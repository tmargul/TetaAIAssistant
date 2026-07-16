import {
  extractTableAliases,
  findUnknownSelectColumns,
  formatUnknownColumnsMessage,
} from './sql-column-validation.util';

describe('sql-column-validation.util', () => {
  const tPracColumns = new Map<string, Set<string>>([
    [
      'T_PRAC',
      new Set(['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY', 'PESEL']),
    ],
  ]);

  it('detects invented abbreviation NR_EWD', () => {
    const sql =
      "SELECT IMIE, NAZWISKO FROM TETA_ADMIN.T_PRAC WHERE NR_EWD = '00122'";
    const unknown = findUnknownSelectColumns(sql, ['TETA_ADMIN.T_PRAC'], tPracColumns);
    expect(unknown).toContain('NR_EWD');
  });

  it('accepts real column NR_EWIDENCYJNY', () => {
    const sql =
      "SELECT IMIE, NAZWISKO FROM T_PRAC WHERE NR_EWIDENCYJNY = '00122'";
    const unknown = findUnknownSelectColumns(sql, ['T_PRAC'], tPracColumns);
    expect(unknown).not.toContain('NR_EWIDENCYJNY');
    expect(unknown).toHaveLength(0);
  });

  it('validates alias-qualified columns', () => {
    const sql = "SELECT PRAC.IMIE FROM T_PRAC PRAC WHERE PRAC.NR_EWD = '1'";
    const unknown = findUnknownSelectColumns(sql, ['T_PRAC'], tPracColumns);
    expect(unknown).toContain('NR_EWD');
  });

  it('maps table aliases from FROM clause', () => {
    const aliases = extractTableAliases('SELECT * FROM T_PRAC PRAC', ['T_PRAC']);
    expect(aliases.get('PRAC')).toBe('T_PRAC');
  });

  it('formats user-facing message', () => {
    const message = formatUnknownColumnsMessage(['NR_EWD'], ['T_PRAC']);
    expect(message).toContain('NR_EWD');
    expect(message).not.toContain('describe_table');
  });
});
