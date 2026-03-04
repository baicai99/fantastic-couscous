import fs from 'node:fs'
import path from 'node:path'

const distDir = path.resolve('dist/assets')
const targetKb = Number(process.env.BUNDLE_TARGET_KB || 750)

if (!fs.existsSync(distDir)) {
  console.error('dist/assets not found. Run build first.')
  process.exit(1)
}

const files = fs.readdirSync(distDir).filter((name) => /^index-.*\.js$/.test(name))
if (files.length === 0) {
  console.error('No index-*.js file found in dist/assets.')
  process.exit(1)
}

const largest = files
  .map((name) => {
    const full = path.join(distDir, name)
    const size = fs.statSync(full).size / 1024
    return { name, size }
  })
  .sort((a, b) => b.size - a.size)[0]

console.log(`Main bundle: ${largest.name} ${largest.size.toFixed(2)} KB (target < ${targetKb} KB)`)

if (largest.size >= targetKb) {
  console.error('Bundle check failed.')
  process.exit(2)
}

console.log('Bundle check passed.')
