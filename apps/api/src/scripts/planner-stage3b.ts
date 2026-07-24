/**
 * Stage 3B CLI — plan / catalog / audit.
 *
 * pnpm --filter @teta/api run planner:stage3b -- <subcommand> [...]
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
import { runStage3bAudit } from '../teta-planner/teta-stage3b-audit';
import type { PlannerIntentType, TetaPlanningRequest } from '../teta-planner/teta-stage3b.types';
import { STAGE3B_CONTRACT_VERSION, STAGE3B_PLANNER_CONFIG_VERSION } from '../teta-planner/teta-stage3b.types';

type Args = {
  cmd: string;
  json: boolean;
  pretty: boolean;
  strict: boolean;
  question?: string;
  contextFile?: string;
  expectedIntent?: string;
  formGuid?: string;
  formName?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { cmd: 'catalog', json: false, pretty: false, strict: false };
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
    else if (a === '--question') args.question = next();
    else if (a === '--context-file') args.contextFile = next();
    else if (a === '--expected-intent') args.expectedIntent = next();
    else if (a === '--form-guid') args.formGuid = next();
    else if (a === '--form-name') args.formName = next();
  }
  return args;
}

function repoRootFromCwd(): string {
  // apps/api when run via pnpm --filter
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'config', 'teta-intent-catalog-v1.json'))) {
    return path.resolve(cwd, '..', '..');
  }
  if (existsSync(path.join(cwd, 'apps', 'api', 'config', 'teta-intent-catalog-v1.json'))) {
    return cwd;
  }
  return path.resolve(cwd, '..', '..');
}

function out(obj: unknown, args: Args) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(obj, null, args.pretty || !args.json ? 2 : undefined));
}

function buildDocs(report: ReturnType<typeof runStage3bAudit>, repoRoot: string) {
  const mdPath = path.join(repoRoot, 'docs', 'AIA_INTENT_EVIDENCE_PLANNER_STAGE3B.md');
  const jsonPath = path.join(repoRoot, 'docs', 'AIA_INTENT_EVIDENCE_PLANNER_STAGE3B.json');
  const json = {
    metadata: {
      stage: '3B',
      generatedAt: report.generatedAt,
      contractVersion: report.contractVersion,
      plannerConfigVersion: report.plannerConfigVersion,
      graphIndexSchemaVersion: report.graphIndexSchemaVersion,
      graphSourceHash: report.graphSourceHash,
    },
    audit: report,
  };
  writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');

  const md = `# AIA Intent & Evidence Planner — Stage 3B

Wygenerowano: **${report.generatedAt}**
contractVersion: \`${report.contractVersion}\`
plannerConfigVersion: \`${report.plannerConfigVersion}\`

## Architektura

- Moduł: \`apps/api/src/teta-planner/\`
- Konfiguracje: \`apps/api/config/teta-*-v1.json\`
- Klient Stage 3A: \`CanonicalGraphResolverService\` (bez NDJSON, bez własnego rankingu)
- **Bez** SQL gen / SQL exec / XLSX / Qdrant / embeddingów / LLM / agenta / Oracle write

## Kontrakt

- Request: \`TetaPlanningRequest\`
- Plan: \`TetaEvidencePlan\` (\`${STAGE3B_CONTRACT_VERSION}\`)
- Statusy: ready | needs_clarification | ambiguous | unsupported | invalid

### Semantyka \`planningStatus\`

- **ready** — komplet encji użytkownika; plan może przejść do kolejnego etapu zbierania dowodów. **Nie** oznacza zgody na generowanie/wykonanie SQL.
- **needs_clarification** — użytkownik musi podać brakującą informację (np. formularz dla pola).
- **ambiguous** — równorzędni kandydaci wymagają wyboru (z \`candidateIds\`).
- **unsupported** / **invalid**

## Stage 3B.1 — Graph-scoped evidence resolution

### Diagnoza \`graphResolved=0\` (przed patchem)

${JSON.stringify(report.diagnosis, null, 2)}

### Zachowanie po patchu

1. Formularz: GUID → albo \`plugin_registry_entry\` (polska nazwa PA) → GUID/className → \`resolveForm\`.
2. Pole: tylko z \`formNodeId\` (\`scopedFieldQueries\`); bez formularza — \`field_scope_missing\` + pytanie, **bez** globalnego multi-type search.
3. \`action_parameter=not_applicable\` dla zwykłego pola danych.
4. Import: \`businessTarget\` + \`canonicalCandidates\` + \`selectionRequiredBeforeExecution\` (bez auto-owner).
5. Raport BHP: \`graphSearchTerms\` z konfiguracji → zapytania Stage 3A; runtime nadal \`deferred\`.
6. Patch spójności evidence: typowanie \`selectedNodeId\`, resolved wymaga identity, ścieżka pola (nie cały formularz), lookup tylko z \`BINDS_LOOKUP\`.

## Katalog intencji

- explain_payroll_component
- validate_import_file
- build_employee_report
- explain_application_field
- trace_application_to_oracle
- unsupported / unknown

## Audit metrics

| Metryka | Wartość |
|---------|---------|
| questionsTested | **${report.questionsTested}** |
| intentsResolved / unknown / unsupported | **${report.intentsResolved}** / **${report.intentsUnknown}** / **${report.intentsUnsupported}** |
| ready / needs_clarification / ambiguous / invalid | **${report.plansReady}** / **${report.plansNeedsClarification}** / **${report.plansAmbiguous}** / **${report.plansInvalid}** |
| entitiesExtracted | **${report.entitiesExtracted}** |
| graphQueries / graphResolved / graphAmbiguous | **${report.graphQueriesExecuted}** / **${report.graphResolved}** / **${report.graphAmbiguous}** |
| graphResolvedEvidence / ambiguousEvidence | **${report.graphResolvedEvidence}** / **${report.graphAmbiguousEvidence}** |
| scopedFieldQueries / unscopedFieldQueries | **${report.scopedFieldQueries}** / **${report.unscopedFieldQueries}** |
| resolvedForms / resolvedFormScopedFields | **${report.resolvedForms}** / **${report.resolvedFormScopedFields}** |
| resolvedEvidenceWithoutNodeOrPath | **${report.resolvedEvidenceWithoutNodeOrPath}** |
| evidenceSelectedNodeTypeMismatch | **${report.evidenceSelectedNodeTypeMismatch}** |
| fieldEvidenceOutsideResolvedPath | **${report.fieldEvidenceOutsideResolvedPath}** |
| bindingResolvedWithoutResolvedControl | **${report.bindingResolvedWithoutResolvedControl}** |
| lookupResolvedWithoutLookupEdge | **${report.lookupResolvedWithoutLookupEdge}** |
| helpDocumentPointingToForm | **${report.helpDocumentPointingToForm}** |
| irrelevantGlobalAmbiguities | **${report.irrelevantGlobalAmbiguities}** |
| evidenceNotApplicable | **${report.evidenceNotApplicable}** |
| clarificationQuestionsForAmbiguities | **${report.clarificationQuestionsForAmbiguities}** |
| deferredEvidence | **${report.deferredEvidence}** |
| guessedEntities / autoResolvedAmbiguities | **${report.guessedEntities}** / **${report.autoResolvedAmbiguities}** |
| SQL gen/exec / filesRead / oracleWrites | **${report.sqlGenerated}** / **${report.sqlExecuted}** / **${report.filesRead}** / **${report.oracleWrites}** |
| avg / max planning ms | **${report.averagePlanningTimeMs}** / **${report.maxPlanningTimeMs}** |
| graphSourceHash | \`${report.graphSourceHash ?? 'null'}\` |
| strictErrors | **${report.strictErrors.length}** |

## Referencje A–G

\`\`\`json
${JSON.stringify(report.referenceResults, null, 2)}
\`\`\`

## Przykłady statusów

- **ready** — kompletne encje + plan dowodów (ref A; ref E gdy form+pole jednoznaczne). Nie pozwala na SQL.
- **needs_clarification** — brak pracownika/okresu (ref B) lub pole bez formularza (ref F).
- **ambiguous** — równorzędni kandydaci formularza/pola; import może mieć \`selectionRequiredBeforeExecution\` bez blokady planu.
- **unsupported** — zapis/przelew (ref G)

## CLI

\`\`\`bash
pnpm --filter @teta/api run planner:stage3b -- plan --question "..."
pnpm --filter @teta/api run planner:stage3b -- catalog
pnpm --filter @teta/api run planner:stage3b -- audit --strict
\`\`\`
`;
  writeFileSync(mdPath, md, 'utf8');
  return { mdPath, jsonPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromCwd();
  const apiRoot = path.join(repoRoot, 'apps', 'api');
  const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));
  const stage3aPaths = defaultStage3aPaths(repoRoot);
  const index = new CanonicalGraphIndexService(stage3aPaths);
  const status = index.status();

  let resolver: CanonicalGraphResolverService | null = null;
  if (status.exists) {
    index.ensureQueryIndexes();
    resolver = new CanonicalGraphResolverService(index.openReadonly());
  }

  const planner = new TetaEvidencePlannerService({
    configs,
    resolver,
    graphSourceHash: status.sourceHash,
  });

  if (args.cmd === 'catalog') {
    out(
      {
        contractVersion: STAGE3B_CONTRACT_VERSION,
        plannerConfigVersion: STAGE3B_PLANNER_CONFIG_VERSION,
        intents: configs.intentCatalog.map((i) => ({
          type: i.type,
          minScore: i.minScore,
          signals: i.signals.map((s) => s.id),
          requiredEntityTypes: i.requiredEntityTypes,
        })),
        evidenceTemplateKeys: Object.keys(configs.evidenceTemplates),
        graphIndex: {
          exists: status.exists,
          sourceHash: status.sourceHash,
          indexSchemaVersion: status.indexSchemaVersion,
        },
      },
      args,
    );
    return;
  }

  if (args.cmd === 'plan') {
    if (!args.question) {
      throw new Error('Wymagane --question');
    }
    const request: TetaPlanningRequest = {
      question: args.question,
      language: 'pl',
      hints: {
        expectedIntent: (args.expectedIntent as PlannerIntentType | undefined) ?? null,
        formGuid: args.formGuid ?? null,
        formName: args.formName ?? null,
      },
    };
    if (args.contextFile) {
      if (!existsSync(args.contextFile)) {
        throw new Error(`Brak pliku kontekstu: ${args.contextFile}`);
      }
      const ctx = JSON.parse(readFileSync(args.contextFile, 'utf8')) as TetaPlanningRequest;
      request.conversationContext = ctx.conversationContext ?? request.conversationContext;
      if (ctx.hints) {
        request.hints = { ...request.hints, ...ctx.hints };
      }
      if (ctx.question && !args.question) request.question = ctx.question;
    }
    const plan = planner.plan(request);
    out(plan, args);
    return;
  }

  if (args.cmd === 'audit') {
    if (!status.exists) {
      throw new Error(
        [
          'Brak indeksu Stage 3A — wymagany do audytu Stage 3B.',
          `Oczekiwany: ${stage3aPaths.indexPath}`,
          'Zbuduj: pnpm --filter @teta/api run graph:stage3a -- build',
        ].join('\n'),
      );
    }
    const localDir = path.join(repoRoot, '.local');
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
    const auditPath = path.join(localDir, 'AIA_INTENT_EVIDENCE_PLANNER_STAGE3B.audit.json');
    const report = runStage3bAudit({
      planner,
      graphSourceHash: status.sourceHash,
      graphIndexSchemaVersion: status.indexSchemaVersion,
      auditPath,
    });
    const docs = buildDocs(report, repoRoot);
    out(
      {
        ok: report.strictErrors.length === 0,
        auditPath,
        docs,
        report,
      },
      args,
    );
    if (args.strict && report.strictErrors.length) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Nieznana komenda: ${args.cmd} (plan|catalog|audit)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
