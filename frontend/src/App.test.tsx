import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { DashboardData } from './types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('dashboard data integration', () => {
  it('shows the publication-safe empty state when no browser export exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your intelligence workspace is ready.' })).toBeInTheDocument()
    expect(screen.getByText(/No sample business values are shown/)).toBeInTheDocument()
  })

  it('renders KPIs from a validated payload', async () => {
    const payload: DashboardData = {
      status: 'ready',
      generatedAt: '2026-01-01T00:00:00Z',
      source: { name: 'Synthetic test fixture', rows: 1, minDate: '2024-01-01', maxDate: '2024-01-01' },
      filters: { regions: ['West'], segments: ['Consumer'], categories: ['Office'], years: [2024] },
      rows: [{ orderDate: '2024-01-01', region: 'West', segment: 'Consumer', category: 'Office', discount: 0, sales: 100, profit: 20, orderId: 'TEST-1' }],
      trend: [],
      categories: [],
      states: [],
      regions: [],
      discounts: [],
      kpis: { sales: 100, profit: 20, margin: 0.2, orders: 1, averageOrderValue: 100 },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Profitability command center' })).toBeInTheDocument()
    const salesCard = screen.getByText('Net sales').closest('article')
    expect(salesCard).not.toBeNull()
    expect(within(salesCard!).getByText(/^\$100(?:\.0)?$/)).toBeInTheDocument()
    const marginCard = screen.getByText('Profit margin').closest('article')
    expect(marginCard).not.toBeNull()
    expect(within(marginCard!).getByText('20%')).toBeInTheDocument()
  })
})
