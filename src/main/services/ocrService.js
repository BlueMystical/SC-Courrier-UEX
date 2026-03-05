// src/main/services/ocrService.js

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sharp = require('sharp')
const uexCache = require('../helpers/uexCache')

const TESSERACT_PATH = 'tesseract'
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
      // Return the full cached item object, with price injected and name from catalogue
      result.push({
        ...match.item,           // full API object (id, name, category, section, slug, etc.)
        price:           item.price,
        matchSimilarity: match.similarity,
        ocr_name:        item.name,    // preserve original OCR text for debugging
        volumeUSCU:      item.volumeUSCU
      })
    } else {
      // Unresolved — keep raw OCR data with nulls
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
function runTesseract(imagePath, psm = 6) {
  console.log(`[Tesseract] Ejecutando OCR sobre: ${imagePath} (psm:${psm})`)
  return new Promise((resolve, reject) => {
    execFile(
      TESSERACT_PATH,
      [imagePath, 'stdout', '-l', 'eng', '--psm', String(psm)],
      (error, stdout) => {
        if (error) { console.error('[Tesseract] ERROR:', error.message); return reject(error) }
        console.log(`[Tesseract] OK. Caracteres leídos: ${stdout.length}`)
        console.log(`[Tesseract] Raw output:\n${stdout}`)
        resolve(stdout)
      }
    )
  })
}

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
// Color scheme detection
// ─────────────────────────────────────────────
async function detectUIColorScheme(buffer, width, height) {
  // Medir en la zona central-izquierda (evita bordes del monitor)
  const x = Math.floor(width * 0.10), y = Math.floor(height * 0.15)
  const w = Math.floor(width * 0.35), h = Math.floor(height * 0.35)
  const raw = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer()
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
    scheme = 'light'   // Casaba: fondo crema muy claro
  } else if (rgRatio > 1.4) {
    scheme = 'orange'  // Commodity naranja / Weapons / Refinery
  } else if (avgB > avgR + 10 && avgB > avgG + 5) {
    scheme = 'blue'    // Commodity azul / Center Mass / Armor / Pharmacy
  } else {
    scheme = 'dark'    // Oscuro genérico (Teach's, etc.)
  }

  console.log(`[detectUIColorScheme] RGB=(${avgR.toFixed(0)},${avgG.toFixed(0)},${avgB.toFixed(0)}) brightness:${avgBrightness.toFixed(0)} ratio:${rgRatio.toFixed(2)} → ${scheme}`)
  return scheme
}

