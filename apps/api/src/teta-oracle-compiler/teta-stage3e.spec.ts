/**
 * Stage 3E unit tests — fixture graphs and fixture plans only.
 * No live Stage 3A index, no Oracle connection, no SQL execution.
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
  isFilterOnlyQuerySource,
  querySourceUsageOf,
} from '../teta-query-planner/teta-query-plan.types';
import {
  ORACLE_IDENTIFIER_PATTERN,
  buildQualifiedColumn,
  buildQualifiedObjectName,
  isValidOracleIdentifier,
  parseOracleColumnNodeId,
  parseOracleObjectNodeId,
  toUpperSnakeIdentifier,
  validateIdentifier,
} from './teta-oracle-identifier-validator';
import { planSourceAliases, sourceAliasFor } from './teta-oracle-source-alias-planner';
import { createAccessColumnResolver } from './teta-oracle-access-column-resolver';
import { buildJoinTree, nullableSourceRoles } from './teta-oracle-join-tree-builder';
import {
  ORACLE_MONTH_START,
  ORACLE_NEXT_MONTH_START,
  ORACLE_SYSDATE,
  compileDateBoundary,
  compileHalfOpenInterval,
  compileNullableComparison,
  isOpenEndedOperator,
  mapComparisonOperator,
} from './teta-oracle-expression-compiler';
import { bindPlaceholderFor, createBindPlan } from './teta-oracle-bind-planner';
import { sha256Utf8 } from './teta-oracle-select-renderer';
import { validateCompiledSql } from './teta-oracle-compiled-sql-validator';
import {
  gateCompilationRequest,
  stableStringify,
  stripVolatileCompiledFields,
} from './teta-oracle-compiler-contract';
import {
  STAGE3E_CONTRACT_VERSION,
  STAGE3E_DIALECT,
  STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
  type CompilableQueryPlan,
} from './teta-oracle-compiler.types';
import {
  FX_OBJECTS,
  STAGE3E_FIXTURE_GRAPH_HASH,
  STAGE3E_REFERENCE_BHP_QUESTION,
  buildStage3eFixturePlan,
  compileStage3eFixture,
  createStage3eFixtureClient,
  createStage3eFixtureCompiler,
  fxColumnNodeId,
  renderStage3eAuditMarkdown,
  runStage3eAudit,
  verifyStage3eSqlArtifacts,
  writeAndVerifyStage3eArtifacts,
} from './teta-stage3e-audit';

const EXPECTED_FIXTURE_SQL = [
  'SELECT',
  '  S01.EMP_NO AS EMPLOYEE_NUMBER,',
  '  S01.FIRST_NAME AS EMPLOYEE_FIRST_NAME,',
  '  S01.LAST_NAME AS EMPLOYEE_LAST_NAME,',
  '  S03.NAME AS EXAMINATION_TYPE_NAME,',
  '  S02.VALID_FROM AS EXAMINATION_VALID_FROM,',
  '  S02.VALID_TO AS EXAMINATION_VALID_TO,',
  '  S06.NAME AS POSITION_NAME,',
  '  S05.NAME AS ORGANIZATIONAL_UNIT_NAME',
  'FROM TETA_ADMIN_P.FX_EMPLOYEE S01',
  'INNER JOIN TETA_ADMIN_P.FX_EXAM S02 ON S02.EMP_ID = S01.ID',
  'INNER JOIN TETA_ADMIN.FX_EXAM_TYPE S03 ON S02.TYPE_ID = S03.ID',
  'LEFT JOIN TETA_ADMIN.FX_POSITION S04 ON S01.ID = S04.EMP_ID',
  '  AND S04.VALID_FROM <= SYSDATE',
  '  AND (S04.VALID_TO IS NULL OR S04.VALID_TO >= SYSDATE)',
  'LEFT JOIN TETA_ADMIN.FX_ORG_UNIT S05 ON S04.UNIT_ID = S05.ID',
  'LEFT JOIN TETA_ADMIN.FX_POSITION_DICT S06 ON S04.POS_ID = S06.ID',
  "WHERE S02.VALID_TO >= TRUNC(SYSDATE,'MM')",
  "  AND S02.VALID_TO < ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)",
  '  AND EXISTS (',
  '    SELECT 1',
  '    FROM TETA_ADMIN.FX_CONTRACT E01',
  '    WHERE E01.EMP_ID = S01.ID',
  '      AND E01.VALID_FROM <= SYSDATE',
  '      AND (E01.VALID_TO IS NULL OR E01.VALID_TO >= SYSDATE)',
  '  )',
  'ORDER BY S02.VALID_TO ASC, S01.LAST_NAME ASC, S01.FIRST_NAME ASC',
  'FETCH FIRST 500 ROWS ONLY',
].join('\n');

function compiled() {
  return compileStage3eFixture();
}

function aliasPlanOf(plan: CompilableQueryPlan = buildStage3eFixturePlan()) {
  return planSourceAliases(plan);
}

function resolverOf(
  plan: CompilableQueryPlan = buildStage3eFixturePlan(),
  graphOptions: Parameters<typeof createStage3eFixtureClient>[0] = {},
) {
  const aliasPlan = planSourceAliases(plan);
  return {
    aliasPlan,
    resolver: createAccessColumnResolver({
      client: createStage3eFixtureClient(graphOptions),
      sources: aliasPlan.sources,
    }),
  };
}

function validateSql(sqlText: string, overrides: Partial<Parameters<typeof validateCompiledSql>[0]> = {}) {
  return validateCompiledSql({
    sqlText,
    sourceAliases: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'],
    existenceAliases: ['E01'],
    resultAliases: [
      'EMPLOYEE_NUMBER',
      'EMPLOYEE_FIRST_NAME',
      'EMPLOYEE_LAST_NAME',
      'EXAMINATION_TYPE_NAME',
      'EXAMINATION_VALID_FROM',
      'EXAMINATION_VALID_TO',
      'POSITION_NAME',
      'ORGANIZATIONAL_UNIT_NAME',
    ],
    owners: ['TETA_ADMIN', 'TETA_ADMIN_P'],
    bindPlaceholders: [],
    ...overrides,
  });
}

function gate(plan: CompilableQueryPlan, hash: string | null = STAGE3E_FIXTURE_GRAPH_HASH) {
  return gateCompilationRequest(
    {
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      dialect: STAGE3E_DIALECT,
    },
    hash,
    true,
  );
}

describe('Stage 3E — Oracle identifier validation', () => {
  test('1. accepts an upper-case Oracle identifier', () => {
    expect(isValidOracleIdentifier('NT_KP_PRC_PRACOWNICY')).toBe(true);
    expect(ORACLE_IDENTIFIER_PATTERN.test('S01')).toBe(true);
  });

  test('2. rejects lower-case identifiers', () => {
    expect(isValidOracleIdentifier('employee')).toBe(false);
    expect(validateIdentifier('objectName', 'employee')?.code).toBe('identifier_pattern_mismatch');
  });

  test('3. rejects identifiers starting with a digit', () => {
    expect(validateIdentifier('objectName', '1TABLE')?.code).toBe('identifier_pattern_mismatch');
  });

  test('4. rejects whitespace in identifiers', () => {
    expect(validateIdentifier('objectName', 'MY TABLE')?.code).toBe('whitespace_in_identifier');
  });

  test('5. rejects quoted identifiers', () => {
    expect(validateIdentifier('objectName', '"Mixed"')?.code).toBe('quoted_identifier_forbidden');
    expect(validateIdentifier('objectName', "O'BRIEN")?.code).toBe('string_literal_in_identifier');
  });

  test('6. rejects statement separators', () => {
    expect(validateIdentifier('objectName', 'T;DROP')?.code).toBe(
      'statement_separator_in_identifier',
    );
  });

  test('7. rejects database links', () => {
    expect(validateIdentifier('objectName', 'T@REMOTE')?.code).toBe('db_link_in_identifier');
  });

  test('8. rejects comment fragments and wildcards', () => {
    expect(validateIdentifier('objectName', 'T--X')?.code).toBe('comment_in_identifier');
    expect(validateIdentifier('objectName', 'T/*X')?.code).toBe('comment_in_identifier');
    expect(validateIdentifier('columnName', '*')?.code).toBe('wildcard_in_identifier');
  });

  test('9. builds OWNER.OBJECT from validated parts', () => {
    const result = buildQualifiedObjectName('TETA_ADMIN_P', 'FX_EMPLOYEE');
    expect(result.ok && result.text).toBe('TETA_ADMIN_P.FX_EMPLOYEE');
  });

  test('10. builds ALIAS.COLUMN from validated parts', () => {
    const result = buildQualifiedColumn('S01', 'EMP_NO');
    expect(result.ok && result.text).toBe('S01.EMP_NO');
  });

  test('11. refuses to build a qualified name from an invalid owner', () => {
    const result = buildQualifiedObjectName('teta admin', 'FX_EMPLOYEE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.kind).toBe('owner');
  });

  test('12. maps business roles to UPPER_SNAKE result aliases', () => {
    expect(toUpperSnakeIdentifier('employee_number')).toBe('EMPLOYEE_NUMBER');
    expect(toUpperSnakeIdentifier('organizational_unit_name')).toBe('ORGANIZATIONAL_UNIT_NAME');
  });

  test('13. normalises diacritics and separators in result aliases', () => {
    expect(toUpperSnakeIdentifier('rodzaj badania')).toBe('RODZAJ_BADANIA');
    expect(toUpperSnakeIdentifier('imię-pracownika')).toBe('IMIE_PRACOWNIKA');
    expect(toUpperSnakeIdentifier('2nd_column')).toBe('C_2ND_COLUMN');
  });

  test('14. parses oracle-column node ids', () => {
    expect(parseOracleColumnNodeId('oracle-column:TETA_ADMIN:FX_EXAM:VALID_TO')).toEqual({
      owner: 'TETA_ADMIN',
      objectName: 'FX_EXAM',
      columnName: 'VALID_TO',
    });
  });

  test('15. parses oracle-object node ids', () => {
    expect(parseOracleObjectNodeId('oracle-object:TETA_ADMIN_P:VIEW:FX_EMPLOYEE')).toEqual({
      owner: 'TETA_ADMIN_P',
      objectType: 'VIEW',
      objectName: 'FX_EMPLOYEE',
    });
  });

  test('16. returns null for unparsable node ids', () => {
    expect(parseOracleColumnNodeId('dataset-column:X')).toBeNull();
    expect(parseOracleObjectNodeId(null)).toBeNull();
  });
});

describe('Stage 3E — source alias planning', () => {
  test('17. assigns S01…S06 to row-producing sources in sources[] order', () => {
    const { sources } = aliasPlanOf();
    expect(sources.map((s) => s.alias)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06']);
    expect(sources.map((s) => s.sourceRole)).toEqual([
      'employee',
      'health_examination',
      'examination_type',
      'current_position',
      'organizational_unit',
      'position_dictionary',
    ]);
    expect(sources.every((s) => s.usage === 'row_source')).toBe(true);
  });

  test('17b. gives filter-only sources their own E alias space', () => {
    const { filterOnlySources, allSources, byRole } = aliasPlanOf();
    expect(filterOnlySources.map((s) => s.alias)).toEqual(['E01']);
    expect(filterOnlySources.map((s) => s.sourceRole)).toEqual(['active_employment']);
    expect(byRole.get('active_employment')?.usage).toBe('filter_only');
    // Plan order is preserved across both alias spaces, which is what makes the SQL deterministic.
    expect(allSources.map((s) => s.alias)).toEqual([
      'S01',
      'S02',
      'S03',
      'S04',
      'S05',
      'E01',
      'S06',
    ]);
  });

  test('17c. numbers a second filter-only source E02', () => {
    const plan = buildStage3eFixturePlan();
    plan.sources = plan.sources.map((s) =>
      s.sourceRole === 'organizational_unit' ? { ...s, sourceUsage: 'filter_only' as const } : s,
    );
    expect(planSourceAliases(plan).filterOnlySources.map((s) => s.alias)).toEqual(['E01', 'E02']);
  });

  test('17d. rejects a plan whose every source is filter-only', () => {
    const plan = buildStage3eFixturePlan();
    plan.sources = plan.sources.map((s) => ({ ...s, sourceUsage: 'filter_only' as const }));
    expect(planSourceAliases(plan).issues[0]?.code).toBe('no_row_producing_sources');
  });

  test('18. uses the access object, never the logical object', () => {
    const { byRole } = aliasPlanOf();
    const employee = byRole.get('employee')!;
    expect(employee.qualifiedName).toBe(`TETA_ADMIN_P.${FX_OBJECTS.employee}`);
    expect(employee.logicalOwner).toBe('TETA_ADMIN');
  });

  test('19. exposes deterministic role and alias lookups', () => {
    const plan = aliasPlanOf();
    expect(plan.byAlias.get('S05')?.sourceRole).toBe('organizational_unit');
    expect(sourceAliasFor(12)).toBe('S12');
  });

  test('20. reports duplicate source roles', () => {
    const plan = buildStage3eFixturePlan();
    plan.sources = [...plan.sources, plan.sources[0]!];
    expect(planSourceAliases(plan).issues[0]?.code).toBe('duplicate_source_role');
  });

  test('21. reports a missing access object', () => {
    const plan = buildStage3eFixturePlan();
    plan.sources = plan.sources.map((s, i) => (i === 0 ? { ...s, accessObject: null } : s));
    expect(planSourceAliases(plan).issues[0]?.code).toBe('missing_access_object');
  });
});

describe('Stage 3E — access column resolution', () => {
  test('22. keeps the same node id when logical and access objects match', () => {
    const { resolver } = resolverOf();
    const result = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.examType, 'NAME'),
      'examination_type',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.column.mappingKind).toBe('identical');
      expect(result.column.accessColumnNodeId).toBe(
        fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.examType, 'NAME'),
      );
    }
  });

  test('23. remaps a logical column to the access owner', () => {
    const { resolver } = resolverOf();
    const result = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'EMP_NO'),
      'employee',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.column.mappingKind).toBe('access_owner_remap');
      expect(result.column.accessColumnNodeId).toBe(
        fxColumnNodeId('TETA_ADMIN_P', FX_OBJECTS.employee, 'EMP_NO'),
      );
      expect(result.column.qualifiedExpression).toBe('S01.EMP_NO');
    }
  });

  test('24. carries HAS_COLUMN evidence for the remapped column', () => {
    const { resolver } = resolverOf();
    const result = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'LAST_NAME'),
      'employee',
    );
    expect(result.ok && result.column.evidenceEdgeIds.length).toBeGreaterThan(0);
  });

  test('25. rejects a column the access object cannot prove', () => {
    const { resolver } = resolverOf(buildStage3eFixturePlan(), {
      omitAccessColumns: ['EMP_NO'],
    });
    const result = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'EMP_NO'),
      'employee',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('missing_access_column_evidence');
  });

  test('26. rejects unparsable column node ids', () => {
    const { resolver } = resolverOf();
    const result = resolver.resolve('dataset-column:whatever', 'employee');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('unparsable_oracle_column_node_id');
  });

  test('27. rejects a column that belongs to another source', () => {
    const { resolver } = resolverOf();
    const result = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.exam, 'VALID_TO'),
      'employee',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('column_object_mismatch');
  });

  test('28. attributes a column to a source when no role is given', () => {
    const { resolver } = resolverOf();
    const result = resolver.resolve(fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.orgUnit, 'NAME'));
    expect(result.ok && result.column.sourceRole).toBe('organizational_unit');
  });

  test('29. counts access-owner remaps', () => {
    const { resolver } = resolverOf();
    resolver.resolve(fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'ID'), 'employee');
    resolver.resolve(fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.examType, 'ID'), 'examination_type');
    expect(resolver.remapCount()).toBe(1);
  });
});

describe('Stage 3E — join tree', () => {
  function tree(plan: CompilableQueryPlan = buildStage3eFixturePlan()) {
    const { aliasPlan, resolver } = resolverOf(plan);
    return buildJoinTree({
      plan,
      sources: aliasPlan.sources,
      byRole: aliasPlan.byRole,
      accessColumns: resolver,
    });
  }

  test('30. root is the first source not on a LEFT JOIN nullable side', () => {
    const result = tree();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tree.rootSourceRole).toBe('employee');
      expect(result.tree.rootAlias).toBe('S01');
    }
  });

  test('31. edge count equals row-producing sources - 1', () => {
    const result = tree();
    if (result.ok) {
      expect(result.tree.sourceCount).toBe(6);
      expect(result.tree.edgeCount).toBe(result.tree.sourceCount - 1);
      expect(result.tree.edgeCount).toBe(5);
    }
  });

  test('31b. a filter-only source is never joined into the main tree', () => {
    const plan = buildStage3eFixturePlan({ filterOnlyInMainJoinTree: true });
    const result = tree(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('filter_only_source_in_join_tree');
  });

  test('32. inner joins are emitted before left joins', () => {
    const result = tree();
    if (result.ok) {
      const keywords = result.tree.steps.map((s) => s.joinKeyword);
      expect(keywords).toEqual([
        'INNER JOIN',
        'INNER JOIN',
        'LEFT JOIN',
        'LEFT JOIN',
        'LEFT JOIN',
      ]);
    }
  });

  test('33. every LEFT JOIN keeps its preserved side already in the tree', () => {
    const result = tree();
    if (result.ok) {
      const seen = new Set([result.tree.rootSourceRole]);
      for (const step of result.tree.steps) {
        if (step.joinType === 'left') {
          expect(seen.has(step.anchorSourceRole)).toBe(true);
        }
        seen.add(step.joinedSourceRole);
      }
    }
  });

  test('34. reversed LEFT JOIN is unsupported', () => {
    const result = tree(buildStage3eFixturePlan({ reversedLeftJoin: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('left_join_reversal_unsupported');
  });

  test('35. cyclic join graph is rejected', () => {
    const result = tree(buildStage3eFixturePlan({ cyclicJoins: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe('cyclic_join_graph_unsupported');
      expect(result.cyclic).toBe(true);
    }
  });

  test('36. self join is rejected', () => {
    const result = tree(buildStage3eFixturePlan({ selfJoin: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe('self_join_unsupported');
      expect(result.selfJoins).toBeGreaterThan(0);
    }
  });

  test('37. join without predicates is rejected as cartesian', () => {
    const result = tree(buildStage3eFixturePlan({ cartesianJoin: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('cartesian_join_forbidden');
  });

  test('38. wrong join count is rejected', () => {
    const plan = buildStage3eFixturePlan();
    plan.joins = plan.joins.slice(0, 4);
    const result = tree(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('join_count_mismatch');
  });

  test('39. non-equality join operator is rejected', () => {
    const plan = buildStage3eFixturePlan();
    plan.joins = plan.joins.map((j, i) =>
      i === 0
        ? {
            ...j,
            predicates: j.predicates.map((p) => ({
              ...p,
              operator: 'greater_than' as unknown as 'equals',
            })),
          }
        : j,
    );
    const result = tree(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('unsupported_join_operator');
  });

  test('40. unresolved join is rejected', () => {
    const plan = buildStage3eFixturePlan();
    plan.joins = plan.joins.map((j, i) => (i === 0 ? { ...j, status: 'unproven' as const } : j));
    const result = tree(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('unresolved_join');
  });

  test('41. nullable roles are everything reached through a LEFT JOIN', () => {
    const result = tree();
    if (result.ok) {
      expect([...nullableSourceRoles(result.tree)].sort()).toEqual([
        'current_position',
        'organizational_unit',
        'position_dictionary',
      ]);
    }
  });

  test('42. tree reports itself as acyclic and connected', () => {
    const result = tree();
    if (result.ok) {
      expect(result.tree.acyclic).toBe(true);
      expect(result.tree.connected).toBe(true);
    }
  });
});

describe('Stage 3E — expression compilation', () => {
  test('43. month start uses TRUNC(SYSDATE,MM)', () => {
    const result = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'month_start',
      inclusive: true,
    });
    expect(result.ok && result.text).toBe(ORACLE_MONTH_START);
    expect(ORACLE_MONTH_START).toBe("TRUNC(SYSDATE,'MM')");
  });

  test('44. next month start uses ADD_MONTHS', () => {
    const result = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'next_month_start',
      inclusive: false,
    });
    expect(result.ok && result.text).toBe(ORACLE_NEXT_MONTH_START);
  });

  test('45. identity transform is SYSDATE', () => {
    const result = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'identity',
      inclusive: true,
    });
    expect(result.ok && result.text).toBe(ORACLE_SYSDATE);
  });

  test('46. unsupported transform and clock are rejected', () => {
    const badTransform = compileDateBoundary({
      clock: 'oracle_sysdate',
      transform: 'year_start' as unknown as 'identity',
      inclusive: true,
    });
    expect(badTransform.ok).toBe(false);
    const badClock = compileDateBoundary({
      clock: 'app_now' as unknown as 'oracle_sysdate',
      transform: 'identity',
      inclusive: true,
    });
    expect(badClock.ok).toBe(false);
    if (!badClock.ok) expect(badClock.code).toBe('unsupported_clock');
  });

  test('47. half-open interval emits inclusive lower and exclusive upper bounds', () => {
    const result = compileHalfOpenInterval(
      'S02.VALID_TO',
      { clock: 'oracle_sysdate', transform: 'month_start', inclusive: true },
      { clock: 'oracle_sysdate', transform: 'next_month_start', inclusive: false },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conditions).toEqual([
        "S02.VALID_TO >= TRUNC(SYSDATE,'MM')",
        "S02.VALID_TO < ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)",
      ]);
    }
  });

  test('48. open-ended interval end allows NULL', () => {
    expect(compileNullableComparison('S06.VALID_TO', '>=', ORACLE_SYSDATE)).toBe(
      '(S06.VALID_TO IS NULL OR S06.VALID_TO >= SYSDATE)',
    );
  });

  test('49. maps Stage 3C operator names to Oracle operators', () => {
    expect(mapComparisonOperator('less_or_equal')).toBe('<=');
    expect(mapComparisonOperator('greater_or_null')).toBe('>=');
    expect(mapComparisonOperator('like')).toBeNull();
  });

  test('50. detects open-ended operator names', () => {
    expect(isOpenEndedOperator('greater_or_null')).toBe(true);
    expect(isOpenEndedOperator('less_or_equal')).toBe(false);
  });
});

describe('Stage 3E — projections, filters and ordering', () => {
  test('51. all eight projections are qualified and aliased', () => {
    const result = compiled();
    expect(result.projections).toHaveLength(8);
    for (const projection of result.projections) {
      expect(projection.expression).toMatch(/^S\d{2}\.[A-Z][A-Z0-9_$#]*$/);
      expect(projection.resultAlias).toMatch(ORACLE_IDENTIFIER_PATTERN);
    }
  });

  test('52. result aliases are the UPPER_SNAKE business roles', () => {
    expect(compiled().projections.map((p) => p.resultAlias)).toEqual([
      'EMPLOYEE_NUMBER',
      'EMPLOYEE_FIRST_NAME',
      'EMPLOYEE_LAST_NAME',
      'EXAMINATION_TYPE_NAME',
      'EXAMINATION_VALID_FROM',
      'EXAMINATION_VALID_TO',
      'POSITION_NAME',
      'ORGANIZATIONAL_UNIT_NAME',
    ]);
  });

  test('53. unresolved projection blocks compilation', () => {
    const plan = buildStage3eFixturePlan();
    plan.projections = plan.projections.map((p, i) =>
      i === 0 ? { ...p, status: 'missing' as const } : p,
    );
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.compileStatus).toBe('rejected_invalid_plan');
    expect(result.rejection?.code).toBe('projection_not_resolved');
    expect(result.sqlText).toBeNull();
  });

  test('54. projection without column evidence blocks compilation', () => {
    const plan = buildStage3eFixturePlan();
    plan.projections = plan.projections.map((p, i) =>
      i === 0 ? { ...p, oracleColumnNodeId: null } : p,
    );
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.rejection?.code).toBe('projection_without_column_evidence');
  });

  test('55. current-month filter lands in WHERE', () => {
    const monthFilter = compiled().predicates.filter(
      (p) => p.filterRole === 'examination_valid_to_in_current_month',
    );
    expect(monthFilter).toHaveLength(2);
    expect(monthFilter.every((p) => p.placement === 'where')).toBe(true);
    expect(monthFilter[0]!.sql).toBe("S02.VALID_TO >= TRUNC(SYSDATE,'MM')");
    expect(monthFilter[1]!.sql).toBe("S02.VALID_TO < ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)");
  });

  test('56. active-employment filter compiles into a single correlated EXISTS predicate', () => {
    const activeFilter = compiled().predicates.filter(
      (p) => p.filterRole === 'employee_active_on_oracle_sysdate',
    );
    expect(activeFilter).toHaveLength(1);
    expect(activeFilter[0]!.filterType).toBe('correlated_exists');
    expect(activeFilter[0]!.placement).toBe('where');
    expect(activeFilter[0]!.sql).toBe(
      'EXISTS (SELECT 1 FROM TETA_ADMIN.FX_CONTRACT E01 WHERE E01.EMP_ID = S01.ID' +
        ' AND E01.VALID_FROM <= SYSDATE AND (E01.VALID_TO IS NULL OR E01.VALID_TO >= SYSDATE))',
    );
  });

  test('57. current-position filter is attached to its LEFT JOIN ON clause', () => {
    const positionFilter = compiled().predicates.filter(
      (p) => p.filterRole === 'current_position_on_oracle_sysdate',
    );
    expect(positionFilter).toHaveLength(2);
    expect(positionFilter.every((p) => p.placement === 'join_on')).toBe(true);
    expect(positionFilter.every((p) => p.targetJoinId === 'join:employee:current_position')).toBe(
      true,
    );
  });

  test('58. left-joined enrichment filters never appear in WHERE', () => {
    const sql = compiled().sqlText!;
    const whereBlock = sql.slice(sql.indexOf('WHERE'));
    expect(whereBlock).not.toContain('S04.');
  });

  test('59. filter with a non-resolved status blocks compilation', () => {
    const plan = buildStage3eFixturePlan();
    plan.filters = plan.filters.map((f, i) => (i === 0 ? { ...f, status: 'missing' as const } : f));
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.rejection?.code).toBe('filter_not_resolved');
  });

  test('60. unsupported filter type is rejected as unsupported', () => {
    const plan = buildStage3eFixturePlan();
    plan.filters = [
      ...plan.filters,
      {
        filterRole: 'weird',
        type: 'regex_match',
        status: 'resolved',
        provenanceNodeIds: [],
        provenanceEdgeIds: [],
      } as unknown as CompilableQueryPlan['filters'][number],
    ];
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.compileStatus).toBe('rejected_unsupported');
    expect(result.rejection?.code).toBe('unsupported_filter_type');
  });

  test('61. effective_on_date filter without predicates is rejected', () => {
    const plan = buildStage3eFixturePlan();
    plan.filters = plan.filters.map((f) =>
      f.filterRole === 'employee_active_on_oracle_sysdate'
        ? { ...f, resolvedPredicates: [] }
        : f,
    ) as CompilableQueryPlan['filters'];
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.rejection?.code).toBe('filter_without_compilable_predicates');
  });

  test('62. ORDER BY uses qualified columns, not result aliases', () => {
    const result = compiled();
    expect(result.ordering.map((o) => `${o.expression} ${o.direction}`)).toEqual([
      'S02.VALID_TO ASC',
      'S01.LAST_NAME ASC',
      'S01.FIRST_NAME ASC',
    ]);
    const orderByLine = result.sqlText!.split('\n').find((l) => l.startsWith('ORDER BY'))!;
    for (const alias of result.projections.map((p) => p.resultAlias)) {
      expect(orderByLine).not.toContain(` ${alias}`);
    }
  });

  test('63. descending ordering renders DESC', () => {
    const plan = buildStage3eFixturePlan();
    plan.ordering = plan.ordering.map((o, i) =>
      i === 0 ? { ...o, direction: 'descending' as const } : o,
    );
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.ordering[0]?.direction).toBe('DESC');
    expect(result.sqlText).toContain('ORDER BY S02.VALID_TO DESC');
  });

  test('64. unresolved ordering entries are skipped with a warning', () => {
    const plan = buildStage3eFixturePlan();
    plan.ordering = plan.ordering.map((o, i) =>
      i === 2 ? { ...o, status: 'missing' as const, oracleColumnNodeId: null } : o,
    );
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.compileStatus).toBe('compiled');
    expect(result.ordering).toHaveLength(2);
    expect(result.warnings.some((w) => w.code === 'ordering_entry_skipped')).toBe(true);
  });
});

describe('Stage 3E — bind planning', () => {
  test('65. bind placeholders are :P001, :P002, …', () => {
    expect(bindPlaceholderFor(1)).toBe(':P001');
    expect(bindPlaceholderFor(12)).toBe(':P012');
  });

  test('66. bind plan allocates in order of appearance', () => {
    const plan = createBindPlan();
    const first = plan.allocate({ filterRole: 'a', oracleType: 'string' });
    const second = plan.allocate({ filterRole: 'b', oracleType: 'number' });
    expect([first.placeholder, second.placeholder]).toEqual([':P001', ':P002']);
    expect(plan.names()).toEqual([':P001', ':P002']);
  });

  test('67. reference BHP shape needs no binds', () => {
    expect(compiled().binds).toEqual([]);
    expect(compiled().audit.bindCount).toBe(0);
  });

  test('68. user literal is bound, never inlined', () => {
    const result = compileStage3eFixture({ withUserLiteralFilter: true });
    expect(result.compileStatus).toBe('compiled');
    expect(result.binds).toHaveLength(1);
    expect(result.binds[0]?.placeholder).toBe(':P001');
    expect(result.sqlText).toContain('S01.EMP_NO = :P001');
    expect(result.sqlText).not.toContain('00122');
  });
});

describe('Stage 3E — rendered statement', () => {
  test('69. renders the expected deterministic statement', () => {
    expect(compiled().sqlText).toBe(EXPECTED_FIXTURE_SQL);
  });

  test('70. statement starts with SELECT and has no semicolon', () => {
    const sql = compiled().sqlText!;
    expect(sql.startsWith('SELECT\n')).toBe(true);
    expect(sql).not.toContain(';');
    expect(sql.endsWith(';')).toBe(false);
  });

  test('71. uses LF newlines, two-space indent and no trailing whitespace', () => {
    const sql = compiled().sqlText!;
    expect(sql).not.toContain('\r');
    expect(sql.split('\n').every((line) => !/\s$/.test(line))).toBe(true);
    expect(sql.split('\n')[1]).toBe('  S01.EMP_NO AS EMPLOYEE_NUMBER,');
  });

  test('72. never emits SELECT *', () => {
    expect(compiled().sqlText).not.toMatch(/\*/);
    expect(compiled().audit.selectStar).toBe(0);
  });

  test('73. ends with FETCH FIRST n ROWS ONLY from plan limits', () => {
    expect(compiled().sqlText!.endsWith('FETCH FIRST 500 ROWS ONLY')).toBe(true);
    const smaller = compileStage3eFixture({ maxRows: 50 });
    expect(smaller.sqlText!.endsWith('FETCH FIRST 50 ROWS ONLY')).toBe(true);
  });

  test('74. sqlSha256 is the sha256 of the UTF-8 statement text', () => {
    const result = compiled();
    expect(result.sqlSha256).toBe(
      createHash('sha256').update(result.sqlText!, 'utf8').digest('hex'),
    );
    expect(result.sqlSha256).toBe(sha256Utf8(result.sqlText!));
  });

  test('75. two compilations of the same plan are byte-identical', () => {
    const first = compiled();
    const second = compiled();
    expect(first.sqlText).toBe(second.sqlText);
    expect(stableStringify(stripVolatileCompiledFields(first))).toBe(
      stableStringify(stripVolatileCompiledFields(second)),
    );
  });

  test('76. only access objects appear in FROM/JOIN', () => {
    const result = compiled();
    const fromLines = result
      .sqlText!.split('\n')
      .filter((l) => l.startsWith('FROM') || l.includes('JOIN '));
    expect(fromLines).toHaveLength(6);
    expect(fromLines[0]).toBe(`FROM TETA_ADMIN_P.${FX_OBJECTS.employee} S01`);
    expect(result.audit.logicalObjectsUsedInSql).toBe(0);
  });

  test('77. every access column belongs to an allowed owner', () => {
    for (const column of compiled().accessColumns) {
      expect(['TETA_ADMIN', 'TETA_ADMIN_P']).toContain(column.owner);
    }
  });
});

