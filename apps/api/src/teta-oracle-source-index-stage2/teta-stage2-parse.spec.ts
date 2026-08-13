import {
  alignViewProjectionsWithSurface,
  extractViewProjectionLineage,
  extractViewLineage,
  parseCreateViewExplicitColumnList,
} from './teta-stage2-parse';

describe('extractViewProjectionLineage', () => {
  it('maps direct SELECT alias projection VIEW.PUBLIC_X <- A.COL_X', () => {
    const sql = `
      CREATE OR REPLACE VIEW HR.KDR_V AS
      SELECT lstn.kasta_sl_stan_id SSTN_ID, lstn.prac_id PRAC_ID
      FROM l_stanowiska lstn
    `;
    const alias = new Map<string, string>([['LSTN', 'HR.L_STANOWISKA']]);
    const { projections } = extractViewProjectionLineage(sql, 'HR', 'KDR_V', alias);
    const dict = projections.find((p) => p.viewColumn === 'SSTN_ID');
    expect(dict).toMatchObject({
      viewColumn: 'SSTN_ID',
      sourceAlias: 'LSTN',
      sourceObject: 'HR.L_STANOWISKA',
      sourceColumn: 'KASTA_SL_STAN_ID',
      projectionKind: 'aliased_direct_column',
      explicitAlias: 'SSTN_ID',
    });
  });

  it('does not substitute base column name when SELECT body lacks alias or DDL list', () => {
    const sql = `
      CREATE VIEW HR.V AS
      SELECT a.internal_id FROM base_table a
    `;
    const { projections } = extractViewProjectionLineage(
      sql,
      'HR',
      'V',
      new Map([['A', 'HR.BASE_TABLE']]),
    );
    expect(projections[0]?.viewColumn).toBe('COL_1');
    expect(projections[0]?.sourceColumn).toBe('INTERNAL_ID');
    expect(projections[0]?.viewColumn).not.toBe('INTERNAL_ID');
  });

  it('supports CREATE VIEW explicit column list + SELECT ordinal mapping', () => {
    const sql = `
      CREATE VIEW HR.V (PUB_A, PUB_B) AS
      SELECT a.col_a, b.col_b FROM t_a a, t_b b
    `;
    const alias = new Map<string, string>([
      ['A', 'HR.T_A'],
      ['B', 'HR.T_B'],
    ]);
    const { projections } = extractViewProjectionLineage(sql, 'HR', 'V', alias);
    expect(projections[0]).toMatchObject({
      viewColumn: 'PUB_A',
      sourceColumn: 'COL_A',
      projectionKind: 'direct_column',
      exposedColumnSource: 'ddl_explicit_list',
    });
    expect(projections[1]).toMatchObject({
      viewColumn: 'PUB_B',
      sourceColumn: 'COL_B',
    });
    expect(parseCreateViewExplicitColumnList(sql)).toEqual(['PUB_A', 'PUB_B']);
  });

  it('marks CAST projections as function_expression without direct equivalence', () => {
    const sql = `CREATE VIEW HR.V AS SELECT CAST(a.col_x AS NUMBER(10)) AS COL_X FROM t_a a`;
    const { projections } = extractViewProjectionLineage(sql, 'HR', 'V', new Map([['A', 'HR.T_A']]));
    expect(projections[0]?.projectionKind).toBe('function_expression');
    expect(projections[0]?.sourceColumn).toBeNull();
  });

  it('marks SELECT * as unresolved without ordinal exact mapping', () => {
    const sql = `CREATE VIEW HR.V AS SELECT * FROM t_a a`;
    const { projections, unresolvedConstructs } = extractViewProjectionLineage(sql, 'HR', 'V');
    expect(projections[0]?.projectionKind).toBe('unresolved');
    expect(projections[0]?.viewColumn).toBe('*');
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: [
        { owner: 'HR', viewName: 'V', columnName: 'COL_X', columnId: 1 },
        { owner: 'HR', viewName: 'V', columnName: 'COL_Y', columnId: 2 },
      ],
      unresolvedConstructs,
    });
    expect(aligned.projectionConfidence).not.toBe('exact_static');
    expect(aligned.metrics.projectionOrdinalAlignmentsExact).toBe(0);
  });

  it('extractViewLineage recovers comma-FROM WHERE equijoin pairs', () => {
    const sql = `
      CREATE VIEW HR.V AS
      SELECT a.id, b.name
      FROM tab_a a, tab_b b
      WHERE a.fk_id = b.id
    `;
    const lineage = extractViewLineage(sql);
    expect(lineage.joins.some((j) => j.joinType === 'WHERE_EQUIJOIN')).toBe(true);
    expect(lineage.joins[0]?.parsedPairs[0]).toMatchObject({
      leftColumn: 'FK_ID',
      rightColumn: 'ID',
    });
  });
});

