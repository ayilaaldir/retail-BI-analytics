export type KpiSet = {
  sales: number
  profit: number
  margin: number
  orders: number
  averageOrderValue: number
}

export type TrendPoint = { month: string; sales: number; profit: number; margin: number }
export type BreakdownPoint = { name: string; sales: number; profit: number; margin: number }

export type DashboardView = {
  kpis: KpiSet
  trend: TrendPoint[]
  categories: BreakdownPoint[]
  locations: BreakdownPoint[]
  discounts: BreakdownPoint[]
}

export type DashboardData = {
  status: 'ready'
  generatedAt: string
  source: {
    name: string
    creator: string
    rows: number
    minDate: string
    maxDate: string
    attributionUrl: string
    licenseName: string
    licenseUrl: string
    doi: string
    synthetic: true
    usageCondition: string
  }
  filters: { locations: string[]; paymentMethods: string[]; categories: string[]; years: number[] }
  privacy: { maxActiveFilters: number; minimumTransactionsPerAggregate: number; complementarySuppression: boolean }
  views: Record<string, DashboardView>
}

export type DataUnavailable = {
  status: 'unavailable'
  reason: string
  expectedPath?: string
}

export type DataPayload = DashboardData | DataUnavailable
