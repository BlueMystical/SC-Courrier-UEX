const { post } = require('./uexApi')
const settingsHelper = require('../helpers/settingsHelper')

const APP_BEARER = process.env.UEX_APP_BEARER

function hasToken() {
  const token = settingsHelper.getSetting('settings/security/user/token')
  return !!token
}

function getUserSecret() {
  return settingsHelper.getSetting('settings/security/user/token')
}

function validateTokens() {
  if (!APP_BEARER) {
    throw new Error('UEX APP Bearer token not configured (.env)')
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
    console.error('[UEX] ❌ Submit failed:', error.message)

    return {
      success: false,
      error: error.message
    }
  }
}

module.exports = {
  submitData,
  hasToken
}