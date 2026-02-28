<template>
  <div class="dr-container">
    <div class="watcher-bar">
      <InputGroup class="custom-input-group">
        <InputGroupAddon class="watcher-addon"><span class="status-dot"></span></InputGroupAddon>
        <InputText value="Watcher Active, waiting for screenshots..." readonly class="watcher-text" />
        <Button icon="pi pi-plus-circle" label="Manual Entry" @click="addManualCapture" class="watcher-btn-manual" />
        <Button icon="pi pi-folder-open" label="Screenshots" class="watcher-btn" @click="openScreenshotsFolder" />
      </InputGroup>
    </div>

    <div v-for="(capture, cIndex) in captures" :key="capture.id" class="capture-block" :class="{ 'new-capture-anim': capture.isNew }">
      
      <div class="capture-header">
        <div style="min-width: 220px;">
          <span class="label">Terminal:</span>
          <Select v-model="capture.terminalId" :options="terminalOptions" filter optionLabel="label" optionValue="value" placeholder="Select" size="small" class="w-full" />
        </div>

        <div style="min-width: 150px;">
          <span class="label">Type:</span>
          <Select v-model="capture.type" :options="typeOptions" optionLabel="label" optionValue="value" size="small" class="w-full" @change="handleTypeChange(capture)" />
        </div>

        <div style="min-width: 120px;">
          <span class="label">Mode:</span>
          <Select v-model="capture.mode" :options="modeOptions" optionLabel="label" optionValue="value" size="small" class="w-full" />
        </div>

        <Button icon="pi pi-trash" severity="danger" text rounded @click="removeCaptureBlock(cIndex)" />
      </div>

      <div class="capture-body">
        <div class="preview-area">
          <img v-if="capture.previewBase64" :src="capture.previewBase64" />
          <div v-else class="no-image-placeholder"><i class="pi pi-image"></i><span>No Image</span></div>
        </div>

        <div class="items-area">
          <div v-for="(item, iIndex) in capture.items" :key="iIndex" class="item-row">

            <template v-if="capture.type === 'item'">
              <FloatLabel>
                <Select :id="'cat-select-' + cIndex + '-' + iIndex" v-model="item.categoryId" :options="itemCategories"
                  optionLabel="name" optionValue="id" filter size="small" style="min-width: 180px;"
                  @change="fetchItemsByCategory(item.categoryId)" />
                <label :for="'cat-select-' + cIndex + '-' + iIndex">Category</label>
              </FloatLabel>
            </template>

            <FloatLabel>
              <Select :id="'item-select-' + cIndex + '-' + iIndex" v-model="item.id_resolved"
                :options="getOptionsForCapture(capture, item)" optionLabel="name" optionValue="id" filter size="small"
                class="input-name-pv" />
              <label :for="'item-select-' + cIndex + '-' + iIndex">Item Name</label>
            </FloatLabel>

            <template v-if="capture.type === 'commodity'">
              <FloatLabel>
                <Select :id="'stock-select-' + cIndex + '-' + iIndex" v-model="item.stockStatus"
                  :options="getStockOptions(capture.mode)" optionLabel="name" optionValue="code" size="small"
                  class="input-small-pv" style="min-width: 140px;" />
                <label :for="'stock-select-' + cIndex + '-' + iIndex">Stock Status</label>
              </FloatLabel>
              <FloatLabel><InputNumber inputId="minmax" v-model="item.quantity" :min="0" class="input-small-pv" size="small" fluid/> <label>Stock SCUs</label></FloatLabel>   
              <FloatLabel><InputNumber inputId="s" v-model="item.price" :min="0" class="input-small-pv" size="small" suffix=" aUEC" fluid/><label>Price/scu</label></FloatLabel>
            </template>

            <template v-if="capture.type === 'item'">
              <FloatLabel><InputText v-model.number="item.price" class="input-small-pv" size="small" /><label>Price/item</label></FloatLabel>
            </template>

            <template v-if="capture.type?.startsWith('vehicle')">
              <FloatLabel><InputText v-model.number="item.price" class="input-small-pv" size="small" /><label>Price</label></FloatLabel>
            </template>

            <Button icon="pi pi-times" severity="danger" text @click="removeItem(capture, iIndex)" style="width: 2rem" />
          </div>

          <div class="add-item-container">
            <Button label="Add Item" icon="pi pi-plus" size="small" text @click="addNewItem(capture)" style="color: #00ffcc" />
          </div>
        </div>
      </div>
    </div>

    <div v-if="captures.length > 0" class="submit-bar">
      <button class="btn-submit-all" @click="submitAll">Submit All</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Select from 'primevue/select';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import FloatLabel from 'primevue/floatlabel';

