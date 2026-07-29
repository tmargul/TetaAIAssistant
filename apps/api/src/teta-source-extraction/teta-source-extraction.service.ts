import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import {
  logicalSourceIdForDocument,
  normalizeRelativePath,
  sha256,
  splitRelativeDirectorySegments,
} from './teta-canonical-source-contract';
import { discoverDocumentSources, pairMovieBundle } from './teta-document-source-discovery.service';
import { extractDocxSource, toAssetReferences } from './teta-docx-extractor';
import { extractPdfSource } from './teta-pdf-extractor';
import { resolveLegacyDocConverter } from './teta-legacy-doc-converter';
import { extractWhisperTranscript, buildVideoLogicalSourceId } from './teta-video-transcript-extractor';
import { inventoryFrameTimeline } from './teta-frame-timeline.service';
import { extractFilenameHints, resolveFolderHints } from './teta-folder-hint-resolver';
import { ContentAddressedAssetStore, writeManifest } from './teta-content-addressed-asset-store';
import { exactContentDedup, exactFileDedup, exactAssetDedup } from './teta-exact-content-deduplicator';
import { validateMp4Asset, resolveFfprobePath } from './teta-mp4-validation.service';
import {
  computeExtractionFingerprint,
  computeSourceRevisionId,
  metadataFingerprint,
} from './teta-source-extraction-fingerprint';
import { loadStage3j2bRegistries } from './teta-source-extraction-config.loader';
import {
  STAGE3J2B_EXTRACTION_VERSION,
  TETA_CANONICAL_SOURCE_CONTRACT_VERSION,
  type CanonicalSourceRecordV1,
  type ExtractionManifestV1,
  type PilotManifestV1,
  type PilotResolution,
} from './teta-canonical-source.types';

export type ExtractionRunOptions = {
  root: string;
  outputRoot: string;
  documentsOnly?: boolean;
  moviesOnly?: boolean;
  sourceFilter?: string;
  relativePathFilter?: string;
  relativePathFilters?: string[];
  maxSources?: number;
  docConverterPath?: string | null;
  mockDocxPath?: string | null;
  ffprobePath?: string | null;
  dryRun?: boolean;
  workspaceDir?: string;
};

export type ExtractionRunResult = {
  manifest: ExtractionManifestV1;
  stats: Record<string, number>;
};

