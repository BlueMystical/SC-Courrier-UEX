// src/main/helpers/ocrHelper.js
// OCR pipeline: sharp preprocessing → Tesseract.js text extraction.
// Runs in the main process (Node.js) to avoid bundling issues with Tesseract workers.

const path = require('path')

// Lazy-load heavy deps so startup time is unaffected
let sharp     = null
let Tesseract = null

function loadDeps() {
  if (!sharp)     sharp     = require('sharp')
  if (!Tesseract) Tesseract = require('tesseract.js')
}

/**
 * Preprocess a raw image buffer with sharp to maximize OCR accuracy.
 *
 * Strategy:
 * 1. Crop to the RIGHT 35% of the image — this is always where the SC
 *    terminal panel lives (SHOP INVENTORY / item grid). The left side
 *    is the 3D game scene which produces garbage OCR output.
 * 2. Scale up 2x so small text is larger for Tesseract.
 * 3. Greyscale + normalize contrast.
 * 4. Threshold to pure black/white — eliminates texture noise from
 *    the game's UI background gradients.
 *
 * @param {Buffer} inputBuffer - Raw image bytes (jpg or png)
 * @returns {Promise<Buffer>} Processed PNG buffer
 */
async function preprocessImage(inputBuffer) {
  loadDeps()

  // Get image dimensions first
  const meta = await sharp(inputBuffer).metadata()
  const { width, height } = meta

  // Crop to right 37% of the image (the terminal panel)
  // SC terminals always render their data panel on the right side
  const cropLeft  = Math.floor(width * 0.63)
  const cropWidth = width - cropLeft

  return sharp(inputBuffer)
    .extract({ left: cropLeft, top: 0, width: cropWidth, height })
    .resize({ width: cropWidth * 2 })     // upscale 2x for better OCR on small text
    .greyscale()
    .normalize()                           // stretch histogram → max contrast
    .threshold(140)                        // binarize: kills UI texture noise
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer()
}

/**
 * Run Tesseract OCR on a preprocessed image buffer.
 *
 * @param {Buffer} imageBuffer - Preprocessed PNG buffer
 * @returns {Promise<string>} Raw extracted text
 */
async function runTesseract(imageBuffer) {
  loadDeps()

  const path = require('path')
  const fs   = require('fs')

  // Tesseract.js v7 looks for lang files in <package>/lang-data/
  // Files needed: eng.traineddata AND eng.traineddata.gz (both must exist)
  // Setup: copy tessdata/eng.traineddata to node_modules/tesseract.js/lang-data/
  //        and also rename/copy as eng.traineddata.gz in the same folder.
  const tesseractPkg = path.dirname(require.resolve('tesseract.js/package.json'))
  const langDataDir  = path.join(tesseractPkg, 'lang-data')
  const gzPath       = path.join(langDataDir, 'eng.traineddata.gz')
  const plainPath    = path.join(langDataDir, 'eng.traineddata')

  if (!fs.existsSync(gzPath) || !fs.existsSync(plainPath)) {
    throw new Error(
      'Tesseract language data not found.\n' +
      'Please ensure both files exist in node_modules/tesseract.js/lang-data/:\n' +
      '  - eng.traineddata\n' +
      '  - eng.traineddata.gz\n' +
      'Copy them from the tessdata/ folder at the project root.'
    )
  }

  const workerPath = path.join(tesseractPkg, 'src', 'worker-script', 'node', 'index.js')

  const worker = await Tesseract.createWorker('eng', 1, {
    logger:      () => {},
    workerPath,
    langPath:    langDataDir,
    cacheMethod: 'none',
  })

  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: '',
  })

  const { data: { text } } = await worker.recognize(imageBuffer)
  await worker.terminate()
  return text
}

/**
 * Crop the top-left corner of the image to extract the station name.
 * In all SC terminals, the station name appears in a box in the top-left
 * of the left panel (YOUR INVENTORIES / CHOOSE DESTINATION area).
 *
 * @param {Buffer} inputBuffer - Raw image bytes
 * @returns {Promise<Buffer>} Processed PNG of just the station name area
 */
async function cropStationName(inputBuffer) {
  loadDeps()
  const meta = await sharp(inputBuffer).metadata()
  const { width, height } = meta

  // Top-left 40% width, top 25% height — covers the station name box
  const cropWidth  = Math.floor(width * 0.40)
  const cropHeight = Math.floor(height * 0.25)

  return sharp(inputBuffer)
    .extract({ left: 0, top: 0, width: cropWidth, height: cropHeight })
    .resize({ width: cropWidth * 2 })
    .greyscale()
    .normalize()
    .threshold(130)
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer()
}

/**
 * Full pipeline: raw image buffer → extracted text + station name.
 *
 * @param {Buffer} rawBuffer - Raw jpg/png bytes from disk
 * @returns {Promise<{ text: string, stationName: string|null, processedImageBase64: string }>}
 */
