import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, BarChart3, ChevronDown, CircleDollarSign, Database, Filter, Info, PackageSearch, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import { filterRows, summarize, type Filters } from './lib/analytics'
import type { DataPayload, DashboardData } from './types'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })
const initialFilters: Filters = { region: 'All', segment: 'All', category: 'All', year: 'All' }

function SelectFilter({ label, value, values, onChange }: { label: string; value: string; values: Array<string | number>; onChange: (value: string) => void }) {
  return <label className="filter-control"><span>{label}</span><div><select value={value} onChange={(event) => onChange(event.target.value)}><option>All</option>{values.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div></label>
}

function KpiCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof TrendingUp }) {
  return <article className="kpi-card"><div className="kpi-head"><span>{label}</span><span className="icon-chip"><Icon size={17} /></span></div><strong>{value}</strong><small>{note}</small></article>
}

function EmptyState({ reason }: { reason: string }) {
  return <main className="empty-shell"><section className="empty-card"><span className="empty-icon"><Database size={28} /></span><p className="eyebrow">DATA CONNECTION</p><h1>Your intelligence workspace is ready.</h1><p className="empty-copy">{reason}</p><div className="empty-steps">
    <div><span>01</span><p><strong>Add the real dataset</strong><small>Place the Kaggle Superstore CSV in <code>data/raw/</code>.</small></p></div>
    <div><span>02</span><p><strong>Verify its license</strong><small>Complete <code>data/source_manifest.json</code> before publication.</small></p></div>
    <div><span>03</span><p><strong>Build the analytics</strong><small>Run the pipeline with <code>--local-export</code> for a private preview.</small></p></div>
  </div><div className="integrity-note"><AlertTriangle size={17} /><span>No sample business values are shown. Every KPI will come from your validated source data.</span></div></section></main>
}

