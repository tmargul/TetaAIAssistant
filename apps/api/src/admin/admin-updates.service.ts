import { Injectable } from '@nestjs/common';
import type { ClientUpdatesStatusResponse, GlobalRagImportResult, OllamaPullModel } from '@teta/shared';
import { OllamaChatService } from '../chat/ollama-chat.service';
import { OllamaModelsService } from '../chat/ollama-models.service';
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
    private readonly ollamaModels: OllamaModelsService,
  ) {}

  async getStatus(): Promise<ClientUpdatesStatusResponse> {
    const [globalRag, systemHealth, chatModels, installedModels] = await Promise.all([
      this.globalRag.getStatus(),
      this.health.getSystemHealth(),
      this.ollama.getAvailableChatModels(),
      this.ollama.listAllInstalledModels(true).catch(() => [] as string[]),
    ]);

    return {
      appVersion: systemHealth.version,
      globalRag,
      ollama: {
        status: systemHealth.ollama.status,
        modelCount: systemHealth.ollama.modelCount,
        chatModels,
        installedModels,
      },
      qdrant: systemHealth.qdrant,
    };
  }

  importGlobalRag(packagePath: string) {
    return this.globalRagImport.importPackage(packagePath);
  }

  importOllamaModels(packagePath: string) {
    return this.ollamaModels.importFromZipPackage(packagePath);
  }

  pullOllamaModel(model: OllamaPullModel) {
    return this.ollamaModels.pullModel(model);
  }
}
