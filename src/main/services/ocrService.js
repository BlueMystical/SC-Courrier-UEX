// src/main/services/ocrService.js

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sharp = require('sharp')
const uexCache = require('../helpers/uexCache')

const TMP_DIR = os.tmpdir()

const SECTOR_A_BLACKLIST = [
  'YOUR INVENTORIES',
  'YOUR INVENTORIE',
  'YOUR INVENTOR',
  'IN DEMAND',
  'IN DEMANO',
  'NO DEMAND',
  'NO DEMANO',
  'CANNOT SELL',
  'CANNO SELL',
  'SELECT SUB-CATEGORY',
  'SELECT SUB CATEGORY',
  'SELECT SUB',
  'COMMODITIES',
  'ITEMS',
  'VEHICLES',
  // Item shop UI navigation labels — present in orange/Pyro UI
  'CHOOSE DESTINATION',
  'CHOOSE CATEGORY',
  'CHOOSE SUBCATEGORY',
  'CHOOSE SUB-DESTINATION',
  'CHOOSE SUB DESTINATION',
  'ALL OPTIONS',
  'ALL CATEGORIES',
  'SUBCATEGORY',
  'ITEM NAME',
]

const NOMBRE_NOISE_TOKENS = [
  / VV\s*$/,
  / V\s*$/,
  / IP\s*$/,
  / [A-Z]{1,2}\s*$/,
  /^\s*\|\s*/,
  /\s*\|\s*$/,
]

const MIN_LINE_LENGTH = 5

// ─────────────────────────────────────────────
// Stock statuses — aligned with UEX API /commodities_status
// ─────────────────────────────────────────────
const STOCK_STATUS_MAP = [
  {
    code: 1, name: 'Out of Stock (Empty)', short: 'Out Stock', abbr: 'OS',
    patterns: ['OUT OF STOCK', 'OUT OF STOC', 'OUT STOCK', 'OUT OF STECK', 'OUT OF STEK', 'OUT OF STUCK']
  },
  {
    code: 2, name: 'Very Low Inventory', short: 'Very Low', abbr: 'VL',
    patterns: ['VERY LOW']
  },
  {
    code: 3, name: 'Low Inventory', short: 'Low', abbr: 'LO',
    patterns: ['LOW INV', 'LOW']
  },
  {
    code: 4, name: 'Medium Inventory', short: 'Medium', abbr: 'ME',
    patterns: ['MEDIUM', 'NEDIUN', 'MEDIUN', 'NEDIUM']
  },
  {
    code: 5, name: 'High Inventory', short: 'High', abbr: 'HI',
    patterns: ['HIGH INV', 'HIGH']
  },
  {
    code: 6, name: 'Very High Inventory', short: 'Very High', abbr: 'VH',
    patterns: ['VERY HIGH']
  },
  {
    code: 7, name: 'Maximum Inventory (Full)', short: 'Maximum', abbr: 'MA',
    patterns: ['MAXIMUM', 'MAX INV', 'MAK INV', 'MAX INV']
  },
]

// ──────── TESSERACT OCR ─────────────────────────────────────
// ── Tesseract paths ─────────────────────────
function getTesseractPath() {
  const defaultPath = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe'
  if (require('fs').existsSync(defaultPath)) return defaultPath
  return 'tesseract'
}

function getTessdataPath() {
  const { app } = require('electron')
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tessdata')
  }
  return path.join(__dirname, '../../tessdata')
}

const TESSERACT_PATH = getTesseractPath()  

function runTesseract(imagePath, psm = 6) {
  const tessdataPath = getTessdataPath()
  
  console.log(`[Tesseract] bin: ${TESSERACT_PATH}`)      // ← usa la constante
  console.log(`[Tesseract] tessdata: ${tessdataPath}`)
  console.log(`[Tesseract] imagen: ${imagePath} (psm:${psm})`)

  return new Promise((resolve, reject) => {
    execFile(
      TESSERACT_PATH,                                     // ← usa la constante
      [imagePath, 'stdout', '-l', 'eng', '--psm', String(psm), '--tessdata-dir', tessdataPath],
      (error, stdout) => {
        if (error) { console.error('[Tesseract] ERROR:', error.message); return reject(error) }
        console.log(`[Tesseract] OK. Caracteres leídos: ${stdout.length}`)
        console.log(`[Tesseract] Raw output:\n${stdout}`)
        resolve(stdout)
      }
    )
  })
}

// ─────────────────────────────────────────────
// Levenshtein + fuzzy match
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

  let bestMatch = null, bestScore = Infinity, bestSimilarity = 0
  for (const terminal of terminals) {
    const candidates = [
      terminal.nickname, terminal.displayname,
      terminal.space_station_name, terminal.name,
    ].filter(Boolean).map(s => s.toUpperCase().trim())
    for (const name of candidates) {
      const dist = levenshtein(query, name)
      const maxLen = Math.max(query.length, name.length)
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0
      if (dist < bestScore) { bestScore = dist; bestMatch = terminal; bestSimilarity = similarity }
    }
  }
  console.log(`[fuzzyMatch] Mejor match: "${bestMatch?.name}" (similarity: ${(bestSimilarity * 100).toFixed(1)}% dist:${bestScore})`)
  if (bestSimilarity < 0.65) { console.log(`[fuzzyMatch] ⚠️  Similitud muy baja, descartando`); return null }
  return { terminal: bestMatch, similarity: bestSimilarity }
}

function fuzzyMatchCommodity(ocrName, commodities) {
  if (!ocrName || !commodities?.length) return null
  const query = ocrName.toUpperCase().trim()
  if (query.length < 2) return null
  let bestMatch = null, bestScore = Infinity, bestSimilarity = 0
  for (const commodity of commodities) {
    const candidates = [commodity.name, commodity.name_short, commodity.code]
      .filter(Boolean).map(s => s.toUpperCase().trim())
    for (const name of candidates) {
      const dist = levenshtein(query, name)
      const maxLen = Math.max(query.length, name.length)
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0
      if (dist < bestScore) { bestScore = dist; bestMatch = commodity; bestSimilarity = similarity }
    }
  }
  if (bestSimilarity < 0.55) return null
  return { commodity: bestMatch, similarity: bestSimilarity }
}

function fuzzyMatchItemName(ocrName, cachedItems) {
  if (!ocrName || !cachedItems?.length) return null
  const query = ocrName.toUpperCase().trim()
  if (query.length < 3) return null
  let bestMatch = null, bestScore = Infinity, bestSimilarity = 0
  for (const item of cachedItems) {
    const candidates = [item.name, item.slug?.replace(/-/g,' ')].filter(Boolean).map(s => s.toUpperCase().trim())
    for (const cand of candidates) {
      const dist = levenshtein(query, cand)
      const sim  = Math.max(query.length, cand.length) > 0 ? 1 - dist / Math.max(query.length, cand.length) : 0
      if (dist < bestScore) { bestScore = dist; bestMatch = item; bestSimilarity = sim }
    }
  }
  const pct = (bestSimilarity * 100).toFixed(1)
  if (bestSimilarity >= 0.65) {
    console.log(`[fuzzyMatchItemName] ✅ "${query}" → "${bestMatch.name}" (${pct}% dist:${bestScore})`)
    return { item: bestMatch, similarity: bestSimilarity }
  }
  console.log(`[fuzzyMatchItemName] ⚠️  "${query}" → best:"${bestMatch?.name}" (${pct}%) — below threshold`)
  return null
}

function resolveItemNames(gridItems, cachedItems) {
  if (!cachedItems?.length) {
    console.log('[resolveItemNames] ⚠️  Cache empty — itemCacheService has not synced yet')
    return gridItems.map(it => ({ ...it, id_resolved: null, name_resolved: null, category: null, section: null, matchSimilarity: 0 }))
  }
  console.log(`\n[resolveItemNames] Resolving ${gridItems.length} items against ${cachedItems.length} cached`)
  const result = []
  for (const item of gridItems) {
    console.log(`[resolveItemNames] Matching: "${item.name}"`)
    const match = fuzzyMatchItemName(item.name, cachedItems)
    if (match) {
      result.push({
        ...match.item,
        price:           item.price,
        matchSimilarity: match.similarity,
        ocr_name:        item.name,
        volumeUSCU:      item.volumeUSCU
      })
    } else {
      result.push({
        ...item,
        id_resolved: null, name_resolved: null,
        category: null, section: null, matchSimilarity: 0
      })
    }
  }
  const resolved = result.filter(i => i.id != null).length
  console.log(`[resolveItemNames] ✅ ${resolved}/${result.length} resolved\n`)
  return result
}

// ─────────────────────────────────────────────
// Tesseract CLI (psm configurable)
// ─────────────────────────────────────────────


function isReasonableCandidate(text) {
  if (!text || text.length < 8) return false
  const words = text.split(' ').filter(w => w.length > 2)
  if (words.length < 2) return false
  const letters = (text.match(/[A-Z]/g) || []).length
  const numbers = (text.match(/[0-9]/g) || []).length
  return numbers <= letters
}

// ─────────────────────────────────────────────
// Debug helpers
// ─────────────────────────────────────────────
const DEBUG_SAVE_IMAGES = true
const DEBUG_DIR = path.join(os.homedir(), 'Desktop', 'ocr-debug')

async function ensureDebugDir() {
  if (!DEBUG_SAVE_IMAGES) return
  try { await fs.promises.mkdir(DEBUG_DIR, { recursive: true }); console.log(`[DEBUG] Carpeta: ${DEBUG_DIR}`) } catch (e) { }
}

async function saveDebugImage(buffer, name) {
  if (!DEBUG_SAVE_IMAGES) return
  const filepath = path.join(DEBUG_DIR, name)
  await fs.promises.writeFile(filepath, buffer)
  console.log(`[DEBUG] 🖼️  Imagen guardada: ${filepath}`)
}

// ─────────────────────────────────────────────
// UI Bounds Detection
// Finds the top and bottom Y coordinates of the actual game UI panel
// within the screenshot, to correct for vertical offset variations.
// Strategy: scan a center-column strip for the first/last row that has
// sufficient dark-pixel density (the UI panel background).
// ─────────────────────────────────────────────
async function detectUIBounds(buffer, width, height) {
  // Sample a vertical strip at ~15% from left (inside the panel, not on decorations)
  const stripX = Math.floor(width * 0.15)
  const stripW = Math.floor(width * 0.10)
  const raw = await sharp(buffer)
    .extract({ left: stripX, top: 0, width: stripW, height })
    .grayscale()
    .raw()
    .toBuffer()

  // For each row, compute average brightness
  const rowBrightness = []
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = 0; x < stripW; x++) sum += raw[y * stripW + x]
    rowBrightness.push(sum / stripW)
  }

  // The UI panel is a dark region (brightness < 60) that spans most of the image.
  // Find first row where brightness drops below threshold (panel top edge).
  const DARK_THRESHOLD = 60
  const MIN_DARK_ROWS  = 40  // must persist for at least this many rows to be the real panel

  let uiTop = 0, uiBottom = height - 1

  // Scan top-down for start of sustained dark region
  for (let y = 0; y < height - MIN_DARK_ROWS; y++) {
    if (rowBrightness[y] < DARK_THRESHOLD) {
      // Check that the next MIN_DARK_ROWS are also dark
      let darkCount = 0
      for (let dy = 0; dy < MIN_DARK_ROWS; dy++) {
        if (rowBrightness[y + dy] < DARK_THRESHOLD + 20) darkCount++
      }
      if (darkCount >= MIN_DARK_ROWS * 0.7) {
        uiTop = y
        break
      }
    }
  }

  // Scan bottom-up for end of sustained dark region
  for (let y = height - 1; y > uiTop + MIN_DARK_ROWS; y--) {
    if (rowBrightness[y] < DARK_THRESHOLD) {
      uiBottom = y
      break
    }
  }

  const uiHeight = uiBottom - uiTop
  console.log(`[detectUIBounds] uiTop:${uiTop} uiBottom:${uiBottom} uiHeight:${uiHeight} (${((uiHeight/height)*100).toFixed(1)}% of frame)`)

  // Sanity check: if detected region is unreasonably small, fall back to full image
  if (uiHeight < height * 0.5) {
    console.log(`[detectUIBounds] ⚠️  Detected region too small — falling back to full image`)
    return { uiTop: 0, uiBottom: height - 1, uiHeight: height }
  }

  return { uiTop, uiBottom, uiHeight }
}

