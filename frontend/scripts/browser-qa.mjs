import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { preview } from 'vite'

const require = createRequire(new URL('../../data/local/browser-qa/qa.cjs', import.meta.url))
const { chromium } = require('playwright-core')
const origin = process.env.NORTHSTAR_QA_URL ?? 'http://127.0.0.1:4175'
const data = JSON.parse(gunzipSync(await readFile(new URL('../public/inventory/monthly.json.gzip', import.meta.url))))
const sales = JSON.parse(await readFile(new URL('../public/data/dashboard.json', import.meta.url), 'utf8'))
const widths = [375, 390, 768, 1024, 1440]
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const salesMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('en-US')
const ratio = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function totals(pairs, first, last) {
  const days = data.periods.slice(first, last + 1).reduce((sum, period) => sum + period[3], 0)
  let ending = 0, value = 0, exposure = 0, cost = 0, sold = 0, alerts = 0
  for (const [, product, months] of pairs) {
    const costUsd = data.catalog[product][3] / 100
    ending += months[last][6]
    value += months[last][6] * costUsd
    alerts += months[last][16]
    for (const row of months.slice(first, last + 1)) {
      exposure += row[7] * costUsd
      cost += (row[3] - row[4]) * costUsd
      sold += row[3]
    }
  }
  const average = exposure / days
  return { ending, value, cost, average, alerts, sold, turns: cost / average, dio: average / cost * days }
}

function observe(page) {
  const errors = []
  const responses = new Map()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('requestfailed', (request) => errors.push(`${request.url()} ${request.failure()?.errorText}`))
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    responses.set(path, response)
    if (response.status() >= 400) errors.push(`${response.status()} ${path}`)
  })
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) errors.push(`${message.type()} ${message.text()}`)
  })
  return { errors, responses }
}

async function assertKpis(page, computed) {
  const expectKpi = async (label, value) => {
    const card = page.getByRole('region', { name: 'Inventory KPIs' }).locator('article').filter({ hasText: label })
    assert.equal(await card.locator('strong').innerText(), value, label)
  }
  await expectKpi('Ending stock units', integer.format(computed.ending))
  await expectKpi('Ending inventory value', money.format(computed.value))
  await expectKpi('Inventory turnover', Number.isFinite(computed.turns) ? `${ratio.format(computed.turns)}×` : 'N/A')
  await expectKpi('Days of inventory on hand', Number.isFinite(computed.dio) ? `${ratio.format(computed.dio)} d` : 'N/A')
  await expectKpi('Below reorder point', integer.format(computed.alerts))
}

async function verifyViewport(page, width) {
  await page.getByRole('heading', { name: 'Inventory Intelligence' }).waitFor()
  await page.locator('.inventory-movement-chart .recharts-wrapper').waitFor()
  const measures = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    charts: [...document.querySelectorAll('.inventory-panel .chart-wrap')].map((chart) => {
      const frame = chart.getBoundingClientRect()
      const plot = chart.querySelector('.recharts-wrapper')?.getBoundingClientRect()
      return [Math.floor(frame.width), Math.floor(plot?.width ?? 0), Math.floor(plot?.height ?? 0)]
    }),
    table: (() => {
      const table = document.querySelector('[aria-label="Product performance table"]')
      return [table.clientWidth, table.scrollWidth]
    })(),
    navigation: [...document.querySelectorAll('.workspace-nav a')].map((link) => link.getBoundingClientRect().right),
  }))
  assert.ok(measures.documentWidth <= width + 1, `Page overflow at ${width}: ${JSON.stringify(measures)}`)
  assert.equal(measures.charts.length, 3)
  assert.ok(measures.charts.every(([frame, plot, height]) => plot >= 200 && plot <= frame + 1 && height >= 200), JSON.stringify(measures))
  assert.ok(measures.table[0] <= width && measures.table[1] >= measures.table[0])
  if (width <= 390) assert.ok(measures.table[1] > measures.table[0], 'wide product table scrolls within its container')
  assert.ok(measures.navigation.every((right) => right <= width), 'navigation fits')
  const movement = page.locator('.inventory-movement-chart .recharts-wrapper')
  await movement.hover({ position: { x: Math.round(measures.charts[0][1] / 2), y: 100 } })
  const tooltip = movement.locator('.recharts-tooltip-wrapper')
  await tooltip.waitFor({ state: 'visible' })
  assert.match(await tooltip.innerText(), /Closing stock/)
  const bounds = await tooltip.boundingBox()
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `Tooltip outside ${width}px viewport`)
  await page.getByRole('button', { name: 'Export inventory product CSV' }).waitFor()
}

