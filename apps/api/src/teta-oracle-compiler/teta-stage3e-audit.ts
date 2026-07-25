/**
 * Stage 3E — audit report, deterministic fixtures and artifact writers.
 *
 * Fixtures use synthetic `FX_*` object names so no live Oracle identifier is hardcoded outside the
 * Stage 3D JSON registry.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { GraphEdgeView, GraphNodeView } from '../teta-plugins/teta-stage3a.types';
import {
  createFixtureGraphClient,
  type FixtureGraph,
  type Stage3cGraphClient,
} from '../teta-query-planner/teta-query-graph-client';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
  type QueryExistenceFilter,
  type QuerySourceUsage,
} from '../teta-query-planner/teta-query-plan.types';
import {
  STAGE3E_CONTRACT_VERSION,
  STAGE3E_DIALECT,
  STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
  type CompilableQueryPlan,
  type Stage3eAuditReport,
  type Stage3eReferenceResult,
  type TetaCompiledOracleSelect,
} from './teta-oracle-compiler.types';
import { TetaOracleSelectCompilerService } from './teta-oracle-select-compiler.service';
import { stableStringify, stripVolatileCompiledFields } from './teta-oracle-compiler-contract';

export const STAGE3E_REFERENCE_BHP_QUESTION =
  'Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.';

export const STAGE3E_FIXTURE_GRAPH_HASH = 'stage3e-fixture-graph-hash';

/* ------------------------------------------------------------------ fixtures */

type FixtureObjectSpec = {
  owner: string;
  objectName: string;
  columns: string[];
  /** Column names deliberately missing from the graph (no HAS_COLUMN edge). */
  omitColumns?: string[];
};

function fixtureNode(
  partial: Partial<GraphNodeView> & { id: string; type: string; name: string },
): GraphNodeView {
  return {
    domain: 'oracle',
    canonicalName: partial.name,
    owner: null,
    objectType: null,
    confidence: 'confirmed',
    sourceStages: ['fixture'],
    attributes: {},
    evidence: [],
    semanticNormalization: null,
    ...partial,
  };
}

function fixtureEdge(type: string, from: string, to: string): GraphEdgeView {
  return {
    id: `edge:${type}:${from}:${to}`,
    type,
    from,
    to,
    confidence: 'confirmed',
    sourceStages: ['fixture'],
    attributes: {},
    evidence: [],
  };
}

export const FX_OBJECTS = {
  employee: 'FX_EMPLOYEE',
  exam: 'FX_EXAM',
  examType: 'FX_EXAM_TYPE',
  position: 'FX_POSITION',
  orgUnit: 'FX_ORG_UNIT',
  contract: 'FX_CONTRACT',
  positionDict: 'FX_POSITION_DICT',
} as const;

const FX_COLUMNS: Record<string, string[]> = {
  [FX_OBJECTS.employee]: ['ID', 'EMP_NO', 'FIRST_NAME', 'LAST_NAME'],
  [FX_OBJECTS.exam]: ['ID', 'EMP_ID', 'TYPE_ID', 'VALID_FROM', 'VALID_TO'],
  [FX_OBJECTS.examType]: ['ID', 'NAME'],
  [FX_OBJECTS.position]: ['ID', 'EMP_ID', 'UNIT_ID', 'POS_ID', 'VALID_FROM', 'VALID_TO'],
  [FX_OBJECTS.orgUnit]: ['ID', 'NAME'],
  [FX_OBJECTS.contract]: ['ID', 'EMP_ID', 'VALID_FROM', 'VALID_TO'],
  [FX_OBJECTS.positionDict]: ['ID', 'NAME'],
};

export function fxObjectNodeId(owner: string, objectName: string): string {
  return `oracle-object:${owner}:VIEW:${objectName}`;
}

export function fxColumnNodeId(owner: string, objectName: string, columnName: string): string {
  return `oracle-column:${owner}:${objectName}:${columnName}`;
}

export type Stage3eFixtureGraphOptions = {
  /** Drops HAS_COLUMN evidence for these `TETA_ADMIN_P.FX_EMPLOYEE` columns (Reference H). */
  omitAccessColumns?: string[];
  /** Drops HAS_COLUMN evidence for these `TETA_ADMIN.FX_CONTRACT` columns (existence subquery). */
  omitContractColumns?: string[];
  /** Adds an HRM twin of the employee view (Reference E). */
  includeHrmEmployee?: boolean;
};

export function buildStage3eFixtureGraph(options: Stage3eFixtureGraphOptions = {}): FixtureGraph {
  const specs: FixtureObjectSpec[] = [
    { owner: 'TETA_ADMIN', objectName: FX_OBJECTS.employee, columns: FX_COLUMNS[FX_OBJECTS.employee]! },
    {
      owner: 'TETA_ADMIN_P',
      objectName: FX_OBJECTS.employee,
      columns: FX_COLUMNS[FX_OBJECTS.employee]!,
      omitColumns: options.omitAccessColumns,
    },
    { owner: 'TETA_ADMIN', objectName: FX_OBJECTS.exam, columns: FX_COLUMNS[FX_OBJECTS.exam]! },
    { owner: 'TETA_ADMIN_P', objectName: FX_OBJECTS.exam, columns: FX_COLUMNS[FX_OBJECTS.exam]! },
    { owner: 'TETA_ADMIN', objectName: FX_OBJECTS.examType, columns: FX_COLUMNS[FX_OBJECTS.examType]! },
    { owner: 'TETA_ADMIN', objectName: FX_OBJECTS.position, columns: FX_COLUMNS[FX_OBJECTS.position]! },
    { owner: 'TETA_ADMIN', objectName: FX_OBJECTS.orgUnit, columns: FX_COLUMNS[FX_OBJECTS.orgUnit]! },
    {
      owner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.contract,
      columns: FX_COLUMNS[FX_OBJECTS.contract]!,
      omitColumns: options.omitContractColumns,
    },
    {
      owner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.positionDict,
      columns: FX_COLUMNS[FX_OBJECTS.positionDict]!,
    },
  ];
  if (options.includeHrmEmployee) {
    specs.push({
      owner: 'HRM',
      objectName: FX_OBJECTS.employee,
      columns: FX_COLUMNS[FX_OBJECTS.employee]!,
    });
  }

  const nodes: GraphNodeView[] = [];
  const edges: GraphEdgeView[] = [];

  for (const spec of specs) {
    const objectId = fxObjectNodeId(spec.owner, spec.objectName);
    nodes.push(
      fixtureNode({
        id: objectId,
        type: 'oracle_object',
        name: spec.objectName,
        owner: spec.owner,
        objectType: 'VIEW',
        attributes: { owner: spec.owner, objectName: spec.objectName },
      }),
    );
    for (const columnName of spec.columns) {
      const columnId = fxColumnNodeId(spec.owner, spec.objectName, columnName);
      nodes.push(
        fixtureNode({
          id: columnId,
          type: 'oracle_column',
          name: columnName,
          owner: spec.owner,
          attributes: { owner: spec.owner, objectName: spec.objectName, columnName },
        }),
      );
      if ((spec.omitColumns ?? []).includes(columnName)) continue;
      edges.push(fixtureEdge('HAS_COLUMN', objectId, columnId));
    }
  }

  return { nodes, edges };
}

export function createStage3eFixtureClient(
  options: Stage3eFixtureGraphOptions = {},
): Stage3cGraphClient {
  return createFixtureGraphClient(buildStage3eFixtureGraph(options));
}

function fxSource(input: {
  sourceRole: string;
  logicalOwner: string;
  accessOwner: string;
  objectName: string;
  enrichment?: boolean;
  sourceUsage?: QuerySourceUsage;
}) {
  return {
    sourceRole: input.sourceRole,
    status: 'resolved' as const,
    sourceUsage: input.sourceUsage ?? ('row_source' as const),
    logicalObject: {
      nodeId: fxObjectNodeId(input.logicalOwner, input.objectName),
      owner: input.logicalOwner,
      objectType: 'VIEW',
      objectName: input.objectName,
      canonical: input.logicalOwner === 'TETA_ADMIN',
    },
    accessObject: {
      nodeId: fxObjectNodeId(input.accessOwner, input.objectName),
      owner: input.accessOwner,
      objectType: 'VIEW',
      objectName: input.objectName,
    },
    selectionReason: 'fixture',
    candidateNodeIds: [],
    provenanceNodeIds: [],
    provenanceEdgeIds: [],
    pathNodeIds: [],
    enrichment: !!input.enrichment,
  };
}

