import type { BreakdownPoint, DashboardData, KpiSet, TrendPoint } from '../types'

export type Filters = { region: string; segment: string; category: string; year: string }

export function filterRows(data: DashboardData, filters: Filters) {
  return data.rows.filter((row) => {
    const year = new Date(row.orderDate).getUTCFullYear().toString()
    return (filters.region === 'All' || row.region === filters.region)
      && (filters.segment === 'All' || row.segment === filters.segment)
      && (filters.category === 'All' || row.category === filters.category)
      && (filters.year === 'All' || year === filters.year)
  })
}

export function summarize(rows: DashboardData['rows']): { kpis: KpiSet; trend: TrendPoint[]; categories: BreakdownPoint[]; regions: BreakdownPoint[]; discounts: BreakdownPoint[] } {
  const sales = rows.reduce((sum, row) => sum + row.sales, 0)
  const profit = rows.reduce((sum, row) => sum + row.profit, 0)
  const orders = new Set(rows.map((row) => row.orderId)).size
  const kpis = { sales, profit, margin: sales ? profit / sales : 0, orders, averageOrderValue: orders ? sales / orders : 0 }
  const months = new Map<string, { sales: number; profit: number }>()
  const groups = new Map<string, { sales: number; profit: number }>()
  const regionGroups = new Map<string, { sales: number; profit: number }>()
  const discountGroups = new Map<string, { sales: number; profit: number }>()

  const addToGroup = (groups: Map<string, { sales: number; profit: number }>, key: string, row: DashboardData['rows'][number]) => {
    const values = groups.get(key) ?? { sales: 0, profit: 0 }
    values.sales += row.sales
    values.profit += row.profit
    groups.set(key, values)
  }

  const discountBand = (discount: number) => {
    if (discount === 0) return 'No discount'
    if (discount <= 0.2) return '0–20%'
    if (discount <= 0.4) return '21–40%'
    return 'Above 40%'
  }

  rows.forEach((row) => {
    const month = row.orderDate.slice(0, 7)
    const monthValues = months.get(month) ?? { sales: 0, profit: 0 }
    monthValues.sales += row.sales
    monthValues.profit += row.profit
    months.set(month, monthValues)
    addToGroup(groups, row.category, row)
    addToGroup(regionGroups, row.region, row)
    addToGroup(discountGroups, discountBand(row.discount), row)
  })

  const trend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, ...value, margin: value.sales ? value.profit / value.sales : 0 }))
  const categories = [...groups.entries()].map(([name, value]) => ({ name, ...value, margin: value.sales ? value.profit / value.sales : 0 })).sort((a, b) => b.sales - a.sales)
  const regions = [...regionGroups.entries()].map(([name, value]) => ({ name, ...value, margin: value.sales ? value.profit / value.sales : 0 })).sort((a, b) => b.sales - a.sales)
  const discountOrder = ['No discount', '0–20%', '21–40%', 'Above 40%']
  const discounts = [...discountGroups.entries()].map(([name, value]) => ({ name, ...value, margin: value.sales ? value.profit / value.sales : 0 })).sort((a, b) => discountOrder.indexOf(a.name) - discountOrder.indexOf(b.name))
  return { kpis, trend, categories, regions, discounts }
}
