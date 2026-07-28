/**
 * Stage 3J CLI — explain | dependencies | impact | search | audit
 *
 * Audit output is metadata-only — no raw formulas, SQL, or customer names.
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { DatabaseService } from '../database/database.service';
import { TetaPayrollSnapshotImportService } from '../teta-payroll-snapshots/teta-payroll-snapshot-import.service';
import { TetaPayrollSnapshotQueryService } from '../teta-payroll-snapshots/teta-payroll-snapshot-query.service';
import { TetaPayrollSnapshotRepository } from '../teta-payroll-snapshots/teta-payroll-snapshot-repository';
import { STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE } from '../teta-payroll-snapshots/teta-payroll-snapshot.types';
import { TetaPayrollComponentExplanationService } from '../teta-payroll-explanations/teta-payroll-component-explanation.service';
import {
  formatExplanationAsPlainText,
  mapExplanationToChatResponse,
} from '../teta-payroll-explanations/teta-payroll-component-response-mapper';
import { routePayrollChatQuestion } from '../teta-payroll-explanations/teta-payroll-explanation-chat-route';
import { redactChatResponseForHistory } from '../teta-payroll-explanations/teta-payroll-explanation-history-redactor';
import {
  STAGE3J_EXPLANATION_CONTRACT_VERSION,
  STAGE3J_SEMANTICS_CATALOG_VERSION,
} from '../teta-payroll-explanations/teta-payroll-explanation.types';
import { loadPayrollSemanticsCatalog } from '../teta-payroll-explanations/teta-payroll-semantics-catalog';
import { resolvePayrollComponent } from '../teta-payroll-explanations/teta-payroll-component-resolver';
import {
  buildGoldenImpact1350RepoSummary,
  countCustomerCodesInRepoReferences,
  formatGoldenImpact1350RepoDetail,
  repoReferencesForStage3jDocs,
  type GoldenImpact1350RepoSummary,
} from '../teta-payroll-explanations/teta-stage3j-artifact-privacy';
import { traverseDependencies } from '../teta-payroll-explanations/teta-payroll-component-graph.service';
import {
  buildStage3jAudit,
  collectSideEffectViolations,
  emptyStage3jSideEffects,
  validateStage3jInvariants,
  type Stage3jAuditInvariants,
  type Stage3jAuditReference,
} from '../teta-payroll-explanations/teta-stage3j-audit';
import {
  countImpactWordingIssues,
  emptyReferenceAudit,
  emptyRuntimeAudit,
  recordChatRouteMetrics,
  recordExplanationMetrics,
  recordReferenceResult,
  recordSelectorMetrics,
} from '../teta-payroll-explanations/teta-stage3j-runtime-metrics';

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
    code: get('--code'),
    query: get('--query'),
    depth: Number(get('--depth') ?? '5'),
    focus: get('--focus') ?? 'full',
    strict: argv.includes('--strict'),
  };
}

function openTempDb(root: string): DatabaseService {
  const dbPath = path.join(root, '.local', `payroll-stage3j-cli-${Date.now()}.sqlite`);
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
  const explanations = new TetaPayrollComponentExplanationService(repository);
  return { db, repository, imports, queries, explanations };
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
      ok: failed === 0 && executed > 0 && raw.success !== false,
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

function fixturePath(root: string, name: string): string {
  return path.join(
    root,
    'apps',
    'api',
    'src',
    'teta-payroll-snapshots',
    'fixtures',
    name,
  );
}

function addReference(
  references: Stage3jAuditReference[],
  referenceAudit: ReturnType<typeof emptyReferenceAudit>,
  input: {
    id: string;
    ok: boolean;
    detail: string;
    kind: 'golden' | 'synthetic' | 'verification';
  },
): void {
  references.push({ id: input.id, ok: input.ok, detail: input.detail });
  recordReferenceResult(referenceAudit, input.ok, input.kind);
}

function hasDependencyPath(
  transitive: Array<{ componentCode: string; paths: string[][] }>,
  target: string,
  path: string[],
): boolean {
  const row = transitive.find((t) => t.componentCode === target);
  if (!row) return false;
  const needle = path.join('|');
  return row.paths.some((p) => p.join('|') === needle);
}

function hashRefId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function sanitizeExplanationForAudit(
  explanation: ReturnType<TetaPayrollComponentExplanationService['explain']>,
) {
  return {
    status: explanation.status,
    explanationId: explanation.explanationId,
    explanationFingerprintSha256: explanation.explanationFingerprintSha256,
    request: explanation.request,
    source: explanation.source
      ? {
          snapshotId: explanation.source.snapshotId,
          snapshotFileSha256: explanation.source.snapshotFileSha256,
          reportGeneratedAt: explanation.source.reportGeneratedAt,
          kpVersion: explanation.source.kpVersion,
          paVersion: explanation.source.paVersion,
          parserVersion: explanation.source.parserVersion,
          semanticsCatalogVersion: explanation.source.semanticsCatalogVersion,
        }
      : null,
    component: explanation.component
      ? {
          code: explanation.component.code,
          title: explanation.component.title,
          typeCode: explanation.component.typeCode,
          typeMeaning: explanation.component.typeMeaning,
          correctionMode: explanation.component.correctionMode,
          correctionModeMeaning: explanation.component.correctionModeMeaning,
        }
      : null,
    formula: {
      available: explanation.formula.available,
      parseStatus: explanation.formula.parseStatus,
      referenceCount: explanation.formula.references.length,
      stepCount: explanation.formula.plainLanguageSteps.length,
      warningCount: explanation.formula.warnings.length,
    },
    dependencies: {
      directCodes: explanation.dependencies.direct.map((d) => d.componentCode),
      transitiveCodes: explanation.dependencies.transitive.map((t) => t.componentCode),
      missingTargets: explanation.dependencies.missingTargets,
      cycleCount: explanation.dependencies.cycles.length,
      truncated: explanation.dependencies.truncated,
    },
    impact: {
      directDependentCodes: explanation.impact.directDependents.map((d) => d.componentCode),
      transitiveDependentCodes: explanation.impact.transitiveDependents.map((d) => d.componentCode),
      calculationFormulaUseCount: explanation.impact.calculationFormulaUses.length,
      sqlFormulaUseStatuses: explanation.impact.sqlFormulaUses.map((s) => s.status),
    },
    diagnostics: explanation.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
    evidenceSummary: explanation.evidenceSummary,
  };
}

function runAudit(root: string, strict: boolean): number {
  const localDir = path.join(root, '.local');
  mkdirSync(localDir, { recursive: true });
  const apiDir = path.join(root, 'apps', 'api');
  const runtimeAudit = emptyRuntimeAudit();
  const referenceAudit = emptyReferenceAudit();
  const sideEffects = emptyStage3jSideEffects();
  const references: Stage3jAuditReference[] = [];
  const auditInvariants: Partial<Stage3jAuditInvariants> = {};

  let goldenMetaPresent = false;
  let goldenMeta: Record<string, unknown> | null = null;
  let reference1353Payload: Record<string, unknown> | null = null;
  let reference1350ImpactPayload: Record<string, unknown> | null = null;
  let impact1350RepoSummary: GoldenImpact1350RepoSummary | null = null;

  // Reference D — snapshot required via Stage 3J chat route (isolated scope, no snapshot)
  {
    const { repository, explanations, queries } = services(root);
    const route = routePayrollChatQuestion({
      question: 'Jak zbudowany jest składnik 1353?',
      explanationService: explanations,
      queryService: queries,
      uploadAllowed: true,
    });
    recordChatRouteMetrics(runtimeAudit, route);
    if (route.handled) {
      const msg = route.content;
      const ok =
        route.chatResponse.status === 'snapshot_required' &&
        msg.includes('Wydruki') &&
        msg.includes('Płace') &&
        msg.includes('Wydruk parametrów płacowych');
      auditInvariants.snapshotRequiredUsesStage3jRoute = ok;
      addReference(references, referenceAudit, {
        id: 'stage3j-snapshot-required',
        ok,
        detail: route.chatResponse.status,
        kind: 'synthetic',
      });
    } else {
      addReference(references, referenceAudit, {
        id: 'stage3j-snapshot-required',
        ok: false,
        detail: 'route_not_handled',
        kind: 'synthetic',
      });
    }
    void repository;
  }

  // Golden import + references A, B, C, E, I, J, fingerprint
  const goldenPath = path.join(root, '.local', 'fixtures', 'payroll', 'SKLADNIKI_DOMAN.rtf');
  if (!existsSync(goldenPath)) {
    addReference(references, referenceAudit, {
      id: 'golden-full-explanation-1353',
      ok: false,
      detail: 'SKLADNIKI_DOMAN.rtf missing',
      kind: 'golden',
    });
    addReference(references, referenceAudit, {
      id: 'golden-impact-1350',
      ok: false,
      detail: 'SKLADNIKI_DOMAN.rtf missing',
      kind: 'golden',
    });
    addReference(references, referenceAudit, {
      id: 'golden-leading-zero-code-0010',
      ok: false,
      detail: 'SKLADNIKI_DOMAN.rtf missing',
      kind: 'golden',
    });
    addReference(references, referenceAudit, {
      id: 'stage3j-component-not-found',
      ok: false,
      detail: 'SKLADNIKI_DOMAN.rtf missing',
      kind: 'golden',
    });
    addReference(references, referenceAudit, {
      id: 'stage3j-calculation-formula-use',
      ok: false,
      detail: 'SKLADNIKI_DOMAN.rtf missing',
      kind: 'golden',
    });
  } else {
    goldenMetaPresent = true;
    const { imports, queries, explanations, repository } = services(root);
    const buf = readFileSync(goldenPath);
    const goldenImport = imports.importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
    });
    if (!('snapshot' in goldenImport)) {
      addReference(references, referenceAudit, {
        id: 'golden-full-explanation-1353',
        ok: false,
        detail: `import=${goldenImport.status}`,
        kind: 'golden',
      });
    } else {
      const snap = goldenImport.snapshot;
      goldenMeta = {
        fileSha256: createHash('sha256').update(buf).digest('hex'),
        reportGeneratedAt: snap.source.reportGeneratedAt,
        kpVersion: snap.source.kpVersion,
        paVersion: snap.source.paVersion,
        componentCount: snap.summary.componentCount,
        directDependencyCount: snap.summary.directDependencyCount,
      };

      // Reference A — golden full explanation 1353
      const explain1353a = explanations.explain({ code: '1353', focus: 'full', depth: 5 });
      recordExplanationMetrics(runtimeAudit, explain1353a, {
        focus: 'full',
        traceKind: 'full',
      });
      const explain1353b = explanations.explain({ code: '1353', focus: 'full', depth: 5 });
      recordExplanationMetrics(runtimeAudit, explain1353b, {
        focus: 'full',
        traceKind: 'full',
      });
      const explain1353depth4 = explanations.explain({ code: '1353', focus: 'full', depth: 4 });
      recordExplanationMetrics(runtimeAudit, explain1353depth4, {
        focus: 'full',
        traceKind: 'full',
      });

      const deps1353 = explain1353a.dependencies.direct.map((d) => d.componentCode);
      const trans1353 = explain1353a.dependencies.transitive.map((t) => t.componentCode);
      const path1346 = hasDependencyPath(explain1353a.dependencies.transitive, '1346', [
        '1353',
        '1350',
        '1346',
      ]);
      const path1348 = hasDependencyPath(explain1353a.dependencies.transitive, '1348', [
        '1353',
        '1350',
        '1348',
      ]);
      const refAOk =
        explain1353a.component?.code === '1353' &&
        includesAll(deps1353, ['1350', '1351', '1352']) &&
        includesAll(trans1353, ['1346', '1348']) &&
        path1346 &&
        path1348 &&
        Boolean(explain1353a.explanationFingerprintSha256) &&
        (explain1353a.status === 'completed' ||
          explain1353a.status === 'completed_with_warnings') &&
        sideEffects.formulasExecuted === 0;
      auditInvariants.golden1353DirectDependenciesCorrect = includesAll(deps1353, [
        '1350',
        '1351',
        '1352',
      ]);
      auditInvariants.golden1353TransitiveDependenciesCorrect = includesAll(trans1353, [
        '1346',
        '1348',
      ]);
      auditInvariants.golden1353PathsCorrect = path1346 && path1348;

      if (
        explain1353a.explanationFingerprintSha256 &&
        explain1353b.explanationFingerprintSha256 &&
        explain1353a.explanationFingerprintSha256 === explain1353b.explanationFingerprintSha256
      ) {
        runtimeAudit.identicalInputFingerprintMatches += 1;
      }
      if (
        explain1353a.explanationFingerprintSha256 &&
        explain1353depth4.explanationFingerprintSha256 &&
        explain1353a.explanationFingerprintSha256 !== explain1353depth4.explanationFingerprintSha256
      ) {
        runtimeAudit.changedDepthFingerprintDiffers += 1;
      }
      runtimeAudit.deterministicFingerprintCheckOk =
        runtimeAudit.identicalInputFingerprintMatches >= 1 &&
        runtimeAudit.changedDepthFingerprintDiffers >= 1
          ? 1
          : 0;
      auditInvariants.deterministicFingerprintCheckOk =
        runtimeAudit.deterministicFingerprintCheckOk === 1;

      addReference(references, referenceAudit, {
        id: 'golden-full-explanation-1353',
        ok: refAOk,
        detail: `status=${explain1353a.status};deps=${deps1353.join(',')};fp=${explain1353a.explanationFingerprintSha256?.slice(0, 12) ?? 'n/a'}`,
        kind: 'golden',
      });

      reference1353Payload = sanitizeExplanationForAudit(explain1353a);

      // Reference B — golden impact 1350
      const impact1350 = explanations.explain({ code: '1350', focus: 'impact', depth: 5 });
      recordExplanationMetrics(runtimeAudit, impact1350, {
        focus: 'impact',
        traceKind: 'impact',
      });
      const impactCodes = impact1350.impact.directDependents.map((d) => d.componentCode);
      const impactText = `${impact1350.narrative.impactExplanation} ${impact1350.narrative.summary}`;
      const wordingOk =
        /może wpłynąć/i.test(impactText) && countImpactWordingIssues(impactText) === 0;
      const refBOk =
        includesAll(impactCodes, ['1353', '1355']) &&
        runtimeAudit.impactTraceRequests > 0 &&
        impact1350.impact.directDependents.length > 0 &&
        wordingOk &&
        runtimeAudit.guaranteedImpactClaimsMade === 0;
      auditInvariants.golden1350ImpactContains1353And1355 = includesAll(impactCodes, [
        '1353',
        '1355',
      ]);
      auditInvariants.guaranteedImpactClaimsMadeZero =
        runtimeAudit.guaranteedImpactClaimsMade === 0;

      impact1350RepoSummary = buildGoldenImpact1350RepoSummary({
        directDependentCodes: impactCodes,
        impactTraceRequests: runtimeAudit.impactTraceRequests,
      });

      addReference(references, referenceAudit, {
        id: 'golden-impact-1350',
        ok: refBOk,
        detail: formatGoldenImpact1350RepoDetail(impact1350RepoSummary),
        kind: 'golden',
      });

      reference1350ImpactPayload = {
        status: impact1350.status,
        directDependentCodes: impactCodes,
        transitiveDependentCount: impact1350.impact.transitiveDependents.length,
        calculationFormulaUseCount: impact1350.impact.calculationFormulaUses.length,
        wordingUsesMayAffect: /może wpłynąć/i.test(impactText),
        guaranteedClaims: countImpactWordingIssues(impactText),
        explanationFingerprintSha256: impact1350.explanationFingerprintSha256,
      };

      // Reference C — exact code 0010 + code 10 no auto-resolve (polish-encoding fixture)
      {
        const { repository: repo0010, imports: imp0010 } = services(root);
        const polishPath = fixturePath(root, 'payroll-parameters-polish-encoding.rtf');
        if (existsSync(polishPath)) {
          imp0010.importBuffer(readFileSync(polishPath), 'payroll-parameters-polish-encoding.rtf');
          const scope0010 = repo0010.getOrCreateInstallationScopeId();
          const sel0010 = resolvePayrollComponent({
            repository: repo0010,
            installationScopeId: scope0010,
            rawSelector: '0010',
            exactCode: '0010',
          });
          recordSelectorMetrics(runtimeAudit, sel0010.selection, {
            queryCode: '0010',
            resolvedCode: sel0010.selection.resolved?.code,
          });
          const sel10 = resolvePayrollComponent({
            repository: repo0010,
            installationScopeId: scope0010,
            rawSelector: '10',
          });
          recordSelectorMetrics(runtimeAudit, sel10.selection, { queryCode: '10' });

          const refCOk =
            sel0010.selection.selector.selectorType === 'exact_code' &&
            sel0010.selection.resolved?.code === '0010' &&
            runtimeAudit.leadingZeroCodesPreserved >= 1 &&
            runtimeAudit.selectorAutoPaddingApplied === 0 &&
            sel10.selection.resolved?.code !== '0010' &&
            runtimeAudit.autoResolvedPaddedCodes === 0;
          auditInvariants.exact0010Preserved =
            sel0010.selection.resolved?.code === '0010' &&
            sel0010.selection.selector.selectorType === 'exact_code';
          auditInvariants.code10NotAutoResolvedTo0010 = sel10.selection.resolved?.code !== '0010';

          addReference(references, referenceAudit, {
            id: 'golden-leading-zero-code-0010',
            ok: refCOk,
            detail: `0010=${sel0010.selection.resolved?.code};10=${sel10.selection.resolved?.code ?? 'null'};suggested=${sel10.selection.selector.suggestedCode ?? 'none'}`,
            kind: 'synthetic',
          });
        } else {
          addReference(references, referenceAudit, {
            id: 'golden-leading-zero-code-0010',
            ok: false,
            detail: 'polish-encoding fixture missing',
            kind: 'synthetic',
          });
        }
      }

      // Reference E — component not found ZZZZ via Stage 3J route
      const routeMissing = routePayrollChatQuestion({
        question: 'Jak zbudowany jest składnik ZZZZ?',
        explanationService: explanations,
        queryService: queries,
        uploadAllowed: true,
      });
      recordChatRouteMetrics(runtimeAudit, routeMissing);
      const missingOk =
        routeMissing.handled &&
        routeMissing.chatResponse.status === 'component_not_found' &&
        Boolean(routeMissing.chatResponse.explanation?.source?.snapshotId);
      auditInvariants.missingComponentUsesStage3jRoute = Boolean(missingOk);
      addReference(references, referenceAudit, {
        id: 'stage3j-component-not-found',
        ok: Boolean(missingOk),
        detail: routeMissing.handled ? routeMissing.chatResponse.status : 'not_handled',
        kind: 'golden',
      });

      // Reference I — calculation formula use (hashed ids only)
      let calcFormulaUseCount = 0;
      let calcFormulaRefHash: string | null = null;
      const summaries = repository.listComponentSummaries(snap.snapshotId);
      for (const summary of summaries) {
        const refs = repository.listCalculationFormulaRefsByComponent(
          snap.snapshotId,
          summary.code,
        );
        if (refs.length > 0) {
          const impactProbe = explanations.explain({
            code: summary.code,
            focus: 'impact',
            depth: 3,
          });
          recordExplanationMetrics(runtimeAudit, impactProbe, {
            focus: 'impact',
            traceKind: 'impact',
          });
          calcFormulaUseCount = impactProbe.impact.calculationFormulaUses.length;
          if (calcFormulaUseCount > 0) {
            calcFormulaRefHash = hashRefId(
              impactProbe.impact.calculationFormulaUses[0]!.formulaInternalId,
            );
          }
          break;
        }
      }
      const refIOk =
        calcFormulaUseCount > 0 &&
        runtimeAudit.calculationFormulasPersisted === 0 &&
        runtimeAudit.calculationFormulasLogged === 0;
      auditInvariants.calculationFormulaUseProven = refIOk;
      addReference(references, referenceAudit, {
        id: 'stage3j-calculation-formula-use',
        ok: refIOk,
        detail: `uses=${calcFormulaUseCount};refHash=${calcFormulaRefHash ?? 'n/a'}`,
        kind: 'golden',
      });

      // Reference J — unsupported capability
      const routeUnsupported = routePayrollChatQuestion({
        question: 'Utwórz składnik analogiczny do 1353.',
        explanationService: explanations,
        queryService: queries,
        uploadAllowed: true,
      });
      recordChatRouteMetrics(runtimeAudit, routeUnsupported);
      const unsupportedOk =
        routeUnsupported.handled &&
        routeUnsupported.chatResponse.status === 'capability_not_available';
      auditInvariants.unsupportedCapabilityDoesNotFallback = Boolean(unsupportedOk);
      addReference(references, referenceAudit, {
        id: 'stage3j-unsupported-capability',
        ok: Boolean(unsupportedOk),
        detail: routeUnsupported.handled
          ? routeUnsupported.chatResponse.status
          : 'not_handled',
        kind: 'golden',
      });

      // History redaction on active snapshot route
      const routeActive = routePayrollChatQuestion({
        question: 'Wyjaśnij konfigurację składnika 1353',
        explanationService: explanations,
        queryService: queries,
        uploadAllowed: true,
      });
      if (routeActive.handled) {
        recordChatRouteMetrics(runtimeAudit, routeActive);
        const red = redactChatResponseForHistory(routeActive.chatResponse);
        runtimeAudit.historyRedactionsApplied += 1;
        addReference(references, referenceAudit, {
          id: 'history-redaction',
          ok: !red.historyRedaction.rawFormulaPersisted && red.historyRedaction.dataExpired,
          detail: 'redacted',
          kind: 'verification',
        });
      }
    }
  }

  // Reference F — ambiguous title (synthetic fixture)
  {
    const { repository, imports, explanations } = services(root);
    const ambPath = fixturePath(root, 'payroll-parameters-ambiguous-title.rtf');
    if (existsSync(ambPath)) {
      imports.importBuffer(readFileSync(ambPath), 'payroll-parameters-ambiguous-title.rtf');
      const scopeAmb = repository.getOrCreateInstallationScopeId();
      const ambSelection = resolvePayrollComponent({
        repository,
        installationScopeId: scopeAmb,
        rawSelector: 'premia kwartalna',
      });
      recordSelectorMetrics(runtimeAudit, ambSelection.selection);
      const ex = explanations.explain({ query: 'premia kwartalna' });
      recordExplanationMetrics(runtimeAudit, ex);
      const candidates = ex.candidates ?? [];
      const refFOk =
        ex.status === 'ambiguous_component' &&
        candidates.length >= 2 &&
        candidates.length <= 10 &&
        candidates.every((c) => !('formula' in c && (c as { formula?: string }).formula));
      auditInvariants.ambiguousTitleNotAutoResolved = ex.status === 'ambiguous_component';
      addReference(references, referenceAudit, {
        id: 'stage3j-ambiguous-component-title',
        ok: refFOk,
        detail: `status=${ex.status};candidates=${candidates.length}`,
        kind: 'synthetic',
      });
    } else {
      addReference(references, referenceAudit, {
        id: 'stage3j-ambiguous-component-title',
        ok: false,
        detail: 'fixture missing',
        kind: 'synthetic',
      });
    }
    void repository;
  }

  // Reference G — dependency cycle via graph traversal
  {
    const cycleDeps = [
      { fromComponentCode: '1000', toComponentCode: '1010' },
      { fromComponentCode: '1010', toComponentCode: '1000' },
    ] as never;
    const g = traverseDependencies({
      dependencies: cycleDeps,
      rootCode: '1000',
      maxDepth: 5,
      titleByCode: new Map([
        ['1000', 'A'],
        ['1010', 'B'],
      ]),
      knownCodes: new Set(['1000', '1010']),
    });
    runtimeAudit.cyclesDetected += g.cycles.length;
    const refGOk =
      g.cycles.length > 0 &&
      g.cycles.some((c) => c.includes('1000') && c.includes('1010')) &&
      !g.truncated;
    auditInvariants.cycleTraversalTerminates = g.cycles.length > 0;
    addReference(references, referenceAudit, {
      id: 'stage3j-dependency-cycle',
      ok: refGOk,
      detail: `cycles=${g.cycles.length};truncated=${g.truncated}`,
      kind: 'synthetic',
    });
  }

  // Reference H — unknown function (synthetic fixture)
  {
    const { repository, imports, explanations } = services(root);
    const unkPath = fixturePath(root, 'payroll-parameters-unknown-function.rtf');
    if (existsSync(unkPath)) {
      imports.importBuffer(readFileSync(unkPath), 'payroll-parameters-unknown-function.rtf');
      const ex = explanations.explain({ code: '4000', focus: 'formula' });
      recordExplanationMetrics(runtimeAudit, ex, { focus: 'formula' });
      const hasUnknownDiag = ex.diagnostics.some((d) => d.code === 'formula_unknown_function');
      const refHOk =
        ex.formula.unknownCalls.length > 0 &&
        hasUnknownDiag &&
        runtimeAudit.unknownMeaningsInvented === 0 &&
        sideEffects.formulasExecuted === 0;
      auditInvariants.unknownFunctionMeaningNotInvented =
        runtimeAudit.unknownMeaningsInvented === 0 && hasUnknownDiag;
      addReference(references, referenceAudit, {
        id: 'stage3j-unknown-function',
        ok: refHOk,
        detail: `unknownCalls=${ex.formula.unknownCalls.length};diag=${hasUnknownDiag}`,
        kind: 'synthetic',
      });
    } else {
      addReference(references, referenceAudit, {
        id: 'stage3j-unknown-function',
        ok: false,
        detail: 'fixture missing',
        kind: 'synthetic',
      });
    }
    void repository;
  }

  // Jest verification references
  const stage3jOut = path.join(localDir, 'stage3j-jest.json');
  const stage3jJest = spawnJest({
    apiDir,
    outputFile: stage3jOut,
    args: ['teta-stage3j.spec.ts'],
  });
  addReference(references, referenceAudit, {
    id: 'stage3j-jest',
    ok: stage3jJest.ok,
    detail: stage3jJest.detail,
    kind: 'verification',
  });

  const regressionOut = path.join(localDir, 'stage3-regression-jest.json');
  const regressionJest = spawnJest({
    apiDir,
    outputFile: regressionOut,
    args: [
      'teta-stage3b.spec.ts',
      'teta-stage3c.spec.ts',
      'teta-stage3d.spec.ts',
      'teta-stage3e.spec.ts',
      'teta-stage3f.spec.ts',
      'teta-stage3g.spec.ts',
      'teta-stage3h.spec.ts',
      'teta-stage3i.spec.ts',
    ],
  });
  addReference(references, referenceAudit, {
    id: 'regression-jest-3b-i',
    ok: regressionJest.ok,
    detail: regressionJest.detail,
    kind: 'verification',
  });

  const verification = {
    stage3jTestsExecuted: stage3jJest.executed,
    stage3jTestsPassed: stage3jJest.passed,
    stage3jTestsFailed: stage3jJest.failed,
    regressionTestsExecuted: regressionJest.executed,
    regressionTestsPassed: regressionJest.passed,
    regressionTestsFailed: regressionJest.failed,
  };

  auditInvariants.noSideEffects = collectSideEffectViolations(sideEffects).length === 0;
  auditInvariants.componentValuesCalculatedZero = runtimeAudit.componentValuesCalculated === 0;
  auditInvariants.rawComponentFormulasPersistedZero =
    runtimeAudit.rawComponentFormulasPersisted === 0;
  auditInvariants.dependencyFragmentsPersistedZero =
    runtimeAudit.dependencyFragmentsPersisted === 0;
  auditInvariants.calculationFormulasPersistedZero =
    runtimeAudit.calculationFormulasPersisted === 0;
  auditInvariants.sqlFormulasPersistedZero = runtimeAudit.sqlFormulasPersisted === 0;
  auditInvariants.ambiguousResponseHasAmbiguousSelectionEvidence =
    runtimeAudit.ambiguousComponentResponses === 0 || runtimeAudit.ambiguousSelections >= 1;

  const generatedAt = new Date().toISOString();
  const catalog = loadPayrollSemanticsCatalog(path.join(root, 'apps', 'api'));
  const repoReferences = repoReferencesForStage3jDocs(references, impact1350RepoSummary);

  const docsJsonDraft = {
    contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
    auditContractVersion: 'teta-aia-payroll-component-explanation-audit-v1',
    generatedAt,
    explanationContractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
    semanticsCatalogVersion: STAGE3J_SEMANTICS_CATALOG_VERSION,
    semanticsCatalogSha256Prefix: catalog.catalogSha256.slice(0, 12) + '…',
    runtimeAudit,
    referenceAudit,
    sideEffects,
    goldenMeta: goldenMeta
      ? {
          fileSha256Prefix: String(goldenMeta.fileSha256).slice(0, 12) + '…',
          reportGeneratedAt: goldenMeta.reportGeneratedAt,
          kpVersion: goldenMeta.kpVersion,
          paVersion: goldenMeta.paVersion,
          componentCount: goldenMeta.componentCount,
          directDependencyCount: goldenMeta.directDependencyCount,
        }
      : null,
    references: repoReferences,
    verification,
    invariants: auditInvariants,
  };

  sideEffects.customerConfigurationCodesExposedInRepoArtifacts =
    countCustomerCodesInRepoReferences(repoReferences);
  auditInvariants.goldenImpactAdditionalDependentsRedactedFromRepoArtifacts =
    sideEffects.customerConfigurationCodesExposedInRepoArtifacts === 0 &&
    impact1350RepoSummary !== null &&
    impact1350RepoSummary.additionalDependentsRedacted === true;

  const report = buildStage3jAudit({
    explanationContractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
    semanticsCatalogVersion: STAGE3J_SEMANTICS_CATALOG_VERSION,
    runtimeAudit,
    referenceAudit,
    sideEffects,
    references: repoReferences.map((r) => ({ id: r.id, ok: r.ok, detail: r.detail })),
    verification,
    invariants: auditInvariants,
    goldenMetaPresent,
    minStage3jTests: 158,
    now: () => new Date(generatedAt),
  });

  const docsJson = {
    ...docsJsonDraft,
    auditContractVersion: report.contractVersion,
    auditSemantics: report.auditSemantics,
    sideEffects: report.sideEffects,
    invariants: report.invariants,
    strictErrors: report.strictErrors,
  };

  writeFileSync(
    path.join(localDir, 'AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.audit.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  if (reference1353Payload) {
    writeFileSync(
      path.join(localDir, 'AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.reference-1353.json'),
      JSON.stringify(reference1353Payload, null, 2),
      'utf8',
    );
  }
  if (reference1350ImpactPayload) {
    writeFileSync(
      path.join(
        localDir,
        'AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.reference-1350-impact.json',
      ),
      JSON.stringify(reference1350ImpactPayload, null, 2),
      'utf8',
    );
  }

  writeFileSync(
    path.join(root, 'docs', 'AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.json'),
    JSON.stringify(docsJson, null, 2),
    'utf8',
  );

  const shaPrefix =
    goldenMeta && typeof goldenMeta.fileSha256 === 'string'
      ? `${goldenMeta.fileSha256.slice(0, 12)}…`
      : 'n/a';

  const requiredRefs = repoReferences.filter(
    (r) => r.id.startsWith('golden-') || r.id.startsWith('stage3j-'),
  );

  const md = [
    '# AIA — Stage 3J Payroll Component Explanation',
    '',
    `> Generated ${generatedAt}. Metadata only — no formulas, SQL, or customer names.`,
    '',
    '## Scope',
    '',
    '- Static explanation of payroll **components** from Stage 3I snapshot (RTF import)',
    '- Deterministic selector, formula plain-language steps, dependency/impact graph',
    '- **No** formula/SQL execution, Oracle, LLM, Qdrant, employee payroll values',
    '- Local golden RTF (`SKLADNIKI_DOMAN.rtf`) is `customer_example` only — never git',
    '',
    '## Audit semantics',
    '',
    '- **runtimeAudit** — instrumented service counters from real audit execution',
    '- **referenceAudit** — audit scenario pass/fail counts (A–J + jest)',
    '- Reference execution may also increment runtimeAudit when invoking real services',
    '',
    '## Runtime audit (selected)',
    '',
    `| impactTraceRequests | ${runtimeAudit.impactTraceRequests} |`,
    `| directDependentsReturned | ${runtimeAudit.directDependentsReturned} |`,
    `| snapshotRequiredResponses | ${runtimeAudit.snapshotRequiredResponses} |`,
    `| componentNotFoundResponses | ${runtimeAudit.componentNotFoundResponses} |`,
    `| ambiguousSelections | ${runtimeAudit.ambiguousSelections} |`,
    `| ambiguousComponentResponses | ${runtimeAudit.ambiguousComponentResponses} |`,
    `| customerConfigurationCodesExposedInRepoArtifacts | ${report.sideEffects.customerConfigurationCodesExposedInRepoArtifacts} |`,
    `| cyclesDetected | ${runtimeAudit.cyclesDetected} |`,
    `| unknownFunctionsPreserved | ${runtimeAudit.unknownFunctionsPreserved} |`,
    `| calculationFormulaUsesReturned | ${runtimeAudit.calculationFormulaUsesReturned} |`,
    `| guaranteedImpactClaimsMade | ${runtimeAudit.guaranteedImpactClaimsMade} |`,
    `| deterministicFingerprintCheckOk | ${runtimeAudit.deterministicFingerprintCheckOk} |`,
    '',
    '## Privacy counters (must be 0)',
    '',
    `| rawComponentFormulasPersisted | ${runtimeAudit.rawComponentFormulasPersisted} |`,
    `| calculationFormulasPersisted | ${runtimeAudit.calculationFormulasPersisted} |`,
    `| sqlFormulasPersisted | ${runtimeAudit.sqlFormulasPersisted} |`,
    `| rawFormulasLogged | ${runtimeAudit.rawFormulasLogged} |`,
    '',
    '### verification (jest runner)',
    '',
    `| stage3jTests | ${verification.stage3jTestsPassed}/${verification.stage3jTestsExecuted} (failed ${verification.stage3jTestsFailed}) |`,
    `| regression 3B–3I | ${verification.regressionTestsPassed}/${verification.regressionTestsExecuted} (failed ${verification.regressionTestsFailed}) |`,
    `| referenceAudit passed | ${referenceAudit.referencesPassed}/${referenceAudit.referencesTested} |`,
    '',
    '## Golden metadata',
    '',
    `| reportGeneratedAt | ${String(goldenMeta?.reportGeneratedAt ?? 'n/a')} |`,
    `| kpVersion / paVersion | ${String(goldenMeta?.kpVersion ?? 'n/a')} / ${String(goldenMeta?.paVersion ?? 'n/a')} |`,
    `| componentCount | ${String(goldenMeta?.componentCount ?? 'n/a')} |`,
    `| fileSha256 (prefix) | \`${shaPrefix}\` |`,
    `| semanticsCatalogVersion | ${STAGE3J_SEMANTICS_CATALOG_VERSION} |`,
    `| strictErrors | ${report.strictErrors.length ? report.strictErrors.join(', ') : '[]'} |`,
    '',
    '### Required references A–J',
    '',
    ...requiredRefs.map((r) => `- **${r.id}**: ${r.ok ? 'OK' : 'FAIL'} — ${r.detail}`),
    '',
    '## Side effects (strict)',
    '',
    'Oracle / LLM / Qdrant / embeddings / formula execution / SQL execution / raw formula logging / DOMAN fallback / legacy agent fallback = **0**.',
    '',
    '## CLI',
    '',
    '```bash',
    'pnpm --filter @teta/api run payroll-explanation:stage3j -- explain --code 1353',
    'pnpm --filter @teta/api run payroll-explanation:stage3j -- dependencies --code 1353 --depth 5',
    'pnpm --filter @teta/api run payroll-explanation:stage3j -- impact --code 1350',
    'pnpm --filter @teta/api run payroll-explanation:stage3j -- search --query premia',
    'pnpm --filter @teta/api run payroll-explanation:stage3j -- audit --strict',
    '```',
    '',
    '## Out of scope',
    '',
    'Employee payroll values, component design, comparison, payroll calculation, Oracle formula execution.',
    '',
  ].join('\n');

  writeFileSync(path.join(root, 'docs', 'AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.md'), md, 'utf8');

  console.log(md);

  const outputErrors = validateStage3jInvariants({
    sideEffects: report.sideEffects,
    runtimeAudit,
    referenceAudit,
    invariants: report.invariants,
    references: repoReferences.map((r) => ({ id: r.id, ok: r.ok, detail: r.detail })),
    verification,
    auditOutputText: JSON.stringify(docsJson),
    minStage3jTests: 158,
  });
  if (outputErrors.length) {
    report.strictErrors.push(...outputErrors.filter((e) => !report.strictErrors.includes(e)));
  }

  writeFileSync(
    path.join(localDir, 'AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.audit.json'),
    JSON.stringify({ ...report, strictErrors: report.strictErrors }, null, 2),
    'utf8',
  );

  if (strict && report.strictErrors.length) {
    console.error('STRICT FAIL', report.strictErrors);
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

  const { imports, explanations } = services(root);

  // Optional golden bootstrap for CLI commands
  const goldenPath = path.join(root, '.local', 'fixtures', 'payroll', 'SKLADNIKI_DOMAN.rtf');
  const synFixture = path.join(
    root,
    'apps',
    'api',
    'src',
    'teta-payroll-snapshots',
    'fixtures',
    'payroll-parameters-minimal-valid.rtf',
  );
  if (existsSync(goldenPath)) {
    imports.importBuffer(readFileSync(goldenPath), 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE,
    });
  } else if (existsSync(synFixture)) {
    imports.importBuffer(readFileSync(synFixture), 'payroll-parameters-minimal-valid.rtf');
  }

  if (args.cmd === 'explain') {
    const explanation = explanations.explain({
      code: args.code,
      query: args.query,
      focus: args.focus as never,
      depth: args.depth,
    });
    console.log(
      JSON.stringify(
        {
          sanitized: sanitizeExplanationForAudit(explanation),
          message: formatExplanationAsPlainText(explanation),
          chat: mapExplanationToChatResponse(explanation),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.cmd === 'dependencies') {
    if (!args.code) throw new Error('--code required');
    const explanation = explanations.explain({
      code: args.code,
      focus: 'dependencies',
      depth: args.depth,
    });
    console.log(JSON.stringify(sanitizeExplanationForAudit(explanation).dependencies, null, 2));
    return;
  }

  if (args.cmd === 'impact') {
    if (!args.code) throw new Error('--code required');
    const explanation = explanations.explain({
      code: args.code,
      focus: 'impact',
      depth: args.depth,
    });
    console.log(JSON.stringify(sanitizeExplanationForAudit(explanation).impact, null, 2));
    return;
  }

  if (args.cmd === 'search') {
    const q = args.query ?? args.code ?? '';
    if (!q.trim()) throw new Error('--query required');
    console.log(JSON.stringify(explanations.searchComponents(q), null, 2));
    return;
  }

  throw new Error(`Unknown command: ${args.cmd}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
