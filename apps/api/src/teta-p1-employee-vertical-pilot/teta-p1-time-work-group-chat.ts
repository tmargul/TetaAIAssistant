import type { TimeWorkGroupSafetyCounters } from './teta-p1-time-work-group.types';
import {
  P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER,
  P1_TIME_WORK_GROUP_QUESTION,
} from './teta-p1-time-work-group.types';

export function buildTimeWorkGroupBlockedReviewMessage(input: {
  employeeNumber?: string;
  blockingGaps: string[];
  candidateCount: number;
}): string {
  const num = input.employeeNumber ?? P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER;
  return [
    `Pilot „grupa czasu pracy” dla numeru ewidencyjnego ${num} został zablokowany.`,
    'Nie uruchomiono zapytania biznesowego, ponieważ brakuje dokładnego powiązania źródła przypisania grupy czasu pracy.',
    `Znaleziono ${input.candidateCount} kandydatów dowodowych; żaden nie osiągnął statusu resolved_exact dla pełnej ścieżki.`,
    `Luki blokujące (${input.blockingGaps.length}): ${input.blockingGaps.slice(0, 8).join('; ')}.`,
  ].join(' ');
}

export function buildTimeWorkGroupChatResponse(input: {
  kind: 'blocked' | 'employee_missing' | 'no_current_group' | 'rows';
  employeeNumber?: string;
  rows?: string[][];
  multiple?: boolean;
  blockingGaps?: string[];
  candidateCount?: number;
  counters: TimeWorkGroupSafetyCounters;
}): {
  message: string;
  report: {
    columns: Array<{ ordinal: number; businessRole: string; displayLabel: string; valueKind: string }>;
    rows: string[][];
    rowCount: number;
    columnCount: number;
    limitReached: boolean;
  } | null;
  deliveryStatus: 'blocked_review' | 'delivered_empty' | 'delivered_table';
} {
  const columns = [
    { ordinal: 1, businessRole: 'employee_first_name', displayLabel: 'Imię', valueKind: 'text' },
    { ordinal: 2, businessRole: 'employee_last_name', displayLabel: 'Nazwisko', valueKind: 'text' },
    {
      ordinal: 3,
      businessRole: 'employee_number',
      displayLabel: 'Numer ewidencyjny',
      valueKind: 'text',
    },
    {
      ordinal: 4,
      businessRole: 'current_time_work_group_name',
      displayLabel: 'Grupa czasu pracy',
      valueKind: 'text',
    },
  ];

  if (input.kind === 'blocked') {
    return {
      message: buildTimeWorkGroupBlockedReviewMessage({
        employeeNumber: input.employeeNumber,
        blockingGaps: input.blockingGaps ?? [],
        candidateCount: input.candidateCount ?? 0,
      }),
      report: null,
      deliveryStatus: 'blocked_review',
    };
  }

  const num = input.employeeNumber ?? P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER;
  if (input.kind === 'employee_missing') {
    return {
      message: `Nie znaleziono pracownika o numerze ewidencyjnym ${num}.`,
      report: { columns, rows: [], rowCount: 0, columnCount: 4, limitReached: false },
      deliveryStatus: 'delivered_empty',
    };
  }

  const rows = input.rows ?? [];
  // Never expose raw numeric group IDs as names
  for (const row of rows) {
    const name = row[3] ?? '';
    if (/^\d+$/.test(name)) input.counters.groupIdShownAsGroupName += 1;
  }

  if (input.kind === 'no_current_group') {
    return {
      message: `Dla pracownika o numerze ewidencyjnym ${num} nie znaleziono aktualnej grupy czasu pracy.`,
      report: {
        columns,
        rows,
        rowCount: rows.length,
        columnCount: 4,
        limitReached: false,
      },
      deliveryStatus: rows.length ? 'delivered_table' : 'delivered_empty',
    };
  }

  let message = `Znaleziono grupę czasu pracy dla pracownika o numerze ewidencyjnym ${num}.`;
  if (input.multiple) {
    message =
      `Dla pracownika znaleziono więcej niż jedną grupę czasu pracy obowiązującą w bieżącym dniu.`;
  }
  void P1_TIME_WORK_GROUP_QUESTION;
  return {
    message,
    report: {
      columns,
      rows,
      rowCount: rows.length,
      columnCount: 4,
      limitReached: false,
    },
    deliveryStatus: rows.length ? 'delivered_table' : 'delivered_empty',
  };
}
