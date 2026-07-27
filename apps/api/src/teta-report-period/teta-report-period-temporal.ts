/**
 * Stage 3H — build Stage 3C temporal filter AST from a resolved TetaReportPeriod.
 * Never emits SQL or bind values — only typed AST + parameter ids.
 */
import type { QueryFilter } from '../teta-query-planner/teta-query-plan.types';
import type { TetaReportPeriod } from './teta-report-period.types';

export type PeriodTemporalPlan = {
  filter: QueryFilter;
  reportParameters: {
    period: TetaReportPeriod;
  };
};

/**
 * Rewrites the BHP examination_valid_to filter for the given period.
 * Column evidence is preserved from the existing current-month filter.
 */
export function buildPeriodExaminationFilter(options: {
  period: TetaReportPeriod;
  baseFilter: Extract<QueryFilter, { type: 'half_open_date_interval' }>;
}): PeriodTemporalPlan {
  const { period, baseFilter } = options;
  const common = {
    filterRole: baseFilter.filterRole,
    status: baseFilter.status,
    columnOracleNodeId: baseFilter.columnOracleNodeId,
    columnBusinessRole: baseFilter.columnBusinessRole,
    provenanceNodeIds: baseFilter.provenanceNodeIds,
    provenanceEdgeIds: baseFilter.provenanceEdgeIds,
  };

  if (period.kind === 'current_month') {
    return {
      reportParameters: { period },
      filter: {
        ...common,
        type: 'half_open_date_interval',
        lowerBoundary: {
          clock: 'oracle_sysdate',
          transform: 'month_start',
          offsetMonths: 0,
          inclusive: true,
        },
        upperBoundary: {
          clock: 'oracle_sysdate',
          transform: 'month_start',
          offsetMonths: 1,
          inclusive: false,
        },
      },
    };
  }

  if (period.kind === 'next_month') {
    return {
      reportParameters: { period },
      filter: {
        ...common,
        type: 'half_open_date_interval',
        lowerBoundary: {
          clock: 'oracle_sysdate',
          transform: 'month_start',
          offsetMonths: 1,
          inclusive: true,
        },
        upperBoundary: {
          clock: 'oracle_sysdate',
          transform: 'month_start',
          offsetMonths: 2,
          inclusive: false,
        },
      },
    };
  }

  if (period.kind === 'next_n_days') {
    return {
      reportParameters: { period },
      filter: {
        ...common,
        type: 'rolling_date_interval',
        clock: 'oracle_sysdate',
        startTransform: 'day_start',
        daysParameterId: 'report_period_days',
        lowerInclusive: true,
        upperInclusive: false,
      },
    };
  }

  return {
    reportParameters: { period },
    filter: {
      ...common,
      type: 'explicit_local_date_interval',
      startParameterId: 'report_period_start_date',
      endInclusiveParameterId: 'report_period_end_date',
      lowerInclusive: true,
      upperInclusive: true,
      dateSemantics: 'oracle_local_date',
    },
  };
}

export function applyPeriodToQueryFilters(
  filters: QueryFilter[],
  period: TetaReportPeriod,
): { filters: QueryFilter[]; applied: boolean } {
  const idx = filters.findIndex(
    (f) =>
      f.filterRole === 'examination_valid_to_in_current_month' &&
      f.type === 'half_open_date_interval',
  );
  if (idx < 0) return { filters, applied: false };
  const base = filters[idx] as Extract<QueryFilter, { type: 'half_open_date_interval' }>;
  const planned = buildPeriodExaminationFilter({ period, baseFilter: base });
  const next = [...filters];
  next[idx] = planned.filter;
  return { filters: next, applied: true };
}

export function routeIdForPeriod(period: TetaReportPeriod): string {
  switch (period.kind) {
    case 'current_month':
      return 'occupational_health_examinations_current_month';
    case 'next_month':
      return 'occupational_health_examinations_next_month';
    case 'next_n_days':
      return 'occupational_health_examinations_next_n_days';
    case 'explicit_date_range':
      return 'occupational_health_examinations_date_range';
  }
}
