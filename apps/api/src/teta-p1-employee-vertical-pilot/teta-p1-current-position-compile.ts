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
  P1_CURRENT_POSITION_DICTIONARY,
  P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
  P1_CURRENT_POSITION_INTENT,
  P1_CURRENT_POSITION_MAX_ROWS,
  P1_CURRENT_POSITION_SCENARIO_ID,
  P1_CURRENT_POSITION_SOURCE,
  P1_CURRENT_POSITION_SUBJECT,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  sha256Current,
  type CurrentPositionResolvedBinding,
  type CurrentPositionSafetyCounters,
} from './teta-p1-current-position.types';
import { byRole } from './teta-p1-current-position-resolve';

const EMP = 'S01';
const POS = 'S02';
const DICT = 'S03';

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

function requireExact(
  bindings: CurrentPositionResolvedBinding[],
  role: CurrentPositionResolvedBinding['logicalRole'],
): CurrentPositionResolvedBinding {
  const b = byRole(bindings, role);
  if (!b || b.resolutionStatus !== 'resolved_exact') {
    throw new Error(`missing_exact_binding:${role}`);
  }
  return b;
}

export function buildCurrentPositionLogicalRequest(input: {
  question: string;
  bindings: CurrentPositionResolvedBinding[];
  employeeNumber?: string;
}) {
  const employeeNumber = input.employeeNumber ?? P1_CURRENT_POSITION_EMPLOYEE_NUMBER;
  return {
    contractVersion: 'teta-aia-p1-employee-current-position-logical-request-v1',
    scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
    pilotOnly: true,
    pilotSourceKind: 'vendor_local_vertical_pilot_source' as const,
    candidateId: 'cand:P1:employee' as const,
    candidateApprovalStatus: 'not_approved' as const,
    productionBindingCreated: false,
    reusePolicyModified: false,
    planningEligibilityModified: false,
    question: input.question,
    subject: 'employee' as const,
    projections: [
      {
        logicalField: 'employee_first_name',
        physicalColumn: byRole(input.bindings, 'employee_first_name')?.physicalColumn ?? null,
        displayHeader: 'Imię',
      },
      {
        logicalField: 'employee_last_name',
        physicalColumn: byRole(input.bindings, 'employee_last_name')?.physicalColumn ?? null,
        displayHeader: 'Nazwisko',
      },
      {
        logicalField: 'employee_number',
        physicalColumn: byRole(input.bindings, 'employee_number')?.physicalColumn ?? null,
        displayHeader: 'Numer ewidencyjny',
      },
      {
        logicalField: 'current_position_name',
        physicalColumn: byRole(input.bindings, 'positionNameColumn')?.physicalColumn ?? null,
        displayHeader: 'Aktualne stanowisko',
      },
    ],
    filter: {
      field: 'employee_number' as const,
      operator: 'equals' as const,
      value: employeeNumber,
    },
    temporalContext: {
      kind: 'current_on_oracle_sysdate' as const,
    },
    sort: [
      { field: 'employee_last_name', direction: 'ascending' as const },
      { field: 'employee_first_name', direction: 'ascending' as const },
      { field: 'current_position_valid_from', direction: 'descending' as const },
    ],
    maxRows: P1_CURRENT_POSITION_MAX_ROWS,
  };
}