export async function runStage3j2bExtraction(options: ExtractionRunOptions): Promise<ExtractionRunResult> {
  const regs = loadStage3j2bRegistries();
  const discovery = discoverDocumentSources(options.root, regs.selectionPolicy);
  const assetStore = new ContentAddressedAssetStore(options.outputRoot);
  const workspaceDir = options.workspaceDir ?? path.join(options.outputRoot, '.workspace');
  mkdirSync(workspaceDir, { recursive: true });
  const legacyConverter = resolveLegacyDocConverter({
    sofficePath: options.docConverterPath,
    mockDocxPath: options.mockDocxPath,
  });

  const sources: CanonicalSourceRecordV1[] = [];
  const stats: Record<string, number> = {
    docxExtracted: 0,
    legacyDocConverted: 0,
    legacyDocRequiresConverter: 0,
    pdfExtracted: 0,
    transcriptSourcesExtracted: 0,
    framesWithConfirmedTimeline: 0,
    videosFound: 0,
    videosDurationValidated: 0,
    videoValidationUnavailable: 0,
    tablesExtracted: 0,
    listsExtracted: 0,
    embeddedImagesExtracted: 0,
    pagesTotal: 0,
    pagesWithText: 0,
    pagesWithoutText: 0,
    pagesRequiringOcr: 0,
    transcriptSegments: 0,
    segmentFrameLinks: 0,
    framesRegenerated: 0,
    videosRetranscribed: 0,
    ocrCalls: 0,
    llmCalls: 0,
    embeddingCalls: 0,
    qdrantCalls: 0,
    imageAnalysisCalls: 0,
    semanticMergeDecisionsMade: 0,
    clientAssetsSelected: 0,
    folderHintsPromotedToApprovedDomain: 0,
    folderHintsPromotedToApprovedConcept: 0,
    folderHintUsedAsOnlyClassificationEvidence: 0,
    hintsIncorrectlyPromotedToFacts: 0,
    sourceRecordsCreated: 0,
    contentExtractionSucceeded: 0,
    contentExtractionWithWarnings: 0,
    contentExtractionBlocked: 0,
    metadataOnlySources: 0,
    sourcesRequiringReview: 0,
    sourcesWithContentUnits: 0,
    sourcesWithoutContentUnits: 0,
    sourcesIncorrectlyReportedAsContentExtracted: 0,
  };

  const pathFilterSet =
    options.relativePathFilters?.length
      ? new Set(options.relativePathFilters.map((p) => normalizeRelativePath(p)))
      : options.relativePathFilter
        ? new Set([normalizeRelativePath(options.relativePathFilter)])
        : null;

  if (!options.moviesOnly) {
    let docs = discovery.documentCandidates;
    if (pathFilterSet) docs = docs.filter((d) => pathFilterSet.has(normalizeRelativePath(d.relativePath)));
    if (typeof options.maxSources === 'number') docs = docs.slice(0, options.maxSources);
    for (const doc of docs) {
      const abs = path.join(options.root, doc.relativePath);
      const logicalSourceId = logicalSourceIdForDocument(doc.relativePath);
      if (options.sourceFilter && logicalSourceId !== options.sourceFilter) continue;
      const hints = resolveFolderHints(doc.relativeDirectorySegments, regs.folderHints);
      const filenameHints = extractFilenameHints(doc.fileName);
      const fileSha256 = sha256(readFileSync(abs));
      let format: CanonicalSourceRecordV1['format'] = 'docx';
      let contentUnits: CanonicalSourceRecordV1['contentUnits'] = [];
      let assets: CanonicalSourceRecordV1['assets'] = [];
      const warnings: string[] = [];
      let conversion = null as CanonicalSourceRecordV1['provenance']['conversion'];

      if (doc.extension === '.docx') {
        const extracted = await extractDocxSource(abs, logicalSourceId);
        contentUnits = extracted.contentUnits;
        for (const asset of extracted.assets) {
          if (!options.dryRun) assetStore.storeBinary({ buffer: asset.buffer, ext: asset.ext, mimeType: asset.mimeType });
        }
        assets = toAssetReferences(extracted.assets, logicalSourceId);
        stats.docxExtracted += 1;
        stats.tablesExtracted += extracted.tablesExtracted;
        stats.listsExtracted += extracted.listsExtracted;
        stats.embeddedImagesExtracted += extracted.embeddedImagesExtracted;
        warnings.push(...extracted.warnings);
        format = 'docx';
      } else if (doc.extension === '.doc') {
        const conv = await legacyConverter.convert(abs, path.join(workspaceDir, sha256(logicalSourceId).slice(0, 16)));
        conversion = {
          originalFormat: 'doc',
          convertedFormat: 'docx',
          converter: conv.converter,
          converterVersion: conv.converterVersion,
          originalSha256: conv.originalSha256 ?? fileSha256,
          convertedSha256: conv.convertedSha256 ?? '',
          status: conv.status,
        };
        if (conv.status === 'converted' && conv.convertedPath) {
          const extracted = await extractDocxSource(conv.convertedPath, logicalSourceId);
          contentUnits = extracted.contentUnits;
          assets = toAssetReferences(extracted.assets, logicalSourceId);
          stats.legacyDocConverted += 1;
          stats.docxExtracted += 1;
          format = 'legacy_doc';
        } else {
          stats.legacyDocRequiresConverter += 1;
          warnings.push(...conv.warnings);
          format = 'legacy_doc';
        }
      } else if (doc.extension === '.pdf') {
        const extracted = await extractPdfSource(abs, logicalSourceId);
        contentUnits = extracted.contentUnits;
        warnings.push(...extracted.warnings);
        stats.pdfExtracted += 1;
        stats.pagesTotal += extracted.pagesTotal;
        stats.pagesWithText += extracted.pagesWithText;
        stats.pagesWithoutText += extracted.pagesWithoutText;
        stats.pagesRequiringOcr += extracted.pagesRequiringOcr;
        format = 'pdf';
      }

      const meta = metadataFingerprint({
        logicalSourceId,
        normalizedRelativePath: doc.normalizedRelativePath,
        folderHints: hints.folderHints,
        productFamilyHints: hints.productFamilyHints,
        productSurfaceHints: hints.productSurfaceHints,
        domainHints: hints.domainHints,
      });
      const sourceRecord = buildSourceRecord({
        logicalSourceId,
        format,
        doc,
        hints,
        filenameHints,
        contentUnits,
        assets,
        warnings,
        fileSha256,
        conversion,
        meta,
      });
      tallyExtractionOutcome(sourceRecord, stats);
      sources.push(sourceRecord);
    }
  }

  if (!options.documentsOnly) {
    let bundles = discovery.movieBundles.filter((b) => b.transcriptRelativePath);
    if (pathFilterSet) {
      bundles = bundles.filter(
        (b) => b.transcriptRelativePath && pathFilterSet.has(normalizeRelativePath(b.transcriptRelativePath)),
      );
    }
    if (typeof options.maxSources === 'number') bundles = bundles.slice(0, options.maxSources);
    for (const bundle of bundles) {
      const pair = pairMovieBundle(bundle);
      if (!pair.accepted) continue;
      const logicalSourceId = buildVideoLogicalSourceId(bundle.basename);
      if (options.sourceFilter && logicalSourceId !== options.sourceFilter) continue;
      const transcriptPath = path.join(options.root, bundle.transcriptRelativePath!);
      const frameDir = bundle.framesRelativeDirectory
        ? path.join(options.root, bundle.framesRelativeDirectory)
        : null;
      const frameNames = frameDir && existsSync(frameDir)
        ? readdirSync(frameDir).filter((n) => /\.(jpg|jpeg|png|webp)$/i.test(n))
        : [];
      const timeline = inventoryFrameTimeline(frameNames, regs.videoArchiveDefaults);
      stats.framesWithConfirmedTimeline += timeline.frames.length;
      const frameAssetByFileName = new Map<string, { assetId: string; relativePortablePath: string }>();
      if (frameDir && !options.dryRun) {
        for (const fr of timeline.frames) {
          const ext = path.extname(fr.fileName);
          const stored = assetStore.copyFrameFile({
            sourcePath: path.join(frameDir, fr.fileName),
            ext,
          });
          frameAssetByFileName.set(fr.fileName, {
            assetId: stored.assetId,
            relativePortablePath: stored.relativePortablePath,
          });
        }
      }
      const extracted = extractWhisperTranscript(
        transcriptPath,
        logicalSourceId,
        frameNames,
        regs.videoArchiveDefaults,
        frameAssetByFileName,
      );
      stats.transcriptSourcesExtracted += 1;
      stats.transcriptSegments += extracted.transcriptSegments;
      stats.segmentFrameLinks += extracted.contentUnits.filter((u) => u.frameRefs?.nearestFrameRef).length;
      const videoPath = bundle.videoRelativePath ? path.join(options.root, bundle.videoRelativePath) : null;
      if (videoPath) stats.videosFound += 1;
      const lastFrameTs = timeline.frames.length ? timeline.frames[timeline.frames.length - 1].timestampSeconds : null;
      const videoValidation = await validateMp4Asset({
        videoPath,
        actualFrameCount: timeline.frames.length,
        lastFrameTimestampSeconds: lastFrameTs,
        transcriptEndSeconds: extracted.durationSeconds,
        ffprobePath: resolveFfprobePath(options.ffprobePath),
        videoDefaults: regs.videoArchiveDefaults,
      });
      if (videoValidation.ffprobeAvailable && videoValidation.videoDurationValidation === 'ok') stats.videosDurationValidated += 1;
      else if (!videoValidation.ffprobeAvailable) stats.videoValidationUnavailable += 1;
      const hints = resolveFolderHints(['ALL_MOVIES'], regs.folderHints);
      const meta = metadataFingerprint({
        logicalSourceId,
        normalizedRelativePath: bundle.transcriptRelativePath!,
        folderHints: hints.folderHints,
        productFamilyHints: hints.productFamilyHints,
        productSurfaceHints: hints.productSurfaceHints,
        domainHints: hints.domainHints,
      });
      const videoSource: CanonicalSourceRecordV1 = {
        contractVersion: TETA_CANONICAL_SOURCE_CONTRACT_VERSION,
        logicalSourceId,
        sourceRevisionId: computeSourceRevisionId({
          fileSha256: sha256(readFileSync(transcriptPath)),
          contentUnitHashes: extracted.contentUnits.map((u) => u.normalizedTextSha256),
          assetIds: [...frameAssetByFileName.values()].map((a) => a.assetId),
          metadataFingerprint: meta,
        }),
        sourceType: 'video_training',
        format: 'whisper_segments_json',
        sourceLabel: bundle.basename,
        originalRelativePath: normalizeRelativePath(bundle.transcriptRelativePath!),
        normalizedRelativePath: normalizeRelativePath(bundle.transcriptRelativePath!),
        relativeDirectorySegments: splitRelativeDirectorySegments(bundle.transcriptRelativePath!),
        fileName: path.basename(bundle.transcriptRelativePath!),
        extension: '.json',
        folderHints: hints.folderHints,
        platformId: 'teta_platform',
        productFamilyHints: hints.productFamilyHints,
        productSurfaceHints: hints.productSurfaceHints,
        domainHints: hints.domainHints,
        businessAreaHints: hints.businessAreaHints,
        knowledgeAreaHints: hints.knowledgeAreaHints,
        scopeClassificationStatus: 'requires_review',
        sectionLevelClassificationRequired: hints.sectionLevelClassificationRequired,
        applicabilityReviewRequired: hints.applicabilityReviewRequired,
        contentUnits: extracted.contentUnits,
        assets: [...frameAssetByFileName.values()].map((a) => ({
          assetId: a.assetId,
          relativePortablePath: a.relativePortablePath,
          mimeType: 'image/jpeg',
          sourceOccurrences: [{ logicalSourceId, occurrenceKind: 'video_frame' }],
        })),
        warnings: extracted.warnings,
        extractionStatus: extracted.warnings.length ? 'succeeded_with_warnings' : 'succeeded',
        blockReason: null,
        metadataOnly: false,
        requiresReview: false,
        extractionOutcome: {
          transcriptExtractionStatus: 'succeeded',
          frameIndexingStatus: 'succeeded',
          mp4AssetStatus: videoPath ? 'present_vendor_only' : 'missing_vendor_only',
          mp4DurationValidationStatus: videoValidation.videoDurationValidation,
        },
        sourcePolicy: {
          rawSourceRetention: 'vendor_only',
          portableExtractedContent: true,
          clientDistributionStatus: 'candidate_not_selected',
          rawVideoClientDistributionDefault: 'exclude',
        },
        provenance: {
          inventorySourceRevisionId: null,
          extractorVersion: STAGE3J2B_EXTRACTION_VERSION,
          registryVersions: [
            regs.selectionPolicyVersion,
            regs.folderHintsVersion,
            regs.videoArchiveDefaultsVersion,
          ],
          conversion: null,
        },
        fileSha256: sha256(readFileSync(transcriptPath)),
        videoValidation,
      };
      tallyExtractionOutcome(videoSource, stats);
      sources.push(videoSource);
    }
  }

  const dedup = exactContentDedup(
    sources.map((s) => ({
      logicalSourceId: s.logicalSourceId,
      contentUnits: s.contentUnits,
      format: s.format,
      productFamilyHints: s.productFamilyHints,
      productSurfaceHints: s.productSurfaceHints,
    })),
  );
  for (const s of sources) {
    s.contentUnits = dedup.contentUnitsBySource.get(s.logicalSourceId) ?? s.contentUnits;
  }

  const manifest: ExtractionManifestV1 = {
    contractVersion: TETA_CANONICAL_SOURCE_CONTRACT_VERSION,
    extractionVersion: STAGE3J2B_EXTRACTION_VERSION,
    rootLabel: path.basename(options.root),
    fingerprintSha256: '',
    sources,
    exactDuplicates: dedup.records.filter((r) => r.sourceOccurrences.length > 1),
    policies: {
      rawDocumentClientDistributionDefault: 'exclude',
      rawVideoClientDistributionDefault: 'exclude',
      extractedTextClientDistributionStatus: 'candidate',
      extractedImageClientDistributionStatus: 'candidate',
      videoFrameClientDistributionStatus: 'candidate',
      clientAssetsSelected: 0,
    },
  };
  manifest.fingerprintSha256 = computeExtractionFingerprint(manifest);
  if (!options.dryRun) writeManifest(options.outputRoot, manifest);

  const assetStats = assetStore.getStats();
  const fileHashes = sources.map((s) => s.fileSha256).filter(Boolean) as string[];
  const fileDedup = exactFileDedup(fileHashes);
  const assetDedup = exactAssetDedup([...assetStats.portableAssetsStored ? [] : []]);

  return {
    manifest,
    stats: {
      ...stats,
      ...assetStats,
      exactDuplicateContentUnits: dedup.exactDuplicateContentUnits,
      canonicalContentUnits: dedup.canonicalContentUnits,
      sourceOccurrencesPreserved: dedup.sourceOccurrencesPreserved,
      duplicateEvidenceOccurrencesLost: dedup.duplicateEvidenceOccurrencesLost,
      exactDuplicateFiles: fileDedup.exactDuplicateFiles,
      filesExamined: discovery.filesExamined,
      ignoredFiles: discovery.ignoredFiles,
      sourceRecordsCreated: sources.length,
    },
  };
}

