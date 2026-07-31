/**
 * Stage 3K.1 — capability taxonomy for generic readonly logical requests.
 * Recognition ≠ compiler/executor support.
 */

export const STAGE3K1_CAPABILITY_REGISTRY_VERSION = 'teta-aia-generic-query-capabilities-v1';

export type QueryCapabilityId =
  | 'projection'
  | 'filter_equals'
  | 'filter_comparison'
  | 'filter_date_range'
  | 'filter_null'
  | 'filter_like'
  | 'filter_in'
  | 'boolean_and'
  | 'boolean_or'
  | 'current_record'
  | 'history'
  | 'as_of'
  | 'ordering'
  | 'top_n'
  | 'distinct'
  | 'aggregate_count'
  | 'aggregate_sum'
  | 'aggregate_avg'
  | 'aggregate_min'
  | 'aggregate_max'
  | 'group_by'
  | 'having'
  | 'pagination'
  | 'negative_existence';

export type QueryCapabilitySupportStatus =
  | 'supported_now'
  | 'recognized_but_not_supported'
  | 'unknown';

export type QueryCapabilityDefinition = {
  id: QueryCapabilityId;
  status: QueryCapabilitySupportStatus;
  description: string;
};

export const STAGE3K1_CAPABILITY_DEFINITIONS: readonly QueryCapabilityDefinition[] = [
  { id: 'projection', status: 'supported_now', description: 'Request a projected logical field' },
  { id: 'filter_equals', status: 'recognized_but_not_supported', description: 'Equality filter on a concept' },
  { id: 'filter_comparison', status: 'recognized_but_not_supported', description: 'Comparison filter' },
  { id: 'filter_date_range', status: 'recognized_but_not_supported', description: 'Date range filter' },
  { id: 'filter_null', status: 'recognized_but_not_supported', description: 'Null / absence filter' },
  { id: 'filter_like', status: 'recognized_but_not_supported', description: 'Contains / prefix / like filter' },
  { id: 'filter_in', status: 'recognized_but_not_supported', description: 'IN list filter' },
  { id: 'boolean_and', status: 'recognized_but_not_supported', description: 'AND of filters' },
  { id: 'boolean_or', status: 'recognized_but_not_supported', description: 'OR boolean groups' },
  { id: 'current_record', status: 'supported_now', description: 'Current / effective-now temporal intent' },
  { id: 'history', status: 'recognized_but_not_supported', description: 'Full history temporal intent' },
  { id: 'as_of', status: 'recognized_but_not_supported', description: 'As-of date temporal intent' },
  { id: 'ordering', status: 'recognized_but_not_supported', description: 'Ordering intent' },
  { id: 'top_n', status: 'recognized_but_not_supported', description: 'Top-N / limit intent' },
  { id: 'distinct', status: 'recognized_but_not_supported', description: 'Distinct result intent' },
  { id: 'aggregate_count', status: 'recognized_but_not_supported', description: 'COUNT aggregation' },
  { id: 'aggregate_sum', status: 'recognized_but_not_supported', description: 'SUM aggregation' },
  { id: 'aggregate_avg', status: 'recognized_but_not_supported', description: 'AVG aggregation' },
  { id: 'aggregate_min', status: 'recognized_but_not_supported', description: 'MIN aggregation' },
  { id: 'aggregate_max', status: 'recognized_but_not_supported', description: 'MAX aggregation' },
  { id: 'group_by', status: 'recognized_but_not_supported', description: 'GROUP BY intent' },
  { id: 'having', status: 'recognized_but_not_supported', description: 'HAVING intent' },
  { id: 'pagination', status: 'recognized_but_not_supported', description: 'Pagination intent' },
  {
    id: 'negative_existence',
    status: 'recognized_but_not_supported',
    description: 'Absence / without-current-X existence semantics',
  },
] as const;

export function getCapabilityStatus(id: QueryCapabilityId): QueryCapabilitySupportStatus {
  const found = STAGE3K1_CAPABILITY_DEFINITIONS.find((c) => c.id === id);
  return found?.status ?? 'unknown';
}

export function listCapabilityIds(): QueryCapabilityId[] {
  return STAGE3K1_CAPABILITY_DEFINITIONS.map((c) => c.id);
}

/** Canonical business concepts allowed in conceptKey (must reuse existing ontology/lexicon). */
export const CANONICAL_BUSINESS_CONCEPT_KEYS = new Set([
  'employee',
  'position',
  'organizational_unit',
  'active_employment',
  'health_examination',
  'employment_contract',
]);

export const PSEUDO_CONCEPT_KEYS_FORBIDDEN = [
  'department_ambiguous',
  'compensation_ambiguous',
  'location_unresolved',
  'education_form',
] as const;
