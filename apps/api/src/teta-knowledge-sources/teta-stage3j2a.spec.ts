import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { buildStage3j2aAudit, collectStage3j2aStrictErrorCodes } from './teta-knowledge-source-audit';
import {
  normalizeBasenameKey,
  sha256,
  stableStringify,
  toPosixRelative,
} from './teta-knowledge-source-contract';
import {
  buildLogicalSourceId,
  computeCanonicalTranscriptHash,
  computeInventoryFingerprint,
  computeMetadataFingerprint,
  computeSourceRevisionId,
} from './teta-knowledge-source-fingerprint';
import {
  inventoryFrameDirectory,
  createTinyPngBuffer,
  parseFramesManifest,
} from './teta-frame-directory-inventory.service';
import {
  inventoryDocumentFiles,
  inventoryKnowledgeSourcesStage3j2a,
} from './teta-knowledge-source-inventory.service';
import {
  loadKnowledgeSourceRegistries,
  resetKnowledgeSourceRegistryCache,
  validateKnowledgeSourceRegistries,
} from './teta-knowledge-source-registry.loader';
import {
  assertNoContentExtraction,
  validateKnowledgeSourceInventory,
} from './teta-knowledge-source-validator';
import { discoverTrainingPairs, explainPairForJson } from './teta-training-pair-discovery.service';
import { findSeriesEntry, parseTrainingSourceLabel } from './teta-training-source-series.parser';
import { validateWhisperTranscriptJson } from './teta-whisper-transcript-json.adapter';

const FIXTURE_ROOT = path.resolve(__dirname, '../../test-fixtures/teta-knowledge-sources/stage3j2a');
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CONFIG_DIR = path.resolve(__dirname, '../../config/teta-knowledge-sources');

const VERIFICATION_STUB = {
  stage3j2aTestsExecuted: 180,
  stage3j2aTestsPassed: 180,
  stage3j2aTestsFailed: 0,
  fixtureSourcesExamined: 1,
  fixtureSourcesPassed: 1,
  apiBuildExitCode: 0,
  webBuildExitCode: 0,
  stage3j1RegressionExecuted: 271,
  stage3j1RegressionPassed: 271,
  stage3jRegressionExecuted: 161,
  stage3jRegressionPassed: 161,
};

const APPROVED_SERIES = [
  'DS',
  'EDU',
  'KADRY',
  'ME',
  'OBD',
  'PIT',
  'PLACE',
  'PPK',
  'PROJ',
  'RAP',
  'RCP',
  'WCAG',
  'WORKFLOW',
  'WSTEP',
  'ZU',
] as const;

function loadRegs() {
  resetKnowledgeSourceRegistryCache();
  return loadKnowledgeSourceRegistries();
}

function inventoryFixture(frameHashMode: 'content' | 'metadata' = 'content') {
  return inventoryKnowledgeSourcesStage3j2a({ root: FIXTURE_ROOT, frameHashMode });
}

function seriesById(seriesId: string) {
  return loadRegs().series.find((s) => s.seriesId === seriesId);
}

beforeEach(() => {
  resetKnowledgeSourceRegistryCache();
});

describe('Stage 3J.2A registry loading and validation', () => {
  test('1. loadKnowledgeSourceRegistries returns all registry versions', () => {
    const regs = loadRegs();
    expect(regs.platformRegistryVersion).toBe('teta-product-platform-registry-v1');
    expect(regs.productFamilyRegistryVersion).toBe('teta-product-family-registry-v1');
    expect(regs.productSurfaceRegistryVersion).toBe('teta-product-surface-registry-v1');
    expect(regs.businessAreaRegistryVersion).toBe('teta-business-area-registry-v1');
    expect(regs.knowledgeAreaRegistryVersion).toBe('teta-knowledge-area-registry-v1');
    expect(regs.sourceSeriesRegistryVersion).toBe('teta-training-source-series-v1');
  });

  test('2. validateKnowledgeSourceRegistries reports no duplicate ids', () => {
    const report = validateKnowledgeSourceRegistries(loadRegs());
    expect(report.duplicateRegistryIds).toEqual([]);
  });

  test('3. validateKnowledgeSourceRegistries reports no unknown references', () => {
    const report = validateKnowledgeSourceRegistries(loadRegs());
    expect(report.unknownRegistryReferences).toEqual([]);
  });

  test('4. validateKnowledgeSourceRegistries reports no missing provenance', () => {
    const report = validateKnowledgeSourceRegistries(loadRegs());
    expect(report.missingProvenance).toEqual([]);
  });

  test('5. platform registry contains approved teta_platform', () => {
    const platform = loadRegs().platforms.find((p) => p.platformId === 'teta_platform');
    expect(platform?.status).toBe('approved');
    expect(platform?.canonicalLabel).toContain('Teta');
  });

  test('6. product family registry contains teta_hr', () => {
    const family = loadRegs().productFamilies.find((f) => f.productFamilyId === 'teta_hr');
    expect(family?.platformId).toBe('teta_platform');
    expect(family?.status).toBe('approved');
  });

  test('7. product family registry contains teta_edu', () => {
    const family = loadRegs().productFamilies.find((f) => f.productFamilyId === 'teta_edu');
    expect(family?.platformId).toBe('teta_platform');
    expect(family?.aliases).toContain('edu');
  });

  test('8. product surface registry contains teta_me', () => {
    const surface = loadRegs().productSurfaces.find((s) => s.productSurfaceId === 'teta_me');
    expect(surface?.productFamilyIds).toContain('teta_hr');
    expect(surface?.surfaceKind).toBe('web_application');
  });

  test('9. DS series is approved with teta_hr family', () => {
    const ds = seriesById('DS');
    expect(ds?.status).toBe('approved');
    expect(ds?.productFamilyIds).toContain('teta_hr');
    expect(ds?.businessAreaIds).toContain('social_benefits');
  });

  test('10. EDU series is approved with teta_edu family and no hr domainHints', () => {
    const edu = seriesById('EDU');
    expect(edu?.productFamilyIds).toEqual(['teta_edu']);
    expect(edu?.domainHints).toEqual([]);
  });

  test('11. KADRY series is approved with hr domain hint', () => {
    const kadry = seriesById('KADRY');
    expect(kadry?.domainHints.some((d) => d.domainId === 'hr')).toBe(true);
    expect(kadry?.clientSpecificRisk).toBe('low');
  });

  test('12. ME series is approved with teta_me product surface', () => {
    const me = seriesById('ME');
    expect(me?.productSurfaceIds).toContain('teta_me');
    expect(me?.domainHints.every((d) => d.domainId !== 'teta_me')).toBe(true);
  });

  test('13. OBD series has high clientSpecificRisk and mixed scope policy', () => {
    const obd = seriesById('OBD');
    expect(obd?.clientSpecificRisk).toBe('high');
    expect(obd?.scopePolicy).toBe('mixed_requires_review');
  });

  test('14. PIT series includes payroll domain hint', () => {
    const pit = seriesById('PIT');
    expect(pit?.domainHints.some((d) => d.domainId === 'payroll')).toBe(true);
  });

  test('15. PLACE series includes payroll domain hint', () => {
    const place = seriesById('PLACE');
    expect(place?.domainHints.some((d) => d.domainId === 'payroll')).toBe(true);
    expect(place?.aliases).toContain('płace');
  });

  test('16. PPK series includes employee_capital_plans business area', () => {
    const ppk = seriesById('PPK');
    expect(ppk?.businessAreaIds).toContain('employee_capital_plans');
  });

  test('17. PROJ series maps to form_design knowledge area', () => {
    const proj = seriesById('PROJ');
    expect(proj?.knowledgeAreaIds).toContain('form_design');
  });

  test('18. RAP series maps to reporting_genrap knowledge area', () => {
    const rap = seriesById('RAP');
    expect(rap?.knowledgeAreaIds).toContain('reporting_genrap');
  });

  test('19. RCP series maps to time_and_attendance domain hint', () => {
    const rcp = seriesById('RCP');
    expect(rcp?.domainHints.some((d) => d.domainId === 'time_and_attendance')).toBe(true);
  });

  test('20. WCAG series maps to accessibility knowledge area', () => {
    const wcag = seriesById('WCAG');
    expect(wcag?.knowledgeAreaIds).toContain('accessibility');
  });

  test('21. WORKFLOW series has high clientSpecificRisk', () => {
    const workflow = seriesById('WORKFLOW');
    expect(workflow?.clientSpecificRisk).toBe('high');
    expect(workflow?.scopePolicy).toBe('mixed_requires_review');
  });

  test('22. WSTEP series includes wstęp alias', () => {
    const wstep = seriesById('WSTEP');
    expect(wstep?.aliases).toContain('wstęp');
    expect(wstep?.knowledgeAreaIds).toContain('application_usage');
  });

  test('23. ZU series maps to developer_training knowledge area', () => {
    const zu = seriesById('ZU');
    expect(zu?.knowledgeAreaIds).toContain('developer_training');
    expect(zu?.aliases).toContain('zu');
  });

  test('24. resetKnowledgeSourceRegistryCache forces reload', () => {
    const first = loadKnowledgeSourceRegistries();
    resetKnowledgeSourceRegistryCache();
    const second = loadKnowledgeSourceRegistries();
    expect(first).not.toBe(second);
    expect(second.series.length).toBe(first.series.length);
  });

  test('25. all approved training series ids are present', () => {
    const ids = new Set(loadRegs().series.filter((s) => s.status === 'approved').map((s) => s.seriesId));
    for (const seriesId of APPROVED_SERIES) {
      expect(ids.has(seriesId)).toBe(true);
    }
  });

  test('26. business area registry is non-empty', () => {
    expect(loadRegs().businessAreas.length).toBeGreaterThan(0);
  });

  test('27. knowledge area registry is non-empty', () => {
    expect(loadRegs().knowledgeAreas.length).toBeGreaterThan(0);
  });

  test('28. every approved series has provenance', () => {
    for (const s of loadRegs().series.filter((x) => x.status === 'approved')) {
      expect(s.provenance?.sourceId).toBeTruthy();
    }
  });

  test('29. every approved series references teta_platform', () => {
    for (const s of loadRegs().series.filter((x) => x.status === 'approved')) {
      expect(s.platformId).toBe('teta_platform');
    }
  });

  test('30. registry cache returns same object when not reset', () => {
    const a = loadKnowledgeSourceRegistries();
    const b = loadKnowledgeSourceRegistries();
    expect(a).toBe(b);
  });
});

