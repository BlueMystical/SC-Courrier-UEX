<!-- src/renderer/views/BuySell/Items.vue -->
<template>
    <div class="items-layout">

        <!-- ================= HEADER FIJO ================= -->
        <div class="items-header">
            <section class="search-section card shadow-2 border-round-xl p-5">
                <h2 class="m-0 mb-4 text-primary flex align-items-center gap-3">
                    Item Shop Finder
                    <i class="pi pi-tag" style="font-size: 1.5rem"></i>

                    <!-- Indicador de estado del cache -->
                    <span v-if="cacheStatus === 'loading'" class="cache-badge cache-badge--loading">
                        <i class="pi pi-spin pi-spinner"></i> Loading item cache...
                    </span>
                    <span v-else-if="cacheStatus === 'ready'" class="cache-badge cache-badge--ready">
                        <i class="pi pi-check-circle"></i> {{ totalItems.toLocaleString() }} items
                    </span>
                    <span v-else-if="cacheStatus === 'error'" class="cache-badge cache-badge--error">
                        <i class="pi pi-exclamation-triangle"></i> Cache unavailable
                    </span>
                </h2>

                <div class="flex flex-column gap-3">
                    <label class="font-bold text-xl text-700 ml-1">
                        Item Name & Quantity
                    </label>

                    <div class="custom-input-wrapper shadow-1">
                        <i class="pi pi-search box-icon"></i>

                        <AutoComplete ref="itemSearchInput" v-model="selectedItem" :suggestions="filteredItems"
                            showClear @complete="searchItem" optionLabel="name" field="name"
                            :disabled="cacheStatus !== 'ready'" :placeholder="searchPlaceholder" forceSelection
                            class="search-input-container" inputClass="custom-input" @item-select="onItemSelect">
                            <template #option="slotProps">
                                <div class="item-option">
                                    <span class="item-option-name">{{ slotProps.option.name }}</span>
                                    <span class="item-option-category">{{ slotProps.option.category_name ||
                                        slotProps.option.type }}</span>
                                </div>
                            </template>
                        </AutoComplete>

                        <div class="input-divider"></div>

                        <div class="flex align-items-center px-2 quantity-wrapper">
                            <InputNumber :modelValue="quantity" @input="handleQuantityChange" :min="1"
                                inputClass="qty-input" variant="filled" placeholder="Qty" :useGrouping="false" />
                        </div>

                        <Button v-if="selectedItem" icon="pi pi-times" severity="secondary" rounded text class="mr-2"
                            @click="clearSearch" />
                    </div>

                    <!-- Filtros: Buy/Sell + Sistema Estelar -->
                    <div v-if="selectedItem && prices.length > 0" class="filters-row animate-in fade-in mt-2">
                        <SelectButton v-model="filterMode" :options="filterOptions" optionLabel="label"
                            optionValue="value" class="filter-mode-btn" />

                        <div class="system-filter">
                            <i class="pi pi-map-marker system-filter-icon"></i>
                            <Select v-model="selectedSystem" :options="systemOptions" optionLabel="label"
                                optionValue="value" placeholder="All Systems" showClear :loading="loadingSystems"
                                class="system-select" />
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <!-- ================= ZONA SCROLLEABLE ================= -->
        <div class="items-scroll">
            <section v-if="selectedItem"
                class="results-section border-round-xl shadow-3 bg-card w-full animate-in fade-in">
                <DataView :value="filteredPrices" paginator :rows="10" :rowsPerPageOptions="[5, 10, 25, 50]">
                    <template #list="slotProps">
                        <div class="flex flex-column w-full px-2">
                            <div v-for="(item, index) in slotProps.items" :key="item.id || index"
                                class="terminal-row w-full"
                                :class="{ 'terminal-row--hovered': hoveredRow === (item.id || index) }"
                                @mouseenter="hoveredRow = (item.id || index)" @mouseleave="hoveredRow = null">
                                <div class="row-accent-bar"></div>

                                <div class="grid-container">
                                    <div class="col-terminal font-bold">
                                        {{ item.terminal_name }}
                                    </div>

                                    <div class="col-buy label-header">Price (Total)</div>
                                    <div class="col-sell label-header">Buyback</div>

                                    <div class="col-item-name text-500 font-mono text-xs opacity-80">
                                        {{ item.item_name }}
                                    </div>

                                    <div class="col-buy price-value">
                                        <span v-if="item.price_buy > 0"
                                            v-tooltip.top="'Updated: ' + formatTooltipDate(item.date_modified)"
                                            class="text-green-500 cursor-pointer">
                                            {{ (item.price_buy * debouncedQuantity).toLocaleString('en-US') }}
                                        </span>
                                        <span v-else class="text-700 font-normal italic text-sm">N/A</span>
                                    </div>

                                    <div class="col-sell price-value">
                                        <span v-if="item.price_sell > 0" class="text-orange-500">
                                            {{ (item.price_sell * debouncedQuantity).toLocaleString('en-US') }}
                                        </span>
                                        <span v-else class="text-500 font-normal italic text-sm">--</span>
                                    </div>

                                    <div class="col-location text-500 italic text-xs opacity-70">
                                        {{ formatLocation(item) }}
                                    </div>

                                    <div class="col-version text-right text-500 font-medium uppercase text-xs">
                                        v{{ item.game_version }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>

                    <template #empty>
                        <div
                            class="flex flex-column align-items-center justify-content-center py-8 text-center bg-card">
                            <i class="pi pi-search-minus text-primary opacity-50 mb-3" style="font-size: 3rem"></i>
                            <h3 class="m-0 text-700">No market data found</h3>
                            <p class="text-500 mt-2">There are no prices available for the current filters.</p>
                            <div class="flex gap-2 mt-3">
                                <Button v-if="filterMode !== 'all'" label="Show All Prices" icon="pi pi-filter-slash"
                                    class="p-button-text" @click="filterMode = 'all'" />
                                <Button v-if="selectedSystem" label="Clear System Filter" icon="pi pi-map-marker"
                                    class="p-button-text" @click="selectedSystem = null" />
                            </div>
                        </div>
                    </template>
                </DataView>
            </section>
        </div>

    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import AutoComplete from 'primevue/autocomplete';
import DataView from 'primevue/dataview';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Tooltip from 'primevue/tooltip';
import { useNotify } from '@/components/Notificaciones/Notify';

const vTooltip = Tooltip;
const notify = useNotify();

// --- ESTADOS ---
const allItems = ref([]);           // todos los items del cache
const filteredItems = ref([]);      // sugerencias del autocomplete
const selectedItem = ref(null);
const prices = ref([]);
const filterMode = ref('all');
const quantity = ref(1);
const debouncedQuantity = ref(1);
const hoveredRow = ref(null);
const itemSearchInput = ref(null);

// Cache status
const cacheStatus = ref('loading'); // 'loading' | 'ready' | 'error'
const totalItems = computed(() => allItems.value.length);

// Sistemas estelares
const starSystems = ref([]);
const selectedSystem = ref(null);
const loadingSystems = ref(false);

const API_BASE = 'https://api.uexcorp.uk/2.0';
const API_ITEM_PRICES = `${API_BASE}/items_prices?id_item=`;
const API_STAR_SYSTEMS = `${API_BASE}/star_systems`;

let debounceTimeout = null;

const filterOptions = [
    { label: 'Buy From', value: 'buy' },
    { label: 'Sell To', value: 'sell' },
    { label: 'All', value: 'all' },
];

const searchPlaceholder = computed(() => {
    if (cacheStatus.value === 'loading') return 'Loading items...'
    if (cacheStatus.value === 'error') return 'Cache unavailable — try restarting'
    return `Search among ${totalItems.value.toLocaleString()} items...`
});

// Opciones de sistemas — solo los disponibles en live
const systemOptions = computed(() =>
    starSystems.value
        .filter(s => s.is_available_live === 1)
        .map(s => ({ label: s.name, value: s.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
);

onMounted(async () => {
    // Carga cache de items y sistemas en paralelo
    try {
        const [cachedItems, systemsRes] = await Promise.all([
            window.api.Items.getAll(),
            fetch(API_STAR_SYSTEMS)
        ]);

        // Items desde cache local
        if (Array.isArray(cachedItems) && cachedItems.length > 0) {
            allItems.value = cachedItems;
            cacheStatus.value = 'ready';
        } else {
            cacheStatus.value = 'error';
            notify.warn('Item cache is empty. Try running a sync first.');
        }

        // Sistemas estelares
        const systemsJson = await systemsRes.json();
        if (systemsJson.status === 'ok') starSystems.value = systemsJson.data;

    } catch (e) {
        cacheStatus.value = 'error';
        notify.error('Error loading item cache');
    }
});

onUnmounted(() => {
    clearTimeout(debounceTimeout);
});

// Búsqueda fuzzy directa sobre el cache — sin llamadas a API
const searchItem = (event) => {
    const query = (event.query || '').trim().toLowerCase();
    if (!allItems.value.length) return;

    if (query.length === 0) {
        // Sin query: mostrar los primeros 50 para no saturar el dropdown
        filteredItems.value = allItems.value.slice(0, 50);
        return;
    }

    // Búsqueda: coincidencia al inicio primero, luego cualquier posición
    const starts = [];
    const contains = [];
    for (const item of allItems.value) {
        const name = (item.name || '').toLowerCase();
        if (name.startsWith(query)) {
            starts.push(item);
        } else if (name.includes(query)) {
            contains.push(item);
        }
        if (starts.length + contains.length >= 100) break; // cap para rendimiento
    }

    filteredItems.value = [
        ...starts.sort((a, b) => a.name.localeCompare(b.name)),
        ...contains.sort((a, b) => a.name.localeCompare(b.name)),
    ];
};

const onItemSelect = async (event) => {
    prices.value = [];
    filterMode.value = 'all';
    selectedSystem.value = null;
    try {
        const res = await fetch(`${API_ITEM_PRICES}${event.value.id}`);
        const json = await res.json();
        if (json.status === 'ok') {
            prices.value = json.data;
            if (prices.value.length === 0) notify.warn('No market records found for this item');
        }
    } catch (e) {
        notify.error('Error loading prices');
    }
};

const handleQuantityChange = (e) => {
    quantity.value = e.value != null && e.value > 0 ? e.value : 1;
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => { debouncedQuantity.value = quantity.value; }, 500);
};

const formatLocation = (item) => {
    const parts = [];
    if (item.star_system_name) parts.push(item.star_system_name);
    if (item.planet_name && item.planet_name !== item.star_system_name) parts.push(item.planet_name);
    if (item.city_name) parts.push(item.city_name);
    else if (item.outpost_name) parts.push(item.outpost_name);
    return parts.join(' > ');
};

const formatTooltipDate = (ts) => {
    if (!ts) return 'No data';
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
};

const clearSearch = () => {
    selectedItem.value = null;
    prices.value = [];
    filterMode.value = 'all';
    selectedSystem.value = null;
};

const filteredPrices = computed(() => {
    let res = [...prices.value];

    // Filtro por sistema estelar
    if (selectedSystem.value) {
        res = res.filter(p => p.star_system_name === selectedSystem.value);
    }

    if (filterMode.value === 'buy') return res.filter(p => p.price_buy > 0).sort((a, b) => a.price_buy - b.price_buy);
    if (filterMode.value === 'sell') return res.filter(p => p.price_sell > 0).sort((a, b) => b.price_sell - a.price_sell);
    return res;
});
</script>

<style scoped>
/* ================= LAYOUT ================= */

.items-layout {
    height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 20px;
    background-color: var(--p-content-background);
}

.items-header {
    flex-shrink: 0;
}

.items-scroll {
    flex: 1;
    overflow-y: auto;
    margin-top: 20px;
}

/* ================= BADGE ESTADO CACHE ================= */

.cache-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    letter-spacing: 0.3px;
}

.cache-badge--loading {
    background: rgba(var(--p-primary-color-rgb, 99, 102, 241), 0.12);
    color: var(--p-primary-color);
    border: 1px solid rgba(var(--p-primary-color-rgb, 99, 102, 241), 0.3);
}

.cache-badge--ready {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
}

.cache-badge--error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
}

/* ================= BUSCADOR ================= */

.custom-input-wrapper {
    display: flex;
    align-items: center;
    border: 2px solid var(--p-content-border-color);
    border-radius: 14px;
    background: var(--p-content-background);
    padding: 2px;
    width: 100%;
    margin-top: 10px;
}

.box-icon {
    margin-left: 1.5rem;
    font-size: 1.4rem;
    color: var(--p-primary-color);
}

.input-divider {
    width: 2px;
    height: 35px;
    background-color: var(--p-content-border-color);
    margin: 0 10px;
    opacity: 0.6;
}

.search-input-container {
    flex: 1;
    min-width: 200px;
}

.quantity-wrapper {
    width: 110px;
    flex-shrink: 0;
}

.quantity-wrapper :deep(.p-inputnumber),
.quantity-wrapper :deep(.p-inputnumber-input) {
    width: 100% !important;
}

:deep(.custom-input) {
    border: none !important;
    padding: 1.25rem 1rem !important;
    font-size: 1.2rem;
    width: 100% !important;
    background: transparent !important;
    outline: none;
    margin-left: 10px;
}

:deep(.qty-input) {
    border: none !important;
    background: transparent !important;
    font-size: 1.2rem;
    font-weight: bold;
    width: 100%;
    padding: 1.25rem 0.5rem !important;
    text-align: center;
    color: var(--p-primary-color);
    outline: none;
}

/* Opción del autocomplete: nombre + categoría */
.item-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
}

