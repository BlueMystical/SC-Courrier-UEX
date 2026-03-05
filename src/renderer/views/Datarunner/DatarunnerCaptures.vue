<!-- src/renderer/views/Datarunner/DatarunnerCaptures.vue -->
<template>
  <div class="dr-container">

    <!-- ZONA 1: siempre visible arriba -->
    <div class="watcher-bar">
      <InputGroup class="custom-input-group">
        <InputGroupAddon class="watcher-addon"><span class="status-dot"></span></InputGroupAddon>
        <InputText :value="watcherStatusText" readonly class="watcher-text" />
        <Button icon="pi pi-send" label="Submit All" class="watcher-btn-submit"
          :disabled="!captures.some(c => c.status === 'ready')"
          @click="submitAll" />
        <Button icon="pi pi-plus-circle" label="Manual Entry" @click="addManualCapture" class="watcher-btn-manual" />
        <Button icon="pi pi-folder-open" label="Screenshots" class="watcher-btn" @click="openScreenshotsFolder" />
      </InputGroup>
    </div>

    <!-- ZONA 2: scrolleable -->
    <div class="captures-scroll">

      <div v-for="(capture, cIndex) in captures" :key="capture.id" class="capture-block"
        :class="{ 'new-capture-anim': capture.isNew }">

        <div class="capture-header">
          <div style="min-width: 220px;">
            <span class="label">Terminal:</span>
            <Select v-model="capture.terminalId" :options="terminalOptions" filter autoFilterFocus optionLabel="label"
              optionValue="value" placeholder="Select" size="small" class="w-full" :class="getHeaderClass(capture.terminalId)" />
          </div>
          <div style="min-width: 150px;">
            <span class="label">Type:</span>
            <Select v-model="capture.type" :options="typeOptions" optionLabel="label" optionValue="value" size="small"
              class="w-full" @change="handleTypeChange(capture)" :class="getHeaderClass(capture.type)" />
          </div>
          <div style="min-width: 120px;">
            <span class="label">Mode:</span>
            <Select v-model="capture.mode" :options="modeOptions" optionLabel="label" optionValue="value" size="small"
              class="w-full" :class="getHeaderClass(capture.mode)"/>
          </div>
          <div class="status-badge" :class="`status-${capture.status}`">
            <i v-if="capture.status === 'processing'" class="pi pi-spin pi-spinner" style="font-size: 11px;" />
            {{ capture.status }}
          </div>
          <Button icon="pi pi-trash" severity="danger" text rounded @click="removeCaptureBlock(cIndex)" />
        </div>

        <div class="capture-body">

          <div class="preview-area" @dragover="onDragOver" @drop="onDropImage(capture, $event)">
            <img v-if="capture.previewBase64" :src="capture.previewBase64"
              title="Click to enlarge · Double-click to replace" class="preview-img"
              @click="openLightbox(capture.previewBase64)" @dblclick.prevent="pickImageForCapture(capture)" />
            <div v-else class="no-image-placeholder" title="Click to load an image"
              @click="pickImageForCapture(capture)">
              <i class="pi pi-image"></i>
              <span>Click or drop image</span>
            </div>
          </div>

          <div class="items-area">

            <div v-if="capture.status === 'processing'" class="ocr-overlay">
              <i class="pi pi-spin pi-spinner" />
              <span>Processing OCR...</span>
            </div>
            <div v-else-if="capture.status === 'error'" class="ocr-error">
              <i class="pi pi-exclamation-triangle" />
              <span>OCR failed — fill manually</span>
            </div>

            <div v-for="(item, iIndex) in capture.items" :key="iIndex" class="item-row">

              <template v-if="capture.type === 'item'">
                <FloatLabel class="item-field">
                  <!-- id_category comes directly from the resolved item object -->
                  <Select :id="'cat-' + cIndex + '-' + iIndex" v-model="item.id_category" :options="itemCategories"
                    optionLabel="name" optionValue="id" filter autoFilterFocus size="small"
                    @change="fetchItemsByCategory(item.id_category)" />
                  <label :for="'cat-' + cIndex + '-' + iIndex">Category</label>
                </FloatLabel>
              </template>

              <FloatLabel class="item-field item-field--name">
                <!-- item.id is the catalogue id — used for dropdown binding, price hints, and submit -->
                <Select :id="'item-' + cIndex + '-' + iIndex" v-model="item.id"
                  :options="getOptionsForCapture(capture, item)" optionLabel="name" optionValue="id" filter autoFilterFocus size="small"
                  @change="fetchPriceHint(capture.type, item.id)" :class="getHeaderClass(item.id)" />
                <label :for="'item-' + cIndex + '-' + iIndex">Item Name</label>
              </FloatLabel>

              <!-- COMMODITY -->
              <template v-if="capture.type === 'commodity'">
                <FloatLabel class="item-field item-field--status">
                  <Select :id="'stock-' + cIndex + '-' + iIndex" v-model="item.stockStatus"
                    :options="getStockOptions(capture.mode)" optionLabel="name_short" optionValue="code" size="small"
                    @change="onStockChange(capture, item)" :class="getStatusClass(capture, item)" />
                  <label :for="'stock-' + cIndex + '-' + iIndex">Stock Status</label>
                </FloatLabel>
                <FloatLabel class="item-field item-field--small">
                  <InputNumber v-model="item.quantity" :min="0" size="small" suffix=" SCU" fluid
                    :class="getQuantityClass(capture, item)" />
                  <label>In Stock</label>
                </FloatLabel>
                <FloatLabel class="item-field item-field--small">
                  <InputNumber v-model="item.price" :min="0" size="small" fluid v-tooltip.top="{
                    value: buildTooltipText(capture.type, capture.mode, getPriceHint(capture.type, item.id)),
                    showDelay: 200,
                    pt: { text: { style: 'white-space:pre-line;min-width:100px;font-size:12px;line-height:1.8;background:#111821;border:1px solid #1e2a35;color:#e6e6e6;padding:8px 12px;' } }
                  }" @focus="fetchPriceHint(capture.type, item.id)" :class="getPriceClass(capture, item)" />
                  <label>Price/scu</label>
                </FloatLabel>
              </template>

              <!-- ITEM -->
              <template v-if="capture.type === 'item'">
                <FloatLabel class="item-field item-field--small">
                  <InputText v-model.number="item.price" size="small"
                    v-tooltip.top="{
                      value: buildTooltipText(capture.type, capture.mode, getPriceHint(capture.type, item.id)),
                      showDelay: 200,
                      pt: { text: { style: 'white-space:pre-line;min-width:100px;font-size:12px;line-height:1.8;background:#111821;border:1px solid #1e2a35;color:#e6e6e6;padding:8px 12px;' } }
                    }"
                    @focus="fetchPriceHint(capture.type, item.id)"
                    :class="getPriceClass(capture, item)" />
                  <label>Price/item</label>
                </FloatLabel>
              </template>

              <!-- VEHICLE -->
              <template v-if="capture.type?.startsWith('vehicle')">
                <FloatLabel class="item-field item-field--small">
                  <InputNumber v-model="item.price" :min="0" size="small" fluid
                    v-tooltip.top="{
                      value: buildTooltipText(capture.type, capture.mode, getPriceHint(capture.type, item.id)),
                      showDelay: 200,
                      pt: { text: { style: 'white-space:pre-line;min-width:100px;font-size:12px;line-height:1.8;background:#111821;border:1px solid #1e2a35;color:#e6e6e6;padding:8px 12px;' } }
                    }"
                    @focus="fetchPriceHint(capture.type, item.id)"
                    :class="getPriceClass(capture, item)" />
                  <label>Price</label>
                </FloatLabel>
              </template>

              <Button icon="pi pi-times" severity="danger" text class="item-delete-btn"
                @click="removeItem(capture, iIndex)" />

            </div>

            <div class="add-item-container">
              <Button label="Add Item" icon="pi pi-plus" size="small" text @click="addNewItem(capture)"
                style="color: #00ffcc" />
            </div>
          </div>
        </div>
      </div>

    </div><!-- fin .captures-scroll -->

    <!-- LIGHTBOX -->
    <Teleport to="body">
      <div v-if="lightboxSrc" class="lightbox-overlay" @click="closeLightbox">
        <div class="lightbox-stage" :style="lightboxCursor" @click.stop @wheel.prevent="onWheelZoom"
            @mousedown="startPan" @mousemove="onPan" @mouseup="endPan" @mouseleave="endPan">
          <img :src="lightboxSrc" class="lightbox-img" :style="lightboxStyle" draggable="false" />
        </div>
        <button class="lightbox-close" @click="closeLightbox">✕</button>
      </div>
    </Teleport>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Select from 'primevue/select'
