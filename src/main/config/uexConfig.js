// src/main/config/uexConfig.js
const UEX_CONFIG = {
  BASE_URL: 'https://api.uexcorp.uk/2.0',

  ENDPOINTS: {
    TERMINALS: '/terminals',
    COMMODITIES: '/commodities',
    ITEMS: '/items',
    CATEGORIES: '/categories',
    VEHICLES: '/vehicles',
    DATA_SUBMIT: '/data_submit'
  },

  TIMEOUT: 20000,

  RETRY: {
    ATTEMPTS: 3,
    DELAY_MS: 2000
  }
}

module.exports = UEX_CONFIG