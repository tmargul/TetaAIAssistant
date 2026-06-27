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
  /** Efektywny tryb pracy (z nagłówka sesji lub domyślny). */
  appMode: AppMode;
  /** Tryb pakietu / instalacji — czy dostępny wybór Klient vs Vendor. */
  buildMode: AppMode;
  workModeSelectable: boolean;
  vendorEnabled: boolean;
  ollama: OllamaHealthInfo;
  qdrant: QdrantHealthInfo;
}
