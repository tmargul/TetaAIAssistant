/**
 * Stage 3B / 3B.1 — audit runner for references A–G + strict gates.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { TetaEvidencePlannerService } from './teta-evidence-planner.service';
import { stripVolatilePlanFields, stableStringify } from './teta-task-contract';
import { assertNoSideEffects } from './teta-planner-validation';
import { hasResolvedIdentity, validateEvidenceList } from './teta-evidence-contract';
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
    ambiguities: plan.ambiguities.map((a) => ({
      kind: a.kind,
      subject: a.subject,
      blocksPlanning: a.blocksPlanning !== false,
      selectionRequiredBeforeExecution: a.selectionRequiredBeforeExecution === true,
      candidateIds: a.candidateIds?.slice(0, 8),
    })),
    clarificationQuestions: plan.clarificationQuestions,
    selectionRequiredBeforeExecution: plan.selectionRequiredBeforeExecution,
    evidenceStatuses: plan.evidenceRequirements.map((e) => ({
      evidenceType: e.evidenceType,
      status: e.status,
      runtimeSourceRequired: e.runtimeSourceRequired,
      selectedNodeId: e.graphResolution?.selectedNodeId ?? null,
      selectedNodeIds: e.graphResolution?.selectedNodeIds ?? null,
      pathNodeIds: e.graphResolution?.pathNodeIds?.slice(0, 12) ?? null,
    })),
    executionPolicy: plan.executionPolicy,
    graphNodes: plan.resolvedGraphEvidence.nodes.length,
    graphEdges: plan.resolvedGraphEvidence.edges.length,
    graphConflicts: plan.resolvedGraphEvidence.conflicts.length,
    scopedFieldQueries: plan.audit.scopedFieldQueries,
    unscopedFieldQueries: plan.audit.unscopedFieldQueries,
    queryTimingMs: plan.audit.queryTimingMs,
    durationMs: plan.audit.plannerDurationMs,
  };
}

function checkReference(key: string, plan: TetaEvidencePlan): string[] {
  const errors: string[] = [];
  const ent = (t: string) => plan.entities.filter((e) => e.type === t);
  const ev = (t: string) => plan.evidenceRequirements.find((e) => e.evidenceType === t);

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
    const tables = ent('targetTable').map((e) => e.normalizedValue);
    for (const t of ['T_PRAC', 'L_STANOWISKA', 'L_STAWKI']) {
      if (!tables.includes(t)) errors.push(`C: missing table ${t}`);
    }
    const targetEv = ev('target_tables');
    const gr = targetEv?.graphResolution as
      | { candidates?: Array<{ businessTarget?: string; canonicalCandidates?: unknown[] }> }
      | null
      | undefined;
    if (gr?.candidates && Array.isArray(gr.candidates)) {
      for (const row of gr.candidates) {
        if (!row.businessTarget) errors.push('C: businessTarget missing');
        if (!Array.isArray(row.canonicalCandidates)) errors.push('C: canonicalCandidates missing');
      }
    }
    if (plan.executionPolicy.fileReadAllowed !== false) errors.push('C: fileReadAllowed');
    // owner/type must not be auto-resolved into a single selected owner silently
    if (plan.audit.autoResolvedAmbiguities !== 0) errors.push('C: autoResolvedAmbiguities');
  }

  if (key === 'D') {
    if (plan.intent.type !== 'build_employee_report') errors.push('D: wrong intent');
    if (!ent('reportSubject').some((e) => e.normalizedValue === 'occupational_health_examinations')) {
      errors.push('D: reportSubject');
    }
    if (!ent('relativeDateRange').some((e) => e.normalizedValue === 'current_month')) {
      errors.push('D: relativeDateRange current_month');
    }
    if (plan.audit.graphQueriesExecuted < 1) {
      errors.push('D: expected at least one graph query');
    }
    const runtimeDeferred = plan.evidenceRequirements.filter(
      (e) => e.runtimeSourceRequired && e.status === 'deferred',
    );
    if (runtimeDeferred.length < 1 && plan.evidenceRequirements.some((e) => e.runtimeSourceRequired)) {
      errors.push('D: runtime evidence should remain deferred');
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
    if (plan.audit.scopedFieldQueries < 1) errors.push('E: expected scoped field query');
    if (plan.audit.unscopedFieldQueries !== 0) errors.push('E: unexpected unscoped field query');
    if (ev('form')?.status !== 'resolved') errors.push('E: form evidence not resolved');
    const formId = ev('form')?.graphResolution?.selectedNodeId ?? '';
    if (!formId.startsWith('form:')) errors.push('E: form selectedNodeId must be application_form');
    if (ev('help_document')?.status !== 'resolved') errors.push('E: help_document must be resolved');
    const helpDocId = ev('help_document')?.graphResolution?.selectedNodeId ?? '';
    if (!helpDocId.startsWith('help-doc:')) {
      errors.push('E: help_document must point to help-doc node, not form');
    }
    if (helpDocId.startsWith('form:')) errors.push('E: help_document pointing to form');
    if (ev('help_field')?.status !== 'resolved') errors.push('E: help_field must be resolved');
    const helpFieldId = ev('help_field')?.graphResolution?.selectedNodeId ?? '';
    if (!helpFieldId.startsWith('help-field:')) errors.push('E: help_field selectedNodeId');
    if (ev('action_parameter')?.status !== 'not_applicable') {
      errors.push('E: action_parameter must be not_applicable for data field');
    }
    if (plan.ambiguities.some((a) => a.subject === 'action_parameter')) {
      errors.push('E: must not have action_parameter ambiguity');
    }
    // control may be missing when DESCRIBES link absent — not deferred-fake-resolved bindings
    const controlStatus = ev('control')?.status;
    if (controlStatus === 'resolved') {
      const cid = ev('control')?.graphResolution?.selectedNodeId ?? '';
      if (!cid.startsWith('control:') && !cid.startsWith('action:')) {
        errors.push('E: control selectedNodeId type mismatch');
      }
    } else if (!['missing', 'ambiguous', 'unavailable'].includes(String(controlStatus))) {
      // deferred without identity was the old bug; prefer missing
      if (controlStatus === 'deferred' && !hasResolvedIdentity(ev('control')?.graphResolution)) {
        errors.push('E: control deferred without identity — use missing');
      }
    }
    if (ev('lookup_binding')?.status === 'resolved' && controlStatus !== 'resolved') {
      errors.push('E: lookup resolved without control');
    }
    if (ev('lookup_binding')?.status === 'resolved') {
      // Wartość typically has no lookup — if resolved must have ids
      if (!hasResolvedIdentity(ev('lookup_binding')?.graphResolution)) {
        errors.push('E: lookup resolved without ids');
      }
    }
    for (const t of ['target_binding', 'dataset_columns', 'oracle_columns'] as const) {
      if (ev(t)?.status === 'resolved') {
        if (controlStatus !== 'resolved') errors.push(`E: ${t} resolved without control`);
        if (!hasResolvedIdentity(ev(t)?.graphResolution)) {
          errors.push(`E: ${t} resolved without node ids`);
        }
      }
    }
    for (const e of plan.evidenceRequirements) {
      if (e.status === 'resolved' && !hasResolvedIdentity(e.graphResolution)) {
        errors.push(`E: resolved evidence ${e.evidenceType} without identity`);
      }
    }
    if (plan.resolvedGraphEvidence.nodes.length < 1) errors.push('E: graphNodes expected > 0');
    if (plan.planningStatus !== 'ready' && plan.planningStatus !== 'ambiguous') {
      errors.push(`E: unexpected planningStatus=${plan.planningStatus}`);
    }
  }

  if (key === 'F') {
    if (plan.planningStatus !== 'ambiguous' && plan.planningStatus !== 'needs_clarification') {
      errors.push('F: expected ambiguous or needs_clarification');
    }
    if (plan.planningStatus === 'ready') errors.push('F: must not auto-resolve');
    if (plan.clarificationQuestions.length < 1) {
      errors.push('F: expected clarificationQuestion about form');
    }
    const q = plan.clarificationQuestions.map((c) => c.question).join(' ');
    if (!/formularzu/i.test(q) || !/Nazwa/i.test(q)) {
      errors.push('F: clarification must ask for form of field Nazwa');
    }
    if (plan.ambiguities.some((a) => ['action_parameter', 'control', 'help_field'].includes(a.subject))) {
      errors.push('F: must not emit separate global ambiguities for action/control/help');
    }
    if (!plan.ambiguities.some((a) => a.subject === 'field_scope_missing')) {
      errors.push('F: expected grouped field_scope_missing ambiguity');
    }
    if (plan.audit.unscopedFieldQueries !== 0) {
      errors.push('F: must not run unscoped global field search');
    }
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
  let graphResolvedEvidence = 0;
  let graphAmbiguousEvidence = 0;
  let graphUnresolvedEvidence = 0;
  let scopedFieldQueries = 0;
  let unscopedFieldQueries = 0;
  let irrelevantGlobalAmbiguities = 0;
  let clarificationQuestionsForAmbiguities = 0;
  let evidenceNotApplicable = 0;
  let resolvedForms = 0;
  let resolvedFormScopedFields = 0;
  let missingRequiredEvidence = 0;
  let deferredEvidence = 0;
  let guessedEntities = 0;
  let autoResolvedAmbiguities = 0;
  let sqlGenerated = 0;
  let sqlExecuted = 0;
  let filesRead = 0;
  let oracleWrites = 0;
  let resolvedEvidenceWithoutNodeOrPath = 0;
  let evidenceSelectedNodeTypeMismatch = 0;
  let fieldEvidenceOutsideResolvedPath = 0;
  let bindingResolvedWithoutResolvedControl = 0;
  let lookupResolvedWithoutLookupEdge = 0;
  let helpDocumentPointingToForm = 0;

  for (const [key, req] of Object.entries(STAGE3B_REFERENCE_QUESTIONS)) {
    const plan = input.planner.plan(req);
    timings.push(plan.audit.plannerDurationMs);
    referenceResults[key] = summarizePlan(plan);
    strictErrors.push(...checkReference(key, plan));

    entitiesExtracted += plan.entities.length;
    graphQueriesExecuted += plan.audit.graphQueriesExecuted;
    scopedFieldQueries += plan.audit.scopedFieldQueries;
    unscopedFieldQueries += plan.audit.unscopedFieldQueries;
    irrelevantGlobalAmbiguities += plan.audit.irrelevantGlobalAmbiguities;
    clarificationQuestionsForAmbiguities += plan.audit.clarificationQuestionsForAmbiguities;
    evidenceNotApplicable += plan.audit.evidenceNotApplicable;
    resolvedForms += plan.audit.resolvedForms;
    resolvedFormScopedFields += plan.audit.resolvedFormScopedFields;
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
      if (ev.status === 'resolved') graphResolvedEvidence += 1;
      if (ev.status === 'ambiguous') graphAmbiguousEvidence += 1;
      if (ev.status === 'missing' || ev.status === 'unavailable') graphUnresolvedEvidence += 1;
      const st = ev.graphResolution?.status;
      if (st === 'resolved') graphResolved += 1;
      else if (st === 'ambiguous') graphAmbiguous += 1;
      else if (st === 'unresolved') graphUnresolved += 1;
      else if (st === 'conflicting') graphConflicting += 1;
    }

    const pathSeed = new Set<string>();
    for (const et of ['form', 'help_document', 'help_field', 'control'] as const) {
      const e = plan.evidenceRequirements.find((x) => x.evidenceType === et);
      if (e?.graphResolution?.selectedNodeId) pathSeed.add(e.graphResolution.selectedNodeId);
      for (const id of e?.graphResolution?.pathNodeIds ?? []) pathSeed.add(id);
      for (const id of e?.graphResolution?.selectedNodeIds ?? []) pathSeed.add(id);
    }
    const hasLookupEdge = plan.resolvedGraphEvidence.edges.some(
      (e) => (e as { type?: string }).type === 'BINDS_LOOKUP',
    );
    const violations = validateEvidenceList(plan.evidenceRequirements, {
      lookupEdgePresent: hasLookupEdge,
      allowedFieldPathNodeIds: pathSeed.size > 0 ? pathSeed : undefined,
    });
    for (const v of violations) {
      if (v.code === 'resolvedEvidenceWithoutNodeOrPath') resolvedEvidenceWithoutNodeOrPath += 1;
      else if (v.code === 'evidenceSelectedNodeTypeMismatch') evidenceSelectedNodeTypeMismatch += 1;
      else if (v.code === 'fieldEvidenceOutsideResolvedPath') fieldEvidenceOutsideResolvedPath += 1;
      else if (v.code === 'bindingResolvedWithoutResolvedControl') {
        bindingResolvedWithoutResolvedControl += 1;
      } else if (v.code === 'lookupResolvedWithoutLookupEdge') lookupResolvedWithoutLookupEdge += 1;
      else if (v.code === 'helpDocumentPointingToForm') helpDocumentPointingToForm += 1;
      strictErrors.push(`${key}: evidence contract ${v.code} (${v.evidenceType}: ${v.detail})`);
    }

    const plan2 = input.planner.plan(req);
    if (stableStringify(stripVolatilePlanFields(plan)) !== stableStringify(stripVolatilePlanFields(plan2))) {
      strictErrors.push(`${key}: non-deterministic plan output`);
    }
  }

  if (!input.graphSourceHash) strictErrors.push('graph source hash unavailable');
  if (guessedEntities !== 0) strictErrors.push('guessedEntities != 0');
  if (autoResolvedAmbiguities !== 0) strictErrors.push('autoResolvedAmbiguities != 0');
  if (sqlGenerated !== 0) strictErrors.push('SQL generated != 0');
  if (sqlExecuted !== 0) strictErrors.push('SQL executed != 0');
  if (filesRead !== 0) strictErrors.push('filesRead != 0');
  if (oracleWrites !== 0) strictErrors.push('Oracle writes != 0');
  if (irrelevantGlobalAmbiguities !== 0) {
    strictErrors.push(`irrelevantGlobalAmbiguities=${irrelevantGlobalAmbiguities}`);
  }
  if (graphResolvedEvidence < 1 && graphResolved < 1) {
    // Prefer evidence-level resolved counts from Stage 3B.1 applicability
    strictErrors.push('graphResolvedEvidence expected > 0 when Stage 3A can resolve refs');
  }
  if (resolvedEvidenceWithoutNodeOrPath !== 0) {
    strictErrors.push(`resolvedEvidenceWithoutNodeOrPath=${resolvedEvidenceWithoutNodeOrPath}`);
  }
  if (evidenceSelectedNodeTypeMismatch !== 0) {
    strictErrors.push(`evidenceSelectedNodeTypeMismatch=${evidenceSelectedNodeTypeMismatch}`);
  }
  if (fieldEvidenceOutsideResolvedPath !== 0) {
    strictErrors.push(`fieldEvidenceOutsideResolvedPath=${fieldEvidenceOutsideResolvedPath}`);
  }
  if (bindingResolvedWithoutResolvedControl !== 0) {
    strictErrors.push(
      `bindingResolvedWithoutResolvedControl=${bindingResolvedWithoutResolvedControl}`,
    );
  }
  if (lookupResolvedWithoutLookupEdge !== 0) {
    strictErrors.push(`lookupResolvedWithoutLookupEdge=${lookupResolvedWithoutLookupEdge}`);
  }
  if (helpDocumentPointingToForm !== 0) {
    strictErrors.push(`helpDocumentPointingToForm=${helpDocumentPointingToForm}`);
  }

  const diagnosis = {
    rootCause:
      'Stage 3B previously called resolveForm(nameFragment) on Polish display titles that live on plugin_registry_entry, not application_form; then resolveField without formNodeId searched help_field+ui_control+action_control globally and applied the same ambiguous result to every evidence type including action_parameter.',
    stage3b1Fix: [
      'resolve form via GUID or plugin_registry_entry → GUID/className → resolveForm',
      'resolveField only with formNodeId when form known',
      'skip global field search when form missing; emit field_scope_missing + clarification',
      'mark action_parameter not_applicable for ordinary data fields',
      'import tables: businessTarget + canonicalCandidates + selectionRequiredBeforeExecution',
      'report subjects: config graphSearchTerms queried through Stage 3A',
    ],
    evidenceContractPatch: [
      'selectedNodeId must match evidenceType node type (help_document ≠ form)',
      'resolved requires selectedNodeId | selectedNodeIds | path',
      'field bindings/columns only from help_field/control path, not whole form subgraph',
      'lookup only when BINDS_LOOKUP; honest missing/not_applicable over fake resolved',
    ],
  };

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
    graphResolvedEvidence,
    graphAmbiguousEvidence,
    graphUnresolvedEvidence,
    scopedFieldQueries,
    unscopedFieldQueries,
    irrelevantGlobalAmbiguities,
    clarificationQuestionsForAmbiguities,
    evidenceNotApplicable,
    resolvedForms,
    resolvedFormScopedFields,
    resolvedEvidenceWithoutNodeOrPath,
    evidenceSelectedNodeTypeMismatch,
    fieldEvidenceOutsideResolvedPath,
    bindingResolvedWithoutResolvedControl,
    lookupResolvedWithoutLookupEdge,
    helpDocumentPointingToForm,
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
    diagnosis,
    strictErrors,
    deterministicCheckOk: !strictErrors.some((e) => e.includes('non-deterministic')),
    generatedAt: new Date().toISOString(),
  };

  const dir = path.dirname(input.auditPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(input.auditPath, JSON.stringify(report, null, 2), 'utf8');

  return report;
}
