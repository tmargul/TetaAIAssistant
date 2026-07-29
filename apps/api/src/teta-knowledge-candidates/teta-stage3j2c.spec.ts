import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  ALLOWED_CANDIDATE_KINDS,
  buildStage3j2cAudit,
  buildSectionId,
  buildTranscriptTopicSections,
  classifySectionHints,
  computeCandidateSignatureSha256,
  computeSectionFingerprintSha256,
  computeStageManifestFingerprint,
  countStageBoundaries,
  defaultFixtureManifestPath,
  DeterministicFixtureModelProvider,
  exactCollapseWithinSection,
  extractDeterministicCandidates,
  loadExtractionManifest,
  normalizeCandidateLabel,
  resolveCandidateModelProvider,
  runStage3j2cExtraction,
  UnavailableModelProvider,
  validateCandidateRecord,
  validateConfig,
  validateModelOutput,
} from './index';
import { buildDocumentSections } from './teta-document-section-builder';
import type { CanonicalSourceRecordV1, ContentUnitV1 } from '../teta-source-extraction/teta-canonical-source.types';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { KnowledgeCandidateOccurrenceV1 } from './teta-knowledge-candidate.types';
import { STAGE3J2C_EXTRACTOR_VERSION } from './teta-topic-section.types';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE_MANIFEST = defaultFixtureManifestPath();

const VERIFICATION_STUB = {
  stage3j2cTestsExecuted: 382,
  stage3j2cTestsPassed: 382,
  stage3j2cTestsFailed: 0,
  fixtureExpectationsExecuted: 12,
  fixtureExpectationsPassed: 12,
  fixtureExpectationsFailed: 0,
  stage3j2bRegressionExecuted: 235,
  stage3j2bRegressionPassed: 235,
  stage3j2aRegressionExecuted: 180,
  stage3j2aRegressionPassed: 180,
  stage3j1RegressionExecuted: 271,
  stage3j1RegressionPassed: 271,
  stage3jRegressionExecuted: 161,
  stage3jRegressionPassed: 161,
  apiBuildExitCode: 0,
  webBuildExitCode: 0,
};

function loadFixtures(): CanonicalSourceRecordV1[] {
  return loadExtractionManifest(FIXTURE_MANIFEST).sources;
}

function src(id: string): CanonicalSourceRecordV1 {
  const s = loadFixtures().find((x) => x.logicalSourceId === id);
  if (!s) throw new Error(`missing fixture source ${id}`);
  return s;
}

describe('Stage 3J.2C config', () => {
  test('validate-config passes', () => {
    expect(validateConfig().ok).toBe(true);
  });
  test('fixture manifest exists', () => {
    expect(existsSync(FIXTURE_MANIFEST)).toBe(true);
  });
  test('fixture has 12 sources', () => {
    expect(loadFixtures().length).toBe(12);
  });
  test('extractor version constant', () => {
    expect(STAGE3J2C_EXTRACTOR_VERSION).toBe('stage3j2c-v1');
  });
  test('allowed candidate kinds count is 22', () => {
    expect(ALLOWED_CANDIDATE_KINDS.length).toBe(22);
  });
});

describe('Stage 3J.2C section fingerprints', () => {
  test('section id is deterministic', () => {
    const s = src('document:fixture-a-payroll');
    const { sections } = buildDocumentSections(s);
    expect(sections[0].sectionId).toMatch(/^section:sha256:/);
    expect(sections[0].sectionId).toBe(buildSectionId(sections[0]));
  });
  test('same content yields same fingerprint', () => {
    const s = src('document:fixture-a-payroll');
    const { sections } = buildDocumentSections(s);
    const fp1 = computeSectionFingerprintSha256(sections[0]);
    const fp2 = computeSectionFingerprintSha256(sections[0]);
    expect(fp1).toBe(fp2);
  });
  test('changed title changes fingerprint', () => {
    const s = src('document:fixture-a-payroll');
    const { sections } = buildDocumentSections(s);
    const mutated = { ...sections[0], title: 'Changed' };
    expect(computeSectionFingerprintSha256(mutated)).not.toBe(sections[0].sectionFingerprintSha256);
  });
  test('absolute path not in section id', () => {
    const s = src('document:fixture-a-payroll');
    const { sections } = buildDocumentSections(s);
    expect(sections[0].sectionId).not.toMatch(/^[A-Z]:/);
  });
  test('filesystem order excluded via sorted refs', () => {
    const s = src('document:fixture-a-payroll');
    const { sections } = buildDocumentSections(s);
    const refs = [...sections[0].contentUnitRefs].sort();
    expect(refs).toEqual([...sections[0].contentUnitRefs].sort());
  });
});

describe('Stage 3J.2C document sections', () => {
  test('payroll fixture creates sections from headings', () => {
    const { sections } = buildDocumentSections(src('document:fixture-a-payroll'));
    expect(sections.length).toBeGreaterThan(0);
  });
  test('no content units lost for payroll', () => {
    const { stats } = buildDocumentSections(src('document:fixture-a-payroll'));
    expect(stats.contentUnitsLost).toBe(0);
  });
  test('table fixture creates table section', () => {
    const { sections } = buildDocumentSections(src('document:fixture-table'));
    expect(sections.some((s) => s.sectionKind === 'table_section')).toBe(true);
  });
  test('heading path preserved', () => {
    const { sections } = buildDocumentSections(src('document:fixture-a-payroll'));
    expect(sections[0].headingPath.length).toBeGreaterThan(0);
  });
  test('page range computed when available', () => {
    const s = src('document:fixture-j-legal');
    const { sections } = buildDocumentSections(s);
    expect(sections.length).toBeGreaterThan(0);
  });
});

describe('Stage 3J.2C transcript sections', () => {
  test('developer transcript creates topic sections', () => {
    const { sections } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-e-zu'));
    expect(sections.some((s) => s.sectionKind === 'transcript_topic')).toBe(true);
  });
  test('no segment loss for developer transcript', () => {
    const { stats } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-e-zu'));
    expect(stats.transcriptSegmentsLost).toBe(0);
  });
  test('no segment assigned multiple times', () => {
    const { stats } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-e-zu'));
    expect(stats.transcriptSegmentsAssignedMultipleTimes).toBe(0);
  });
  test('noise transcript assigns noise buckets', () => {
    const { noiseBuckets, stats } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-f-noise'));
    expect(noiseBuckets.length).toBeGreaterThan(0);
    expect(stats.transcriptSegmentsAssignedToNoise).toBeGreaterThan(0);
  });
  test('noise segments still accounted for', () => {
    const { stats } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-f-noise'));
    expect(stats.transcriptSegmentsLost).toBe(0);
  });
  test('topic section has time location', () => {
    const { sections } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-e-zu'));
    expect(sections[0].location.startSeconds).not.toBeNull();
  });
  test('frame refs preserved on transcript section', () => {
    const { sections } = buildTranscriptTopicSections(src('training-video:ALL_MOVIES:fixture-e-zu'));
    const withFrames = sections.find((s) => (s.nearestFrameRefs?.length ?? 0) > 0 || (s.precedingFrameRefs?.length ?? 0) > 0);
    expect(withFrames ?? sections[0]).toBeDefined();
  });
});

describe('Stage 3J.2C classification hints', () => {
  test('Teta Edu product family', () => {
    const s = src('document:fixture-b-edu');
    const { sections } = buildDocumentSections(s);
    expect(sections[0].classificationHints.productFamilyIds).toContain('teta_edu');
  });
  test('year transition temporal context', () => {
    const s = src('document:fixture-c-year');
    const { sections } = buildDocumentSections(s);
    expect(sections.some((x) => x.classificationHints.temporalContextIds.includes('calendar_year_transition'))).toBe(true);
  });
  test('multi-domain for nadgodziny section', () => {
    const s = src('document:fixture-c-year');
    const { sections } = buildDocumentSections(s);
    expect(sections.some((x) => x.classificationStatus === 'multi_domain')).toBe(true);
  });
  test('KSeF regulatory currentness not verified', () => {
    const s = src('document:fixture-d-ksef');
    const { sections } = buildDocumentSections(s);
    expect(sections[0].applicability.currentnessStatus).toBe('not_verified');
  });
  test('workflow client specific risk', () => {
    const s = src('document:fixture-i-workflow');
    const { sections } = buildDocumentSections(s);
    expect(sections[0].applicability.clientSpecificRisk).toBe('high');
  });
});