// ─────────────────────────────────────────────
// Color scheme detection
// ─────────────────────────────────────────────
async function detectUIColorScheme(buffer, width, height, uiTop = null) {
  // Sample from within the detected UI bounds, not fixed screen percentages
  const top = uiTop !== null ? uiTop + Math.floor((height - (uiTop ?? 0)) * 0.10) : Math.floor(height * 0.15)
  const x = Math.floor(width * 0.10), y = top
  const w = Math.floor(width * 0.35), h = Math.floor(height * 0.35)
  // Clamp to image bounds
  const safeH = Math.min(h, height - y)
  if (safeH < 10) return 'dark'
  const raw = await sharp(buffer).extract({ left: x, top: y, width: w, height: safeH }).raw().toBuffer()
  const meta = await sharp(buffer).metadata()
  const channels = meta.channels ?? 3
  let rSum = 0, gSum = 0, bSum = 0, count = 0
  for (let i = 0; i < raw.length; i += channels) {
    rSum += raw[i]; gSum += raw[i + 1]; bSum += raw[i + 2]; count++
  }
  const avgR = rSum / count, avgG = gSum / count, avgB = bSum / count
  const avgBrightness = (avgR + avgG + avgB) / 3
  const rgRatio = avgR / Math.max(avgG, 1)

  let scheme
  if (avgBrightness > 140) {
    scheme = 'light'
  } else if (rgRatio > 1.4) {
    scheme = 'orange'
  } else if (avgB > avgR + 10 && avgB > avgG + 5) {
    scheme = 'blue'
  } else {
    scheme = 'dark'
  }

  console.log(`[detectUIColorScheme] RGB=(${avgR.toFixed(0)},${avgG.toFixed(0)},${avgB.toFixed(0)}) brightness:${avgBrightness.toFixed(0)} ratio:${rgRatio.toFixed(2)} → ${scheme}`)
  return scheme
}

