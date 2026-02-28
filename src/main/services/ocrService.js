const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sharp = require('sharp')
const uexCache = require('../helpers/uexCache')

const TESSERACT_PATH = 'tesseract'
const TMP_DIR = os.tmpdir()

// ─────────────────────────────────────────────
// Blacklist: líneas de UI que NO son el nombre
// ─────────────────────────────────────────────
const SECTOR_A_BLACKLIST = [
  'YOUR INVENTORIES',
  'YOUR INVENTORIE',    // OCR a veces corta la S
  'YOUR INVENTOR',      // OCR corta más
  'IN DEMAND',
  'IN DEMANO',          // OCR confunde D con O
  'NO DEMAND',
  'NO DEMANO',
  'CANNOT SELL',
  'CANNO SELL',         // OCR a veces pierde la T
  'SELECT SUB-CATEGORY',
  'SELECT SUB CATEGORY',
  'SELECT SUB',
  'COMMODITIES',
  'ITEMS',
  'VEHICLES',
]

// Sufijos/tokens que Tesseract añade por ruido de UI (ícono chevron, bordes, etc.)
// Se eliminan del nombre DESPUÉS de extraerlo
const NOMBRE_NOISE_TOKENS = [
  / VV\s*$/,        // ícono ✓ del dropdown leído como VV al final
  / V\s*$/,         // variante con una sola V
  / IP\s*$/,        // ícono ▶ de la UI azul leído como IP
  / [A-Z]{1,2}\s*$/, // cualquier 1-2 letras sueltas al final (ruido de ícono)
  /^\s*\|\s*/,      // pipes del marco al inicio
  /\s*\|\s*$/,      // pipes del marco al final
]

// Longitud mínima para considerar una línea válida
// Evita ruido como "4", "|", "I", etc.
const MIN_LINE_LENGTH = 5

// ─────────────────────────────────────────────
// Fuzzy match: compara dos strings letra a letra
// Retorna un score 0-1 (1 = idénticos)
// Usa distancia de Levenshtein normalizada
// ─────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function fuzzyMatchTerminal(ocrText, terminals) {
  if (!ocrText || !terminals?.length) return null

  const query = ocrText.toUpperCase().trim()
  console.log(`[fuzzyMatch] Buscando coincidencia para: "${query}"`)
  console.log(`[fuzzyMatch] Total terminales disponibles: ${terminals.length}`)

  let bestMatch = null
  let bestScore = Infinity
  let bestSimilarity = 0

  for (const terminal of terminals) {
    // Comparar contra múltiples campos — el OCR puede leer cualquiera de ellos
    const candidates = [
      terminal.nickname,
      terminal.displayname,
      terminal.space_station_name,
      terminal.name,
    ].filter(Boolean).map(s => s.toUpperCase().trim())

    for (const name of candidates) {
      const dist = levenshtein(query, name)
      const maxLen = Math.max(query.length, name.length)
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0

      if (dist < bestScore) {
        bestScore = dist
        bestMatch = terminal
        bestSimilarity = similarity
      }
    }
  }

  console.log(`[fuzzyMatch] Mejor match: "${bestMatch?.name || bestMatch?.station_name}" (similarity: ${(bestSimilarity * 100).toFixed(1)}% dist:${bestScore})`)

  // Solo aceptar si la similitud es razonable (>40%)
  // Umbral bajo para tolerar errores del OCR
  if (bestSimilarity < 0.65) {
    console.log(`[fuzzyMatch] ⚠️  Similitud muy baja, descartando match`)
    return null
  }

  return { terminal: bestMatch, similarity: bestSimilarity }
}


// ─────────────────────────────────────────────
// Run Tesseract CLI (psm configurable)
// ─────────────────────────────────────────────
function runTesseract(imagePath, psm = 6) {
  console.log(`[Tesseract] Ejecutando OCR sobre: ${imagePath} (psm:${psm})`)

  return new Promise((resolve, reject) => {
    execFile(
      TESSERACT_PATH,
      [imagePath, 'stdout', '-l', 'eng', '--psm', String(psm)],
      (error, stdout) => {
        if (error) {
          console.error('[Tesseract] ERROR:', error.message)
          return reject(error)
        }
        console.log(`[Tesseract] OK. Caracteres leídos: ${stdout.length}`)
        console.log(`[Tesseract] Raw output:\n${stdout}`)
        resolve(stdout)
      }
    )
  })
}