import InputGroup from 'primevue/inputgroup'
import InputGroupAddon from 'primevue/inputgroupaddon'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import FloatLabel from 'primevue/floatlabel'
import Tooltip from 'primevue/tooltip'

const vTooltip = Tooltip

// ── State ─────────────────────────────────────────────────────────────────────
const terminals        = ref([])
const commoditiesList  = ref([])
const vehiclesList     = ref([])
const itemCategories   = ref([])
const itemsByCategory  = ref({})
const captures         = ref([])
const stockStatuses    = ref({ buy: [], sell: [] })
const watcherStatusText = ref('Watcher Active, waiting for screenshots...')
const priceCache       = ref({})

const typeOptions = [
  { label: 'Commodities', value: 'commodity' },
  { label: 'Items',       value: 'item' },
  { label: 'Vehicles',    value: 'vehicle' }
]
const modeOptions = [
  { label: 'Buy',  value: 'buy' },
  { label: 'Sell', value: 'sell' },
  { label: 'Rent', value: 'rent' }
]

const terminalOptions = computed(() =>
  terminals.value.map(t => ({ label: t.name, value: t.id }))
)

// ── URLs ──────────────────────────────────────────────────────────────────────
const SCREENSHOTS_FOLDER     = 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\screenshots'
const BASE                   = 'https://api.uexcorp.uk/2.0'
const API_COMMODITIES        = `${BASE}/commodities`
const API_COMMODITIES_PRICES = `${BASE}/commodities_prices?id_commodity=`
const API_STOCK_STATUSES     = `${BASE}/commodities_status`
const API_VEHICLES           = `${BASE}/vehicles`
const API_VEHICLES_PRICES    = `${BASE}/vehicles_purchases_prices?id_vehicle=`
const API_ITEMS              = `${BASE}/items?id_category=`
const API_ITEMS_PRICES       = `${BASE}/items_prices?id_item=`
const API_ITEM_CATEGORIES    = `${BASE}/categories?type=item`

