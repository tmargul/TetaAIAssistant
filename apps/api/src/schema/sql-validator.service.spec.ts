import { SqlValidatorService } from './sql-validator.service';
import { SchemaGraphService } from './schema-graph.service';

describe('SqlValidatorService', () => {
  const graph = {
    getKnownTableNames: () =>
      new Set(['TETA.SL_BADANIA_BHP', 'SL_BADANIA_BHP', 'TETA.T_PRAC', 'T_PRAC']),
  } as SchemaGraphService;

  const validator = new SqlValidatorService(graph);

  it('accepts SELECT on known tables', () => {
    const result = validator.validateSelectSql(
      'SELECT firm_id FROM sl_badania_bhp WHERE badanie_id = 1',
    );
    expect(result.valid).toBe(true);
  });

  it('rejects INSERT', () => {
    const result = validator.validateSelectSql('INSERT INTO t_prac VALUES (1)');
    expect(result.valid).toBe(false);
  });

  it('rejects unknown tables', () => {
    const result = validator.validateSelectSql('SELECT * FROM nieistniejaca_tabela');
    expect(result.valid).toBe(false);
  });
});
