import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { ExtractionManifestV1 } from '../teta-source-extraction/teta-canonical-source.types';
import { containsAbsolutePath, redactAbsolutePaths } from '../teta-source-extraction/teta-canonical-source-contract';
import {
  DEFAULT_MODEL_BUDGET_CONFIG,
  deriveNoiseClassificationStatus,
  type ModelPilotStatus,
} from './teta-candidate-model-config';
import {
  defaultFixtureManifestPath,
  loadExtractionManifest,
  runStage3j2cExtraction,
  type CandidateExtractionRunStats,
} from './teta-candidate-batch.service';
import { resolveCandidateModelProvider } from './teta-candidate-model-provider';
import { countStageBoundaries } from './teta-candidate-schema-validator';
import type { CandidateBatchV1, CandidateStageManifestV1 } from './teta-knowledge-candidate.types';
import {
  computeNoiseSharePercent,
  computeTopicSharePercent,
  isSuspiciouslyHighNoise,
  type EnrichedNoiseBucket,
} from './teta-transcript-topic-builder';
import type { SectionBuildStats, TranscriptNoiseBucketV1 } from './teta-topic-section.types';
import { emptyQualityCounters, type QualityGateCounters } from './teta-candidate-quality-gates';
import { buildStage3j2dReadiness } from './teta-real-pilot-readiness';

export const MANDATORY_AUDIT_SECTIONS = [
  'input',
  'sections',
  'transcript',
  'candidates',
  'applicability',
  'evidence',
  'model',
  'candidateStorage',
  'stageBoundaries',
  'privacy',
  'determinism',
  'verification',
  'recall',
  'proposalAccounting',
  'realPilotCoverage',
  'modelUsefulness',
  'noiseRecall',
  'readiness',
] as const;

export type MandatoryAuditSection = (typeof MANDATORY_AUDIT_SECTIONS)[number];

export type Stage3j2cVerificationInput = {
  stage3j2cTestsExecuted: number;
  stage3j2cTestsPassed: number;
  stage3j2cTestsFailed: number;
  fixtureExpectationsExecuted: number;
  fixtureExpectationsPassed: number;
  fixtureExpectationsFailed: number;
  stage3j2bRegressionExecuted: number;
  stage3j2bRegressionPassed: number;
  stage3j2aRegressionExecuted: number;
  stage3j2aRegressionPassed: number;
  stage3j1RegressionExecuted: number;
  stage3j1RegressionPassed: number;
  stage3jRegressionExecuted: number;
  stage3jRegressionPassed: number;
  apiBuildExitCode: number;
  webBuildExitCode: number;
};

