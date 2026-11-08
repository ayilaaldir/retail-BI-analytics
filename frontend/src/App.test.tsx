import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PRODUCTION_DASHBOARD_URL } from './lib/analytics'
import type { DashboardData } from './types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('dashboard data integration', () => {
  it('uses only the approved static asset path in production', () => {
    expect(PRODUCTION_DASHBOARD_URL).toBe('/data/dashboard.json')
  })

  it('shows the publication-safe empty state when no browser export exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Your intelligence workspace is ready.' })).toBeInTheDocument()
    expect(screen.getByText(/No placeholder values are shown/)).toBeInTheDocument()
  })

  it('renders KPIs from a validated payload', async () => {
    const payload: DashboardData = {
      status: 'ready',
      generatedAt: '2026-01-01T00:00:00Z',
      source: { name: 'Synthetic test fixture', creator: 'Test Creator', rows: 1, minDate: '2024-01-01', maxDate: '2024-01-01', attributionUrl: 'https://example.com/dataset', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', doi: '10.test/example', synthetic: true, usageCondition: 'Test use only.' },
      filters: { locations: ['Store 01'], paymentMethods: ['Card'], categories: ['Apparel'], years: [2024] },
      privacy: { maxActiveFilters: 3, minimumTransactionsPerAggregate: 10, complementarySuppression: true },
      views: {
        'All|All|All|All': {
          trend: [], categories: [], locations: [], discounts: [],
          kpis: { sales: 100, profit: 20, margin: 0.2, orders: 1, averageOrderValue: 100 },
        },
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Multi-store profitability command center' })).toBeInTheDocument()
    const salesCard = screen.getAllByText('Net sales')[0].closest('article')
    expect(salesCard).not.toBeNull()
    expect(within(salesCard!).getByText(/^\$100(?:\.0)?$/)).toBeInTheDocument()
    const marginCard = screen.getByText('Gross margin').closest('article')
    expect(marginCard).not.toBeNull()
    expect(within(marginCard!).getByText('20%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Synthetic test fixture' })).toHaveAttribute('href', 'https://example.com/dataset')
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/')
  })

  it('prevents a fourth simultaneous filter to avoid fine-grained cells', async () => {
    const payload: DashboardData = {
      status: 'ready', generatedAt: '2026-01-01T00:00:00Z',
      source: { name: 'Fixture', creator: 'Test Creator', rows: 100, minDate: '2024-01-01', maxDate: '2024-12-31', attributionUrl: 'https://example.com/dataset', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', doi: '10.test/example', synthetic: true, usageCondition: 'Test use only.' },
      filters: { locations: ['Store 01'], paymentMethods: ['Card'], categories: ['Apparel'], years: [2024] },
      privacy: { maxActiveFilters: 3, minimumTransactionsPerAggregate: 10, complementarySuppression: true },
      views: { 'All|All|All|All': { trend: [], categories: [], locations: [], discounts: [], kpis: { sales: 100, profit: 20, margin: 0.2, orders: 20, averageOrderValue: 5 } } },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Multi-store profitability command center' })
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2024' } })
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'Store 01' } })
    fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'Card' } })
    expect(screen.getByLabelText('Category')).toBeDisabled()
  })
})
