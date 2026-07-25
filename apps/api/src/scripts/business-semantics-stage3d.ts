/**
 * Stage 3D CLI — discover | validate | explain-role | plan-reference-bhp | audit.
 *
 * pnpm --filter @teta/api run semantics:stage3d -- <subcommand> [...]
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import { STAGE3A_INDEX_SCHEMA_VERSION } from '../teta-plugins/teta-stage3a.types';
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
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import {
  defaultOntologyPath,
  loadBusinessOntology,
} from '../teta-business-semantics/teta-business-ontology-loader';
import {
  defaultBindingsPath,
  defaultLanguagePath,
  loadBusinessLanguage,
  loadSemanticBindings,
} from '../teta-business-semantics/teta-semantic-bindings-loader';
import { TetaBusinessRoleResolver } from '../teta-business-semantics/teta-business-role-resolver';
import {
  runStage3dAudit,
  writeStage3dAuditArtifacts,
  STAGE3D_REFERENCE_BHP_QUESTION,
} from '../teta-business-semantics/teta-stage3d-audit';
import { resolveValuePath } from '../teta-business-semantics/teta-semantic-value-path-resolver';
import { resolveTemporalRule } from '../teta-business-semantics/teta-semantic-temporal-rule-resolver';

type Args = {
  cmd: string;
  json: boolean;
  pretty: boolean;
  strict: boolean;
  subject?: string;
  role?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { cmd: 'validate', json: false, pretty: false, strict: false };
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
    else if (a === '--subject') args.subject = next();
    else if (a === '--role') args.role = next();
  }
  return args;
}

function repoRootFromCwd(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'config', 'teta-business-ontology-v1.json'))) {
    return path.resolve(cwd, '..', '..');
  }
  if (existsSync(path.join(cwd, 'apps', 'api', 'config', 'teta-business-ontology-v1.json'))) {
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
      ].join('\n'),
    );
  }
  if (!status.sourceHash) {
    throw new Error('Stage 3A index missing sourceHash in metadata');
  }
  const resolver = new CanonicalGraphResolverService(index.openReadonly());
  return { index, status, resolver, paths };
}

function buildSemanticResolver(repoRoot: string, apiRoot: string) {
  const { status, resolver } = openGraph(repoRoot);
  const ontology = loadBusinessOntology(defaultOntologyPath(apiRoot));
  const bindings = loadSemanticBindings(defaultBindingsPath(apiRoot));
  const language = loadBusinessLanguage(defaultLanguagePath(apiRoot));
  const semanticResolver = new TetaBusinessRoleResolver({
    ontology,
    bindings,
    language,
    resolver,
    graphSourceHash: status.sourceHash,
  });
  return { status, resolver, semanticResolver, ontology, bindings, language };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromCwd();
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const subject = args.subject ?? STAGE3C_SUPPORTED_SUBJECT;

  if (args.cmd === 'discover') {
    if (!args.role) throw new Error('--role is required for discover');
    const { semanticResolver } = buildSemanticResolver(repoRoot, apiRoot);
    out(semanticResolver.discoverCandidates(subject, args.role), args);
    return;
  }

  if (args.cmd === 'validate') {
    const { semanticResolver, status } = buildSemanticResolver(repoRoot, apiRoot);
    const result = semanticResolver.validateRegistry();
    out(
      {
        graphSourceHash: status.sourceHash,
        result,
        subjectResolution: semanticResolver.resolveSubject(subject),
      },
      args,
    );
    if (args.strict && !result.ok) process.exitCode = 1;
    return;
  }

  if (args.cmd === 'explain-role') {
    if (!args.role) throw new Error('--role is required for explain-role');
    const { semanticResolver } = buildSemanticResolver(repoRoot, apiRoot);
    const role = args.role;
    out(
      {
        subject,
        role,
        source: semanticResolver.getApprovedSource(subject, role),
        projection: semanticResolver.getApprovedProjection(subject, role),
        relation: semanticResolver.getApprovedRelation(subject, role),
        temporal: semanticResolver.getApprovedTemporal(subject, role),
        valuePath: semanticResolver.getApprovedValuePath(subject, role),
        valuePathResolved: resolveValuePath(
          semanticResolver.getApprovedValuePath(subject, role),
        ),
        temporalResolved: resolveTemporalRule(
          semanticResolver.getApprovedTemporal(subject, role),
        ),
        discovery: semanticResolver.discoverCandidates(subject, role),
        label: semanticResolver.language?.labels?.[role] ?? null,
      },
      args,
    );
    return;
  }

  if (args.cmd === 'plan-reference-bhp') {
    const { status, resolver, semanticResolver } = buildSemanticResolver(repoRoot, apiRoot);
    const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
    const evidencePlanner = new TetaEvidencePlannerService({
      configs,
      resolver,
      graphSourceHash: status.sourceHash,
    });
    const evidencePlan = evidencePlanner.plan({ question: STAGE3D_REFERENCE_BHP_QUESTION });
    const templates = loadReportTemplates(defaultReportTemplatePath(apiRoot));
    const safety = loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot));
    const queryPlanner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: wrapStage3aResolver(resolver),
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
      semanticResolver,
    });
    const queryPlan = queryPlanner.plan({
      evidencePlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });
    const semantics = semanticResolver.resolveSubject(STAGE3C_SUPPORTED_SUBJECT);
    const localDir = path.join(repoRoot, '.local');
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
    writeFileSync(
      path.join(localDir, 'AIA_BUSINESS_SEMANTICS_STAGE3D.reference-bhp.json'),
      JSON.stringify({ evidencePlan, semantics, queryPlan }, null, 2),
      'utf8',
    );
    out(
      {
        evidencePlanningStatus: evidencePlan.planningStatus,
        semanticsStatus: semantics.status,
        queryPlan,
        positionNamePath: resolveValuePath(
          semanticResolver.getApprovedValuePath(STAGE3C_SUPPORTED_SUBJECT, 'position_name'),
        ).pathSummary,
        examinationTypeNamePath: resolveValuePath(
          semanticResolver.getApprovedValuePath(
            STAGE3C_SUPPORTED_SUBJECT,
            'examination_type_name',
          ),
        ).pathSummary,
      },
      args,
    );
    return;
  }

  if (args.cmd === 'audit') {
    const { status, resolver, semanticResolver } = buildSemanticResolver(repoRoot, apiRoot);
    const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
    const evidencePlanner = new TetaEvidencePlannerService({
      configs,
      resolver,
      graphSourceHash: status.sourceHash,
    });
    const templates = loadReportTemplates(defaultReportTemplatePath(apiRoot));
    const safety = loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot));
    const queryPlanner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: wrapStage3aResolver(resolver),
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
      semanticResolver,
    });
    const report = runStage3dAudit({
      semanticResolver,
      queryPlanner,
      evidencePlanner,
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    });
    const evidenceA = evidencePlanner.plan({ question: STAGE3D_REFERENCE_BHP_QUESTION });
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
    writeStage3dAuditArtifacts(report, repoRoot, referenceBhp);
    out(report, args);
    if (args.strict && report.strictErrors.length) {
      // eslint-disable-next-line no-console
      console.error('Stage 3D audit --strict FAILED:\n' + report.strictErrors.join('\n'));
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(
    `Unknown subcommand: ${args.cmd}. Use discover | validate | explain-role | plan-reference-bhp | audit`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
