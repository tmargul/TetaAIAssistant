import type { AppMode } from './rag.js';

export type HealthStatus = 'ok' | 'degraded';

export type ServiceState = 'ok' | 'offline';

export interface HealthResponse {
  status: HealthStatus;
  app: string;
  version: string;
  timestamp: string;
}

export interface OllamaHealthInfo {
  status: ServiceState;
  modelCount: number;
}

export interface QdrantHealthInfo {
  status: ServiceState;
  collection: string;
  pointsCount: number | null;
}

export interface SystemHealthResponse extends HealthResponse {
  appMode: AppMode;
  vendorEnabled: boolean;
  ollama: OllamaHealthInfo;
  qdrant: QdrantHealthInfo;
}
