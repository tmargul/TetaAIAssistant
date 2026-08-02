import fs from 'fs';
import path from 'path';
import type { CandidateGapResolutionRun } from './teta-gap-pipeline';
import type {
  HumanDomainEvidenceRequest,
  TetaApplicationContextAnchor,
  TetaSemanticEvidenceGap,
  TetaSemanticGapResolutionResult,
} from './teta-gap.types';
import { P1_CANDIDATE_ID, P2_CANDIDATE_ID } from './teta-stage3k2b2a-fixtures';

export interface ReviewPackV3 {
  packVersion: 'v3';
  packId: string;
  candidateId: string;
  applicationContextAnchors: TetaApplicationContextAnchor[];
  gapsBeforeCollection: TetaSemanticEvidenceGap[];
  collectionPlans: CandidateGapResolutionRun['collectionPlan'][];
  collectorsExecuted: string[];
  evidenceObservations: CandidateGapResolutionRun['observations'];
  featureFamilyEvidence: string[];
  independentObservationGroups: string[];
  scopeAssessment: CandidateGapResolutionRun['scopeAssessment'];
  grainAssessment: CandidateGapResolutionRun['grainAssessment'];
  employeeRootAssessment?: CandidateGapResolutionRun['employeeRootAssessment'];
  identityFacetAssessment?: CandidateGapResolutionRun['identityFacetAssessment'];
  gapsAfterCollection: TetaSemanticGapResolutionResult[];
  humanQuestionsGenerated: HumanDomainEvidenceRequest[];
  candidateReevaluationStatus: CandidateGapResolutionRun['reevaluationRequest'];
  approvalForbidden: true;
  policyHash: string;
}

export function buildReviewPackV3(input: {
  candidateId: string;
  run: CandidateGapResolutionRun;
  anchors: TetaApplicationContextAnchor[];
  policyHash: string;
}): ReviewPackV3 {
  return {
    packVersion: 'v3',
    packId: `pack-v3:${input.candidateId}`,
    candidateId: input.candidateId,
    applicationContextAnchors: input.anchors,
    gapsBeforeCollection: input.run.gapsBefore,
    collectionPlans: [input.run.collectionPlan],
    collectorsExecuted: input.run.collectorsExecuted,
    evidenceObservations: input.run.observations,
    featureFamilyEvidence: input.run.featureFamilyKeys,
    independentObservationGroups: input.run.independentObservationGroups,
    scopeAssessment: input.run.scopeAssessment,
    grainAssessment: input.run.grainAssessment,
    employeeRootAssessment: input.run.employeeRootAssessment,
    identityFacetAssessment: input.run.identityFacetAssessment,
    gapsAfterCollection: input.run.gapsAfter,
    humanQuestionsGenerated: input.run.humanQuestionsGenerated,
    candidateReevaluationStatus: input.run.reevaluationRequest,
    approvalForbidden: true,
    policyHash: input.policyHash,
  };
}

export function writeReviewPacksV3(
  repoRoot: string,
  input: {
    applicationContextAnchors: TetaApplicationContextAnchor[];
    p1: CandidateGapResolutionRun;
    p2: CandidateGapResolutionRun;
    policyHash: string;
  },
): { paths: string[]; packs: ReviewPackV3[] } {
  const dir = path.join(repoRoot, '.local', 'stage3k2b2a', 'review-packs-v3');
  fs.mkdirSync(dir, { recursive: true });
  // Ensure we never touch v2
  const v2dir = path.join(repoRoot, '.local', 'stage3k2b1', 'review-packs-v2');
  void v2dir;

  const packs = [
    buildReviewPackV3({
      candidateId: P1_CANDIDATE_ID,
      run: input.p1,
      anchors: input.applicationContextAnchors,
      policyHash: input.policyHash,
    }),
    buildReviewPackV3({
      candidateId: P2_CANDIDATE_ID,
      run: input.p2,
      anchors: input.applicationContextAnchors,
      policyHash: input.policyHash,
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