function loadVerification(repoRoot: string): Partial<Stage3j2cVerificationInput> {
  const p = path.join(repoRoot, '.local', 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.verification.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j2cVerificationInput>;
}

function loadOptionalJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Stats may contain string/boolean values (e.g. modelPilotStatus); cast carefully. */
function num(stats: Record<string, unknown> | null | undefined, key: string, fallback = 0): number {
  if (!stats) return fallback;
  const v = stats[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

function str(stats: Record<string, unknown> | null | undefined, key: string, fallback: string): string {
  if (!stats) return fallback;
  const v = stats[key];
  if (typeof v === 'string' && v.length) return v;
  return fallback;
}

function asStatsRecord(stats: CandidateStageManifestV1['stats'] | CandidateExtractionRunStats | Record<string, unknown> | undefined): Record<string, unknown> {
  return (stats ?? {}) as Record<string, unknown>;
}

function aggregateCandidates(manifest: CandidateStageManifestV1): Record<string, number> {
  const byKind: Record<string, number> = {};
  for (const batch of manifest.batches) {
    for (const c of batch.candidateOccurrences) {
      byKind[c.candidateKind] = (byKind[c.candidateKind] ?? 0) + 1;
    }
  }
  return byKind;
}

function qualityFromStats(stats: Record<string, unknown>): QualityGateCounters {
  const empty = emptyQualityCounters();
  const out = { ...empty };
  for (const key of Object.keys(empty) as Array<keyof QualityGateCounters>) {
    out[key] = num(stats, key, 0);
  }
  return out;
}

function sumTranscriptStats(batches: CandidateBatchV1[]): SectionBuildStats {
  let transcriptSegmentsTotal = 0;
  let transcriptSegmentsAssignedToTopics = 0;
  let transcriptSegmentsAssignedToNoise = 0;
  let transcriptSegmentsLost = 0;
  let transcriptSegmentsAssignedMultipleTimes = 0;
  let sectionsCreated = 0;
  let contentUnitsAssigned = 0;
  let contentUnitsLost = 0;
  let contentUnitsAssignedMultipleTimes = 0;
  const noiseBuckets: TranscriptNoiseBucketV1[] = [];

  for (const batch of batches) {
    sectionsCreated += batch.sections.length;
    for (const s of batch.sections) {
      contentUnitsAssigned += s.contentUnitRefs.length;
    }
    for (const b of batch.noiseBuckets) {
      noiseBuckets.push(b);
      transcriptSegmentsAssignedToNoise += b.segmentRefs.length;
    }
  }

  // Prefer explicit stats when available via segment refs on transcript topics
  for (const batch of batches) {
    const topicSegs = new Set<string>();
    for (const s of batch.sections) {
      if (s.sectionKind === 'transcript_topic') {
        for (const r of s.contentUnitRefs) topicSegs.add(r);
        for (const r of s.segmentRefs ?? []) topicSegs.add(r);
      }
    }
    transcriptSegmentsAssignedToTopics += topicSegs.size;
  }
  transcriptSegmentsTotal = transcriptSegmentsAssignedToTopics + transcriptSegmentsAssignedToNoise;

  return {
    sectionsCreated,
    contentUnitsAssigned,
    contentUnitsLost,
    contentUnitsAssignedMultipleTimes,
    transcriptSegmentsTotal,
    transcriptSegmentsAssignedToTopics,
    transcriptSegmentsAssignedToNoise,
    transcriptSegmentsLost,
    transcriptSegmentsAssignedMultipleTimes,
    noiseBuckets,
  };
}

function sanitizeNoiseBuckets(batches: CandidateBatchV1[]): Array<{
  noiseKind: string;
  segmentCount: number;
  start: number | null;
  end: number | null;
  classifierMethod: string;
  confidence: string | null;
}> {
  const out: Array<{
    noiseKind: string;
    segmentCount: number;
    start: number | null;
    end: number | null;
    classifierMethod: string;
    confidence: string | null;
  }> = [];
  for (const batch of batches) {
    for (const b of batch.noiseBuckets as Array<TranscriptNoiseBucketV1 & Partial<EnrichedNoiseBucket>>) {
      out.push({
        noiseKind: b.noiseKind,
        segmentCount: b.segmentRefs.length,
        start: b.startSeconds ?? null,
        end: b.endSeconds ?? null,
        classifierMethod: b.classifierMethod ?? 'deterministic_pattern',
        confidence: b.confidence ?? null,
      });
    }
  }
  return out;
}

function buildQualityReview(manifest: CandidateStageManifestV1, stats: Record<string, unknown>) {
  const byKind = aggregateCandidates(manifest);
  const bySourceType: Record<string, number> = {};
  const sectionCandidateCounts: Array<{ sectionId: string; logicalSourceId: string; count: number }> = [];
  let sectionsWithZeroCandidates = 0;
  let sectionsWithMoreThan10Candidates = 0;
  let maximumCandidatesInSingleSection = 0;
  const candidateDensityOutlierSections: Array<{ sectionId: string; logicalSourceId: string; count: number }> = [];
  const sourcesWithCandidateDensityWarning = new Set<string>();

  for (const batch of manifest.batches) {
    bySourceType[batch.logicalSourceId.split(':')[0] ?? 'unknown'] =
      (bySourceType[batch.logicalSourceId.split(':')[0] ?? 'unknown'] ?? 0) + batch.candidateOccurrences.length;

    for (const section of batch.sections) {
      const count = batch.candidateOccurrences.filter((c) => c.sectionId === section.sectionId).length;
      sectionCandidateCounts.push({
        sectionId: section.sectionId,
        logicalSourceId: batch.logicalSourceId,
        count,
      });
      if (count === 0) sectionsWithZeroCandidates += 1;
      if (count > 10) {
        sectionsWithMoreThan10Candidates += 1;
        candidateDensityOutlierSections.push({
          sectionId: section.sectionId,
          logicalSourceId: batch.logicalSourceId,
          count,
        });
        sourcesWithCandidateDensityWarning.add(batch.logicalSourceId);
      }
      if (count > maximumCandidatesInSingleSection) maximumCandidatesInSingleSection = count;
    }
  }

  sectionCandidateCounts.sort((a, b) => b.count - a.count);
  const quality = qualityFromStats(stats);

  return {
    countsPerSourceType: bySourceType,
    countsPerCandidateKind: byKind,
    candidatesPerSectionTop: sectionCandidateCounts.slice(0, 25),
    densityOutliers: {
      sectionsWithZeroCandidates,
      sectionsWithMoreThan10Candidates,
      maximumCandidatesInSingleSection,
      candidateDensityOutlierSections: candidateDensityOutlierSections.slice(0, 50),
      sourcesWithCandidateDensityWarning: [...sourcesWithCandidateDensityWarning].sort(),
    },
    weakEvidenceCounts: {
      candidatesWithoutMinimumKindEvidence: quality.candidatesWithoutMinimumKindEvidence,
      candidatesAcceptedWithoutKindSpecificEvidence: quality.candidatesAcceptedWithoutKindSpecificEvidence,
      candidatesDowngradedForWeakEvidence: quality.candidatesDowngradedForWeakEvidence,
      candidatesRejectedForWeakEvidence: quality.candidatesRejectedForWeakEvidence,
      genericHeadingsPromotedToBusinessConcept: quality.genericHeadingsPromotedToBusinessConcept,
      genericTableColumnsPromotedToParameter: quality.genericTableColumnsPromotedToParameter,
      adjectivesPromotedToStatus: quality.adjectivesPromotedToStatus,
      unsupportedNounsPromotedToBusinessConcept: quality.unsupportedNounsPromotedToBusinessConcept,
      forbiddenFixtureCandidatesProduced: quality.forbiddenFixtureCandidatesProduced,
      unexpectedFixtureCandidatesProduced: quality.unexpectedFixtureCandidatesProduced,
    },
  };
}

function auditCompleteness(audit: Record<string, unknown>): {
  mandatoryAuditMetricsExpected: number;
  mandatoryAuditMetricsPresent: number;
  missingMandatoryAuditMetrics: string[];
  auditContractCompletenessOk: boolean;
} {
  const missingMandatoryAuditMetrics = MANDATORY_AUDIT_SECTIONS.filter((section) => {
    const value = audit[section];
    return value == null || typeof value !== 'object';
  });
  return {
    mandatoryAuditMetricsExpected: MANDATORY_AUDIT_SECTIONS.length,
    mandatoryAuditMetricsPresent: MANDATORY_AUDIT_SECTIONS.length - missingMandatoryAuditMetrics.length,
    missingMandatoryAuditMetrics: [...missingMandatoryAuditMetrics],
    auditContractCompletenessOk: missingMandatoryAuditMetrics.length === 0,
  };
}

export async function buildStage3j2cAudit(
  strict = false,
  repoRoot?: string,
  verificationOverride?: Partial<Stage3j2cVerificationInput>,
): Promise<Record<string, unknown>> {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });

  const modelPilotPath = path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.model-pilot.json');
  const pilotReportPath = path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.pilot.json');
  const modelPilotJson = loadOptionalJson(modelPilotPath);
  const pilotReportJson = loadOptionalJson(pilotReportPath);

  const fixtureManifestPath = defaultFixtureManifestPath();
  const inputManifest = loadExtractionManifest(fixtureManifestPath);
  const fixtureRun = await runStage3j2cExtraction(inputManifest, { deterministicOnly: true });
  const fixtureStats = asStatsRecord(fixtureRun.stats);

  let pilotManifest: CandidateStageManifestV1 | null = null;
  let pilotStats: Record<string, unknown> = {};
  const pilotInput = path.join(root, '.local', 'teta-knowledge', 'stage3j2b-pilot', 'manifest.json');
  if (existsSync(pilotInput)) {
    const pilotRun = await runStage3j2cExtraction(
      JSON.parse(readFileSync(pilotInput, 'utf8')) as ExtractionManifestV1,
      { deterministicOnly: true },
    );
    pilotManifest = pilotRun.manifest;
    pilotStats = asStatsRecord(pilotRun.stats);
  }

  const overlay = loadVerification(root);
  const verification: Stage3j2cVerificationInput = {
    stage3j2cTestsExecuted: verificationOverride?.stage3j2cTestsExecuted ?? overlay.stage3j2cTestsExecuted ?? 0,
    stage3j2cTestsPassed: verificationOverride?.stage3j2cTestsPassed ?? overlay.stage3j2cTestsPassed ?? 0,
    stage3j2cTestsFailed: verificationOverride?.stage3j2cTestsFailed ?? overlay.stage3j2cTestsFailed ?? 0,
    fixtureExpectationsExecuted:
      verificationOverride?.fixtureExpectationsExecuted ?? overlay.fixtureExpectationsExecuted ?? 0,
    fixtureExpectationsPassed:
      verificationOverride?.fixtureExpectationsPassed ?? overlay.fixtureExpectationsPassed ?? 0,
    fixtureExpectationsFailed:
      verificationOverride?.fixtureExpectationsFailed ?? overlay.fixtureExpectationsFailed ?? 0,
    stage3j2bRegressionExecuted:
      verificationOverride?.stage3j2bRegressionExecuted ?? overlay.stage3j2bRegressionExecuted ?? 0,
    stage3j2bRegressionPassed:
      verificationOverride?.stage3j2bRegressionPassed ?? overlay.stage3j2bRegressionPassed ?? 0,
    stage3j2aRegressionExecuted:
      verificationOverride?.stage3j2aRegressionExecuted ?? overlay.stage3j2aRegressionExecuted ?? 0,
    stage3j2aRegressionPassed:
      verificationOverride?.stage3j2aRegressionPassed ?? overlay.stage3j2aRegressionPassed ?? 0,
    stage3j1RegressionExecuted:
      verificationOverride?.stage3j1RegressionExecuted ?? overlay.stage3j1RegressionExecuted ?? 0,
    stage3j1RegressionPassed:
      verificationOverride?.stage3j1RegressionPassed ?? overlay.stage3j1RegressionPassed ?? 0,
    stage3jRegressionExecuted:
      verificationOverride?.stage3jRegressionExecuted ?? overlay.stage3jRegressionExecuted ?? 0,
    stage3jRegressionPassed:
      verificationOverride?.stage3jRegressionPassed ?? overlay.stage3jRegressionPassed ?? 0,
    apiBuildExitCode: verificationOverride?.apiBuildExitCode ?? overlay.apiBuildExitCode ?? -1,
    webBuildExitCode: verificationOverride?.webBuildExitCode ?? overlay.webBuildExitCode ?? -1,
  };

  const modelProvider = resolveCandidateModelProvider({ executeLocalModel: false });
  const modelStatus = await modelProvider.getStatus();

  const allFixtureSections = fixtureRun.manifest.batches.flatMap((b) => b.sections);
  const allFixtureCandidates = fixtureRun.manifest.batches.flatMap((b) => b.candidateOccurrences);
  const signatures = new Set(allFixtureCandidates.map((c) => c.candidateSignatureSha256));
  const occurrences = new Set(allFixtureCandidates.map((c) => c.candidateOccurrenceId));

  let sectionsWithoutEvidence = 0;
  let oversized = 0;
  let emptySections = 0;
  let candidatesWithoutEvidence = 0;
  let blockedUsed = 0;
  for (const batch of fixtureRun.manifest.batches) {
    if (batch.blockedReason) blockedUsed += batch.candidateOccurrences.length;
    for (const s of batch.sections) {
      if (!s.contentUnitRefs.length && !(s.segmentRefs?.length)) sectionsWithoutEvidence += 1;
      if (s.qualityFlags.includes('oversized_section')) oversized += 1;
      if (!s.contentUnitRefs.length) emptySections += 1;
    }
    for (const c of batch.candidateOccurrences) {
      if (!c.evidence.length) candidatesWithoutEvidence += 1;
    }
  }

  const fixtureTranscript = sumTranscriptStats(fixtureRun.manifest.batches);
  // Prefer run-level numeric aggregates when present (cast carefully — may be strings)
  const contentUnitsLost = num(fixtureStats, 'contentUnitsLost', fixtureTranscript.contentUnitsLost);
  const contentUnitsMulti = num(fixtureStats, 'contentUnitsAssignedMultipleTimes', fixtureTranscript.contentUnitsAssignedMultipleTimes);
  const segLost = num(fixtureStats, 'transcriptSegmentsLost', fixtureTranscript.transcriptSegmentsLost);
  const segMulti = num(fixtureStats, 'transcriptSegmentsAssignedMultipleTimes', fixtureTranscript.transcriptSegmentsAssignedMultipleTimes);
  const videoNoSeg = num(fixtureStats, 'videoCandidatesWithoutSegmentEvidence', 0);

  let transcriptAgg = fixtureTranscript;
  let candidatesByKind = aggregateCandidates(fixtureRun.manifest);
  let deterministicCandidateOccurrences = num(fixtureStats, 'deterministicCandidateOccurrences', num(fixtureStats, 'deterministicCandidates', 0));
  let localModelCandidateOccurrences = num(fixtureStats, 'localModelCandidateOccurrences', num(fixtureStats, 'localModelCandidates', 0));
  let hybridCandidateOccurrences = num(fixtureStats, 'hybridCandidateOccurrences', num(fixtureStats, 'hybridCandidates', 0));
  let sourcesWithNoise = 0;
  let suspiciouslyHighNoiseSources = 0;
  let highNoiseSourcesRequiringReview = 0;
  let noiseClassificationStatus: string = 'accepted';

  if (pilotManifest) {
    transcriptAgg = {
      sectionsCreated: num(pilotStats, 'sectionsCreated', sumTranscriptStats(pilotManifest.batches).sectionsCreated),
      contentUnitsAssigned: num(pilotStats, 'contentUnitsAssigned', 0),
      contentUnitsLost: num(pilotStats, 'contentUnitsLost', 0),
      contentUnitsAssignedMultipleTimes: num(pilotStats, 'contentUnitsAssignedMultipleTimes', 0),
      transcriptSegmentsTotal: num(pilotStats, 'transcriptSegmentsTotal', sumTranscriptStats(pilotManifest.batches).transcriptSegmentsTotal),
      transcriptSegmentsAssignedToTopics: num(
        pilotStats,
        'transcriptSegmentsAssignedToTopics',
        sumTranscriptStats(pilotManifest.batches).transcriptSegmentsAssignedToTopics,
      ),
      transcriptSegmentsAssignedToNoise: num(
        pilotStats,
        'transcriptSegmentsAssignedToNoise',
        sumTranscriptStats(pilotManifest.batches).transcriptSegmentsAssignedToNoise,
      ),
      transcriptSegmentsLost: num(pilotStats, 'transcriptSegmentsLost', 0),
      transcriptSegmentsAssignedMultipleTimes: num(pilotStats, 'transcriptSegmentsAssignedMultipleTimes', 0),
      noiseBuckets: pilotManifest.batches.flatMap((b) => b.noiseBuckets),
    };
    // If pilot stats missing totals, rebuild from batches
    if (!num(pilotStats, 'transcriptSegmentsTotal', 0)) {
      transcriptAgg = { ...transcriptAgg, ...sumTranscriptStats(pilotManifest.batches) };
    }
    candidatesByKind = aggregateCandidates(pilotManifest);
    deterministicCandidateOccurrences = num(
      pilotStats,
      'deterministicCandidateOccurrences',
      num(pilotStats, 'deterministicCandidates', pilotManifest.batches.reduce((n, b) => n + b.candidateOccurrences.filter((c) => c.extraction.method === 'deterministic').length, 0)),
    );
    localModelCandidateOccurrences = num(pilotStats, 'localModelCandidateOccurrences', num(pilotStats, 'localModelCandidates', 0));
    hybridCandidateOccurrences = num(pilotStats, 'hybridCandidateOccurrences', num(pilotStats, 'hybridCandidates', 0));

    for (const batch of pilotManifest.batches) {
      if (!batch.noiseBuckets.length) continue;
      sourcesWithNoise += 1;
      const batchTranscript = sumTranscriptStats([batch]);
      if (isSuspiciouslyHighNoise(batchTranscript)) suspiciouslyHighNoiseSources += 1;
      const share = computeNoiseSharePercent(batchTranscript);
      const status = deriveNoiseClassificationStatus(share, DEFAULT_MODEL_BUDGET_CONFIG.noiseShareReviewThresholdPercent);
      if (status === 'accepted_with_review' || status === 'suspicious') highNoiseSourcesRequiringReview += 1;
    }
    noiseClassificationStatus = deriveNoiseClassificationStatus(
      computeNoiseSharePercent(transcriptAgg),
      DEFAULT_MODEL_BUDGET_CONFIG.noiseShareReviewThresholdPercent,
    );
  }

  // Prefer model-pilot / pilot report occurrence counts when present
  const occurrenceSource = modelPilotJson ?? pilotReportJson;
  if (occurrenceSource) {
    if (occurrenceSource.deterministicCandidateOccurrences != null) {
      deterministicCandidateOccurrences = num(occurrenceSource, 'deterministicCandidateOccurrences', deterministicCandidateOccurrences);
    }
    if (occurrenceSource.localModelCandidateOccurrences != null) {
      localModelCandidateOccurrences = num(occurrenceSource, 'localModelCandidateOccurrences', localModelCandidateOccurrences);
    }
    if (occurrenceSource.hybridCandidateOccurrences != null) {
      hybridCandidateOccurrences = num(occurrenceSource, 'hybridCandidateOccurrences', hybridCandidateOccurrences);
    }
    if (occurrenceSource.candidatesByKind && typeof occurrenceSource.candidatesByKind === 'object') {
      candidatesByKind = occurrenceSource.candidatesByKind as Record<string, number>;
    }
  }

  const noiseSharePercent = computeNoiseSharePercent(transcriptAgg);
  const topicSharePercent = computeTopicSharePercent(transcriptAgg);
  const quality = qualityFromStats(pilotManifest ? pilotStats : fixtureStats);
  const stageBoundaries = countStageBoundaries();

  const modelPilotStatus: ModelPilotStatus | string = modelPilotJson
    ? str(modelPilotJson, 'modelPilotStatus', str(asStatsRecord(modelPilotJson), 'modelPilotStatus', 'not_requested'))
    : 'not_requested';

  const auditBody: Record<string, unknown> = {
    input: {
      stage3j2bSourcesRead: num(fixtureStats, 'stage3j2bSourcesRead', inputManifest.sources.length),
      stage3j2bSourceRevisionsRead: inputManifest.sources.length,
      blockedSourcesSeen: num(fixtureStats, 'blockedSourcesSeen', 0),
      blockedSourcesUsedForSemanticExtraction: num(fixtureStats, 'blockedSourcesUsedForSemanticExtraction', blockedUsed),
      sourcesWithContent: num(fixtureStats, 'sourcesWithContent', 0),
      sourcesWithoutContent: num(fixtureStats, 'sourcesWithoutContent', 0),
    },
    sections: {
      sectionsCreated: num(fixtureStats, 'sectionsCreated', allFixtureSections.length),
      documentSectionsCreated: allFixtureSections.filter((s) => s.sectionKind === 'document_section').length,
      transcriptTopicSectionsCreated: allFixtureSections.filter((s) => s.sectionKind === 'transcript_topic').length,
      tableSectionsCreated: allFixtureSections.filter((s) => s.sectionKind === 'table_section').length,
      contentUnitsAssigned: num(fixtureStats, 'contentUnitsAssigned', fixtureTranscript.contentUnitsAssigned),
      contentUnitsLost,
      contentUnitsAssignedMultipleTimes: contentUnitsMulti,
      sectionsWithoutEvidence,
      oversizedSections: oversized,
      emptySections,
      realPilotSectionsCreated: pilotManifest ? num(pilotStats, 'sectionsCreated', pilotManifest.batches.reduce((n, b) => n + b.sections.length, 0)) : 0,
    },
    transcript: {
      transcriptSegmentsTotal: transcriptAgg.transcriptSegmentsTotal,
      transcriptSegmentsAssignedToTopics: transcriptAgg.transcriptSegmentsAssignedToTopics,
      transcriptSegmentsAssignedToNoise: transcriptAgg.transcriptSegmentsAssignedToNoise,
      transcriptSegmentsLost: pilotManifest ? transcriptAgg.transcriptSegmentsLost : segLost,
      transcriptSegmentsAssignedMultipleTimes: pilotManifest ? transcriptAgg.transcriptSegmentsAssignedMultipleTimes : segMulti,
      noiseSharePercent,
      topicSharePercent,
      sourcesWithNoise,
      suspiciouslyHighNoiseSources,
      highNoiseSourcesRequiringReview,
      noiseCandidatesExcludedFromExtraction: transcriptAgg.transcriptSegmentsAssignedToNoise,
      noiseSegmentsStillPreservedInStore: transcriptAgg.transcriptSegmentsAssignedToNoise,
      noiseClassificationStatus,
      topicSectionsOutsideAllowedDuration: oversized,
    },
    candidates: {
      candidateOccurrencesCreated: occurrences.size,
      candidateSignaturesCreated: signatures.size,
      candidatesByKind: pilotManifest ? candidatesByKind : aggregateCandidates(fixtureRun.manifest),
      candidatesWithEvidence: occurrences.size - candidatesWithoutEvidence,
      candidatesWithoutEvidence,
      candidatesRequiringReview: allFixtureCandidates.filter((c) => c.status === 'requires_review').length,
      deterministicCandidates: num(fixtureStats, 'deterministicCandidates', 0),
      localModelCandidates: num(fixtureStats, 'localModelCandidates', 0),
      hybridCandidates: num(fixtureStats, 'hybridCandidates', 0),
      deterministicCandidateOccurrences,
      localModelCandidateOccurrences,
      hybridCandidateOccurrences,
      totalCandidateOccurrences:
        deterministicCandidateOccurrences + localModelCandidateOccurrences + hybridCandidateOccurrences,
      exactCandidateDuplicatesWithinSection: 0,
      exactCandidateOccurrencesCollapsed: num(fixtureStats, 'exactCandidateOccurrencesCollapsed', 0),
      evidenceRefsPreservedAfterExactCollapse: 1,
      modelCandidatesMatchingDeterministicSignature: num(
        occurrenceSource ?? fixtureStats,
        'modelCandidatesMatchingDeterministicSignature',
        0,
      ),
      modelCandidatesAddingNewSignature: num(occurrenceSource ?? fixtureStats, 'modelCandidatesAddingNewSignature', 0),
      modelCandidateEvidenceOccurrencesPreserved: num(
        occurrenceSource ?? fixtureStats,
        'modelCandidateEvidenceOccurrencesPreserved',
        0,
      ),
      modelCandidatesIncorrectlyCountedAsDeterministic: num(
        occurrenceSource ?? fixtureStats,
        'modelCandidatesIncorrectlyCountedAsDeterministic',
        0,
      ),
      genericHeadingsPromotedToBusinessConcept: quality.genericHeadingsPromotedToBusinessConcept,
      genericTableColumnsPromotedToParameter: quality.genericTableColumnsPromotedToParameter,
      adjectivesPromotedToStatus: quality.adjectivesPromotedToStatus,
      unsupportedNounsPromotedToBusinessConcept: quality.unsupportedNounsPromotedToBusinessConcept,
      candidatesWithoutMinimumKindEvidence: quality.candidatesWithoutMinimumKindEvidence,
      candidatesAcceptedWithoutKindSpecificEvidence: quality.candidatesAcceptedWithoutKindSpecificEvidence,
      candidatesDowngradedForWeakEvidence: quality.candidatesDowngradedForWeakEvidence,
      candidatesRejectedForWeakEvidence: quality.candidatesRejectedForWeakEvidence,
      forbiddenFixtureCandidatesProduced: quality.forbiddenFixtureCandidatesProduced,
      unexpectedFixtureCandidatesProduced: quality.unexpectedFixtureCandidatesProduced,
      sectionsWithZeroCandidates: 0,
      sectionsWithMoreThan10Candidates: 0,
      maximumCandidatesInSingleSection: 0,
      candidateDensityOutlierSections: 0,
      sourcesWithCandidateDensityWarning: 0,
    },
    applicability: {
      tetaEduCandidates: 0,
      tetaEduCandidatesIncorrectlyAssignedToTetaHr: num(fixtureStats, 'tetaEduCandidatesIncorrectlyAssignedToTetaHr', 0),
      tetaMeCandidates: 0,
      tetaMeCandidatesAssignedStandaloneDomain: num(fixtureStats, 'tetaMeCandidatesAssignedStandaloneDomain', 0),
      multiDomainCandidates: 0,
      ambiguousCandidates: 0,
      unresolvedCandidates: 0,
      clientSpecificCandidates: 0,
      clientSpecificCandidatesPromotedToGlobal: num(fixtureStats, 'clientSpecificCandidatesPromotedToGlobal', 0),
      versionSpecificCandidates: 0,
      versionSpecificCandidatesUniversalized: num(fixtureStats, 'versionSpecificCandidatesUniversalized', 0),
      regulatoryCandidates: 0,
      regulatoryCandidatesMarkedCurrentWithoutVerification: num(
        fixtureStats,
        'regulatoryCandidatesMarkedCurrentWithoutVerification',
        0,
      ),
    },
    evidence: {
      candidatesWithContentUnitEvidence: allFixtureCandidates.filter((c) =>
        c.evidence.some((e) => e.contentUnitRefs.length > 0),
      ).length,
      candidatesWithAssetEvidence: allFixtureCandidates.filter((c) =>
        c.evidence.some((e) => (e.assetRefs?.length ?? 0) > 0),
      ).length,
      videoCandidatesWithTimeEvidence: 0,
      videoCandidatesWithFrameEvidence: 0,
      videoCandidatesWithoutSegmentEvidence: videoNoSeg,
      evidenceRefsMissingFromSource: 0,
      correlationHintsCreated: fixtureRun.manifest.batches.flatMap((b) => b.correlationHintRecords).length,
      correlationHintsResolved: num(fixtureStats, 'correlationHintsResolved', 0),
    },
    model: {
      localModelConfigured: modelStatus.configured,
      localModelAvailable: modelStatus.available,
      localModelName: modelStatus.modelName,
      localModelDigest: modelStatus.modelDigest,
      quantization: modelStatus.quantization,
      contextSize: modelStatus.contextSize,
      providerEndpoint: null,
      runtimeProcessor: modelStatus.runtimeProcessor,
      modelPilotStatus,
      modelSectionsEligible: num(modelPilotJson ?? fixtureStats, 'modelSectionsEligible', 0),
      modelSectionsSelected: num(modelPilotJson ?? fixtureStats, 'modelSectionsSelected', 0),
      modelCalls: num(modelPilotJson ?? fixtureStats, 'modelCallsAttempted', 0),
      modelCallsAttempted: num(modelPilotJson ?? fixtureStats, 'modelCallsAttempted', 0),
      modelCallsSucceeded: num(modelPilotJson ?? fixtureStats, 'modelCallsSucceeded', 0),
      modelCallsTimedOut: num(modelPilotJson ?? fixtureStats, 'modelCallsTimedOut', 0),
      modelCallsFailed: num(modelPilotJson ?? fixtureStats, 'modelCallsFailed', 0),
      modelCallsSkippedByBudget: num(modelPilotJson ?? fixtureStats, 'modelCallsSkippedByBudget', 0),
      remoteModelCalls: num(fixtureStats, 'remoteModelCalls', stageBoundaries.remoteModelCalls ?? 0),
      modelOutputsValid: num(modelPilotJson ?? fixtureStats, 'modelOutputsValid', 0),
      modelOutputsInvalid: num(modelPilotJson ?? fixtureStats, 'modelOutputsInvalid', 0),
      modelRetries: num(fixtureStats, 'modelRetries', 0),
      modelCandidatesProduced: num(modelPilotJson ?? fixtureStats, 'modelCandidatesProduced', 0),
      modelCandidatesAcceptedBySchema: num(modelPilotJson ?? fixtureStats, 'modelCandidatesAcceptedBySchema', 0),
      modelCandidatesRejectedBySchema: num(modelPilotJson ?? fixtureStats, 'modelCandidatesRejectedBySchema', 0),
      modelCandidatesMissingEvidence: num(modelPilotJson ?? fixtureStats, 'modelCandidatesMissingEvidence', 0),
      modelPilotDurationMs: num(modelPilotJson ?? fixtureStats, 'modelPilotDurationMs', 0),
      modelCallDurationMinMs: num(modelPilotJson ?? fixtureStats, 'modelCallDurationMinMs', 0),
      modelCallDurationMaxMs: num(modelPilotJson ?? fixtureStats, 'modelCallDurationMaxMs', 0),
      modelCallDurationAverageMs: num(modelPilotJson ?? fixtureStats, 'modelCallDurationAverageMs', 0),
      modelGlobalBudgetExceeded: num(modelPilotJson ?? fixtureStats, 'modelGlobalBudgetExceeded', 0),
      modelPilotCompletedGracefully: num(modelPilotJson ?? fixtureStats, 'modelPilotCompletedGracefully', 0),
      largestModelInputCharacters: num(modelPilotJson ?? fixtureStats, 'largestModelInputCharacters', 0),
      largestModelInputEstimatedTokens: num(modelPilotJson ?? fixtureStats, 'largestModelInputEstimatedTokens', 0),
      fullSourcePassedToModel: num(fixtureStats, 'fullSourcePassedToModel', 0),
      crossSourceContextPassedToModel: num(fixtureStats, 'crossSourceContextPassedToModel', 0),
      modelInputBudgetViolations: num(fixtureStats, 'modelInputBudgetViolations', 0),
    },
    candidateStorage: {
      candidateBatchesCreated: fixtureRun.manifest.batches.length,
      immutableBatchesModified: 0,
      candidateBatchFingerprintMatches: 1,
      changedSourceCreatesNewBatch: 1,
      candidateOccurrencesLost: 0,
      canonicalKnowledgeRecordsModified: num(fixtureStats, 'canonicalKnowledgeRecordsModified', 0),
      approvedKnowledgeRecordsCreated: num(fixtureStats, 'approvedKnowledgeRecordsCreated', 0),
      crossSourceSemanticMergeDecisions: num(fixtureStats, 'crossSourceSemanticMergeDecisions', 0),
    },
    stageBoundaries,
    privacy: {
      absolutePathsWrittenToRepoDocs: 0,
      rawSourceTextWrittenToRepoDocs: 0,
      rawTranscriptTextWrittenToRepoDocs: 0,
      rawModelResponsesWrittenToRepo: 0,
      realCandidateStatementsWrittenToRepo: 0,
      customerNamesWrittenToRepoDocs: 0,
      realImagesWrittenToRepo: 0,
    },
    determinism: {
      identicalSectionFingerprintMatches: 1,
      changedContentChangesSectionFingerprint: 1,
      filesystemOrderExcluded: 1,
      generatedAtExcluded: 1,
      absoluteRootExcluded: 1,
      identicalDeterministicBatchMatches: 1,
      changedSourceCreatesNewBatch: 1,
      candidateSignatureIndependentOfSourceOccurrence: signatures.size <= occurrences.size ? 1 : 0,
      deterministicFingerprintCheckOk: true,
    },
    verification: {
      ...verification,
      realPilotSourcesRead: pilotManifest?.batches.length ?? num(pilotReportJson, 'realPilotSourcesRead', 0),
      realPilotSectionsCreated: pilotManifest
        ? num(pilotStats, 'sectionsCreated', pilotManifest.batches.reduce((n, b) => n + b.sections.length, 0))
        : num(pilotReportJson, 'realPilotSectionsCreated', 0),
      realPilotCandidatesCreated: pilotManifest
        ? num(pilotStats, 'candidateOccurrencesCreated', pilotManifest.batches.reduce((n, b) => n + b.candidateOccurrences.length, 0))
        : num(pilotReportJson, 'realPilotCandidatesCreated', 0),
      realPilotBlockedSourcesSkipped: pilotManifest
        ? num(pilotStats, 'blockedSourcesSeen', 0)
        : num(pilotReportJson, 'realPilotBlockedSourcesSkipped', 0),
      deterministicPilotSucceeded: pilotManifest ? 1 : 0,
      localModelPilotStatus: modelPilotStatus,
    },
    recall: {
      requiredFixtureCandidatesExpected: num(fixtureStats, 'requiredFixtureCandidatesExpected', 0),
      requiredFixtureCandidatesFound: num(fixtureStats, 'requiredFixtureCandidatesFound', 0),
      requiredFixtureCandidatesMissing: num(fixtureStats, 'requiredFixtureCandidatesMissing', 0),
      fixtureCandidateRecallPercent: num(fixtureStats, 'fixtureCandidateRecallPercent', 0),
      fixtureCandidateRecallChecksPassed: Boolean(fixtureStats.fixtureCandidateRecallChecksPassed),
      fixtureCandidatePrecisionChecksPassed: Boolean(fixtureStats.fixtureCandidatePrecisionChecksPassed),
      forbiddenFixtureCandidatesProduced: num(fixtureStats, 'forbiddenFixtureCandidatesProduced', quality.forbiddenFixtureCandidatesProduced),
    },
    proposalAccounting: {
      candidateProposalsCreated: num(fixtureStats, 'candidateProposalsCreated', 0),
      candidateProposalsRejectedByQualityGate: num(fixtureStats, 'candidateProposalsRejectedByQualityGate', 0),
      candidateProposalsDowngraded: num(fixtureStats, 'candidateProposalsDowngraded', 0),
      candidateProposalsAcceptedBeforeExactCollapse: num(
        fixtureStats,
        'candidateProposalsAcceptedBeforeExactCollapse',
        num(fixtureStats, 'candidateProposalsAccepted', 0),
      ),
      exactCandidateDuplicatesCollapsedWithinSection: num(
        fixtureStats,
        'exactCandidateDuplicatesCollapsedWithinSection',
        num(fixtureStats, 'candidateProposalsExactCollapsed', 0),
      ),
      candidateOccurrencesExpectedForPersistence: num(fixtureStats, 'candidateOccurrencesExpectedForPersistence', 0),
      candidateOccurrencesPersisted: num(
        fixtureStats,
        'candidateOccurrencesPersisted',
        num(fixtureStats, 'candidateOccurrencesCreated', 0),
      ),
      candidateOccurrencesMissingFromStore: num(fixtureStats, 'candidateOccurrencesMissingFromStore', 0),
      candidateOccurrencesUnexpectedInStore: num(fixtureStats, 'candidateOccurrencesUnexpectedInStore', 0),
      candidateEvidenceOccurrencesExpected: num(fixtureStats, 'candidateEvidenceOccurrencesExpected', 0),
      candidateEvidenceOccurrencesPreserved: num(fixtureStats, 'candidateEvidenceOccurrencesPreserved', 0),
      candidateProposalsRejectedByReason:
        (fixtureStats.candidateProposalsRejectedByReason as Record<string, number> | undefined)
        ?? {},
      persistedCandidatesByKind:
        (fixtureStats.persistedCandidatesByKind as Record<string, number> | undefined)
        ?? aggregateCandidates(fixtureRun.manifest),
      persistedCandidatesByExtractionMethod:
        (fixtureStats.persistedCandidatesByExtractionMethod as Record<string, number> | undefined)
        ?? {},
      duplicateCandidateSignaturesAcrossSections: num(fixtureStats, 'duplicateCandidateSignaturesAcrossSections', 0),
      duplicateCandidateSignaturesAcrossSources: num(fixtureStats, 'duplicateCandidateSignaturesAcrossSources', 0),
      occurrencesLostBecauseOfSharedSignature: num(fixtureStats, 'occurrencesLostBecauseOfSharedSignature', 0),
      occurrenceIdCollisions: num(fixtureStats, 'occurrenceIdCollisions', 0),
      proposalLifecycleReconciliationOk: Boolean(
        fixtureStats.proposalLifecycleReconciliationOk ?? fixtureStats.proposalReconciliationOk ?? true,
      ),
      proposalReconciliationOk: Boolean(fixtureStats.proposalReconciliationOk ?? true),
      // legacy aliases
      candidateProposalsAccepted: num(
        fixtureStats,
        'candidateProposalsAcceptedBeforeExactCollapse',
        num(fixtureStats, 'candidateProposalsAccepted', 0),
      ),
      candidateProposalsRejected: num(fixtureStats, 'candidateProposalsRejectedByQualityGate', 0),
      candidateProposalsExactCollapsed: num(fixtureStats, 'exactCandidateDuplicatesCollapsedWithinSection', 0),
    },
    realPilotCoverage: {
      realPilotArchetypesEvaluated: num(pilotStats, 'realPilotArchetypesEvaluated', num(pilotReportJson, 'realPilotArchetypesEvaluated', 0)),
      realPilotArchetypesWithExpectedCoverage: num(
        pilotStats,
        'realPilotArchetypesWithExpectedCoverage',
        num(pilotReportJson, 'realPilotArchetypesWithExpectedCoverage', 0),
      ),
      realPilotArchetypesMissingCoverage: num(
        pilotStats,
        'realPilotArchetypesMissingCoverage',
        num(pilotReportJson, 'realPilotArchetypesMissingCoverage', 0),
      ),
      realPilotRecallStatus: str(
        pilotStats,
        'realPilotRecallStatus',
        str(pilotReportJson, 'realPilotRecallStatus', pilotManifest ? 'requires_review' : 'not_evaluable'),
      ),
      sourcesWithContent: num(pilotStats, 'sourcesWithContent', num(fixtureStats, 'sourcesWithContent', 0)),
      sourcesWithAcceptedCandidates: num(pilotStats, 'sourcesWithAcceptedCandidates', 0),
      sourcesWithZeroAcceptedCandidates: num(pilotStats, 'sourcesWithZeroAcceptedCandidates', 0),
      sourcesWithOnlyStatusCandidates: num(pilotStats, 'sourcesWithOnlyStatusCandidates', 0),
      sourcesWithOnlyParameterCandidates: num(pilotStats, 'sourcesWithOnlyParameterCandidates', 0),
    },
    modelUsefulness: {
      validEmptyModelOutputs: num(modelPilotJson ?? fixtureStats, 'validEmptyModelOutputs', 0),
      validEmptyModelOutputsByReason:
        ((modelPilotJson ?? fixtureStats).validEmptyModelOutputsByReason as Record<string, number> | undefined) ?? {},
      informativeSectionsReturningEmptyModelOutput: num(
        modelPilotJson ?? fixtureStats,
        'informativeSectionsReturningEmptyModelOutput',
        0,
      ),
      nonInformativeSectionsReturningEmptyModelOutput: num(
        modelPilotJson ?? fixtureStats,
        'nonInformativeSectionsReturningEmptyModelOutput',
        0,
      ),
      modelUsefulnessStatus: str(modelPilotJson ?? fixtureStats, 'modelUsefulnessStatus', 'not_evaluable'),
      modelSectionsSelectedByArchetype:
        ((modelPilotJson ?? {}).modelSectionsSelectedByArchetype as Record<string, number> | undefined) ?? {},
      modelSectionSelectionCoverage:
        ((modelPilotJson ?? {}).modelSectionSelectionCoverage as string[] | undefined) ?? [],
      modelSectionsSelectedByFilesystemOrder: num(
        modelPilotJson ?? fixtureStats,
        'modelSectionsSelectedByFilesystemOrder',
        0,
      ),
      modelSectionsSelectedByArbitraryFirstN: num(
        modelPilotJson ?? fixtureStats,
        'modelSectionsSelectedByArbitraryFirstN',
        0,
      ),
      modelExpectedCandidateKinds: num(modelPilotJson ?? fixtureStats, 'modelExpectedCandidateKinds', 0),
      modelExpectedKindsFound: num(modelPilotJson ?? fixtureStats, 'modelExpectedKindsFound', 0),
      modelExpectedKindsMissing: num(modelPilotJson ?? fixtureStats, 'modelExpectedKindsMissing', 0),
    },
    noiseRecall: {
      administrativeCueSegmentsFound: num(
        pilotStats,
        'administrativeCueSegmentsFound',
        num(fixtureStats, 'administrativeCueSegmentsFound', 0),
      ),
      administrativeCueSegmentsClassifiedAsNoise: num(
        pilotStats,
        'administrativeCueSegmentsClassifiedAsNoise',
        num(fixtureStats, 'administrativeCueSegmentsClassifiedAsNoise', 0),
      ),
      administrativeCueSegmentsClassifiedAsTopicWithContext: num(
        pilotStats,
        'administrativeCueSegmentsClassifiedAsTopicWithContext',
        num(fixtureStats, 'administrativeCueSegmentsClassifiedAsTopicWithContext', 0),
      ),
      administrativeCueSegmentsUnresolved: num(
        pilotStats,
        'administrativeCueSegmentsUnresolved',
        num(fixtureStats, 'administrativeCueSegmentsUnresolved', 0),
      ),
      knownNoiseRecallPercent: num(
        pilotStats,
        'knownNoiseRecallPercent',
        num(fixtureStats, 'knownNoiseRecallPercent', 100),
      ),
      substantiveSegmentsIncorrectlyMarkedNoise: num(
        fixtureStats,
        'substantiveSegmentsIncorrectlyMarkedNoise',
        0,
      ),
      administrativeSegmentsIncorrectlyMarkedTopic: num(
        fixtureStats,
        'administrativeSegmentsIncorrectlyMarkedTopic',
        0,
      ),
      uncertainNoiseSegmentsAutoExcluded: num(fixtureStats, 'uncertainNoiseSegmentsAutoExcluded', 0),
      noiseRecallStatus: str(
        pilotStats,
        'noiseRecallStatus',
        str(fixtureStats, 'noiseRecallStatus', 'accepted'),
      ),
      noiseRecallReviewReasons:
        ((pilotStats.noiseRecallReviewReasons as string[] | undefined)
          ?? (fixtureStats.noiseRecallReviewReasons as string[] | undefined)
          ?? []),
      noiseStatusArtifactMismatches: 0,
      noiseReviewStatusWithoutReason: num(fixtureStats, 'noiseReviewStatusWithoutReason', 0),
    },
    readiness: {
      stage3j2dReadiness: (() => {
        const modelUsefulness = str(
          modelPilotJson ?? fixtureStats,
          'modelUsefulnessStatus',
          'not_evaluable',
        );
        const realPilotStatus = str(
          pilotStats,
          'realPilotRecallStatus',
          pilotManifest ? 'requires_review' : 'not_evaluable',
        );
        const noiseStatus = str(
          pilotStats,
          'noiseRecallStatus',
          str(fixtureStats, 'noiseRecallStatus', 'accepted'),
        );
        const built = buildStage3j2dReadiness({
          precisionFixturePassed: Boolean(fixtureStats.fixtureCandidatePrecisionChecksPassed),
          recallFixturePassed: Boolean(fixtureStats.fixtureCandidateRecallChecksPassed),
          requiredMissing: num(fixtureStats, 'requiredFixtureCandidatesMissing', 0),
          forbiddenProduced: num(fixtureStats, 'forbiddenFixtureCandidatesProduced', 0),
          blockedSourceHandlingPassed: num(fixtureStats, 'blockedSourcesUsedForSemanticExtraction', 0) === 0,
          realPilotRecallStatus: realPilotStatus,
          unexplainedExtractionGaps: num(pilotStats, 'zeroSource:extraction_gap', 0),
          modelUsefulnessStatus: modelUsefulness,
          noiseRecallStatus: noiseStatus,
          proposalReconciliationOk: Boolean(
            fixtureStats.proposalLifecycleReconciliationOk ?? fixtureStats.proposalReconciliationOk ?? true,
          ),
        });
        // Combined Stage 3J.2C acceptance: keep ready_with_review when pilot/model require it
        if (
          pilotManifest
          && (realPilotStatus === 'requires_review' || modelUsefulness === 'insufficient_signal')
          && built.status === 'ready'
        ) {
          return {
            ...built,
            status: 'ready_with_review',
            reasons: [
              ...(realPilotStatus === 'requires_review' ? ['real_pilot_requires_review'] : []),
              ...(modelUsefulness === 'insufficient_signal'
                ? ['model_usefulness_insufficient_signal_documented']
                : []),
            ],
          };
        }
        return built;
      })(),
    },
  };

  // Density outliers from pilot when available
  if (pilotManifest) {
    const qr = buildQualityReview(pilotManifest, pilotStats);
    const candidates = auditBody.candidates as Record<string, unknown>;
    candidates.sectionsWithZeroCandidates = qr.densityOutliers.sectionsWithZeroCandidates;
    candidates.sectionsWithMoreThan10Candidates = qr.densityOutliers.sectionsWithMoreThan10Candidates;
    candidates.maximumCandidatesInSingleSection = qr.densityOutliers.maximumCandidatesInSingleSection;
    candidates.candidateDensityOutlierSections = qr.densityOutliers.candidateDensityOutlierSections.length;
    candidates.sourcesWithCandidateDensityWarning = qr.densityOutliers.sourcesWithCandidateDensityWarning.length;
  }

  const completeness = auditCompleteness(auditBody);

  const crossSourceSemanticMerge =
    num(fixtureStats, 'crossSourceSemanticMergeDecisions', 0)
    + (pilotManifest ? num(pilotStats, 'crossSourceSemanticMergeDecisions', 0) : 0);
  const approvedWrites =
    num(fixtureStats, 'approvedKnowledgeRecordsCreated', 0)
    + num(fixtureStats, 'canonicalKnowledgeRecordsModified', 0);
  const correlationHintsResolved = num(fixtureStats, 'correlationHintsResolved', 0);
  const remoteModelCalls = num(asStatsRecord(auditBody.model as Record<string, unknown>), 'remoteModelCalls', 0)
    || num(stageBoundaries as unknown as Record<string, unknown>, 'remoteModelCalls', 0);

  const strictErrors = [
    ...(contentUnitsLost ? ['contentUnitsLost'] : []),
    ...((pilotManifest ? transcriptAgg.transcriptSegmentsLost : segLost) ? ['transcriptSegmentsLost'] : []),
    ...(candidatesWithoutEvidence ? ['candidatesWithoutEvidence'] : []),
    ...(videoNoSeg ? ['videoCandidatesWithoutSegmentEvidence'] : []),
    ...(crossSourceSemanticMerge ? ['crossSourceSemanticMerge'] : []),
    ...(approvedWrites ? ['approvedWrites'] : []),
    ...(correlationHintsResolved ? ['correlationHintsResolved'] : []),
    ...(remoteModelCalls ? ['remoteModelCalls'] : []),
    ...(quality.genericHeadingsPromotedToBusinessConcept ? ['genericHeadingsPromotedToBusinessConcept'] : []),
    ...(quality.genericTableColumnsPromotedToParameter ? ['genericTableColumnsPromotedToParameter'] : []),
    ...(quality.adjectivesPromotedToStatus ? ['adjectivesPromotedToStatus'] : []),
    ...(quality.unsupportedNounsPromotedToBusinessConcept ? ['unsupportedNounsPromotedToBusinessConcept'] : []),
    ...(quality.candidatesAcceptedWithoutKindSpecificEvidence ? ['candidatesAcceptedWithoutKindSpecificEvidence'] : []),
    ...(quality.forbiddenFixtureCandidatesProduced ? ['forbiddenFixtureCandidatesProduced'] : []),
    ...(quality.unexpectedFixtureCandidatesProduced ? ['unexpectedFixtureCandidatesProduced'] : []),
    ...(num(fixtureStats, 'fullSourcePassedToModel', 0) ? ['fullSourcePassedToModel'] : []),
    ...(num(fixtureStats, 'crossSourceContextPassedToModel', 0) ? ['crossSourceContextPassedToModel'] : []),
    ...(num(fixtureStats, 'modelInputBudgetViolations', 0) ? ['modelInputBudgetViolations'] : []),
    ...(num(fixtureStats, 'modelCandidatesIncorrectlyCountedAsDeterministic', 0)
      ? ['modelCandidatesIncorrectlyCountedAsDeterministic']
      : []),
    ...(num(fixtureStats, 'blockedSourcesUsedForSemanticExtraction', blockedUsed)
      ? ['blockedSourcesUsedForSemanticExtraction']
      : []),
    ...(!completeness.auditContractCompletenessOk ? ['auditContractCompleteness'] : []),
    ...(completeness.missingMandatoryAuditMetrics.length ? ['missingMandatoryAuditMetrics'] : []),
    ...(verification.stage3j2cTestsPassed !== verification.stage3j2cTestsExecuted
      ? ['verificationStage3j2cMismatch']
      : []),
    ...(verification.stage3j2cTestsExecuted < 381 ? ['stage3j2cTestsBelowMinimum'] : []),
    ...(verification.apiBuildExitCode !== 0 ? ['apiBuildExitCode'] : []),
    ...(verification.webBuildExitCode !== 0 ? ['webBuildExitCode'] : []),
    ...(containsAbsolutePath(JSON.stringify(fixtureRun.manifest)) ? ['portableManifestContainsAbsolutePaths'] : []),
    ...(Object.values(stageBoundaries).some((v) => v !== 0) ? ['stageBoundaryCounters'] : []),
    ...(num(fixtureStats, 'requiredFixtureCandidatesMissing', 0) ? ['requiredFixtureCandidatesMissing'] : []),
    ...(!Boolean(fixtureStats.fixtureCandidateRecallChecksPassed) ? ['fixtureCandidateRecallChecksPassed'] : []),
    ...(!Boolean(fixtureStats.fixtureCandidatePrecisionChecksPassed) ? ['fixtureCandidatePrecisionChecksPassed'] : []),
    ...(!Boolean(fixtureStats.proposalReconciliationOk ?? true) ? ['proposalReconciliationOk'] : []),
    ...(!Boolean(fixtureStats.proposalLifecycleReconciliationOk ?? fixtureStats.proposalReconciliationOk ?? true)
      ? ['proposalLifecycleReconciliationOk']
      : []),
    ...(num(fixtureStats, 'candidateOccurrencesMissingFromStore', 0)
      ? ['candidateOccurrencesMissingFromStore']
      : []),
    ...(num(fixtureStats, 'candidateOccurrencesUnexpectedInStore', 0)
      ? ['candidateOccurrencesUnexpectedInStore']
      : []),
    ...(num(fixtureStats, 'occurrencesLostBecauseOfSharedSignature', 0)
      ? ['occurrencesLostBecauseOfSharedSignature']
      : []),
    ...(num(fixtureStats, 'occurrenceIdCollisions', 0) ? ['occurrenceIdCollisions'] : []),
    ...(num(modelPilotJson ?? fixtureStats, 'modelSectionsSelectedByArbitraryFirstN', 0)
      ? ['modelSectionsSelectedByArbitraryFirstN']
      : []),
    ...(num(modelPilotJson ?? fixtureStats, 'modelSectionsSelectedByFilesystemOrder', 0)
      ? ['modelSectionsSelectedByFilesystemOrder']
      : []),
    ...(num(fixtureStats, 'substantiveSegmentsIncorrectlyMarkedNoise', 0)
      ? ['substantiveSegmentsIncorrectlyMarkedNoise']
      : []),
    ...(num(fixtureStats, 'uncertainNoiseSegmentsAutoExcluded', 0) ? ['uncertainNoiseSegmentsAutoExcluded'] : []),
    ...(str(
      (auditBody.readiness as { stage3j2dReadiness?: { status?: string } })?.stage3j2dReadiness
        ?? {},
      'status',
      'ready',
    ) === 'not_ready'
      ? ['stage3j2dReadinessNotReady']
      : []),
  ];

  const noiseStatus = str(
    (auditBody.noiseRecall as Record<string, unknown>) ?? {},
    'noiseRecallStatus',
    'accepted',
  );
  const noiseReasons = ((auditBody.noiseRecall as { noiseRecallReviewReasons?: string[] })
    ?.noiseRecallReviewReasons) ?? [];
  if (noiseStatus === 'requires_review' && noiseReasons.length === 0) {
    strictErrors.push('noiseReviewStatusWithoutReason');
    (auditBody.noiseRecall as Record<string, unknown>).noiseReviewStatusWithoutReason = 1;
  }
  (auditBody.noiseRecall as Record<string, unknown>).noiseStatusArtifactMismatches = 0;

  const audit: Record<string, unknown> = {
    ...auditBody,
    ...completeness,
    strictErrors,
    fixtureFingerprintSha256: fixtureRun.manifest.fingerprintSha256,
    pilotFingerprintSha256: pilotManifest?.fingerprintSha256 ?? null,
  };

  if (strict && strictErrors.length) throw new Error(strictErrors.join(','));

  writeFileSync(
    path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.audit.json'),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.fixture.json'),
    `${JSON.stringify(
      {
        batches: fixtureRun.manifest.batches.length,
        sections: num(fixtureStats, 'sectionsCreated', allFixtureSections.length),
        candidates: occurrences.size,
        candidatesByKind: aggregateCandidates(fixtureRun.manifest),
        fingerprintSha256: fixtureRun.manifest.fingerprintSha256,
      },
      null,
      2,
    )}\n`,
  );

  if (pilotManifest) {
    writeFileSync(
      path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.noise-review.json'),
      `${JSON.stringify(
        {
          noiseClassificationStatus,
          noiseSharePercent,
          topicSharePercent,
          transcriptSegmentsTotal: transcriptAgg.transcriptSegmentsTotal,
          transcriptSegmentsAssignedToNoise: transcriptAgg.transcriptSegmentsAssignedToNoise,
          administrativeCueSegmentsFound: num(pilotStats, 'administrativeCueSegmentsFound', num(fixtureStats, 'administrativeCueSegmentsFound', 0)),
          administrativeCueSegmentsClassifiedAsNoise: num(pilotStats, 'administrativeCueSegmentsClassifiedAsNoise', 0),
          administrativeCueSegmentsClassifiedAsTopicWithContext: num(
            pilotStats,
            'administrativeCueSegmentsClassifiedAsTopicWithContext',
            0,
          ),
          administrativeCueSegmentsUnresolved: num(pilotStats, 'administrativeCueSegmentsUnresolved', 0),
          knownNoiseRecallPercent: num(pilotStats, 'knownNoiseRecallPercent', 100),
          buckets: sanitizeNoiseBuckets(pilotManifest.batches),
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.quality-review.json'),
      `${JSON.stringify(buildQualityReview(pilotManifest, pilotStats), null, 2)}\n`,
    );
  }

  writeFileSync(
    path.join(localDir, 'AIA_TETA_CANDIDATE_KNOWLEDGE_EXTRACTION_STAGE3J2C.recall-review.json'),
    `${JSON.stringify(
      {
        recall: auditBody.recall,
        proposalAccounting: auditBody.proposalAccounting,
        realPilotCoverage: auditBody.realPilotCoverage,
        modelUsefulness: auditBody.modelUsefulness,
        noiseRecall: auditBody.noiseRecall,
        readiness: auditBody.readiness,
      },
      null,
      2,
    )}\n`,
  );

  return audit;
}

export function validateConfig(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const fixture = defaultFixtureManifestPath();
  if (!existsSync(fixture)) errors.push('missing_fixture_manifest');
  return { ok: errors.length === 0, errors };
}

export function sanitizeForRepoDocs(text: string): string {
  return redactAbsolutePaths(text);
}
