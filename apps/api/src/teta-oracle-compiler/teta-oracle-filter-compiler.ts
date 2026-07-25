/**
 * Stage 3E — filter compilation.
 *
 * Predicates that belong to a source reached through a LEFT JOIN are attached to that join's ON
 * clause; putting them in WHERE would silently turn the outer join into an inner join and drop
 * employees whose enrichment rows are missing. Everything else goes to WHERE.
 */
import type {
  QueryColumnRef,
  QueryFilter,
} from '../teta-query-planner/teta-query-plan.types';
import type {
  CompilableQueryFilter,
  CompilableQueryPlan,
  CompiledExistenceFilter,
  CompiledJoinTree,
  CompiledPredicate,
  CompiledSourceAlias,
  UserLiteralFilter,
} from './teta-oracle-compiler.types';
import type { AccessColumnResolver } from './teta-oracle-access-column-resolver';
import type { BindPlan } from './teta-oracle-bind-planner';
import {
  compileComparison,
  compileDateBoundary,
  compileHalfOpenInterval,
  compileNullableComparison,
  isOpenEndedOperator,
  mapComparisonOperator,
} from './teta-oracle-expression-compiler';

export type FilterCompileIssue = {
  code: string;
  message: string;
  filterRole: string;
};

export type FilterCompileResult =
  | { ok: true; predicates: CompiledPredicate[]; warnings: Array<{ code: string; message: string }> }
  | { ok: false; issue: FilterCompileIssue };

function isUserLiteralFilter(filter: CompilableQueryFilter): filter is UserLiteralFilter {
  return filter.type === 'user_literal_equals';
}

function sourceRoleForColumnBusinessRole(
  projections: QueryColumnRef[],
  businessRole: string | undefined,
): string | null {
  if (!businessRole) return null;
  return projections.find((p) => p.businessRole === businessRole)?.sourceRole ?? null;
}

