/**
 * Stage 3B — plan validation + clarification helpers.
 */
import type {
  AmbiguityRecord,
  ClarificationQuestion,
  EvidenceRequirement,
  MissingEntity,
  PlannerEntity,
  PlannerIntentType,
  PlanningStatus,
  TetaEvidencePlan,
} from './teta-stage3b.types';
import type { IntentDef, PlannerConfigs } from './teta-intent-catalog';
import { hasEntity } from './teta-entity-extractor';
import type { PlannerEntityType } from './teta-stage3b.types';

export function computeMissingEntities(
  intent: PlannerIntentType,
  intentDef: IntentDef | undefined,
  entities: PlannerEntity[],
): MissingEntity[] {
  const missing: MissingEntity[] = [];
  if (!intentDef) return missing;

  if (intent === 'explain_payroll_component') {
    if (!hasEntity(entities, ['employeeNumber', 'employeeId', 'employeeName'])) {
      missing.push({
        type: 'employee',
        reason: 'employee_identity_not_provided',
        requiredForIntent: true,
      });
    }
    if (!hasEntity(entities, ['payrollPeriod', 'payrollNumber', 'dateRange', 'relativeDateRange'])) {
      if (!hasEntity(entities, ['payrollType']) || !hasEntity(entities, ['payrollPeriod', 'payrollNumber'])) {
        missing.push({
          type: 'payroll_context',
          reason: 'payroll_period_or_list_not_provided',
          requiredForIntent: true,
        });
      }
    }
    if (!hasEntity(entities, ['componentCode'])) {
      missing.push({
        type: 'componentCode',
        reason: 'component_code_not_provided',
        requiredForIntent: true,
      });
    }
  }

  if (intent === 'validate_import_file') {
    if (!hasEntity(entities, ['fileName'])) {
      missing.push({ type: 'fileName', reason: 'file_not_provided', requiredForIntent: true });
    }
    if (!hasEntity(entities, ['targetTable'])) {
      missing.push({ type: 'targetTable', reason: 'target_tables_not_provided', requiredForIntent: true });
    }
  }

  if (intent === 'build_employee_report') {
    if (!hasEntity(entities, ['reportSubject'])) {
      missing.push({ type: 'reportSubject', reason: 'report_subject_not_provided', requiredForIntent: true });
    }
  }

  if (intent === 'explain_application_field' || intent === 'trace_application_to_oracle') {
    if (!hasEntity(entities, ['fieldLabel', 'controlName', 'oracleObjectName'])) {
      missing.push({ type: 'fieldLabel', reason: 'field_not_provided', requiredForIntent: true });
    }
  }

  for (const req of intentDef.requiredEntityTypes) {
    if (!hasEntity(entities, [req])) {
      if (!missing.some((m) => m.type === req || (m.type === 'employee' && req.startsWith('employee')))) {
        missing.push({ type: req, reason: `required_entity_missing:${req}`, requiredForIntent: true });
      }
    }
  }

  return missing;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return out;
}

