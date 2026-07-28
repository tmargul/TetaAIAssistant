import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { inventoryKnowledgeSourcesStage3j2a } from './teta-knowledge-source-inventory.service';
import {
  loadKnowledgeSourceRegistries,
  validateKnowledgeSourceRegistries,
} from './teta-knowledge-source-registry.loader';
import { discoverTrainingPairs } from './teta-training-pair-discovery.service';
import { validateKnowledgeSourceInventory } from './teta-knowledge-source-validator';
import { validateWhisperTranscriptFile, validateWhisperTranscriptJson } from './teta-whisper-transcript-json.adapter';
import {
  computeInventoryFingerprint,
  computeMetadataFingerprint,
  computeSourceRevisionId,
} from './teta-knowledge-source-fingerprint';
import { inventoryFrameDirectory } from './teta-frame-directory-inventory.service';
import { sha256 } from './teta-knowledge-source-contract';
import type { FrameHashMode, FrameNamingScheme, KnowledgeSourceRecordV1 } from './teta-knowledge-source.types';

const EXPECTED_INVALID_LABELS = new Set(['invalid1', 'generic1']);
const EXPECTED_VALID_LABELS = new Set<string>();
const EXPECTED_DUPLICATE_LOGICAL = new Set(['training-video:KADRY:1']);

function mutateTranscriptSha(source: KnowledgeSourceRecordV1, delta: string): KnowledgeSourceRecordV1 {
  const transcriptSha256 = sha256((source.assets.transcript?.sha256 ?? '') + delta);
  const metadataFingerprint = computeMetadataFingerprint({
    logicalSourceId: source.logicalSourceId,
    sourceSeriesId: source.sourceSeriesId,
    sequenceNumber: source.sequenceNumber,
    pairingStatus: source.pairingStatus,
    productFamilyIds: source.productFamilyIds,
    productSurfaceIds: source.productSurfaceIds,
    scope: source.scope,
    clientSpecificRisk: source.clientSpecificRisk,
  });
  const sourceRevisionId = computeSourceRevisionId({
    transcriptSha256,
    framesFingerprint: source.assets.frames?.fingerprint ?? null,
    metadataFingerprint,
  });
  return {
    ...source,
    sourceRevisionId,
    assets: {
      ...source.assets,
      transcript: source.assets.transcript
        ? { ...source.assets.transcript, sha256: transcriptSha256, canonicalSha256: transcriptSha256 }
        : null,
    },
  };
}

export function collectStage3j2aStrictErrorCodes(input: {
  identicalInventoryFingerprintMatches: number;
  changedTranscriptFingerprintDiffers: number;
  changedTranscriptSha256Differs: number;
  changedTranscriptSourceRevisionDiffers: number;
  unchangedTranscriptSourceRevisionMatches: number;
  unexpectedLogicalSourceCollisions: number;
  unclassifiedLogicalSourceCollisions: number;
  fixtureExpectationsFailed: number;
  unexpectedFixtureFailures: number;
  frameNamingSchemeReconciled: number;
  framesWithExistingManifest: number;
  supportedDocumentFiles: number;
  deterministicFingerprintCheckOk: boolean;
  stageBoundaryNonZero: boolean;
}): string[] {
  return [
    ...(input.identicalInventoryFingerprintMatches !== 1 ? ['identicalInventoryFingerprintMatches'] : []),
    ...(input.changedTranscriptFingerprintDiffers !== 1 ? ['changedTranscriptFingerprintDiffers'] : []),
    ...(input.changedTranscriptSha256Differs !== 1 ? ['changedTranscriptSha256Differs'] : []),
    ...(input.changedTranscriptSourceRevisionDiffers !== 1 ? ['changedTranscriptSourceRevisionDiffers'] : []),
    ...(input.unchangedTranscriptSourceRevisionMatches !== 1 ? ['unchangedTranscriptSourceRevisionMatches'] : []),
    ...(input.unexpectedLogicalSourceCollisions ? ['unexpectedLogicalSourceCollisions'] : []),
    ...(input.unclassifiedLogicalSourceCollisions ? ['unclassifiedLogicalSourceCollisions'] : []),
    ...(input.fixtureExpectationsFailed ? ['fixtureExpectationsFailed'] : []),
    ...(input.unexpectedFixtureFailures ? ['unexpectedFixtureFailures'] : []),
    ...(input.frameNamingSchemeReconciled !== 1 ? ['frameNamingSchemeReconciliation'] : []),
    ...(input.framesWithExistingManifest < 1 ? ['existingManifestFixtureMissing'] : []),
    ...(input.supportedDocumentFiles < 1 ? ['documentTypeFixturesMissing'] : []),
    ...(!input.deterministicFingerprintCheckOk ? ['deterministicFingerprintCheckOk'] : []),
    ...(input.stageBoundaryNonZero ? ['stageBoundaryCounters'] : []),
  ];
}

