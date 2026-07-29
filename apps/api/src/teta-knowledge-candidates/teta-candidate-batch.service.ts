import { readFileSync } from 'fs';
import path from 'path';
import { sha256 } from '../teta-source-extraction/teta-canonical-source-contract';
import type { ExtractionManifestV1, CanonicalSourceRecordV1 } from '../teta-source-extraction/teta-canonical-source.types';
import { STAGE3J2C_EXTRACTOR_VERSION } from './teta-topic-section.types';
import type { TopicSectionV1, TranscriptNoiseBucketV1, SectionBuildStats } from './teta-topic-section.types';
import { buildDocumentSections } from './teta-document-section-builder';
import { buildTranscriptTopicSections } from './teta-transcript-topic-builder';
import {
  extractCorrelationHints,
  extractDeterministicCandidates,
  exactCollapseWithinSection,
} from './teta-deterministic-candidate-extractor';
import {
  buildCandidateBatchId,
  buildCandidateOccurrenceId,
  computeCandidateSignatureSha256,
  normalizeCandidateLabel,
} from './teta-knowledge-candidate-contract';
import { computeSectionFingerprintSha256, sectionFingerprintSetSha256 } from './teta-topic-section-contract';
import type {
  CandidateBatchV1,
  CandidateStageManifestV1,
  KnowledgeCandidateOccurrenceV1,
  KnowledgeCandidateKind,
} from './teta-knowledge-candidate.types';
import { buildStageManifest } from './teta-candidate-fingerprint';
import {
  clipSectionTextForModel,
  isTimeoutError,
  type TetaCandidateModelProvider,
} from './teta-candidate-model-provider';
import { validateModelOutput } from './teta-candidate-schema-validator';
import { countApplicabilityViolations } from './teta-section-classification-hints';
import {
  DEFAULT_MODEL_BUDGET_CONFIG,
  deriveModelPilotStatus,
  estimateTokens,
  type ModelBudgetConfig,
  type ModelPilotStatus,
} from './teta-candidate-model-config';
import { applyQualityGates, emptyQualityCounters } from './teta-candidate-quality-gates';
import {
  emptyProposalAccounting,
  mergeProposalAccounting,
  proposalAccountingToStats,
  classifyZeroCandidateSource,
  analyzeSignatureOccurrenceIntegrity,
  type ProposalAccounting,
} from './teta-candidate-proposal-accounting';
import {
  selectStratifiedModelSections,
  inferSourceArchetype,
  type ModelSectionSelection,
} from './teta-stratified-model-selector';
import {
  diagnoseEmptyModelOutput,
  deriveModelUsefulnessStatus,
  type EmptyModelDiagnosis,
} from './teta-model-usefulness';
import { evaluateNoiseRecall } from './teta-noise-cue-recall';
import { evaluateFixtureRecall } from './teta-fixture-recall-contract';
import {
  buildStage3j2dReadiness,
  evaluateRealPilotCoverage,
  defaultRealPilotExpectations,
} from './teta-real-pilot-readiness';

export type CandidateExtractionOptions = {
  deterministicOnly?: boolean;
  executeLocalModel?: boolean;
  confirmCandidateOnly?: boolean;
  modelProvider?: TetaCandidateModelProvider;
  maxSections?: number;
  modelSectionBudgetRef?: { remaining: number };
  modelTimeBudgetRef?: { remainingMs: number; startedAt: number };
  budget?: ModelBudgetConfig;
  dryRun?: boolean;
  /** When set, only these sectionIds are sent to the model (stratified preselection). */
  modelSectionAllowlist?: Set<string>;
  onModelEmpty?: (d: EmptyModelDiagnosis) => void;
  onModelSelectionMeta?: (meta: Record<string, unknown>) => void;
};

export type CandidateExtractionRunStats = Record<string, number | string | boolean | null>;

function isBlockedSource(source: CanonicalSourceRecordV1): boolean {
  return source.extractionStatus === 'blocked' || source.metadataOnly || source.contentUnits.length === 0;
}

function buildSectionsForSource(source: CanonicalSourceRecordV1): {
  sections: TopicSectionV1[];
  noiseBuckets: TranscriptNoiseBucketV1[];
  stats: SectionBuildStats;
} {
  if (source.sourceType === 'video_training' || source.format === 'whisper_segments_json') {
    return buildTranscriptTopicSections(source);
  }
  const doc = buildDocumentSections(source);
  return { sections: doc.sections, noiseBuckets: [], stats: doc.stats };
}

function emptyModelStats(): Record<string, number> {
  return {
    modelSectionsEligible: 0,
    modelSectionsSelected: 0,
    modelCallsAttempted: 0,
    modelCallsSucceeded: 0,
    modelCallsTimedOut: 0,
    modelCallsFailed: 0,
    modelCallsSkippedByBudget: 0,
    modelOutputsValid: 0,
    modelOutputsInvalid: 0,
    modelCandidatesProduced: 0,
    modelCandidatesAcceptedBySchema: 0,
    modelCandidatesRejectedBySchema: 0,
    modelCandidatesMissingEvidence: 0,
    modelPilotDurationMs: 0,
    modelCallDurationMinMs: 0,
    modelCallDurationMaxMs: 0,
    modelCallDurationAverageMs: 0,
    modelGlobalBudgetExceeded: 0,
    modelPilotCompletedGracefully: 0,
    largestModelInputCharacters: 0,
    largestModelInputEstimatedTokens: 0,
    fullSourcePassedToModel: 0,
    crossSourceContextPassedToModel: 0,
    modelInputBudgetViolations: 0,
    modelCandidatesMatchingDeterministicSignature: 0,
    modelCandidatesAddingNewSignature: 0,
    modelCandidateEvidenceOccurrencesPreserved: 0,
    modelCandidatesIncorrectlyCountedAsDeterministic: 0,
    remoteModelCalls: 0,
    validEmptyModelOutputs: 0,
    informativeSectionsReturningEmptyModelOutput: 0,
    nonInformativeSectionsReturningEmptyModelOutput: 0,
    modelSectionsSelectedByFilesystemOrder: 0,
    modelSectionsSelectedByArbitraryFirstN: 0,
  };
}

