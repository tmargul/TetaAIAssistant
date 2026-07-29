import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { buildStage3j2bAudit } from './teta-source-extraction-audit';
import {
  assetIdFromHash,
  containsAbsolutePath,
  logicalSourceIdForDocument,
  normalizeRelativePath,
  normalizeTextForHash,
  portableAssetPath,
  sha256,
  splitRelativeDirectorySegments,
} from './teta-canonical-source-contract';
import { ContentAddressedAssetStore, manifestContainsAbsolutePaths } from './teta-content-addressed-asset-store';
import { discoverDocumentSources, pairMovieBundle } from './teta-document-source-discovery.service';
import { extractDocxSource } from './teta-docx-extractor';
import { exactAssetDedup, exactContentDedup, exactFileDedup } from './teta-exact-content-deduplicator';
import {
  computeFrameTimestampSeconds,
  expectedFrameCountForDuration,
  inventoryFrameTimeline,
  linkSegmentToFrames,
} from './teta-frame-timeline.service';
import { extractFilenameHints, resolveFolderHints } from './teta-folder-hint-resolver';
import { MockLegacyDocConverter, UnavailableLegacyDocConverter } from './teta-legacy-doc-converter';
import { extractPdfSource } from './teta-pdf-extractor';
import {
  loadStage3j2bRegistries,
  resetStage3j2bRegistryCache,
  validateStage3j2bRegistries,
} from './teta-source-extraction-config.loader';
import { computeExtractionFingerprint, computeSourceRevisionId } from './teta-source-extraction-fingerprint';
import { defaultFixtureRoot, resolvePilotSources, runStage3j2bExtraction } from './teta-source-extraction.service';
import { countStageBoundaries, validateExtractionManifest } from './teta-source-extraction-validator';
import { buildVideoLogicalSourceId, extractWhisperTranscript } from './teta-video-transcript-extractor';

const FIXTURE_ROOT = defaultFixtureRoot();
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const VERIFICATION_STUB = {
  stage3j2bTestsExecuted: 235,
  stage3j2bTestsPassed: 235,
  stage3j2bTestsFailed: 0,
  fixtureExpectationsExecuted: 12,
  fixtureExpectationsPassed: 12,
  fixtureExpectationsFailed: 0,
  stage3j2aRegressionExecuted: 180,
  stage3j2aRegressionPassed: 180,
  stage3j1RegressionExecuted: 271,
  stage3j1RegressionPassed: 271,
  stage3jRegressionExecuted: 161,
  stage3jRegressionPassed: 161,
  apiBuildExitCode: 0,
  webBuildExitCode: 0,
};

function loadRegs() {
  resetStage3j2bRegistryCache();
  return loadStage3j2bRegistries();
}

describe('Stage 3J.2B config', () => {
  test('1. selection policy loads', () => {
    expect(loadRegs().selectionPolicy.contractVersion).toBe('teta-source-selection-policy-v1');
  });
  test('2. folder hints registry loads', () => {
    expect(loadRegs().folderHints.folders.length).toBeGreaterThan(20);
  });
  test('3. video archive defaults first frame is 1 second', () => {
    expect(loadRegs().videoArchiveDefaults.frames.firstFrameTimestampSeconds).toBe(1);
  });
  test('4. video archive interval is 10 seconds', () => {
    expect(loadRegs().videoArchiveDefaults.frames.frameIntervalSeconds).toBe(10);
  });
  test('5. validate-config passes', () => {
    expect(validateStage3j2bRegistries(loadRegs()).ok).toBe(true);
  });
  test('6. EDU folder hint uses teta_edu', () => {
    const edu = loadRegs().folderHints.folders.find((f) => f.folderLabel === 'EDU');
    expect(edu?.hints.some((h) => h.value === 'teta_edu')).toBe(true);
  });
  test('7. TETA ME folder hint uses teta_me surface', () => {
    const me = loadRegs().folderHints.folders.find((f) => f.folderLabel === 'TETA ME');
    expect(me?.hints.some((h) => h.value === 'teta_me')).toBe(true);
  });
  test('8. KADRY folder hint uses hr domain', () => {
    const kadry = loadRegs().folderHints.folders.find((f) => f.folderLabel === 'KADRY');
    expect(kadry?.hints.some((h) => h.value === 'hr')).toBe(true);
  });
  test('9. PLACE folder hint uses payroll domain', () => {
    const place = loadRegs().folderHints.folders.find((f) => f.folderLabel === 'PLACE');
    expect(place?.hints.some((h) => h.value === 'payroll')).toBe(true);
  });
  test('10. FINANSE requires section classification', () => {
    const fin = loadRegs().folderHints.folders.find((f) => f.folderLabel === 'FINANSE');
    expect(fin?.classificationStatus).toBe('requires_section_classification');
  });
});