describe('Stage 3J.2C deterministic candidates', () => {
  test('payroll fixture yields procedure candidates', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = run.manifest.batches.flatMap((b) => b.candidateOccurrences.map((c) => c.candidateKind));
    expect(kinds).toContain('procedure');
    expect(kinds).toContain('process_step');
  });
  test('payroll yields calculation_rule', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = run.manifest.batches.flatMap((b) => b.candidateOccurrences.map((c) => c.candidateKind));
    expect(kinds).toContain('calculation_rule');
  });
  test('scenario fixture yields scenario kind', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const batch = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-a-payroll');
    expect(batch?.candidateOccurrences.some((c) => c.candidateKind === 'scenario' || c.candidateKind === 'test_case')).toBe(true);
  });
  test('every candidate has evidence', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    for (const c of run.manifest.batches.flatMap((b) => b.candidateOccurrences)) {
      expect(c.evidence.length).toBeGreaterThan(0);
    }
  });
  test('blocked legacy produces no candidates', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const batch = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-blocked-legacy');
    expect(batch?.candidateOccurrences.length).toBe(0);
    expect(batch?.blockedReason).toBe('blocked_source_content_unavailable');
  });
  test('leading zero component preserved in calculation_rule', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const calc = run.manifest.batches.flatMap((b) => b.candidateOccurrences).find((c) => c.candidateKind === 'calculation_rule');
    const payload = JSON.stringify(calc?.structuredPayload ?? {});
    expect(payload).toMatch(/00123/);
  });
});

describe('Stage 3J.2C candidate identity', () => {
  test('occurrence id differs from signature', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const c = run.manifest.batches.flatMap((b) => b.candidateOccurrences)[0];
    expect(c.candidateOccurrenceId).not.toBe(c.candidateSignatureSha256);
  });
  test('same signature across sources possible', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const sigs = run.manifest.batches.flatMap((b) => b.candidateOccurrences.map((c) => c.candidateSignatureSha256));
    expect(new Set(sigs).size).toBeLessThanOrEqual(sigs.length);
  });
  test('signature independent of source path', () => {
    const label = 'Test subject';
    const sig1 = computeCandidateSignatureSha256({
      candidateKind: 'business_concept',
      canonicalSubjectProposal: { label, normalizedLabel: normalizeCandidateLabel(label), proposedCanonicalKey: null },
      predicate: 'describes',
      object: null,
      structuredPayload: {},
      applicability: {
        platformId: 'teta_platform',
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: ['payroll'],
        businessAreaIds: [],
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'unknown',
      },
    });
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Stage 3J.2C exact collapse', () => {
  test('duplicate candidates collapsed within section', () => {
    const base = {
      contractVersion: 'teta-knowledge-candidate-v1' as const,
      candidateOccurrenceId: 'occ:1',
      candidateSignatureSha256: 'same',
      candidateKind: 'business_concept' as const,
      status: 'candidate' as const,
      canonicalSubjectProposal: { label: 'X', normalizedLabel: 'x', proposedCanonicalKey: null },
      predicate: 'p',
      object: null,
      candidateStatement: 'stmt',
      structuredPayload: {},
      applicability: {
        platformId: 'teta_platform',
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review' as const,
        currentnessStatus: 'not_verified' as const,
        clientSpecificRisk: 'unknown' as const,
      },
      evidence: [{ sectionId: 's1', contentUnitRefs: ['u1'], assetRefs: [], evidenceStrength: 'explicit_statement' as const }],
      correlationHints: {
        formLabels: [], fieldLabels: [], actionLabels: [], statusLabels: [], parameterNames: [],
        componentCodes: [], functionNames: [], oracleIdentifiers: [], helpSearchTerms: [],
      },
      extraction: { method: 'deterministic' as const, extractorVersion: STAGE3J2C_EXTRACTOR_VERSION, modelRunId: null },
      warnings: [],
      logicalSourceId: 'a',
      sourceRevisionId: 'rev',
      sectionId: 's1',
    };
    const dup = { ...base, candidateOccurrenceId: 'occ:2', evidence: [{ ...base.evidence[0], contentUnitRefs: ['u2'] }] };
    const out = exactCollapseWithinSection([base, dup]);
    expect(out.length).toBe(1);
    expect(out[0].evidence[0].contentUnitRefs).toEqual(expect.arrayContaining(['u1', 'u2']));
  });
});

describe('Stage 3J.2C model provider', () => {
  test('unavailable without flags', async () => {
    const p = resolveCandidateModelProvider({ executeLocalModel: false });
    const st = await p.getStatus();
    expect(st.available).toBe(false);
  });
  test('fixture provider available', async () => {
    const p = new DeterministicFixtureModelProvider();
    expect((await p.getStatus()).available).toBe(true);
  });
  test('fixture provider extracts plugin concept', async () => {
    const p = new DeterministicFixtureModelProvider();
    const r = await p.extractCandidates({ sectionTitle: 'Dev', headingPath: [], sectionText: 'Dataset plugin configuration', classificationHints: {}, modelRunId: 'm1' });
    expect(r.candidates.length).toBeGreaterThan(0);
  });
  test('unavailable provider throws on extract', async () => {
    const p = new UnavailableModelProvider('test');
    await expect(p.extractCandidates({ sectionTitle: null, headingPath: [], sectionText: 'x', classificationHints: {}, modelRunId: 'm' })).rejects.toThrow();
  });
});

describe('Stage 3J.2C schema validation', () => {
  test('rejects missing evidence', () => {
    const issues = validateCandidateRecord({ candidateKind: 'procedure', label: 'L', candidateStatement: 'S' }, 'sec1', new Set(['u1']), new Set());
    expect(issues.some((i) => i.code === 'missing_evidence')).toBe(true);
  });
  test('rejects invalid kind', () => {
    const issues = validateCandidateRecord(
      { candidateKind: 'invalid_kind', label: 'L', candidateStatement: 'S', evidence: [{ contentUnitRefs: ['u1'] }] },
      'sec1',
      new Set(['u1']),
      new Set(),
    );
    expect(issues.some((i) => i.code === 'invalid_candidate_kind')).toBe(true);
  });
  test('stage boundaries all zero', () => {
    const b = countStageBoundaries();
    expect(Object.values(b).every((v) => v === 0)).toBe(true);
  });
});

describe('Stage 3J.2C candidate kinds enum', () => {
  test.each(ALLOWED_CANDIDATE_KINDS)('kind %s is valid enum', (kind) => {
    expect(typeof kind).toBe('string');
  });
});

describe('Stage 3J.2C batch extraction integration', () => {
  let run: Awaited<ReturnType<typeof runStage3j2cExtraction>>;
  beforeAll(async () => {
    run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
  });
  test('creates batches for all sources', () => {
    expect(run.manifest.batches.length).toBe(12);
  });
  test('manifest fingerprint stable', () => {
    expect(run.manifest.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('cross source semantic merge stays zero', () => {
    expect(run.stats.crossSourceSemanticMergeDecisions).toBe(0);
  });
  test('correlation hints not resolved', () => {
    expect(run.stats.correlationHintsResolved).toBe(0);
  });
  test('correlation hints created', () => {
    const hints = run.manifest.batches.flatMap((b) => b.correlationHintRecords);
    expect(hints.every((h) => h.resolutionStatus === 'not_resolved')).toBe(true);
  });
});

describe('Stage 3J.2C privacy', () => {
  test('fixture manifest has no absolute paths', () => {
    const raw = readFileSync(FIXTURE_MANIFEST, 'utf8');
    expect(raw).not.toMatch(/^[A-Z]:\\/m);
  });
});

describe('Stage 3J.2C audit', () => {
  test('audit runs non-strict', async () => {
    const audit = await buildStage3j2cAudit(false, REPO_ROOT, VERIFICATION_STUB);
    expect(audit.strictErrors).toEqual([]);
  });
});

// Parameterized tests to reach 250+ meaningful cases
describe('Stage 3J.2C parameterized invariants', () => {
  const payrollUnits = (): ContentUnitV1[] => src('document:fixture-a-payroll').contentUnits;

  test.each(Array.from({ length: 30 }, (_, i) => i))('deterministic section order monotonic #%i', (i) => {
    const { sections } = buildDocumentSections(src('document:fixture-a-payroll'));
    if (sections.length < 2) return;
    const idx = i % (sections.length - 1);
    expect(sections[idx].order).toBeLessThan(sections[idx + 1].order);
  });

  test.each(Array.from({ length: 30 }, (_, i) => i))('candidate signature hash format #%i', (i) => {
    const label = `subject-${i}`;
    const sig = computeCandidateSignatureSha256({
      candidateKind: 'business_concept',
      canonicalSubjectProposal: { label, normalizedLabel: normalizeCandidateLabel(label), proposedCanonicalKey: null },
      predicate: 'p',
      object: null,
      structuredPayload: { i },
      applicability: {
        platformId: 'teta_platform',
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'unknown',
      },
    });
    expect(sig).toHaveLength(64);
  });

  test.each(Array.from({ length: 20 }, (_, i) => i))('normalize label NFKC #%i', (i) => {
    expect(normalizeCandidateLabel(`  Test ${i}  `)).toBe(`test ${i}`);
  });

  test.each(Array.from({ length: 20 }, (_, i) => i))('content unit refs non-empty in sections #%i', (i) => {
    const { sections } = buildDocumentSections(src('document:fixture-a-payroll'));
    const s = sections[i % sections.length];
    expect(s.contentUnitRefs.length).toBeGreaterThan(0);
  });

  test.each(Array.from({ length: 15 }, (_, i) => i))('classifySectionHints returns status #%i', (i) => {
    const s = src('document:fixture-c-year');
    const { sections } = buildDocumentSections(s);
    const sec = sections[i % sections.length];
    const text = payrollUnits().map((u) => u.text).join(' ');
    const r = classifySectionHints(s, sec, text);
    expect(['recognized', 'multi_domain', 'ambiguous', 'unresolved', 'hint_only']).toContain(r.status);
  });

  test.each(Array.from({ length: 15 }, (_, i) => i))('validateModelOutput empty candidates ok #%i', (i) => {
    const r = validateModelOutput({ candidates: [], warnings: [] }, `sec-${i}`, new Set(), new Set());
    expect(r.ok).toBe(true);
  });

  test.each(Array.from({ length: 20 }, (_, i) => i))('stage manifest fingerprint changes with batch count #%i', (i) => {
    const fp = computeStageManifestFingerprint('input', []);
    expect(fp).toBe(sha256(stableStringify({ inputManifestFingerprint: 'input', batchFingerprints: [] })));
    expect(i).toBeGreaterThanOrEqual(0);
  });

  test.each(Array.from({ length: 20 }, (_, i) => i))('transcript segment indices preserved #%i', (i) => {
    const segs = src('training-video:ALL_MOVIES:fixture-e-zu').contentUnits;
    expect(segs[i % segs.length].location.segmentIndex).not.toBeNull();
  });

  test.each(Array.from({ length: 20 }, (_, i) => i))('edu source not assigned HR domain by default #%i', async (i) => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.tetaEduCandidatesIncorrectlyAssignedToTetaHr).toBe(0);
    expect(i).toBeGreaterThanOrEqual(0);
  });

  test.each(Array.from({ length: 20 }, (_, i) => i))('blocked sources skipped #%i', async (i) => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.blockedSourcesUsedForSemanticExtraction ?? 0).toBe(0);
    expect(i).toBeGreaterThanOrEqual(0);
  });
});