export function compileFilters(input: {
  plan: CompilableQueryPlan;
  byRole: Map<string, CompiledSourceAlias>;
  joinTree: CompiledJoinTree;
  nullableRoles: Set<string>;
  accessColumns: AccessColumnResolver;
  bindPlan: BindPlan;
  /** Already-compiled correlated existence tests, keyed back to the filter they consume. */
  existenceFilters?: CompiledExistenceFilter[];
}): FilterCompileResult {
  const { plan, byRole, joinTree, nullableRoles, accessColumns, bindPlan } = input;
  const predicates: CompiledPredicate[] = [];
  const warnings: Array<{ code: string; message: string }> = [];

  const joinByJoinedRole = new Map(joinTree.steps.map((s) => [s.joinedSourceRole, s]));
  const existenceFilters = input.existenceFilters ?? [];
  const existenceByConsumedRole = new Map<string, CompiledExistenceFilter>();
  for (const existence of existenceFilters) {
    if (existence.temporalFilterRole) {
      existenceByConsumedRole.set(existence.temporalFilterRole, existence);
    }
  }

  function pushExistence(existence: CompiledExistenceFilter) {
    predicates.push({
      ordinal: predicates.length + 1,
      filterRole: existence.filterRole,
      filterType: 'correlated_exists',
      kind: 'filter_only_source_exists',
      sql: existence.sql,
      sqlLines: existence.sqlLines,
      placement: 'where',
      targetJoinId: null,
      accessColumnNodeIds: existence.accessColumnNodeIds,
      bindNames: [],
    });
  }

  function placementFor(sourceRole: string | null): {
    placement: CompiledPredicate['placement'];
    targetJoinId: string | null;
  } {
    if (!sourceRole) return { placement: 'where', targetJoinId: null };
    if (!nullableRoles.has(sourceRole)) return { placement: 'where', targetJoinId: null };
    const step = joinByJoinedRole.get(sourceRole);
    if (!step) return { placement: 'where', targetJoinId: null };
    return { placement: 'join_on', targetJoinId: step.joinId };
  }

  function push(
    filter: CompilableQueryFilter,
    kind: string,
    sql: string,
    sourceRole: string | null,
    accessColumnNodeIds: string[],
    bindNames: string[] = [],
  ) {
    const { placement, targetJoinId } = placementFor(sourceRole);
    predicates.push({
      ordinal: predicates.length + 1,
      filterRole: filter.filterRole,
      filterType: filter.type,
      kind,
      sql,
      placement,
      targetJoinId,
      accessColumnNodeIds,
      bindNames,
    });
  }

  const emittedExistenceRoles = new Set<string>();

  for (const filter of plan.filters ?? []) {
    const untypedFilter = filter as unknown as { filterRole: string; type: string };
    if (filter.status !== 'resolved') {
      return {
        ok: false,
        issue: {
          code: 'filter_not_resolved',
          filterRole: filter.filterRole,
          message: `Filter ${filter.filterRole} has status ${filter.status}`,
        },
      };
    }

    // A filter consumed by an existence test is emitted inside the EXISTS subquery, never as a
    // separate WHERE predicate against the main tree.
    const consumingExistence = existenceByConsumedRole.get(filter.filterRole);
    if (consumingExistence) {
      pushExistence(consumingExistence);
      emittedExistenceRoles.add(consumingExistence.filterRole);
      continue;
    }

    const filterSource =
      'sourceRole' in filter && filter.sourceRole ? byRole.get(filter.sourceRole) : undefined;
    if (filterSource?.usage === 'filter_only') {
      return {
        ok: false,
        issue: {
          code: 'filter_only_source_without_existence_filter',
          filterRole: filter.filterRole,
          message: `Filter ${filter.filterRole} targets filter-only source ${filterSource.sourceRole} but no existence filter consumes it`,
        },
      };
    }

    if (filter.type === 'half_open_date_interval') {
      const typed = filter as Extract<QueryFilter, { type: 'half_open_date_interval' }>;
      if (!typed.columnOracleNodeId) {
        return {
          ok: false,
          issue: {
            code: 'filter_without_column_evidence',
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole} has no columnOracleNodeId`,
          },
        };
      }
      const preferredRole = sourceRoleForColumnBusinessRole(
        plan.projections,
        typed.columnBusinessRole,
      );
      const column = accessColumns.resolve(typed.columnOracleNodeId, preferredRole);
      if (!column.ok) {
        return {
          ok: false,
          issue: {
            code: column.issue.code,
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole}: ${column.issue.message}`,
          },
        };
      }
      const interval = compileHalfOpenInterval(
        column.column.qualifiedExpression,
        typed.lowerBoundary,
        typed.upperBoundary,
      );
      if (!interval.ok) {
        return {
          ok: false,
          issue: {
            code: interval.code,
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole}: ${interval.message}`,
          },
        };
      }
      push(
        filter,
        'half_open_interval_lower',
        interval.conditions[0]!,
        column.column.sourceRole,
        [column.column.accessColumnNodeId],
      );
      push(
        filter,
        'half_open_interval_upper',
        interval.conditions[1]!,
        column.column.sourceRole,
        [column.column.accessColumnNodeId],
      );
      continue;
    }

    if (filter.type === 'effective_on_date') {
      const typed = filter as Extract<QueryFilter, { type: 'effective_on_date' }>;
      if (typed.clock !== 'oracle_sysdate') {
        return {
          ok: false,
          issue: {
            code: 'unsupported_clock',
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole} uses clock ${typed.clock}`,
          },
        };
      }
      const resolvedPredicates = typed.resolvedPredicates ?? [];
      if (!resolvedPredicates.length) {
        return {
          ok: false,
          issue: {
            code: 'filter_without_compilable_predicates',
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole} has no resolved predicates`,
          },
        };
      }
      const filterSourceRole = typed.sourceRole ?? null;
      let compiledCount = 0;
      for (const predicate of resolvedPredicates) {
        if (!predicate.leftOracleColumnNodeId) {
          return {
            ok: false,
            issue: {
              code: 'filter_predicate_without_column',
              filterRole: filter.filterRole,
              message: `Filter ${filter.filterRole} has a predicate without leftOracleColumnNodeId`,
            },
          };
        }
        const operator = mapComparisonOperator(predicate.operator);
        if (!operator) {
          return {
            ok: false,
            issue: {
              code: 'unsupported_filter_operator',
              filterRole: filter.filterRole,
              message: `Filter ${filter.filterRole} uses unsupported operator ${String(predicate.operator)}`,
            },
          };
        }
        const boundary = compileDateBoundary(
          predicate.right as Parameters<typeof compileDateBoundary>[0],
        );
        if (!boundary.ok) {
          return {
            ok: false,
            issue: {
              code: boundary.code,
              filterRole: filter.filterRole,
              message: `Filter ${filter.filterRole}: ${boundary.message}`,
            },
          };
        }
        const column = accessColumns.resolve(predicate.leftOracleColumnNodeId, filterSourceRole);
        if (!column.ok) {
          return {
            ok: false,
            issue: {
              code: column.issue.code,
              filterRole: filter.filterRole,
              message: `Filter ${filter.filterRole}: ${column.issue.message}`,
            },
          };
        }
        const openEnded = isOpenEndedOperator(predicate.operator);
        const sql = openEnded
          ? compileNullableComparison(column.column.qualifiedExpression, operator, boundary.text)
          : compileComparison(column.column.qualifiedExpression, operator, boundary.text);
        push(
          filter,
          predicate.kind ?? (openEnded ? 'interval_end_or_null' : 'interval_start'),
          sql,
          column.column.sourceRole,
          [column.column.accessColumnNodeId],
        );
        compiledCount += 1;
      }
      if (!compiledCount) {
        return {
          ok: false,
          issue: {
            code: 'filter_without_compilable_predicates',
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole} produced no conditions`,
          },
        };
      }
      continue;
    }

    if (isUserLiteralFilter(filter)) {
      if (!filter.columnOracleNodeId) {
        return {
          ok: false,
          issue: {
            code: 'filter_without_column_evidence',
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole} has no columnOracleNodeId`,
          },
        };
      }
      const column = accessColumns.resolve(filter.columnOracleNodeId, filter.sourceRole ?? null);
      if (!column.ok) {
        return {
          ok: false,
          issue: {
            code: column.issue.code,
            filterRole: filter.filterRole,
            message: `Filter ${filter.filterRole}: ${column.issue.message}`,
          },
        };
      }
      const bind = bindPlan.allocate({
        filterRole: filter.filterRole,
        oracleType: filter.literal.kind,
      });
      push(
        filter,
        'user_literal_equals',
        compileComparison(column.column.qualifiedExpression, '=', bind.placeholder),
        column.column.sourceRole,
        [column.column.accessColumnNodeId],
        [bind.placeholder],
      );
      warnings.push({
        code: 'user_literal_bound',
        message: `Filter ${filter.filterRole} uses bind ${bind.placeholder} for the user-supplied value`,
      });
      continue;
    }

    return {
      ok: false,
      issue: {
        code: 'unsupported_filter_type',
        filterRole: untypedFilter.filterRole,
        message: `Unsupported filter type ${String(untypedFilter.type)}`,
      },
    };
  }

  // Existence tests without a temporal filter to anchor them keep a deterministic tail position.
  for (const existence of existenceFilters) {
    if (emittedExistenceRoles.has(existence.filterRole)) continue;
    pushExistence(existence);
    emittedExistenceRoles.add(existence.filterRole);
  }

  return { ok: true, predicates, warnings };
}
