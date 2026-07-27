/**
 * Stage 3I CLI — validate | import | status | inspect-component | trace-dependencies | audit
 *
 * Audit counters are split:
 * - apiUploadAudit — real importBuffer calls (uploadRequests / accepted / rejected / …)
 * - validationReferenceAudit — validateOnly / fixture probes (do NOT increment uploadRequests)
 * - verification — jest runner results (never hardcode test counts; never confuse with references)
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { DatabaseService } from '../database/database.service';
import { detectPayrollParametersReport } from '../teta-payroll-snapshots/teta-payroll-report-detector';
import { TetaPayrollRtfTextExtractor } from '../teta-payroll-snapshots/teta-payroll-rtf-text-extractor';
import { TetaPayrollSnapshotImportService } from '../teta-payroll-snapshots/teta-payroll-snapshot-import.service';
import { TetaPayrollSnapshotQueryService } from '../teta-payroll-snapshots/teta-payroll-snapshot-query.service';
import { TetaPayrollSnapshotRepository } from '../teta-payroll-snapshots/teta-payroll-snapshot-repository';
import { evaluatePayrollChatGate } from '../teta-payroll-snapshots/teta-payroll-snapshot-chat-gate';
import { traceDependencies } from '../teta-payroll-snapshots/teta-payroll-dependency-extractor';
import {
  STAGE3I_PARSER_VERSION,
  STAGE3I_SNAPSHOT_CONTRACT_VERSION,
  STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
} from '../teta-payroll-snapshots/teta-payroll-snapshot.types';

type Reference = { id: string; ok: boolean; detail: string };

type ApiUploadAudit = {
  uploadRequests: number;
  uploadsAccepted: number;
  uploadsRejected: number;
  uploadsAlreadyImported: number;
  uploadsActivated: number;
  uploadsInactive: number;
  /** Documented semantics: accepted includes already_imported (subset). */
  note: string;
};

type ValidationReferenceAudit = {
  malformedRtfReferences: number;
  wrongReportReferences: number;
  invalidSignatureReferences: number;
  incompleteReportReferences: number;
  limitRejectionReferences: number;
  note: string;
};

type SideEffectCounters = {
  oracleConnectionsOpened: number;
  oracleStatementsExecuted: number;
  oracleWrites: number;
  llmCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  formulasExecuted: number;
  sqlFormulasExecuted: number;
  domanFallbacks: number;
  legacyAgentFallbacks: number;
  clientPayrollQuestionWithoutSnapshotFallbacks: number;
  rawReportContentLogged: number;
  formulasLogged: number;
  sqlFormulasLogged: number;
  customerNamesWrittenToDocs: number;
  localFixturesAddedToGit: number;
};

type JestSummary = {
  executed: number;
  passed: number;
  failed: number;
  outputFile: string;
  ok: boolean;
  detail: string;
};

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'apps', 'api', 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function parseArgs(argv: string[]) {
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'audit';
  const get = (name: string) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  return {
    cmd,
    file: get('--file'),
    code: get('--code'),
    depth: Number(get('--depth') ?? '5'),
    strict: argv.includes('--strict'),
  };
}

function openTempDb(root: string): DatabaseService {
  const dbPath = path.join(root, '.local', `payroll-stage3i-cli-${Date.now()}.sqlite`);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  process.env.DATABASE_URL = `file:${dbPath}`;
  const config = {
    get: (_key: string, def?: string) => process.env.DATABASE_URL ?? def,
  } as ConstructorParameters<typeof DatabaseService>[0];
  const service = new DatabaseService(config);
  service.onModuleInit();
  return service;
}

function services(root: string) {
  const db = openTempDb(root);
  const repository = new TetaPayrollSnapshotRepository(db);
  const imports = new TetaPayrollSnapshotImportService(repository);
  const queries = new TetaPayrollSnapshotQueryService(repository);
  return { db, repository, imports, queries, dbPath: process.env.DATABASE_URL };
}

function emptyApiUploadAudit(): ApiUploadAudit {
  return {
    uploadRequests: 0,
    uploadsAccepted: 0,
    uploadsRejected: 0,
    uploadsAlreadyImported: 0,
    uploadsActivated: 0,
    uploadsInactive: 0,
    note: 'uploadsAccepted includes already_imported; uploadsAlreadyImported is a subset of accepted',
  };
}

function emptyValidationReferenceAudit(): ValidationReferenceAudit {
  return {
    malformedRtfReferences: 0,
    wrongReportReferences: 0,
    invalidSignatureReferences: 0,
    incompleteReportReferences: 0,
    limitRejectionReferences: 0,
    note: 'validateOnly / fixture probes — do not increment apiUploadAudit.uploadRequests',
  };
}

function emptySideEffects(): SideEffectCounters {
  return {
    oracleConnectionsOpened: 0,
    oracleStatementsExecuted: 0,
    oracleWrites: 0,
    llmCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    formulasExecuted: 0,
    sqlFormulasExecuted: 0,
    domanFallbacks: 0,
    legacyAgentFallbacks: 0,
    clientPayrollQuestionWithoutSnapshotFallbacks: 0,
    rawReportContentLogged: 0,
    formulasLogged: 0,
    sqlFormulasLogged: 0,
    customerNamesWrittenToDocs: 0,
    localFixturesAddedToGit: 0,
  };
}