function buildSourceRecord(input: {
  logicalSourceId: string;
  format: CanonicalSourceRecordV1['format'];
  doc: { relativePath: string; normalizedRelativePath: string; relativeDirectorySegments: string[]; fileName: string; extension: string };
  hints: ReturnType<typeof resolveFolderHints>;
  filenameHints: ReturnType<typeof extractFilenameHints>;
  contentUnits: CanonicalSourceRecordV1['contentUnits'];
  assets: CanonicalSourceRecordV1['assets'];
  warnings: string[];
  fileSha256: string;
  conversion: CanonicalSourceRecordV1['provenance']['conversion'];
  meta: string;
}): CanonicalSourceRecordV1 {
  const hasContent = input.contentUnits.length > 0;
  const requiresConversionTool = input.conversion?.status === 'requires_conversion_tool';
  const conversionFailed = input.conversion?.status === 'conversion_failed';
  const isInvalidPdf = input.format === 'pdf' && !hasContent && input.warnings.length > 0;
  const blocked = requiresConversionTool || conversionFailed || isInvalidPdf;
  const blockReason = requiresConversionTool
    ? 'requires_conversion_tool'
    : conversionFailed
      ? 'conversion_failed'
      : isInvalidPdf
        ? 'invalid_pdf'
        : null;
  const requiresReview = Boolean(requiresConversionTool || conversionFailed || isInvalidPdf);
  const metadataOnly = !hasContent;
  const extractionStatus: CanonicalSourceRecordV1['extractionStatus'] = blocked
    ? 'blocked'
    : input.warnings.length
      ? 'succeeded_with_warnings'
      : 'succeeded';
  return {
    contractVersion: TETA_CANONICAL_SOURCE_CONTRACT_VERSION,
    logicalSourceId: input.logicalSourceId,
    sourceRevisionId: computeSourceRevisionId({
      fileSha256: input.fileSha256,
      contentUnitHashes: input.contentUnits.map((u) => u.normalizedTextSha256),
      assetIds: input.assets.map((a) => a.assetId),
      metadataFingerprint: input.meta,
    }),
    sourceType: 'document',
    format: input.format,
    sourceLabel: path.basename(input.doc.fileName, input.doc.extension),
    originalRelativePath: input.doc.relativePath,
    normalizedRelativePath: input.doc.normalizedRelativePath,
    relativeDirectorySegments: input.doc.relativeDirectorySegments,
    fileName: input.doc.fileName,
    extension: input.doc.extension,
    folderHints: input.hints.folderHints,
    platformId: 'teta_platform',
    productFamilyHints: input.hints.productFamilyHints,
    productSurfaceHints: input.hints.productSurfaceHints,
    domainHints: input.hints.domainHints,
    businessAreaHints: input.hints.businessAreaHints,
    knowledgeAreaHints: input.hints.knowledgeAreaHints,
    scopeClassificationStatus: 'requires_review',
    sectionLevelClassificationRequired: input.hints.sectionLevelClassificationRequired,
    applicabilityReviewRequired: input.hints.applicabilityReviewRequired,
    contentUnits: input.contentUnits,
    assets: input.assets,
    warnings: input.warnings,
    extractionStatus,
    blockReason,
    metadataOnly,
    requiresReview,
    sourcePolicy: {
      rawSourceRetention: 'vendor_only',
      portableExtractedContent: true,
      clientDistributionStatus: 'candidate_not_selected',
      rawDocumentClientDistributionDefault: 'exclude',
    },
    provenance: {
      inventorySourceRevisionId: null,
      extractorVersion: STAGE3J2B_EXTRACTION_VERSION,
      registryVersions: [],
      conversion: input.conversion,
    },
    fileSha256: input.fileSha256,
    productVersionHints: input.filenameHints.productVersionHints,
    documentDateHints: input.filenameHints.documentDateHints,
    sourcePurposeHints: input.hints.sourcePurposeHints,
  };
}

