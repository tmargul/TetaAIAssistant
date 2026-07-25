/**
 * Stage 3D — temporal rule resolver (typed AST, no SQL).
 */
import type { SemanticTemporalBinding } from './teta-business-semantics.types';

export type ResolvedTemporalRule =
  | {
      role: string;
      status: 'resolved' | 'missing' | 'incomplete';
      type: 'half_open_date_interval';
      columnOracleNodeId: string | null;
      columnBusinessRole?: string | null;
      clock: 'oracle_sysdate';
      lowerBoundary: {
        clock: 'oracle_sysdate';
        transform: 'month_start';
        inclusive: true;
      };
      upperBoundary: {
        clock: 'oracle_sysdate';
        transform: 'next_month_start';
        inclusive: false;
      };
      provenanceNodeIds: string[];
      businessReason: string;
    }
  | {
      role: string;
      status: 'resolved' | 'missing' | 'incomplete';
      type: 'effective_on_date';
      clock: 'oracle_sysdate';
      sourceRole: string | null;
      openEndedEndAllowed: boolean;
      startInclusive: boolean;
      endInclusive: boolean;
      resolvedPredicates: Array<{
        kind: string;
        leftOracleColumnNodeId?: string;
        operator?: string;
        right?: {
          clock: 'oracle_sysdate';
          transform: 'identity';
          inclusive: boolean;
        };
      }>;
      provenanceNodeIds: string[];
      businessReason: string;
      missingReason?: string | null;
    };

export function resolveTemporalRule(
  binding: SemanticTemporalBinding | null | undefined,
): ResolvedTemporalRule {
  if (!binding || binding.status !== 'approved') {
    return {
      role: binding?.role ?? 'unknown',
      status: 'missing',
      type: 'effective_on_date',
      clock: 'oracle_sysdate',
      sourceRole: binding?.sourceRole ?? null,
      openEndedEndAllowed: !!binding?.openEndedEndAllowed,
      startInclusive: binding?.startInclusive !== false,
      endInclusive: binding?.endInclusive !== false,
      resolvedPredicates: [],
      provenanceNodeIds: [],
      businessReason: binding?.businessReason ?? '',
      missingReason: 'temporal_binding_not_approved',
    };
  }

  if (binding.type === 'half_open_date_interval') {
    const ok = !!binding.columnOracleNodeId;
    return {
      role: binding.role,
      status: ok ? 'resolved' : 'incomplete',
      type: 'half_open_date_interval',
      columnOracleNodeId: binding.columnOracleNodeId ?? null,
      columnBusinessRole: binding.columnBusinessRole ?? null,
      clock: 'oracle_sysdate',
      lowerBoundary: { clock: 'oracle_sysdate', transform: 'month_start', inclusive: true },
      upperBoundary: {
        clock: 'oracle_sysdate',
        transform: 'next_month_start',
        inclusive: false,
      },
      provenanceNodeIds: binding.columnOracleNodeId ? [binding.columnOracleNodeId] : [],
      businessReason: binding.businessReason,
    };
  }

  const from = binding.validFromColumnNodeId;
  const to = binding.validToColumnNodeId;
  const startInclusive = binding.startInclusive !== false;
  const endInclusive = binding.endInclusive !== false;
  const openEnded = binding.openEndedEndAllowed !== false;

  if (!from || !to) {
    return {
      role: binding.role,
      status: 'incomplete',
      type: 'effective_on_date',
      clock: 'oracle_sysdate',
      sourceRole: binding.sourceRole ?? null,
      openEndedEndAllowed: openEnded,
      startInclusive,
      endInclusive,
      resolvedPredicates: [],
      provenanceNodeIds: [],
      businessReason: binding.businessReason,
      missingReason: 'missing_valid_from_or_valid_to_columns',
    };
  }

  return {
    role: binding.role,
    status: 'resolved',
    type: 'effective_on_date',
    clock: 'oracle_sysdate',
    sourceRole: binding.sourceRole ?? null,
    openEndedEndAllowed: openEnded,
    startInclusive,
    endInclusive,
    resolvedPredicates: [
      {
        kind: 'effective_date_range_contains_sysdate',
        leftOracleColumnNodeId: from,
        operator: startInclusive ? 'less_or_equal' : 'less_than',
        right: {
          clock: 'oracle_sysdate',
          transform: 'identity',
          inclusive: startInclusive,
        },
      },
      {
        kind: openEnded
          ? 'effective_date_range_contains_sysdate_or_null_end'
          : 'effective_date_range_contains_sysdate',
        leftOracleColumnNodeId: to,
        operator: openEnded
          ? endInclusive
            ? 'greater_or_null'
            : 'greater_than_or_null'
          : endInclusive
            ? 'greater_or_equal'
            : 'greater_than',
        right: {
          clock: 'oracle_sysdate',
          transform: 'identity',
          inclusive: endInclusive,
        },
      },
    ],
    provenanceNodeIds: [from, to, ...(binding.evidenceNodeIds ?? [])].sort(),
    businessReason: binding.businessReason,
  };
}
