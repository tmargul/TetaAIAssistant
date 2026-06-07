import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RagChunkPayload } from '@teta/shared';
import { RAG_CONSTANTS } from './rag.constants';

type QdrantPoint = {
  id: string;
  vector: number[];
  payload: RagChunkPayload;
};

@Injectable()
export class QdrantService {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('QDRANT_URL', 'http://127.0.0.1:6333').replace(/\/$/, '');
  }

  get globalCollection(): string {
    return (
      this.config.get<string>('QDRANT_COLLECTION_GLOBAL') ?? RAG_CONSTANTS.globalCollection
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Qdrant request failed (${res.status}) ${path}: ${body}`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async ensureCollection(collection: string, vectorSize: number): Promise<void> {
    try {
      await this.request(`/collections/${collection}`);
    } catch {
      await this.request(`/collections/${collection}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        }),
      });
    }
  }

  async recreateCollection(collection: string, vectorSize: number): Promise<void> {
    try {
      await this.request(`/collections/${collection}`, { method: 'DELETE' });
    } catch {
      // collection may not exist yet
    }
    await this.ensureCollection(collection, vectorSize);
  }

  async upsertPoints(collection: string, points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    const batchSize = 64;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await this.request(`/collections/${collection}/points?wait=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: batch }),
      });
    }
  }

  async scrollAllPoints(collection: string): Promise<QdrantPoint[]> {
    type ScrollResponse = {
      result: {
        points: Array<{
          id: string | number;
          vector: number[] | Record<string, number[]>;
          payload: RagChunkPayload;
        }>;
        next_page_offset: string | number | null;
      };
    };

    const points: QdrantPoint[] = [];
    let offset: string | number | null = null;

    do {
      const response: ScrollResponse = await this.request<ScrollResponse>(
        `/collections/${collection}/points/scroll`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limit: 256,
            with_payload: true,
            with_vector: true,
            offset,
          }),
        },
      );

      for (const point of response.result.points) {
        const vector = Array.isArray(point.vector)
          ? point.vector
          : Object.values(point.vector)[0];
        points.push({
          id: String(point.id),
          vector,
          payload: point.payload,
        });
      }

      offset = response.result.next_page_offset;
    } while (offset !== null && offset !== undefined);

    return points;
  }

  async getPointsCount(collection: string): Promise<number> {
    const info = await this.request<{
      result: { points_count: number };
    }>(`/collections/${collection}`);
    return info.result.points_count;
  }
}