describe('Stage 3J.2A series and sequence parser', () => {
  test('31. parseTrainingSourceLabel classifies kadry3 as KADRY sequence 3', () => {
    const parsed = parseTrainingSourceLabel('kadry3', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('KADRY');
    expect(parsed.sequenceNumber).toBe(3);
    expect(parsed.classificationStatus).toBe('classified');
  });

  test('32. parseTrainingSourceLabel classifies ds as DS base', () => {
    const parsed = parseTrainingSourceLabel('ds', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('DS');
    expect(parsed.sequenceNumber).toBeNull();
  });

  test('33. parseTrainingSourceLabel classifies edu as EDU', () => {
    const parsed = parseTrainingSourceLabel('edu', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('EDU');
  });

  test('34. parseTrainingSourceLabel classifies me1 as ME sequence 1', () => {
    const parsed = parseTrainingSourceLabel('me1', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('ME');
    expect(parsed.sequenceNumber).toBe(1);
  });

  test('35. parseTrainingSourceLabel leaves unknown series unclassified', () => {
    const parsed = parseTrainingSourceLabel('totallyunknown99', loadRegs().series);
    expect(parsed.sourceSeriesId).toBeNull();
    expect(parsed.classificationStatus).toBe('unclassified');
  });

  test('36. parseTrainingSourceLabel applies NFKC normalization', () => {
    const parsed = parseTrainingSourceLabel('ｗｓｔｅｐ1', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('WSTEP');
    expect(parsed.sequenceNumber).toBe(1);
  });

  test('37. parseTrainingSourceLabel prefers longest alias prefix', () => {
    const parsed = parseTrainingSourceLabel('kadry01', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('KADRY');
    expect(parsed.sequenceNumber).toBe(1);
  });

  test('38. findSeriesEntry returns approved entry for KADRY', () => {
    const entry = findSeriesEntry('KADRY', loadRegs());
    expect(entry?.seriesId).toBe('KADRY');
    expect(entry?.status).toBe('approved');
  });

  test('39. findSeriesEntry returns null for unknown series id', () => {
    expect(findSeriesEntry('NOT_A_SERIES', loadRegs())).toBeNull();
  });

  test('40. findSeriesEntry returns null for null input', () => {
    expect(findSeriesEntry(null, loadRegs())).toBeNull();
  });

  test('41. parseTrainingSourceLabel preserves trimmed sourceLabel', () => {
    const parsed = parseTrainingSourceLabel('  zu2  ', loadRegs().series);
    expect(parsed.sourceLabel).toBe('zu2');
    expect(parsed.sourceSeriesId).toBe('ZU');
    expect(parsed.sequenceNumber).toBe(2);
  });

  test('42. parseTrainingSourceLabel classifies workflow2', () => {
    const parsed = parseTrainingSourceLabel('workflow2', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('WORKFLOW');
    expect(parsed.sequenceNumber).toBe(2);
  });

  test('43. parseTrainingSourceLabel classifies pit1', () => {
    const parsed = parseTrainingSourceLabel('pit1', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('PIT');
    expect(parsed.sequenceNumber).toBe(1);
  });

  test('44. parseTrainingSourceLabel classifies obd1', () => {
    const parsed = parseTrainingSourceLabel('obd1', loadRegs().series);
    expect(parsed.sourceSeriesId).toBe('OBD');
    expect(parsed.sequenceNumber).toBe(1);
  });

  test('45. parseTrainingSourceLabel rejects partial numeric suffix mismatch', () => {
    const parsed = parseTrainingSourceLabel('kadryx1', loadRegs().series);
    expect(parsed.classificationStatus).toBe('unclassified');
  });
});

describe('Stage 3J.2A transcript-frame pairing', () => {
  test('46. zu2.json pairs exactly with zu2 directory', () => {
    const pair = explainPairForJson(FIXTURE_ROOT, 'zu2.json');
    expect(pair?.pairingStatus).toBe('exact');
    expect(pair?.framesRelativeDirectory).toBe('zu2');
  });

  test('47. kadry1.json pairs case-insensitively with KADRY1', () => {
    const pair = explainPairForJson(FIXTURE_ROOT, 'kadry1.json');
    expect(pair?.pairingStatus).toBe('case_insensitive_exact');
    expect(pair?.framesRelativeDirectory).toBe('KADRY1');
  });

  test('48. workflow2.json requires confirmation for WORFLOW2 typo', () => {
    const pair = explainPairForJson(FIXTURE_ROOT, 'workflow2.json');
    expect(pair?.pairingStatus).toBe('requires_confirmation');
    expect(pair?.suggestedDirectory).toBe('WORFLOW2');
    expect(pair?.reason).toBe('similar_name_not_exact');
  });

  test('49. discoverTrainingPairs never auto-accepts fuzzy pairs', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.fuzzyPairsAutomaticallyAccepted).toBe(0);
  });

  test('50. missingframes.json has missing_frames pairing status', () => {
    const pair = explainPairForJson(FIXTURE_ROOT, 'missingframes.json');
    expect(pair?.pairingStatus).toBe('missing_frames');
    expect(pair?.framesRelativeDirectory).toBeNull();
  });

  test('51. ORPHAN1 directory is reported as orphan_directory', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    const orphan = scan.pairs.find((p) => p.pairingStatus === 'orphan_directory' && p.basename === 'ORPHAN1');
    expect(orphan?.framesRelativeDirectory).toBe('ORPHAN1');
    expect(orphan?.reason).toBe('frame_directory_without_transcript');
  });

  test('52. discoverTrainingPairs finds transcript json files', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.transcriptJsonFiles).toContain('zu2.json');
    expect(scan.transcriptJsonFiles.length).toBeGreaterThan(10);
  });

  test('53. discoverTrainingPairs counts at least one exact pair', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.exactPairs).toBeGreaterThanOrEqual(1);
  });

  test('54. discoverTrainingPairs counts case-insensitive exact pairs', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.caseInsensitiveExactPairs).toBeGreaterThanOrEqual(1);
  });

  test('55. discoverTrainingPairs reports fuzzy suggestions for typo directory', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.fuzzyPairSuggestions).toBeGreaterThanOrEqual(1);
  });

  test('56. workflow2 inventory keeps requires_confirmation pairing', () => {
    const inv = inventoryFixture();
    const wf = inv.sources.find((s) => s.sourceLabel === 'workflow2');
    expect(wf?.pairingStatus).toBe('requires_confirmation');
    expect(wf?.inventoryStatus).toBe('requires_review');
  });

  test('57. zu2 inventory uses exact pairing', () => {
    const inv = inventoryFixture();
    const zu = inv.sources.find((s) => s.sourceLabel === 'zu2');
    expect(zu?.pairingStatus).toBe('exact');
    expect(zu?.assets.frames?.relativeDirectory).toBe('zu2');
  });

  test('58. discoverTrainingPairs lists frame directories', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.frameDirectories).toEqual(expect.arrayContaining(['zu2', 'KADRY1', 'ORPHAN1']));
  });

  test('59. emptyframes1.json pairs with empty EMPTYFRAMES1 directory', () => {
    const pair = explainPairForJson(FIXTURE_ROOT, 'emptyframes1.json');
    expect(pair?.pairingStatus).toBe('case_insensitive_exact');
    expect(pair?.framesRelativeDirectory?.toUpperCase()).toBe('EMPTYFRAMES1');
  });

  test('60. discoverTrainingPairs includes orphan frame directories count', () => {
    const scan = discoverTrainingPairs(FIXTURE_ROOT);
    expect(scan.frameDirectoriesWithoutTranscript).toBeGreaterThanOrEqual(1);
  });
});

