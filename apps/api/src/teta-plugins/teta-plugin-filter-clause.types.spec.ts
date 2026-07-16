import { formatFilterComparison, formatPluginWhereClause } from './teta-plugin-filter-clause.types';

describe('teta-plugin-filter-clause.types', () => {
  it('uses UPPER for text filter values', () => {
    expect(formatFilterComparison('NAZWISKO', 'Kowalski')).toBe(
      "UPPER(NAZWISKO) = UPPER('Kowalski')",
    );
  });

  it('keeps exact match for numeric filter values', () => {
    expect(formatFilterComparison('NR_EWD', '00122')).toBe("NR_EWD = '00122'");
  });

  it('formats OR groups with case-insensitive text comparisons', () => {
    const where = formatPluginWhereClause({
      conditions: [
        { filterColumn: 'NAZWISKO', filterValue: 'Kowalski' },
        { filterColumn: 'IMIE', filterValue: 'Janusz' },
      ],
      orAlternatives: [
        [
          { filterColumn: 'NAZWISKO', filterValue: 'Janusz' },
          { filterColumn: 'IMIE', filterValue: 'Kowalski' },
        ],
      ],
    });

    expect(where).toBe(
      "(UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Janusz')) OR (UPPER(NAZWISKO) = UPPER('Janusz') AND UPPER(IMIE) = UPPER('Kowalski'))",
    );
  });

  it('prefers rawWhereSql from history over conditions', () => {
    expect(
      formatPluginWhereClause({
        conditions: [],
        rawWhereSql: "UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Jan')",
      }),
    ).toBe("UPPER(NAZWISKO) = UPPER('Kowalski') AND UPPER(IMIE) = UPPER('Jan')");
  });
});
