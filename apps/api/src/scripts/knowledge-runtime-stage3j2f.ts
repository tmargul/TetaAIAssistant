import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import {
  buildStage3j2fAudit,
  defaultStage3j2bStore,
  defaultStage3j2cStore,
  defaultStage3j2dStore,
  defaultStage3j2eStore,
  defaultStage3j2fOutput,
  loadRuntimeUnits,
  runBuildAnswerPlan,
  runBuildIndex,
  runBuildRuntimePacks,
  runPilotRfCases,
  runRenderFixtureAnswer,
  runRetrieve,
  validateConfig,
} from '../teta-runtime-knowledge';
import type { GroundedAnswerPlanV1 } from '../teta-runtime-knowledge';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function resolvePathArg(arg: string | null, fallback: string, repoRoot: string): string {
  const value = arg ?? fallback;
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const repoRoot = resolveRepoRoot();

  if (cmd === 'validate-config') {
    const result = validateConfig(repoRoot);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  if (cmd === 'build-runtime-packs') {
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2fOutput(repoRoot), repoRoot);
    const result = runBuildRuntimePacks({
      repoRoot,
      approvalStore: resolvePathArg(getArg('--approval-store'), defaultStage3j2eStore(repoRoot), repoRoot),
      correlationStore: resolvePathArg(getArg('--correlation-store'), defaultStage3j2dStore(repoRoot), repoRoot),
      candidateStore: resolvePathArg(getArg('--candidate-store'), defaultStage3j2cStore(repoRoot), repoRoot),
      sourceStore: resolvePathArg(getArg('--source-store'), defaultStage3j2bStore(repoRoot), repoRoot),
      outputRoot,
      writeArtifacts: true,
    });
    console.log(
      JSON.stringify(
        {
          approvedCanonicalUnitsCreated: result.stats.approvedCanonicalUnitsCreated,
          sourceBackedCandidatesEvaluated: result.stats.sourceBackedCandidatesEvaluated,
          sourceBackedDirectUnitsCreated: result.stats.sourceBackedDirectUnitsCreated,
          sourceBackedPartialUnitsCreated: result.stats.sourceBackedPartialUnitsCreated,
          sourceBackedCandidatesBlocked: result.stats.sourceBackedCandidatesBlocked,
          vendorRuntimePacksCreated: result.stats.vendorRuntimePacksCreated,
          vendorAuditPacksCreated: result.stats.vendorAuditPacksCreated,
          strictErrors: result.strictErrors,
          output: outputRoot,
        },
        null,
        2,
      ),
    );
    if (result.strictErrors.length) process.exit(1);
    return;
  }

  if (cmd === 'build-index') {
    const inputRoot = resolvePathArg(getArg('--input'), defaultStage3j2fOutput(repoRoot), repoRoot);
    const outputRoot = resolvePathArg(getArg('--output'), path.join(inputRoot, 'index'), repoRoot);
    const result = runBuildIndex({ inputRoot, outputRoot, repoRoot });
    console.log(JSON.stringify({ documentCount: result.documentCount, fingerprint: result.fingerprintSha256, output: outputRoot }, null, 2));
    return;
  }

  if (cmd === 'retrieve') {
    const inputRoot = resolvePathArg(getArg('--input'), defaultStage3j2fOutput(repoRoot), repoRoot);
    const query = getArg('--query');
    if (!query) throw new Error('retrieve requires --query');
    const roles = (getArg('--roles') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const result = runRetrieve({
      inputRoot,
      query: {
        query,
        productFamily: getArg('--product-family'),
        productSurface: getArg('--product-surface'),
        domain: getArg('--domain'),
        tenantId: getArg('--tenant'),
        roles,
      },
    });
    mkdirSync(path.join(inputRoot, 'retrieval-results'), { recursive: true });
    writeFileSync(
      path.join(inputRoot, 'retrieval-results', 'latest.json'),
      JSON.stringify(
        {
          query,
          stats: result.stats,
          hits: result.hits.map((h) => ({
            unitId: h.unit.runtimeKnowledgeUnitId,
            mode: h.unit.knowledgeMode,
            rankBucket: h.rankBucket,
            score: h.score,
            ownership: h.unit.sourcePolicy.sourceOwnership,
          })),
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ stats: result.stats, hitCount: result.hits.length }, null, 2));
    return;
  }

  if (cmd === 'build-answer-plan') {
    const inputRoot = resolvePathArg(getArg('--input'), defaultStage3j2fOutput(repoRoot), repoRoot);
    const query = getArg('--query');
    if (!query) throw new Error('build-answer-plan requires --query');
    const output = resolvePathArg(
      getArg('--output'),
      path.join(inputRoot, 'answer-plans', 'latest.json'),
      repoRoot,
    );
    const planned = runBuildAnswerPlan({
      inputRoot,
      query,
      productFamily: getArg('--product-family'),
      productSurface: getArg('--product-surface'),
      domain: getArg('--domain'),
      outputPath: output,
    });
    console.log(
      JSON.stringify(
        {
          answerPlanId: planned.plan.answerPlanId,
          answerability: planned.plan.answerability,
          claims: planned.plan.claims.length,
          visibleCitations: planned.plan.visibleCitations.length,
          runtimeStatus: planned.plan.runtimeStatus,
          output,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'render-fixture-answer') {
    const planPath = getArg('--answer-plan');
    if (!planPath) throw new Error('render-fixture-answer requires --answer-plan');
    const abs = resolvePathArg(planPath, planPath, repoRoot);
    const plan = JSON.parse(readFileSync(abs, 'utf8')) as GroundedAnswerPlanV1;
    const inputRoot = defaultStage3j2fOutput(repoRoot);
    const denyTokens = existsSync(path.join(inputRoot, 'vendor-audit-pack', 'pack.json'))
      ? (JSON.parse(readFileSync(path.join(inputRoot, 'vendor-audit-pack', 'pack.json'), 'utf8')) as { denyTokens: string[] })
          .denyTokens
      : [];
    const rendered = runRenderFixtureAnswer({ plan, denyTokens });
    console.log(JSON.stringify({ answer: rendered.answer, payload: rendered.payload, leakBlocked: rendered.leak.blocked }, null, 2));
    return;
  }

  if (cmd === 'explain-internal-trace') {
    if (!hasFlag('--confirm-vendor-audit')) {
      throw new Error('explain-internal-trace requires --confirm-vendor-audit');
    }
    const traceId = getArg('--trace-id');
    if (!traceId) throw new Error('explain-internal-trace requires --trace-id');
    const inputRoot = defaultStage3j2fOutput(repoRoot);
    const dir = path.join(inputRoot, 'internal-traces');
    if (!existsSync(dir)) throw new Error('no internal traces');
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
    let found = null as unknown;
    for (const f of files) {
      const t = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (t?.internalTraceId === traceId) {
        found = t;
        break;
      }
    }
    console.log(JSON.stringify(found ?? { error: 'trace_not_found' }, null, 2));
    if (!found) process.exit(1);
    return;
  }

  if (cmd === 'smoke-local-model') {
    if (!hasFlag('--confirm-local-model-call')) {
      throw new Error('smoke-local-model requires --confirm-local-model-call');
    }
    console.log(
      JSON.stringify(
        {
          skipped: true,
          reason: 'stage3j2f_iteration_forbids_real_local_model_calls',
          realLocalModelCalls: 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'run-pilot') {
    const outputRoot = resolvePathArg(getArg('--output'), defaultStage3j2fOutput(repoRoot), repoRoot);
    if (!existsSync(path.join(outputRoot, 'vendor-runtime-pack', 'pack.json'))) {
      runBuildRuntimePacks({
        repoRoot,
        approvalStore: defaultStage3j2eStore(repoRoot),
        correlationStore: defaultStage3j2dStore(repoRoot),
        candidateStore: defaultStage3j2cStore(repoRoot),
        sourceStore: defaultStage3j2bStore(repoRoot),
        outputRoot,
      });
      runBuildIndex({ inputRoot: outputRoot, outputRoot: path.join(outputRoot, 'index'), repoRoot });
    }
    const results = runPilotRfCases({ inputRoot: outputRoot, outputRoot, repoRoot });
    console.log(JSON.stringify({ results }, null, 2));
    return;
  }

  if (cmd === 'audit') {
    try {
      const audit = buildStage3j2fAudit(repoRoot, { strict: hasFlag('--strict') });
      console.log(
        JSON.stringify(
          {
            stage3j2fStatus: audit.stage3j2fStatus,
            strictErrors: audit.strictErrors,
            runtimeUnits: audit.runtimeUnits,
            realPilot: {
              rf01: audit.realPilot.results.find((r) => r.id === 'RF01'),
              rf02: audit.realPilot.results.find((r) => r.id === 'RF02'),
              rf03: audit.realPilot.results.find((r) => r.id === 'RF03'),
              rf04: audit.realPilot.results.find((r) => r.id === 'RF04'),
              rf05: audit.realPilot.results.find((r) => r.id === 'RF05'),
            },
          },
          null,
          2,
        ),
      );
      if (hasFlag('--strict') && audit.strictErrors.length) process.exit(1);
    } catch (e) {
      console.error(String(e));
      process.exit(1);
    }
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
