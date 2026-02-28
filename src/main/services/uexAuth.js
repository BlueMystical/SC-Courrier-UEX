const settingsHelper = require('../helpers/settingsHelper')

function getAppToken() {
  const token = process.env.UEX_APP_TOKEN
  if (!token) {
    throw new Error('UEX APP token missing')
  }
  return token
}

function getUserToken() {
  const token = settingsHelper.getSetting('settings/security/user/token')
  if (!token) {
    throw new Error('UEX USER token missing')
  }
  return token
}

module.exports = {
  getAppToken,
  getUserToken
}