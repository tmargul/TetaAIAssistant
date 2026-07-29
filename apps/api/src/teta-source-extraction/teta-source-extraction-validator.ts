import { containsAbsolutePath } from './teta-canonical-source-contract';
import type { CanonicalSourceRecordV1, ExtractionManifestV1 } from './teta-canonical-source.types';

export function validateExtractionManifest(manifest: ExtractionManifestV1): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (manifest.contractVersion !== 'teta-canonical-source-v1') errors.push('invalid_contract_version');
  if (manifest.policies.clientAssetsSelected !== 0) errors.push('clientAssetsSelected_must_be_zero');
  const blob = JSON.stringify(manifest);
  if (containsAbsolutePath(blob)) errors.push('absolute_paths_in_manifest');
  for (const source of manifest.sources) {
    if (source.scopeClassificationStatus !== 'requires_review') errors.push('scope_auto_approved');
    for (const unit of source.contentUnits) {
      if (unit.classificationStatus !== 'unclassified') errors.push('content_unit_auto_classified');
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function countStageBoundaries(): Record<string, 0> {
  return {
    conceptsExtracted: 0,
    businessProcessesExtracted: 0,
    businessRulesExtracted: 0,
    claimsApproved: 0,
    semanticChunksGenerated: 0,
    semanticDuplicateDecisions: 0,
    conflictsResolved: 0,
    lexiconEntriesApproved: 0,
    ragChunksGenerated: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    llmCalls: 0,
    ocrCalls: 0,
    imageAnalysisCalls: 0,
    oracleConnectionsOpened: 0,
    oracleStatementsExecuted: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
  };
}

export function validateSourceRecord(source: CanonicalSourceRecordV1): string[] {
  const errors: string[] = [];
  if (source.sourcePolicy.rawSourceRetention !== 'vendor_only') errors.push('raw_source_not_vendor_only');
  if (source.provenance.extractorVersion !== 'stage3j2b-v1') errors.push('invalid_extractor_version');
  return errors;
}