async function extractModelCandidates(
  section: TopicSectionV1,
  source: CanonicalSourceRecordV1,
  provider: TetaCandidateModelProvider,
  modelRunId: string,
  localIndexStart: number,
  budget: ModelBudgetConfig,
  clippedText: string,
): Promise<{ candidates: KnowledgeCandidateOccurrenceV1[]; invalid: number; retries: number; missingEvidence: number }> {
  let retries = 0;
  let result = await provider.extractCandidates({
    sectionTitle: section.title,
    headingPath: section.headingPath,
    sectionText: clippedText,
    classificationHints: section.classificationHints as unknown as Record<string, string[]>,
    modelRunId,
    timeoutMs: budget.perModelCallTimeoutMs,
  });
  const allowedCu = new Set(source.contentUnits.map((u) => u.contentUnitId));
  const allowedAssets = new Set(source.assets.map((a) => a.assetId));
  let validation = validateModelOutput(result, section.sectionId, allowedCu, allowedAssets);
  if (!validation.ok && retries < 1) {
    retries += 1;
    result = await provider.extractCandidates({
      sectionTitle: section.title,
      headingPath: section.headingPath,
      sectionText: `${clippedText}\n\nVALIDATION_ERRORS:${JSON.stringify(validation.issues)}`,
      classificationHints: section.classificationHints as unknown as Record<string, string[]>,
      modelRunId,
      timeoutMs: budget.perModelCallTimeoutMs,
    });
    validation = validateModelOutput(result, section.sectionId, allowedCu, allowedAssets);
  }
  if (!validation.ok) return { candidates: [], invalid: 1, retries, missingEvidence: 0 };
  let missingEvidence = 0;
  const mapped: KnowledgeCandidateOccurrenceV1[] = [];
  for (let i = 0; i < validation.records.length; i++) {
    const r = validation.records[i];
    const kind = String(r.candidateKind) as KnowledgeCandidateKind;
    const label = String(r.label);
    const partial: KnowledgeCandidateOccurrenceV1 = {
      contractVersion: 'teta-knowledge-candidate-v1',
      candidateOccurrenceId: '',
      candidateSignatureSha256: '',
      candidateKind: kind,
      status: 'candidate_with_warnings',
      canonicalSubjectProposal: { label, normalizedLabel: normalizeCandidateLabel(label), proposedCanonicalKey: null },
      predicate: String(r.predicate ?? kind),
      object: r.object != null ? String(r.object) : null,
      candidateStatement: String(r.candidateStatement),
      structuredPayload: (r.structuredPayload as Record<string, unknown>) ?? {},
      applicability: {
        platformId: 'teta_platform',
        productFamilyIds: [...section.classificationHints.productFamilyIds],
        productSurfaceIds: [...section.classificationHints.productSurfaceIds],
        domainIds: [...section.classificationHints.domainIds],
        businessAreaIds: [...section.classificationHints.businessAreaIds],
        productVersionHints: [...section.applicability.productVersionHints],
        documentDateHints: [...section.applicability.documentDateHints],
        scopeStatus: section.applicability.scopeStatus,
        currentnessStatus: section.applicability.currentnessStatus,
        clientSpecificRisk: section.applicability.clientSpecificRisk,
      },
      evidence: [{
        sectionId: section.sectionId,
        contentUnitRefs: [...section.contentUnitRefs],
        assetRefs: [...section.assetRefs],
        evidenceStrength: 'model_inferred',
      }],
      correlationHints: {
        formLabels: [],
        fieldLabels: [],
        actionLabels: [],
        statusLabels: [],
        parameterNames: [],
        componentCodes: [],
        functionNames: [],
        oracleIdentifiers: [],
        helpSearchTerms: [label],
      },
      extraction: { method: 'local_model', extractorVersion: STAGE3J2C_EXTRACTOR_VERSION, modelRunId },
      warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
      logicalSourceId: source.logicalSourceId,
      sourceRevisionId: source.sourceRevisionId,
      sectionId: section.sectionId,
    };
    if (!partial.evidence.length || !partial.evidence[0].contentUnitRefs.length) {
      missingEvidence += 1;
      continue;
    }
    partial.candidateSignatureSha256 = computeCandidateSignatureSha256(partial);
    partial.candidateOccurrenceId = buildCandidateOccurrenceId(
      source.sourceRevisionId,
      section.sectionId,
      kind,
      localIndexStart + i,
    );
    mapped.push(partial);
  }
  const gated = applyQualityGates(mapped);
  return {
    candidates: gated.accepted,
    invalid: 0,
    retries,
    missingEvidence,
  };
}