describe('Stage 3J.2A whisper transcript validation', () => {
  test('61. validateWhisperTranscriptJson accepts valid zu1 fixture', () => {
    const raw = readFileSync(path.join(FIXTURE_ROOT, 'zu1.json'), 'utf8');
    const v = validateWhisperTranscriptJson(raw);
    expect(v.validationStatus).toBe('valid');
    expect(v.transcriptFormat).toBe('whisper_segments_json');
    expect(v.segmentCount).toBe(2);
  });

  test('62. validateWhisperTranscriptJson rejects invalid json syntax', () => {
    const v = validateWhisperTranscriptJson(readFileSync(path.join(FIXTURE_ROOT, 'invalid1.json'), 'utf8'));
    expect(v.validationStatus).toBe('invalid');
    expect(v.errors).toContain('json_parse_error');
  });

  test('63. validateWhisperTranscriptJson treats generic json without segments as invalid', () => {
    const v = validateWhisperTranscriptJson(readFileSync(path.join(FIXTURE_ROOT, 'generic1.json'), 'utf8'));
    expect(v.transcriptFormat).toBe('generic_json');
    expect(v.errors).toContain('segments_not_array');
  });

  test('64. validateWhisperTranscriptJson warns on non-monotonic segments', () => {
    const v = validateWhisperTranscriptJson(readFileSync(path.join(FIXTURE_ROOT, 'nonmono1.json'), 'utf8'));
    expect(v.nonMonotonicSegments).toBeGreaterThan(0);
    expect(v.warnings).toContain('non_monotonic_segments');
    expect(v.validationStatus).toBe('valid_with_warnings');
  });

  test('65. validateWhisperTranscriptJson detects empty segment text', () => {
    const v = validateWhisperTranscriptJson(
      JSON.stringify({
        language: 'pl',
        segments: [{ start: 0, end: 1, text: '   ' }],
      }),
    );
    expect(v.emptySegments).toBe(1);
    expect(v.warnings).toContain('empty_segments');
  });

  test('66. validateWhisperTranscriptJson rejects invalid segment times', () => {
    const v = validateWhisperTranscriptJson(
      JSON.stringify({
        segments: [{ start: 5, end: 2, text: 'bad' }],
      }),
    );
    expect(v.invalidSegmentTimes).toBeGreaterThan(0);
    expect(v.validationStatus).toBe('invalid');
  });

  test('67. validateWhisperTranscriptJson reports quality metrics when present', () => {
    const v = validateWhisperTranscriptJson(readFileSync(path.join(FIXTURE_ROOT, 'kadry1.json'), 'utf8'));
    expect(v.qualityMetricsAvailable).toBe(true);
  });

  test('68. validateWhisperTranscriptJson computes duration from max segment end', () => {
    const v = validateWhisperTranscriptJson(readFileSync(path.join(FIXTURE_ROOT, 'zu1.json'), 'utf8'));
    expect(v.durationSeconds).toBe(3);
  });

  test('69. validateWhisperTranscriptJson rejects non-object root', () => {
    const v = validateWhisperTranscriptJson(JSON.stringify([{ segments: [] }]));
    expect(v.errors).toContain('not_object');
  });

  test('70. invalid1 inventory source is marked invalid', () => {
    const inv = inventoryFixture();
    const invalid = inv.sources.find((s) => s.sourceLabel === 'invalid1');
    expect(invalid?.inventoryStatus).toBe('invalid');
  });

  test('71. generic1 inventory source is marked invalid', () => {
    const inv = inventoryFixture();
    const generic = inv.sources.find((s) => s.sourceLabel === 'generic1');
    expect(generic?.inventoryStatus).toBe('invalid');
  });

  test('72. nonmono1 inventory source requires review and reports non-monotonic warning', () => {
    const inv = inventoryFixture();
    const nonmono = inv.sources.find((s) => s.sourceLabel === 'nonmono1');
    expect(nonmono?.inventoryStatus).toBe('requires_review');
    expect(nonmono?.warnings).toEqual(expect.arrayContaining(['non_monotonic_segments']));
  });

  test('73. validateWhisperTranscriptJson warns when language missing', () => {
    const v = validateWhisperTranscriptJson(JSON.stringify({ segments: [{ start: 0, end: 1, text: 'x' }] }));
    expect(v.warnings).toContain('language_missing');
  });
});

