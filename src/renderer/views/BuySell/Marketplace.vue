<!-- src/renderer/views/BuySell/Marketplace.vue -->
<template>
    <div class="marketplace-container">

        <!-- Header -->
        <div class="page-header">
            <div class="header-title">
                <i class="pi pi-shopping-bag"></i>
                <div>
                    <h1>Marketplace</h1>
                    <p class="header-sub">Player-to-player listings across the 'verse</p>
                </div>
            </div>
            <div class="header-controls">
                <!-- Operation toggle -->
                <div class="op-toggle">
                    <button v-for="op in operations" :key="op.value" class="op-btn"
                        :class="{ active: activeOperation === op.value, [op.cls]: true }"
                        @click="setOperation(op.value)">
                        <i :class="op.icon"></i>
                        {{ op.label }}
                    </button>
                </div>

                <span class="listing-count" v-if="!loading">
                    {{ filteredListings.length }} listing{{ filteredListings.length !== 1 ? 's' : '' }}
                </span>
            </div>
        </div>

        <!-- Search + filters -->
        <div class="search-bar">
            <IconField>
                <InputIcon class="pi pi-search" />
                <InputText v-model="searchQuery" placeholder="Search listings..." class="search-input" />
            </IconField>

            <Select v-model="selectedType" :options="typeOptions" optionLabel="label" optionValue="value"
                placeholder="All types" showClear class="type-select" @show="onSelectShow" />

            <Select v-model="selectedAvailability" :options="availabilityOptions" optionLabel="label"
                optionValue="value" placeholder="Any availability" showClear class="avail-select"
                @show="onSelectShow" />

            <Button v-if="hasActiveFilters" icon="pi pi-times" label="Clear" severity="secondary" text size="small"
                @click="clearFilters" />
        </div>

        <!-- Loading -->
        <div v-if="loading" class="loading-state">
            <ProgressSpinner />
            <p>Loading marketplace...</p>
        </div>

        <!-- Error -->
        <Message v-else-if="error" severity="error" class="error-msg">{{ error }}</Message>

        <!-- Empty -->
        <div v-else-if="filteredListings.length === 0" class="empty-state">
            <i class="pi pi-inbox"></i>
            <p>No listings match your filters</p>
            <Button label="Clear filters" severity="secondary" outlined size="small" @click="clearFilters" />
        </div>

        <!-- Listings grid -->
        <div v-else class="listings-grid">
            <div v-for="listing in filteredListings" :key="listing.id" class="listing-card"
                :class="{ selected: selectedListing?.id === listing.id, sold: listing.is_sold_out }"
                @click="selectListing(listing)">
                <!-- Photo -->
                <div class="listing-photo-wrapper">
                    <img v-if="firstPhoto(listing)" :src="firstPhoto(listing)" :alt="listing.title"
                        class="listing-photo" @error="onImageError($event)" />
                    <div v-else class="listing-photo-placeholder">
                        <i class="pi pi-image"></i>
                    </div>

                    <!-- Operation badge -->
                    <div class="op-badge" :class="listing.operation">
                        <i :class="listing.operation === 'sell' ? 'pi pi-tag' : 'pi pi-cart-plus'"></i>
                        {{ listing.operation === 'sell' ? 'SELL' : 'BUY' }}
                    </div>

                    <!-- Sold out overlay -->
                    <div v-if="listing.is_sold_out" class="sold-overlay">SOLD OUT</div>
                </div>

                <!-- Info -->
                <div class="listing-info">
                    <div class="listing-meta">
                        <span class="listing-type">{{ listing.type }}</span>
                        <span class="listing-durability" v-if="listing.durability < 100">
                            <i class="pi pi-wrench"></i> {{ listing.durability }}%
                        </span>
                    </div>

                    <h3 class="listing-title">{{ listing.title }}</h3>

                    <div class="listing-location">
                        <i class="pi pi-map-marker"></i>
                        <span>{{ listing.location || '—' }}</span>
                    </div>

                    <div class="listing-footer">
                        <div class="listing-price" :class="listing.operation">
                            <span class="price-amount">{{ formatAUEC(listing.price) }}</span>
                            <span class="price-currency">aUEC</span>
                        </div>
                        <div class="listing-seller">
                            <i class="pi pi-user"></i>
                            <span>{{ listing.user_username }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Drawer -->
        <Drawer v-model:visible="showDrawer" position="right" :style="{ width: '420px' }" :modal="false"
            :showCloseIcon="true">
            <template #header>
                <div class="drawer-header" v-if="selectedListing">
                    <!-- Photo thumbnail -->
                    <div class="drawer-thumb-wrap">
                        <img v-if="firstPhoto(selectedListing)" :src="firstPhoto(selectedListing)" class="drawer-thumb"
                            @error="onImageError($event)" />
                        <div v-else class="drawer-thumb-placeholder"><i class="pi pi-image"></i></div>
                    </div>
                    <div>
                        <div class="drawer-op-badge" :class="selectedListing.operation">
                            {{ selectedListing.operation === 'sell' ? '↗ FOR SALE' : '↙ WANTED' }}
                        </div>
                        <h2 class="drawer-title">{{ selectedListing.title }}</h2>
                    </div>
                </div>
            </template>

            <div class="drawer-content" v-if="selectedListing">

                <!-- Price block -->
                <div class="price-block" :class="selectedListing.operation">
                    <div class="price-label">
                        {{ selectedListing.operation === 'sell' ? 'Asking Price' : 'Offering Price' }}
                    </div>
                    <div class="price-value">
                        {{ formatAUEC(selectedListing.price) }}
                        <span class="price-unit">aUEC / {{ selectedListing.unit }}</span>
                    </div>
                    <div class="price-old" v-if="selectedListing.price_old && selectedListing.price_old !== '0'">
                        Was: {{ formatAUEC(selectedListing.price_old) }} aUEC
                    </div>
                </div>

                <!-- Market average (if loaded) -->
                <div class="avg-block" v-if="marketAvg">
                    <div class="avg-label"><i class="pi pi-chart-bar"></i> Market Average</div>
                    <div class="avg-row">
                        <div class="avg-item">
                            <span class="avg-sub">Avg. Sell</span>
                            <span class="avg-val sell">{{ formatAUEC(marketAvg.price_sell) }}</span>
                        </div>
                        <div class="avg-divider"></div>
                        <div class="avg-item">
                            <span class="avg-sub">Avg. Buy</span>
                            <span class="avg-val buy">{{ formatAUEC(marketAvg.price_buy) }}</span>
                        </div>
                    </div>
                    <div class="avg-meta">Based on {{ marketAvg.game_version }}</div>
                </div>
                <div class="avg-loading" v-else-if="loadingAvg">
                    <ProgressSpinner style="width:18px;height:18px" /> Fetching market data...
                </div>

                <Divider />

                <!-- Details grid -->
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Type</span>
                        <span class="detail-value">{{ selectedListing.type }}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Availability</span>
                        <span class="detail-value">{{ formatAvailability(selectedListing.availability) }}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Durability</span>
                        <span class="detail-value" :class="{ 'warn-value': selectedListing.durability < 80 }">
                            {{ selectedListing.durability }}%
                        </span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">In Stock</span>
                        <span class="detail-value">{{ selectedListing.in_stock ? 'Yes' : 'No' }}</span>
                    </div>
                    <div class="detail-item full-width">
                        <span class="detail-label">Location</span>
                        <span class="detail-value">{{ selectedListing.location || '—' }}</span>
                    </div>
                    <div class="detail-item full-width" v-if="selectedListing.source">
                        <span class="detail-label">Source</span>
                        <span class="detail-value">{{ selectedListing.source }}</span>
                    </div>
                </div>

                <!-- Description -->
                <div class="description-block" v-if="selectedListing.description">
                    <div class="description-label">Description</div>
                    <p class="description-text">{{ selectedListing.description }}</p>
                </div>

                <Divider />

                <!-- Seller info -->
                <div class="seller-block">
                    <div class="seller-avatar" v-if="selectedListing.user_avatar">
                        <img :src="selectedListing.user_avatar" @error="onImageError($event)" />
                    </div>
                    <div class="seller-avatar placeholder" v-else>
                        <i class="pi pi-user"></i>
                    </div>
                    <div class="seller-info">
                        <div class="seller-name">{{ selectedListing.user_name }}</div>
                        <div class="seller-username">@{{ selectedListing.user_username }}</div>
                    </div>
                    <div class="seller-stats">
                        <div class="stat-pill">
                            <i class="pi pi-eye"></i> {{ selectedListing.total_views }}
                        </div>
                        <div class="stat-pill">
                            <i class="pi pi-comments"></i> {{ selectedListing.total_negotiations }}
                        </div>
                        <div class="stat-pill" :class="{ upvoted: selectedListing.votes > 0 }">
                            <i class="pi pi-thumbs-up"></i> {{ selectedListing.votes }}
                        </div>
                    </div>
                </div>

                <!-- Expiration -->
                <div class="expiry-bar" v-if="selectedListing.date_expiration">
                    <i class="pi pi-clock"></i>
                    <span>Expires: {{ formatDate(selectedListing.date_expiration) }}</span>
                </div>

                <Divider />

                <!-- Actions -->
                <div class="drawer-actions">
                    <Button label="View on UEX" icon="pi pi-external-link" @click="openOnUex(selectedListing)" />
                    <Button v-if="selectedListing.video_url" label="Video" icon="pi pi-youtube" severity="secondary"
                        outlined @click="openUrl(selectedListing.video_url)" />
                </div>

            </div>
        </Drawer>

    </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Drawer from 'primevue/drawer'
import Divider from 'primevue/divider'
import { useNotify } from '@/components/Notificaciones/Notify'

const notify = useNotify()

const API_LISTINGS = 'https://api.uexcorp.uk/2.0/marketplace_listings'
const API_AVERAGES = 'https://api.uexcorp.uk/2.0/marketplace_averages'
const MARKET_DETAIL_URL = 'https://uexcorp.space/marketplace/item/info/'  // ?id=123

// ── STATE ──
const listings = ref([])
const loading = ref(false)
const error = ref(null)
const searchQuery = ref('')
const activeOperation = ref('all')   // 'all' | 'sell' | 'buy'
const selectedType = ref(null)
const selectedAvailability = ref(null)
const selectedListing = ref(null)
const showDrawer = ref(false)
const marketAvg = ref(null)
const loadingAvg = ref(false)

const operations = [
    { value: 'all', label: 'All', icon: 'pi pi-list', cls: 'all' },
    { value: 'sell', label: 'Sell', icon: 'pi pi-tag', cls: 'sell' },
    { value: 'buy', label: 'Buy', icon: 'pi pi-cart-plus', cls: 'buy' },
]

const typeOptions = [
    { label: 'Item', value: 'item' },
    { label: 'Vehicle', value: 'vehicle' },
    { label: 'Commodity', value: 'commodity' },
]

const availabilityOptions = [
    { label: 'Ready for pickup', value: 'ready_pickup' },
    { label: 'Digital delivery', value: 'digital' },
    { label: 'On order', value: 'on_order' },
]

// ── COMPUTED ──
const filteredListings = computed(() => {
    let list = listings.value

    if (activeOperation.value !== 'all') {
        list = list.filter(l => l.operation === activeOperation.value)
    }

    if (selectedType.value) {
        list = list.filter(l => l.type === selectedType.value)
    }

    if (selectedAvailability.value) {
        list = list.filter(l => l.availability === selectedAvailability.value)
    }

    if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase()
        list = list.filter(l =>
            l.title?.toLowerCase().includes(q) ||
            l.description?.toLowerCase().includes(q) ||
            l.location?.toLowerCase().includes(q) ||
            l.user_username?.toLowerCase().includes(q)
        )
    }

    return list
})