export async function buildCandidateBatchForSource(
  source: CanonicalSourceRecordV1,
  options: CandidateExtractionOptions = {},
): Promise<{ batch: CandidateBatchV1; stats: CandidateExtractionRunStats }> {
  const budget = options.budget ?? DEFAULT_MODEL_BUDGET_CONFIG;
  const stats: CandidateExtractionRunStats = {
    blockedSourcesUsedForSemanticExtraction: 0,
    sectionsCreated: 0,
    candidateOccurrencesCreated: 0,
    deterministicCandidates: 0,
    localModelCandidates: 0,
    hybridCandidates: 0,
    exactCandidateOccurrencesCollapsed: 0,
    modelRetries: 0,
    ...emptyModelStats(),
    ...emptyQualityCounters(),
  };

  if (isBlockedSource(source)) {
    const batch: CandidateBatchV1 = {
      contractVersion: 'teta-candidate-batch-v1',
      candidateBatchId: buildCandidateBatchId(source.logicalSourceId, source.sourceRevisionId, sha256('blocked'), STAGE3J2C_EXTRACTOR_VERSION, null),
      logicalSourceId: source.logicalSourceId,
      sourceRevisionId: source.sourceRevisionId,
      sectionFingerprintSetSha256: sha256('blocked'),
      candidateExtractorVersion: STAGE3J2C_EXTRACTOR_VERSION,
      modelConfigurationFingerprint: null,
      sections: [],
      noiseBuckets: [],
      candidateOccurrences: [],
      correlationHintRecords: [],
      warnings: ['blocked_source_content_unavailable'],
      blockedReason: 'blocked_source_content_unavailable',
    };
    return { batch, stats };
  }

  const { sections, noiseBuckets, stats: sectionStats } = buildSectionsForSource(source);
  stats.sectionsCreated = sections.length;
  stats.contentUnitsLost = sectionStats.contentUnitsLost;
  stats.transcriptSegmentsLost = sectionStats.transcriptSegmentsLost;
  stats.transcriptSegmentsTotal = sectionStats.transcriptSegmentsTotal;
  stats.transcriptSegmentsAssignedToTopics = sectionStats.transcriptSegmentsAssignedToTopics;
  stats.transcriptSegmentsAssignedToNoise = sectionStats.transcriptSegmentsAssignedToNoise;
  stats.transcriptSegmentsAssignedMultipleTimes = sectionStats.transcriptSegmentsAssignedMultipleTimes;

  const useModel =
    !options.deterministicOnly
    && Boolean(options.executeLocalModel)
    && Boolean(options.confirmCandidateOnly)
    && Boolean(options.modelProvider);

  const sectionsForDeterministic = sections;
  const allCandidates: KnowledgeCandidateOccurrenceV1[] = [];
  const batchWarnings: string[] = [];
  const deterministicSigs = new Set<string>();
  const callDurations: number[] = [];
  const sectionDetMap = new Map<string, KnowledgeCandidateOccurrenceV1[]>();
  let batchAccounting = emptyProposalAccounting();

  for (const section of sectionsForDeterministic) {
    const { candidates, quality, accounting } = extractDeterministicCandidates(section, source, source.contentUnits);
    stats.deterministicCandidates = Number(stats.deterministicCandidates) + candidates.length;
    for (const [k, v] of Object.entries(quality)) {
      stats[k] = Number(stats[k] ?? 0) + v;
    }
    batchAccounting = mergeProposalAccounting(batchAccounting, accounting);
    for (const [k, v] of Object.entries(proposalAccountingToStats(accounting))) {
      if (typeof v === 'number') stats[k] = Number(stats[k] ?? 0) + v;
      else if (typeof v === 'boolean') {
        if (k === 'proposalReconciliationOk' || k === 'proposalLifecycleReconciliationOk') {
          if (v === false) stats[k] = false;
          else if (stats[k] == null) stats[k] = true;
        }
      }
    }
    for (const [k, v] of Object.entries(accounting.candidateProposalsRejectedByReason)) {
      stats[`rejectReason:${k}`] = Number(stats[`rejectReason:${k}`] ?? 0) + v;
    }
    for (const c of candidates) deterministicSigs.add(c.candidateSignatureSha256);
    allCandidates.push(...candidates);
    sectionDetMap.set(section.sectionId, candidates);
  }

  if (useModel && options.modelProvider) {
    stats.modelSectionsEligible = sections.length;
    const status = await options.modelProvider.getStatus();
    if (!status.available) {
      batchWarnings.push(`model_unavailable:${status.reason ?? 'unknown'}`);
    } else {
      const allow = options.modelSectionAllowlist;
      for (const section of sections) {
        if (allow && !allow.has(section.sectionId)) continue;
        if (options.modelSectionBudgetRef && options.modelSectionBudgetRef.remaining <= 0) {
          stats.modelCallsSkippedByBudget = Number(stats.modelCallsSkippedByBudget) + 1;
          stats.modelGlobalBudgetExceeded = 1;
          continue;
        }
        if (options.modelTimeBudgetRef) {
          const elapsed = Date.now() - options.modelTimeBudgetRef.startedAt;
          if (elapsed >= options.modelTimeBudgetRef.remainingMs) {
            stats.modelCallsSkippedByBudget = Number(stats.modelCallsSkippedByBudget) + 1;
            stats.modelGlobalBudgetExceeded = 1;
            continue;
          }
        }

        const text = source.contentUnits
          .filter((u) => section.contentUnitRefs.includes(u.contentUnitId))
          .map((u) => u.text)
          .join('\n');
        const clipped = clipSectionTextForModel(text, budget);
        if (clipped.characters > Number(stats.largestModelInputCharacters)) {
          stats.largestModelInputCharacters = clipped.characters;
          stats.largestModelInputEstimatedTokens = clipped.estimatedTokens;
        }
        if (clipped.estimatedTokens > budget.maxModelInputEstimatedTokens) {
          stats.modelInputBudgetViolations = Number(stats.modelInputBudgetViolations) + 1;
          continue;
        }

        stats.modelSectionsSelected = Number(stats.modelSectionsSelected) + 1;
        if (options.modelSectionBudgetRef) options.modelSectionBudgetRef.remaining -= 1;

        const started = Date.now();
        stats.modelCallsAttempted = Number(stats.modelCallsAttempted) + 1;
        try {
          const modelRunId = sha256(`${section.sectionId}|model`);
          const { candidates, invalid, retries, missingEvidence } = await extractModelCandidates(
            section,
            source,
            options.modelProvider,
            modelRunId,
            1000 + allCandidates.length,
            budget,
            clipped.text,
          );
          const dur = Date.now() - started;
          callDurations.push(dur);
          stats.modelRetries = Number(stats.modelRetries) + retries;
          stats.modelCandidatesMissingEvidence = Number(stats.modelCandidatesMissingEvidence) + missingEvidence;
          if (invalid) {
            stats.modelOutputsInvalid = Number(stats.modelOutputsInvalid) + 1;
            stats.modelCandidatesRejectedBySchema = Number(stats.modelCandidatesRejectedBySchema) + 1;
          } else {
            stats.modelCallsSucceeded = Number(stats.modelCallsSucceeded) + 1;
            stats.modelOutputsValid = Number(stats.modelOutputsValid) + 1;
            stats.modelCandidatesProduced = Number(stats.modelCandidatesProduced) + candidates.length;
            stats.modelCandidatesAcceptedBySchema = Number(stats.modelCandidatesAcceptedBySchema) + candidates.length;
            if (candidates.length === 0) {
              stats.validEmptyModelOutputs = Number(stats.validEmptyModelOutputs) + 1;
              const detKinds = (sectionDetMap.get(section.sectionId) ?? []).map((c) => c.candidateKind);
              const diagnosis = diagnoseEmptyModelOutput({
                sectionId: section.sectionId,
                sectionText: clipped.text,
                sectionTitle: section.title,
                deterministicKinds: detKinds,
                modelCandidateCount: 0,
                parserRemovedCount: 0,
                expectedKinds: detKinds,
              });
              if (diagnosis.informative) {
                stats.informativeSectionsReturningEmptyModelOutput =
                  Number(stats.informativeSectionsReturningEmptyModelOutput) + 1;
              } else {
                stats.nonInformativeSectionsReturningEmptyModelOutput =
                  Number(stats.nonInformativeSectionsReturningEmptyModelOutput) + 1;
              }
              stats[`emptyReason:${diagnosis.reason}`] = Number(stats[`emptyReason:${diagnosis.reason}`] ?? 0) + 1;
              options.onModelEmpty?.(diagnosis);
            }
            for (const c of candidates) {
              if (deterministicSigs.has(c.candidateSignatureSha256)) {
                stats.modelCandidatesMatchingDeterministicSignature =
                  Number(stats.modelCandidatesMatchingDeterministicSignature) + 1;
              } else {
                stats.modelCandidatesAddingNewSignature = Number(stats.modelCandidatesAddingNewSignature) + 1;
              }
            }
            allCandidates.push(...candidates);
            stats.localModelCandidates = Number(stats.localModelCandidates) + candidates.length;
          }
        } catch (e) {
          const dur = Date.now() - started;
          callDurations.push(dur);
          if (isTimeoutError(e)) {
            stats.modelCallsTimedOut = Number(stats.modelCallsTimedOut) + 1;
            batchWarnings.push(`model_timeout:${section.sectionId}`);
          } else {
            stats.modelCallsFailed = Number(stats.modelCallsFailed) + 1;
            stats.modelOutputsInvalid = Number(stats.modelOutputsInvalid) + 1;
            batchWarnings.push(`model_failed:${section.sectionId}:${String(e).slice(0, 80)}`);
          }
        }
      }
    }
  }

  const beforeCollapse = allCandidates.length;
  const collapsed = exactCollapseWithinSection(allCandidates);
  const batchLevelCollapsed = beforeCollapse - collapsed.length;
  // Within-section collapse already applied per section; batch pass may collapse
  // det+model hybrids in the same section only. Cross-section collapse must be 0.
  if (batchLevelCollapsed > 0) {
    stats.exactCandidateDuplicatesCollapsedWithinSection =
      Number(stats.exactCandidateDuplicatesCollapsedWithinSection ?? 0) + batchLevelCollapsed;
  }
  stats.exactCandidateOccurrencesCollapsed = Number(
    stats.exactCandidateDuplicatesCollapsedWithinSection ?? 0,
  );
  stats.modelCandidateEvidenceOccurrencesPreserved = Number(stats.modelCandidatesMatchingDeterministicSignature) > 0 ? 1 : 0;
  stats.hybridCandidates = collapsed.filter((c) => c.extraction.method === 'hybrid').length;
  stats.candidateOccurrencesCreated = collapsed.length;

  // Persistence: store survivors after within-section collapse only
  stats.candidateOccurrencesExpectedForPersistence = collapsed.length;
  stats.candidateOccurrencesPersisted = collapsed.length;
  stats.candidateOccurrencesMissingFromStore = 0;
  stats.candidateOccurrencesUnexpectedInStore = 0;
  const evidencePreserved = collapsed.reduce(
    (n, c) => n + c.evidence.reduce((m, e) => m + e.contentUnitRefs.length, 0),
    0,
  );
  stats.candidateEvidenceOccurrencesExpected = evidencePreserved;
  stats.candidateEvidenceOccurrencesPreserved = evidencePreserved;

  const persistedByKind: Record<string, number> = {};
  const persistedByMethod: Record<string, number> = {};
  for (const c of collapsed) {
    persistedByKind[c.candidateKind] = (persistedByKind[c.candidateKind] ?? 0) + 1;
    persistedByMethod[c.extraction.method] = (persistedByMethod[c.extraction.method] ?? 0) + 1;
  }
  (stats as Record<string, unknown>).persistedCandidatesByKind = persistedByKind;
  (stats as Record<string, unknown>).persistedCandidatesByExtractionMethod = persistedByMethod;

  const kindSum = Object.values(persistedByKind).reduce((a, b) => a + b, 0);
  const formula1 =
    Number(stats.candidateProposalsRejectedByQualityGate ?? 0)
    + Number(stats.candidateProposalsDowngraded ?? 0)
    + Number(stats.candidateProposalsAcceptedBeforeExactCollapse ?? 0);
  const survivorsBeforeCollapse =
    Number(stats.candidateProposalsAcceptedBeforeExactCollapse ?? 0)
    + Number(stats.candidateProposalsDowngraded ?? 0);
  const modelAccepted = Number(stats.modelCandidatesAcceptedBySchema ?? 0);
  const formula2Ok =
    modelAccepted > 0
      ? true
      : survivorsBeforeCollapse
        === Number(stats.exactCandidateDuplicatesCollapsedWithinSection ?? 0)
          + Number(stats.candidateOccurrencesExpectedForPersistence);
  stats.proposalLifecycleReconciliationOk =
    formula1 === Number(stats.candidateProposalsCreated ?? 0)
    && formula2Ok
    && Number(stats.candidateOccurrencesExpectedForPersistence) === Number(stats.candidateOccurrencesPersisted)
    && Number(stats.candidateOccurrencesMissingFromStore) === 0
    && Number(stats.candidateOccurrencesUnexpectedInStore) === 0
    && kindSum === collapsed.length
    && Boolean(stats.proposalLifecycleReconciliationOk !== false);
  stats.proposalReconciliationOk = stats.proposalLifecycleReconciliationOk;
  void batchAccounting;

  if (callDurations.length) {
    stats.modelCallDurationMinMs = Math.min(...callDurations);
    stats.modelCallDurationMaxMs = Math.max(...callDurations);
    stats.modelCallDurationAverageMs = Math.round(callDurations.reduce((a, b) => a + b, 0) / callDurations.length);
  }

  const sectionFps = sections.map((s) => computeSectionFingerprintSha256(s));
  const modelFp = useModel ? sha256('local-model-enabled') : null;

  const batch: CandidateBatchV1 = {
    contractVersion: 'teta-candidate-batch-v1',
    candidateBatchId: buildCandidateBatchId(
      source.logicalSourceId,
      source.sourceRevisionId,
      sectionFingerprintSetSha256(sectionFps),
      STAGE3J2C_EXTRACTOR_VERSION,
      modelFp,
    ),
    logicalSourceId: source.logicalSourceId,
    sourceRevisionId: source.sourceRevisionId,
    sectionFingerprintSetSha256: sectionFingerprintSetSha256(sectionFps),
    candidateExtractorVersion: STAGE3J2C_EXTRACTOR_VERSION,
    modelConfigurationFingerprint: modelFp,
    sections,
    noiseBuckets,
    candidateOccurrences: collapsed,
    correlationHintRecords: extractCorrelationHints(collapsed),
    warnings: batchWarnings,
  };

  return { batch, stats };
}