// ─────────────────────────────────────────────
// Sector A crops — all relative to uiBounds
// ─────────────────────────────────────────────
async function cropSectorA_tipo(buffer, uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  // Tipo label is in the first ~9% of the UI panel height
  const left      = Math.floor(width * 0.03)
  const top       = uiTop + Math.floor(uiHeight * 0.03)
  const cropWidth = Math.floor(width * 0.40)
  const cropHeight= Math.floor(uiHeight * 0.09)
  console.log(`[cropSectorA_tipo] ${width}x${height}px uiTop:${uiTop} → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

async function cropSectorA_nombre(buffer, colorScheme = 'blue', uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  // Orange (Pyro item shops): dropdown "Orbituary" sits right below "CHOOSE DESTINATION" at ~15-37%
  // Other schemes: station name sits at ~12-32% (dark) or ~17-37%
  const topByScheme    = { dark: 0.12, blue: 0.17, orange: 0.15, light: 0.17 }
  const heightByScheme = { dark: 0.20, blue: 0.20, orange: 0.22, light: 0.20 }
  const topPct    = topByScheme[colorScheme]    ?? 0.17
  const heightPct = heightByScheme[colorScheme] ?? 0.20
  const left      = Math.floor(width * 0.05)
  const top       = uiTop + Math.floor(uiHeight * topPct)
  const cropWidth = Math.floor(width * 0.42)
  const cropHeight= Math.floor(uiHeight * heightPct)
  console.log(`[cropSectorA_nombre] colorScheme:${colorScheme} top:${(topPct*100).toFixed(0)}% uiTop:${uiTop} → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

// ─────────────────────────────────────────────
// Sector B crops — all relative to uiBounds
// ─────────────────────────────────────────────
async function cropSectorB_tabs(buffer, uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const left      = Math.floor(width * 0.64)
  const top       = uiTop + Math.floor(uiHeight * 0.13)
  const cropWidth = Math.floor(width * 0.36)
  const cropHeight= Math.floor(uiHeight * 0.12)
  console.log(`[cropSectorB_tabs] uiTop:${uiTop} → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

async function cropSectorB_items(buffer, uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const left      = Math.floor(width * 0.69)
  const top       = uiTop + Math.floor(uiHeight * 0.22)
  const cropWidth = Math.floor(width * 0.31)
  const cropHeight= Math.floor(uiHeight * 0.75)
  console.log(`[cropSectorB_items] uiTop:${uiTop} → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

// ─────────────────────────────────────────────
// Preprocessing — Sector A
// ─────────────────────────────────────────────
async function preprocessNombreSoft(buffer) {
  console.log('[preprocessNombreSoft] resize 3x → grayscale → normalize → sharpen')
  const meta = await sharp(buffer).metadata()
  return await sharp(buffer).resize({ width: meta.width * 3, kernel: 'lanczos3' }).grayscale().normalize().sharpen().toBuffer()
}

async function preprocessPass1(buffer) {
  console.log('[preprocessPass1] resize 3x → grayscale → normalize → threshold(100) → sharpen')
  const meta = await sharp(buffer).metadata()
  return await sharp(buffer).resize({ width: meta.width * 3, kernel: 'lanczos3' }).grayscale().normalize().threshold(100).sharpen().toBuffer()
}

async function preprocessPass2(buffer) {
  console.log('[preprocessPass2] resize 3x → grayscale → negate → normalize → sharpen')
  const meta = await sharp(buffer).metadata()
  return await sharp(buffer).resize({ width: meta.width * 3, kernel: 'lanczos3' }).grayscale().negate().normalize().sharpen().toBuffer()
}

// ─────────────────────────────────────────────
// Preprocessing — Sector B
// ─────────────────────────────────────────────
async function preprocessSectorB_orange(buffer) {
  const meta = await sharp(buffer).metadata()
  console.log('[preprocessSectorB_orange] 3x → grayscale → normalize → sharpen')
  return await sharp(buffer).resize({ width: meta.width * 3, kernel: 'lanczos3' }).grayscale().normalize().sharpen({ sigma: 1.5 }).toBuffer()
}

async function preprocessSectorB_blue(buffer) {
  const meta = await sharp(buffer).metadata()
  console.log('[preprocessSectorB_blue] 3x → grayscale → normalize → sharpen')
  return await sharp(buffer).resize({ width: meta.width * 3, kernel: 'lanczos3' }).grayscale().normalize().sharpen({ sigma: 1.5 }).toBuffer()
}

// ─────────────────────────────────────────────
// Text helpers — Sector A
// ─────────────────────────────────────────────
function cleanLine(line) {
  return line.toUpperCase().replace(/[^A-Z0-9\-\s]/g, '').replace(/\s+/g, ' ').trim()
}

function isBlacklisted(line) {
  const match = SECTOR_A_BLACKLIST.some(b => line.includes(b))
  if (match) console.log(`[isBlacklisted] ❌ Descartada: "${line}"`)
  return match
}

function extractValidLines(rawText, label) {
  console.log(`\n[extractValidLines:${label}] Procesando texto...`)
  const rawLines = rawText.split(/\r?\n/)
  console.log(`[extractValidLines:${label}] Total líneas raw: ${rawLines.length}`)
  rawLines.forEach((l, i) => console.log(`  [raw ${i}] ${JSON.stringify(l)}`))
  const valid = []
  for (const line of rawLines) {
    const cleaned = cleanLine(line)
    if (!cleaned || cleaned.length < MIN_LINE_LENGTH) continue
    if (isBlacklisted(cleaned)) continue
    console.log(`  → ✅ Aceptada: "${cleaned}"`)
    valid.push(cleaned)
  }
  console.log(`[extractValidLines:${label}] Líneas válidas (${valid.length}):`, valid)
  return valid
}

function detectTypeFromRaw(rawText) {
  const upper = rawText.toUpperCase().replace(/[^A-Z]/g, ' ').replace(/\s+/g, ' ')
  console.log(`[detectTypeFromRaw] Buscando keywords...`)

  if (upper.includes('COMMODITIES')) { console.log(`[detectTypeFromRaw] ✅ commodity`); return 'commodity' }
  if (upper.includes('ITEMS'))       { console.log(`[detectTypeFromRaw] ✅ item`);      return 'item' }
  if (upper.includes('VEHICLES'))    { console.log(`[detectTypeFromRaw] ✅ vehicle`);   return 'vehicle' }

  const words = upper.split(' ').filter(w => w.length >= 7)
  for (const w of words) {
    const d = levenshtein(w, 'COMMODITIES')
    if (d <= 3) { console.log(`[detectTypeFromRaw] ✅ commodity (fuzzy "${w}" dist:${d})`); return 'commodity' }
    const dv = levenshtein(w, 'VEHICLES')
    if (dv <= 2) { console.log(`[detectTypeFromRaw] ✅ vehicle (fuzzy "${w}" dist:${dv})`); return 'vehicle' }
  }

  console.log(`[detectTypeFromRaw] ⚠️  unknown`)
  return 'unknown'
}

// ─────────────────────────────────────────────
// Item shop subtype detection
// ─────────────────────────────────────────────
function detectItemShopSubtype(rawHeaderText) {
  const up = rawHeaderText.toUpperCase().replace(/[^A-Z0-9\s_]/g, ' ').replace(/\s+/g, ' ')
  console.log(`[detectItemShopSubtype] OCR header: "${up.slice(0, 120)}"`)

  if (/CENTER\s*MASS/.test(up))             return 'center_mass'
  if (/CUBBY\s*BLAST/.test(up))             return 'cubby_blast'
  if (/CASABA/.test(up))                    return 'casaba'
  if (/REFINERY\s*SHOP/.test(up))           return 'refinery_shop'
  if (/TEACH\s*S/.test(up))                 return 'teachs'
  if (/PHARMACY/.test(up))                  return 'pharmacy'
  if (/WEAPONS[\s_]*SHOP/.test(up))         return 'weapons_shop'
  if (/\bARMOR\b/.test(up))                 return 'armor_shop'
  if (/SKUTTERS/.test(up))                  return 'skutters'
  if (/DUMPER/.test(up))                    return 'dumpers_depot'
  if (/PLATINUM/.test(up))                  return 'platinum_bay'
  if (/GARRITY/.test(up))                   return 'garrity_defense'
  if (/CONSCIENTIOUS/.test(up))             return 'conscientious_objects'
  return 'generic_item'
}

const SHOP_SUBTYPE_COMPANY = {
  center_mass:           'Center Mass',
  cubby_blast:           'Cubby Blast',
  casaba:                'Casaba Outlet',
  refinery_shop:         'Refinery Shop',
  teachs:                "Teach's",
  pharmacy:              'Pharmacy',
  weapons_shop:          'Weapons Shop',
  armor_shop:            'Armor Shop',
  skutters:              'Skutters',
  dumpers_depot:         "Dumper's Depot",
  platinum_bay:          'Platinum Bay',
  garrity_defense:       'Garrity Defense',
  conscientious_objects: 'Conscientious Objects',
}

function fuzzyMatchItemTerminal(shopSubtype, destination, terminals) {
  console.log(`[fuzzyMatchItem] shopSubtype:"${shopSubtype}" destination:"${destination}"`)
  if (!terminals?.length) return null

  const companyName = SHOP_SUBTYPE_COMPANY[shopSubtype]

  let subset = terminals.filter(t => t.type === 'item' || t.is_shop_fps)
  if (companyName) {
    const byCompany = subset.filter(t =>
      t.company_name && levenshtein(t.company_name.toUpperCase(), companyName.toUpperCase()) <= 2
    )
    console.log(`[fuzzyMatchItem] Filtrado por company "${companyName}": ${byCompany.length} terminales`)
    if (byCompany.length > 0) subset = byCompany
  }

  if (!destination || destination.length < 2) {
    if (subset.length === 1) {
      console.log(`[fuzzyMatchItem] ✅ único match: "${subset[0].name}"`)
      return { terminal: subset[0], similarity: 0.8 }
    }
    console.log(`[fuzzyMatchItem] ⚠️  sin destination, ${subset.length} candidatos → no resuelto`)
    return null
  }

  const destClean = destination.toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim()
  let bestMatch = null, bestScore = -1

  for (const t of subset) {
    const candidates = [
      t.city_name, t.displayname, t.space_station_name,
      t.outpost_name, t.nickname, t.name
    ].filter(Boolean).map(s => s.toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim())

    for (const cand of candidates) {
      const dist = levenshtein(destClean, cand)
      const maxLen = Math.max(destClean.length, cand.length)
      const sim = maxLen > 0 ? 1 - dist / maxLen : 0
      if (sim > bestScore) { bestScore = sim; bestMatch = t }
    }
  }

  if (bestMatch && bestScore >= 0.55) {
    console.log(`[fuzzyMatchItem] ✅ "${bestMatch.name}" (dest sim:${(bestScore*100).toFixed(1)}%)`)
    return { terminal: bestMatch, similarity: bestScore }
  }

  console.log(`[fuzzyMatchItem] ⚠️  mejor match "${bestMatch?.name}" sim:${(bestScore*100).toFixed(1)}% < umbral 55%`)
  return null
}

// ─────────────────────────────────────────────
// Mode detection by tab brightness
// ─────────────────────────────────────────────
async function detectModeByBrightness(buffer, width, height, uiBounds = null) {
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const tabY = uiTop + Math.floor(uiHeight * 0.175)
  const tabH = Math.floor(uiHeight * 0.045)
  const leftX  = Math.floor(width * 0.641), leftW  = Math.floor(width * 0.075)
  const rightX = Math.floor(width * 0.716), rightW = Math.floor(width * 0.170)

  const measureBrightness = async (x, y, w, h) => {
    const raw = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).grayscale().raw().toBuffer()
    let sum = 0; for (let i = 0; i < raw.length; i++) sum += raw[i]
    return sum / raw.length
  }

  const ocrTab = async (x, y, w, h, label) => {
    const crop = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).toBuffer()
    const scale = Math.min(4, Math.floor(800 / w))

    const tryOCR = async (pipeline, suffix) => {
      const processed = await pipeline(sharp(crop).resize({ width: w * scale, kernel: 'lanczos3' })).toBuffer()
      const tmp = path.join(TMP_DIR, `ocr-tab-${label}-${suffix}-${Date.now()}.png`)
      await fs.promises.writeFile(tmp, processed)
      const text = await runTesseract(tmp, 7)
      await fs.promises.unlink(tmp)
      const clean = text.trim().toUpperCase().replace(/[^A-Z\s]/g, '').trim()
      console.log(`[ocrTab:${label}:${suffix}] "${clean}"`)
      return clean
    }

    let text = await tryOCR(s => s.grayscale().normalize().threshold(140), 'thr')
    if (/BUY|SELL|RENT|LOCAL|MARKET/.test(text)) return text

    text = await tryOCR(s => s.grayscale().negate().normalize().threshold(130), 'neg')
    if (/BUY|SELL|RENT|LOCAL|MARKET/.test(text)) return text

    text = await tryOCR(s => s.grayscale().normalize().sharpen({ sigma: 3, m1: 0, m2: 6 }), 'shrp')
    return text
  }

  const leftBrightness  = await measureBrightness(leftX,  tabY, leftW,  tabH)
  const rightBrightness = await measureBrightness(rightX, tabY, rightW, tabH)
  console.log(`[detectModeByBrightness] left:${leftBrightness.toFixed(1)} right:${rightBrightness.toFixed(1)}`)

  const brightnessDiff = Math.abs(leftBrightness - rightBrightness)

  let activeText = ''
  if (brightnessDiff >= 8) {
    const leftIsActive = leftBrightness > rightBrightness
    const activeX = leftIsActive ? leftX  : rightX
    const activeW = leftIsActive ? leftW  : rightW
    activeText = await ocrTab(activeX, tabY, activeW, tabH, leftIsActive ? 'left' : 'right')
    const tabCrop = await sharp(buffer).extract({ left: activeX, top: tabY, width: activeW, height: tabH }).toBuffer()
    const tabProcessed = await sharp(tabCrop).resize({ width: activeW * 4, kernel: 'lanczos3' }).grayscale().normalize().threshold(100).toBuffer()
    await saveDebugImage(tabProcessed, '11b-tab-activo-processed.png')
    console.log(`[detectModeByBrightness] activeTab:${leftIsActive ? 'LEFT' : 'RIGHT'} rawTab:"${activeText}"`)
  } else {
    console.log(`[detectModeByBrightness] ⚠️  brillo similar (diff:${brightnessDiff.toFixed(1)}) → OCR ambos tabs`)
    const leftText  = await ocrTab(leftX,  tabY, leftW,  tabH, 'left')
    const rightText = await ocrTab(rightX, tabY, rightW, tabH, 'right')
    activeText = leftText + ' ' + rightText
    console.log(`[detectModeByBrightness] leftTab:"${leftText}" rightTab:"${rightText}"`)
    const tabCrop = await sharp(buffer).extract({ left: leftX, top: tabY, width: leftW, height: tabH }).toBuffer()
    const tabProcessed = await sharp(tabCrop).resize({ width: leftW * 4, kernel: 'lanczos3' }).grayscale().normalize().threshold(100).toBuffer()
    await saveDebugImage(tabProcessed, '11b-tab-activo-processed.png')
  }

  if (activeText.includes('SELL')) return 'sell'
  if (activeText.includes('RENT')) return 'rent'
  if (activeText.includes('BUY'))  return 'buy'

  const fallback = leftBrightness >= rightBrightness ? 'buy' : 'sell'
  console.log(`[detectModeByBrightness] ⚠️  OCR no reconoció tabs → fallback brillo: "${fallback}"`)
  return fallback
}

// ─────────────────────────────────────────────
// Sector B — Price parser
// ─────────────────────────────────────────────
function parsePrice(text) {
  let s = text.replace(/[¤₤£€$¥]/g, '')

  const pricePattern = /([0-9][0-9.,]*)([KkMm]?)\/\s*S[A-Z]/gi
  const allMatches = [...s.matchAll(pricePattern)]
  if (allMatches.length === 0) return null

  for (const match of allMatches) {
    let rawNum = match[1]
    const mult = match[2].toUpperCase()

    rawNum = rawNum.replace(/,/g, '.')
    const parts = rawNum.split('.')
    let value = parts.length > 2
      ? parseFloat(parts[0] + '.' + parts.slice(1).join(''))
      : parseFloat(rawNum)
    if (isNaN(value)) continue

    if (mult === 'K') value *= 1_000
    else if (mult === 'M') value *= 1_000_000

    if (value > 10_000_000) {
      console.log(`[parsePrice] ⚠️  Precio sospechoso descartado: ${value} (rawNum:"${rawNum}" mult:"${mult}")`)
      continue
    }

    return Math.round(value * 1_000_000) / 1_000_000
  }

  console.log(`[parsePrice] ⚠️  Todos los candidatos descartados en: "${text}"`)
  return null
}

// ─────────────────────────────────────────────
// Sector B — Stock status resolver
// ─────────────────────────────────────────────
function resolveStockStatus(text) {
  const up = text.toUpperCase()
  for (const s of STOCK_STATUS_MAP) {
    if (s.patterns.some(p => up.includes(p))) {
      return { code: s.code, name: s.name, short: s.short, abbr: s.abbr }
    }
  }
  const words = up.replace(/[^A-Z\s]/g, '').trim().split(/\s+/).slice(0, 3).join(' ')
  let best = null, bestDist = Infinity
  for (const s of STOCK_STATUS_MAP) {
    const d = levenshtein(words, s.short.toUpperCase())
    if (d < bestDist) { bestDist = d; best = s }
  }
  if (best && bestDist <= 4) {
    console.log(`[resolveStockStatus] fuzzy "${words}" → "${best.short}" (dist:${bestDist})`)
    return { code: best.code, name: best.name, short: best.short, abbr: best.abbr }
  }
  return null
}

// ─────────────────────────────────────────────
// Sector B — Name extractor from header line
// ─────────────────────────────────────────────
function extractNameFromHeader(line) {
  let s = line
    .replace(/[|'`\[\](){}'"\\]/g, ' ')
    .replace(/\s+/g, ' ').trim()
  s = s.replace(/\s+[\d,]+\s+S[A-Z]{2,3}\b.*/i, '').trim()
  s = s.replace(/^[^A-Za-z]+/, '')
  s = s.replace(/^(?:[A-Za-z0-9%]{1,4}\s+)+(?=[A-Za-z]{4})/, '').trim()
  s = s.replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

// ─────────────────────────────────────────────
// Sector B — Main item parser
// ─────────────────────────────────────────────
function parseSectorBItems(rawText, commodities = []) {
  console.log('\n[parseSectorBItems] ── INICIO ──')

  const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !(l.length > 35 && !/\s/.test(l)))
  console.log('[parseSectorBItems] líneas raw:', rawLines)

  const SCU_RE    = / SCU\b/i
  const CARGO_RE  = /AVAI?[LA]{1,2}BLE\s+CARGO|AVATLABLE\s+CARGO/i
  const JUNK_RE   = /^[\[\]|\\\/\-\s]*$|^[^A-Za-z]{0,3}$|^e[0-9]+$/
  const SHOPQ_RE  = /SHOP\s*QUAN[TI]{2}[TY]{2}|SHOP\s*QUANT/i

  const hasShopQuantity = rawLines.some(l => SHOPQ_RE.test(l))
  console.log(`[parseSectorBItems] anchor: ${hasShopQuantity ? 'SHOP QUANTITY (primario)' : 'SCU (fallback)'}`)

  const items = []

  if (hasShopQuantity) {
    const anchorIdxs = rawLines.reduce((acc, l, i) => {
      if (SHOPQ_RE.test(l)) acc.push(i)
      return acc
    }, [])
    console.log(`[parseSectorBItems] ${anchorIdxs.length} anchors SHOP QUANTITY en índices:`, anchorIdxs)

    for (const ai of anchorIdxs) {
      const anchorLine = rawLines[ai]
      console.log(`\n[parseSectorBItems] ── Anchor[${ai}]: ${JSON.stringify(anchorLine)}`)

      const namePart1Raw = anchorLine.replace(SHOPQ_RE, '').trim()
      const namePart1 = namePart1Raw.replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
      console.log(`[parseSectorBItems]   namePart1: "${namePart1}"`)

      let namePart2 = ''
      let quantity = 0
      const nextLine = rawLines[ai + 1] ?? ''
      const qtyMatch = nextLine.match(/([\d,]+)\s+SCU/i)
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1].replace(/,/g, ''))
        const before = nextLine.slice(0, nextLine.search(/[\d,]+\s+SCU/i)).trim()
        namePart2 = before.replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
      }
      console.log(`[parseSectorBItems]   namePart2: "${namePart2}"  qty:${quantity}`)

      const fullName = [namePart1, namePart2].filter(Boolean).join(' ').trim()
      console.log(`[parseSectorBItems]   fullName: "${fullName}"`)

      if (!fullName || fullName.length < 2) {
        console.log(`[parseSectorBItems] ⚠️  nombre vacío, saltando`)
        continue
      }

      let price = null, stockStatus = null
      const nextAnchorIdx = anchorIdxs.find(x => x > ai) ?? rawLines.length
      for (let j = ai + 2; j < nextAnchorIdx; j++) {
        const l = rawLines[j].trim()
        if (!l || JUNK_RE.test(l) || CARGO_RE.test(l)) continue

        const p = parsePrice(l)
        if (p !== null && price === null) price = p

        const s = resolveStockStatus(l)
        if (s && !stockStatus) stockStatus = s

        console.log(`[parseSectorBItems]   line[${j}]: ${JSON.stringify(l)} → price:${p} status:${JSON.stringify(s)}`)
      }

      console.log(`[parseSectorBItems]   → price:${price}  status:${JSON.stringify(stockStatus)}`)

      const item = {
        name: fullName, ocr_name: fullName, quantity, price, stockStatus,
        commodityId: null, commodityName: null, commodityCode: null
      }

      if (commodities.length > 0) {
        const match = fuzzyMatchCommodity(fullName, commodities)
        if (match) {
          console.log(`[parseSectorBItems] 🔍 "${fullName}" → "${match.commodity.name}" (${(match.similarity * 100).toFixed(1)}%)`)
          item.name = match.commodity.name   // ✅ usar nombre canónico, no el del OCR
          item.commodityId = match.commodity.id
          item.commodityName = match.commodity.name
          item.commodityCode = match.commodity.code
        } else {
          console.log(`[parseSectorBItems] ⚠️  "${fullName}" → sin match en commodities`)
        }
      }

      console.log(`[parseSectorBItems] ✅ "${item.name}" qty:${item.quantity} price:${item.price} status:${JSON.stringify(item.stockStatus)}`)
      items.push(item)
    }

  } else {
    console.log('[parseSectorBItems] Usando estrategia fallback SCU')
    const UI_RE = /SHOP\s+QUANTITY|LOCAL\s+MARKET|AVAILABLE\s+CARGO/i

    const lines = []
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      if (SCU_RE.test(line) && !CARGO_RE.test(line)) {
        const prev = lines[lines.length - 1]
        if (prev && !UI_RE.test(prev) && !SCU_RE.test(prev) && !JUNK_RE.test(prev) && !CARGO_RE.test(prev)) {
          const realWords = (prev.match(/[A-Za-z]{3,}/g) || [])
          const totalTokens = prev.split(/\s+/).length
          const isCleanEnough = realWords.length >= 1 && totalTokens <= 5 && realWords.length >= totalTokens * 0.3
          if (isCleanEnough) {
            console.log(`[parseSectorBItems] 🔗 Merge: "${prev}" + "${line}"`)
            lines[lines.length - 1] = prev + ' ' + line
            continue
          } else {
            console.log(`[parseSectorBItems] ⛔ No merge (línea previa muy ruidosa): "${prev}"`)
          }
        }
      }
      lines.push(line)
    }

    console.log('[parseSectorBItems] líneas tras merge:', lines)

    const headerIdxs = lines.reduce((acc, l, i) => {
      if (SCU_RE.test(l) && !CARGO_RE.test(l)) acc.push(i)
      return acc
    }, [])
    console.log(`[parseSectorBItems] ${headerIdxs.length} headers SCU en índices:`, headerIdxs)

    for (const hi of headerIdxs) {
      const headerLine = lines[hi]
      console.log(`\n[parseSectorBItems] ── Header[${hi}]: ${JSON.stringify(headerLine)}`)

      const qtyMatch = headerLine.match(/([\d,]+)\s+SCU/i)
      const quantity = qtyMatch ? parseInt(qtyMatch[1].replace(/,/g, '')) : 0
      const name = extractNameFromHeader(headerLine)

      if (!name || name.length < 2) {
        console.log(`[parseSectorBItems] ⚠️  nombre vacío, saltando`)
        continue
      }

      let price = null, stockStatus = null
      for (let j = hi + 1; j < lines.length; j++) {
        const l = lines[j].trim()
        if (!l || JUNK_RE.test(l) || CARGO_RE.test(l)) continue
        if (SCU_RE.test(l) && !CARGO_RE.test(l)) break
        price = parsePrice(l)
        stockStatus = resolveStockStatus(l)
        console.log(`[parseSectorBItems]   status+price[${j}]: ${JSON.stringify(l)} → price:${price} status:${JSON.stringify(stockStatus)}`)
        break
      }

      const item = {
        name, ocr_name: name, quantity, price, stockStatus,
        commodityId: null, commodityName: null, commodityCode: null
      }

      if (commodities.length > 0) {
        const match = fuzzyMatchCommodity(name, commodities)
        if (match) {
          console.log(`[parseSectorBItems] 🔍 "${name}" → "${match.commodity.name}" (${(match.similarity * 100).toFixed(1)}%)`)
          item.name = match.commodity.name   // ✅ usar nombre canónico, no el del OCR
          item.commodityId = match.commodity.id
          item.commodityName = match.commodity.name
          item.commodityCode = match.commodity.code
        } else {
          console.log(`[parseSectorBItems] ⚠️  "${name}" → sin match en commodities`)
        }
      }

      console.log(`[parseSectorBItems] ✅ "${item.name}" qty:${item.quantity} price:${item.price} status:${JSON.stringify(item.stockStatus)}`)
      items.push(item)
    }
  }

  console.log(`\n[parseSectorBItems] Total: ${items.length}`)
  return items
}

