// src/main/helpers/FileHelper.js

const { app, ipcMain, dialog, shell, net } = require('electron');
const { createReadStream, createWriteStream } = require('fs');
const { exec, execFile, spawn } = require('child_process');
const { setTimeout } = require('node:timers/promises');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const fsSync = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PathHelper = require('./PathHelper.js');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// #region Files and Directories

async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath).catch(async () => {
      await fs.mkdir(dirPath, { recursive: true });
    });
    return dirPath;
  } catch (error) {
    throw new Error(`Error creating directory: ${error.message}\n${error.stack}`);
  }
}

async function checkFileDirExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFiles(srcDir, destDir, ext = null) {
  const files = await getAllFiles(srcDir, ext);
  await fs.mkdir(destDir, { recursive: true });
  for (const file of files) {
    const dest = path.join(destDir, path.basename(file));
    await fs.copyFile(file, dest);
  }
}

async function copyDirectory(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    verbatimSymlinks: true
  });
}

async function moveFiles(srcDir, destDir, ext = null) {
  const files = await getAllFiles(srcDir, ext);
  await fs.mkdir(destDir, { recursive: true });
  for (const file of files) {
    const dest = path.join(destDir, path.basename(file));
    await fs.rename(file, dest);
  }
}

async function deleteFiles(srcDir, ext = null) {
    const files = await getAllFiles(srcDir, ext);
    await Promise.all(
        files.map(file => fs.rm(file, { force: true }))
    );
}

async function deleteDirectory(dirPath, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const isLocked = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'ENOTEMPTY';
      if (i === maxRetries - 1 || !isLocked) {
        throw err;
      }
      await setTimeout((i + 1) * 200);
    }
  }
}

async function getAllFiles(dir, extFilter = null) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await getAllFiles(fullPath, extFilter));
    } else {
      const fileExt = path.extname(entry.name).toLowerCase();
      if (!extFilter || fileExt === extFilter.toLowerCase()) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

async function findFile(folderPath, pattern) {
  const regexPattern = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  try {
    const files = await fs.readdir(folderPath);
    const matches = files
      .filter(file => regexPattern.test(file))
      .map(file => path.join(folderPath, file));

    if (matches.length === 0) {
      throw new Error(`No files matching pattern "${pattern}" found in "${folderPath}"`);
    }

    return matches[0];
  } catch (error) {
    throw new Error(`Error finding file: ${error.message}\n${error.stack}`);
  }
}

// #endregion

// #region JSON Files

async function readJSON(filePath) {
  const resolvedPath = PathHelper.resolveEnvVariables(filePath);
  try {
    await fs.access(resolvedPath);
    const data = await fs.readFile(resolvedPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`File not found: ${resolvedPath}`);
      return null;
    }
    console.error(`Error loading JSON file: ${resolvedPath}`, err);
    throw err;
  }
}

async function writeJSON(filePath, data, prettyPrint = true) {
  const resolvedPath = PathHelper.resolveEnvVariables(filePath);
  try {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    const space = prettyPrint ? 2 : 0;
    await fs.writeFile(resolvedPath, JSON.stringify(data, null, space), 'utf8');
    return true;
  } catch (error) {
    throw new Error(error.message + error.stack);
  }
}

// #endregion

// #region Dialogs

async function ShowOpenDialog(options) {
  try {
    const result = dialog.showOpenDialogSync(options);
    return result;
  } catch (error) {
    throw new Error(error.message + error.stack);
  }
}

async function ShowSaveDialog(options) {
  try {
    const result = dialog.showSaveDialogSync(options);
    return result ? result : null;
  } catch (error) {
    throw new Error(error.message + error.stack);
  }
}

// #endregion

// #region File Execution

function openUrlInBrowser(url) {
  console.log('[FileHelper] Opening URL in browser:', url);
  shell.openExternal(url);
}

function openPathInExplorer(filePath) {
  // Nota: Corregido para usar PathHelper.resolveEnvVariables
  const normalizedPath = PathHelper.resolveEnvVariables(
    path.normalize(filePath)
  );

  let command;
  if (os.platform() === 'win32') {
    command = `start "" "${normalizedPath}"`;
  } else if (os.platform() === 'darwin') {
    command = `open "${normalizedPath}"`;
  } else {
    command = `xdg-open "${normalizedPath}"`;
  }

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error opening path: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`Path opened successfully: ${stdout}`);
  });
}

async function openFile(filePath) {
  try {
    const absoluteFilePath = path.resolve(filePath);
    await shell.openPath(absoluteFilePath);
    console.log(`Opened file: ${absoluteFilePath}`);
  } catch (error) {
    console.error(`Error opening file: ${error}`);
  }
}

// #endregion

// #region Program Executions

