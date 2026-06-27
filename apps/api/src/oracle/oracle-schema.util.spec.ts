import {
  buildOracleThreadContext,
  extractPrimaryTableFromSql,
  parseOracleThreadContextTable,
  qualifySelectTables,
} from './oracle-schema.util';

describe('qualifySelectTables', () => {
  it('adds TETA_ADMIN prefix to unqualified tables', () => {
    const sql = "SELECT * FROM T_PRAC WHERE NAZWISKO LIKE 'M%'";
    expect(qualifySelectTables(sql, ['T_PRAC'], 'TETA_ADMIN')).toBe(
      "SELECT * FROM TETA_ADMIN.T_PRAC WHERE NAZWISKO LIKE 'M%'",
    );
  });

  it('leaves already qualified tables unchanged', () => {
    const sql = 'SELECT * FROM TETA_ADMIN.T_PRAC';
    expect(qualifySelectTables(sql, ['TETA_ADMIN.T_PRAC'], 'TETA_ADMIN')).toBe(sql);
  });
});

describe('extractPrimaryTableFromSql', () => {
  it('extracts qualified table name', () => {
    expect(extractPrimaryTableFromSql("SELECT * FROM TETA_ADMIN.T_PRAC WHERE NAZWISKO LIKE 'Z%'")).toBe(
      'TETA_ADMIN.T_PRAC',
    );
  });
});

describe('parseOracleThreadContextTable', () => {
  it('parses table from thread context', () => {
    expect(
      parseOracleThreadContextTable(
        'ostatnia tabela: TETA_ADMIN.T_PRAC; kolumny wyniku: NAZWISKO, IMIE',
      ),
    ).toEqual({ owner: 'TETA_ADMIN', name: 'T_PRAC' });
  });
});
