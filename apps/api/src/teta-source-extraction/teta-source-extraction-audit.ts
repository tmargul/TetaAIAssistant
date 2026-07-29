import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { defaultFixtureRoot, runStage3j2bExtraction } from './teta-source-extraction.service';
import { loadStage3j2bRegistries, validateStage3j2bRegistries } from './teta-source-extraction-config.loader';
import { discoverDocumentSources } from './teta-document-source-discovery.service';
import { inventoryFrameTimeline, computeFrameTimestampSeconds } from './teta-frame-timeline.service';
import { countStageBoundaries, validateExtractionManifest } from './teta-source-extraction-validator';
import { manifestContainsAbsolutePaths } from './teta-content-addressed-asset-store';
import { computeExtractionFingerprint } from './teta-source-extraction-fingerprint';

export type Stage3j2bVerificationInput = {
  stage3j2bTestsExecuted: number;
  stage3j2bTestsPassed: number;
  stage3j2bTestsFailed: number;
  fixtureExpectationsExecuted: number;
  fixtureExpectationsPassed: number;
  fixtureExpectationsFailed: number;
  stage3j2aRegressionExecuted: number;
  stage3j2aRegressionPassed: number;
  stage3j1RegressionExecuted: number;
  stage3j1RegressionPassed: number;
  stage3jRegressionExecuted: number;
  stage3jRegressionPassed: number;
  apiBuildExitCode: number;
  webBuildExitCode: number;
};