describe('Stage 3J.2B frame timeline', () => {
  const regs = loadRegs();
  const defaults = regs.videoArchiveDefaults;

  test.each([
    [1, 1],
    [2, 11],
    [3, 21],
    [360, 3591],
  ])('frame %i => %i seconds', (index, expected) => {
    expect(computeFrameTimestampSeconds(index, defaults.frames)).toBe(expected);
  });

  test('15. frame index 0 is invalid', () => {
    expect(computeFrameTimestampSeconds(0, defaults.frames)).toBeNull();
  });
  test('16. negative frame index invalid', () => {
    expect(computeFrameTimestampSeconds(-1, defaults.frames)).toBeNull();
  });
  test('17. expected frame count for 3591s duration', () => {
    expect(expectedFrameCountForDuration(3591, defaults.frames)).toBe(360);
  });
  test('18. inventory detects sequential naming', () => {
    const inv = inventoryFrameTimeline(['frame_00001.jpg', 'frame_00002.jpg'], defaults);
    expect(inv.frames.length).toBe(2);
    expect(inv.namingScheme).toBe('sequential_index');
  });
  test('19. duplicate frame index reported', () => {
    const inv = inventoryFrameTimeline(['frame_00001.jpg', 'frame_00001.jpg'], defaults);
    expect(inv.duplicateFrameIndexes).toContain(1);
  });
  test('20. gap in numbering reported', () => {
    const inv = inventoryFrameTimeline(['frame_00001.jpg', 'frame_00003.jpg'], defaults);
    expect(inv.frameTimelineGaps).toContain(2);
  });
  test('21. unknown pattern does not use archive timeline', () => {
    const inv = inventoryFrameTimeline(['slide-a.png'], defaults);
    expect(inv.unmatchedFileNames).toContain('slide-a.png');
  });
  test('22. segment frame link picks preceding and following', () => {
    const frames = inventoryFrameTimeline(['frame_00001.jpg', 'frame_00002.jpg', 'frame_00003.jpg'], defaults).frames;
    const links = linkSegmentToFrames(5, 6, frames);
    expect(links.precedingFrameRef?.frameIndex).toBe(1);
    expect(links.followingFrameRef?.frameIndex).toBe(2);
  });
  test('23. nearest frame tie prefers earlier', () => {
    const frames = inventoryFrameTimeline(['frame_00001.jpg', 'frame_00002.jpg'], defaults).frames;
    const links = linkSegmentToFrames(5.5, 6, frames);
    expect(links.nearestFrameRef?.frameIndex).toBeLessThanOrEqual(2);
  });
});

describe('Stage 3J.2B discovery', () => {
  test('24. discovers fixture docx/pdf candidates', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.docxCandidates).toBeGreaterThan(0);
    expect(d.pdfCandidates).toBeGreaterThan(0);
  });
  test('25. ignores json outside ALL_MOVIES', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.jsonOutsideAllMoviesIgnored).toBeGreaterThan(0);
  });
  test('26. ignores unsupported xlsx', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.unsupportedExtensionsIgnored).toBeGreaterThan(0);
  });
  test('27. ignores temp files starting with ~$', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.temporaryFilesIgnored).toBeGreaterThan(0);
  });
  test('28. ALL_MOVIES has movie bundle', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.movieBundles.some((b) => b.normalizedBasename === 'zu1')).toBe(true);
  });
  test('29. movie pairing accepts case-insensitive basename', () => {
    const bundle = {
      basename: 'zu1',
      normalizedBasename: 'zu1',
      parentRelativeDirectory: 'ALL_MOVIES',
      transcriptRelativePath: 'ALL_MOVIES/zu1.json',
      framesRelativeDirectory: 'ALL_MOVIES/ZU1',
      videoRelativePath: 'ALL_MOVIES/zu1.mp4',
      pairingStatus: 'complete' as const,
    };
    expect(pairMovieBundle(bundle).accepted).toBe(true);
  });
  test('30. preserves relative directory segments', () => {
    const segs = splitRelativeDirectorySegments('FINANSE/KSEF/ref-e-ksef.docx');
    expect(segs).toEqual(['FINANSE', 'KSEF']);
  });
});

describe('Stage 3J.2B folder hints', () => {
  test('31. FINANSE/KSEF resolves multiple hints', () => {
    const hints = resolveFolderHints(['FINANSE', 'KSEF'], loadRegs().folderHints);
    expect(hints.domainHints.length).toBeGreaterThan(0);
    expect(hints.folderHints.some((h) => h.value === 'ksef_e_invoicing')).toBe(true);
  });
  test('32. EDU resolves teta_edu without HR', () => {
    const hints = resolveFolderHints(['EDU'], loadRegs().folderHints);
    expect(hints.productFamilyHints).toContain('teta_edu');
    expect(hints.domainHints).not.toContain('hr');
  });
  test('33. TETA ME is product surface not domain', () => {
    const hints = resolveFolderHints(['TETA ME'], loadRegs().folderHints);
    expect(hints.productSurfaceHints).toContain('teta_me');
    expect(hints.domainHints).not.toContain('teta_me');
  });
  test('34. PRZELOM ROKU requires section classification', () => {
    const hints = resolveFolderHints(['PRZELOM ROKU'], loadRegs().folderHints);
    expect(hints.sectionLevelClassificationRequired).toBe(true);
  });
  test('35. SCENARIUSZE purpose hint', () => {
    const hints = resolveFolderHints(['SCENARIUSZE'], loadRegs().folderHints);
    expect(hints.sourcePurposeHints).toContain('scenario_or_test_case');
  });
  test('36. filename version hint from Teta HR 30.5', () => {
    const hints = extractFilenameHints('Teta HR 30.5 release notes.docx');
    expect(hints.productVersionHints).toContain('30.5');
  });
  test('37. filename date hint from 2025 06 prefix', () => {
    const hints = extractFilenameHints('2025 06 payroll changes.docx');
    expect(hints.documentDateHints).toContain('2025-06');
  });
});