.item-option-name {
    font-weight: 500;
}

.item-option-category {
    font-size: 0.7rem;
    color: var(--p-primary-color);
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
}

:deep(.p-autocomplete-panel) {
    min-width: 420px !important;
}

/* ================= FILTROS ================= */

.filters-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
}

.filter-mode-btn {
    flex: 1;
    min-width: 200px;
}

.system-filter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 200px;
}

.system-filter-icon {
    color: var(--p-primary-color);
    font-size: 1rem;
    flex-shrink: 0;
}

.system-select {
    flex: 1;
}

/* ================= FILAS CON HOVER ================= */

.terminal-row {
    position: relative;
    padding: 1.5rem 1rem 1.5rem 1.25rem;
    border-top: 1px solid var(--p-content-border-color);
    transition: background-color 0.15s ease, padding-left 0.15s ease;
    cursor: default;
}

.row-accent-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--p-primary-color);
    border-radius: 0 2px 2px 0;
    opacity: 0;
    transform: scaleY(0.4);
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.terminal-row--hovered {
    background-color: var(--p-content-hover-background, rgba(255, 255, 255, 0.04));
    padding-left: 1.5rem;
}

.terminal-row--hovered .row-accent-bar {
    opacity: 1;
    transform: scaleY(1);
}

.terminal-row--hovered .price-value span {
    filter: brightness(1.2);
}

