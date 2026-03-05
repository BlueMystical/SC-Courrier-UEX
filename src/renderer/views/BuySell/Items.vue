<!-- src/renderer/views/BuySell/Items.vue -->
<template>
    <div class="items-layout">

        <!-- ================= HEADER FIJO ================= -->
        <div class="items-header">
            <section class="search-section card shadow-2 border-round-xl p-5">
                <h2 class="m-0 mb-5 text-primary flex align-items-center gap-3">
                    Item Shop Finder
                    <i class="pi pi-tag" style="font-size: 1.5rem"></i>
                </h2>

                <div class="flex flex-column gap-3">
                    <label class="font-bold text-xl text-700 ml-1">
                        Category, Item & Quantity
                    </label>

                    <div class="custom-input-wrapper shadow-1 flex align-items-center">
                        <i class="pi pi-search box-icon"></i>

                        <Dropdown ref="categoryDropdown" v-model="selectedCategory" :options="groupedCategories"
                            optionLabel="name" optionGroupLabel="label" optionGroupChildren="items"
                            placeholder="Category" class="category-dropdown" @change="onCategoryChange"
                            @show="onDropdownShow" filter>
                            <template #optiongroup="slotProps">
                                <div class="group-header">
                                    <i class="pi pi-bookmark-fill mr-2"></i>
                                    {{ slotProps.option.label }}
                                </div>
                            </template>
                        </Dropdown>

                        <div class="input-divider"></div>

                        <AutoComplete ref="itemSearchInput" v-model="selectedItem" :suggestions="filteredItems"
                            showClear @complete="searchItem" optionLabel="name" field="name"
                            :disabled="!selectedCategory" @keyup.enter="handleEnterKey"
                            :placeholder="selectedCategory ? 'Search item... ENTER for List' : '← Select category'"
                            forceSelection class="search-input-container" inputClass="custom-input"
                            @item-select="onItemSelect" />

                        <div class="input-divider"></div>

                        <div class="flex align-items-center px-2 quantity-wrapper">
                            <InputNumber :modelValue="quantity" @input="handleQuantityChange" :min="1"
                                inputClass="qty-input" variant="filled" placeholder="Qty" :useGrouping="false" />
                        </div>

                        <Button v-if="selectedItem || selectedCategory" icon="pi pi-times" severity="secondary" rounded
                            text class="mr-2" @click="clearSearch" />
                    </div>

                    <div v-if="selectedItem" class="mt-4 animate-in fade-in">
                        <SelectButton v-model="filterMode" :options="filterOptions" optionLabel="label"
                            optionValue="value" class="w-full" />
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
                        <div class="flex flex-column w-full px-4">
                            <div v-for="(item, index) in slotProps.items" :key="item.id || index"
                                class="terminal-row w-full">
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
                                        <span v-else class="text-700 font-normal italic text-sm">
                                            N/A
                                        </span>
                                    </div>

                                    <div class="col-sell price-value">
                                        <span v-if="item.price_sell > 0" class="text-orange-500">
                                            {{ (item.price_sell * debouncedQuantity).toLocaleString('en-US') }}
                                        </span>
                                        <span v-else class="text-500 font-normal italic text-sm">
                                            --
                                        </span>
                                    </div>

                                    <div class="col-location text-500 italic text-xs opacity-70">
                                        {{ formatLocation(item) }}
                                    </div>

                                    <div class="col-faction text-right text-500 font-medium uppercase text-xs">
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
                            <p class="text-500 mt-2">
                                There are no prices available for the current filters.
                            </p>
                            <Button v-if="filterMode !== 'all'" label="Show All Prices" icon="pi pi-filter-slash"
                                class="p-button-text mt-3" @click="filterMode = 'all'" />
                        </div>
                    </template>

                </DataView>
            </section>
        </div>

    </div>
</template>

<script setup>
// FIX #7: importar onUnmounted para limpiar el timeout al desmontar
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import AutoComplete from 'primevue/autocomplete';
import Dropdown from 'primevue/dropdown';
import DataView from 'primevue/dataview';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import InputNumber from 'primevue/inputnumber';
import Tooltip from 'primevue/tooltip';
import { useNotify } from '@/components/Notificaciones/Notify';

const vTooltip = Tooltip;
const notify = useNotify();

const groupedCategories = ref([]);
const selectedCategory = ref(null);
const itemsList = ref([]);
const filteredItems = ref([]);
const selectedItem = ref(null);
const prices = ref([]);
const filterMode = ref('all');
const quantity = ref(1);
const debouncedQuantity = ref(1);
const itemSearchInput = ref(null);
const categoryDropdown = ref(null);

