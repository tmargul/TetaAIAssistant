import { formatEmployeeNumberCell } from './teta-p1-vertical-pilot-chat';
import {
  P1_SURNAME_POSITION_MAX_ROWS,
  P1_SURNAME_POSITION_PREFIX,
  P1_SURNAME_POSITION_REFERENCE_BASE_EMPLOYEE_COUNT,
  type SurnamePositionSafetyCounters,
} from './teta-p1-surname-current-position.types';

const EMPTY_POSITION = 'Brak aktualnego stanowiska';
const MISSING_DICT_NAME = 'Nie znaleziono nazwy stanowiska';

export type EmployeePositionMultiplicityStatus = 'none' | 'single' | 'multiple';

export type EmployeeCardinalityAuditEntry = {
  employeeNumber: string;
  currentPositionRowCount: number;
  multiplicityStatus: EmployeePositionMultiplicityStatus;
};

export type SurnamePositionCardinality = {
  baseEmployeeDistinctCount: number;
  returnedEmployeeDistinctCount: number;
  returnedRowCount: number;
  employeesWithoutCurrentPositionCount: number;
  employeesWithSingleCurrentPositionCount: number;
  employeesWithMultipleCurrentPositionsCount: number;
  currentPositionRowsWithoutDictionaryName: number;
  missingPositionDictionaryNames: number;
  perEmployee: EmployeeCardinalityAuditEntry[];
};

export function analyzeSurnamePositionRows(
  rows: unknown[][],
  counters: SurnamePositionSafetyCounters,
): SurnamePositionCardinality {
  type Agg = {
    positionPresentCount: number;
    namedPositionCount: number;
    missingDictNameCount: number;
  };
  const byEmployee = new Map<string, Agg>();

  for (const row of rows) {
    const num = formatEmployeeNumberCell(row[2], counters);
    const positionName = row[3];
    const positionRef = row[4];
    const hasPosition = positionRef != null && String(positionRef).trim() !== '';
    const hasName = positionName != null && String(positionName).trim() !== '';

    const agg = byEmployee.get(num) ?? {
      positionPresentCount: 0,
      namedPositionCount: 0,
      missingDictNameCount: 0,
    };
    if (hasPosition) {
      agg.positionPresentCount += 1;
      if (hasName) agg.namedPositionCount += 1;
      else agg.missingDictNameCount += 1;
    }
    byEmployee.set(num, agg);
  }

  let without = 0;
  let single = 0;
  let multiple = 0;
  let missingDict = 0;
  const perEmployee: EmployeeCardinalityAuditEntry[] = [];

  for (const [employeeNumber, agg] of [...byEmployee.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    missingDict += agg.missingDictNameCount;
    let multiplicityStatus: EmployeePositionMultiplicityStatus = 'none';
    if (agg.positionPresentCount === 0) {
      without += 1;
      multiplicityStatus = 'none';
    } else if (agg.positionPresentCount === 1) {
      single += 1;
      multiplicityStatus = 'single';
    } else {
      multiple += 1;
      multiplicityStatus = 'multiple';
    }
    perEmployee.push({
      employeeNumber,
      currentPositionRowCount: agg.positionPresentCount,
      multiplicityStatus,
    });
  }

  const returnedEmployeeDistinctCount = byEmployee.size;
  if (returnedEmployeeDistinctCount !== P1_SURNAME_POSITION_REFERENCE_BASE_EMPLOYEE_COUNT) {
    counters.returnedEmployeeDistinctCountMismatch += 1;
    counters.baseEmployeeCountChangedUnexpectedly += 1;
  }

  return {
    baseEmployeeDistinctCount: P1_SURNAME_POSITION_REFERENCE_BASE_EMPLOYEE_COUNT,
    returnedEmployeeDistinctCount,
    returnedRowCount: rows.length,
    employeesWithoutCurrentPositionCount: without,
    employeesWithSingleCurrentPositionCount: single,
    employeesWithMultipleCurrentPositionsCount: multiple,
    currentPositionRowsWithoutDictionaryName: missingDict,
    missingPositionDictionaryNames: missingDict,
    perEmployee,
  };
}

export function buildSurnamePositionChatResponse(input: {
  rows: unknown[][];
  limitReached: boolean;
  maxRows?: number;
  counters: SurnamePositionSafetyCounters;
  prefix?: string;
}): {
  message: string;
  report: {
    columns: Array<{ ordinal: number; businessRole: string; displayLabel: string; valueKind: string }>;
    rows: string[][];
    rowCount: number;
    columnCount: number;
    limitReached: boolean;
  };
  deliveryStatus: 'delivered_table' | 'delivered_empty';
  cardinality: SurnamePositionCardinality;
} {
  const prefix = input.prefix ?? P1_SURNAME_POSITION_PREFIX;
  const maxRows = input.maxRows ?? P1_SURNAME_POSITION_MAX_ROWS;
  const cardinality = analyzeSurnamePositionRows(input.rows, input.counters);

  const formattedRows: string[][] = input.rows.map((row) => {
    const first = row[0] == null ? '' : String(row[0]);
    const last = row[1] == null ? '' : String(row[1]);
    const num = formatEmployeeNumberCell(row[2], input.counters);
    const positionRef = row[4];
    const hasPosition = positionRef != null && String(positionRef).trim() !== '';
    const rawName = row[3];
    let positionLabel: string;
    if (!hasPosition) {
      positionLabel = EMPTY_POSITION;
    } else if (rawName == null || String(rawName).trim() === '') {
      positionLabel = MISSING_DICT_NAME;
    } else {
      positionLabel = String(rawName);
      // Never expose raw SSTN_ID as user-facing name
      if (/^\d+$/.test(positionLabel)) {
        input.counters.positionIdShownAsPositionName += 1;
      }
    }
    return [first, last, num, positionLabel];
  });

  const nEmployees = cardinality.returnedEmployeeDistinctCount;
  let message: string;
  if (nEmployees === 0) {
    message = `Nie znaleziono pracowników, których nazwisko zaczyna się na literę ${prefix}.`;
  } else {
    message = `Znaleziono ${nEmployees} pracowników, których nazwisko zaczyna się na literę ${prefix}.`;
    if (cardinality.employeesWithMultipleCurrentPositionsCount > 0) {
      message +=
        ' Dla części pracowników znaleziono więcej niż jedno stanowisko obowiązujące w bieżącym dniu.';
    }
    if (input.limitReached) {
      message += ` Pokazano pierwsze ${maxRows} rekordów.`;
    }
  }

  return {
    message,
    report: {
      columns: [
        { ordinal: 1, businessRole: 'employee_first_name', displayLabel: 'Imię', valueKind: 'text' },
        {
          ordinal: 2,
          businessRole: 'employee_last_name',
          displayLabel: 'Nazwisko',
          valueKind: 'text',
        },
        {
          ordinal: 3,
          businessRole: 'employee_number',
          displayLabel: 'Numer ewidencyjny',
          valueKind: 'text',
        },
        {
          ordinal: 4,
          businessRole: 'current_position_name',
          displayLabel: 'Aktualne stanowisko',
          valueKind: 'text',
        },
      ],
      rows: formattedRows,
      rowCount: formattedRows.length,
      columnCount: 4,
      limitReached: input.limitReached,
    },
    deliveryStatus: formattedRows.length === 0 ? 'delivered_empty' : 'delivered_table',
    cardinality,
  };
}