const hasActiveFilters = computed(() =>
    searchQuery.value.trim() ||
    selectedType.value ||
    selectedAvailability.value ||
    activeOperation.value !== 'all'
)

// ── LIFECYCLE ──
onMounted(fetchListings)

// ── API ──
async function fetchListings() {
    loading.value = true
    error.value = null
    try {
        const res = await fetch(API_LISTINGS)
        const json = await res.json()
        listings.value = json.data || []
    } catch (e) {
        error.value = 'Failed to load marketplace. Please check your connection.'
        console.error(e)
    } finally {
        loading.value = false
    }
}

async function fetchMarketAvg(idItem) {
    if (!idItem) return
    loadingAvg.value = true
    marketAvg.value = null
    try {
        const res = await fetch(`${API_AVERAGES}?id_item=${idItem}`)
        const json = await res.json()
        marketAvg.value = json.data?.[0] || null
    } catch (e) {
        console.error('Failed to load market avg:', e)
    } finally {
        loadingAvg.value = false
    }
}

// ── HANDLERS ──
function setOperation(op) {
    activeOperation.value = op
}

async function selectListing(listing) {
    selectedListing.value = listing
    showDrawer.value = true
    await fetchMarketAvg(listing.id_item)
}

function clearFilters() {
    searchQuery.value = ''
    selectedType.value = null
    selectedAvailability.value = null
    activeOperation.value = 'all'
}