const API_BASE = 'https://api.uexcorp.uk/2.0';
const API_CATEGORIES = `${API_BASE}/categories?type=item`;
const API_ITEMS_BY_CATEGORY = `${API_BASE}/items?id_category=`;
const API_ITEM_PRICES = `${API_BASE}/items_prices?id_item=`;

let debounceTimeout = null;

onMounted(async () => {
    try {
        const response = await fetch(API_CATEGORIES);
        const json = await response.json();
        if (json.status === 'ok') {
            const groups = {};
            json.data.forEach(cat => {
                if (!groups[cat.section]) {
                    groups[cat.section] = { label: cat.section, items: [] };
                }
                groups[cat.section].items.push(cat);
            });
            groupedCategories.value = Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));
        }
    } catch (e) { notify.error('API Error Categories'); }
});

// FIX #7: Limpiar debounce al desmontar el componente para evitar memory leaks
onUnmounted(() => {
    clearTimeout(debounceTimeout);
});

const filterOptions = [
    { label: 'Buy From', value: 'buy', icon: 'pi pi-shopping-bag' },
    { label: 'Sell To', value: 'sell', icon: 'pi pi-dollar' },
    { label: 'All', value: 'all', icon: 'pi pi-map' },
];
const onDropdownShow = async () => {
    await nextTick();

    // Intenta varios selectores según la versión de PrimeVue
    const selectors = [
        '.p-dropdown-filter',
        '.p-select-filter',
        '[data-pc-section="filterinput"]',
        '.p-dropdown-filter-container input',
        '.p-dropdown-panel input',
    ];

    for (const selector of selectors) {
        const input = categoryDropdown.value?.$el
            ?.closest('body')
            ?.querySelector(selector)
            ?? document.querySelector(selector);

        if (input) {
            input.focus();
            break;
        }
    }
};

const sortItems = (list) => {
    return list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
};

const searchItem = (event) => {
    const query = event.query ? event.query.trim().toLowerCase() : '';
    if (!itemsList.value.length) return;

    if (query === '') {
        filteredItems.value = sortItems([...itemsList.value]);
    } else {
        const results = itemsList.value.filter(item =>
            item.name?.toLowerCase().includes(query) ||
            item.company_name?.toLowerCase().includes(query)
        );
        filteredItems.value = sortItems(results);
    }
};

const handleEnterKey = (event) => {
    if (selectedItem.value || !selectedCategory.value) return;
    const query = event.target.value;
    if (!query || query.trim().length === 0) {
        filteredItems.value = sortItems([...itemsList.value]);
        nextTick(() => {
            if (itemSearchInput.value) itemSearchInput.value.show();
        });
    }
};

const onCategoryChange = async () => {
    selectedItem.value = null;
    prices.value = [];
    // FIX #5: Resetear filterMode al cambiar categoría
    filterMode.value = 'all';
    if (!selectedCategory.value) return;

    try {
        const res = await fetch(`${API_ITEMS_BY_CATEGORY}${selectedCategory.value.id}`);
        const json = await res.json();
        if (json.status === 'ok') {
            itemsList.value = json.data;
            await nextTick();
            const input = itemSearchInput.value?.$el.querySelector('input');
            if (input) input.focus();
        }
    } catch (e) { notify.error('API Error Items'); }
};

const onItemSelect = async (event) => {
    prices.value = [];
    // FIX #5: Resetear filterMode al seleccionar un nuevo ítem
    filterMode.value = 'all';
    try {
        const res = await fetch(`${API_ITEM_PRICES}${event.value.id}`);
        const json = await res.json();
        if (json.status === 'ok') {
            prices.value = json.data;
            if (prices.value.length === 0) notify.warn('No market records found for this item');
        }
    } catch (e) { notify.error('Error loading prices'); }
};

const handleQuantityChange = (e) => {
    quantity.value = e.value != null && e.value > 0 ? e.value : 1;
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => { debouncedQuantity.value = quantity.value; }, 500);
};

const formatLocation = (item) => {
    const p = [item.star_system_name, item.planet_name, item.city_name || item.outpost_name].filter(Boolean);
    return p.join(' > ');
};

const formatTooltipDate = (ts) => {
    if (!ts) return 'No data';
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
};

// FIX #6: clearSearch también resetea filterMode
const clearSearch = () => {
    selectedItem.value = null;
    selectedCategory.value = null;
    prices.value = [];
    itemsList.value = [];
    filterMode.value = 'all';
};

const filteredPrices = computed(() => {
    let res = [...prices.value];
    if (filterMode.value === 'buy') return res.filter(p => p.price_buy > 0).sort((a, b) => a.price_buy - b.price_buy);
    if (filterMode.value === 'sell') return res.filter(p => p.price_sell > 0).sort((a, b) => b.price_sell - a.price_sell);
    return res;
});
</script>

