import type {
  Stage3eAuditCounters,
  TetaCompiledOracleSelect,
} from '../teta-oracle-compiler/teta-oracle-compiler.types';
import {
  STAGE3E_CONTRACT_VERSION,
  STAGE3E_DIALECT,
} from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { validateCompiledSql } from '../teta-oracle-compiler/teta-oracle-compiled-sql-validator';
import {
  escapeLikePrefix,
  fingerprint,
  P1_VERTICAL_INTENT,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  P1_VERTICAL_SUBJECT,
  sha256,
  type PilotFieldBinding,
  type P1VerticalSafetyCounters,
} from './teta-p1-vertical-pilot.types';

const ALIAS = 'S01';
const MAX_ROWS = 500;

function emptyCounters(): Stage3eAuditCounters {
  return {
    statementsCompiled: 0,
    finalSqlGenerated: 0,
    sqlExecuted: 0,
    oracleConnections: 0,
    oracleWrites: 0,
    businessDataRowsRead: 0,
    xlsxFilesRead: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    llmCalls: 0,
    agentCalls: 0,
    selectStar: 0,
    unqualifiedColumns: 0,
    sqlComments: 0,
    optimizerHints: 0,
    semicolons: 0,
    dmlStatements: 0,
    plsqlBlocks: 0,
    dbLinks: 0,
    forUpdateClauses: 0,
    withClauses: 0,
    multipleStatements: 0,
    unboundUserLiterals: 0,
    cartesianJoins: 0,
    crossJoins: 0,
    selfJoins: 0,
    cyclicJoinGraphs: 0,
    invalidIdentifiers: 0,
    missingAccessColumns: 0,
    forbiddenOwnerReferences: 0,
    logicalObjectsUsedInSql: 0,
    reportGrainDefined: 1,
    rowProducingSources: 1,
    filterOnlySources: 0,
    existenceFiltersCompiled: 0,
    filterOnlySourcesInMainJoinTree: 0,
    filterOnlyAliasesOutsideExists: 0,
    filterOnlySourcesProjected: 0,
    filterOnlySourcesUsedForOrdering: 0,
    unprovenFilterJoinCardinality: 0,
    possibleReportRowMultiplication: 0,
    distinctAddedToHideMultiplicity: 0,
    arbitrarySubqueriesDetected: 0,
    uncorrelatedExistsDetected: 0,
    existsWithoutSemanticEvidence: 0,
    uncontrolledSubqueries: 0,
    inSubqueries: 0,
    distinctClauses: 0,
  };
}

export function buildPilotLogicalRequest(input: {
  question: string;
  bindings: PilotFieldBinding[];
}) {
  return {
    contractVersion: 'teta-aia-p1-employee-vertical-pilot-logical-request-v1',
    pilotOnly: true,
    pilotSourceKind: 'vendor_local_vertical_pilot_source' as const,
    candidateId: 'cand:P1:employee' as const,
    candidateApprovalStatus: 'not_approved' as const,
    productionBindingCreated: false,
    reusePolicyModified: false,
    planningEligibilityModified: false,
    question: input.question,
    subject: 'employee' as const,
    projections: input.bindings.map((b) => ({
      logicalField: b.logicalField,
      physicalColumn: b.physicalColumn,
      displayHeader: b.displayHeader,
    })),
    filter: {
      field: 'employee_last_name' as const,
      operator: 'starts_with' as const,
      value: 'A',
    },
    sort: [
      { field: 'employee_last_name', direction: 'ascending' as const },
      { field: 'employee_first_name', direction: 'ascending' as const },
      { field: 'employee_number', direction: 'ascending' as const },
    ],
    maxRows: MAX_ROWS,
  };
}

export function buildPilotQueryPlan(input: {
  logicalRequest: ReturnType<typeof buildPilotLogicalRequest>;
  bindings: PilotFieldBinding[];
}) {
  const byLogical = Object.fromEntries(input.bindings.map((b) => [b.logicalField, b]));
  return {
    contractVersion: 'teta-aia-p1-employee-vertical-pilot-query-plan-v1',
    planStatus: 'ready_for_compilation' as const,
    intent: P1_VERTICAL_INTENT,
    subject: P1_VERTICAL_SUBJECT,
    pilotOnly: true,
    sources: [
      {
        sourceRole: 'employee',
        status: 'resolved',
        logicalObject: {
          owner: P1_VERTICAL_OWNER,
          objectType: 'VIEW',
          objectName: P1_VERTICAL_OBJECT,
        },
        accessObject: {
          owner: P1_VERTICAL_OWNER,
          objectType: 'VIEW',
          objectName: P1_VERTICAL_OBJECT,
        },
      },
    ],
    projections: input.logicalRequest.projections.map((p) => ({
      businessRole: p.logicalField,
      physicalColumn: byLogical[p.logicalField]?.physicalColumn ?? null,
      status: byLogical[p.logicalField]?.resolutionStatus ?? 'missing',
    })),
    filters: [
      {
        filterRole: 'employee_last_name_starts_with',
        type: 'starts_with',
        field: 'employee_last_name',
        value: 'A',
        physicalColumn: byLogical.employee_last_name?.physicalColumn ?? null,
      },
    ],
    ordering: input.logicalRequest.sort,
    limits: { maxRows: MAX_ROWS, maxColumns: 4, statementTimeoutMs: 30000 },
    joins: [] as unknown[],
  };
}