export function buildCurrentPositionQueryPlan(input: {
  logicalRequest: ReturnType<typeof buildCurrentPositionLogicalRequest>;
  bindings: CurrentPositionResolvedBinding[];
}) {
  return {
    contractVersion: 'teta-aia-p1-employee-current-position-query-plan-v1',
    scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
    planStatus: 'ready_for_compilation' as const,
    intent: P1_CURRENT_POSITION_INTENT,
    subject: P1_CURRENT_POSITION_SUBJECT,
    pilotOnly: true,
    sources: [
      {
        sourceRole: 'employee',
        status: 'resolved',
        accessObject: {
          owner: P1_VERTICAL_OWNER,
          objectType: 'VIEW',
          objectName: P1_VERTICAL_OBJECT,
        },
      },
      {
        sourceRole: 'current_position',
        status: 'resolved',
        accessObject: {
          owner: P1_VERTICAL_OWNER,
          objectType: 'VIEW',
          objectName: P1_CURRENT_POSITION_SOURCE,
        },
      },
      {
        sourceRole: 'position_dictionary',
        status: 'resolved',
        accessObject: {
          owner: P1_VERTICAL_OWNER,
          objectType: 'VIEW',
          objectName: P1_CURRENT_POSITION_DICTIONARY,
        },
      },
    ],
    joins: [
      {
        role: 'employee_to_current_position',
        joinType: 'left',
        status: byRole(input.bindings, 'employeeToPositionJoin')?.resolutionStatus,
      },
      {
        role: 'current_position_to_position_dictionary',
        joinType: 'left',
        status: byRole(input.bindings, 'positionToDictionaryJoin')?.resolutionStatus,
      },
    ],
    temporal: {
      role: 'current_position_on_oracle_sysdate',
      predicates: [
        'DATA_OD <= TRUNC(SYSDATE)',
        'DATA_DO IS NULL OR DATA_DO >= TRUNC(SYSDATE)',
      ],
      inclusive: true,
    },
    projections: input.logicalRequest.projections,
    filters: [input.logicalRequest.filter],
    ordering: input.logicalRequest.sort,
    limits: {
      maxRows: P1_CURRENT_POSITION_MAX_ROWS,
      maxColumns: 4,
      statementTimeoutMs: 30000,
    },
  };
}