function parseCsv(content) {
  assert.equal(content.charCodeAt(0), 0xfeff, 'UTF-8 BOM')
  const csvPattern = /(?:"((?:[^"]|"")*)"|([^,\r\n]*))(,|\r\n)/gy
  const body = content.slice(1)
  const rows = [[]]
  let input
  while ((input = csvPattern.exec(body))) {
    rows.at(-1).push(input[1]?.replaceAll('""', '"') ?? input[2])
    if (input[3] === '\r\n') rows.push([])
    if (csvPattern.lastIndex === body.length) return rows.slice(0, -1)
  }
  throw new Error('Invalid CSV quoting or line endings')
}

async function download(page, label, filename) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()])
  assert.equal(file.suggestedFilename(), filename)
  const [headers, ...rows] = parseCsv(await readFile(await file.path(), 'utf8'))
  return { headers, rows: rows.map((row) => {
    assert.equal(row.length, headers.length)
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]))
  }) }
}

async function functional(page, telemetry) {
  const last = data.periods.length - 1
  const first = data.periods.findIndex(([month]) => month.startsWith(data.periods[last][0].slice(0, 4)))
  const dashboard = page.getByRole('region', { name: 'Inventory filters' })
  await assertKpis(page, totals(data.series, first, last))
  assert.ok(!telemetry.responses.has('/data/dashboard.json'), 'inventory deep link did not request sales data')
  const selected = data.series.find(([, , periods]) => periods[last - 1][17])
  const [store, product] = selected
  const [sku, , category] = data.catalog[product]
  await dashboard.getByLabel('From month').selectOption(data.periods[first + 1][0])
  await dashboard.getByLabel('Through month').selectOption(data.periods[last - 1][0])
  await dashboard.getByLabel('Store', { exact: true }).selectOption(data.stores[store])
  await dashboard.getByLabel('Category', { exact: true }).selectOption(category)
  await dashboard.getByLabel('Inventory health').selectOption('Replenishment attention')
  await dashboard.getByRole('searchbox').fill(sku.toLowerCase())
  const computed = totals([selected], first + 1, last - 1)
  await assertKpis(page, computed)
  await page.getByLabel('Category metric').selectOption('Turnover')
  assert.ok(await page.getByLabel('Turnover by category').getByText(category, { exact: true }).isVisible())
  await page.getByLabel('Aging metric').selectOption('Units')
  assert.ok(await page.getByLabel('Units across FIFO age bands').isVisible())
  const productTable = page.getByRole('table', { name: 'Product performance' })
  const storeTable = page.getByRole('table', { name: 'Store comparison' })
  const watchlist = page.getByRole('table', { name: 'Replenishment watchlist' })
  assert.equal(await productTable.locator('tbody tr').count(), 1)
  assert.ok(await storeTable.getByText(data.stores[store], { exact: true }).isVisible())
  assert.ok(await watchlist.getByText(sku, { exact: true }).isVisible())

  const start = data.periods[first + 1][0], end = data.periods[last - 1][0]
  const period = `${start}_to_${end}.csv`
  const productCsv = await download(page, 'Export inventory product CSV', `inventory-products-${period}`)
  const watchCsv = await download(page, 'Export replenishment watchlist CSV', `inventory-watchlist-${period}`)
  const exceptionsCsv = await download(page, 'Export reconciliation exceptions CSV', `inventory-exceptions-${period}`)
  const summaryCsv = await download(page, 'Export inventory KPI summary CSV', `inventory-summary-${period}`)
  assert.equal(productCsv.rows.length, 1)
  assert.equal(productCsv.rows[0].SKU, sku)
  assert.equal(productCsv.rows[0].Store, data.stores[store])
  assert.equal(productCsv.rows[0]['Start date'], data.periods[first + 1][1])
  assert.equal(productCsv.rows[0]['End date'], data.periods[last - 1][2])
  assert.equal(Number(productCsv.rows[0]['Inventory value (USD)']), Math.round(computed.value * 100) / 100)
  assert.equal(Number(productCsv.rows[0]['Units sold']), computed.sold)
  assert.equal(watchCsv.rows.length, 1)
  assert.equal(watchCsv.rows[0].SKU, sku)
  assert.equal(Number(watchCsv.rows[0]['Reorder point']), selected[2][last - 1][9])
  assert.equal(summaryCsv.rows.length, 1)
  assert.equal(Number(summaryCsv.rows[0]['Net COGS (USD)']), Math.round(computed.cost * 100) / 100)
  const expectedWarnings = data.quality.byPeriod.filter(([month]) => month >= start && month <= end).reduce((sum, row) => sum + row[3], 0)
  assert.equal(exceptionsCsv.rows.reduce((sum, row) => sum + Number(row.Records), 0), expectedWarnings)
  assert.ok(exceptionsCsv.rows.every((row) => row.Scope === 'Entire network' && row.Severity === 'warning'))
  assert.ok(productCsv.headers.includes('Turnover (×)'))
  for (const file of [productCsv, watchCsv, exceptionsCsv, summaryCsv]) {
    assert.doesNotMatch(JSON.stringify(file), /(?:SQ-\d+|customer[_ ]id|transaction[_ ]id|[A-Z]:[\\/])/i)
  }

  await dashboard.getByRole('searchbox').fill('no matching entry')
  await page.getByRole('heading', { name: 'No matching inventory' }).waitFor()
  await dashboard.getByRole('button', { name: 'Reset' }).click()
  await assertKpis(page, totals(data.series, first, last))
  await dashboard.getByLabel('Through month').selectOption(data.periods[0][0])
  await page.getByRole('heading', { name: 'Check the reporting period' }).waitFor()
  await dashboard.getByRole('button', { name: 'Reset' }).click()
  await productTable.getByRole('button', { name: 'Ending units' }).click()
  assert.equal(await productTable.locator('th[aria-sort="ascending"]').innerText().then((s) => s.trim()), 'Ending units ↑')
  await page.getByText('Validation checks', { exact: true }).click()
  assert.ok(await page.getByText('snapshot flow mismatch', { exact: true }).isVisible())
  await page.getByText('Inventory methodology', { exact: true }).click()
  assert.ok(await page.getByText('Health precedence', { exact: true }).isVisible())

  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('heading', { name: 'Multi-store profitability command center' }).waitFor()
  const overview = page.locator('main#overview')
  const kpi = (label) => overview.locator('article').filter({ has: page.locator('.kpi-head').getByText(label, { exact: true }) }).locator('strong')
  for (const year of sales.filters.years) {
    await page.getByLabel('Year').selectOption(String(year))
    const view = sales.views[`${year}|All|All|All`]
    assert.equal(await kpi('Net sales').innerText(), salesMoney.format(view.kpis.sales))
    assert.equal(await kpi('Gross profit').innerText(), salesMoney.format(view.kpis.profit))
    assert.equal(await kpi('Gross margin').innerText(), new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(view.kpis.margin))
  }
  await page.getByLabel('Store', { exact: true }).selectOption(sales.filters.locations[0])
  await page.getByLabel('Category', { exact: true }).selectOption(sales.filters.categories[0])
  const filteredSales = sales.views[`${sales.filters.years.at(-1)}|${sales.filters.locations[0]}|All|${sales.filters.categories[0]}`]
  assert.equal(await kpi('Net sales').innerText(), salesMoney.format(filteredSales.kpis.sales))
  assert.ok(await overview.getByRole('heading', { name: 'Top stores by gross profit' }).isVisible())
  assert.ok(await overview.getByRole('heading', { name: 'Category economics' }).isVisible())
  await overview.locator('.recharts-line-curve').waitFor()
  await page.getByRole('link', { name: 'Methodology', exact: true }).click()
  await page.getByRole('heading', { name: 'Sales methodology' }).waitFor()
}