<style scoped>

/* ================= LAYOUT BASE ================= */

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

/* BUSCADOR */
.custom-input-wrapper {
    display: flex;
    align-items: center;
    border: 2px solid var(--p-content-border-color);
    border-radius: 14px;
    background: var(--p-content-background);
    padding: 6px;
    width: 100%;
    margin-top: 10px;
    margin-bottom: 10px;
}

.box-icon {
    margin-left: 1rem;
    font-size: 1.4rem;
    color: var(--p-primary-color);
    opacity: 0.6;
}

.input-divider {
    width: 1px;
    height: 35px;
    background-color: var(--p-content-border-color);
    margin: 0 8px;
}

:deep(.category-dropdown) {
    border: none !important;
    background: transparent !important;
    width: 250px;
    flex-shrink: 0;
    box-shadow: none !important;
}

:deep(.custom-input) {
    border: none !important;
    padding: 1rem !important;
    font-size: 1.2rem;
    width: 100% !important;
    background: transparent !important;
    outline: none;
}

:deep(.qty-input) {
    border: none !important;
    background: var(--p-content-hover-background) !important;
    border-radius: 8px;
    font-size: 1.2rem;
    font-weight: bold;
    width: 100%;
    text-align: center;
    color: var(--p-primary-color);
}

/* FIX #2: :deep() para que el ancho del quantity-wrapper llegue al InputNumber interno */
.quantity-wrapper :deep(.p-inputnumber),
.quantity-wrapper :deep(.p-inputnumber-input) {
    width: 100% !important;
}

.group-header {
    color: var(--p-primary-color);
    font-weight: 800;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 0.5rem 0;
    display: flex;
    align-items: center;
}

/* RESULTADOS */
.terminal-row {
    padding: 1.5rem 0;
    padding-left: 1rem;
    /* ← agrega esto */
    padding-right: 1rem;
    /* ← y esto */
    border-top: 1px solid var(--p-content-border-color);
}

/* FIX #9: grid-column explícito para cada celda del grid de 3 columnas */
.grid-container {
    display: grid;
    grid-template-columns: 1fr 160px 160px;
    grid-template-rows: auto auto auto;
    gap: 0.3rem 1.5rem;
    align-items: end;
}

/* Fila 1 */
.col-terminal {
    grid-column: 1;
    grid-row: 1;
    font-size: 1.3rem;
    color: var(--p-primary-color);
    line-height: 1.1;
}

.label-header {
    grid-row: 1;
    text-align: right;
    font-size: 0.7rem;
    font-weight: 800;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* Asignar col explícita a los label-headers */
.col-buy.label-header {
    grid-column: 2;
}

.col-sell.label-header {
    grid-column: 3;
}

/* Fila 2 */
/* FIX #1: col-box renombrado a col-item-name con estilo y posición definidos */
.col-item-name {
    grid-column: 1;
    grid-row: 2;
    font-size: 0.75rem;
    opacity: 0.8;
}

.price-value {
    grid-row: 2;
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
    font-size: 1.4rem;
    font-weight: 700;
}

.col-buy.price-value {
    grid-column: 2;
}

.col-sell.price-value {
    grid-column: 3;
}

/* Fila 3 */
.col-location {
    grid-column: 1;
    grid-row: 3;
    font-size: 0.85rem;
    opacity: 0.8;
    margin-top: 4px;
    font-style: italic;
}

.col-faction {
    grid-column: 3;
    grid-row: 3;
    text-align: right;
    opacity: 0.5;
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
}

/* PANEL AUTOCOMPLETE */
:deep(.p-autocomplete-panel) {
    z-index: 9999 !important;
    background-color: var(--p-content-background) !important;
    border: 1px solid var(--p-primary-color);
    max-height: 400px !important;
}

.search-input-container {
    flex: 1;
    min-width: 200px;
}

.quantity-wrapper {
    width: 100px;
    flex-shrink: 0;
}

/* Responsive: En móviles se apilan los elementos */
@media (max-width: 768px) {
    .custom-input-wrapper {
        flex-direction: column;
        align-items: stretch;
        padding: 1rem;
    }

    :deep(.category-dropdown),
    .quantity-wrapper,
    .search-input-container {
        width: 100% !important;
        flex: none;
    }

    .input-divider {
        display: none;
    }

    /* En móvil, el grid pasa a 2 columnas para mejor legibilidad */
    .grid-container {
        grid-template-columns: 1fr 130px;
    }

    .col-sell,
    .col-sell.label-header {
        display: none;
    }
}
</style>