function isReasonableCandidate(text) {
  if (!text) return false

  // mínimo 8 caracteres
  if (text.length < 8) return false

  // debe tener al menos 2 palabras
  const words = text.split(' ').filter(w => w.length > 2)
  if (words.length < 2) return false

  // no debe tener más números que letras
  const letters = (text.match(/[A-Z]/g) || []).length
  const numbers = (text.match(/[0-9]/g) || []).length
  if (numbers > letters) return false

  return true
}

// ─────────────────────────────────────────────
// Crop Sector A - Zona TIPO
// Franja superior generosa: captura COMMODITIES / ITEMS / VEHICLES
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Detecta dinámicamente la fila donde empieza la UI
// Busca la primera banda sostenida de brillo en el
// tercio izquierdo (donde siempre está el título COMMODITIES)
// Retorna la fila absoluta del inicio de la UI
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Detecta si la UI es naranja o azul/cyan
// comparando el ratio R/G en el panel izquierdo.
// Naranja: R >> G  (ratio > 1.4)
// Azul/cyan: R ≈ G ≈ B  (ratio < 1.4)
// ─────────────────────────────────────────────
async function detectUIColorScheme(buffer, width, height) {
  const x = Math.floor(width  * 0.10)
  const y = Math.floor(height * 0.15)
  const w = Math.floor(width  * 0.35)
  const h = Math.floor(height * 0.35)

  const raw = await sharp(buffer)
    .extract({ left: x, top: y, width: w, height: h })
    .raw()
    .toBuffer()

  const meta = await sharp(buffer).metadata()
  const channels = meta.channels ?? 3

  let rSum = 0, gSum = 0, count = 0
  for (let i = 0; i < raw.length; i += channels) {
    rSum += raw[i]
    gSum += raw[i + 1]
    count++
  }

  const rMean = rSum / count
  const gMean = gSum / count
  const ratio  = rMean / Math.max(gMean, 1)
  const scheme = ratio > 1.4 ? 'orange' : 'blue'
  console.log(`[detectUIColorScheme] R=${rMean.toFixed(0)} G=${gMean.toFixed(0)} ratio=${ratio.toFixed(2)} → ${scheme}`)
  return scheme
}

// ─────────────────────────────────────────────
// Encuentra la fila central del dropdown buscando
// el máximo de (mean × contrast) en x:5%-45%
// ─────────────────────────────────────────────
async function findDropdownPeakRow(buffer, width, height) {
  const x0 = Math.floor(width  * 0.05)
  const scanW = Math.floor(width * 0.40)
  const y0 = Math.floor(height * 0.05)
  const y1 = Math.floor(height * 0.65)
  const scanH = y1 - y0

  const raw = await sharp(buffer)
    .extract({ left: x0, top: y0, width: scanW, height: scanH })
    .grayscale()
    .raw()
    .toBuffer()

  let bestScore = 0, bestRow = Math.floor(height * 0.25)
  for (let row = 0; row < scanH; row++) {
    let sum = 0
    const vals = []
    for (let col = 0; col < scanW; col++) {
      const v = raw[row * scanW + col]
      sum += v
      vals.push(v)
    }
    const mean = sum / scanW
    vals.sort((a, b) => a - b)
    const p10 = vals[Math.floor(scanW * 0.10)]
    const p90 = vals[Math.floor(scanW * 0.90)]
    const score = mean * ((p90 - p10) / 100)
    if (score > bestScore) {
      bestScore = score
      bestRow = y0 + row
    }
  }
  console.log(`[findDropdownPeakRow] peak=${bestRow} (${(bestRow/height*100).toFixed(1)}%) score=${bestScore.toFixed(0)}`)
  return bestRow
}