// ── API Fetchers ──────────────────────────────────────────────────────────────

const fetchCommodities = async () => {
  try {
    const res = await fetch(API_COMMODITIES)
    const json = await res.json()
    if (json.status === 'ok') {
      commoditiesList.value = json.data
      window.api.invoke('uex:cacheCommodities', json).catch(() => {})
    }
  } catch (e) { console.error('Error Commodities', e) }
}

const fetchVehicles = async () => {
  try {
    const res = await fetch(API_VEHICLES)
    const json = await res.json()
    if (json.status === 'ok') vehiclesList.value = json.data
  } catch (e) { console.error('Error Vehicles', e) }
}

const fetchCategories = async () => {
  try {
    const res = await fetch(API_ITEM_CATEGORIES)
    const json = await res.json()
    if (json.status === 'ok') itemCategories.value = json.data
  } catch (e) { console.error('Error Categories', e) }
}

const fetchStockStatuses = async () => {
  try {
    const res = await fetch(API_STOCK_STATUSES)
    const json = await res.json()
    if (json.status === 'ok') stockStatuses.value = json.data
  } catch (e) { console.error('Error stock statuses', e) }
}

const fetchItemsByCategory = async (categoryId) => {
  if (!categoryId || itemsByCategory.value[categoryId]) return
  try {
    const res = await fetch(`${API_ITEMS}${categoryId}`)
    const json = await res.json()
    if (json.status === 'ok') itemsByCategory.value[categoryId] = json.data
  } catch (e) { console.error('Error items by category', categoryId, e) }
}

// ── Price Hints ───────────────────────────────────────────────────────────────

