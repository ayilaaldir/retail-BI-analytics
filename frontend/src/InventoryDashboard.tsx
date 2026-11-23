import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Archive, BarChart3, CalendarDays, ChevronDown, CircleDollarSign, Download, Filter, PackageSearch, RefreshCw } from 'lucide-react'
import { defaultInventoryFilters, downloadCsv, loadInventory, selectExceptions, selectInventory,
  type CsvCell, type InventoryData, type InventoryFilters, type InventoryMetrics, type InventoryProduct } from './lib/inventory'

const count = new Intl.NumberFormat('en-US')
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const kpiRatio = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const money = (cents: number) => usd.format(cents / 100)
const turns = (value: number | null) => value === null ? 'N/A' : `${number.format(value)}×`
const days = (value: number | null) => value === null ? 'N/A' : `${number.format(value)} d`
const fraction = (value: number | null) => value === null ? null : Math.round(value * 100) / 100
const dollars = (cents: number) => Math.round(cents) / 100
const labels = { same_day_receipt: 'Same-day receipt override', sales_reconciliation: 'Sales-to-ledger mismatch' }
const issueName = (code: string) => labels[code as keyof typeof labels] ?? code.replaceAll('_', ' ')
const tone = (health: string) => health === 'Replenishment attention' ? 'attention' : health === 'Healthy' ? 'healthy' : 'neutral'

type Column<T> = { header: string; value: (row: T) => CsvCell; render?: (row: T) => ReactNode }