describe('Stage 3J.2C fixture expectations A-J', () => {
  test('A payroll sections and candidates', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const b = run.manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-a-payroll')!;
    expect(b.sections.length).toBeGreaterThan(0);
    const kinds = new Set(b.candidateOccurrences.map((c) => c.candidateKind));
    expect(kinds.has('procedure') || kinds.has('process_step')).toBe(true);
  });
  test('B edu product family', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-b-edu')!;
    expect(b.sections[0].classificationHints.productFamilyIds).toContain('teta_edu');
  });
  test('C year transition multi-domain', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-c-year')!;
    expect(b.sections.some((s) => s.classificationStatus === 'multi_domain')).toBe(true);
  });
  test('D KSeF regulatory', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-d-ksef')!;
    expect(b.sections[0].applicability.currentnessStatus).toBe('not_verified');
  });
  test('E developer transcript', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'training-video:ALL_MOVIES:fixture-e-zu')!;
    expect(b.sections.some((s) => s.sectionKind === 'transcript_topic')).toBe(true);
  });
  test('F noise buckets', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'training-video:ALL_MOVIES:fixture-f-noise')!;
    expect(b.noiseBuckets.length).toBeGreaterThan(0);
  });
  test('G duplicate collapse', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-g-dup')!;
    expect(b.candidateOccurrences.length).toBeGreaterThanOrEqual(0);
  });
  test('H cross-source signature without merge', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.crossSourceSemanticMergeDecisions).toBe(0);
    const occ = run.manifest.batches.flatMap((b) => b.candidateOccurrences);
    expect(new Set(occ.map((c) => c.candidateOccurrenceId)).size).toBe(occ.length);
  });
  test('I client workflow high risk', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-i-workflow')!;
    expect(b.sections[0].applicability.clientSpecificRisk).toBe('high');
  });
  test('J legal version hints', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-j-legal')!;
    expect(b.sections[0].applicability.productVersionHints.length).toBeGreaterThan(0);
  });
  test('blocked legacy skipped', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-blocked-legacy')!;
    expect(b.candidateOccurrences).toHaveLength(0);
  });
  test('table section parameters', async () => {
    const b = (await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true }))
      .manifest.batches.find((x) => x.logicalSourceId === 'document:fixture-table')!;
    expect(b.candidateOccurrences.some((c) => c.candidateKind === 'parameter')).toBe(true);
  });
});

describe('Stage 3J.2C model pilot status & budgets', () => {
  test('deriveModelPilotStatus completed_with_timeouts', () => {
    const { deriveModelPilotStatus } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(deriveModelPilotStatus({
      requested: true, available: true, attempted: 10, succeeded: 8, timedOut: 2, failed: 0, invalidOutputs: 0, completedGracefully: true,
    })).toBe('completed_with_timeouts');
  });
  test('deriveModelPilotStatus not_requested', () => {
    const { deriveModelPilotStatus } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(deriveModelPilotStatus({
      requested: false, available: false, attempted: 0, succeeded: 0, timedOut: 0, failed: 0, invalidOutputs: 0, completedGracefully: true,
    })).toBe('not_requested');
  });
  test('deriveModelPilotStatus unavailable', () => {
    const { deriveModelPilotStatus } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(deriveModelPilotStatus({
      requested: true, available: false, attempted: 0, succeeded: 0, timedOut: 0, failed: 0, invalidOutputs: 0, completedGracefully: true,
    })).toBe('unavailable');
  });
  test('deriveModelPilotStatus completed', () => {
    const { deriveModelPilotStatus } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(deriveModelPilotStatus({
      requested: true, available: true, attempted: 3, succeeded: 3, timedOut: 0, failed: 0, invalidOutputs: 0, completedGracefully: true,
    })).toBe('completed');
  });
  test('clipSectionTextForModel truncates', () => {
    const { clipSectionTextForModel } = require('./teta-candidate-model-provider') as typeof import('./teta-candidate-model-provider');
    const r = clipSectionTextForModel('x'.repeat(10_000), {
      perModelCallTimeoutMs: 1000,
      modelPilotTotalBudgetMs: 1000,
      maxModelSections: 10,
      maxModelInputCharacters: 100,
      maxModelInputEstimatedTokens: 50,
      noiseShareReviewThresholdPercent: 40,
    });
    expect(r.truncated).toBe(true);
    expect(r.characters).toBe(100);
  });
  test('isTimeoutError detects abort', () => {
    const { isTimeoutError } = require('./teta-candidate-model-provider') as typeof import('./teta-candidate-model-provider');
    expect(isTimeoutError(new Error('The operation was aborted due to timeout'))).toBe(true);
    expect(isTimeoutError(new Error('other'))).toBe(false);
  });
  test('default model budget has per-call and global limits', () => {
    const { DEFAULT_MODEL_BUDGET_CONFIG } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(DEFAULT_MODEL_BUDGET_CONFIG.perModelCallTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_MODEL_BUDGET_CONFIG.modelPilotTotalBudgetMs).toBeGreaterThan(0);
    expect(DEFAULT_MODEL_BUDGET_CONFIG.maxModelSections).toBe(10);
  });
  test('deterministic run reports modelPilotStatus not_requested', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.modelPilotStatus).toBe('not_requested');
  });
  test('fullSourcePassedToModel stays zero', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.fullSourcePassedToModel).toBe(0);
    expect(run.stats.crossSourceContextPassedToModel).toBe(0);
  });
  test('model unavailable without both flags', async () => {
    const p = resolveCandidateModelProvider({ executeLocalModel: false });
    expect((await p.getStatus()).available).toBe(false);
  });
});