async function fetchPriceHint(type, id) {
  if (!id || !type) return
  const key = `${type}-${id}`
  if (priceCache.value[key] !== undefined) return
  const urls = {
    commodity: `${API_COMMODITIES_PRICES}${id}`,
    item:      `${API_ITEMS_PRICES}${id}`,
    vehicle:   `${API_VEHICLES_PRICES}${id}`
  }
  const url = urls[type]
  if (!url) return
  priceCache.value[key] = null
  try {
    const res  = await fetch(url)
    const json = await res.json()
    if (json.status !== 'ok' || !json.data?.length) return
    const data = json.data
    const avg  = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
    if (type === 'commodity') {
      const buy  = data.map(r => r.price_buy_avg).filter(p => p > 0)
      const sell = data.map(r => r.price_sell_avg).filter(p => p > 0)
      priceCache.value[key] = {
        buy: avg(buy), sell: avg(sell),
        buyMin: buy.length  ? Math.min(...buy)  : null, buyMax: buy.length  ? Math.max(...buy)  : null,
        sellMin: sell.length ? Math.min(...sell) : null, sellMax: sell.length ? Math.max(...sell) : null,
        sources: data.length
      }
    }
    if (type === 'item') {
      const buy = data.map(r => r.price_buy_avg).filter(p => p > 0)
      priceCache.value[key] = { buy: avg(buy), buyMin: buy.length ? Math.min(...buy) : null, buyMax: buy.length ? Math.max(...buy) : null, sources: data.length }
    }
    if (type === 'vehicle') {
      const buy = data.map(r => r.price_buy_avg).filter(p => p > 0)
      priceCache.value[key] = { buy: avg(buy), buyMin: buy.length ? Math.min(...buy) : null, buyMax: buy.length ? Math.max(...buy) : null, sources: data.length }
    }
  } catch (e) { console.error(`[priceHint] Error ${key}:`, e) }
}

function fmtPrice(n) {
  if (n == null) return '—'
  return n.toLocaleString('en-US') + ' aUEC'
}

function getPriceHint(type, id) {
  if (!id || !type) return null
  return priceCache.value[`${type}-${id}`] ?? null
}

function getAverageForItem(capture, item) {
  if (!item?.id) return null
  const hint = getPriceHint(capture.type, item.id)
  if (!hint) return null
  if (capture.type === 'commodity') return capture.mode === 'sell' ? hint.sell ?? null : hint.buy ?? null
  return hint.buy ?? null
}

function buildTooltipText(type, mode, hint) {
  if (!hint) return '📊 No market data available'
  const lines = []
  if (type === 'commodity') {
    if (mode === 'buy'  || !mode) lines.push(`Buy avg   : ${fmtPrice(hint.buy)}`)
    if (mode === 'sell' || !mode) lines.push(`Sell avg  : ${fmtPrice(hint.sell)}`)
  }
  if (type === 'item' || type === 'vehicle') lines.push(`Buy avg   : ${fmtPrice(hint.buy)}`)
  return lines.join('\n')
}

// ── Alert classes ─────────────────────────────────────────────────────────────

function getHeaderClass(value) {
  return (value === null || value === undefined || value === '') ? 'price-missing' : null
}

function getPriceState(capture, item) {
  if (item.price === null || item.price === undefined || item.price === '') return 'missing'
  const price = Number(item.price)
  const avg   = getAverageForItem(capture, item)
  if (!avg || avg <= 0 || isNaN(price)) return null
  const diff = Math.abs(price - avg) / avg
  if (diff >= 1)   return 'extreme'
  if (diff >= 0.5) return 'warning'
  return null
}

function getPriceClass(capture, item)    { const s = getPriceState(capture, item);    return s ? `price-${s}` : null }

function getQuantityClass(capture, item) {
  const qty = item.quantity
  if (qty === null || qty === undefined) return 'price-missing'
  if (qty < 0) return 'price-extreme'
  return null
}

