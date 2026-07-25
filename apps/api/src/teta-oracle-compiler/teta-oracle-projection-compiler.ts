/**
 * Stage 3E — projection compilation.
 *
 * Every projected column is qualified with its source alias and aliased to the UPPER_SNAKE form of
 * the Stage 3D business role. `SELECT *` can never be produced because the column list is built
 * exclusively from resolved plan projections.
 */
import type {
  CompilableQueryPlan,
  CompiledProjection,
  CompiledSourceAlias,
} from './teta-oracle-compiler.types';
import type { AccessColumnResolver } from './teta-oracle-access-column-resolver';
import { toUpperSnakeIdentifier, validateIdentifier } from './teta-oracle-identifier-validator';

export type ProjectionCompileIssue = {
  code: string;
  message: string;
  businessRole: string | null;
};

export type ProjectionCompileResult =
  | { ok: true; projections: CompiledProjection[] }
  | { ok: false; issue: ProjectionCompileIssue };

export function compileProjections(input: {
  plan: CompilableQueryPlan;
  byRole: Map<string, CompiledSourceAlias>;
  accessColumns: AccessColumnResolver;
}): ProjectionCompileResult {
  const { plan, byRole, accessColumns } = input;
  const projections: CompiledProjection[] = [];
  const usedAliases = new Set<string>();

  if (!plan.projections.length) {
    return {
      ok: false,
      issue: { code: 'no_projections', businessRole: null, message: 'Plan has no projections' },
    };
  }
  if (plan.projections.length > plan.limits.maxColumns) {
    return {
      ok: false,
      issue: {
        code: 'projection_count_over_limit',
        businessRole: null,
        message: `${plan.projections.length} projections exceed maxColumns=${plan.limits.maxColumns}`,
      },
    };
  }

  for (const projection of plan.projections) {
    if (projection.status !== 'resolved') {
      return {
        ok: false,
        issue: {
          code: 'projection_not_resolved',
          businessRole: projection.businessRole,
          message: `Projection ${projection.businessRole} has status ${projection.status}`,
        },
      };
    }
    if (!projection.oracleColumnNodeId) {
      return {
        ok: false,
        issue: {
          code: 'projection_without_column_evidence',
          businessRole: projection.businessRole,
          message: `Projection ${projection.businessRole} has no oracleColumnNodeId`,
        },
      };
    }
    // A filter-only source is not in FROM/JOIN, so its columns are not addressable in the SELECT list.
    if (byRole.get(projection.sourceRole)?.usage === 'filter_only') {
      return {
        ok: false,
        issue: {
          code: 'filter_only_source_in_projection',
          businessRole: projection.businessRole,
          message: `Projection ${projection.businessRole} reads from filter-only source ${projection.sourceRole}`,
        },
      };
    }

    const resultAlias = toUpperSnakeIdentifier(projection.businessRole);
    const aliasIssue = validateIdentifier('resultAlias', resultAlias);
    if (aliasIssue) {
      return {
        ok: false,
        issue: {
          code: 'invalid_result_alias',
          businessRole: projection.businessRole,
          message: aliasIssue.message,
        },
      };
    }
    if (usedAliases.has(resultAlias)) {
      return {
        ok: false,
        issue: {
          code: 'duplicate_result_alias',
          businessRole: projection.businessRole,
          message: `Result alias ${resultAlias} is used by more than one projection`,
        },
      };
    }

    const column = accessColumns.resolve(projection.oracleColumnNodeId, projection.sourceRole);
    if (!column.ok) {
      return {
        ok: false,
        issue: {
          code: column.issue.code,
          businessRole: projection.businessRole,
          message: `Projection ${projection.businessRole}: ${column.issue.message}`,
        },
      };
    }

    usedAliases.add(resultAlias);
    projections.push({
      ordinal: projections.length + 1,
      businessRole: projection.businessRole,
      resultAlias,
      expression: column.column.qualifiedExpression,
      sourceRole: column.column.sourceRole,
      logicalColumnNodeId: projection.oracleColumnNodeId,
      accessColumnNodeId: column.column.accessColumnNodeId,
      displayLabel: projection.displayLabel ?? null,
    });
  }

  return { ok: true, projections };
}