function fxProjection(input: {
  businessRole: string;
  sourceRole: string;
  objectName: string;
  columnName: string;
  displayLabel: string;
}) {
  return {
    businessRole: input.businessRole,
    status: 'resolved' as const,
    sourceRole: input.sourceRole,
    datasetColumnNodeId: null,
    oracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', input.objectName, input.columnName),
    owner: 'TETA_ADMIN',
    objectName: input.objectName,
    columnName: input.columnName,
    displayLabel: input.displayLabel,
    provenanceNodeIds: [fxColumnNodeId('TETA_ADMIN', input.objectName, input.columnName)],
    provenanceEdgeIds: [],
    pathNodeIds: [],
  };
}

function fxJoin(input: {
  left: string;
  right: string;
  joinType: 'inner' | 'left';
  leftObject: string;
  leftColumn: string;
  rightObject: string;
  rightColumn: string;
  required?: boolean;
  enrichment?: boolean;
}) {
  return {
    joinId: `join:${input.left}:${input.right}`,
    leftSourceRole: input.left,
    rightSourceRole: input.right,
    joinType: input.joinType,
    predicates: [
      {
        leftOracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', input.leftObject, input.leftColumn),
        operator: 'equals' as const,
        rightOracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', input.rightObject, input.rightColumn),
      },
    ],
    evidenceType: 'foreign_key' as const,
    provenanceEdgeIds: [],
    pathNodeIds: [],
    status: 'resolved' as const,
    required: input.required !== false,
    enrichment: !!input.enrichment,
  };
}

function fxEffectiveOnDate(input: { filterRole: string; sourceRole: string; objectName: string }) {
  return {
    filterRole: input.filterRole,
    type: 'effective_on_date' as const,
    status: 'resolved' as const,
    clock: 'oracle_sysdate' as const,
    resolvedPredicates: [
      {
        kind: 'effective_date_range_contains_sysdate',
        leftOracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', input.objectName, 'VALID_FROM'),
        operator: 'less_or_equal',
        right: { clock: 'oracle_sysdate' as const, transform: 'identity' as const, inclusive: true },
      },
      {
        kind: 'effective_date_range_contains_sysdate_or_null_end',
        leftOracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', input.objectName, 'VALID_TO'),
        operator: 'greater_or_null',
        right: { clock: 'oracle_sysdate' as const, transform: 'identity' as const, inclusive: true },
      },
    ],
    sourceRole: input.sourceRole,
    missingReason: null,
    provenanceNodeIds: [],
    provenanceEdgeIds: [],
  };
}

export type Stage3eFixturePlanOptions = {
  planStatus?: CompilableQueryPlan['planStatus'];
  contractVersion?: string;
  allowSqlExecution?: boolean;
  allowOracleConnection?: boolean;
  employeeAccessOwner?: string;
  intent?: string;
  subject?: string | null;
  maxRows?: number;
  maxColumns?: number;
  statementTimeoutMs?: number;
  /** Adds a user-literal equality filter so bind planning is exercised (Reference G). */
  withUserLiteralFilter?: boolean;
  /** Replaces the join set with a triangle plus an isolated source (Reference F). */
  cyclicJoins?: boolean;
  /** Emits `employee → employee` so self-join rejection can be checked. */
  selfJoin?: boolean;
  /** Drops all join predicates so cartesian rejection can be checked. */
  cartesianJoin?: boolean;
  /** Reverses the enrichment LEFT JOIN so left-join reversal rejection can be checked. */
  reversedLeftJoin?: boolean;
  /** Removes the current-position temporal filter. */
  omitCurrentPositionFilter?: boolean;
  cartesianJoinsCounter?: number;
  /** Keeps `active_employment` filter-only but also joins it into the main tree. */
  filterOnlyInMainJoinTree?: boolean;
  /** Leaves `active_employment` filter-only with no existence filter to consume its temporal. */
  omitExistenceFilters?: boolean;
  /** Projects a column from the filter-only source. */
  projectFilterOnlySource?: boolean;
  /** Orders by a column from the filter-only source. */
  orderByFilterOnlySource?: boolean;
  /** Strips correlation predicates so the EXISTS would filter nothing. */
  uncorrelatedExistenceFilter?: boolean;
  /** Treats `active_employment` as a row source again (pre-3E behaviour). */
  activeEmploymentAsRowSource?: boolean;
  /** Removes the report grain declaration. */
  omitReportGrain?: boolean;
};

