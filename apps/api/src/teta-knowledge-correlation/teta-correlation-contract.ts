import type { RelationKind } from './teta-correlation.types';

export const RELATION_KINDS: RelationKind[] = [
  'exact_duplicate',
  'semantic_duplicate',
  'enrich_existing',
  'product_variant',
  'product_surface_variant',
  'version_variant',
  'temporal_variant',
  'configuration_variant',
  'process_variant',
  'scenario_variant',
  'client_variant',
  'regulatory_variant',
  'conflict',
  'unrelated',
  'requires_review',
];

export const VARIANT_KINDS: RelationKind[] = [
  'product_variant',
  'product_surface_variant',
  'version_variant',
  'temporal_variant',
  'configuration_variant',
  'process_variant',
  'scenario_variant',
  'client_variant',
  'regulatory_variant',
];

export const STAGE_BOUNDARY_ZERO_FIELDS = [
  'approvedConceptsCreated',
  'approvedProcessesCreated',
  'approvedRulesCreated',
  'approvedRecordsCreated',
  'existingApprovedRecordsModified',
  'conflictsAutoResolved',
  'lexiconEntriesApproved',
  'ragChunksGenerated',
  'qdrantCalls',
  'embeddingCalls',
  'localModelCalls',
  'remoteModelCalls',
  'ocrCalls',
  'imageAnalysisCalls',
  'oracleConnectionsOpened',
  'oracleStatementsExecuted',
  'sqlCompiled',
  'sqlExecuted',
  'formulasExecuted',
  'clientKnowledgePacksBuilt',
  'finalChatAnswersGenerated',
] as const;

export function isRelationKind(value: string): value is RelationKind {
  return (RELATION_KINDS as string[]).includes(value);
}

export function emptyStageBoundaryCounters(): Record<(typeof STAGE_BOUNDARY_ZERO_FIELDS)[number], number> {
  return Object.fromEntries(STAGE_BOUNDARY_ZERO_FIELDS.map((k) => [k, 0])) as Record<
    (typeof STAGE_BOUNDARY_ZERO_FIELDS)[number],
    number
  >;
}