export function buildClarificationQuestions(
  missing: MissingEntity[],
  ambiguities: AmbiguityRecord[],
  intentDef: IntentDef | undefined,
  configs: PlannerConfigs,
  entities: PlannerEntity[],
): ClarificationQuestion[] {
  const order = intentDef?.clarificationEntityOrder ?? [];
  const questions: ClarificationQuestion[] = [];
  const seen = new Set<string>();
  const templates = configs.language.clarificationTemplates ?? {};

  const push = (entityType: string, question: string) => {
    if (seen.has(entityType)) return;
    if (!question.trim()) return;
    seen.add(entityType);
    questions.push({ entityType, question });
  };

  for (const m of missing) {
    if (m.type === 'employee') {
      push('employeeNumber', configs.language.clarificationQuestions.employeeNumber ?? '');
    } else if (m.type === 'payroll_context') {
      push('payrollPeriod', configs.language.clarificationQuestions.payrollPeriod ?? '');
    } else {
      push(String(m.type), configs.language.clarificationQuestions[String(m.type)] ?? '');
    }
  }

  for (const a of ambiguities) {
    if (a.blocksPlanning === false) continue;
    if (a.subject === 'field_scope_missing' || a.message === 'field_scope_missing') {
      const label = entities.find((e) => e.type === 'fieldLabel')?.rawValue ?? 'pole';
      const tpl =
        templates.field_scope_missing ??
        'Na którym formularzu znajduje się pole „{fieldLabel}”?';
      push('field_scope_missing', fillTemplate(tpl, { fieldLabel: label }));
    } else if (a.subject === 'form' || a.message === 'multiple_forms_match') {
      const labels = (a.candidateIds ?? []).slice(0, 5).join(', ');
      const tpl = templates.multiple_forms ?? 'Który formularz masz na myśli: {candidateLabels}?';
      push('form_ambiguous', fillTemplate(tpl, { candidateLabels: labels || '(kandydaci)' }));
    } else if (a.subject === 'field' || a.message === 'multiple_fields_match') {
      const labels = (a.candidateIds ?? []).slice(0, 5).join(', ');
      const tpl = templates.multiple_fields ?? 'Które pole masz na myśli: {candidateLabels}?';
      push('field_ambiguous', fillTemplate(tpl, { candidateLabels: labels || '(kandydaci)' }));
    }
  }

  // Field without form and no ambiguity yet — still ask
  if (
    hasEntity(entities, ['fieldLabel']) &&
    !hasEntity(entities, ['formName', 'formGuid']) &&
    !seen.has('field_scope_missing')
  ) {
    const label = entities.find((e) => e.type === 'fieldLabel')?.rawValue ?? 'pole';
    const tpl =
      templates.field_scope_missing ??
      'Na którym formularzu znajduje się pole „{fieldLabel}”?';
    push('field_scope_missing', fillTemplate(tpl, { fieldLabel: label }));
  }

  questions.sort((a, b) => {
    const ia = order.indexOf(a.entityType as PlannerEntityType);
    const ib = order.indexOf(b.entityType as PlannerEntityType);
    const sa = ia === -1 ? 999 : ia;
    const sb = ib === -1 ? 999 : ib;
    if (sa !== sb) return sa - sb;
    return a.entityType.localeCompare(b.entityType);
  });

  return questions;
}

export function derivePlanningStatus(input: {
  intent: PlannerIntentType;
  missing: MissingEntity[];
  ambiguities: AmbiguityRecord[];
  evidence: EvidenceRequirement[];
}): PlanningStatus {
  if (input.intent === 'unsupported') return 'unsupported';
  if (input.intent === 'unknown') return 'invalid';

  const blocking = input.ambiguities.filter((a) => a.blocksPlanning !== false);

  if (blocking.some((a) => a.kind === 'conflicting')) return 'ambiguous';

  // field_scope_missing → needs_clarification (user must supply form)
  if (blocking.some((a) => a.subject === 'field_scope_missing' || a.message === 'field_scope_missing')) {
    return 'needs_clarification';
  }

  if (blocking.some((a) => a.kind === 'ambiguous')) return 'ambiguous';

  if (input.missing.some((m) => m.requiredForIntent)) return 'needs_clarification';

  return 'ready';
}

export function assertNoSideEffects(plan: TetaEvidencePlan): string[] {
  const errors: string[] = [];
  if (plan.executionPolicy.sqlGenerationAllowed) errors.push('sqlGenerationAllowed must be false');
  if (plan.executionPolicy.sqlExecutionAllowed) errors.push('sqlExecutionAllowed must be false');
  if (plan.executionPolicy.fileReadAllowed) errors.push('fileReadAllowed must be false');
  if (plan.executionPolicy.oracleWriteAllowed) errors.push('oracleWriteAllowed must be false');
  if (plan.audit.guessedEntities !== 0) errors.push('guessedEntities != 0');
  if (plan.audit.autoResolvedAmbiguities !== 0) errors.push('autoResolvedAmbiguities != 0');
  if (plan.audit.sqlGenerated !== 0) errors.push('sqlGenerated != 0');
  if (plan.audit.sqlExecuted !== 0) errors.push('sqlExecuted != 0');
  if (plan.audit.filesRead !== 0) errors.push('filesRead != 0');
  if (plan.audit.oracleWrites !== 0) errors.push('oracleWrites != 0');
  return errors;
}
