<!-- src/renderer/views/BuySell/Commodities.vue -->
<template>
    <div class="commodities-layout">

        <!-- ================= HEADER FIJO ================= -->
        <div class="commodities-header">
            <section class="search-section card shadow-2 border-round-xl p-5">
                <h2 class="m-0 mb-5 text-primary flex align-items-center gap-3">
                    Commodity Market Search
                    <i class="pi pi-search" style="font-size: 1.5rem"></i>
                </h2>

                <div class="flex flex-column gap-5">
                    <div class="flex flex-column gap-3">
                        <label class="font-bold text-xl text-700 ml-1">
                            Commodity Name & Quantity (SCU)
                        </label>

                        <div class="custom-input-wrapper shadow-1">
                            <i class="pi pi-box box-icon"></i>

                            <AutoComplete v-model="selectedCommodity" :suggestions="filteredCommodities"
                                @complete="searchCommodity" optionLabel="name" optionGroupLabel="label"
                                optionGroupChildren="items" placeholder="Search commodity..." forceSelection
                                class="flex-grow-1" inputClass="custom-input" @item-select="onCommoditySelect">
                                <template #optiongroup="slotProps">
                                    <div class="flex align-items-center py-2 px-3 bg-gray-100 font-bold text-primary">
                                        <span class="uppercase text-xs">
                                            {{ slotProps.option.label }}
                                        </span>
                                    </div>
                                </template>
                            </AutoComplete>

                            <div class="input-divider"></div>

                            <div class="flex align-items-center px-3" style="width: 140px;">
                                <InputNumber :modelValue="quantity" @input="handleQuantityChange" :min="1"
                                    inputClass="qty-input" variant="filled" placeholder="Qty" :useGrouping="false" />
                            </div>

                            <Button v-if="selectedCommodity" icon="pi pi-times" severity="secondary" rounded text
                                class="mr-2" @click="clearSearch" />
                        </div>
                    </div>

                    <!-- Filtros: Buy/Sell + Sistema Estelar -->
                    <div v-if="selectedCommodity" class="filters-row animate-in fade-in mt-4">

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
        <div class="commodities-scroll">
            <section v-if="selectedCommodity" class="results-section border-round-xl shadow-3 bg-card w-full">
                <DataView :value="filteredPrices" paginator :rows="10" :rowsPerPageOptions="[5, 10, 25, 50]">
                    <template #list="slotProps">
                        <div class="flex flex-column w-full px-2">
                            <div v-for="(item, index) in slotProps.items" :key="item.id || index"
                                class="terminal-row w-full"
                                :class="{ 'terminal-row--hovered': hoveredRow === (item.id || index) }"
                                @mouseenter="hoveredRow = (item.id || index)" @mouseleave="hoveredRow = null">

                                <!-- Indicador lateral de hover -->
                                <div class="row-accent-bar"></div>

                                <div class="grid-container">

                                    <!-- FILA 1: nombre terminal | labels -->
                                    <div class="col-terminal font-bold">
                                        {{ item.terminal_name }}
                                    </div>
                                    <div class="col-buy label-header">Buy</div>
                                    <div class="col-sell label-header">Sell</div>

                                    <!-- FILA 2: box sizes | precios -->
                                    <div class="col-box text-500 font-mono text-xs opacity-80">
                                        Box Sizes: {{ item.container_sizes || '1, 2, 4, 8, 16, 24' }}
                                    </div>
                                    <div class="col-buy price-value">
                                        <span v-if="item.price_buy > 0" :key="'buy-' + debouncedQuantity"
                                            v-tooltip.top="'Updated: ' + formatTooltipDate(item.date_modified)"
                                            class="text-green-500 cursor-pointer animate-duration-300 animate-in fade-in zoom-in">
                                            {{ (item.price_buy * debouncedQuantity).toLocaleString('en-US') }} <span
                                                class="price-unit">aUEC</span>
                                        </span>
                                        <span v-else class="text-700">--</span>
                                    </div>
                                    <div class="col-sell price-value">
                                        <span v-if="item.price_sell > 0" :key="'sell-' + debouncedQuantity"
                                            v-tooltip.top="'Updated: ' + formatTooltipDate(item.date_modified)"
                                            class="text-orange-500 cursor-pointer animate-duration-300 animate-in fade-in zoom-in">
                                            {{ (item.price_sell * debouncedQuantity).toLocaleString('en-US') }} <span
                                                class="price-unit">aUEC</span>
                                        </span>
                                        <span v-else class="text-700">--</span>
                                    </div>

                                    <!-- FILA 3: vacío | SCU máximos -->
                                    <div class="col-buy scu-value">
                                        <span v-if="item.scu_buy_max > 0" class="text-green-400">
                                            <span class="scu-label">Max Buy:
                                            {{ item.scu_buy_max.toLocaleString('en-US') }} SCU</span>
                                        </span>
                                        <span v-else class="text-700">--</span>
                                    </div>
                                    <div class="col-sell scu-value">
                                        <span v-if="item.scu_sell_max > 0" class="text-orange-400">
                                            <span class="scu-label">Max Sell:
                                            {{ item.scu_sell_max.toLocaleString('en-US') }} SCU</span>
                                        </span>
                                        <span v-else class="text-700">--</span>
                                    </div>

                                    <!-- FILA 4: ubicación | facción -->
                                    <div class="col-location text-500 italic text-xs opacity-70">
                                        {{ formatLocation(item) }}
                                    </div>
                                    <div
                                        class="col-faction text-right text-500 font-medium uppercase text-xs tracking-tighter">
                                        {{ item.faction_name || 'United Empire of Earth' }}
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
                            <p class="text-500 mt-2">
                                There are no prices available for the current filters.
                            </p>
                            <div class="flex gap-2 mt-3">
                                <Button v-if="filterMode !== 'all'" label="Show All Terminals" icon="pi pi-filter-slash"
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
const commoditiesList = ref([]);
const filteredCommodities = ref([]);
const selectedCommodity = ref(null);
const prices = ref([]);
const filterMode = ref('all');
const quantity = ref(1);
const debouncedQuantity = ref(1);
const hoveredRow = ref(null);

