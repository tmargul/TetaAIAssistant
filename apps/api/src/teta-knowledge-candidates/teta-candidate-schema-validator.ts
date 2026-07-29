import type { KnowledgeCandidateKind } from './teta-knowledge-candidate.types';

export const ALLOWED_CANDIDATE_KINDS: KnowledgeCandidateKind[] = [
  'business_concept',
  'alias',
  'business_process',
  'process_step',
  'procedure',
  'action',
  'status',
  'state_transition',
  'validation_rule',
  'calculation_rule',
  'temporal_rule',
  'eligibility_rule',
  'parameter',
  'report',
  'document_type',
  'import_export',
  'integration',
  'scenario',
  'test_case',
  'warning',
  'exception',
  'technical_relation',
];

const KIND_SET = new Set<string>(ALLOWED_CANDIDATE_KINDS);

export type ValidationIssue = { code: string; message: string };

export function validateCandidateRecord(
  record: Record<string, unknown>,
  sectionId: string,
  allowedContentUnitRefs: Set<string>,
  allowedAssetRefs: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!record.candidateKind || !KIND_SET.has(String(record.candidateKind))) {
    issues.push({ code: 'invalid_candidate_kind', message: `Invalid kind: ${record.candidateKind}` });
  }
  if (!record.label || typeof record.label !== 'string') {
    issues.push({ code: 'missing_label', message: 'Missing label' });
  }
  if (!record.candidateStatement || typeof record.candidateStatement !== 'string') {
    issues.push({ code: 'missing_statement', message: 'Missing candidateStatement' });
  }
  const evidence = record.evidence as Array<{ sectionId?: string; contentUnitRefs?: string[]; assetRefs?: string[] }> | undefined;
  if (!evidence?.length) {
    issues.push({ code: 'missing_evidence', message: 'Candidate must have evidence' });
  } else {
    for (const e of evidence) {
      if (e.sectionId && e.sectionId !== sectionId) {
        issues.push({ code: 'unknown_section_ref', message: `Unknown section ${e.sectionId}` });
      }
      for (const ref of e.contentUnitRefs ?? []) {
        if (!allowedContentUnitRefs.has(ref)) {
          issues.push({ code: 'unknown_content_unit_ref', message: `Unknown content unit ${ref}` });
        }
      }
      for (const ref of e.assetRefs ?? []) {
        if (!allowedAssetRefs.has(ref)) {
          issues.push({ code: 'unknown_asset_ref', message: `Unknown asset ${ref}` });
        }
      }
    }
  }
  return issues;
}

export function validateModelOutput(
  output: unknown,
  sectionId: string,
  allowedContentUnitRefs: Set<string>,
  allowedAssetRefs: Set<string>,
): { ok: boolean; issues: ValidationIssue[]; records: Array<Record<string, unknown>> } {
  const issues: ValidationIssue[] = [];
  if (!output || typeof output !== 'object') {
    return { ok: false, issues: [{ code: 'invalid_json', message: 'Output not object' }], records: [] };
  }
  const obj = output as { candidates?: unknown[]; warnings?: unknown[] };
  if (!Array.isArray(obj.candidates)) {
    issues.push({ code: 'missing_candidates_array', message: 'Missing candidates array' });
    return { ok: false, issues, records: [] };
  }
  const records = obj.candidates as Array<Record<string, unknown>>;
  for (const r of records) {
    issues.push(...validateCandidateRecord(r, sectionId, allowedContentUnitRefs, allowedAssetRefs));
  }
  return { ok: issues.length === 0, issues, records };
}

export function countStageBoundaries(): Record<string, number> {
  return {
    approvedConceptsCreated: 0,
    approvedProcessesCreated: 0,
    approvedRulesCreated: 0,
    semanticDuplicateDecisions: 0,
    enrichmentDecisions: 0,
    variantMergeDecisions: 0,
    conflictsResolved: 0,
    lexiconEntriesApproved: 0,
    canonicalKnowledgeRecordsModified: 0,
    ragChunksGenerated: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    remoteModelCalls: 0,
    ocrCalls: 0,
    imageAnalysisCalls: 0,
    oracleConnectionsOpened: 0,
    oracleStatementsExecuted: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    formulasExecuted: 0,
    clientKnowledgePacksBuilt: 0,
    crossSourceSemanticMergeDecisions: 0,
    approvedKnowledgeRecordsCreated: 0,
  };
}