function onSelectShow() {
    nextTick(() => {
        const filterInput = document.querySelector('.p-select-overlay .p-select-filter')
        if (filterInput) filterInput.focus()
    })
}

function firstPhoto(listing) {
    if (!listing.photos) return null
    const url = listing.photos.split(',').map(s => s.trim()).filter(Boolean)[0]
    return url || null
}

function onImageError(event) {
    event.target.style.display = 'none'
}

function openOnUex(listing) {
    const url = `${MARKET_DETAIL_URL}${listing.slug}/`
    window.api?.System?.openUrlInBrowser(url)    
}

function openUrl(url) {
    window.api?.System?.openUrlInBrowser(url)
}

function formatAUEC(value) {
    if (!value && value !== 0) return '—'
    const n = typeof value === 'string' ? parseInt(value, 10) : value
    if (isNaN(n)) return '—'
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
    return n.toLocaleString('en-US')
}

function formatAvailability(val) {
    const map = {
        ready_pickup: 'Ready for pickup',
        digital: 'Digital delivery',
        on_order: 'On order',
    }
    return map[val] || val || '—'
}

function formatDate(timestamp) {
    if (!timestamp) return '—'
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    })
}
</script>

<style scoped>
.marketplace-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    height: 100%;
    overflow: hidden;
}

