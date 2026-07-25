/**
 * Stage 3E — correlated EXISTS compilation.
 *
 * A qualifying source that can match several rows per report row must not be joined, because the
 * join would multiply the report. It is compiled as
 *
 *   EXISTS (
 *     SELECT 1
 *     FROM OWNER.OBJECT E01
 *     WHERE E01.FK = S01.ID
 *       AND E01.DATE_FROM <= SYSDATE
 *       AND (E01.DATE_TO IS NULL OR E01.DATE_TO >= SYSDATE)
 *   )
 *
 * The subquery shape is fixed (`SELECT 1`, exactly one FROM entry, at least one correlation
 * condition), which is what lets the independent validator accept these and reject any other
 * subquery.
 */
import type {
  QueryExistenceFilter,
  QueryFilter,
} from '../teta-query-planner/teta-query-plan.types';
import type {
  CompilableQueryFilter,
  CompiledExistenceFilter,
  CompiledSourceAlias,
} from './teta-oracle-compiler.types';
import type { AccessColumnResolver } from './teta-oracle-access-column-resolver';
import {
  compileComparison,
  compileDateBoundary,
  compileNullableComparison,
  isOpenEndedOperator,
  mapComparisonOperator,
} from './teta-oracle-expression-compiler';
import { STAGE3E_INDENT } from './teta-oracle-select-renderer';

export type ExistenceCompileIssue = {
  code: string;
  message: string;
  filterRole: string;
};

export type ExistenceCompileResult =
  | { ok: true; existenceFilters: CompiledExistenceFilter[] }
  | { ok: false; issue: ExistenceCompileIssue };

function isEffectiveOnDate(
  filter: CompilableQueryFilter | undefined,
): filter is Extract<QueryFilter, { type: 'effective_on_date' }> {
  return !!filter && filter.type === 'effective_on_date';
}

/** Renders the fixed EXISTS layout; callers add one indent level per nesting depth. */
function renderExistenceLines(input: {
  qualifiedName: string;
  alias: string;
  conditions: string[];
}): string[] {
  const [first, ...rest] = input.conditions;
  return [
    'EXISTS (',
    `${STAGE3E_INDENT}SELECT 1`,
    `${STAGE3E_INDENT}FROM ${input.qualifiedName} ${input.alias}`,
    `${STAGE3E_INDENT}WHERE ${first}`,
    ...rest.map((condition) => `${STAGE3E_INDENT}${STAGE3E_INDENT}AND ${condition}`),
    ')',
  ];
}

function renderExistenceOneLine(input: {
  qualifiedName: string;
  alias: string;
  conditions: string[];
}): string {
  return `EXISTS (SELECT 1 FROM ${input.qualifiedName} ${input.alias} WHERE ${input.conditions.join(' AND ')})`;
}

