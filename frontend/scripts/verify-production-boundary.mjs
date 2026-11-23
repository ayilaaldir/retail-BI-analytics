import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const dist = resolve('dist')
const forbidden = ['/__local/dashboard.json', 'data/local/dashboard.json', '/__local/inventory.json', 'data/local/inventory.json']
const productionDataReference = '/data/dashboard.json'
const inventoryReference = '/inventory/monthly.json.gzip'
const approvedStaticFiles = new Set(['index.html', 'favicon.svg', 'icons.svg', productionDataReference.slice(1), inventoryReference.slice(1)])

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
let inventoryReferenceFound = false
for (const file of files) {
  const normalized = relative(dist, file).replaceAll('\\', '/')
  if (!approvedStaticFiles.has(normalized) && !/^assets\/[a-z0-9_.-]+\.(?:js|css)$/i.test(normalized)) {
    throw new Error(`Unexpected production file: ${normalized}`)
  }
  if (/\.(?:html|js|css|json|map)$/i.test(file)) {
    const contents = await readFile(file, 'utf8')
    if (contents.includes(productionDataReference)) productionReferenceFound = true
    if (contents.includes(inventoryReference)) inventoryReferenceFound = true
    const leaked = forbidden.find((value) => contents.includes(value))
    if (leaked) throw new Error(`Development-only reference ${leaked} found in ${normalized}`)
  }
}

if (!inventoryReferenceFound) throw new Error(`Production inventory does not reference ${inventoryReference}`)
const inventoryPath = resolve(dist, 'inventory', 'monthly.json.gzip')
const inventoryFiles = files.filter((file) => file.replaceAll('\\', '/').includes('/dist/inventory/'))
if (inventoryFiles.length !== 1 || inventoryFiles[0] !== inventoryPath) {
  throw new Error('Production inventory must contain only the reviewed monthly asset')
}
const inventoryBytes = await readFile(inventoryPath)
if (inventoryBytes.length > 25 * 1024 * 1024) throw new Error('Inventory asset exceeds the Pages file size limit')
const inventory = JSON.parse(gunzipSync(inventoryBytes, { maxOutputLength: 25 * 1024 * 1024 }))
function exactKeys(object, keys) {
  return Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key))
}
if (!exactKeys(inventory, ['version', 'synthetic', 'scope', 'seed', 'source', 'policy', 'periods', 'stores', 'catalog', 'series', 'quality']) ||
    inventory.version !== 1 || inventory.synthetic !== true || inventory.scope !== 'licensed_demo' ||
    !exactKeys(inventory.source, ['dataset_name', 'source_owner', 'source_url', 'license_name', 'license_url']) ||
    inventory.source.license_url !== 'https://creativecommons.org/licenses/by/4.0/' ||
    !exactKeys(inventory.policy, ['lookbackDays', 'safetyDays', 'slowUnits', 'overstockDays', 'health'])) {
  throw new Error('Production inventory must use the licensed synthetic demo schema and attribution')
}
const isCount = (value) => Number.isSafeInteger(value) && value >= 0
if (!inventory.catalog.every(([sku, name, category, cost, lead], index) => {
  const suffix = String(index + 1).padStart(3, '0')
  return inventory.catalog[index].length === 5 && sku === `INV-${suffix}` && name === `${category} item ${suffix}` &&
    typeof category === 'string' && isCount(cost) && isCount(lead) && lead > 0
})) throw new Error('Production inventory cannot expose source product labels')

const keys = new Set()
if (inventory.series.length !== inventory.catalog.length * inventory.stores.length || !inventory.series.length ||
    !inventory.periods.length || !inventory.series.every(([store, product, months], index) => {
      const key = `${store}/${product}`
      if (keys.has(key) || !isCount(store) || store >= inventory.stores.length || !isCount(product) ||
          product >= inventory.catalog.length || inventory.series[index].length !== 3) return false
      keys.add(key)
      return months.length === inventory.periods.length && months.every((row, monthIndex) => {
        if (row.length !== 18 || !row.every((value, column) => column === 5 ? Number.isSafeInteger(value) : isCount(value))) return false
        const [opening, receipts, emergency, sold, returned, other, closing] = row
        return opening + receipts + emergency - sold + returned + other === closing &&
          (monthIndex === 0 || months[monthIndex - 1][6] === opening) &&
          row.slice(10, 15).reduce((sum, units) => sum + units, 0) === closing &&
          row[15] < inventory.policy.health.length && row[16] <= 1 && row[17] <= row[16]
      })
    })) throw new Error('Production inventory has unexpected grains, broken balances, or invalid metric fields')

const { valid, critical, checks, exceptions, byPeriod, ...auditCounts } = inventory.quality
const auditFields = ['sourceRows', 'sourceRowsAccepted', 'sourceRowsQuarantined', 'sourceDuplicates', 'sourceDailyGroups',
  'movementRecords', 'acceptedMovements', 'quarantinedMovements', 'snapshots', 'warnings', 'sold', 'returned']
if (valid !== true || critical !== 0 || !exactKeys(auditCounts, auditFields) || !Object.values(auditCounts).every(isCount) ||
    !Object.values(checks).every(isCount) || !exceptions.every((row) => exactKeys(row, ['severity', 'code', 'records', 'sourceRows', 'units']) &&
    row.severity === 'warning' && row.code === 'same_day_receipt' && [row.records, row.sourceRows, row.units].every(isCount)) ||
    !byPeriod.every((row) => row.length === 6 && /^\d{4}-\d{2}$/.test(row[0]) &&
      row[1] === 'warning' && row[2] === 'same_day_receipt' && row.slice(3).every(isCount))) {
  throw new Error('Production inventory quality output must contain only approved aggregate checks')
}

const forbiddenInventoryValues = /(?:customer[_ ]?id|transaction[_ ]?id|device[_ ]?name|SQ-\d+|data[\\/]raw)/i
if (forbiddenInventoryValues.test(JSON.stringify(inventory))) throw new Error('Sensitive POS identifier or path in inventory asset')

if (!productionReferenceFound) {
  throw new Error(`Production dashboard does not reference ${productionDataReference}`)
}

const productionDataPath = resolve(dist, 'data', 'dashboard.json')
if (!files.includes(productionDataPath)) throw new Error(`Missing approved sales asset ${productionDataReference}`)
if (files.includes(productionDataPath)) {
  const payload = JSON.parse(await readFile(productionDataPath, 'utf8'))
  const allowedTopLevel = ['status', 'generatedAt', 'source', 'filters', 'privacy', 'views']
  const unexpectedTopLevel = Object.keys(payload).filter((key) => !allowedTopLevel.includes(key))
  if (unexpectedTopLevel.length) throw new Error(`Unexpected production data fields: ${unexpectedTopLevel.join(', ')}`)

  const forbiddenKeys = new Set([
    'orderId', 'order_id', 'customerId', 'customer_id', 'customerName', 'customer_name',
    'productId', 'product_id', 'productName', 'product_name', 'postalCode', 'postal_code',
    'address', 'city', 'state', 'email', 'sku', 'item', 'transaction_id', 'transactionId',
    'device_name', 'deviceName', 'price_point_name', 'pricePointName',
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

console.log('Production boundary verified for sales and inventory. The inventory asset reconciles and contains no local-only fields.')