// ─────────────────────────────────────────────
// Sector A crops
// ─────────────────────────────────────────────
async function cropSectorA_tipo(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  // BUY/SELL tabs: están en y=3-9% en todas las tiendas
  // Mantener ancho amplio para detectar keywords de tipo de terminal
  const left = Math.floor(width * 0.03), top = Math.floor(height * 0.03)
  const cropWidth = Math.floor(width * 0.40), cropHeight = Math.floor(height * 0.09)
  console.log(`[cropSectorA_tipo] ${width}x${height}px → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

async function cropSectorA_nombre(buffer, colorScheme = 'blue') {
  const { width, height } = await sharp(buffer).metadata()
  // Posición exacta del valor del dropdown CHOOSE DESTINATION por scheme:
  //   dark  (CubbyBlast):   y~18%
  //   blue  (CenterMass):   y~23%
  //   orange (Refinery):    y~23-24%
  //   light  (Casaba):      y~24%
  // Tomamos un rango amplio centrado en esa zona (+/- 4%) para capturar label y valor
  const topByScheme = { dark: 0.14, blue: 0.19, orange: 0.19, light: 0.19 }
  const topPct = topByScheme[colorScheme] ?? 0.19
  const left = Math.floor(width * 0.05), top = Math.floor(height * topPct)
  const cropWidth = Math.floor(width * 0.42), cropHeight = Math.floor(height * 0.12)
  console.log(`[cropSectorA_nombre] colorScheme:${colorScheme} top:${(topPct*100).toFixed(0)}% → left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

// ─────────────────────────────────────────────
// Sector B crops
// ─────────────────────────────────────────────
async function cropSectorB_tabs(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  const left = Math.floor(width * 0.64), top = Math.floor(height * 0.13)
  const cropWidth = Math.floor(width * 0.36), cropHeight = Math.floor(height * 0.12)
  console.log(`[cropSectorB_tabs] left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
  return await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer()
}

async function cropSectorB_items(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  const left = Math.floor(width * 0.69), top = Math.floor(height * 0.22)
  const cropWidth = Math.floor(width * 0.31), cropHeight = Math.floor(height * 0.75)
  console.log(`[cropSectorB_items] left:${left} top:${top} w:${cropWidth} h:${cropHeight}`)
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

  // Exact match primero
  if (upper.includes('COMMODITIES')) { console.log(`[detectTypeFromRaw] ✅ commodity`); return 'commodity' }
  if (upper.includes('ITEMS'))       { console.log(`[detectTypeFromRaw] ✅ item`);      return 'item' }
  if (upper.includes('VEHICLES'))    { console.log(`[detectTypeFromRaw] ✅ vehicle`);   return 'vehicle' }

  // Fuzzy: buscar palabras de 8+ chars que se parezcan a COMMODITIES (OCR lee CONNODITIES, CONMODITIES, etc.)
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
// Item shop type detection — detecta subtipo de tienda
// Analiza el header/título central visible en las tiendas de Items
// Subtipos: cubby_blast, center_mass, casaba, refinery_shop, generic_item
// ─────────────────────────────────────────────
function detectItemShopSubtype(rawHeaderText) {
  const up = rawHeaderText.toUpperCase().replace(/[^A-Z0-9\s_]/g, ' ').replace(/\s+/g, ' ')
  console.log(`[detectItemShopSubtype] OCR header: "${up.slice(0, 120)}"`)

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
  // Center Mass: solo logo circular → no hay texto detectable, queda como fallback
  // Se detectará por exclusión si el header tiene solo noise/vacío y
  // la destination matchea una terminal de Center Mass
  return 'generic_item'
}

// Mapeo shopSubtype → company_name exacto en la API UEX
// Permite hacer el match de terminal: filtrar por company + fuzzy city/station
const SHOP_SUBTYPE_COMPANY = {
  cubby_blast:           'Cubby Blast',
  casaba:                'Casaba Outlet',
  refinery_shop:         'Refinery Shop',
  teachs:                "Teach's",
  pharmacy:              'Pharmacy',
  weapons_shop:          'Weapons Shop',
  armor_shop:            'Armor Shop',
  center_mass:           'Center Mass',
  skutters:              'Skutters',
  dumpers_depot:         "Dumper's Depot",
  platinum_bay:          'Platinum Bay',
  garrity_defense:       'Garrity Defense',
  conscientious_objects: 'Conscientious Objects',
}

// ─────────────────────────────────────────────
// fuzzyMatchItemTerminal
// Estrategia de 2 pasos:
//   1. Filtrar terminales por company_name (shopSubtype → company exacta)
//   2. Dentro de ese subset, buscar por destination (ciudad/estación)
// Si no hay match de subtipo, usar todos los de type='item'
// ─────────────────────────────────────────────
function fuzzyMatchItemTerminal(shopSubtype, destination, terminals) {
  console.log(`[fuzzyMatchItem] shopSubtype:"${shopSubtype}" destination:"${destination}"`)
  if (!terminals?.length) return null

  const companyName = SHOP_SUBTYPE_COMPANY[shopSubtype]

  // Paso 1: filtrar por company_name si tenemos un subtipo conocido
  let subset = terminals.filter(t => t.type === 'item' || t.is_shop_fps)
  if (companyName) {
    const byCompany = subset.filter(t =>
      t.company_name && levenshtein(t.company_name.toUpperCase(), companyName.toUpperCase()) <= 2
    )
    console.log(`[fuzzyMatchItem] Filtrado por company "${companyName}": ${byCompany.length} terminales`)
    if (byCompany.length > 0) subset = byCompany
  }

  if (!destination || destination.length < 2) {
    // Sin destination, devolver el primero del subset si solo hay uno
    if (subset.length === 1) {
      console.log(`[fuzzyMatchItem] ✅ único match: "${subset[0].name}"`)
      return { terminal: subset[0], similarity: 0.8 }
    }
    console.log(`[fuzzyMatchItem] ⚠️  sin destination, ${subset.length} candidatos → no resuelto`)
    return null
  }

  // Paso 2: fuzzy match de destination contra city_name / displayname / space_station_name
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
async function detectModeByBrightness(buffer, width, height) {
  // Tabs "BUY" (left) y "LOCAL MARKET VALUE" (right) en el panel derecho
  // Las coordenadas son relativas al panel completo 1920x1080
  const tabY = Math.floor(height * 0.175), tabH = Math.floor(height * 0.045)
  const leftX  = Math.floor(width * 0.641), leftW  = Math.floor(width * 0.075)
  const rightX = Math.floor(width * 0.716), rightW = Math.floor(width * 0.170)

  const measureBrightness = async (x, y, w, h) => {
    const raw = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).grayscale().raw().toBuffer()
    let sum = 0; for (let i = 0; i < raw.length; i++) sum += raw[i]
    return sum / raw.length
  }

  // Tres pasadas para máxima cobertura de esquemas de color
  const ocrTab = async (x, y, w, h, label) => {
    const crop = await sharp(buffer).extract({ left: x, top: y, width: w, height: h }).toBuffer()
    const scale = Math.min(4, Math.floor(800 / w))  // Limitar tamaño máximo a ~800px

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

    // Pasada 1: normalize + threshold alto — texto oscuro sobre fondo claro (tab activo naranja)
    let text = await tryOCR(s => s.grayscale().normalize().threshold(140), 'thr')
    if (/BUY|SELL|RENT|LOCAL|MARKET/.test(text)) return text

    // Pasada 2: negate + normalize + threshold — texto claro sobre fondo oscuro (UI azul)
    text = await tryOCR(s => s.grayscale().negate().normalize().threshold(130), 'neg')
    if (/BUY|SELL|RENT|LOCAL|MARKET/.test(text)) return text

    // Pasada 3: sharpen fuerte solo — sin binarizar, para texto fino
    text = await tryOCR(s => s.grayscale().normalize().sharpen({ sigma: 3, m1: 0, m2: 6 }), 'shrp')
    return text
  }

  const leftBrightness  = await measureBrightness(leftX,  tabY, leftW,  tabH)
  const rightBrightness = await measureBrightness(rightX, tabY, rightW, tabH)
  console.log(`[detectModeByBrightness] left:${leftBrightness.toFixed(1)} right:${rightBrightness.toFixed(1)}`)

  // Si la diferencia de brillo es clara (>8), el tab más brillante es el activo
  // Si son similares (<8), leer OCR de ambos tabs y buscar el texto más legible
  const brightnessDiff = Math.abs(leftBrightness - rightBrightness)

  let activeText = ''
  if (brightnessDiff >= 8) {
    const leftIsActive = leftBrightness > rightBrightness
    const activeX = leftIsActive ? leftX  : rightX
    const activeW = leftIsActive ? leftW  : rightW
    activeText = await ocrTab(activeX, tabY, activeW, tabH, leftIsActive ? 'left' : 'right')
    // guardar debug del tab activo
    const tabCrop = await sharp(buffer).extract({ left: activeX, top: tabY, width: activeW, height: tabH }).toBuffer()
    const tabProcessed = await sharp(tabCrop).resize({ width: activeW * 4, kernel: 'lanczos3' }).grayscale().normalize().threshold(100).toBuffer()
    await saveDebugImage(tabProcessed, '11b-tab-activo-processed.png')
    console.log(`[detectModeByBrightness] activeTab:${leftIsActive ? 'LEFT' : 'RIGHT'} rawTab:"${activeText}"`)
  } else {
    // Brillo similar → leer ambos y combinar
    console.log(`[detectModeByBrightness] ⚠️  brillo similar (diff:${brightnessDiff.toFixed(1)}) → OCR ambos tabs`)
    const leftText  = await ocrTab(leftX,  tabY, leftW,  tabH, 'left')
    const rightText = await ocrTab(rightX, tabY, rightW, tabH, 'right')
    activeText = leftText + ' ' + rightText
    console.log(`[detectModeByBrightness] leftTab:"${leftText}" rightTab:"${rightText}"`)
    // guardar debug del left tab
    const tabCrop = await sharp(buffer).extract({ left: leftX, top: tabY, width: leftW, height: tabH }).toBuffer()
    const tabProcessed = await sharp(tabCrop).resize({ width: leftW * 4, kernel: 'lanczos3' }).grayscale().normalize().threshold(100).toBuffer()
    await saveDebugImage(tabProcessed, '11b-tab-activo-processed.png')
  }

  if (activeText.includes('SELL')) return 'sell'
  if (activeText.includes('RENT')) return 'rent'
  if (activeText.includes('BUY'))  return 'buy'

  // Último fallback por brillo puro
  const fallback = leftBrightness >= rightBrightness ? 'buy' : 'sell'
  console.log(`[detectModeByBrightness] ⚠️  OCR no reconoció tabs → fallback brillo: "${fallback}"`)
  return fallback
}

// ─────────────────────────────────────────────
// Sector B — Price parser
//
// El precio en el juego es: ¤[entero].[decimales]k/SCU  (ej: ¤28.131000051k/SCU)
// OCR introduce ruido ANTES del número: "2B LALDO0SLK/SCU", "419 94600082k/SCU"
// Estrategia: buscar el patrón [número][k|m]/SCU y tomar ESE número,
// ignorando todo el ruido previo en la línea.
//
// Casos reales:
//   "2B LALDO0SLK/SCU"    → 0SL antes de K → no es número limpio
//   "419 94600082k/SCU"   → 94600082 × 1k → 94600082000 ❌ (OCR leyó 2 números)
//   "S305300094k/SCU"     → 305300094 × 1k → enorme ❌ (OCR pegó dígitos)
//
// Solución: buscar el grupo [dígitos+punto+coma][K|M] justo antes de /SCU
// El número real es siempre el que está pegado al multiplicador sin espacios.
// ─────────────────────────────────────────────
function parsePrice(text) {
  // Normalizar: ¤ y variantes OCR de moneda pegadas a dígito
  let s = text.replace(/[¤₤£€$¥]/g, '')

  // Buscar TODOS los patrones número+multiplicador+/SCU en la línea
  // y quedarse con el que tenga el número más corto (menos dígitos = menos noise pegado)
  // Ej: "15 66599988K/SCU" tiene 2 matches: "15" (sin mult) y "66599988K"
  //     pero "66599988K" → 66B → descartado; "5.66599988K" → 5665 ✓
  //
  // Estrategia: buscar número PEGADO (sin espacio previo) al multiplicador
  const pricePattern = /([0-9][0-9.,]*)([KkMm]?)\/\s*S[A-Z]/gi
  const allMatches = [...s.matchAll(pricePattern)]
  if (allMatches.length === 0) return null

  // Evaluar cada match — tomar el primero que pase sanity check
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
  // Remove trailing: qty (with optional comma-thousands like 1,090) + SCU and anything after
  s = s.replace(/\s+[\d,]+\s+S[A-Z]{2,3}\b.*/i, '').trim()
  // Remove leading non-alpha noise
  s = s.replace(/^[^A-Za-z]+/, '')
  // Remove leading short noise tokens (1-4 chars each) only if followed by a real word (4+ chars)
  // Handles: "% STINS" → "STINS", "HA eee Pie HYDROGEN" → "HYDROGEN",
  //          "Act APHORITE" → "APHORITE", "MMe fh ONNAPOXY" → "ONNAPOXY"
  s = s.replace(/^(?:[A-Za-z0-9%]{1,4}\s+)+(?=[A-Za-z]{4})/, '').trim()
  // Only letters, numbers, spaces, hyphens, apostrophes
  s = s.replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

// ─────────────────────────────────────────────
// Sector B — Main item parser
//
// Estrategia dual de detección de inicio de item:
//
// ANCHOR PRIMARIO — "SHOP QUANTITY" (aparece a la derecha del nombre en línea 1)
//   Layout del juego:
//     "[nombre parte 1]  SHOP QUANTITY"   ← línea 1: anchor + primera parte del nombre
//     "[nombre parte 2]  [qty] SCU"        ← línea 2: resto del nombre + cantidad
//     "[precio]/SCU"                       ← línea 3
//     "[stock status]"                     ← línea 4
//
// ANCHOR FALLBACK — " SCU" (para imágenes donde SHOP QUANTITY no se lee)
//   Si no hay ningún SHOP QUANTITY en el raw, se usa la lógica anterior de SCU-header
//   con pre-pass de merge de línea anterior.
//
// Esto cubre ambos casos sin romperse mutuamente.
// ─────────────────────────────────────────────
function parseSectorBItems(rawText, commodities = []) {
  console.log('\n[parseSectorBItems] ── INICIO ──')

  const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  console.log('[parseSectorBItems] líneas raw:', rawLines)

  const SCU_RE    = / SCU\b/i
  const CARGO_RE  = /AVAI?[LA]{1,2}BLE\s+CARGO|AVATLABLE\s+CARGO/i
  const JUNK_RE   = /^[\[\]|\\\/\-\s]*$|^[^A-Za-z]{0,3}$|^e[0-9]+$/
  const SHOPQ_RE  = /SHOP\s*QUAN[TI]{2}[TY]{2}|SHOP\s*QUANT/i  // tolerante a OCR noise

  // ── Elegir estrategia según presencia de SHOP QUANTITY ──
  const hasShopQuantity = rawLines.some(l => SHOPQ_RE.test(l))
  console.log(`[parseSectorBItems] anchor: ${hasShopQuantity ? 'SHOP QUANTITY (primario)' : 'SCU (fallback)'}`)

  const items = []

  if (hasShopQuantity) {
    // ────────────────────────────────────────
    // ESTRATEGIA A: SHOP QUANTITY como anchor
    // ────────────────────────────────────────
    // Identificar índices de líneas con SHOP QUANTITY
    const anchorIdxs = rawLines.reduce((acc, l, i) => {
      if (SHOPQ_RE.test(l)) acc.push(i)
      return acc
    }, [])
    console.log(`[parseSectorBItems] ${anchorIdxs.length} anchors SHOP QUANTITY en índices:`, anchorIdxs)

    for (const ai of anchorIdxs) {
      const anchorLine = rawLines[ai]
      console.log(`\n[parseSectorBItems] ── Anchor[${ai}]: ${JSON.stringify(anchorLine)}`)

      // Nombre parte 1: todo lo que está a la izquierda de SHOP QUANTITY en esta línea
      const namePart1Raw = anchorLine.replace(SHOPQ_RE, '').trim()
      const namePart1 = namePart1Raw.replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
      console.log(`[parseSectorBItems]   namePart1: "${namePart1}"`)

      // Línea siguiente: "[nombre parte 2]  [qty] SCU"
      let namePart2 = ''
      let quantity = 0
      const nextLine = rawLines[ai + 1] ?? ''
      const qtyMatch = nextLine.match(/([\d,]+)\s+SCU/i)
      if (qtyMatch) {
        quantity = parseInt(qtyMatch[1].replace(/,/g, ''))
        // Todo lo que precede a "[qty] SCU" en esa línea es el resto del nombre
        const before = nextLine.slice(0, nextLine.search(/[\d,]+\s+SCU/i)).trim()
        namePart2 = before.replace(/[^A-Za-z0-9\s\-']/g, ' ').replace(/\s+/g, ' ').trim()
      }
      console.log(`[parseSectorBItems]   namePart2: "${namePart2}"  qty:${quantity}`)

      // Nombre completo
      const fullName = [namePart1, namePart2].filter(Boolean).join(' ').trim()
      console.log(`[parseSectorBItems]   fullName: "${fullName}"`)

      if (!fullName || fullName.length < 2) {
        console.log(`[parseSectorBItems] ⚠️  nombre vacío, saltando`)
        continue
      }

      // Buscar precio y status en las líneas siguientes (desde ai+2 hasta el próximo anchor)
      let price = null, stockStatus = null
      const nextAnchorIdx = anchorIdxs.find(x => x > ai) ?? rawLines.length
      for (let j = ai + 2; j < nextAnchorIdx; j++) {
        const l = rawLines[j].trim()
        if (!l || JUNK_RE.test(l) || CARGO_RE.test(l)) continue

        // Intentar extraer precio
        const p = parsePrice(l)
        if (p !== null && price === null) price = p

        // Intentar extraer status
        const s = resolveStockStatus(l)
        if (s && !stockStatus) stockStatus = s

        console.log(`[parseSectorBItems]   line[${j}]: ${JSON.stringify(l)} → price:${p} status:${JSON.stringify(s)}`)
      }

      console.log(`[parseSectorBItems]   → price:${price}  status:${JSON.stringify(stockStatus)}`)

      const item = {
        name: fullName, quantity, price, stockStatus,
        commodityId: null, commodityName: null, commodityCode: null
      }

      if (commodities.length > 0) {
        const match = fuzzyMatchCommodity(fullName, commodities)
        if (match) {
          console.log(`[parseSectorBItems] 🔍 "${fullName}" → "${match.commodity.name}" (${(match.similarity * 100).toFixed(1)}%)`)
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
    // ────────────────────────────────────────
    // ESTRATEGIA B: SCU como anchor (fallback)
    // Pre-pass de merge: si la línea anterior a un SCU-header no es UI/junk, fusionar
    // ────────────────────────────────────────
    console.log('[parseSectorBItems] Usando estrategia fallback SCU')
    const UI_RE = /SHOP\s+QUANTITY|LOCAL\s+MARKET|AVAILABLE\s+CARGO/i

    const lines = []
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]
      if (SCU_RE.test(line) && !CARGO_RE.test(line)) {
        const prev = lines[lines.length - 1]
        if (prev && !UI_RE.test(prev) && !SCU_RE.test(prev) && !JUNK_RE.test(prev) && !CARGO_RE.test(prev)) {
          // La línea anterior debe ser "limpia": al menos una palabra real de 3+ letras
          // y no debe tener más tokens cortos/ruido que letras útiles
          const realWords = (prev.match(/[A-Za-z]{3,}/g) || [])
          const totalTokens = prev.split(/\s+/).length
          // Criterios: al menos 1 palabra real, no más de 5 tokens total,
          // y ratio palabras_reales/total_tokens >= 30%
          // Esto evita fusionar líneas de botones/iconos como "[1 Jz }4 JL2 Jlas)(24)..."
          // y líneas de ruido excesivo como "i SOMO Te An scat et erie eee oO Z"
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
        name, quantity, price, stockStatus,
        commodityId: null, commodityName: null, commodityCode: null
      }

      if (commodities.length > 0) {
        const match = fuzzyMatchCommodity(name, commodities)
        if (match) {
          console.log(`[parseSectorBItems] 🔍 "${name}" → "${match.commodity.name}" (${(match.similarity * 100).toFixed(1)}%)`)
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
async function extractSectorA(imageBuffer, colorScheme = 'blue') {
  console.log('\n══════════════════════════════════')
  console.log('[extractSectorA] INICIO — Crops separados + triple pasada')
  await ensureDebugDir()

  const tipoCropBuffer = await cropSectorA_tipo(imageBuffer)
  await saveDebugImage(tipoCropBuffer, '00-crop-tipo-raw.png')
  const tipoProcessed = await preprocessPass2(tipoCropBuffer)
  await saveDebugImage(tipoProcessed, '01-crop-tipo-negate.png')
  const tmpTipo = path.join(TMP_DIR, `ocr-tipo-${Date.now()}.png`)
  await fs.promises.writeFile(tmpTipo, tipoProcessed)
  const rawTipo = await runTesseract(tmpTipo, 6)
  await fs.promises.unlink(tmpTipo)
  const type = detectTypeFromRaw(rawTipo)

  const nombreCropBuffer = await cropSectorA_nombre(imageBuffer, colorScheme)
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

  // Para UI naranja (Refinery/Weapons): pasada extra con R-B para destacar texto naranja
  let rawRB = ''
  if (colorScheme === 'orange') {
    const { data, info } = await sharp(nombreCropBuffer).raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const rb = Buffer.alloc(info.width * info.height)
    for (let i = 0; i < rb.length; i++) {
      rb[i] = Math.max(0, Math.min(255, data[i * ch] - data[i * ch + 2]))
    }
    const rbBuf = await sharp(rb, { raw: { width: info.width, height: info.height, channels: 1 } })
      .resize({ width: info.width * 3, kernel: 'lanczos3' }).toBuffer()
    await saveDebugImage(rbBuf, '06-crop-nombre-rb.png')
    const tmpRB = path.join(TMP_DIR, `ocr-nombre-rb-${Date.now()}.png`)
    await fs.promises.writeFile(tmpRB, rbBuf)
    rawRB = await runTesseract(tmpRB, 6)
    await fs.promises.unlink(tmpRB)
    console.log('[NOMBRE RB]:\n' + rawRB)
  }

  const allLines = [...new Set([
    ...extractValidLines(rawSoft, 'nombre-soft'),
    ...extractValidLines(rawA,    'nombre-A'),
    ...extractValidLines(rawB,    'nombre-B'),
    ...(rawRB ? extractValidLines(rawRB, 'nombre-RB') : []),
  ])]
  console.log(`[extractSectorA] Total candidatos: ${allLines.length} → ${JSON.stringify(allLines)}`)

  let stationName = allLines[0] ?? null
  if (stationName) {
    const original = stationName
    for (const noise of NOMBRE_NOISE_TOKENS) stationName = stationName.replace(noise, '').trim()
    if (stationName !== original) console.log(`[extractSectorA] Limpieza: "${original}" → "${stationName}"`)
  }

  console.log('\n[extractSectorA] ── RESULTADO ──')
  console.log(`  type:        "${type}"`)
  console.log(`  stationName: "${stationName}"`)
  console.log('══════════════════════════════════\n')

  return { type, stationName, validLines: allLines, rawTipo, rawNombre: rawSoft }
}

// ─────────────────────────────────────────────
// Sector B extraction
// ─────────────────────────────────────────────
async function extractSectorB(imageBuffer, colorScheme, commodities = []) {
  console.log('\n══════════════════════════════════')
  console.log('[extractSectorB] INICIO colorScheme:', colorScheme)

  const { width, height } = await sharp(imageBuffer).metadata()

  console.log('\n[extractSectorB] ── DETECCIÓN MODO POR BRILLO ──')
  const mode = await detectModeByBrightness(imageBuffer, width, height)
  console.log(`[extractSectorB] mode: "${mode}"`)

  const tabsCrop = await cropSectorB_tabs(imageBuffer)
  await saveDebugImage(tabsCrop, '10-sectorB-tabs-raw.png')

  console.log('\n[extractSectorB] ── CROP ITEMS ──')
  const itemsCrop = await cropSectorB_items(imageBuffer)
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

    let cachedItems = []
    try { cachedItems = uexCache.get('items') || []; console.log(`[processOCR] Items cache: ${cachedItems.length}`) } catch (e) { console.warn('[processOCR] ⚠️ No items cache:', e.message) }

    const { width, height } = await sharp(buffer).metadata()
    const colorScheme = await detectUIColorScheme(buffer, width, height)

    console.log('\n[processOCR] ── SECTOR A ──')
    const { type, stationName, validLines, rawTipo, rawNombre } = await extractSectorA(buffer, colorScheme)

    // ── Bifurcación: Item shop vs Commodity terminal ──
    if (type === 'item' || type === 'vehicle' || type === 'unknown') {
      console.log(`\n[processOCR] ── ITEM SHOP MODE (type:${type}) ──`)
      const { shopSubtype, destination: destFromHeader, mode, items, rawHeader, rawGrid } = await extractItemShop(buffer, colorScheme)

      // Fuentes de destination en orden de prioridad:
      // 1. El dropdown leído por extractItemShop (más preciso)
      // 2. Los candidatos del Sector A (ya leídos de la zona del dropdown izq.)
      // Elegir el mejor: descartar ruido, preferir el que parece nombre de lugar
      const PLACE_RE = /^[A-Z][A-Z0-9\s\-]{3,}$/
      const NOISE_RE = /^(choose|destination|sub|all\s+(opt|cat)|search|item\s*name|ee|null)$/i

      let destination = destFromHeader
      if (!destination || NOISE_RE.test(destination)) {
        // Buscar en validLines del Sector A el mejor candidato
        const sectorACandidates = (validLines || []).filter(l =>
          l && l.length >= 3 && !NOISE_RE.test(l) &&
          !/^(JOSE|REALS|TT|SL|AREFEAIR|AREAIR)$/.test(l.toUpperCase())
        )
        // Preferir líneas que parezcan lugar: "AREA18", "ARC-L1...", etc.
        const placeCandidate = sectorACandidates.find(l => /^(AREA|ARC|MIC|CRU|HUR|ABE|GRI|TER|ORI|OCE|MAG|ITO|ARC)/i.test(l))
          ?? sectorACandidates[0]
        if (placeCandidate) {
          destination = placeCandidate
          console.log(`[processOCR] destination fallback desde SectorA: "${destination}"`)
        }
      }

      // Resolver terminal: shopSubtype (company) + destination (ciudad/estación)
      let terminalMatch = null
      if (shopSubtype !== 'generic_item' || destination) {
        terminalMatch = fuzzyMatchItemTerminal(shopSubtype, destination, terminals)
      }

      // Fallback: fuzzy clásico con destination en todos los terminales de tipo item
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

    console.log('\n[processOCR] ── SECTOR B ──')
    const { mode, items: rawItems, rawItems: rawItemsText } = await extractSectorB(buffer, colorScheme, commodities)

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
// ITEM SHOP EXTRACTION — funciones independientes de Commodities
// ══════════════════════════════════════════════════════════

async function cropItemShop_header(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  // El logo puede estar en distintas posiciones según la tienda:
  //   CubbyBlast: el logo está desde y=0% (encima del borde físico del monitor)
  //   Refinery:   logo en y=12-19%
  //   Casaba:     logo en y=9-17%
  //   CenterMass: logo en y=3-7% (solo logo circular, sin texto)
  // Cubrir x=20%-80% (logo centrado entre 42-62% según tienda)
  // Cubrir y=0%-20% para capturar todos los casos
  const left = Math.floor(width * 0.20), top = 0
  const w    = Math.floor(width * 0.60), h   = Math.floor(height * 0.20)
  console.log(`[cropItemShop_header] → left:${left} top:${top} w:${w} h:${h}`)
  return await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()
}

async function cropItemShop_destination(buffer, colorScheme = 'blue') {
  const { width, height } = await sharp(buffer).metadata()
  // Posición exacta del valor del dropdown por scheme (medido pixel a pixel):
  //   dark   (CubbyBlast):  y~18%
  //   blue   (CenterMass):  y~23%
  //   orange (Refinery):    y~23-24%
  //   light  (Casaba):      y~24%
  // Capturamos una franja amplia que incluye label + valor
  const topByScheme = { dark: 0.14, blue: 0.19, orange: 0.20, light: 0.19 }
  const topPct = topByScheme[colorScheme] ?? 0.19
  const left = Math.floor(width * 0.05), top = Math.floor(height * topPct)
  const w    = Math.floor(width * 0.42), h   = Math.floor(height * 0.10)
  console.log(`[cropItemShop_destination] colorScheme:${colorScheme} → left:${left} top:${top} w:${w} h:${h}`)
  const rawBuf = await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()

  // Para UI naranja: el texto naranja sobre fondo rojo oscuro necesita R-B para destacar
  // Para el resto: grayscale normalize estándar
  if (colorScheme === 'orange') {
    const { data, info } = await sharp(rawBuf).raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const rb = Buffer.alloc(info.width * info.height)
    for (let i = 0; i < rb.length; i++) {
      const r = data[i * ch], b = data[i * ch + 2]
      rb[i] = Math.max(0, Math.min(255, r - b))
    }
    return await sharp(rb, { raw: { width: info.width, height: info.height, channels: 1 } })
      .toBuffer()
  }
  return rawBuf
}

// Dos crops separados: columna izquierda y columna derecha del grid
// Esto evita que Tesseract mezcle el texto de ambas columnas en la misma línea
async function cropItemShop_col1(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  // Col1: desde el borde del panel izq hasta ~40% del ancho
  const left = Math.floor(width * 0.09), top = Math.floor(height * 0.25)
  const w    = Math.floor(width * 0.29), h   = Math.floor(height * 0.70)
  console.log(`[cropItemShop_col1] → left:${left} top:${top} w:${w} h:${h}`)
  return await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()
}

async function cropItemShop_col2(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  // Col2: desde ~40% hasta ~62% (antes del panel de detalle)
  const left = Math.floor(width * 0.39), top = Math.floor(height * 0.25)
  const w    = Math.floor(width * 0.23), h   = Math.floor(height * 0.70)
  console.log(`[cropItemShop_col2] → left:${left} top:${top} w:${w} h:${h}`)
  return await sharp(buffer).extract({ left, top, width: w, height: h }).toBuffer()
}

async function detectItemShopMode(buffer, width, height) {
  const tabY = Math.floor(height * 0.03), tabH = Math.floor(height * 0.08)
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
  const VOLUME_RE     = /volume\s*[:\-]\s*([\d,]+)\s*[µuypwv»]{0,2}s?cu/i
  const JUNK_RE       = /^(quick\s*buy|first|prior|next|last|\d+\/\d+|choose|search|item\s*name|all\s+cat|all\s+opt|subcate|wallet|gories|ategories|yc|ier)/i
  const NOISE_ONLY_RE = /^[^A-Za-z0-9]{0,2}$|^[a-z]{1,2}(\s+[a-z0-9]{0,2})*\s*$|^\W+$/

  const extractPrice = (line) => {
    const nums = [...line.matchAll(/\b([\d]{1,3}(?:,[\d]{3})+|[\d]{2,7})\b/g)]
    if (!nums.length) return null
    const val = parseInt(nums[nums.length - 1][1].replace(/,/g, ''))
    return (!isNaN(val) && val > 0 && val <= 10_000_000) ? val : null
  }

  const isPriceLine = (line) => {
    const tokens = line.replace(/[^A-Za-z0-9,]/g, ' ').trim().split(/\s+/).filter(Boolean)
    const hasNum  = tokens.some(t => /^\d/.test(t.replace(/,/g,'')) && t.replace(/,/g,'').length >= 2)
    const hasWord = tokens.some(t => t.length >= 3 && /[A-Za-z]{3}/.test(t) && !/^(pSCU|ypSCU|SCU|yps)/i.test(t))
    return hasNum && !hasWord
  }

  const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  console.log(`[parseItemShopColumn:${colLabel}] ${rawLines.length} líneas raw`)

  const volumeIdxs = []
  for (let i = 0; i < rawLines.length; i++) {
    if (VOLUME_RE.test(rawLines[i])) volumeIdxs.push(i)
  }
  console.log(`[parseItemShopColumn:${colLabel}] ${volumeIdxs.length} items encontrados`)

  const items = []
  for (let vi = 0; vi < volumeIdxs.length; vi++) {
    const vIdx = volumeIdxs[vi], prevVIdx = volumeIdxs[vi-1] ?? -1, nextVIdx = volumeIdxs[vi+1] ?? rawLines.length
    const volMatch = rawLines[vIdx].match(VOLUME_RE)
    const volumeUSCU = volMatch ? parseInt(volMatch[1].replace(/,/g,'')) : null
    const nameFrom = Math.max(prevVIdx + 2, vIdx - 3)
    const nameParts = []
    for (let k = nameFrom; k < vIdx; k++) {
      const l = rawLines[k]
      if (JUNK_RE.test(l) || NOISE_ONLY_RE.test(l) || isPriceLine(l) || VOLUME_RE.test(l)) continue
      const clean = l.replace(/[^A-Za-z0-9\s\-'()]/g,' ').replace(/\s+/g,' ').trim().toUpperCase()
      if (/[A-Z]{3,}/.test(clean)) nameParts.push(clean)
    }
    let name = nameParts.join(' ')
      .replace(/\(\s+/g,'(').replace(/\s+\)/g,')')
      .replace(/\s+/g,' ').trim()
    name = name.replace(/^[A-Z0-9-]{1,2}\s+(?=[A-Z0-9]{2,})/, '').trim()
    let price = null
    for (let j = vIdx+1; j < Math.min(nextVIdx, vIdx+5); j++) {
      const l = rawLines[j]
      if (VOLUME_RE.test(l)) break
      if (JUNK_RE.test(l)) continue
      if (NOISE_ONLY_RE.test(l) && !extractPrice(l)) continue
      const c = extractPrice(l)
      if (c !== null) { price = c; console.log(`[parseItemShopColumn:${colLabel}]   precio en "${l}" → ${price}`); break }
    }
    if (!name || name.length < 3) { console.log(`[parseItemShopColumn:${colLabel}] ⚠️  nombre vacío vIdx:${vIdx}`); continue }
    console.log(`[parseItemShopColumn:${colLabel}] ✅ "${name}" vol:${volumeUSCU}µSCU price:${price}`)
    items.push({ name, volumeUSCU, price })
  }
  return items
}


function parseItemShopGrid(rawCol1, rawCol2) {
  console.log('\n[parseItemShopGrid] ── INICIO (2 columnas) ──')
  const col1Items = parseItemShopColumn(rawCol1, 'col1')
  const col2Items = parseItemShopColumn(rawCol2, 'col2')

  // Intercalar: col1[0], col2[0], col1[1], col2[1]...
  // (orden de aparición de izq a derecha, fila a fila)
  const items = []
  const maxLen = Math.max(col1Items.length, col2Items.length)
  for (let i = 0; i < maxLen; i++) {
    if (col1Items[i]) items.push(col1Items[i])
    if (col2Items[i]) items.push(col2Items[i])
  }

  console.log(`[parseItemShopGrid] Total combinado: ${items.length}`)
  return items
}

async function extractItemShop(imageBuffer, colorScheme) {
  console.log('\n==============================')
  console.log('[extractItemShop] INICIO colorScheme:', colorScheme)
  await ensureDebugDir()

  const { width, height } = await sharp(imageBuffer).metadata()

  const headerBuf = await cropItemShop_header(imageBuffer)
  await saveDebugImage(headerBuf, '20-item-header-raw.png')
  const hm = await sharp(headerBuf).metadata()

  // Preprocessing adaptado al esquema de color detectado:
  // light  (Casaba): fondo claro → texto oscuro → threshold alto
  // orange (Refinery/Weapons): fondo naranja/marrón → negate para texto claro
  // blue   (CenterMass/Armor/Pharmacy): fondo azul → negate
  // dark   (Teach's/CubbyBlast): fondo oscuro mixto → negate + sharpen agresivo

  const ocrHeaderPass = async (pipeline, suffix) => {
    const proc = await pipeline(sharp(headerBuf).resize({ width: hm.width * 3, kernel: 'lanczos3' })).toBuffer()
    await saveDebugImage(proc, `21-item-header-${suffix}.png`)
    const tmp = path.join(TMP_DIR, `ocr-itemhdr-${suffix}-${Date.now()}.png`)
    await fs.promises.writeFile(tmp, proc)
    const text = await runTesseract(tmp, 6)
    await fs.promises.unlink(tmp)
    return text
  }

  // Siempre 3 pasadas para máxima cobertura, sin importar el scheme
  const h1 = await ocrHeaderPass(s => s.grayscale().normalize().sharpen({ sigma: 1.5 }), 'norm')
  const h2 = await ocrHeaderPass(s => s.grayscale().negate().normalize().threshold(130).sharpen({ sigma: 1 }), 'neg')
  const h3 = await ocrHeaderPass(s => s.grayscale().normalize().threshold(colorScheme === 'light' ? 160 : 100), 'thr')

  const rawHeader = [h1, h2, h3].join('\n')
  console.log('[extractItemShop] rawHeader (combinado):\n' + rawHeader)
  const shopSubtype = detectItemShopSubtype(rawHeader)
  console.log(`[extractItemShop] shopSubtype: "${shopSubtype}"`)

  const destBuf = await cropItemShop_destination(imageBuffer, colorScheme)
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

  let destination = null
  for (const line of rawDestLines) {
    // Saltar labels del UI
    if (/^choose\s+(dest|sub|cat|subcat)/i.test(line)) continue
    if (/^(all\s+(cat|opt|sub)|search|item\s*name)/i.test(line)) continue
    if (/^[^A-Za-z0-9]+$/.test(line)) continue

    // La línea puede contener "AREA18   ALL OPTIONS" juntos — quedarse con la parte izquierda
    // que es el valor del dropdown antes de cualquier label de sub-destination
    const cleaned = line
      .replace(/choose\s+(sub.?dest|dest|category|subcat).*/i, '')
      .replace(/\ball\s+options?\b.*/i, '')
      .replace(/\ball\s+opt\b.*/i, '')
      .replace(/\ball\s+cat.*/i, '')
      .replace(/[^A-Za-z0-9\s\-]/g, ' ')
      .replace(/\s+/g, ' ').trim()

    if (cleaned.length >= 3 && !/^(sell|buy|wallet|blue\s+inf)/i.test(cleaned)) {
      destination = cleaned
      break
    }
  }
  console.log(`[extractItemShop] destination: "${destination}"`)

  const mode = await detectItemShopMode(imageBuffer, width, height)
  console.log(`[extractItemShop] mode: "${mode}"`)

  // ── Grid: dos columnas independientes para evitar mezcla de texto ──
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

  const col1Buf = await cropItemShop_col1(imageBuffer)
  const col2Buf = await cropItemShop_col2(imageBuffer)
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