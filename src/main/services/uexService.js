// src/main/services/uexService.js
// UEX Service: Handles communication with the UEX API, including token management and data submission.

const { post, request } = require('./uexApi')
const settingsHelper = require('../helpers/settingsHelper')

const APP_BEARER = process.env.UEX_APP_TOKEN

function hasToken() {
  const token = settingsHelper.getSetting('settings/security/user/token')
  return !!token
}

function getUserSecret() {
  return settingsHelper.getSetting('settings/security/user/token')
}

function validateTokens() {
  if (!APP_BEARER) {
    throw new Error('UEX_APP_TOKEN not configured in .env')
  }

  const userSecret = getUserSecret()

  if (!userSecret) {
    throw new Error('UEX user secret-key not configured')
  }

  return { userSecret }
}

async function submitData(payload) {
  try {
    const { userSecret } = validateTokens()

    console.log('[UEX] 🚀 Submitting data to UEX...')

    const response = await post('/data_submit', payload, {
      Authorization: `Bearer ${APP_BEARER}`,
      'secret-key': userSecret
    })

    console.log('[UEX] ✅ Submit success')

    return {
      success: true,
      data: response
    }

  } catch (error) {
    console.error('[UEX] ❌ Submit failed:', error.message, error.apiResponse ?? '')
    return {
      success: false,
      error: error.message,
      apiResponse: error.apiResponse ?? null   // ← añadir esto
    }
  }
}

async function getUserNotifications() {
  try {
    const { userSecret } = validateTokens()

    const response = await request('GET', '/user_notifications', null, {
      Authorization: `Bearer ${APP_BEARER}`,
      'secret-key': userSecret
    })

    return { success: true, data: response.data || [] }

  } catch (error) {
    console.error('[UEX] ❌ Get notifications failed:', error.message)
    return { success: false, error: error.message, data: [] }
  }
}

module.exports = { submitData, hasToken, getUserNotifications }