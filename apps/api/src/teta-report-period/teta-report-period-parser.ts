/**
 * Stage 3H — deterministic Polish report-period parser.
 * No LLM. No Node clock for relative periods (those stay relative to Oracle SYSDATE).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  compareIsoLocalDates,
  inclusiveDaySpan,
  isValidIsoLocalDate,
  toIsoLocalDate,
} from './teta-report-period-calendar';
import {
  STAGE3H_MAX_PERIOD_DAYS,
  STAGE3H_MIN_PERIOD_DAYS,
  STAGE3H_PERIOD_LANGUAGE_VERSION,
  emptyPeriodResolution,
  formatPolishDateLabel,
  type TetaReportPeriod,
  type TetaReportPeriodResolution,
} from './teta-report-period.types';

export type Stage3hPeriodLanguageConfig = {
  contractVersion: string;
  maxPeriodDays: number;
  minPeriodDays: number;
  currentMonthPhrases: string[];
  nextMonthPhrases: string[];
  nextNDaysPatterns: string[];
  explicitRangePatterns: string[];
  monthNames: Record<string, number>;
};

let cachedConfig: Stage3hPeriodLanguageConfig | null = null;

export function defaultPeriodLanguageConfigPath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-report-period-language-pl-v1.json');
}

export function loadPeriodLanguageConfig(filePath: string): Stage3hPeriodLanguageConfig {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Stage3hPeriodLanguageConfig;
  if (raw.contractVersion !== STAGE3H_PERIOD_LANGUAGE_VERSION) {
    throw new Error(
      `Unexpected period language contractVersion=${raw.contractVersion}; expected ${STAGE3H_PERIOD_LANGUAGE_VERSION}`,
    );
  }
  return raw;
}

export function getPeriodLanguageConfig(apiRoot?: string): Stage3hPeriodLanguageConfig {
  if (cachedConfig) return cachedConfig;
  const root =
    apiRoot ??
    (existsSync(path.join(process.cwd(), 'config', 'teta-report-period-language-pl-v1.json'))
      ? process.cwd()
      : path.join(process.cwd(), 'apps', 'api'));
  cachedConfig = loadPeriodLanguageConfig(defaultPeriodLanguageConfigPath(root));
  return cachedConfig;
}

/** Test helper. */
export function resetPeriodLanguageConfigCache(): void {
  cachedConfig = null;
}

function normalizeQuestion(question: string): string {
  return question
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumericDateToken(token: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (iso) {
    return toIsoLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const dotted = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(token);
  if (dotted) {
    return toIsoLocalDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
  }
  return null;
}

function parsePolishNamedDate(
  token: string,
  monthNames: Record<string, number>,
): string | null {
  const m = /^(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})$/u.exec(token.trim().toLowerCase());
  if (!m) return null;
  const day = Number(m[1]);
  const month = monthNames[m[2]!];
  const year = Number(m[3]);
  if (!month) return null;
  return toIsoLocalDate(year, month, day);
}

function parseDateToken(
  token: string,
  monthNames: Record<string, number>,
): { ok: true; iso: string } | { ok: false; reason: string } {
  const numeric = parseNumericDateToken(token);
  if (numeric) return { ok: true, iso: numeric };
  const named = parsePolishNamedDate(token, monthNames);
  if (named) return { ok: true, iso: named };
  if (/\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2}/.test(token)) {
    return { ok: false, reason: 'invalid_calendar_date' };
  }
  return { ok: false, reason: 'unparseable_date' };
}

function matchPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase.toLowerCase()));
}

