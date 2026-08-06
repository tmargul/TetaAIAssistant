import type { PilotFieldBinding } from './teta-p1-vertical-pilot.types';

export type PilotChatTable = {
  columns: Array<{ ordinal: number; businessRole: string; displayLabel: string; valueKind: string }>;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  limitReached: boolean;
};

export function formatBirthDateCell(value: unknown, counters: { birthDateTimeExposed: number }): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value);
  // Strip time portion if ISO / Oracle datetime string
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    if (/T|\s+\d{1,2}:/.test(text)) {
      // time was present but we strip for display — not exposing time
    }
    return m[1]!;
  }
  if (/\d{1,2}:\d{2}/.test(text)) {
    counters.birthDateTimeExposed += 1;
  }
  return text;
}

export function formatEmployeeNumberCell(
  value: unknown,
  counters: { employeeNumberConvertedToNumber: number; leadingZerosRemoved: number },
): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    counters.employeeNumberConvertedToNumber += 1;
    return String(value);
  }
  const text = String(value);
  // Preserve as text; detect accidental numeric coercion elsewhere
  if (/^0\d+$/.test(text) === false && typeof value === 'number') {
    counters.leadingZerosRemoved += 1;
  }
  return text;
}

export function buildPilotChatResponse(input: {
  rows: unknown[][];
  columnOrder: Array<{ businessRole: string; displayLabel: string; valueKind: string }>;
  bindings: PilotFieldBinding[];
  limitReached: boolean;
  maxRows: number;
  counters: {
    birthDateTimeExposed: number;
    employeeNumberConvertedToNumber: number;
    leadingZerosRemoved: number;
  };
}): {
  message: string;
  report: PilotChatTable;
  deliveryStatus: 'delivered_table' | 'delivered_empty';
} {
  const formattedRows: string[][] = input.rows.map((row) =>
    row.map((cell, idx) => {
      const role = input.columnOrder[idx]?.businessRole;
      if (role === 'employee_birth_date') return formatBirthDateCell(cell, input.counters);
      if (role === 'employee_number') return formatEmployeeNumberCell(cell, input.counters);
      return cell == null ? '' : String(cell);
    }),
  );

  const n = formattedRows.length;
  let message: string;
  if (n === 0) {
    message =
      'Nie znaleziono pracowników, których nazwisko zaczyna się na literę A.';
  } else if (input.limitReached) {
    message = `Znaleziono ${n} pracowników, których nazwisko zaczyna się na literę A. Pokazano pierwsze ${input.maxRows} rekordów.`;
  } else {
    message = `Znaleziono ${n} pracowników, których nazwisko zaczyna się na literę A.`;
  }

  return {
    message,
    report: {
      columns: input.columnOrder.map((c, i) => ({
        ordinal: i + 1,
        businessRole: c.businessRole,
        displayLabel: c.displayLabel,
        valueKind: c.valueKind,
      })),
      rows: formattedRows,
      rowCount: n,
      columnCount: input.columnOrder.length,
      limitReached: input.limitReached,
    },
    deliveryStatus: n === 0 ? 'delivered_empty' : 'delivered_table',
  };
}
