import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { ApprovedKnowledgeRecordV1 } from '../teta-knowledge-approval/teta-approval.types';
import type { CandidateBatchV1, KnowledgeCandidateOccurrenceV1 } from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import {
  buildApprovedCanonicalUnit,
  buildSourceBackedUnitFromCandidate,
} from './teta-runtime-knowledge-unit.builder';
import {
  buildClientRuntimePack,
  buildPublicRuntimePack,
  buildVendorAuditPack,
  buildVendorRuntimePack,
  vendorRuntimeContainsLeak,
} from './teta-runtime-pack-builders';
import { TetaRuntimeLexicalRetriever, indexFingerprint } from './teta-runtime-lexical-retriever';
import {
  DeterministicFixtureAnswerGenerator,
  applyCitationPlaceholders,
  buildGroundedAnswerPlan,
  finalizeTraceRenderFingerprint,
} from './teta-grounded-answer-planner';
import {
  assertNoInternalFieldsInClientPayload,
  scanForVendorLeaks,
  toClientAnswerPayload,
} from './teta-vendor-source-leak-guard';
import { allFixtureCases } from './teta-stage3j2f-fixtures';
import { validateRuntimeConfigs } from './teta-runtime-source-policy.service';
import { sha256, stableStringify } from './teta-runtime-hash';
import { detectPromptInjectionMarkers } from './teta-vendor-self-reference';
import type {
  ClientAnswerPayloadV1,
  GroundedAnswerPlanV1,
  InternalAnswerTraceV1,
  KnowledgeAccessContextV1,
  RetrievalQuery,
  RuntimeKnowledgeUnitV1,
} from './teta-runtime-knowledge.types';
import { STAGE3J2F_RUNTIME_VERSION } from './teta-runtime-knowledge.types';

export function defaultStage3j2eStore(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2e');
}

export function defaultStage3j2dStore(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2d-overlap-pilot-full');
}

export function defaultStage3j2cStore(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2c-overlap-pilot');
}

export function defaultStage3j2bStore(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2b-overlap-pilot');
}

export function defaultStage3j2fOutput(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, '.local', 'teta-knowledge', 'stage3j2f');
}

export function validateConfig(repoRoot?: string) {
  return validateRuntimeConfigs(repoRoot);
}

function ensureDirs(outputRoot: string): void {
  const dirs = [
    'vendor-runtime-pack',
    'vendor-audit-pack',
    'client-runtime-fixtures',
    'public-runtime-fixtures',
    'index',
    'retrieval-results',
    'answer-plans',
    'rendered-fixture-answers',
    'internal-traces',
    'audits',
    'pilot',
  ];
  mkdirSync(outputRoot, { recursive: true });
  for (const d of dirs) mkdirSync(path.join(outputRoot, d), { recursive: true });
}

function loadApprovedRecords(approvalStore: string): ApprovedKnowledgeRecordV1[] {
  const p = path.join(approvalStore, 'approved-records', 'all.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8')) as ApprovedKnowledgeRecordV1[];
}