export function resolveReportPeriod(
  question: string,
  config: Stage3hPeriodLanguageConfig = getPeriodLanguageConfig(),
): TetaReportPeriodResolution {
  const text = normalizeQuestion(question);
  const hits: TetaReportPeriod[] = [];
  const errors: string[] = [];

  const currentHit = matchPhrase(text, config.currentMonthPhrases);
  const nextHit = matchPhrase(text, config.nextMonthPhrases);

  let nextNDays: { days: number } | null = null;
  for (const pattern of config.nextNDaysPatterns) {
    const re = new RegExp(pattern, 'iu');
    const m = re.exec(text);
    if (m?.[1]) {
      const days = Number(m[1]);
      nextNDays = { days };
      break;
    }
  }

  let explicit:
    | { start: string; end: string }
    | { invalid: string }
    | null = null;
  for (const pattern of config.explicitRangePatterns) {
    const re = new RegExp(pattern, 'iu');
    const m = re.exec(text);
    if (!m?.[1] || !m[2]) continue;
    const startParsed = parseDateToken(m[1], config.monthNames);
    const endParsed = parseDateToken(m[2], config.monthNames);
    if (!startParsed.ok) {
      explicit = { invalid: startParsed.reason };
      break;
    }
    if (!endParsed.ok) {
      explicit = { invalid: endParsed.reason };
      break;
    }
    explicit = { start: startParsed.iso, end: endParsed.iso };
    break;
  }

  if (currentHit) {
    hits.push({
      kind: 'current_month',
      source: 'user_text',
      normalizedLabel: 'Bieżący miesiąc',
    });
  }
  if (nextHit) {
    hits.push({
      kind: 'next_month',
      source: 'user_text',
      normalizedLabel: 'Następny miesiąc',
    });
  }
  if (nextNDays) {
    const days = nextNDays.days;
    if (!Number.isInteger(days) || days < config.minPeriodDays || days > config.maxPeriodDays) {
      return emptyPeriodResolution('invalid', ['period_days_out_of_range'], null);
    }
    hits.push({
      kind: 'next_n_days',
      source: 'user_text',
      days,
      normalizedLabel: `Następne ${days} dni`,
    });
  }
  if (explicit && 'invalid' in explicit) {
    return emptyPeriodResolution('invalid', [explicit.invalid], null);
  }
  if (explicit && 'start' in explicit) {
    if (!isValidIsoLocalDate(explicit.start) || !isValidIsoLocalDate(explicit.end)) {
      return emptyPeriodResolution('invalid', ['invalid_calendar_date'], null);
    }
    const cmp = compareIsoLocalDates(explicit.start, explicit.end);
    if (cmp === null) {
      return emptyPeriodResolution('invalid', ['invalid_calendar_date'], null);
    }
    if (cmp > 0) {
      return emptyPeriodResolution('invalid', ['reversed_date_range'], null);
    }
    const span = inclusiveDaySpan(explicit.start, explicit.end);
    if (span === null || span > config.maxPeriodDays) {
      return emptyPeriodResolution('invalid', ['period_range_over_limit'], null);
    }
    hits.push({
      kind: 'explicit_date_range',
      source: 'user_text',
      startDate: explicit.start,
      endDateInclusive: explicit.end,
      normalizedLabel: `${formatPolishDateLabel(explicit.start)}–${formatPolishDateLabel(explicit.end)}`,
    });
  }

  if (hits.length > 1) {
    return emptyPeriodResolution(
      'ambiguous',
      ['ambiguous_dual_period'],
      'Proszę wskazać jeden okres: bieżący miesiąc, następny miesiąc, liczbę dni albo zakres dat od–do.',
    );
  }

  if (hits.length === 1) {
    return {
      status: 'resolved',
      period: hits[0]!,
      clarificationQuestion: null,
      errors: [],
    };
  }

  return emptyPeriodResolution(
    'missing',
    ['period_missing'],
    'Proszę podać okres raportu: bieżący miesiąc, następny miesiąc, liczbę dni (1–366) albo zakres dat od–do.',
  );
}

export function bindDefinitionsForPeriod(
  period: TetaReportPeriod,
): import('./teta-report-period.types').TetaOracleBindDefinition[] {
  if (period.kind === 'next_n_days') {
    return [
      {
        name: 'P001',
        position: 1,
        oracleType: 'NUMBER',
        semanticType: 'positive_integer_days',
        sourceParameterId: 'report_period_days',
      },
    ];
  }
  if (period.kind === 'explicit_date_range') {
    return [
      {
        name: 'P001',
        position: 1,
        oracleType: 'VARCHAR2',
        semanticType: 'local_date',
        sourceParameterId: 'report_period_start_date',
      },
      {
        name: 'P002',
        position: 2,
        oracleType: 'VARCHAR2',
        semanticType: 'local_date',
        sourceParameterId: 'report_period_end_date',
      },
    ];
  }
  return [];
}

export function bindValuesForPeriod(
  period: TetaReportPeriod,
): import('./teta-report-period.types').TetaOracleExecutionBindValues {
  if (period.kind === 'next_n_days') {
    return { P001: period.days };
  }
  if (period.kind === 'explicit_date_range') {
    return {
      P001: period.startDate,
      P002: period.endDateInclusive,
    };
  }
  return {};
}

export {
  STAGE3H_MAX_PERIOD_DAYS,
  STAGE3H_MIN_PERIOD_DAYS,
};
