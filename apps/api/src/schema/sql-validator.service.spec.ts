import { ConfigService } from '@nestjs/config';
import { SqlValidatorService } from './sql-validator.service';
import { SchemaGraphService } from './schema-graph.service';

describe('SqlValidatorService', () => {
  const graph = {
    getKnownTableNames: () =>
      new Set([
        'TETA_ADMIN.SL_BADANIA_BHP',
        'SL_BADANIA_BHP',
        'TETA_ADMIN.T_PRAC',
        'T_PRAC',
      ]),
    getColumnsForTableNames: (tables: string[]) => {
      const map = new Map<string, Set<string>>();
      if (tables.some((table) => table.toUpperCase().includes('T_PRAC'))) {
        map.set('T_PRAC', new Set(['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY']));
      }
      return map;
    },
  } as SchemaGraphService;

  const config = {
    get: (key: string) => {
      if (key === 'TETA_ORACLE_DEFAULT_SCHEMA') return 'TETA_ADMIN';
      if (key === 'TETA_ORACLE_METADATA_OWNERS') return 'TETA_ADMIN';
      return undefined;
    },
  } as ConfigService;

  const validator = new SqlValidatorService(graph, config);

  it('accepts SELECT on known tables', () => {
    const result = validator.validateSelectSql(
      'SELECT firm_id FROM sl_badania_bhp WHERE badanie_id = 1',
    );
    expect(result.valid).toBe(true);
  });

  it('qualifies unqualified tables with TETA_ADMIN', () => {
    const sql = 'SELECT * FROM T_PRAC';
    const result = validator.validateSelectSql(sql);
    expect(result.valid).toBe(true);
    expect(validator.qualifySelectSql(sql, result.tables!)).toBe('SELECT * FROM TETA_ADMIN.T_PRAC');
  });

  it('accepts SELECT with trailing semicolon', () => {
    const result = validator.validateSelectSql('SELECT * FROM T_PRAC;');
    expect(result.valid).toBe(true);
  });

  it('rejects multiple statements separated by semicolon', () => {
    const result = validator.validateSelectSql('SELECT * FROM T_PRAC; SELECT * FROM T_PRAC');
    expect(result.valid).toBe(false);
  });

  it('rejects INSERT', () => {
    const result = validator.validateSelectSql('INSERT INTO t_prac VALUES (1)');
    expect(result.valid).toBe(false);
  });

  it('rejects unknown tables', () => {
    const result = validator.validateSelectSql('SELECT * FROM nieistniejaca_tabela');
    expect(result.valid).toBe(false);
  });

  it('rejects invented column names before hitting Oracle', () => {
    const result = validator.validateSelectSql(
      "SELECT IMIE, NAZWISKO FROM T_PRAC WHERE NR_EWD = '00122'",
    );
    expect(result.valid).toBe(false);
    expect(result.message).toContain('NR_EWD');
  });
});
