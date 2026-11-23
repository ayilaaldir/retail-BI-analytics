export const INVENTORY_ASSET = '/inventory/monthly.json.gzip'
export const AGING_BANDS = ['0–30 days', '31–60 days', '61–90 days', '91–180 days', '181+ days']

type Period = [month: string, start: string, end: string, days: number, recentDays: number]
type Product = [sku: string, name: string, category: string, costCents: number, lead: number]
type Month = [opening: number, receipts: number, sameDay: number, sold: number, returned: number, other: number,
  ending: number, stockUnitDays: number, recent: number, reorder: number,
  age0: number, age31: number, age61: number, age91: number, age181: number,
  health: number, alert: number, risk: number]
export type InventoryException = { severity: string; code: string; records: number; sourceRows: number; units: number }

export type InventoryData = {
  version: 1
  synthetic: true
  scope: 'local' | 'licensed_demo'
  seed: number
  source: { dataset_name: string; source_owner: string; source_url: string; license_name: string; license_url: string }
  periods: Period[]
  stores: string[]
  catalog: Product[]
  series: [store: number, product: number, months: Month[]][]
  policy: { lookbackDays: number; safetyDays: number; slowUnits: number; overstockDays: number; health: string[] }
  quality: {
    valid: boolean; sourceRows: number; sourceRowsAccepted: number; sourceRowsQuarantined: number; sourceDuplicates: number;
    sourceDailyGroups: number; movementRecords: number; acceptedMovements: number; quarantinedMovements: number;
    snapshots: number; critical: number; warnings: number; sold: number; returned: number; exceptions: InventoryException[];
    byPeriod: [month: string, severity: string, code: string, records: number, units: number, sourceRows: number][]
    checks: Record<string, number>
  }
}

export type InventoryFilters = { start: string; end: string; store: string; category: string; query: string; health: string }

export function defaultInventoryFilters(data: InventoryData): InventoryFilters {
  const end = data.periods.at(-1)![0]
  const start = data.periods.find(([month]) => month.slice(0, 4) === end.slice(0, 4))![0]
  return { start, end, store: '', category: '', query: '', health: '' }
}

type Totals = { ending: number; valueCents: number; valueDaysCents: number; cogsCents: number;
  sold: number; recent: number; alerts: number; slowCents: number; risks: number }

export type InventoryMetrics = Totals & { averageCents: number; turnover: number | null; dio: number | null; cover: number | null }
export type InventoryProduct = InventoryMetrics & {
  store: string; sku: string; name: string; category: string; lead: number; reorder: number; health: string;
  alert: boolean; risk: boolean; action: string; reason: string;
}

const emptyTotals = (): Totals => ({ ending: 0, valueCents: 0, valueDaysCents: 0, cogsCents: 0, sold: 0, recent: 0, alerts: 0, slowCents: 0, risks: 0 })

function sumInto(total: Totals, item: Totals) {
  total.ending += item.ending
  total.valueCents += item.valueCents
  total.valueDaysCents += item.valueDaysCents
  total.cogsCents += item.cogsCents
  total.sold += item.sold
  total.recent += item.recent
  total.alerts += item.alerts
  total.slowCents += item.slowCents
  total.risks += item.risks
}

function evaluate(total: Totals, days: number, recentDays: number): InventoryMetrics {
  const averageCents = total.valueDaysCents / days
  return { ...total, averageCents,
    turnover: averageCents > 0 ? total.cogsCents / averageCents : null,
    dio: total.cogsCents > 0 ? averageCents / total.cogsCents * days : null,
    cover: total.recent > 0 ? total.ending / (total.recent / recentDays) : null,
  }
}