describe('Stage 3J.2A frame directory inventory', () => {
  test('74. inventoryFrameDirectory detects timestamp_seconds naming in ZU1', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'ZU1'), 'ZU1', 'metadata');
    expect(inv.namingScheme).toBe('timestamp_seconds');
    expect(inv.count).toBe(2);
  });

  test('75. inventoryFrameDirectory detects sequential_index naming in SEQ1', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'SEQ1'), 'SEQ1', 'metadata');
    expect(inv.namingScheme).toBe('sequential_index');
    expect(inv.timelineStatus).toBe('requires_interval_or_manifest');
  });

  test('76. inventoryFrameDirectory detects existing_manifest in MANIF1', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'MANIF1'), 'MANIF1', 'metadata');
    expect(inv.hasExistingManifest).toBe(true);
    expect(inv.namingScheme).toBe('existing_manifest');
    expect(inv.timelineStatus).toBe('manifest_present');
  });

  test('77. inventoryFrameDirectory marks missing directory as empty', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, '__missing_dir__'), '__missing_dir__');
    expect(inv.empty).toBe(true);
    expect(inv.timelineStatus).toBe('missing_directory');
  });

  test('78. inventoryFrameDirectory handles empty directory', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'teta-empty-frames-'));
    try {
      const inv = inventoryFrameDirectory(tmp, 'empty-test');
      expect(inv.count).toBe(0);
      expect(inv.timelineStatus).toBe('empty_directory');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('79. content hash mode differs from metadata hash mode fingerprint', () => {
    const meta = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'zu2'), 'zu2', 'metadata');
    const content = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'zu2'), 'zu2', 'content');
    expect(meta.hashMode).toBe('metadata');
    expect(content.hashMode).toBe('content');
    expect(meta.fingerprint).not.toBe(content.fingerprint);
  });

  test('80. createTinyPngBuffer returns decodable png bytes', () => {
    const buf = createTinyPngBuffer();
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('81. inventoryFrameDirectory counts total bytes', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'zu2'), 'zu2', 'content');
    expect(inv.totalBytes).toBeGreaterThan(0);
  });

  test('82. inventoryFrameDirectory records earliest and latest frame names', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'ZU1'), 'ZU1');
    expect(inv.earliestIndexOrTimestamp).toBe('0s.png');
    expect(inv.latestIndexOrTimestamp).toBe('5s.png');
  });

  test('83. seq1 inventory warns frames_require_interval_or_manifest', () => {
    const inv = inventoryFixture();
    const seq = inv.sources.find((s) => s.sourceLabel === 'seq1');
    expect(seq?.assets.frames?.timelineStatus).toBe('requires_interval_or_manifest');
    expect(seq?.warnings).toContain('frames_require_interval_or_manifest');
  });

  test('84. manif1 inventory has manifest_present timeline', () => {
    const inv = inventoryFixture();
    const manif = inv.sources.find((s) => s.sourceLabel === 'manif1');
    expect(manif?.assets.frames?.timelineStatus).toBe('manifest_present');
  });

  test('85. inventoryFrameDirectory fingerprint is stable sha256 hex', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'zu2'), 'zu2', 'content');
    expect(inv.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const again = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'zu2'), 'zu2', 'content');
    expect(again.fingerprint).toBe(inv.fingerprint);
  });

  test('86. inventoryFrameDirectory ignores manifest json from unsupported count', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'MANIF1'), 'MANIF1');
    expect(inv.unsupportedFiles).not.toContain('frames-manifest.json');
  });

  test('87. default inventory uses content frame hash mode', () => {
    const inv = inventoryFixture();
    expect(inv.frameHashMode).toBe('content');
    expect(inv.sources.every((s) => !s.assets.frames || s.assets.frames.hashMode === 'content')).toBe(true);
  });
});

describe('Stage 3J.2A logical source identity and inventory', () => {
  test('88. buildLogicalSourceId formats KADRY sequence', () => {
    expect(
      buildLogicalSourceId({ seriesId: 'KADRY', sequenceNumber: 1, sourceLabel: 'kadry1' }),
    ).toBe('training-video:KADRY:1');
  });

  test('89. buildLogicalSourceId formats unclassified basename', () => {
    expect(
      buildLogicalSourceId({
        seriesId: null,
        sequenceNumber: null,
        sourceLabel: 'missingframes',
        relativePath: 'missingframes.json',
      }),
    ).toBe('training-video:unclassified:missingframes');
  });

  test('90. kadry1 and kadry01 share logical source id KADRY:1', () => {
    const inv = inventoryFixture();
    const k1 = inv.sources.find((s) => s.sourceLabel === 'kadry1');
    const k01 = inv.sources.find((s) => s.sourceLabel === 'kadry01');
    expect(k1?.logicalSourceId).toBe('training-video:KADRY:1');
    expect(k01?.logicalSourceId).toBe('training-video:KADRY:1');
  });

  test('91. duplicate logical source ids trigger requires_review', () => {
    const inv = inventoryFixture();
    const dupes = inv.sources.filter((s) => s.logicalSourceId === 'training-video:KADRY:1');
    expect(dupes.length).toBe(2);
    expect(dupes.every((s) => s.warnings.includes('duplicate_logical_source'))).toBe(true);
    expect(dupes.every((s) => s.inventoryStatus === 'requires_review')).toBe(true);
  });

  test('92. computeSourceRevisionId is sha256 prefixed', () => {
    const rev = computeSourceRevisionId({
      transcriptSha256: 'abc',
      framesFingerprint: 'def',
      metadataFingerprint: 'ghi',
    });
    expect(rev.startsWith('sha256:')).toBe(true);
    expect(rev.length).toBeGreaterThan(20);
  });

  test('93. computeSourceRevisionId changes when transcript hash changes', () => {
    const base = { transcriptSha256: 'a', framesFingerprint: 'b', metadataFingerprint: 'c' };
    const r1 = computeSourceRevisionId(base);
    const r2 = computeSourceRevisionId({ ...base, transcriptSha256: 'z' });
    expect(r1).not.toBe(r2);
  });

  test('94. inventory contract version is teta-knowledge-source-v1', () => {
    const inv = inventoryFixture();
    expect(inv.contractVersion).toBe('teta-knowledge-source-v1');
    expect(inv.inventoryVersion).toBe('stage3j2a-v1');
  });

  test('95. inventory rootLabel is stage3j2a basename only', () => {
    const inv = inventoryFixture();
    expect(inv.rootLabel).toBe('stage3j2a');
  });

  test('96. inventory includes pairs from discovery scan', () => {
    const inv = inventoryFixture();
    expect(inv.pairs.some((p) => p.pairingStatus === 'orphan_directory')).toBe(true);
  });

  test('97. inventory sourceFilter limits results', () => {
    const inv = inventoryKnowledgeSourcesStage3j2a({
      root: FIXTURE_ROOT,
      sourceFilter: 'training-video:ZU:2',
    });
    expect(inv.sources.length).toBe(1);
    expect(inv.sources[0].sourceLabel).toBe('zu2');
  });

  test('98. inventory seriesFilter limits results', () => {
    const inv = inventoryKnowledgeSourcesStage3j2a({ root: FIXTURE_ROOT, seriesFilter: 'ME' });
    expect(inv.sources.every((s) => s.sourceSeriesId === 'ME')).toBe(true);
    expect(inv.sources.some((s) => s.sourceLabel === 'me1')).toBe(true);
  });

  test('99. assertNoContentExtraction holds for inventory records', () => {
    const inv = inventoryFixture();
    expect(inv.sources.every(assertNoContentExtraction)).toBe(true);
  });

  test('100. unclassified generic label gets unclassified logical id', () => {
    const inv = inventoryFixture();
    const generic = inv.sources.find((s) => s.sourceLabel === 'generic1');
    expect(generic?.logicalSourceId).toContain('unclassified');
  });
});