// Listas Globales de la API
const terminals = ref([])
const commoditiesList = ref([])
const vehiclesList = ref([])
const itemCategories = ref([])
const itemsByCategory = ref({})
const captures = ref([])
const stockStatuses = ref({ buy: [], sell: [] });

const typeOptions = [
  { label: 'Commodities', value: 'commodity' },
  { label: 'Items', value: 'item' },
  { label: 'Vehicles', value: 'vehicle' }
];

const modeOptions = [
  { label: 'Buy', value: 'buy' }, { label: 'Sell', value: 'sell' }, { label: 'Rent', value: 'rent' }
];

const terminalOptions = computed(() => terminals.value.map(t => ({ label: t.name, value: t.id })));

/* API FETCHERS */
const fetchCommodities = async () => {
  try {
    const res = await fetch('https://api.uexcorp.uk/2.0/commodities');
    const json = await res.json();
    if (json.status === 'ok') commoditiesList.value = json.data;
  } catch (e) { console.error("Error Commodities", e); }
};

const fetchVehicles = async () => {
  try {
    const res = await fetch('https://api.uexcorp.uk/2.0/vehicles');
    const json = await res.json();
    if (json.status === 'ok') vehiclesList.value = json.data;
  } catch (e) { console.error("Error Vehicles", e); }
};

const fetchCategories = async () => {
  try {
    const res = await fetch('https://api.uexcorp.uk/2.0/categories?type=item');
    const json = await res.json();
    if (json.status === 'ok') itemCategories.value = json.data;
  } catch (e) { console.error("Error Categories", e); }
};

// 2. Fetcher para los estados de stock
const fetchStockStatuses = async () => {
  try {
    const res = await fetch('https://api.uexcorp.uk/2.0/commodities_status');
    const json = await res.json();
    if (json.status === 'ok') {
      stockStatuses.value = json.data;
    }
  } catch (e) {
    console.error("Error cargando stock statuses:", e);
  }
};

// 3. Función para obtener las opciones según el modo
const getStockOptions = (mode) => {
  // mode suele ser 'buy' o 'sell'
  return stockStatuses.value[mode] || [];
};

/* LOGIC */
const handleTypeChange = (capture) => {
  capture.categoryId = null; // Reset category if type changes
  if (capture.type === 'commodity' && !commoditiesList.value.length) fetchCommodities();
  if (capture.type === 'vehicle' && !vehiclesList.value.length) fetchVehicles();
};

/* LÓGICA DE FILTRADO DINÁMICO PARA EL NOMBRE */
const getOptionsForCapture = (capture, item) => {
  if (!item) return []; // Protección contra undefined
  
  if (capture.type === 'commodity') return commoditiesList.value;
  if (capture.type === 'vehicle') return vehiclesList.value;
  if (capture.type === 'item') {
    // Si el ítem tiene categoría seleccionada, devolvemos los ítems de esa categoría
    return itemsByCategory.value[item.categoryId] || [];
  }
  return [];
};

/* FETCH DE ÍTEMS POR CATEGORÍA */
const fetchItemsByCategory = async (categoryId) => {
  if (!categoryId || itemsByCategory.value[categoryId]) return; 

  try {
    const res = await fetch(`https://api.uexcorp.uk/2.0/items?id_category=${categoryId}`);
    const json = await res.json();
    if (json.status === 'ok') {
      itemsByCategory.value[categoryId] = json.data;
    }
  } catch (e) {
    console.error("Error cargando ítems de la categoría:", categoryId, e);
  }
};

/* INICIALIZACIÓN DE UN NUEVO ÍTEM */
function addNewItem(capture) {
  capture.items.push({
    name: '',
    id_resolved: null,
    categoryId: null, // Campo nuevo para el Select de categoría
    quantity: null,
    price: null,
    stockStatus: '',
    containerSizes: '',
    size: ''
  });
}