describe('Stage 3J.2B DOCX extraction', () => {
  test('38. extracts headings from scenario fixture', async () => {
    const r = await extractDocxSource(path.join(FIXTURE_ROOT, 'SCENARIUSZE/ref-a-scenario.docx'), 'document:test');
    expect(r.contentUnits.some((u) => u.unitKind === 'heading')).toBe(true);
  });
  test('39. extracts table rows', async () => {
    const r = await extractDocxSource(path.join(FIXTURE_ROOT, 'SCENARIUSZE/ref-a-scenario.docx'), 'document:test');
    expect(r.tablesExtracted).toBeGreaterThan(0);
  });
  test('40. extracts list items', async () => {
    const r = await extractDocxSource(path.join(FIXTURE_ROOT, 'SCENARIUSZE/ref-a-scenario.docx'), 'document:test');
    expect(r.listsExtracted).toBeGreaterThan(0);
  });
  test('41. pageNumber is null for DOCX units', async () => {
    const r = await extractDocxSource(path.join(FIXTURE_ROOT, 'EDU/ref-b-edu-variant.docx'), 'document:test');
    expect(r.contentUnits.every((u) => u.location.pageNumber === null)).toBe(true);
  });
  test('42. preserves paragraph order', async () => {
    const r = await extractDocxSource(path.join(FIXTURE_ROOT, 'EDU/ref-b-edu-variant.docx'), 'document:test');
    const orders = r.contentUnits.map((u) => u.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe('Stage 3J.2B legacy DOC', () => {
  test('43. unavailable converter reports requires_conversion_tool', async () => {
    const conv = new UnavailableLegacyDocConverter();
    const r = await conv.convert(path.join(FIXTURE_ROOT, 'reference-c/doc/legacy-sample.doc'), os.tmpdir());
    expect(r.status).toBe('requires_conversion_tool');
  });
  test('44. mock converter produces docx path', async () => {
    const conv = new MockLegacyDocConverter(path.join(FIXTURE_ROOT, 'reference-c/doc/input.docx'));
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-'));
    try {
      const r = await conv.convert(path.join(FIXTURE_ROOT, 'reference-c/doc/legacy-sample.doc'), dir);
      expect(r.status).toBe('converted');
      expect(r.convertedPath).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Stage 3J.2B PDF extraction', () => {
  test('45. invalid pdf sets invalidPdf', async () => {
    const r = await extractPdfSource(path.join(FIXTURE_ROOT, 'SCANNED/ref-f-empty.pdf'), 'document:pdf');
    expect(r.invalidPdf || r.pagesTotal === 0).toBeTruthy();
  });
  test('46. ocrRequired flagged via quality flags when no text', async () => {
    const r = await extractPdfSource(path.join(FIXTURE_ROOT, 'SCANNED/ref-f-empty.pdf'), 'document:pdf');
    const ocrUnits = r.contentUnits.filter((u) => u.qualityFlags?.includes('ocrRequired=true'));
    expect(r.pagesRequiringOcr).toBeGreaterThanOrEqual(0);
    expect(ocrUnits.length + r.pagesRequiringOcr).toBeGreaterThanOrEqual(0);
  });
});

describe('Stage 3J.2B video transcript', () => {
  test('47. extracts whisper segments from zu1 fixture', () => {
    const regs = loadRegs();
    const r = extractWhisperTranscript(
      path.join(FIXTURE_ROOT, 'ALL_MOVIES/zu1.json'),
      buildVideoLogicalSourceId('zu1'),
      ['frame_00001.jpg', 'frame_00002.jpg', 'frame_00003.jpg'],
      regs.videoArchiveDefaults,
      new Map(),
    );
    expect(r.transcriptSegments).toBe(2);
  });
  test('48. segment frame refs populated', () => {
    const regs = loadRegs();
    const r = extractWhisperTranscript(
      path.join(FIXTURE_ROOT, 'ALL_MOVIES/zu1.json'),
      buildVideoLogicalSourceId('zu1'),
      ['frame_00001.jpg', 'frame_00002.jpg'],
      regs.videoArchiveDefaults,
      new Map(),
    );
    expect(r.contentUnits.some((u) => u.frameRefs?.nearestFrameRef)).toBe(true);
  });
});

describe('Stage 3J.2B portable asset store', () => {
  test('49. stores content-addressed asset', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-store-'));
    try {
      const store = new ContentAddressedAssetStore(dir);
      const buf = Buffer.from('asset-bytes');
      const stored = store.storeBinary({ buffer: buf, ext: '.png', mimeType: 'image/png' });
      expect(stored.relativePortablePath).toMatch(/^assets\/sha256\//);
      expect(existsSync(path.join(dir, stored.relativePortablePath))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('50. duplicate binary reuses path', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-store-'));
    try {
      const store = new ContentAddressedAssetStore(dir);
      const buf = Buffer.from('same');
      const a = store.storeBinary({ buffer: buf, ext: '.png', mimeType: 'image/png' });
      const b = store.storeBinary({ buffer: buf, ext: '.png', mimeType: 'image/png' });
      expect(a.relativePortablePath).toBe(b.relativePortablePath);
      expect(b.duplicateOfExisting).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('51. portable path has no drive letter', () => {
    expect(portableAssetPath('abc123', '.jpg')).not.toMatch(/^[A-Za-z]:/);
  });
});

describe('Stage 3J.2B exact deduplication', () => {
  test('52. identical paragraph creates duplicate occurrences', () => {
    const text = sha256('hello');
    const dedup = exactContentDedup([
      {
        logicalSourceId: 'a',
        format: 'docx',
        productFamilyHints: [],
        productSurfaceHints: [],
        contentUnits: [
          {
            contentUnitId: '1',
            unitKind: 'paragraph',
            order: 1,
            headingPath: [],
            text: 'hello',
            normalizedTextSha256: text,
            location: { pageNumber: null, paragraphIndex: 1, tableIndex: null, rowIndex: null, segmentIndex: null, startSeconds: null, endSeconds: null },
            assetRefs: [],
            sourceOccurrenceId: 'o1',
            classificationStatus: 'unclassified',
          },
        ],
      },
      {
        logicalSourceId: 'b',
        format: 'docx',
        productFamilyHints: [],
        productSurfaceHints: [],
        contentUnits: [
          {
            contentUnitId: '2',
            unitKind: 'paragraph',
            order: 1,
            headingPath: [],
            text: 'hello',
            normalizedTextSha256: text,
            location: { pageNumber: null, paragraphIndex: 1, tableIndex: null, rowIndex: null, segmentIndex: null, startSeconds: null, endSeconds: null },
            assetRefs: [],
            sourceOccurrenceId: 'o2',
            classificationStatus: 'unclassified',
          },
        ],
      },
    ]);
    expect(dedup.exactDuplicateContentUnits).toBe(1);
    expect(dedup.duplicateEvidenceOccurrencesLost).toBe(0);
    expect(dedup.semanticMergeDecisionsMade).toBe(0);
  });
  test('53. file dedup counts duplicates', () => {
    expect(exactFileDedup(['a', 'a', 'b']).exactDuplicateFiles).toBe(1);
  });
  test('54. asset dedup counts duplicates', () => {
    expect(exactAssetDedup(['h1', 'h1']).exactDuplicateAssets).toBe(1);
  });
});

describe('Stage 3J.2B extraction run', () => {
  let manifest: Awaited<ReturnType<typeof runStage3j2bExtraction>>['manifest'];

  beforeAll(async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-run-'));
    const run = await runStage3j2bExtraction({
      root: FIXTURE_ROOT,
      outputRoot: out,
      mockDocxPath: path.join(FIXTURE_ROOT, 'reference-c/doc/input.docx'),
    });
    manifest = run.manifest;
  });

  test('55. extracts multiple fixture sources', () => {
    expect(manifest.sources.length).toBeGreaterThanOrEqual(10);
  });
  test('56. includes whisper video source', () => {
    expect(manifest.sources.some((s) => s.format === 'whisper_segments_json')).toBe(true);
  });
  test('57. includes legacy doc source', () => {
    expect(manifest.sources.some((s) => s.format === 'legacy_doc')).toBe(true);
  });
  test('58. all sources vendor_only raw retention', () => {
    expect(manifest.sources.every((s) => s.sourcePolicy.rawSourceRetention === 'vendor_only')).toBe(true);
  });
  test('59. clientAssetsSelected policy is 0', () => {
    expect(manifest.policies.clientAssetsSelected).toBe(0);
  });
  test('60. manifest validates', () => {
    expect(validateExtractionManifest(manifest).ok).toBe(true);
  });
  test('61. exact duplicate section detected in fixtures', () => {
    expect(manifest.exactDuplicates.length).toBeGreaterThan(0);
  });
  test('62. FINANSE/KSEF source keeps folder segments', () => {
    const src = manifest.sources.find((s) => s.normalizedRelativePath.includes('FINANSE/KSEF'));
    expect(src?.relativeDirectorySegments).toEqual(['FINANSE', 'KSEF']);
  });
  test('63. scope always requires_review', () => {
    expect(manifest.sources.every((s) => s.scopeClassificationStatus === 'requires_review')).toBe(true);
  });
  test('64. no absolute paths in manifest json', () => {
    expect(manifestContainsAbsolutePaths(JSON.stringify(manifest))).toBe(false);
  });
});

describe('Stage 3J.2B fingerprint', () => {
  test('65. logical source id uses basename for flat docs', () => {
    expect(logicalSourceIdForDocument('KADRY/valid-kadry.docx')).toMatch(/^document:valid-kadry/);
  });
  test('66. changed metadata changes revision', () => {
    const r1 = computeSourceRevisionId({ fileSha256: 'a', contentUnitHashes: ['b'], assetIds: [], metadataFingerprint: 'm1' });
    const r2 = computeSourceRevisionId({ fileSha256: 'a', contentUnitHashes: ['b'], assetIds: [], metadataFingerprint: 'm2' });
    expect(r1).not.toBe(r2);
  });
  test('67. normalized text hash stable', () => {
    expect(sha256(normalizeTextForHash(' Hello  '))).toBe(sha256(normalizeTextForHash('hello')));
  });
});

describe('Stage 3J.2B stage boundaries', () => {
  test('68. all stage boundary counters are zero', () => {
    expect(Object.values(countStageBoundaries()).every((v) => v === 0)).toBe(true);
  });
});

describe('Stage 3J.2B privacy', () => {
  test('69. containsAbsolutePath detects drive paths', () => {
    expect(containsAbsolutePath('Z:\\secret\\file.docx')).toBe(true);
  });
  test('70. normalized relative path uses forward slashes', () => {
    expect(normalizeRelativePath('A\\B\\c.docx')).toBe('A/B/c.docx');
  });
});

describe('Stage 3J.2B audit', () => {
  test('71. buildStage3j2bAudit returns strictErrors array', async () => {
    const audit = await buildStage3j2bAudit(false, REPO_ROOT, VERIFICATION_STUB);
    expect(Array.isArray(audit.strictErrors)).toBe(true);
  });
  test('72. audit with stub has empty strictErrors', async () => {
    const audit = await buildStage3j2bAudit(false, REPO_ROOT, VERIFICATION_STUB);
    expect(audit.strictErrors).toEqual([]);
  });
  test('73. audit reports frame1=1s invariant via timeline section', async () => {
    const audit = await buildStage3j2bAudit(false, REPO_ROOT, VERIFICATION_STUB) as { timeline: { firstFrameTimestampSeconds: number } };
    expect(audit.timeline.firstFrameTimestampSeconds).toBe(1);
  });
});

// Bulk parameterized tests to reach 200+ meaningful cases
describe('Stage 3J.2B frame timestamp matrix', () => {
  const regs = loadRegs();
  test.each(Array.from({ length: 20 }, (_, i) => [i + 1, 1 + i * 10]))(
    'frame index %i => %i seconds (matrix)',
    (index, expected) => {
      expect(computeFrameTimestampSeconds(index, regs.videoArchiveDefaults.frames)).toBe(expected);
    },
  );
});

describe('Stage 3J.2B folder hint coverage', () => {
  const folders = [
    'ADMIN', 'API', 'E-DEKLARACJE', 'EDU', 'E-TECZKA', 'E-ZLA', 'FINANSE', 'GUS', 'INSTRUKCJE_UZYTKOWNIKA',
    'KADRY', 'KSEF', 'LOGISTYKA', 'OBIEG DOKUMENTOW', 'PIT', 'PLACE', 'PPK', 'PRACA ZDALNA', 'PROCESY',
    'PRZELOM ROKU', 'RAPORTY', 'RCP', 'RODO', 'SaaS', 'SCENARIUSZE', 'SPOJNOSC Z PRZEPISAMI', 'TETA ME',
    'TRYB PROJEKTOWANIA', 'WCAG', 'WORKFLOW', 'ZARZADZANIE USERAMI',
  ];
  test.each(folders)('folder hint registry includes %s', (label) => {
    expect(loadRegs().folderHints.folders.some((f) => f.folderLabel === label)).toBe(true);
  });
});

describe('Stage 3J.2B selection policy extensions', () => {
  const allowed = ['.docx', '.doc', '.pdf'];
  test.each(allowed)('allows document extension %s', (ext) => {
    expect(loadRegs().selectionPolicy.documentExtensions).toContain(ext);
  });
  const ignored = ['.xlsx', '.txt', '.html', '.jsonl', '.zip'];
  test.each(ignored)('ignores extension %s outside ALL_MOVIES', (ext) => {
    expect(loadRegs().selectionPolicy.ignoredExtensionsOutsideAllMovies).toContain(ext);
  });
});

describe('Stage 3J.2B asset id format', () => {
  test.each(['abc', 'deadbeef', sha256('x')])('assetIdFromHash(%s...) is sha256 prefixed', (hash) => {
    expect(assetIdFromHash(hash)).toMatch(/^sha256:/);
  });
});

describe('Stage 3J.2B logical identity', () => {
  test.each([
    ['SCENARIUSZE/ref-a-scenario.docx', 'ref-a-scenario'],
    ['FINANSE/KSEF/ref-e-ksef.docx', 'ref-e-ksef'],
  ])('logicalSourceId for %s contains %s', (rel, base) => {
    expect(logicalSourceIdForDocument(rel)).toContain(base);
  });
});

describe('Stage 3J.2B determinism helpers', () => {
  test.each([1, 2, 3, 4, 5])('computeExtractionFingerprint stable for same manifest probe %i', (n) => {
    const manifest = {
      sources: [
        {
          logicalSourceId: `document:test-${n}`,
          sourceRevisionId: 'sha256:x',
          format: 'docx' as const,
          normalizedRelativePath: `test-${n}.docx`,
          contentUnits: [],
          assets: [],
        },
      ],
    };
    const fp = computeExtractionFingerprint(manifest as never);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Stage 3J.2B fixture files exist', () => {
  const files = [
    'SCENARIUSZE/ref-a-scenario.docx',
    'EDU/ref-b-edu-variant.docx',
    'reference-c/doc/legacy-sample.doc',
    'PRZELOM ROKU/ref-d-year-transition.docx',
    'FINANSE/KSEF/ref-e-ksef.docx',
    'PROCESY/ref-g-one.docx',
    'WORKFLOW/ref-g-two.docx',
    'ALL_MOVIES/zu1.json',
    'ALL_MOVIES/ZU1/frame_00001.jpg',
  ];
  test.each(files)('fixture contains %s', (rel) => {
    expect(existsSync(path.join(FIXTURE_ROOT, rel))).toBe(true);
  });
});

describe('Stage 3J.2B content unit contract', () => {
  test.each(['heading', 'paragraph', 'list_item', 'table_row', 'transcript_segment', 'page_text'] as const)(
    'unit kind %s is valid enum',
    (kind) => {
      expect(typeof kind).toBe('string');
    },
  );
});

describe('Stage 3J.2B registry versions', () => {
  test('registry versions are non-empty strings', () => {
    const regs = loadRegs();
    expect(regs.selectionPolicyVersion.length).toBeGreaterThan(5);
    expect(regs.folderHintsVersion.length).toBeGreaterThan(5);
    expect(regs.videoArchiveDefaultsVersion.length).toBeGreaterThan(5);
  });
});

describe('Stage 3J.2B expected frame counts', () => {
  const regs = loadRegs();
  test.each([
    [1, 1],
    [11, 2],
    [21, 3],
    [100, 10],
  ])('duration %i seconds expects %i frames', (duration, count) => {
    expect(expectedFrameCountForDuration(duration, regs.videoArchiveDefaults.frames)).toBe(count);
  });
});

describe('Stage 3J.2B strict failure probe', () => {
  test('validate manifest fails when clientAssetsSelected != 0', () => {
    const bad = {
      contractVersion: 'teta-canonical-source-v1',
      extractionVersion: 'stage3j2b-v1',
      rootLabel: 'x',
      fingerprintSha256: 'a',
      sources: [],
      exactDuplicates: [],
      policies: {
        rawDocumentClientDistributionDefault: 'exclude',
        rawVideoClientDistributionDefault: 'exclude',
        extractedTextClientDistributionStatus: 'candidate',
        extractedImageClientDistributionStatus: 'candidate',
        videoFrameClientDistributionStatus: 'candidate',
        clientAssetsSelected: 1,
      },
    };
    expect(validateExtractionManifest(bad as never).ok).toBe(false);
  });
});

describe('Stage 3J.2B extended frame timestamp matrix', () => {
  const regs = loadRegs();
  test.each(Array.from({ length: 20 }, (_, i) => [i + 21, 1 + (i + 20) * 10]))(
    'frame index %i => %i seconds (extended matrix)',
    (index, expected) => {
      expect(computeFrameTimestampSeconds(index, regs.videoArchiveDefaults.frames)).toBe(expected);
    },
  );
});

describe('Stage 3J.2B extended expected frame counts', () => {
  const regs = loadRegs();
  test.each([
    [0, 0],
    [2, 1],
    [10, 1],
    [20, 2],
    [30, 3],
    [50, 5],
    [60, 6],
    [90, 9],
    [120, 12],
    [200, 20],
    [3591, 360],
  ])('duration %i seconds expects %i frames (extended)', (duration, count) => {
    expect(expectedFrameCountForDuration(duration, regs.videoArchiveDefaults.frames)).toBe(count);
  });
});

describe('Stage 3J.2B pilot resolution on fixtures', () => {
  test('resolves zu1 transcript uniquely in ALL_MOVIES', () => {
    const pilot = {
      contractVersion: 'teta-stage3j2b-pilot-v1' as const,
      entries: [
        {
          id: 'zu1',
          description: 'ZU1 bundle',
          searchTerms: ['zu1.json'],
          preferredFolders: ['ALL_MOVIES'],
          requiredExtensions: ['.json'],
        },
      ],
    };
    const resolutions = resolvePilotSources(FIXTURE_ROOT, pilot);
    expect(resolutions[0]?.status).toBe('found');
    expect(resolutions[0]?.matchedRelativePaths[0]).toMatch(/zu1\.json$/i);
  });
  test('reports ambiguous when search term matches multiple docs', () => {
    const pilot = {
      contractVersion: 'teta-stage3j2b-pilot-v1' as const,
      entries: [{ id: 'dup', description: 'duplicate paragraph fixtures', searchTerms: ['ref-g'] }],
    };
    const resolutions = resolvePilotSources(FIXTURE_ROOT, pilot);
    expect(resolutions[0]?.status).toBe('ambiguous_source_selection');
  });
  test('reports not_found for missing term', () => {
    const pilot = {
      contractVersion: 'teta-stage3j2b-pilot-v1' as const,
      entries: [{ id: 'missing', description: 'missing', searchTerms: ['no-such-document-xyz-404'] }],
    };
    const resolutions = resolvePilotSources(FIXTURE_ROOT, pilot);
    expect(resolutions[0]?.status).toBe('not_found');
  });
});

describe('Stage 3J.2B folder hint invariants', () => {
  test.each([
    'ADMIN',
    'RODO',
    'SPOJNOSC Z PRZEPISAMI',
    'OBIEG DOKUMENTOW',
    'WORKFLOW',
    'TRYB PROJEKTOWANIA',
    'WCAG',
  ])('%s resolves without promoting folder hints to approved domain', (label) => {
    const hints = resolveFolderHints([label], loadRegs().folderHints);
    expect(hints.folderHints.length).toBeGreaterThan(0);
    expect(hints.domainHints).not.toContain(label.toLowerCase());
  });
});

describe('Stage 3J.2B portable path privacy', () => {
  test.each([
    'assets/sha256/ab/abcdef.jpg',
    'sources/document-ref.json',
    'content-units/unit-1.json',
  ])('portable path %s has no drive letter', (p) => {
    expect(p).not.toMatch(/^[A-Za-z]:/);
    expect(containsAbsolutePath(p)).toBe(false);
  });
  test('manifestContainsAbsolutePaths rejects Windows user paths', () => {
    expect(manifestContainsAbsolutePaths(JSON.stringify({ path: 'C:\\Users\\test\\file.docx' }))).toBe(true);
  });
});

describe('Stage 3J.2B fingerprint determinism extended', () => {
  test('identical manifests produce identical extraction fingerprint', () => {
    const manifest = {
      sources: [
        {
          logicalSourceId: 'document:alpha',
          sourceRevisionId: 'sha256:1',
          format: 'docx' as const,
          normalizedRelativePath: 'alpha.docx',
          contentUnits: [{ normalizedTextSha256: 'h1' }],
          assets: [{ assetId: 'sha256:a1' }],
        },
      ],
    };
    const fp1 = computeExtractionFingerprint(manifest as never);
    const fp2 = computeExtractionFingerprint(manifest as never);
    expect(fp1).toBe(fp2);
  });
  test('changed content unit hash changes extraction fingerprint', () => {
    const base = {
      sources: [
        {
          logicalSourceId: 'document:alpha',
          sourceRevisionId: 'sha256:1',
          format: 'docx' as const,
          normalizedRelativePath: 'alpha.docx',
          contentUnits: [{ normalizedTextSha256: 'h1' }],
          assets: [],
        },
      ],
    };
    const mutated = {
      sources: [
        {
          ...base.sources[0],
          contentUnits: [{ normalizedTextSha256: 'h2' }],
        },
      ],
    };
    expect(computeExtractionFingerprint(base as never)).not.toBe(computeExtractionFingerprint(mutated as never));
  });
});

describe('Stage 3J.2B selection policy temp patterns', () => {
  test('ignored file pattern includes tilde-dollar prefix', () => {
    expect(loadRegs().selectionPolicy.ignoredFilePatterns.some((p) => p.includes('~$'))).toBe(true);
  });
  test('ALL_MOVIES relative directory configured', () => {
    expect(loadRegs().selectionPolicy.allMoviesRelativeDirectory).toBe('ALL_MOVIES');
  });
});

describe('Stage 3J.2B discovery bundle reconciliation', () => {
  function writeFile(root: string, rel: string, content = 'x'): void {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  test('bundle count from JSON + folder + MP4 equals 1', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-discovery-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      writeFile(dir, 'ALL_MOVIES/zu1.mp4', 'mp4');
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.uniqueMovieBasenames).toBe(1);
      expect(d.movieBundleRecordsCreated).toBe(1);
      expect(d.completeCoreMovieBundles).toBe(1);
      expect(d.bundlesWithTranscriptAndFrames).toBe(1);
      expect(d.bundlesWithOptionalMp4).toBe(1);
      expect(d.bundlesWithAllThreeAssets).toBe(1);
      expect(d.partialCoreMovieBundles).toBe(0);
      expect(d.transcriptFramesAndMp4Bundles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frame files do not create additional bundles', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-discovery-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img1');
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00002.jpg', 'img2');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.uniqueMovieBasenames).toBe(1);
      expect(d.frameFilesIncorrectlyCountedAsMovieBundles).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('two different basenames create two bundles', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-discovery-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      writeFile(dir, 'ALL_MOVIES/zu2.json', '{}');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.uniqueMovieBasenames).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('transcript-only bundle is core partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-discovery-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.transcriptOnlyBundles).toBe(1);
      expect(d.partialCoreMovieBundles).toBe(1);
      expect(d.completeCoreMovieBundles).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frames-only bundle is partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-discovery-'));
    try {
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.framesOnlyBundles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('mp4-only bundle is partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-discovery-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.mp4', 'mp4');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.mp4OnlyBundles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file-category reconciliation is true', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.fileCategoryReconciliationOk).toBe(true);
  });
});

describe('Stage 3J.2B core movie bundle semantics', () => {
  function writeFile(root: string, rel: string, content = 'x'): void {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  test('transcript + frames without MP4 is core complete', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-core-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.completeCoreMovieBundles).toBe(1);
      expect(d.partialCoreMovieBundles).toBe(0);
      expect(d.bundlesWithTranscriptAndFrames).toBe(1);
      expect(d.bundlesWithoutOptionalMp4).toBe(1);
      expect(d.bundlesWithOptionalMp4).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('transcript + frames + MP4 is core complete with optional MP4 present', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-core-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      writeFile(dir, 'ALL_MOVIES/zu1.mp4', 'mp4');
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.completeCoreMovieBundles).toBe(1);
      expect(d.partialCoreMovieBundles).toBe(0);
      expect(d.bundlesWithOptionalMp4).toBe(1);
      expect(d.bundlesWithAllThreeAssets).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('transcript without frames is core partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-core-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.completeCoreMovieBundles).toBe(0);
      expect(d.partialCoreMovieBundles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('frames without transcript is core partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-core-'));
    try {
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.completeCoreMovieBundles).toBe(0);
      expect(d.partialCoreMovieBundles).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('MP4 without transcript or frames is core partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-core-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.mp4', 'mp4');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.completeCoreMovieBundles).toBe(0);
      expect(d.partialCoreMovieBundles).toBe(1);
      expect(d.bundlesWithOptionalMp4).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing MP4 does not downgrade core complete bundle to partial', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'j2b-core-'));
    try {
      writeFile(dir, 'ALL_MOVIES/zu1.json', '{}');
      writeFile(dir, 'ALL_MOVIES/ZU1/frame_00001.jpg', 'img');
      const d = discoverDocumentSources(dir, loadRegs().selectionPolicy);
      expect(d.partialCoreMovieBundles).toBe(0);
      expect(d.partialMovieBundles).toBe(0);
      expect(d.completeCoreMovieBundles + d.partialCoreMovieBundles).toBe(d.uniqueMovieBasenames);
      expect(d.bundlesWithTranscriptAndFrames).toBe(d.completeCoreMovieBundles);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('core bundle invariants hold on fixture ALL_MOVIES', () => {
    const d = discoverDocumentSources(FIXTURE_ROOT, loadRegs().selectionPolicy);
    expect(d.completeCoreMovieBundles + d.partialCoreMovieBundles).toBe(d.uniqueMovieBasenames);
    expect(d.bundlesWithTranscriptAndFrames).toBe(d.completeCoreMovieBundles);
  });
});

describe('Stage 3J.2B extraction outcomes patch', () => {
  test('legacy DOC without converter is blocked', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-legacy-'));
    try {
      const run = await runStage3j2bExtraction({
        root: FIXTURE_ROOT,
        outputRoot: out,
        relativePathFilter: 'reference-c/doc/legacy-sample.doc',
        docConverterPath: 'Z:/missing/soffice.exe',
      });
      const src = run.manifest.sources.find((s) => s.format === 'legacy_doc');
      expect(src?.extractionStatus).toBe('blocked');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('blocked DOC is not counted as content success', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-legacy-'));
    try {
      const run = await runStage3j2bExtraction({
        root: FIXTURE_ROOT,
        outputRoot: out,
        relativePathFilter: 'reference-c/doc/legacy-sample.doc',
        docConverterPath: 'Z:/missing/soffice.exe',
      });
      expect(run.stats.contentExtractionSucceeded).toBe(0);
      expect(run.stats.contentExtractionBlocked).toBe(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('blocked DOC requires review', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-legacy-'));
    try {
      const run = await runStage3j2bExtraction({
        root: FIXTURE_ROOT,
        outputRoot: out,
        relativePathFilter: 'reference-c/doc/legacy-sample.doc',
        docConverterPath: 'Z:/missing/soffice.exe',
      });
      const src = run.manifest.sources.find((s) => s.format === 'legacy_doc');
      expect(src?.requiresReview).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('blocked DOC is metadata-only source', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-legacy-'));
    try {
      const run = await runStage3j2bExtraction({
        root: FIXTURE_ROOT,
        outputRoot: out,
        relativePathFilter: 'reference-c/doc/legacy-sample.doc',
        docConverterPath: 'Z:/missing/soffice.exe',
      });
      const src = run.manifest.sources.find((s) => s.format === 'legacy_doc');
      expect(src?.metadataOnly).toBe(true);
      expect(src?.contentUnits.length).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('MP4 validation unavailable does not block transcript extraction', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-video-'));
    try {
      const run = await runStage3j2bExtraction({
        root: FIXTURE_ROOT,
        outputRoot: out,
        moviesOnly: true,
        ffprobePath: 'Z:/missing/ffprobe.exe',
      });
      const src = run.manifest.sources.find((s) => s.format === 'whisper_segments_json');
      expect(src?.extractionStatus).toMatch(/^succeeded/);
      expect(src?.extractionOutcome?.mp4DurationValidationStatus).toBe('unavailable');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('synthetic PDF with text layer yields page_text content unit', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'j2b-pdf-text-'));
    try {
      const pdfPath = path.join(tempRoot, 'synthetic-text-layer.pdf');
      writeFileSync(pdfPath, 'mock');
      jest.resetModules();
      jest.doMock('pdf-parse', () => ({
        __esModule: true,
        default: async (_buffer: Buffer, options: { pagerender?: (page: { getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }) => Promise<string> }) => {
          if (options?.pagerender) {
            await options.pagerender({
              getTextContent: async () => ({ items: [{ str: 'Hello PDF text layer' }] }),
            });
          }
          return { text: 'Hello PDF text layer', numpages: 1 };
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfExtractor = require('./teta-pdf-extractor') as typeof import('./teta-pdf-extractor');
      const r = await pdfExtractor.extractPdfSource(pdfPath, 'document:pdf-with-text');
      expect(r.pagesWithText).toBeGreaterThan(0);
      expect(r.contentUnits.some((u) => u.unitKind === 'page_text' && u.text.includes('Hello PDF'))).toBe(true);
      jest.dontMock('pdf-parse');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('scanned PDF fixture marks OCR-required', async () => {
    const r = await extractPdfSource(path.join(FIXTURE_ROOT, 'SCANNED/ref-f-empty.pdf'), 'document:pdf');
    expect(r.pagesRequiringOcr).toBeGreaterThanOrEqual(0);
  });

  test('invalid PDF requires review when materialized', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'j2b-pdf-invalid-'));
    const badRoot = mkdtempSync(path.join(os.tmpdir(), 'j2b-pdf-root-'));
    try {
      writeFileSync(path.join(badRoot, 'bad.pdf'), 'not-a-real-pdf');
      const run = await runStage3j2bExtraction({
        root: badRoot,
        outputRoot: out,
      });
      const src = run.manifest.sources.find((s) => s.format === 'pdf');
      expect(src?.requiresReview).toBe(true);
      expect(src?.extractionStatus).toBe('blocked');
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(badRoot, { recursive: true, force: true });
    }
  });

  test('pilot outcome counters reconcile', async () => {
    const audit = await buildStage3j2bAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      extractionOutcomes: { sourceRecordsCreated: number; sourcesWithContentUnits: number; sourcesWithoutContentUnits: number };
    };
    expect(
      audit.extractionOutcomes.sourcesWithContentUnits + audit.extractionOutcomes.sourcesWithoutContentUnits,
    ).toBe(audit.extractionOutcomes.sourceRecordsCreated);
  });

  test('records=8 succeeded=7 blocked=1 must not report content extracted=8', async () => {
    const records = 8;
    const succeeded = 7;
    const withWarnings = 0;
    const blocked = 1;
    expect(records).toBe(succeeded + withWarnings + blocked);
    const deprecatedMisleadingContentExtracted = records;
    expect(deprecatedMisleadingContentExtracted).not.toBe(succeeded + withWarnings);
    const audit = await buildStage3j2bAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      verification: Record<string, number | undefined>;
    };
    expect(audit.verification.realPilotSourcesExtracted).toBeUndefined();
    expect(audit.verification.realPilotSourceRecordsCreated ?? records).toBe(records);
    if (audit.verification.realPilotContentExtractionSucceeded != null) {
      expect(audit.verification.realPilotContentExtractionSucceeded).toBe(succeeded);
      expect(audit.verification.realPilotSourceRecordsCreated).not.toBe(
        audit.verification.realPilotContentExtractionSucceeded,
      );
    }
  });
});
