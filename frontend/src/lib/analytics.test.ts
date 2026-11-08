import { describe, expect, it } from 'vitest'
import { selectView, viewKey } from './analytics'
import type { DashboardData, DashboardView } from '../types'

const summary: DashboardView = {
  kpis: { sales: 150, profit: 15, margin: 0.1, orders: 2, averageOrderValue: 75 },
  trend: [], categories: [], locations: [], discounts: [],
}

const data = {
  status: 'ready',
  generatedAt: '2026-01-01T00:00:00Z',
  source: {
    name: 'Synthetic fixture', creator: 'Test Creator', rows: 2, minDate: '2024-01-01', maxDate: '2024-02-01',
    attributionUrl: 'https://example.com/dataset', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', doi: '10.test/example', synthetic: true, usageCondition: 'Test use only.',
  },
  filters: { locations: ['Store 01', 'Store 02'], paymentMethods: ['Card'], categories: ['Apparel'], years: [2024] },
  privacy: { maxActiveFilters: 3, minimumTransactionsPerAggregate: 10, complementarySuppression: true },
  views: {
    'All|All|All|All': summary,
    '2024|Store 01|All|All': { ...summary, kpis: { sales: 100, profit: 20, margin: 0.2, orders: 1, averageOrderValue: 100 } },
  },
} satisfies DashboardData

describe('analytics', () => {
  it('maps filters to a stable aggregate-view key', () => {
    expect(viewKey({ year: '2024', location: 'Store 01', paymentMethod: 'Card', category: 'Apparel' })).toBe('2024|Store 01|Card|Apparel')
  })

  it('selects the exact pre-aggregated filter view', () => {
    const selected = selectView(data, { year: '2024', location: 'Store 01', paymentMethod: 'All', category: 'All' })
    expect(selected).not.toBeNull()
    expect(selected!.kpis).toEqual({ sales: 100, profit: 20, margin: 0.2, orders: 1, averageOrderValue: 100 })
  })

  it('returns null for a withheld or unavailable filter combination', () => {
    const selected = selectView(data, { year: '2024', location: 'Store 02', paymentMethod: 'All', category: 'All' })
    expect(selected).toBeNull()
  })
})
