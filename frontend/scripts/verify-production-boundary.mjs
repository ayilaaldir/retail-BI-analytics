import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dist = resolve('dist')
const forbidden = ['/__local/dashboard.json', 'data/local/dashboard.json']
const productionDataReference = '/data/dashboard.json'

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  }))
  return nested.flat()
}

const files = await filesIn(dist)
let productionReferenceFound = false
for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.includes('/dist/__local/')) {
    throw new Error(`Development-only data was emitted: ${normalized}`)
  }
  if (/\.(?:html|js|css|json|map)$/i.test(file)) {
    const contents = await readFile(file, 'utf8')
    if (contents.includes(productionDataReference)) productionReferenceFound = true
    const leaked = forbidden.find((value) => contents.includes(value))
    if (leaked) throw new Error(`Development-only reference ${leaked} found in ${normalized}`)
  }
}

if (!productionReferenceFound) {
  throw new Error(`Production dashboard does not reference ${productionDataReference}`)
}

const productionDataPath = resolve(dist, 'data', 'dashboard.json')
if (files.includes(productionDataPath)) {
  const payload = JSON.parse(await readFile(productionDataPath, 'utf8'))
  const allowedTopLevel = ['status', 'generatedAt', 'source', 'filters', 'privacy', 'views']
  const unexpectedTopLevel = Object.keys(payload).filter((key) => !allowedTopLevel.includes(key))
  if (unexpectedTopLevel.length) throw new Error(`Unexpected production data fields: ${unexpectedTopLevel.join(', ')}`)

  const forbiddenKeys = new Set([
    'orderId', 'order_id', 'customerId', 'customer_id', 'customerName', 'customer_name',
    'productId', 'product_id', 'productName', 'product_name', 'postalCode', 'postal_code',
    'address', 'city', 'state', 'email',
  ])
  const inspect = (value) => {
    if (Array.isArray(value)) return value.forEach(inspect)
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`Forbidden production data field: ${key}`)
      inspect(nested)
    }
  }
  inspect(payload)

  const maxActiveFilters = payload.privacy?.maxActiveFilters
  const minimumTransactions = payload.privacy?.minimumTransactionsPerAggregate ?? payload.privacy?.minimumOrdersPerAggregate
  if (!Number.isInteger(maxActiveFilters) || !Number.isInteger(minimumTransactions)) {
    throw new Error('Production data is missing aggregate privacy policy metadata')
  }
  for (const [key, view] of Object.entries(payload.views ?? {})) {
    const activeFilters = key.split('|').filter((value) => value !== 'All').length
    if (activeFilters > maxActiveFilters) throw new Error(`Over-granular production view: ${key}`)
    if (view.kpis?.orders < minimumTransactions) throw new Error(`Small production aggregate: ${key}`)
  }
}

console.log('Production boundary verified: static data path is present; no local data or development endpoint leaked.')
