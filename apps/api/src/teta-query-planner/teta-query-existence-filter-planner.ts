/**
 * Stage 3C — existence filter planner.
 * Turns `filter_only` relations into correlated existence entries so a qualifying source can never
 * become a row-producing join and change the report grain.
 */
import type {
  QueryExistenceFilter,
  QueryFilter,
  QuerySource,
} from './teta-query-plan.types';
import { isFilterOnlyQuerySource } from './teta-query-plan.types';
import type { SemanticRelationBinding } from '../teta-business-semantics/teta-business-semantics.types';
import { existenceFilterFromSemanticRelation } from '../teta-business-semantics/teta-stage3c-semantic-adapter';

/** Temporal filters carrying a sourceRole are the ones that can be pushed into an EXISTS. */
function temporalFilterForSource(
  filters: QueryFilter[],
  sourceRole: string,
): { role: string; status: 'resolved' | 'incomplete' | 'missing' } | null {
  for (const f of filters) {
    if (f.type !== 'effective_on_date') continue;
    if (f.sourceRole !== sourceRole) continue;
    return { role: f.filterRole, status: f.status };
  }
  return null;
}

export function buildExistenceFilters(input: {
  filterOnlyRelations: SemanticRelationBinding[];
  sources: QuerySource[];
  filters: QueryFilter[];
}): QueryExistenceFilter[] {
  const filterOnlyRoles = new Set(
    input.sources.filter(isFilterOnlyQuerySource).map((s) => s.sourceRole),
  );

  const built: QueryExistenceFilter[] = [];
  for (const relation of input.filterOnlyRelations) {
    const filterOnlySourceRole = filterOnlyRoles.has(relation.rightSourceRole)
      ? relation.rightSourceRole
      : filterOnlyRoles.has(relation.leftSourceRole)
        ? relation.leftSourceRole
        : null;
    if (!filterOnlySourceRole) continue;

    const temporal = temporalFilterForSource(input.filters, filterOnlySourceRole);
    built.push(
      existenceFilterFromSemanticRelation({
        relation,
        filterOnlySourceRole,
        temporalFilterRole: temporal?.role ?? null,
        temporalFilterStatus: temporal?.status ?? null,
      }),
    );
  }

  built.sort((a, b) => a.filterRole.localeCompare(b.filterRole));
  return built;
}

/** Filter roles already consumed by an existence filter must not be emitted as plain predicates. */
export function existenceConsumedFilterRoles(
  existenceFilters: QueryExistenceFilter[] | undefined,
): Set<string> {
  const roles = new Set<string>();
  for (const e of existenceFilters ?? []) {
    if (e.temporalFilterRole) roles.add(e.temporalFilterRole);
  }
  return roles;
}
