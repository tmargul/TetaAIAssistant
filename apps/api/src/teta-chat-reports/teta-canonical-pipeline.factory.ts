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
import type { CompilableQueryPlan } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';

export type Stage3gCanonicalPipeline = {
  evidencePlanner: TetaEvidencePlannerService;
  semanticResolver: TetaBusinessRoleResolver;
  queryPlanner: TetaReadOnlyQueryPlannerService;
  compiler: TetaOracleSelectCompilerService;
  graphSourceHash: string;
  planQuery: (evidencePlan: TetaEvidencePlan) => CompilableQueryPlan;
};

export function resolveRepoRootFromCwd(cwd = process.cwd()): string {
  // apps/api or monorepo root
  if (path.basename(cwd) === 'api' && path.basename(path.dirname(cwd)) === 'apps') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

export function buildCanonicalPipeline(repoRoot: string): Stage3gCanonicalPipeline {
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const paths = defaultStage3aPaths(repoRoot);
  const index = new CanonicalGraphIndexService(paths);
  const status = index.status();
  if (!status.exists || !status.sourceHash) {
    throw new Error(`Brak indeksu Stage 3A: ${paths.indexPath}`);
  }
  const resolver = new CanonicalGraphResolverService(index.openReadonly());
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

  const planQuery = (evidencePlan: TetaEvidencePlan): CompilableQueryPlan =>
    queryPlanner.plan({
      evidencePlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      runtimeAssumptions: {
        oracleUser: 'TETA_ADMIN',
        authorizationEnforcement: 'deferred',
        dateClock: 'oracle_sysdate',
      },
    });

  return {
    evidencePlanner,
    semanticResolver,
    queryPlanner,
    compiler,
    graphSourceHash: status.sourceHash,
    planQuery,
  };
}
