import {
  APPLICABILITY_SAFEGUARD_ZERO_FIELDS,
  PRIVACY_ZERO_FIELDS,
  STAGE_BOUNDARY_ZERO_FIELDS,
} from './teta-approval-contract';

function num(stats: Record<string, unknown>, key: string, fallback = 0): number {
  const v = stats[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return fallback;
}

export function collectStrictErrors(stats: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const key of STAGE_BOUNDARY_ZERO_FIELDS) {
    if (num(stats, key) !== 0) errors.push(key);
  }
  for (const key of APPLICABILITY_SAFEGUARD_ZERO_FIELDS) {
    if (num(stats, key) !== 0) errors.push(key);
  }
  for (const key of PRIVACY_ZERO_FIELDS) {
    if (num(stats, key) !== 0) errors.push(key);
  }

  if (num(stats, 'reviewTasksWithoutPriorityReason') !== 0) errors.push('reviewTasksWithoutPriorityReason');
  if (num(stats, 'duplicateReviewTaskIds') !== 0) errors.push('duplicateReviewTaskIds');
  if (stats.reviewTaskOrderDeterministic === false) errors.push('reviewTaskOrderDeterministic');

  if (num(stats, 'reviewPacksMissingStaleGuard') !== 0) errors.push('reviewPacksMissingStaleGuard');
  if (num(stats, 'reviewPacksWithoutAllowedDecision') !== 0) errors.push('reviewPacksWithoutAllowedDecision');
  if (num(stats, 'excerptsHashMismatch') !== 0) errors.push('excerptsHashMismatch');
  if (num(stats, 'excerptsGeneratedByModel') !== 0) errors.push('excerptsGeneratedByModel');
  if (num(stats, 'fullSourceTextsCopiedToReviewPacks') !== 0) errors.push('fullSourceTextsCopiedToReviewPacks');

  if (num(stats, 'templatesIncorrectlyWrittenAsLedgerEvents') !== 0) {
    errors.push('templatesIncorrectlyWrittenAsLedgerEvents');
  }
  if (num(stats, 'templatesWithPrefilledReviewer') !== 0) errors.push('templatesWithPrefilledReviewer');
  if (num(stats, 'templatesWithPrefilledDecision') !== 0) errors.push('templatesWithPrefilledDecision');

  if (num(stats, 'realDecisionEventsApplied') !== 0) errors.push('realDecisionEventsApplied');
  if (num(stats, 'realApprovedRecordsCreated') !== 0) errors.push('realApprovedRecordsCreated');
  if (num(stats, 'autoApprovalDecisions') !== 0) errors.push('autoApprovalDecisions');
  if (num(stats, 'staleReviewPacksApplied') !== 0) errors.push('staleReviewPacksApplied');

  if (stats.ledgerHashChainValid === false) errors.push('ledgerHashChainValid');
  if (stats.ledgerSequenceValid === false) errors.push('ledgerSequenceValid');
  if (num(stats, 'duplicateDecisionEventIds') !== 0) errors.push('duplicateDecisionEventIds');
  if (num(stats, 'decisionEventPayloadHashMismatches') !== 0) errors.push('decisionEventPayloadHashMismatches');
  if (num(stats, 'decisionEventsModified') !== 0) errors.push('decisionEventsModified');
  if (num(stats, 'decisionEventsDeleted') !== 0) errors.push('decisionEventsDeleted');

  if (num(stats, 'approvedRecordsWithoutEvidence') !== 0) errors.push('approvedRecordsWithoutEvidence');
  if (num(stats, 'approvedRecordsWithMissingOccurrence') !== 0) {
    errors.push('approvedRecordsWithMissingOccurrence');
  }
  if (num(stats, 'approvedRecordsWithMissingDecisionEvent') !== 0) {
    errors.push('approvedRecordsWithMissingDecisionEvent');
  }
  if (num(stats, 'evidenceEntriesLostDuringApproval') !== 0) errors.push('evidenceEntriesLostDuringApproval');
  if (num(stats, 'occurrenceRefsLostDuringApproval') !== 0) errors.push('occurrenceRefsLostDuringApproval');
  if (num(stats, 'evidenceExcerptUsedAsOnlyEvidence') !== 0) errors.push('evidenceExcerptUsedAsOnlyEvidence');

  if (num(stats, 'questionsIncorrectlyMarkedApprovedWithoutRecord') !== 0) {
    errors.push('questionsIncorrectlyMarkedApprovedWithoutRecord');
  }

  if (stats.materializedViewRebuildMatches === false) errors.push('materializedViewRebuildMatches');
  if (num(stats, 'materializedViewContainsUnknownEvent') !== 0) {
    errors.push('materializedViewContainsUnknownEvent');
  }

  if (num(stats, 'realPilotCasesMissing') !== 0) errors.push('realPilotCasesMissing');
  for (const rp of ['rp01Created', 'rp02Created', 'rp03Created', 'rp04Created', 'rp05Created', 'rp06Created', 'rp07Created']) {
    if (num(stats, rp) !== 1) errors.push(rp);
  }

  if (num(stats, 'rawSourcesReadByStage3j2e') !== 0) errors.push('rawSourcesReadByStage3j2e');
  if (num(stats, 'stage3kStarted') !== 0) errors.push('stage3kStarted');

  if (num(stats, 'registryApprovalsWithoutRegistryEvidence') !== 0) {
    errors.push('registryApprovalsWithoutRegistryEvidence');
  }
  if (num(stats, 'registryClaimsBeyondEvidenceScope') !== 0) errors.push('registryClaimsBeyondEvidenceScope');
  if (num(stats, 'packsWithMultipleUnrelatedSubjects') !== 0) errors.push('packsWithMultipleUnrelatedSubjects');
  if (num(stats, 'packsWithoutSingleHumanDecision') !== 0) errors.push('packsWithoutSingleHumanDecision');
  if (num(stats, 'unrelatedDomainsRemainingInPack') !== 0) errors.push('unrelatedDomainsRemainingInPack');
  if (num(stats, 'duplicateClaimsIncorrectlyReportedAsIndependentlyCorroborated') !== 0) {
    errors.push('duplicateClaimsIncorrectlyReportedAsIndependentlyCorroborated');
  }
  if (num(stats, 'mergeAllowedWithUnresolvedScope') !== 0) errors.push('mergeAllowedWithUnresolvedScope');
  if (num(stats, 'semanticMergeAttemptedWithoutScope') !== 0) errors.push('semanticMergeAttemptedWithoutScope');
  if (num(stats, 'approveAsVariantsAllowedWithoutBothProductSides') !== 0) {
    errors.push('approveAsVariantsAllowedWithoutBothProductSides');
  }
  if (num(stats, 'approvalAllowedForEvidenceGap') !== 0) errors.push('approvalAllowedForEvidenceGap');

  return errors;
}