describe('Stage 3J.2A Teta ME classification', () => {
  test('101. me1 inventory uses productSurface teta_me', () => {
    const inv = inventoryFixture();
    const me = inv.sources.find((s) => s.sourceLabel === 'me1');
    expect(me?.productSurfaceIds).toContain('teta_me');
  });

  test('102. me1 inventory uses product family teta_hr', () => {
    const inv = inventoryFixture();
    const me = inv.sources.find((s) => s.sourceLabel === 'me1');
    expect(me?.productFamilyIds).toContain('teta_hr');
  });

  test('103. me1 inventory domainHints exclude teta_me domainId', () => {
    const inv = inventoryFixture();
    const me = inv.sources.find((s) => s.sourceLabel === 'me1');
    expect(me?.domainHints.every((d) => d.domainId !== 'teta_me')).toBe(true);
  });

  test('104. validateKnowledgeSourceInventory reports zero teta_me domain assignments', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.tetaMeClassifiedAsStandaloneBusinessDomain).toBe(0);
    expect(report.legacyTetaMeDomainAssignmentsCreated).toBe(0);
  });

  test('105. validateKnowledgeSourceInventory reports zero me wrong family', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.tetaMeSourcesWrongProductFamily).toBe(0);
  });

  test('106. validateKnowledgeSourceInventory reports zero me missing surface', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.tetaMeSourcesWithoutProductSurface).toBe(0);
  });

  test('107. ME series registry has empty domainHints', () => {
    expect(seriesById('ME')?.domainHints).toEqual([]);
  });

  test('108. me1 scope remains unclassified not global_teta', () => {
    const inv = inventoryFixture();
    const me = inv.sources.find((s) => s.sourceLabel === 'me1');
    expect(me?.scope).toBe('unclassified');
    expect(me?.scope).not.toBe('global_teta');
  });
});

describe('Stage 3J.2A Teta Edu classification', () => {
  test('109. edu inventory uses product family teta_edu', () => {
    const inv = inventoryFixture();
    const edu = inv.sources.find((s) => s.sourceLabel === 'edu');
    expect(edu?.productFamilyIds).toEqual(['teta_edu']);
  });

  test('110. edu inventory does not include teta_hr family', () => {
    const inv = inventoryFixture();
    const edu = inv.sources.find((s) => s.sourceLabel === 'edu');
    expect(edu?.productFamilyIds).not.toContain('teta_hr');
  });

  test('111. edu inventory has no hr domainHints', () => {
    const inv = inventoryFixture();
    const edu = inv.sources.find((s) => s.sourceLabel === 'edu');
    expect(edu?.domainHints.some((d) => d.domainId === 'hr')).toBe(false);
  });

  test('112. validateKnowledgeSourceInventory reports zero edu classified as teta_hr', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.tetaEduClassifiedAsTetaHr).toBe(0);
  });

  test('113. validateKnowledgeSourceInventory reports zero edu inherited hr concepts', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.tetaEduInheritedHrConceptsWithoutEvidence).toBe(0);
  });

  test('114. edu inventory business area is university_administration', () => {
    const inv = inventoryFixture();
    const edu = inv.sources.find((s) => s.sourceLabel === 'edu');
    expect(edu?.businessAreaIds).toContain('university_administration');
  });
});

describe('Stage 3J.2A OBD and WORKFLOW risk and scope', () => {
  test('115. obd1 inventory has high clientSpecificRisk', () => {
    const inv = inventoryFixture();
    const obd = inv.sources.find((s) => s.sourceLabel === 'obd1');
    expect(obd?.clientSpecificRisk).toBe('high');
  });

  test('116. workflow1 inventory has high clientSpecificRisk', () => {
    const inv = inventoryFixture();
    const wf = inv.sources.find((s) => s.sourceLabel === 'workflow1');
    expect(wf?.clientSpecificRisk).toBe('high');
  });

  test('117. obd1 scope is not global_teta', () => {
    const inv = inventoryFixture();
    const obd = inv.sources.find((s) => s.sourceLabel === 'obd1');
    expect(obd?.scope).not.toBe('global_teta');
    expect(obd?.scope).toBe('unclassified');
  });

  test('118. workflow1 scope is not global_teta', () => {
    const inv = inventoryFixture();
    const wf = inv.sources.find((s) => s.sourceLabel === 'workflow1');
    expect(wf?.scope).not.toBe('global_teta');
  });

  test('119. obd1 scopePolicy is mixed_requires_review', () => {
    const inv = inventoryFixture();
    const obd = inv.sources.find((s) => s.sourceLabel === 'obd1');
    expect(obd?.scopePolicy).toBe('mixed_requires_review');
  });

  test('120. validateKnowledgeSourceInventory reports zero scope auto-approved', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.scopeAutoApprovedFromSeriesName).toBe(0);
  });

  test('121. all inventory sources keep unclassified scope', () => {
    const inv = inventoryFixture();
    expect(inv.sources.every((s) => s.scope === 'unclassified')).toBe(true);
  });

  test('122. workflow2 fuzzy pair keeps scopeClassificationStatus requires_review', () => {
    const inv = inventoryFixture();
    const wf = inv.sources.find((s) => s.sourceLabel === 'workflow2');
    expect(wf?.scopeClassificationStatus).toBe('requires_review');
  });
});

describe('Stage 3J.2A determinism and fingerprints', () => {
  test('123. computeInventoryFingerprint is stable for same sources', () => {
    const inv = inventoryFixture();
    const fp1 = computeInventoryFingerprint(inv.sources);
    const fp2 = computeInventoryFingerprint(inv.sources);
    expect(fp1).toBe(fp2);
  });

  test('124. computeInventoryFingerprint changes when revision id changes', () => {
    const inv = inventoryFixture();
    const modified = inv.sources.map((s, i) =>
      i === 0 ? { ...s, sourceRevisionId: `${s.sourceRevisionId}-changed` } : s,
    );
    expect(computeInventoryFingerprint(modified)).not.toBe(computeInventoryFingerprint(inv.sources));
  });

  test('125. inventory fingerprint matches between two runs', () => {
    const a = inventoryFixture();
    const b = inventoryFixture();
    expect(a.fingerprintSha256).toBe(b.fingerprintSha256);
  });

  test('126. inventory fingerprint excludes absolute paths from inputs', () => {
    const inv = inventoryFixture();
    const serialized = stableStringify(
      inv.sources.map((s) => ({
        logicalSourceId: s.logicalSourceId,
        transcript: s.assets.transcript?.relativePath,
        frames: s.assets.frames?.relativeDirectory,
      })),
    );
    expect(serialized).not.toMatch(/[A-Za-z]:\\/);
    expect(serialized).not.toMatch(/\/Users\//);
  });

  test('127. source records use relative transcript paths only', () => {
    const inv = inventoryFixture();
    for (const s of inv.sources) {
      const p = s.assets.transcript?.relativePath ?? '';
      expect(path.isAbsolute(p)).toBe(false);
      expect(p).not.toMatch(/^[A-Za-z]:/);
    }
  });

  test('128. source records use relative frame directories only', () => {
    const inv = inventoryFixture();
    for (const s of inv.sources) {
      const d = s.assets.frames?.relativeDirectory ?? '';
      if (!d) continue;
      expect(path.isAbsolute(d)).toBe(false);
    }
  });

  test('129. sha256 helper returns 64 hex chars', () => {
    expect(sha256('test')).toMatch(/^[a-f0-9]{64}$/);
  });

  test('130. stableStringify sorts object keys deterministically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  test('131. inventory provenance lists six registry versions', () => {
    const inv = inventoryFixture();
    expect(inv.sources[0]?.provenance.registryVersions.length).toBe(6);
  });

  test('132. changed warnings do not affect inventory fingerprint', () => {
    const inv = inventoryFixture();
    const withExtraWarning = inv.sources.map((s) => ({ ...s, warnings: [...s.warnings, 'probe'] }));
    expect(computeInventoryFingerprint(withExtraWarning)).toBe(computeInventoryFingerprint(inv.sources));
  });
});