function detectProgram(exeName, callback) {
  const platform = os.platform();

  if (platform === 'win32') {
    const psCommand = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='${exeName}'\\" | Select-Object -ExpandProperty ExecutablePath"`;

    exec(psCommand, (err, stdout, stderr) => {
      if (err) return callback(err, null);

      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

      for (const exePath of lines) {
        if (!exePath.toLowerCase().includes('launcher')) {
          return callback(null, exePath);
        }
      }
      callback(null, null);
    });

  } else {
    const safeName = exeName.replace(/["\\]/g, '\\\\$&');
    const pgrepCmd = `pgrep -af "${safeName}"`;

    exec(pgrepCmd, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        return callback(err || new Error('No encontrado'), null);
      }

      const lines = stdout.trim().split(/\r?\n/);
      let found = false;

      for (const line of lines) {
        if (found) break;
        if (line.toLowerCase().includes('launcher')) continue;

        const [pid] = line.trim().split(' ', 1);
        if (!pid) continue;

        found = true;
        exec(`readlink -f /proc/${pid}/exe`, (err2, exePathOut) => {
          if (err2 || !exePathOut.trim()) {
            return callback(err2 || new Error('Fallo al leer ruta'), null);
          }
          callback(null, exePathOut.trim());
        });
      }

      if (!found) {
        callback(null, null);
      }
    });
  }
}

function terminateProgram(exeName, options = {}, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const { usePromise = false } = options;
  const platform = os.platform();
  const safeName = exeName.replace(/["\\$`]/g, '\\$&');

  const runner = async () => {
    if (platform === 'win32') {
      const psGet = `powershell -NoProfile -Command `
        + `"Get-CimInstance Win32_Process -Filter \\"Name='${safeName}'\\" `
        + `| Select-Object -ExpandProperty ProcessId"`;
      const { stdout: pidList } = await execAsync(psGet);
      const pids = pidList
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

      if (!pids.length) return `No se encontraron procesos "${exeName}"`;

      for (const pid of pids) {
        await execFileAsync('taskkill', ['/F', '/PID', pid]);
      }
      return `Terminados procesos: ${pids.join(', ')}`;

    } else {
      const { stdout: raw } = await execAsync(`pgrep -f "${safeName}"`);
      const pids = raw
        .trim()
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

      if (!pids.length) return `No se encontraron procesos "${exeName}"`;

      await Promise.all(
        pids.map(pid => execFileAsync('kill', ['-9', pid]))
      );
      return `Terminados procesos: ${pids.join(', ')}`;
    }
  };

  if (usePromise) {
    return runner();
  } else {
    runner()
      .then(result => callback(null, result))
      .catch(err   => callback(err, null));
  }
}

function runScripOrProgram(filePath, args = []) {
  try {
    console.log('Launching program:', filePath, args);

    const resolvedPath = path.resolve(filePath);
    const workingDir = path.dirname(resolvedPath);

    if (process.platform === 'linux') {
      console.log('Linux platform detected');
      fsSync.chmod(resolvedPath, 0o755, (chmodError) => {
        if (chmodError) {
          console.warn(`Warning: Could not change file permissions for ${resolvedPath}.`, chmodError);
        }
      });

      const options = {
        detached: true,
        stdio: 'ignore',
        cwd: workingDir
      };

      const child = spawn('bash', [resolvedPath, ...args], options);
      child.unref();
      console.log('Shell script launched in detached mode.');
    }

    else if (process.platform === 'win32') {
      console.log('Windows platform detected');

      const options = {
        detached: true,
        stdio: 'ignore',
        cwd: workingDir,
        windowsHide: true
      };

      const child = spawn('cmd.exe', ['/c', resolvedPath, ...args], options);
      child.unref();
      console.log('Batch file launched in detached mode.');
      return 'Batch file started successfully';
    }

    else {
      console.error(`Unsupported platform: ${process.platform}`);
    }

    return 'Program started';
  } catch (error) {
    console.error(`Error starting program: ${error}`);
    return 'Program could not start';
  }
}

// #endregion

// #region Networking

async function downloadAsset(url, destination) {
  return new Promise((resolve, reject) => {

    const parentFolder = path.dirname(destination); // Modificado usando path nativo
    ensureDirectoryExists(parentFolder);
    if (fsSync.existsSync(destination)) {
      fsSync.unlinkSync(destination);
    }

    const file = fsSync.createWriteStream(destination);
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', async () => {
        file.close(async (err) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            console.log('Downloaded File:', destination);
            const fileExtension = path.extname(destination).toLowerCase();

            if (fileExtension === '.json') {
              const fileContent = await readJSON(destination); 
              resolve(fileContent);
            } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(fileExtension)) {
              const fileContent = fsSync.readFileSync(destination, 'base64');
              resolve(`data:image/${fileExtension.slice(1)};base64,${fileContent}`); 
            } else {
              resolve(fsSync.readFileSync(destination)); 
            }

          } catch (parseError) {
            reject(parseError);
          }
        });
      });
    }).on('error', (err) => {
      fsSync.unlink(destination, () => reject(err)); 
    });
  });
}