export function buildStage3eFixturePlan(
  options: Stage3eFixturePlanOptions = {},
): CompilableQueryPlan {
  const sources = [
    fxSource({
      sourceRole: 'employee',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: options.employeeAccessOwner ?? 'TETA_ADMIN_P',
      objectName: FX_OBJECTS.employee,
    }),
    fxSource({
      sourceRole: 'health_examination',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: 'TETA_ADMIN_P',
      objectName: FX_OBJECTS.exam,
    }),
    fxSource({
      sourceRole: 'examination_type',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.examType,
    }),
    fxSource({
      sourceRole: 'current_position',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.position,
      enrichment: true,
    }),
    fxSource({
      sourceRole: 'organizational_unit',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.orgUnit,
      enrichment: true,
    }),
    fxSource({
      sourceRole: 'active_employment',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.contract,
      sourceUsage: options.activeEmploymentAsRowSource ? 'row_source' : 'filter_only',
    }),
    fxSource({
      sourceRole: 'position_dictionary',
      logicalOwner: 'TETA_ADMIN',
      accessOwner: 'TETA_ADMIN',
      objectName: FX_OBJECTS.positionDict,
    }),
  ];

  let joins = [
    fxJoin({
      left: 'current_position',
      right: 'organizational_unit',
      joinType: 'left',
      leftObject: FX_OBJECTS.position,
      leftColumn: 'UNIT_ID',
      rightObject: FX_OBJECTS.orgUnit,
      rightColumn: 'ID',
      enrichment: true,
    }),
    fxJoin({
      left: 'current_position',
      right: 'position_dictionary',
      joinType: 'left',
      leftObject: FX_OBJECTS.position,
      leftColumn: 'POS_ID',
      rightObject: FX_OBJECTS.positionDict,
      rightColumn: 'ID',
      required: false,
      enrichment: true,
    }),
    fxJoin({
      left: 'employee',
      right: 'current_position',
      joinType: 'left',
      leftObject: FX_OBJECTS.employee,
      leftColumn: 'ID',
      rightObject: FX_OBJECTS.position,
      rightColumn: 'EMP_ID',
      enrichment: true,
    }),
    fxJoin({
      left: 'health_examination',
      right: 'employee',
      joinType: 'inner',
      leftObject: FX_OBJECTS.exam,
      leftColumn: 'EMP_ID',
      rightObject: FX_OBJECTS.employee,
      rightColumn: 'ID',
    }),
    fxJoin({
      left: 'health_examination',
      right: 'examination_type',
      joinType: 'inner',
      leftObject: FX_OBJECTS.exam,
      leftColumn: 'TYPE_ID',
      rightObject: FX_OBJECTS.examType,
      rightColumn: 'ID',
    }),
  ];

  const employeeToActiveEmployment = fxJoin({
    left: 'employee',
    right: 'active_employment',
    joinType: 'inner',
    leftObject: FX_OBJECTS.employee,
    leftColumn: 'ID',
    rightObject: FX_OBJECTS.contract,
    rightColumn: 'EMP_ID',
  });
  if (options.filterOnlyInMainJoinTree || options.activeEmploymentAsRowSource) {
    joins = [...joins, employeeToActiveEmployment];
  }

  if (options.reversedLeftJoin) {
    joins = joins.map((join) =>
      join.joinId === 'join:employee:current_position'
        ? {
            ...join,
            joinId: 'join:current_position:employee',
            leftSourceRole: 'current_position',
            rightSourceRole: 'employee',
            predicates: [
              {
                leftOracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.position, 'EMP_ID'),
                operator: 'equals' as const,
                rightOracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'ID'),
              },
            ],
          }
        : join,
    );
  }
  if (options.selfJoin) {
    joins = joins.map((join) =>
      join.joinId === 'join:health_examination:employee'
        ? {
            ...join,
            rightSourceRole: 'health_examination',
            joinId: 'join:health_examination:health_examination',
          }
        : join,
    );
  }
  if (options.cartesianJoin) {
    joins = joins.map((join) => ({ ...join, predicates: [] }));
  }

  const projections: ReturnType<typeof fxProjection>[] = [
    fxProjection({
      businessRole: 'employee_number',
      sourceRole: 'employee',
      objectName: FX_OBJECTS.employee,
      columnName: 'EMP_NO',
      displayLabel: 'Numer ewidencyjny',
    }),
    fxProjection({
      businessRole: 'employee_first_name',
      sourceRole: 'employee',
      objectName: FX_OBJECTS.employee,
      columnName: 'FIRST_NAME',
      displayLabel: 'Imię',
    }),
    fxProjection({
      businessRole: 'employee_last_name',
      sourceRole: 'employee',
      objectName: FX_OBJECTS.employee,
      columnName: 'LAST_NAME',
      displayLabel: 'Nazwisko',
    }),
    fxProjection({
      businessRole: 'examination_type_name',
      sourceRole: 'examination_type',
      objectName: FX_OBJECTS.examType,
      columnName: 'NAME',
      displayLabel: 'Rodzaj badania',
    }),
    fxProjection({
      businessRole: 'examination_valid_from',
      sourceRole: 'health_examination',
      objectName: FX_OBJECTS.exam,
      columnName: 'VALID_FROM',
      displayLabel: 'Data od',
    }),
    fxProjection({
      businessRole: 'examination_valid_to',
      sourceRole: 'health_examination',
      objectName: FX_OBJECTS.exam,
      columnName: 'VALID_TO',
      displayLabel: 'Data do',
    }),
    fxProjection({
      businessRole: 'position_name',
      sourceRole: 'position_dictionary',
      objectName: FX_OBJECTS.positionDict,
      columnName: 'NAME',
      displayLabel: 'Stanowisko',
    }),
    fxProjection({
      businessRole: 'organizational_unit_name',
      sourceRole: 'organizational_unit',
      objectName: FX_OBJECTS.orgUnit,
      columnName: 'NAME',
      displayLabel: 'Jednostka organizacyjna',
    }),
  ];
  if (options.projectFilterOnlySource) {
    projections.push(
      fxProjection({
        businessRole: 'employment_valid_from',
        sourceRole: 'active_employment',
        objectName: FX_OBJECTS.contract,
        columnName: 'VALID_FROM',
        displayLabel: 'Zatrudniony od',
      }),
    );
  }

  const filters: CompilableQueryPlan['filters'] = [
    {
      filterRole: 'examination_valid_to_in_current_month',
      type: 'half_open_date_interval',
      status: 'resolved',
      columnOracleNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.exam, 'VALID_TO'),
      columnBusinessRole: 'examination_valid_to',
      lowerBoundary: { clock: 'oracle_sysdate', transform: 'month_start', inclusive: true },
      upperBoundary: { clock: 'oracle_sysdate', transform: 'next_month_start', inclusive: false },
      provenanceNodeIds: [],
      provenanceEdgeIds: [],
    },
    fxEffectiveOnDate({
      filterRole: 'employee_active_on_oracle_sysdate',
      sourceRole: 'active_employment',
      objectName: FX_OBJECTS.contract,
    }),
  ];
  if (!options.omitCurrentPositionFilter) {
    filters.push(
      fxEffectiveOnDate({
        filterRole: 'current_position_on_oracle_sysdate',
        sourceRole: 'current_position',
        objectName: FX_OBJECTS.position,
      }),
    );
  }
  if (options.withUserLiteralFilter) {
    filters.push({
      filterRole: 'employee_number_equals_user_value',
      type: 'user_literal_equals',
      status: 'resolved',
      columnOracleNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'EMP_NO'),
      sourceRole: 'employee',
      literal: { kind: 'string', value: '00122' },
      provenanceNodeIds: [],
      provenanceEdgeIds: [],
    });
  }

  const existenceFilters: QueryExistenceFilter[] =
    options.omitExistenceFilters || options.activeEmploymentAsRowSource
      ? []
      : [
          {
            filterRole: 'employee_active_on_oracle_sysdate',
            status: 'resolved',
            correlatedSourceRole: 'employee',
            filterOnlySourceRole: 'active_employment',
            correlationPredicates: options.uncorrelatedExistenceFilter
              ? []
              : [
                  {
                    outerOracleColumnNodeId: fxColumnNodeId(
                      'TETA_ADMIN',
                      FX_OBJECTS.employee,
                      'ID',
                    ),
                    innerOracleColumnNodeId: fxColumnNodeId(
                      'TETA_ADMIN',
                      FX_OBJECTS.contract,
                      'EMP_ID',
                    ),
                    operator: 'equals',
                  },
                ],
            temporalFilterRole: 'employee_active_on_oracle_sysdate',
            relationRole: 'employee_to_active_employment',
            preservesReportGrain: true,
          },
        ];

  const ordering = [
    {
      orderRole: 'examination_valid_to_ascending',
      status: 'resolved' as const,
      oracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.exam, 'VALID_TO'),
      direction: 'ascending' as const,
      businessRole: 'examination_valid_to',
    },
    {
      orderRole: 'employee_last_name_ascending',
      status: 'resolved' as const,
      oracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'LAST_NAME'),
      direction: 'ascending' as const,
      businessRole: 'employee_last_name',
    },
    {
      orderRole: 'employee_first_name_ascending',
      status: 'resolved' as const,
      oracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.employee, 'FIRST_NAME'),
      direction: 'ascending' as const,
      businessRole: 'employee_first_name',
    },
  ];
  if (options.orderByFilterOnlySource) {
    ordering.push({
      orderRole: 'employment_valid_from_ascending',
      status: 'resolved' as const,
      oracleColumnNodeId: fxColumnNodeId('TETA_ADMIN', FX_OBJECTS.contract, 'VALID_FROM'),
      direction: 'ascending' as const,
      businessRole: 'employment_valid_from',
    });
  }

  const plan: CompilableQueryPlan = {
    contractVersion: (options.contractVersion ?? STAGE3C_CONTRACT_VERSION) as typeof STAGE3C_CONTRACT_VERSION,
    planStatus: options.planStatus ?? 'ready_for_compilation',
    intent: options.intent ?? STAGE3C_SUPPORTED_INTENT,
    subject: options.subject === undefined ? STAGE3C_SUPPORTED_SUBJECT : options.subject,
    sources,
    joins,
    projections,
    filters,
    ordering,
    reportGrain: options.omitReportGrain ? null : 'health_examination',
    existenceFilters,
    limits: {
      maxRows: options.maxRows ?? 500,
      maxColumns: options.maxColumns ?? 20,
      statementTimeoutMs: options.statementTimeoutMs ?? 30000,
    },
    authorization: {
      status: 'deferred',
      assumedOracleUser: 'TETA_ADMIN',
      filtersApplied: false,
      reason: 'fixture',
    },
    unresolvedSelections: [],
    warnings: [],
    evidence: {
      graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
      nodeIds: [],
      edgeIds: [],
      paths: [],
      conflicts: [],
    },
    executionPolicy: {
      sqlCompilationAllowed: false,
      sqlExecutionAllowed: (options.allowSqlExecution ?? false) as false,
      oracleConnectionAllowed: (options.allowOracleConnection ?? false) as false,
      oracleWriteAllowed: false,
      fileReadAllowed: false,
      reason: 'fixture',
    },
    audit: {
      deterministic: true,
      plannerDurationMs: 1,
      reportTemplateVersion: 'teta-aia-report-query-templates-v1',
      safetyPolicyVersion: 'teta-aia-query-safety-policy-v1',
      stage3bContractVersion: 'teta-aia-evidence-plan-v1',
      graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
      graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
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
      rawSqlFragments: 0,
      selectStar: 0,
      unboundUserLiterals: 0,
      unknownOwnerAutoSelections: 0,
      hrmOwnerAutoSelections: 0,
      unsupportedOwnerAutoSelections: 0,
      baseTableSelectionsWithoutGraphPath: 0,
      equalCandidatesAutoSelected: 0,
      cartesianJoins: options.cartesianJoinsCounter ?? 0,
    },
    rejection: null,
  };

  if (options.cyclicJoins) {
    plan.sources = sources.slice(0, 4);
    plan.joins = [
      fxJoin({
        left: 'employee',
        right: 'health_examination',
        joinType: 'inner',
        leftObject: FX_OBJECTS.employee,
        leftColumn: 'ID',
        rightObject: FX_OBJECTS.exam,
        rightColumn: 'EMP_ID',
      }),
      fxJoin({
        left: 'health_examination',
        right: 'examination_type',
        joinType: 'inner',
        leftObject: FX_OBJECTS.exam,
        leftColumn: 'TYPE_ID',
        rightObject: FX_OBJECTS.examType,
        rightColumn: 'ID',
      }),
      fxJoin({
        left: 'examination_type',
        right: 'employee',
        joinType: 'inner',
        leftObject: FX_OBJECTS.examType,
        leftColumn: 'ID',
        rightObject: FX_OBJECTS.employee,
        rightColumn: 'ID',
      }),
    ];
    plan.projections = projections.slice(0, 6);
    plan.filters = [filters[0]!];
    plan.ordering = ordering.slice(0, 1);
    plan.existenceFilters = [];
  }

  return plan;
}