function DataTable<T>({ name, rows, columns, rowKey, pageSize = 12 }: {
  name: string; rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; pageSize?: number;
}) {
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null)
  const [page, setPage] = useState(0)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const key = columns[sort.column].value
    return [...rows].sort((left, right) => {
      const a = key(left), b = key(right)
      if (a === null || b === null) return Number(a === null) - Number(b === null)
      const compare = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true })
      return sort.desc ? -compare : compare
    })
  }, [rows, columns, sort])
  if (!rows.length) return <p className="inventory-empty">No matching records.</p>
  const lastPage = Math.ceil(sorted.length / pageSize) - 1
  const current = Math.min(page, lastPage)
  return <>
    <div className="inventory-table-scroll" role="region" aria-label={`${name} table`} tabIndex={0}>
      <table className="inventory-table" aria-label={name}><thead><tr>{columns.map((column, index) =>
        <th key={column.header} scope="col" aria-sort={sort?.column === index ? (sort.desc ? 'descending' : 'ascending') : undefined}>
          <button type="button" onClick={() => { setSort({ column: index, desc: sort?.column === index && !sort.desc }); setPage(0) }}>
            {column.header}{sort?.column === index && <span aria-hidden="true"> {sort.desc ? '↓' : '↑'}</span>}
          </button>
        </th>)}</tr></thead>
        <tbody>{sorted.slice(current * pageSize, (current + 1) * pageSize).map((row) => <tr key={rowKey(row)}>
          {columns.map((column) => <td key={column.header}>{column.render ? column.render(row) : column.value(row) ?? 'N/A'}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {lastPage > 0 && <div className="inventory-pagination" aria-label={`${name} pagination`}>
      <span>{count.format(current * pageSize + 1)}–{count.format(Math.min((current + 1) * pageSize, rows.length))} of {count.format(rows.length)}</span>
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
      <button type="button" disabled={current === lastPage} onClick={() => setPage(current + 1)}>Next</button>
    </div>}
  </>
}

const storeCols: Column<InventoryMetrics & { name: string }>[] = [
  { header: 'Store', value: (row) => row.name },
  { header: 'Inventory value (USD)', value: (row) => dollars(row.valueCents), render: (row) => money(row.valueCents) },
  { header: 'Turnover (×)', value: (row) => fraction(row.turnover), render: (row) => turns(row.turnover) },
  { header: 'Days of cover', value: (row) => fraction(row.cover), render: (row) => days(row.cover) },
  { header: 'Reorder alerts', value: (row) => row.alerts },
]
const productCols: Column<InventoryProduct>[] = [
  { header: 'SKU', value: (row) => row.sku }, { header: 'Product', value: (row) => row.name },
  { header: 'Category', value: (row) => row.category }, { header: 'Store', value: (row) => row.store },
  { header: 'Ending units', value: (row) => row.ending },
  { header: 'Inventory value (USD)', value: (row) => dollars(row.valueCents), render: (row) => money(row.valueCents) },
  { header: 'Units sold', value: (row) => row.sold },
  { header: 'Turnover (×)', value: (row) => fraction(row.turnover), render: (row) => turns(row.turnover) },
  { header: 'Days of cover', value: (row) => fraction(row.cover), render: (row) => days(row.cover) },
  { header: 'Reorder point', value: (row) => row.reorder },
  { header: 'Health', value: (row) => row.health, render: (row) => <span className={`health-label ${tone(row.health)}`}>{row.health}</span> },
]
const alertCols: Column<InventoryProduct>[] = [
  productCols[3], productCols[0], productCols[4], productCols[9],
  { header: 'Recent units sold', value: (row) => row.recent }, productCols[8],
  { header: 'Lead time (days)', value: (row) => row.lead },
  { header: 'Reason', value: (row) => row.reason }, { header: 'Suggested action', value: (row) => row.action },
]
const productKey = (row: InventoryProduct) => `${row.store}/${row.sku}`

function Field({ label, value, options, all, onChange }: {
  label: string; value: string; options: string[]; all?: string; onChange: (value: string) => void;
}) {
  return <label className="filter-control"><span>{label}</span><div><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    {all && <option value="">{all}</option>}{options.map((option) => <option key={option}>{option}</option>)}
  </select><ChevronDown size={14} aria-hidden="true"/></div></label>
}

function Panel({ title, label, children, actions, wide = false }: {
  title: string; label?: string; children: ReactNode; actions?: ReactNode; wide?: boolean;
}) {
  return <section className={`panel inventory-panel${wide ? ' inventory-wide' : ''}`}>
    <div className="panel-heading"><div>{label && <p className="eyebrow">{label}</p>}<h2>{title}</h2></div>{actions}</div>
    {children}
  </section>
}

function ExportButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return <button type="button" className="inventory-button" onClick={onClick} aria-label={label} disabled={disabled}><Download size={15} /> CSV</button>
}

type InventoryView = NonNullable<ReturnType<typeof selectInventory>>

function MovementChart({ trend }: { trend: InventoryView['trend'] }) {
  return <Panel title="Stock movement" label="UNITS" wide>
    <div className="chart-wrap inventory-movement-chart" aria-label="Monthly signed movement and opening and closing stock in units">
      <ResponsiveContainer><ComposedChart data={trend} margin={{ top: 12, right: 8, left: 2, bottom: 4 }}>
        <CartesianGrid stroke="#e7ece9" vertical={false}/><XAxis dataKey="month" tick={{ fontSize: 10 }}/>
        <YAxis tickFormatter={(value: number) => compact.format(value)} tick={{ fontSize: 11 }}/>
        <Tooltip formatter={(value) => count.format(Number(value))}/><Legend wrapperStyle={{ fontSize: 11 }}/>
        <Bar dataKey="receipts" name="Scheduled receipts" fill="#75bfa1" isAnimationActive={false}/>
        <Bar dataKey="sameDay" name="Same-day receipts" fill="#9c6520" isAnimationActive={false}/>
        <Bar dataKey="sold" name="Fulfilled sales" fill="#bd6053" isAnimationActive={false}/>
        <Bar dataKey="returned" name="Returns" fill="#6486ac" isAnimationActive={false}/>
        <Bar dataKey="other" name="Other net" fill="#7f8492" isAnimationActive={false}/>
        <Line dataKey="opening" name="Opening stock" stroke="#58766a" strokeDasharray="5 3" dot={trend.length === 1} isAnimationActive={false}/>
        <Line dataKey="closing" name="Closing stock" stroke="#147d58" strokeWidth={2.5} dot={trend.length < 2} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer>
    </div>
  </Panel>
}

function CategoryChart({ categories }: Pick<InventoryView, 'categories'>) {
  const [metric, setMetric] = useState('Inventory value')
  const field = metric === 'Inventory value' ? 'valueCents' : metric === 'Ending units' ? 'ending' : 'turnover'
  const tick = (value: number) => field === 'valueCents' ? compactUsd.format(value / 100) : compact.format(value)
  const format = (value: number) => field === 'valueCents' ? money(value) : field === 'turnover' ? turns(value) : count.format(value)
  return <Panel title="Inventory by category" actions={<Field label="Category metric" value={metric} options={['Inventory value', 'Ending units', 'Turnover']} onChange={setMetric}/> }>
    {categories.some((category) => category[field] !== null) ? <div className="chart-wrap" aria-label={`${metric} by category`}>
      <ResponsiveContainer><BarChart data={categories} layout="vertical" margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#e7ece9" horizontal={false}/><XAxis type="number" tickFormatter={tick} tick={{ fontSize: 10 }}/>
        <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 11 }}/>
        <Tooltip formatter={(value) => format(Number(value))}/><Bar dataKey={field} name={metric} radius={[0, 5, 5, 0]} fill="#258a64" isAnimationActive={false}/>
      </BarChart></ResponsiveContainer></div> : <p className="inventory-empty">Turnover is undefined without average inventory value.</p>}
  </Panel>
}

