import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import type { TetaReportPeriodKind } from '../teta-report-period/teta-report-period.types';
import type { Stage3gRouteDefinition, Stage3gRouteRegistry, Stage3gTrustedRequestContext } from './teta-chat-report.types';

export type Stage3gRouteResolveResult =
  | { matched: false; reason: 'no_subject' | 'no_intent' | 'not_ready' | 'no_route' | 'disabled' }
  | { matched: true; route: Stage3gRouteDefinition; authorized: boolean; authReason?: string };

function subjectFromPlan(plan: TetaEvidencePlan): string | null {
  const entity = plan.entities.find(
    (item) => item.type === 'reportSubject' && typeof item.normalizedValue === 'string',
  );
  return entity?.normalizedValue ?? null;
}

function periodKindFromPlan(plan: TetaEvidencePlan): TetaReportPeriodKind | null {
  const period = plan.reportParameters?.period;
  if (!period || period.status !== 'resolved' || !period.period) return null;
  return period.period.kind;
}

export function resolveCanonicalChatReportRoute(options: {
  evidencePlan: TetaEvidencePlan;
  registry: Stage3gRouteRegistry;
  context: Pick<Stage3gTrustedRequestContext, 'role' | 'workMode'>;
}): Stage3gRouteResolveResult {
  const { evidencePlan, registry, context } = options;

  if (evidencePlan.planningStatus !== 'ready') {
    return { matched: false, reason: 'not_ready' };
  }

  const intent = evidencePlan.intent?.type;
  if (!intent || intent === 'unsupported' || intent === 'unknown') {
    return { matched: false, reason: 'no_intent' };
  }

  const subject = subjectFromPlan(evidencePlan);
  if (!subject) {
    return { matched: false, reason: 'no_subject' };
  }

  const periodKind = periodKindFromPlan(evidencePlan);

  const route = registry.routes.find((item) => {
    if (item.intent !== intent || item.subject !== subject) return false;
    if (item.periodKind) {
      return periodKind !== null && item.periodKind === periodKind;
    }
    // Legacy routes without periodKind match only current_month (or any when period absent).
    return !periodKind || periodKind === 'current_month';
  });
  if (!route) {
    return { matched: false, reason: 'no_route' };
  }
  if (!route.enabled) {
    return { matched: false, reason: 'disabled' };
  }

  const roleOk = route.allowedRoles.includes(context.role);
  const workModeOk = route.allowedWorkModes.includes(context.workMode);
  const authorized = roleOk || workModeOk;

  return {
    matched: true,
    route,
    authorized,
    authReason: authorized ? undefined : 'canonical_report_not_authorized',
  };
}

/** Family match for clarification/invalid period — never uses keyword bypass. */
export function resolveBhpFamilyRouteForPeriodIssue(options: {
  evidencePlan: TetaEvidencePlan;
  registry: Stage3gRouteRegistry;
  context: Pick<Stage3gTrustedRequestContext, 'role' | 'workMode'>;
}): Stage3gRouteResolveResult | null {
  const { evidencePlan, registry, context } = options;
  const intent = evidencePlan.intent?.type;
  const subject = subjectFromPlan(evidencePlan);
  if (intent !== 'build_employee_report' || subject !== 'occupational_health_examinations') {
    return null;
  }
  const periodStatus = evidencePlan.reportParameters?.period?.status;
  if (
    periodStatus !== 'missing' &&
    periodStatus !== 'ambiguous' &&
    periodStatus !== 'invalid'
  ) {
    return null;
  }
  if (
    evidencePlan.planningStatus !== 'needs_clarification' &&
    evidencePlan.planningStatus !== 'invalid'
  ) {
    return null;
  }

  const route =
    registry.routes.find(
      (item) =>
        item.subject === subject &&
        item.intent === intent &&
        item.periodKind === 'current_month',
    ) ??
    registry.routes.find((item) => item.subject === subject && item.intent === intent);

  if (!route || !route.enabled) return null;

  const roleOk = route.allowedRoles.includes(context.role);
  const workModeOk = route.allowedWorkModes.includes(context.workMode);
  return {
    matched: true,
    route,
    authorized: roleOk || workModeOk,
    authReason: roleOk || workModeOk ? undefined : 'canonical_report_not_authorized',
  };
}