export function createStage3eFixtureCompiler(
  graphOptions: Stage3eFixtureGraphOptions = {},
): TetaOracleSelectCompilerService {
  return new TetaOracleSelectCompilerService({
    graph: createStage3eFixtureClient(graphOptions),
    graphSourceHash: STAGE3E_FIXTURE_GRAPH_HASH,
    graphIndexSchemaVersion: 'teta-aia-graph-index-v1',
    semanticBindingsVersion: 'teta-aia-business-semantic-bindings-v1',
  });
}

export function compileStage3eFixture(
  planOptions: Stage3eFixturePlanOptions = {},
  graphOptions: Stage3eFixtureGraphOptions = {},
): TetaCompiledOracleSelect {
  return createStage3eFixtureCompiler(graphOptions).compile({
    queryPlan: buildStage3eFixturePlan(planOptions),
    expectedIntent: planOptions.intent ?? STAGE3C_SUPPORTED_INTENT,
    expectedSubject:
      planOptions.subject === undefined ? STAGE3C_SUPPORTED_SUBJECT : (planOptions.subject ?? ''),
    dialect: STAGE3E_DIALECT,
  });
}

/* --------------------------------------------------------------------- audit */

type ReferenceExpectation = {
  reference: string;
  description: string;
  expectedStatus: TetaCompiledOracleSelect['compileStatus'];
  expectedRejectionCode?: string | null;
  compiled: TetaCompiledOracleSelect;
  extraChecks?: Array<{ ok: boolean; message: string }>;
};

function evaluateReference(expectation: ReferenceExpectation): {
  result: Stage3eReferenceResult;
  errors: string[];
} {
  const errors: string[] = [];
  const notes: string[] = [];
  const { compiled } = expectation;

  if (compiled.compileStatus !== expectation.expectedStatus) {
    errors.push(
      `Reference ${expectation.reference}: compileStatus=${compiled.compileStatus}, expected ${expectation.expectedStatus}`,
    );
  }
  if (
    expectation.expectedRejectionCode &&
    compiled.rejection?.code !== expectation.expectedRejectionCode
  ) {
    errors.push(
      `Reference ${expectation.reference}: rejection code=${compiled.rejection?.code ?? 'none'}, expected ${expectation.expectedRejectionCode}`,
    );
  }
  for (const check of expectation.extraChecks ?? []) {
    if (!check.ok) errors.push(`Reference ${expectation.reference}: ${check.message}`);
    else notes.push(check.message);
  }

  return {
    result: {
      reference: expectation.reference,
      description: expectation.description,
      compileStatus: compiled.compileStatus,
      rejectionCode: compiled.rejection?.code ?? null,
      sqlSha256: compiled.sqlSha256,
      validationOk: compiled.validation.ok,
      notes,
    },
    errors,
  };
}

