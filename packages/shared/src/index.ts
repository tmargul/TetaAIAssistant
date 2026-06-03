export const APP_NAME = 'Teta AI Assistant';

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  app: string;
  version: string;
  timestamp: string;
}
