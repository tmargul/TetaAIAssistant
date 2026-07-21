import {
  formatOracleCell,
  isDataNamedColumn,
  pickNewestFirstSortColumn,
  sortRowsNewestFirst,
  userAsksForDateTime,
} from './oracle-result-format.util';

describe('oracle-result-format.util', () => {
  describe('isDataNamedColumn', () => {
    it('recognizes DATA* columns', () => {
      expect(isDataNamedColumn('DATA_OD')).toBe(true);
      expect(isDataNamedColumn('DATA_DO')).toBe(true);
      expect(isDataNamedColumn('DATA')).toBe(true);
      expect(isDataNamedColumn('DATAURODZENIA')).toBe(true);
      expect(isDataNamedColumn('STANOWISKO')).toBe(false);
      expect(isDataNamedColumn('UPDATED_AT')).toBe(false);
    });
  });

  describe('userAsksForDateTime', () => {
    it('detects explicit time requests', () => {
      expect(userAsksForDateTime('pokaż datę z czasem')).toBe(true);
      expect(userAsksForDateTime('z godziną')).toBe(true);
      expect(userAsksForDateTime('jakie ma stanowisko')).toBe(false);
    });
  });

  describe('formatOracleCell', () => {
    it('formats DATA columns as YYYY-MM-DD by default', () => {
      const d = new Date(2020, 5, 15, 14, 30, 0);
      expect(formatOracleCell(d, 'DATA_OD')).toBe('2020-06-15');
      expect(formatOracleCell(d, 'DATA_OD', { includeTime: true })).toBe('2020-06-15 14:30');
    });

    it('formats midnight Date as date-only', () => {
      const d = new Date(2018, 0, 1, 0, 0, 0);
      expect(formatOracleCell(d, 'UTWORZONO')).toBe('2018-01-01');
    });

    it('formats non-DATA datetime with time when present', () => {
      const d = new Date(2018, 0, 1, 9, 5, 0);
      expect(formatOracleCell(d, 'UTWORZONO')).toBe('2018-01-01 09:05');
    });
  });

  describe('sortRowsNewestFirst', () => {
    it('picks DATA_OD preferentially', () => {
      expect(pickNewestFirstSortColumn(['STANOWISKO', 'DATA_DO', 'DATA_OD'])).toBe('DATA_OD');
    });

    it('sorts newest first with nulls last', () => {
      const columns = ['STANOWISKO', 'DATA_OD'];
      const rows = [
        ['A', new Date(2010, 0, 1)],
        ['B', new Date(2020, 0, 1)],
        ['C', null],
        ['D', new Date(2015, 5, 1)],
      ];
      const sorted = sortRowsNewestFirst(columns, rows, (row, i) => row[i]);
      expect(sorted.map((r) => r[0])).toEqual(['B', 'D', 'A', 'C']);
    });

    it('sorts formatted date strings DESC', () => {
      const columns = ['DATA_OD', 'NAZWA'];
      const rows = [
        ['2010-01-01', 'stary'],
        ['2020-06-15', 'nowy'],
      ];
      const sorted = sortRowsNewestFirst(columns, rows, (row, i) => row[i]);
      expect(sorted[0][1]).toBe('nowy');
    });
  });
});