/* ================= GRID DE CONTENIDO ================= */

.grid-container {
    display: grid;
    grid-template-columns: 1fr 160px 160px;
    grid-template-rows: auto auto auto;
    gap: 0.3rem 1.5rem;
    align-items: end;
}

.col-terminal {
    grid-column: 1;
    grid-row: 1;
    font-size: 1.2rem;
    color: var(--p-primary-color);
}

.label-header {
    grid-row: 1;
    text-align: right;
    font-size: 0.75rem;
    font-weight: 800;
    color: #888;
    text-transform: uppercase;
}

.col-buy.label-header {
    grid-column: 2;
}

.col-sell.label-header {
    grid-column: 3;
}

.col-item-name {
    grid-column: 1;
    grid-row: 2;
    font-size: 0.8rem;
}

.price-value {
    grid-row: 2;
    text-align: right;
    font-family: monospace;
    font-size: 1.4rem;
    font-weight: bold;
    transition: filter 0.15s ease;
}

.col-buy.price-value {
    grid-column: 2;
}

.col-sell.price-value {
    grid-column: 3;
}

.col-location {
    grid-column: 1;
    grid-row: 3;
    font-size: 0.75rem;
    opacity: 0.7;
}

.col-version {
    grid-column: 2 / span 2;
    grid-row: 3;
    text-align: right;
    font-size: 0.7rem;
    opacity: 0.5;
    text-transform: uppercase;
}
</style>