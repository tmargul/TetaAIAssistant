/**
 * Stage 3H — typed report period contract.
 * Dates are YYYY-MM-DD strings; never JavaScript Date in the business contract.
 */

export const STAGE3H_PERIOD_CONTRACT_VERSION = 'teta-aia-report-period-v1' as const;
export const STAGE3H_PERIOD_LANGUAGE_VERSION = 'teta-report-period-language-pl-v1' as const;

export const STAGE3H_MAX_PERIOD_DAYS = 366;
export const STAGE3H_MIN_PERIOD_DAYS = 1;

export type TetaReportPeriodKind =
  | 'current_month'
  | 'next_month'
  | 'next_n_days'
  | 'explicit_date_range';

export type TetaReportPeriod =
  | {
      kind: 'current_month';
      source: 'user_text';
      normalizedLabel: string;
    }
  | {
      kind: 'next_month';
      source: 'user_text';
      normalizedLabel: string;
    }
  | {
      kind: 'next_n_days';
      source: 'user_text';
      days: number;
      normalizedLabel: string;
    }
  | {
      kind: 'explicit_date_range';
      source: 'user_text';
      startDate: string;
      endDateInclusive: string;
      normalizedLabel: string;
    };

export type TetaReportPeriodResolutionStatus =
  | 'resolved'
  | 'missing'
  | 'ambiguous'
  | 'invalid';

export type TetaReportPeriodResolution = {
  status: TetaReportPeriodResolutionStatus;
  period: TetaReportPeriod | null;
  clarificationQuestion: string | null;
  errors: string[];
};

/** Safe metadata that may be persisted / shown to the client. */
export type TetaReportPeriodClientMeta = {
  periodKind: TetaReportPeriodKind | null;
  normalizedLabel: string | null;
  startDate: string | null;
  endDateInclusive: string | null;
  days: number | null;
};

export type TetaOracleBindDefinition = {
  name: string;
  position: number;
  oracleType: 'NUMBER' | 'VARCHAR2';
  semanticType: 'positive_integer_days' | 'local_date';
  sourceParameterId: 'report_period_days' | 'report_period_start_date' | 'report_period_end_date';
};

export type TetaOracleExecutionBindValues = Record<string, string | number>;

export function emptyPeriodResolution(
  status: TetaReportPeriodResolutionStatus = 'missing',
  errors: string[] = [],
  clarificationQuestion: string | null = null,
): TetaReportPeriodResolution {
  return {
    status,
    period: null,
    clarificationQuestion,
    errors,
  };
}

export function periodToClientMeta(
  period: TetaReportPeriod | null | undefined,
): TetaReportPeriodClientMeta {
  if (!period) {
    return {
      periodKind: null,
      normalizedLabel: null,
      startDate: null,
      endDateInclusive: null,
      days: null,
    };
  }
  if (period.kind === 'next_n_days') {
    return {
      periodKind: period.kind,
      normalizedLabel: period.normalizedLabel,
      startDate: null,
      endDateInclusive: null,
      days: period.days,
    };
  }
  if (period.kind === 'explicit_date_range') {
    return {
      periodKind: period.kind,
      normalizedLabel: period.normalizedLabel,
      startDate: period.startDate,
      endDateInclusive: period.endDateInclusive,
      days: null,
    };
  }
  return {
    periodKind: period.kind,
    normalizedLabel: period.normalizedLabel,
    startDate: null,
    endDateInclusive: null,
    days: null,
  };
}

export function formatPolishDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