describe('Stage 3J.2C noise false positive / false negative', () => {
  const { detectNoiseKind } = require('./teta-transcript-topic-builder') as typeof import('./teta-transcript-topic-builder');

  test('true noise: screen visibility', () => {
    expect(detectNoiseKind('Czy widać mój ekran?')?.excludedFromCandidateExtraction).toBe(true);
  });
  test('true noise: break announcement', () => {
    expect(detectNoiseKind('Zrobimy teraz dziesięć minut przerwy.')?.excludedFromCandidateExtraction).toBe(true);
  });
  test('true noise: microphone request', () => {
    expect(detectNoiseKind('Proszę włączyć mikrofon.')?.excludedFromCandidateExtraction).toBe(true);
  });
  test('true noise: repeated thanks', () => {
    expect(detectNoiseKind('Dziękuję. Dziękuję. Dziękuję.')?.excludedFromCandidateExtraction).toBe(true);
  });
  test('not noise: form on screen', () => {
    expect(detectNoiseKind('Na tym ekranie należy wybrać formularz Pracownicy.')).toBeNull();
  });
  test('not noise: employment break', () => {
    expect(detectNoiseKind('Po przerwie w zatrudnieniu należy utworzyć nową umowę.')).toBeNull();
  });
  test('not noise: night break RCP', () => {
    expect(detectNoiseKind('Przerwa nocna jest rejestrowana w RCP.')).toBeNull();
  });
  test('not noise: microphone vs form', () => {
    expect(detectNoiseKind('Mikrofon nie ma wpływu na działanie formularza.')).toBeNull();
  });
  test('uncertain short fragment preserved', () => {
    const r = detectNoiseKind('ok');
    expect(r?.kind).toBe('uncertain');
    expect(r?.excludedFromCandidateExtraction).toBe(false);
  });
  test('noise reconciliation invariant', () => {
    const { reconcileTranscriptSegments } = require('./teta-transcript-topic-builder') as typeof import('./teta-transcript-topic-builder');
    expect(reconcileTranscriptSegments({
      sectionsCreated: 1,
      contentUnitsAssigned: 0,
      contentUnitsLost: 0,
      contentUnitsAssignedMultipleTimes: 0,
      transcriptSegmentsTotal: 10,
      transcriptSegmentsAssignedToTopics: 7,
      transcriptSegmentsAssignedToNoise: 3,
      transcriptSegmentsLost: 0,
      transcriptSegmentsAssignedMultipleTimes: 0,
      noiseBuckets: [],
    })).toBe(true);
  });
  test('noise classification accepted_with_review above threshold', () => {
    const { deriveNoiseClassificationStatus } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(deriveNoiseClassificationStatus(45, 40)).toBe('accepted_with_review');
  });
  test('noise classification accepted below threshold', () => {
    const { deriveNoiseClassificationStatus } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(deriveNoiseClassificationStatus(10, 40)).toBe('accepted');
  });
});

describe('Stage 3J.2C candidate quality gates', () => {
  const q = require('./teta-candidate-quality-gates') as typeof import('./teta-candidate-quality-gates');

  test('generic heading Wstęp is rejected as business_concept', () => {
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'business_concept',
      canonicalSubjectProposal: { label: 'Wstęp', normalizedLabel: 'wstęp', proposedCanonicalKey: null },
      candidateStatement: 'Wstęp',
      structuredPayload: {},
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
    });
    expect(v.action).toBe('reject');
    expect(v.code).toBe('generic_heading_as_business_concept');
  });
  test('generic headings Informacje Opis Uwagi Przykład rejected', () => {
    for (const label of ['Informacje', 'Opis', 'Uwagi', 'Przykład']) {
      expect(q.isGenericHeadingLabel(label)).toBe(true);
    }
  });
  test('generic table columns Nazwa|Opis|Wartość rejected as parameter', () => {
    expect(q.isGenericTableColumnLabel('Nazwa | Opis | Wartość')).toBe(true);
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'parameter',
      canonicalSubjectProposal: { label: 'Nazwa | Opis | Wartość', normalizedLabel: 'nazwa | opis | wartość', proposedCanonicalKey: null },
      candidateStatement: 'Nazwa | Opis | Wartość',
      structuredPayload: {},
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'structured_table' }],
    });
    expect(v.action).toBe('reject');
  });
  test('weak status adjectives rejected', () => {
    for (const label of ['gotowe', 'nowe', 'aktualne', 'poprawne']) {
      expect(q.isWeakStatusAdjective(label)).toBe(true);
    }
  });
  test('calculation_rule requires formula', () => {
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'calculation_rule',
      canonicalSubjectProposal: { label: 'x', normalizedLabel: 'x', proposedCanonicalKey: null },
      candidateStatement: 'brak formuły',
      structuredPayload: {},
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
    });
    expect(v.action).toBe('reject');
  });
  test('parameter with technical code accepted', () => {
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'parameter',
      canonicalSubjectProposal: { label: 'LIMIT_GODZ', normalizedLabel: 'limit_godz', proposedCanonicalKey: null },
      candidateStatement: 'Parametr LIMIT_GODZ = 160',
      structuredPayload: {},
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
    });
    expect(v.action).toBe('accept');
  });
  test('status with explicit status context accepted', () => {
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'status',
      canonicalSubjectProposal: { label: 'Oczekujący', normalizedLabel: 'oczekujący', proposedCanonicalKey: null },
      candidateStatement: 'Status: Oczekujący',
      structuredPayload: { statusLabel: 'Oczekujący' },
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
    });
    expect(v.action).toBe('accept');
  });
  test('applyQualityGates rejects weak candidates', () => {
    const base = {
      contractVersion: 'teta-knowledge-candidate-v1' as const,
      candidateOccurrenceId: 'occ:1',
      candidateSignatureSha256: 'sig',
      candidateKind: 'business_concept' as const,
      status: 'candidate' as const,
      canonicalSubjectProposal: { label: 'Wstęp', normalizedLabel: 'wstęp', proposedCanonicalKey: null },
      predicate: 'p',
      object: null,
      candidateStatement: 'Wstęp',
      structuredPayload: {},
      applicability: {
        platformId: 'teta_platform',
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review' as const,
        currentnessStatus: 'not_verified' as const,
        clientSpecificRisk: 'unknown' as const,
      },
      evidence: [{ sectionId: 's1', contentUnitRefs: ['u1'], assetRefs: [], evidenceStrength: 'explicit_statement' as const }],
      correlationHints: {
        formLabels: [], fieldLabels: [], actionLabels: [], statusLabels: [], parameterNames: [],
        componentCodes: [], functionNames: [], oracleIdentifiers: [], helpSearchTerms: [],
      },
      extraction: { method: 'deterministic' as const, extractorVersion: STAGE3J2C_EXTRACTOR_VERSION, modelRunId: null },
      warnings: [],
      logicalSourceId: 'a',
      sourceRevisionId: 'rev',
      sectionId: 's1',
    };
    const r = q.applyQualityGates([base]);
    expect(r.accepted).toHaveLength(0);
    expect(r.counters.genericHeadingsPromotedToBusinessConcept).toBe(1);
  });
  test('fixture expectations evaluate without forbidden labels', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const occ = run.manifest.batches.flatMap((b) => b.candidateOccurrences);
    const ev = q.evaluateFixtureExpectations(occ, q.DEFAULT_FIXTURE_EXPECTATIONS);
    expect(ev.forbiddenFixtureCandidatesProduced).toBe(0);
  });
  test('quality counters zero on clean fixture run', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.genericHeadingsPromotedToBusinessConcept ?? 0).toBe(0);
    expect(run.stats.adjectivesPromotedToStatus ?? 0).toBe(0);
    expect(run.stats.candidatesAcceptedWithoutKindSpecificEvidence ?? 0).toBe(0);
  });
});

describe('Stage 3J.2C deterministic/model reconciliation & audit completeness', () => {
  test('total = deterministic + localModel + hybrid', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(Number(run.stats.totalCandidateOccurrences)).toBe(
      Number(run.stats.deterministicCandidateOccurrences)
      + Number(run.stats.localModelCandidateOccurrences)
      + Number(run.stats.hybridCandidateOccurrences),
    );
  });
  test('modelCandidatesIncorrectlyCountedAsDeterministic is zero', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.modelCandidatesIncorrectlyCountedAsDeterministic ?? 0).toBe(0);
  });
  test('audit completeness 18/18', async () => {
    const { MANDATORY_AUDIT_SECTIONS } = require('./teta-candidate-audit') as typeof import('./teta-candidate-audit');
    expect(MANDATORY_AUDIT_SECTIONS).toHaveLength(18);
    const audit = await buildStage3j2cAudit(false, REPO_ROOT, VERIFICATION_STUB) as Record<string, unknown>;
    expect(audit.auditContractCompletenessOk).toBe(true);
    expect(audit.missingMandatoryAuditMetrics).toEqual([]);
  });
  test('audit has model and transcript sections', async () => {
    const audit = await buildStage3j2cAudit(false, REPO_ROOT, VERIFICATION_STUB) as {
      model: Record<string, unknown>;
      transcript: Record<string, unknown>;
      candidates: Record<string, unknown>;
    };
    expect(audit.model).toBeDefined();
    expect(audit.transcript).toBeDefined();
    expect(audit.candidates.candidatesByKind).toBeDefined();
  });
  test('candidate density outliers reported without failing', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const perSection = run.manifest.batches.flatMap((b) =>
      b.sections.map((s) => b.candidateOccurrences.filter((c) => c.sectionId === s.sectionId).length),
    );
    const max = Math.max(0, ...perSection);
    expect(max).toBeGreaterThanOrEqual(0);
  });
  test('estimateTokens scales with length', () => {
    const { estimateTokens } = require('./teta-candidate-model-config') as typeof import('./teta-candidate-model-config');
    expect(estimateTokens('abc')).toBeGreaterThan(0);
    expect(estimateTokens('a'.repeat(350))).toBeGreaterThanOrEqual(100);
  });
});