function AgingChart({ aging }: Pick<InventoryView, 'aging'>) {
  const [metric, setMetric] = useState('Inventory value')
  const value = metric === 'Inventory value'
  return <Panel title="Stock aging" actions={<Field label="Aging metric" value={metric} options={['Inventory value', 'Units']} onChange={setMetric}/> }>
    <div className="chart-wrap" aria-label={`${metric} across FIFO age bands`}>
      <ResponsiveContainer><BarChart data={aging} margin={{ top: 10, right: 6, left: 4, bottom: 6 }}>
        <CartesianGrid stroke="#e7ece9" vertical={false}/><XAxis dataKey="band" interval={0} tick={{ fontSize: 9 }}/>
        <YAxis tickFormatter={(n: number) => value ? compactUsd.format(n / 100) : compact.format(n)} tick={{ fontSize: 10 }}/>
        <Tooltip formatter={(n) => value ? money(Number(n)) : count.format(Number(n))}/>
        <Bar dataKey={value ? 'valueCents' : 'units'} name={metric} radius={[5, 5, 0, 0]} fill="#258a64" isAnimationActive={false}/>
      </BarChart></ResponsiveContainer>
    </div>
    <p className="inventory-note">Age of remaining FIFO lots from their modeled receipt date to the selected month-end.</p>
  </Panel>
}

function Insights({ view }: { view: InventoryView }) {
  const top = view.categories[0]
  const cover = view.stores.filter((store) => store.cover !== null).sort((a, b) => b.cover! - a.cover!)[0]
  const old = view.aging.slice(3).reduce((sum, band) => sum + band.valueCents, 0)
  const maxAge = view.aging.at(-1)!
  const share = (part: number) => view.metrics.valueCents ? `${number.format(100 * part / view.metrics.valueCents)}%` : 'N/A'
  return <Panel title="Operational findings" wide>
    <ul className="inventory-insights">
      <li><strong>{top.name} holds {share(top.valueCents)} of selected inventory value.</strong> It carries {money(top.valueCents)} at period end and turned {turns(top.turnover)} in the period. Review receipt quantities against demand before changing purchase plans.</li>
      {cover && <li><strong>{cover.name} has the most cover in this selection at {days(cover.cover)}.</strong> Check whether stock can serve other stores with shorter modeled cover. This estimate uses trailing POS demand.</li>}
      <li><strong>{money(old)} is older than 90 days, including {money(maxAge.valueCents)} older than 180.</strong> Review old lots for redistribution or markdown using actual receipt and sell-through records.</li>
      <li><strong>{count.format(view.metrics.risks)} store–SKU pairs have cover shorter than lead time.</strong> Check inbound timing before ordering or transferring stock. Lead times and available balance are modeled.</li>
    </ul>
  </Panel>
}

