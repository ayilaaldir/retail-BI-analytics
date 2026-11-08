export type KpiSet = {
  sales: number
  profit: number
  margin: number
  orders: number
  averageOrderValue: number
}

export type TrendPoint = { month: string; sales: number; profit: number; margin: number }
export type BreakdownPoint = { name: string; sales: number; profit: number; margin: number }
export type StatePoint = { state: string; sales: number; profit: number; margin: number }

export type DashboardData = {
  status: 'ready'
  generatedAt: string
  source: { name: string; rows: number; minDate: string; maxDate: string }
  filters: { regions: string[]; segments: string[]; categories: string[]; years: number[] }
  rows: Array<{
    orderDate: string
    region: string
    segment: string
    category: string
    discount: number
    sales: number
    profit: number
    orderId: string
  }>
  trend: TrendPoint[]
  categories: BreakdownPoint[]
  states: StatePoint[]
  regions: BreakdownPoint[]
  discounts: BreakdownPoint[]
  kpis: KpiSet
}

export type DataUnavailable = {
  status: 'unavailable'
  reason: string
  expectedPath?: string
}

export type DataPayload = DashboardData | DataUnavailable