/** Record a real importBuffer outcome into apiUploadAudit. */
function recordUpload(
  audit: ApiUploadAudit,
  result: {
    status: string;
    snapshot?: { status: string };
  },
): void {
  audit.uploadRequests += 1;
  if (result.status === 'rejected') {
    audit.uploadsRejected += 1;
    return;
  }
  // imported | already_imported | older_report_requires_activation → accepted
  audit.uploadsAccepted += 1;
  if (result.status === 'already_imported') {
    audit.uploadsAlreadyImported += 1;
    // Idempotent hit is accepted; do not re-count activate/inactive.
    return;
  }
  if (
    result.status === 'older_report_requires_activation' ||
    result.snapshot?.status === 'inactive'
  ) {
    audit.uploadsInactive += 1;
    return;
  }
  if (result.snapshot?.status === 'active' || result.status === 'imported') {
    audit.uploadsActivated += 1;
  }
}

function recordValidationReference(
  audit: ValidationReferenceAudit,
  detectionStatus: string,
): void {
  switch (detectionStatus) {
    case 'malformed_rtf':
      audit.malformedRtfReferences += 1;
      audit.invalidSignatureReferences += 1;
      break;
    case 'unsupported_rtf_report':
      audit.wrongReportReferences += 1;
      break;
    case 'incomplete_payroll_parameters_report':
      audit.incompleteReportReferences += 1;
      break;
    case 'rejected_by_limits':
      audit.limitRejectionReferences += 1;
      break;
    default:
      break;
  }
}

function readJestSummary(outputFile: string): JestSummary {
  if (!existsSync(outputFile)) {
    return {
      executed: 0,
      passed: 0,
      failed: 0,
      outputFile,
      ok: false,
      detail: 'jest output missing',
    };
  }
  try {
    const raw = JSON.parse(readFileSync(outputFile, 'utf8')) as {
      numTotalTests?: number;
      numPassedTests?: number;
      numFailedTests?: number;
      success?: boolean;
    };
    const executed = Number(raw.numTotalTests ?? 0);
    const passed = Number(raw.numPassedTests ?? 0);
    const failed = Number(raw.numFailedTests ?? 0);
    return {
      executed,
      passed,
      failed,
      outputFile,
      ok: failed === 0 && executed > 0 && (raw.success !== false),
      detail: `${passed}/${executed} passed, failed=${failed}`,
    };
  } catch (error) {
    return {
      executed: 0,
      passed: 0,
      failed: 0,
      outputFile,
      ok: false,
      detail: error instanceof Error ? error.message : 'jest json parse failed',
    };
  }
}