export function compileExistenceFilters(input: {
  existenceFilters: QueryExistenceFilter[];
  filters: CompilableQueryFilter[];
  byRole: Map<string, CompiledSourceAlias>;
  accessColumns: AccessColumnResolver;
}): ExistenceCompileResult {
  const { byRole, accessColumns } = input;
  const compiled: CompiledExistenceFilter[] = [];

  for (const existence of input.existenceFilters) {
    if (existence.status !== 'resolved') {
      return {
        ok: false,
        issue: {
          code: 'existence_filter_not_resolved',
          filterRole: existence.filterRole,
          message: `Existence filter ${existence.filterRole} has status ${existence.status}`,
        },
      };
    }

    const inner = byRole.get(existence.filterOnlySourceRole);
    if (!inner) {
      return {
        ok: false,
        issue: {
          code: 'existence_filter_unknown_source',
          filterRole: existence.filterRole,
          message: `Existence filter ${existence.filterRole} references unknown source ${existence.filterOnlySourceRole}`,
        },
      };
    }
    if (inner.usage !== 'filter_only') {
      return {
        ok: false,
        issue: {
          code: 'existence_source_not_filter_only',
          filterRole: existence.filterRole,
          message: `Existence filter ${existence.filterRole} targets ${inner.sourceRole}, which is a row-producing source`,
        },
      };
    }

    const outer = byRole.get(existence.correlatedSourceRole);
    if (!outer) {
      return {
        ok: false,
        issue: {
          code: 'existence_filter_unknown_source',
          filterRole: existence.filterRole,
          message: `Existence filter ${existence.filterRole} correlates to unknown source ${existence.correlatedSourceRole}`,
        },
      };
    }
    if (outer.usage !== 'row_source') {
      return {
        ok: false,
        issue: {
          code: 'existence_correlation_not_row_source',
          filterRole: existence.filterRole,
          message: `Existence filter ${existence.filterRole} must correlate to a row-producing source, got ${outer.sourceRole}`,
        },
      };
    }

    if (!existence.correlationPredicates.length) {
      return {
        ok: false,
        issue: {
          code: 'uncorrelated_existence_filter',
          filterRole: existence.filterRole,
          message: `Existence filter ${existence.filterRole} has no correlation predicates; an uncorrelated EXISTS would not filter rows`,
        },
      };
    }

    const accessColumnNodeIds: string[] = [];
    const correlationConditions: string[] = [];
    for (const predicate of existence.correlationPredicates) {
      if (predicate.operator !== 'equals') {
        return {
          ok: false,
          issue: {
            code: 'unsupported_join_operator',
            filterRole: existence.filterRole,
            message: `Existence filter ${existence.filterRole} uses operator ${String(predicate.operator)}; only equals is supported`,
          },
        };
      }
      const innerColumn = accessColumns.resolve(
        predicate.innerOracleColumnNodeId,
        existence.filterOnlySourceRole,
      );
      if (!innerColumn.ok) {
        return {
          ok: false,
          issue: {
            code: innerColumn.issue.code,
            filterRole: existence.filterRole,
            message: `Existence filter ${existence.filterRole}: ${innerColumn.issue.message}`,
          },
        };
      }
      const outerColumn = accessColumns.resolve(
        predicate.outerOracleColumnNodeId,
        existence.correlatedSourceRole,
      );
      if (!outerColumn.ok) {
        return {
          ok: false,
          issue: {
            code: outerColumn.issue.code,
            filterRole: existence.filterRole,
            message: `Existence filter ${existence.filterRole}: ${outerColumn.issue.message}`,
          },
        };
      }
      accessColumnNodeIds.push(
        innerColumn.column.accessColumnNodeId,
        outerColumn.column.accessColumnNodeId,
      );
      correlationConditions.push(
        compileComparison(
          innerColumn.column.qualifiedExpression,
          '=',
          outerColumn.column.qualifiedExpression,
        ),
      );
    }

    const temporalConditions: string[] = [];
    if (existence.temporalFilterRole) {
      const temporal = input.filters.find((f) => f.filterRole === existence.temporalFilterRole);
      if (!isEffectiveOnDate(temporal)) {
        return {
          ok: false,
          issue: {
            code: 'existence_temporal_filter_missing',
            filterRole: existence.filterRole,
            message: `Existence filter ${existence.filterRole} references temporal filter ${existence.temporalFilterRole}, which is not an effective_on_date filter in the plan`,
          },
        };
      }
      if (temporal.status !== 'resolved') {
        return {
          ok: false,
          issue: {
            code: 'filter_not_resolved',
            filterRole: temporal.filterRole,
            message: `Filter ${temporal.filterRole} has status ${temporal.status}`,
          },
        };
      }
      if (temporal.clock !== 'oracle_sysdate') {
        return {
          ok: false,
          issue: {
            code: 'unsupported_clock',
            filterRole: temporal.filterRole,
            message: `Filter ${temporal.filterRole} uses clock ${temporal.clock}`,
          },
        };
      }
      const resolvedPredicates = temporal.resolvedPredicates ?? [];
      if (!resolvedPredicates.length) {
        return {
          ok: false,
          issue: {
            code: 'filter_without_compilable_predicates',
            filterRole: temporal.filterRole,
            message: `Filter ${temporal.filterRole} has no resolved predicates`,
          },
        };
      }
      for (const predicate of resolvedPredicates) {
        if (!predicate.leftOracleColumnNodeId) {
          return {
            ok: false,
            issue: {
              code: 'filter_predicate_without_column',
              filterRole: temporal.filterRole,
              message: `Filter ${temporal.filterRole} has a predicate without leftOracleColumnNodeId`,
            },
          };
        }
        const operator = mapComparisonOperator(predicate.operator);
        if (!operator) {
          return {
            ok: false,
            issue: {
              code: 'unsupported_filter_operator',
              filterRole: temporal.filterRole,
              message: `Filter ${temporal.filterRole} uses unsupported operator ${String(predicate.operator)}`,
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
              filterRole: temporal.filterRole,
              message: `Filter ${temporal.filterRole}: ${boundary.message}`,
            },
          };
        }
        const column = accessColumns.resolve(
          predicate.leftOracleColumnNodeId,
          existence.filterOnlySourceRole,
        );
        if (!column.ok) {
          return {
            ok: false,
            issue: {
              code: column.issue.code,
              filterRole: temporal.filterRole,
              message: `Filter ${temporal.filterRole}: ${column.issue.message}`,
            },
          };
        }
        accessColumnNodeIds.push(column.column.accessColumnNodeId);
        temporalConditions.push(
          isOpenEndedOperator(predicate.operator)
            ? compileNullableComparison(
                column.column.qualifiedExpression,
                operator,
                boundary.text,
              )
            : compileComparison(column.column.qualifiedExpression, operator, boundary.text),
        );
      }
    }

    const conditions = [...correlationConditions, ...temporalConditions];
    compiled.push({
      ordinal: compiled.length + 1,
      filterRole: existence.filterRole,
      relationRole: existence.relationRole,
      temporalFilterRole: existence.temporalFilterRole,
      correlatedSourceRole: existence.correlatedSourceRole,
      correlatedAlias: outer.alias,
      filterOnlySourceRole: existence.filterOnlySourceRole,
      existenceAlias: inner.alias,
      existenceQualifiedName: inner.qualifiedName,
      correlationConditions,
      temporalConditions,
      preservesReportGrain: true,
      sql: renderExistenceOneLine({
        qualifiedName: inner.qualifiedName,
        alias: inner.alias,
        conditions,
      }),
      sqlLines: renderExistenceLines({
        qualifiedName: inner.qualifiedName,
        alias: inner.alias,
        conditions,
      }),
      accessColumnNodeIds: [...new Set(accessColumnNodeIds)].sort(),
    });
  }

  return { ok: true, existenceFilters: compiled };
}