function Quality({ data, filters }: { data: InventoryData; filters: InventoryFilters }) {
  const quality = data.quality
  const exceptions = selectExceptions(data, filters.start, filters.end)
  const report = [
    ['POS source lines', quality.sourceRows], ['Accepted POS lines', quality.sourceRowsAccepted],
    ['Quarantined POS lines', quality.sourceRowsQuarantined], ['Duplicate POS lines', quality.sourceDuplicates],
    ['Processed source day groups', quality.sourceDailyGroups], ['Processed movements', quality.movementRecords],
    ['Accepted movements', quality.acceptedMovements], ['Quarantined movements', quality.quarantinedMovements],
    ['Daily snapshots', quality.snapshots], ['Critical issues', quality.critical], ['Warnings', quality.warnings],
  ] as const
  const first = data.periods[0][1], last = data.periods.at(-1)![2]
  return <Panel title="Data quality" wide actions={<ExportButton label="Export reconciliation exceptions CSV"
    onClick={() => downloadCsv(`inventory-exceptions-${filters.start}_to_${filters.end}.csv`,
      ['Start month', 'End month', 'Scope', 'Severity', 'Check', 'Records', 'Affected POS lines', 'Units'],
      exceptions.map((row) => [filters.start, filters.end, 'Entire network', row.severity, row.code, row.records, row.sourceRows, row.units]))}/> }>
    <p className="inventory-note" role="status"><strong>{quality.valid ? 'Reconciled' : 'Validation failed'}</strong> · Full synthetic run {first} to {last} · Seed {data.seed}</p>
    <dl className="inventory-audit-grid">{report.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{count.format(value)}</dd></div>)}</dl>
    <details className="inventory-detail"><summary>Validation checks</summary><dl className="inventory-audit-grid">{Object.entries(quality.checks).map(([code, failures]) =>
      <div key={code}><dt>{issueName(code)}</dt><dd>{count.format(failures)}</dd></div>)}</dl>
      <p className="inventory-note">A critical issue quarantines the entire refresh and preserves the last approved export. Test mutations are confined to automated fixtures.</p>
    </details>
    <h3>Exceptions in the selected months</h3>
    <p className="inventory-note">Quality checks cover the entire network and follow the date filter only. Same-day receipts are warnings because they model a supply override to preserve recorded sales.</p>
    {exceptions.length ? <ul className="inventory-exceptions">{exceptions.map((row) => <li key={`${row.severity}/${row.code}`}>
      <span className="health-label attention">{row.severity}</span><strong>{issueName(row.code)}</strong>
      <span>{count.format(row.records)} records · {count.format(row.units)} units</span>
    </li>)}</ul> : <p className="inventory-empty">No exceptions in this date range.</p>}
  </Panel>
}

function Methods({ data }: { data: InventoryData }) {
  const { lookbackDays, safetyDays, slowUnits, overstockDays } = data.policy
  return <details className="panel inventory-panel inventory-wide inventory-detail">
    <summary>Inventory methodology</summary><dl className="inventory-methods">
      <div><dt>Stock and valuation</dt><dd>Closing units at the last selected month-end multiplied by the fixed SKU unit cost in USD.</dd></div>
      <div><dt>Turnover and days on hand</dt><dd>Turnover is net COGS divided by mean daily closing inventory value. Days on hand is the inverse ratio times the selected calendar days. Days on hand requires positive net COGS and turnover requires positive average value.</dd></div>
      <div><dt>Demand and replenishment</dt><dd>Coverage uses closing stock divided by daily fulfilled units over the last {lookbackDays} days or available history. No sales yields N/A. Reorder point equals rounded-up lead-time demand plus safety stock of {safetyDays} demand days, rounded up with a minimum of one. An alert requires positive demand and stock strictly below reorder point.</dd></div>
      <div><dt>Health precedence</dt><dd>Replenishment attention, then limited history, then stocked pairs with zero sales (non-moving), then stocked pairs with up to {slowUnits} sales units (slow-moving), then over {overstockDays} days of cover (overstocked), then healthy. Slow-moving value includes non-moving stock.</dd></div>
      <div><dt>Age and limitations</dt><dd>FIFO uses synthetic receipts, opening lots, and the date a return or stock gain was recorded. POS payments and refunds set unit flows. Simulated urgent receipts, costs, and policies cannot establish observed stockouts or outcomes.</dd></div>
    </dl>
  </details>
}