function getStatusClass(capture, item) {
  const code = item.stockStatus, qty = item.quantity
  if (code === null || code === undefined || code === '') return 'price-missing'
  if (code === 1 && qty > 0)   return 'price-extreme'
  if (code !== 1 && qty === 0) return 'price-warning'
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const getStockOptions = (mode) => stockStatuses.value[mode] || []

function onStockChange(capture, item) {
  const selected = getStockOptions(capture.mode).find(o => o.code === item.stockStatus)
  if (!selected) return
  if (selected.percentage_start === 0) item.quantity = 0
  else if (item.quantity === 0) item.quantity = null
}

const getOptionsForCapture = (capture, item) => {
  if (!item) return []
  if (capture.type === 'commodity') return commoditiesList.value
  if (capture.type === 'vehicle')   return vehiclesList.value
  // item.id_category comes directly from the resolved catalogue object
  if (capture.type === 'item')      return itemsByCategory.value[item.id_category] || []
  return []
}

const handleTypeChange = (capture) => {
  if (capture.type === 'commodity' && !commoditiesList.value.length) fetchCommodities()
  if (capture.type === 'vehicle'   && !vehiclesList.value.length)    fetchVehicles()
}

function updateCapture(id, fields) {
  const index = captures.value.findIndex(c => c.id === id)
  if (index === -1) return
  Object.assign(captures.value[index], fields)
}

function newItemTemplate() {
  return {
    id:          null,   // catalogue item id — drives dropdown, price hints, submit
    id_category: null,   // for category dropdown
    name:        '',     // display name
    quantity:    null,
    price:       null,
    stockStatus: null,
    containerSizes: '',
    size:        ''
  }
}

function addNewItem(capture) { capture.items.push(newItemTemplate()) }

function addManualCapture() {
  const newCap = {
    id: crypto.randomUUID(), type: 'commodity', mode: 'buy',
    terminalId: null, items: [newItemTemplate()],
    status: 'ready', isNew: true, previewBase64: null, fullBase64: null, filename: null
  }
  captures.value.unshift(newCap)
  handleTypeChange(newCap)
  setTimeout(() => updateCapture(newCap.id, { isNew: false }), 2000)
}

const openScreenshotsFolder = () => window.api.System.openPathInExplorer(SCREENSHOTS_FOLDER)
function removeCaptureBlock(index) { captures.value.splice(index, 1) }
function removeItem(cap, idx)      { cap.items.splice(idx, 1) }

// ── OCR item mapper ───────────────────────────────────────────────────────────
//
// For 'item' type:
//   ocrService now returns the FULL catalogue object per item (from uexCache),
//   with .price and .ocr_name added, and .matchSimilarity for debug.
//   Fields available: id, id_category, name, section, category, slug, size, etc.
//   We use them directly — no lookup needed.
//
// For 'commodity' / 'vehicle':
//   ocrService returns { name, price, ... } — we look up the id from local lists.
//
function mapOcrItems(ocrItems, type) {
  return (ocrItems ?? []).map(ocrItem => {

    if (type === 'item') {
      // ocrItem IS the full catalogue object — id, name, id_category, etc. already set
      const categoryId = ocrItem.id_category ?? null
      // Pre-load this category's item list so the dropdown is populated immediately
      if (categoryId && !itemsByCategory.value[categoryId]) {
        fetchItemsByCategory(categoryId)
      }
      // Pre-fetch price hint
      if (ocrItem.id) fetchPriceHint('item', ocrItem.id)

      return {
        // Spread full API object (id, id_category, name, slug, section, category, size, etc.)
        ...ocrItem,
        // Ensure these UI-facing fields are set
        id_category:    categoryId,
        stockStatus:    null,
        quantity:       null,
        containerSizes: '',
        // ocr_name kept for debug, price already set from ocrService
      }
    }

    if (type === 'commodity') {
      const id = ocrItem.id
        ?? commoditiesList.value.find(c => c.name?.toLowerCase() === ocrItem.name?.toLowerCase())?.id
        ?? null
      if (id) fetchPriceHint('commodity', id)
      return {
        id,
        id_category:    null,
        name:           ocrItem.name ?? '',
        quantity:       ocrItem.quantity   ?? null,
        price:          ocrItem.price      ?? null,
        stockStatus:    ocrItem.stockStatus?.code ?? null,
        containerSizes: ocrItem.containerSizes ?? '',
        size:           ocrItem.size ?? ''
      }
    }

    if (type === 'vehicle') {
      const id = ocrItem.id
        ?? vehiclesList.value.find(v => v.name?.toLowerCase() === ocrItem.name?.toLowerCase())?.id
        ?? null
      if (id) fetchPriceHint('vehicle', id)
      return {
        id,
        id_category:    null,
        name:           ocrItem.name ?? '',
        quantity:       null,
        price:          ocrItem.price ?? null,
        stockStatus:    null,
        containerSizes: '',
        size:           ''
      }
    }

    // Fallback
    return { ...ocrItem, id: null, id_category: null }
  })
}

async function processOCROnCapture(id, base64, mimeType) {
  updateCapture(id, { status: 'processing' })
  try {
    const result = await window.api.OCR.process({ base64, mimeType })
    console.log('[OCR] Result:', result)
    if (!result?.success) { updateCapture(id, { status: 'error' }); return }

    const type = result.type ?? null
    const mode = result.mode ?? null
    if (type === 'commodity' && !commoditiesList.value.length) await fetchCommodities()
    if (type === 'vehicle'   && !vehiclesList.value.length)    await fetchVehicles()

    const mappedItems = mapOcrItems(result.items, type)
    updateCapture(id, { terminalId: result.terminal?.id ?? null, type, mode, items: mappedItems, status: 'ready' })
  } catch (err) {
    console.error('[OCR] ❌', err)
    updateCapture(id, { status: 'error' })
  }
}

function onDropImage(capture, event) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    const dataUrl  = e.target.result
    const base64   = dataUrl.split(',')[1]
    const mimeType = file.type
    updateCapture(capture.id, { previewBase64: dataUrl, fullBase64: base64, filename: file.name, status: 'ready' })
    await processOCROnCapture(capture.id, base64, mimeType)
  }
  reader.readAsDataURL(file)
}