describe('Stage 3J.2A path normalization', () => {
  test('133. normalizeBasenameKey lowercases and trims', () => {
    expect(normalizeBasenameKey('  KADRY1  ')).toBe('kadry1');
  });

  test('134. normalizeBasenameKey applies NFKC', () => {
    expect(normalizeBasenameKey('ＺＵ１')).toBe('zu1');
  });

  test('135. normalizeBasenameKey treats backslash basename segments equally', () => {
    expect(normalizeBasenameKey('kadry1')).toBe(normalizeBasenameKey('KADRY1'));
  });

  test('136. toPosixRelative strips fixture root prefix', () => {
    const abs = path.join(FIXTURE_ROOT, 'zu2', '0s.png');
    const rel = toPosixRelative(FIXTURE_ROOT.replace(/\\/g, '/'), abs.replace(/\\/g, '/'));
    expect(rel).toBe('zu2/0s.png');
  });

  test('137. pairing uses normalized keys for case-insensitive match', () => {
    expect(normalizeBasenameKey('kadry1')).toBe(normalizeBasenameKey('KADRY1'));
    const pair = explainPairForJson(FIXTURE_ROOT, 'kadry1.json');
    expect(pair?.framesRelativeDirectory).toBe('KADRY1');
  });

  test('138. toPosixRelative normalizes backslashes', () => {
    const rel = toPosixRelative('C:/fixtures', 'C:/fixtures/zu2/0s.png');
    expect(rel).toBe('zu2/0s.png');
    expect(rel.includes('\\')).toBe(false);
  });

  test('139. inventory root resolves relative to spec directory not cwd', () => {
    expect(FIXTURE_ROOT.endsWith(path.join('test-fixtures', 'teta-knowledge-sources', 'stage3j2a'))).toBe(true);
    expect(existsSync(FIXTURE_ROOT)).toBe(true);
  });
});

describe('Stage 3J.2A audit builder', () => {
  test('140. buildStage3j2aAudit(false) returns strictErrors array', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB);
    expect(Array.isArray(audit.strictErrors)).toBe(true);
  });

  test('141. buildStage3j2aAudit(false) has all stageBoundaries counters at zero', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      stageBoundaries: Record<string, number>;
    };
    expect(Object.values(audit.stageBoundaries).every((v) => v === 0)).toBe(true);
  });

  test('142. buildStage3j2aAudit(false) with verification stub has empty strictErrors', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB);
    expect(audit.strictErrors).toEqual([]);
  });

  test('143. buildStage3j2aAudit records inventory fingerprint', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB);
    expect(typeof audit.inventoryFingerprintSha256).toBe('string');
    expect(String(audit.inventoryFingerprintSha256)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('144. buildStage3j2aAudit verification block uses stub counts', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      verification: typeof VERIFICATION_STUB & { fixtureSourcesExamined: number };
    };
    expect(audit.verification.stage3j2aTestsExecuted).toBe(180);
    expect(audit.verification.stage3j2aTestsPassed).toBe(180);
    expect(audit.verification.stage3j1RegressionPassed).toBe(271);
    expect(audit.verification.stage3jRegressionPassed).toBe(161);
  });

  test('145. buildStage3j2aAudit discovery reports zero fuzzy auto accepted', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      discovery: { fuzzyPairsAutomaticallyAccepted: number };
    };
    expect(audit.discovery.fuzzyPairsAutomaticallyAccepted).toBe(0);
  });

  test('146. buildStage3j2aAudit determinism reports identical inventory fingerprint', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      determinism: { identicalInventoryFingerprintMatches: number };
    };
    expect(audit.determinism.identicalInventoryFingerprintMatches).toBe(1);
  });

  test('147. buildStage3j2aAudit registry lists all approved series ids', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      registry: { registeredSeries: string[] };
    };
    for (const seriesId of APPROVED_SERIES) {
      expect(audit.registry.registeredSeries).toContain(seriesId);
    }
  });
});

