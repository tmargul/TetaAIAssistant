import fs from 'fs';
import path from 'path';
import type {
  EmployeeCardIdentityModel,
  EmployeeRootEvidenceAssessment,
  EmptyResultFixture,
  IdentityFacetEvidenceAssessment,
  SemanticAmbiguityFixture,
  SemanticApplicabilityEvidence,
  SemanticGrainEvidence,
  TetaApplicationContextAnchor,
  TetaHumanDomainEvidenceObservation,
  TetaSemanticCandidateReevaluationExecuted,
  TetaSemanticCandidateReevaluationRequest,
  TetaSemanticEvidenceCollectionPlan,
  TetaSemanticEvidenceGap,
  TetaSemanticEvidenceObservation,
  TetaSemanticGapResolutionResult,
} from './teta-gap.types';
import { P1_CANDIDATE_ID, P2_CANDIDATE_ID } from './teta-stage3k2b2a-fixtures';
import { REAL_P1_FORM_GUID } from './teta-real-graph';

export const FIXTURE_ANCHOR_IDS = [
  'anchor:fixture:A',
  'anchor:fixture:B',
  'anchor:fixture:C',
  'anchor:fixture:D',
  'anchor:fixture:E',
] as const;

export type PackV5RunSlice = {
  gapsBefore: TetaSemanticEvidenceGap[];
  collectionPlan: TetaSemanticEvidenceCollectionPlan;
  collectorsExecuted: string[];
  observations: TetaSemanticEvidenceObservation[];
  humanDomainObservations: TetaHumanDomainEvidenceObservation[];
  featureFamilyKeys: string[];
  independentObservationGroups: string[];
  employeeRootAssessment?: EmployeeRootEvidenceAssessment;
  scopeAssessment: SemanticApplicabilityEvidence;
  grainAssessment: SemanticGrainEvidence;
  identityFacetAssessment?: IdentityFacetEvidenceAssessment;
  employeeCardIdentityModel?: EmployeeCardIdentityModel;
  gapsAfter: TetaSemanticGapResolutionResult[];
  reevaluationRequest: TetaSemanticCandidateReevaluationRequest;
  candidateReevaluation?: TetaSemanticCandidateReevaluationExecuted;
  realEvidenceCount: number;
  fixtureEvidenceCount: number;
};

export interface ReviewPackV5 {
  packVersion: 'v5';
  packId: string;
  candidateId: string;
  candidateAnchors: string[];
  priorEvidenceAnchors: string[];
  applicationContextAnchors: TetaApplicationContextAnchor[];
  applicationContextReason: string;
  gapsBeforeCollection: TetaSemanticEvidenceGap[];
  collectionPlans: TetaSemanticEvidenceCollectionPlan[];
  collectorsExecuted: string[];
  evidenceObservations: TetaSemanticEvidenceObservation[];
  humanDomainObservations: TetaHumanDomainEvidenceObservation[];
  featureFamilyEvidence: string[];
  independentObservationGroups: string[];
  personRootScan?: EmployeeRootEvidenceAssessment;
  scopeAssessment: SemanticApplicabilityEvidence;
  grainAssessment: SemanticGrainEvidence;
  identityFacetAssessment?: IdentityFacetEvidenceAssessment;
  employeeCardIdentityModel?: EmployeeCardIdentityModel;
  gapsAfterCollection: TetaSemanticGapResolutionResult[];
  candidateReevaluationStatus: TetaSemanticCandidateReevaluationRequest;
  candidateReevaluation: TetaSemanticCandidateReevaluationExecuted;
  ambiguityFixture?: SemanticAmbiguityFixture;
  emptyResultFixtures?: EmptyResultFixture[];
  realEvidenceCount: number;
  fixtureEvidenceCount: number;
  approvalForbidden: true;
  policyHash: string;
  policyVersion: string;
  rulesApplied: string[];
  syntheticApplicationContextFixturesSeparated: true;
}

export function buildRealPackAnchors(candidateId: string): {
  candidateAnchors: string[];
  priorEvidenceAnchors: string[];
  applicationContextAnchors: TetaApplicationContextAnchor[];
  applicationContextReason: string;
} {
  return {
    candidateAnchors: [`candidate:${candidateId}`],
    priorEvidenceAnchors: [
      `stage3d_prior_evidence_ref:form:${REAL_P1_FORM_GUID}`,
    ],
    // Run used candidate + Stage 3D prior evidence anchors — not live user form context.
    applicationContextAnchors: [],
    applicationContextReason: 'candidate_and_prior_evidence_anchored_run',
  };
}