async function downloadFile(url, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP error! status: ${response.statusCode}`));
        return;
      }

      const totalLength = parseInt(response.headers['content-length'], 10);
      let downloadedLength = 0;
      let lastUpdateTime = Date.now();
      let lastDownloadedLength = 0;

      const writer = fsSync.createWriteStream(filePath);

      response.on('data', (chunk) => {
        writer.write(chunk);
        downloadedLength += chunk.length;

        const now = Date.now();
        if (now - lastUpdateTime > 100) {
          const progress = (downloadedLength / totalLength) * 100;
          const timeDiff = now - lastUpdateTime;
          const bytesDiff = downloadedLength - lastDownloadedLength;
          const speed = bytesDiff / (timeDiff / 1000); 

          if (onProgress) onProgress(progress, speed);
          lastUpdateTime = now;
          lastDownloadedLength = downloadedLength;
        }
      });

      response.on('end', () => {
        writer.end();
        if (onProgress) onProgress(100, 0);
        resolve();
      });

      writer.on('finish', () => {});

      response.on('error', (err) => {
        writer.end();
        reject(err);
      });

      writer.on('error', (err) => {
        reject(err);
      });
    });

    request.on('error', (err) => {
      reject(err);
    });

    request.end();
  });
}

// #endregion

// #region IPC Handlers

ipcMain.handle('file:copy', async (event, srcDir, destDir, ext) => {
  return copyFiles(srcDir, destDir, ext);
});

ipcMain.handle('file:move', async (event, srcDir, destDir, ext) => {
  return moveFiles(srcDir, destDir, ext);
});

ipcMain.handle('file:delete', async (event, srcDir, ext) => {
  return deleteFiles(srcDir, ext);
});

ipcMain.handle('file:deleteDir', async (event, dirPath) => {
  return deleteDirectory(dirPath);
});

ipcMain.handle('file:list', async (event, dir, extFilter) => {
  return getAllFiles(dir, extFilter);
});

ipcMain.handle('file:readJSON', async (event, filePath) => {
  return readJSON(filePath);
});

ipcMain.handle('file:writeJSON', async (event, filePath, obj) => {
  return writeJSON(filePath, obj);
});

ipcMain.handle('file:findFile', async (event, folderPath, pattern) => {
  return findFile(folderPath, pattern);
});

ipcMain.handle('file:showOpenDialog', async (event, options) => {
  return ShowOpenDialog(options);
});

ipcMain.handle('file:showSaveDialog', async (event, options) => {
  return ShowSaveDialog(options);
});

ipcMain.handle('ShowMessageBox', async (event, options) => {
  try {
    const result = await dialog.showMessageBox(options);
    return result;
  } catch (error) {
    throw new Error(error.message + error.stack);
  }
});

ipcMain.handle('file:checkExists', async (event, filePath) => {
  return checkFileDirExists(filePath);
});

ipcMain.handle('file:ensureDir', async (event, dirPath) => {
  return ensureDirectoryExists(dirPath);
});

ipcMain.handle('file:openUrlInBrowser', (event, url) => openUrlInBrowser(url));
ipcMain.handle('file:openPathInExplorer', (event, filePath) => openPathInExplorer(filePath));
ipcMain.handle('file:openFile', (event, filePath) => openFile(filePath));
ipcMain.handle('file:detectProgram', (event, exeName) =>
  new Promise((resolve, reject) => {
    detectProgram(exeName, (err, path) => {
      if (err) reject(err);
      else resolve(path);
    });
  })
);
ipcMain.handle('file:terminateProgram', (event, exeName, options) =>
  terminateProgram(exeName, { ...options, usePromise: true })
);
ipcMain.handle('file:runScriptOrProgram', async (event, filePath, args) => {
  return runScripOrProgram(filePath, args);
});

ipcMain.handle('file:downloadAsset', async (event, url, destination) => {
  return downloadAsset(url, destination);
});

ipcMain.handle('file:downloadFile', async (event, url, filePath) => {
  return downloadFile(url, filePath, (progress, speed) => {
    event.sender.send('download-progress', { progress, speed });
  });
});

ipcMain.handle('file:readAsBase64', async (_, filePath) => {
  const buf = await fs.readFile(filePath)
  return buf.toString('base64')
})

// #endregion

// Reemplazo del "export default" por "module.exports"
module.exports = {
  ensureDirectoryExists,
  checkFileDirExists,
  copyFiles,
  moveFiles,
  deleteFiles,
  deleteDirectory,
  getAllFiles,
  findFile,
  readJSON,
  writeJSON,
  ShowOpenDialog,
  ShowSaveDialog,
  openUrlInBrowser,
  openPathInExplorer,
  openFile,
  detectProgram,
  terminateProgram,
  runScripOrProgram,
  downloadAsset,
  downloadFile
};