export function compileCurrentPositionSelect(input: {
  bindings: CurrentPositionResolvedBinding[];
  counters: CurrentPositionSafetyCounters;
  employeeNumber?: string;
}): {
  compiled: TetaCompiledOracleSelect;
  bindValues: Record<string, string>;
  sqlHash: string;
  temporalPredicates: string[];
} {
  const first = requireExact(input.bindings, 'employee_first_name');
  const last = requireExact(input.bindings, 'employee_last_name');
  const number = requireExact(input.bindings, 'employee_number');
  const empId = requireExact(input.bindings, 'employeePrimaryIdentityColumn');
  const posEmpRef = requireExact(input.bindings, 'positionEmployeeReferenceColumn');
  const posId = requireExact(input.bindings, 'positionIdColumn');
  const validFrom = requireExact(input.bindings, 'positionValidFromColumn');
  const validTo = requireExact(input.bindings, 'positionValidToColumn');
  const dictId = requireExact(input.bindings, 'dictionaryIdColumn');
  const posName = requireExact(input.bindings, 'positionNameColumn');
  requireExact(input.bindings, 'currentPositionSourceRef');
  requireExact(input.bindings, 'dictionarySourceRef');
  requireExact(input.bindings, 'employeeToPositionJoin');
  requireExact(input.bindings, 'positionToDictionaryJoin');

  const empNumber = input.employeeNumber ?? P1_CURRENT_POSITION_EMPLOYEE_NUMBER;
  if (typeof empNumber !== 'string') {
    input.counters.employeeNumberConvertedToNumber += 1;
  }
  if (empNumber !== '00122' && /^0\d+$/.test(empNumber) === false && Number(empNumber)) {
    // keep string path only
  }

  const temporalPredicates = [
    `${POS}.${validFrom.physicalColumn} <= TRUNC(SYSDATE)`,
    `(${POS}.${validTo.physicalColumn} IS NULL OR ${POS}.${validTo.physicalColumn} >= TRUNC(SYSDATE))`,
  ];

  const sqlText = [
    'SELECT',
    `  ${EMP}.${first.physicalColumn} AS EMPLOYEE_FIRST_NAME,`,
    `  ${EMP}.${last.physicalColumn} AS EMPLOYEE_LAST_NAME,`,
    `  ${EMP}.${number.physicalColumn} AS EMPLOYEE_NUMBER,`,
    `  ${DICT}.${posName.physicalColumn} AS CURRENT_POSITION_NAME`,
    `FROM ${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT} ${EMP}`,
    `LEFT JOIN ${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_SOURCE} ${POS}`,
    `  ON ${EMP}.${empId.physicalColumn} = ${POS}.${posEmpRef.physicalColumn}`,
    ` AND ${temporalPredicates[0]}`,
    ` AND ${temporalPredicates[1]}`,
    `LEFT JOIN ${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_DICTIONARY} ${DICT}`,
    `  ON ${POS}.${posId.physicalColumn} = ${DICT}.${dictId.physicalColumn}`,
    `WHERE ${EMP}.${number.physicalColumn} = :P001`,
    `ORDER BY ${EMP}.${last.physicalColumn} ASC, ${EMP}.${first.physicalColumn} ASC, ${POS}.${validFrom.physicalColumn} DESC`,
    `FETCH FIRST ${P1_CURRENT_POSITION_MAX_ROWS} ROWS ONLY`,
  ].join('\n');

  if (/\bSELECT\s+\*/i.test(sqlText)) input.counters.selectStarUsed += 1;
  if (sqlText.includes(`'${empNumber}'`)) {
    input.counters.employeeNumberEmbeddedInSql += 1;
    input.counters.unboundUserLiterals += 1;
  }
  if (/\bT_PRAC\b/i.test(sqlText)) {
    input.counters.tPracFallbackUsed += 1;
    input.counters.fallbackOracleObjectSelected += 1;
  }
  if (/\bSL_STAN\b/i.test(sqlText) && !/\bNT_KP_SLO_STANOWISKA\b/.test(sqlText)) {
    input.counters.guessedPositionDictionary += 1;
    input.counters.additionalUnexpectedSourcesUsed += 1;
  }
  if (!/TRUNC\s*\(\s*SYSDATE\s*\)/i.test(sqlText)) {
    input.counters.currentPositionSelectedWithoutTemporalFilter += 1;
  }
  if (/\bROW_NUMBER\s*\(/i.test(sqlText)) {
    input.counters.rowNumberUsedToHideMultiplicity += 1;
    input.counters.firstCurrentPositionAutoSelected += 1;
  }
  // FETCH FIRST 50 is the report limit — only flag if used as 1 to hide multiplicity
  if (/FETCH\s+FIRST\s+1\s+ROWS?\s+ONLY/i.test(sqlText)) {
    input.counters.fetchFirstUsedToHideMultiplicity += 1;
    input.counters.firstCurrentPositionAutoSelected += 1;
  }

  const validation = validateCompiledSql({
    sqlText,
    sourceAliases: [EMP, POS, DICT],
    resultAliases: [
      'EMPLOYEE_FIRST_NAME',
      'EMPLOYEE_LAST_NAME',
      'EMPLOYEE_NUMBER',
      'CURRENT_POSITION_NAME',
    ],
    owners: [P1_VERTICAL_OWNER],
    bindPlaceholders: [':P001'],
  });

  const sqlHash = sha256Current(sqlText);
  const empObj = `oracle-object:${P1_VERTICAL_OWNER}:VIEW:${P1_VERTICAL_OBJECT}`;
  const posObj = `oracle-object:${P1_VERTICAL_OWNER}:VIEW:${P1_CURRENT_POSITION_SOURCE}`;
  const dictObj = `oracle-object:${P1_VERTICAL_OWNER}:VIEW:${P1_CURRENT_POSITION_DICTIONARY}`;

  const compiled: TetaCompiledOracleSelect = {
    contractVersion: STAGE3E_CONTRACT_VERSION,
    compileStatus: validation.ok ? 'compiled' : 'rejected_unsafe',
    dialect: STAGE3E_DIALECT,
    sourcePlanContractVersion: 'teta-aia-p1-employee-current-position-query-plan-v1',
    intent: P1_CURRENT_POSITION_INTENT,
    subject: P1_CURRENT_POSITION_SUBJECT,
    sqlText: validation.ok ? sqlText : null,
    sqlSha256: validation.ok ? sqlHash : null,
    binds: [
      {
        ordinal: 1,
        name: 'P001',
        placeholder: ':P001',
        filterRole: 'employee_number_equals',
        valueKind: 'user_literal',
        oracleType: 'string',
        semanticType: 'user_literal',
      },
    ],
    sources: [
      {
        alias: EMP,
        ordinal: 1,
        usage: 'row_source',
        sourceRole: 'employee',
        accessObjectNodeId: empObj,
        accessOwner: P1_VERTICAL_OWNER,
        accessObjectType: 'VIEW',
        accessObjectName: P1_VERTICAL_OBJECT,
        qualifiedName: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
        logicalObjectNodeId: empObj,
        logicalOwner: P1_VERTICAL_OWNER,
        logicalObjectName: P1_VERTICAL_OBJECT,
        enrichment: false,
      },
      {
        alias: POS,
        ordinal: 2,
        usage: 'row_source',
        sourceRole: 'current_position',
        accessObjectNodeId: posObj,
        accessOwner: P1_VERTICAL_OWNER,
        accessObjectType: 'VIEW',
        accessObjectName: P1_CURRENT_POSITION_SOURCE,
        qualifiedName: `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_SOURCE}`,
        logicalObjectNodeId: posObj,
        logicalOwner: P1_VERTICAL_OWNER,
        logicalObjectName: P1_CURRENT_POSITION_SOURCE,
        enrichment: true,
      },
      {
        alias: DICT,
        ordinal: 3,
        usage: 'row_source',
        sourceRole: 'position_dictionary',
        accessObjectNodeId: dictObj,
        accessOwner: P1_VERTICAL_OWNER,
        accessObjectType: 'VIEW',
        accessObjectName: P1_CURRENT_POSITION_DICTIONARY,
        qualifiedName: `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_DICTIONARY}`,
        logicalObjectNodeId: dictObj,
        logicalOwner: P1_VERTICAL_OWNER,
        logicalObjectName: P1_CURRENT_POSITION_DICTIONARY,
        enrichment: true,
      },
    ],
    accessColumns: [],
    projections: [
      {
        ordinal: 1,
        businessRole: 'employee_first_name',
        resultAlias: 'EMPLOYEE_FIRST_NAME',
        expression: `${EMP}.${first.physicalColumn}`,
        sourceRole: 'employee',
        logicalColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${first.physicalColumn}`,
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${first.physicalColumn}`,
        displayLabel: 'Imię',
      },
      {
        ordinal: 2,
        businessRole: 'employee_last_name',
        resultAlias: 'EMPLOYEE_LAST_NAME',
        expression: `${EMP}.${last.physicalColumn}`,
        sourceRole: 'employee',
        logicalColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${last.physicalColumn}`,
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${last.physicalColumn}`,
        displayLabel: 'Nazwisko',
      },
      {
        ordinal: 3,
        businessRole: 'employee_number',
        resultAlias: 'EMPLOYEE_NUMBER',
        expression: `${EMP}.${number.physicalColumn}`,
        sourceRole: 'employee',
        logicalColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${number.physicalColumn}`,
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${number.physicalColumn}`,
        displayLabel: 'Numer ewidencyjny',
      },
      {
        ordinal: 4,
        businessRole: 'current_position_name',
        resultAlias: 'CURRENT_POSITION_NAME',
        expression: `${DICT}.${posName.physicalColumn}`,
        sourceRole: 'position_dictionary',
        logicalColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_CURRENT_POSITION_DICTIONARY}:${posName.physicalColumn}`,
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_CURRENT_POSITION_DICTIONARY}:${posName.physicalColumn}`,
        displayLabel: 'Aktualne stanowisko',
      },
    ],
    joinTree: {
      rootSourceRole: 'employee',
      rootAlias: EMP,
      rootQualifiedName: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
      steps: [
        {
          ordinal: 1,
          joinId: 'employee_to_current_position',
          joinKeyword: 'LEFT JOIN',
          joinType: 'left',
          joinedSourceRole: 'current_position',
          joinedAlias: POS,
          joinedQualifiedName: `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_SOURCE}`,
          anchorSourceRole: 'employee',
          anchorAlias: EMP,
          onConditions: [
            `${EMP}.${empId.physicalColumn} = ${POS}.${posEmpRef.physicalColumn}`,
            ...temporalPredicates,
          ],
          enrichment: true,
        },
        {
          ordinal: 2,
          joinId: 'current_position_to_position_dictionary',
          joinKeyword: 'LEFT JOIN',
          joinType: 'left',
          joinedSourceRole: 'position_dictionary',
          joinedAlias: DICT,
          joinedQualifiedName: `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_DICTIONARY}`,
          anchorSourceRole: 'current_position',
          anchorAlias: POS,
          onConditions: [
            `${POS}.${posId.physicalColumn} = ${DICT}.${dictId.physicalColumn}`,
          ],
          enrichment: true,
        },
      ],
      edgeCount: 2,
      sourceCount: 3,
      acyclic: true,
      connected: true,
    },
    predicates: [
      {
        ordinal: 1,
        filterRole: 'employee_number_equals',
        filterType: 'equals',
        kind: 'equals',
        sql: `${EMP}.${number.physicalColumn} = :P001`,
        placement: 'where',
        targetJoinId: null,
        accessColumnNodeIds: [
          `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${number.physicalColumn}`,
        ],
        bindNames: ['P001'],
      },
      {
        ordinal: 2,
        filterRole: 'current_position_on_oracle_sysdate',
        filterType: 'effective_on_date',
        kind: 'temporal',
        sql: temporalPredicates.join(' AND '),
        placement: 'join_on',
        targetJoinId: 'employee_to_current_position',
        accessColumnNodeIds: [
          `oracle-column:${P1_VERTICAL_OWNER}:${P1_CURRENT_POSITION_SOURCE}:${validFrom.physicalColumn}`,
          `oracle-column:${P1_VERTICAL_OWNER}:${P1_CURRENT_POSITION_SOURCE}:${validTo.physicalColumn}`,
        ],
        bindNames: [],
      },
    ],
    existenceFilters: [],
    ordering: [
      {
        ordinal: 1,
        orderRole: 'employee_last_name',
        businessRole: 'employee_last_name',
        expression: `${EMP}.${last.physicalColumn}`,
        direction: 'ASC',
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${last.physicalColumn}`,
      },
      {
        ordinal: 2,
        orderRole: 'employee_first_name',
        businessRole: 'employee_first_name',
        expression: `${EMP}.${first.physicalColumn}`,
        direction: 'ASC',
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_VERTICAL_OBJECT}:${first.physicalColumn}`,
      },
      {
        ordinal: 3,
        orderRole: 'current_position_valid_from',
        businessRole: 'current_position_valid_from',
        expression: `${POS}.${validFrom.physicalColumn}`,
        direction: 'DESC',
        accessColumnNodeId: `oracle-column:${P1_VERTICAL_OWNER}:${P1_CURRENT_POSITION_SOURCE}:${validFrom.physicalColumn}`,
      },
    ],
    reportGrain: 'employee_current_position',
    limits: {
      maxRows: P1_CURRENT_POSITION_MAX_ROWS,
      maxColumns: 4,
      statementTimeoutMs: 30000,
    },
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
      sourcePlanContractVersion: 'teta-aia-p1-employee-current-position-query-plan-v1',
      semanticBindingsVersion: null,
      graphSourceHash: null,
      graphIndexSchemaVersion: null,
      sourceCount: 3,
      joinCount: 2,
      projectionCount: 4,
      predicateCount: 2,
      existenceFilterCount: 0,
      orderingCount: 3,
      bindCount: 1,
      accessColumnRemaps: 0,
      ...emptyCounters(),
      statementsCompiled: validation.ok ? 1 : 0,
      finalSqlGenerated: validation.ok ? 1 : 0,
    },
  };

  return {
    compiled,
    bindValues: { P001: empNumber },
    sqlHash,
    temporalPredicates,
  };
}