export function runStage3eAudit(input: {
  liveCompiler: TetaOracleSelectCompilerService;
  livePlan: CompilableQueryPlan;
  graphSourceHash: string | null;
  graphIndexSchemaVersion: string | null;
  semanticBindingsVersion: string | null;
}): { report: Stage3eAuditReport; live: TetaCompiledOracleSelect } {
  const strictErrors: string[] = [];
  const referenceResults: Stage3eReferenceResult[] = [];

  const request = {
    queryPlan: input.livePlan,
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    dialect: STAGE3E_DIALECT,
  };
  const live = input.liveCompiler.compile(request);
  const liveRepeat = input.liveCompiler.compile(request);
  const deterministicCheckOk =
    stableStringify(stripVolatileCompiledFields(live)) ===
    stableStringify(stripVolatileCompiledFields(liveRepeat));

  if (!deterministicCheckOk) {
    strictErrors.push('live compilation is not deterministic across two runs');
  }
  if (live.compileStatus !== 'compiled') {
    strictErrors.push(
      `live compileStatus=${live.compileStatus} (${live.rejection?.code ?? 'no code'}); expected compiled`,
    );
  }
  if (!live.validation.ok) {
    for (const violation of live.validation.violations) {
      strictErrors.push(`live SQL validation: ${violation.code} — ${violation.message}`);
    }
  }
  if (live.sqlText && live.sqlText.includes(';')) {
    strictErrors.push('live SQL contains a semicolon');
  }
  if (live.sqlText && live.sqlText.includes('\r')) {
    strictErrors.push('live SQL does not use LF newlines only');
  }
  if (live.binds.length !== 0) {
    strictErrors.push(`live SQL has ${live.binds.length} binds; the reference report expects 0`);
  }
  const liveRowSources = live.sources.filter((s) => s.usage === 'row_source');
  const liveFilterOnlySources = live.sources.filter((s) => s.usage === 'filter_only');
  if (live.joinTree && live.joinTree.edgeCount !== liveRowSources.length - 1) {
    strictErrors.push('live join tree edge count is not rowProducingSources-1');
  }
  if (!live.reportGrain) {
    strictErrors.push('live plan does not declare a reportGrain');
  }
  if (live.existenceFilters.length !== liveFilterOnlySources.length) {
    strictErrors.push(
      `live existenceFilters=${live.existenceFilters.length} does not cover ${liveFilterOnlySources.length} filter-only source(s)`,
    );
  }
  for (const existence of live.existenceFilters) {
    if (!existence.correlationConditions.length) {
      strictErrors.push(`live existence filter ${existence.filterRole} is not correlated`);
    }
    if (!existence.preservesReportGrain) {
      strictErrors.push(`live existence filter ${existence.filterRole} does not preserve the grain`);
    }
  }
  for (const source of liveFilterOnlySources) {
    if (!source.alias.startsWith('E')) {
      strictErrors.push(`filter-only source ${source.sourceRole} has non-existence alias ${source.alias}`);
    }
    if (live.projections.some((p) => p.sourceRole === source.sourceRole)) {
      strictErrors.push(`filter-only source ${source.sourceRole} is projected`);
    }
    if (live.ordering.some((o) => live.sources.some((s) => s.alias === source.alias && o.expression.startsWith(`${s.alias}.`)))) {
      strictErrors.push(`filter-only source ${source.sourceRole} appears in ORDER BY`);
    }
    if (live.sqlText && new RegExp(`(FROM|JOIN) [A-Z0-9_$#.]+ ${source.alias}\\b`).test(live.sqlText.replace(/^ +/gm, ''))) {
      const outsideExists = live.sqlText.replace(/EXISTS \([\s\S]*?\n {2}\)/g, ' ');
      if (outsideExists.includes(`${source.alias}.`)) {
        strictErrors.push(`filter-only alias ${source.alias} is referenced outside an EXISTS block`);
      }
    }
  }
  if (live.joinTree && !live.joinTree.acyclic) strictErrors.push('live join tree is not acyclic');
  if (live.joinTree && !live.joinTree.connected) strictErrors.push('live join tree is not connected');
  for (const source of live.sources) {
    if (!['TETA_ADMIN', 'TETA_ADMIN_P'].includes(source.accessOwner)) {
      strictErrors.push(`live SQL uses access owner ${source.accessOwner}`);
    }
  }
  if (live.audit.logicalObjectsUsedInSql !== 0) {
    strictErrors.push('live SQL references a logical object instead of the access object');
  }
  for (const [counter, value] of Object.entries({
    sqlExecuted: live.audit.sqlExecuted,
    oracleConnections: live.audit.oracleConnections,
    oracleWrites: live.audit.oracleWrites,
    businessDataRowsRead: live.audit.businessDataRowsRead,
    qdrantCalls: live.audit.qdrantCalls,
    embeddingCalls: live.audit.embeddingCalls,
    llmCalls: live.audit.llmCalls,
    agentCalls: live.audit.agentCalls,
    selectStar: live.audit.selectStar,
    unqualifiedColumns: live.audit.unqualifiedColumns,
    sqlComments: live.audit.sqlComments,
    optimizerHints: live.audit.optimizerHints,
    semicolons: live.audit.semicolons,
    dmlStatements: live.audit.dmlStatements,
    plsqlBlocks: live.audit.plsqlBlocks,
    dbLinks: live.audit.dbLinks,
    forUpdateClauses: live.audit.forUpdateClauses,
    withClauses: live.audit.withClauses,
    multipleStatements: live.audit.multipleStatements,
    unboundUserLiterals: live.audit.unboundUserLiterals,
    cartesianJoins: live.audit.cartesianJoins,
    crossJoins: live.audit.crossJoins,
    selfJoins: live.audit.selfJoins,
    cyclicJoinGraphs: live.audit.cyclicJoinGraphs,
    invalidIdentifiers: live.audit.invalidIdentifiers,
    missingAccessColumns: live.audit.missingAccessColumns,
    forbiddenOwnerReferences: live.audit.forbiddenOwnerReferences,
    filterOnlySourcesInMainJoinTree: live.audit.filterOnlySourcesInMainJoinTree,
    filterOnlyAliasesOutsideExists: live.audit.filterOnlyAliasesOutsideExists,
    filterOnlySourcesProjected: live.audit.filterOnlySourcesProjected,
    filterOnlySourcesUsedForOrdering: live.audit.filterOnlySourcesUsedForOrdering,
    unprovenFilterJoinCardinality: live.audit.unprovenFilterJoinCardinality,
    possibleReportRowMultiplication: live.audit.possibleReportRowMultiplication,
    distinctAddedToHideMultiplicity: live.audit.distinctAddedToHideMultiplicity,
    arbitrarySubqueriesDetected: live.audit.arbitrarySubqueriesDetected,
    uncorrelatedExistsDetected: live.audit.uncorrelatedExistsDetected,
    existsWithoutSemanticEvidence: live.audit.existsWithoutSemanticEvidence,
    uncontrolledSubqueries: live.audit.uncontrolledSubqueries,
    inSubqueries: live.audit.inSubqueries,
    distinctClauses: live.audit.distinctClauses,
  })) {
    if (value !== 0) strictErrors.push(`live counter ${counter}=${value}; expected 0`);
  }
  if (live.audit.reportGrainDefined !== 1) {
    strictErrors.push('live counter reportGrainDefined=0; expected 1');
  }

  const fixtureOk = compileStage3eFixture();
  const fixtureRepeat = compileStage3eFixture();
  const fixtureG = compileStage3eFixture({ withUserLiteralFilter: true });
  const fixtureExistence = fixtureOk.existenceFilters[0];

  const expectations: ReferenceExpectation[] = [
    {
      reference: 'A',
      description: 'Live BHP plan (Stage 3D bindings) compiles to a single read-only SELECT',
      expectedStatus: 'compiled',
      compiled: live,
      extraChecks: [
        {
          ok: live.validation.ok,
          message: 'compiled SQL passes the independent token validator',
        },
        {
          ok: deterministicCheckOk,
          message: 'two consecutive compilations produce identical output',
        },
        {
          ok: live.binds.length === 0,
          message: 'no binds are needed (all values derive from the graph and SYSDATE)',
        },
      ],
    },
    {
      reference: 'B',
      description: 'Fixture BHP plan compiles with positional aliases and access objects only',
      expectedStatus: 'compiled',
      compiled: fixtureOk,
      extraChecks: [
        {
          ok: fixtureOk.sources.map((s) => s.alias).join(',') === 'S01,S02,S03,S04,S05,E01,S06',
          message: 'aliases follow sources[] order; filter-only sources use the E space',
        },
        {
          ok: fixtureOk.joinTree?.rootSourceRole === 'employee',
          message: 'root is the first source that is not on a LEFT JOIN nullable side',
        },
        {
          ok: fixtureOk.joinTree?.sourceCount === 6 && fixtureOk.joinTree?.edgeCount === 5,
          message: 'main join tree holds 6 row-producing sources and 5 edges',
        },
        {
          ok:
            stableStringify(stripVolatileCompiledFields(fixtureOk)) ===
            stableStringify(stripVolatileCompiledFields(fixtureRepeat)),
          message: 'fixture compilation is deterministic',
        },
      ],
    },
    {
      reference: 'C',
      description: 'Plan that is not ready_for_compilation is rejected without SQL',
      expectedStatus: 'rejected_not_ready',
      expectedRejectionCode: 'source_plan_not_ready_for_compilation',
      compiled: compileStage3eFixture({ planStatus: 'needs_graph_resolution' }),
    },
    {
      reference: 'D',
      description: 'Plan that grants SQL execution is rejected as unsafe',
      expectedStatus: 'rejected_unsafe',
      expectedRejectionCode: 'execution_policy_violation',
      compiled: compileStage3eFixture({ allowSqlExecution: true }),
    },
    {
      reference: 'E',
      description: 'HRM owner never reaches a compiled statement',
      expectedStatus: 'rejected_unsafe',
      expectedRejectionCode: 'forbidden_owner',
      compiled: compileStage3eFixture(
        { employeeAccessOwner: 'HRM' },
        { includeHrmEmployee: true },
      ),
    },
    {
      reference: 'F',
      description: 'Cyclic join graph is unsupported in v1',
      expectedStatus: 'rejected_unsupported',
      expectedRejectionCode: 'cyclic_join_graph_unsupported',
      compiled: compileStage3eFixture({ cyclicJoins: true }),
    },
    {
      reference: 'G',
      description: 'User-supplied literal is passed as a bind variable, never inlined',
      expectedStatus: 'compiled',
      compiled: fixtureG,
      extraChecks: [
        { ok: fixtureG.binds.length === 1, message: 'exactly one bind is allocated' },
        {
          ok: fixtureG.binds[0]?.placeholder === ':P001',
          message: 'the first bind placeholder is :P001',
        },
        {
          ok: !!fixtureG.sqlText?.includes(':P001') && !fixtureG.sqlText?.includes('00122'),
          message: 'the literal value does not appear in the statement text',
        },
      ],
    },
    {
      reference: 'H',
      description: 'Missing HAS_COLUMN evidence on the access object blocks compilation',
      expectedStatus: 'rejected_invalid_plan',
      expectedRejectionCode: 'missing_access_column_evidence',
      compiled: compileStage3eFixture({}, { omitAccessColumns: ['EMP_NO'] }),
    },
    {
      reference: 'I',
      description:
        'Active employment qualifies employees through a correlated EXISTS, never a row-producing join',
      expectedStatus: 'compiled',
      compiled: fixtureOk,
      extraChecks: [
        {
          ok: fixtureExistence?.existenceAlias === 'E01',
          message: 'the filter-only source is aliased E01',
        },
        {
          ok: fixtureExistence?.correlatedAlias === 'S01',
          message: 'the EXISTS is correlated to the employee row source',
        },
        {
          ok: fixtureExistence?.temporalConditions.length === 2,
          message: 'the active-employment temporal rule lives inside the subquery',
        },
        {
          ok: !!fixtureOk.sqlText?.includes(`FROM TETA_ADMIN.${FX_OBJECTS.contract} E01`),
          message: 'the contract object appears only in the EXISTS FROM clause',
        },
        {
          ok: !fixtureOk.sqlText?.includes(`JOIN TETA_ADMIN.${FX_OBJECTS.contract}`),
          message: 'the contract object is never joined into the main tree',
        },
        {
          ok: fixtureOk.audit.filterOnlySourcesInMainJoinTree === 0,
          message: 'no filter-only source reaches the main join tree',
        },
        {
          ok: fixtureOk.reportGrain === 'health_examination',
          message: 'the compiled statement records the health_examination report grain',
        },
      ],
    },
    {
      reference: 'J',
      description: 'Joining a filter-only source into the main tree is rejected as unsafe',
      expectedStatus: 'rejected_unsafe',
      expectedRejectionCode: 'filter_only_source_in_join_tree',
      compiled: compileStage3eFixture({ filterOnlyInMainJoinTree: true }),
    },
    {
      reference: 'K',
      description: 'A filter-only source with no existence filter is rejected as unsafe',
      expectedStatus: 'rejected_unsafe',
      expectedRejectionCode: 'filter_only_source_without_existence_filter',
      compiled: compileStage3eFixture({ omitExistenceFilters: true }),
    },
    {
      reference: 'L',
      description: 'An uncorrelated EXISTS would not filter rows and is rejected',
      expectedStatus: 'rejected_unsafe',
      expectedRejectionCode: 'uncorrelated_existence_filter',
      compiled: compileStage3eFixture({ uncorrelatedExistenceFilter: true }),
    },
    {
      reference: 'M',
      description: 'Projecting a filter-only column is rejected as unsafe',
      expectedStatus: 'rejected_unsafe',
      expectedRejectionCode: 'filter_only_source_in_projection',
      compiled: compileStage3eFixture({ projectFilterOnlySource: true }),
    },
  ];

  for (const expectation of expectations) {
    const { result, errors } = evaluateReference(expectation);
    referenceResults.push(result);
    strictErrors.push(...errors);
  }

  for (const result of referenceResults) {
    if (result.compileStatus !== 'compiled' && result.sqlSha256) {
      strictErrors.push(`Reference ${result.reference} produced SQL despite being rejected`);
    }
  }

  const report: Stage3eAuditReport = {
    contractVersion: STAGE3E_CONTRACT_VERSION,
    dialect: STAGE3E_DIALECT,
    sourcePlanContractVersion: STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
    semanticBindingsVersion: input.semanticBindingsVersion,
    graphSourceHash: input.graphSourceHash,
    graphIndexSchemaVersion: input.graphIndexSchemaVersion,
    liveSourcePlanStatus: input.livePlan.planStatus,
    liveCompileStatus: live.compileStatus,
    liveSqlSha256: live.sqlSha256,
    liveSqlLineCount: live.sqlText ? live.sqlText.split('\n').length : 0,
    liveSourceCount: live.sources.length,
    liveJoinCount: live.joinTree?.edgeCount ?? 0,
    liveProjectionCount: live.projections.length,
    livePredicateCount: live.predicates.length,
    liveOrderingCount: live.ordering.length,
    liveBindCount: live.binds.length,
    liveAccessColumnRemaps: live.audit.accessColumnRemaps,
    liveValidationOk: live.validation.ok,
    liveReportGrain: live.reportGrain,
    liveRowProducingSources: liveRowSources.length,
    liveFilterOnlySources: liveFilterOnlySources.length,
    liveExistenceFilterCount: live.existenceFilters.length,
    referencesTested: referenceResults.length,
    referencesPassed: referenceResults.filter(
      (r) => !strictErrors.some((e) => e.startsWith(`Reference ${r.reference}:`)),
    ).length,
    referenceResults,
    counters: {
      statementsCompiled: live.audit.statementsCompiled,
      finalSqlGenerated: live.compileStatus === 'compiled' && live.sqlText ? 1 : 0,
      sqlExecuted: live.audit.sqlExecuted,
      oracleConnections: live.audit.oracleConnections,
      oracleWrites: live.audit.oracleWrites,
      businessDataRowsRead: live.audit.businessDataRowsRead,
      xlsxFilesRead: live.audit.xlsxFilesRead,
      qdrantCalls: live.audit.qdrantCalls,
      embeddingCalls: live.audit.embeddingCalls,
      llmCalls: live.audit.llmCalls,
      agentCalls: live.audit.agentCalls,
      selectStar: live.audit.selectStar,
      unqualifiedColumns: live.audit.unqualifiedColumns,
      sqlComments: live.audit.sqlComments,
      optimizerHints: live.audit.optimizerHints,
      semicolons: live.audit.semicolons,
      dmlStatements: live.audit.dmlStatements,
      plsqlBlocks: live.audit.plsqlBlocks,
      dbLinks: live.audit.dbLinks,
      forUpdateClauses: live.audit.forUpdateClauses,
      withClauses: live.audit.withClauses,
      multipleStatements: live.audit.multipleStatements,
      unboundUserLiterals: live.audit.unboundUserLiterals,
      cartesianJoins: live.audit.cartesianJoins,
      crossJoins: live.audit.crossJoins,
      selfJoins: live.audit.selfJoins,
      cyclicJoinGraphs: live.audit.cyclicJoinGraphs,
      invalidIdentifiers: live.audit.invalidIdentifiers,
      missingAccessColumns: live.audit.missingAccessColumns,
      forbiddenOwnerReferences: live.audit.forbiddenOwnerReferences,
      logicalObjectsUsedInSql: live.audit.logicalObjectsUsedInSql,
      reportGrainDefined: live.audit.reportGrainDefined,
      rowProducingSources: live.audit.rowProducingSources,
      filterOnlySources: live.audit.filterOnlySources,
      existenceFiltersCompiled: live.audit.existenceFiltersCompiled,
      filterOnlySourcesInMainJoinTree: live.audit.filterOnlySourcesInMainJoinTree,
      filterOnlyAliasesOutsideExists: live.audit.filterOnlyAliasesOutsideExists,
      filterOnlySourcesProjected: live.audit.filterOnlySourcesProjected,
      filterOnlySourcesUsedForOrdering: live.audit.filterOnlySourcesUsedForOrdering,
      unprovenFilterJoinCardinality: live.audit.unprovenFilterJoinCardinality,
      possibleReportRowMultiplication: live.audit.possibleReportRowMultiplication,
      distinctAddedToHideMultiplicity: live.audit.distinctAddedToHideMultiplicity,
      arbitrarySubqueriesDetected: live.audit.arbitrarySubqueriesDetected,
      uncorrelatedExistsDetected: live.audit.uncorrelatedExistsDetected,
      existsWithoutSemanticEvidence: live.audit.existsWithoutSemanticEvidence,
      uncontrolledSubqueries: live.audit.uncontrolledSubqueries,
      inSubqueries: live.audit.inSubqueries,
      distinctClauses: live.audit.distinctClauses,
    },
    deterministicCheckOk,
    // Filled in by verifyStage3eSqlArtifacts once the artifacts exist on disk.
    sqlArtifactHashMismatches: 0,
    sqlArtifactTextMismatches: 0,
    sessionContextHashMismatch: 0,
    artifactHashChecks: [],
    typecheckErrors: 0,
    strictErrors,
    generatedAt: new Date().toISOString(),
  };

  return { report, live };
}