function Dashboard({ data }: { data: DashboardData }) {
  const [filters, setFilters] = useState(initialFilters)
  const rows = useMemo(() => filterRows(data, filters), [data, filters])
  const analytics = useMemo(() => summarize(rows), [rows])
  const activeCount = Object.values(filters).filter((value) => value !== 'All').length
  const updateFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }))
  return <main className="dashboard-grid" id="overview">
    <section className="page-heading"><div><p className="eyebrow">PERFORMANCE OVERVIEW</p><h1>Profitability command center</h1><p>Follow revenue quality, margin movement, and category performance.</p></div><div className="data-badge"><span></span><div><strong>Validated data</strong><small>{whole.format(data.source.rows)} rows · through {data.source.maxDate}</small></div></div></section>
    <section className="filter-bar"><div className="filter-title"><Filter size={16} /><span>Filters</span>{activeCount > 0 && <em>{activeCount}</em>}</div>
      <SelectFilter label="Year" value={filters.year} values={data.filters.years} onChange={(v) => updateFilter('year', v)} /><SelectFilter label="Region" value={filters.region} values={data.filters.regions} onChange={(v) => updateFilter('region', v)} /><SelectFilter label="Segment" value={filters.segment} values={data.filters.segments} onChange={(v) => updateFilter('segment', v)} /><SelectFilter label="Category" value={filters.category} values={data.filters.categories} onChange={(v) => updateFilter('category', v)} /><button className="reset-button" onClick={() => setFilters(initialFilters)} disabled={!activeCount}><RefreshCw size={15} />Reset</button>
    </section>
    <section className="kpi-grid"><KpiCard label="Net sales" value={money.format(analytics.kpis.sales)} note="Gross merchandise value" icon={CircleDollarSign} /><KpiCard label="Total profit" value={money.format(analytics.kpis.profit)} note={analytics.kpis.profit >= 0 ? 'Positive contribution' : 'Loss-making selection'} icon={TrendingUp} /><KpiCard label="Profit margin" value={percent.format(analytics.kpis.margin)} note="Profit as a share of sales" icon={BarChart3} /><KpiCard label="Orders" value={whole.format(analytics.kpis.orders)} note={`AOV ${money.format(analytics.kpis.averageOrderValue)}`} icon={ShoppingBag} /></section>
    <section className="panel trend-panel"><div className="panel-heading"><div><p className="eyebrow">MOMENTUM</p><h2>Sales & profit trend</h2></div><div className="legend"><span className="sales-dot"></span>Sales<span className="profit-dot"></span>Profit</div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics.trend} margin={{ top: 18, right: 8, left: -12, bottom: 0 }}><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#30b37d" stopOpacity={0.32}/><stop offset="100%" stopColor="#30b37d" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#e7ece9" vertical={false}/><XAxis dataKey="month" tickFormatter={(v) => v.slice(2)} tickLine={false} axisLine={false} tick={{ fill: '#6e7e77', fontSize: 11 }}/><YAxis tickFormatter={(v) => money.format(v)} tickLine={false} axisLine={false} tick={{ fill: '#6e7e77', fontSize: 11 }}/><Tooltip formatter={(v) => money.format(Number(v))} labelStyle={{ color: '#0d2119' }}/><Area type="monotone" dataKey="sales" stroke="#16865d" strokeWidth={2.5} fill="url(#salesFill)"/><Line type="monotone" dataKey="profit" stroke="#d99a35" strokeWidth={2.2} dot={false}/></AreaChart></ResponsiveContainer></div></section>
    <section className="panel category-panel"><div className="panel-heading"><div><p className="eyebrow">PORTFOLIO MIX</p><h2>Category economics</h2></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.categories} layout="vertical" margin={{ top: 10, right: 18, left: 6, bottom: 0 }}><CartesianGrid stroke="#e7ece9" horizontal={false}/><XAxis type="number" tickFormatter={(v) => money.format(v)} axisLine={false} tickLine={false} tick={{ fill: '#6e7e77', fontSize: 11 }}/><YAxis type="category" dataKey="name" width={82} axisLine={false} tickLine={false} tick={{ fill: '#263c33', fontSize: 12 }}/><Tooltip formatter={(v) => money.format(Number(v))}/><Bar dataKey="sales" radius={[0, 5, 5, 0]}>{analytics.categories.map((entry, index) => <Cell key={entry.name} fill={['#147d58', '#2ca477', '#72c5a2'][index % 3]} />)}</Bar></BarChart></ResponsiveContainer></div></section>
    <section className="panel region-panel"><div className="panel-heading"><div><p className="eyebrow">REGIONAL HEALTH</p><h2>Profit contribution by region</h2></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.regions} layout="vertical" margin={{ top: 10, right: 18, left: 6, bottom: 0 }}><CartesianGrid stroke="#e7ece9" horizontal={false}/><XAxis type="number" tickFormatter={(v) => money.format(v)} axisLine={false} tickLine={false} tick={{ fill: '#6e7e77', fontSize: 11 }}/><YAxis type="category" dataKey="name" width={62} axisLine={false} tickLine={false} tick={{ fill: '#263c33', fontSize: 12 }}/><Tooltip formatter={(v) => money.format(Number(v))}/><Bar dataKey="profit" radius={[0, 5, 5, 0]}>{analytics.regions.map((entry) => <Cell key={entry.name} fill={entry.profit < 0 ? '#d56c58' : '#248e68'} />)}</Bar></BarChart></ResponsiveContainer></div></section>
    <section className="panel discount-panel"><div className="panel-heading"><div><p className="eyebrow">DISCOUNT EFFICIENCY</p><h2>Margin by discount band</h2></div></div><div className="economic-table"><div className="table-head"><span>Band</span><span>Sales</span><span>Profit</span><span>Margin</span></div>{analytics.discounts.map((band) => <div className="table-row" key={band.name}><strong>{band.name}</strong><span>{money.format(band.sales)}</span><span className={band.profit < 0 ? 'negative-text' : ''}>{money.format(band.profit)}</span><span className={band.margin < 0 ? 'negative-text' : ''}>{percent.format(band.margin)}</span></div>)}</div><p className="panel-note"><Info size={15} />Discount bands respond to every active filter.</p></section>
    <section className="panel margin-panel"><div className="panel-heading"><div><p className="eyebrow">MARGIN WATCH</p><h2>Category profitability</h2></div></div><div className="margin-list">{analytics.categories.map((category) => <div className="margin-row" key={category.name}><span>{category.name}</span><div className="margin-track"><i style={{ width: `${Math.min(Math.abs(category.margin) * 220, 100)}%` }} className={category.margin < 0 ? 'negative' : ''}></i></div><strong className={category.margin < 0 ? 'negative-text' : ''}>{percent.format(category.margin)}</strong></div>)}</div><p className="panel-note"><Info size={15} />Margins recalculate with every filter selection.</p></section>
  </main>
}

function App() {
  const [payload, setPayload] = useState<DataPayload | null>(null)
  useEffect(() => { fetch(import.meta.env.DEV ? '/__local/dashboard.json' : '/data/dashboard.json').then((response) => response.ok ? response.json() : Promise.reject()).then(setPayload).catch(() => setPayload({ status: 'unavailable', reason: 'No validated export was found. Load the source dataset to activate the dashboard.' })) }, [])
  return <div className="app-shell"><header className="topbar"><a className="brand" href="/"><span><PackageSearch size={21} /></span><div><strong>Northstar</strong><small>RETAIL INTELLIGENCE</small></div></a><nav><a className="active" href="#overview">Overview</a><a href="#methodology">Methodology</a></nav><div className="source-pill"><Database size={14}/>{payload?.status === 'ready' ? 'Source connected' : 'Awaiting data'}</div></header>{payload === null ? <main className="loading"><span></span>Loading workspace…</main> : payload.status === 'ready' ? <Dashboard data={payload} /> : <EmptyState reason={payload.reason} />}<footer><span>Northstar Retail BI</span><span>Validated with Pandas · Queried with DuckDB</span></footer></div>
}

export default App
