import type { ChatModel } from './chat.js';
import type { GlobalRagStatusResponse } from './rag.js';
import type { QdrantHealthInfo, ServiceState } from './health.js';

export interface ClientUpdatesStatusResponse {
  appVersion: string;
  globalRag: GlobalRagStatusResponse;
  ollama: {
    status: ServiceState;
    modelCount: number;
    chatModels: ChatModel[];
    installedModels: string[];
  };
  qdrant: QdrantHealthInfo;
}