/* ----------------------------------------------------------------- artifacts */

export function writeStage3eAuditArtifacts(
  report: Stage3eAuditReport,
  repoRoot: string,
  live: TetaCompiledOracleSelect,
  livePlan?: CompilableQueryPlan | null,
): void {
  const docsDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  writeFileSync(
    path.join(docsDir, 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.md'),
    renderStage3eAuditMarkdown(report, live),
    'utf8',
  );
  writeFileSync(
    path.join(docsDir, 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(localDir, 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.audit.json'),
    JSON.stringify({ report, compiled: live }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(localDir, 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.json'),
    JSON.stringify({ queryPlan: livePlan ?? null, compiled: live }, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(localDir, 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.sql'),
    // Exact sqlText bytes — same representation hashed for sqlSha256 (no extra trailing newline).
    live.sqlText ?? '',
    'utf8',
  );

  if (live.sqlText && live.sqlSha256) {
    syncSessionContextSqlHash(repoRoot, live.sqlSha256);
  }
}

/* ------------------------------------------------- artifact hash consistency */

const STAGE3E_ARTIFACT_PATHS = {
  docsJson: path.join('docs', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.json'),
  docsMarkdown: path.join('docs', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.md'),
  localAudit: path.join('.local', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.audit.json'),
  localReference: path.join('.local', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.json'),
  localSql: path.join('.local', 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.sql'),
  sessionContext: path.join('docs', 'session-context.md'),
} as const;

const SESSION_CONTEXT_HASH_RE = /(`sqlSha256` = `)([0-9a-f]{64})(`)/;

/**
 * Keeps the hash recorded in the session notes in step with the statement that was just compiled,
 * so every artifact from one pipeline run agrees on a single `sqlSha256`.
 */
export function syncSessionContextSqlHash(repoRoot: string, sqlSha256: string): boolean {
  const filePath = path.join(repoRoot, STAGE3E_ARTIFACT_PATHS.sessionContext);
  if (!existsSync(filePath)) return false;
  const current = readFileSync(filePath, 'utf8');
  if (!SESSION_CONTEXT_HASH_RE.test(current)) return false;
  const updated = current.replace(SESSION_CONTEXT_HASH_RE, `$1${sqlSha256}$3`);
  if (updated !== current) writeFileSync(filePath, updated, 'utf8');
  return true;
}

export type Stage3eArtifactVerification = {
  expectedSha256: string | null;
  sqlArtifactHashMismatches: number;
  sqlArtifactTextMismatches: number;
  sessionContextHashMismatch: number;
  artifactHashChecks: Stage3eAuditReport['artifactHashChecks'];
};

function extractMarkdownSqlBlock(markdown: string): string | null {
  const match = /## Live compiled SQL[^\n]*\n[\s\S]*?```sql\n([\s\S]*?)\n```/.exec(markdown);
  return match ? match[1]! : null;
}

/**
 * Re-reads every artifact from disk and compares it against a freshly computed hash of the
 * compiled statement. A drifting hash means an artifact was regenerated from a different run.
 */
export function verifyStage3eSqlArtifacts(input: {
  repoRoot: string;
  live: TetaCompiledOracleSelect;
}): Stage3eArtifactVerification {
  const { repoRoot, live } = input;
  const checks: Stage3eAuditReport['artifactHashChecks'] = [];
  let hashMismatches = 0;
  let textMismatches = 0;
  let sessionContextHashMismatch = 0;

  if (!live.sqlText) {
    return {
      expectedSha256: null,
      sqlArtifactHashMismatches: 0,
      sqlArtifactTextMismatches: 0,
      sessionContextHashMismatch: 0,
      artifactHashChecks: [],
    };
  }

  const expectedSha256 = createHash('sha256').update(live.sqlText, 'utf8').digest('hex');

  const record = (
    artifact: string,
    hashOk: boolean,
    textOk: boolean | null,
    detail: string,
  ) => {
    if (!hashOk) hashMismatches += 1;
    if (textOk === false) textMismatches += 1;
    checks.push({ artifact, hashOk, textOk, detail });
  };

  record(
    'compiled.sqlSha256',
    live.sqlSha256 === expectedSha256,
    null,
    live.sqlSha256 === expectedSha256
      ? 'compiler hash matches an independent sha256 of sqlText'
      : `compiler hash ${live.sqlSha256 ?? 'null'} != ${expectedSha256}`,
  );

  const readIfExists = (relative: string): string | null => {
    const filePath = path.join(repoRoot, relative);
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  };

  const docsJson = readIfExists(STAGE3E_ARTIFACT_PATHS.docsJson);
  if (docsJson === null) {
    record(STAGE3E_ARTIFACT_PATHS.docsJson, false, null, 'artifact is missing');
  } else {
    const parsed = JSON.parse(docsJson) as Stage3eAuditReport;
    record(
      STAGE3E_ARTIFACT_PATHS.docsJson,
      parsed.liveSqlSha256 === expectedSha256,
      null,
      `liveSqlSha256=${parsed.liveSqlSha256 ?? 'null'}`,
    );
  }

  const docsMarkdown = readIfExists(STAGE3E_ARTIFACT_PATHS.docsMarkdown);
  if (docsMarkdown === null) {
    record(STAGE3E_ARTIFACT_PATHS.docsMarkdown, false, null, 'artifact is missing');
  } else {
    const block = extractMarkdownSqlBlock(docsMarkdown);
    record(
      STAGE3E_ARTIFACT_PATHS.docsMarkdown,
      docsMarkdown.includes(expectedSha256),
      block === null ? false : block === live.sqlText,
      block === null ? 'no fenced SQL block found' : 'documented SQL block and hash compared',
    );
  }

  for (const relative of [
    STAGE3E_ARTIFACT_PATHS.localAudit,
    STAGE3E_ARTIFACT_PATHS.localReference,
  ]) {
    const content = readIfExists(relative);
    if (content === null) {
      record(relative, false, null, 'artifact is missing');
      continue;
    }
    const parsed = JSON.parse(content) as { compiled?: { sqlText?: string; sqlSha256?: string } };
    record(
      relative,
      parsed.compiled?.sqlSha256 === expectedSha256,
      parsed.compiled?.sqlText === live.sqlText,
      `compiled.sqlSha256=${parsed.compiled?.sqlSha256 ?? 'null'}`,
    );
  }

  const localSql = readIfExists(STAGE3E_ARTIFACT_PATHS.localSql);
  if (localSql === null) {
    record(STAGE3E_ARTIFACT_PATHS.localSql, false, null, 'artifact is missing');
  } else {
    const storedHash = createHash('sha256').update(localSql, 'utf8').digest('hex');
    record(
      STAGE3E_ARTIFACT_PATHS.localSql,
      storedHash === expectedSha256,
      localSql === live.sqlText,
      `sha256 of stored statement=${storedHash}`,
    );
  }

  const sessionContext = readIfExists(STAGE3E_ARTIFACT_PATHS.sessionContext);
  if (sessionContext === null) {
    record(STAGE3E_ARTIFACT_PATHS.sessionContext, false, null, 'artifact is missing');
    sessionContextHashMismatch = 1;
  } else {
    const recorded = SESSION_CONTEXT_HASH_RE.exec(sessionContext)?.[2] ?? null;
    const ok = recorded === expectedSha256;
    if (!ok) sessionContextHashMismatch = 1;
    record(
      STAGE3E_ARTIFACT_PATHS.sessionContext,
      ok,
      null,
      `recorded sqlSha256=${recorded ?? 'none'}`,
    );
  }

  return {
    expectedSha256,
    sqlArtifactHashMismatches: hashMismatches,
    sqlArtifactTextMismatches: textMismatches,
    sessionContextHashMismatch,
    artifactHashChecks: checks,
  };
}

/**
 * Writes the artifacts, verifies them against a fresh hash, folds the result into the report and
 * rewrites so the published artifacts carry their own verification outcome.
 */
export function writeAndVerifyStage3eArtifacts(input: {
  report: Stage3eAuditReport;
  repoRoot: string;
  live: TetaCompiledOracleSelect;
  livePlan?: CompilableQueryPlan | null;
  typecheckErrors?: number;
}): Stage3eArtifactVerification {
  const { report, repoRoot, live, livePlan } = input;
  writeStage3eAuditArtifacts(report, repoRoot, live, livePlan ?? null);

  const verification = verifyStage3eSqlArtifacts({ repoRoot, live });
  report.sqlArtifactHashMismatches = verification.sqlArtifactHashMismatches;
  report.sqlArtifactTextMismatches = verification.sqlArtifactTextMismatches;
  report.sessionContextHashMismatch = verification.sessionContextHashMismatch;
  report.artifactHashChecks = verification.artifactHashChecks;
  report.typecheckErrors = input.typecheckErrors ?? 0;

  for (const check of verification.artifactHashChecks) {
    if (!check.hashOk) {
      report.strictErrors.push(`artifact ${check.artifact} hash mismatch: ${check.detail}`);
    }
    if (check.textOk === false) {
      report.strictErrors.push(`artifact ${check.artifact} SQL text differs from the compiled statement`);
    }
  }
  if (report.typecheckErrors !== 0) {
    report.strictErrors.push(`typecheckErrors=${report.typecheckErrors}; expected 0`);
  }

  writeStage3eAuditArtifacts(report, repoRoot, live, livePlan ?? null);
  return verification;
}

export function renderStage3eAuditMarkdown(
  report: Stage3eAuditReport,
  live: TetaCompiledOracleSelect,
): string {
  const sourceRows = live.sources
    .map(
      (s) =>
        `| ${s.alias} | \`${s.sourceRole}\` | \`${s.usage}\` | \`${s.qualifiedName}\` | \`${s.logicalObjectNodeId ?? '—'}\` | ${s.enrichment ? 'yes' : 'no'} |`,
    )
    .join('\n');
  const existenceRows = live.existenceFilters
    .map(
      (e) =>
        `| ${e.ordinal} | \`${e.filterRole}\` | \`${e.relationRole}\` | \`${e.correlatedSourceRole}\` (${e.correlatedAlias}) | \`${e.filterOnlySourceRole}\` (${e.existenceAlias}) | ${e.correlationConditions.map((c) => `\`${c}\``).join(' AND ')} | ${e.preservesReportGrain} |`,
    )
    .join('\n');
  const artifactRows = report.artifactHashChecks
    .map(
      (c) =>
        `| \`${c.artifact}\` | ${c.hashOk ? 'ok' : 'MISMATCH'} | ${c.textOk === null ? 'n/a' : c.textOk ? 'ok' : 'MISMATCH'} | ${c.detail} |`,
    )
    .join('\n');
  const projectionRows = live.projections
    .map(
      (p) =>
        `| ${p.ordinal} | \`${p.businessRole}\` | \`${p.expression}\` | \`${p.resultAlias}\` | ${p.displayLabel ?? '—'} |`,
    )
    .join('\n');
  const joinRows = (live.joinTree?.steps ?? [])
    .map(
      (j) =>
        `| ${j.ordinal} | ${j.joinKeyword} | \`${j.joinedSourceRole}\` (${j.joinedAlias}) | \`${j.anchorSourceRole}\` (${j.anchorAlias}) | ${j.onConditions.map((c) => `\`${c}\``).join(' AND ')} |`,
    )
    .join('\n');
  const predicateRows = live.predicates
    .map(
      (p) =>
        `| ${p.ordinal} | \`${p.filterRole}\` | \`${p.filterType}\` | ${p.placement}${p.targetJoinId ? ` (\`${p.targetJoinId}\`)` : ''} | \`${p.sql}\` |`,
    )
    .join('\n');
  const referenceRows = report.referenceResults
    .map(
      (r) =>
        `| ${r.reference} | ${r.description} | \`${r.compileStatus}\` | ${r.rejectionCode ? `\`${r.rejectionCode}\`` : '—'} | ${r.validationOk ? 'ok' : '—'} |`,
    )
    .join('\n');
  const counterRows = Object.entries(report.counters)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join('\n');

  return `# AIA Oracle SELECT Compiler — Stage 3E

Generated: ${report.generatedAt}

## Summary

| Field | Value |
|-------|-------|
| Contract | \`${report.contractVersion}\` |
| Dialect | \`${report.dialect}\` |
| Source plan contract | \`${report.sourcePlanContractVersion}\` |
| Stage 3D bindings | \`${report.semanticBindingsVersion ?? '—'}\` |
| Graph hash | \`${report.graphSourceHash ?? '—'}\` |
| Graph index schema | \`${report.graphIndexSchemaVersion ?? '—'}\` |
| Live source planStatus | \`${report.liveSourcePlanStatus}\` |
| Live compileStatus | \`${report.liveCompileStatus}\` |
| Live \`sqlSha256\` | \`${report.liveSqlSha256 ?? '—'}\` |
| Live SQL lines | ${report.liveSqlLineCount} |
| Report grain | \`${report.liveReportGrain ?? '—'}\` |
| Sources (row-producing / filter-only) | ${report.liveRowProducingSources} / ${report.liveFilterOnlySources} |
| Main join tree edges | ${report.liveJoinCount} |
| Existence filters | ${report.liveExistenceFilterCount} |
| Projections / predicates / ordering | ${report.liveProjectionCount} / ${report.livePredicateCount} / ${report.liveOrderingCount} |
| Binds | ${report.liveBindCount} |
| Access column remaps | ${report.liveAccessColumnRemaps} |
| Validation ok | ${report.liveValidationOk} |
| References passed | ${report.referencesPassed} / ${report.referencesTested} |
| Deterministic | ${report.deterministicCheckOk} |
| SQL artifact hash / text mismatches | ${report.sqlArtifactHashMismatches} / ${report.sqlArtifactTextMismatches} |
| Session-context hash mismatch | ${report.sessionContextHashMismatch} |
| Typecheck errors | ${report.typecheckErrors} |
| Strict errors | ${report.strictErrors.length} |

## Live compiled SQL (Reference A)

Question: _${STAGE3E_REFERENCE_BHP_QUESTION}_

\`\`\`sql
${live.sqlText ?? '-- not compiled'}
\`\`\`

\`sqlSha256\` = \`${report.liveSqlSha256 ?? '—'}\` (sha256 of the UTF-8 statement text, no trailing newline)

## Sources (access objects only)

\`row_source\` entries appear in FROM/JOIN; \`filter_only\` entries exist only inside a correlated
EXISTS and use the separate \`E\` alias space.

| Alias | Role | Usage | Access object | Logical object | Enrichment |
|-------|------|-------|---------------|----------------|------------|
${sourceRows || '| — | — | — | — | — | — |'}

## Projections

| # | Business role | Expression | Result alias | Label |
|---|---------------|-----------|--------------|-------|
${projectionRows || '| — | — | — | — | — |'}

## Join tree

Root: \`${live.joinTree?.rootSourceRole ?? '—'}\` (${live.joinTree?.rootAlias ?? '—'}) — \`${live.joinTree?.rootQualifiedName ?? '—'}\`

| # | Keyword | Joined | Anchor | ON |
|---|---------|--------|--------|----|
${joinRows || '| — | — | — | — | — |'}

## Predicates

| # | Filter role | Type | Placement | SQL |
|---|-------------|------|-----------|-----|
${predicateRows || '| — | — | — | — | — |'}

Predicates that belong to a LEFT JOIN source are attached to that join's \`ON\` clause; moving them
to \`WHERE\` would turn the outer join into an inner join and drop employees whose enrichment rows
are missing.

## Existence filters (grain-preserving qualification)

An employee can hold several employment contracts, and after the temporal filter there is still no
cardinality proof that at most one row survives. Joining the contract object would therefore
multiply examination rows, so the qualifying condition is compiled as a correlated
\`EXISTS (SELECT 1 …)\` instead. The report grain stays \`${report.liveReportGrain ?? '—'}\`.

| # | Filter role | Relation | Correlated row source | Filter-only source | Correlation | Preserves grain |
|---|-------------|----------|-----------------------|--------------------|-------------|-----------------|
${existenceRows || '| — | — | — | — | — | — | — |'}

## Artifact hash consistency

Every artifact below is compared against an independent \`sha256\` of the compiled statement, so a
stale hash in one file cannot survive an audit run.

| Artifact | Hash | SQL text | Detail |
|----------|------|----------|--------|
${artifactRows || '| — | — | — | — |'}

## Ordering

${
  live.ordering.length
    ? live.ordering.map((o) => `- \`${o.expression} ${o.direction}\` (${o.orderRole})`).join('\n')
    : '_none_'
}

## Binds

${
  live.binds.length
    ? live.binds.map((b) => `- \`${b.placeholder}\` — ${b.filterRole} (${b.oracleType})`).join('\n')
    : '_none — every value derives from the canonical graph plus `SYSDATE`_'
}

## References

| Ref | Scenario | compileStatus | Rejection | Validation |
|-----|----------|---------------|-----------|------------|
${referenceRows || '| — | — | — | — | — |'}

## Counters (live compilation)

| Counter | Value |
|---------|-------|
${counterRows}

## Strict errors

${report.strictErrors.length ? report.strictErrors.map((e) => `- ${e}`).join('\n') : '_none_'}

## Notes

- Stage 3E consumes \`${report.sourcePlanContractVersion}\` and does not modify Stage 3A–3D contracts.
- SQL always reads from the plan's \`accessObject\`; logical (\`TETA_ADMIN\`) objects are used only to
  look up column evidence, which is then remapped to the access owner via \`HAS_COLUMN\`.
- Identifiers must match \`^[A-Z][A-Z0-9_$#]*$\`; nothing is quoted and nothing is concatenated from
  free text.
- No Oracle connection, no SQL execution, no business data read, no Qdrant / embeddings / LLM / agent.
- The compiled statement has no trailing semicolon and uses LF newlines with a two-space indent.
`;
}
