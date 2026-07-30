import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { KnowledgeCandidateOccurrenceV1 } from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import type { NormalizedCandidate } from './teta-correlation.types';
import { buildApplicabilityPartitionKey } from './teta-applicability-partitioner';

export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[„”"']/g, '')
    .replace(/[.,;:!?\-–—()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePreserveCodes(input: string): string {
  // Preserve digit runs (including leading zeros) while normalizing letters/spacing.
  return input
    .normalize('NFKC')
    .replace(/[„”"']/g, '')
    .replace(/[.,;:!?\-–—()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function tokenizeLabel(label: string): string[] {
  return normalizeText(label)
    .split(' ')
    .filter((t) => t.length > 1)
    .sort();
}

function kindSpecificSemanticKey(c: KnowledgeCandidateOccurrenceV1, subject: string, predicate: string, object: string): string {
  const payload = c.structuredPayload ?? {};
  const bits: unknown[] = [c.candidateKind, subject, predicate, object];
  for (const key of ['code', 'componentCode', 'functionName', 'status', 'parameterName', 'value', 'formLabel', 'fieldLabel']) {
    if (key in payload) bits.push(key, payload[key]);
  }
  return sha256(stableStringify(bits));
}

function semanticPayloadKey(c: KnowledgeCandidateOccurrenceV1, subject: string, predicate: string, object: string): string {
  return sha256(
    stableStringify({
      kind: c.candidateKind,
      subject,
      predicate,
      object,
      payload: c.structuredPayload ?? {},
    }),
  );
}

function flattenHintValues(c: KnowledgeCandidateOccurrenceV1): string[] {
  const h = c.correlationHints;
  return [
    ...h.formLabels,
    ...h.fieldLabels,
    ...h.actionLabels,
    ...h.statusLabels,
    ...h.parameterNames,
    ...h.componentCodes,
    ...h.functionNames,
    ...h.oracleIdentifiers,
    ...h.helpSearchTerms,
  ]
    .map((v) => normalizePreserveCodes(String(v)))
    .filter(Boolean)
    .sort();
}

export function normalizeCandidate(occurrence: KnowledgeCandidateOccurrenceV1): NormalizedCandidate {
  const normalizedSubject = normalizeText(occurrence.canonicalSubjectProposal.normalizedLabel || occurrence.canonicalSubjectProposal.label);
  const normalizedPredicate = normalizeText(occurrence.predicate || '');
  const normalizedObject = normalizeText(occurrence.object || '');
  const partitionKey = buildApplicabilityPartitionKey(occurrence.applicability);
  const folderHint =
    typeof occurrence.structuredPayload?.folderHint === 'string'
      ? normalizeText(String(occurrence.structuredPayload.folderHint))
      : null;

  const blockingKeys = buildBlockingKeys(occurrence, {
    normalizedSubject,
    normalizedPredicate,
    folderHint,
  });

  return {
    occurrence,
    normalizedSubject,
    normalizedPredicate,
    normalizedObject,
    semanticPayloadKey: semanticPayloadKey(occurrence, normalizedSubject, normalizedPredicate, normalizedObject),
    kindSpecificSemanticKey: kindSpecificSemanticKey(occurrence, normalizedSubject, normalizedPredicate, normalizedObject),
    applicabilityPartitionKey: partitionKey,
    blockingKeys,
    correlationHintValues: flattenHintValues(occurrence),
    folderHint,
  };
}

export function buildBlockingKeys(
  occurrence: KnowledgeCandidateOccurrenceV1,
  opts: { normalizedSubject: string; normalizedPredicate: string; folderHint: string | null },
): string[] {
  const keys = new Set<string>();
  keys.add(`kind:${occurrence.candidateKind}`);
  if (opts.normalizedSubject) keys.add(`subject:${opts.normalizedSubject}`);
  if (opts.normalizedPredicate) keys.add(`predicate:${opts.normalizedPredicate}`);
  for (const token of tokenizeLabel(occurrence.canonicalSubjectProposal.label)) {
    keys.add(`token:${token}`);
  }
  for (const id of occurrence.applicability.productFamilyIds) keys.add(`family:${id}`);
  for (const id of occurrence.applicability.productSurfaceIds) keys.add(`surface:${id}`);
  for (const id of occurrence.applicability.domainIds) keys.add(`domain:${id}`);
  for (const id of occurrence.applicability.businessAreaIds) keys.add(`area:${id}`);
  for (const id of occurrence.applicability.productVersionHints) keys.add(`version:${id}`);
  for (const id of occurrence.applicability.documentDateHints) keys.add(`date:${id}`);
  if (occurrence.applicability.scopeStatus === 'client_specific_candidate') keys.add('scope:client');
  const hints = occurrence.correlationHints;
  for (const v of hints.formLabels) keys.add(`hint:form:${normalizePreserveCodes(v)}`);
  for (const v of hints.fieldLabels) keys.add(`hint:field:${normalizePreserveCodes(v)}`);
  for (const v of hints.parameterNames) keys.add(`hint:param:${normalizePreserveCodes(v)}`);
  for (const v of hints.componentCodes) keys.add(`hint:code:${normalizePreserveCodes(v)}`);
  for (const v of hints.functionNames) keys.add(`hint:fn:${normalizePreserveCodes(v)}`);
  for (const v of hints.oracleIdentifiers) keys.add(`hint:ora:${normalizePreserveCodes(v)}`);
  // Folder hint may be recorded but must never be the sole pairing reason downstream.
  if (opts.folderHint) keys.add(`folder:${opts.folderHint}`);
  return [...keys].sort();
}

/** Strip punctuation/whitespace differences for exact-compare of statements. */
export function normalizeForExactCompare(text: string): string {
  return normalizeText(text);
}
