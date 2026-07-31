import fs from 'fs';
import path from 'path';
import { analyzeGenericQuery } from '../teta-generic-query/teta-logical-request-builder';
import { loadStage3k1Configs } from '../teta-generic-query/teta-query-capability-registry';
import { STAGE3K1_FIXTURES } from '../teta-generic-query/teta-stage3k1-fixtures';
import {
  bindFromAnalysis,
  buildStage3k2aAudit,
  collectBindingNodeIdsFromConfigs,
  createPassthroughGraphValidator,
  loadStage3k2aConfigs,
  scanRuntimeSafeDtoLeaks,
  toRuntimeSafeSemanticDto,
  SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
  type BindOptions,
  type BindOutput,
} from '../teta-generic-semantic-binding';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function summarizeBinding(out: BindOutput, id: string, query: string, analysis: ReturnType<typeof analyzeGenericQuery>) {
  const { result, evidenceTrace } = out;
  const runtimeSafe = toRuntimeSafeSemanticDto(result);
  return {
    id,
    query,
    stage3k1: {
      analysisKind: analysis.analysisKind,
      interpretation: analysis.interpretationStatus,
      capability: analysis.capabilityStatus,
      executionEligibility: analysis.executionEligibility,
    },
    semantic: {
      resultStatus: result.resultStatus,
      resultGrain: result.resultGrain,
      executionEligibility: result.executionEligibility,
      planningReadiness: result.planningReadiness,
      rootBinding: result.rootBinding,
      fieldBindings: result.fieldBindings,
      filterBindings: result.filterBindings,
      relationBindings: result.relationBindings,
      temporalBinding: result.temporalBinding,
      clarifications: result.clarifications,
      warnings: result.warnings,
      planningEligibilities: [
        result.rootBinding,
        ...result.fieldBindings,
        ...result.filterBindings,
        ...result.relationBindings,
        result.temporalBinding,
      ]
        .filter(Boolean)
        .map((b) => ({
          id: b!.logicalElementId,
          planningEligibility: b!.planningEligibility,
          bindingStatus: b!.bindingStatus,
          approvalReuseStatus: b!.approvalReuseStatus,
          evidenceStatus: b!.evidenceStatus,
        })),
    },
    internalResult: result,
    runtimeSafeDto: runtimeSafe,
    evidenceTraceSummary: {
      bindingRefs: evidenceTrace.stage3dBindingRefs,
      nodeCount: evidenceTrace.graphNodeIds.length,
      edgeCount: evidenceTrace.graphEdgeIds.length,
      pathCount: evidenceTrace.graphPathIds.length,
      reasons: evidenceTrace.validationReasons,
      conflicts: evidenceTrace.conflicts,
      diagnosticCandidates: evidenceTrace.diagnosticCandidates,
    },
  };
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'audit';
  const repoRoot = resolveRepoRoot();

  if (cmd === 'validate-config') {
    const r = loadStage3k2aConfigs(repoRoot);
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exit(1);
    return;
  }

  if (cmd === 'bind') {
    const query = getArg('--query');
    if (!query) {
      console.error('Missing --query');
      process.exit(1);
    }
    const k1 = loadStage3k1Configs(repoRoot);
    const k2 = loadStage3k2aConfigs(repoRoot);
    if (!k1.ok || !k1.configs || !k2.ok || !k2.configs) {
      console.error('config_invalid');
      process.exit(1);
    }
    const analysis = analyzeGenericQuery(query, k1.configs);
    const graph = createPassthroughGraphValidator(
      collectBindingNodeIdsFromConfigs(repoRoot),
      k2.configs.bindings.graphSourceHash,
    );
    const out = bindFromAnalysis(analysis, { configs: k2.configs, graph });
    console.log(
      JSON.stringify(
        {
          analysisKind: analysis.analysisKind,
          result: out.result,
          runtimeSafeDto: toRuntimeSafeSemanticDto(out.result),
          evidenceTraceSummary: {
            bindingRefs: out.evidenceTrace.stage3dBindingRefs,
            nodeCount: out.evidenceTrace.graphNodeIds.length,
            reasons: out.evidenceTrace.validationReasons,
            diagnosticCandidates: out.evidenceTrace.diagnosticCandidates,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'bind-request') {
    const inputPath = getArg('--input');
    if (!inputPath) {
      console.error('Missing --input <3K1 logical request / analysis fixture JSON>');
      process.exit(1);
    }
    const k2 = loadStage3k2aConfigs(repoRoot);
    if (!k2.ok || !k2.configs) {
      console.error('config_invalid');
      process.exit(1);
    }
    const analysis = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
    const graph = createPassthroughGraphValidator(
      collectBindingNodeIdsFromConfigs(repoRoot),
      k2.configs.bindings.graphSourceHash,
    );
    const out = bindFromAnalysis(analysis, { configs: k2.configs, graph });
    console.log(
      JSON.stringify(
        {
          result: out.result,
          runtimeSafeDto: toRuntimeSafeSemanticDto(out.result),
          evidenceTraceSummary: out.evidenceTrace,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === 'run-fixtures' || cmd === 'audit') {
    const audit = buildStage3k2aAudit(repoRoot);
    console.log(JSON.stringify(audit, null, 2));
    if (process.argv.includes('--strict') && audit.strictErrors.length) process.exit(1);
    return;
  }

  if (cmd === 'human-review' || cmd === 'human-review-v2') {
    const k1 = loadStage3k1Configs(repoRoot);
    const k2 = loadStage3k2aConfigs(repoRoot);
    if (!k1.ok || !k1.configs || !k2.ok || !k2.configs) {
      console.error('config_invalid');
      process.exit(1);
    }
    const configs = k2.configs;
    const graph = createPassthroughGraphValidator(
      collectBindingNodeIdsFromConfigs(repoRoot),
      configs.bindings.graphSourceHash,
    );

    const focusIds = new Set(['K1', 'K2', 'K4', 'K5', 'K11', 'K12']);
    const fixtures = STAGE3K1_FIXTURES.map((fx) => {
      const analysis = analyzeGenericQuery(fx.query, k1.configs!);
      const out = bindFromAnalysis(analysis, { configs, graph });
      return summarizeBinding(out, fx.id, fx.query, analysis);
    });
    const focus = fixtures.filter((f) => focusIds.has(f.id));

    const k1Fx = STAGE3K1_FIXTURES.find((f) => f.id === 'K1')!;
    const sScenarios: Array<{ id: string; note: string; options: BindOptions; query?: string }> = [
      {
        id: 'S1',
        note: 'wrong graphSourceHash → stale propagation',
        options: { configs, graph, overrideGraphSourceHash: 'deadbeef'.repeat(8) },
      },
      {
        id: 'S2',
        note: 'missing graph evidence → invalid + planning blocked',
        options: {
          configs,
          graph: { graphSourceHash: configs.bindings.graphSourceHash, nodeExists: () => false },
        },
      },
      {
        id: 'S3',
        note: 'discovered diagnostics retained (not runtime)',
        options: { configs, graph, injectDiscoveredDiagnostic: true },
      },
      {
        id: 'S4',
        note: 'synthetic fixture policy → two reusable roles',
        options: {
          configs,
          graph,
          forceTwoCandidateClarification: true,
          fixturePolicyOverride: SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
        },
      },
      {
        id: 'S5',
        note: 'scope restricted → planning blocked',
        options: { configs, graph },
      },
      {
        id: 'S6',
        note: 'shortest path ignored',
        options: { configs, graph },
      },
      {
        id: 'S7',
        note: 'leading zero employee number 00122',
        query: 'Jakie stanowisko ma pracownik 00122?',
        options: { configs, graph },
      },
      {
        id: 'S8',
        note: 'delegated Stage3K1 → no binding',
        query: STAGE3K1_FIXTURES.find((f) => f.id === 'K8')!.query,
        options: { configs, graph },
      },
      {
        id: 'S9',
        note: 'rejected Stage3K1 → no binding',
        query: STAGE3K1_FIXTURES.find((f) => f.id === 'N1')!.query,
        options: { configs, graph },
      },
      {
        id: 'S10',
        note: 'runtime-safe DTO — no internal provenance',
        options: { configs, graph },
      },
    ];

    const specials = sScenarios.map((s) => {
      const query = s.query ?? k1Fx.query;
      const analysis = analyzeGenericQuery(query, k1.configs!);
      const out = bindFromAnalysis(analysis, s.options);
      const summary = summarizeBinding(out, s.id, query, analysis);
      return {
        ...summary,
        note: s.note,
        runtimeLeakScan: scanRuntimeSafeDtoLeaks(summary.runtimeSafeDto),
        counters: out.counters,
      };
    });

    const audit = buildStage3k2aAudit(repoRoot);
    const dir = path.join(repoRoot, '.local');
    fs.mkdirSync(dir, { recursive: true });
    const suffix = cmd === 'human-review-v2' ? '-v2' : '';
    const jsonPath = path.join(dir, `stage3k2a-human-review${suffix}.json`);
    const mdPath = path.join(dir, `stage3k2a-human-review${suffix}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify({ focus, fixtures, specials, audit }, null, 2));

    const md = [
      '# Stage 3K.2A Human Review v2 (safety cleanup)',
      '',
      `Status: ${audit.stage3k2aStatus}`,
      `Stage 3K.2: ${audit.stage3k2Status}`,
      '',
      '## Focus fixtures',
      '',
      ...focus.map(
        (r) =>
          `- **${r.id}**: ${r.semantic.resultStatus} | planning=${r.semantic.planningReadiness} | grain=${r.semantic.resultGrain} | exec=${r.semantic.executionEligibility} | temporalTarget=${r.semantic.temporalBinding?.temporalLogicalTarget ?? 'null'} | temporalRole=${r.semantic.temporalBinding?.resolvedRoleKey ?? 'null'}`,
      ),
      '',
      '### Planning eligibility (focus)',
      '',
      ...focus.flatMap((r) =>
        (r.semantic.planningEligibilities ?? []).map(
          (p: { id: string; planningEligibility: string; bindingStatus: string; approvalReuseStatus: string }) =>
            `- ${r.id}/${p.id}: planning=${p.planningEligibility} status=${p.bindingStatus} reuse=${p.approvalReuseStatus}`,
        ),
      ),
      '',
      '## S1–S10',
      '',
      ...specials.map(
        (r) =>
          `- **${r.id}**: ${r.note} → ${r.semantic.resultStatus} | planning=${r.semantic.planningReadiness} | exec=${r.semantic.executionEligibility}`,
      ),
      '',
      '## Special audit',
      '',
      `- specialStaleBindingsObserved: ${audit.specialSafetyFixtureAudit.specialStaleBindingsObserved}`,
      `- specialInvalidBindingsObserved: ${audit.specialSafetyFixtureAudit.specialInvalidBindingsObserved}`,
      `- specialDiscoveredCandidatesObserved: ${audit.specialSafetyFixtureAudit.specialDiscoveredCandidatesObserved}`,
      `- specialAmbiguityCasesObserved: ${audit.specialSafetyFixtureAudit.specialAmbiguityCasesObserved}`,
      '',
      '## Production (K/N) element counts',
      '',
      `- stale: ${audit.productionFixtureAudit.elementBindingsStale}`,
      `- invalid: ${audit.productionFixtureAudit.elementBindingsInvalid}`,
      `- planningEligible: ${audit.productionFixtureAudit.planningEligibleBindings}`,
      '',
      '## Strict',
      '',
      `- strictErrors: ${JSON.stringify(audit.strictErrors)}`,
      `- executionEligibleResults: ${audit.executionEligibleResults}`,
      `- temporalBindingsAttachedToWrongLogicalTarget: ${audit.temporalBindingsAttachedToWrongLogicalTarget}`,
      `- runtimeApprovedBindingRefsExposed: ${audit.runtimeApprovedBindingRefsExposed}`,
      '',
      'Internal vs runtime: see JSON `internalResult` vs `runtimeSafeDto`. Evidence diagnostics are audit-only.',
    ].join('\n');
    fs.writeFileSync(mdPath, md);
    console.log(
      JSON.stringify(
        { ok: true, jsonPath, mdPath, fixtureCount: fixtures.length, specialCount: specials.length },
        null,
        2,
      ),
    );
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
