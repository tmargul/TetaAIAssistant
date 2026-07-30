import type { CorrelationStageManifestV1, ProposedKnowledgeRecordV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import {
  loadPilotCasesPolicy,
  loadReviewPackPolicy,
  loadReviewPriorityPolicy,
  type PilotCaseDef,
  type ReviewPackPolicyV1,
} from './teta-approval-policy';
import type {
  DecisionKind,
  EvidenceExcerptEntry,
  ReviewPackKind,
  ReviewPackV1,
  ReviewTaskV1,
} from './teta-approval.types';
import { TETA_REVIEW_PACK_CONTRACT_VERSION } from './teta-approval.types';
import { buildStaleGuard, computeExcerptSha256, fingerprintReviewPack } from './teta-review-pack-fingerprint';
import { MAX_EXCERPT_CHARS } from './teta-approval-contract';
import { materializeReviewTask } from './teta-review-priority';
import {
  buildDecisionabilityForPack,
  buildRegistryAnchorEvidence,
  EMPLOYMENT_PROCESS_SUBJECT,
  hasUnrelatedDomain,
  inferDuplicateSourceIndependence,
  isEmploymentRelatedRecord,
  narrowEmploymentRecords,
} from './teta-review-decisionability';

export type BuildPackOptions = {
  includeExcerpts?: boolean;
  syntheticExcerptText?: string | null;
  pilotCaseId?: string;
  packKind?: ReviewPackKind;
  allowedDecisionKinds?: DecisionKind[];
  forceEvidenceGap?: boolean;
  injectRegistryEvidence?: boolean;
  decisionabilityExtras?: Parameters<typeof buildDecisionabilityForPack>[0]['extras'];
};

function collectEvidenceEntries(
  manifest: CorrelationStageManifestV1,
  proposedRefs: string[],
  occurrenceRefs: string[],
  opts: BuildPackOptions,
  packPolicy: ReviewPackPolicyV1,
): EvidenceExcerptEntry[] {
  const records = manifest.proposedRecords.filter((r) => proposedRefs.includes(r.proposedRecordId));
  const evidenceIds = [
    ...new Set([
      ...records.flatMap((r) => r.evidenceRefs),
      ...occurrenceRefs.map((id) => `evidence:${id}`),
    ]),
  ].sort();

  return evidenceIds.map((evidenceEntryId, idx) => {
    const sectionId = `section:${evidenceEntryId.slice(-12)}`;
    let excerpt: string | null = null;
    if (opts.includeExcerpts && opts.syntheticExcerptText) {
      excerpt = opts.syntheticExcerptText.slice(0, packPolicy.maxExcerptChars ?? MAX_EXCERPT_CHARS);
    } else if (opts.includeExcerpts && !packPolicy.preferRefsWithoutFullSourceForAcceptancePilot) {
      excerpt = null;
    }
    if (packPolicy.preferRefsWithoutFullSourceForAcceptancePilot && !opts.syntheticExcerptText) {
      excerpt = null;
    }
    return {
      evidenceEntryId,
      evidenceKind: 'candidate_occurrence',
      // Acceptance pilot refs: same shared source revision; sections differ → same_source_different_sections
      sourceRevisionId: 'source-revision:acceptance-pilot-shared',
      sectionId,
      contentUnitRefs: [`cu-ref:${idx}`],
      assetRefs: [],
      pageFrom: null,
      pageTo: null,
      startSeconds: null,
      endSeconds: null,
      evidenceStrength: 'explicit_statement',
      excerptSha256: computeExcerptSha256(excerpt),
      excerpt,
    };
  });
}

function recordSummary(records: ProposedKnowledgeRecordV1[]) {
  return {
    count: records.length,
    ids: records.map((r) => r.proposedRecordId).sort(),
    mergeStatuses: [...new Set(records.map((r) => r.mergeStatus))].sort(),
    statuses: [...new Set(records.map((r) => r.status))].sort(),
    subjects: records.map((r) => r.canonicalSubjectProposal.label).slice(0, 5),
  };
}

function applicabilitySummary(records: ProposedKnowledgeRecordV1[]) {
  const families = [...new Set(records.flatMap((r) => r.applicability.productFamilyIds))].sort();
  const surfaces = [...new Set(records.flatMap((r) => r.applicability.productSurfaceIds))].sort();
  const domains = [...new Set(records.flatMap((r) => r.applicability.domainIds))].sort();
  const scopes = [...new Set(records.map((r) => r.applicability.scopeStatus))].sort();
  const currentness = [...new Set(records.map((r) => r.applicability.currentnessStatus))].sort();
  return {
    productFamilyIds: families,
    productSurfaceIds: surfaces,
    domainIds: domains,
    scopeStatuses: scopes,
    currentnessStatuses: currentness,
    clientSpecificRisk: [...new Set(records.map((r) => r.applicability.clientSpecificRisk))].sort(),
  };
}

export function buildReviewPack(
  task: ReviewTaskV1,
  manifest: CorrelationStageManifestV1,
  opts: BuildPackOptions = {},
  repoRoot?: string,
): ReviewPackV1 {
  const packPolicy = loadReviewPackPolicy(repoRoot);
  const records = manifest.proposedRecords.filter((r) => task.proposedRecordRefs.includes(r.proposedRecordId));
  const packKind =
    opts.packKind ??
    (opts.forceEvidenceGap
      ? 'evidence_gap'
      : task.reviewKind === 'resolve_conflict'
        ? 'conflict_review'
        : task.reviewKind === 'insufficient_evidence'
          ? 'evidence_gap'
          : task.reviewKind === 'confirm_equivalence'
            ? 'merge_review'
            : task.reviewKind === 'confirm_applicability' || task.reviewKind === 'select_product_scope'
              ? 'scope_review'
              : 'record_approval');

  let allowedDecisionKinds =
    opts.allowedDecisionKinds ??
    packPolicy.defaultAllowedByPackKind[packKind] ??
    task.allowedDecisionKinds;

  let evidence = collectEvidenceEntries(
    manifest,
    task.proposedRecordRefs,
    task.candidateOccurrenceRefs,
    opts,
    packPolicy,
  );

  if (opts.injectRegistryEvidence || opts.pilotCaseId === 'RP01') {
    evidence = [buildRegistryAnchorEvidence(repoRoot), ...evidence];
  }

  const relationDecisionRefs = task.relationDecisionRefs.length
    ? task.relationDecisionRefs
    : manifest.relationDecisions
        .filter(
          (d) =>
            task.candidateOccurrenceRefs.includes(d.leftOccurrenceId) ||
            task.candidateOccurrenceRefs.includes(d.rightOccurrenceId),
        )
        .map((d) => d.relationDecisionId)
        .sort();

  const staleGuard = buildStaleGuard({
    proposedRecordRevisionIds: records.map((r) => r.proposedRecordRevisionId),
    evidenceRefs: evidence.map((e) => e.evidenceEntryId),
    relationDecisionIds: relationDecisionRefs,
    reviewTask: task,
  });

  const blockingIssues: string[] = [];
  const missingInformation: string[] = [];
  if (packKind === 'evidence_gap') {
    missingInformation.push('no_matching_evidence');
  } else if (evidence.length === 0) {
    missingInformation.push('no_matching_evidence');
  }
  if (records.some((r) => (r.conflictRefs?.length ?? 0) > 0)) {
    blockingIssues.push('unresolved_conflict');
  }
  if (records.some((r) => r.mergeStatus === 'requires_review_before_merge')) {
    blockingIssues.push('requires_review_before_merge');
  }

  const baseWithoutDecisionability: Omit<ReviewPackV1, 'reviewPackId' | 'reviewPackRevisionId' | 'decisionability'> = {
    contractVersion: TETA_REVIEW_PACK_CONTRACT_VERSION,
    pilotCaseId: opts.pilotCaseId,
    reviewTaskId: task.reviewTaskId,
    correlationRunId: manifest.run.correlationRunId,
    correlationRunFingerprintSha256: manifest.fingerprintSha256,
    packKind,
    questionRefs: [...task.questionRefs].sort(),
    proposedRecordRefs: [...task.proposedRecordRefs].sort(),
    candidateOccurrenceRefs: [...task.candidateOccurrenceRefs].sort(),
    relationDecisionRefs,
    clusterRefs: [...task.clusterRefs].sort(),
    recordSummary: recordSummary(records),
    applicabilitySummary:
      opts.pilotCaseId === 'RP01'
        ? {
            productFamilyIds: ['teta_hr'],
            productSurfaceIds: ['teta_me'],
            domainIds: [],
            scopeStatuses: ['registry_anchored'],
            currentnessStatuses: ['not_applicable'],
            clientSpecificRisk: ['not_applicable'],
          }
        : applicabilitySummary(records),
    mergeSummary: {
      mergeStatuses: [...new Set(records.map((r) => r.mergeStatus))].sort(),
      multiOccurrence: records.filter((r) => r.candidateOccurrenceRefs.length > 1).length,
    },
    variantSummary: {
      variantRefs: [...new Set(records.flatMap((r) => r.variantRefs))].sort(),
    },
    conflictSummary: {
      conflictRefs: [...new Set(records.flatMap((r) => r.conflictRefs))].sort(),
    },
    evidence,
    allowedDecisionKinds,
    blockingIssues: blockingIssues.sort(),
    missingInformation: missingInformation.sort(),
    staleGuard,
    status: 'ready_for_human_review',
    warnings: [],
  };

  const enriched = buildDecisionabilityForPack({
    pack: baseWithoutDecisionability,
    records,
    extras: opts.decisionabilityExtras,
  });

  const base: Omit<ReviewPackV1, 'reviewPackId' | 'reviewPackRevisionId'> = {
    ...baseWithoutDecisionability,
    allowedDecisionKinds: enriched.allowedDecisionKinds,
    blockingIssues: enriched.blockingIssues,
    missingInformation: enriched.missingInformation,
    warnings: enriched.warnings,
    decisionability: enriched.decisionability,
  };

  const ids = fingerprintReviewPack(base);
  return { ...base, ...ids };
}

function pickStableRecord(
  records: ProposedKnowledgeRecordV1[],
  predicate: (r: ProposedKnowledgeRecordV1) => boolean,
): ProposedKnowledgeRecordV1 | null {
  const matched = records.filter(predicate).sort((a, b) => a.proposedRecordId.localeCompare(b.proposedRecordId));
  return matched[0] ?? null;
}

function materializePilotTask(
  source: {
    reviewTaskId: string;
    reviewKind: string;
    candidateOccurrenceRefs: string[];
    proposedRecordRefs: string[];
    questionRefs: string[];
    reasonCodes: string[];
    requiredHumanDecision: string;
  },
  manifest: CorrelationStageManifestV1,
  repoRoot?: string,
): ReviewTaskV1 {
  return materializeReviewTask(source as never, manifest, loadReviewPriorityPolicy(repoRoot));
}

export function selectPilotCaseTargets(
  manifest: CorrelationStageManifestV1,
  queue: ReviewTaskV1[],
  repoRoot?: string,
): Array<{
  caseDef: PilotCaseDef;
  task: ReviewTaskV1;
  record?: ProposedKnowledgeRecordV1;
  decisionabilityExtras?: BuildPackOptions['decisionabilityExtras'];
  injectRegistryEvidence?: boolean;
}> {
  const cases = loadPilotCasesPolicy(repoRoot).cases;
  const results: Array<{
    caseDef: PilotCaseDef;
    task: ReviewTaskV1;
    record?: ProposedKnowledgeRecordV1;
    decisionabilityExtras?: BuildPackOptions['decisionabilityExtras'];
    injectRegistryEvidence?: boolean;
  }> = [];

  for (const caseDef of cases) {
    const sel = caseDef.selection;

    if (caseDef.pilotCaseId === 'RP01' && typeof sel.questionId === 'string') {
      const task = materializePilotTask(
        {
          reviewTaskId: `synthetic:${sel.questionId}`,
          reviewKind: 'confirm_applicability',
          candidateOccurrenceRefs: [],
          proposedRecordRefs: [],
          questionRefs: [sel.questionId],
          reasonCodes: [String(sel.reasonCode ?? 'registry_surface_anchor')],
          requiredHumanDecision: 'Review Q21 registry surface fact',
        },
        manifest,
        repoRoot,
      );
      results.push({
        caseDef,
        task,
        injectRegistryEvidence: true,
        decisionabilityExtras: {
          forceStatus: 'ready_for_scoped_decision',
          tetaHrEvidenceEntries: 1,
          tetaEduEvidenceEntries: 0,
          sharedProcessSubjects: ['teta_me_registry_surface'],
          independentSourcesPerPack: 1,
        },
      });
      continue;
    }

    if (caseDef.pilotCaseId === 'RP02' && typeof sel.questionId === 'string') {
      const q = manifest.questionCoverage.find((x) => x.questionId === sel.questionId);
      const all = manifest.proposedRecords.filter((r) => (q?.matchedProposedRecordIds ?? []).includes(r.proposedRecordId));
      const narrowed = narrowEmploymentRecords(all, { maxProposed: 8, maxOccurrences: 30, maxEvidence: 40 });
      const selected = narrowed.selected;
      const occ = [...new Set(selected.flatMap((r) => r.candidateOccurrenceRefs))].sort();
      const task = materializePilotTask(
        {
          reviewTaskId: `synthetic:${sel.questionId}:narrowed`,
          reviewKind: 'confirm_applicability',
          candidateOccurrenceRefs: occ,
          proposedRecordRefs: selected.map((r) => r.proposedRecordId).sort(),
          questionRefs: [sel.questionId],
          reasonCodes: ['golden_question', 'employment_supported_subset'],
          requiredHumanDecision: 'Review Q07 supported subset',
        },
        manifest,
        repoRoot,
      );
      const unrelatedRemaining = selected.filter((r) => hasUnrelatedDomain(r)).length;
      results.push({
        caseDef,
        task,
        decisionabilityExtras: {
          recordsExcludedAsUnrelatedToQuestion: narrowed.excludedUnrelated.length + narrowed.excludedContextOnly.length,
          occurrencesExcludedAsContextOnly: narrowed.excludedContextOnly.reduce((n, r) => n + r.candidateOccurrenceRefs.length, 0),
          evidenceExcludedAsOutsideDecisionScope: all.length - selected.length,
          unrelatedDomainsRemainingInPack: unrelatedRemaining,
          questionMatchBasisPerRecord: narrowed.questionMatchBasisPerRecord,
          cannotNarrowReason: narrowed.cannotNarrowReason,
          sharedProcessSubjects: selected.some((r) =>
            (r.canonicalSubjectProposal.label || '').toLowerCase().includes(EMPLOYMENT_PROCESS_SUBJECT),
          )
            ? [EMPLOYMENT_PROCESS_SUBJECT]
            : selected.slice(0, 1).map((r) => r.canonicalSubjectProposal.label.slice(0, 80)),
          proposedClaimsForDecision: selected.slice(0, 8).map(
            (r) => `supported_subset:${r.recordKind}:${r.canonicalSubjectProposal.label.replace(/\s+/g, ' ').slice(0, 100)}`,
          ),
          explicitlyUnsupportedClaims: [
            'complete_employment_authorization_procedure',
            'missing_required_steps_not_present_in_subset',
            ...narrowed.excludedUnrelated.slice(0, 5).map((r) => `excluded_unrelated:${r.proposedRecordId}`),
          ],
          unresolvedDecisionDimensions: ['missing_authorization_steps', 'currentness_not_verified'],
          alternativeInterpretations: [
            'approve_only_supported_employment_info_steps',
            'request_more_evidence_for_contract_authorization',
          ],
          evidenceNeededToResolve: ['contract_authorization_step_evidence', 'employment_status_transition_evidence'],
        },
      });
      continue;
    }

    if (caseDef.pilotCaseId === 'RP03' && typeof sel.questionId === 'string') {
      const q = manifest.questionCoverage.find((x) => x.questionId === sel.questionId);
      const all = manifest.proposedRecords.filter((r) => (q?.matchedProposedRecordIds ?? []).includes(r.proposedRecordId));
      const employment = all.filter((r) => isEmploymentRelatedRecord(r));
      const processFocused = employment.filter((r) =>
        (r.canonicalSubjectProposal.label || '').toLowerCase().includes(EMPLOYMENT_PROCESS_SUBJECT),
      );
      const selected = (processFocused.length ? processFocused : employment)
        .sort((a, b) => a.proposedRecordId.localeCompare(b.proposedRecordId))
        .slice(0, 8);
      const families = [...new Set(selected.flatMap((r) => r.applicability.productFamilyIds))];
      const hasHr = families.includes('teta_hr');
      const hasEdu = families.includes('teta_edu');
      const bothSides = hasHr && hasEdu;
      const occ = [...new Set(selected.flatMap((r) => r.candidateOccurrenceRefs))].sort();
      const allowed = bothSides
        ? caseDef.allowedDecisionKinds
        : (['request_more_evidence', 'defer', 'reject'] as DecisionKind[]);
      const task = materializePilotTask(
        {
          reviewTaskId: `synthetic:${sel.questionId}:comparison-narrowed`,
          reviewKind: 'confirm_applicability',
          candidateOccurrenceRefs: occ,
          proposedRecordRefs: selected.map((r) => r.proposedRecordId).sort(),
          questionRefs: [sel.questionId],
          reasonCodes: bothSides ? ['hr_edu_comparison'] : ['comparison_missing_hr_side'],
          requiredHumanDecision: 'Review Q08 HR vs Edu comparison',
        },
        manifest,
        repoRoot,
      );
      results.push({
        caseDef: { ...caseDef, allowedDecisionKinds: allowed },
        task,
        decisionabilityExtras: {
          forceStatus: bothSides ? 'ready_for_decision' : 'requires_more_evidence',
          forceAllowed: allowed,
          productComparisonSidesPresent: bothSides,
          comparisonBasedOnSingleProductOnly: !bothSides,
          tetaHrEvidenceEntries: hasHr ? selected.filter((r) => r.applicability.productFamilyIds.includes('teta_hr')).length : 0,
          tetaEduEvidenceEntries: hasEdu ? selected.filter((r) => r.applicability.productFamilyIds.includes('teta_edu')).length : 0,
          sharedProcessSubjects: [EMPLOYMENT_PROCESS_SUBJECT],
          recordsExcludedAsUnrelatedToQuestion: Math.max(0, all.length - selected.length),
          proposedClaimsForDecision: bothSides
            ? ['shared_vs_variant_employment_steps_hr_edu']
            : ['cannot_compare_without_teta_hr_evidence'],
          explicitlyUnsupportedClaims: [
            'absence_of_hr_evidence_proves_processes_differ',
            'universal_hr_edu_merge',
          ],
          evidenceNeededToResolve: ['teta_hr_employment_process_evidence'],
          unresolvedDecisionDimensions: bothSides ? [] : ['missing_teta_hr_side'],
          alternativeInterpretations: [
            'request_more_evidence_for_teta_hr',
            'defer_until_hr_corpus_available',
            'reject_comparison_claim_as_unsupported',
          ],
        },
      });
      continue;
    }

    if (caseDef.pilotCaseId === 'RP07' && typeof sel.questionId === 'string') {
      const task = materializePilotTask(
        {
          reviewTaskId: `synthetic:${sel.questionId}`,
          reviewKind: 'insufficient_evidence',
          candidateOccurrenceRefs: [],
          proposedRecordRefs: [],
          questionRefs: [sel.questionId],
          reasonCodes: [String(sel.reasonCode ?? 'no_matching_evidence')],
          requiredHumanDecision: 'Review Q14 KSeF evidence gap',
        },
        manifest,
        repoRoot,
      );
      results.push({
        caseDef,
        task,
        decisionabilityExtras: {
          forceStatus: 'requires_more_evidence',
          forceAllowed: ['request_more_evidence', 'defer', 'close_gap_as_no_evidence'],
          evidenceRequest: {
            neededDocumentOrTraining: 'KSeF instruction or training material',
            requiredMetadata: ['document_or_training_date', 'material_version', 'currentness_status'],
            productVersionScope: 'optional_but_recommended',
            notes: [
              'close_gap_as_no_evidence means absent from current corpus only',
              'does_not_mean_instruction_does_not_exist',
              'does_not_mean_ksef_unsupported',
              'does_not_create_approved_record',
            ],
          },
          proposedClaimsForDecision: [],
          explicitlyUnsupportedClaims: [
            'approve_ksef_currency_without_evidence',
            'ksef_unsupported_by_product',
            'instruction_does_not_exist',
          ],
          sharedProcessSubjects: ['ksef_currentness'],
          unresolvedDecisionDimensions: ['missing_ksef_source', 'unknown_currentness'],
          alternativeInterpretations: ['request_more_evidence', 'defer', 'close_gap_as_no_evidence'],
          evidenceNeededToResolve: ['ksef_document_or_training_with_date_and_version'],
        },
      });
      continue;
    }

    if (
      sel.mergeStatus === 'exact_collapsed' ||
      sel.mergeStatus === 'semantically_grouped' ||
      sel.mergeStatus === 'requires_review_before_merge'
    ) {
      const record = pickStableRecord(
        manifest.proposedRecords,
        (r) =>
          r.mergeStatus === sel.mergeStatus &&
          r.candidateOccurrenceRefs.length >= Number(sel.minOccurrences ?? 2),
      );
      if (!record) throw new Error(`${caseDef.pilotCaseId} selection failed: no ${String(sel.mergeStatus)} multi-occurrence record`);
      const relatedTask =
        queue.find((t) => t.proposedRecordRefs.includes(record.proposedRecordId)) ??
        queue.find((t) => t.candidateOccurrenceRefs.some((id) => record.candidateOccurrenceRefs.includes(id)));
      const task = materializePilotTask(
        {
          reviewTaskId: relatedTask?.sourceReviewTaskId ?? `synthetic:${caseDef.pilotCaseId}:${record.proposedRecordId}`,
          reviewKind: relatedTask?.reviewKind ?? 'confirm_equivalence',
          candidateOccurrenceRefs: [...record.candidateOccurrenceRefs].sort(),
          proposedRecordRefs: [record.proposedRecordId],
          questionRefs: [],
          reasonCodes: relatedTask?.priorityReasons?.length
            ? relatedTask.priorityReasons
            : [`merge:${String(sel.mergeStatus)}`],
          requiredHumanDecision: `Review ${caseDef.pilotCaseId}`,
        },
        manifest,
        repoRoot,
      );

      const provisionalEvidence = collectEvidenceEntries(
        manifest,
        [record.proposedRecordId],
        record.candidateOccurrenceRefs,
        {},
        loadReviewPackPolicy(repoRoot),
      );
      const dup = inferDuplicateSourceIndependence(provisionalEvidence);

      if (caseDef.pilotCaseId === 'RP04') {
        results.push({
          caseDef,
          task,
          record,
          decisionabilityExtras: {
            ...dup,
            proposedClaimsForDecision: [
              `exact_duplicate_merge:${record.canonicalSubjectProposal.label.replace(/\s+/g, ' ').slice(0, 120)}`,
            ],
            explicitlyUnsupportedClaims: [
              'treat_same_source_duplicate_as_independent_corroboration',
            ],
            sharedProcessSubjects: [record.canonicalSubjectProposal.label.slice(0, 80)],
            semanticEquivalenceEvidenceSummary: null,
            unresolvedDecisionDimensions: [],
            alternativeInterpretations: ['approve_merged_record_for_dedup', 'reject', 'defer'],
          },
        });
        continue;
      }

      if (caseDef.pilotCaseId === 'RP05') {
        const unresolved = record.applicability.scopeStatus === 'requires_review';
        results.push({
          caseDef,
          task,
          record,
          decisionabilityExtras: {
            ...dup,
            semanticMergeRequiresExplicitScope: unresolved,
            forceStatus: unresolved ? 'ready_for_scoped_decision' : 'ready_for_decision',
            proposedClaimsForDecision: [
              `semantic_duplicate_merge:${record.canonicalSubjectProposal.label.replace(/\s+/g, ' ').slice(0, 120)}`,
            ],
            explicitlyUnsupportedClaims: [
              'merge_without_explicit_scope_when_requires_review',
            ],
            sharedProcessSubjects: [record.canonicalSubjectProposal.label.slice(0, 80)],
            semanticEquivalenceEvidenceSummary: `${record.candidateOccurrenceRefs.length} occurrences; scope=${record.applicability.scopeStatus}`,
            semanticDifferencesRequiringReview: unresolved
              ? ['unresolved_applicability_scope', 'possible_product_or_version_partition']
              : [],
            unresolvedDecisionDimensions: unresolved ? ['scopeStatus', 'productVersionHints'] : [],
            alternativeInterpretations: [
              'approve_merged_record_with_explicit_scopeDecision',
              'request_more_evidence',
              'defer',
              'reject',
            ],
            evidenceNeededToResolve: unresolved ? ['explicit_product_scope_or_version_evidence'] : [],
          },
        });
        continue;
      }

      if (caseDef.pilotCaseId === 'RP06') {
        results.push({
          caseDef,
          task,
          record,
          decisionabilityExtras: {
            ...dup,
            forceStatus: 'requires_more_evidence',
            proposedClaimsForDecision: [
              `resolve_requires_review_before_merge:${record.canonicalSubjectProposal.label.replace(/\s+/g, ' ').slice(0, 120)}`,
            ],
            explicitlyUnsupportedClaims: ['auto_merge_without_supporting_relation'],
            sharedProcessSubjects: [record.canonicalSubjectProposal.label.slice(0, 80)],
            unresolvedDecisionDimensions: [
              'equivalence_vs_variants',
              'incomplete_applicability',
              'missing_merge_supporting_relation',
            ],
            alternativeInterpretations: [
              'approve_as_variants_if_applicability_partitions_differ',
              'approve_supported_subset_of_shared_facts_only',
              'request_more_evidence_for_equivalence',
              'defer',
              'reject',
            ],
            evidenceNeededToResolve: [
              'explicit_equivalence_or_variant_relation_evidence',
              'applicability_partition_evidence',
            ],
            singleHumanDecisionQuestion:
              'Dla jednego subject: czy to warianty produktowe, supported subset wspólnych faktów, czy brak evidence do równoważności?',
          },
        });
        continue;
      }

      results.push({ caseDef, task, record });
      continue;
    }

    throw new Error(`unsupported pilot selection for ${caseDef.pilotCaseId}`);
  }

  return results;
}

export function buildPilotReviewPacks(
  manifest: CorrelationStageManifestV1,
  queue: ReviewTaskV1[],
  repoRoot?: string,
): ReviewPackV1[] {
  const targets = selectPilotCaseTargets(manifest, queue, repoRoot);
  return targets.map(({ caseDef, task, decisionabilityExtras, injectRegistryEvidence }) => {
    return buildReviewPack(
      {
        ...task,
        questionRefs: [
          ...new Set([
            ...task.questionRefs,
            ...(typeof caseDef.selection.questionId === 'string' ? [caseDef.selection.questionId] : []),
          ]),
        ].sort(),
      },
      manifest,
      {
        pilotCaseId: caseDef.pilotCaseId,
        packKind: caseDef.packKind,
        allowedDecisionKinds: caseDef.allowedDecisionKinds,
        forceEvidenceGap: caseDef.packKind === 'evidence_gap',
        includeExcerpts: caseDef.pilotCaseId === 'RP01',
        injectRegistryEvidence,
        decisionabilityExtras,
      },
      repoRoot,
    );
  });
}

export function createDecisionTemplate(pack: ReviewPackV1) {
  return {
    contractVersion: 'teta-approval-decision-template-v1' as const,
    templateId: `template:${pack.reviewPackId}`,
    reviewPackId: pack.reviewPackId,
    reviewPackRevisionId: pack.reviewPackRevisionId,
    allowedDecisionKinds: pack.allowedDecisionKinds,
    staleGuard: pack.staleGuard,
    reviewerId: null,
    reviewerRole: null,
    decisionKind: null,
    rationale: null,
    scopeDecision: null,
    isDecisionEvent: false as const,
  };
}

export function renderHumanReviewMarkdown(pack: ReviewPackV1, templatePath: string): string {
  const d = pack.decisionability;
  const lines = [
    `# ${pack.pilotCaseId ?? 'Review Pack'} — ${pack.packKind}`,
    '',
    `- reviewPackId: \`${pack.reviewPackId}\``,
    `- reviewPackRevisionId: \`${pack.reviewPackRevisionId}\``,
    `- reviewTaskId: \`${pack.reviewTaskId}\``,
    `- correlationRunId: \`${pack.correlationRunId}\``,
    `- status: ${pack.status}`,
    `- decisionabilityStatus: \`${d?.decisionabilityStatus ?? 'n/a'}\``,
    `- humanReviewComplexity: \`${d?.humanReviewComplexity ?? 'n/a'}\``,
    `- systemRecommendation: \`${d?.systemRecommendation ?? 'n/a'}\` (not applied)`,
    '',
    '## Single human decision question',
    d?.singleHumanDecisionQuestion ?? '(missing)',
    '',
    '## What may be approved',
    ...(d?.proposedClaimsForDecision?.length
      ? d.proposedClaimsForDecision.map((c) => `- ${c}`)
      : ['- (none)']),
    '',
    '## What must NOT be approved',
    ...(d?.explicitlyUnsupportedClaims?.length
      ? d.explicitlyUnsupportedClaims.map((c) => `- ${c}`)
      : ['- (none)']),
    '',
    '## Questions / case',
    ...(pack.questionRefs.length ? pack.questionRefs.map((q) => `- ${q}`) : ['- (no golden question refs)']),
    '',
    '## Proposed records',
    `- count: ${pack.proposedRecordRefs.length}`,
    ...pack.proposedRecordRefs.slice(0, 20).map((id) => `- ${id}`),
    '',
    '## Occurrences',
    `- count: ${pack.candidateOccurrenceRefs.length}`,
    '',
    '## Relations',
    `- count: ${pack.relationDecisionRefs.length}`,
    '',
    '## Applicability summary',
    '```json',
    JSON.stringify(pack.applicabilitySummary, null, 2),
    '```',
    '',
    '## Decision scope summary',
    '```json',
    JSON.stringify(d?.decisionScopeSummary ?? {}, null, 2),
    '```',
    '',
    '## Source independence / comparison',
    '```json',
    JSON.stringify(
      {
        duplicateSourceIndependence: d?.duplicateSourceIndependence,
        duplicateSupportsDeduplication: d?.duplicateSupportsDeduplication,
        duplicateSupportsIndependentCorroboration: d?.duplicateSupportsIndependentCorroboration,
        independentSourcesPerPack: d?.independentSourcesPerPack,
        productComparisonSidesPresent: d?.productComparisonSidesPresent,
        comparisonBasedOnSingleProductOnly: d?.comparisonBasedOnSingleProductOnly,
        semanticMergeRequiresExplicitScope: d?.semanticMergeRequiresExplicitScope,
      },
      null,
      2,
    ),
    '```',
    '',
    '## Unresolved dimensions / alternatives',
    '```json',
    JSON.stringify(
      {
        unresolvedDecisionDimensions: d?.unresolvedDecisionDimensions ?? [],
        alternativeInterpretations: d?.alternativeInterpretations ?? [],
        evidenceNeededToResolve: d?.evidenceNeededToResolve ?? [],
        evidenceRequest: d?.evidenceRequest ?? null,
      },
      null,
      2,
    ),
    '```',
    '',
    '## Merge / variants / conflicts',
    '```json',
    JSON.stringify(
      { merge: pack.mergeSummary, variants: pack.variantSummary, conflicts: pack.conflictSummary },
      null,
      2,
    ),
    '```',
    '',
    '## Evidence table',
    `| evidenceEntryId | kind | sectionId | excerptSha256 | excerpt |`,
    `| --- | --- | --- | --- | --- |`,
    ...pack.evidence.map(
      (e) =>
        `| ${e.evidenceEntryId} | ${e.evidenceKind ?? 'candidate_occurrence'} | ${e.sectionId} | ${e.excerptSha256 ?? 'null'} | ${e.excerpt ? e.excerpt.slice(0, 120).replace(/\|/g, '/') : 'null (refs only)'} |`,
    ),
    '',
    '## Blocking issues',
    ...(pack.blockingIssues.length ? pack.blockingIssues.map((b) => `- ${b}`) : ['- none']),
    '',
    '## Missing information',
    ...(pack.missingInformation.length ? pack.missingInformation.map((m) => `- ${m}`) : ['- none']),
    '',
    '## Allowed decisions and consequences',
    ...pack.allowedDecisionKinds.map((kind) => {
      const consequence =
        kind.startsWith('approve')
          ? 'creates approved record(s) only after explicit human apply-decision'
          : kind === 'close_gap_as_no_evidence'
            ? 'closes gap without approved record; does not assert product unsupported'
            : kind === 'request_more_evidence'
              ? 'records evidence request; no approved record'
              : kind === 'defer'
                ? 'leaves task deferred; no approved record'
                : kind === 'reject'
                  ? 'records rejection; does not delete proposed/evidence'
                  : 'see policy';
      return `- ${kind}: ${consequence}`;
    }),
    '',
    '## Stale guard',
    '```json',
    JSON.stringify(pack.staleGuard, null, 2),
    '```',
    '',
    `## Decision template path`,
    `\`${templatePath}\``,
    '',
  ];
  return `${lines.join('\n')}\n`;
}