export function countFixtureAnchorsInPack(pack: ReviewPackV5): number {
  return (pack.applicationContextAnchors ?? []).filter((a) =>
    FIXTURE_ANCHOR_IDS.includes(a.anchorId as (typeof FIXTURE_ANCHOR_IDS)[number]),
  ).length;
}

export function countFixtureIdsAnywhereInPack(pack: unknown): number {
  const text = JSON.stringify(pack);
  let n = 0;
  for (const id of FIXTURE_ANCHOR_IDS) {
    if (text.includes(id)) n += 1;
  }
  return n;
}

export function buildReviewPackV5(input: {
  candidateId: string;
  run: PackV5RunSlice;
  policyHash: string;
  policyVersion: string;
  rulesApplied: string[];
  ambiguityFixture?: SemanticAmbiguityFixture;
  emptyResultFixtures?: EmptyResultFixture[];
}): ReviewPackV5 {
  if (!input.run.candidateReevaluation) {
    throw new Error(`pack_v5_missing_candidate_reevaluation:${input.candidateId}`);
  }
  const anchors = buildRealPackAnchors(input.candidateId);
  return {
    packVersion: 'v5',
    packId: `pack-v5:${input.candidateId}`,
    candidateId: input.candidateId,
    ...anchors,
    gapsBeforeCollection: input.run.gapsBefore,
    collectionPlans: [input.run.collectionPlan],
    collectorsExecuted: input.run.collectorsExecuted,
    evidenceObservations: input.run.observations,
    humanDomainObservations: input.run.humanDomainObservations,
    featureFamilyEvidence: input.run.featureFamilyKeys,
    independentObservationGroups: input.run.independentObservationGroups,
    personRootScan: input.run.employeeRootAssessment,
    scopeAssessment: input.run.scopeAssessment,
    grainAssessment: input.run.grainAssessment,
    identityFacetAssessment: input.run.identityFacetAssessment,
    employeeCardIdentityModel: input.run.employeeCardIdentityModel,
    gapsAfterCollection: input.run.gapsAfter,
    candidateReevaluationStatus: input.run.reevaluationRequest,
    candidateReevaluation: input.run.candidateReevaluation,
    ambiguityFixture: input.ambiguityFixture,
    emptyResultFixtures: input.emptyResultFixtures,
    realEvidenceCount: input.run.realEvidenceCount,
    fixtureEvidenceCount: input.run.fixtureEvidenceCount,
    approvalForbidden: true,
    policyHash: input.policyHash,
    policyVersion: input.policyVersion,
    rulesApplied: input.rulesApplied,
    syntheticApplicationContextFixturesSeparated: true,
  };
}

export function writeReviewPacksV5(
  repoRoot: string,
  input: {
    p1: PackV5RunSlice;
    p2: PackV5RunSlice;
    policyHash: string;
    policyVersion: string;
    rulesApplied: string[];
    ambiguityFixture: SemanticAmbiguityFixture;
    emptyResultFixtures: EmptyResultFixture[];
  },
): { paths: string[]; packs: ReviewPackV5[] } {
  const dir = path.join(repoRoot, '.local', 'stage3k2b2a', 'review-packs-v5');
  fs.mkdirSync(dir, { recursive: true });

  const packs = [
    buildReviewPackV5({
      candidateId: P1_CANDIDATE_ID,
      run: input.p1,
      policyHash: input.policyHash,
      policyVersion: input.policyVersion,
      rulesApplied: input.rulesApplied,
      ambiguityFixture: input.ambiguityFixture,
      emptyResultFixtures: input.emptyResultFixtures,
    }),
    buildReviewPackV5({
      candidateId: P2_CANDIDATE_ID,
      run: input.p2,
      policyHash: input.policyHash,
      policyVersion: input.policyVersion,
      rulesApplied: input.rulesApplied,
      ambiguityFixture: input.ambiguityFixture,
      emptyResultFixtures: input.emptyResultFixtures,
    }),
  ];
  const paths = packs.map((p) => {
    const name = p.candidateId.includes('P1') ? 'pack-P1.json' : 'pack-P2.json';
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, JSON.stringify(p, null, 2), 'utf8');
    return fp;
  });
  return { paths, packs };
}