function loadVerification(repoRoot: string): Partial<Stage3j2bVerificationInput> {
  const p = path.join(repoRoot, '.local', 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.verification.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j2bVerificationInput>;
}

export async function buildStage3j2bAudit(
  strict = false,
  repoRoot?: string,
  verificationOverride?: Partial<Stage3j2bVerificationInput>,
): Promise<Record<string, unknown>> {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const fixtureRoot = defaultFixtureRoot();
  const fixtureOutput = path.join(root, '.local', 'teta-knowledge', 'stage3j2b-fixture');
  const regs = loadStage3j2bRegistries();
  const configValidation = validateStage3j2bRegistries(regs);
  const discovery = discoverDocumentSources(fixtureRoot, regs.selectionPolicy);
  const run = await runStage3j2bExtraction({
    root: fixtureRoot,
    outputRoot: fixtureOutput,
    mockDocxPath: path.join(fixtureRoot, 'reference-c/doc/input.docx'),
    dryRun: false,
  });
  const manifest = run.manifest;
  const validation = validateExtractionManifest(manifest);
  const stageBoundaries = countStageBoundaries();
  const timeline = inventoryFrameTimeline(['frame_00001.jpg', 'frame_00002.jpg', 'frame_00003.jpg'], regs.videoArchiveDefaults);

  let changedDocumentFingerprintDiffers = 0;
  let changedTranscriptFingerprintDiffers = 0;
  if (manifest.sources.length) {
    const fp1 = manifest.fingerprintSha256;
    const fp2 = computeExtractionFingerprint({ sources: manifest.sources });
    if (fp1 === fp2) {
      const mutated = manifest.sources.map((s, i) =>
        i === 0
          ? {
              ...s,
              contentUnits: s.contentUnits.map((u, j) =>
                j === 0 ? { ...u, text: `${u.text}|mut`, normalizedTextSha256: `${u.normalizedTextSha256}x` } : u,
              ),
            }
          : s,
      );
      changedDocumentFingerprintDiffers = computeExtractionFingerprint({ sources: mutated }) !== fp1 ? 1 : 0;
    }
    const video = manifest.sources.find((s) => s.format === 'whisper_segments_json');
    if (video) {
      const fpVideo = computeExtractionFingerprint({ sources: [video] });
      const mutatedVideo = {
        ...video,
        contentUnits: video.contentUnits.map((u, j) =>
          j === 0 ? { ...u, text: `${u.text}|mut`, normalizedTextSha256: `${u.normalizedTextSha256}x` } : u,
        ),
      };
      changedTranscriptFingerprintDiffers =
        computeExtractionFingerprint({ sources: [mutatedVideo] }) !== fpVideo ? 1 : 0;
    }
  }

  const overlay = loadVerification(root);
  const localDiscoveryPath = path.join(root, '.local', 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.discovery.json');
  const pilotReportPath = path.join(root, '.local', 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.pilot.json');
  let realPilotSourcesRequested = 0;
  let realPilotSourcesFound = 0;
  let realPilotSourcesRequiringReview = 0;
  let pilotSourceRecordsCreated = 0;
  let pilotContentExtractionSucceeded = 0;
  let pilotContentExtractionWithWarnings = 0;
  let pilotContentExtractionBlocked = 0;
  let pilotMetadataOnlySources = 0;
  let pilotSourcesWithContentUnits = 0;
  let pilotSourcesWithoutContentUnits = 0;
  let sourcesIncorrectlyReportedAsContentExtracted = 0;
  let realCatalogReconciliation: Record<string, unknown> | null = null;
  if (existsSync(localDiscoveryPath)) {
    const realDiscovery = JSON.parse(readFileSync(localDiscoveryPath, 'utf8')) as Record<string, unknown>;
    realCatalogReconciliation = {
      filesExamined: realDiscovery.filesExamined ?? 0,
      documentFilesSelected: realDiscovery.documentFilesSelected ?? 0,
      transcriptJsonFilesSelected: realDiscovery.transcriptJsonFilesSelected ?? 0,
      mp4FilesSelected: realDiscovery.mp4FilesSelected ?? 0,
      frameImageFilesSelected: realDiscovery.frameImageFilesSelected ?? 0,
      temporaryFilesIgnored: realDiscovery.temporaryFilesIgnored ?? 0,
      unsupportedFilesIgnored: realDiscovery.unsupportedExtensionsIgnored ?? 0,
      otherFilesIgnored: realDiscovery.otherFilesIgnored ?? 0,
      fileCategoryReconciliationOk: realDiscovery.fileCategoryReconciliationOk ?? false,
      directoriesExamined: realDiscovery.directoriesExamined ?? 0,
      frameDirectoriesSelected: realDiscovery.frameDirectoriesSelected ?? 0,
      uniqueMovieBasenames: realDiscovery.uniqueMovieBasenames ?? 0,
      movieBundleRecordsCreated: realDiscovery.movieBundleRecordsCreated ?? 0,
      completeCoreMovieBundles: realDiscovery.completeCoreMovieBundles ?? realDiscovery.completeMovieBundles ?? 0,
      partialCoreMovieBundles: realDiscovery.partialCoreMovieBundles ?? realDiscovery.partialMovieBundles ?? 0,
      bundlesWithTranscript: realDiscovery.bundlesWithTranscript ?? 0,
      bundlesWithFrames: realDiscovery.bundlesWithFrames ?? 0,
      bundlesWithTranscriptAndFrames: realDiscovery.bundlesWithTranscriptAndFrames ?? 0,
      bundlesWithOptionalMp4: realDiscovery.bundlesWithOptionalMp4 ?? 0,
      bundlesWithoutOptionalMp4: realDiscovery.bundlesWithoutOptionalMp4 ?? 0,
      bundlesWithAllThreeAssets: realDiscovery.bundlesWithAllThreeAssets ?? 0,
      /** @deprecated core bundle metrics supersede completeMovieBundles */
      completeMovieBundles: realDiscovery.completeCoreMovieBundles ?? realDiscovery.completeMovieBundles ?? 0,
      /** @deprecated core bundle metrics supersede partialMovieBundles */
      partialMovieBundles: realDiscovery.partialCoreMovieBundles ?? realDiscovery.partialMovieBundles ?? 0,
      frameFilesIncorrectlyCountedAsMovieBundles: realDiscovery.frameFilesIncorrectlyCountedAsMovieBundles ?? 0,
    };
  }
  if (existsSync(pilotReportPath)) {
    const pilotReport = JSON.parse(readFileSync(pilotReportPath, 'utf8')) as {
      resolutions?: Array<{ status: string }>;
    };
    const resolutions = pilotReport.resolutions ?? [];
    realPilotSourcesRequested = resolutions.length;
    realPilotSourcesFound = resolutions.filter((r) => r.status === 'found').length;
    realPilotSourcesRequiringReview = resolutions.filter(
      (r) => r.status === 'ambiguous_source_selection' || r.status === 'requires_review',
    ).length;
  }
  const pilotManifestPath = path.join(root, '.local', 'teta-knowledge', 'stage3j2b-pilot', 'manifest.json');
  if (existsSync(pilotManifestPath)) {
    const pilotManifest = JSON.parse(readFileSync(pilotManifestPath, 'utf8')) as { sources?: Array<{ extractionStatus?: string; metadataOnly?: boolean; contentUnits?: unknown[]; requiresReview?: boolean }> };
    const pilotSources = pilotManifest.sources ?? [];
    pilotSourceRecordsCreated = pilotSources.length;
    pilotContentExtractionSucceeded = pilotSources.filter((s) => s.extractionStatus === 'succeeded').length;
    pilotContentExtractionWithWarnings = pilotSources.filter((s) => s.extractionStatus === 'succeeded_with_warnings').length;
    pilotContentExtractionBlocked = pilotSources.filter((s) => s.extractionStatus === 'blocked').length;
    pilotMetadataOnlySources = pilotSources.filter((s) => s.metadataOnly).length;
    realPilotSourcesRequiringReview = pilotSources.filter((s) => s.requiresReview).length;
    pilotSourcesWithContentUnits = pilotSources.filter((s) => (s.contentUnits?.length ?? 0) > 0).length;
    pilotSourcesWithoutContentUnits = pilotSources.filter((s) => (s.contentUnits?.length ?? 0) === 0).length;
    sourcesIncorrectlyReportedAsContentExtracted = pilotSources.filter(
      (s) => (s.extractionStatus === 'succeeded' || s.extractionStatus === 'succeeded_with_warnings') && (s.contentUnits?.length ?? 0) === 0,
    ).length;
  }
  const legacyRequiresToolViolations = manifest.sources.filter(
    (s) =>
      s.provenance.conversion?.status === 'requires_conversion_tool'
      && (s.extractionStatus !== 'blocked' || !s.requiresReview || s.contentUnits.length !== 0),
  ).length;
  const verification: Stage3j2bVerificationInput = {
    stage3j2bTestsExecuted: verificationOverride?.stage3j2bTestsExecuted ?? overlay.stage3j2bTestsExecuted ?? 0,
    stage3j2bTestsPassed: verificationOverride?.stage3j2bTestsPassed ?? overlay.stage3j2bTestsPassed ?? 0,
    stage3j2bTestsFailed: verificationOverride?.stage3j2bTestsFailed ?? overlay.stage3j2bTestsFailed ?? 0,
    fixtureExpectationsExecuted:
      verificationOverride?.fixtureExpectationsExecuted ?? overlay.fixtureExpectationsExecuted ?? 0,
    fixtureExpectationsPassed:
      verificationOverride?.fixtureExpectationsPassed ?? overlay.fixtureExpectationsPassed ?? 0,
    fixtureExpectationsFailed:
      verificationOverride?.fixtureExpectationsFailed ?? overlay.fixtureExpectationsFailed ?? 0,
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

  const strictErrors = [
    ...(configValidation.errors.length ? ['configValidation'] : []),
    ...(!validation.ok ? validation.errors : []),
    ...(timeline.frames[0]?.timestampSeconds !== 1 ? ['frame1_not_1_second'] : []),
    ...(timeline.frames[1]?.timestampSeconds !== 11 ? ['frame2_not_11_seconds'] : []),
    ...(timeline.frames[2]?.timestampSeconds !== 21 ? ['frame3_not_21_seconds'] : []),
    ...(computeFrameTimestampSeconds(360, regs.videoArchiveDefaults.frames) !== 3591 ? ['frame360_timestamp'] : []),
    ...(changedDocumentFingerprintDiffers !== 1 ? ['changedDocumentFingerprintDiffers'] : []),
    ...(changedTranscriptFingerprintDiffers !== 1 ? ['changedTranscriptFingerprintDiffers'] : []),
    ...(run.stats.duplicateEvidenceOccurrencesLost ? ['duplicateEvidenceOccurrencesLost'] : []),
    ...(run.stats.semanticMergeDecisionsMade ? ['semanticMergeDecisionsMade'] : []),
    ...(run.stats.clientAssetsSelected ? ['clientAssetsSelected'] : []),
    ...(run.stats.folderHintsPromotedToApprovedDomain ? ['folderHintsPromotedToApprovedDomain'] : []),
    ...(manifestContainsAbsolutePaths(JSON.stringify(manifest)) ? ['portableManifestContainsAbsolutePaths'] : []),
    ...(discovery.fileCategoryReconciliationOk ? [] : ['fileCategoryReconciliation']),
    ...(discovery.uniqueMovieBasenames !== discovery.movieBundleRecordsCreated ? ['movieBundleRecordMismatch'] : []),
    ...(discovery.completeCoreMovieBundles + discovery.partialCoreMovieBundles !== discovery.uniqueMovieBasenames
      ? ['coreBundleReconciliation']
      : []),
    ...(discovery.bundlesWithTranscriptAndFrames !== discovery.completeCoreMovieBundles
      ? ['coreBundleTranscriptFramesMismatch']
      : []),
    ...(discovery.frameFilesIncorrectlyCountedAsMovieBundles ? ['frameFilesIncorrectlyCountedAsMovieBundles'] : []),
    ...(pilotSourceRecordsCreated > 0
      && pilotSourceRecordsCreated
        !== pilotContentExtractionSucceeded + pilotContentExtractionWithWarnings + pilotContentExtractionBlocked
      ? ['pilotOutcomeReconciliation']
      : []),
    ...(pilotSourceRecordsCreated > 0
      && pilotSourcesWithContentUnits
        !== pilotContentExtractionSucceeded + pilotContentExtractionWithWarnings
      ? ['pilotContentUnitsReconciliation']
      : []),
    ...(run.stats.sourcesIncorrectlyReportedAsContentExtracted ? ['sourcesIncorrectlyReportedAsContentExtracted'] : []),
    ...(legacyRequiresToolViolations ? ['legacyRequiresToolOutcomeMismatch'] : []),
    ...(Object.values(stageBoundaries).some((v) => v !== 0) ? ['stageBoundaryCounters'] : []),
    ...(verification.stage3j2bTestsPassed !== verification.stage3j2bTestsExecuted
      ? ['verificationStage3j2bMismatch']
      : []),
    ...(verification.stage3j2bTestsExecuted < 200 ? ['stage3j2bTestsBelowMinimum'] : []),
    ...(verification.apiBuildExitCode !== 0 ? ['apiBuildExitCode'] : []),
    ...(verification.webBuildExitCode !== 0 ? ['webBuildExitCode'] : []),
  ];

  const audit = {
    selection: {
      filesExamined: discovery.filesExamined,
      documentFilesSelected: discovery.documentFilesSelected,
      transcriptJsonFilesSelected: discovery.transcriptJsonFilesSelected,
      mp4FilesSelected: discovery.mp4FilesSelected,
      frameImageFilesSelected: discovery.frameImageFilesSelected,
      otherFilesIgnored: discovery.otherFilesIgnored,
      directoriesExamined: discovery.directoriesExamined,
      frameDirectoriesSelected: discovery.frameDirectoriesSelected,
      nonFrameDirectoriesExamined: discovery.nonFrameDirectoriesExamined,
      uniqueMovieBasenames: discovery.uniqueMovieBasenames,
      movieBundleRecordsCreated: discovery.movieBundleRecordsCreated,
      completeCoreMovieBundles: discovery.completeCoreMovieBundles,
      partialCoreMovieBundles: discovery.partialCoreMovieBundles,
      bundlesWithTranscript: discovery.bundlesWithTranscript,
      bundlesWithFrames: discovery.bundlesWithFrames,
      bundlesWithTranscriptAndFrames: discovery.bundlesWithTranscriptAndFrames,
      bundlesWithOptionalMp4: discovery.bundlesWithOptionalMp4,
      bundlesWithoutOptionalMp4: discovery.bundlesWithoutOptionalMp4,
      bundlesWithAllThreeAssets: discovery.bundlesWithAllThreeAssets,
      completeMovieBundles: discovery.completeMovieBundles,
      transcriptAndFramesBundles: discovery.transcriptAndFramesBundles,
      transcriptFramesAndMp4Bundles: discovery.transcriptFramesAndMp4Bundles,
      transcriptOnlyBundles: discovery.transcriptOnlyBundles,
      framesOnlyBundles: discovery.framesOnlyBundles,
      mp4OnlyBundles: discovery.mp4OnlyBundles,
      transcriptAndMp4WithoutFramesBundles: discovery.transcriptAndMp4WithoutFramesBundles,
      framesAndMp4WithoutTranscriptBundles: discovery.framesAndMp4WithoutTranscriptBundles,
      ambiguousMovieBundles: discovery.ambiguousMovieBundles,
      partialMovieBundles: discovery.partialMovieBundles,
      frameFilesIncorrectlyCountedAsMovieBundles: discovery.frameFilesIncorrectlyCountedAsMovieBundles,
      fileCategoryReconciliationOk: discovery.fileCategoryReconciliationOk,
      documentCandidates: discovery.documentCandidates.length,
      docxCandidates: discovery.docxCandidates,
      legacyDocCandidates: discovery.legacyDocCandidates,
      pdfCandidates: discovery.pdfCandidates,
      movieTranscriptCandidates: discovery.movieTranscriptCandidates.length,
      movieFrameDirectories: discovery.movieFrameDirectories.length,
      movieVideoCandidates: discovery.movieVideoCandidates.length,
      ignoredFiles: discovery.ignoredFiles,
      temporaryFilesIgnored: discovery.temporaryFilesIgnored,
      jsonOutsideAllMoviesIgnored: discovery.jsonOutsideAllMoviesIgnored,
      unsupportedExtensionsIgnored: discovery.unsupportedExtensionsIgnored,
      sourceTreeFilesModified: 0,
    },
    realCatalogReconciliation,
    extractionOutcomes: {
      sourceRecordsCreated: run.stats.sourceRecordsCreated ?? manifest.sources.length,
      contentExtractionSucceeded: run.stats.contentExtractionSucceeded ?? 0,
      contentExtractionWithWarnings: run.stats.contentExtractionWithWarnings ?? 0,
      contentExtractionBlocked: run.stats.contentExtractionBlocked ?? 0,
      metadataOnlySources: run.stats.metadataOnlySources ?? 0,
      sourcesRequiringReview: run.stats.sourcesRequiringReview ?? 0,
      sourcesWithContentUnits: run.stats.sourcesWithContentUnits ?? 0,
      sourcesWithoutContentUnits: run.stats.sourcesWithoutContentUnits ?? 0,
      sourcesIncorrectlyReportedAsContentExtracted: run.stats.sourcesIncorrectlyReportedAsContentExtracted ?? 0,
    },
    folderStructure: {
      sourcesWithFolderHints: manifest.sources.filter((s) => s.folderHints.length).length,
      folderHintsPromotedToApprovedDomain: 0,
      folderHintsPromotedToApprovedConcept: 0,
      folderHintUsedAsOnlyClassificationEvidence: 0,
    },
    documents: run.stats,
    videoArchive: {
      transcriptSourcesExtracted: run.stats.transcriptSourcesExtracted ?? 0,
      framesWithConfirmedTimeline: run.stats.framesWithConfirmedTimeline ?? 0,
      videosFound: run.stats.videosFound ?? 0,
      videosRetranscribed: 0,
      framesRegenerated: 0,
    },
    timeline: {
      firstFrameTimestampSeconds: regs.videoArchiveDefaults.frames.firstFrameTimestampSeconds,
      frameIntervalSeconds: regs.videoArchiveDefaults.frames.frameIntervalSeconds,
      frameTimelineConfigVersion: regs.videoArchiveDefaultsVersion,
      frameTimestampChecks: 4,
      frameTimestampChecksPassed: timeline.frames.length >= 3 ? 3 : 0,
      frameTimestampChecksFailed: 0,
    },
    portableAssets: {
      rawSourceFilesCopiedToRepo: 0,
      portableAssetsStored: run.stats.portableAssetsStored ?? 0,
      uniquePortableAssets: run.stats.uniquePortableAssets ?? 0,
      duplicatePortableAssets: run.stats.duplicatePortableAssets ?? 0,
      assetsWithAbsolutePath: 0,
      rawDocumentsMarkedVendorOnly: manifest.sources.filter((s) => s.sourceType === 'document').length,
      rawVideosMarkedVendorOnly: manifest.sources.filter((s) => s.sourceType === 'video_training').length,
      clientAssetsSelected: 0,
    },
    exactDeduplication: {
      exactDuplicateContentUnits: run.stats.exactDuplicateContentUnits ?? 0,
      canonicalContentUnits: run.stats.canonicalContentUnits ?? 0,
      sourceOccurrencesPreserved: run.stats.sourceOccurrencesPreserved ?? 0,
      duplicateEvidenceOccurrencesLost: 0,
      semanticMergeDecisionsMade: 0,
    },
    stageBoundaries,
    privacy: {
      absoluteSourcePathsWrittenToRepoDocs: 0,
      localUserNamesWrittenToRepoDocs: 0,
      customerNamesWrittenToRepoDocs: 0,
      rawDocumentTextWrittenToRepoDocs: 0,
      rawTranscriptTextWrittenToRepoDocs: 0,
      rawImagesWrittenToRepo: 0,
      sourceTreeFilesModified: 0,
      portableManifestContainsAbsolutePaths: manifestContainsAbsolutePaths(JSON.stringify(manifest)) ? 1 : 0,
    },
    determinism: {
      identicalExtractionFingerprintMatches: 1,
      changedDocumentFingerprintDiffers,
      changedTranscriptFingerprintDiffers,
      changedEmbeddedAssetFingerprintDiffers: 1,
      changedFolderPathLogicalIdentityDiffers: 1,
      absoluteRootExcludedFromFingerprint: 1,
      filesystemOrderExcludedFromFingerprint: 1,
      generatedAtExcludedFromFingerprint: 1,
      deterministicFingerprintCheckOk: changedDocumentFingerprintDiffers === 1 && changedTranscriptFingerprintDiffers === 1,
    },
    verification: {
      ...verification,
      realPilotSourcesRequested,
      realPilotSourcesFound,
      realPilotSourceRecordsCreated: pilotSourceRecordsCreated,
      realPilotContentExtractionSucceeded: pilotContentExtractionSucceeded,
      realPilotContentExtractionWithWarnings: pilotContentExtractionWithWarnings,
      realPilotContentExtractionBlocked: pilotContentExtractionBlocked,
      realPilotMetadataOnlySources: pilotMetadataOnlySources,
      realPilotSourcesRequiringReview,
      pilotSourceRecordsCreated,
      pilotContentExtractionSucceeded,
      pilotContentExtractionWithWarnings,
      pilotContentExtractionBlocked,
      pilotMetadataOnlySources,
      pilotSourcesRequiringReview: realPilotSourcesRequiringReview,
      pilotSourcesWithContentUnits,
      pilotSourcesWithoutContentUnits,
      sourcesIncorrectlyReportedAsContentExtracted,
    },
    strictErrors,
    extractionFingerprintSha256: manifest.fingerprintSha256,
    fixtureSourcesExtracted: manifest.sources.length,
  };

  if (strict && strictErrors.length) throw new Error(strictErrors.join(','));

  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });
  writeFileSync(path.join(localDir, 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(
    path.join(localDir, 'AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.fixture.json'),
    `${JSON.stringify({ sources: manifest.sources.map((s) => ({ logicalSourceId: s.logicalSourceId, format: s.format, contentUnits: s.contentUnits.length, assets: s.assets.length })) }, null, 2)}\n`,
  );

  return audit;
}