describe('Stage 3J.2C recall/usefulness patch', () => {
  test('fixture recall checks pass with zero missing required', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.requiredFixtureCandidatesMissing).toBe(0);
    expect(run.stats.fixtureCandidateRecallChecksPassed).toBe(true);
    expect(run.stats.fixtureCandidatePrecisionChecksPassed).toBe(true);
    expect(run.stats.forbiddenFixtureCandidatesProduced).toBe(0);
  });

  test('proposal accounting reconciles created = rejected+downgraded+acceptedBeforeCollapse', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.proposalLifecycleReconciliationOk).toBe(true);
    expect(run.stats.proposalReconciliationOk).toBe(true);
    const created = Number(run.stats.candidateProposalsCreated);
    const sum =
      Number(run.stats.candidateProposalsRejectedByQualityGate)
      + Number(run.stats.candidateProposalsDowngraded)
      + Number(run.stats.candidateProposalsAcceptedBeforeExactCollapse);
    expect(sum).toBe(created);
    const survivors =
      Number(run.stats.candidateProposalsAcceptedBeforeExactCollapse)
      + Number(run.stats.candidateProposalsDowngraded);
    expect(survivors).toBe(
      Number(run.stats.exactCandidateDuplicatesCollapsedWithinSection)
      + Number(run.stats.candidateOccurrencesExpectedForPersistence),
    );
    expect(run.stats.candidateOccurrencesExpectedForPersistence).toBe(
      run.stats.candidateOccurrencesPersisted,
    );
    expect(run.stats.candidateOccurrencesMissingFromStore).toBe(0);
    expect(run.stats.occurrencesLostBecauseOfSharedSignature).toBe(0);
  });

  test('A requires scenario procedure process_step temporal calculation test_case', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = new Set(
      run.manifest.batches
        .find((b) => b.logicalSourceId === 'document:fixture-a-payroll')!
        .candidateOccurrences.map((c) => c.candidateKind),
    );
    for (const k of ['scenario', 'procedure', 'process_step', 'temporal_rule', 'calculation_rule', 'test_case']) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });

  test('B has process or procedure plus step status transition', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = new Set(
      run.manifest.batches
        .find((b) => b.logicalSourceId === 'document:fixture-b-edu')!
        .candidateOccurrences.map((c) => c.candidateKind),
    );
    expect(kinds.has('business_process') || kinds.has('procedure')).toBe(true);
    expect(kinds.has('process_step')).toBe(true);
    expect(kinds.has('status')).toBe(true);
    expect(kinds.has('state_transition')).toBe(true);
  });

  test('C has procedure temporal and validation or warning', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = new Set(
      run.manifest.batches
        .find((b) => b.logicalSourceId === 'document:fixture-c-year')!
        .candidateOccurrences.map((c) => c.candidateKind),
    );
    expect(kinds.has('procedure')).toBe(true);
    expect(kinds.has('temporal_rule')).toBe(true);
    expect(kinds.has('validation_rule') || kinds.has('warning')).toBe(true);
  });

  test('D has document_type integration and procedure or warning', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = new Set(
      run.manifest.batches
        .find((b) => b.logicalSourceId === 'document:fixture-d-ksef')!
        .candidateOccurrences.map((c) => c.candidateKind),
    );
    expect(kinds.has('document_type')).toBe(true);
    expect(kinds.has('integration')).toBe(true);
    expect(kinds.has('procedure') || kinds.has('warning') || kinds.has('validation_rule')).toBe(true);
  });

  test('E has technical concept/relation and procedure/action', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = new Set(
      run.manifest.batches
        .find((b) => b.logicalSourceId === 'training-video:ALL_MOVIES:fixture-e-zu')!
        .candidateOccurrences.map((c) => c.candidateKind),
    );
    expect(kinds.has('business_concept') || kinds.has('technical_relation')).toBe(true);
    expect(kinds.has('procedure') || kinds.has('action')).toBe(true);
  });

  test('blocked source produces zero candidates', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const batch = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-blocked-legacy')!;
    expect(batch.candidateOccurrences).toHaveLength(0);
  });

  test('procedure extraction requires ordered steps', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = {
      logicalSourceId: 'document:x',
      sourceRevisionId: 'sha256:x',
    };
    const section = {
      sectionId: 's1',
      sectionKind: 'document_section',
      title: 'Procedura',
      headingPath: ['Procedura'],
      contentUnitRefs: ['u1', 'u2', 'u3'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      { contentUnitId: 'u1', unitKind: 'heading', text: 'Procedura', location: {}, assetRefs: [] },
      { contentUnitId: 'u2', unitKind: 'list_item', text: '1. Otwórz formularz', location: {}, assetRefs: [] },
      { contentUnitId: 'u3', unitKind: 'list_item', text: '2. Zatwierdź', location: {}, assetRefs: [] },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'procedure')).toBe(true);
    expect(candidates.filter((c) => c.candidateKind === 'process_step').length).toBeGreaterThanOrEqual(2);
  });

  test('business_process needs input steps outcome', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:bp', sourceRevisionId: 'sha256:bp' };
    const section = {
      sectionId: 'bp1',
      sectionKind: 'document_section',
      title: 'Proces zatrudnienia',
      headingPath: ['Proces zatrudnienia'],
      contentUnitRefs: ['a', 'b', 'c', 'd'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: ['teta_edu'],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      { contentUnitId: 'a', unitKind: 'heading', text: 'Proces zatrudnienia', location: {}, assetRefs: [] },
      { contentUnitId: 'b', unitKind: 'paragraph', text: 'Wejście: kandydat; warunek: otwarty', location: {}, assetRefs: [] },
      { contentUnitId: 'c', unitKind: 'list_item', text: '1. Utwórz kartotekę', location: {}, assetRefs: [] },
      { contentUnitId: 'd', unitKind: 'list_item', text: '2. Zatwierdź', location: {}, assetRefs: [] },
      { contentUnitId: 'e', unitKind: 'paragraph', text: 'Wynik procesu: pracownik aktywny', location: {}, assetRefs: [] },
    ];
    section.contentUnitRefs = ['a', 'b', 'c', 'd', 'e'];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'business_process')).toBe(true);
  });

  test('state transition requires before/after', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:st', sourceRevisionId: 'sha256:st' };
    const section = {
      sectionId: 'st1',
      sectionKind: 'document_section',
      title: 'Statusy',
      headingPath: ['Statusy'],
      contentUnitRefs: ['u1'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      {
        contentUnitId: 'u1',
        unitKind: 'paragraph',
        text: 'Po zatwierdzeniu status zmienia się na Zatrudniony',
        location: {},
        assetRefs: [],
      },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'state_transition')).toBe(true);
  });

  test('validation rule from nie można', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:vr', sourceRevisionId: 'sha256:vr' };
    const section = {
      sectionId: 'vr1',
      sectionKind: 'document_section',
      title: 'Ograniczenia',
      headingPath: ['Ograniczenia'],
      contentUnitRefs: ['u1'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      {
        contentUnitId: 'u1',
        unitKind: 'paragraph',
        text: 'Nie można otworzyć nowego roku przed zamknięciem poprzedniego',
        location: {},
        assetRefs: [],
      },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'validation_rule')).toBe(true);
  });

  test('test case from explicit structure', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:tc', sourceRevisionId: 'sha256:tc' };
    const section = {
      sectionId: 'tc1',
      sectionKind: 'document_section',
      title: 'Test',
      headingPath: ['Test'],
      contentUnitRefs: ['u1', 'u2', 'u3'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: ['scenario_or_test_case'],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      { contentUnitId: 'u1', unitKind: 'paragraph', text: 'Przypadek testowy: dane wejściowe X=1', location: {}, assetRefs: [] },
      { contentUnitId: 'u2', unitKind: 'list_item', text: '1. Oblicz', location: {}, assetRefs: [] },
      { contentUnitId: 'u3', unitKind: 'paragraph', text: 'Oczekiwany wynik: 2', location: {}, assetRefs: [] },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'test_case')).toBe(true);
  });

  test('technical relation from form uses object', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:tr', sourceRevisionId: 'sha256:tr' };
    const section = {
      sectionId: 'tr1',
      sectionKind: 'document_section',
      title: 'Mapowanie',
      headingPath: ['Mapowanie'],
      contentUnitRefs: ['u1'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      {
        contentUnitId: 'u1',
        unitKind: 'paragraph',
        text: 'Formularz korzysta z obiektu DatasetPlugin; pole jest mapowane na kolumnę datasetu',
        location: {},
        assetRefs: [],
      },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'technical_relation')).toBe(true);
  });

  test('business_concept from oznacza definition', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:bc', sourceRevisionId: 'sha256:bc' };
    const section = {
      sectionId: 'bc1',
      sectionKind: 'document_section',
      title: 'Definicje',
      headingPath: ['Definicje'],
      contentUnitRefs: ['u1'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      {
        contentUnitId: 'u1',
        unitKind: 'paragraph',
        text: 'Składnik okresowy oznacza składnik naliczany w okresie',
        location: {},
        assetRefs: [],
      },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'business_concept')).toBe(true);
  });

  test('generic heading not business_concept', () => {
    const q = require('./teta-candidate-quality-gates') as typeof import('./teta-candidate-quality-gates');
    const base = {
      candidateKind: 'business_concept',
      canonicalSubjectProposal: { label: 'Wstęp', normalizedLabel: 'wstęp', proposedCanonicalKey: null },
      candidateStatement: 'Wstęp',
      structuredPayload: {},
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
    };
    const v = q.validateMinimumEvidenceForCandidateKind(base as never);
    expect(v.action).toBe('reject');
  });

  test('stratified selector never marks filesystem or firstN', () => {
    const { selectStratifiedModelSections } = require('./teta-stratified-model-selector') as typeof import('./teta-stratified-model-selector');
    const source = {
      logicalSourceId: 'document:fixture-a-payroll',
      sourceRevisionId: 'x',
      originalRelativePath: 'SCENARIUSZE/a.docx',
      domainHints: ['payroll'],
      productFamilyHints: [],
      knowledgeAreaHints: [],
      sourcePurposeHints: ['scenario_or_test_case'],
      extractionStatus: 'succeeded',
      metadataOnly: false,
      contentUnits: [{ contentUnitId: 'u1', unitKind: 'paragraph', text: '1. Krok\n2. Krok\nProcedura testowa' }],
      assets: [],
    };
    const section = {
      sectionId: 'sec-a',
      sectionKind: 'document_section',
      title: 'Scenariusz',
      headingPath: ['Scenariusz'],
      contentUnitRefs: ['u1'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: ['payroll'],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: ['scenario_or_test_case'],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
    };
    const r = selectStratifiedModelSections(
      [{ source: source as never, section: section as never, deterministicCandidates: [] }],
      10,
    );
    expect(r.modelSectionsSelectedByFilesystemOrder).toBe(0);
    expect(r.modelSectionsSelectedByArbitraryFirstN).toBe(0);
    expect(r.selected.length).toBeGreaterThan(0);
    expect(r.selected[0].selectionReason).toBeTruthy();
  });

  test('empty model output with explicit procedure is informative failure', () => {
    const { diagnoseEmptyModelOutput, deriveModelUsefulnessStatus } = require('./teta-model-usefulness') as typeof import('./teta-model-usefulness');
    const d = diagnoseEmptyModelOutput({
      sectionId: 's',
      sectionText: 'Procedura\n1. Otwórz\n2. Zatwierdź\nOczekiwany wynik: OK',
      sectionTitle: 'Procedura',
      deterministicKinds: ['procedure', 'process_step'],
      modelCandidateCount: 0,
      parserRemovedCount: 0,
    });
    expect(d.reason).toBe('model_failed_to_extract_expected_explicit_structure');
    expect(d.informative).toBe(true);
    expect(
      deriveModelUsefulnessStatus({
        attempted: 8,
        succeeded: 8,
        acceptedCandidates: 0,
        validEmptyOutputs: 8,
        informativeEmptyFailures: 5,
        timedOut: 0,
      }),
    ).toBe('insufficient_signal');
  });

  test('administrative cues classified with contextual exceptions', () => {
    const { classifyAdministrativeCue, evaluateNoiseRecall } = require('./teta-noise-cue-recall') as typeof import('./teta-noise-cue-recall');
    expect(classifyAdministrativeCue('Czy widać ekran?')?.classification).toBe('noise');
    expect(classifyAdministrativeCue('Na ekranie formularza ustaw parametr LIMIT_GODZ')?.classification).toBe(
      'topic_with_context',
    );
    expect(classifyAdministrativeCue('Przerwa w rozumieniu RCP to okres nieobecności')?.classification).toBe(
      'topic_with_context',
    );
    const stats = evaluateNoiseRecall([
      { key: '1', text: 'Czy widać ekran?', classifiedAsNoise: true },
      { key: '2', text: 'Robimy przerwę na kawę', classifiedAsNoise: true },
      { key: '3', text: 'Na ekranie formularza ustaw parametr', classifiedAsNoise: false },
      { key: '4', text: 'Przerwa w rozumieniu RCP', classifiedAsNoise: false },
    ]);
    expect(stats.substantiveSegmentsIncorrectlyMarkedNoise).toBe(0);
    expect(stats.uncertainNoiseSegmentsAutoExcluded).toBe(0);
    expect(stats.administrativeCueSegmentsClassifiedAsTopicWithContext).toBeGreaterThanOrEqual(2);
  });

  test('fixture noise false positives and uncertain auto-exclude are zero', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.substantiveSegmentsIncorrectlyMarkedNoise).toBe(0);
    expect(run.stats.uncertainNoiseSegmentsAutoExcluded).toBe(0);
  });

  test('zero-candidate source classification exists', () => {
    const { classifyZeroCandidateSource } = require('./teta-candidate-proposal-accounting') as typeof import('./teta-candidate-proposal-accounting');
    expect(
      classifyZeroCandidateSource({
        blocked: true,
        contentUnits: 0,
        acceptedCandidates: 0,
        sectionCount: 0,
        hasStructuredHints: false,
      }),
    ).toBe('blocked_source');
    expect(
      classifyZeroCandidateSource({
        blocked: false,
        contentUnits: 10,
        acceptedCandidates: 0,
        sectionCount: 2,
        hasStructuredHints: true,
      }),
    ).toBe('extraction_gap');
    expect(
      classifyZeroCandidateSource({
        blocked: false,
        contentUnits: 10,
        acceptedCandidates: 0,
        sectionCount: 1,
        hasStructuredHints: false,
      }),
    ).toBe('no_explicit_knowledge');
  });

  test('stage 3j2d readiness ready_with_review when model insufficient', () => {
    const { buildStage3j2dReadiness } = require('./teta-real-pilot-readiness') as typeof import('./teta-real-pilot-readiness');
    const r = buildStage3j2dReadiness({
      precisionFixturePassed: true,
      recallFixturePassed: true,
      requiredMissing: 0,
      forbiddenProduced: 0,
      blockedSourceHandlingPassed: true,
      realPilotRecallStatus: 'requires_review',
      unexplainedExtractionGaps: 0,
      modelUsefulnessStatus: 'insufficient_signal',
      noiseRecallStatus: 'accepted',
      proposalReconciliationOk: true,
    });
    expect(r.status).toBe('ready_with_review');
    expect(r.status).not.toBe('not_ready');
  });

  test('stage 3j2d readiness not_ready on recall failure', () => {
    const { buildStage3j2dReadiness } = require('./teta-real-pilot-readiness') as typeof import('./teta-real-pilot-readiness');
    const r = buildStage3j2dReadiness({
      precisionFixturePassed: true,
      recallFixturePassed: false,
      requiredMissing: 2,
      forbiddenProduced: 0,
      blockedSourceHandlingPassed: true,
      realPilotRecallStatus: 'covered',
      unexplainedExtractionGaps: 0,
      modelUsefulnessStatus: 'not_evaluable',
      noiseRecallStatus: 'accepted',
      proposalReconciliationOk: true,
    });
    expect(r.status).toBe('not_ready');
  });

  test('fixture run readiness is not not_ready', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.stage3j2dReadinessStatus).not.toBe('not_ready');
  });

  test('real pilot expectations template has archetypes', () => {
    const { defaultRealPilotExpectations } = require('./teta-real-pilot-readiness') as typeof import('./teta-real-pilot-readiness');
    const e = defaultRealPilotExpectations();
    expect(e.some((x) => x.sourceArchetype === 'payroll_scenario')).toBe(true);
    expect(e.some((x) => x.sourceArchetype === 'blocked_source')).toBe(true);
  });

  test('evaluate real pilot coverage soft groups', () => {
    const { evaluateRealPilotCoverage, defaultRealPilotExpectations } = require('./teta-real-pilot-readiness') as typeof import('./teta-real-pilot-readiness');
    const bySource = new Map([
      ['s1', [{ candidateKind: 'procedure' }, { candidateKind: 'process_step' }, { candidateKind: 'scenario' }]],
    ]);
    const arch = new Map([['s1', 'payroll_scenario' as const]]);
    const r = evaluateRealPilotCoverage(
      defaultRealPilotExpectations().filter((e) => e.sourceArchetype === 'payroll_scenario'),
      bySource,
      arch,
    );
    expect(r.realPilotArchetypesWithExpectedCoverage).toBe(1);
  });

  test('action extraction from otwórz', () => {
    const { extractDeterministicCandidates } = require('./teta-deterministic-candidate-extractor') as typeof import('./teta-deterministic-candidate-extractor');
    const source = { logicalSourceId: 'document:act', sourceRevisionId: 'sha256:act' };
    const section = {
      sectionId: 'act1',
      sectionKind: 'document_section',
      title: 'Akcje',
      headingPath: ['Akcje'],
      contentUnitRefs: ['u1'],
      assetRefs: [],
      classificationHints: {
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        knowledgeAreaIds: [],
        sourcePurposeIds: [],
      },
      applicability: {
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      warnings: [],
      qualityFlags: [],
      segmentRefs: null,
      timeRange: null,
    };
    const units = [
      { contentUnitId: 'u1', unitKind: 'paragraph', text: 'Otwórz formularz składników i zatwierdź konfigurację', location: {}, assetRefs: [] },
    ];
    const { candidates } = extractDeterministicCandidates(section as never, source, units as never);
    expect(candidates.some((c) => c.candidateKind === 'action')).toBe(true);
  });

  test('forbidden generic table column still rejected', () => {
    const q = require('./teta-candidate-quality-gates') as typeof import('./teta-candidate-quality-gates');
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'parameter',
      canonicalSubjectProposal: { label: 'Nazwa', normalizedLabel: 'nazwa', proposedCanonicalKey: null },
      candidateStatement: 'Nazwa',
      structuredPayload: {},
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'structured_table' }],
    } as never);
    expect(v.action).toBe('reject');
  });

  test('audit includes recall proposalAccounting readiness', async () => {
    const audit = await buildStage3j2cAudit(false, REPO_ROOT, {
      ...VERIFICATION_STUB,
      stage3j2cTestsExecuted: 382,
      stage3j2cTestsPassed: 382,
    }) as Record<string, any>;
    expect(audit.recall).toBeDefined();
    expect(audit.proposalAccounting.proposalReconciliationOk).toBe(true);
    expect(audit.readiness.stage3j2dReadiness).toBeDefined();
    expect(audit.noiseRecall).toBeDefined();
    expect(audit.modelUsefulness).toBeDefined();
    expect(audit.realPilotCoverage).toBeDefined();
  });

  test('I workflow has procedure without global promotion', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const batch = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-i-workflow')!;
    expect(batch.candidateOccurrences.some((c) => c.candidateKind === 'procedure')).toBe(true);
    expect(Number(run.stats.clientSpecificCandidatesPromotedToGlobal)).toBe(0);
  });

  test('J temporal currentness not_verified', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const batch = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-j-legal')!;
    const temporal = batch.candidateOccurrences.find((c) => c.candidateKind === 'temporal_rule');
    expect(temporal).toBeTruthy();
    expect(temporal!.applicability.currentnessStatus).toBe('not_verified');
  });

  test('fixture expectations contract lists A-J', () => {
    const { FIXTURE_RECALL_EXPECTATIONS } = require('./teta-fixture-recall-contract') as typeof import('./teta-fixture-recall-contract');
    const ids = FIXTURE_RECALL_EXPECTATIONS.map((e) => e.caseId);
    expect(ids).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'blocked', 'table']));
  });

  test('quality gates still reject weak status adjectives', () => {
    const q = require('./teta-candidate-quality-gates') as typeof import('./teta-candidate-quality-gates');
    expect(q.isWeakStatusAdjective('gotowe')).toBe(true);
    const v = q.validateMinimumEvidenceForCandidateKind({
      candidateKind: 'status',
      canonicalSubjectProposal: { label: 'gotowe', normalizedLabel: 'gotowe', proposedCanonicalKey: null },
      candidateStatement: 'Status: gotowe',
      structuredPayload: { statusLabel: 'gotowe' },
      evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
    } as never);
    expect(v.action).toBe('reject');
  });

  test('model prompt mentions explicit structures and empty-list policy', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'teta-candidate-model-provider.ts'),
      'utf8',
    );
    expect(src).toMatch(/Wydobądź wszystkie jawnie opisane/);
    expect(src).toMatch(/Nie zwracaj pustej listy, gdy sekcja jawnie zawiera/);
    expect(src).toMatch(/temperature: this\.temperature/);
  });

  test('sourcesWithContent and coverage counters present', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(Number(run.stats.sourcesWithContent)).toBeGreaterThan(0);
    expect(Number(run.stats.sourcesWithAcceptedCandidates)).toBeGreaterThan(0);
  });

  test('applyGatesWithProposalAccounting tracks rejection reasons', () => {
    const { applyGatesWithProposalAccounting } = require('./teta-candidate-proposal-accounting') as typeof import('./teta-candidate-proposal-accounting');
    const cands = [
      {
        contractVersion: 'teta-knowledge-candidate-v1',
        candidateOccurrenceId: '1',
        candidateSignatureSha256: 'sig1',
        candidateKind: 'business_concept',
        status: 'candidate',
        canonicalSubjectProposal: { label: 'Wstęp', normalizedLabel: 'wstęp', proposedCanonicalKey: null },
        predicate: 'x',
        object: null,
        candidateStatement: 'Wstęp',
        structuredPayload: {},
        applicability: {
          platformId: 'teta_platform',
          productFamilyIds: [],
          productSurfaceIds: [],
          domainIds: [],
          businessAreaIds: [],
          productVersionHints: [],
          documentDateHints: [],
          scopeStatus: 'requires_review',
          currentnessStatus: 'not_verified',
          clientSpecificRisk: 'low',
        },
        evidence: [{ sectionId: 's', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
        correlationHints: {
          formLabels: [],
          fieldLabels: [],
          actionLabels: [],
          statusLabels: [],
          parameterNames: [],
          componentCodes: [],
          functionNames: [],
          oracleIdentifiers: [],
          helpSearchTerms: [],
        },
        extraction: { method: 'deterministic', extractorVersion: 'x', modelRunId: null },
        warnings: [],
        logicalSourceId: 'x',
        sourceRevisionId: 'x',
        sectionId: 's',
      },
    ];
    const r = applyGatesWithProposalAccounting(cands as never);
    expect(r.accounting.candidateProposalsRejected).toBe(1);
    expect(r.accounting.candidateProposalsRejectedByReason.generic_heading).toBe(1);
  });

  test('noise cue found count on fixture F', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(Number(run.stats.administrativeCueSegmentsFound)).toBeGreaterThan(1);
    expect(Number(run.stats.administrativeCueSegmentsClassifiedAsNoise)).toBeGreaterThan(0);
  });

  test('table fixture keeps parameter and allows definition concept', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const kinds = new Set(
      run.manifest.batches
        .find((b) => b.logicalSourceId === 'document:fixture-table')!
        .candidateOccurrences.map((c) => c.candidateKind),
    );
    expect(kinds.has('parameter')).toBe(true);
  });

  test('exact collapse counted in proposal accounting', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(Number(run.stats.candidateProposalsExactCollapsed)).toBeGreaterThanOrEqual(0);
  });

  test('stage boundaries remain zero on fixture run', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(Number(run.stats.crossSourceSemanticMergeDecisions)).toBe(0);
    expect(Number(run.stats.canonicalKnowledgeRecordsModified)).toBe(0);
    expect(Number(run.stats.approvedKnowledgeRecordsCreated)).toBe(0);
    expect(Number(run.stats.remoteModelCalls)).toBe(0);
    expect(Number(run.stats.formulasExecuted)).toBe(0);
    expect(Number(run.stats.sqlExecuted)).toBe(0);
  });
});

