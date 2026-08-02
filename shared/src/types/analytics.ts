/**
 * Analytics types for the dashboard analytics page.
 */

export interface CountBucket {
  key: string;
  count: number;
}

export interface AnalyticsSummary {
  totalAlerts: number;
  scenario1Count: number;
  scenario2Count: number;
  alertsPerDay: CountBucket[];
  alertsPerWeek: CountBucket[];
  alertsPerUnderlying: CountBucket[];
  alertsPerExpiry: CountBucket[];
  mostActiveSymbols: CountBucket[];
}