describe('alignViewProjectionsWithSurface', () => {
  const meta = (names: string[]) =>
    names.map((columnName, i) => ({
      owner: 'HR',
      viewName: 'V',
      columnName,
      columnId: i + 1,
    }));

  it('maps VIEW.PUBLIC_ID <- BASE.INTERNAL_ID via ALL_TAB_COLUMNS ordinal alignment', () => {
    const sql = `CREATE VIEW HR.V AS SELECT b.internal_id FROM hr.base b`;
    const alias = new Map([['B', 'HR.BASE']]);
    const { projections } = extractViewProjectionLineage(sql, 'HR', 'V', alias);
    expect(projections[0]?.viewColumn).toBe('COL_1');
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: meta(['PUBLIC_ID']),
    });
    expect(aligned.projections[0]).toMatchObject({
      viewColumn: 'PUBLIC_ID',
      sourceColumn: 'INTERNAL_ID',
      projectionKind: 'aliased_direct_column',
      exposedColumnSource: 'oracle_metadata',
      projectionConfidence: 'exact_static',
    });
  });

  it('explicit SELECT alias that agrees with metadata stays exact_static', () => {
    const sql = `CREATE VIEW HR.V AS SELECT b.internal_id AS PUBLIC_ID FROM hr.base b`;
    const { projections } = extractViewProjectionLineage(
      sql,
      'HR',
      'V',
      new Map([['B', 'HR.BASE']]),
    );
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: meta(['PUBLIC_ID']),
    });
    expect(aligned.metrics.projectionAliasMetadataConflicts).toBe(0);
    expect(aligned.projectionConfidence).toBe('exact_static');
    expect(aligned.projections[0]?.viewColumn).toBe('PUBLIC_ID');
    expect(aligned.projections[0]?.sourceColumn).toBe('INTERNAL_ID');
  });

  it('records explicit SELECT alias conflict with metadata', () => {
    const sql = `CREATE VIEW HR.V AS SELECT b.internal_id WRONG_ALIAS FROM hr.base b`;
    const { projections } = extractViewProjectionLineage(
      sql,
      'HR',
      'V',
      new Map([['B', 'HR.BASE']]),
    );
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: meta(['PUBLIC_ID']),
    });
    expect(aligned.metrics.projectionAliasMetadataConflicts).toBe(1);
    expect(aligned.projectionConfidence).not.toBe('exact_static');
    expect(aligned.projections[0]?.viewColumn).toBe('PUBLIC_ID');
  });

  it('records DDL vs metadata conflict without silently choosing DDL', () => {
    const sql = `
      CREATE VIEW HR.V (DDL_NAME) AS
      SELECT b.internal_id FROM hr.base b
    `;
    const { projections } = extractViewProjectionLineage(
      sql,
      'HR',
      'V',
      new Map([['B', 'HR.BASE']]),
    );
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: meta(['METADATA_NAME']),
      declaredColumnsFromDdl: parseCreateViewExplicitColumnList(sql),
    });
    expect(aligned.metrics.ddlMetadataConflicts.length).toBeGreaterThan(0);
    expect(aligned.projections[0]?.viewColumn).toBe('METADATA_NAME');
  });

  it('rejects exact alignment on projection count mismatch', () => {
    const sql = `CREATE VIEW HR.V AS SELECT a.col_a, b.col_b FROM t_a a, t_b b`;
    const { projections } = extractViewProjectionLineage(
      sql,
      'HR',
      'V',
      new Map([
        ['A', 'HR.T_A'],
        ['B', 'HR.T_B'],
      ]),
    );
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: meta(['ONLY_ONE']),
    });
    expect(aligned.metrics.projectionCountMismatches).toBe(1);
    expect(aligned.projectionConfidence).not.toBe('exact_static');
  });

  it('supports quoted exposed column names from metadata', () => {
    const sql = `CREATE VIEW HR.V AS SELECT 1 AS X FROM dual`;
    const { projections } = extractViewProjectionLineage(sql, 'HR', 'V');
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: [{ owner: 'HR', viewName: 'V', columnName: 'Quoted Col', columnId: 1 }],
    });
    expect(aligned.projections[0]?.viewColumn).toBe('QUOTED COL');
  });

  it('supports qualified direct projection with metadata rename', () => {
    const sql = `CREATE VIEW HR.V AS SELECT hr.base.internal_id FROM hr.base`;
    const { projections } = extractViewProjectionLineage(sql, 'HR', 'V');
    const aligned = alignViewProjectionsWithSurface({
      viewOwner: 'HR',
      viewName: 'V',
      projections,
      exposedColumns: meta(['PUBLIC_ID']),
    });
    expect(aligned.projections[0]?.projectionKind).toBe('aliased_direct_column');
    expect(aligned.projections[0]?.viewColumn).toBe('PUBLIC_ID');
  });
});
