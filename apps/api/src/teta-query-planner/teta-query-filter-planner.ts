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
import type { SemanticTemporalBinding } from '../teta-business-semantics/teta-business-semantics.types';
import { resolveTemporalRule } from '../teta-business-semantics/teta-semantic-temporal-rule-resolver';

function pushEffectiveDatePredicatesFromObject(
  client: Stage3cGraphClient,
  oid: string,
  predicates: Array<{
    kind: string;
    leftOracleColumnNodeId?: string;
    operator?: string;
    right?: {
      clock: 'oracle_sysdate';
      transform: 'identity';
      inclusive: boolean;
    };
    provenanceEdgeIds?: string[];
  }>,
  provenanceNodeIds: string[],
  provenanceEdgeIds: string[],
  opts?: { preferPositionRoles?: boolean },
): boolean {
  const { columns, edgeIds } = columnsOfOracleObject(client, oid);
  const preferPosition = !!opts?.preferPositionRoles;

  if (
    !preferPosition &&
    columns.some((c) => String(c.attributes?.activeEmploymentSemantics) === 'confirmed')
  ) {
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
    return true;
  }

  if (
    preferPosition &&
    columns.some((c) => String(c.attributes?.positionEffectiveDating) === 'confirmed')
  ) {
    const marker = columns.find(
      (c) => String(c.attributes?.positionEffectiveDating) === 'confirmed',
    )!;
    predicates.push({
      kind: 'confirmed_position_effective_dating',
      leftOracleColumnNodeId: marker.id,
      operator: 'effective_on',
      right: { clock: 'oracle_sysdate', transform: 'identity', inclusive: true },
      provenanceEdgeIds: edgeIds,
    });
    provenanceNodeIds.push(oid, marker.id);
    provenanceEdgeIds.push(...edgeIds);
    return true;
  }

  const roleFrom = preferPosition ? 'position_valid_from' : 'employment_valid_from';
  const roleTo = preferPosition ? 'position_valid_to' : 'employment_valid_to';
  const tag = preferPosition ? 'current_position' : 'active_employment';

  const activeCols = columns.filter((c) => {
    const role = String(c.attributes?.businessRole ?? '');
    const tags = Array.isArray(c.attributes?.semanticTags)
      ? (c.attributes!.semanticTags as string[])
      : [];
    const hints = Array.isArray(c.attributes?.labelHints)
      ? (c.attributes!.labelHints as string[])
      : [];
    return (
      role === roleFrom ||
      role === roleTo ||
      tags.includes(tag) ||
      hints.some((h) =>
        preferPosition
          ? /stanowisk|data od|data do/i.test(h)
          : /zatrud|aktualn|data od|data do/i.test(h),
      )
    );
  });

  if (activeCols.length >= 2) {
    const from =
      activeCols.find((c) => String(c.attributes?.businessRole) === roleFrom) ?? activeCols[0]!;
    const to =
      activeCols.find((c) => String(c.attributes?.businessRole) === roleTo) ?? activeCols[1]!;
    predicates.push({
      kind: 'effective_date_range_contains_sysdate',
      leftOracleColumnNodeId: from.id,
      operator: 'less_or_equal',
      right: { clock: 'oracle_sysdate', transform: 'identity', inclusive: true },
      provenanceEdgeIds: edgeIds,
    });
    predicates.push({
      kind: 'effective_date_range_contains_sysdate_or_null_end',
      leftOracleColumnNodeId: to.id,
      operator: 'greater_or_null',
      right: { clock: 'oracle_sysdate', transform: 'identity', inclusive: true },
      provenanceEdgeIds: edgeIds,
    });
    provenanceNodeIds.push(oid, from.id, to.id);
    provenanceEdgeIds.push(...edgeIds);
    return true;
  }

  return false;
}

