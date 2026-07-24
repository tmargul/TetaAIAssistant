/**
 * Stage 3C CLI — plan / plan-reference-bhp / templates / audit.
 *
 * pnpm --filter @teta/api run query:stage3c -- <subcommand> [...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import { defaultPlannerConfigDir, loadPlannerConfigs } from '../teta-planner/teta-intent-catalog';
import { TetaEvidencePlannerService } from '../teta-planner/teta-evidence-planner.service';
import {
  defaultReportTemplatePath,
  loadReportTemplates,
} from '../teta-query-planner/teta-report-template-loader';
import {
  defaultSafetyPolicyPath,
  loadSafetyPolicy,
} from '../teta-query-planner/teta-query-safety-policy';
import { wrapStage3aResolver } from '../teta-query-planner/teta-query-graph-client';
import { TetaReadOnlyQueryPlannerService } from '../teta-query-planner/teta-readonly-query-planner.service';
import {
  runStage3cAudit,
  writeStage3cAuditArtifacts,
  STAGE3C_REFERENCE_BHP_QUESTION,
} from '../teta-query-planner/teta-stage3c-audit';
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import { createFixtureGraphClient } from '../teta-query-planner/teta-query-graph-client';
import {
  buildBhpFixtureGraph,
  minimalReadyEvidencePlan,
} from '../teta-query-planner/teta-stage3c-fixtures';
import { STAGE3A_INDEX_SCHEMA_VERSION } from '../teta-plugins/teta-stage3a.types';
import type { TetaEvidencePlan as EvidencePlan } from '../teta-planner/teta-stage3b.types';

type Args = {
  cmd: string;
  json: boolean;
  pretty: boolean;
  strict: boolean;
  evidencePlanFile?: string;
  expectedSubject?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { cmd: 'templates', json: false, pretty: false, strict: false };
  if (argv[0] && !argv[0].startsWith('-')) {
    args.cmd = argv[0];
    argv = argv.slice(1);
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i];
    if (a === '--json') args.json = true;
    else if (a === '--pretty') args.pretty = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--evidence-plan-file') args.evidencePlanFile = next();
    else if (a === '--expected-subject') args.expectedSubject = next();
  }
  return args;
}

function repoRootFromCwd(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'config', 'teta-report-query-templates-v1.json'))) {
    return path.resolve(cwd, '..', '..');
  }
  if (existsSync(path.join(cwd, 'apps', 'api', 'config', 'teta-report-query-templates-v1.json'))) {
    return cwd;
  }
  return path.resolve(cwd, '..', '..');
}

function out(obj: unknown, args: Args) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(obj, null, args.pretty || !args.json ? 2 : undefined));
}

function openGraph(repoRoot: string) {
  const paths = defaultStage3aPaths(repoRoot);
  const index = new CanonicalGraphIndexService(paths);
  const status = index.status();
  if (!status.exists) {
    throw new Error(
      [
        `Brak indeksu Stage 3A: ${paths.indexPath}`,
        'Zbuduj indeks: pnpm --filter @teta/api run graph:stage3a -- build',
        'Nie przebudowuję automatycznie Stage 3A.',
      ].join('\n'),
    );
  }
  if (!status.sourceHash) {
    throw new Error('Stage 3A index missing sourceHash in metadata');
  }
  const resolver = new CanonicalGraphResolverService(index.openReadonly());
  return { index, status, resolver, paths };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromCwd();
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const templates = loadReportTemplates(defaultReportTemplatePath(apiRoot));
  const safety = loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot));

  if (args.cmd === 'templates') {
    out(
      {
        version: templates.version,
        subjects: templates.templates.map((t) => ({
          subject: t.subject,
          intent: t.intent,
          requiredSourceRoles: t.requiredSourceRoles,
          requiredProjectionRoles: t.requiredProjectionRoles,
          requiredFilters: t.requiredFilters,
          defaultOrdering: t.defaultOrdering,
        })),
        safetyPolicyVersion: safety.version,
        limits: {
          maxRows: safety.maxRows,
          maxColumns: safety.maxColumns,
          statementTimeoutMs: safety.statementTimeoutMs,
        },
      },
      args,
    );
    return;
  }

  if (args.cmd === 'plan') {
    if (!args.evidencePlanFile) {
      throw new Error('--evidence-plan-file is required for plan');
    }
    const filePath = path.isAbsolute(args.evidencePlanFile)
      ? args.evidencePlanFile
      : path.resolve(repoRoot, args.evidencePlanFile);
    const evidencePlan = JSON.parse(readFileSync(filePath, 'utf8')) as EvidencePlan;
    const { status, resolver } = openGraph(repoRoot);
    const queryPlanner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: wrapStage3aResolver(resolver),
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    });
    const plan = queryPlanner.plan({
      evidencePlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: args.expectedSubject ?? STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
    out(plan, args);
    return;
  }

  if (args.cmd === 'plan-reference-bhp') {
    const { status, resolver } = openGraph(repoRoot);
    const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
    const evidencePlanner = new TetaEvidencePlannerService({
      configs,
      resolver,
      graphSourceHash: status.sourceHash,
    });
    const evidencePlan = evidencePlanner.plan({ question: STAGE3C_REFERENCE_BHP_QUESTION });
    const queryPlanner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: wrapStage3aResolver(resolver),
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    });
    const plan = queryPlanner.plan({
      evidencePlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
    const localDir = path.join(repoRoot, '.local');
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
    writeFileSync(
      path.join(localDir, 'AIA_READ_ONLY_QUERY_PLANNER_STAGE3C.reference-bhp.json'),
      JSON.stringify({ evidencePlan, queryPlan: plan }, null, 2),
      'utf8',
    );
    out({ evidencePlanningStatus: evidencePlan.planningStatus, queryPlan: plan }, args);
    return;
  }

  if (args.cmd === 'audit') {
    const { status, resolver } = openGraph(repoRoot);
    const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
    const evidencePlanner = new TetaEvidencePlannerService({
      configs,
      resolver,
      graphSourceHash: status.sourceHash,
    });
    const queryPlanner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: wrapStage3aResolver(resolver),
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    });

    // Fixture refs E/F (owner policy + missing join) — deterministic, no hardcoding in live planner
    const fixturePlanner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: createFixtureGraphClient(buildBhpFixtureGraph({ includeHrmUnknown: true })),
      graphSourceHash: 'fixture-graph-hash',
      graphIndexSchemaVersion: STAGE3A_INDEX_SCHEMA_VERSION,
    });
    const fixtureEvidence = minimalReadyEvidencePlan('fixture-graph-hash');
    const planE = fixturePlanner.plan({
      evidencePlan: fixtureEvidence,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const fixturePlannerF = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: createFixtureGraphClient(buildBhpFixtureGraph({ omitJoins: true })),
      graphSourceHash: 'fixture-graph-hash',
      graphIndexSchemaVersion: STAGE3A_INDEX_SCHEMA_VERSION,
    });
    const planF = fixturePlannerF.plan({
      evidencePlan: fixtureEvidence,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });

    const report = runStage3cAudit({
      queryPlanner,
      evidencePlanner,
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
      fixtureQueryPlans: { E: planE, F: planF },
    });

    const evidenceA = evidencePlanner.plan({ question: STAGE3C_REFERENCE_BHP_QUESTION });
    const referenceBhp = queryPlanner.plan({
      evidencePlan: evidenceA,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
    writeStage3cAuditArtifacts(report, repoRoot, referenceBhp);
    out(report, args);
    if (args.strict && report.strictErrors.length) {
      // eslint-disable-next-line no-console
      console.error('Stage 3C audit --strict FAILED:\n' + report.strictErrors.join('\n'));
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unknown subcommand: ${args.cmd}. Use plan | plan-reference-bhp | templates | audit`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