function tallyExtractionOutcome(source: CanonicalSourceRecordV1, stats: Record<string, number>): void {
  stats.sourceRecordsCreated += 1;
  if (source.contentUnits.length > 0) stats.sourcesWithContentUnits += 1;
  else stats.sourcesWithoutContentUnits += 1;
  if (source.metadataOnly) stats.metadataOnlySources += 1;
  if (source.requiresReview) stats.sourcesRequiringReview += 1;

  if (source.extractionStatus === 'blocked') {
    stats.contentExtractionBlocked += 1;
    return;
  }
  if (source.extractionStatus === 'succeeded_with_warnings') stats.contentExtractionWithWarnings += 1;
  else stats.contentExtractionSucceeded += 1;

  if (source.contentUnits.length === 0) stats.sourcesIncorrectlyReportedAsContentExtracted += 1;
}

export function defaultFixtureRoot(): string {
  return path.resolve(__dirname, '../../test-fixtures/teta-source-extraction/stage3j2b');
}

export function resolvePilotSources(root: string, pilot: PilotManifestV1): PilotResolution[] {
  const regs = loadStage3j2bRegistries();
  const discovery = discoverDocumentSources(root, regs.selectionPolicy);
  const allPaths = [
    ...discovery.documentCandidates.map((d) => d.relativePath),
    ...discovery.movieTranscriptCandidates.map((d) => d.relativePath),
  ];
  const resolutions: PilotResolution[] = [];
  for (const entry of pilot.entries) {
    let matches = allPaths.filter((p) =>
      entry.searchTerms.some((term) => normalizeRelativePath(p).toLowerCase().includes(term.toLowerCase())),
    );
    if (entry.preferredFolders?.length) {
      const preferred = entry.preferredFolders.map((f) => f.toLowerCase());
      const preferredMatches = matches.filter((p) => {
        const normalized = normalizeRelativePath(p).toLowerCase();
        return preferred.some((folder) => normalized.startsWith(`${folder}/`) || normalized.includes(`/${folder}/`));
      });
      if (preferredMatches.length) matches = preferredMatches;
    }
    if (entry.requiredExtensions?.length) {
      const allowed = entry.requiredExtensions.map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
      matches = matches.filter((p) => allowed.some((ext) => p.toLowerCase().endsWith(ext)));
    }
    if (!matches.length) {
      resolutions.push({ id: entry.id, status: 'not_found', matchedRelativePaths: [], logicalSourceId: null });
    } else if (matches.length > 1) {
      resolutions.push({ id: entry.id, status: 'ambiguous_source_selection', matchedRelativePaths: matches, logicalSourceId: null });
    } else {
      resolutions.push({
        id: entry.id,
        status: 'found',
        matchedRelativePaths: matches,
        logicalSourceId: matches[0].endsWith('.json')
          ? buildVideoLogicalSourceId(path.basename(matches[0], '.json'))
          : logicalSourceIdForDocument(matches[0]),
      });
    }
  }
  return resolutions;
}
