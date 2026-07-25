/**
 * Stage 3E — TetaOracleSelectCompilerService.
 *
 * Turns a Stage 3C `TetaReadOnlyQueryPlan` (planStatus=ready_for_compilation) into exactly one
 * deterministic Oracle 19c SELECT. No Oracle connection, no execution, no LLM, no Qdrant.
 */
import { STAGE3A_INDEX_SCHEMA_VERSION } from '../teta-plugins/teta-stage3a.types';
import type { Stage3cGraphClient } from '../teta-query-planner/teta-query-graph-client';
import {
  STAGE3E_CONTRACT_VERSION,
  STAGE3E_DIALECT,
  STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
  type OracleCompileStatus,
  type Stage3eAuditCounters,
  type TetaCompiledOracleSelect,
  type TetaOracleSelectCompilationRequest,
} from './teta-oracle-compiler.types';
import { gateCompilationRequest } from './teta-oracle-compiler-contract';
import { planSourceAliases } from './teta-oracle-source-alias-planner';
import { createAccessColumnResolver } from './teta-oracle-access-column-resolver';
import { buildJoinTree, nullableSourceRoles } from './teta-oracle-join-tree-builder';
import { compileProjections } from './teta-oracle-projection-compiler';
import { compileExistenceFilters } from './teta-oracle-existence-compiler';
import { compileFilters } from './teta-oracle-filter-compiler';
import { compileOrdering } from './teta-oracle-ordering-compiler';
import { createBindPlan } from './teta-oracle-bind-planner';
import { renderSelect } from './teta-oracle-select-renderer';
import { validateCompiledSql } from './teta-oracle-compiled-sql-validator';

export type OracleSelectCompilerOptions = {
  graph: Stage3cGraphClient | null;
  graphSourceHash?: string | null;
  graphIndexSchemaVersion?: string | null;
  semanticBindingsVersion?: string | null;
};

/** Codes that mean "the plan shape is not supported by v1" rather than "the plan is broken". */
const UNSUPPORTED_CODES = new Set([
  'cyclic_join_graph_unsupported',
  'self_join_unsupported',
  'left_join_reversal_unsupported',
  'unsupported_join_operator',
  'unsupported_filter_type',
  'unsupported_filter_operator',
  'unsupported_date_transform',
  'unsupported_clock',
  'unsupported_ordering_direction',
  'unexpected_join_for_single_source',
]);

/** Codes that mean "compiling this would produce an unsafe statement". */
const UNSAFE_CODES = new Set([
  'cartesian_join_forbidden',
  'projection_count_over_limit',
  'compiled_sql_validation_failed',
  'filter_only_source_in_join_tree',
  'filter_only_source_without_existence_filter',
  'filter_only_source_in_projection',
  'filter_only_source_in_ordering',
  'uncorrelated_existence_filter',
]);

function statusForCode(code: string): OracleCompileStatus {
  if (UNSUPPORTED_CODES.has(code)) return 'rejected_unsupported';
  if (UNSAFE_CODES.has(code)) return 'rejected_unsafe';
  return 'rejected_invalid_plan';
}

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
    reportGrainDefined: 0,
    rowProducingSources: 0,
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

export class TetaOracleSelectCompilerService {
  constructor(private readonly options: OracleSelectCompilerOptions) {}

