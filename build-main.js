// build-main.js
const fs = require('fs');
const path = require('path');

console.log('📦 Building main process...');

// ==================== PARTE 0: LIMPIAR RELEASE ANTERIOR ====================
console.log('🧹 Cleaning previous release...');

const releaseDir = path.join(__dirname, 'release');
const dirsToClean = ['installer', 'win-unpacked'];

dirsToClean.forEach(dir => {
    const fullPath = path.join(releaseDir, dir);
    if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`  ✓ Cleaned: ${dir}/`);
    }
});

// También limpiar el latest.yml de la raíz de release
const oldYml = path.join(releaseDir, 'latest.yml');
if (fs.existsSync(oldYml)) {
    fs.unlinkSync(oldYml);
    console.log('  ✓ Cleaned: latest.yml');
}

console.log('✅ Release cleaned!\n');

// ==================== PARTE 1: COPIAR ARCHIVOS ====================
const srcMainDir = path.join(__dirname, 'src/main');
const srcPreloadDir = path.join(__dirname, 'src/shared');
const distMainDir = path.join(__dirname, 'dist/main');
const distPreloadDir = path.join(__dirname, 'dist/shared');

// Función para copiar archivos recursivamente
function copyDir(src, dest) {
    if (!fs.existsSync(src)) {
        console.error(`  ✗ SOURCE NOT FOUND: ${src}`);  // <-- detecta el problema
        return;
    }
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
            console.log(`  ✓ ${path.relative(__dirname, destPath)}`);
        }
    }
}

// Copiar proceso principal
console.log('\n📁 Copying main process files...');
copyDir(srcMainDir, distMainDir);

// Copiar preload
console.log('\n📁 Copying preload files...');
copyDir(srcPreloadDir, distPreloadDir);

console.log('\n✅ Main process build complete!\n');

// ==================== PARTE 2: CREAR CARPETAS DE OUTPUT ====================
console.log('📁 Creating output directories for electron-builder...');

const outputDirs = [
    // Windows
    path.join(__dirname, 'release', 'installer'),
    //path.join(__dirname, 'release', 'portable'),
    // Linux
    //path.join(__dirname, 'release', 'tarball'),
    //path.join(__dirname, 'release', 'appimage'),
    //path.join(__dirname, 'release', 'deb'),
    //path.join(__dirname, 'release', 'rpm')
];

outputDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`  ✓ Created: ${path.basename(dir)}/`);
    } else {
        console.log(`  ℹ Already exists: ${path.basename(dir)}/`);
    }
});

console.log('✅ Output directories ready!\n');

// ==================== PARTE 3: COPIAR latest.yml A INSTALLER ====================
const installerDir = path.join(__dirname, 'release', 'installer');
const latestYml = path.join(releaseDir, 'latest.yml');
const latestYmlDest = path.join(installerDir, 'latest.yml');

if (fs.existsSync(latestYml)) {
  fs.copyFileSync(latestYml, latestYmlDest);
  console.log('✅ latest.yml copiado a installer/');
} else {
  console.log('ℹ latest.yml no existe aun (se genera despues del build)');
}
/*

---
npm run build:prod:win
npm run build:prod:linux

## 📂 Estructura final en `release/`:
```
release/
├── installer/          # Windows
│   └── Material App Setup 1.0.0.exe
├── portable/           # Windows
│   └── Material App 1.0.0.exe
├── tarball/            # Linux - UNIVERSAL
│   └── Material App-1.0.0-x64.tar.gz
├── appimage/           # Linux - Moderno
│   └── Material App-1.0.0.AppImage
├── deb/                # Linux - Debian/Ubuntu
│   └── Material App_1.0.0_amd64.deb
├── rpm/                # Linux - Fedora/RHEL
│   └── Material App-1.0.0.x86_64.rpm
└── win-unpacked/
└── linux-unpacked/

Cómo usar el tarball:
bash# 1. Extraer
tar -xzf "Material App-1.0.0-x64.tar.gz"

# 2. Entrar a la carpeta
cd "Material App-1.0.0-x64"

# 3. Ejecutar
./material-app
*/