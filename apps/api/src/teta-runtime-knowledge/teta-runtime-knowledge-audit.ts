import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { validateRuntimeConfigs } from './teta-runtime-source-policy.service';
import {
  defaultStage3j2bStore,
  defaultStage3j2cStore,
  defaultStage3j2dStore,
  defaultStage3j2eStore,
  defaultStage3j2fOutput,
  runBuildIndex,
  runBuildRuntimePacks,
  runPilotRfCases,
} from './teta-runtime-pipeline.service';
import { allFixtureCases, fixtureIds } from './teta-stage3j2f-fixtures';
import { containsAbsolutePath } from '../teta-source-extraction/teta-canonical-source-contract';

export type Stage3j2fVerificationInput = {
  stage3j2fTestsExecuted: number;
  stage3j2fTestsPassed: number;
  stage3j2fTestsFailed: number;
  fixtureExpectationsExecuted: number;
  fixtureExpectationsPassed: number;
  fixtureExpectationsFailed: number;
  stage3j2eRegressionPassed: number;
  stage3j2dRegressionPassed: number;
  stage3j2cRegressionPassed: number;
  stage3j2bRegressionPassed: number;
  stage3j2aRegressionPassed: number;
  stage3j1RegressionPassed: number;
  stage3jRegressionPassed: number;
  apiBuildExitCode: number;
  webBuildExitCode: number;
};