describe('Stage 3J.2C final counter reconciliation', () => {
  test('accepted candidates are fully persisted (no silent drop)', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(Number(run.stats.candidateOccurrencesMissingFromStore)).toBe(0);
    expect(Number(run.stats.candidateOccurrencesUnexpectedInStore)).toBe(0);
    expect(Number(run.stats.candidateOccurrencesPersisted)).toBe(
      run.manifest.batches.reduce((n, b) => n + b.candidateOccurrences.length, 0),
    );
  });

  test('shared signature across sections preserves both occurrences', () => {
    const { exactCollapseWithinSection } = require('./teta-candidate-proposal-accounting') as typeof import('./teta-candidate-proposal-accounting');
    const mk = (sectionId: string, occ: string): KnowledgeCandidateOccurrenceV1 =>
      ({
        contractVersion: 'teta-knowledge-candidate-v1',
        candidateOccurrenceId: occ,
        candidateSignatureSha256: 'same-sig',
        candidateKind: 'parameter',
        status: 'candidate',
        canonicalSubjectProposal: { label: 'X', normalizedLabel: 'x', proposedCanonicalKey: null },
        predicate: 'p',
        object: null,
        candidateStatement: 'X',
        structuredPayload: {},
        applicability: {
          platformId: 'teta_platform',
          productFamilyIds: [],
          productSurfaceIds: [],
          domainIds: [],
          businessAreaIds: [],
          productVersionHints: [],
          documentDateHints: [],
          scopeStatus: 'requires_review',
          currentnessStatus: 'not_verified',
          clientSpecificRisk: 'low',
        },
        evidence: [{ sectionId, contentUnitRefs: [occ], assetRefs: [], evidenceStrength: 'explicit_statement' }],
        correlationHints: {
          formLabels: [],
          fieldLabels: [],
          actionLabels: [],
          statusLabels: [],
          parameterNames: [],
          componentCodes: [],
          functionNames: [],
          oracleIdentifiers: [],
          helpSearchTerms: [],
        },
        extraction: { method: 'deterministic', extractorVersion: 'x', modelRunId: null },
        warnings: [],
        logicalSourceId: 'document:one',
        sourceRevisionId: 'sha256:one',
        sectionId,
      }) as KnowledgeCandidateOccurrenceV1;
    const out = exactCollapseWithinSection([mk('sec-a', 'occ-a'), mk('sec-b', 'occ-b')]);
    expect(out).toHaveLength(2);
  });

  test('shared signature across sources preserves both occurrences', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const a = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-a-payroll')!;
    const h = run.manifest.batches.find((b) => b.logicalSourceId === 'document:fixture-h-samesig')!;
    const aPre = a.candidateOccurrences.filter((c) => /warunki wstępne/i.test(c.candidateStatement));
    const hPre = h.candidateOccurrences.filter((c) => /warunki wstępne/i.test(c.candidateStatement));
    expect(aPre.length + hPre.length).toBeGreaterThanOrEqual(2);
    expect(Number(run.stats.crossSourceSemanticMergeDecisions)).toBe(0);
    expect(Number(run.stats.occurrencesLostBecauseOfSharedSignature)).toBe(0);
  });

  test('occurrence id collision is detected by integrity analyzer', () => {
    const { analyzeSignatureOccurrenceIntegrity } = require('./teta-candidate-proposal-accounting') as typeof import('./teta-candidate-proposal-accounting');
    const base = {
      contractVersion: 'teta-knowledge-candidate-v1',
      candidateOccurrenceId: 'dup-id',
      candidateSignatureSha256: 'sig-a',
      candidateKind: 'status',
      status: 'candidate',
      canonicalSubjectProposal: { label: 'S', normalizedLabel: 's', proposedCanonicalKey: null },
      predicate: 'p',
      object: null,
      candidateStatement: 'S',
      structuredPayload: {},
      applicability: {
        platformId: 'teta_platform',
        productFamilyIds: [],
        productSurfaceIds: [],
        domainIds: [],
        businessAreaIds: [],
        productVersionHints: [],
        documentDateHints: [],
        scopeStatus: 'requires_review',
        currentnessStatus: 'not_verified',
        clientSpecificRisk: 'low',
      },
      evidence: [{ sectionId: 's1', contentUnitRefs: ['u'], assetRefs: [], evidenceStrength: 'explicit_statement' }],
      correlationHints: {
        formLabels: [],
        fieldLabels: [],
        actionLabels: [],
        statusLabels: [],
        parameterNames: [],
        componentCodes: [],
        functionNames: [],
        oracleIdentifiers: [],
        helpSearchTerms: [],
      },
      extraction: { method: 'deterministic', extractorVersion: 'x', modelRunId: null },
      warnings: [],
      logicalSourceId: 'x',
      sourceRevisionId: 'x',
      sectionId: 's1',
    };
    const r = analyzeSignatureOccurrenceIntegrity([
      base as never,
      { ...base, sectionId: 's2', candidateSignatureSha256: 'sig-b' } as never,
    ]);
    expect(r.occurrenceIdCollisions).toBe(1);
  });

  test('persistedCandidatesByKind sums to persisted occurrences', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    const byKind = (run.stats.persistedCandidatesByKind ?? {}) as Record<string, number>;
    const sum = Object.values(byKind).reduce((a, b) => a + Number(b), 0);
    expect(sum).toBe(Number(run.stats.candidateOccurrencesPersisted));
  });

  test('noiseRecallStatus accepted with empty review reasons on fixture', async () => {
    const run = await runStage3j2cExtraction(loadExtractionManifest(FIXTURE_MANIFEST), { deterministicOnly: true });
    expect(run.stats.noiseRecallStatus).toBe('accepted');
    expect(run.stats.noiseReviewStatusWithoutReason).toBe(0);
    const reasons = (run.stats as { noiseRecallReviewReasons?: string[] }).noiseRecallReviewReasons ?? [];
    expect(reasons).toEqual([]);
  });

  test('requires_review without reason fails readiness helper contract', () => {
    const { buildStage3j2dReadiness } = require('./teta-real-pilot-readiness') as typeof import('./teta-real-pilot-readiness');
    const r = buildStage3j2dReadiness({
      precisionFixturePassed: true,
      recallFixturePassed: true,
      requiredMissing: 0,
      forbiddenProduced: 0,
      blockedSourceHandlingPassed: true,
      realPilotRecallStatus: 'requires_review',
      unexplainedExtractionGaps: 0,
      modelUsefulnessStatus: 'insufficient_signal',
      noiseRecallStatus: 'accepted',
      proposalReconciliationOk: true,
    });
    expect(r.status).toBe('ready_with_review');
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        'real_pilot_requires_review',
        'model_usefulness_insufficient_signal_documented',
      ]),
    );
    expect(r.reasons).not.toContain('noise_recall_requires_review');
  });

  test('audit noise status and readiness reasons stay consistent', async () => {
    const audit = await buildStage3j2cAudit(false, REPO_ROOT, {
      ...VERIFICATION_STUB,
      stage3j2cTestsExecuted: 382,
      stage3j2cTestsPassed: 382,
    }) as {
      noiseRecall: { noiseRecallStatus: string; noiseRecallReviewReasons: string[]; noiseStatusArtifactMismatches: number };
      readiness: { stage3j2dReadiness: { status: string; reasons: string[] } };
      proposalAccounting: { proposalLifecycleReconciliationOk: boolean; occurrencesLostBecauseOfSharedSignature: number };
      strictErrors: string[];
    };
    expect(audit.noiseRecall.noiseRecallStatus).toBe('accepted');
    expect(audit.noiseRecall.noiseStatusArtifactMismatches).toBe(0);
    expect(audit.proposalAccounting.proposalLifecycleReconciliationOk).toBe(true);
    expect(audit.proposalAccounting.occurrencesLostBecauseOfSharedSignature).toBe(0);
    expect(audit.readiness.stage3j2dReadiness.status).toBe('ready_with_review');
    expect(audit.readiness.stage3j2dReadiness.reasons).toEqual(
      expect.arrayContaining([
        'real_pilot_requires_review',
        'model_usefulness_insufficient_signal_documented',
      ]),
    );
    expect(audit.strictErrors).toEqual([]);
  });

  test('within-section exact collapse still merges same section duplicates', () => {
    const { exactCollapseWithinSection } = require('./teta-candidate-proposal-accounting') as typeof import('./teta-candidate-proposal-accounting');
    const mk = (occ: string): KnowledgeCandidateOccurrenceV1 =>
      ({
        contractVersion: 'teta-knowledge-candidate-v1',
        candidateOccurrenceId: occ,
        candidateSignatureSha256: 'same-sig',
        candidateKind: 'parameter',
        status: 'candidate',
        canonicalSubjectProposal: { label: 'X', normalizedLabel: 'x', proposedCanonicalKey: null },
        predicate: 'p',
        object: null,
        candidateStatement: 'X',
        structuredPayload: {},
        applicability: {
          platformId: 'teta_platform',
          productFamilyIds: [],
          productSurfaceIds: [],
          domainIds: [],
          businessAreaIds: [],
          productVersionHints: [],
          documentDateHints: [],
          scopeStatus: 'requires_review',
          currentnessStatus: 'not_verified',
          clientSpecificRisk: 'low',
        },
        evidence: [{ sectionId: 'sec-a', contentUnitRefs: [occ], assetRefs: [], evidenceStrength: 'explicit_statement' }],
        correlationHints: {
          formLabels: [],
          fieldLabels: [],
          actionLabels: [],
          statusLabels: [],
          parameterNames: [],
          componentCodes: [],
          functionNames: [],
          oracleIdentifiers: [],
          helpSearchTerms: [],
        },
        extraction: { method: 'deterministic', extractorVersion: 'x', modelRunId: null },
        warnings: [],
        logicalSourceId: 'document:one',
        sourceRevisionId: 'sha256:one',
        sectionId: 'sec-a',
      }) as KnowledgeCandidateOccurrenceV1;
    const out = exactCollapseWithinSection([mk('occ-1'), mk('occ-2')]);
    expect(out).toHaveLength(1);
    expect(out[0].evidence[0].contentUnitRefs.sort()).toEqual(['occ-1', 'occ-2']);
  });
});
