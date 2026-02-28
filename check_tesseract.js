// Run this from your project root: node check_tesseract.js
const path = require('path')
const fs   = require('fs')

try {
  const pkgPath = path.dirname(require.resolve('tesseract.js/package.json'))
  console.log('📦 tesseract.js package at:', pkgPath)
  
  // Check version
  const pkg = require('tesseract.js/package.json')
  console.log('📌 Version:', pkg.version)
  
  // Check for lang-data folder
  const langPath = path.join(pkgPath, 'lang-data')
  const hasLangDir = fs.existsSync(langPath)
  console.log('📁 lang-data folder exists:', hasLangDir)
  if (hasLangDir) {
    console.log('   Contents:', fs.readdirSync(langPath))
  }
  
  // Check for traineddata in common locations
  const locations = [
    path.join(pkgPath, 'lang-data', 'eng.traineddata'),
    path.join(pkgPath, 'tessdata', 'eng.traineddata'),
    path.join(process.cwd(), 'tessdata', 'eng.traineddata'),
    path.join(process.env.APPDATA || '', 'tesseract-ocr', 'tessdata', 'eng.traineddata'),
  ]
  
  console.log('\n🔍 Checking for eng.traineddata:')
  locations.forEach(loc => {
    console.log(` ${fs.existsSync(loc) ? '✅' : '❌'} ${loc}`)
  })
  
  // Check worker script
  const workerPath = path.join(pkgPath, 'src', 'worker-script', 'node', 'index.js')
  console.log('\n🔧 Worker script exists:', fs.existsSync(workerPath), workerPath)
  
} catch(e) {
  console.error('Error:', e.message)
}
