import { formatEmployeeNumberCell } from './teta-p1-vertical-pilot-chat';
import {
  P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
  type CurrentPositionSafetyCounters,
} from './teta-p1-current-position.types';

export type CurrentPositionChatTable = {
  columns: Array<{ ordinal: number; businessRole: string; displayLabel: string; valueKind: string }>;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  limitReached: boolean;
};

export type CurrentPositionMultiplicity = {
  employeeRecordCount: number;
  currentPositionRowCount: number;
  multipleEmployeeRecordsDetected: boolean;
  multipleCurrentPositionRowsDetected: boolean;
};

const COLUMNS = [
  { businessRole: 'employee_first_name', displayLabel: 'Imię', valueKind: 'text' },
  { businessRole: 'employee_last_name', displayLabel: 'Nazwisko', valueKind: 'text' },
  { businessRole: 'employee_number', displayLabel: 'Numer ewidencyjny', valueKind: 'text' },
  {
    businessRole: 'current_position_name',
    displayLabel: 'Aktualne stanowisko',
    valueKind: 'text',
  },
] as const;

const EMPTY_POSITION = 'Brak aktualnego stanowiska';

export function analyzeCurrentPositionRows(rows: unknown[][]): CurrentPositionMultiplicity {
  const employeeKeys = new Set<string>();
  let withPosition = 0;
  for (const row of rows) {
    const first = row[0] == null ? '' : String(row[0]);
    const last = row[1] == null ? '' : String(row[1]);
    const num = row[2] == null ? '' : String(row[2]);
    employeeKeys.add(`${num}\u0000${last}\u0000${first}`);
    const pos = row[3];
    if (pos != null && String(pos).trim() !== '') withPosition += 1;
  }
  return {
    employeeRecordCount: employeeKeys.size,
    currentPositionRowCount: withPosition,
    multipleEmployeeRecordsDetected: employeeKeys.size > 1,
    multipleCurrentPositionRowsDetected: withPosition > 1,
  };
}

export function buildCurrentPositionChatResponse(input: {
  rows: unknown[][];
  limitReached: boolean;
  maxRows: number;
  counters: CurrentPositionSafetyCounters;
  employeeNumber?: string;
}): {
  message: string;
  report: CurrentPositionChatTable;
  deliveryStatus: 'delivered_table' | 'delivered_empty';
  multiplicity: CurrentPositionMultiplicity;
} {
  const empNo = input.employeeNumber ?? P1_CURRENT_POSITION_EMPLOYEE_NUMBER;
  const multiplicity = analyzeCurrentPositionRows(input.rows);

  const formattedRows: string[][] = input.rows.map((row) => {
    const first = row[0] == null ? '' : String(row[0]);
    const last = row[1] == null ? '' : String(row[1]);
    const num = formatEmployeeNumberCell(row[2], input.counters);
    const rawPos = row[3];
    const pos =
      rawPos == null || String(rawPos).trim() === '' ? EMPTY_POSITION : String(rawPos);
    return [first, last, num, pos];
  });

  let message: string;
  if (formattedRows.length === 0) {
    message = `Nie znaleziono pracownika o numerze ewidencyjnym ${empNo}.`;
  } else if (
    multiplicity.currentPositionRowCount === 0 &&
    multiplicity.employeeRecordCount >= 1
  ) {
    message = `Znaleziono pracownika o numerze ewidencyjnym ${empNo}. Aktualne stanowisko = „${EMPTY_POSITION}”.`;
  } else if (multiplicity.multipleCurrentPositionRowsDetected) {
    message = `Dla pracownika znaleziono więcej niż jedno stanowisko obowiązujące w bieżącym dniu. Numer ewidencyjny: ${empNo}.`;
  } else if (multiplicity.multipleEmployeeRecordsDetected) {
    message = `Znaleziono więcej niż jeden rekord pracownika o numerze ewidencyjnym ${empNo}.`;
  } else {
    message = `Znaleziono aktualne stanowisko pracownika o numerze ewidencyjnym ${empNo}.`;
  }

  if (input.limitReached && formattedRows.length > 0) {
    message += ` Pokazano pierwsze ${input.maxRows} rekordów.`;
  }

  return {
    message,
    report: {
      columns: COLUMNS.map((c, i) => ({
        ordinal: i + 1,
        businessRole: c.businessRole,
        displayLabel: c.displayLabel,
        valueKind: c.valueKind,
      })),
      rows: formattedRows,
      rowCount: formattedRows.length,
      columnCount: COLUMNS.length,
      limitReached: input.limitReached,
    },
    deliveryStatus: formattedRows.length === 0 ? 'delivered_empty' : 'delivered_table',
    multiplicity,
  };
}