// Sistemas estelares
const starSystems = ref([]);
const selectedSystem = ref(null);
const loadingSystems = ref(false);

const API_COMMODITIES_LIST = 'https://api.uexcorp.uk/2.0/commodities';
const API_COMMODITY_PRICES = 'https://api.uexcorp.uk/2.0/commodities_prices?id_commodity=';
const API_STAR_SYSTEMS = 'https://api.uexcorp.uk/2.0/star_systems';

let debounceTimeout = null;

const filterOptions = [
    { label: 'Buy From', value: 'buy', icon: 'pi pi-shopping-bag' },
    { label: 'Sell To', value: 'sell', icon: 'pi pi-dollar' },
    { label: 'All', value: 'all', icon: 'pi pi-map' },
];

// Opciones del select de sistemas — solo los disponibles en live
const systemOptions = computed(() => [
    ...starSystems.value
        .filter(s => s.is_available_live === 1)
        .map(s => ({ label: s.name, value: s.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
]);

onUnmounted(() => {
    clearTimeout(debounceTimeout);
});

const handleQuantityChange = (event) => {
    const val = event.value;
    quantity.value = val != null && val >= 1 ? val : 1;
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
        debouncedQuantity.value = quantity.value;
    }, 500);
};

const formatLocation = (item) => {
    const parts = [];
    if (item.star_system_name) parts.push(item.star_system_name);
    if (item.moon_name) {
        parts.push(item.moon_name);
    } else if (item.planet_name && item.planet_name !== item.star_system_name) {
        parts.push(item.planet_name);
    }
    if (item.space_station_name) parts.push(item.space_station_name);
    if (item.city_name) {
        parts.push(item.city_name);
    } else if (item.outpost_name) {
        parts.push(item.outpost_name);
    }
    return parts.join(' > ');
};

onMounted(async () => {
    // Carga de commodities y sistemas en paralelo
    try {
        const [commoditiesRes, systemsRes] = await Promise.all([
            fetch(API_COMMODITIES_LIST),
            fetch(API_STAR_SYSTEMS)
        ]);
        const [commoditiesJson, systemsJson] = await Promise.all([
            commoditiesRes.json(),
            systemsRes.json()
        ]);
        if (commoditiesJson.status === 'ok') commoditiesList.value = commoditiesJson.data;
        if (systemsJson.status === 'ok') starSystems.value = systemsJson.data;
    } catch (e) {
        notify.error('API Error loading data');
    }
});

const searchCommodity = (event) => {
    const query = event.query.toLowerCase();
    const groups = {};
    commoditiesList.value.forEach(item => {
        if (!groups[item.kind]) groups[item.kind] = { label: item.kind, items: [] };
        if (item.name.toLowerCase().includes(query)) groups[item.kind].items.push(item);
    });
    filteredCommodities.value = Object.values(groups).filter(g => g.items.length > 0);
};

const onCommoditySelect = async (event) => {
    prices.value = [];
    filterMode.value = 'all';
    selectedSystem.value = null;
    try {
        const res = await fetch(`${API_COMMODITY_PRICES}${event.value.id}`);
        const json = await res.json();
        if (json.status === 'ok') {
            prices.value = json.data;
            if (prices.value.length === 0) notify.warn('No market records found for this commodity');
        }
    } catch (e) {
        notify.error('Error loading prices');
    }
};

const clearSearch = () => {
    selectedCommodity.value = null;
    prices.value = [];
    quantity.value = 1;
    debouncedQuantity.value = 1;
    filterMode.value = 'all';
    selectedSystem.value = null;
};

const formatTooltipDate = (timestamp) => {
    if (!timestamp) return 'No data';
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return 'just now';
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
};

const filteredPrices = computed(() => {
    let res = [...prices.value];

    // Filtro por sistema estelar
    if (selectedSystem.value) {
        res = res.filter(p => p.star_system_name === selectedSystem.value);
    }

    // Filtro por modo buy/sell
    if (filterMode.value === 'buy') return res.filter(p => p.price_buy > 0).sort((a, b) => a.price_buy - b.price_buy);
    if (filterMode.value === 'sell') return res.filter(p => p.price_sell > 0).sort((a, b) => b.price_sell - a.price_sell);
    return res;
});
</script>

<style scoped>
/* ================= LAYOUT BASE ================= */

.commodities-layout {
    height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 20px;
    background-color: var(--p-content-background);
}

.commodities-header {
    flex-shrink: 0;
}

.commodities-scroll {
    flex: 1;
    overflow-y: auto;
    margin-top: 20px;
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

:deep(.filter-mode-btn .p-selectbutton) {
    width: 100%;
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

/* ================= ESTILOS EXISTENTES ================= */

.cursor-pointer {
    cursor: help !important;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.2);
}

.custom-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    border: 2px solid var(--p-content-border-color);
    border-radius: 14px;
    background: var(--p-content-background);
    padding: 2px;
    margin-bottom: 20px;
    margin-top: 10px;
    width: 100%;
}

:deep(.p-autocomplete) {
    flex-grow: 1;
    display: flex;
}

:deep(.p-autocomplete-panel) {
    min-width: 400px !important;
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

/* ================= FILAS CON HOVER ================= */

.terminal-row {
    position: relative;
    padding: 1.5rem 1rem 1.5rem 1.25rem;
    border-top: 1px solid var(--p-content-border-color);
    transition: background-color 0.15s ease, padding-left 0.15s ease;
    cursor: default;
}

/* Barra de acento lateral (oculta por defecto) */
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

/* Estado hover de la fila */
.terminal-row--hovered {
    background-color: var(--p-content-hover-background, rgba(255, 255, 255, 0.04));
    padding-left: 1.5rem;
}

.terminal-row--hovered .row-accent-bar {
    opacity: 1;
    transform: scaleY(1);
}

/* Resaltar los precios en hover */
.terminal-row--hovered .price-value span {
    filter: brightness(1.2);
}

/* ================= GRID DE CONTENIDO ================= */

.grid-container {
    display: grid;
    grid-template-columns: 1fr 130px 130px;
    gap: 0.15rem 1rem;
    align-items: end;
    width: 100%;
}

/* Columnas */
.col-buy {
    grid-column: 2;
}

.col-sell {
    grid-column: 3;
}

/* FILA 1 */
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

/* FILA 2 */
.col-box {
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
}

.price-value span {
    transition: filter 0.15s ease;
}

/* FILA 3 */
.scu-value {
    grid-row: 3;
    text-align: right;
    font-family: monospace;
    font-size: 0.85rem;
    font-weight: 600;
    opacity: 0.75;
}

/* FILA 4 */
.col-location {
    grid-column: 1;
    grid-row: 4;
    font-size: 0.75rem;
    opacity: 0.7;
}

.col-faction {
    grid-column: 2 / span 2;
    grid-row: 4;
    text-align: right;
    font-size: 0.75rem;
    opacity: 0.6;
}

.price-unit {
    font-size: 0.65rem;
    font-weight: 400;
    opacity: 0.6;
    margin-left: 3px;
    vertical-align: middle;
}

.scu-label {
    font-size: 0.65rem;
    font-weight: 400;
    opacity: 0.6;
    margin-right: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: inherit;
}
</style>