import type { ApprovedKnowledgeRecordV1 } from '../teta-knowledge-approval/teta-approval.types';
import type { KnowledgeCandidateOccurrenceV1 } from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import {
  TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION,
  type ClientAccessPolicy,
  type RuntimeKnowledgeUnitV1,
  type RiskClass,
  type VisibleCitationV1,
} from './teta-runtime-knowledge.types';
import { opaqueToken, sha256, stableStringify } from './teta-runtime-hash';
import {
  clientSourcePolicy,
  publicAuthoritySourcePolicy,
  vendorSourcePolicy,
} from './teta-runtime-source-policy.service';
import { evaluateSourceBackedEligibility } from './teta-source-backed-eligibility';
import { sanitizeAnswerableClaimText } from './teta-claim-text-sanitizer';

function riskForCandidate(c: KnowledgeCandidateOccurrenceV1): RiskClass {
  const text = `${c.candidateKind} ${c.candidateStatement}`.toLowerCase();
  if (/\bksef\b|kodeks pracy|\bustaw[ay]\b|rozporząd|\blegal\b|regulatory/.test(text)) {
    return 'legal_or_regulatory';
  }
  if (/placa|płac|payroll|skladnik|składnik|wynagrod/.test(text)) return 'payroll_sensitive';
  if (/konfigur|parametr|ustawien|settings/.test(text)) return 'configuration_sensitive';
  if (/\badmin\b|secur|\bhaslo\b|\bhasło\b|bezpiecze[nń]stw/.test(text)) return 'security_sensitive';
  return 'normal_product_knowledge';
}

export function buildApprovedCanonicalUnit(
  record: ApprovedKnowledgeRecordV1,
  repoRoot?: string,
): RuntimeKnowledgeUnitV1 {
  const claims = Array.isArray(record.approvedPayload?.supportedClaims)
    ? (record.approvedPayload.supportedClaims as string[])
    : [];
  const answerable =
    record.recordKind === 'registry_product_surface_fact' && /teta me/i.test(record.canonicalSubject.label)
      ? 'Teta ME jest powierzchnią produktu Teta HR, korzystającą ze wspólnej bazy.'
      : claims.length
        ? claims.join('; ')
        : record.canonicalSubject.label;

  const material = {
    approvedRecordRevisionId: record.approvedRecordRevisionId,
    answerable,
  };

  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION,
    runtimeKnowledgeUnitId: opaqueToken('runtime-unit', material),
    runtimeKnowledgeRevisionId: opaqueToken('runtime-revision', {
      ...material,
      status: record.status,
    }),
    knowledgeMode: 'approved_canonical',
    recordKind: record.recordKind,
    subject: {
      canonicalKey: record.canonicalSubject.canonicalKey,
      label: record.canonicalSubject.label,
    },
    claim: {
      normalizedText: answerable,
      answerableText: answerable,
      completeness: 'complete',
    },
    applicability: {
      platformId: record.applicability.platformId,
      productFamilyIds: [...record.applicability.productFamilyIds],
      productSurfaceIds: [...record.applicability.productSurfaceIds],
      domainIds: [...record.applicability.domainIds],
      businessAreaIds: [...record.applicability.businessAreaIds],
      productVersionHints: [...record.applicability.productVersionHints],
      temporalContextIds: [...record.applicability.temporalContextIds],
      clientScope: record.applicability.clientScope,
      currentnessStatus: record.applicability.currentnessStatus,
    },
    riskClass: 'normal_product_knowledge',
    sourcePolicy: vendorSourcePolicy(repoRoot),
    accessPolicy: null,
    internalProvenanceToken: opaqueToken('opaque', {
      approved: record.approvedRecordRevisionId,
      decisions: record.decisionEventRefs,
      evidence: record.evidenceRefs,
    }),
    visibleCitationDescriptor: null,
    answerPolicy: {
      mayAnswer: true,
      mayStateAsUniversal: true,
      mustDisclosePartiality: false,
      mustDiscloseCurrentness: false,
      mustRequestClarification: false,
    },
    warnings: [...(record.warnings ?? [])],
    synthetic: !!record.synthetic,
  };
}