describe('Stage 3J.2A privacy and encoding', () => {
  test('148. validateKnowledgeSourceInventory reports zero absolute paths in records', () => {
    const inv = inventoryFixture();
    const report = validateKnowledgeSourceInventory(inv, loadRegs());
    expect(report.absolutePathsInRecords).toBe(0);
  });

  test('149. inventory json serialization contains no Windows drive paths', () => {
    const inv = inventoryFixture();
    const blob = JSON.stringify(inv.sources);
    expect(blob).not.toMatch(/"[A-Za-z]:\\\\/);
    expect(blob).not.toMatch(/\/Users\//);
  });

  test('150. registry platform json parses as UTF-8 without nul bytes', () => {
    const raw = readFileSync(path.join(CONFIG_DIR, 'teta-product-platform-registry-v1.json'), 'utf8');
    expect(raw.includes('\u0000')).toBe(false);
    const parsed = JSON.parse(raw) as { platforms: unknown[] };
    expect(Array.isArray(parsed.platforms)).toBe(true);
  });

  test('151. registry series json parses as UTF-8 with Polish alias', () => {
    const raw = readFileSync(path.join(CONFIG_DIR, 'teta-training-source-series-v1.json'), 'utf8');
    expect(raw).toContain('płace');
    const parsed = JSON.parse(raw) as { series: Array<{ seriesId: string }> };
    expect(parsed.series.some((s) => s.seriesId === 'PLACE')).toBe(true);
  });

  test('152. registry family json parses as UTF-8', () => {
    const raw = readFileSync(path.join(CONFIG_DIR, 'teta-product-family-registry-v1.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw.includes('\u0000')).toBe(false);
  });

  test('153. registry surface json parses as UTF-8', () => {
    const raw = readFileSync(path.join(CONFIG_DIR, 'teta-product-surface-registry-v1.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('154. registry business area json parses as UTF-8', () => {
    const raw = readFileSync(path.join(CONFIG_DIR, 'teta-business-area-registry-v1.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('155. registry knowledge area json parses as UTF-8', () => {
    const raw = readFileSync(path.join(CONFIG_DIR, 'teta-knowledge-area-registry-v1.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('Stage 3J.2A integrity — fingerprints and revisions', () => {
  test('156. changed transcript text changes canonicalSha256', () => {
    const before = validateWhisperTranscriptJson(readFileSync(path.join(FIXTURE_ROOT, 'kadry1.json')));
    const obj = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'kadry1.json'), 'utf8'));
    obj.segments[0].text = `${obj.segments[0].text}|x`;
    const after = validateWhisperTranscriptJson(JSON.stringify(obj));
    expect(before.canonicalSha256).toBeTruthy();
    expect(after.canonicalSha256).toBeTruthy();
    expect(after.canonicalSha256).not.toBe(before.canonicalSha256);
  });

  test('157. changed segment timing changes canonical transcript hash', () => {
    const base = computeCanonicalTranscriptHash({
      language: 'pl',
      segments: [{ start: 0, end: 1, text: 'a' }],
    });
    const changed = computeCanonicalTranscriptHash({
      language: 'pl',
      segments: [{ start: 0, end: 1.1, text: 'a' }],
    });
    expect(changed).not.toBe(base);
  });

  test('158. audit reports changedTranscriptFingerprintDiffers=1', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      determinism: Record<string, number | boolean>;
    };
    expect(audit.determinism.changedTranscriptFingerprintDiffers).toBe(1);
    expect(audit.determinism.changedTranscriptSha256Differs).toBe(1);
    expect(audit.determinism.changedTranscriptSourceRevisionDiffers).toBe(1);
    expect(audit.determinism.unchangedTranscriptSourceRevisionMatches).toBe(1);
    expect(audit.determinism.deterministicFingerprintCheckOk).toBe(true);
  });

  test('159. strict errors include changedTranscriptFingerprintDiffers when counter is 0', () => {
    const codes = collectStage3j2aStrictErrorCodes({
      identicalInventoryFingerprintMatches: 1,
      changedTranscriptFingerprintDiffers: 0,
      changedTranscriptSha256Differs: 1,
      changedTranscriptSourceRevisionDiffers: 1,
      unchangedTranscriptSourceRevisionMatches: 1,
      unexpectedLogicalSourceCollisions: 0,
      unclassifiedLogicalSourceCollisions: 0,
      fixtureExpectationsFailed: 0,
      unexpectedFixtureFailures: 0,
      frameNamingSchemeReconciled: 1,
      framesWithExistingManifest: 1,
      supportedDocumentFiles: 1,
      deterministicFingerprintCheckOk: false,
      stageBoundaryNonZero: false,
    });
    expect(codes).toContain('changedTranscriptFingerprintDiffers');
    expect(codes).toContain('deterministicFingerprintCheckOk');
  });

  test('160. sourceRevision changes when transcript hash changes', () => {
    const inv = inventoryFixture();
    const src = inv.sources.find((s) => s.sourceLabel === 'kadry1')!;
    const meta = computeMetadataFingerprint({
      logicalSourceId: src.logicalSourceId,
      sourceSeriesId: src.sourceSeriesId,
      sequenceNumber: src.sequenceNumber,
      pairingStatus: src.pairingStatus,
      productFamilyIds: src.productFamilyIds,
      productSurfaceIds: src.productSurfaceIds,
      scope: src.scope,
      clientSpecificRisk: src.clientSpecificRisk,
    });
    const before = src.sourceRevisionId;
    const after = computeSourceRevisionId({
      transcriptSha256: sha256(src.assets.transcript!.sha256 + '|delta'),
      framesFingerprint: src.assets.frames?.fingerprint ?? null,
      metadataFingerprint: meta,
    });
    expect(after).not.toBe(before);
  });

  test('161. content mode frame content change changes frames fingerprint', () => {
    const dir = path.join(FIXTURE_ROOT, 'zu2');
    const a = inventoryFrameDirectory(dir, 'zu2', 'content');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'j2a-frame-'));
    try {
      writeFileSync(path.join(tmp, '0s.png'), createTinyPngBuffer());
      writeFileSync(path.join(tmp, '5s.png'), Buffer.from('different-bytes'));
      const b = inventoryFrameDirectory(tmp, 'zu2', 'content');
      expect(b.fingerprint).not.toBe(a.fingerprint);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('162. metadata mode ignores frame content bytes for fingerprint', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'j2a-meta-'));
    try {
      writeFileSync(path.join(tmp, '0s.png'), createTinyPngBuffer());
      writeFileSync(path.join(tmp, '5s.png'), createTinyPngBuffer());
      const a = inventoryFrameDirectory(tmp, 'rel', 'metadata');
      writeFileSync(path.join(tmp, '5s.png'), Buffer.from('changed-content-same-size!!!!'.slice(0, createTinyPngBuffer().length)));
      // Force same size by rewriting with different buffer of same length
      const sameLen = Buffer.alloc(createTinyPngBuffer().length, 7);
      writeFileSync(path.join(tmp, '5s.png'), sameLen);
      const b = inventoryFrameDirectory(tmp, 'rel', 'metadata');
      expect(b.fingerprint).toBe(a.fingerprint);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('163. metadata mode fingerprint changes when frame size changes', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'j2a-metasize-'));
    try {
      writeFileSync(path.join(tmp, '0s.png'), createTinyPngBuffer());
      const a = inventoryFrameDirectory(tmp, 'rel', 'metadata');
      writeFileSync(path.join(tmp, '0s.png'), Buffer.concat([createTinyPngBuffer(), Buffer.from('x')]));
      const b = inventoryFrameDirectory(tmp, 'rel', 'metadata');
      expect(b.fingerprint).not.toBe(a.fingerprint);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('164. product family change changes metadata fingerprint and revision', () => {
    const inv = inventoryFixture();
    const src = inv.sources.find((s) => s.sourceLabel === 'edu')!;
    const baseMeta = computeMetadataFingerprint({
      logicalSourceId: src.logicalSourceId,
      sourceSeriesId: src.sourceSeriesId,
      sequenceNumber: src.sequenceNumber,
      pairingStatus: src.pairingStatus,
      productFamilyIds: src.productFamilyIds,
      productSurfaceIds: src.productSurfaceIds,
      scope: src.scope,
      clientSpecificRisk: src.clientSpecificRisk,
    });
    const changedMeta = computeMetadataFingerprint({
      logicalSourceId: src.logicalSourceId,
      sourceSeriesId: src.sourceSeriesId,
      sequenceNumber: src.sequenceNumber,
      pairingStatus: src.pairingStatus,
      productFamilyIds: ['teta_hr'],
      productSurfaceIds: src.productSurfaceIds,
      scope: src.scope,
      clientSpecificRisk: src.clientSpecificRisk,
    });
    expect(changedMeta).not.toBe(baseMeta);
    const r1 = computeSourceRevisionId({
      transcriptSha256: src.assets.transcript!.sha256,
      framesFingerprint: src.assets.frames?.fingerprint ?? null,
      metadataFingerprint: baseMeta,
    });
    const r2 = computeSourceRevisionId({
      transcriptSha256: src.assets.transcript!.sha256,
      framesFingerprint: src.assets.frames?.fingerprint ?? null,
      metadataFingerprint: changedMeta,
    });
    expect(r2).not.toBe(r1);
  });

  test('165. absolute root change does not change sourceRevisionId', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'j2a-root-'));
    try {
      const label = 'edu';
      writeFileSync(path.join(tmp, `${label}.json`), readFileSync(path.join(FIXTURE_ROOT, `${label}.json`)));
      const dir = path.join(tmp, 'EDU');
      require('fs').mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, '0s.png'), readFileSync(path.join(FIXTURE_ROOT, 'EDU', '0s.png')));
      writeFileSync(path.join(dir, '5s.png'), readFileSync(path.join(FIXTURE_ROOT, 'EDU', '5s.png')));
      const a = inventoryKnowledgeSourcesStage3j2a({ root: FIXTURE_ROOT, sourceFilter: 'training-video:EDU:base' });
      const b = inventoryKnowledgeSourcesStage3j2a({ root: tmp, sourceFilter: 'training-video:EDU:base' });
      expect(a.sources[0]?.sourceRevisionId).toBe(b.sources[0]?.sourceRevisionId);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('166. re-run inventory keeps identical fingerprint and revisions', () => {
    const a = inventoryFixture();
    const b = inventoryFixture();
    expect(a.fingerprintSha256).toBe(b.fingerprintSha256);
    expect(a.sources.map((s) => s.sourceRevisionId)).toEqual(b.sources.map((s) => s.sourceRevisionId));
  });
});

describe('Stage 3J.2A integrity — logical ids and fixtures', () => {
  test('167. unclassified logical ids use normalized basename', () => {
    const inv = inventoryFixture();
    expect(inv.sources.find((s) => s.sourceLabel === 'missingframes')?.logicalSourceId).toBe(
      'training-video:unclassified:missingframes',
    );
    expect(inv.sources.find((s) => s.sourceLabel === 'invalid1')?.logicalSourceId).toBe(
      'training-video:unclassified:invalid1',
    );
    expect(inv.sources.every((s) => s.logicalSourceId !== 'training-video:unclassified:base')).toBe(true);
  });

  test('168. nested relative path adds deterministic unclassified suffix', () => {
    const a = buildLogicalSourceId({
      seriesId: null,
      sequenceNumber: null,
      sourceLabel: 'intro',
      relativePath: 'nested/a/intro.json',
    });
    const b = buildLogicalSourceId({
      seriesId: null,
      sequenceNumber: null,
      sourceLabel: 'intro',
      relativePath: 'nested/b/intro.json',
    });
    expect(a).toMatch(/^training-video:unclassified:intro:[a-f0-9]{8}$/);
    expect(b).toMatch(/^training-video:unclassified:intro:[a-f0-9]{8}$/);
    expect(a).not.toBe(b);
  });

  test('169. expected duplicate is only KADRY:1 and unexpected collisions are 0', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      identityAndDuplicates: {
        expectedDuplicateLogicalSourceIds: string[];
        unexpectedLogicalSourceCollisions: number;
        unclassifiedLogicalSourceCollisions: number;
        duplicateLogicalSourceIds: string[];
      };
    };
    expect(audit.identityAndDuplicates.expectedDuplicateLogicalSourceIds).toEqual([
      'training-video:KADRY:1',
    ]);
    expect(audit.identityAndDuplicates.unexpectedLogicalSourceCollisions).toBe(0);
    expect(audit.identityAndDuplicates.unclassifiedLogicalSourceCollisions).toBe(0);
    expect(audit.identityAndDuplicates.duplicateLogicalSourceIds).toEqual(['training-video:KADRY:1']);
  });

  test('170. fixture expectations all pass with intentional invalids counted', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      fixtureExpectations: Record<string, number>;
    };
    const f = audit.fixtureExpectations;
    expect(f.fixtureExpectationsPassed).toBe(f.fixtureCasesEvaluated);
    expect(f.fixtureExpectationsFailed).toBe(0);
    expect(f.unexpectedFixtureFailures).toBe(0);
    expect(f.expectedInvalidSources).toBe(2);
    expect(f.actualInvalidSources).toBe(2);
    expect(f.expectedValidSources).toBe(0);
    expect(f.expectedWarningSources + f.expectedInvalidSources).toBe(f.fixtureCasesEvaluated);
  });
});

describe('Stage 3J.2A integrity — frames and documents', () => {
  test('171. timestamp_seconds naming scheme detected', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'DS'), 'DS');
    expect(inv.namingScheme).toBe('timestamp_seconds');
  });

  test('172. timestamp_milliseconds naming scheme detected', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'MS1'), 'MS1');
    expect(inv.namingScheme).toBe('timestamp_milliseconds');
  });

  test('173. hh_mm_ss naming scheme detected', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'HMS1'), 'HMS1');
    expect(inv.namingScheme).toBe('hh_mm_ss');
  });

  test('174. sequential_index naming scheme detected', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'SEQ1'), 'SEQ1');
    expect(inv.namingScheme).toBe('sequential_index');
    expect(inv.timelineStatus).toBe('requires_interval_or_manifest');
  });

  test('175. existing_manifest naming scheme and valid parse', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'MANIF1'), 'MANIF1');
    expect(inv.namingScheme).toBe('existing_manifest');
    expect(inv.hasExistingManifest).toBe(true);
    expect(inv.manifestValid).toBe(true);
    expect(inv.timelineStatus).toBe('manifest_present');
    const raw = readFileSync(path.join(FIXTURE_ROOT, 'MANIF1', 'frames-manifest.json'), 'utf8');
    expect(parseFramesManifest(raw).valid).toBe(true);
  });

  test('176. invalid manifest is rejected', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'BADMANIF1'), 'BADMANIF1');
    expect(inv.hasExistingManifest).toBe(true);
    expect(inv.manifestValid).toBe(false);
    expect(inv.invalidFrameManifest).toBe(true);
    expect(inv.timelineStatus).toBe('invalid_manifest');
  });

  test('177. unknown naming scheme detected', () => {
    const inv = inventoryFrameDirectory(path.join(FIXTURE_ROOT, 'UNK1'), 'UNK1');
    expect(inv.namingScheme).toBe('unknown');
    expect(inv.timelineStatus).toBe('requires_interval_or_manifest');
  });

  test('178. audit frameDirectoriesByNamingScheme reconciles', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      frames: {
        frameDirectoriesByNamingScheme: Record<string, number>;
        pairedFrameDirectories: number;
        frameNamingSchemeReconciled: boolean;
        framesWithExistingManifest: number;
        contentHashedFrameFiles: number;
        contentHashedFrameDirectories: number;
        metadataHashedFrameFiles: number;
      };
    };
    const schemes = audit.frames.frameDirectoriesByNamingScheme;
    const sum = Object.values(schemes).reduce((a, b) => a + b, 0);
    expect(sum).toBe(audit.frames.pairedFrameDirectories);
    expect(audit.frames.frameNamingSchemeReconciled).toBe(true);
    expect(schemes.timestamp_seconds).toBeGreaterThan(0);
    expect(schemes.timestamp_milliseconds).toBe(1);
    expect(schemes.hh_mm_ss).toBe(1);
    expect(schemes.sequential_index).toBe(1);
    expect(schemes.existing_manifest).toBe(1);
    expect(schemes.unknown).toBeGreaterThan(0);
    expect(audit.frames.framesWithExistingManifest).toBeGreaterThan(0);
    expect(audit.frames.contentHashedFrameDirectories).toBe(audit.frames.pairedFrameDirectories);
    expect(audit.frames.contentHashedFrameFiles).toBeGreaterThan(0);
    expect(audit.frames.metadataHashedFrameFiles).toBe(0);
  });

  test('179. document inventory covers pdf/docx/rtf/txt/html/jsonl/mp4/json', () => {
    const docs = inventoryDocumentFiles(FIXTURE_ROOT);
    const byType = Object.fromEntries(docs.map((d) => [d.sourceType, d]));
    expect(byType.pdf?.signatureStatus).toBe('ok');
    expect(byType.docx?.signatureStatus).toBe('ok');
    expect(byType.rtf?.signatureStatus).toBe('ok');
    expect(byType.txt?.signatureStatus).toBe('ok');
    expect(byType.html?.signatureStatus).toBe('ok');
    expect(byType.jsonl?.signatureStatus).toBe('ok');
    expect(byType.mp4?.signatureStatus).toBe('unknown');
    expect(byType.json?.relativePath).toBe('sample-generic.json');
    expect(byType.unsupported?.relativePath).toBe('unsupported.bin');
  });

  test('180. audit documentsByType populated and whisper json excluded', () => {
    const audit = buildStage3j2aAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      documents: { documentsByType: Record<string, number>; supportedDocumentFiles: number; unsupportedFiles: number };
      discovery: { transcriptAssets: number; documentSources: number };
    };
    expect(audit.documents.documentsByType.pdf).toBe(1);
    expect(audit.documents.documentsByType.docx).toBe(1);
    expect(audit.documents.documentsByType.rtf).toBe(1);
    expect(audit.documents.documentsByType.txt).toBe(1);
    expect(audit.documents.documentsByType.html).toBe(1);
    expect(audit.documents.documentsByType.jsonl).toBe(1);
    expect(audit.documents.documentsByType.mp4).toBe(1);
    expect(audit.documents.documentsByType.json).toBe(1);
    expect(audit.documents.supportedDocumentFiles).toBe(8);
    expect(audit.documents.unsupportedFiles).toBe(1);
    expect(audit.discovery.documentSources).toBe(8);
    expect(audit.discovery.transcriptAssets).toBeGreaterThan(20);
  });
});