function onDragOver(event) { event.preventDefault() }

async function processScreenshot(data) {
  const id = crypto.randomUUID()
  captures.value.unshift({
    id, filename: data.filename,
    previewBase64: `data:${data.mimeType};base64,${data.base64}`,
    fullBase64: data.base64,
    terminalId: null, type: null, mode: null,
    items: [], status: 'processing', isNew: true
  })
  setTimeout(() => updateCapture(id, { isNew: false }), 2000)
  await processOCROnCapture(id, data.base64, data.mimeType)
}

// ── Submit ────────────────────────────────────────────────────────────────────

function buildPrices(capture) {
  if (!capture.items?.length) return []
  if (capture.type === 'commodity') {
    return capture.items.map(item => ({
      id_commodity: item.id,
      price_sell:   item.price,
      scu_sell:     item.quantity,
      scu_status:   item.stockStatus
    }))
  }
  if (capture.type === 'item') {
    return capture.items.map(item => ({
      id_item:   item.id,
      price_buy: item.price
    }))
  }
  if (capture.type === 'vehicle') {
    return capture.items.map(item => ({
      id_vehicle: item.id,
      price_rent: item.price
    }))
  }
  return []
}

async function submitAll() {
  for (const capture of captures.value) {
    if (capture.status !== 'ready') continue
    try {
      const payload = {
        id_terminal:   capture.terminalId,
        type:          capture.type,
        mode:          capture.mode,
        is_production: 0,
        prices:        buildPrices(capture),
        screenshot:    capture.fullBase64
      }
      const result = await window.api.invoke('uex:submitData', payload)
      updateCapture(capture.id, { status: result?.success ? 'sent' : 'error' })
      if (!result?.success) console.warn('[submitAll] ⚠️ Error:', result)
    } catch (err) {
      updateCapture(capture.id, { status: 'error' })
      console.error('[submitAll] ❌ Error:', err)
    }
  }
}

// ── Image / Lightbox ──────────────────────────────────────────────────────────
const lightboxSrc = ref(null)
const scale = ref(1)
const translate = ref({ x: 0, y: 0 })
const isPanning = ref(false)
const start = ref({ x: 0, y: 0 })

const lightboxStyle = computed(() => ({
  transform: `translate(-50%, -50%) translate(${translate.value.x}px, ${translate.value.y}px) scale(${scale.value})`
}))
const lightboxCursor = computed(() =>
  scale.value <= 1 ? { cursor: 'zoom-in' } : { cursor: isPanning.value ? 'grabbing' : 'grab' }
)