async function extractText(rawBuffer) {
  loadDeps()

  // Run both crops in parallel
  const [processedBuffer, stationBuffer] = await Promise.all([
    preprocessImage(rawBuffer),
    cropStationName(rawBuffer),
  ])

  // Run OCR on both crops in parallel
  const [text, stationRaw] = await Promise.all([
    runTesseract(processedBuffer),
    runTesseract(stationBuffer),
  ])

  // Parse the station name from the top-left OCR text
  const stationName = parseStationName(stationRaw)

  console.log('[OCR] Station name raw:', stationRaw.substring(0, 150))
  console.log('[OCR] Station name parsed:', stationName)

  // Return the processed right-panel image so the UI can show what Tesseract saw
  const processedImageBase64 = processedBuffer.toString('base64')

  return { text: text.trim(), stationName, processedImageBase64 }
}

/**
 * Extract the station/location name from the top-left OCR text.
 * Looks for lines that match known SC location name patterns.
 *
 * Examples:
 *   "HUR-L2 FAITHFUL DREAM STATION"
 *   "CRU-L4 SHALLOW FIELDS STATION"
 *   "RUIN STATION"
 *   "AREA18"
 *   "ORISON"
 */
function parseStationName(rawText) {
  if (!rawText) return null

  const lines = rawText
    .split('\n')
    .map(l => l.trim().toUpperCase())
    .filter(l => l.length > 3)

  // Priority 1: lines matching SC location code pattern (e.g. HUR-L2, CRU-L4, ARC-L1)
  const codePattern = /^[A-Z]{2,4}-[A-Z]?\d+\s+[A-Z\s]{4,}/
  for (const line of lines) {
    if (codePattern.test(line)) return line.trim()
  }

  // Priority 2: lines ending with STATION, OUTPOST, TERMINAL, DEPOT
  const suffixes = ['STATION', 'OUTPOST', 'TERMINAL', 'DEPOT', 'PLATFORM', 'SETTLEMENT', 'COLONY']
  for (const line of lines) {
    if (suffixes.some(s => line.endsWith(s)) && line.length > 6) return line.trim()
  }

  // Priority 3: known short names
  const knownNames = ['AREA18', 'ORISON', 'LORVILLE', 'MICROTECH', 'NEW BABBAGE', 'RUIN STATION', 'JUMPTOWN']
  for (const line of lines) {
    if (knownNames.some(n => line.includes(n))) return line.trim()
  }

  // Priority 4: longest reasonable line (likely to be the station name)
  const candidates = lines.filter(l => l.length >= 6 && l.length <= 50 && /^[A-Z0-9\s\-']+$/.test(l))
  if (candidates.length > 0) {
    return candidates.sort((a, b) => b.length - a.length)[0].trim()
  }

  return null
}

/**
 * Detect the terminal type from the raw OCR text.
 * Returns: 'commodity' | 'item' | 'vehicle_buy' | 'vehicle_rent' | 'unknown'
 */
function detectTerminalType(text) {
  const upper = text.toUpperCase()

  console.log('[OCR] detectTerminalType scanning text length:', text.length)

  // Commodities: header says COMMODITIES, uses SCU units
  if (upper.includes('COMMODIT')) return 'commodity'

  // Items: shop name OR category shown OR QUICK BUY button
  const itemSignals = [
    'QUICK BUY', 'ITEM NAME', 'PLATINUM BAY', "DUMPER'S DEPOT", 'DUMPERS DEPOT',
    'ARMOR', 'SYSTEMS', 'WEAPONS', 'VHCL', 'SUBCATEGOR', 'CHOOSE CATEGORY',
    'BLUE INFINITY',
  ]
  if (itemSignals.some(s => upper.includes(s))) return 'item'

  // Vehicle: rent or buy terminals
  if (upper.includes('VEHICLE') || upper.includes('RENT')) {
    return upper.includes('RENT') ? 'vehicle_rent' : 'vehicle_buy'
  }

  // Fallback: if we see SCU it's probably commodity
  if (upper.includes('SCU')) return 'commodity'

  // If we see price patterns (¤ + numbers) it's probably items
  if (/[¤¤]\s*[\d,]+/.test(text)) return 'item'

  return 'unknown'
}

/**
 * Parse commodity lines from OCR text.
 * Expected line format (from the SHOP INVENTORY panel):
 *   "MEDICAL SUPPLIES   268 SCU"
 *   "LOW INVENTORY  ¤5.4140003K/SCU"   ← price line
 *
 * Returns array of:
 * { name, price, scu, status, operation }
 */
function parseCommodityLines(text) {
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean)
  const results = []

  // Status keywords → numeric codes expected by UEX API
  const STATUS_MAP = {
    'OUT OF STOCK':       1,
    'VERY LOW':           2,
    'LOW INVENTORY':      3,
    'MEDIUM':             4,
    'HIGH INVENTORY':     5,
    'VERY HIGH':          6,
    'MAX INVENTORY':      7,
    'MAXIMUM':            7,
  }

  // Price pattern: ¤ or a or similar prefix, then digits with optional K/M suffix
  // e.g. "¤5.4140003K/SCU"  "¤1.92200005K/SCU"  "¤151.6660003K/SCU"
  const pricePattern = /[¤a]?\s*([\d,]+(?:\.\d+)?)\s*([KMB])?\s*\/\s*SCU/i

  // SCU pattern: digits followed by SCU
  const scuPattern = /(\d[\d,]*)\s+SCU\b/i

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Skip header lines, tab labels, UI chrome
    if (/^(BUY|SELL|LOCAL MARKET VALUE|SHOP INVENTORY|YOUR INVENTORIES|IN DEMAND|NO DEMAND|CANNOT SELL|SELLABLE CARGO|AVAILABLE CARGO SIZE|SELECT SUB-CATEGORY)/i.test(line)) {
      i++; continue
    }

    // Try to detect a commodity name + SCU on the same line
    // e.g. "MEDICAL SUPPLIES   268 SCU"
    const scuMatch = line.match(scuPattern)
    if (scuMatch) {
      const name = line.replace(scuMatch[0], '').trim()
        .replace(/[^a-zA-Z0-9\s\-']/g, '').trim()

      if (name.length < 2) { i++; continue }

      const scu    = parseInt(scuMatch[1].replace(',', ''), 10)
      let price    = null
      let status   = null
      let operation = 'sell' // default assumption; parser will refine

      // Look at next 1-2 lines for status and price
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const next = lines[i + j].toUpperCase()

        // Status detection
        for (const [key, val] of Object.entries(STATUS_MAP)) {
          if (next.includes(key)) { status = val; break }
        }

        // Price detection
        const pm = lines[i + j].match(pricePattern)
        if (pm) {
          let raw = parseFloat(pm[1].replace(',', ''))
          const suffix = (pm[2] || '').toUpperCase()
          if (suffix === 'K') raw *= 1_000
          if (suffix === 'M') raw *= 1_000_000
          if (suffix === 'B') raw *= 1_000_000_000
          price = Math.round(raw)
        }
      }

      // Determine buy/sell from active tab context or SCU=0 heuristic
      // SCU=0 with price usually means "selling TO player" (buy for player = terminal sells)
      // We'll mark ambiguous ones and let the user confirm in the UI
      const isMissing = scu === 0 && status === 1

      results.push({
        rawName:   name,
        name:      name,       // will be replaced by fuzzy match
        id:        null,       // filled by fuzzy match in renderer
        price,
        scu,
        status,
        operation, // 'buy' | 'sell' — UI lets user confirm
        is_missing: isMissing ? 1 : 0,
        _confidence: 'medium',
      })

      i++; continue
    }

    i++
  }

  return results
}

/**
 * Parse item lines from OCR text.
 * Expected: item name on one line, price (¤ + number) on next or same line.
 * e.g.
 *   "FOXFIRE"
 *   "Volume: 84000 µSCU"
 *   "¤ 44,885"
 *
 * Returns array of: { name, price, operation }
 */
function parseItemLines(text) {
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean)
  const results = []

  // Price: ¤ or a followed by optional space and digits (possibly with commas)
  const pricePattern = /^[¤a]\s*([\d,]+(?:\.\d+)?)$/

  // Skip lines that are clearly UI chrome
  const UI_NOISE = /^(BUY|SELL|QUICK BUY|CHOOSE CATEGORY|CHOOSE SUBCATEGORY|CHOOSE DESTINATION|CHOOSE SUB-DESTINATION|SEARCH|ITEM NAME|ALL CATEGORIES|ALL OPTIONS|VOLUME:|FIRST|PREV|NEXT|LAST|\d+\/\d+)/i

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (UI_NOISE.test(line) || line.length < 2) { i++; continue }

    // Check if this looks like an item name (no digits, reasonable length)
    const looksLikeName = /^[A-Z0-9][A-Za-z0-9\s\-'().]+$/.test(line) &&
                          line.length >= 3 &&
                          line.length <= 60 &&
                          !/µSCU|SCU|aUEC|UEC/i.test(line)

    if (looksLikeName) {
      // Look forward for price
      let price = null
      for (let j = 1; j <= 4 && i + j < lines.length; j++) {
        const next = lines[i + j]
        const pm   = next.match(pricePattern)
        if (pm) {
          price = parseInt(pm[1].replace(/,/g, ''), 10)
          break
        }
      }

      if (price !== null) {
        results.push({
          rawName:     line,
          name:        line,
          id:          null,
          id_category: null,
          price,
          operation:   'buy',    // items terminals are mostly buy; UI lets user change
          _confidence: 'medium',
        })
      }
    }

    i++
  }

  return results
}

module.exports = {
  extractText,
  detectTerminalType,
  parseCommodityLines,
  parseItemLines,
}