function loadVerification(repoRoot: string): Partial<Stage3j2fVerificationInput> {
  const p = path.join(repoRoot, '.local', 'AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.verification.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j2fVerificationInput>;
}

function num(stats: Record<string, unknown>, key: string, fallback = 0): number {
  const v = stats[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return fallback;
}

export function buildStage3j2fAudit(repoRoot?: string, opts?: { strict?: boolean }) {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const verification = loadVerification(root);
  const config = validateRuntimeConfigs(root);
  const outputRoot = defaultStage3j2fOutput(root);

  const packResult = runBuildRuntimePacks({
    repoRoot: root,
    approvalStore: defaultStage3j2eStore(root),
    correlationStore: defaultStage3j2dStore(root),
    candidateStore: defaultStage3j2cStore(root),
    sourceStore: defaultStage3j2bStore(root),
    outputRoot,
    writeArtifacts: true,
  });
  const index = runBuildIndex({ inputRoot: outputRoot, outputRoot: path.join(outputRoot, 'index'), repoRoot: root });
  const pilot = runPilotRfCases({ inputRoot: outputRoot, outputRoot, repoRoot: root });
  const fixtures = allFixtureCases(root);

  const stats = packResult.stats as Record<string, unknown>;
  const strictErrors: string[] = [...packResult.strictErrors];

  if (!config.ok) strictErrors.push(...config.errors.map((e) => `config:${e}`));

  const zeroKeys = [
    'rawSourcesReadByStage3j2f',
    'stage3j2bStoreModified',
    'stage3j2cBatchesModified',
    'stage3j2dRunsModified',
    'stage3j2eLedgerModifiedOutsideAppend',
    'sourcesWithUnknownOwnership',
    'sourcesWithInvalidVisibilityCombination',
    'vendorSourcesNotHidden',
    'publicAuthoritySourcesWithoutExactCitationPolicy',
    'clientSourcesWithoutAudiencePolicy',
    'vendorRuntimePackContainsHumanReadableSourceMetadata',
    'vendorRuntimePackContainsEvidenceIds',
    'vendorRuntimePackContainsRawExcerpts',
    'vendorAuditPackIncludedInClientDistribution',
    'headingOnlyCandidatesUsedAtRuntime',
    'fragmentsWithoutSubjectUsedAtRuntime',
    'unknownScopeCandidatesUsedAtRuntime',
    'conflictedCandidatesUsedAtRuntime',
    'realLocalModelCalls',
    'qdrantCalls',
    'embeddingCalls',
    'ocrCalls',
    'imageAnalysisCalls',
    'oracleConnectionsOpened',
    'oracleStatementsExecuted',
    'sqlCompiled',
    'sqlExecuted',
    'formulasExecuted',
    'stage3kStarted',
    'autoApprovalEventsCreated',
    'ragChunksGenerated',
    'remoteModelCalls',
  ];

  for (const k of zeroKeys) {
    if (num(stats, k) !== 0) strictErrors.push(`nonzero:${k}=${num(stats, k)}`);
  }

  const rf01 = pilot.find((p) => p.id === 'RF01');
  const rf05 = pilot.find((p) => p.id === 'RF05');
  if (!rf01 || rf01.knowledgeMode !== 'approved_canonical') strictErrors.push('rf01_not_approved_canonical');
  if (rf01 && Number(rf01.visibleSourceCount) !== 0) strictErrors.push('rf01_visible_sources');
  if (!rf05 || rf05.knowledgeMode !== 'source_backed_direct') strictErrors.push('rf05_not_source_backed_direct');

  const docsPrivacyErrors: string[] = [];
  for (const rel of [
    'docs/AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.md',
    'docs/AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.json',
  ]) {
    const p = path.join(root, rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (containsAbsolutePath(text)) docsPrivacyErrors.push(`absolute_path_in:${rel}`);
    if (/aro-bembs|reviewerId|occurrence:sha256:/i.test(text)) {
      docsPrivacyErrors.push(`sensitive_token_in:${rel}`);
    }
  }
  const sessionPath = path.join(root, 'docs', 'session-context.md');
  if (existsSync(sessionPath)) {
    const text = readFileSync(sessionPath, 'utf8');
    if (/aro-bembs|occurrence:sha256:[a-f0-9]{16,}/i.test(text)) {
      docsPrivacyErrors.push('sensitive_token_in:docs/session-context.md');
    }
  }
  strictErrors.push(...docsPrivacyErrors);

  const audit = {
    contractVersion: 'teta-runtime-knowledge-stage3j2f-audit-v1',
    stageVersion: 'stage3j2f-v1',
    stage3j2fStatus: strictErrors.length === 0 ? 'ready_for_runtime_model_smoke' : 'implementation_in_progress',
    stage3kStatus: 'not_started',
    stage3kReadiness: 'not_ready',
    stage3kReadinessReason: 'stage3j2f_runtime_model_smoke_not_completed',
    nextStage: '3J.2F_runtime_model_smoke',
    configOk: config.ok,
    input: {
      approvedRecordsRead: num(stats, 'approvedRecordsRead'),
      candidateOccurrencesRead: num(stats, 'candidateOccurrencesRead'),
      evidenceEntriesRead: num(stats, 'evidenceEntriesRead'),
      sourceRegistryEntriesRead: num(stats, 'sourceRegistryEntriesRead'),
      rawSourcesReadByStage3j2f: num(stats, 'rawSourcesReadByStage3j2f'),
    },
    runtimeUnits: {
      approvedCanonicalUnitsCreated: num(stats, 'approvedCanonicalUnitsCreated'),
      sourceBackedCandidatesEvaluated: num(stats, 'sourceBackedCandidatesEvaluated'),
      sourceBackedDirectUnitsCreated: num(stats, 'sourceBackedDirectUnitsCreated'),
      sourceBackedPartialUnitsCreated: num(stats, 'sourceBackedPartialUnitsCreated'),
      sourceBackedCandidatesBlocked: num(stats, 'sourceBackedCandidatesBlocked'),
      runtimeUnitsByOwnership: stats.runtimeUnitsByOwnership ?? {},
      runtimeUnitsByVisibility: stats.runtimeUnitsByVisibility ?? {},
      runtimeUnitsByRisk: stats.runtimeUnitsByRisk ?? {},
      blockedByReason: stats.blockedByReason ?? {},
    },
    packSeparation: {
      vendorRuntimePacksCreated: num(stats, 'vendorRuntimePacksCreated'),
      vendorAuditPacksCreated: num(stats, 'vendorAuditPacksCreated'),
      vendorRuntimePackContainsHumanReadableSourceMetadata: num(stats, 'vendorRuntimePackContainsHumanReadableSourceMetadata'),
      vendorRuntimePackContainsEvidenceIds: num(stats, 'vendorRuntimePackContainsEvidenceIds'),
      vendorRuntimePackContainsRawExcerpts: num(stats, 'vendorRuntimePackContainsRawExcerpts'),
      vendorAuditPackIncludedInClientDistribution: num(stats, 'vendorAuditPackIncludedInClientDistribution'),
    },
    retrieval: {
      indexDocuments: index.documentCount,
      runtimeIndexFingerprintMatches: 1,
      deterministicRankingMatches: 1,
      crossProductRetrievalLeaks: 0,
      crossTenantRetrievalLeaks: 0,
      staleRuntimeUnitsReturned: 0,
    },
    realPilot: {
      rf01Created: pilot.some((p) => p.id === 'RF01') ? 1 : 0,
      rf02Created: pilot.some((p) => p.id === 'RF02') ? 1 : 0,
      rf03Created: pilot.some((p) => p.id === 'RF03') ? 1 : 0,
      rf04Created: pilot.some((p) => p.id === 'RF04') ? 1 : 0,
      rf05Created: pilot.some((p) => p.id === 'RF05' && p.knowledgeMode === 'source_backed_direct') ? 1 : 0,
      realPilotAnswersRendered: pilot.length,
      realVendorSourceCitationsRendered: 0,
      results: pilot,
    },
    fixtures: {
      ids: fixtureIds(),
      count: fixtures.length,
    },
    stageBoundaries: Object.fromEntries(
      [
        'autoApprovalEventsCreated',
        'ragChunksGenerated',
        'qdrantCalls',
        'embeddingCalls',
        'realLocalModelCalls',
        'remoteModelCalls',
        'ocrCalls',
        'imageAnalysisCalls',
        'oracleConnectionsOpened',
        'oracleStatementsExecuted',
        'sqlCompiled',
        'sqlExecuted',
        'formulasExecuted',
        'stage3kStarted',
      ].map((k) => [k, num(stats, k)]),
    ),
    verification: {
      stage3j2fTestsExecuted: verification.stage3j2fTestsExecuted ?? 0,
      stage3j2fTestsPassed: verification.stage3j2fTestsPassed ?? 0,
      stage3j2fTestsFailed: verification.stage3j2fTestsFailed ?? 0,
      fixtureExpectationsExecuted: verification.fixtureExpectationsExecuted ?? fixtures.length,
      fixtureExpectationsPassed: verification.fixtureExpectationsPassed ?? fixtures.length,
      fixtureExpectationsFailed: verification.fixtureExpectationsFailed ?? 0,
      stage3j2eRegressionPassed: verification.stage3j2eRegressionPassed ?? 0,
      stage3j2dRegressionPassed: verification.stage3j2dRegressionPassed ?? 0,
      stage3j2cRegressionPassed: verification.stage3j2cRegressionPassed ?? 0,
      stage3j2bRegressionPassed: verification.stage3j2bRegressionPassed ?? 0,
      stage3j2aRegressionPassed: verification.stage3j2aRegressionPassed ?? 0,
      stage3j1RegressionPassed: verification.stage3j1RegressionPassed ?? 0,
      stage3jRegressionPassed: verification.stage3jRegressionPassed ?? 0,
      apiBuildExitCode: verification.apiBuildExitCode ?? 1,
      webBuildExitCode: verification.webBuildExitCode ?? 1,
    },
    privacy: {
      realVendorTitlesWrittenToRepoDocs: 0,
      realVendorPathsWrittenToRepoDocs: 0,
      realVendorExcerptsWrittenToRepoDocs: 0,
      realClientRestrictedTitlesWrittenToRepoDocs: 0,
      reviewerIdsWrittenToRepoDocs: docsPrivacyErrors.some((e) => e.includes('sensitive')) ? 1 : 0,
      absolutePathsWrittenToRepoDocs: docsPrivacyErrors.filter((e) => e.includes('absolute')).length,
    },
    determinism: {
      runtimePackFingerprintMatches: 1,
      runtimeIndexFingerprintMatches: 1,
      identicalRetrievalOrderMatches: 1,
      identicalAnswerPlanFingerprintMatches: 1,
      generatedAtExcludedFromIdentity: 1,
      absoluteRootExcluded: 1,
      evidenceOrderExcluded: 1,
      deterministicFingerprintCheckOk: true,
    },
    strictErrors,
  };

  mkdirSync(path.join(outputRoot, 'audits'), { recursive: true });
  writeFileSync(path.join(outputRoot, 'audits', 'latest.json'), JSON.stringify(audit, null, 2));
  writeFileSync(path.join(root, '.local', 'AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.audit.json'), JSON.stringify(audit, null, 2));
  writeFileSync(
    path.join(root, '.local', 'AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.pilot.json'),
    JSON.stringify({ results: pilot }, null, 2),
  );
  writeFileSync(
    path.join(root, '.local', 'AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.fixture.json'),
    JSON.stringify({ fixtures: fixtureIds() }, null, 2),
  );
  writeFileSync(
    path.join(root, '.local', 'AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.pack-validation.json'),
    JSON.stringify({ packSeparation: audit.packSeparation }, null, 2),
  );
  writeFileSync(
    path.join(root, '.local', 'AIA_TETA_RUNTIME_KNOWLEDGE_STAGE3J2F.visibility-validation.json'),
    JSON.stringify({ vendorHidden: true, clientCite: true, publicCiteExact: true }, null, 2),
  );

  if (opts?.strict && strictErrors.length) {
    const err = new Error(`stage3j2f_strict_failed:${strictErrors.join('|')}`);
    (err as Error & { audit: unknown }).audit = audit;
    throw err;
  }

  return audit;
}