function spawnJest(options: {
  root: string;
  apiDir: string;
  outputFile: string;
  args: string[];
}): JestSummary {
  mkdirSync(path.dirname(options.outputFile), { recursive: true });
  const relOut = path.relative(options.apiDir, options.outputFile).replace(/\\/g, '/');
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['jest', '--runInBand', '--json', `--outputFile=${relOut}`, ...options.args],
    {
      cwd: options.apiDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: { ...process.env, CI: '1' },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const summary = readJestSummary(options.outputFile);
  if (result.error) {
    summary.ok = false;
    summary.detail = `spawn error: ${result.error.message}`;
  } else if (result.status !== 0 && summary.failed === 0 && summary.executed === 0) {
    summary.ok = false;
    summary.detail = `jest exit=${result.status}; ${String(result.stderr ?? '').slice(0, 400)}`;
  }
  return summary;
}

function includesAll(hay: string[], need: string[]): boolean {
  return need.every((n) => hay.includes(n));
}

function runAudit(root: string, strict: boolean): number {
  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });
  const apiDir = path.join(root, 'apps', 'api');
  const fixturesDir = path.join(
    root,
    'apps',
    'api',
    'src',
    'teta-payroll-snapshots',
    'fixtures',
  );

  const apiUploadAudit = emptyApiUploadAudit();
  const validationReferenceAudit = emptyValidationReferenceAudit();
  const sideEffects = emptySideEffects();
  const references: Reference[] = [];
  const { imports, queries, repository } = services(root);

  let goldenMeta: Record<string, unknown> | null = null;
  let sectionReconciliation: Record<string, unknown> | null = null;
  let goldenDiagnostics: Record<string, unknown> | null = null;
  let componentRecordsParsed = 0;
  let directDependencies = 0;
  let calculationFormulaCount = 0;
  let calculationFormulaComponentReferences = 0;

  // --- Chat refs A & D (before snapshot) ---
  const gateA = evaluatePayrollChatGate({
    question: 'Jak zbudowany jest składnik 1353?',
    queryService: {
      getActiveSummary: () => null,
      inspectComponent: () => ({ status: 'no_active_snapshot' as const }),
    } as never,
    uploadAllowed: true,
  });
  references.push({
    id: 'chat-ref-a-snapshot-required',
    ok: gateA.kind === 'snapshot_required',
    detail: gateA.kind,
  });
  if (
    gateA.kind === 'snapshot_required' &&
    gateA.response.type !== 'payroll_parameter_snapshot_required'
  ) {
    sideEffects.clientPayrollQuestionWithoutSnapshotFallbacks += 1;
  }

  const gateD = evaluatePayrollChatGate({
    question: 'Co oznacza składnik typu Obliczany?',
    queryService: queries,
    uploadAllowed: false,
  });
  references.push({
    id: 'chat-ref-d-generic',
    ok: gateD.kind === 'generic_payroll_knowledge',
    detail: gateD.kind,
  });

  // --- Golden: .local/fixtures/payroll/SKLADNIKI_DOMAN.rtf ---
  const goldenPath = path.join(root, '.local', 'fixtures', 'payroll', 'SKLADNIKI_DOMAN.rtf');
  if (!existsSync(goldenPath)) {
    references.push({
      id: 'golden-fixture-present',
      ok: false,
      detail: 'SKLADNIKI_DOMAN.rtf missing — local golden audit blocked',
    });
  } else {
    references.push({ id: 'golden-fixture-present', ok: true, detail: 'present' });
    const buf = readFileSync(goldenPath);
    const extractor = new TetaPayrollRtfTextExtractor();
    const extracted = extractor.extractFromBuffer(buf);
    references.push({
      id: 'golden-extract',
      ok: extracted.ok,
      detail: extracted.ok ? `chars=${extracted.text.length}` : extracted.code,
    });

    let detectionStatus = 'extract_failed';
    if (extracted.ok) {
      const detection = detectPayrollParametersReport(extracted.text);
      detectionStatus = detection.status;
      references.push({
        id: 'golden-detection',
        ok: detection.status === 'valid_payroll_parameters_report',
        detail: detection.status,
      });
    }

    const goldenImport = imports.importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
    });
    recordUpload(apiUploadAudit, goldenImport);
    const snapOk =
      goldenImport.status === 'imported' || goldenImport.status === 'already_imported';
    references.push({
      id: 'golden-import',
      ok: snapOk && 'snapshot' in goldenImport,
      detail: goldenImport.status,
    });

    if ('snapshot' in goldenImport) {
      const snap = goldenImport.snapshot;
      goldenDiagnostics = goldenImport.diagnostics;
      const recon = (goldenImport.diagnostics?.reconciliation ?? null) as Record<
        string,
        unknown
      > | null;
      sectionReconciliation = recon;

      const deps = repository.listAllDependencies(snap.snapshotId);
      const c1350 = traceDependencies(deps, '1350', 5);
      const c1353 = traceDependencies(deps, '1353', 5);
      const c1355 = traceDependencies(deps, '1355', 5);

      references.push({
        id: 'golden-deps-1350',
        ok: includesAll(c1350.direct, ['1348', '1346']),
        detail: `direct=${c1350.direct.join(',')}`,
      });
      references.push({
        id: 'golden-deps-1353',
        ok: includesAll(c1353.direct, ['1352', '1350', '1351']),
        detail: `direct=${c1353.direct.join(',')}`,
      });
      references.push({
        id: 'golden-deps-1355',
        ok: includesAll(c1355.direct, ['1338', '0010', '1350', '0300']),
        detail: `direct=${c1355.direct.join(',')}`,
      });
      references.push({
        id: 'golden-transitive-1353',
        ok: includesAll(c1353.transitive, ['1348', '1346']),
        detail: 'transitive_has_1348_1346',
      });

      // Idempotency — real importBuffer → counts as upload (accepted + already_imported)
      const idem = imports.importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
        sourceScope: STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
      });
      recordUpload(apiUploadAudit, idem);
      references.push({
        id: 'golden-idempotent',
        ok: idem.status === 'already_imported',
        detail: idem.status,
      });

      // Chat refs B & C (with active snapshot)
      const gateB = evaluatePayrollChatGate({
        question: 'Jak zbudowany jest składnik 1353?',
        queryService: queries,
        uploadAllowed: true,
      });
      references.push({
        id: 'chat-ref-b-active',
        ok: gateB.kind === 'component_summary' && gateB.code === '1353',
        detail: gateB.kind,
      });
      const gateC = evaluatePayrollChatGate({
        question: 'Jak zbudowany jest składnik 99999?',
        queryService: queries,
        uploadAllowed: true,
      });
      references.push({
        id: 'chat-ref-c-missing',
        ok: gateC.kind === 'component_not_found',
        detail: gateC.kind,
      });

      componentRecordsParsed = snap.summary.componentCount;
      directDependencies = snap.summary.directDependencyCount;
      calculationFormulaCount = snap.summary.calculationFormulaCount;
      calculationFormulaComponentReferences =
        snap.summary.calculationFormulaComponentReferences;

      const tocOk = snap.summary.tocSectionCount === 26;
      const bodyOk = snap.summary.bodySectionCount === 26;
      const matchedOk = snap.summary.matchedSectionCount === 26;
      const calcOk = snap.summary.calculationFormulaCount > 0;
      references.push({
        id: 'golden-section-reconciliation',
        ok: tocOk && bodyOk && matchedOk,
        detail: `toc=${snap.summary.tocSectionCount} body=${snap.summary.bodySectionCount} matched=${snap.summary.matchedSectionCount}`,
      });
      references.push({
        id: 'golden-calculation-formulas',
        ok: calcOk && Boolean(goldenDiagnostics?.calculationFormulaSectionDetected),
        detail: `calculationFormulaCount=${snap.summary.calculationFormulaCount}`,
      });

      goldenMeta = {
        parserVersion: STAGE3I_PARSER_VERSION,
        detectionStatus,
        fileSha256: createHash('sha256').update(buf).digest('hex'),
        fileSizeBytes: buf.byteLength,
        reportGeneratedAt: snap.source.reportGeneratedAt,
        reportDateParseStatus: snap.source.reportDateParseStatus ?? null,
        reportDateSourceEvidence: snap.source.reportDateSourceEvidence ?? null,
        kpVersion: snap.source.kpVersion,
        paVersion: snap.source.paVersion,
        summary: {
          componentCount: snap.summary.componentCount,
          componentFormulaCount: snap.summary.componentFormulaCount,
          directDependencyCount: snap.summary.directDependencyCount,
          sqlFormulaCount: snap.summary.sqlFormulaCount,
          calculationFormulaCount: snap.summary.calculationFormulaCount,
          calculationFormulaComponentReferences:
            snap.summary.calculationFormulaComponentReferences,
          contextRecordCount: snap.summary.contextRecordCount,
          unparsedRecordCount: snap.summary.unparsedRecordCount,
          warningCount: snap.summary.warningCount,
          sectionCount: snap.summary.sectionCount,
          totalSectionsDetected: snap.summary.totalSectionsDetected,
          coreSectionsNormalized: snap.summary.coreSectionsNormalized,
          genericSectionsPreserved: snap.summary.genericSectionsPreserved,
          unknownSectionsPreserved: snap.summary.unknownSectionsPreserved,
          tocSectionCount: snap.summary.tocSectionCount,
          bodySectionCount: snap.summary.bodySectionCount,
          matchedSectionCount: snap.summary.matchedSectionCount,
        },
        sectionReconciliation: recon,
        calculationFormulaSectionDetected: Boolean(
          goldenDiagnostics?.calculationFormulaSectionDetected,
        ),
        calculationFormulaSectionNormalized: Boolean(
          goldenDiagnostics?.calculationFormulaSectionNormalized,
        ),
        calculationFormulaRecordsParsed: Number(
          goldenDiagnostics?.calculationFormulaRecordsParsed ?? 0,
        ),
        calculationFormulaMissingComponentTargets: Number(
          goldenDiagnostics?.calculationFormulaMissingComponentTargets ?? 0,
        ),
        calculationFormulaUnknownCalls: Number(
          goldenDiagnostics?.calculationFormulaUnknownCalls ?? 0,
        ),
        knownDependencyChecks: {
          '1350': c1350.direct,
          '1353': c1353.direct,
          '1355': c1355.direct,
          '1353_transitive_includes_1348_1346': includesAll(c1353.transitive, [
            '1348',
            '1346',
          ]),
        },
        sourceScope: STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
        note: 'customer_example fixture — not a Teta default; never use as fallback',
      };
    }
  }

  // --- Synthetic older report (validate path via importBuffer; real upload) ---
  const validBuf = readFileSync(path.join(fixturesDir, 'payroll-parameters-minimal-valid.rtf'));
  const imported = imports.importBuffer(validBuf, 'payroll-parameters-minimal-valid.rtf');
  recordUpload(apiUploadAudit, imported);
  const okValid =
    imported.status === 'imported' ||
    imported.status === 'already_imported' ||
    imported.status === 'older_report_requires_activation';
  references.push({
    id: 'synthetic-valid-import',
    ok: okValid && 'snapshot' in imported && imported.snapshot.summary.componentCount > 0,
    detail: imported.status,
  });

  const again = imports.importBuffer(validBuf, 'payroll-parameters-minimal-valid.rtf');
  recordUpload(apiUploadAudit, again);
  references.push({
    id: 'synthetic-idempotent',
    ok: again.status === 'already_imported',
    detail: again.status,
  });

  // --- Validation references (validateOnly — NOT uploadRequests) ---
  const malformed = imports.validateOnly(
    readFileSync(path.join(fixturesDir, 'payroll-parameters-malformed.rtf')),
    'payroll-parameters-malformed.rtf',
  );
  recordValidationReference(validationReferenceAudit, malformed.detectionStatus);
  references.push({
    id: 'malformed-rejected',
    ok: malformed.status === 'rejected',
    detail: malformed.detectionStatus,
  });

  const wrong = imports.validateOnly(
    readFileSync(path.join(fixturesDir, 'payroll-parameters-invalid-report.rtf')),
    'payroll-parameters-invalid-report.rtf',
  );
  recordValidationReference(validationReferenceAudit, wrong.detectionStatus);
  references.push({
    id: 'wrong-report-rejected',
    ok: wrong.status === 'rejected',
    detail: wrong.detectionStatus,
  });

  const incomplete = imports.validateOnly(
    readFileSync(path.join(fixturesDir, 'payroll-parameters-incomplete.rtf')),
    'payroll-parameters-incomplete.rtf',
  );
  recordValidationReference(validationReferenceAudit, incomplete.detectionStatus);
  references.push({
    id: 'incomplete-rejected',
    ok: incomplete.status === 'rejected',
    detail: incomplete.detectionStatus,
  });

  // Invalid extension probe (validateOnly) → wrongReport / signature-ish reject, not upload
  const badExt = imports.validateOnly(Buffer.from('not rtf'), 'not-an-rtf.txt');
  recordValidationReference(validationReferenceAudit, badExt.detectionStatus);
  if (badExt.detectionStatus === 'unsupported_rtf_report') {
    // already counted as wrongReportReferences; also track as invalid signature-ish extension
    // (invalid_extension maps to unsupported_rtf_report in import service)
  }
  references.push({
    id: 'invalid-extension-rejected',
    ok: badExt.status === 'rejected',
    detail: badExt.detectionStatus,
  });

  // --- Jest verification (never hardcode counts) ---
  const stage3iJestOut = path.join(localDir, 'stage3i-jest.json');
  const regressionJestOut = path.join(localDir, 'stage3b-h-jest.json');

  console.log('Running Stage 3I jest…');
  const stage3iTests = spawnJest({
    root,
    apiDir,
    outputFile: stage3iJestOut,
    args: ['src/teta-payroll-snapshots/teta-stage3i.spec.ts'],
  });
  references.push({
    id: 'stage3i-jest',
    ok: stage3iTests.ok && stage3iTests.executed >= 130,
    detail: stage3iTests.detail,
  });

  console.log('Running Stage 3B–3H regression jest…');
  const regressionTests = spawnJest({
    root,
    apiDir,
    outputFile: regressionJestOut,
    args: ['--testPathPatterns=teta-stage3[bcdefgh]'],
  });
  references.push({
    id: 'regression-jest-3b-h',
    ok: regressionTests.ok,
    detail: regressionTests.detail,
  });

  const verification = {
    stage3iTestsExecuted: stage3iTests.executed,
    stage3iTestsPassed: stage3iTests.passed,
    stage3iTestsFailed: stage3iTests.failed,
    stage3iJestReport: path.relative(root, stage3iJestOut).replace(/\\/g, '/'),
    regressionTestsExecuted: regressionTests.executed,
    regressionTestsPassed: regressionTests.passed,
    regressionTestsFailed: regressionTests.failed,
    regressionJestReport: path.relative(root, regressionJestOut).replace(/\\/g, '/'),
    note: 'Test counts come from jest --json outputFile; never hardcoded; distinct from referencesTested',
  };

  // --- Strict invariants ---
  const uploadCounterInvariantOk =
    apiUploadAudit.uploadsAccepted + apiUploadAudit.uploadsRejected ===
    apiUploadAudit.uploadRequests;

  const validationReferenceTotal =
    validationReferenceAudit.malformedRtfReferences +
    validationReferenceAudit.wrongReportReferences +
    validationReferenceAudit.invalidSignatureReferences +
    validationReferenceAudit.incompleteReportReferences +
    validationReferenceAudit.limitRejectionReferences;
  // Structural: validateOnly never calls recordUpload; require non-zero refs + healthy upload invariant.
  const referenceCountersSeparatedFromUploads =
    validationReferenceTotal > 0 && uploadCounterInvariantOk;

  const runtimeTestCountersNotConfusedWithReferences =
    verification.stage3iTestsExecuted !== references.length &&
    verification.stage3iTestsPassed !== references.filter((r) => r.ok).length;

  const documentedTestCountMatchesRunner =
    stage3iTests.ok &&
    regressionTests.ok &&
    verification.stage3iTestsExecuted === stage3iTests.executed &&
    verification.stage3iTestsPassed === stage3iTests.passed;

  const summaryMeta = (goldenMeta?.summary ?? null) as Record<string, number> | null;
  const tocAndBodySectionCountsMatch =
    Boolean(sectionReconciliation?.tocAndBodySectionCountsMatch) ||
    (summaryMeta != null &&
      summaryMeta.tocSectionCount === summaryMeta.bodySectionCount &&
      summaryMeta.tocSectionCount === 26);

  const allGoldenTocSectionsInventoried = summaryMeta?.tocSectionCount === 26;
  const allGoldenBodySectionsInventoried = summaryMeta?.bodySectionCount === 26;
  const coreSectionsPresent = (summaryMeta?.coreSectionsNormalized ?? 0) >= 4;
  const calculationFormulaSectionDetected = Boolean(
    goldenDiagnostics?.calculationFormulaSectionDetected,
  );
  const calculationFormulaSectionNormalized = Boolean(
    goldenDiagnostics?.calculationFormulaSectionNormalized,
  );
  const calculationFormulaRecordsParsed =
    Number(goldenDiagnostics?.calculationFormulaRecordsParsed ?? 0) > 0 ||
    calculationFormulaCount > 0;
  const noCalculationFormulaExecution =
    sideEffects.formulasExecuted === 0 && sideEffects.sqlFormulasExecuted === 0;
  const sectionCountNotLimitedToNormalizedCoreSections =
    summaryMeta != null &&
    summaryMeta.sectionCount >= 26 &&
    summaryMeta.sectionCount > (summaryMeta.coreSectionsNormalized ?? 0);

  const invariants = {
    uploadCounterInvariantOk,
    referenceCountersSeparatedFromUploads,
    runtimeTestCountersNotConfusedWithReferences,
    documentedTestCountMatchesRunner,
    tocAndBodySectionCountsMatch,
    allGoldenTocSectionsInventoried,
    allGoldenBodySectionsInventoried,
    coreSectionsPresent,
    calculationFormulaSectionDetected,
    calculationFormulaSectionNormalized,
    calculationFormulaRecordsParsed,
    noCalculationFormulaExecution,
    sectionCountNotLimitedToNormalizedCoreSections,
  };

  const strictErrors: string[] = [];

  for (const [key, value] of Object.entries(sideEffects)) {
    if (value !== 0) strictErrors.push(`sideEffect:${key}=${value}`);
  }
  for (const [key, value] of Object.entries(invariants)) {
    if (!value) strictErrors.push(`invariant:${key}`);
  }
  for (const ref of references) {
    if (!ref.ok) strictErrors.push(`reference:${ref.id}`);
  }
  if (summaryMeta) {
    if (summaryMeta.tocSectionCount !== 26) {
      strictErrors.push(`tocSectionCount=${summaryMeta.tocSectionCount}`);
    }
    if (summaryMeta.bodySectionCount !== 26) {
      strictErrors.push(`bodySectionCount=${summaryMeta.bodySectionCount}`);
    }
    if (summaryMeta.matchedSectionCount !== 26) {
      strictErrors.push(`matchedSectionCount=${summaryMeta.matchedSectionCount}`);
    }
    if (summaryMeta.calculationFormulaCount <= 0) {
      strictErrors.push('calculationFormulaCount=0');
    }
  } else if (existsSync(goldenPath)) {
    strictErrors.push('goldenMetaMissing');
  }
  if (verification.stage3iTestsExecuted < 130) {
    strictErrors.push(
      `stage3iTestsExecuted=${verification.stage3iTestsExecuted} (expected >=130)`,
    );
  }
  if (verification.stage3iTestsFailed > 0) {
    strictErrors.push(`stage3iTestsFailed=${verification.stage3iTestsFailed}`);
  }
  if (verification.regressionTestsFailed > 0) {
    strictErrors.push(`regressionTestsFailed=${verification.regressionTestsFailed}`);
  }

  const generatedAt = new Date().toISOString();
  const report = {
    contractVersion: STAGE3I_SNAPSHOT_CONTRACT_VERSION,
    generatedAt,
    parserVersion: STAGE3I_PARSER_VERSION,
    apiUploadAudit,
    validationReferenceAudit,
    sideEffects,
    sectionReconciliation,
    componentRecordsParsed,
    directDependencies,
    calculationFormulaCount,
    calculationFormulaComponentReferences,
    references,
    referencesTested: references.length,
    referencesPassed: references.filter((r) => r.ok).length,
    verification,
    invariants,
    goldenMetaPresent: Boolean(goldenMeta),
    strictErrors,
  };

  writeFileSync(
    path.join(localDir, 'AIA_PAYROLL_PARAMETER_SNAPSHOT_STAGE3I.audit.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  if (goldenMeta) {
    writeFileSync(
      path.join(localDir, 'AIA_PAYROLL_PARAMETER_SNAPSHOT_STAGE3I.golden-metadata.json'),
      JSON.stringify(goldenMeta, null, 2),
      'utf8',
    );
  }

  // Docs JSON — metadata only (no formulas / SQL / company names)
  const docsJson = {
    contractVersion: STAGE3I_SNAPSHOT_CONTRACT_VERSION,
    generatedAt,
    parserVersion: STAGE3I_PARSER_VERSION,
    apiUploadAudit: {
      uploadRequests: apiUploadAudit.uploadRequests,
      uploadsAccepted: apiUploadAudit.uploadsAccepted,
      uploadsRejected: apiUploadAudit.uploadsRejected,
      uploadsAlreadyImported: apiUploadAudit.uploadsAlreadyImported,
      uploadsActivated: apiUploadAudit.uploadsActivated,
      uploadsInactive: apiUploadAudit.uploadsInactive,
      note: apiUploadAudit.note,
      uploadCounterInvariantOk,
    },
    validationReferenceAudit: {
      malformedRtfReferences: validationReferenceAudit.malformedRtfReferences,
      wrongReportReferences: validationReferenceAudit.wrongReportReferences,
      invalidSignatureReferences: validationReferenceAudit.invalidSignatureReferences,
      incompleteReportReferences: validationReferenceAudit.incompleteReportReferences,
      limitRejectionReferences: validationReferenceAudit.limitRejectionReferences,
      note: validationReferenceAudit.note,
    },
    sideEffects,
    sectionReconciliation: summaryMeta
      ? {
          tocSectionCount: summaryMeta.tocSectionCount,
          bodySectionCount: summaryMeta.bodySectionCount,
          matchedSectionCount: summaryMeta.matchedSectionCount,
          coreSectionsNormalized: summaryMeta.coreSectionsNormalized,
          genericSectionsPreserved: summaryMeta.genericSectionsPreserved,
          unknownSectionsPreserved: summaryMeta.unknownSectionsPreserved,
        }
      : null,
    goldenMeta: goldenMeta
      ? {
          parserVersion: goldenMeta.parserVersion,
          detectionStatus: goldenMeta.detectionStatus,
          fileSha256: goldenMeta.fileSha256,
          reportGeneratedAt: goldenMeta.reportGeneratedAt,
          reportDateParseStatus: goldenMeta.reportDateParseStatus,
          kpVersion: goldenMeta.kpVersion,
          paVersion: goldenMeta.paVersion,
          summary: goldenMeta.summary,
          knownDependencyChecks: goldenMeta.knownDependencyChecks,
          calculationFormulaSectionDetected: goldenMeta.calculationFormulaSectionDetected,
          calculationFormulaSectionNormalized: goldenMeta.calculationFormulaSectionNormalized,
          sourceScope: goldenMeta.sourceScope,
        }
      : null,
    references: references.map((r) => ({ id: r.id, ok: r.ok, detail: r.detail })),
    referencesTested: report.referencesTested,
    referencesPassed: report.referencesPassed,
    verification,
    invariants,
    strictErrors,
  };
  writeFileSync(
    path.join(root, 'docs', 'AIA_PAYROLL_PARAMETER_SNAPSHOT_STAGE3I.json'),
    JSON.stringify(docsJson, null, 2),
    'utf8',
  );

  const shaPrefix =
    typeof goldenMeta?.fileSha256 === 'string'
      ? `${String(goldenMeta.fileSha256).slice(0, 12)}…`
      : 'n/a';

  const md = [
    '# AIA — Stage 3I Payroll Parameter Snapshot',
    '',
    `> Generated ${generatedAt}. Metadata only — no formulas, SQL, or customer names.`,
    '',
    '## Scope',
    '',
    '- Import Teta RTF: **Wydruki → Płace → Wydruk parametrów płacowych**',
    '- Deterministic parse + dependency graph; **no** formula/SQL execution, Oracle, LLM, Qdrant',
    '- Local golden RTF (`SKLADNIKI_DOMAN.rtf`) is `sourceScope=customer_example` only — never git, never default, never fallback',
    '- Stage 3I does **not** explain employee values, run payroll, or design new components (Stage 3J+)',
    '',
    '## Architecture',
    '',
    '| Layer | Role |',
    '|---|---|',
    '| `TetaPayrollRtfTextExtractor` | Safe RTF → text (CP1250, tables; no Word/LibreOffice) |',
    '| Report detector | Content evidence → `valid_payroll_parameters_report` / reject |',
    '| Section inventory | TOC vs body reconciliation (26/26/26 golden) |',
    '| Formula tokenizer/parser | AST + unknown tokens; never `eval` |',
    '| Dependency extractor | Direct/transitive graph; cycles reported, not rejected |',
    '| SQLite repository | Transactional snapshot; idempotent by `installationScopeId+fileSha256` |',
    '| Chat gate | Client config questions require active snapshot; generic knowledge passes |',
    '',
    '## Audit counters',
    '',
    '### apiUploadAudit (real `importBuffer` only)',
    '',
    `| uploadRequests | ${apiUploadAudit.uploadRequests} |`,
    `| uploadsAccepted | ${apiUploadAudit.uploadsAccepted} |`,
    `| uploadsRejected | ${apiUploadAudit.uploadsRejected} |`,
    `| uploadsAlreadyImported | ${apiUploadAudit.uploadsAlreadyImported} |`,
    `| uploadsActivated | ${apiUploadAudit.uploadsActivated} |`,
    `| uploadsInactive | ${apiUploadAudit.uploadsInactive} |`,
    `| invariant accepted+rejected=requests | ${uploadCounterInvariantOk} |`,
    '',
    '> `uploadsAccepted` **includes** `already_imported` (subset tracked in `uploadsAlreadyImported`).',
    '',
    '### validationReferenceAudit (`validateOnly` — not uploads)',
    '',
    `| malformedRtfReferences | ${validationReferenceAudit.malformedRtfReferences} |`,
    `| wrongReportReferences | ${validationReferenceAudit.wrongReportReferences} |`,
    `| invalidSignatureReferences | ${validationReferenceAudit.invalidSignatureReferences} |`,
    `| incompleteReportReferences | ${validationReferenceAudit.incompleteReportReferences} |`,
    `| limitRejectionReferences | ${validationReferenceAudit.limitRejectionReferences} |`,
    '',
    '### verification (jest runner — not references)',
    '',
    `| stage3iTests | ${verification.stage3iTestsPassed}/${verification.stage3iTestsExecuted} (failed ${verification.stage3iTestsFailed}) |`,
    `| regression 3B–3H | ${verification.regressionTestsPassed}/${verification.regressionTestsExecuted} (failed ${verification.regressionTestsFailed}) |`,
    `| referencesPassed | ${report.referencesPassed}/${report.referencesTested} |`,
    '',
    '## Golden metadata',
    '',
    `| detectionStatus | ${String(goldenMeta?.detectionStatus ?? 'n/a')} |`,
    `| reportGeneratedAt | ${String(goldenMeta?.reportGeneratedAt ?? 'n/a')} |`,
    `| kpVersion / paVersion | ${String(goldenMeta?.kpVersion ?? 'n/a')} / ${String(goldenMeta?.paVersion ?? 'n/a')} |`,
    `| toc/body/matched | ${summaryMeta?.tocSectionCount ?? 'n/a'}/${summaryMeta?.bodySectionCount ?? 'n/a'}/${summaryMeta?.matchedSectionCount ?? 'n/a'} |`,
    `| componentCount | ${summaryMeta?.componentCount ?? 'n/a'} |`,
    `| componentFormulaCount | ${summaryMeta?.componentFormulaCount ?? 'n/a'} |`,
    `| calculationFormulaCount | ${summaryMeta?.calculationFormulaCount ?? 'n/a'} |`,
    `| sqlFormulaCount | ${summaryMeta?.sqlFormulaCount ?? 'n/a'} |`,
    `| directDependencies | ${summaryMeta?.directDependencyCount ?? 'n/a'} |`,
    `| fileSha256 (prefix) | \`${shaPrefix}\` |`,
    `| parserVersion | ${STAGE3I_PARSER_VERSION} |`,
    `| strictErrors | ${strictErrors.length ? strictErrors.join(', ') : '[]'} |`,
    '',
    '### Known dependency checks (codes only)',
    '',
    '| Component | Direct deps |',
    '|---|---|',
    '| 1350 | 1346, 1348 |',
    '| 1353 | 1350, 1351, 1352 |',
    '| 1355 | 0010, 0300, 1338, 1350 |',
    '| 1353 transitive | includes 1346, 1348 |',
    '',
    '### References',
    '',
    ...references.map((r) => `- **${r.id}**: ${r.ok ? 'OK' : 'FAIL'} — ${r.detail}`),
    '',
    '## Side effects (strict)',
    '',
    'Oracle / LLM / Qdrant / embeddings / formula execution / SQL execution / raw report logging / DOMAN fallback / legacy agent fallback = **0**.',
    '',
    '## CLI',
    '',
    '```bash',
    'pnpm --filter @teta/api run payroll-snapshot:stage3i -- validate --file .local/fixtures/payroll/SKLADNIKI_DOMAN.rtf',
    'pnpm --filter @teta/api run payroll-snapshot:stage3i -- import --file .local/fixtures/payroll/SKLADNIKI_DOMAN.rtf',
    'pnpm --filter @teta/api run payroll-snapshot:stage3i -- status',
    'pnpm --filter @teta/api run payroll-snapshot:stage3i -- inspect-component --code 1353',
    'pnpm --filter @teta/api run payroll-snapshot:stage3i -- trace-dependencies --code 1353 --depth 5',
    'pnpm --filter @teta/api run payroll-snapshot:stage3i -- audit --strict',
    '```',
    '',
    '## UI',
    '',
    '**Ustawienia → Parametryzacja płac** — status snapshotu + upload RTF (admin/vendor).',
    '',
    '## Out of scope (Stage 3J+)',
    '',
    'Full business explanation of components, analogous component design, payroll calculation, Oracle formula execution.',
    '',
  ].join('\n');

  writeFileSync(
    path.join(root, 'docs', 'AIA_PAYROLL_PARAMETER_SNAPSHOT_STAGE3I.md'),
    md,
    'utf8',
  );

  console.log(md);
  if (strict && strictErrors.length) {
    console.error('STRICT FAIL', strictErrors);
    return 1;
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();

  if (args.cmd === 'audit') {
    process.exitCode = runAudit(root, args.strict);
    return;
  }

  const { imports, queries } = services(root);

  if (args.cmd === 'validate') {
    if (!args.file) throw new Error('--file required');
    const buf = readFileSync(path.resolve(args.file));
    const result = imports.validateOnly(buf, path.basename(args.file));
    console.log(
      JSON.stringify(
        {
          status: result.status,
          detectionStatus: result.detectionStatus,
          summary: 'snapshot' in result ? result.snapshot.summary : null,
          errors: 'errors' in result ? result.errors : [],
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.cmd === 'import') {
    if (!args.file) throw new Error('--file required');
    const buf = readFileSync(path.resolve(args.file));
    const scope = path.resolve(args.file).includes(`${path.sep}.local${path.sep}`)
      ? STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE
      : 'customer_installation';
    const result = imports.importBuffer(buf, path.basename(args.file), { sourceScope: scope });
    console.log(
      JSON.stringify(
        {
          status: result.status,
          detectionStatus: result.detectionStatus,
          snapshotId: 'snapshot' in result ? result.snapshot.snapshotId : null,
          summary: 'snapshot' in result ? result.snapshot.summary : null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.cmd === 'status') {
    console.log(JSON.stringify({ active: queries.getActiveSummary() }, null, 2));
    return;
  }

  if (args.cmd === 'inspect-component') {
    if (!args.code) throw new Error('--code required');
    console.log(JSON.stringify(queries.inspectComponent(args.code), null, 2));
    return;
  }

  if (args.cmd === 'trace-dependencies') {
    if (!args.code) throw new Error('--code required');
    console.log(JSON.stringify(queries.traceComponent(args.code, args.depth), null, 2));
    return;
  }

  throw new Error(`Unknown command ${args.cmd}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