const server = process.env.NORTHSTAR_QA_URL ? null : await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } })
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 }, acceptDownloads: true })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(8_000)
      const telemetry = observe(page)
      await page.goto(`${origin}/#inventory`)
      await verifyViewport(page, width)
      if (width === 1440) await functional(page, telemetry)
      assert.deepEqual(telemetry.errors, [], `Browser errors at ${width}px`)
      console.log(`Passed ${width}px viewport${width === 1440 ? ' and full functional, CSV and sales checks' : ''}`)
    } finally {
      await context.close()
    }
  }
  const page = await browser.newPage()
  let resume
  const gate = new Promise((resolve) => { resume = resolve })
  await page.route('**/inventory/monthly.json.gzip', async (route) => { await gate; await route.continue() })
  await page.goto(`${origin}/#inventory`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Loading inventory…').waitFor()
  resume()
  await page.getByRole('heading', { name: 'Inventory Intelligence' }).waitFor()
  await page.unroute('**/inventory/monthly.json.gzip')
  await page.route('**/inventory/monthly.json.gzip', (route) => route.fulfill({ status: 404, body: 'Missing test asset' }))
  await page.reload()
  await page.getByRole('heading', { name: 'Inventory export unavailable' }).waitFor()
  await page.close()
  console.log('Passed delayed and unavailable inventory asset states')
} finally {
  await browser?.close()
  await server?.close()
}