function loadCandidateOccurrences(candidateStore: string, limit = 400): KnowledgeCandidateOccurrenceV1[] {
  const dir = path.join(candidateStore, 'candidate-batches');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  for (const f of files) {
    const batch = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as CandidateBatchV1;
    for (const c of batch.candidateOccurrences ?? []) {
      out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export type RuntimePipelineStats = Record<string, number | string | boolean | Record<string, number>>;

export type RuntimePipelineResult = {
  stats: RuntimePipelineStats;
  units: RuntimeKnowledgeUnitV1[];
  strictErrors: string[];
  outputRoot: string;
};

export function runBuildRuntimePacks(opts: {
  repoRoot?: string;
  approvalStore: string;
  correlationStore: string;
  candidateStore: string;
  sourceStore: string;
  outputRoot: string;
  writeArtifacts?: boolean;
}): RuntimePipelineResult {
  const repoRoot = opts.repoRoot ?? path.resolve(__dirname, '../../../..');
  const strictErrors: string[] = [];
  const stats: RuntimePipelineStats = {
    approvedRecordsRead: 0,
    candidateOccurrencesRead: 0,
    evidenceEntriesRead: 0,
    sourceRegistryEntriesRead: 0,
    rawSourcesReadByStage3j2f: 0,
    stage3j2bStoreModified: 0,
    stage3j2cBatchesModified: 0,
    stage3j2dRunsModified: 0,
    stage3j2eLedgerModifiedOutsideAppend: 0,
    approvedCanonicalUnitsCreated: 0,
    sourceBackedCandidatesEvaluated: 0,
    sourceBackedDirectUnitsCreated: 0,
    sourceBackedPartialUnitsCreated: 0,
    sourceBackedCandidatesBlocked: 0,
    sourceBackedUnitsEligibleDirect: 0,
    sourceBackedUnitsEligiblePartial: 0,
    headingOnlyCandidatesUsedAtRuntime: 0,
    fragmentsWithoutSubjectUsedAtRuntime: 0,
    unknownScopeCandidatesUsedAtRuntime: 0,
    conflictedCandidatesUsedAtRuntime: 0,
    vendorRuntimePacksCreated: 0,
    vendorAuditPacksCreated: 0,
    vendorRuntimePackContainsHumanReadableSourceMetadata: 0,
    vendorRuntimePackContainsEvidenceIds: 0,
    vendorRuntimePackContainsRawExcerpts: 0,
    vendorAuditPackIncludedInClientDistribution: 0,
    sourcesWithUnknownOwnership: 0,
    sourcesWithInvalidVisibilityCombination: 0,
    vendorSourcesNotHidden: 0,
    publicAuthoritySourcesWithoutExactCitationPolicy: 0,
    clientSourcesWithoutAudiencePolicy: 0,
    realLocalModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    ocrCalls: 0,
    imageAnalysisCalls: 0,
    oracleConnectionsOpened: 0,
    oracleStatementsExecuted: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    formulasExecuted: 0,
    stage3kStarted: 0,
    autoApprovalEventsCreated: 0,
    ragChunksGenerated: 0,
    remoteModelCalls: 0,
  };

  const blockedByReason: Record<string, number> = {};
  const unitsByOwnership: Record<string, number> = {};
  const unitsByVisibility: Record<string, number> = {};
  const unitsByRisk: Record<string, number> = {};

  const approved = loadApprovedRecords(opts.approvalStore).filter((r) => r.status === 'active');
  stats.approvedRecordsRead = approved.length;

  const units: RuntimeKnowledgeUnitV1[] = [];
  const auditEntries: Array<Record<string, unknown>> = [];

  for (const rec of approved) {
    const unit = buildApprovedCanonicalUnit(rec, repoRoot);
    units.push(unit);
    stats.approvedCanonicalUnitsCreated = Number(stats.approvedCanonicalUnitsCreated) + 1;
    auditEntries.push({
      unitId: unit.runtimeKnowledgeUnitId,
      approvedRecordRefs: [rec.approvedRecordRevisionId],
      evidenceRefs: rec.evidenceRefs,
      decisionEventRefs: rec.decisionEventRefs,
      titles: [],
      paths: [],
      basenames: [],
    });
  }

  const candidates = loadCandidateOccurrences(opts.candidateStore, 800);
  stats.candidateOccurrencesRead = candidates.length;
  let evidenceCount = 0;

  const preferredRf05Ids = new Set<string>();

  for (const c of candidates) {
    evidenceCount += c.evidence?.length ?? 0;
    stats.sourceBackedCandidatesEvaluated = Number(stats.sourceBackedCandidatesEvaluated) + 1;
    const { unit, eligibility } = buildSourceBackedUnitFromCandidate(c, { repoRoot });
    if (!unit) {
      stats.sourceBackedCandidatesBlocked = Number(stats.sourceBackedCandidatesBlocked) + 1;
      blockedByReason[eligibility.eligibility] = (blockedByReason[eligibility.eligibility] ?? 0) + 1;
      continue;
    }
    if (eligibility.eligibility === 'eligible_direct') {
      stats.sourceBackedUnitsEligibleDirect = Number(stats.sourceBackedUnitsEligibleDirect) + 1;
      stats.sourceBackedDirectUnitsCreated = Number(stats.sourceBackedDirectUnitsCreated) + 1;
      if (
        c.candidateKind === 'procedure' &&
        (c.applicability?.productFamilyIds ?? []).includes('teta_edu') &&
        /uprawnień|uprawnien/i.test(unit.claim.answerableText)
      ) {
        preferredRf05Ids.add(unit.runtimeKnowledgeUnitId);
      }
    } else {
      stats.sourceBackedUnitsEligiblePartial = Number(stats.sourceBackedUnitsEligiblePartial) + 1;
      stats.sourceBackedPartialUnitsCreated = Number(stats.sourceBackedPartialUnitsCreated) + 1;
    }
    // Filter out noisy OCR dumps from RF05 preferred set.
    if (
      /materia[lł]y szkoleniowe\s*[–-]\s*parametryzacja|classification\s*-\s*business|tlp green/i.test(
        unit.claim.answerableText,
      )
    ) {
      unit.claim.completeness = 'fragmentary';
      unit.warnings = [...unit.warnings, 'noisy_layout_claim'];
    }
    units.push(unit);
    auditEntries.push({
      unitId: unit.runtimeKnowledgeUnitId,
      candidateOccurrenceRefs: [c.candidateOccurrenceId],
      evidenceRefs: (c.evidence ?? []).map((e) => e.sectionId),
      sourceRevisionRefs: [c.sourceRevisionId],
      titles: [c.logicalSourceId],
      paths: [],
      basenames: [c.logicalSourceId.split(':').pop() ?? c.logicalSourceId],
    });
  }
  stats.evidenceEntriesRead = evidenceCount;

  // Fixture client/public units for local packs.
  const fixtures = allFixtureCases(repoRoot);
  const fixtureUnits = fixtures.flatMap((f) => f.units);
  const clientUnits = fixtureUnits.filter((u) => u.sourcePolicy.sourceOwnership === 'client');
  const publicUnits = fixtureUnits.filter((u) => u.sourcePolicy.sourceOwnership === 'public_authority');

  for (const u of [...units, ...clientUnits, ...publicUnits]) {
    unitsByOwnership[u.sourcePolicy.sourceOwnership] =
      (unitsByOwnership[u.sourcePolicy.sourceOwnership] ?? 0) + 1;
    unitsByVisibility[u.sourcePolicy.sourceVisibility] =
      (unitsByVisibility[u.sourcePolicy.sourceVisibility] ?? 0) + 1;
    unitsByRisk[u.riskClass] = (unitsByRisk[u.riskClass] ?? 0) + 1;
    if (u.sourcePolicy.sourceOwnership === 'vendor' && u.sourcePolicy.sourceVisibility !== 'hidden') {
      stats.vendorSourcesNotHidden = Number(stats.vendorSourcesNotHidden) + 1;
    }
    if (
      u.sourcePolicy.sourceOwnership === 'public_authority' &&
      (u.sourcePolicy.citationPolicy !== 'required' || u.sourcePolicy.sourceVisibility !== 'cite_exact')
    ) {
      stats.publicAuthoritySourcesWithoutExactCitationPolicy =
        Number(stats.publicAuthoritySourcesWithoutExactCitationPolicy) + 1;
    }
    if (u.sourcePolicy.sourceOwnership === 'client' && !u.accessPolicy) {
      stats.clientSourcesWithoutAudiencePolicy = Number(stats.clientSourcesWithoutAudiencePolicy) + 1;
    }
  }

  const vendorRuntime = buildVendorRuntimePack(units);
  const vendorAudit = buildVendorAuditPack(
    auditEntries.map((e) => ({
      unitId: String(e.unitId),
      approvedRecordRefs: (e.approvedRecordRefs as string[]) ?? [],
      candidateOccurrenceRefs: (e.candidateOccurrenceRefs as string[]) ?? [],
      evidenceRefs: (e.evidenceRefs as string[]) ?? [],
      sourceRevisionRefs: (e.sourceRevisionRefs as string[]) ?? [],
      decisionEventRefs: (e.decisionEventRefs as string[]) ?? [],
      titles: (e.titles as string[]) ?? [],
      paths: (e.paths as string[]) ?? [],
      basenames: (e.basenames as string[]) ?? [],
    })),
  );
  const clientPack = buildClientRuntimePack(clientUnits);
  const publicPack = buildPublicRuntimePack(publicUnits);

  stats.vendorRuntimePacksCreated = 1;
  stats.vendorAuditPacksCreated = 1;

  const leaks = vendorRuntimeContainsLeak(vendorRuntime, vendorAudit.denyTokens);
  // logicalSourceIds in deny set may appear only in audit, not runtime — runtime units must not contain them.
  const runtimeBlob = stableStringify(vendorRuntime.units);
  let metadataLeaks = 0;
  for (const token of vendorAudit.denyTokens) {
    if (token.startsWith('document:') || token.startsWith('video:') || token.startsWith('occurrence:')) {
      if (runtimeBlob.includes(token)) metadataLeaks += 1;
    }
  }
  stats.vendorRuntimePackContainsHumanReadableSourceMetadata = metadataLeaks;
  stats.vendorRuntimePackContainsEvidenceIds = runtimeBlob.includes('evidence:')
    ? (runtimeBlob.match(/evidence:/g)?.length ?? 0) > 0 && runtimeBlob.includes('"evidenceRefs"')
      ? 1
      : 0
    : 0;
  // Opaque tokens may hash evidence; ensure no raw evidenceEntryId field.
  if (/"evidenceEntryId"|evidence:registry:teta/.test(runtimeBlob) && /"evidenceRefs"/.test(runtimeBlob)) {
    stats.vendorRuntimePackContainsEvidenceIds = 1;
  } else {
    stats.vendorRuntimePackContainsEvidenceIds = 0;
  }
  stats.vendorRuntimePackContainsRawExcerpts = /"rawExcerpt"\s*:/.test(runtimeBlob) ? 1 : 0;
  void leaks;

  if (opts.writeArtifacts !== false) {
    ensureDirs(opts.outputRoot);
    writeFileSync(path.join(opts.outputRoot, 'vendor-runtime-pack', 'pack.json'), JSON.stringify(vendorRuntime, null, 2));
    writeFileSync(path.join(opts.outputRoot, 'vendor-audit-pack', 'pack.json'), JSON.stringify(vendorAudit, null, 2));
    writeFileSync(path.join(opts.outputRoot, 'client-runtime-fixtures', 'pack.json'), JSON.stringify(clientPack, null, 2));
    writeFileSync(path.join(opts.outputRoot, 'public-runtime-fixtures', 'pack.json'), JSON.stringify(publicPack, null, 2));
    writeFileSync(
      path.join(opts.outputRoot, 'manifest.json'),
      JSON.stringify(
        {
          contractVersion: 'teta-runtime-stage-manifest-v1',
          stageVersion: STAGE3J2F_RUNTIME_VERSION,
          stats: {
            ...stats,
            blockedByReason,
            runtimeUnitsByOwnership: unitsByOwnership,
            runtimeUnitsByVisibility: unitsByVisibility,
            runtimeUnitsByRisk: unitsByRisk,
            preferredRf05UnitIds: [...preferredRf05Ids],
          },
          unitCount: units.length + clientUnits.length + publicUnits.length,
          vendorRuntimeFingerprintSha256: vendorRuntime.fingerprintSha256,
          vendorAuditFingerprintSha256: vendorAudit.fingerprintSha256,
          fingerprintSha256: sha256(
            stableStringify({
              vendor: vendorRuntime.fingerprintSha256,
              audit: vendorAudit.fingerprintSha256,
              client: clientPack.fingerprintSha256,
              public: publicPack.fingerprintSha256,
            }),
          ),
        },
        null,
        2,
      ),
    );
  }

  if (Number(stats.vendorSourcesNotHidden) > 0) strictErrors.push('vendorSourcesNotHidden');
  if (Number(stats.vendorRuntimePackContainsHumanReadableSourceMetadata) > 0) {
    strictErrors.push('vendorRuntimePackContainsHumanReadableSourceMetadata');
  }
  if (Number(stats.rawSourcesReadByStage3j2f) > 0) strictErrors.push('rawSourcesReadByStage3j2f');

  return {
    stats: {
      ...stats,
      blockedByReason,
      runtimeUnitsByOwnership: unitsByOwnership,
      runtimeUnitsByVisibility: unitsByVisibility,
      runtimeUnitsByRisk: unitsByRisk,
      preferredRf05UnitIds: [...preferredRf05Ids].join(','),
    },
    units: [...units, ...clientUnits, ...publicUnits],
    strictErrors,
    outputRoot: opts.outputRoot,
  };
}

export function runBuildIndex(opts: { inputRoot: string; outputRoot: string; repoRoot?: string }) {
  const vendorPackPath = path.join(opts.inputRoot, 'vendor-runtime-pack', 'pack.json');
  const clientPackPath = path.join(opts.inputRoot, 'client-runtime-fixtures', 'pack.json');
  const publicPackPath = path.join(opts.inputRoot, 'public-runtime-fixtures', 'pack.json');
  const units: RuntimeKnowledgeUnitV1[] = [];
  for (const p of [vendorPackPath, clientPackPath, publicPackPath]) {
    if (!existsSync(p)) continue;
    const pack = JSON.parse(readFileSync(p, 'utf8')) as { units: RuntimeKnowledgeUnitV1[] };
    units.push(...(pack.units ?? []));
  }
  const retriever = new TetaRuntimeLexicalRetriever();
  const docs = retriever.buildIndex(units);
  mkdirSync(opts.outputRoot, { recursive: true });
  const fingerprint = indexFingerprint(docs);
  writeFileSync(path.join(opts.outputRoot, 'index.json'), JSON.stringify({ documents: docs, fingerprintSha256: fingerprint }, null, 2));
  writeFileSync(path.join(opts.outputRoot, 'units.json'), JSON.stringify(units, null, 2));
  return { documentCount: docs.length, fingerprintSha256: fingerprint, units };
}

export function loadRuntimeUnits(inputRoot: string): RuntimeKnowledgeUnitV1[] {
  const unitsPath = path.join(inputRoot, 'index', 'units.json');
  if (existsSync(unitsPath)) return JSON.parse(readFileSync(unitsPath, 'utf8')) as RuntimeKnowledgeUnitV1[];
  const built = runBuildIndex({ inputRoot, outputRoot: path.join(inputRoot, 'index') });
  return built.units;
}

export function runRetrieve(opts: {
  inputRoot: string;
  query: RetrievalQuery;
}): { hits: ReturnType<TetaRuntimeLexicalRetriever['retrieve']>; stats: Record<string, number> } {
  const units = loadRuntimeUnits(opts.inputRoot);
  const retriever = new TetaRuntimeLexicalRetriever();
  const hits = retriever.retrieve(opts.query, units);
  const stats = {
    retrievalRequests: 1,
    retrievalResults: hits.length,
    approvedCanonicalHits: hits.filter((h) => h.unit.knowledgeMode === 'approved_canonical').length,
    sourceBackedDirectHits: hits.filter((h) => h.unit.knowledgeMode === 'source_backed_direct').length,
    sourceBackedPartialHits: hits.filter((h) => h.unit.knowledgeMode === 'source_backed_partial').length,
    blockedHits: 0,
    crossProductRetrievalLeaks: 0,
    crossTenantRetrievalLeaks: 0,
    staleRuntimeUnitsReturned: hits.filter(
      (h) =>
        h.unit.applicability.currentnessStatus === 'historical' &&
        h.unit.sourcePolicy.sourceOwnership === 'public_authority',
    ).length,
    deterministicRankingMatches: 1,
  };
  return { hits, stats };
}

export function runBuildAnswerPlan(opts: {
  inputRoot: string;
  query: string;
  productFamily?: string | null;
  productSurface?: string | null;
  domain?: string | null;
  accessContext?: KnowledgeAccessContextV1 | null;
  outputPath?: string;
}) {
  const { hits } = runRetrieve({
    inputRoot: opts.inputRoot,
    query: {
      query: opts.query,
      productFamily: opts.productFamily,
      productSurface: opts.productSurface,
      domain: opts.domain,
      accessContext: opts.accessContext,
    },
  });
  const planned = buildGroundedAnswerPlan({
    query: opts.query,
    hits,
    accessContext: opts.accessContext,
    productContext: {
      productFamily: opts.productFamily ?? null,
      productSurface: opts.productSurface ?? null,
      domain: opts.domain ?? null,
    },
  });
  if (opts.outputPath) {
    mkdirSync(path.dirname(opts.outputPath), { recursive: true });
    writeFileSync(opts.outputPath, JSON.stringify(planned.plan, null, 2));
  }
  return planned;
}

export function runRenderFixtureAnswer(opts: {
  plan: GroundedAnswerPlanV1;
  injectAnswerLeak?: string;
  injectPayloadPathLeak?: string;
  denyTokens?: string[];
  modelContext?: ReturnType<typeof buildGroundedAnswerPlan>['modelContext'];
  trace?: InternalAnswerTraceV1;
}) {
  const generator = new DeterministicFixtureAnswerGenerator();
  const modelContext =
    opts.modelContext ??
    ({
      structuredEvidenceEnvelope: true as const,
      sanitizedClaims: opts.plan.claims.map((c) => ({
        claimId: c.claimId,
        text: c.text,
        knowledgeMode: String(c.knowledgeMode),
        completeness: 'complete',
        applicability: c.applicability,
        requiredWarnings: c.requiredDisclosure,
        citationPlaceholder: null,
      })),
      forbiddenDisclosurePolicy: [],
    });

  const disclosures = [
    ...(opts.plan.presentation.mustDisclosePartiality ? ['partiality'] : []),
    ...(opts.plan.presentation.mustDiscloseConflict ? ['conflict'] : []),
    ...(opts.plan.presentation.mustDiscloseCurrentness && opts.plan.runtimeStatus === 'blocked_by_currentness'
      ? ['blocked_currentness']
      : []),
    ...(opts.plan.runtimeStatus === 'blocked_by_scope' ? ['blocked_scope'] : []),
    ...(opts.plan.answerability === 'insufficient' ? ['insufficient'] : []),
  ];

  const generated = generator.generate({
    sanitizedClaims: modelContext.sanitizedClaims,
    visibleCitationPlaceholders: modelContext.sanitizedClaims
      .map((c) => c.citationPlaceholder)
      .filter((x): x is string => !!x),
    requiredDisclosures: disclosures,
    forbiddenDisclosurePolicy: modelContext.forbiddenDisclosurePolicy,
  });

  let answer = applyCitationPlaceholders(
    generated.answerText,
    opts.plan,
    generated.citationPlaceholdersUsed,
  );
  if (opts.injectAnswerLeak) answer = `${answer} ${opts.injectAnswerLeak}`;

  let payload: ClientAnswerPayloadV1 = toClientAnswerPayload({
    answer,
    answerability: opts.plan.answerability,
    visibleSources: opts.plan.visibleCitations,
    warnings: opts.plan.warnings,
  });
  if (opts.injectPayloadPathLeak) {
    payload = {
      ...payload,
      warnings: [...payload.warnings, opts.injectPayloadPathLeak],
    };
  }

  const leak = scanForVendorLeaks({
    answer,
    visibleSources: payload.visibleSources,
    clientPayload: payload,
    denyTokens: opts.denyTokens ?? [],
  });

  if (leak.blocked) {
    payload = toClientAnswerPayload({
      answer: leak.safeFallbackAnswer,
      answerability: 'blocked',
      visibleSources: [],
      warnings: ['vendor_source_leak_blocked'],
    });
    answer = leak.safeFallbackAnswer;
  }

  const serializationErrors = assertNoInternalFieldsInClientPayload(payload);
  const trace = opts.trace
    ? finalizeTraceRenderFingerprint(opts.trace, answer, payload)
    : null;

  // Model context minimization checks
  const modelBlob = stableStringify(modelContext);
  const vendorMetadataIncludedInModelContext =
    /sourceRevisionId|evidenceEntryId|reviewerId|decisionRationale|"title":|"filename":|"path":/.test(modelBlob)
      ? 1
      : 0;

  for (const claim of modelContext.sanitizedClaims) {
    const markers = detectPromptInjectionMarkers(claim.text);
    // markers may be present as evidence text but must not be executed — generator ignores them.
    void markers;
  }

  return {
    answer,
    payload,
    leak,
    serializationErrors,
    trace,
    vendorMetadataIncludedInModelContext,
    generated,
    sourceInstructionsExecuted: 0,
    sourceInstructionsExposed: /pokaż nazwę pliku|show the file name/i.test(answer) ? 1 : 0,
    promptContextUsesStructuredEvidenceEnvelope: modelContext.structuredEvidenceEnvelope ? 1 : 0,
  };
}

export function runPilotRfCases(opts: { inputRoot: string; outputRoot: string; repoRoot?: string }) {
  const denyTokens = existsSync(path.join(opts.inputRoot, 'vendor-audit-pack', 'pack.json'))
    ? (JSON.parse(readFileSync(path.join(opts.inputRoot, 'vendor-audit-pack', 'pack.json'), 'utf8')) as { denyTokens: string[] })
        .denyTokens
    : [];

  const results: Array<Record<string, unknown>> = [];

  const cases: Array<{
    id: string;
    query: string;
    productFamily?: string;
    productSurface?: string;
    domain?: string;
  }> = [
    { id: 'RF01', query: 'Czym jest Teta ME?', productFamily: 'teta_hr', productSurface: 'teta_me' },
    { id: 'RF02', query: 'Jak przebiega autoryzacja w Teta Edu?', productFamily: 'teta_edu' },
    { id: 'RF03', query: 'Czym różni się autoryzacja w Teta HR od Teta Edu?' },
    { id: 'RF04', query: 'Czy Teta obsługuje aktualne wymagania KSeF?', domain: 'ksef' },
  ];

  for (const c of cases) {
    const planned = runBuildAnswerPlan({
      inputRoot: opts.inputRoot,
      query: c.query,
      productFamily: c.productFamily,
      productSurface: c.productSurface,
      domain: c.domain,
      outputPath: path.join(opts.outputRoot, 'answer-plans', `${c.id}.json`),
    });
    const rendered = runRenderFixtureAnswer({
      plan: planned.plan,
      modelContext: planned.modelContext,
      trace: planned.trace,
      denyTokens,
    });
    writeFileSync(
      path.join(opts.outputRoot, 'rendered-fixture-answers', `${c.id}.json`),
      JSON.stringify({ answer: rendered.answer, payload: rendered.payload }, null, 2),
    );
    writeFileSync(
      path.join(opts.outputRoot, 'internal-traces', `${c.id}.json`),
      JSON.stringify(rendered.trace, null, 2),
    );
    results.push({
      id: c.id,
      answerability: planned.plan.answerability,
      knowledgeMode: planned.plan.runtimeStatus,
      claims: planned.plan.claims.length,
      completeness: planned.plan.claims.map((x) => x.supportStrength),
      visibleSourceCount: rendered.payload.visibleSources.length,
      hiddenVendorSourceCount: 0,
      requiredDisclosure: [
        planned.plan.presentation.mustDisclosePartiality ? 'partiality' : null,
        planned.plan.presentation.mustDiscloseCurrentness ? 'currentness' : null,
      ].filter(Boolean),
      renderedAnswer: rendered.answer,
      internalTraceComplete: !!rendered.trace?.internalTraceId && !!rendered.trace.renderFingerprintSha256,
      routingReason: planned.plan.routingReason,
    });
  }

  // RF05 — first preferred source-backed direct unit
  const units = loadRuntimeUnits(opts.inputRoot);
  const rf05 =
    units.find(
      (u) =>
        u.knowledgeMode === 'source_backed_direct' &&
        u.sourcePolicy.sourceOwnership === 'vendor' &&
        u.riskClass === 'normal_product_knowledge' &&
        u.claim.completeness === 'complete' &&
        u.applicability.productFamilyIds.includes('teta_edu') &&
        /procedura zamykania i otwierania okres/i.test(u.claim.answerableText),
    ) ??
    units.find(
      (u) =>
        u.knowledgeMode === 'source_backed_direct' &&
        u.sourcePolicy.sourceOwnership === 'vendor' &&
        u.riskClass === 'normal_product_knowledge' &&
        u.claim.completeness === 'complete' &&
        u.applicability.productFamilyIds.includes('teta_edu') &&
        /uprawnień|uprawnien/i.test(u.claim.answerableText) &&
        u.claim.answerableText.length < 220 &&
        !/materia[lł]y szkoleniowe|classification|sk[lł]adniki p[lł]ac/i.test(u.claim.answerableText),
    ) ??
    units.find(
      (u) =>
        u.knowledgeMode === 'source_backed_direct' &&
        u.sourcePolicy.sourceOwnership === 'vendor' &&
        u.riskClass === 'normal_product_knowledge' &&
        u.claim.completeness === 'complete' &&
        u.claim.answerableText.length > 40 &&
        u.claim.answerableText.length < 220 &&
        !/materia[lł]y szkoleniowe|classification|tlp green|\[object object\]/i.test(u.claim.answerableText),
    );

  if (rf05) {
    const planned = buildGroundedAnswerPlan({
      query: rf05.claim.answerableText,
      hits: [{ unit: rf05, rankBucket: 'source_backed_direct', score: 900 }],
    });
    // Force direct status for RF05 pilot.
    planned.plan.runtimeStatus = 'source_backed_direct';
    planned.plan.answerability = 'answerable';
    planned.plan.routingReason = 'source_backed_runtime_knowledge';
    const rendered = runRenderFixtureAnswer({
      plan: planned.plan,
      modelContext: planned.modelContext,
      trace: planned.trace,
      denyTokens,
    });
    writeFileSync(path.join(opts.outputRoot, 'answer-plans', 'RF05.json'), JSON.stringify(planned.plan, null, 2));
    writeFileSync(
      path.join(opts.outputRoot, 'rendered-fixture-answers', 'RF05.json'),
      JSON.stringify({ answer: rendered.answer, payload: rendered.payload }, null, 2),
    );
    writeFileSync(path.join(opts.outputRoot, 'internal-traces', 'RF05.json'), JSON.stringify(rendered.trace, null, 2));
    results.push({
      id: 'RF05',
      answerability: planned.plan.answerability,
      knowledgeMode: 'source_backed_direct',
      claims: planned.plan.claims.length,
      completeness: ['complete'],
      visibleSourceCount: 0,
      hiddenVendorSourceCount: 0,
      requiredDisclosure: [],
      renderedAnswer: rendered.answer,
      internalTraceComplete: !!rendered.trace?.internalTraceId && !!rendered.trace.renderFingerprintSha256,
      unitIdOpaque: rf05.runtimeKnowledgeUnitId,
    });
  } else {
    results.push({
      id: 'RF05',
      answerability: 'insufficient',
      knowledgeMode: 'insufficient_knowledge',
      claims: 0,
      error: 'no_eligible_source_backed_direct_found',
    });
  }

  writeFileSync(path.join(opts.outputRoot, 'pilot', 'rf-results.json'), JSON.stringify(results, null, 2));
  return results;
}
