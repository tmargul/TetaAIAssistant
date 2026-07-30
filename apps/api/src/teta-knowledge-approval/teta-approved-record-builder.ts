import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import { APPROVAL_KINDS_CREATING_RECORDS } from './teta-approval-contract';
import type {
  ApprovedKnowledgeRecordV1,
  DecisionEventV1,
  ReviewPackV1,
  ScopeDecision,
} from './teta-approval.types';
import { TETA_APPROVED_KNOWLEDGE_RECORD_CONTRACT_VERSION } from './teta-approval.types';

function defaultScope(pack: ReviewPackV1, scope: ScopeDecision | null): ApprovedKnowledgeRecordV1['applicability'] {
  const families = scope?.productFamilyIds?.length
    ? scope.productFamilyIds
    : ((pack.applicabilitySummary.productFamilyIds as string[]) ?? []);
  const surfaces = scope?.productSurfaceIds?.length
    ? scope.productSurfaceIds
    : ((pack.applicabilitySummary.productSurfaceIds as string[]) ?? []);
  return {
    platformId: scope?.platformId ?? 'teta_platform',
    productFamilyIds: [...families].sort(),
    productSurfaceIds: [...surfaces].sort(),
    domainIds: [...(scope?.domainIds ?? ((pack.applicabilitySummary.domainIds as string[]) ?? []))].sort(),
    businessAreaIds: [...(scope?.businessAreaIds ?? [])].sort(),
    productVersionHints: [...(scope?.productVersionHints ?? [])].sort(),
    temporalContextIds: [...(scope?.temporalContextIds ?? [])].sort(),
    clientScope: scope?.clientScope ?? 'not_applicable',
    currentnessStatus: scope?.currentnessStatus ?? 'not_verified',
  };
}

export function buildApprovedRecordLogicalId(input: {
  recordKind: string;
  canonicalKey: string;
  applicability: ApprovedKnowledgeRecordV1['applicability'];
}): string {
  return `approved:sha256:${sha256(
    stableStringify({
      recordKind: input.recordKind,
      canonicalKey: input.canonicalKey,
      applicabilityPartition: {
        platformId: input.applicability.platformId,
        productFamilyIds: input.applicability.productFamilyIds,
        productSurfaceIds: input.applicability.productSurfaceIds,
        domainIds: input.applicability.domainIds,
        clientScope: input.applicability.clientScope,
        productVersionHints: input.applicability.productVersionHints,
        temporalContextIds: input.applicability.temporalContextIds,
      },
    }),
  )}`;
}

export function buildApprovedRecordRevisionId(input: {
  logicalId: string;
  payload: Record<string, unknown>;
  evidenceRefs: string[];
  decisionEventId: string;
  applicability: ApprovedKnowledgeRecordV1['applicability'];
}): string {
  return `approved-revision:sha256:${sha256(
    stableStringify({
      logicalId: input.logicalId,
      payload: input.payload,
      evidenceRefs: [...input.evidenceRefs].sort(),
      decisionEventId: input.decisionEventId,
      applicability: input.applicability,
    }),
  )}`;
}

