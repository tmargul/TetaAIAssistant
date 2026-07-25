/**
 * Stage 3E — ORDER BY compilation.
 *
 * Ordering uses qualified access columns, never result aliases, so the statement stays valid if a
 * projection alias later changes.
 */
import type {
  CompilableQueryPlan,
  CompiledOrdering,
  CompiledProjection,
  CompiledSourceAlias,
} from './teta-oracle-compiler.types';
import type { AccessColumnResolver } from './teta-oracle-access-column-resolver';
import { parseOracleColumnNodeId } from './teta-oracle-identifier-validator';

export type OrderingCompileIssue = {
  code: string;
  message: string;
  orderRole: string | null;
};

export type OrderingCompileResult =
  | {
      ok: true;
      ordering: CompiledOrdering[];
      warnings: Array<{ code: string; message: string }>;
    }
  | { ok: false; issue: OrderingCompileIssue };

export function compileOrdering(input: {
  plan: CompilableQueryPlan;
  projections: CompiledProjection[];
  byRole: Map<string, CompiledSourceAlias>;
  accessColumns: AccessColumnResolver;
}): OrderingCompileResult {
  const { plan, projections, byRole, accessColumns } = input;
  const ordering: CompiledOrdering[] = [];
  const warnings: Array<{ code: string; message: string }> = [];

  const filterOnlySources = [...byRole.values()].filter((s) => s.usage === 'filter_only');
  /**
   * A filter-only column never resolves through the access resolver, so recognise it from the
   * column node id and report it as an ordering violation instead of a missing column.
   */
  const filterOnlySourceForColumn = (columnNodeId: string): CompiledSourceAlias | null => {
    const parsed = parseOracleColumnNodeId(columnNodeId);
    if (!parsed) return null;
    return (
      filterOnlySources.find(
        (s) =>
          s.accessObjectName === parsed.objectName || s.logicalObjectName === parsed.objectName,
      ) ?? null
    );
  };

  for (const entry of plan.ordering ?? []) {
    if (entry.status !== 'resolved' || !entry.oracleColumnNodeId) {
      warnings.push({
        code: 'ordering_entry_skipped',
        message: `Ordering ${entry.orderRole} skipped (status=${entry.status})`,
      });
      continue;
    }
    const preferredRole =
      projections.find((p) => p.businessRole === entry.businessRole)?.sourceRole ?? null;
    // ORDER BY reads the result set, which never contains filter-only columns.
    if (preferredRole && byRole.get(preferredRole)?.usage === 'filter_only') {
      return {
        ok: false,
        issue: {
          code: 'filter_only_source_in_ordering',
          orderRole: entry.orderRole,
          message: `Ordering ${entry.orderRole} reads from filter-only source ${preferredRole}`,
        },
      };
    }
    const filterOnlyTarget = filterOnlySourceForColumn(entry.oracleColumnNodeId);
    if (filterOnlyTarget) {
      return {
        ok: false,
        issue: {
          code: 'filter_only_source_in_ordering',
          orderRole: entry.orderRole,
          message: `Ordering ${entry.orderRole} reads a column of filter-only source ${filterOnlyTarget.sourceRole}`,
        },
      };
    }
    const column = accessColumns.resolve(entry.oracleColumnNodeId, preferredRole);
    if (column.ok && byRole.get(column.column.sourceRole)?.usage === 'filter_only') {
      return {
        ok: false,
        issue: {
          code: 'filter_only_source_in_ordering',
          orderRole: entry.orderRole,
          message: `Ordering ${entry.orderRole} resolved to filter-only source ${column.column.sourceRole}`,
        },
      };
    }
    if (!column.ok) {
      return {
        ok: false,
        issue: {
          code: column.issue.code,
          orderRole: entry.orderRole,
          message: `Ordering ${entry.orderRole}: ${column.issue.message}`,
        },
      };
    }
    if (entry.direction !== 'ascending' && entry.direction !== 'descending') {
      return {
        ok: false,
        issue: {
          code: 'unsupported_ordering_direction',
          orderRole: entry.orderRole,
          message: `Ordering ${entry.orderRole} uses unsupported direction ${String(entry.direction)}`,
        },
      };
    }
    ordering.push({
      ordinal: ordering.length + 1,
      orderRole: entry.orderRole,
      businessRole: entry.businessRole,
      expression: column.column.qualifiedExpression,
      direction: entry.direction === 'descending' ? 'DESC' : 'ASC',
      accessColumnNodeId: column.column.accessColumnNodeId,
    });
  }

  return { ok: true, ordering, warnings };
}