// ─────────────────────────────────────────────
// Sector A extraction
// ─────────────────────────────────────────────
async function extractSectorA(imageBuffer, colorScheme = 'blue', uiBounds = null) {
  console.log('\n══════════════════════════════════')
  console.log('[extractSectorA] INICIO — Crops separados + triple pasada')
  await ensureDebugDir()

  const tipoCropBuffer = await cropSectorA_tipo(imageBuffer, uiBounds)
  await saveDebugImage(tipoCropBuffer, '00-crop-tipo-raw.png')
  const tipoProcessed = await preprocessPass2(tipoCropBuffer)
  await saveDebugImage(tipoProcessed, '01-crop-tipo-negate.png')
  const tmpTipo = path.join(TMP_DIR, `ocr-tipo-${Date.now()}.png`)
  await fs.promises.writeFile(tmpTipo, tipoProcessed)
  const rawTipo = await runTesseract(tmpTipo, 6)
  await fs.promises.unlink(tmpTipo)
  const type = detectTypeFromRaw(rawTipo)

  const nombreCropBuffer = await cropSectorA_nombre(imageBuffer, colorScheme, uiBounds)
  await saveDebugImage(nombreCropBuffer, '02-crop-nombre-raw.png')

  const nombreSoft = await preprocessNombreSoft(nombreCropBuffer)
  await saveDebugImage(nombreSoft, '03-crop-nombre-soft.png')
  const tmpSoft = path.join(TMP_DIR, `ocr-nombre-soft-${Date.now()}.png`)
  await fs.promises.writeFile(tmpSoft, nombreSoft)
  const rawSoft = await runTesseract(tmpSoft, 6)
  await fs.promises.unlink(tmpSoft)
  console.log('[NOMBRE SOFT]:\n' + rawSoft)

  const nombrePassA = await preprocessPass1(nombreCropBuffer)
  await saveDebugImage(nombrePassA, '04-crop-nombre-passA-threshold.png')
  const tmpA = path.join(TMP_DIR, `ocr-nombre-A-${Date.now()}.png`)
  await fs.promises.writeFile(tmpA, nombrePassA)
  const rawA = await runTesseract(tmpA, 6)
  await fs.promises.unlink(tmpA)
  console.log('[NOMBRE PASS-A]:\n' + rawA)

  const nombrePassB = await preprocessPass2(nombreCropBuffer)
  await saveDebugImage(nombrePassB, '05-crop-nombre-passB-negate.png')
  const tmpB = path.join(TMP_DIR, `ocr-nombre-B-${Date.now()}.png`)
  await fs.promises.writeFile(tmpB, nombrePassB)
  const rawB = await runTesseract(tmpB, 6)
  await fs.promises.unlink(tmpB)
  console.log('[NOMBRE PASS-B]:\n' + rawB)

  // Pasada extra R-B para UI naranja — FIX: .png() para producir archivo válido
  let rawRB = ''
  if (colorScheme === 'orange') {
    try {
      const { width: iw, height: ih } = await sharp(imageBuffer).metadata()
      const { uiTop: ut, uiHeight: uh } = uiBounds ?? { uiTop: 0, uiHeight: ih }

      // ── Dedicated crop: CHOOSE DESTINATION dropdown value row ──
      // The label "CHOOSE DESTINATION" is at ~21% of uiHeight.
      // The dropdown selected value (e.g. "Orbituary") is ~1.5% below in a light-bg row.
      // Crop a narrow band at ~22.5-25.5% to isolate just that text.
      const ddLeft  = Math.floor(iw * 0.09)
      const ddTop   = ut + Math.floor(uh * 0.225)
      const ddWidth = Math.floor(iw * 0.42)
      const ddHeight= Math.floor(uh * 0.035)
      const ddBuf   = await sharp(imageBuffer)
        .extract({ left: ddLeft, top: ddTop, width: ddWidth, height: ddHeight })
        .toBuffer()
      await saveDebugImage(ddBuf, '06c-crop-dest-dropdown.png')

      // The dropdown has a lighter orange bg with dark text — grayscale + threshold works well
      const ddMeta = await sharp(ddBuf).metadata()
      const ddScale = Math.min(6, Math.floor(600 / ddMeta.width))
      const ddProc  = await sharp(ddBuf)
        .resize({ width: ddMeta.width * ddScale, kernel: 'lanczos3' })
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.5 })
        .toBuffer()
      await saveDebugImage(ddProc, '06d-crop-dest-dropdown-proc.png')
      const tmpDD = path.join(TMP_DIR, `ocr-dest-dd-${Date.now()}.png`)
      await fs.promises.writeFile(tmpDD, ddProc)
      const rawDD = await runTesseract(tmpDD, 7)  // psm:7 = single line
      await fs.promises.unlink(tmpDD)
      const ddClean = rawDD
        .replace(/[^A-Za-z0-9\s\-']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      // Remove trailing "All Options" and similar sub-destination labels that bleed in
      const ddValue = ddClean.replace(/\s*(all\s+options?|all\s+opt|v\s*$)/gi, '').trim()
        .replace(/^[a-z]{1,3}\s+/i, '')   // strip leading 1-3 char OCR noise token
        .replace(/(\s+[a-z]{1,3}){1,3}$/i, '')  // strip trailing short noise tokens
        .trim()
      console.log(`[NOMBRE DEST-DROPDOWN]: raw="${ddClean}" → value="${ddValue}"`)
      if (ddValue.length >= 3 && !/^(choose|all\s|search|item\s*name)/i.test(ddValue)) {
        rawRB = `CHOOSE DESTINATION\n${ddValue}\n`
        console.log(`[extractSectorA] ✅ dropdown directo: "${ddValue.toUpperCase()}"`)
      }

      // Continue with R-B pass on the nombre crop for additional OCR coverage
      const { data, info } = await sharp(nombreCropBuffer).raw().toBuffer({ resolveWithObject: true })
      const ch = info.channels  // ✅ agregar esta línea
      const rb = Buffer.alloc(info.width * info.height)

      for (let i = 0; i < rb.length; i++) {
        rb[i] = Math.max(0, Math.min(255, data[i * ch] - data[i * ch + 2]))
      }
      // ✅ FIX 1: .png() obligatorio — sin él sharp devuelve raw sin cabecera y Tesseract falla
      const rbBuf = await sharp(rb, { raw: { width: info.width, height: info.height, channels: 1 } })
        .resize({ width: info.width * 3, kernel: 'lanczos3' })
        .normalize()
        .sharpen({ sigma: 1.5 })
        .png()
        .toBuffer()
      await saveDebugImage(rbBuf, '06-crop-nombre-rb.png')
      const tmpRB = path.join(TMP_DIR, `ocr-nombre-rb-${Date.now()}.png`)
      await fs.promises.writeFile(tmpRB, rbBuf)
      rawRB += '\n' + await runTesseract(tmpRB, 6)
      await fs.promises.unlink(tmpRB)
      console.log('[NOMBRE RB]:\n' + rawRB)

      // Extra: R-channel only with threshold — helps with bright orange dropdown text
      const rOnly = Buffer.alloc(info.width * info.height)
      for (let i = 0; i < rOnly.length; i++) rOnly[i] = data[i * ch]  // just red channel
      const rBuf = await sharp(rOnly, { raw: { width: info.width, height: info.height, channels: 1 } })
        .resize({ width: info.width * 3, kernel: 'lanczos3' })
        .normalize()
        .threshold(180)  // bright orange text (high R value) → white; dark background → black
        .png()
        .toBuffer()
      await saveDebugImage(rBuf, '06b-crop-nombre-rchannel.png')
      const tmpRC = path.join(TMP_DIR, `ocr-nombre-rc-${Date.now()}.png`)
      await fs.promises.writeFile(tmpRC, rBuf)
      const rawRC = await runTesseract(tmpRC, 6)
      await fs.promises.unlink(tmpRC)
      console.log('[NOMBRE R-CHANNEL]:\n' + rawRC)
      rawRB = rawRB + '\n' + rawRC  // merge both orange passes
    } catch (e) {
      console.warn('[extractSectorA] ⚠️  Pasada RB falló, continuando sin ella:', e.message)
    }
  }

  const allLines = [...new Set([
    ...extractValidLines(rawSoft, 'nombre-soft'),
    ...extractValidLines(rawA,    'nombre-A'),
    ...extractValidLines(rawB,    'nombre-B'),
    ...(rawRB ? extractValidLines(rawRB, 'nombre-RB') : []),
  ])]

  // Extra: extract dropdown VALUES from raw nombre text.
  // When the crop includes item-shop filter rows like:
  //   "CHOOSE DESTINATION"  →  "Orbituary"  →  "CHOOSE CATEGORY" ...
  // the dropdown values (lines immediately after a CHOOSE label) are the
  // actual station/location name, but extractValidLines discards them as
  // noise because they look short. We re-parse the raw texts for these.
  const CHOOSE_LABEL_RE = /^choose\s+(destination|category|sub.?dest|subcategory)/i
  const extractDropdownValues = (rawText, label) => {
    const lines = rawText.split(/\r?\n/).map(l => l.trim())
    const vals = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Pattern A: "CHOOSE DESTINATION <value> CHOOSE SUB-DEST" — value is inline between two CHOOSE
      // e.g. "cual DESTINATION sie ual CHOOSE SUB-DESTINAT" → "sie ual" could be "Orbituary" OCR
      // Better: look for text sandwiched between DESTINATION and the second CHOOSE
      const inlineMatch = line.match(/DEST[A-Z]*\s+(.+?)\s+CHOOSE\s+SUB/i)
      if (inlineMatch) {
        const candidate = inlineMatch[1].replace(/[^A-Za-z0-9\s\-]/g, ' ').replace(/\s+/g, ' ').trim()
        if (candidate.length >= 3 && !/^(choose|all\s|search|item\s*name|ee|sub|ual|sie|iil|re|a$)/i.test(candidate)) {
          const up = candidate.toUpperCase()
          console.log(`[extractDropdownValues:${label}] inline between DEST…SUB: "${up}"`)
          vals.push(up)
        }
      }

      // Pattern B: line matches CHOOSE DESTINATION label, and the NEXT non-empty line is the value
      if (CHOOSE_LABEL_RE.test(line)) {
        // Look at next 1-2 lines for a non-empty, non-label value
        for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
          const next = lines[j]?.replace(/[^A-Za-z0-9\s\-]/g, ' ').replace(/\s+/g, ' ').trim()
          if (!next || next.length < 3) continue
          if (/^(choose|all\s|search|item\s*name)/i.test(next)) break
          const up = next.toUpperCase()
          console.log(`[extractDropdownValues:${label}] next-line after CHOOSE: "${up}"`)
          vals.push(up)
          break
        }
      }
    }
    return vals
  }
  const dropdownCandidates = colorScheme === 'orange' ? [
    ...extractDropdownValues(rawSoft, 'soft'),
    ...extractDropdownValues(rawA,    'A'),
    ...extractDropdownValues(rawB,    'B'),
    ...(rawRB ? extractDropdownValues(rawRB, 'RB') : []),
  ] : []
  const allCandidates = [...new Set([...dropdownCandidates, ...allLines])]
  console.log(`[extractSectorA] Total candidatos: ${allCandidates.length} → ${JSON.stringify(allCandidates)}`)

  // Prefer dropdown values first (they are the actual selected location),
  // then fall back to longest isReasonableCandidate, then first line.
  const solidDropdowns = dropdownCandidates.filter(l => {
    if (l.length < 3) return false
    if (/^(choose|all\s|search|item\s*name|teemneme)/i.test(l)) return false
    // Reject if contains multiple CHOOSE labels — it's a UI label line, not a value
    if ((l.match(/choose/gi) ?? []).length >= 2) return false
    // Reject if contains SUBCATEGORY/SEARCH — it's a label row
    if (/subcategor|chouse|chduse|tnoosee/i.test(l)) return false
    // Reject long concatenated junk (>40 chars no spaces)
    if (/\S{20,}/.test(l)) return false
    return true
  })
  const solidCandidates = allCandidates.filter(isReasonableCandidate)
  let stationName = solidDropdowns[0]
    ?? (solidCandidates.length > 0
        ? solidCandidates.reduce((best, l) => l.length > best.length ? l : best, solidCandidates[0])
        : (allCandidates[0] ?? null))
  if (stationName) {
    const original = stationName
    for (const noise of NOMBRE_NOISE_TOKENS) stationName = stationName.replace(noise, '').trim()
    if (stationName !== original) console.log(`[extractSectorA] Limpieza: "${original}" → "${stationName}"`)
  }

  console.log('\n[extractSectorA] ── RESULTADO ──')
  console.log(`  type:        "${type}"`)
  console.log(`  stationName: "${stationName}"`)
  console.log('══════════════════════════════════\n')

  return { type, stationName, validLines: allCandidates, rawTipo, rawNombre: rawSoft }
}

