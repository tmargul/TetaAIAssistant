import { Injectable, Logger } from '@nestjs/common';
import { ChunkingService } from '../rag/chunking.service';
import { EmbeddingService } from '../rag/embedding.service';
import { QdrantService } from '../rag/qdrant.service';
import { buildClientDocumentSource, buildRagPointId } from '../rag/rag-point-id';
import { extractDocumentText } from './document-text-extractor';

@Injectable()
export class ClientRagIngestService {
  private readonly logger = new Logger(ClientRagIngestService.name);

  constructor(
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly qdrant: QdrantService,
  ) {}

  async ingestFile(documentId: number, filePath: string, displayName: string): Promise<number> {
    const content = await extractDocumentText(filePath, displayName);
    const chunks = this.chunking.chunkText(content);
    if (chunks.length === 0) {
      throw new Error('Plik jest pusty lub nie zawiera tekstu do indeksacji.');
    }

    const source = buildClientDocumentSource(documentId);
    await this.qdrant.ensureCollection(this.qdrant.clientCollection, this.embedding.dimensions);
    await this.qdrant.deletePointsBySource(this.qdrant.clientCollection, source);

    const vectors = await this.embedding.embedBatch(chunks);
    await this.qdrant.upsertPoints(
      this.qdrant.clientCollection,
      chunks.map((text, chunkIndex) => ({
        id: buildRagPointId(source, chunkIndex),
        vector: vectors[chunkIndex],
        payload: {
          text,
          source,
          chunkIndex,
        },
      })),
    );

    this.logger.log(`Zaindeksowano dokument ${documentId}: ${chunks.length} chunków.`);
    return chunks.length;
  }

  async removeDocument(documentId: number): Promise<void> {
    const source = buildClientDocumentSource(documentId);
    await this.qdrant.deletePointsBySource(this.qdrant.clientCollection, source);
  }
}