/* ── HEADER ── */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
}

.header-title {
    display: flex;
    align-items: center;
    gap: 0.85rem;
}

.header-title i {
    font-size: 2rem;
    color: var(--p-primary-color);
}

.header-title h1 {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0;
    line-height: 1.1;
}

.header-sub {
    font-size: 0.85rem;
    color: var(--p-text-muted-color);
    margin: 0;
}

.header-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.listing-count {
    font-size: 0.85rem;
    color: var(--p-text-muted-color);
    white-space: nowrap;
}

/* ── OP TOGGLE ── */
.op-toggle {
    display: flex;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    overflow: hidden;
}

.op-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.9rem;
    font-size: 0.82rem;
    font-weight: 600;
    border: none;
    background: transparent;
    color: var(--p-text-muted-color);
    cursor: pointer;
    transition: all 0.15s;
    border-right: 1px solid var(--p-content-border-color);
}

.op-btn:last-child {
    border-right: none;
}

.op-btn:hover {
    background: var(--p-surface-hover);
    color: var(--p-text-color);
}

.op-btn.active.sell {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
}

.op-btn.active.buy {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
}

.op-btn.active.all {
    background: var(--p-highlight-background);
    color: var(--p-primary-color);
}

/* ── SEARCH BAR ── */
.search-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.search-input {
    width: 260px;
}

.type-select {
    min-width: 150px;
}

.avail-select {
    min-width: 180px;
}

/* ── STATES ── */
.loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    flex: 1;
    color: var(--p-text-muted-color);
}

.error-msg {
    margin: 0;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    flex: 1;
    color: var(--p-text-muted-color);
}

.empty-state i {
    font-size: 3rem;
    opacity: 0.3;
}

/* ── GRID ── */
.listings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
    overflow-y: auto;
    padding-right: 0.25rem;
    flex: 1;
}

/* ── CARD ── */
.listing-card {
    border: 1px solid var(--p-content-border-color);
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--p-content-background);
    display: flex;
    flex-direction: column;
}

.listing-card:hover {
    border-color: var(--p-primary-color);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    transform: translateY(-2px);
}

.listing-card.selected {
    border-color: var(--p-primary-color);
    box-shadow: 0 0 0 2px var(--p-primary-color);
}

.listing-card.sold {
    opacity: 0.55;
}

/* Photo */
.listing-photo-wrapper {
    position: relative;
    height: 130px;
    background: var(--p-surface-800, #111);
    overflow: hidden;
}

.listing-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
}

.listing-card:hover .listing-photo {
    transform: scale(1.04);
}

.listing-photo-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--p-text-muted-color);
    opacity: 0.3;
    font-size: 2rem;
}

.op-badge {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
}

.op-badge.sell {
    background: rgba(239, 68, 68, 0.85);
    color: #fff;
}

.op-badge.buy {
    background: rgba(34, 197, 94, 0.85);
    color: #fff;
}

.sold-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #fff;
}

/* Info */
.listing-info {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1;
}

.listing-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.listing-type {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--p-primary-color);
}