describe('Stage 3E — compiled SQL token validator', () => {
  test('78. accepts the compiled reference statement', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('79. rejects line and block comments', () => {
    expect(validateSql(`${EXPECTED_FIXTURE_SQL} -- sneaky`).ok).toBe(false);
    expect(validateSql(`${EXPECTED_FIXTURE_SQL} /* sneaky */`).checks.no_sql_comments).toBe(false);
  });

  test('80. rejects optimizer hints', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('SELECT', 'SELECT /*+ FULL(S01) */'));
    expect(result.checks.no_optimizer_hints).toBe(false);
  });

  test('81. rejects wildcard column lists', () => {
    const result = validateSql('SELECT * FROM TETA_ADMIN.FX_EMPLOYEE S01\nFETCH FIRST 1 ROWS ONLY');
    expect(result.checks.no_select_star).toBe(false);
  });

  test('82. rejects DML, DDL and transaction control', () => {
    expect(validateSql(`${EXPECTED_FIXTURE_SQL}\nUPDATE X`).checks.no_dml_or_ddl).toBe(false);
    expect(validateSql(`DELETE FROM T`).checks.no_dml_or_ddl).toBe(false);
    expect(validateSql(`${EXPECTED_FIXTURE_SQL}\nCOMMIT`).checks.no_dml_or_ddl).toBe(false);
  });

  test('83. rejects PL/SQL blocks', () => {
    expect(validateSql('BEGIN NULL END').checks.no_plsql_block).toBe(false);
    expect(validateSql('DECLARE X').checks.no_plsql_block).toBe(false);
  });

  test('84. rejects FOR UPDATE', () => {
    expect(validateSql(`${EXPECTED_FIXTURE_SQL}\nFOR UPDATE`).checks.no_for_update).toBe(false);
  });

  test('85. rejects WITH clauses and set operators', () => {
    expect(validateSql('WITH X AS (SELECT 1) SELECT 1').checks.no_with_clause).toBe(false);
    expect(
      validateSql(`${EXPECTED_FIXTURE_SQL}\nUNION ALL`).checks.no_set_operator,
    ).toBe(false);
  });

  test('86. rejects semicolons and multiple statements', () => {
    const result = validateSql(`${EXPECTED_FIXTURE_SQL};\nSELECT 1 FROM DUAL`);
    expect(result.checks.no_semicolon).toBe(false);
    expect(result.checks.single_statement).toBe(false);
  });

  test('87. rejects database links', () => {
    expect(
      validateSql(EXPECTED_FIXTURE_SQL.replace('FX_EMPLOYEE S01', 'FX_EMPLOYEE@REMOTE S01')).checks
        .no_db_link,
    ).toBe(false);
  });

  test('88. rejects unqualified columns', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('S01.EMP_NO AS', 'EMP_NO AS'));
    expect(result.checks.all_columns_qualified).toBe(false);
    expect(result.violations.some((v) => v.code === 'unqualified_identifier')).toBe(true);
  });

  test('89. rejects unknown qualifiers', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('S01.EMP_NO AS', 'X9.EMP_NO AS'));
    expect(result.violations.some((v) => v.code === 'unknown_qualifier')).toBe(true);
  });

  test('90. rejects inline literals other than date masks', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace('FETCH FIRST', "  AND S01.EMP_NO = '00122'\nFETCH FIRST"),
    );
    expect(result.checks.no_unbound_user_literals).toBe(false);
  });

  test('91. rejects undeclared bind variables', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace('FETCH FIRST', '  AND S01.EMP_NO = :P001\nFETCH FIRST'),
    );
    expect(result.violations.some((v) => v.code === 'unknown_bind_variable')).toBe(true);
  });

  test('92. accepts declared bind variables', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace('FETCH FIRST', '  AND S01.EMP_NO = :P001\nFETCH FIRST'),
      { bindPlaceholders: [':P001'] },
    );
    expect(result.ok).toBe(true);
  });

  test('93. requires a row limit', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace('\nFETCH FIRST 500 ROWS ONLY', ''),
    );
    expect(result.checks.row_limit_present).toBe(false);
  });

  test('94. requires the statement to start with SELECT', () => {
    const result = validateSql(`\n${EXPECTED_FIXTURE_SQL}`);
    expect(result.checks.starts_with_select).toBe(false);
  });
});