export function buildSourceBackedUnitFromCandidate(
  candidate: KnowledgeCandidateOccurrenceV1,
  opts?: { unresolvedConflict?: boolean; repoRoot?: string },
): { unit: RuntimeKnowledgeUnitV1 | null; eligibility: ReturnType<typeof evaluateSourceBackedEligibility> } {
  const eligibility = evaluateSourceBackedEligibility(candidate, opts);
  if (eligibility.eligibility !== 'eligible_direct' && eligibility.eligibility !== 'eligible_partial') {
    return { unit: null, eligibility };
  }

  const text = eligibility.normalizedAnswerableText ?? candidate.candidateStatement;
  const norm = sanitizeAnswerableClaimText(text, { repoRoot: opts?.repoRoot });
  if (!norm.ok) {
    return {
      unit: null,
      eligibility: { ...eligibility, eligibility: 'blocked_source_policy', reasons: [...eligibility.reasons, norm.reason ?? 'sanitize_failed'] },
    };
  }
  const mode =
    eligibility.eligibility === 'eligible_direct' ? 'source_backed_direct' : 'source_backed_partial';
  const material = {
    candidateOccurrenceId: candidate.candidateOccurrenceId,
    mode,
    text: norm.text,
  };

  const unit: RuntimeKnowledgeUnitV1 = {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION,
    runtimeKnowledgeUnitId: opaqueToken('runtime-unit', material),
    runtimeKnowledgeRevisionId: opaqueToken('runtime-revision', material),
    knowledgeMode: mode,
    recordKind: candidate.candidateKind,
    subject: {
      canonicalKey: sha256(candidate.canonicalSubjectProposal?.label ?? candidate.candidateOccurrenceId).slice(0, 24),
      label: candidate.canonicalSubjectProposal?.label ?? 'candidate',
    },
    claim: {
      normalizedText: norm.text,
      answerableText: norm.text,
      completeness: mode === 'source_backed_partial' ? 'partial' : 'complete',
    },
    applicability: {
      platformId: candidate.applicability?.platformId ?? null,
      productFamilyIds: [...(candidate.applicability?.productFamilyIds ?? [])],
      productSurfaceIds: [...(candidate.applicability?.productSurfaceIds ?? [])],
      domainIds: [...(candidate.applicability?.domainIds ?? [])],
      businessAreaIds: [...(candidate.applicability?.businessAreaIds ?? [])],
      productVersionHints: [...(candidate.applicability?.productVersionHints ?? [])],
      temporalContextIds: [],
      clientScope:
        candidate.applicability?.scopeStatus === 'client_specific_candidate'
          ? 'client_specific'
          : 'global',
      currentnessStatus: 'not_verified',
    },
    riskClass: riskForCandidate(candidate),
    sourcePolicy: vendorSourcePolicy(opts?.repoRoot),
    accessPolicy: null,
    internalProvenanceToken: opaqueToken('opaque', {
      candidate: candidate.candidateOccurrenceId,
      evidence: candidate.evidence,
      sourceRevisionId: candidate.sourceRevisionId,
    }),
    visibleCitationDescriptor: null,
    answerPolicy: {
      mayAnswer: true,
      mayStateAsUniversal: false,
      mustDisclosePartiality: mode === 'source_backed_partial',
      mustDiscloseCurrentness: false,
      mustRequestClarification: false,
    },
    warnings: [...(candidate.warnings ?? [])],
    eligibility: eligibility.eligibility,
    synthetic: false,
  };

  return { unit, eligibility };
}

