import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
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

  const route = registry.routes.find(
    (item) => item.intent === intent && item.subject === subject,
  );
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
