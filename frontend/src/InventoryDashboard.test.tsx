import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import InventoryDashboard from './InventoryDashboard'
import { defaultInventoryFilters, selectExceptions, selectInventory, toCsv, type InventoryData } from './lib/inventory'

vi.mock('recharts', async (importOriginal) => {
  const real = await importOriginal<typeof import('recharts')>()
  return { ...real, ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 520, height: 240 }) }
})

const data: InventoryData = {
  version: 1, scope: 'local', synthetic: true, seed: 42,
  source: { dataset_name: 'Fixture POS', source_owner: 'Fixture', source_url: 'https://example.org',
    license_name: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' },
  periods: [['2024-01', '2024-01-01', '2024-01-31', 31, 28], ['2024-02', '2024-02-01', '2024-02-29', 29, 28]],
  stores: ['North', 'South'], catalog: [['A-1', 'Cotton Tee', 'Apparel', 1000, 14], ['B-1', 'Face Wash', 'Beauty', 2000, 5]],
  policy: { lookbackDays: 28, safetyDays: 3, slowUnits: 2, overstockDays: 90,
    health: ['Healthy', 'Replenishment attention', 'Non-moving', 'Slow-moving', 'Overstocked', 'Limited history'] },
  series: [
    [0, 0, [[10, 0, 0, 2, 0, 0, 8, 280, 2, 2, 6, 2, 0, 0, 0, 0, 0, 0],
      [8, 22, 1, 21, 1, -1, 10, 290, 21, 14, 7, 3, 0, 0, 0, 1, 1, 1]]],
    [1, 1, [[2, 0, 0, 0, 0, 0, 2, 62, 0, 1, 2, 0, 0, 0, 0, 2, 0, 0],
      [2, 0, 0, 0, 0, 0, 2, 58, 0, 1, 0, 2, 0, 0, 0, 2, 0, 0]]],
  ],
  quality: { valid: true, sourceRows: 4, sourceRowsAccepted: 4, sourceRowsQuarantined: 0, sourceDuplicates: 0,
    sourceDailyGroups: 4, movementRecords: 8, acceptedMovements: 8, quarantinedMovements: 0, snapshots: 120,
    critical: 0, warnings: 1, sold: 23, returned: 1, checks: { sales_reconciliation: 0, same_day_receipt: 1 },
    exceptions: [], byPeriod: [['2024-02', 'warning', 'same_day_receipt', 1, 1, 0]] },
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const fixtureFetch = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('inventory')
  ? { ok: true, json: async () => data }
  : { ok: false }))

describe('inventory analytical filters', () => {
  it('uses ending snapshots, daily exposure, signed COGS, and ratio-of-sums', () => {
    const filters = defaultInventoryFilters(data)
    const view = selectInventory(data, filters)!
    expect(view.days).toBe(60)
    expect(view.metrics).toMatchObject({ ending: 12, valueCents: 14000, averageCents: 13500, cogsCents: 22000, alerts: 1, slowCents: 4000 })
    expect(view.metrics.turnover).toBeCloseTo(22000 / 13500)
    expect(view.metrics.dio).toBeCloseTo(13500 / 22000 * 60)
    expect(view.metrics.cover).toBeCloseTo(12 / (21 / 28))
    expect(view.aging.map((band) => band.units)).toEqual([7, 5, 0, 0, 0])
    const jan = selectInventory(data, { ...filters, end: '2024-01' })!
    expect(jan.metrics.ending).toBe(10)
    expect(jan.metrics.alerts).toBe(0)
    const narrow = selectInventory(data, { ...filters, store: 'North', category: 'Apparel', query: 'cotton' })!
    expect(narrow.trend[1]).toEqual({ month: '2024-02', opening: 8, receipts: 22, sameDay: 1, sold: -21, returned: 1, other: -1, closing: 10 })
    expect(narrow.categories.map((category) => category.name)).toEqual(['Apparel'])
    expect(narrow.metrics.averageCents).toBe(9500)
  })

  it('handles zero sales and COGS, empty selections, and quality scope', () => {
    const filters = defaultInventoryFilters(data)
    const view = selectInventory(data, { ...filters, health: 'Non-moving' })!
    expect(view.metrics).toMatchObject({ ending: 2, turnover: 0, dio: null, cover: null })
    expect(selectInventory(data, { ...filters, start: '2024-03' })).toBeNull()
    expect(selectInventory(data, { ...filters, query: 'missing' })?.products).toEqual([])
    expect(selectExceptions(data, '2024-01', '2024-01')).toEqual([])
    expect(selectExceptions(data, '2024-02', '2024-02')[0]).toMatchObject({ records: 1, units: 1 })
  })

  it('writes CSV safely with numeric values and blank undefined metrics', () => {
    expect(toCsv(['Product', 'Units', 'Coverage'], [['=sum(1,2) "test"', -2, null]])).toBe(
      `"Product","Units","Coverage"\r\n"'=sum(1,2) ""test""",-2,\r\n`,
    )
  })
})

describe('inventory workspace', () => {
  it('updates cards, charts and the watchlist and resets empty filters', async () => {
    fixtureFetch()
    render(<InventoryDashboard />)
    expect(await screen.findByRole('heading', { name: 'Inventory Intelligence' })).toBeInTheDocument()
    const cards = screen.getByRole('region', { name: 'Inventory KPIs' })
    const inventoryValue = within(cards).getByText('Ending inventory value').closest('article')!
    expect(within(inventoryValue).getByText('$140.00')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Replenishment watchlist' })).getByText('A-1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Category', { selector: 'select' }), { target: { value: 'Beauty' } })
    expect(within(inventoryValue).getByText('$40.00')).toBeInTheDocument()
    const categoryChart = screen.getByLabelText('Inventory value by category')
    expect(within(categoryChart).getByText('Beauty')).toBeInTheDocument()
    expect(within(categoryChart).queryByText('Apparel')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Replenishment watchlist' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'SKU or product' }), { target: { value: 'missing' } })
    expect(screen.getByRole('heading', { name: 'No matching inventory' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('table', { name: 'Replenishment watchlist' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From month'), { target: { value: '2024-02' } })
    fireEvent.change(screen.getByLabelText('Through month'), { target: { value: '2024-01' } })
    expect(screen.getByRole('heading', { name: 'Check the reporting period' })).toBeInTheDocument()
  })

  it('sorts products numerically and downloads the filtered CSV', async () => {
    fixtureFetch()
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:inventory-fixture')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<InventoryDashboard />)
    const table = await screen.findByRole('table', { name: 'Product performance' })
    fireEvent.click(within(table).getByRole('button', { name: 'Ending units' }))
    expect(within(within(table).getAllByRole('row')[1]).getByText('B-1')).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'Ending units' }))
    expect(within(within(table).getAllByRole('row')[1]).getByText('A-1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Store', { selector: 'select' }), { target: { value: 'North' } })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Export inventory product CSV' }))
    vi.runAllTimers()
    vi.useRealTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:inventory-fixture')
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('inventory-products-2024-01_to_2024-02.csv')
    const contents = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(createObjectURL.mock.calls[0][0])
    })
    expect(contents).toContain('"North"')
    expect(contents).toContain('"A-1"')
    expect(contents).not.toContain('"B-1"')
  })

  it('supports hash navigation from inventory back to the existing overview', async () => {
    fixtureFetch()
    vi.stubGlobal('scrollTo', vi.fn())
    window.history.replaceState(null, '', '/#inventory')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Inventory Intelligence' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inventory Intelligence' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }))
    expect(await screen.findByRole('heading', { name: 'Your intelligence workspace is ready.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  })
})