export function buildClientRuntimeUnit(opts: {
  idSeed: string;
  label: string;
  answerableText: string;
  documentClass: 'normative' | 'analysis';
  accessPolicy: ClientAccessPolicy;
  citation: VisibleCitationV1;
  repoRoot?: string;
}): RuntimeKnowledgeUnitV1 {
  const material = { idSeed: opts.idSeed, text: opts.answerableText };
  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION,
    runtimeKnowledgeUnitId: opaqueToken('runtime-unit', material),
    runtimeKnowledgeRevisionId: opaqueToken('runtime-revision', material),
    knowledgeMode: 'source_backed_direct',
    recordKind: opts.documentClass === 'normative' ? 'client_regulation' : 'client_analysis',
    subject: { canonicalKey: sha256(opts.label).slice(0, 24), label: opts.label },
    claim: {
      normalizedText: opts.answerableText,
      answerableText: opts.answerableText,
      completeness: 'complete',
    },
    applicability: {
      platformId: null,
      productFamilyIds: [],
      productSurfaceIds: [],
      domainIds: [],
      businessAreaIds: [],
      productVersionHints: [],
      temporalContextIds: [],
      clientScope: 'client_specific',
      currentnessStatus: 'verified_for_scope',
    },
    riskClass: 'normal_product_knowledge',
    sourcePolicy: clientSourcePolicy(opts.documentClass, opts.repoRoot),
    accessPolicy: opts.accessPolicy,
    internalProvenanceToken: opaqueToken('opaque', material),
    visibleCitationDescriptor: opts.citation,
    answerPolicy: {
      mayAnswer: true,
      mayStateAsUniversal: false,
      mustDisclosePartiality: false,
      mustDiscloseCurrentness: false,
      mustRequestClarification: false,
    },
    warnings: [],
    synthetic: true,
  };
}

export function buildPublicRuntimeUnit(opts: {
  idSeed: string;
  label: string;
  answerableText: string;
  citation: VisibleCitationV1;
  currentnessStatus: RuntimeKnowledgeUnitV1['applicability']['currentnessStatus'];
  repoRoot?: string;
}): RuntimeKnowledgeUnitV1 {
  const material = { idSeed: opts.idSeed, text: opts.answerableText };
  const stale = opts.currentnessStatus !== 'verified_for_scope';
  return {
    contractVersion: TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION,
    runtimeKnowledgeUnitId: opaqueToken('runtime-unit', material),
    runtimeKnowledgeRevisionId: opaqueToken('runtime-revision', material),
    knowledgeMode: 'source_backed_direct',
    recordKind: 'public_authority_rule',
    subject: { canonicalKey: sha256(opts.label).slice(0, 24), label: opts.label },
    claim: {
      normalizedText: opts.answerableText,
      answerableText: opts.answerableText,
      completeness: 'complete',
    },
    applicability: {
      platformId: null,
      productFamilyIds: [],
      productSurfaceIds: [],
      domainIds: ['labour_law'],
      businessAreaIds: [],
      productVersionHints: [],
      temporalContextIds: [],
      clientScope: 'not_applicable',
      currentnessStatus: opts.currentnessStatus,
    },
    riskClass: 'legal_or_regulatory',
    sourcePolicy: publicAuthoritySourcePolicy(opts.repoRoot),
    accessPolicy: null,
    internalProvenanceToken: opaqueToken('opaque', material),
    visibleCitationDescriptor: opts.citation,
    answerPolicy: {
      mayAnswer: !stale,
      mayStateAsUniversal: !stale,
      mustDisclosePartiality: false,
      mustDiscloseCurrentness: stale,
      mustRequestClarification: stale,
    },
    warnings: stale ? ['stale_or_unverified_public_authority'] : [],
    synthetic: true,
  };
}

export function unitFingerprint(units: RuntimeKnowledgeUnitV1[]): string {
  return sha256(
    stableStringify(
      units.map((u) => ({
        id: u.runtimeKnowledgeUnitId,
        rev: u.runtimeKnowledgeRevisionId,
        mode: u.knowledgeMode,
        text: u.claim.answerableText,
      })),
    ),
  );
}
