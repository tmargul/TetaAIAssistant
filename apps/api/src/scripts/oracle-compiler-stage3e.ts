/**
 * Stage 3E CLI — compile | compile-reference-bhp | validate | audit.
 *
 * pnpm --filter @teta/api run compiler:stage3e -- <subcommand> [...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
import { STAGE3D_BINDINGS_VERSION } from '../teta-business-semantics/teta-business-semantics.types';
import { TetaOracleSelectCompilerService } from '../teta-oracle-compiler/teta-oracle-select-compiler.service';
import {
  STAGE3E_DIALECT,
  type CompilableQueryPlan,
} from '../teta-oracle-compiler/teta-oracle-compiler.types';
import {
  STAGE3E_REFERENCE_BHP_QUESTION,
  runStage3eAudit,
  writeAndVerifyStage3eArtifacts,
} from '../teta-oracle-compiler/teta-stage3e-audit';

type Args = {
  cmd: string;
  json: boolean;
  pretty: boolean;
  strict: boolean;
  sql: boolean;
  question?: string;
  plan?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    cmd: 'compile-reference-bhp',
    json: false,
    pretty: false,
    strict: false,
    sql: false,
  };
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
    else if (a === '--sql') args.sql = true;
    else if (a === '--question') args.question = next();
    else if (a === '--plan') args.plan = next();
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

/** Stage 3A index → Stage 3D semantics → Stage 3B evidence → Stage 3C plan → Stage 3E compiler. */
function buildLivePipeline(repoRoot: string) {
  const apiRoot = path.join(repoRoot, 'apps', 'api');
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

  const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
  const evidencePlanner = new TetaEvidencePlannerService({
    configs,
    resolver,
    graphSourceHash: status.sourceHash,
  });

  const graph = wrapStage3aResolver(resolver);
  const queryPlanner = new TetaReadOnlyQueryPlannerService({
    templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
    safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
    graph,
    graphSourceHash: status.sourceHash,
    graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    semanticResolver,
  });

  const compiler = new TetaOracleSelectCompilerService({
    graph,
    graphSourceHash: status.sourceHash,
    graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
    semanticBindingsVersion: STAGE3D_BINDINGS_VERSION,
  });

  const planFor = (question: string): CompilableQueryPlan =>
    queryPlanner.plan({
      evidencePlan: evidencePlanner.plan({ question }),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });

  return { status, compiler, planFor };
}

function loadPlanFromFile(filePath: string): CompilableQueryPlan {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as
    | CompilableQueryPlan
    | { queryPlan: CompilableQueryPlan };
  const plan = 'queryPlan' in raw ? raw.queryPlan : raw;
  if (!plan?.contractVersion) {
    throw new Error(`File ${filePath} does not contain a Stage 3C query plan`);
  }
  return plan;
}

function writeLocalArtifacts(
  repoRoot: string,
  fileStem: string,
  payload: unknown,
  sqlText: string | null,
) {
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
  writeFileSync(
    path.join(localDir, `${fileStem}.json`),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(localDir, `${fileStem}.sql`),
    sqlText ? `${sqlText}\n` : '',
    'utf8',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromCwd();

  if (args.cmd === 'compile' || args.cmd === 'compile-reference-bhp') {
    const question =
      args.cmd === 'compile-reference-bhp'
        ? STAGE3E_REFERENCE_BHP_QUESTION
        : (args.question ?? STAGE3E_REFERENCE_BHP_QUESTION);

    let compiler: TetaOracleSelectCompilerService;
    let queryPlan: CompilableQueryPlan;

    if (args.plan) {
      queryPlan = loadPlanFromFile(path.resolve(repoRoot, args.plan));
      const { status, resolver } = openGraph(repoRoot);
      compiler = new TetaOracleSelectCompilerService({
        graph: wrapStage3aResolver(resolver),
        graphSourceHash: status.sourceHash,
        graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
        semanticBindingsVersion: STAGE3D_BINDINGS_VERSION,
      });
    } else {
      const pipeline = buildLivePipeline(repoRoot);
      compiler = pipeline.compiler;
      queryPlan = pipeline.planFor(question);
    }

    const compiled = compiler.compile({
      queryPlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      dialect: STAGE3E_DIALECT,
    });

    const stem =
      args.cmd === 'compile-reference-bhp'
        ? 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp'
        : 'AIA_ORACLE_SELECT_COMPILER_STAGE3E.compile';
    writeLocalArtifacts(repoRoot, stem, { queryPlan, compiled }, compiled.sqlText);

    if (args.sql) {
      // eslint-disable-next-line no-console
      console.log(compiled.sqlText ?? '');
    } else {
      out(
        {
          question,
          sourcePlanStatus: queryPlan.planStatus,
          compileStatus: compiled.compileStatus,
          rejection: compiled.rejection,
          sqlSha256: compiled.sqlSha256,
          sqlText: compiled.sqlText,
          binds: compiled.binds,
          validation: compiled.validation,
          warnings: compiled.warnings,
          audit: compiled.audit,
        },
        args,
      );
    }
    if (args.strict && compiled.compileStatus !== 'compiled') process.exitCode = 1;
    return;
  }

  if (args.cmd === 'validate') {
    const pipeline = args.plan ? null : buildLivePipeline(repoRoot);
    let compiler: TetaOracleSelectCompilerService;
    let queryPlan: CompilableQueryPlan;
    if (pipeline) {
      compiler = pipeline.compiler;
      queryPlan = pipeline.planFor(args.question ?? STAGE3E_REFERENCE_BHP_QUESTION);
    } else {
      queryPlan = loadPlanFromFile(path.resolve(repoRoot, args.plan!));
      const { status, resolver } = openGraph(repoRoot);
      compiler = new TetaOracleSelectCompilerService({
        graph: wrapStage3aResolver(resolver),
        graphSourceHash: status.sourceHash,
        graphIndexSchemaVersion: status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
        semanticBindingsVersion: STAGE3D_BINDINGS_VERSION,
      });
    }
    const compiled = compiler.compile({
      queryPlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      dialect: STAGE3E_DIALECT,
    });
    out(
      {
        sourcePlanStatus: queryPlan.planStatus,
        compileStatus: compiled.compileStatus,
        rejection: compiled.rejection,
        sqlSha256: compiled.sqlSha256,
        validation: compiled.validation,
        sources: compiled.sources.map((s) => ({
          alias: s.alias,
          role: s.sourceRole,
          object: s.qualifiedName,
        })),
        accessColumnRemaps: compiled.audit.accessColumnRemaps,
        warnings: compiled.warnings,
      },
      args,
    );
    if (args.strict && (!compiled.validation.ok || compiled.compileStatus !== 'compiled')) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.cmd === 'audit') {
    const pipeline = buildLivePipeline(repoRoot);
    const livePlan = pipeline.planFor(STAGE3E_REFERENCE_BHP_QUESTION);
    const { report, live } = runStage3eAudit({
      liveCompiler: pipeline.compiler,
      livePlan,
      graphSourceHash: pipeline.status.sourceHash,
      graphIndexSchemaVersion:
        pipeline.status.indexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION,
      semanticBindingsVersion: STAGE3D_BINDINGS_VERSION,
    });
    writeAndVerifyStage3eArtifacts({ report, repoRoot, live, livePlan });
    out(report, args);
    if (args.strict && report.strictErrors.length) {
      // eslint-disable-next-line no-console
      console.error('Stage 3E audit --strict FAILED:\n' + report.strictErrors.join('\n'));
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(
    `Unknown subcommand: ${args.cmd}. Use compile | compile-reference-bhp | validate | audit`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