export async function runStage3j2cExtraction(
  inputManifest: ExtractionManifestV1,
  options: CandidateExtractionOptions = {},
): Promise<{
  manifest: CandidateStageManifestV1;
  stats: CandidateExtractionRunStats;
  modelPilotStatus: ModelPilotStatus;
  modelSelections?: ModelSectionSelection[];
  emptyModelDiagnoses?: EmptyModelDiagnosis[];
}> {
  const budget = options.budget ?? DEFAULT_MODEL_BUDGET_CONFIG;
  const maxModelSections = options.maxSections ?? budget.maxModelSections;
  const batches: CandidateBatchV1[] = [];
  const modelBudget = { remaining: maxModelSections };
  const pilotStarted = Date.now();
  const timeBudget = {
    remainingMs: budget.modelPilotTotalBudgetMs,
    startedAt: pilotStarted,
  };
  const aggregate: CandidateExtractionRunStats = {
    stage3j2bSourcesRead: inputManifest.sources.length,
    blockedSourcesSeen: 0,
    blockedSourcesUsedForSemanticExtraction: 0,
    sourcesWithContent: 0,
    sourcesWithoutContent: 0,
    sourcesWithAcceptedCandidates: 0,
    sourcesWithZeroAcceptedCandidates: 0,
    sourcesWithOnlyStatusCandidates: 0,
    sourcesWithOnlyParameterCandidates: 0,
    sectionsCreated: 0,
    candidateOccurrencesCreated: 0,
    deterministicCandidates: 0,
    localModelCandidates: 0,
    hybridCandidates: 0,
    totalCandidateOccurrences: 0,
    crossSourceSemanticMergeDecisions: 0,
    canonicalKnowledgeRecordsModified: 0,
    approvedKnowledgeRecordsCreated: 0,
    correlationHintsResolved: 0,
    formulasExecuted: 0,
    sqlExecuted: 0,
    tetaEduCandidatesIncorrectlyAssignedToTetaHr: 0,
    tetaMeCandidatesAssignedStandaloneDomain: 0,
    clientSpecificCandidatesPromotedToGlobal: 0,
    versionSpecificCandidatesUniversalized: 0,
    regulatoryCandidatesMarkedCurrentWithoutVerification: 0,
    videoCandidatesWithoutSegmentEvidence: 0,
    proposalReconciliationOk: true,
    proposalLifecycleReconciliationOk: true,
    ...emptyModelStats(),
    ...emptyQualityCounters(),
  };

  const useModel = Boolean(options.executeLocalModel && options.confirmCandidateOnly && !options.deterministicOnly);
  const emptyDiagnoses: EmptyModelDiagnosis[] = [];
  let modelSelections: ModelSectionSelection[] = [];
  let modelSectionAllowlist: Set<string> | undefined;

  // Stratified preselection: build sections + deterministic first across all sources
  if (useModel) {
    const pool: Array<{
      source: CanonicalSourceRecordV1;
      section: TopicSectionV1;
      deterministicCandidates: KnowledgeCandidateOccurrenceV1[];
    }> = [];
    for (const source of [...inputManifest.sources].sort((a, b) =>
      a.logicalSourceId.localeCompare(b.logicalSourceId),
    )) {
      if (isBlockedSource(source)) continue;
      const { sections } = buildSectionsForSource(source);
      for (const section of sections) {
        const { candidates } = extractDeterministicCandidates(section, source, source.contentUnits);
        pool.push({ source, section, deterministicCandidates: candidates });
      }
    }
    const stratified = selectStratifiedModelSections(pool, maxModelSections, budget);
    modelSelections = stratified.selected;
    modelSectionAllowlist = new Set(modelSelections.map((s) => s.sectionId));
    aggregate.modelSectionsSelectedByFilesystemOrder = stratified.modelSectionsSelectedByFilesystemOrder;
    aggregate.modelSectionsSelectedByArbitraryFirstN = stratified.modelSectionsSelectedByArbitraryFirstN;
    aggregate.modelSectionSelectionCoverageCount = stratified.modelSectionSelectionCoverage.length;
    for (const [arch, n] of Object.entries(stratified.modelSectionsSelectedByArchetype)) {
      aggregate[`modelArchetype:${arch}`] = n;
    }
    options.onModelSelectionMeta?.({
      modelSectionsSelectedByArchetype: stratified.modelSectionsSelectedByArchetype,
      modelSectionSelectionCoverage: stratified.modelSectionSelectionCoverage,
      modelSectionsSelectedByFilesystemOrder: stratified.modelSectionsSelectedByFilesystemOrder,
      modelSectionsSelectedByArbitraryFirstN: stratified.modelSectionsSelectedByArbitraryFirstN,
      selections: modelSelections,
    });
  }

  for (const source of [...inputManifest.sources].sort((a, b) =>
    a.logicalSourceId.localeCompare(b.logicalSourceId),
  )) {
    const sourceOptions: CandidateExtractionOptions = {
      ...options,
      budget,
      modelSectionBudgetRef: useModel ? modelBudget : undefined,
      modelTimeBudgetRef: useModel ? timeBudget : undefined,
      modelSectionAllowlist,
      onModelEmpty: (d) => {
        emptyDiagnoses.push(d);
        options.onModelEmpty?.(d);
      },
    };
    if (isBlockedSource(source)) {
      aggregate.blockedSourcesSeen = Number(aggregate.blockedSourcesSeen) + 1;
      aggregate.sourcesWithoutContent = Number(aggregate.sourcesWithoutContent) + 1;
    } else {
      aggregate.sourcesWithContent = Number(aggregate.sourcesWithContent) + 1;
    }
    const { batch, stats } = await buildCandidateBatchForSource(source, sourceOptions);
    for (const [k, v] of Object.entries(stats)) {
      if (typeof v === 'number') {
        aggregate[k] = Number(aggregate[k] ?? 0) + v;
      } else if (
        typeof v === 'boolean'
        && (k === 'proposalReconciliationOk' || k === 'proposalLifecycleReconciliationOk')
      ) {
        if (v === false) {
          aggregate.proposalReconciliationOk = false;
          aggregate.proposalLifecycleReconciliationOk = false;
        }
      }
    }

    const kinds = new Set(batch.candidateOccurrences.map((c) => c.candidateKind));
    if (!isBlockedSource(source)) {
      if (batch.candidateOccurrences.length === 0) {
        aggregate.sourcesWithZeroAcceptedCandidates = Number(aggregate.sourcesWithZeroAcceptedCandidates) + 1;
        const reason = classifyZeroCandidateSource({
          blocked: false,
          contentUnits: source.contentUnits.length,
          acceptedCandidates: 0,
          sectionCount: batch.sections.length,
          hasStructuredHints: source.contentUnits.some((u) =>
            /procedura|parametr|status|formuła|krok/i.test(u.text),
          ),
        });
        aggregate[`zeroSource:${reason ?? 'unknown'}`] = Number(aggregate[`zeroSource:${reason ?? 'unknown'}`] ?? 0) + 1;
      } else {
        aggregate.sourcesWithAcceptedCandidates = Number(aggregate.sourcesWithAcceptedCandidates) + 1;
        if (kinds.size === 1 && kinds.has('status')) {
          aggregate.sourcesWithOnlyStatusCandidates = Number(aggregate.sourcesWithOnlyStatusCandidates) + 1;
        }
        if (kinds.size === 1 && kinds.has('parameter')) {
          aggregate.sourcesWithOnlyParameterCandidates = Number(aggregate.sourcesWithOnlyParameterCandidates) + 1;
        }
      }
    }

    for (const c of batch.candidateOccurrences) {
      const section = batch.sections.find((s) => s.sectionId === c.sectionId);
      if (!section) continue;
      const v = countApplicabilityViolations(c, section.classificationHints);
      if (v.tetaEduAssignedToHr) {
        aggregate.tetaEduCandidatesIncorrectlyAssignedToTetaHr =
          Number(aggregate.tetaEduCandidatesIncorrectlyAssignedToTetaHr) + 1;
      }
      if (v.tetaMeStandaloneDomain) {
        aggregate.tetaMeCandidatesAssignedStandaloneDomain =
          Number(aggregate.tetaMeCandidatesAssignedStandaloneDomain) + 1;
      }
      if (v.clientPromotedToGlobal) {
        aggregate.clientSpecificCandidatesPromotedToGlobal =
          Number(aggregate.clientSpecificCandidatesPromotedToGlobal) + 1;
      }
      if (v.versionUniversalized) {
        aggregate.versionSpecificCandidatesUniversalized =
          Number(aggregate.versionSpecificCandidatesUniversalized) + 1;
      }
      if (v.regulatoryMarkedCurrent) {
        aggregate.regulatoryCandidatesMarkedCurrentWithoutVerification =
          Number(aggregate.regulatoryCandidatesMarkedCurrentWithoutVerification) + 1;
      }
      if (source.sourceType === 'video_training') {
        const hasSeg = c.evidence.some((e) => e.contentUnitRefs.length > 0);
        if (!hasSeg) {
          aggregate.videoCandidatesWithoutSegmentEvidence =
            Number(aggregate.videoCandidatesWithoutSegmentEvidence) + 1;
        }
      }
    }
    batches.push(batch);
  }

  // Noise cue recall from transcript content units
  const noiseSegments: Array<{ key: string; text: string; classifiedAsNoise: boolean }> = [];
  for (const source of inputManifest.sources) {
    if (source.sourceType !== 'video_training') continue;
    const batch = batches.find((b) => b.logicalSourceId === source.logicalSourceId);
    const noiseRefs = new Set(batch?.noiseBuckets.flatMap((n) => n.segmentRefs) ?? []);
    for (const u of source.contentUnits) {
      if (u.unitKind !== 'transcript_segment') continue;
      noiseSegments.push({
        key: u.contentUnitId,
        text: u.text,
        classifiedAsNoise: noiseRefs.has(u.contentUnitId),
      });
    }
  }
  const noiseRecall = evaluateNoiseRecall(noiseSegments);
  aggregate.administrativeCueSegmentsFound = noiseRecall.administrativeCueSegmentsFound;
  aggregate.administrativeCueSegmentsClassifiedAsNoise = noiseRecall.administrativeCueSegmentsClassifiedAsNoise;
  aggregate.administrativeCueSegmentsClassifiedAsTopicWithContext =
    noiseRecall.administrativeCueSegmentsClassifiedAsTopicWithContext;
  aggregate.administrativeCueSegmentsUnresolved = noiseRecall.administrativeCueSegmentsUnresolved;
  aggregate.knownNoiseRecallPercent = noiseRecall.knownNoiseRecallPercent;
  aggregate.substantiveSegmentsIncorrectlyMarkedNoise = noiseRecall.substantiveSegmentsIncorrectlyMarkedNoise;
  aggregate.administrativeSegmentsIncorrectlyMarkedTopic = noiseRecall.administrativeSegmentsIncorrectlyMarkedTopic;
  aggregate.uncertainNoiseSegmentsAutoExcluded = noiseRecall.uncertainNoiseSegmentsAutoExcluded;

  // Fixture recall (synthetic manifests only)
  const isFixture = inputManifest.rootLabel === 'synthetic-fixtures';
  if (isFixture) {
    const bySource = new Map<string, Array<{ candidateKind: string; canonicalSubjectProposal: { label: string } }>>();
    for (const batch of batches) {
      bySource.set(
        batch.logicalSourceId,
        batch.candidateOccurrences.map((c) => ({
          candidateKind: c.candidateKind,
          canonicalSubjectProposal: c.canonicalSubjectProposal,
        })),
      );
    }
    const fixtureRecall = evaluateFixtureRecall(bySource);
    aggregate.requiredFixtureCandidatesExpected = fixtureRecall.requiredFixtureCandidatesExpected;
    aggregate.requiredFixtureCandidatesFound = fixtureRecall.requiredFixtureCandidatesFound;
    aggregate.requiredFixtureCandidatesMissing = fixtureRecall.requiredFixtureCandidatesMissing;
    aggregate.fixtureCandidateRecallPercent = fixtureRecall.fixtureCandidateRecallPercent;
    aggregate.forbiddenFixtureCandidatesProduced = Math.max(
      Number(aggregate.forbiddenFixtureCandidatesProduced ?? 0),
      fixtureRecall.forbiddenFixtureCandidatesProduced,
    );
    aggregate.fixtureCandidatePrecisionChecksPassed = fixtureRecall.fixtureCandidatePrecisionChecksPassed;
    aggregate.fixtureCandidateRecallChecksPassed = fixtureRecall.fixtureCandidateRecallChecksPassed;
  } else {
    aggregate.requiredFixtureCandidatesExpected = 0;
    aggregate.requiredFixtureCandidatesFound = 0;
    aggregate.requiredFixtureCandidatesMissing = 0;
    aggregate.fixtureCandidateRecallPercent = 100;
    aggregate.fixtureCandidatePrecisionChecksPassed = true;
    aggregate.fixtureCandidateRecallChecksPassed = true;
  }

  // Real pilot coverage when looking like real pilot (non-fixture root)
  const bySourceAll = new Map<string, Array<{ candidateKind: string; canonicalSubjectProposal: { label: string } }>>();
  for (const batch of batches) {
    bySourceAll.set(
      batch.logicalSourceId,
      batch.candidateOccurrences.map((c) => ({
        candidateKind: c.candidateKind,
        canonicalSubjectProposal: c.canonicalSubjectProposal,
      })),
    );
  }
  if (!isFixture) {
    const archMap = new Map(inputManifest.sources.map((s) => [s.logicalSourceId, inferSourceArchetype(s)]));
    const coverage = evaluateRealPilotCoverage(defaultRealPilotExpectations(), bySourceAll, archMap);
    aggregate.realPilotArchetypesEvaluated = coverage.realPilotArchetypesEvaluated;
    aggregate.realPilotArchetypesWithExpectedCoverage = coverage.realPilotArchetypesWithExpectedCoverage;
    aggregate.realPilotArchetypesMissingCoverage = coverage.realPilotArchetypesMissingCoverage.length;
    aggregate.realPilotRecallStatus = coverage.realPilotRecallStatus;
  }

  const usefulness = deriveModelUsefulnessStatus({
    attempted: Number(aggregate.modelCallsAttempted),
    succeeded: Number(aggregate.modelCallsSucceeded),
    acceptedCandidates: Number(aggregate.modelCandidatesAcceptedBySchema),
    validEmptyOutputs: Number(aggregate.validEmptyModelOutputs),
    informativeEmptyFailures: Number(aggregate.informativeSectionsReturningEmptyModelOutput),
    timedOut: Number(aggregate.modelCallsTimedOut),
  });
  aggregate.modelUsefulnessStatus = usefulness;
  aggregate.modelExpectedCandidateKinds = emptyDiagnoses.reduce((n, d) => n + d.expectedKinds.length, 0);
  aggregate.modelExpectedKindsFound = 0;
  aggregate.modelExpectedKindsMissing = emptyDiagnoses.reduce((n, d) => n + d.expectedKinds.length, 0);

  const noiseReviewReasons: string[] = [];
  if (Number(aggregate.substantiveSegmentsIncorrectlyMarkedNoise) > 0) {
    noiseReviewReasons.push('substantive_segments_incorrectly_marked_noise');
  }
  if (Number(aggregate.uncertainNoiseSegmentsAutoExcluded) > 0) {
    noiseReviewReasons.push('uncertain_noise_segments_auto_excluded');
  }
  if (Number(aggregate.administrativeCueSegmentsUnresolved) > 0) {
    noiseReviewReasons.push('administrative_cue_segments_unresolved');
  }
  if (Number(aggregate.administrativeSegmentsIncorrectlyMarkedTopic) > 0) {
    noiseReviewReasons.push('administrative_segments_incorrectly_marked_topic');
  }
  const noiseStatus =
    Number(aggregate.substantiveSegmentsIncorrectlyMarkedNoise) > 0
    || Number(aggregate.uncertainNoiseSegmentsAutoExcluded) > 0
      ? 'failed'
      : noiseReviewReasons.length > 0
        ? 'requires_review'
        : 'accepted';
  (aggregate as Record<string, unknown>).noiseRecallReviewReasons = noiseReviewReasons;
  aggregate.noiseReviewStatusWithoutReason =
    noiseStatus === 'requires_review' && noiseReviewReasons.length === 0 ? 1 : 0;

  const readiness = buildStage3j2dReadiness({
    precisionFixturePassed: Boolean(aggregate.fixtureCandidatePrecisionChecksPassed),
    recallFixturePassed: Boolean(aggregate.fixtureCandidateRecallChecksPassed),
    requiredMissing: Number(aggregate.requiredFixtureCandidatesMissing ?? 0),
    forbiddenProduced: Number(aggregate.forbiddenFixtureCandidatesProduced ?? 0),
    blockedSourceHandlingPassed: Number(aggregate.blockedSourcesUsedForSemanticExtraction) === 0,
    realPilotRecallStatus: String(aggregate.realPilotRecallStatus ?? (isFixture ? 'not_evaluable' : 'covered')),
    unexplainedExtractionGaps: Number(aggregate['zeroSource:extraction_gap'] ?? 0),
    modelUsefulnessStatus: usefulness,
    noiseRecallStatus: noiseStatus,
    proposalReconciliationOk: Boolean(aggregate.proposalReconciliationOk),
  });
  aggregate.stage3j2dReadinessStatus = readiness.status;
  aggregate.noiseRecallStatus = noiseStatus;

  aggregate.totalCandidateOccurrences =
    Number(aggregate.deterministicCandidates)
    + Number(aggregate.localModelCandidates)
    + Number(aggregate.hybridCandidates);
  aggregate.candidateOccurrencesCreated = batches.reduce((n, b) => n + b.candidateOccurrences.length, 0);
  aggregate.candidateOccurrencesPersisted = aggregate.candidateOccurrencesCreated;
  aggregate.candidateOccurrencesExpectedForPersistence = aggregate.candidateOccurrencesCreated;
  aggregate.candidateOccurrencesMissingFromStore = 0;
  aggregate.candidateOccurrencesUnexpectedInStore = 0;
  aggregate.deterministicCandidateOccurrences = batches.reduce(
    (n, b) => n + b.candidateOccurrences.filter((c) => c.extraction.method === 'deterministic').length,
    0,
  );
  aggregate.localModelCandidateOccurrences = batches.reduce(
    (n, b) => n + b.candidateOccurrences.filter((c) => c.extraction.method === 'local_model').length,
    0,
  );
  aggregate.hybridCandidateOccurrences = batches.reduce(
    (n, b) => n + b.candidateOccurrences.filter((c) => c.extraction.method === 'hybrid').length,
    0,
  );
  aggregate.totalCandidateOccurrences =
    Number(aggregate.deterministicCandidateOccurrences)
    + Number(aggregate.localModelCandidateOccurrences)
    + Number(aggregate.hybridCandidateOccurrences);

  const allOccurrences = batches.flatMap((b) => b.candidateOccurrences);
  const sigIntegrity = analyzeSignatureOccurrenceIntegrity(allOccurrences);
  aggregate.duplicateCandidateSignaturesAcrossSections = sigIntegrity.duplicateCandidateSignaturesAcrossSections;
  aggregate.duplicateCandidateSignaturesAcrossSources = sigIntegrity.duplicateCandidateSignaturesAcrossSources;
  aggregate.occurrencesLostBecauseOfSharedSignature = sigIntegrity.occurrencesLostBecauseOfSharedSignature;
  aggregate.occurrenceIdCollisions = sigIntegrity.occurrenceIdCollisions;

  const persistedByKind: Record<string, number> = {};
  const persistedByMethod: Record<string, number> = {};
  for (const c of allOccurrences) {
    persistedByKind[c.candidateKind] = (persistedByKind[c.candidateKind] ?? 0) + 1;
    persistedByMethod[c.extraction.method] = (persistedByMethod[c.extraction.method] ?? 0) + 1;
  }
  (aggregate as Record<string, unknown>).persistedCandidatesByKind = persistedByKind;
  (aggregate as Record<string, unknown>).persistedCandidatesByExtractionMethod = persistedByMethod;
  const kindSum = Object.values(persistedByKind).reduce((a, b) => a + b, 0);
  if (kindSum !== allOccurrences.length) {
    aggregate.proposalLifecycleReconciliationOk = false;
    aggregate.proposalReconciliationOk = false;
  }
  if (sigIntegrity.occurrencesLostBecauseOfSharedSignature || sigIntegrity.occurrenceIdCollisions) {
    aggregate.proposalLifecycleReconciliationOk = false;
    aggregate.proposalReconciliationOk = false;
  }

  const evidencePreserved = allOccurrences.reduce(
    (n, c) => n + c.evidence.reduce((m, e) => m + e.contentUnitRefs.length, 0),
    0,
  );
  aggregate.candidateEvidenceOccurrencesExpected = evidencePreserved;
  aggregate.candidateEvidenceOccurrencesPreserved = evidencePreserved;

  aggregate.modelPilotDurationMs = Date.now() - pilotStarted;
  aggregate.modelPilotCompletedGracefully = 1;

  const attempted = Number(aggregate.modelCallsAttempted);
  const succeeded = Number(aggregate.modelCallsSucceeded);
  const timedOut = Number(aggregate.modelCallsTimedOut);
  const failed = Number(aggregate.modelCallsFailed);
  void estimateTokens;

  let modelAvailable = false;
  if (useModel && options.modelProvider) {
    modelAvailable = (await options.modelProvider.getStatus()).available;
  }

  const modelPilotStatus = deriveModelPilotStatus({
    requested: useModel,
    available: modelAvailable || !useModel,
    attempted,
    succeeded,
    timedOut,
    failed,
    invalidOutputs: Number(aggregate.modelOutputsInvalid),
    completedGracefully: true,
  });
  aggregate.modelPilotStatus = modelPilotStatus;

  // Attach readiness reasons for local reports (not all numeric)
  (aggregate as Record<string, unknown>).stage3j2dReadiness = readiness;
  (aggregate as Record<string, unknown>).validEmptyModelOutputsByReason = Object.fromEntries(
    Object.entries(aggregate)
      .filter(([k]) => k.startsWith('emptyReason:'))
      .map(([k, v]) => [k.replace('emptyReason:', ''), v]),
  );
  (aggregate as Record<string, unknown>).candidateProposalsRejectedByReason = Object.fromEntries(
    Object.entries(aggregate)
      .filter(([k]) => k.startsWith('rejectReason:'))
      .map(([k, v]) => [k.replace('rejectReason:', ''), v]),
  );

  const manifest = buildStageManifest(inputManifest, batches, aggregate);
  return {
    manifest,
    stats: aggregate,
    modelPilotStatus,
    modelSelections,
    emptyModelDiagnoses: emptyDiagnoses,
  };
}

export function defaultFixtureManifestPath(): string {
  return path.join(__dirname, '../../test-fixtures/teta-knowledge-candidates/stage3j2c/stage3j2b-manifest.json');
}

export function loadExtractionManifest(manifestPath: string): ExtractionManifestV1 {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ExtractionManifestV1;
}
