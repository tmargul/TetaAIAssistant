import fs from 'fs';
import path from 'path';
import type { CandidateGapResolutionRun } from './teta-gap-pipeline';
import type {
  EmptyResultFixture,
  SemanticAmbiguityFixture,
  TetaApplicationContextAnchor,
  TetaHumanDomainEvidenceObservation,
  TetaSemanticEvidenceGap,
  TetaSemanticGapResolutionResult,
} from './teta-gap.types';
import { P1_CANDIDATE_ID, P2_CANDIDATE_ID } from './teta-stage3k2b2a-fixtures';

export interface ReviewPackV4 {
  packVersion: 'v4';
  packId: string;
  candidateId: string;
  applicationContextAnchors: TetaApplicationContextAnchor[];
  gapsBeforeCollection: TetaSemanticEvidenceGap[];
  collectionPlans: CandidateGapResolutionRun['collectionPlan'][];
  collectorsExecuted: string[];
  evidenceObservations: CandidateGapResolutionRun['observations'];
  humanDomainObservations: TetaHumanDomainEvidenceObservation[];
  featureFamilyEvidence: string[];
  independentObservationGroups: string[];
  personRootScan?: CandidateGapResolutionRun['employeeRootAssessment'];
  scopeAssessment: CandidateGapResolutionRun['scopeAssessment'];
  grainAssessment: CandidateGapResolutionRun['grainAssessment'];
  identityFacetAssessment?: CandidateGapResolutionRun['identityFacetAssessment'];
  employeeCardIdentityModel?: CandidateGapResolutionRun['employeeCardIdentityModel'];
  gapsAfterCollection: TetaSemanticGapResolutionResult[];
  candidateReevaluationStatus: CandidateGapResolutionRun['reevaluationRequest'];
  ambiguityFixture?: SemanticAmbiguityFixture;
  emptyResultFixtures?: EmptyResultFixture[];
  realEvidenceCount: number;
  fixtureEvidenceCount: number;
  approvalForbidden: true;
  policyHash: string;
}

export function buildReviewPackV4(input: {
  candidateId: string;
  run: CandidateGapResolutionRun;
  anchors: TetaApplicationContextAnchor[];
  policyHash: string;
  ambiguityFixture?: SemanticAmbiguityFixture;
  emptyResultFixtures?: EmptyResultFixture[];
}): ReviewPackV4 {
  return {
    packVersion: 'v4',
    packId: `pack-v4:${input.candidateId}`,
    candidateId: input.candidateId,
    applicationContextAnchors: input.anchors,
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
    ambiguityFixture: input.ambiguityFixture,
    emptyResultFixtures: input.emptyResultFixtures,
    realEvidenceCount: input.run.realEvidenceCount,
    fixtureEvidenceCount: input.run.fixtureEvidenceCount,
    approvalForbidden: true,
    policyHash: input.policyHash,
  };
}

export function writeReviewPacksV4(
  repoRoot: string,
  input: {
    applicationContextAnchors: TetaApplicationContextAnchor[];
    p1: CandidateGapResolutionRun;
    p2: CandidateGapResolutionRun;
    policyHash: string;
    ambiguityFixture: SemanticAmbiguityFixture;
    emptyResultFixtures: EmptyResultFixture[];
  },
): { paths: string[]; packs: ReviewPackV4[] } {
  const dir = path.join(repoRoot, '.local', 'stage3k2b2a', 'review-packs-v4');
  fs.mkdirSync(dir, { recursive: true });

  const packs = [
    buildReviewPackV4({
      candidateId: P1_CANDIDATE_ID,
      run: input.p1,
      anchors: input.applicationContextAnchors,
      policyHash: input.policyHash,
      ambiguityFixture: input.ambiguityFixture,
      emptyResultFixtures: input.emptyResultFixtures,
    }),
    buildReviewPackV4({
      candidateId: P2_CANDIDATE_ID,
      run: input.p2,
      anchors: input.applicationContextAnchors,
      policyHash: input.policyHash,
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
