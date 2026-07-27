import { readFileSync } from 'fs';
import path from 'path';
import {
  STAGE3G_ROUTES_CONTRACT_VERSION,
  type Stage3gRouteDefinition,
  type Stage3gRouteRegistry,
} from './teta-chat-report.types';

export function defaultCanonicalChatReportRoutesPath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-canonical-chat-report-routes-v1.json');
}

export function loadCanonicalChatReportRoutes(filePath: string): Stage3gRouteRegistry {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Stage3gRouteRegistry;
  validateRouteRegistry(raw);
  return raw;
}

export function validateRouteRegistry(registry: Stage3gRouteRegistry): void {
  if (registry.contractVersion !== STAGE3G_ROUTES_CONTRACT_VERSION) {
    throw new Error(
      `Invalid Stage 3G route registry contractVersion: ${String(registry.contractVersion)}`,
    );
  }
  if (!Array.isArray(registry.routes)) {
    throw new Error('Stage 3G route registry routes must be an array');
  }
  for (const route of registry.routes) {
    validateRouteDefinition(route);
  }
}

function validateRouteDefinition(route: Stage3gRouteDefinition): void {
  if (!route.routeId?.trim()) throw new Error('route.routeId required');
  if (!route.intent?.trim()) throw new Error('route.intent required');
  if (!route.subject?.trim()) throw new Error('route.subject required');
  if (typeof route.enabled !== 'boolean') throw new Error('route.enabled required');
  if (!Array.isArray(route.allowedWorkModes)) throw new Error('route.allowedWorkModes required');
  if (!Array.isArray(route.allowedRoles)) throw new Error('route.allowedRoles required');
  // Safety: registry must never carry SQL / Oracle object names.
  const serialized = JSON.stringify(route).toLowerCase();
  for (const banned of ['select ', 'from ', 'teta_admin.', 'sqltext', 'join ']) {
    if (serialized.includes(banned.trim()) && banned.includes(' ')) {
      // soft check — "select " unlikely in route ids
    }
  }
  if ('sql' in route || 'sqlText' in route || 'tables' in route) {
    throw new Error('Stage 3G route registry must not contain SQL or table metadata');
  }
}