export function selectInventory(data: InventoryData, filters: InventoryFilters) {
  const from = data.periods.findIndex(([month]) => month === filters.start)
  const through = data.periods.findIndex(([month]) => month === filters.end)
  if (from < 0 || through < from) return null

  const periods = data.periods.slice(from, through + 1)
  const days = periods.reduce((sum, period) => sum + period[3], 0)
  const end = data.periods[through][2]
  const recentDays = data.periods[through][4]
  const trend = periods.map(([month]) => ({ month, opening: 0, receipts: 0, sameDay: 0, sold: 0, returned: 0, other: 0, closing: 0 }))
  const aging = AGING_BANDS.map((band) => ({ band, units: 0, valueCents: 0 }))
  const categories = new Map<string, Totals>()
  const stores = new Map<string, Totals>()
  const products: InventoryProduct[] = []
  const total = emptyTotals()
  const query = filters.query.trim().toLowerCase()

  for (const [storeIndex, productIndex, months] of data.series) {
    const store = data.stores[storeIndex]
    const [sku, name, category, cost, lead] = data.catalog[productIndex]
    const snapshot = months[through]
    const health = data.policy.health[snapshot[15]]
    if ((filters.store && store !== filters.store) || (filters.category && category !== filters.category) ||
        (filters.health && health !== filters.health) || (query && !`${sku} ${name}`.toLowerCase().includes(query))) continue

    const ending = snapshot[6]
    const alert = Boolean(snapshot[16])
    const risk = Boolean(snapshot[17])
    const item = { ...emptyTotals(), ending, valueCents: ending * cost, recent: snapshot[8], alerts: Number(alert),
      risks: Number(risk), slowCents: health === 'Slow-moving' || health === 'Non-moving' ? ending * cost : 0 }
    for (let index = from; index <= through; index++) {
      const [opening, receipts, sameDay, sold, returned, other, closing, unitDays] = months[index]
      item.valueDaysCents += unitDays * cost
      item.cogsCents += (sold - returned) * cost
      item.sold += sold
      const point = trend[index - from]
      point.opening += opening
      point.receipts += receipts
      point.sameDay += sameDay
      point.sold -= sold
      point.returned += returned
      point.other += other
      point.closing += closing
    }
    aging.forEach((band, index) => {
      const units = snapshot[10 + index]
      band.units += units
      band.valueCents += units * cost
    })
    products.push({ ...evaluate(item, days, recentDays), store, sku, name, category, lead, reorder: snapshot[9],
      health, alert, risk,
      reason: risk ? 'Cover shorter than lead time' : alert ? 'Stock below reorder point' : '',
      action: risk ? 'Check inbound ETA and nearby transfer stock' : alert ? 'Review open orders and next delivery' : '',
    })
    sumInto(total, item)
    if (!categories.has(category)) categories.set(category, emptyTotals())
    if (!stores.has(store)) stores.set(store, emptyTotals())
    sumInto(categories.get(category)!, item)
    sumInto(stores.get(store)!, item)
  }

  const groups = (items: Map<string, Totals>) => Array.from(items, ([name, metrics]) => ({ name, ...evaluate(metrics, days, recentDays) }))
    .sort((left, right) => right.valueCents - left.valueCents || left.name.localeCompare(right.name))
  return { days, recentDays, start: data.periods[from][1], end, metrics: evaluate(total, days, recentDays), products, trend,
    aging, categories: groups(categories), stores: groups(stores) }
}

export function selectExceptions(data: InventoryData, from: string, through: string): InventoryException[] {
  const groups = new Map<string, InventoryException>()
  for (const [month, severity, code, records, units, sourceRows] of data.quality.byPeriod) {
    if (month < from || month > through) continue
    const key = `${severity}:${code}`
    const group = groups.get(key) ?? { severity, code, records: 0, sourceRows: 0, units: 0 }
    group.records += records
    group.units += units
    group.sourceRows += sourceRows
    groups.set(key, group)
  }
  return [...groups.values()]
}

export type CsvCell = string | number | null

export function toCsv(headers: string[], rows: CsvCell[][]) {
  function encode(value: CsvCell) {
    if (value === null) return ''
    if (typeof value === 'number') return String(value)
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value
    return `"${safe.replaceAll('"', '""')}"`
  }
  return [headers, ...rows].map((row) => row.map(encode).join(',')).join('\r\n') + '\r\n'
}

export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function loadInventory(signal: AbortSignal): Promise<InventoryData> {
  const localUrl = import.meta.env.DEV ? '/__local/inventory.json' : undefined
  const local = localUrl && await fetch(localUrl, { signal })
  let value
  if (local && local.ok) {
    value = await local.json()
  } else {
    const response = await fetch(INVENTORY_ASSET, { signal })
    if (!response.ok || !response.body) throw new Error('Inventory export unavailable')
    value = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()
  }
  if (value.version !== 1 || value.synthetic !== true || !value.quality?.valid || !value.periods?.length || !value.series?.length) {
    throw new Error('Inventory export failed validation')
  }
  return value
}