function InventoryWorkspace({ data }: { data: InventoryData }) {
  const [filters, setFilters] = useState(() => defaultInventoryFilters(data))
  const view = useMemo(() => selectInventory(data, filters), [data, filters])
  const alerts = useMemo(() => view?.products.filter((row) => row.alert)
    .sort((a, b) => Number(b.risk) - Number(a.risk) || (a.cover ?? Infinity) - (b.cover ?? Infinity)) ?? [], [view])
  const months = data.periods.map(([month]) => month)
  const categories = [...new Set(data.catalog.map((product) => product[2]))].sort()
  const update = (key: keyof InventoryFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  const selection = [view?.start ?? '', view?.end ?? '', filters.store || 'All', filters.category || 'All', filters.query || 'All', filters.health || 'All']
  const scopeHeaders = ['Start date', 'End date', 'Store filter', 'Category filter', 'SKU or product filter', 'Health filter']
  const exportRows = (kind: string, columns: Column<InventoryProduct>[], rows: InventoryProduct[]) =>
    downloadCsv(`inventory-${kind}-${filters.start}_to_${filters.end}.csv`, [...scopeHeaders, ...columns.map((column) => column.header)],
      rows.map((row) => [...selection, ...columns.map((column) => column.value(row))]))
  const summary = view?.metrics
  const kpis = summary && [
    ['Ending stock units', count.format(summary.ending), `Closing balance on ${view.end}`, Archive],
    ['Ending inventory value', money(summary.valueCents), 'Ending units valued at SKU cost', CircleDollarSign],
    ['Inventory turnover', summary.turnover === null ? 'N/A' : `${kpiRatio.format(summary.turnover)}×`, 'Net COGS ÷ mean daily stock value', RefreshCw],
    ['Days of inventory on hand', summary.dio === null ? 'N/A' : `${kpiRatio.format(summary.dio)} d`, 'Mean stock value ÷ net COGS × period days', CalendarDays],
    ['Below reorder point', count.format(summary.alerts), 'Based on on-hand stock and recent demand', AlertTriangle],
    ['Slow-moving inventory value', money(summary.slowCents), 'Includes non-moving stock', BarChart3],
  ] as const

  return <main className="dashboard-grid inventory-grid" id="inventory">
    <section className="page-heading"><div><p className="eyebrow">NORTHSTAR RETAIL BI</p><h1>Inventory Intelligence</h1>
      <p>Explore stock, turnover, aging, and replenishment across the store network.</p></div>
      <div className="data-badge"><span></span><div><strong>Synthetic case study</strong><small>{data.scope === 'licensed_demo' ? 'Demo catalog aliases' : 'Local POS catalog'} · Ridla A. Gani</small></div></div>
    </section>
    <section className="filter-bar inventory-filters" aria-label="Inventory filters">
      <div className="filter-title"><Filter size={16} />Filters</div>
      <Field label="From month" value={filters.start} options={months} onChange={(value) => update('start', value)}/>
      <Field label="Through month" value={filters.end} options={months} onChange={(value) => update('end', value)}/>
      <Field label="Store" value={filters.store} options={data.stores} all="All stores" onChange={(value) => update('store', value)}/>
      <Field label="Category" value={filters.category} options={categories} all="All categories" onChange={(value) => update('category', value)}/>
      <Field label="Inventory health" value={filters.health} options={data.policy.health} all="All classifications" onChange={(value) => update('health', value)}/>
      <label className="filter-control inventory-search"><span>SKU or product</span><div><PackageSearch size={14} aria-hidden="true" />
        <input type="search" aria-label="SKU or product" value={filters.query} onChange={(event) => update('query', event.target.value)} placeholder="Search catalog" />
        {filters.query && <button type="button" aria-label="Clear product search" onClick={() => update('query', '')}>×</button>}
      </div></label>
      <button className="reset-button" type="button" onClick={() => setFilters(defaultInventoryFilters(data))}><RefreshCw size={15} />Reset</button>
    </section>
    {view && view.products.length && summary && kpis ? <>
      <div className="inventory-scope inventory-wide"><p aria-live="polite">{view.start} to {view.end} · {count.format(view.products.length)} store–SKU pairs</p>
        <ExportButton label="Export inventory KPI summary CSV" onClick={() => downloadCsv(`inventory-summary-${filters.start}_to_${filters.end}.csv`,
          [...scopeHeaders, 'Period days', 'Ending units', 'Ending inventory value (USD)', 'Average inventory value (USD)', 'Net COGS (USD)',
            'Turnover (×)', 'Days of inventory on hand', 'Reorder alerts', 'Slow-moving inventory value (USD)'],
          [[...selection, view.days, summary.ending, dollars(summary.valueCents), dollars(summary.averageCents), dollars(summary.cogsCents),
            fraction(summary.turnover), fraction(summary.dio), summary.alerts, dollars(summary.slowCents)]])}/>
      </div>
      <section className="kpi-grid inventory-kpis" aria-label="Inventory KPIs">{kpis.map(([label, value, note, Icon]) =>
        <article className="kpi-card" key={label}><div className="kpi-head"><span>{label}</span><span className="icon-chip"><Icon size={17}/></span></div>
          <strong>{value}</strong><small>{note}</small></article>)}</section>
      <MovementChart trend={view.trend}/><CategoryChart categories={view.categories}/><AgingChart aging={view.aging}/>
      <Panel title="Store comparison" wide><DataTable name="Store comparison" rows={view.stores} columns={storeCols} rowKey={(row) => row.name} /></Panel>
      <Panel title="Product performance" wide actions={<ExportButton label="Export inventory product CSV" onClick={() => exportRows('products', productCols, view.products)}/> }>
        <DataTable name="Product performance" rows={view.products} columns={productCols} rowKey={productKey} />
      </Panel>
      <Panel title="Replenishment watchlist" wide actions={<ExportButton label="Export replenishment watchlist CSV" onClick={() => exportRows('watchlist', alertCols, alerts)}/> }>
        <p className="inventory-note">Estimates as of {view.end} use on-hand stock and {view.recentDays} days of demand. Review open orders and their due dates before taking action.</p>
        <DataTable name="Replenishment watchlist" rows={alerts} columns={alertCols} rowKey={productKey} />
      </Panel>
      <Insights view={view}/>
    </> : <section className="privacy-state" role="status"><AlertTriangle size={20}/><div><h2>{view ? 'No matching inventory' : 'Check the reporting period'}</h2>
      <p>{view ? 'Broaden your inventory filters or reset the selection.' : 'The through month must fall on or after the from month.'}</p></div></section>}
    <Quality data={data} filters={filters}/><Methods data={data}/>
    <p className="inventory-note inventory-wide">Adapted from {data.source.dataset_name} by {data.source.source_owner}. <a href={data.source.source_url} target="_blank" rel="noreferrer">Dataset</a> · <a href={data.source.license_url} target="_blank" rel="noreferrer">{data.source.license_name}</a></p>
  </main>
}

export default function InventoryDashboard() {
  const [data, setData] = useState<InventoryData | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const request = new AbortController()
    loadInventory(request.signal).then(setData).catch(() => { if (!request.signal.aborted) setFailed(true) })
    return () => request.abort()
  }, [])
  if (failed) return <main className="empty-shell"><section className="empty-card"><h1>Inventory export unavailable</h1>
    <p className="empty-copy">Generate the validated asset with <code>python -m retail_bi.inventory_pipeline</code> for local development.</p></section></main>
  return data ? <InventoryWorkspace data={data}/> : <main className="loading" role="status"><span></span>Loading inventory…</main>
}