async function cropSectorA_tipo(buffer) {
  const { width, height } = await sharp(buffer).metadata()

  // Crop ancho que cubre toda la zona posible del título (2%-50% altura)
  const left       = Math.floor(width  * 0.03)
  const top        = Math.floor(height * 0.02)
  const cropWidth  = Math.floor(width  * 0.62)
  const cropHeight = Math.floor(height * 0.48)

  console.log(`[cropSectorA_tipo] ${width}x${height}px → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)

  const cropped = await sharp(buffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .toBuffer()

  console.log(`[cropSectorA_tipo] OK. Buffer: ${cropped.length} bytes`)
  return cropped
}

// ─────────────────────────────────────────────
// Crop Sector A - Zona NOMBRE
// Dos crops distintos según el tipo de UI:
//   UI Naranja: dropdown en ~18-27% → crop centrado ahí
//   UI Azul:    nombre en texto plano en ~12-20% → crop más arriba
// Ambos con margen generoso para tolerar imágenes ladeadas
// ─────────────────────────────────────────────
async function cropSectorA_nombre(buffer, colorScheme, dropdownPeak) {
  const { width, height } = await sharp(buffer).metadata()

  if (colorScheme === 'orange') {
    // UI naranja: recorte enfocado en el dropdown (peak ± ~40px)
    // más estrecho horizontalmente para evitar ruido del marco físico
    const left       = Math.floor(width  * 0.05)
    const top        = Math.max(0, dropdownPeak - 40)
    const cropWidth  = Math.floor(width  * 0.35)
    const cropHeight = Math.min(Math.floor(height * 0.10), height - top)
    console.log(`[cropSectorA_nombre] orange: left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
    return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
  } else {
    // UI azul: crop ancho desde arriba (2%-73%) — YOUR INVENTORIES anchor siempre visible
    const left       = Math.floor(width  * 0.03)
    const top        = Math.floor(height * 0.02)
    const cropWidth  = Math.floor(width  * 0.42)
    const cropHeight = Math.floor(height * 0.71)
    console.log(`[cropSectorA_nombre] blue: left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
    return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
  }
}



// ─────────────────────────────────────────────
// Preprocesamiento SUAVE para nombre
// NO usa threshold
// Ideal para UI naranja con buen contraste natural
// ─────────────────────────────────────────────
async function preprocessNombreSoft(buffer) {
  console.log('[preprocessNombreSoft] resize 3x → grayscale → normalize → sharpen')
  const meta = await sharp(buffer).metadata()

  const processed = await sharp(buffer)
    .resize({ width: meta.width * 3, kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer()

  console.log(`[preprocessNombreSoft] OK. Buffer: ${processed.length} bytes`)
  return processed
}

// ─────────────────────────────────────────────
// Preprocesamiento ADAPTIVO para UI naranja
// Diferencia pixel vs blur local — extrae texto
// oscuro sobre fondo naranja (bajo contraste global)
// ─────────────────────────────────────────────
async function preprocessNombreAdaptive(buffer) {
  console.log('[preprocessNombreAdaptive] adaptive threshold (blur-diff)')
  const meta = await sharp(buffer).metadata()
  const w4 = meta.width * 4
  const h4 = meta.height * 4

  const scaled = await sharp(buffer)
    .resize({ width: w4, kernel: 'lanczos3' })
    .grayscale()
    .raw()
    .toBuffer()

  const blurred = await sharp(scaled, { raw: { width: w4, height: h4, channels: 1 } })
    .blur(5)
    .raw()
    .toBuffer()

  const diff = Buffer.alloc(w4 * h4)
  for (let i = 0; i < w4 * h4; i++) {
    diff[i] = Math.min(255, Math.max(0, (blurred[i] - scaled[i]) * 5 + 128))
  }

  const out = await sharp(diff, { raw: { width: w4, height: h4, channels: 1 } })
    .normalize()
    .sharpen()
    .png()
    .toBuffer()

  console.log(`[preprocessNombreAdaptive] OK. Buffer: ${out.length} bytes`)
  return out
}


// ─────────────────────────────────────────────
// Preprocesamiento PASADA 1
// Para el dropdown del nombre: texto oscuro sobre fondo naranja/gris claro
// Escala 3x + threshold agresivo para maximizar contraste
// ─────────────────────────────────────────────
async function preprocessPass1(buffer) {
  console.log('[preprocessPass1] resize 3x → grayscale → normalize → threshold(100) → sharpen')
  const meta = await sharp(buffer).metadata()
  const processed = await sharp(buffer)
    .resize({ width: meta.width * 3, kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .threshold(100)   // más bajo = preserva texto más claro/gris
    .sharpen()
    .toBuffer()
  console.log(`[preprocessPass1] OK. Buffer: ${processed.length} bytes`)
  return processed
}

// ─────────────────────────────────────────────
// Preprocesamiento PASADA 2
// Para COMMODITIES: texto claro sobre fondo oscuro
// negate invierte para que Tesseract lea texto oscuro sobre fondo claro
// ─────────────────────────────────────────────
async function preprocessPass2(buffer) {
  console.log('[preprocessPass2] resize 3x → grayscale → negate → normalize → sharpen  (con negate)')
  const meta = await sharp(buffer).metadata()
  const processed = await sharp(buffer)
    .resize({ width: meta.width * 3, kernel: 'lanczos3' })
    .grayscale()
    .negate()
    .normalize()
    .sharpen()
    .toBuffer()
  console.log(`[preprocessPass2] OK. Buffer: ${processed.length} bytes`)
  return processed
}

// ─────────────────────────────────────────────
// Limpia una línea de texto OCR
// Permite: A-Z, 0-9, guión (-) y espacio
// ─────────────────────────────────────────────
function cleanLine(line) {
  return line
    .toUpperCase()
    .replace(/[^A-Z0-9\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─────────────────────────────────────────────
// Verifica si una línea está en la blacklist
// ─────────────────────────────────────────────
function isBlacklisted(line) {
  const match = SECTOR_A_BLACKLIST.some(b => line.includes(b))
  if (match) console.log(`[isBlacklisted] ❌ Descartada: "${line}"`)
  return match
}

// ─────────────────────────────────────────────
// Extrae líneas válidas de un texto OCR crudo
// Aplica: limpieza, longitud mínima, blacklist
// ─────────────────────────────────────────────
function extractValidLines(rawText, label) {
  console.log(`\n[extractValidLines:${label}] Procesando texto...`)
  const rawLines = rawText.split(/\r?\n/)
  console.log(`[extractValidLines:${label}] Total líneas raw: ${rawLines.length}`)
  rawLines.forEach((l, i) => console.log(`  [raw ${i}] ${JSON.stringify(l)}`))

  const valid = []
  for (const line of rawLines) {
    const cleaned = cleanLine(line)

    if (cleaned.length === 0) {
      console.log(`  → ⚪ Vacía, descartada`)
      continue
    }

    if (cleaned.length < MIN_LINE_LENGTH) {
      console.log(`  → ⚪ Muy corta (${cleaned.length} chars): "${cleaned}", descartada`)
      continue
    }

    if (isBlacklisted(cleaned)) continue

    console.log(`  → ✅ Aceptada: "${cleaned}"`)
    valid.push(cleaned)
  }

  console.log(`[extractValidLines:${label}] Líneas válidas (${valid.length}):`, valid)
  return valid
}

// ─────────────────────────────────────────────cropSectorA
// Detecta el tipo de terminal desde el texto crudo
// Se busca en el raw ANTES de aplicar blacklist
// porque COMMODITIES está en la blacklist (es UI, no es el nombre)
// ─────────────────────────────────────────────
function detectTypeFromRaw(rawText) {
  const upper = rawText.toUpperCase()
  console.log(`[detectTypeFromRaw] Buscando keywords en texto raw...`)

  if (upper.includes('COMMODITIES')) {
    console.log(`[detectTypeFromRaw] ✅ Encontrado: COMMODITIES → commodity`)
    return 'commodity'
  }
  if (upper.includes('ITEMS')) {
    console.log(`[detectTypeFromRaw] ✅ Encontrado: ITEMS → item`)
    return 'item'
  }
  if (upper.includes('VEHICLES')) {
    console.log(`[detectTypeFromRaw] ✅ Encontrado: VEHICLES → vehicle`)
    return 'vehicle'
  }

  console.log(`[detectTypeFromRaw] ⚠️  No se encontró keyword conocida → unknown`)
  return 'unknown'
}

// ─────────────────────────────────────────────
// Directorio de debug — guarda imágenes tmp para inspección visual
// ⚠️  DEBUG: cambiar a true para guardar imágenes y poder inspeccionarlas
// ─────────────────────────────────────────────
const DEBUG_SAVE_IMAGES = true
const DEBUG_DIR = path.join(os.homedir(), 'Desktop', 'ocr-debug')

async function ensureDebugDir() {
  if (!DEBUG_SAVE_IMAGES) return
  try {
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true })
    console.log(`[DEBUG] Carpeta de debug: ${DEBUG_DIR}`)
  } catch (e) {
    console.warn('[DEBUG] No se pudo crear carpeta de debug:', e.message)
  }
}

async function saveDebugImage(buffer, name) {
  if (!DEBUG_SAVE_IMAGES) return
  const filepath = path.join(DEBUG_DIR, name)
  await fs.promises.writeFile(filepath, buffer)
  console.log(`[DEBUG] 🖼️  Imagen guardada: ${filepath}`)
}

// ─────────────────────────────────────────────
// Extrae tipo y nombre del Sector A
// Doble pasada OCR sobre el mismo crop:
//   Pasada 1 (sin negate) → detecta el tipo
//   Pasada 2 (con negate) → detecta el nombre (dropdown naranja)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Extrae el nombre de terminal buscando la línea
// inmediatamente después de "YOUR INVENTORIES" en el OCR.
// Funciona en UI naranja y azul independientemente del crop.
// ─────────────────────────────────────────────
// Extrae la primera línea válida de múltiples textos raw.
// Usada para UI naranja donde el crop ya es solo el dropdown.
function extractFirstValidLine(...rawTexts) {
  for (const raw of rawTexts) {
    if (!raw) continue
    const lines = raw.split(/\r?\n/)
      .map(l => l.toUpperCase().replace(/[^A-Z0-9\-\s]/g, '').replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 4 && /[A-Z]/.test(l))
      .filter(l => !SECTOR_A_BLACKLIST.some(b => l.includes(b)))
    if (lines.length > 0) {
      console.log(`[extractFirstValidLine] ✅ "${lines[0]}"`)
      return lines[0]
    }
  }
  console.log('[extractFirstValidLine] ⚠️ No encontrado')
  return null
}

function extractLineAfterYourInventories(...rawTexts) {
  // Variantes de "YOUR INVENTORIES" que el OCR puede producir
  const YOUR_INV_VARIANTS = [
    'YOUR INVENTORIES',
    'YOUR INVENTORIE',
    'YOUR INVENTOR',
    'YOUR INVENTO',
    'JR INVENTORIES',
    'UR INVENTORIES',
    'INVENTORIES',
  ]

  for (const rawText of rawTexts) {
    if (!rawText) continue
    const lines = rawText.split(/\r?\n/).map(l => l.toUpperCase().replace(/[^A-Z0-9\-\s]/g, '').replace(/\s+/g, ' ').trim())

    for (let i = 0; i < lines.length; i++) {
      const isYourInv = YOUR_INV_VARIANTS.some(v => lines[i].includes(v))
      if (!isYourInv) continue

      // Buscar la siguiente línea no vacía después de YOUR INVENTORIES
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j].trim()
        if (candidate.length < 3) continue
        // Rechazar si es otra etiqueta de UI conocida
        if (SECTOR_A_BLACKLIST.some(b => candidate.includes(b))) continue
        // Rechazar si es solo ruido (pocos chars o solo símbolos)
        if (candidate.length < 4) continue
        if (!/[A-Z]/.test(candidate)) continue

        console.log(`[extractLineAfterYourInv] ✅ Encontrado: "${candidate}" (línea ${j}, después de YOUR INVENTORIES en línea ${i})`)
        return candidate
      }
    }
  }

  console.log('[extractLineAfterYourInv] ⚠️ No encontrado en ninguna pasada')
  return null
}

// ─────────────────────────────────────────────
// Extrae tipo y nombre del Sector A
// Usa 3 pasadas para nombre:
//   1) SOFT (principal)
//   2) THRESHOLD (backup)
//   3) NEGATE (backup UI azul)
// ─────────────────────────────────────────────
async function extractSectorA(imageBuffer) {
  console.log('\n══════════════════════════════════')
  console.log('[extractSectorA] INICIO')
  await ensureDebugDir()

  // ── DETECTAR ESQUEMA DE COLOR (naranja vs azul) ──────────────────
  const { width, height } = await sharp(imageBuffer).metadata()
  const colorScheme = await detectUIColorScheme(imageBuffer, width, height)

  // ── CROP TIPO ────────────────────────────────────────────────────
  console.log('\n[extractSectorA] ── CROP TIPO ──')
  const tipoCropBuffer = await cropSectorA_tipo(imageBuffer)
  await saveDebugImage(tipoCropBuffer, '00-crop-tipo-raw.png')

  const tipoProcessed = await preprocessPass2(tipoCropBuffer)
  await saveDebugImage(tipoProcessed, '01-crop-tipo-negate.png')

  const tmpTipo = path.join(TMP_DIR, `ocr-tipo-${Date.now()}.png`)
  await fs.promises.writeFile(tmpTipo, tipoProcessed)
  const rawTipo = await runTesseract(tmpTipo, 11)
  await fs.promises.unlink(tmpTipo)
  const type = detectTypeFromRaw(rawTipo)

  // ── ENCONTRAR DROPDOWN ───────────────────────────────────────────
  const dropdownPeak = colorScheme === 'orange'
    ? await findDropdownPeakRow(imageBuffer, width, height)
    : 0  // no necesario para UI azul

  // ── CROP NOMBRE ──────────────────────────────────────────────────
  console.log('\n[extractSectorA] ── CROP NOMBRE ──')
  const nombreCropBuffer = await cropSectorA_nombre(imageBuffer, colorScheme, dropdownPeak)
  await saveDebugImage(nombreCropBuffer, '02-crop-nombre-raw.png')

  let rawNeg = '', rawSoft = '', rawAdaptive = ''

  if (colorScheme === 'orange') {
    // UI naranja: adaptive (diferencia local) como pasada principal
    const nombreAdaptive = await preprocessNombreAdaptive(nombreCropBuffer)
    await saveDebugImage(nombreAdaptive, '03-crop-nombre-adaptive.png')
    const tmpAdp = path.join(TMP_DIR, `ocr-nombre-adp-${Date.now()}.png`)
    await fs.promises.writeFile(tmpAdp, nombreAdaptive)
    rawAdaptive = await runTesseract(tmpAdp, 11)
    await fs.promises.unlink(tmpAdp)
    console.log('[NOMBRE ADAPTIVE]:\n' + rawAdaptive)

    // Negate como backup
    const nombreNeg = await preprocessPass2(nombreCropBuffer)
    await saveDebugImage(nombreNeg, '04-crop-nombre-negate.png')
    const tmpNeg = path.join(TMP_DIR, `ocr-nombre-neg-${Date.now()}.png`)
    await fs.promises.writeFile(tmpNeg, nombreNeg)
    rawNeg = await runTesseract(tmpNeg, 11)
    await fs.promises.unlink(tmpNeg)
    console.log('[NOMBRE NEGATE]:\n' + rawNeg)

  } else {
    // UI azul: negate como pasada principal
    const nombreNeg = await preprocessPass2(nombreCropBuffer)
    await saveDebugImage(nombreNeg, '03-crop-nombre-negate.png')
    const tmpNeg = path.join(TMP_DIR, `ocr-nombre-neg-${Date.now()}.png`)
    await fs.promises.writeFile(tmpNeg, nombreNeg)
    rawNeg = await runTesseract(tmpNeg, 11)
    await fs.promises.unlink(tmpNeg)
    console.log('[NOMBRE NEGATE]:\n' + rawNeg)

    // Soft como backup
    const nombreSoft = await preprocessNombreSoft(nombreCropBuffer)
    await saveDebugImage(nombreSoft, '04-crop-nombre-soft.png')
    const tmpSoft = path.join(TMP_DIR, `ocr-nombre-soft-${Date.now()}.png`)
    await fs.promises.writeFile(tmpSoft, nombreSoft)
    rawSoft = await runTesseract(tmpSoft, 11)
    await fs.promises.unlink(tmpSoft)
    console.log('[NOMBRE SOFT]:\n' + rawSoft)
  }

  // ── EXTRAER NOMBRE ───────────────────────────────────────────────
  // Para azul: buscar línea después de YOUR INVENTORIES
  // Para naranja: primera línea válida del adaptive (crop ya es solo el dropdown)
  let stationName = null

  if (colorScheme === 'blue') {
    stationName = extractLineAfterYourInventories(rawNeg, rawSoft)
  } else {
    // Crop naranja es solo el dropdown — primera línea válida es el nombre
    stationName = extractFirstValidLine(rawAdaptive, rawNeg)
  }

  const linesNeg      = extractValidLines(rawNeg,      'nombre-negate')
  const linesSoft     = extractValidLines(rawSoft,     'nombre-soft')
  const linesAdaptive = extractValidLines(rawAdaptive, 'nombre-adaptive')
  const allLines = [...new Set([
    ...(stationName ? [stationName] : []),
    ...linesNeg, ...linesSoft, ...linesAdaptive
  ])]

  console.log(`[extractSectorA] Total candidatos: ${allLines.length} → ${JSON.stringify(allLines)}`)
  console.log('\n[extractSectorA] ── RESULTADO ──')
  console.log(`  type:        "${type}"`)
  console.log(`  stationName: "${stationName ?? allLines[0] ?? null}"`)
  console.log('══════════════════════════════════\n')

  return { type, stationName: stationName ?? allLines[0] ?? null, validLines: allLines, rawTipo, rawNombre: rawAdaptive || rawNeg }
}


// ─────────────────────────────────────────────
// Main OCR Process
// ─────────────────────────────────────────────

async function processOCR({ base64 }) {
  console.log('\n████████████████████████████████████')
  console.log('[processOCR] INICIO')
  console.log(`[processOCR] base64 length: ${base64?.length ?? 0}`)

  try {
    const buffer = Buffer.from(base64, 'base64')
    const metadata = await sharp(buffer).metadata()
    console.log(`[processOCR] Imagen: ${metadata.width}x${metadata.height}px formato:${metadata.format}`)

    // ── STEP 1: Cargar terminales cacheadas ────────────────────────
    console.log('\n[processOCR] ── STEP 1: Cargando terminales cacheadas ──')

    let terminals = []
    try {
      const uexCache = require('../helpers/uexCache')
      terminals = uexCache.get('terminals')?.data || []

      console.log(`[processOCR] Terminales disponibles: ${terminals.length}`)
    } catch (e) {
      console.warn('[processOCR] ⚠️ No se pudieron cargar terminales:', e.message)
    }

    // ── STEP 2: Extraer datos OCR ──────────────────────────────────
    console.log('\n[processOCR] ── STEP 2: Extracción Sector A ──')

    const {
      type,
      stationName,
      validLines,
      rawTipo,
      rawNombre
    } = await extractSectorA(buffer)

    // ── STEP 3: Filtro de calidad OCR ──────────────────────────────
    console.log('\n[processOCR] ── STEP 3: Validación de candidatos ──')

    function isReasonableCandidate(text) {
      if (!text) return false

      if (text.length < 8) return false

      const words = text.split(' ').filter(w => w.length > 2)
      if (words.length < 2) return false

      const letters = (text.match(/[A-Z]/g) || []).length
      const numbers = (text.match(/[0-9]/g) || []).length
      if (numbers > letters) return false

      return true
    }

    const filteredLines = (validLines || []).filter(isReasonableCandidate)

    console.log(`[processOCR] Candidatos originales: ${validLines?.length || 0}`)
    console.log(`[processOCR] Candidatos razonables: ${filteredLines.length}`)

    // ── STEP 4: Fuzzy Match seguro ─────────────────────────────────
    console.log('\n[processOCR] ── STEP 4: Fuzzy match ──')

    let resolvedName = null
    let terminalId = null
    let matchedTerminal = null

    if (terminals.length > 0 && filteredLines.length > 0) {

      let bestMatch = null
      let bestMatchLine = null

      for (const line of filteredLines) {
        const match = fuzzyMatchTerminal(line, terminals)

        // ⬇️ umbral elevado a 0.65
        if (match && match.similarity >= 0.65) {
          if (!bestMatch || match.similarity > bestMatch.similarity) {
            bestMatch = match
            bestMatchLine = line
          }
        }
      }

      if (bestMatch) {
        matchedTerminal = bestMatch.terminal
        resolvedName = matchedTerminal.name || null
        terminalId = matchedTerminal.id || null

        console.log(
          `[processOCR] ✅ Match sólido: "${bestMatchLine}" → "${resolvedName}" (${(bestMatch.similarity * 100).toFixed(1)}%)`
        )
      } else {
        console.log('[processOCR] ⚠️ Ningún match superó el umbral 0.65 → devolviendo null')
      }

    } else {
      console.log('[processOCR] ⚠️ Sin candidatos válidos o sin terminales cargadas')
    }

    const rawText = `[TIPO]\n${rawTipo}\n[NOMBRE]\n${rawNombre}`

    console.log('\n[processOCR] ── RESULTADO FINAL ──')
    console.log(`  type:        "${type}"`)
    console.log(`  stationName: "${resolvedName}"`)
    console.log(`  terminalId:  "${terminalId}"`)
    console.log('████████████████████████████████████\n')

    return {
      success: true,
      rawText,
      type,
      mode: null,
      stationName: resolvedName,
      items: [],
      terminalId,
      terminal: matchedTerminal // ← objeto completo
    }

  } catch (err) {
    console.error('[processOCR] ❌ ERROR:', err.message)
    console.error(err)

    return {
      success: false,
      error: err.message
    }
  }
}
module.exports = { processOCR }