import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { CorrelationStageManifestV1, ProposedKnowledgeRecordV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import {
  makeOccurrence,
  buildFixtureManifest,
} from '../teta-knowledge-correlation/teta-stage3j2d-fixtures';
import { runStage3j2dCorrelation } from '../teta-knowledge-correlation/teta-correlation-pipeline.service';
import type {
  DecisionEventV1,
  ReviewPackV1,
  ReviewTaskV1,
  ScopeDecision,
} from './teta-approval.types';
import { TETA_APPROVAL_DECISION_EVENT_CONTRACT_VERSION } from './teta-approval.types';
import { buildReviewQueue } from './teta-review-queue.service';
import { buildReviewPack } from './teta-review-pack-builder';
import { createDecisionEventId } from './teta-approval-ledger';

export type FixtureCaseId =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T';

export type FixturePack = {
  id: FixtureCaseId;
  title: string;
  correlationManifest: CorrelationStageManifestV1;
  reviewTasks: ReviewTaskV1[];
  reviewPack: ReviewPackV1;
  notes: string[];
};

function baseScope(over: Partial<ScopeDecision> = {}): ScopeDecision {
  return {
    platformId: 'teta_platform',
    productFamilyIds: ['teta_hr'],
    productSurfaceIds: [],
    domainIds: ['place'],
    businessAreaIds: [],
    productVersionHints: [],
    temporalContextIds: [],
    clientScope: 'global',
    currentnessStatus: 'verified_for_scope',
    ...over,
  };
}

function proposeFromOccurrences(
  result: ReturnType<typeof runStage3j2dCorrelation>,
  patch?: (r: ProposedKnowledgeRecordV1) => ProposedKnowledgeRecordV1,
): CorrelationStageManifestV1 {
  if (!patch) return result.manifest;
  return {
    ...result.manifest,
    proposedRecords: result.manifest.proposedRecords.map(patch),
  };
}

function packFromManifest(
  manifest: CorrelationStageManifestV1,
  opts: Parameters<typeof buildReviewPack>[2],
): { tasks: ReviewTaskV1[]; pack: ReviewPackV1 } {
  const queue = buildReviewQueue(manifest);
  const task =
    queue.tasks[0] ??
    ({
      contractVersion: 'teta-review-task-v1',
      reviewTaskId: `review:sha256:${sha256('fixture-empty')}`,
      sourceReviewTaskId: 'source:empty',
      reviewKind: 'confirm_equivalence',
      status: 'pending',
      priority: 'normal',
      priorityReasons: ['normal_review'],
      proposedRecordRefs: manifest.proposedRecords.map((r) => r.proposedRecordId),
      candidateOccurrenceRefs: [],
      relationDecisionRefs: [],
      clusterRefs: [],
      questionRefs: [],
      evidenceRefs: [],
      allowedDecisionKinds: ['approve', 'reject', 'defer'],
      createdFromCorrelationRunId: manifest.run.correlationRunId,
      warnings: [],
    } satisfies ReviewTaskV1);

  const pack = buildReviewPack(
    {
      ...task,
      proposedRecordRefs: task.proposedRecordRefs.length
        ? task.proposedRecordRefs
        : manifest.proposedRecords.map((r) => r.proposedRecordId),
      candidateOccurrenceRefs: task.candidateOccurrenceRefs.length
        ? task.candidateOccurrenceRefs
        : manifest.proposedRecords.flatMap((r) => r.candidateOccurrenceRefs),
    },
    manifest,
    {
      includeExcerpts: true,
      syntheticExcerptText: 'Synthetic evidence excerpt for fixture validation only.',
      ...opts,
    },
  );
  return { tasks: queue.tasks.length ? queue.tasks : [task], pack };
}

export function fixturePackA_ExactDuplicate(): FixturePack {
  const left = makeOccurrence({
    id: 'fx-a-1',
    kind: 'business_concept',
    label: 'Składnik okresowy',
    predicate: 'is',
    statement: 'Składnik okresowy istnieje.',
  });
  const right = makeOccurrence({
    id: 'fx-a-2',
    kind: 'business_concept',
    label: 'Składnik okresowy',
    predicate: 'is',
    statement: 'Składnik okresowy istnieje.',
    source: 'fixture:source-b',
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([left, right]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'merge_review',
    allowedDecisionKinds: ['approve_merged_record', 'reject', 'defer'],
  });
  return { id: 'A', title: 'Exact duplicate approval', correlationManifest: corr.manifest, reviewTasks: tasks, reviewPack: pack, notes: ['approve_merged_record'] };
}

export function fixturePackB_SemanticDuplicate(): FixturePack {
  const left = makeOccurrence({
    id: 'fx-b-1',
    kind: 'business_concept',
    label: 'Składnik okresowy wynagrodzenia',
    predicate: 'defines',
    statement: 'Składnik okresowy wynagrodzenia jest pojęciem płacowym.',
    hints: { componentCodes: ['1350'] },
  });
  const right = makeOccurrence({
    id: 'fx-b-2',
    kind: 'business_concept',
    label: 'Okresowy składnik płacy',
    predicate: 'defines',
    statement: 'Okresowy składnik płacy jest pojęciem płacowym.',
    source: 'fixture:source-b',
    hints: { componentCodes: ['1350'] },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([left, right]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'merge_review',
    allowedDecisionKinds: ['approve_merged_record', 'reject', 'defer'],
  });
  return { id: 'B', title: 'Semantic duplicate approval', correlationManifest: corr.manifest, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackC_ScopeApproval(): FixturePack {
  const occ = makeOccurrence({
    id: 'fx-c-1',
    kind: 'validation_rule',
    label: 'Reguła zakresu nieznanego',
    predicate: 'applies',
    statement: 'Reguła z unknown applicability.',
    applicability: { scopeStatus: 'requires_review', productFamilyIds: [] },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([occ]));
  const patched = proposeFromOccurrences(corr, (r) => ({
    ...r,
    applicability: { ...r.applicability, scopeStatus: 'requires_review', productFamilyIds: [] },
  }));
  const { tasks, pack } = packFromManifest(patched, {
    packKind: 'scope_review',
    allowedDecisionKinds: ['approve', 'approve_with_scope', 'reject', 'defer'],
  });
  return { id: 'C', title: 'Scope approval', correlationManifest: patched, reviewTasks: tasks, reviewPack: pack, notes: ['approve_requires_scope'] };
}

export function fixturePackD_HrEduVariants(): FixturePack {
  const hr = makeOccurrence({
    id: 'fx-d-hr',
    kind: 'business_process',
    label: 'Zatrudnienie',
    predicate: 'process',
    statement: 'Proces zatrudnienia w Teta HR.',
    applicability: { productFamilyIds: ['teta_hr'] },
  });
  const edu = makeOccurrence({
    id: 'fx-d-edu',
    kind: 'business_process',
    label: 'Zatrudnienie',
    predicate: 'process',
    statement: 'Proces zatrudnienia w Teta Edu.',
    source: 'fixture:edu',
    applicability: { productFamilyIds: ['teta_edu'] },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([hr, edu]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'variant_review',
    allowedDecisionKinds: ['approve_as_variants', 'request_more_evidence', 'defer', 'reject'],
  });
  return { id: 'D', title: 'HR/Edu variants', correlationManifest: corr.manifest, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackE_TetaMeRegistry(): FixturePack {
  const occ = makeOccurrence({
    id: 'fx-e-1',
    kind: 'business_concept',
    label: 'Teta ME surface',
    predicate: 'is',
    statement: 'Teta ME jest powierzchnią produktu Teta HR.',
    applicability: { productFamilyIds: ['teta_hr'], productSurfaceIds: ['teta_me'] },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([occ]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'scope_review',
    pilotCaseId: 'RP01',
    allowedDecisionKinds: ['approve_with_scope', 'reject', 'defer'],
  });
  return { id: 'E', title: 'Teta ME registry fact', correlationManifest: corr.manifest, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackF_ClientSpecific(): FixturePack {
  const occ = makeOccurrence({
    id: 'fx-f-1',
    kind: 'validation_rule',
    label: 'Reguła klienta',
    predicate: 'applies',
    statement: 'Reguła client-specific.',
    applicability: { scopeStatus: 'client_specific_candidate', clientSpecificRisk: 'high' },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([occ]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'scope_review',
    allowedDecisionKinds: ['approve_with_scope', 'reject', 'defer'],
  });
  return { id: 'F', title: 'Client-specific safety', correlationManifest: corr.manifest, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackG_Historical(): FixturePack {
  const occ = makeOccurrence({
    id: 'fx-g-1',
    kind: 'temporal_rule',
    label: 'Historyczna reguła',
    predicate: 'valid_in',
    statement: 'Historyczna reguła nieaktualna.',
    applicability: { currentnessStatus: 'not_verified', documentDateHints: ['2018'] },
    warnings: ['historical_document'],
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([occ]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'currentness_review',
    allowedDecisionKinds: ['approve_with_scope', 'defer', 'request_more_evidence', 'reject'],
  });
  return {
    id: 'G',
    title: 'Historical/currentness',
    correlationManifest: corr.manifest,
    reviewTasks: tasks,
    reviewPack: pack,
    notes: ['historical'],
  };
}

export function fixturePackH_Regulatory(): FixturePack {
  const occ = makeOccurrence({
    id: 'fx-h-1',
    kind: 'temporal_rule',
    label: 'Reguła KSeF',
    predicate: 'requires',
    statement: 'Reguła regulacyjna wymaga weryfikacji aktualności.',
    applicability: { currentnessStatus: 'not_verified' },
    warnings: ['regulatory_claim'],
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([occ]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'currentness_review',
    allowedDecisionKinds: ['approve_with_scope', 'defer', 'request_more_evidence', 'reject'],
  });
  return {
    id: 'H',
    title: 'Regulatory review',
    correlationManifest: corr.manifest,
    reviewTasks: tasks,
    reviewPack: pack,
    notes: ['regulatory'],
  };
}

export function fixturePackI_Reject(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'I', title: 'Reject', notes: ['reject'] };
}

export function fixturePackJ_Defer(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'J', title: 'Defer', notes: ['defer'] };
}

export function fixturePackK_RequestEvidence(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'K', title: 'Request more evidence', notes: ['request_more_evidence'] };
}

export function fixturePackL_Conflict(): FixturePack {
  const left = makeOccurrence({
    id: 'fx-l-1',
    kind: 'validation_rule',
    label: 'Konflikt wartości',
    predicate: 'equals',
    object: 'A',
    statement: 'Wartość A.',
    payload: { value: 'A' },
  });
  const right = makeOccurrence({
    id: 'fx-l-2',
    kind: 'validation_rule',
    label: 'Konflikt wartości',
    predicate: 'equals',
    object: 'B',
    statement: 'Wartość B.',
    source: 'fixture:source-b',
    payload: { value: 'B' },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([left, right]));
  const patched = proposeFromOccurrences(corr, (r) => ({
    ...r,
    status: 'proposed_with_conflict',
    conflictRefs: r.conflictRefs.length ? r.conflictRefs : ['conflict:fixture'],
  }));
  const { tasks, pack } = packFromManifest(patched, {
    packKind: 'conflict_review',
    allowedDecisionKinds: ['defer', 'request_more_evidence', 'reject', 'approve_as_variants'],
  });
  return { id: 'L', title: 'Conflict', correlationManifest: patched, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackM_StalePack(): FixturePack {
  const base = fixturePackA_ExactDuplicate();
  return { ...base, id: 'M', title: 'Stale pack', notes: ['stale'] };
}

export function fixturePackN_LedgerChain(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'N', title: 'Ledger chain', notes: ['ledger'] };
}

export function fixturePackO_Idempotency(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'O', title: 'Idempotency', notes: ['idempotent'] };
}

export function fixturePackP_Supersede(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'P', title: 'Supersede', notes: ['supersede'] };
}

export function fixturePackQ_Revoke(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'Q', title: 'Revoke', notes: ['revoke'] };
}

export function fixturePackR_Unsupported(): FixturePack {
  const corr = runStage3j2dCorrelation(buildFixtureManifest([]));
  const emptyManifest: CorrelationStageManifestV1 = {
    ...corr.manifest,
    proposedRecords: [],
    questionCoverage: [
      {
        questionId: 'Q99',
        question: 'Unsupported synthetic',
        coverageStatus: 'unsupported',
        matchedProposedRecordIds: [],
        matchedCandidateOccurrenceIds: [],
        variantRefs: [],
        conflictRefs: [],
        requiredKnowledgeKinds: ['rule'],
        knowledgeKindsFound: [],
        knowledgeKindsMissing: ['rule'],
        productFamilyCoverage: [],
        domainCoverage: [],
        sourceArchetypeCoverage: [],
        evidenceCount: 0,
        independentSourceCount: 0,
        supportingEvidenceRefs: [],
        reasonCode: 'no_matching_evidence',
        warnings: [],
      },
    ],
  };
  const { tasks, pack } = packFromManifest(emptyManifest, {
    packKind: 'evidence_gap',
    forceEvidenceGap: true,
    allowedDecisionKinds: ['request_more_evidence', 'defer', 'close_gap_as_no_evidence'],
  });
  return { id: 'R', title: 'Unsupported question', correlationManifest: emptyManifest, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackS_SupportedSubset(): FixturePack {
  const occ = makeOccurrence({
    id: 'fx-s-1',
    kind: 'procedure',
    label: 'Krok zatrudnienia',
    predicate: 'step',
    statement: 'Częściowo wsparty proces.',
    applicability: { productFamilyIds: ['teta_edu'] },
  });
  const corr = runStage3j2dCorrelation(buildFixtureManifest([occ]));
  const { tasks, pack } = packFromManifest(corr.manifest, {
    packKind: 'record_approval',
    allowedDecisionKinds: ['approve_supported_subset', 'request_more_evidence', 'defer', 'reject'],
  });
  return { id: 'S', title: 'Approve supported subset', correlationManifest: corr.manifest, reviewTasks: tasks, reviewPack: pack, notes: [] };
}

export function fixturePackT_MissingConfirmation(): FixturePack {
  return { ...fixturePackA_ExactDuplicate(), id: 'T', title: 'Missing reviewer confirmation', notes: ['no_confirm'] };
}

export function allFixturePacks(): FixturePack[] {
  return [
    fixturePackA_ExactDuplicate(),
    fixturePackB_SemanticDuplicate(),
    fixturePackC_ScopeApproval(),
    fixturePackD_HrEduVariants(),
    fixturePackE_TetaMeRegistry(),
    fixturePackF_ClientSpecific(),
    fixturePackG_Historical(),
    fixturePackH_Regulatory(),
    fixturePackI_Reject(),
    fixturePackJ_Defer(),
    fixturePackK_RequestEvidence(),
    fixturePackL_Conflict(),
    fixturePackM_StalePack(),
    fixturePackN_LedgerChain(),
    fixturePackO_Idempotency(),
    fixturePackP_Supersede(),
    fixturePackQ_Revoke(),
    fixturePackR_Unsupported(),
    fixturePackS_SupportedSubset(),
    fixturePackT_MissingConfirmation(),
  ];
}

export function makeSyntheticDecision(
  pack: ReviewPackV1,
  input: {
    decisionKind: DecisionEventV1['decisionKind'];
    reviewerId?: string;
    reviewerRole?: DecisionEventV1['reviewer']['reviewerRole'];
    rationale?: string;
    scopeDecision?: ScopeDecision | null;
    decidedAt?: string;
    reasonCodes?: string[];
    staleGuard?: ReviewPackV1['staleGuard'];
  },
): Omit<DecisionEventV1, 'ledger'> {
  const body = {
    contractVersion: TETA_APPROVAL_DECISION_EVENT_CONTRACT_VERSION,
    reviewPackId: pack.reviewPackId,
    reviewPackRevisionId: pack.reviewPackRevisionId,
    decisionKind: input.decisionKind,
    reviewer: {
      reviewerId: input.reviewerId ?? 'fixture-reviewer',
      reviewerRole: input.reviewerRole ?? 'knowledge_reviewer',
      decisionSource: 'synthetic_fixture' as const,
    },
    decidedAt: input.decidedAt ?? '2026-07-30T00:00:00.000Z',
    reasonCodes: input.reasonCodes ?? ['fixture'],
    rationale: input.rationale ?? 'Synthetic fixture rationale for Stage 3J.2E.',
    scopeDecision: input.scopeDecision ?? null,
    approvedRecordActions: [],
    variantActions: [],
    rejectedClaims: [],
    missingEvidenceRequests: [],
    staleGuard: input.staleGuard ?? pack.staleGuard,
    synthetic: true,
  };
  return {
    ...body,
    decisionEventId: createDecisionEventId(body),
  };
}

export { baseScope };