// ─────────────────────────────────────────────
// Sector B extraction
// ─────────────────────────────────────────────
async function extractSectorB(imageBuffer, colorScheme, commodities = [], uiBounds = null) {
  console.log('\n══════════════════════════════════')
  console.log('[extractSectorB] INICIO colorScheme:', colorScheme)

  const { width, height } = await sharp(imageBuffer).metadata()

  console.log('\n[extractSectorB] ── DETECCIÓN MODO POR BRILLO ──')
  const mode = await detectModeByBrightness(imageBuffer, width, height, uiBounds)
  console.log(`[extractSectorB] mode: "${mode}"`)

  const tabsCrop = await cropSectorB_tabs(imageBuffer, uiBounds)
  await saveDebugImage(tabsCrop, '10-sectorB-tabs-raw.png')

  console.log('\n[extractSectorB] ── CROP ITEMS ──')
  const itemsCrop = await cropSectorB_items(imageBuffer, uiBounds)
  await saveDebugImage(itemsCrop, '12-sectorB-items-raw.png')

  const itemsProcessed = colorScheme === 'orange'
    ? await preprocessSectorB_orange(itemsCrop)
    : await preprocessSectorB_blue(itemsCrop)
  await saveDebugImage(itemsProcessed, '13-sectorB-items-processed.png')

  const tmpItems = path.join(TMP_DIR, `ocr-items-${Date.now()}.png`)
  await fs.promises.writeFile(tmpItems, itemsProcessed)
  const rawItemsText = await runTesseract(tmpItems, 6)
  await fs.promises.unlink(tmpItems)

  console.log('[extractSectorB] rawItems:\n' + rawItemsText)

  const items = parseSectorBItems(rawItemsText, commodities)

  console.log('\n[extractSectorB] ── RESULTADO ──')
  console.log(`  mode:  "${mode}"`)
  console.log(`  items: ${items.length}`)
  console.log('══════════════════════════════════\n')

  return { mode, items, rawItems: rawItemsText }
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

    let terminals = [], commodities = []
    try { terminals = uexCache.get('terminals')?.data || []; console.log(`[processOCR] Terminales: ${terminals.length}`) } catch (e) { console.warn('[processOCR] ⚠️ No terminales:', e.message) }
    try { commodities = uexCache.get('commodities')?.data || []; console.log(`[processOCR] Commodities: ${commodities.length}`) } catch (e) { console.warn('[processOCR] ⚠️ No commodities:', e.message) }

    // items se guardan como array plano por itemCacheService (sin wrapper .data)
    let cachedItems = []
    try { cachedItems = uexCache.get('items') || []; console.log(`[processOCR] Items cache: ${cachedItems.length}`) } catch (e) { console.warn('[processOCR] ⚠️ No items cache:', e.message) }

    const { width, height } = await sharp(buffer).metadata()
    const uiBounds = await detectUIBounds(buffer, width, height)
    const colorScheme = await detectUIColorScheme(buffer, width, height, uiBounds.uiTop)

    console.log('\n[processOCR] ── SECTOR A ──')
    const { type, stationName, validLines, rawTipo, rawNombre } = await extractSectorA(buffer, colorScheme, uiBounds)

    // ── Bifurcación: Item shop vs Commodity terminal ──
    // En item shops, cropSectorA_tipo recorta el logo de la tienda (no hay texto
    // COMMODITIES/ITEMS) → type='unknown'. Para resolver el ambigüedad leemos el
    // tab superior derecho: en commodity terminals ahí está "SELL"/"BUY", mientras
    // que en item shops está el nombre de la tienda (texto arbitrario sin esas palabras).
    // No hardcodeamos nombres — sólo usamos la ausencia de las keywords de modo.
    let resolvedType = type
    let triageTabText = ''  // texto del tab derecho — reutilizado en extractItemShop para detectar subtype
    if (type === 'unknown') {
      console.log('[processOCR] type=unknown — triage por tab derecho...')
      try {
        const { width: w2, height: h2 } = await sharp(buffer).metadata()
        // Triage tab is ~13.5% into the UI panel, not the full frame
        const { uiTop, uiHeight } = uiBounds

        // For orange (Pyro) UI, the shop name is in the center header ("WEAPONS_SHOP"),
        // not in a right-side tab. Read the header directly.
        if (colorScheme === 'orange') {
          console.log('[processOCR] orange scheme — triage por rawNombre + header central')

          // First: check if rawNombre already contains commodity signals.
          // The nombre crop for orange starts at top:15% and captures "COMMODITIES"
          // at its upper edge when it's a commodity terminal — much more reliable
          // than re-reading the header which may be partially cropped.
          const rawNombreUpper = (rawNombre || '').toUpperCase().replace(/[^A-Z]/g, ' ')
          const COMMODITY_SIGNALS = /COMMODIT|YOUR INVENTOR|IN DEMAND|NO DEMAND|CANNOT SELL|SHOP INVENTOR/
          if (COMMODITY_SIGNALS.test(rawNombreUpper)) {
            console.log(`[processOCR] triage orange: rawNombre contiene señal commodity → flujo commodity`)
            // resolvedType stays 'unknown' → goes to commodity flow
          } else {
            // No commodity signals in nombre — try reading the header for shop name
            try {
              const headerBuf = await cropItemShop_header(buffer, uiBounds)
              const scale = 3
              const { width: hw } = await sharp(headerBuf).metadata()

              const tryHeader = async (pipeline, suffix) => {
                const proc = await pipeline(sharp(headerBuf).resize({ width: hw * scale, kernel: 'lanczos3' })).toBuffer()
                const tmp  = path.join(TMP_DIR, `ocr-triage-hdr-${suffix}-${Date.now()}.png`)
                await fs.promises.writeFile(tmp, proc)
                const text = (await runTesseract(tmp, 6)).toUpperCase().replace(/[^A-Z0-9_\s]/g, ' ').replace(/\s+/g, ' ').trim()
                await fs.promises.unlink(tmp)
                console.log(`[triage:hdr:${suffix}] "${text}"`)
                return text
              }

              // R-channel minus B-channel isolates orange text on dark background
              const { data, info } = await sharp(headerBuf).raw().toBuffer({ resolveWithObject: true })
              const ch = info.channels
              const rb = Buffer.alloc(info.width * info.height)
              for (let i = 0; i < rb.length; i++) rb[i] = Math.max(0, Math.min(255, data[i*ch] - data[i*ch+2]))
              const rbBuf = await sharp(rb, { raw: { width: info.width, height: info.height, channels: 1 } })
                .resize({ width: info.width * scale, kernel: 'lanczos3' }).normalize().png().toBuffer()
              const tmp = path.join(TMP_DIR, `ocr-triage-hdr-rb-${Date.now()}.png`)
              await fs.promises.writeFile(tmp, rbBuf)
              let hdrText = (await runTesseract(tmp, 6)).toUpperCase().replace(/[^A-Z0-9_\s]/g, ' ').replace(/\s+/g, ' ').trim()
              await fs.promises.unlink(tmp)
              console.log(`[triage:hdr:rb] "${hdrText}"`)

              if (!hdrText || hdrText.length < 3) hdrText = await tryHeader(s => s.grayscale().normalize().threshold(120), 'thr')
              if (!hdrText || hdrText.length < 3) hdrText = await tryHeader(s => s.grayscale().normalize().sharpen({ sigma: 2 }), 'shrp')

              // Also check hdrText for commodity fragments (e.g. "DITIES" from "COMMODITIES" cut off)
              const COMMODITY_HDR = /COMMODIT|DITIES|ODITIES|YOUR INVEN/
              if (hdrText.length >= 3 && !COMMODITY_HDR.test(hdrText)) {
                console.log(`[processOCR] ✅ triage orange: header="${hdrText}" → item shop`)
                resolvedType = 'item'
                triageTabText = hdrText
              } else {
                console.log(`[processOCR] triage orange: header="${hdrText}" → commodity o vacío`)
              }
            } catch (e) {
              console.warn('[processOCR] ⚠️  triage orange header falló:', e.message)
            }
          }
        } else {

        const tabY = uiTop + Math.floor(uiHeight * 0.135)
        const tabH = Math.floor(uiHeight * 0.055)
        const tabX = Math.floor(w2 * 0.716), tabW = Math.floor(w2 * 0.230)
        const crop = await sharp(buffer).extract({ left: tabX, top: tabY, width: tabW, height: tabH }).toBuffer()
        const scale = Math.min(4, Math.floor(800 / tabW))

        const tryTab = async (pipeline, suffix) => {
          const proc = await pipeline(sharp(crop).resize({ width: tabW * scale, kernel: 'lanczos3' })).toBuffer()
          const tmp  = path.join(TMP_DIR, `ocr-triage-${suffix}-${Date.now()}.png`)
          await fs.promises.writeFile(tmp, proc)
          const text = (await runTesseract(tmp, 7)).toUpperCase().replace(/[^A-Z\s]/g, '').trim()
          await fs.promises.unlink(tmp)
          console.log(`[triage:${suffix}] "${text}"`)
          return text
        }

        // Si el tab dice BUY/SELL/RENT → commodity. Si tiene texto de otra clase → item shop.
        const COMMODITY_TAB = /\b(BUY|SELL|RENT|LOCAL|MARKET)\b/
        let tabText = await tryTab(s => s.grayscale().normalize().threshold(140), 'thr')
        if (!tabText || tabText.length < 3) tabText = await tryTab(s => s.grayscale().negate().normalize().threshold(130), 'neg')
        if (!tabText || tabText.length < 3) tabText = await tryTab(s => s.grayscale().normalize().sharpen({ sigma: 2 }), 'shrp')

        if (tabText.length >= 3 && !COMMODITY_TAB.test(tabText)) {
          console.log(`[processOCR] ✅ triage: tab="${tabText}" → no es commodity → item shop`)
          resolvedType = 'item'
          triageTabText = tabText  // lo reutilizamos en extractItemShop
        } else {
          console.log(`[processOCR] triage: tab="${tabText}" → commodity o vacío → flujo commodity`)
        }

        } // end else (non-orange)
      } catch (e) {
        console.warn('[processOCR] ⚠️  triage falló:', e.message)
      }
    }

    if (resolvedType === 'item' || resolvedType === 'vehicle') {
      console.log(`\n[processOCR] ── ITEM SHOP MODE (type:${resolvedType} original:${type}) ──`)
      const { shopSubtype, destination: destFromHeader, mode, items, rawHeader, rawGrid } = await extractItemShop(buffer, colorScheme, triageTabText, uiBounds)

      const PLACE_RE = /^[A-Z][A-Z0-9\s\-]{3,}$/
      const NOISE_RE = /^(choose|destination|sub|all\s+(opt|cat)|search|item\s*name|ee|null)$/i

      let destination = destFromHeader
      if (!destination || NOISE_RE.test(destination)) {
        const sectorACandidates = (validLines || []).filter(l =>
          l && l.length >= 3 && !NOISE_RE.test(l) &&
          !/^(JOSE|REALS|TT|SL|AREFEAIR|AREAIR)$/.test(l.toUpperCase())
        )
        const placeCandidate = sectorACandidates.find(l => /^(AREA|ARC|MIC|CRU|HUR|ABE|GRI|TER|ORI|OCE|MAG|ITO|ARC)/i.test(l))
          ?? sectorACandidates[0]
        if (placeCandidate) {
          destination = placeCandidate
          console.log(`[processOCR] destination fallback desde SectorA: "${destination}"`)
        }
      }

      let terminalMatch = null
      if (shopSubtype !== 'generic_item' || destination) {
        terminalMatch = fuzzyMatchItemTerminal(shopSubtype, destination, terminals)
      }

      if (!terminalMatch && destination && !NOISE_RE.test(destination)) {
        console.log(`[processOCR] ⚠️  item: reintentando fuzzy clásico con destination "${destination}"`)
        const classicMatch = fuzzyMatchTerminal(destination, terminals.filter(t => t.type === 'item' || t.is_shop_fps))
        if (classicMatch?.similarity >= 0.60) terminalMatch = classicMatch
      }

      const resolvedTerminal = terminalMatch?.terminal ?? null
      const resolvedName     = resolvedTerminal?.name ?? null
      const terminalId       = resolvedTerminal?.id   ?? null

      const rawText = `[TIPO]\n${rawTipo}\n[HEADER]\n${rawHeader}\n[GRID]\n${rawGrid}`

      const resolvedItems = resolveItemNames(items, cachedItems)

      console.log('\n[processOCR] ── RESULTADO FINAL (item) ──')
      console.log(`  type:        "item"`)
      console.log(`  shopSubtype: "${shopSubtype}"`)
      console.log(`  mode:        "${mode}"`)
      console.log(`  terminal:    "${resolvedName}"`)
      console.log(`  destination: "${destination}"`)
      console.log(`  items:       ${resolvedItems.length}`)
      resolvedItems.forEach((it, idx) =>
        console.log(`    [${idx}] name:"${it.name}" id:${it.id ?? 'null'} sim:${it.matchSimilarity ? (it.matchSimilarity*100).toFixed(1)+'%' : '-'} price:${it.price ?? 'null'}`)
      )
      console.log('████████████████████████████████████\n')

      return {
        success: true,
        rawText,
        type: 'item',
        shopSubtype,
        mode,
        stationName: resolvedName,
        items: resolvedItems,
        terminalId,
        terminal: resolvedTerminal
      }
    }

    // Commodity terminal (type === 'commodity') o unknown (OCR no leyó el tipo)
    console.log(`\n[processOCR] ── COMMODITY MODE (type:${type}) ──`)
    const { mode, items: rawItems, rawItems: rawItemsText } = await extractSectorB(buffer, colorScheme, commodities, uiBounds)

    const filteredLines = (validLines || []).filter(isReasonableCandidate)
    let resolvedName = null, terminalId = null, matchedTerminal = null

    if (terminals.length > 0 && filteredLines.length > 0) {
      let bestMatch = null, bestMatchLine = null
      for (const line of filteredLines) {
        const match = fuzzyMatchTerminal(line, terminals)
        if (match?.similarity >= 0.65 && (!bestMatch || match.similarity > bestMatch.similarity)) {
          bestMatch = match; bestMatchLine = line
        }
      }
      if (bestMatch) {
        matchedTerminal = bestMatch.terminal
        resolvedName = matchedTerminal.name || null
        terminalId = matchedTerminal.id || null
        console.log(`[processOCR] ✅ Terminal: "${bestMatchLine}" → "${resolvedName}" (${(bestMatch.similarity * 100).toFixed(1)}%)`)
      } else {
        console.log('[processOCR] ⚠️ Ningún match superó el umbral 0.65')
      }
    }

    const rawText = `[TIPO]\n${rawTipo}\n[NOMBRE]\n${rawNombre}\n[ITEMS]\n${rawItemsText}`

    console.log('\n[processOCR] ── RESULTADO FINAL ──')
    console.log(`  type:    "${type}"`)
    console.log(`  mode:    "${mode}"`)
    console.log(`  terminal:"${resolvedName}"`)
    console.log(`  items:   ${rawItems.length}`)
    rawItems.forEach((it, idx) => console.log(`    [${idx}] ${JSON.stringify(it)}`))
    console.log('████████████████████████████████████\n')

    return {
      success: true,
      rawText,
      type,
      mode,
      stationName: resolvedName,
      items: rawItems,
      terminalId,
      terminal: matchedTerminal
    }

  } catch (err) {
    console.error('[processOCR] ❌ ERROR:', err.message)
    console.error(err)
    return { success: false, error: err.message }
  }
}