export function compilePilotStartsWithSelect(input: {
  bindings: PilotFieldBinding[];
  counters: P1VerticalSafetyCounters;
  prefix?: string;
}): {
  compiled: TetaCompiledOracleSelect;
  bindValues: Record<string, string>;
  sqlHash: string;
} {
  const by = Object.fromEntries(input.bindings.map((b) => [b.logicalField, b]));
  const required = [
    'employee_first_name',
    'employee_last_name',
    'employee_number',
    'employee_birth_date',
  ] as const;
  for (const k of required) {
    if (!by[k]?.physicalColumn || by[k].resolutionStatus !== 'resolved_exact') {
      throw new Error(`missing_exact_binding:${k}`);
    }
  }

  const prefix = input.prefix ?? 'A';
  const bindValue = `${escapeLikePrefix(prefix)}%`;
  const col = (logical: (typeof required)[number]) =>
    `${ALIAS}.${by[logical]!.physicalColumn}`;

  const projectionsMeta = [
    {
      logical: 'employee_first_name' as const,
      alias: 'EMPLOYEE_FIRST_NAME',
      label: 'Imię',
    },
    {
      logical: 'employee_last_name' as const,
      alias: 'EMPLOYEE_LAST_NAME',
      label: 'Nazwisko',
    },
    {
      logical: 'employee_number' as const,
      alias: 'EMPLOYEE_NUMBER',
      label: 'Numer ewidencyjny',
    },
    {
      logical: 'employee_birth_date' as const,
      alias: 'EMPLOYEE_BIRTH_DATE',
      label: 'Data urodzenia',
    },
  ];

  const selectList = projectionsMeta
    .map((p) => `${col(p.logical)} AS ${p.alias}`)
    .join(',\n  ');

  const sqlText = [
    'SELECT',
    `  ${selectList}`,
    `FROM ${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT} ${ALIAS}`,
    `WHERE UPPER(${col('employee_last_name')}) LIKE :P001 ESCAPE '\\'`,
    `ORDER BY ${col('employee_last_name')} ASC, ${col('employee_first_name')} ASC, ${col('employee_number')} ASC`,
    `FETCH FIRST ${MAX_ROWS} ROWS ONLY`,
  ].join('\n');

  if (/\bSELECT\s+\*/i.test(sqlText)) input.counters.selectStarUsed += 1;
  if (sqlText.includes(`'${prefix}`) || sqlText.includes("'A%'") || /LIKE\s+'A%/i.test(sqlText)) {
    input.counters.surnamePrefixEmbeddedInSql += 1;
    input.counters.unboundUserLiterals += 1;
  }
  if (/\bT_PRAC\b/i.test(sqlText)) {
    input.counters.tPracFallbackUsed += 1;
    input.counters.fallbackOracleObjectSelected += 1;
  }
  if (/\bJOIN\b/i.test(sqlText)) input.counters.unexpectedJoinsAdded += 1;

  const validation = validateCompiledSql({
    sqlText,
    sourceAliases: [ALIAS],
    resultAliases: projectionsMeta.map((p) => p.alias),
    owners: [P1_VERTICAL_OWNER],
    bindPlaceholders: [':P001'],
    allowedInlineLiterals: ["'\\'", "'MM'", "'YYYY-MM-DD'"],
  });

  const sqlHash = sha256(sqlText);
  const node = (column: string) =>
    `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${column}`;
  const objectNode = `oracle-object:${P1_VERTICAL_OWNER}:VIEW:${P1_VERTICAL_OBJECT}`;

  const compiled: TetaCompiledOracleSelect = {
    contractVersion: STAGE3E_CONTRACT_VERSION,
    compileStatus: validation.ok ? 'compiled' : 'rejected_unsafe',
    dialect: STAGE3E_DIALECT,
    sourcePlanContractVersion: 'teta-aia-p1-employee-vertical-pilot-query-plan-v1',
    intent: P1_VERTICAL_INTENT,
    subject: P1_VERTICAL_SUBJECT,
    sqlText: validation.ok ? sqlText : null,
    sqlSha256: validation.ok ? sqlHash : null,
    binds: [
      {
        ordinal: 1,
        name: 'P001',
        placeholder: ':P001',
        filterRole: 'employee_last_name_starts_with',
        valueKind: 'user_literal',
        oracleType: 'string',
        semanticType: 'user_literal',
      },
    ],
    sources: [
      {
        alias: ALIAS,
        ordinal: 1,
        usage: 'row_source',
        sourceRole: 'employee',
        accessObjectNodeId: objectNode,
        accessOwner: P1_VERTICAL_OWNER,
        accessObjectType: 'VIEW',
        accessObjectName: P1_VERTICAL_OBJECT,
        qualifiedName: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
        logicalObjectNodeId: objectNode,
        logicalOwner: P1_VERTICAL_OWNER,
        logicalObjectName: P1_VERTICAL_OBJECT,
        enrichment: false,
      },
    ],
    accessColumns: projectionsMeta.map((p) => ({
      logicalColumnNodeId: node(by[p.logical]!.physicalColumn!),
      accessColumnNodeId: node(by[p.logical]!.physicalColumn!),
      sourceRole: 'employee',
      alias: ALIAS,
      owner: P1_VERTICAL_OWNER,
      objectName: P1_VERTICAL_OBJECT,
      columnName: by[p.logical]!.physicalColumn!,
      qualifiedExpression: col(p.logical),
      mappingKind: 'identical',
      evidenceEdgeIds: [],
    })),
    projections: projectionsMeta.map((p, i) => ({
      ordinal: i + 1,
      businessRole: p.logical,
      resultAlias: p.alias,
      expression: col(p.logical),
      sourceRole: 'employee',
      logicalColumnNodeId: node(by[p.logical]!.physicalColumn!),
      accessColumnNodeId: node(by[p.logical]!.physicalColumn!),
      displayLabel: p.label,
    })),
    joinTree: null,
    predicates: [
      {
        ordinal: 1,
        filterRole: 'employee_last_name_starts_with',
        filterType: 'starts_with',
        kind: 'starts_with',
        sql: `UPPER(${col('employee_last_name')}) LIKE :P001 ESCAPE '\\'`,
        placement: 'where',
        targetJoinId: null,
        accessColumnNodeIds: [node(by.employee_last_name!.physicalColumn!)],
        bindNames: ['P001'],
      },
    ],
    existenceFilters: [],
    ordering: [
      {
        ordinal: 1,
        orderRole: 'employee_last_name',
        businessRole: 'employee_last_name',
        expression: col('employee_last_name'),
        direction: 'ASC',
        accessColumnNodeId: node(by.employee_last_name!.physicalColumn!),
      },
      {
        ordinal: 2,
        orderRole: 'employee_first_name',
        businessRole: 'employee_first_name',
        expression: col('employee_first_name'),
        direction: 'ASC',
        accessColumnNodeId: node(by.employee_first_name!.physicalColumn!),
      },
      {
        ordinal: 3,
        orderRole: 'employee_number',
        businessRole: 'employee_number',
        expression: col('employee_number'),
        direction: 'ASC',
        accessColumnNodeId: node(by.employee_number!.physicalColumn!),
      },
    ],
    reportGrain: 'employee',
    limits: { maxRows: MAX_ROWS, maxColumns: 4, statementTimeoutMs: 30000 },
    validation,
    warnings: [],
    rejection: validation.ok
      ? null
      : {
          code: 'sql_validation_failed',
          message: validation.violations.map((v) => v.code).join(','),
        },
    evidence: { graphSourceHash: null, nodeIds: [], edgeIds: [] },
    executionPolicy: {
      sqlExecutionAllowed: false,
      oracleConnectionAllowed: false,
      oracleWriteAllowed: false,
      fileReadAllowed: false,
      reason: 'Pilot compile only; Stage 3F gates live execution',
    },
    audit: {
      deterministic: true,
      compilerDurationMs: 0,
      compilerContractVersion: STAGE3E_CONTRACT_VERSION,
      sourcePlanContractVersion: 'teta-aia-p1-employee-vertical-pilot-query-plan-v1',
      semanticBindingsVersion: null,
      graphSourceHash: null,
      graphIndexSchemaVersion: null,
      sourceCount: 1,
      joinCount: 0,
      projectionCount: 4,
      predicateCount: 1,
      existenceFilterCount: 0,
      orderingCount: 3,
      bindCount: 1,
      accessColumnRemaps: 0,
      ...emptyCounters(),
      statementsCompiled: validation.ok ? 1 : 0,
      finalSqlGenerated: validation.ok ? 1 : 0,
    },
  };

  void fingerprint;
  return { compiled, bindValues: { P001: bindValue }, sqlHash };
}
