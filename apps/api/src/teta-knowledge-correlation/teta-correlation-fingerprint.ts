import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  CorrelationRunV1,
  CorrelationStageManifestV1,
  GoldenQuestionCoverageV1,
  ProposedKnowledgeRecordV1,
  RelationDecisionV1,
} from './teta-correlation.types';
import { TETA_CORRELATION_RUN_CONTRACT_VERSION } from './teta-correlation.types';

export function fingerprintOccurrenceSet(occurrenceIds: string[]): string {
  return sha256(stableStringify([...occurrenceIds].sort()));
}

export function fingerprintRelationDecisions(decisions: RelationDecisionV1[]): string {
  return sha256(
    stableStringify(
      decisions
        .map((d) => ({
          id: d.relationDecisionId,
          kind: d.relationKind,
          left: d.leftOccurrenceId,
          right: d.rightOccurrenceId,
          basis: d.decisionBasis,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
}

export function fingerprintProposedRecords(records: ProposedKnowledgeRecordV1[]): string {
  return sha256(
    stableStringify(
      records
        .map((r) => ({
          id: r.proposedRecordId,
          logical: r.proposedRecordLogicalId,
          revision: r.proposedRecordRevisionId,
          occ: r.candidateOccurrenceRefs,
          status: r.status,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
}

export function fingerprintQuestionCoverage(coverage: GoldenQuestionCoverageV1[]): string {
  return sha256(
    stableStringify(
      coverage
        .map((c) => ({
          id: c.questionId,
          status: c.coverageStatus,
          occ: c.matchedCandidateOccurrenceIds,
          records: c.matchedProposedRecordIds,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
}

export function buildCorrelationRun(input: {
  inputCandidateManifestSha256: string;
  policyVersion: string;
  occurrenceIds: string[];
  decisions: RelationDecisionV1[];
  records: ProposedKnowledgeRecordV1[];
  coverage: GoldenQuestionCoverageV1[];
  hasReview: boolean;
}): CorrelationRunV1 {
  const candidateOccurrenceSetSha256 = fingerprintOccurrenceSet(input.occurrenceIds);
  const relationDecisionSetSha256 = fingerprintRelationDecisions(input.decisions);
  const proposedRecordSetSha256 = fingerprintProposedRecords(input.records);
  const questionCoverageSetSha256 = fingerprintQuestionCoverage(input.coverage);
  const correlationRunId = `run:sha256:${sha256(
    stableStringify({
      input: input.inputCandidateManifestSha256,
      policy: input.policyVersion,
      occ: candidateOccurrenceSetSha256,
      rel: relationDecisionSetSha256,
      rec: proposedRecordSetSha256,
      q: questionCoverageSetSha256,
    }),
  )}`;
  return {
    contractVersion: TETA_CORRELATION_RUN_CONTRACT_VERSION,
    correlationRunId,
    inputCandidateManifestSha256: input.inputCandidateManifestSha256,
    policyVersion: input.policyVersion,
    candidateOccurrenceSetSha256,
    relationDecisionSetSha256,
    proposedRecordSetSha256,
    questionCoverageSetSha256,
    status: input.hasReview ? 'complete_with_review' : 'complete',
  };
}

export function fingerprintStageManifest(manifest: Omit<CorrelationStageManifestV1, 'fingerprintSha256'>): string {
  return sha256(
    stableStringify({
      stageVersion: manifest.stageVersion,
      run: manifest.run,
      relationDecisionIds: manifest.relationDecisions.map((d) => d.relationDecisionId).sort(),
      proposedRecordIds: manifest.proposedRecords.map((r) => r.proposedRecordId).sort(),
      conflictIds: manifest.conflicts.map((c) => c.conflictId).sort(),
      questionIds: manifest.questionCoverage.map((q) => q.questionId).sort(),
    }),
  );
}
