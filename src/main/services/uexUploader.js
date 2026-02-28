const axios = require('axios')
const UEX_CONFIG = require('../config/uexConfig')
const { getAppToken, getUserToken } = require('./uexAuth')

async function submitData(payload) {
  const url = `${UEX_CONFIG.BASE_URL}${UEX_CONFIG.ENDPOINTS.DATA_SUBMIT}`

  const response = await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getAppToken()}`,
      'secret-key': getUserToken()
    },
    timeout: UEX_CONFIG.TIMEOUT
  })

  if (response.data?.status !== 'ok') {
    throw new Error('UEX rejected submission')
  }

  return response.data
}

module.exports = {
  submitData
}