function onWheelZoom(event) {
  scale.value = Math.min(6, Math.max(1, scale.value + (event.deltaY > 0 ? -0.1 : 0.1)))
}
function startPan(event) {
  if (scale.value <= 1) return
  isPanning.value = true
  start.value = { x: event.clientX - translate.value.x, y: event.clientY - translate.value.y }
}
function onPan(event) {
  if (!isPanning.value) return
  translate.value = { x: event.clientX - start.value.x, y: event.clientY - start.value.y }
}
function endPan()        { isPanning.value = false }
function openLightbox(src) { lightboxSrc.value = src; scale.value = 1; translate.value = { x: 0, y: 0 } }
function closeLightbox()   { lightboxSrc.value = null }

async function pickImageForCapture(capture) {
  const result = await window.api.System.showOpenDialog({
    title: 'Select Screenshot', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  })
  if (!result || !result.length) return
  const filePath = result[0]
  const base64   = await window.api.invoke('file:readAsBase64', filePath)
  if (!base64) return
  const ext      = filePath.split('.').pop().toLowerCase()
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'
  updateCapture(capture.id, {
    previewBase64: `data:${mimeType};base64,${base64}`,
    fullBase64: base64, filename: filePath.split(/[\\/]/).pop(), status: 'ready'
  })
  await processOCROnCapture(capture.id, base64, mimeType)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const res = await window.api.UEX.getCache()
    terminals.value = res?.terminals?.data || []
  } catch (e) { terminals.value = [] }

  await Promise.all([fetchStockStatuses(), fetchCommodities(), fetchCategories(), fetchVehicles()])

  window.api.Screenshots.offNew()
  window.api.Screenshots.offFolderMissing()

  window.api.Screenshots.onWatcherStarted((data) => {
    watcherStatusText.value = `Watcher Active — ${data?.path ?? ''}`
  })
  window.api.Screenshots.onFolderMissing(() => {
    watcherStatusText.value = '⚠️ Screenshots folder not found — configure in Settings'
  })
  window.api.Screenshots.onNew(async (data) => {
    await processScreenshot(data)
  })
})

onUnmounted(() => {
  window.api.Screenshots.offNew()
  window.api.Screenshots.offFolderMissing()
})
</script>

