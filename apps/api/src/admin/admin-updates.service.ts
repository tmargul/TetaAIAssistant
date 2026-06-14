import { Injectable } from '@nestjs/common';
import type { ClientUpdatesStatusResponse } from '@teta/shared';
import { OllamaChatService } from '../chat/ollama-chat.service';
import { HealthService } from '../health/health.service';
import { GlobalRagImportService } from '../rag/global-rag-import.service';
import { GlobalRagService } from '../rag/global-rag.service';

@Injectable()
export class AdminUpdatesService {
  constructor(
    private readonly globalRag: GlobalRagService,
    private readonly globalRagImport: GlobalRagImportService,
    private readonly health: HealthService,
    private readonly ollama: OllamaChatService,
  ) {}

  async getStatus(): Promise<ClientUpdatesStatusResponse> {
    const [globalRag, systemHealth, chatModels] = await Promise.all([
      this.globalRag.getStatus(),
      this.health.getSystemHealth(),
      this.ollama.getAvailableChatModels(),
    ]);

    return {
      appVersion: systemHealth.version,
      globalRag,
      ollama: {
        status: systemHealth.ollama.status,
        modelCount: systemHealth.ollama.modelCount,
        chatModels,
      },
      qdrant: systemHealth.qdrant,
    };
  }

  importGlobalRag(packagePath: string) {
    return this.globalRagImport.importPackage(packagePath);
  }
}