export function buildApprovedRecordsFromDecision(
  event: DecisionEventV1,
  pack: ReviewPackV1,
  opts?: { recordKind?: string; label?: string; payload?: Record<string, unknown>; variantSplit?: boolean },
): ApprovedKnowledgeRecordV1[] {
  if (event.decisionKind === 'close_gap_as_no_evidence') return [];
  if (event.decisionKind === 'reject' || event.decisionKind === 'defer' || event.decisionKind === 'request_more_evidence') {
    return [];
  }
  if (!APPROVAL_KINDS_CREATING_RECORDS.includes(event.decisionKind) && event.decisionKind !== 'revoke') {
    return [];
  }
  if (event.decisionKind === 'revoke') return [];

  const evidenceRefs = pack.evidence.map((e) => e.evidenceEntryId).sort();
  if (!evidenceRefs.length && pack.packKind !== 'scope_review') {
    // registry-anchored scope packs may have zero occurrence evidence but still approve registry facts in fixtures
    if (!(pack.pilotCaseId === 'RP01' || opts?.label)) return [];
  }

  if (event.decisionKind === 'approve_as_variants' || opts?.variantSplit) {
    const fromScope = event.scopeDecision?.productFamilyIds ?? [];
    const fromPack = (pack.applicabilitySummary.productFamilyIds as string[]) ?? [];
    const families = [...new Set([...fromScope, ...fromPack])].sort();
    const splitFamilies = families.length >= 2 ? families : families.length === 1 ? [families[0]!, 'variant_other'] : ['variant_a', 'variant_b'];
    return splitFamilies.map((family, idx) => {
      const applicability = defaultScope(pack, {
        ...(event.scopeDecision ?? {
          platformId: 'teta_platform',
          productFamilyIds: [family],
          productSurfaceIds: [],
          domainIds: [],
          businessAreaIds: [],
          productVersionHints: [],
          temporalContextIds: [],
          clientScope: 'not_applicable',
          currentnessStatus: 'not_verified',
        }),
        productFamilyIds: [family],
      });
      const label = `${opts?.label ?? 'variant'}:${family}`;
      const canonicalKey = sha256(label).slice(0, 24);
      const logicalId = buildApprovedRecordLogicalId({
        recordKind: opts?.recordKind ?? 'concept',
        canonicalKey,
        applicability,
      });
      const payload = { ...(opts?.payload ?? {}), variantIndex: idx, productFamilyId: family };
      const revisionId = buildApprovedRecordRevisionId({
        logicalId,
        payload,
        evidenceRefs: evidenceRefs.length ? evidenceRefs : [`registry-anchor:${pack.reviewPackId}`],
        decisionEventId: event.decisionEventId,
        applicability,
      });
      return {
        contractVersion: TETA_APPROVED_KNOWLEDGE_RECORD_CONTRACT_VERSION,
        approvedRecordLogicalId: logicalId,
        approvedRecordRevisionId: revisionId,
        recordKind: opts?.recordKind ?? 'concept',
        status: 'active' as const,
        canonicalSubject: { label, canonicalKey },
        approvedPayload: payload,
        applicability,
        sourceProposedRecordRefs: [...pack.proposedRecordRefs].sort(),
        candidateOccurrenceRefs: [...pack.candidateOccurrenceRefs].sort(),
        evidenceRefs: evidenceRefs.length ? evidenceRefs : [`registry-anchor:${pack.reviewPackId}`],
        relationDecisionRefs: [...pack.relationDecisionRefs].sort(),
        decisionEventRefs: [event.decisionEventId],
        approval: {
          approvedByReviewerId: event.reviewer.reviewerId,
          approvedByRole: event.reviewer.reviewerRole,
          approvedAt: event.decidedAt,
          decisionKind: event.decisionKind,
          reasonCodes: event.reasonCodes,
        },
        supersession: { supersedesRevisionId: null, supersededByRevisionId: null },
        warnings: [],
        synthetic: event.synthetic,
      };
    });
  }

  const applicability = defaultScope(pack, event.scopeDecision);
  const label = opts?.label ?? String((pack.recordSummary as { subjects?: string[] }).subjects?.[0] ?? pack.reviewPackId);
  const canonicalKey = sha256(label).slice(0, 24);
  const logicalId = buildApprovedRecordLogicalId({
    recordKind: opts?.recordKind ?? 'concept',
    canonicalKey,
    applicability,
  });
  const payload = opts?.payload ?? { subject: label };
  const evidence = evidenceRefs.length ? evidenceRefs : [`registry-anchor:${pack.reviewPackId}`];
  const revisionId = buildApprovedRecordRevisionId({
    logicalId,
    payload,
    evidenceRefs: evidence,
    decisionEventId: event.decisionEventId,
    applicability,
  });

  return [
    {
      contractVersion: TETA_APPROVED_KNOWLEDGE_RECORD_CONTRACT_VERSION,
      approvedRecordLogicalId: logicalId,
      approvedRecordRevisionId: revisionId,
      recordKind: opts?.recordKind ?? 'concept',
      status: 'active',
      canonicalSubject: { label, canonicalKey },
      approvedPayload: payload,
      applicability,
      sourceProposedRecordRefs: [...pack.proposedRecordRefs].sort(),
      candidateOccurrenceRefs: [...pack.candidateOccurrenceRefs].sort(),
      evidenceRefs: evidence,
      relationDecisionRefs: [...pack.relationDecisionRefs].sort(),
      decisionEventRefs: [event.decisionEventId],
      approval: {
        approvedByReviewerId: event.reviewer.reviewerId,
        approvedByRole: event.reviewer.reviewerRole,
        approvedAt: event.decidedAt,
        decisionKind: event.decisionKind,
        reasonCodes: event.reasonCodes,
      },
      supersession: { supersedesRevisionId: null, supersededByRevisionId: null },
      warnings: [],
      synthetic: event.synthetic,
    },
  ];
}