describe('Stage 3E — compilation gate', () => {
  test('95. accepts a ready fixture plan', () => {
    expect(gate(buildStage3eFixturePlan()).ok).toBe(true);
  });

  test('96. rejects a plan that is not ready_for_compilation', () => {
    const result = gate(buildStage3eFixturePlan({ planStatus: 'needs_selection' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_not_ready');
      expect(result.code).toBe('source_plan_not_ready_for_compilation');
    }
  });

  test('97. rejects an unsupported source plan contract', () => {
    const result = gate(buildStage3eFixturePlan({ contractVersion: 'teta-aia-old-plan-v0' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_invalid_plan');
      expect(result.code).toBe('unsupported_source_plan_contract');
    }
  });

  test('98. rejects a graphSourceHash mismatch', () => {
    const result = gate(buildStage3eFixturePlan(), 'another-hash');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('graph_source_hash_mismatch');
  });

  test('99. rejects a plan that grants SQL execution', () => {
    const result = gate(buildStage3eFixturePlan({ allowSqlExecution: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_unsafe');
      expect(result.code).toBe('execution_policy_violation');
    }
  });

  test('100. rejects a plan that grants an Oracle connection', () => {
    const result = gate(buildStage3eFixturePlan({ allowOracleConnection: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('execution_policy_violation');
  });

  test('101. still compiles although Stage 3C sets sqlCompilationAllowed=false', () => {
    const plan = buildStage3eFixturePlan();
    expect(plan.executionPolicy.sqlCompilationAllowed).toBe(false);
    expect(gate(plan).ok).toBe(true);
    expect(compiled().compileStatus).toBe('compiled');
  });

  test('102. rejects HRM and UNKNOWN owners', () => {
    const hrm = gate(buildStage3eFixturePlan({ employeeAccessOwner: 'HRM' }));
    expect(hrm.ok).toBe(false);
    if (!hrm.ok) {
      expect(hrm.compileStatus).toBe('rejected_unsafe');
      expect(hrm.code).toBe('forbidden_owner');
    }
    const unknown = gate(buildStage3eFixturePlan({ employeeAccessOwner: 'UNKNOWN' }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe('forbidden_owner');
  });

  test('103. rejects owners outside the allow-list', () => {
    const result = gate(buildStage3eFixturePlan({ employeeAccessOwner: 'SOME_OTHER_SCHEMA' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('owner_not_allowed');
  });

  test('104. rejects an unsupported intent', () => {
    const result = gate(buildStage3eFixturePlan({ intent: 'explain_payroll_component' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_unsupported');
      expect(result.code).toBe('unsupported_intent');
    }
  });

  test('105. rejects an unsupported subject', () => {
    const result = gate(buildStage3eFixturePlan({ subject: 'payroll_components' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_subject');
  });

  test('106. rejects a non-Oracle19c dialect', () => {
    const result = gateCompilationRequest(
      {
        queryPlan: buildStage3eFixturePlan(),
        expectedIntent: STAGE3C_SUPPORTED_INTENT,
        expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
        dialect: 'postgres16',
      },
      STAGE3E_FIXTURE_GRAPH_HASH,
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_unsupported');
      expect(result.code).toBe('unsupported_dialect');
    }
  });

  test('107. rejects invalid row limits', () => {
    expect(gate(buildStage3eFixturePlan({ maxRows: 0 })).ok).toBe(false);
    const tooMany = gate(buildStage3eFixturePlan({ maxRows: 501 }));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.code).toBe('invalid_row_limit');
  });

  test('108. rejects invalid column limits and timeouts', () => {
    const columns = gate(buildStage3eFixturePlan({ maxColumns: 21 }));
    expect(columns.ok).toBe(false);
    if (!columns.ok) expect(columns.code).toBe('invalid_column_limit');
    const timeout = gate(buildStage3eFixturePlan({ statementTimeoutMs: 30001 }));
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.code).toBe('invalid_statement_timeout');
  });

  test('109. rejects more projections than the column limit allows', () => {
    const result = gate(buildStage3eFixturePlan({ maxColumns: 4 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('projection_count_over_limit');
  });

  test('110. rejects a plan that reports cartesian joins', () => {
    const result = gate(buildStage3eFixturePlan({ cartesianJoinsCounter: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('cartesian_join_in_plan');
  });

  test('111. rejects blocking unresolved selections', () => {
    const plan = buildStage3eFixturePlan();
    plan.unresolvedSelections = [
      { subject: 'x', reason: 'two candidates', candidateNodeIds: ['a', 'b'], blocksPlanning: true },
    ];
    const result = gate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('blocking_unresolved_selection');
  });

  test('112. tolerates non-blocking unresolved selections', () => {
    const plan = buildStage3eFixturePlan();
    plan.unresolvedSelections = [
      { subject: 'x', reason: 'informational', candidateNodeIds: ['a'], blocksPlanning: false },
    ];
    expect(gate(plan).ok).toBe(true);
  });

  test('113. requires a graph client', () => {
    const result = gateCompilationRequest(
      {
        queryPlan: buildStage3eFixturePlan(),
        expectedIntent: STAGE3C_SUPPORTED_INTENT,
        expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      },
      STAGE3E_FIXTURE_GRAPH_HASH,
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('graph_client_missing');
  });
});

describe('Stage 3E — contract and audit', () => {
  test('114. exposes the documented contract constants', () => {
    expect(STAGE3E_CONTRACT_VERSION).toBe('teta-aia-oracle-select-v1');
    expect(STAGE3E_DIALECT).toBe('oracle19c');
    expect(STAGE3E_SOURCE_PLAN_CONTRACT_VERSION).toBe('teta-aia-readonly-query-plan-v1');
    expect(STAGE3E_SOURCE_PLAN_CONTRACT_VERSION).toBe(STAGE3C_CONTRACT_VERSION);
  });

  test('115. compiled output carries the contract, dialect and no rejection', () => {
    const result = compiled();
    expect(result.contractVersion).toBe(STAGE3E_CONTRACT_VERSION);
    expect(result.dialect).toBe(STAGE3E_DIALECT);
    expect(result.sourcePlanContractVersion).toBe(STAGE3E_SOURCE_PLAN_CONTRACT_VERSION);
    expect(result.rejection).toBeNull();
    expect(result.validation.ok).toBe(true);
  });

  test('116. rejected compilations never carry SQL', () => {
    for (const options of [
      { planStatus: 'invalid' as const },
      { allowSqlExecution: true },
      { employeeAccessOwner: 'HRM' },
      { cyclicJoins: true },
      { selfJoin: true },
    ]) {
      const result = compileStage3eFixture(options);
      expect(result.compileStatus).not.toBe('compiled');
      expect(result.sqlText).toBeNull();
      expect(result.sqlSha256).toBeNull();
    }
  });

  test('117. execution policy stays closed on compiled output', () => {
    const policy = compiled().executionPolicy;
    expect(policy.sqlExecutionAllowed).toBe(false);
    expect(policy.oracleConnectionAllowed).toBe(false);
    expect(policy.oracleWriteAllowed).toBe(false);
    expect(policy.fileReadAllowed).toBe(false);
  });

  test('118. side-effect counters are all zero', () => {
    const audit = compiled().audit;
    for (const key of [
      'sqlExecuted',
      'oracleConnections',
      'oracleWrites',
      'businessDataRowsRead',
      'xlsxFilesRead',
      'qdrantCalls',
      'embeddingCalls',
      'llmCalls',
      'agentCalls',
      'selectStar',
      'unqualifiedColumns',
      'sqlComments',
      'optimizerHints',
      'semicolons',
      'dmlStatements',
      'plsqlBlocks',
      'dbLinks',
      'forUpdateClauses',
      'withClauses',
      'multipleStatements',
      'unboundUserLiterals',
      'cartesianJoins',
      'crossJoins',
      'selfJoins',
      'cyclicJoinGraphs',
      'invalidIdentifiers',
      'missingAccessColumns',
      'forbiddenOwnerReferences',
      'logicalObjectsUsedInSql',
      'filterOnlySourcesInMainJoinTree',
      'filterOnlyAliasesOutsideExists',
      'uncontrolledSubqueries',
      'inSubqueries',
      'distinctClauses',
    ] as const) {
      expect(audit[key]).toBe(0);
    }
    expect(audit.statementsCompiled).toBe(1);
  });

  test('119. audit records shape counters and versions', () => {
    const audit = compiled().audit;
    expect(audit.sourceCount).toBe(7);
    expect(audit.joinCount).toBe(5);
    expect(audit.projectionCount).toBe(8);
    expect(audit.predicateCount).toBe(5);
    expect(audit.existenceFilterCount).toBe(1);
    expect(audit.rowProducingSources).toBe(6);
    expect(audit.filterOnlySources).toBe(1);
    expect(audit.existenceFiltersCompiled).toBe(1);
    expect(audit.reportGrainDefined).toBe(1);
    expect(audit.orderingCount).toBe(3);
    expect(audit.accessColumnRemaps).toBeGreaterThan(0);
    expect(audit.deterministic).toBe(true);
    expect(audit.semanticBindingsVersion).toBe('teta-aia-business-semantic-bindings-v1');
  });

  test('120. evidence lists access and logical node ids', () => {
    const result = compiled();
    expect(result.evidence.graphSourceHash).toBe(STAGE3E_FIXTURE_GRAPH_HASH);
    expect(result.evidence.nodeIds.length).toBeGreaterThan(0);
    expect(result.evidence.edgeIds.length).toBeGreaterThan(0);
    expect(result.evidence.nodeIds).toEqual([...result.evidence.nodeIds].sort());
  });

  test('121. missing access column evidence is reported as an invalid plan', () => {
    const result = compileStage3eFixture({}, { omitAccessColumns: ['EMP_NO'] });
    expect(result.compileStatus).toBe('rejected_invalid_plan');
    expect(result.rejection?.code).toBe('missing_access_column_evidence');
    expect(result.audit.missingAccessColumns).toBe(1);
  });

  test('122. reference question is the BHP report question', () => {
    expect(STAGE3E_REFERENCE_BHP_QUESTION).toContain('badania BHP');
  });

  test('123. audit report has no strict errors on fixtures', () => {
    const { report, live } = runStage3eAudit({
      liveCompiler: createStage3eFixtureCompiler(),
      livePlan: buildStage3eFixturePlan(),
      graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
      graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
      semanticBindingsVersion: 'teta-aia-business-semantic-bindings-v1',
    });
    expect(report.strictErrors).toEqual([]);
    expect(report.liveCompileStatus).toBe('compiled');
    expect(live.sqlText).toBe(EXPECTED_FIXTURE_SQL);
  });

  test('124. audit covers references A–M', () => {
    const { report } = runStage3eAudit({
      liveCompiler: createStage3eFixtureCompiler(),
      livePlan: buildStage3eFixturePlan(),
      graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
      graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
      semanticBindingsVersion: 'teta-aia-business-semantic-bindings-v1',
    });
    expect(report.referenceResults.map((r) => r.reference)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
      'M',
    ]);
    expect(report.referencesPassed).toBe(report.referencesTested);
    expect(report.deterministicCheckOk).toBe(true);
  });

  test('125. audit markdown embeds the compiled statement', () => {
    const { report, live } = runStage3eAudit({
      liveCompiler: createStage3eFixtureCompiler(),
      livePlan: buildStage3eFixturePlan(),
      graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
      graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
      semanticBindingsVersion: 'teta-aia-business-semantic-bindings-v1',
    });
    const markdown = renderStage3eAuditMarkdown(report, live);
    expect(markdown).toContain('# AIA Oracle SELECT Compiler — Stage 3E');
    expect(markdown).toContain(EXPECTED_FIXTURE_SQL);
    expect(markdown).toContain(report.liveSqlSha256!);
  });

  test('126. Stage 3C plan contract is not modified by Stage 3E', () => {
    const plan = buildStage3eFixturePlan();
    const before = stableStringify(plan);
    compileStage3eFixture();
    createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(stableStringify(plan)).toBe(before);
  });
});

describe('Stage 3E — filter-only sources compile as correlated EXISTS', () => {
  test('127. active employment is a filter-only source, not a row source', () => {
    const plan = buildStage3eFixturePlan();
    const source = plan.sources.find((s) => s.sourceRole === 'active_employment')!;
    expect(source.sourceUsage).toBe('filter_only');
    expect(isFilterOnlyQuerySource(source)).toBe(true);
    expect(plan.joins.some((j) => j.rightSourceRole === 'active_employment')).toBe(false);
  });

  test('128. sources without an explicit usage stay row-producing', () => {
    const employee = buildStage3eFixturePlan().sources.find((s) => s.sourceRole === 'employee')!;
    expect(querySourceUsageOf({ ...employee, sourceUsage: undefined })).toBe('row_source');
  });

  test('129. the compiled statement carries the existence filter and its provenance', () => {
    const result = compiled();
    expect(result.existenceFilters).toHaveLength(1);
    const existence = result.existenceFilters[0]!;
    expect(existence.filterRole).toBe('employee_active_on_oracle_sysdate');
    expect(existence.relationRole).toBe('employee_to_active_employment');
    expect(existence.correlatedSourceRole).toBe('employee');
    expect(existence.correlatedAlias).toBe('S01');
    expect(existence.filterOnlySourceRole).toBe('active_employment');
    expect(existence.existenceAlias).toBe('E01');
    expect(existence.preservesReportGrain).toBe(true);
    expect(existence.correlationConditions).toEqual(['E01.EMP_ID = S01.ID']);
    expect(existence.temporalConditions).toEqual([
      'E01.VALID_FROM <= SYSDATE',
      '(E01.VALID_TO IS NULL OR E01.VALID_TO >= SYSDATE)',
    ]);
    expect(existence.accessColumnNodeIds).toEqual([...existence.accessColumnNodeIds].sort());
  });

  test('130. the EXISTS renders as SELECT 1 over the access object only', () => {
    const sql = compiled().sqlText!;
    expect(sql).toContain('  AND EXISTS (');
    expect(sql).toContain('    SELECT 1');
    expect(sql).toContain(`    FROM TETA_ADMIN.${FX_OBJECTS.contract} E01`);
    expect(sql).toContain('    WHERE E01.EMP_ID = S01.ID');
    expect(sql).not.toContain(`JOIN TETA_ADMIN.${FX_OBJECTS.contract}`);
  });

  test('131. the filter-only object never reaches FROM or JOIN of the main tree', () => {
    const result = compiled();
    const mainTreeLines = result
      .sqlText!.split('\n')
      .filter((l) => l.startsWith('FROM ') || l.startsWith('INNER JOIN') || l.startsWith('LEFT JOIN'));
    expect(mainTreeLines.some((l) => l.includes(FX_OBJECTS.contract))).toBe(false);
    expect(result.joinTree!.sourceCount).toBe(6);
    expect(result.joinTree!.edgeCount).toBe(5);
    expect(result.audit.filterOnlySourcesInMainJoinTree).toBe(0);
  });

  test('132. the temporal filter is not emitted a second time against the main tree', () => {
    const sql = compiled().sqlText!;
    const outsideExists = sql.replace(/ {2}AND EXISTS \([\s\S]*?\n {2}\)\n/, '\n');
    expect(outsideExists).not.toContain('E01.');
    expect(outsideExists).not.toContain(FX_OBJECTS.contract);
    // The only remaining `<= SYSDATE` bound belongs to the current-position LEFT JOIN.
    expect(outsideExists.match(/VALID_FROM <= SYSDATE/g)).toEqual(['VALID_FROM <= SYSDATE']);
    expect(outsideExists).toContain('AND S04.VALID_FROM <= SYSDATE');
    expect(compiled().audit.filterOnlyAliasesOutsideExists).toBe(0);
  });

  test('133. the compiled statement records the report grain', () => {
    expect(compiled().reportGrain).toBe('health_examination');
    expect(compileStage3eFixture({ omitReportGrain: true }).reportGrain).toBeNull();
    expect(compileStage3eFixture({ omitReportGrain: true }).audit.reportGrainDefined).toBe(0);
  });

  test('134. joining the filter-only source is rejected as unsafe', () => {
    const result = compileStage3eFixture({ filterOnlyInMainJoinTree: true });
    expect(result.compileStatus).toBe('rejected_unsafe');
    expect(result.rejection?.code).toBe('filter_only_source_in_join_tree');
    expect(result.sqlText).toBeNull();
  });

  test('135. a filter-only source without an existence filter is rejected as unsafe', () => {
    const result = compileStage3eFixture({ omitExistenceFilters: true });
    expect(result.compileStatus).toBe('rejected_unsafe');
    expect(result.rejection?.code).toBe('filter_only_source_without_existence_filter');
  });

  test('136. an uncorrelated existence filter is rejected as unsafe', () => {
    const result = compileStage3eFixture({ uncorrelatedExistenceFilter: true });
    expect(result.compileStatus).toBe('rejected_unsafe');
    expect(result.rejection?.code).toBe('uncorrelated_existence_filter');
  });

  test('137. projecting a filter-only column is rejected as unsafe', () => {
    const result = compileStage3eFixture({ projectFilterOnlySource: true });
    expect(result.compileStatus).toBe('rejected_unsafe');
    expect(result.rejection?.code).toBe('filter_only_source_in_projection');
  });

  test('138. ordering by a filter-only column is rejected as unsafe', () => {
    const result = compileStage3eFixture({ orderByFilterOnlySource: true });
    expect(result.compileStatus).toBe('rejected_unsafe');
    expect(result.rejection?.code).toBe('filter_only_source_in_ordering');
  });

  test('139. an existence filter that is not resolved blocks compilation', () => {
    const plan = buildStage3eFixturePlan();
    plan.existenceFilters = plan.existenceFilters!.map((e) => ({ ...e, status: 'incomplete' }));
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.rejection?.code).toBe('existence_filter_not_resolved');
  });

  test('140. an existence filter must target a filter-only source', () => {
    const plan = buildStage3eFixturePlan();
    plan.existenceFilters = plan.existenceFilters!.map((e) => ({
      ...e,
      filterOnlySourceRole: 'organizational_unit',
    }));
    const result = createStage3eFixtureCompiler().compile({
      queryPlan: plan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(result.rejection?.code).toBe('filter_only_source_without_existence_filter');
  });

  test('141. an access column the graph cannot prove blocks the EXISTS', () => {
    const result = compileStage3eFixture({}, { omitContractColumns: ['EMP_ID'] });
    expect(result.compileStatus).toBe('rejected_invalid_plan');
    expect(result.rejection?.code).toBe('missing_access_column_evidence');
    expect(result.audit.missingAccessColumns).toBe(1);
    expect(result.sqlText).toBeNull();
  });

  test('142. a filter-only column is only addressable when its role is named', () => {
    const { aliasPlan } = resolverOf();
    const resolver = createAccessColumnResolver({
      client: createStage3eFixtureClient(),
      sources: aliasPlan.allSources,
    });
    const implicit = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.contract, 'VALID_FROM'),
    );
    expect(implicit.ok).toBe(false);
    const explicit = resolver.resolve(
      fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.contract, 'VALID_FROM'),
      'active_employment',
    );
    expect(explicit.ok && explicit.column.qualifiedExpression).toBe('E01.VALID_FROM');
  });
});

describe('Stage 3E — validator guards around subqueries', () => {
  test('143. accepts the controlled EXISTS the compiler produces', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL);
    expect(result.checks.controlled_exists_only).toBe(true);
    expect(result.checks.filter_only_aliases_confined_to_exists).toBe(true);
    expect(result.checks.single_statement).toBe(true);
  });

  test('144. rejects DISTINCT', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('SELECT\n', 'SELECT DISTINCT\n'));
    expect(result.checks.no_distinct).toBe(false);
    expect(result.ok).toBe(false);
  });

  test('145. rejects an uncorrelated EXISTS', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace('WHERE E01.EMP_ID = S01.ID', 'WHERE E01.EMP_ID IS NOT NULL'),
    );
    expect(result.checks.controlled_exists_only).toBe(false);
    expect(result.violations.some((v) => v.code === 'uncorrelated_exists_subquery')).toBe(true);
  });

  test('146. rejects a subquery that selects columns instead of SELECT 1', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('SELECT 1', 'SELECT E01.EMP_ID'));
    expect(result.checks.controlled_exists_only).toBe(false);
    expect(result.violations.some((v) => v.code === 'uncontrolled_exists_subquery')).toBe(true);
  });

  test('147. rejects SELECT * inside a subquery', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('SELECT 1', 'SELECT *'));
    expect(result.checks.no_select_star).toBe(false);
    expect(result.ok).toBe(false);
  });

  test('148. rejects a nested subquery inside the EXISTS', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace(
        'WHERE E01.EMP_ID = S01.ID',
        'WHERE E01.EMP_ID = S01.ID AND EXISTS (SELECT 1 FROM TETA_ADMIN.FX_CONTRACT E02 WHERE E02.EMP_ID = E01.EMP_ID)',
      ),
    );
    expect(result.checks.controlled_exists_only).toBe(false);
  });

  test('149. rejects an IN (…) subquery', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace(
        'ORDER BY',
        '  AND S01.ID IN (SELECT E01.EMP_ID FROM TETA_ADMIN.FX_CONTRACT E01)\nORDER BY',
      ),
    );
    expect(result.checks.no_in_subquery).toBe(false);
  });

  test('150. rejects a filter-only alias used outside an EXISTS', () => {
    const result = validateSql(
      EXPECTED_FIXTURE_SQL.replace(
        'ORDER BY S02.VALID_TO ASC',
        'ORDER BY E01.VALID_FROM ASC, S02.VALID_TO ASC',
      ),
    );
    expect(result.checks.filter_only_aliases_confined_to_exists).toBe(false);
    expect(result.violations.some((v) => v.code === 'filter_only_alias_outside_exists')).toBe(true);
  });

  test('151. rejects an EXISTS with unbalanced parentheses', () => {
    const result = validateSql(EXPECTED_FIXTURE_SQL.replace('\n  )\nORDER BY', '\nORDER BY'));
    expect(result.checks.controlled_exists_only).toBe(false);
  });

  test('152. still rejects a second top-level SELECT', () => {
    const result = validateSql(`${EXPECTED_FIXTURE_SQL}\nSELECT 1 FROM DUAL`);
    expect(result.checks.single_statement).toBe(false);
  });
});

describe('Stage 3E — compilation gate rejects filter-only misuse', () => {
  test('153. accepts the fixture plan with its existence filter', () => {
    const plan = buildStage3eFixturePlan();
    expect(plan.existenceFilters).toHaveLength(1);
    expect(gate(plan).ok).toBe(true);
  });

  test('154. rejects a plan where every source is filter-only', () => {
    const plan = buildStage3eFixturePlan();
    plan.sources = plan.sources.map((s) => ({ ...s, sourceUsage: 'filter_only' as const }));
    const result = gate(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_invalid_plan');
      expect(result.code).toBe('no_row_producing_sources');
    }
  });

  test('155. rejects a filter-only source that also appears in plan joins', () => {
    const result = gate(buildStage3eFixturePlan({ filterOnlyInMainJoinTree: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compileStatus).toBe('rejected_unsafe');
      expect(result.code).toBe('filter_only_source_in_join_tree');
    }
  });

  test('156. rejects a filter-only source with no existence filter', () => {
    const result = gate(buildStage3eFixturePlan({ omitExistenceFilters: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('filter_only_source_without_existence_filter');
  });

  test('157. rejects a projected filter-only source', () => {
    const result = gate(buildStage3eFixturePlan({ projectFilterOnlySource: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('filter_only_source_in_projection');
  });
});

describe('Stage 3E — artifact hash consistency', () => {
  const artifactDir = path.join(tmpdir(), 'teta-stage3e-artifacts');

  function auditInto(dir: string) {
    const { report, live } = runStage3eAudit({
      liveCompiler: createStage3eFixtureCompiler(),
      livePlan: buildStage3eFixturePlan(),
      graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
      graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
      semanticBindingsVersion: 'teta-aia-business-semantic-bindings-v1',
    });
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(
      path.join(dir, 'docs', 'session-context.md'),
      '# ctx\n\n`sqlSha256` = `' + '0'.repeat(64) + '`\n',
      'utf8',
    );
    const verification = writeAndVerifyStage3eArtifacts({ report, repoRoot: dir, live });
    return { report, live, verification };
  }

  beforeEach(() => {
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(artifactDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(artifactDir, { recursive: true, force: true });
  });

  test('158. one audit run leaves every artifact on the same sqlSha256', () => {
    const { report, live, verification } = auditInto(artifactDir);
    expect(verification.expectedSha256).toBe(sha256Utf8(live.sqlText!));
    expect(live.sqlSha256).toBe(verification.expectedSha256);
    expect(report.sqlArtifactHashMismatches).toBe(0);
    expect(report.sqlArtifactTextMismatches).toBe(0);
    expect(report.sessionContextHashMismatch).toBe(0);
    expect(report.typecheckErrors).toBe(0);
    expect(report.strictErrors).toEqual([]);
    expect(report.artifactHashChecks.length).toBeGreaterThanOrEqual(6);
    expect(report.artifactHashChecks.every((c) => c.hashOk)).toBe(true);
  });

  test('159. the session notes are rewritten to the freshly compiled hash', () => {
    const { live } = auditInto(artifactDir);
    const notes = readFileSync(path.join(artifactDir, 'docs', 'session-context.md'), 'utf8');
    expect(notes).toContain('`sqlSha256` = `' + live.sqlSha256 + '`');
  });

  test('160. a stale hash in the session notes is reported, not silently accepted', () => {
    const { live } = auditInto(artifactDir);
    writeFileSync(
      path.join(artifactDir, 'docs', 'session-context.md'),
      '# ctx\n\n`sqlSha256` = `' + 'e'.repeat(64) + '`\n',
      'utf8',
    );
    const verification = verifyStage3eSqlArtifacts({ repoRoot: artifactDir, live });
    expect(verification.sessionContextHashMismatch).toBe(1);
    expect(verification.sqlArtifactHashMismatches).toBe(1);
  });

  test('161. drifting SQL text in a stored artifact is reported', () => {
    const { live } = auditInto(artifactDir);
    const sqlPath = path.join(
      artifactDir,
      '.local',
      'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.sql',
    );
    writeFileSync(sqlPath, live.sqlText!.replace('FETCH FIRST 500', 'FETCH FIRST 499'), 'utf8');
    const verification = verifyStage3eSqlArtifacts({ repoRoot: artifactDir, live });
    expect(verification.sqlArtifactTextMismatches).toBe(1);
    expect(verification.sqlArtifactHashMismatches).toBe(1);
  });

  test('162. the documented statement is byte-identical to the compiled one', () => {
    const { live } = auditInto(artifactDir);
    const markdown = readFileSync(
      path.join(artifactDir, 'docs', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.md'),
      'utf8',
    );
    expect(markdown).toContain(live.sqlText!);
    expect(markdown).toContain(live.sqlSha256!);
    const docsJson = JSON.parse(
      readFileSync(path.join(artifactDir, 'docs', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.json'), 'utf8'),
    ) as { liveSqlSha256: string; sqlArtifactHashMismatches: number };
    expect(docsJson.liveSqlSha256).toBe(live.sqlSha256);
    expect(docsJson.sqlArtifactHashMismatches).toBe(0);
  });

  test('163. a missing artifact counts as a mismatch', () => {
    const { live } = auditInto(artifactDir);
    rmSync(path.join(artifactDir, 'docs', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.json'));
    const verification = verifyStage3eSqlArtifacts({ repoRoot: artifactDir, live });
    expect(verification.sqlArtifactHashMismatches).toBe(1);
    expect(
      verification.artifactHashChecks.find((c) => c.artifact.endsWith('STAGE3E.json'))?.detail,
    ).toBe('artifact is missing');
  });
});