module.exports = { processOCR, extractItemShop }

// ══════════════════════════════════════════════════════════
// ITEM SHOP EXTRACTION
// ══════════════════════════════════════════════════════════

async function cropItemShop_header(buffer, uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const left = Math.floor(width * 0.20), top = uiTop
  const w    = Math.floor(width * 0.60), h   = Math.floor(uiHeight * 0.20)
  console.log(`[cropItemShop_header] uiTop:${uiTop} → left:${left} top:${top} w:${w} h:${h}`)
  return await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()
}

async function cropItemShop_destination(buffer, colorScheme = 'blue', uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const topByScheme = { dark: 0.13, blue: 0.18, orange: 0.18, light: 0.18 }
  const topPct = topByScheme[colorScheme] ?? 0.18
  const left = Math.floor(width * 0.05)
  const top  = uiTop + Math.floor(uiHeight * topPct)
  // Wider (50%) and taller (18% of UI) to capture both the label row and the
  // dropdown value row which sits ~4-6% below the label
  const w    = Math.floor(width * 0.50), h   = Math.floor(uiHeight * 0.18)
  console.log(`[cropItemShop_destination] colorScheme:${colorScheme} uiTop:${uiTop} → left:${left} top:${top} w:${w} h:${h}`)
  const rawBuf = await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()

  if (colorScheme === 'orange') {
    const { data, info } = await sharp(rawBuf).raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const rb = Buffer.alloc(info.width * info.height)
    for (let i = 0; i < rb.length; i++) {
      const r = data[i * ch], b = data[i * ch + 2]
      rb[i] = Math.max(0, Math.min(255, r - b))
    }
    return await sharp(rb, { raw: { width: info.width, height: info.height, channels: 1 } })
      .png()
      .toBuffer()
  }
  return rawBuf
}

