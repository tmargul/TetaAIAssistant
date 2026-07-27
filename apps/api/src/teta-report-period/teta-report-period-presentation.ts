/**
 * Stage 3H — user-facing titles, messages, XLSX criteria and safe filenames.
 * Deterministic; no LLM.
 */
import {
  formatPolishDateLabel,
  periodToClientMeta,
  type TetaReportPeriod,
  type TetaReportPeriodClientMeta,
} from './teta-report-period.types';

export type PeriodPresentation = {
  title: string;
  criterion: string;
  periodKindLabel: string;
  fileNameBase: string;
  clientMeta: TetaReportPeriodClientMeta;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function periodPresentation(period: TetaReportPeriod): PeriodPresentation {
  const clientMeta = periodToClientMeta(period);
  switch (period.kind) {
    case 'current_month':
      return {
        title: 'Badania BHP kończące się w bieżącym miesiącu',
        criterion: 'Data ważności badania przypada w bieżącym miesiącu',
        periodKindLabel: 'Bieżący miesiąc',
        fileNameBase: 'badania_bhp_biezacy_miesiac',
        clientMeta,
      };
    case 'next_month':
      return {
        title: 'Badania BHP kończące się w następnym miesiącu',
        criterion: 'Data ważności badania przypada w następnym miesiącu',
        periodKindLabel: 'Następny miesiąc',
        fileNameBase: 'badania_bhp_nastepny_miesiac',
        clientMeta,
      };
    case 'next_n_days':
      return {
        title: `Badania BHP kończące się w ciągu następnych ${period.days} dni`,
        criterion: `Data ważności badania przypada w ciągu następnych ${period.days} dni`,
        periodKindLabel: period.normalizedLabel,
        fileNameBase: `badania_bhp_nastepne_${period.days}_dni`,
        clientMeta,
      };
    case 'explicit_date_range': {
      const startPl = formatPolishDateLabel(period.startDate);
      const endPl = formatPolishDateLabel(period.endDateInclusive);
      return {
        title: `Badania BHP z terminem ważności od ${startPl} do ${endPl}`,
        criterion: `Data ważności badania od ${startPl} do ${endPl} (włącznie)`,
        periodKindLabel: period.normalizedLabel,
        fileNameBase: `badania_bhp_${period.startDate}_${period.endDateInclusive}`,
        clientMeta,
      };
    }
  }
}

export function buildPeriodExportFileName(period: TetaReportPeriod, when: Date): string {
  const { fileNameBase } = periodPresentation(period);
  const date = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
  const time = `${pad2(when.getHours())}${pad2(when.getMinutes())}${pad2(when.getSeconds())}`;
  return `${fileNameBase}_${date}_${time}.xlsx`;
}

/** Accept legacy Stage 3F/3G names and Stage 3H period-specific names. */
export function isValidPeriodExportFileName(fileName: string): boolean {
  if (/^badania_bhp_koniec_waznosci_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(fileName)) {
    return true;
  }
  if (/^badania_bhp_biezacy_miesiac_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(fileName)) {
    return true;
  }
  if (/^badania_bhp_nastepny_miesiac_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(fileName)) {
    return true;
  }
  if (/^badania_bhp_nastepne_\d{1,3}_dni_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(fileName)) {
    return true;
  }
  if (
    /^badania_bhp_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(
      fileName,
    )
  ) {
    return true;
  }
  return false;
}

export function buildPeriodStatusMessage(
  period: TetaReportPeriod,
  status: 'completed' | 'completed_empty' | 'limit_reached' | string,
  rowCount: number,
): string | null {
  if (status === 'limit_reached') {
    return 'Wyświetlono maksymalny limit 500 rekordów. Wynik może być niepełny.';
  }
  if (status === 'completed_empty' || (status === 'completed' && rowCount === 0)) {
    switch (period.kind) {
      case 'current_month':
        return 'Nie znaleziono badań BHP, których termin ważności kończy się w bieżącym miesiącu dla pracowników z aktywną umową o pracę.';
      case 'next_month':
        return 'Nie znaleziono badań BHP, których termin ważności kończy się w następnym miesiącu dla pracowników z aktywną umową o pracę.';
      case 'next_n_days':
        return `Nie znaleziono badań BHP, których termin ważności kończy się w ciągu następnych ${period.days} dni dla pracowników z aktywną umową o pracę.`;
      case 'explicit_date_range':
        return `Nie znaleziono badań BHP z terminem ważności od ${formatPolishDateLabel(period.startDate)} do ${formatPolishDateLabel(period.endDateInclusive)} dla pracowników z aktywną umową o pracę.`;
    }
  }
  if (status === 'completed') {
    switch (period.kind) {
      case 'current_month':
        return `Znalazłem ${rowCount} rekordów badań BHP, których termin ważności kończy się w bieżącym miesiącu. Wynik znajduje się w tabeli poniżej.`;
      case 'next_month':
        return `Znalazłem ${rowCount} rekordów badań BHP, których termin ważności kończy się w następnym miesiącu. Wynik znajduje się w tabeli poniżej.`;
      case 'next_n_days':
        return `Znalazłem ${rowCount} rekordów badań BHP, których termin ważności kończy się w ciągu następnych ${period.days} dni. Wynik znajduje się w tabeli poniżej.`;
      case 'explicit_date_range':
        return `Znalazłem ${rowCount} rekordów badań BHP z terminem ważności od ${formatPolishDateLabel(period.startDate)} do ${formatPolishDateLabel(period.endDateInclusive)}. Wynik znajduje się w tabeli poniżej.`;
    }
  }
  return null;
}
