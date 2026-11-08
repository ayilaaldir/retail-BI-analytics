import type { DashboardData, DashboardView } from '../types'

export type Filters = { location: string; paymentMethod: string; category: string; year: string }

export const PRODUCTION_DASHBOARD_URL = '/data/dashboard.json'

export function viewKey(filters: Filters) {
  return [filters.year, filters.location, filters.paymentMethod, filters.category].join('|')
}

export function selectView(data: DashboardData, filters: Filters): DashboardView | null {
  return data.views[viewKey(filters)] ?? null
}
