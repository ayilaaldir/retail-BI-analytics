import { describe, expect, it } from 'vitest'
import { filterRows, summarize } from './analytics'
import type { DashboardData } from '../types'

const data = {
  rows: [
    { orderDate: '2024-01-01', region: 'West', segment: 'Consumer', category: 'Office', discount: 0, sales: 100, profit: 20, orderId: 'A' },
    { orderDate: '2024-02-01', region: 'East', segment: 'Corporate', category: 'Tech', discount: 0.5, sales: 50, profit: -5, orderId: 'B' },
  ],
} as DashboardData

describe('analytics', () => {
  it('filters rows across dimensions', () => expect(filterRows(data, { region: 'West', segment: 'All', category: 'All', year: '2024' })).toHaveLength(1))
  it('computes KPIs from rows', () => expect(summarize(data.rows).kpis).toEqual({ sales: 150, profit: 15, margin: 0.1, orders: 2, averageOrderValue: 75 }))
  it('recalculates region and discount performance', () => {
    const summary = summarize(data.rows)
    expect(summary.regions).toHaveLength(2)
    expect(summary.discounts.map((item) => item.name)).toEqual(['No discount', 'Above 40%'])
    expect(summary.discounts[1].profit).toBe(-5)
  })
})
