/**
 * Stage 3C — filter planner (typed AST, never raw SQL).
 */
import type { FilterResolution } from './teta-report-template.types';
import type {
  QueryColumnRef,
  QueryFilter,
  QuerySource,
} from './teta-query-plan.types';
import {
  collectOracleObjectCandidates,
  columnsOfOracleObject,
  type Stage3cGraphClient,
} from './teta-query-graph-client';

export function planFilters(input: {
  client: Stage3cGraphClient;
  filterSpecs: FilterResolution[];
  filterOrder: string[];
  projections: QueryColumnRef[];
  sources: QuerySource[];
}): { filters: QueryFilter[]; filtersWithoutColumnEvidence: number } {
  const filters: QueryFilter[] = [];
  let filtersWithoutColumnEvidence = 0;

  for (const role of input.filterOrder) {
    const spec = input.filterSpecs.find((f) => f.filterRole === role);
    if (!spec) {
      continue;
    }

    if (spec.type === 'half_open_date_interval') {
      const col = input.projections.find((p) => p.businessRole === spec.columnBusinessRole);
      const columnOracleNodeId =
        col?.status === 'resolved' ? col.oracleColumnNodeId : null;
      if (!columnOracleNodeId) filtersWithoutColumnEvidence += 1;
      filters.push({
        filterRole: spec.filterRole,
        type: 'half_open_date_interval',
        status: columnOracleNodeId ? 'resolved' : 'incomplete',
        columnOracleNodeId,
        columnBusinessRole: spec.columnBusinessRole,
        lowerBoundary: {
          clock: 'oracle_sysdate',
          transform: 'month_start',
          inclusive: true,
        },
        upperBoundary: {
          clock: 'oracle_sysdate',
          transform: 'next_month_start',
          inclusive: false,
        },
        provenanceNodeIds: columnOracleNodeId ? [columnOracleNodeId] : [],
        provenanceEdgeIds: [],
      });
      continue;
    }

    // effective_on_date — require confirmed active-employment evidence in graph
    const employmentCandidates = collectOracleObjectCandidates(input.client, [
      ...(spec.searchTerms ?? []),
      'active_employment',
    ]);
    const employee = input.sources.find((s) => s.sourceRole === 'employee');
    const predicates: Array<{
      kind: string;
      leftOracleColumnNodeId?: string;
      operator?: string;
      right?: {
        clock: 'oracle_sysdate';
        transform: 'identity';
        inclusive: boolean;
      };
      provenanceEdgeIds?: string[];
    }> = [];

    let provenanceNodeIds: string[] = [];
    let provenanceEdgeIds: string[] = [];
    let missingReason: string | null = null;

    // Prefer columns tagged as employment effective dating on employee or employment source
    const searchObjects = [
      ...(employee?.status === 'resolved'
        ? [
            employee.logicalObject?.nodeId,
            employee.accessObject?.nodeId,
          ].filter((x): x is string => !!x)
        : []),
      ...employmentCandidates.map((n) => n.id),
    ];

    for (const oid of [...new Set(searchObjects)].sort()) {
      const { columns, edgeIds } = columnsOfOracleObject(input.client, oid);
      const activeCols = columns.filter((c) => {
        const role = String(c.attributes?.businessRole ?? '');
        const tags = Array.isArray(c.attributes?.semanticTags)
          ? (c.attributes!.semanticTags as string[])
          : [];
        const hints = Array.isArray(c.attributes?.labelHints)
          ? (c.attributes!.labelHints as string[])
          : [];
        return (
          role === 'employment_valid_from' ||
          role === 'employment_valid_to' ||
          tags.includes('active_employment') ||
          hints.some((h) => /zatrud|aktualn|data od|data do/i.test(h))
        );
      });
      if (columns.some((c) => String(c.attributes?.activeEmploymentSemantics) === 'confirmed')) {
        const marker = columns.find(
          (c) => String(c.attributes?.activeEmploymentSemantics) === 'confirmed',
        )!;
        predicates.push({
          kind: 'confirmed_active_employment_semantics',
          leftOracleColumnNodeId: marker.id,
          operator: 'effective_on',
          right: { clock: 'oracle_sysdate', transform: 'identity', inclusive: true },
          provenanceEdgeIds: edgeIds,
        });
        provenanceNodeIds.push(oid, marker.id);
        provenanceEdgeIds.push(...edgeIds);
      } else if (activeCols.length >= 2) {
        const from =
          activeCols.find((c) => String(c.attributes?.businessRole) === 'employment_valid_from') ??
          activeCols[0]!;
        const to =
          activeCols.find((c) => String(c.attributes?.businessRole) === 'employment_valid_to') ??
          activeCols[1]!;
        predicates.push({
          kind: 'employment_date_range_contains_sysdate',
          leftOracleColumnNodeId: from.id,
          operator: 'less_or_equal',
          right: { clock: 'oracle_sysdate', transform: 'identity', inclusive: true },
          provenanceEdgeIds: edgeIds,
        });
        predicates.push({
          kind: 'employment_date_range_contains_sysdate',
          leftOracleColumnNodeId: to.id,
          operator: 'greater_or_null',
          right: { clock: 'oracle_sysdate', transform: 'identity', inclusive: true },
          provenanceEdgeIds: edgeIds,
        });
        provenanceNodeIds.push(oid, from.id, to.id);
        provenanceEdgeIds.push(...edgeIds);
      }
    }

    if (!predicates.length) {
      missingReason =
        'missing_confirmed_active_employment_semantics_in_graph; do_not_assume_T_PRAC_presence_means_active';
      filtersWithoutColumnEvidence += 1;
    }

    filters.push({
      filterRole: spec.filterRole,
      type: 'effective_on_date',
      status: predicates.length ? 'resolved' : 'incomplete',
      clock: 'oracle_sysdate',
      resolvedPredicates: predicates,
      sourceRole: employee?.sourceRole ?? null,
      missingReason,
      provenanceNodeIds: [...new Set(provenanceNodeIds)].sort(),
      provenanceEdgeIds: [...new Set(provenanceEdgeIds)].sort(),
    });
  }

  // Stable order by template filter order
  filters.sort((a, b) => {
    const ia = input.filterOrder.indexOf(a.filterRole);
    const ib = input.filterOrder.indexOf(b.filterRole);
    return ia - ib;
  });

  return { filters, filtersWithoutColumnEvidence };
}
