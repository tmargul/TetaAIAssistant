import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APP_NAME,
  GLOBAL_RAG_COLLECTION,
  type HealthStatus,
  type SystemHealthResponse,
} from '@teta/shared';
import { getAppMode } from '../rag/app-mode';
import { isVendorEnabled } from '../rag/vendor-auth';

@Injectable()
export class HealthService {
  constructor(private readonly config: ConfigService) {}

  getBasicHealth() {
    return {
      status: 'ok' as HealthStatus,
      app: APP_NAME,
      version: process.env.npm_package_version ?? '0.0.1',
      timestamp: new Date().toISOString(),
    };
  }

  async getSystemHealth(): Promise<SystemHealthResponse> {
    const [ollama, qdrant] = await Promise.all([this.checkOllama(), this.checkQdrant()]);
    const degraded = ollama.status !== 'ok' || qdrant.status !== 'ok';

    return {
      ...this.getBasicHealth(),
      status: degraded ? 'degraded' : 'ok',
      appMode: getAppMode(),
      vendorEnabled: isVendorEnabled(),
      ollama,
      qdrant,
    };
  }

  private get ollamaBaseUrl(): string {
    return this.config.get<string>('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').replace(/\/$/, '');
  }

  private get qdrantBaseUrl(): string {
    return this.config.get<string>('QDRANT_URL', 'http://127.0.0.1:6333').replace(/\/$/, '');
  }

  private get globalCollection(): string {
    return this.config.get<string>('QDRANT_COLLECTION_GLOBAL', GLOBAL_RAG_COLLECTION);
  }

  private async checkOllama() {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return { status: 'offline' as const, modelCount: 0 };
      }
      const data = (await res.json()) as { models?: unknown[] };
      return {
        status: 'ok' as const,
        modelCount: data.models?.length ?? 0,
      };
    } catch {
      return { status: 'offline' as const, modelCount: 0 };
    }
  }

  private async checkQdrant() {
    const collection = this.globalCollection;
    try {
      const listRes = await fetch(`${this.qdrantBaseUrl}/collections`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!listRes.ok) {
        return { status: 'offline' as const, collection, pointsCount: null };
      }

      let pointsCount = 0;
      const detailRes = await fetch(`${this.qdrantBaseUrl}/collections/${collection}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (detailRes.ok) {
        const data = (await detailRes.json()) as { result?: { points_count?: number } };
        pointsCount = data.result?.points_count ?? 0;
      }

      return {
        status: 'ok' as const,
        collection,
        pointsCount,
      };
    } catch {
      return { status: 'offline' as const, collection, pointsCount: null };
    }
  }
}