  compile(request: TetaOracleSelectCompilationRequest): TetaCompiledOracleSelect {
    const started = Date.now();
    const plan = request.queryPlan;
    const graphSourceHash =
      this.options.graphSourceHash ??
      plan?.evidence?.graphSourceHash ??
      plan?.audit?.graphSourceHash ??
      null;

    const base = (
      compileStatus: OracleCompileStatus,
      partial: Partial<TetaCompiledOracleSelect> = {},
    ): TetaCompiledOracleSelect => {
      const compiled: TetaCompiledOracleSelect = {
        contractVersion: STAGE3E_CONTRACT_VERSION,
        compileStatus,
        dialect: STAGE3E_DIALECT,
        sourcePlanContractVersion: STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
        intent: plan?.intent ?? request.expectedIntent,
        subject: plan?.subject ?? request.expectedSubject ?? null,
        sqlText: null,
        sqlSha256: null,
        binds: [],
        sources: [],
        accessColumns: [],
        projections: [],
        joinTree: null,
        predicates: [],
        existenceFilters: [],
        ordering: [],
        reportGrain: plan?.reportGrain ?? null,
        limits: {
          maxRows: plan?.limits?.maxRows ?? 0,
          maxColumns: plan?.limits?.maxColumns ?? 0,
          statementTimeoutMs: plan?.limits?.statementTimeoutMs ?? 0,
        },
        validation: { ok: false, checks: {} as never, violations: [] },
        warnings: [],
        rejection: null,
        evidence: { graphSourceHash, nodeIds: [], edgeIds: [] },
        executionPolicy: {
          sqlExecutionAllowed: false,
          oracleConnectionAllowed: false,
          oracleWriteAllowed: false,
          fileReadAllowed: false,
          reason:
            'Stage 3E compiles a read-only SELECT; execution and Oracle connections belong to a later stage.',
        },
        audit: {
          deterministic: true,
          compilerDurationMs: 0,
          compilerContractVersion: STAGE3E_CONTRACT_VERSION,
          sourcePlanContractVersion: STAGE3E_SOURCE_PLAN_CONTRACT_VERSION,
          semanticBindingsVersion: this.options.semanticBindingsVersion ?? null,
          graphSourceHash,
          graphIndexSchemaVersion:
            this.options.graphIndexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
          sourceCount: 0,
          joinCount: 0,
          projectionCount: 0,
          predicateCount: 0,
          existenceFilterCount: 0,
          orderingCount: 0,
          bindCount: 0,
          accessColumnRemaps: 0,
          ...emptyCounters(),
        },
        ...partial,
      };
      compiled.audit.compilerDurationMs = Date.now() - started;
      compiled.audit.generatedAt = new Date().toISOString();
      return compiled;
    };

    const rejectWith = (
      compileStatus: OracleCompileStatus,
      code: string,
      message: string,
      partial: Partial<TetaCompiledOracleSelect> = {},
    ) =>
      base(compileStatus, {
        rejection: { code, message },
        ...partial,
      });

    const gate = gateCompilationRequest(request, this.options.graphSourceHash ?? null, !!this.options.graph);
    if (!gate.ok) {
      const counters = emptyCounters();
      if (gate.code === 'forbidden_owner' || gate.code === 'owner_not_allowed') {
        counters.forbiddenOwnerReferences = 1;
      }
      if (gate.code === 'cartesian_join_in_plan') counters.cartesianJoins = 1;
      if (gate.code === 'select_star_in_plan') counters.selectStar = 1;
      const rejected = rejectWith(gate.compileStatus, gate.code, gate.message);
      Object.assign(rejected.audit, counters);
      return rejected;
    }

    const graph = this.options.graph!;
    const aliasPlan = planSourceAliases(plan);
    if (aliasPlan.issues.length || aliasPlan.identifierIssues.length) {
      const issue = aliasPlan.issues[0];
      const identifierIssue = aliasPlan.identifierIssues[0];
      const rejected = rejectWith(
        'rejected_invalid_plan',
        issue?.code ?? identifierIssue!.code,
        issue?.message ?? identifierIssue!.message,
      );
      rejected.audit.invalidIdentifiers = aliasPlan.identifierIssues.length;
      return rejected;
    }

    const accessColumns = createAccessColumnResolver({
      client: graph,
      sources: aliasPlan.allSources,
    });

    const joinResult = buildJoinTree({
      plan,
      sources: aliasPlan.sources,
      byRole: aliasPlan.byRole,
      accessColumns,
    });
    if (!joinResult.ok) {
      const rejected = rejectWith(
        statusForCode(joinResult.issue.code),
        joinResult.issue.code,
        joinResult.issue.message,
        { sources: aliasPlan.sources },
      );
      rejected.audit.sourceCount = aliasPlan.sources.length;
      rejected.audit.selfJoins = joinResult.selfJoins;
      rejected.audit.crossJoins = joinResult.crossJoins;
      rejected.audit.cartesianJoins = joinResult.crossJoins;
      rejected.audit.cyclicJoinGraphs = joinResult.cyclic ? 1 : 0;
      if (joinResult.issue.code === 'filter_only_source_in_join_tree') {
        rejected.audit.filterOnlySourcesInMainJoinTree = 1;
      }
      if (joinResult.issue.code === 'missing_access_column_evidence') {
        rejected.audit.missingAccessColumns = 1;
      }
      return rejected;
    }

    const projectionResult = compileProjections({
      plan,
      byRole: aliasPlan.byRole,
      accessColumns,
    });
    if (!projectionResult.ok) {
      const rejected = rejectWith(
        statusForCode(projectionResult.issue.code),
        projectionResult.issue.code,
        projectionResult.issue.message,
        { sources: aliasPlan.sources, joinTree: joinResult.tree },
      );
      rejected.audit.sourceCount = aliasPlan.sources.length;
      rejected.audit.joinCount = joinResult.tree.edgeCount;
      if (projectionResult.issue.code === 'missing_access_column_evidence') {
        rejected.audit.missingAccessColumns = 1;
      }
      return rejected;
    }

    const existenceResult = compileExistenceFilters({
      existenceFilters: plan.existenceFilters ?? [],
      filters: plan.filters ?? [],
      byRole: aliasPlan.byRole,
      accessColumns,
    });
    if (!existenceResult.ok) {
      const rejected = rejectWith(
        statusForCode(existenceResult.issue.code),
        existenceResult.issue.code,
        existenceResult.issue.message,
        {
          sources: aliasPlan.sources,
          joinTree: joinResult.tree,
          projections: projectionResult.projections,
        },
      );
      rejected.audit.sourceCount = aliasPlan.sources.length;
      rejected.audit.joinCount = joinResult.tree.edgeCount;
      rejected.audit.projectionCount = projectionResult.projections.length;
      rejected.audit.rowProducingSources = aliasPlan.sources.length;
      rejected.audit.filterOnlySources = aliasPlan.filterOnlySources.length;
      if (existenceResult.issue.code === 'missing_access_column_evidence') {
        rejected.audit.missingAccessColumns = 1;
      }
      return rejected;
    }

    const bindPlan = createBindPlan();
    const filterResult = compileFilters({
      plan,
      byRole: aliasPlan.byRole,
      joinTree: joinResult.tree,
      nullableRoles: nullableSourceRoles(joinResult.tree),
      accessColumns,
      bindPlan,
      existenceFilters: existenceResult.existenceFilters,
    });
    if (!filterResult.ok) {
      const rejected = rejectWith(
        statusForCode(filterResult.issue.code),
        filterResult.issue.code,
        filterResult.issue.message,
        {
          sources: aliasPlan.sources,
          joinTree: joinResult.tree,
          projections: projectionResult.projections,
        },
      );
      rejected.audit.sourceCount = aliasPlan.sources.length;
      rejected.audit.joinCount = joinResult.tree.edgeCount;
      rejected.audit.projectionCount = projectionResult.projections.length;
      if (filterResult.issue.code === 'missing_access_column_evidence') {
        rejected.audit.missingAccessColumns = 1;
      }
      return rejected;
    }

    const orderingResult = compileOrdering({
      plan,
      projections: projectionResult.projections,
      byRole: aliasPlan.byRole,
      accessColumns,
    });
    if (!orderingResult.ok) {
      const rejected = rejectWith(
        statusForCode(orderingResult.issue.code),
        orderingResult.issue.code,
        orderingResult.issue.message,
        {
          sources: aliasPlan.sources,
          joinTree: joinResult.tree,
          projections: projectionResult.projections,
        },
      );
      rejected.audit.sourceCount = aliasPlan.sources.length;
      rejected.audit.joinCount = joinResult.tree.edgeCount;
      rejected.audit.projectionCount = projectionResult.projections.length;
      return rejected;
    }

    const rendered = renderSelect({
      projections: projectionResult.projections,
      joinTree: joinResult.tree,
      predicates: filterResult.predicates,
      ordering: orderingResult.ordering,
      maxRows: plan.limits.maxRows,
    });

    const validation = validateCompiledSql({
      sqlText: rendered.sqlText,
      sourceAliases: aliasPlan.sources.map((s) => s.alias),
      existenceAliases: aliasPlan.filterOnlySources.map((s) => s.alias),
      resultAliases: projectionResult.projections.map((p) => p.resultAlias),
      owners: [...new Set(aliasPlan.allSources.map((s) => s.accessOwner))].sort(),
      bindPlaceholders: bindPlan.binds.map((b) => b.placeholder),
    });

    const resolvedColumns = accessColumns.resolved();
    const warnings = [
      ...accessColumns.warnings(),
      ...filterResult.warnings,
      ...orderingResult.warnings,
    ];

    const logicalObjectsUsedInSql = aliasPlan.allSources.filter(
      (s) =>
        s.logicalObjectNodeId &&
        s.logicalObjectNodeId !== s.accessObjectNodeId &&
        rendered.sqlText.includes(`${s.logicalOwner}.${s.logicalObjectName} `),
    ).length;

    const joinTreeRoles = new Set<string>([
      joinResult.tree.rootSourceRole,
      ...joinResult.tree.steps.flatMap((s) => [s.joinedSourceRole, s.anchorSourceRole]),
    ]);

    const counters: Stage3eAuditCounters = {
      ...emptyCounters(),
      reportGrainDefined: plan.reportGrain ? 1 : 0,
      rowProducingSources: aliasPlan.sources.length,
      filterOnlySources: aliasPlan.filterOnlySources.length,
      existenceFiltersCompiled: existenceResult.existenceFilters.length,
      filterOnlySourcesInMainJoinTree: aliasPlan.filterOnlySources.filter((s) =>
        joinTreeRoles.has(s.sourceRole),
      ).length,
      filterOnlyAliasesOutsideExists: validation.violations.filter(
        (v) => v.code === 'filter_only_alias_outside_exists',
      ).length,
      filterOnlySourcesProjected: aliasPlan.filterOnlySources.filter((s) =>
        (plan.projections ?? []).some((p) => p.sourceRole === s.sourceRole),
      ).length,
      filterOnlySourcesUsedForOrdering: aliasPlan.filterOnlySources.filter((s) =>
        (plan.ordering ?? []).some((o) => {
          const proj = (plan.projections ?? []).find((p) => p.businessRole === o.businessRole);
          return proj?.sourceRole === s.sourceRole;
        }),
      ).length,
      unprovenFilterJoinCardinality: 0,
      possibleReportRowMultiplication: aliasPlan.filterOnlySources.filter((s) =>
        joinTreeRoles.has(s.sourceRole),
      ).length,
      distinctAddedToHideMultiplicity: validation.checks.no_distinct ? 0 : 1,
      arbitrarySubqueriesDetected: validation.violations.filter(
        (v) =>
          v.code === 'uncontrolled_exists_subquery' ||
          v.code === 'nested_subquery_forbidden' ||
          v.code === 'unbalanced_exists_parentheses',
      ).length,
      uncorrelatedExistsDetected: validation.violations.filter(
        (v) => v.code === 'uncorrelated_exists_subquery',
      ).length,
      existsWithoutSemanticEvidence:
        existenceResult.existenceFilters.length > 0 &&
        (plan.existenceFilters ?? []).length === 0
          ? 1
          : 0,
      uncontrolledSubqueries: validation.violations.filter(
        (v) =>
          v.code === 'uncontrolled_exists_subquery' ||
          v.code === 'uncorrelated_exists_subquery' ||
          v.code === 'nested_subquery_forbidden' ||
          v.code === 'exists_subquery_alias_mismatch' ||
          v.code === 'unbalanced_exists_parentheses',
      ).length,
      inSubqueries: validation.checks.no_in_subquery ? 0 : 1,
      distinctClauses: validation.checks.no_distinct ? 0 : 1,
      statementsCompiled: validation.ok ? 1 : 0,
      finalSqlGenerated: validation.ok ? 1 : 0,
      selectStar: validation.checks.no_select_star ? 0 : 1,
      unqualifiedColumns: validation.violations.filter((v) => v.code === 'unqualified_identifier')
        .length,
      sqlComments: validation.checks.no_sql_comments ? 0 : 1,
      optimizerHints: validation.checks.no_optimizer_hints ? 0 : 1,
      semicolons: validation.checks.no_semicolon ? 0 : 1,
      dmlStatements: validation.checks.no_dml_or_ddl ? 0 : 1,
      plsqlBlocks: validation.checks.no_plsql_block ? 0 : 1,
      dbLinks: validation.checks.no_db_link ? 0 : 1,
      forUpdateClauses: validation.checks.no_for_update ? 0 : 1,
      withClauses: validation.checks.no_with_clause ? 0 : 1,
      multipleStatements: validation.checks.single_statement ? 0 : 1,
      unboundUserLiterals: validation.violations.filter(
        (v) => v.code === 'inline_literal_forbidden' || v.code === 'unknown_bind_variable',
      ).length,
      logicalObjectsUsedInSql,
    };

    const evidenceNodeIds = [
      ...new Set([
        ...aliasPlan.allSources.map((s) => s.accessObjectNodeId),
        ...aliasPlan.allSources
          .map((s) => s.logicalObjectNodeId)
          .filter((id): id is string => !!id),
        ...resolvedColumns.map((c) => c.accessColumnNodeId),
        ...resolvedColumns.map((c) => c.logicalColumnNodeId),
      ]),
    ].sort();
    const evidenceEdgeIds = [
      ...new Set(resolvedColumns.flatMap((c) => c.evidenceEdgeIds)),
    ].sort();

    if (!validation.ok) {
      const rejected = base('rejected_unsafe', {
        sources: aliasPlan.allSources,
        accessColumns: resolvedColumns,
        projections: projectionResult.projections,
        joinTree: joinResult.tree,
        predicates: filterResult.predicates,
        existenceFilters: existenceResult.existenceFilters,
        ordering: orderingResult.ordering,
        reportGrain: plan.reportGrain ?? null,
        binds: bindPlan.binds,
        sqlText: null,
        sqlSha256: null,
        validation,
        warnings,
        rejection: {
          code: 'compiled_sql_validation_failed',
          message: `Compiled SQL failed validation: ${validation.violations
            .map((v) => v.code)
            .join(', ')}`,
        },
        evidence: { graphSourceHash, nodeIds: evidenceNodeIds, edgeIds: evidenceEdgeIds },
        limits: { ...plan.limits },
      });
      Object.assign(rejected.audit, counters, {
        sourceCount: aliasPlan.allSources.length,
        joinCount: joinResult.tree.edgeCount,
        projectionCount: projectionResult.projections.length,
        predicateCount: filterResult.predicates.length,
        existenceFilterCount: existenceResult.existenceFilters.length,
        orderingCount: orderingResult.ordering.length,
        bindCount: bindPlan.binds.length,
        accessColumnRemaps: accessColumns.remapCount(),
        statementsCompiled: 0,
      });
      return rejected;
    }

    const compiled = base('compiled', {
      sources: aliasPlan.allSources,
      accessColumns: resolvedColumns,
      projections: projectionResult.projections,
      joinTree: joinResult.tree,
      predicates: filterResult.predicates,
      existenceFilters: existenceResult.existenceFilters,
      ordering: orderingResult.ordering,
      reportGrain: plan.reportGrain ?? null,
      binds: bindPlan.binds,
      sqlText: rendered.sqlText,
      sqlSha256: rendered.sqlSha256,
      validation,
      warnings,
      rejection: null,
      evidence: { graphSourceHash, nodeIds: evidenceNodeIds, edgeIds: evidenceEdgeIds },
      limits: { ...plan.limits },
    });
    Object.assign(compiled.audit, counters, {
      sourceCount: aliasPlan.allSources.length,
      joinCount: joinResult.tree.edgeCount,
      projectionCount: projectionResult.projections.length,
      predicateCount: filterResult.predicates.length,
      existenceFilterCount: existenceResult.existenceFilters.length,
      orderingCount: orderingResult.ordering.length,
      bindCount: bindPlan.binds.length,
      accessColumnRemaps: accessColumns.remapCount(),
    });
    return compiled;
  }
}