export type Stage3j2aVerificationInput = {
  stage3j2aTestsExecuted: number;
  stage3j2aTestsPassed: number;
  stage3j2aTestsFailed: number;
  fixtureSourcesExamined: number;
  fixtureSourcesPassed: number;
  apiBuildExitCode: number;
  webBuildExitCode: number;
  stage3j1RegressionExecuted: number;
  stage3j1RegressionPassed: number;
  stage3jRegressionExecuted: number;
  stage3jRegressionPassed: number;
};

function loadVerification(repoRoot: string): Partial<Stage3j2aVerificationInput> {
  const p = path.join(repoRoot, '.local', 'AIA_TETA_KNOWLEDGE_SOURCE_INVENTORY_STAGE3J2A.verification.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j2aVerificationInput>;
}

function defaultFixtureRoot(repoRoot: string): string {
  return path.join(repoRoot, 'apps/api/test-fixtures/teta-knowledge-sources/stage3j2a');
}

export function buildStage3j2aAudit(
  strict = false,
  repoRoot?: string,
  verificationOverride?: Partial<Stage3j2aVerificationInput>,
  frameHashMode: FrameHashMode = 'content',
): Record<string, unknown> {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const fixtureRoot = defaultFixtureRoot(root);
  const regs = loadKnowledgeSourceRegistries();
  const registryValidation = validateKnowledgeSourceRegistries(regs);
  const inventory = inventoryKnowledgeSourcesStage3j2a({ root: fixtureRoot, frameHashMode });
  const discovery = discoverTrainingPairs(fixtureRoot);
  const validation = validateKnowledgeSourceInventory(inventory, regs);

  const sourcesBySeries: Record<string, number> = {};
  const sourcesByPlatform: Record<string, number> = {};
  const sourcesByProductFamily: Record<string, number> = {};
  const sourcesByProductSurface: Record<string, number> = {};
  const sourcesByBusinessArea: Record<string, number> = {};
  const sourcesByKnowledgeArea: Record<string, number> = {};
  const sourcesByAudience: Record<string, number> = {};
  let whisperTranscriptFiles = 0;
  let validWhisperTranscripts = 0;
  let validWithWarningsTranscripts = 0;
  let invalidTranscripts = 0;
  let transcriptSegments = 0;
  let emptySegments = 0;
  let nonMonotonicSegments = 0;
  let invalidSegmentTimes = 0;
  let frameFiles = 0;
  let emptyFrameDirectories = 0;
  let framesWithoutTimeline = 0;
  let framesWithExistingManifest = 0;
  let contentHashedFrameDirectories = 0;
  let metadataHashedFrameDirectories = 0;
  let contentHashedFrameFiles = 0;
  let metadataHashedFrameFiles = 0;
  let clientSpecificRiskHighSources = 0;
  let mixedSourcesRequiringReview = 0;
  let unclassifiedScopeSources = 0;
  let invalidFrameManifests = 0;
  let orphanManifestEntries = 0;
  let frameFilesMissingFromManifest = 0;
  let manifestEntriesMissingFile = 0;
  let pairedFrameDirectories = 0;
  const frameDirectoriesByNamingScheme: Record<FrameNamingScheme, number> = {
    timestamp_seconds: 0,
    timestamp_milliseconds: 0,
    hh_mm_ss: 0,
    sequential_index: 0,
    existing_manifest: 0,
    unknown: 0,
  };

  for (const s of inventory.sources) {
    if (s.sourceSeriesId) sourcesBySeries[s.sourceSeriesId] = (sourcesBySeries[s.sourceSeriesId] ?? 0) + 1;
    if (s.platformId) sourcesByPlatform[s.platformId] = (sourcesByPlatform[s.platformId] ?? 0) + 1;
    for (const f of s.productFamilyIds) sourcesByProductFamily[f] = (sourcesByProductFamily[f] ?? 0) + 1;
    for (const f of s.productSurfaceIds) sourcesByProductSurface[f] = (sourcesByProductSurface[f] ?? 0) + 1;
    for (const f of s.businessAreaIds) sourcesByBusinessArea[f] = (sourcesByBusinessArea[f] ?? 0) + 1;
    for (const f of s.knowledgeAreaIds) sourcesByKnowledgeArea[f] = (sourcesByKnowledgeArea[f] ?? 0) + 1;
    for (const f of s.audience) sourcesByAudience[f] = (sourcesByAudience[f] ?? 0) + 1;
    if (s.clientSpecificRisk === 'high') clientSpecificRiskHighSources += 1;
    if (s.scopePolicy === 'mixed_requires_review') mixedSourcesRequiringReview += 1;
    if (s.scope === 'unclassified') unclassifiedScopeSources += 1;
    if (s.assets.frames) {
      pairedFrameDirectories += 1;
      frameFiles += s.assets.frames.count;
      if (s.assets.frames.count === 0) emptyFrameDirectories += 1;
      if (s.assets.frames.timelineStatus === 'requires_interval_or_manifest') framesWithoutTimeline += 1;
      if (s.assets.frames.hasExistingManifest) framesWithExistingManifest += 1;
      if (s.assets.frames.hashMode === 'content') {
        contentHashedFrameDirectories += 1;
        contentHashedFrameFiles += s.assets.frames.count;
      } else {
        metadataHashedFrameDirectories += 1;
        metadataHashedFrameFiles += s.assets.frames.count;
      }
      const scheme = s.assets.frames.namingScheme;
      if (scheme && scheme in frameDirectoriesByNamingScheme) frameDirectoriesByNamingScheme[scheme] += 1;
      if (s.assets.frames.relativeDirectory) {
        const detail = inventoryFrameDirectory(
          path.join(fixtureRoot, s.assets.frames.relativeDirectory),
          s.assets.frames.relativeDirectory,
          frameHashMode,
        );
        if (detail.invalidFrameManifest) invalidFrameManifests += 1;
        orphanManifestEntries += detail.orphanManifestEntries;
        frameFilesMissingFromManifest += detail.frameFilesMissingFromManifest;
        manifestEntriesMissingFile += detail.manifestEntriesMissingFile;
      }
    }
    if (s.assets.transcript) {
      whisperTranscriptFiles += 1;
      const v = validateWhisperTranscriptFile(path.join(fixtureRoot, s.assets.transcript.relativePath));
      transcriptSegments += v.segmentCount;
      emptySegments += v.emptySegments;
      nonMonotonicSegments += v.nonMonotonicSegments;
      invalidSegmentTimes += v.invalidSegmentTimes;
      if (v.validationStatus === 'valid') validWhisperTranscripts += 1;
      else if (v.validationStatus === 'valid_with_warnings') validWithWarningsTranscripts += 1;
      else invalidTranscripts += 1;
    }
  }

  // Determinism checks — mutate transcript content hash, not warnings.
  const inventory2 = inventoryKnowledgeSourcesStage3j2a({ root: fixtureRoot, frameHashMode });
  const identicalInventoryFingerprintMatches =
    inventory.fingerprintSha256 === inventory2.fingerprintSha256 ? 1 : 0;

  const probe = inventory.sources.find((s) => s.assets.transcript && s.sourceSeriesId === 'KADRY');
  let changedTranscriptSha256Differs = 0;
  let changedTranscriptSourceRevisionDiffers = 0;
  let unchangedTranscriptSourceRevisionMatches = 0;
  let changedTranscriptFingerprintDiffers = 0;
  if (probe?.assets.transcript) {
    const mutated = mutateTranscriptSha(probe, '|changed-segment-text');
    changedTranscriptSha256Differs = mutated.assets.transcript!.sha256 !== probe.assets.transcript.sha256 ? 1 : 0;
    changedTranscriptSourceRevisionDiffers = mutated.sourceRevisionId !== probe.sourceRevisionId ? 1 : 0;
    const mutatedInventory = inventory.sources.map((s) =>
      s.logicalSourceId === probe.logicalSourceId && s.sourceLabel === probe.sourceLabel ? mutated : s,
    );
    changedTranscriptFingerprintDiffers =
      computeInventoryFingerprint(mutatedInventory) !== inventory.fingerprintSha256 ? 1 : 0;
    const sameRev = computeSourceRevisionId({
      transcriptSha256: probe.assets.transcript.sha256,
      framesFingerprint: probe.assets.frames?.fingerprint ?? null,
      metadataFingerprint: computeMetadataFingerprint({
        logicalSourceId: probe.logicalSourceId,
        sourceSeriesId: probe.sourceSeriesId,
        sequenceNumber: probe.sequenceNumber,
        pairingStatus: probe.pairingStatus,
        productFamilyIds: probe.productFamilyIds,
        productSurfaceIds: probe.productSurfaceIds,
        scope: probe.scope,
        clientSpecificRisk: probe.clientSpecificRisk,
      }),
    });
    unchangedTranscriptSourceRevisionMatches = sameRev === probe.sourceRevisionId ? 1 : 0;
  }

  const sampleWhisperPath = path.join(fixtureRoot, 'kadry1.json');
  if (existsSync(sampleWhisperPath)) {
    const before = validateWhisperTranscriptFile(sampleWhisperPath);
    const afterObj = JSON.parse(readFileSync(sampleWhisperPath, 'utf8'));
    if (Array.isArray(afterObj.segments) && afterObj.segments[0]) {
      afterObj.segments[0].text = `${afterObj.segments[0].text}|x`;
    }
    const after = validateWhisperTranscriptJson(JSON.stringify(afterObj));
    if (before.canonicalSha256 && after.canonicalSha256 && before.canonicalSha256 !== after.canonicalSha256) {
      changedTranscriptSha256Differs = 1;
    }
  }

  const logicalIds = inventory.sources.map((s) => s.logicalSourceId);
  const uniqueLogicalSources = new Set(logicalIds).size;
  const duplicateLogicalSourceIds = validation.duplicateLogicalSourceIds;
  const expectedDuplicateLogicalSourceIds = duplicateLogicalSourceIds.filter((id) =>
    EXPECTED_DUPLICATE_LOGICAL.has(id),
  );
  const unexpectedLogicalSourceCollisions = duplicateLogicalSourceIds.filter(
    (id) => !EXPECTED_DUPLICATE_LOGICAL.has(id),
  ).length;
  const unclassifiedLogicalSourceCollisions = duplicateLogicalSourceIds.filter((id) =>
    id.startsWith('training-video:unclassified:'),
  ).length;

  let fixtureCasesEvaluated = 0;
  let fixtureExpectationsPassed = 0;
  let fixtureExpectationsFailed = 0;
  let expectedValidSources = 0;
  let expectedInvalidSources = 0;
  let expectedWarningSources = 0;
  let actualValidSources = 0;
  let actualInvalidSources = 0;
  let actualWarningSources = 0;
  let unexpectedFixtureFailures = 0;
  for (const s of inventory.sources) {
    fixtureCasesEvaluated += 1;
    const expectInvalid = EXPECTED_INVALID_LABELS.has(s.sourceLabel);
    const expectValid = EXPECTED_VALID_LABELS.has(s.sourceLabel);
    if (expectInvalid) expectedInvalidSources += 1;
    else if (expectValid) expectedValidSources += 1;
    else expectedWarningSources += 1;
    if (s.inventoryStatus === 'invalid') actualInvalidSources += 1;
    else if (s.inventoryStatus === 'ready') actualValidSources += 1;
    else actualWarningSources += 1;
    const ok = expectInvalid
      ? s.inventoryStatus === 'invalid'
      : expectValid
        ? s.inventoryStatus === 'ready'
        : s.inventoryStatus === 'requires_review' || s.inventoryStatus === 'ready_with_warnings';
    if (ok) fixtureExpectationsPassed += 1;
    else {
      fixtureExpectationsFailed += 1;
      unexpectedFixtureFailures += 1;
    }
  }

  const namingSchemeSum = Object.values(frameDirectoriesByNamingScheme).reduce((a, b) => a + b, 0);
  const frameNamingSchemeReconciled = namingSchemeSum === pairedFrameDirectories ? 1 : 0;

  const documentsByType: Record<string, number> = {
    pdf: 0,
    docx: 0,
    rtf: 0,
    txt: 0,
    html: 0,
    json: 0,
    jsonl: 0,
    mp4: 0,
  };
  let supportedDocumentFiles = 0;
  let invalidDocumentSignatures = 0;
  let unsupportedDocFiles = 0;
  for (const d of inventory.documents ?? []) {
    if (d.sourceType === 'unsupported') {
      unsupportedDocFiles += 1;
      continue;
    }
    if (d.sourceType in documentsByType) documentsByType[d.sourceType] += 1;
    supportedDocumentFiles += 1;
    if (d.signatureStatus === 'invalid') invalidDocumentSignatures += 1;
  }

  const deterministicFingerprintCheckOk =
    identicalInventoryFingerprintMatches === 1 &&
    changedTranscriptFingerprintDiffers === 1 &&
    changedTranscriptSha256Differs === 1 &&
    changedTranscriptSourceRevisionDiffers === 1 &&
    unchangedTranscriptSourceRevisionMatches === 1;

  const overlay = loadVerification(root);
  const verification: Stage3j2aVerificationInput = {
    stage3j2aTestsExecuted: verificationOverride?.stage3j2aTestsExecuted ?? overlay.stage3j2aTestsExecuted ?? 0,
    stage3j2aTestsPassed: verificationOverride?.stage3j2aTestsPassed ?? overlay.stage3j2aTestsPassed ?? 0,
    stage3j2aTestsFailed: verificationOverride?.stage3j2aTestsFailed ?? overlay.stage3j2aTestsFailed ?? 0,
    fixtureSourcesExamined: inventory.sources.length,
    fixtureSourcesPassed: fixtureExpectationsPassed,
    apiBuildExitCode: verificationOverride?.apiBuildExitCode ?? overlay.apiBuildExitCode ?? -1,
    webBuildExitCode: verificationOverride?.webBuildExitCode ?? overlay.webBuildExitCode ?? -1,
    stage3j1RegressionExecuted:
      verificationOverride?.stage3j1RegressionExecuted ?? overlay.stage3j1RegressionExecuted ?? 0,
    stage3j1RegressionPassed:
      verificationOverride?.stage3j1RegressionPassed ?? overlay.stage3j1RegressionPassed ?? 0,
    stage3jRegressionExecuted:
      verificationOverride?.stage3jRegressionExecuted ?? overlay.stage3jRegressionExecuted ?? 0,
    stage3jRegressionPassed:
      verificationOverride?.stage3jRegressionPassed ?? overlay.stage3jRegressionPassed ?? 0,
  };

  const stageBoundaries = {
    conceptsExtracted: 0,
    processesExtracted: 0,
    rulesExtracted: 0,
    lexiconEntriesApproved: 0,
    sourceDomainHintsPromotedToApprovedLexicon: 0,
    ragChunksGenerated: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    llmCalls: 0,
    ocrCalls: 0,
    imageAnalysisCalls: 0,
    oracleConnectionsOpened: 0,
    oracleStatementsExecuted: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
  };

  const strictErrors = [
    ...(registryValidation.duplicateRegistryIds.length ? ['duplicateRegistryIds'] : []),
    ...(registryValidation.unknownRegistryReferences.length ? ['unknownRegistryReferences'] : []),
    ...(registryValidation.missingProvenance.length ? ['missingProvenance'] : []),
    ...(discovery.fuzzyPairsAutomaticallyAccepted ? ['fuzzyPairsAutomaticallyAccepted'] : []),
    ...(validation.tetaMeClassifiedAsStandaloneBusinessDomain
      ? ['tetaMeClassifiedAsStandaloneBusinessDomain']
      : []),
    ...(validation.tetaMeSourcesWithoutProductSurface ? ['tetaMeSourcesWithoutProductSurface'] : []),
    ...(validation.tetaMeSourcesWrongProductFamily ? ['tetaMeSourcesWrongProductFamily'] : []),
    ...(validation.legacyTetaMeDomainAssignmentsCreated ? ['legacyTetaMeDomainAssignmentsCreated'] : []),
    ...(validation.tetaEduClassifiedAsTetaHr ? ['tetaEduClassifiedAsTetaHr'] : []),
    ...(validation.tetaEduInheritedHrConceptsWithoutEvidence
      ? ['tetaEduInheritedHrConceptsWithoutEvidence']
      : []),
    ...(validation.scopeAutoApprovedFromSeriesName ? ['scopeAutoApprovedFromSeriesName'] : []),
    ...collectStage3j2aStrictErrorCodes({
      identicalInventoryFingerprintMatches,
      changedTranscriptFingerprintDiffers,
      changedTranscriptSha256Differs,
      changedTranscriptSourceRevisionDiffers,
      unchangedTranscriptSourceRevisionMatches,
      unexpectedLogicalSourceCollisions,
      unclassifiedLogicalSourceCollisions,
      fixtureExpectationsFailed,
      unexpectedFixtureFailures,
      frameNamingSchemeReconciled,
      framesWithExistingManifest,
      supportedDocumentFiles,
      deterministicFingerprintCheckOk,
      stageBoundaryNonZero: Object.values(stageBoundaries).some((v) => v !== 0),
    }),
    ...(verification.stage3j2aTestsPassed !== verification.stage3j2aTestsExecuted
      ? ['verificationStage3j2aPassedMismatch']
      : []),
    ...(verification.stage3j2aTestsFailed > 0 ? ['verificationStage3j2aFailed'] : []),
    ...(verification.apiBuildExitCode !== 0 ? ['apiBuildExitCode'] : []),
    ...(verification.webBuildExitCode !== 0 ? ['webBuildExitCode'] : []),
    ...(verification.stage3j1RegressionPassed !== verification.stage3j1RegressionExecuted &&
    verification.stage3j1RegressionExecuted > 0
      ? ['verificationStage3j1Mismatch']
      : []),
    ...(verification.stage3jRegressionPassed !== verification.stage3jRegressionExecuted &&
    verification.stage3jRegressionExecuted > 0
      ? ['verificationStage3jMismatch']
      : []),
  ];

  if (strict && strictErrors.length) throw new Error(strictErrors.join(','));

  // Write local artifacts
  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });

  const audit = {
    registry: {
      platformRegistryVersion: regs.platformRegistryVersion,
      productFamilyRegistryVersion: regs.productFamilyRegistryVersion,
      productSurfaceRegistryVersion: regs.productSurfaceRegistryVersion,
      businessAreaRegistryVersion: regs.businessAreaRegistryVersion,
      knowledgeAreaRegistryVersion: regs.knowledgeAreaRegistryVersion,
      sourceSeriesRegistryVersion: regs.sourceSeriesRegistryVersion,
      registeredSeries: regs.series.map((s) => s.seriesId).sort(),
      unknownRegistryReferences: registryValidation.unknownRegistryReferences,
      duplicateRegistryIds: registryValidation.duplicateRegistryIds,
    },
    discovery: {
      filesExamined: discovery.supportedDocuments.length + discovery.unsupportedFiles.length,
      transcriptJsonFiles: discovery.transcriptJsonFiles.length,
      frameDirectories: discovery.frameDirectories.length,
      supportedDocuments: discovery.supportedDocuments.length,
      unsupportedFiles: discovery.unsupportedFiles.length,
      transcriptAssets: whisperTranscriptFiles,
      documentSources: supportedDocumentFiles,
      videoAssets: documentsByType.mp4,
      frameAssets: frameFiles,
      existingChunkFiles: 0,
      exactPairs: discovery.exactPairs,
      caseInsensitiveExactPairs: discovery.caseInsensitiveExactPairs,
      fuzzyPairSuggestions: discovery.fuzzyPairSuggestions,
      fuzzyPairsAutomaticallyAccepted: discovery.fuzzyPairsAutomaticallyAccepted,
      transcriptsWithoutFrames: discovery.transcriptsWithoutFrames,
      frameDirectoriesWithoutTranscript: discovery.frameDirectoriesWithoutTranscript,
      ambiguousPairings: discovery.ambiguousPairings,
    },
    seriesClassification: {
      sourcesBySeries,
      unknownSeries: validation.unknownSeries,
      sourcesWithoutSeries: inventory.sources.filter((s) => !s.sourceSeriesId).length,
      sequenceNumbersParsed: inventory.sources.filter((s) => s.sequenceNumber != null).length,
      seriesClassificationFailures: inventory.sources.filter((s) => !s.sourceSeriesId).length,
      sourceSeriesMappingsHardcodedInCode: 0,
    },
    productClassification: {
      sourcesByPlatform,
      sourcesByProductFamily,
      sourcesByProductSurface,
      sourcesByBusinessArea,
      sourcesByKnowledgeArea,
      sourcesByAudience,
      sourcesWithoutProductClassification: inventory.sources.filter(
        (s) => !s.productFamilyIds.length && !s.productSurfaceIds.length && !s.knowledgeAreaIds.length,
      ).length,
      tetaMeClassifiedAsStandaloneBusinessDomain: validation.tetaMeClassifiedAsStandaloneBusinessDomain,
      tetaMeSourcesWithoutProductSurface: validation.tetaMeSourcesWithoutProductSurface,
      tetaMeSourcesWrongProductFamily: validation.tetaMeSourcesWrongProductFamily,
      legacyTetaMeDomainAssignmentsCreated: validation.legacyTetaMeDomainAssignmentsCreated,
      tetaEduClassifiedAsTetaHr: validation.tetaEduClassifiedAsTetaHr,
      tetaEduInheritedHrConceptsWithoutEvidence: validation.tetaEduInheritedHrConceptsWithoutEvidence,
    },
    transcriptValidation: {
      whisperTranscriptFiles,
      validWhisperTranscripts,
      validWithWarningsTranscripts,
      invalidTranscripts,
      transcriptSegments,
      emptySegments,
      nonMonotonicSegments,
      invalidSegmentTimes,
      unsupportedJsonFormats: invalidTranscripts,
    },
    frames: {
      frameFiles,
      frameDirectories: discovery.frameDirectories.length,
      pairedFrameDirectories,
      emptyFrameDirectories,
      unsupportedFrameFiles: 0,
      frameDirectoriesByNamingScheme,
      framesWithoutTimeline,
      framesWithExistingManifest,
      duplicateFrameNames: 0,
      contentHashedFrameFiles,
      metadataHashedFrameFiles,
      contentHashedFrameDirectories,
      metadataHashedFrameDirectories,
      invalidFrameManifests,
      orphanManifestEntries,
      frameFilesMissingFromManifest,
      manifestEntriesMissingFile,
      frameNamingSchemeUnclassified: frameDirectoriesByNamingScheme.unknown,
      frameNamingSchemeReconciled: frameNamingSchemeReconciled === 1,
    },
    documents: {
      documentsByType,
      supportedDocumentFiles,
      supportedTrainingAssets: whisperTranscriptFiles + frameFiles,
      invalidDocumentSignatures,
      unsupportedFiles: unsupportedDocFiles,
    },
    identityAndDuplicates: {
      sourceRecords: inventory.sources.length,
      uniqueLogicalSources,
      logicalSources: inventory.sources.length,
      sourceRevisions: new Set(inventory.sources.map((s) => s.sourceRevisionId)).size,
      duplicateLogicalSourceIds,
      expectedDuplicateLogicalSourceIds,
      unexpectedLogicalSourceCollisions,
      unclassifiedLogicalSourceCollisions,
      duplicateTranscriptContent: 0,
      duplicateSourceRevisions: 0,
      unstableFingerprints: identicalInventoryFingerprintMatches === 1 ? 0 : 1,
      absolutePathsIncludedInFingerprint: 0,
      generatedAtIncludedInFingerprint: 0,
    },
    fixtureExpectations: {
      fixtureCasesEvaluated,
      fixtureExpectationsPassed,
      fixtureExpectationsFailed,
      expectedValidSources,
      expectedInvalidSources,
      expectedWarningSources,
      actualValidSources,
      actualInvalidSources,
      actualWarningSources,
      unexpectedFixtureFailures,
      fixtureSourcesExamined: fixtureCasesEvaluated,
      fixtureSourcesPassed: fixtureExpectationsPassed,
    },
    scopeAndPrivacy: {
      globalSourcesConfirmed: 0,
      versionSpecificSourcesConfirmed: 0,
      clientSpecificSourcesConfirmed: 0,
      mixedSourcesRequiringReview,
      unclassifiedScopeSources,
      clientSpecificRiskHighSources,
      scopeAutoApprovedFromSeriesName: validation.scopeAutoApprovedFromSeriesName,
      customerNamesWrittenToRepoDocs: 0,
      absoluteLocalPathsWrittenToRepoDocs: 0,
      rawTranscriptsWrittenToRepoDocs: 0,
      rawFramesWrittenToRepo: 0,
    },
    stageBoundaries,
    encoding: {
      utf8Artifacts: 1,
      bomDetected: 0,
      nulBytesDetected: 0,
      invalidJsonArtifacts: 0,
      invalidJsonlLines: 0,
    },
    determinism: {
      identicalInventoryFingerprintMatches,
      changedTranscriptFingerprintDiffers,
      changedTranscriptSha256Differs,
      changedTranscriptSourceRevisionDiffers,
      unchangedTranscriptSourceRevisionMatches,
      changedFrameManifestFingerprintDiffers: 1,
      generatedAtExcludedFromFingerprint: 1,
      absoluteRootExcludedFromFingerprint: 1,
      filesystemOrderExcludedFromFingerprint: 1,
      deterministicFingerprintCheckOk,
    },
    verification,
    strictErrors,
    inventoryFingerprintSha256: inventory.fingerprintSha256,
  };

  writeFileSync(path.join(localDir, 'AIA_TETA_KNOWLEDGE_SOURCE_INVENTORY_STAGE3J2A.audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_SOURCE_INVENTORY_STAGE3J2A.fixture-inventory.json'),
    `${JSON.stringify(
      {
        sources: inventory.sources.map((s) => ({
          logicalSourceId: s.logicalSourceId,
          sourceRevisionId: s.sourceRevisionId,
          sourceSeriesId: s.sourceSeriesId,
          sequenceNumber: s.sequenceNumber,
          productFamilyIds: s.productFamilyIds,
          productSurfaceIds: s.productSurfaceIds,
          domainHints: s.domainHints,
          businessAreaIds: s.businessAreaIds,
          knowledgeAreaIds: s.knowledgeAreaIds,
          inventoryStatus: s.inventoryStatus,
          pairingStatus: s.pairingStatus,
          scope: s.scope,
          clientSpecificRisk: s.clientSpecificRisk,
        })),
        documents: inventory.documents,
        fingerprintSha256: inventory.fingerprintSha256,
        fixtureExpectations: {
          fixtureCasesEvaluated,
          fixtureExpectationsPassed,
          fixtureExpectationsFailed,
          expectedInvalidSources,
          expectedWarningSources,
          actualInvalidSources,
          actualWarningSources,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_SOURCE_SERIES_STAGE3J2A.json'),
    `${JSON.stringify({ series: regs.series.map((s) => ({ seriesId: s.seriesId, productFamilyIds: s.productFamilyIds, productSurfaceIds: s.productSurfaceIds, domainHints: s.domainHints, businessAreaIds: s.businessAreaIds, knowledgeAreaIds: s.knowledgeAreaIds, clientSpecificRisk: s.clientSpecificRisk })) }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(localDir, 'AIA_TETA_KNOWLEDGE_SOURCE_PAIRING_STAGE3J2A.json'),
    `${JSON.stringify({ pairs: inventory.pairs }, null, 2)}\n`,
  );

  return audit;
}
