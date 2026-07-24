/**
 * Stage 3B — audit runner for references A–G + strict gates.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { TetaEvidencePlannerService } from './teta-evidence-planner.service';
import { stripVolatilePlanFields, stableStringify } from './teta-task-contract';
import { assertNoSideEffects } from './teta-planner-validation';
import type { Stage3bAuditReport, TetaEvidencePlan, TetaPlanningRequest } from './teta-stage3b.types';
import { STAGE3B_CONTRACT_VERSION, STAGE3B_PLANNER_CONFIG_VERSION } from './teta-stage3b.types';

export const STAGE3B_REFERENCE_QUESTIONS: Record<string, TetaPlanningRequest> = {
  A: {
    question:
      'Dlaczego składnik 4300 policzył się na 5200 zł na liście UC pracownika 00034 za luty 2026?',
  },
  B: {
    question: 'Dlaczego składnik 4300 tak się policzył?',
  },
  C: {
    question:
      'Sprawdź, czy plik import.xlsx ma wszystkie dane potrzebne do importu do T_PRAC, L_STANOWISKA i L_STAWKI oraz czy przejdzie constrainty.',
  },
  D: {
    question: 'Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.',
  },
  E: {
    question: 'Do czego służy pole Wartość na formularzu Lista obliczona?',
  },
  F: {
    question: 'Do czego służy pole Nazwa?',
  },
  G: {
    question: 'Wyślij przelew do pracownika.',
  },
};

function summarizePlan(plan: TetaEvidencePlan): Record<string, unknown> {
  return {
    planningStatus: plan.planningStatus,
    intent: plan.intent.type,
    confidence: plan.intent.confidence,
    entities: plan.entities.map((e) => ({
      type: e.type,
      rawValue: e.rawValue,
      normalizedValue: e.normalizedValue,
      source: e.source,
    })),
    missingEntities: plan.missingEntities,
    ambiguities: plan.ambiguities.map((a) => ({ kind: a.kind, subject: a.subject })),
    clarificationQuestions: plan.clarificationQuestions,
    evidenceStatuses: plan.evidenceRequirements.map((e) => ({
      evidenceType: e.evidenceType,
      status: e.status,
      runtimeSourceRequired: e.runtimeSourceRequired,
    })),
    executionPolicy: plan.executionPolicy,
    graphNodes: plan.resolvedGraphEvidence.nodes.length,
    graphEdges: plan.resolvedGraphEvidence.edges.length,
    graphConflicts: plan.resolvedGraphEvidence.conflicts.length,
    durationMs: plan.audit.plannerDurationMs,
  };
}

function checkReference(key: string, plan: TetaEvidencePlan): string[] {
  const errors: string[] = [];
  const ent = (t: string) => plan.entities.filter((e) => e.type === t);

  if (key === 'A') {
    if (plan.intent.type !== 'explain_payroll_component') {
      errors.push('A: intent != explain_payroll_component');
    }
    if (!ent('componentCode').some((e) => e.normalizedValue === '4300')) {
      errors.push('A: missing componentCode 4300');
    }
    if (!ent('componentValue').some((e) => e.normalizedValue === '5200')) {
      errors.push('A: missing componentValue 5200');
    }
    if (!ent('employeeNumber').some((e) => e.rawValue === '00034')) {
      errors.push('A: employeeNumber must preserve 00034');
    }
    if (!ent('payrollType').some((e) => e.rawValue === 'UC')) {
      errors.push('A: payrollType rawValue UC required');
    }
    if (!ent('payrollPeriod').some((e) => e.normalizedValue === '2026-02')) {
      errors.push('A: payrollPeriod 2026-02 required');
    }
    const deferred = plan.evidenceRequirements.filter((e) => e.status === 'deferred');
    if (deferred.length < 3) errors.push('A: expected deferred runtime evidence');
    if (plan.planningStatus === 'unsupported' || plan.planningStatus === 'invalid') {
      errors.push('A: bad planningStatus');
    }
  }

  if (key === 'B') {
    if (plan.planningStatus !== 'needs_clarification') {
      errors.push('B: expected needs_clarification');
    }
    const missingTypes = plan.missingEntities.map((m) => m.type);
    if (!missingTypes.includes('employee') && !missingTypes.includes('employeeNumber')) {
      errors.push('B: missing employee');
    }
    if (!missingTypes.includes('payroll_context') && !missingTypes.includes('payrollPeriod')) {
      errors.push('B: missing payroll context');
    }
    if (plan.clarificationQuestions.length < 1) {
      errors.push('B: expected clarification questions');
    }
  }

  if (key === 'C') {
    if (plan.intent.type !== 'validate_import_file') errors.push('C: wrong intent');
    if (!ent('fileName').some((e) => e.normalizedValue === 'import.xlsx')) {
      errors.push('C: fileName');
    }
    if (!ent('fileType').some((e) => e.normalizedValue === 'xlsx')) {
      errors.push('C: fileType');
    }
    const tables = ent('targetTable').map((e) => e.normalizedValue).sort();
    for (const t of ['T_PRAC', 'L_STANOWISKA', 'L_STAWKI']) {
      if (!tables.includes(t)) errors.push(`C: missing table ${t}`);
    }
    const types = new Set(plan.evidenceRequirements.map((e) => e.evidenceType));
    for (const need of [
      'datatype_rules',
      'not_null_rules',
      'primary_keys',
      'unique_constraints',
      'foreign_keys',
      'check_constraints',
      'triggers',
      'business_rules',
      'import_order',
    ]) {
      if (!types.has(need)) errors.push(`C: missing evidence ${need}`);
    }
    if (plan.executionPolicy.fileReadAllowed !== false) errors.push('C: fileReadAllowed');
  }

  if (key === 'D') {
    if (plan.intent.type !== 'build_employee_report') errors.push('D: wrong intent');
    if (!ent('reportSubject').some((e) => e.normalizedValue === 'occupational_health_examinations')) {
      errors.push('D: reportSubject');
    }
    if (!ent('relativeDateRange').some((e) => e.normalizedValue === 'current_month')) {
      errors.push('D: relativeDateRange current_month');
    }
    if (
      ent('relativeDateRange').some(
        (e) => e.attributes && (e.attributes as { resolvedAt?: unknown }).resolvedAt != null,
      )
    ) {
      errors.push('D: relative date must not be resolved');
    }
    const types = new Set(plan.evidenceRequirements.map((e) => e.evidenceType));
    for (const need of [
      'employee_source',
      'joins',
      'dictionary_display_columns',
      'authorization_scope',
    ]) {
      if (!types.has(need)) errors.push(`D: missing evidence ${need}`);
    }
  }

  if (key === 'E') {
    if (plan.intent.type !== 'explain_application_field') errors.push('E: wrong intent');
    if (!ent('fieldLabel').some((e) => /warto[sś][cć]/i.test(e.rawValue))) {
      errors.push('E: fieldLabel Wartość');
    }
    if (!ent('formName').some((e) => /lista\s+obliczona/i.test(e.rawValue))) {
      errors.push('E: formName Lista obliczona');
    }
  }

  if (key === 'F') {
    if (plan.planningStatus !== 'ambiguous' && plan.planningStatus !== 'needs_clarification') {
      errors.push('F: expected ambiguous or needs_clarification');
    }
    if (plan.planningStatus === 'ready') errors.push('F: must not auto-resolve');
  }

  if (key === 'G') {
    if (plan.intent.type !== 'unsupported') errors.push('G: intent unsupported');
    if (plan.planningStatus !== 'unsupported') errors.push('G: planningStatus unsupported');
    if (plan.executionPolicy.oracleWriteAllowed !== false) errors.push('G: oracleWriteAllowed');
  }

  errors.push(...assertNoSideEffects(plan).map((e) => `${key}: ${e}`));
  return errors;
}

export function runStage3bAudit(input: {
  planner: TetaEvidencePlannerService;
  graphSourceHash: string | null;
  graphIndexSchemaVersion: string | null;
  auditPath: string;
}): Stage3bAuditReport {
  const timings: number[] = [];
  const referenceResults: Record<string, unknown> = {};
  const strictErrors: string[] = [];

  let intentsResolved = 0;
  let intentsUnknown = 0;
  let intentsUnsupported = 0;
  let plansReady = 0;
  let plansNeedsClarification = 0;
  let plansAmbiguous = 0;
  let plansInvalid = 0;
  let entitiesExtracted = 0;
  let graphQueriesExecuted = 0;
  let graphResolved = 0;
  let graphAmbiguous = 0;
  let graphUnresolved = 0;
  let graphConflicting = 0;
  let missingRequiredEvidence = 0;
  let deferredEvidence = 0;
  let guessedEntities = 0;
  let autoResolvedAmbiguities = 0;
  let sqlGenerated = 0;
  let sqlExecuted = 0;
  let filesRead = 0;
  let oracleWrites = 0;

  for (const [key, req] of Object.entries(STAGE3B_REFERENCE_QUESTIONS)) {
    const plan = input.planner.plan(req);
    timings.push(plan.audit.plannerDurationMs);
    referenceResults[key] = summarizePlan(plan);
    strictErrors.push(...checkReference(key, plan));

    entitiesExtracted += plan.entities.length;
    graphQueriesExecuted += plan.audit.graphQueriesExecuted;
    guessedEntities += plan.audit.guessedEntities;
    autoResolvedAmbiguities += plan.audit.autoResolvedAmbiguities;
    sqlGenerated += plan.audit.sqlGenerated;
    sqlExecuted += plan.audit.sqlExecuted;
    filesRead += plan.audit.filesRead;
    oracleWrites += plan.audit.oracleWrites;

    if (plan.intent.type === 'unknown') intentsUnknown += 1;
    else if (plan.intent.type === 'unsupported') intentsUnsupported += 1;
    else intentsResolved += 1;

    if (plan.planningStatus === 'ready') plansReady += 1;
    else if (plan.planningStatus === 'needs_clarification') plansNeedsClarification += 1;
    else if (plan.planningStatus === 'ambiguous') plansAmbiguous += 1;
    else if (plan.planningStatus === 'invalid') plansInvalid += 1;

    for (const ev of plan.evidenceRequirements) {
      if (ev.required && ev.status === 'missing') missingRequiredEvidence += 1;
      if (ev.status === 'deferred') deferredEvidence += 1;
      const st = ev.graphResolution?.status;
      if (st === 'resolved') graphResolved += 1;
      else if (st === 'ambiguous') graphAmbiguous += 1;
      else if (st === 'unresolved') graphUnresolved += 1;
      else if (st === 'conflicting') graphConflicting += 1;
    }

    // Determinism: plan twice
    const plan2 = input.planner.plan(req);
    if (stableStringify(stripVolatilePlanFields(plan)) !== stableStringify(stripVolatilePlanFields(plan2))) {
      strictErrors.push(`${key}: non-deterministic plan output`);
    }
  }

  if (!input.graphSourceHash) {
    strictErrors.push('graph source hash unavailable');
  }
  if (guessedEntities !== 0) strictErrors.push('guessedEntities != 0');
  if (autoResolvedAmbiguities !== 0) strictErrors.push('autoResolvedAmbiguities != 0');
  if (sqlGenerated !== 0) strictErrors.push('SQL generated != 0');
  if (sqlExecuted !== 0) strictErrors.push('SQL executed != 0');
  if (filesRead !== 0) strictErrors.push('filesRead != 0');
  if (oracleWrites !== 0) strictErrors.push('Oracle writes != 0');

  const report: Stage3bAuditReport = {
    contractVersion: STAGE3B_CONTRACT_VERSION,
    plannerConfigVersion: STAGE3B_PLANNER_CONFIG_VERSION,
    graphIndexSchemaVersion: input.graphIndexSchemaVersion,
    graphSourceHash: input.graphSourceHash,
    questionsTested: Object.keys(STAGE3B_REFERENCE_QUESTIONS).length,
    intentsResolved,
    intentsUnknown,
    intentsUnsupported,
    plansReady,
    plansNeedsClarification,
    plansAmbiguous,
    plansInvalid,
    entitiesExtracted,
    graphQueriesExecuted,
    graphResolved,
    graphAmbiguous,
    graphUnresolved,
    graphConflicting,
    missingRequiredEvidence,
    deferredEvidence,
    guessedEntities,
    autoResolvedAmbiguities,
    sqlGenerated,
    sqlExecuted,
    filesRead,
    oracleWrites,
    averagePlanningTimeMs:
      timings.length === 0 ? 0 : Math.round(timings.reduce((a, b) => a + b, 0) / timings.length),
    maxPlanningTimeMs: timings.length === 0 ? 0 : Math.max(...timings),
    referenceResults,
    strictErrors,
    deterministicCheckOk: !strictErrors.some((e) => e.includes('non-deterministic')),
    generatedAt: new Date().toISOString(),
  };

  const dir = path.dirname(input.auditPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(input.auditPath, JSON.stringify(report, null, 2), 'utf8');

  return report;
}