.listing-durability {
    font-size: 0.7rem;
    color: var(--p-text-muted-color);
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.listing-title {
    font-size: 0.97rem;
    font-weight: 600;
    margin: 0;
    line-height: 1.3;
}

.listing-location {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--p-text-muted-color);
}

.listing-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: auto;
    padding-top: 0.5rem;
    border-top: 1px solid var(--p-content-border-color);
}

.listing-price {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
}

.price-amount {
    font-size: 1rem;
    font-weight: 700;
}

.listing-price.sell .price-amount {
    color: #ef4444;
}

.listing-price.buy .price-amount {
    color: #22c55e;
}

.price-currency {
    font-size: 0.68rem;
    color: var(--p-text-muted-color);
    font-weight: 500;
}

.listing-seller {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--p-text-muted-color);
}

/* ── DRAWER ── */
.drawer-header {
    display: flex;
    align-items: center;
    gap: 0.85rem;
}

.drawer-thumb-wrap {
    width: 72px;
    height: 48px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--p-surface-800, #111);
    flex-shrink: 0;
}

.drawer-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.drawer-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--p-text-muted-color);
    opacity: 0.3;
}

.drawer-op-badge {
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    margin-bottom: 0.2rem;
}

.drawer-op-badge.sell {
    color: #ef4444;
}

.drawer-op-badge.buy {
    color: #22c55e;
}

.drawer-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
    line-height: 1.2;
}

.drawer-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

/* Price block */
.price-block {
    border-radius: 10px;
    padding: 1rem 1.1rem;
    border: 1px solid;
}

.price-block.sell {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.3);
}

.price-block.buy {
    background: rgba(34, 197, 94, 0.08);
    border-color: rgba(34, 197, 94, 0.3);
}

.price-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--p-text-muted-color);
    margin-bottom: 0.3rem;
}

.price-value {
    font-size: 1.6rem;
    font-weight: 800;
    line-height: 1;
}

.price-block.sell .price-value {
    color: #ef4444;
}

.price-block.buy .price-value {
    color: #22c55e;
}

.price-unit {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--p-text-muted-color);
    margin-left: 0.3rem;
}

.price-old {
    font-size: 0.75rem;
    color: var(--p-text-muted-color);
    text-decoration: line-through;
    margin-top: 0.25rem;
}

/* Market average */
.avg-block {
    background: var(--p-highlight-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    padding: 0.75rem 1rem;
}

.avg-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--p-text-muted-color);
    margin-bottom: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
}

.avg-row {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.avg-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1;
}

.avg-divider {
    width: 1px;
    height: 30px;
    background: var(--p-content-border-color);
}

.avg-sub {
    font-size: 0.7rem;
    color: var(--p-text-muted-color);
}

.avg-val {
    font-size: 1rem;
    font-weight: 700;
}

.avg-val.sell {
    color: #ef4444;
}

.avg-val.buy {
    color: #22c55e;
}

.avg-meta {
    font-size: 0.68rem;
    color: var(--p-text-muted-color);
    margin-top: 0.4rem;
}

.avg-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--p-text-muted-color);
}

/* Detail grid */
.detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem 1rem;
}

.detail-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
}

.detail-item.full-width {
    grid-column: 1 / -1;
}

.detail-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--p-text-muted-color);
}

.detail-value {
    font-size: 0.88rem;
    font-weight: 500;
}

.warn-value {
    color: #f97316;
}

/* Description */
.description-block {}

.description-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--p-text-muted-color);
    margin-bottom: 0.35rem;
}

.description-text {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--p-text-color);
    margin: 0;
    white-space: pre-wrap;
}

/* Seller */
.seller-block {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.seller-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
}

.seller-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.seller-avatar.placeholder {
    background: var(--p-surface-700, #222);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--p-text-muted-color);
    font-size: 1rem;
}

.seller-info {
    flex: 1;
}

.seller-name {
    font-size: 0.88rem;
    font-weight: 600;
}

.seller-username {
    font-size: 0.75rem;
    color: var(--p-text-muted-color);
}

.seller-stats {
    display: flex;
    gap: 0.4rem;
}

.stat-pill {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    color: var(--p-text-muted-color);
    background: var(--p-surface-700, #222);
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--p-content-border-color);
}

.stat-pill.upvoted {
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.4);
}

/* Expiry */
.expiry-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--p-text-muted-color);
    background: var(--p-surface-700, #1a1a1a);
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--p-content-border-color);
}

/* Actions */
.drawer-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
}
</style>