async function cropItemShop_col1(buffer, uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const left = Math.floor(width * 0.09), top = uiTop + Math.floor(uiHeight * 0.25)
  const w    = Math.floor(width * 0.29), h   = Math.floor(uiHeight * 0.70)
  console.log(`[cropItemShop_col1] uiTop:${uiTop} → left:${left} top:${top} w:${w} h:${h}`)
  return await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()
}

async function cropItemShop_col2(buffer, uiBounds = null) {
  const { width, height } = await sharp(buffer).metadata()
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  const left = Math.floor(width * 0.39), top = uiTop + Math.floor(uiHeight * 0.25)
  const w    = Math.floor(width * 0.23), h   = Math.floor(uiHeight * 0.70)
  console.log(`[cropItemShop_col2] uiTop:${uiTop} → left:${left} top:${top} w:${w} h:${h}`)
  return await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()
}

async function detectItemShopMode(buffer, width, height, uiBounds = null) {
  const { uiTop, uiHeight } = uiBounds ?? { uiTop: 0, uiHeight: height }
  // BUY/SELL tabs are in the top 3-11% of the UI panel
  const tabY = uiTop + Math.floor(uiHeight * 0.03)
  const tabH = Math.floor(uiHeight * 0.08)
  const buyX = Math.floor(width * 0.05),  buyW = Math.floor(width * 0.09)
  const selX = Math.floor(width * 0.13),  selW = Math.floor(width * 0.10)

  const brightness = async (x, y, w, h) => {
    const raw = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).grayscale().raw().toBuffer()
    let s = 0; for (const v of raw) s += v; return s / raw.length
  }

  const buyB = await brightness(buyX, tabY, buyW, tabH)
  const selB = await brightness(selX, tabY, selW, tabH)
  console.log(`[detectItemShopMode] BUY:${buyB.toFixed(1)} SELL:${selB.toFixed(1)}`)

  if (buyB > selB + 5) return 'buy'
  if (selB > buyB + 5) return 'sell'

  const combined = await sharp(buffer).extract({ left: buyX, top: tabY, width: selX + selW - buyX, height: tabH }).toBuffer()
  const proc = await sharp(combined).resize({ width: (selX + selW - buyX) * 4, kernel: 'lanczos3' }).grayscale().normalize().threshold(130).toBuffer()
  const tmp = path.join(TMP_DIR, `ocr-itemtab-${Date.now()}.png`)
  await fs.promises.writeFile(tmp, proc)
  const text = (await runTesseract(tmp, 7)).toUpperCase()
  await fs.promises.unlink(tmp)
  console.log(`[detectItemShopMode] OCR tabs: "${text}"`)
  if (text.includes('SELL')) return 'sell'
  return 'buy'
}