function addManualCapture() {
  const newCap = { 
    id: crypto.randomUUID(), type: 'commodity', mode: 'buy', terminalId: null, 
    categoryId: null, items: [], status: 'ready', isNew: true 
  };
  captures.value.unshift(newCap);
  handleTypeChange(newCap); // Carga inicial si es necesario
  setTimeout(() => { newCap.isNew = false; }, 2000);
}

const openScreenshotsFolder = () => {
  window.api.System.openPathInExplorer('C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\screenshots');
};

function removeCaptureBlock(index) { captures.value.splice(index, 1); }
function removeItem(cap, idx) { cap.items.splice(idx, 1); }

onMounted(async () => {
  // 1. Cargar terminales desde cache local
  try {
    const res = await window.api.UEX.getCache();
    terminals.value = res?.terminals?.data || [];
  } catch (e) { terminals.value = []; }

  // 2. Precargar Commodities y Categorías (para tenerlas listas)
  fetchStockStatuses();
  fetchCommodities();
  fetchCategories();
  fetchVehicles();  

  window.api.Screenshots.onNew(async (data) => {
    // Aquí iría la lógica de processScreenshot adaptada para llamar a fetchItemsByCategory si el OCR detecta ítems
  });
});
</script>

<style scoped>
/* (Se mantiene el CSS anterior con el ajuste de gap: 25px en .items-area) */
.dr-container { background: #0b0f14; color: #e6e6e6; padding: 20px; display: flex; flex-direction: column; gap: 20px; font-family: sans-serif; min-height: 100vh; }
.watcher-bar { margin-bottom: 1rem; }
:deep(.custom-input-group) { border: 1px solid #1e2a35; border-radius: 4px; overflow: hidden; }
:deep(.watcher-addon) { background: #111821; border: none; border-right: 1px solid #1e2a35; padding: 0 1rem; }
:deep(.p-inputtext.watcher-text) { background: #0b0f14; color: #00ffcc; border: none; font-weight: bold; box-shadow: none; }
:deep(.watcher-btn) { background: #1a2530; color: #e6e6e6; border: none; border-left: 1px solid #1e2a35; }
:deep(.watcher-btn-manual) { background: #003a3a; color: #00ffcc; border: none; border-left: 1px solid #1e2a35; }
.status-dot { width: 10px; height: 10px; background-color: #22c55e; border-radius: 50%; display: inline-block; animation: pulse 2s infinite; }
@keyframes pulse { 0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; } }
.capture-block { border: 1px solid #1e2a35; background: #111821; padding: 15px; display: flex; flex-direction: column; gap: 15px; margin-bottom: 10px; }
.new-capture-anim { animation: flash-border 2s ease-out; }
@keyframes flash-border { 0% { border-color: #00ffcc; } 100% { border-color: #1e2a35; } }
.capture-header { display: flex; justify-content: space-between; align-items: center; }
.label { color: #00ffcc; font-size: 12px; text-transform: uppercase; margin-right: 10px; }
.capture-body { display: grid; grid-template-columns: 260px 1fr; gap: 20px; border-top: 1px solid #1e2a35; padding-top: 25px; }
.preview-area img { width: 100%; border: 1px solid #1e2a35; border-radius: 4px; }
.no-image-placeholder { height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #080b0f; border: 1px dashed #1e2a35; color: #444; }
.items-area { display: flex; flex-direction: column; gap: 25px; }
.item-row { display: flex; gap: 12px; align-items: center; }
:deep(.p-floatlabel label) { color: #00ffcc; font-size: 13px; }
:deep(.p-floatlabel:has(.p-inputwrapper-focus) label),
:deep(.p-floatlabel:has(.p-inputwrapper-filled) label) { color: #00ffcc !important; }
:deep(.p-inputtext), :deep(.p-select) { background: #0f141b !important; border: 1px solid #1e2a35 !important; color: white !important; }
:deep(.input-name-pv) { width: 100%; min-width: 200px; }
:deep(.input-small-pv) { 
  width: 100px; /* Un poco más ancho para que se lea el estado */
  text-align: center; 
}

/* Para que el texto dentro del select de stock no se corte */
:deep(.p-select.input-small-pv .p-select-label) {
  font-size: 11px;
}
.submit-bar { text-align: center; padding: 20px; border-top: 1px solid #1e2a35; }
.btn-submit-all { background: #003a3a; border: 1px solid #00ffcc; color: #00ffcc; padding: 12px 40px; font-weight: bold; cursor: pointer; }
</style>