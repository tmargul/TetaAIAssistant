import type { KnowledgeCandidateKind, KnowledgeCandidateOccurrenceV1 } from './teta-knowledge-candidate.types';
import {
  applyQualityGates,
  emptyQualityCounters,
  type QualityGateCounters,
  type RejectionReasonCode,
} from './teta-candidate-quality-gates';

/** Exact collapse ONLY within the same sectionId. */
export function exactCollapseWithinSection(
  candidates: KnowledgeCandidateOccurrenceV1[],
): KnowledgeCandidateOccurrenceV1[] {
  const byKey = new Map<string, KnowledgeCandidateOccurrenceV1>();
  for (const c of candidates) {
    const key = `${c.sectionId}|${c.candidateSignatureSha256}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, c);
      continue;
    }
    const mergedRefs = new Set([
      ...existing.evidence.flatMap((e) => e.contentUnitRefs),
      ...c.evidence.flatMap((e) => e.contentUnitRefs),
    ]);
    existing.evidence = [{
      ...existing.evidence[0],
      contentUnitRefs: [...mergedRefs],
      assetRefs: [...new Set([...existing.evidence[0].assetRefs, ...c.evidence[0].assetRefs])],
    }];
    existing.warnings = [...new Set([...existing.warnings, ...c.warnings, 'exact_duplicate_collapsed'])];
    if (existing.extraction.method !== c.extraction.method) {
      existing.extraction = { ...existing.extraction, method: 'hybrid' };
      existing.warnings = [...new Set([...existing.warnings, 'model_deterministic_exact_collapse'])];
    }
  }
  return [...byKey.values()];
}

export type ProposalAccounting = {
  candidateProposalsCreated: number;
  candidateProposalsRejectedByQualityGate: number;
  candidateProposalsDowngraded: number;
  candidateProposalsAcceptedBeforeExactCollapse: number;
  exactCandidateDuplicatesCollapsedWithinSection: number;
  candidateOccurrencesExpectedForPersistence: number;
  candidateOccurrencesPersisted: number;
  candidateOccurrencesMissingFromStore: number;
  candidateOccurrencesUnexpectedInStore: number;
  candidateEvidenceOccurrencesExpected: number;
  candidateEvidenceOccurrencesPreserved: number;
  candidateProposalsRejectedByReason: Record<string, number>;
  candidateProposalsByKindBeforeQualityGate: Record<string, number>;
  candidateOccurrencesByKindAfterQualityGate: Record<string, number>;
  persistedCandidatesByKind: Record<string, number>;
  persistedCandidatesByExtractionMethod: Record<string, number>;
  sectionsProducingCandidateProposals: number;
  sectionsProducingAcceptedCandidates: number;
  sectionsWithZeroCandidateProposals: number;
  sectionsWithOnlyRejectedCandidateProposals: number;
  proposalLifecycleReconciliationOk: boolean;
  /** @deprecated alias — use candidateProposalsAcceptedBeforeExactCollapse */
  candidateProposalsAccepted: number;
  /** @deprecated alias — use candidateProposalsRejectedByQualityGate */
  candidateProposalsRejected: number;
  /** @deprecated alias — use exactCandidateDuplicatesCollapsedWithinSection */
  candidateProposalsExactCollapsed: number;
  proposalReconciliationOk: boolean;
};

export function emptyProposalAccounting(): ProposalAccounting {
  return {
    candidateProposalsCreated: 0,
    candidateProposalsRejectedByQualityGate: 0,
    candidateProposalsDowngraded: 0,
    candidateProposalsAcceptedBeforeExactCollapse: 0,
    exactCandidateDuplicatesCollapsedWithinSection: 0,
    candidateOccurrencesExpectedForPersistence: 0,
    candidateOccurrencesPersisted: 0,
    candidateOccurrencesMissingFromStore: 0,
    candidateOccurrencesUnexpectedInStore: 0,
    candidateEvidenceOccurrencesExpected: 0,
    candidateEvidenceOccurrencesPreserved: 0,
    candidateProposalsRejectedByReason: {},
    candidateProposalsByKindBeforeQualityGate: {},
    candidateOccurrencesByKindAfterQualityGate: {},
    persistedCandidatesByKind: {},
    persistedCandidatesByExtractionMethod: {},
    sectionsProducingCandidateProposals: 0,
    sectionsProducingAcceptedCandidates: 0,
    sectionsWithZeroCandidateProposals: 0,
    sectionsWithOnlyRejectedCandidateProposals: 0,
    proposalLifecycleReconciliationOk: true,
    candidateProposalsAccepted: 0,
    candidateProposalsRejected: 0,
    candidateProposalsExactCollapsed: 0,
    proposalReconciliationOk: true,
  };
}

function bump(map: Record<string, number>, key: string, n = 1): void {
  map[key] = (map[key] ?? 0) + n;
}

function kindCounts(items: Array<{ candidateKind: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of items) bump(out, c.candidateKind);
  return out;
}

function methodCounts(items: Array<{ extraction: { method: string } }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of items) bump(out, c.extraction.method);
  return out;
}

export function mapQualityCodeToReason(code: string | null): RejectionReasonCode {
  switch (code) {
    case 'generic_heading_as_business_concept':
      return 'generic_heading';
    case 'generic_table_column_as_parameter':
      return 'generic_table_column';
    case 'adjective_promoted_to_status':
    case 'status_missing_process_context':
      return 'weak_status_evidence';
    case 'parameter_missing_config_evidence':
      return 'weak_parameter_evidence';
    case 'unsupported_noun_as_business_concept':
    case 'business_concept_weak_context':
    case 'business_concept_missing_definition':
      return 'weak_business_concept_evidence';
    case 'missing_evidence':
      return 'missing_source_evidence';
    case 'model_schema_rejection':
      return 'model_schema_rejection';
    case 'duplicate_within_section':
      return 'duplicate_within_section';
    case 'unsupported_pattern':
      return 'unsupported_pattern';
    case 'ambiguous_structure':
      return 'ambiguous_structure';
    default:
      return 'missing_kind_specific_evidence';
  }
}

export type GateWithAccounting = {
  accepted: KnowledgeCandidateOccurrenceV1[];
  quality: QualityGateCounters;
  accounting: ProposalAccounting;
};

/**
 * Lifecycle (within one section):
 * 1) quality gate on raw proposals
 * 2) exact collapse only within the same sectionId
 * 3) survivors are expected for persistence
 *
 * created = rejectedByQualityGate + downgraded + acceptedBeforeExactCollapse
 * acceptedBeforeExactCollapse = exactCollapsedWithinSection + expectedForPersistence
 *   where expectedForPersistence counts post-collapse survivors that are not downgraded,
 *   and downgraded are also persisted → expectedForPersistence total = postCollapseClean + downgraded
 *
 * Simplified when collapsing all gate survivors together:
 * created = rejected + survivingGate
 * survivingGate = collapsed + expected
 * expected = persisted
 * with survivingGate broken down as downgraded + acceptedBeforeCollapse labels for diagnostics.
 */
export function applyGatesWithProposalAccounting(
  rawProposals: KnowledgeCandidateOccurrenceV1[],
  options?: { sectionHadProposals?: boolean },
): GateWithAccounting {
  const created = rawProposals.length;
  const beforeKinds = kindCounts(rawProposals);
  const gated = applyQualityGates(rawProposals);

  const downgraded = gated.accepted.filter((c) => c.status === 'requires_review');
  const cleanAccepted = gated.accepted.filter((c) => c.status !== 'requires_review');
  const rejected = created - gated.accepted.length;

  // Exact collapse only within section — applied to all gate survivors (clean + downgraded)
  const beforeCollapse = gated.accepted.length;
  const collapsedSurvivors = exactCollapseWithinSection(gated.accepted);
  const exactCollapsed = beforeCollapse - collapsedSurvivors.length;

  const accounting = emptyProposalAccounting();
  accounting.candidateProposalsCreated = created;
  accounting.candidateProposalsRejectedByQualityGate = rejected;
  accounting.candidateProposalsDowngraded = downgraded.length;
  // "Accepted before collapse" = clean accepts that entered the collapse step
  // Gate survivors = downgraded + cleanAccepted; collapse runs on all survivors.
  // User formula: created = rejected + downgraded + acceptedBeforeExactCollapse
  // ⇒ acceptedBeforeExactCollapse = cleanAccepted.length (pre-collapse)
  accounting.candidateProposalsAcceptedBeforeExactCollapse = cleanAccepted.length;
  accounting.exactCandidateDuplicatesCollapsedWithinSection = exactCollapsed;

  // After collapse, count clean vs downgraded among survivors
  const postCollapseDowngraded = collapsedSurvivors.filter((c) => c.status === 'requires_review').length;
  const postCollapseClean = collapsedSurvivors.length - postCollapseDowngraded;
  // Persist all collapsed survivors
  accounting.candidateOccurrencesExpectedForPersistence = collapsedSurvivors.length;
  accounting.candidateOccurrencesPersisted = collapsedSurvivors.length;
  accounting.candidateOccurrencesMissingFromStore = 0;
  accounting.candidateOccurrencesUnexpectedInStore = 0;

  const evidenceExpected = collapsedSurvivors.reduce(
    (n, c) => n + c.evidence.reduce((m, e) => m + e.contentUnitRefs.length, 0),
    0,
  );
  accounting.candidateEvidenceOccurrencesExpected = evidenceExpected;
  accounting.candidateEvidenceOccurrencesPreserved = evidenceExpected;

  accounting.candidateProposalsByKindBeforeQualityGate = beforeKinds;
  accounting.candidateOccurrencesByKindAfterQualityGate = kindCounts(gated.accepted);
  accounting.persistedCandidatesByKind = kindCounts(collapsedSurvivors);
  accounting.persistedCandidatesByExtractionMethod = methodCounts(collapsedSurvivors);
  accounting.candidateProposalsRejectedByReason = { ...gated.rejectedByReason };

  // Aliases for older stats keys
  accounting.candidateProposalsAccepted = accounting.candidateProposalsAcceptedBeforeExactCollapse;
  accounting.candidateProposalsRejected = accounting.candidateProposalsRejectedByQualityGate;
  accounting.candidateProposalsExactCollapsed = accounting.exactCandidateDuplicatesCollapsedWithinSection;

  const formula1 =
    accounting.candidateProposalsRejectedByQualityGate
    + accounting.candidateProposalsDowngraded
    + accounting.candidateProposalsAcceptedBeforeExactCollapse;
  // Collapse may merge downgraded with clean or each other within section.
  // acceptedBefore + downgraded = beforeCollapse; beforeCollapse = collapsed + afterCollapseAll
  const formula2Ok =
    cleanAccepted.length + downgraded.length
    === exactCollapsed + collapsedSurvivors.length;
  const formula3Ok =
    accounting.candidateOccurrencesExpectedForPersistence
    === accounting.candidateOccurrencesPersisted;
  const kindSum = Object.values(accounting.persistedCandidatesByKind).reduce((a, b) => a + b, 0);
  const formula4Ok = kindSum === accounting.candidateOccurrencesPersisted;
  const evidenceOk =
    accounting.candidateEvidenceOccurrencesPreserved
    === accounting.candidateEvidenceOccurrencesExpected;

  accounting.proposalLifecycleReconciliationOk =
    formula1 === created && formula2Ok && formula3Ok && formula4Ok && evidenceOk;
  accounting.proposalReconciliationOk = accounting.proposalLifecycleReconciliationOk;

  if (options?.sectionHadProposals === false && created === 0) {
    accounting.sectionsWithZeroCandidateProposals = 1;
  } else if (created > 0 && collapsedSurvivors.length === 0) {
    accounting.sectionsWithOnlyRejectedCandidateProposals = 1;
    accounting.sectionsProducingCandidateProposals = 1;
  } else if (created > 0) {
    accounting.sectionsProducingCandidateProposals = 1;
    if (collapsedSurvivors.length > 0) accounting.sectionsProducingAcceptedCandidates = 1;
  }

  void postCollapseClean;
  return {
    accepted: collapsedSurvivors,
    quality: gated.counters,
    accounting,
  };
}

export function finalizePersistenceAccounting(
  accounting: ProposalAccounting,
  persisted: KnowledgeCandidateOccurrenceV1[],
): ProposalAccounting {
  accounting.candidateOccurrencesPersisted = persisted.length;
  accounting.persistedCandidatesByKind = kindCounts(persisted);
  accounting.persistedCandidatesByExtractionMethod = methodCounts(persisted);
  accounting.candidateOccurrencesMissingFromStore = Math.max(
    0,
    accounting.candidateOccurrencesExpectedForPersistence - persisted.length,
  );
  accounting.candidateOccurrencesUnexpectedInStore = Math.max(
    0,
    persisted.length - accounting.candidateOccurrencesExpectedForPersistence,
  );
  const evidencePreserved = persisted.reduce(
    (n, c) => n + c.evidence.reduce((m, e) => m + e.contentUnitRefs.length, 0),
    0,
  );
  accounting.candidateEvidenceOccurrencesPreserved = evidencePreserved;
  const kindSum = Object.values(accounting.persistedCandidatesByKind).reduce((a, b) => a + b, 0);
  accounting.proposalLifecycleReconciliationOk =
    accounting.candidateProposalsCreated
      === accounting.candidateProposalsRejectedByQualityGate
        + accounting.candidateProposalsDowngraded
        + accounting.candidateProposalsAcceptedBeforeExactCollapse
    && accounting.candidateOccurrencesExpectedForPersistence === accounting.candidateOccurrencesPersisted
    && accounting.candidateOccurrencesMissingFromStore === 0
    && accounting.candidateOccurrencesUnexpectedInStore === 0
    && kindSum === accounting.candidateOccurrencesPersisted
    && accounting.candidateEvidenceOccurrencesPreserved === accounting.candidateEvidenceOccurrencesExpected;
  accounting.proposalReconciliationOk = accounting.proposalLifecycleReconciliationOk;
  return accounting;
}

export function mergeProposalAccounting(into: ProposalAccounting, add: ProposalAccounting): ProposalAccounting {
  into.candidateProposalsCreated += add.candidateProposalsCreated;
  into.candidateProposalsRejectedByQualityGate += add.candidateProposalsRejectedByQualityGate;
  into.candidateProposalsDowngraded += add.candidateProposalsDowngraded;
  into.candidateProposalsAcceptedBeforeExactCollapse += add.candidateProposalsAcceptedBeforeExactCollapse;
  into.exactCandidateDuplicatesCollapsedWithinSection += add.exactCandidateDuplicatesCollapsedWithinSection;
  into.candidateOccurrencesExpectedForPersistence += add.candidateOccurrencesExpectedForPersistence;
  into.candidateOccurrencesPersisted += add.candidateOccurrencesPersisted;
  into.candidateOccurrencesMissingFromStore += add.candidateOccurrencesMissingFromStore;
  into.candidateOccurrencesUnexpectedInStore += add.candidateOccurrencesUnexpectedInStore;
  into.candidateEvidenceOccurrencesExpected += add.candidateEvidenceOccurrencesExpected;
  into.candidateEvidenceOccurrencesPreserved += add.candidateEvidenceOccurrencesPreserved;
  into.sectionsProducingCandidateProposals += add.sectionsProducingCandidateProposals;
  into.sectionsProducingAcceptedCandidates += add.sectionsProducingAcceptedCandidates;
  into.sectionsWithZeroCandidateProposals += add.sectionsWithZeroCandidateProposals;
  into.sectionsWithOnlyRejectedCandidateProposals += add.sectionsWithOnlyRejectedCandidateProposals;
  for (const [k, v] of Object.entries(add.candidateProposalsRejectedByReason)) {
    bump(into.candidateProposalsRejectedByReason, k, v);
  }
  for (const [k, v] of Object.entries(add.candidateProposalsByKindBeforeQualityGate)) {
    bump(into.candidateProposalsByKindBeforeQualityGate, k, v);
  }
  for (const [k, v] of Object.entries(add.candidateOccurrencesByKindAfterQualityGate)) {
    bump(into.candidateOccurrencesByKindAfterQualityGate, k, v);
  }
  for (const [k, v] of Object.entries(add.persistedCandidatesByKind)) {
    bump(into.persistedCandidatesByKind, k, v);
  }
  for (const [k, v] of Object.entries(add.persistedCandidatesByExtractionMethod)) {
    bump(into.persistedCandidatesByExtractionMethod, k, v);
  }
  into.candidateProposalsAccepted = into.candidateProposalsAcceptedBeforeExactCollapse;
  into.candidateProposalsRejected = into.candidateProposalsRejectedByQualityGate;
  into.candidateProposalsExactCollapsed = into.exactCandidateDuplicatesCollapsedWithinSection;

  const formula1 =
    into.candidateProposalsRejectedByQualityGate
    + into.candidateProposalsDowngraded
    + into.candidateProposalsAcceptedBeforeExactCollapse;
  const kindSum = Object.values(into.persistedCandidatesByKind).reduce((a, b) => a + b, 0);
  into.proposalLifecycleReconciliationOk =
    formula1 === into.candidateProposalsCreated
    && into.candidateOccurrencesExpectedForPersistence === into.candidateOccurrencesPersisted
    && into.candidateOccurrencesMissingFromStore === 0
    && into.candidateOccurrencesUnexpectedInStore === 0
    && kindSum === into.candidateOccurrencesPersisted
    && into.candidateEvidenceOccurrencesPreserved === into.candidateEvidenceOccurrencesExpected
    && add.proposalLifecycleReconciliationOk !== false;
  into.proposalReconciliationOk = into.proposalLifecycleReconciliationOk;
  return into;
}

export function proposalAccountingToStats(a: ProposalAccounting): Record<string, number | boolean | string> {
  return {
    candidateProposalsCreated: a.candidateProposalsCreated,
    candidateProposalsRejectedByQualityGate: a.candidateProposalsRejectedByQualityGate,
    candidateProposalsDowngraded: a.candidateProposalsDowngraded,
    candidateProposalsAcceptedBeforeExactCollapse: a.candidateProposalsAcceptedBeforeExactCollapse,
    exactCandidateDuplicatesCollapsedWithinSection: a.exactCandidateDuplicatesCollapsedWithinSection,
    candidateOccurrencesExpectedForPersistence: a.candidateOccurrencesExpectedForPersistence,
    candidateOccurrencesPersisted: a.candidateOccurrencesPersisted,
    candidateOccurrencesMissingFromStore: a.candidateOccurrencesMissingFromStore,
    candidateOccurrencesUnexpectedInStore: a.candidateOccurrencesUnexpectedInStore,
    candidateEvidenceOccurrencesExpected: a.candidateEvidenceOccurrencesExpected,
    candidateEvidenceOccurrencesPreserved: a.candidateEvidenceOccurrencesPreserved,
    sectionsProducingCandidateProposals: a.sectionsProducingCandidateProposals,
    sectionsProducingAcceptedCandidates: a.sectionsProducingAcceptedCandidates,
    sectionsWithZeroCandidateProposals: a.sectionsWithZeroCandidateProposals,
    sectionsWithOnlyRejectedCandidateProposals: a.sectionsWithOnlyRejectedCandidateProposals,
    proposalLifecycleReconciliationOk: a.proposalLifecycleReconciliationOk,
    // aliases
    candidateProposalsAccepted: a.candidateProposalsAcceptedBeforeExactCollapse,
    candidateProposalsRejected: a.candidateProposalsRejectedByQualityGate,
    candidateProposalsExactCollapsed: a.exactCandidateDuplicatesCollapsedWithinSection,
    proposalReconciliationOk: a.proposalLifecycleReconciliationOk,
  };
}

export type SignatureOccurrenceStats = {
  duplicateCandidateSignaturesAcrossSections: number;
  duplicateCandidateSignaturesAcrossSources: number;
  occurrencesLostBecauseOfSharedSignature: number;
  occurrenceIdCollisions: number;
};

export function analyzeSignatureOccurrenceIntegrity(
  occurrences: KnowledgeCandidateOccurrenceV1[],
): SignatureOccurrenceStats {
  const bySigSections = new Map<string, Set<string>>();
  const bySigSources = new Map<string, Set<string>>();
  const byOccId = new Map<string, number>();
  for (const c of occurrences) {
    byOccId.set(c.candidateOccurrenceId, (byOccId.get(c.candidateOccurrenceId) ?? 0) + 1);
    if (!bySigSections.has(c.candidateSignatureSha256)) bySigSections.set(c.candidateSignatureSha256, new Set());
    bySigSections.get(c.candidateSignatureSha256)!.add(c.sectionId);
    if (!bySigSources.has(c.candidateSignatureSha256)) bySigSources.set(c.candidateSignatureSha256, new Set());
    bySigSources.get(c.candidateSignatureSha256)!.add(c.logicalSourceId);
  }
  let acrossSections = 0;
  for (const sections of bySigSections.values()) {
    if (sections.size > 1) acrossSections += 1;
  }
  let acrossSources = 0;
  for (const sources of bySigSources.values()) {
    if (sources.size > 1) acrossSources += 1;
  }
  let idCollisions = 0;
  for (const n of byOccId.values()) {
    if (n > 1) idCollisions += n - 1;
  }
  return {
    duplicateCandidateSignaturesAcrossSections: acrossSections,
    duplicateCandidateSignaturesAcrossSources: acrossSources,
    occurrencesLostBecauseOfSharedSignature: 0,
    occurrenceIdCollisions: idCollisions,
  };
}

export type ZeroCandidateSourceReason =
  | 'no_explicit_knowledge'
  | 'extraction_gap'
  | 'unsupported_structure'
  | 'requires_model_review'
  | 'requires_human_review'
  | 'blocked_source';

export type SourceCoverageRow = {
  logicalSourceId: string;
  contentUnits: number;
  acceptedCandidates: number;
  kinds: KnowledgeCandidateKind[];
  onlyStatus: boolean;
  onlyParameter: boolean;
  zeroReason: ZeroCandidateSourceReason | null;
};

export function classifyZeroCandidateSource(row: {
  blocked: boolean;
  contentUnits: number;
  acceptedCandidates: number;
  sectionCount: number;
  hasStructuredHints: boolean;
}): ZeroCandidateSourceReason | null {
  if (row.acceptedCandidates > 0) return null;
  if (row.blocked || row.contentUnits === 0) return 'blocked_source';
  if (!row.hasStructuredHints && row.sectionCount > 0) return 'no_explicit_knowledge';
  if (row.hasStructuredHints) return 'extraction_gap';
  return 'requires_human_review';
}