function parseItemShopColumn(rawText, colLabel) {
  // OCR often corrupts digits in "Volume: 16000 µSCU":
  //   L6000, @500, lB000 — letter substituted for digit
  //   µ → p, y, », w, v;  SCU → pSCU, ySCU, PSCU etc.
  // Anchor on the word "Volume" (very distinctive) and accept corrupted digits.
  const VOLUME_RE = /volume\s*[:\-]?\s*[A-Za-z@]?[\d,A-Za-z@]{1,8}[^\n]{0,15}?[µuypwv»]?s?cu/i

  const extractVolume = (line) => {
    // Grab everything between "Volume:" and the SCU marker
    const m = line.match(/volume\s*[:\-]?\s*([A-Za-z@]?[A-Za-z\d,@]{1,10})\s*[µuypwv»]?[Pp]?[Ss][Cc][Uu]/i)
    if (!m) return null
    // Normalize common OCR letter→digit substitutions in numeric context
    const raw = m[1]
      .replace(/[Oo]/g, '0')
      .replace(/[lLI@]/g, '1')
      .replace(/[Ss](?=\d)/g, '5')  // S before digit → 5
      .replace(/[Bb]/g, '8')        // B → 8
      .replace(/,/g, '')
      .replace(/^[A-Za-z]/, '')     // strip leading letter (L6000 → 6000)
    const v = parseInt(raw)
    return (!isNaN(v) && v > 0 && v < 10_000_000) ? v : null
  }

  const JUNK_RE       = /^(quick\s*buy|first|prior|next|last|\d+\/\d+|choose|search|item\s*name|all\s+cat|all\s+opt|subcate|wallet|gories|ategories|yc$|ier$|rch$)/i
  const NOISE_ONLY_RE = /^[^A-Za-z0-9]{0,2}$|^[a-z]{1,2}(\s+[a-z0-9]{0,2})*\s*$|^\W+$/

  const extractPrice = (line) => {
    // Normalize: strip ¤ prefix and common OCR variants (M, N, O at start before digits)
    // Also handle dot-separated thousands like "07.232" → 7232
    let s = line.replace(/^[\s¤₤£€MmNnOo|]+/, '').trim()
    // Try dot-as-thousands-separator: "7.232" or "07.232" → 7232
    const dotThousands = s.match(/^(\d{1,2})\.(\d{3})\b/)
    if (dotThousands) {
      const val = parseInt(dotThousands[1] + dotThousands[2])
      if (!isNaN(val) && val >= 10 && val <= 10_000_000) return val
    }
    // Handle "O4 746" pattern: OCR splits ¤4,746 → the O is ¤, "4" is thousands, "746" is rest
    // Detect: 1-2 digits followed by space followed by 3 digits (= thousands pattern)
    const splitThousands = s.match(/^(\d{1,2})\s+(\d{3})\b/)
    if (splitThousands) {
      const val = parseInt(splitThousands[1] + splitThousands[2])
      if (!isNaN(val) && val >= 1000 && val <= 10_000_000) return val
    }
    const nums = [...line.matchAll(/\b([\d]{1,3}(?:,[\d]{3})+|[\d]{2,7})\b/g)]
    if (!nums.length) return null
    const val = parseInt(nums[nums.length - 1][1].replace(/,/g,''))
    return (!isNaN(val) && val >= 10 && val <= 10_000_000) ? val : null
  }

  const isPriceLine = (line) => {
    const tokens = line.replace(/[^A-Za-z0-9,]/g,' ').trim().split(/\s+/).filter(Boolean)
    const hasNum  = tokens.some(t => /^\d/.test(t.replace(/,/g,'')) && t.replace(/,/g,'').length >= 2)
    const hasWord = tokens.some(t => t.length >= 3 && /[A-Za-z]{3}/.test(t) && !/^(pSCU|ypSCU|SCU|yps|PSCU|USCU)/i.test(t))
    return hasNum && !hasWord
  }

  const isNameLine = (line) => {
    if (JUNK_RE.test(line)) return false
    if (NOISE_ONLY_RE.test(line)) return false
    if (VOLUME_RE.test(line)) return false
    if (isPriceLine(line)) return false
    // Long concatenated noise lines (OCR smearing): >20 consecutive non-space chars
    if (/\S{20,}/.test(line)) return false
    const clean = line.replace(/[^A-Za-z0-9\s\-'()]/g,' ').trim()
    return /[A-Za-z]{3,}/.test(clean)
  }

  const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !(l.length > 35 && !/\s/.test(l)))
  console.log(`[parseItemShopColumn:${colLabel}] ${rawLines.length} líneas raw`)

  const volumeIdxs = []
  for (let i = 0; i < rawLines.length; i++) {
    if (VOLUME_RE.test(rawLines[i])) volumeIdxs.push(i)
  }
  console.log(`[parseItemShopColumn:${colLabel}] ${volumeIdxs.length} anchors VOLUME`)

  const items = []
  for (let vi = 0; vi < volumeIdxs.length; vi++) {
    const vIdx     = volumeIdxs[vi]
    const prevVIdx = volumeIdxs[vi-1] ?? -1
    const nextVIdx = volumeIdxs[vi+1] ?? rawLines.length

    const volumeUSCU = extractVolume(rawLines[vIdx])

    // Name: scan UP from Volume — up to 3 lines, skip past previous Volume boundary
    const nameFrom = Math.max(prevVIdx + 1, vIdx - 3)
    const nameParts = []
    for (let k = nameFrom; k < vIdx; k++) {
      const l = rawLines[k]
      if (!isNameLine(l)) continue
      const clean = l.replace(/[^A-Za-z0-9\s\-'()]/g,' ').replace(/\s+/g,' ').trim().toUpperCase()
      if (/[A-Z]{3,}/.test(clean)) nameParts.push(clean)
    }
    let name = nameParts.join(' ').replace(/\s+/g,' ').trim()
    // Strip leading 1-2 char OCR junk tokens (e.g. '"a CODA PISTOL' → 'CODA PISTOL')
    name = name.replace(/^(?:[A-Z0-9"'`=]{1,2}\s+)+(?=[A-Z]{3})/, '').trim()
    // Strip leading short all-caps noise tokens (3-4 chars) only when followed by
    // a longer token — e.g. "AEW A CODA PISTOL" → "CODA PISTOL", "RCH CS4 SMG" → "CS4 SMG"
    // Rule: if the first token is <= 4 chars AND the remaining text has a token >= 5 chars,
    // strip the short leading tokens one at a time (up to 3 times)
    for (let strip = 0; strip < 3; strip++) {
      const firstTokenMatch = name.match(/^([A-Z0-9]{1,3})\s+(.+)$/)
      if (!firstTokenMatch) break
      const rest = firstTokenMatch[2]
      const hasLongToken = /[A-Z][A-Z0-9\-']{3,}/.test(rest)
      if (hasLongToken) { name = rest } else break
    }

    // Price: scan DOWN from Volume — before next Volume or QUICK BUY
    let price = null
    for (let j = vIdx + 1; j < Math.min(nextVIdx, vIdx + 6); j++) {
      const l = rawLines[j]
      if (VOLUME_RE.test(l)) break
      if (/quick\s*buy/i.test(l)) break
      const c = extractPrice(l)
      if (c !== null) {
        // Reject if line has real words (not just digits/symbols)
        const wordTokens = l.replace(/[^A-Za-z]/g,' ').trim().split(/\s+/).filter(w => w.length >= 4)
        if (wordTokens.length === 0) {
          price = c
          console.log(`[parseItemShopColumn:${colLabel}]   precio en "${l}" → ${price}`)
          break
        }
      }
    }

    if (!name || name.length < 3) {
      console.log(`[parseItemShopColumn:${colLabel}] ⚠️  nombre vacío vIdx:${vIdx}`)
      continue
    }
    console.log(`[parseItemShopColumn:${colLabel}] ✅ "${name}" vol:${volumeUSCU}µSCU price:${price}`)
    items.push({ name, volumeUSCU, price })
  }
  return items
}
function parseItemShopGrid(rawCol1, rawCol2) {
  console.log('\n[parseItemShopGrid] ── INICIO (2 columnas) ──')
  const col1Items = parseItemShopColumn(rawCol1, 'col1')
  const col2Items = parseItemShopColumn(rawCol2, 'col2')

  const items = []
  const maxLen = Math.max(col1Items.length, col2Items.length)
  for (let i = 0; i < maxLen; i++) {
    if (col1Items[i]) items.push(col1Items[i])
    if (col2Items[i]) items.push(col2Items[i])
  }

  console.log(`[parseItemShopGrid] Total combinado: ${items.length}`)
  return items
}

async function extractItemShop(imageBuffer, colorScheme, triageTabText = '', uiBounds = null) {
  console.log('\n==============================')
  console.log('[extractItemShop] INICIO colorScheme:', colorScheme)
  await ensureDebugDir()

  const { width, height } = await sharp(imageBuffer).metadata()

  const headerBuf = await cropItemShop_header(imageBuffer, uiBounds)
  await saveDebugImage(headerBuf, '20-item-header-raw.png')
  const hm = await sharp(headerBuf).metadata()

  const ocrHeaderPass = async (pipeline, suffix) => {
    const proc = await pipeline(sharp(headerBuf).resize({ width: hm.width * 3, kernel: 'lanczos3' })).toBuffer()
    await saveDebugImage(proc, `21-item-header-${suffix}.png`)
    const tmp = path.join(TMP_DIR, `ocr-itemhdr-${suffix}-${Date.now()}.png`)
    await fs.promises.writeFile(tmp, proc)
    const text = await runTesseract(tmp, 6)
    await fs.promises.unlink(tmp)
    return text
  }

  const h1 = await ocrHeaderPass(s => s.grayscale().normalize().sharpen({ sigma: 1.5 }), 'norm')
  const h2 = await ocrHeaderPass(s => s.grayscale().negate().normalize().threshold(130).sharpen({ sigma: 1 }), 'neg')
  const h3 = await ocrHeaderPass(s => s.grayscale().normalize().threshold(colorScheme === 'light' ? 160 : 100), 'thr')

  const rawHeader = [h1, h2, h3].join('\n')
  console.log('[extractItemShop] rawHeader (combinado):\n' + rawHeader)
  const subtypeSource = triageTabText ? triageTabText + '\n' + rawHeader : rawHeader
  const shopSubtype = detectItemShopSubtype(subtypeSource)
  console.log(`[extractItemShop] shopSubtype: "${shopSubtype}" (triageTab: "${triageTabText}")`)

  const destBuf = await cropItemShop_destination(imageBuffer, colorScheme, uiBounds)
  await saveDebugImage(destBuf, '22-item-destination-raw.png')
  const dm = await sharp(destBuf).metadata()
  const destProc = await sharp(destBuf).resize({ width: dm.width * 3, kernel: 'lanczos3' }).grayscale().normalize().sharpen({ sigma: 1.5 }).toBuffer()
  await saveDebugImage(destProc, '23-item-destination-processed.png')
  const tmpD = path.join(TMP_DIR, `ocr-itemdest-${Date.now()}.png`)
  await fs.promises.writeFile(tmpD, destProc)
  const rawDest = await runTesseract(tmpD, 6)
  await fs.promises.unlink(tmpD)
  const rawDestLines = rawDest.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  console.log(`[extractItemShop] rawDest líneas: ${JSON.stringify(rawDestLines)}`)

  // ── Dedicated narrow crop: just the CHOOSE DESTINATION dropdown value row ──
  // For orange (Pyro) UI the dropdown sits at ~22.5-25.5% of uiHeight.
  // We do a tight single-line crop and OCR with psm:7 for best results.
  let destinationDirect = null
  if (colorScheme === 'orange') {
    try {
      const { width: iw, height: ih } = await sharp(imageBuffer).metadata()
      const { uiTop: ut = 0, uiHeight: uh = ih } = uiBounds ?? {}
      const ddLeft   = Math.floor(iw * 0.09)
      const ddTop    = ut + Math.floor(uh * 0.225)
      const ddWidth  = Math.floor(iw * 0.42)
      const ddHeight = Math.max(20, Math.floor(uh * 0.035))
      const ddBuf = await sharp(imageBuffer)
        .extract({ left: ddLeft, top: ddTop, width: ddWidth, height: ddHeight })
        .toBuffer()
      await saveDebugImage(ddBuf, '22b-item-dest-dropdown.png')
      const ddMeta = await sharp(ddBuf).metadata()
      const ddProc = await sharp(ddBuf)
        .resize({ width: ddMeta.width * 4, kernel: 'lanczos3' })
        .grayscale().normalize().sharpen({ sigma: 1.5 })
        .toBuffer()
      await saveDebugImage(ddProc, '22c-item-dest-dropdown-proc.png')
      const tmpDD = path.join(TMP_DIR, `ocr-itemdest-dd-${Date.now()}.png`)
      await fs.promises.writeFile(tmpDD, ddProc)
      const rawDD = await runTesseract(tmpDD, 7)  // psm:7 = single text line
      await fs.promises.unlink(tmpDD)
      console.log(`[extractItemShop] dest-dropdown raw: "${rawDD.trim()}"`)
      // Clean: strip trailing "All Options" and short trailing noise tokens
      let ddVal = rawDD
        .replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/\s*(all\s+options?|all\s+opt)\s*$/gi, '').trim()
        .replace(/(\s+[a-z]{1,3}){1,3}$/i, '').trim()
        .replace(/^[a-z]{1,3}\s+/i, '').trim()
      if (ddVal.length >= 3 && !/^(choose|all\s|search|item\s*name)/i.test(ddVal)) {
        destinationDirect = ddVal
        console.log(`[extractItemShop] ✅ dest-dropdown directo: "${destinationDirect}"`)
      }
    } catch (e) {
      console.log(`[extractItemShop] dest-dropdown error: ${e.message}`)
    }
  }

  // Parse destination: skip UI labels, extract the dropdown value
  const DEST_LABEL_RE = /^choose\s+(dest|sub|cat|subcat)/i
  const DEST_UI_RE    = /^(all\s+(cat|opt|sub)|search|item\s*name|choose\s+sub)/i
  const DEST_JUNK_RE  = /^[^A-Za-z0-9]+$/

  // Start with direct dropdown crop result (most reliable for orange UI)
  let destination = destinationDirect ?? null
  if (!destination) {
    for (const line of rawDestLines) {
      if (DEST_LABEL_RE.test(line)) continue
      if (DEST_UI_RE.test(line))    continue
      if (DEST_JUNK_RE.test(line))  continue

      const cleaned = line
        .replace(/choose\s+(sub.?dest|dest|category|subcat).*/i, '')
        .replace(/\ball\s+options?\b.*/i, '')
        .replace(/\ball\s+opt\b.*/i, '')
        .replace(/\ball\s+cat.*/i, '')
        .replace(/[^A-Za-z0-9\s\-]/g, ' ')
        .replace(/\s+/g, ' ').trim()

      if (cleaned.length >= 3 && !/^(sell|buy|wallet|blue\s+inf|eee)/i.test(cleaned)) {
        destination = cleaned
        console.log(`[extractItemShop] destination candidate: "${cleaned}"`)
        break
      }
    }
  }

  // Third pass: try to extract value inline from "CHOOSE DESTINATION <value>"
  if (!destination) {
    for (const line of rawDestLines) {
      const m = line.match(/choose\s+(?:sub.?)?dest(?:ination)?\s+(.+)/i)
      if (m) {
        const val = m[1].replace(/[^A-Za-z0-9\s\-]/g, ' ').replace(/\s+/g, ' ').trim()
        if (val.length >= 3 && !/^(all\s+(opt|cat)|choose)/i.test(val)) {
          destination = val
          console.log(`[extractItemShop] destination inline: "${destination}"`)
          break
        }
      }
    }
  }

  console.log(`[extractItemShop] destination: "${destination}"`)

  const mode = await detectItemShopMode(imageBuffer, width, height, uiBounds)
  console.log(`[extractItemShop] mode: "${mode}"`)

  const isCasaba = shopSubtype === 'casaba'

  const ocrCol = async (buf, label, debugIdx) => {
    await saveDebugImage(buf, `${debugIdx}-item-${label}-raw.png`)
    const m = await sharp(buf).metadata()
    const scale = Math.min(3, Math.floor(1800 / m.width))
    const proc = isCasaba
      ? await sharp(buf).resize({ width: m.width * scale, kernel: 'lanczos3' }).grayscale().normalize().threshold(160).toBuffer()
      : await sharp(buf).resize({ width: m.width * scale, kernel: 'lanczos3' }).grayscale().normalize().sharpen({ sigma: 1.5 }).toBuffer()
    await saveDebugImage(proc, `${debugIdx}b-item-${label}-processed.png`)
    const tmp = path.join(TMP_DIR, `ocr-item${label}-${Date.now()}.png`)
    await fs.promises.writeFile(tmp, proc)
    const raw = await runTesseract(tmp, 6)
    await fs.promises.unlink(tmp)
    console.log(`[extractItemShop] raw${label}:\n` + raw)
    return raw
  }

  const col1Buf = await cropItemShop_col1(imageBuffer, uiBounds)
  const col2Buf = await cropItemShop_col2(imageBuffer, uiBounds)
  const rawCol1 = await ocrCol(col1Buf, 'col1', '24')
  const rawCol2 = await ocrCol(col2Buf, 'col2', '25')

  const items = parseItemShopGrid(rawCol1, rawCol2)
  const rawGrid = `[COL1]\n${rawCol1}\n[COL2]\n${rawCol2}`

  console.log('\n[extractItemShop] ── RESULTADO ──')
  console.log(`  shopSubtype: "${shopSubtype}"`)
  console.log(`  destination: "${destination}"`)
  console.log(`  mode: "${mode}"`)
  console.log(`  items: ${items.length}`)
  items.forEach((it, idx) => console.log(`    [${idx}] ${JSON.stringify(it)}`))
  console.log('==============================\n')

  return { shopSubtype, destination, mode, items, rawHeader, rawGrid }
}