<style scoped>
.dr-container {
  background: #0b0f14;
  color: #e6e6e6;
  font-family: sans-serif;
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.captures-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.watcher-bar { padding: 12px 20px; flex-shrink: 0; border-bottom: 1px solid #1e2a35; }

:deep(.custom-input-group) { border: 1px solid #1e2a35; border-radius: 4px; overflow: hidden; }
:deep(.watcher-addon)      { background: #111821; border: none; border-right: 1px solid #1e2a35; padding: 0 1rem; }
:deep(.p-inputtext.watcher-text) { background: #0b0f14; color: #00ffcc; border: none; font-weight: normal; box-shadow: none; }
:deep(.watcher-btn)        { background: #1a2530; color: #e6e6e6; border: none; border-left: 1px solid #1e2a35; }
:deep(.watcher-btn-manual) { background: #003a3a; color: #00ffcc; border: none; border-left: 1px solid #1e2a35; }
:deep(.watcher-btn-submit) { background: #003a3a; color: #00ffcc; border: none; border-left: 1px solid #1e2a35; }
:deep(.watcher-btn-submit:disabled) { opacity: 0.35; cursor: not-allowed; }
:deep(.watcher-btn-manual .p-button-label),
:deep(.watcher-btn .p-button-label),
:deep(.watcher-btn-submit .p-button-label) { font-weight: normal; }

/* ── Price Alert States ───────────────────────────── */
:deep(.price-missing .p-inputtext) { border: 2px solid #ff4d4f !important; background-color: #2a1215 !important; }
:deep(.price-warning .p-inputtext) { border: 2px solid #4096ff !important; background-color: #111c2f !important; }
:deep(.price-extreme .p-inputtext) { border: 2px solid #fadb14 !important; background-color: #2b2611 !important; }
:deep(.p-select.price-missing)     { border: 2px solid #ff4d4f !important; background-color: #2a1215 !important; }
:deep(.p-select.price-warning)     { border: 2px solid #4096ff !important; background-color: #111c2f !important; }
:deep(.p-select.price-extreme)     { border: 2px solid #fadb14 !important; background-color: #2b2611 !important; }

.new-capture-anim { animation: flash-border 2s ease-out; }
@keyframes flash-border { 0% { border-color: #00ffcc; } 100% { border-color: #1e2a35; } }

.capture-block { border: 1px solid #1e2a35; background: #111821; padding: 15px; display: flex; flex-direction: column; gap: 15px; }
.capture-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.capture-body { display: grid; grid-template-columns: 260px 1fr; gap: 20px; border-top: 1px solid #1e2a35; padding-top: 25px; }

.label { color: #00ffcc; font-size: 12px; text-transform: uppercase; margin-right: 10px; }
.status-badge {
  padding: 2px 10px; border-radius: 4px; font-size: 11px; font-weight: bold;
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; gap: 5px; white-space: nowrap;
}
.status-processing { background: #1a2a1a; color: #88ffaa; border: 1px solid #336644; }
.status-ready      { background: #1a2a3a; color: #00ffcc; border: 1px solid #005577; }
.status-error      { background: #2a1a1a; color: #ff6666; border: 1px solid #662222; }
.status-sent       { background: #1a1a2a; color: #aaaaff; border: 1px solid #334488; }

.ocr-overlay { display: flex; align-items: center; gap: 8px; color: #88ffaa; font-size: 13px; padding: 8px 0; }
.ocr-error   { display: flex; align-items: center; gap: 8px; color: #ff6666; font-size: 13px; padding: 8px 0; }

.items-area { display: flex; flex-direction: column; gap: 28px; }
.item-row   { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #1e2a35; }

.item-field         { display: flex; flex-direction: column; min-width: 120px; }
.item-field--name   { flex: 1; min-width: 180px; }
.item-field--status { min-width: 130px; max-width: 160px; }
.item-field--small  { min-width: 70px; max-width: 90px; }

.item-delete-btn { flex-shrink: 0; align-self: flex-end; margin-bottom: 2px; width: 2rem !important; height: 2rem !important; }
.add-item-container { padding-top: 4px; }

:deep(.p-floatlabel label)                               { color: #00ffcc; font-size: 13px; }
:deep(.p-floatlabel:has(.p-inputwrapper-focus) label),
:deep(.p-floatlabel:has(.p-inputwrapper-filled) label)   { color: #00ffcc !important; }
:deep(.p-inputtext), :deep(.p-select)                    { background: #0f141b !important; border: 1px solid #1e2a35 !important; color: white !important; }
:deep(.p-tooltip .p-tooltip-text) {
  white-space: pre-line; font-size: 12px; line-height: 1.8; min-width: 100px; max-width: 100px;
  background: #111821; border: 1px solid #1e2a35; color: #e6e6e6; padding: 8px 12px;
}

.preview-img { width: 100%; border: 1px solid #1e2a35; border-radius: 4px; cursor: zoom-in; transition: border-color 0.2s; }
.preview-img:hover { border-color: #00ffcc; }
.preview-area { border: 2px dashed transparent; border-radius: 4px; transition: border-color 0.2s; }
.preview-area:hover { border-color: #1e2a35; }
.no-image-placeholder {
  height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: #080b0f; border: 1px dashed #1e2a35; color: #444; gap: 8px; cursor: pointer;
  transition: border-color 0.2s, color 0.2s; border-radius: 4px;
}
.no-image-placeholder:hover { border-color: #00ffcc; color: #00ffcc; }

.lightbox-overlay  { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.lightbox-stage    { width: 90vw; height: 90vh; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.lightbox-img      { position: absolute; top: 50%; left: 50%; transform-origin: center center; }
.lightbox-close    {
  position: fixed; top: 20px; right: 24px; background: transparent; border: 1px solid #555;
  color: #ccc; font-size: 20px; width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.lightbox-close:hover { border-color: #00ffcc; color: #00ffcc; }
</style>