export function planFilters(input: {
  client: Stage3cGraphClient;
  filterSpecs: FilterResolution[];
  filterOrder: string[];
  projections: QueryColumnRef[];
  sources: QuerySource[];
  /** Optional Stage 3D approved temporal bindings keyed by filter role. */
  semanticTemporals?: Map<string, SemanticTemporalBinding> | null;
}): { filters: QueryFilter[]; filtersWithoutColumnEvidence: number } {
  const filters: QueryFilter[] = [];
  let filtersWithoutColumnEvidence = 0;

  for (const role of input.filterOrder) {
    const semantic = input.semanticTemporals?.get(role);
    if (semantic && semantic.status === 'approved') {
      const resolved = resolveTemporalRule(semantic);
      if (resolved.type === 'half_open_date_interval') {
        if (!resolved.columnOracleNodeId) filtersWithoutColumnEvidence += 1;
        filters.push({
          filterRole: resolved.role,
          type: 'half_open_date_interval',
          status: resolved.status === 'resolved' ? 'resolved' : 'incomplete',
          columnOracleNodeId: resolved.columnOracleNodeId,
          columnBusinessRole: resolved.columnBusinessRole ?? undefined,
          lowerBoundary: resolved.lowerBoundary,
          upperBoundary: resolved.upperBoundary,
          provenanceNodeIds: resolved.provenanceNodeIds,
          provenanceEdgeIds: [],
        });
        continue;
      }
      filters.push({
        filterRole: resolved.role,
        type: 'effective_on_date',
        status: resolved.status === 'resolved' ? 'resolved' : 'incomplete',
        clock: 'oracle_sysdate',
        resolvedPredicates: resolved.resolvedPredicates,
        sourceRole: resolved.sourceRole,
        missingReason: resolved.missingReason ?? null,
        provenanceNodeIds: resolved.provenanceNodeIds,
        provenanceEdgeIds: [],
      });
      if (resolved.status !== 'resolved') filtersWithoutColumnEvidence += 1;
      continue;
    }

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
    let sourceRoleOut: string | null = null;

    if (spec.sourceRole) {
      sourceRoleOut = spec.sourceRole;
      const source = input.sources.find((s) => s.sourceRole === spec.sourceRole);
      const searchObjects =
        source?.status === 'resolved'
          ? [source.logicalObject?.nodeId, source.accessObject?.nodeId].filter(
              (x): x is string => !!x,
            )
          : [];
      for (const oid of [...new Set(searchObjects)].sort()) {
        if (
          pushEffectiveDatePredicatesFromObject(
            input.client,
            oid,
            predicates,
            provenanceNodeIds,
            provenanceEdgeIds,
            { preferPositionRoles: spec.sourceRole === 'current_position' },
          )
        ) {
          break;
        }
      }
      if (!predicates.length) {
        missingReason = `missing_confirmed_effective_dating_on_source_${spec.sourceRole}`;
        filtersWithoutColumnEvidence += 1;
      }
    } else {
      // effective_on_date — require confirmed active-employment evidence in graph
      const employmentCandidates = collectOracleObjectCandidates(input.client, [
        ...(spec.searchTerms ?? []),
        'active_employment',
      ]);
      const employee = input.sources.find((s) => s.sourceRole === 'employee');
      sourceRoleOut = employee?.sourceRole ?? null;

      const searchObjects = [
        ...(employee?.status === 'resolved'
          ? [employee.logicalObject?.nodeId, employee.accessObject?.nodeId].filter(
              (x): x is string => !!x,
            )
          : []),
        ...employmentCandidates.map((n) => n.id),
      ];

      for (const oid of [...new Set(searchObjects)].sort()) {
        pushEffectiveDatePredicatesFromObject(
          input.client,
          oid,
          predicates,
          provenanceNodeIds,
          provenanceEdgeIds,
          { preferPositionRoles: false },
        );
        if (predicates.length) break;
      }

      if (!predicates.length) {
        missingReason =
          'missing_confirmed_active_employment_semantics_in_graph; do_not_assume_T_PRAC_presence_means_active';
        filtersWithoutColumnEvidence += 1;
      }
    }

    filters.push({
      filterRole: spec.filterRole,
      type: 'effective_on_date',
      status: predicates.length ? 'resolved' : 'incomplete',
      clock: 'oracle_sysdate',
      resolvedPredicates: predicates,
      sourceRole: sourceRoleOut,
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
