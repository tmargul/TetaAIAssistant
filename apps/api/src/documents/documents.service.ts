import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import {
  formatRagSourceExtensions,
  type ClientRagStatusResponse,
  type RagDocumentRecord,
  isRagSourceExtension,
} from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { EmbeddingService } from '../rag/embedding.service';
import { QdrantService } from '../rag/qdrant.service';
import { ClientRagIngestService } from './client-rag-ingest.service';

type DocumentRow = {
  id: number;
  original_name: string;
  storage_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: RagDocumentRecord['status'];
  chunk_count: number;
  error_message: string | null;
  uploaded_by: number | null;
  created_at: string;
  indexed_at: string | null;
  uploader_name: string | null;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly qdrant: QdrantService,
    private readonly embedding: EmbeddingService,
    private readonly clientRagIngest: ClientRagIngestService,
  ) {}

  private get storageDir(): string {
    const configured = this.config.get<string>('RAG_DOCUMENTS_DIR', 'data/rag-documents');
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  async listDocuments(): Promise<RagDocumentRecord[]> {
    const rows = this.db.connection
      .prepare(
        `SELECT d.*, u.display_name AS uploader_name, u.oracle_username
         FROM rag_documents d
         LEFT JOIN users u ON u.id = d.uploaded_by
         ORDER BY d.created_at DESC`,
      )
      .all() as Array<DocumentRow & { oracle_username?: string }>;

    return rows.map((row) => this.mapRow(row));
  }

  async getStatus(): Promise<ClientRagStatusResponse> {
    const documentCount = (
      this.db.connection.prepare('SELECT COUNT(*) AS count FROM rag_documents').get() as {
        count: number;
      }
    ).count;

    const indexedDocumentCount = (
      this.db.connection
        .prepare("SELECT COUNT(*) AS count FROM rag_documents WHERE status = 'indexed'")
        .get() as { count: number }
    ).count;

    let chunkCount = 0;
    let globalChunkCount = 0;

    try {
      chunkCount = await this.qdrant.getPointsCount(this.qdrant.clientCollection);
    } catch {
      chunkCount = 0;
    }

    try {
      globalChunkCount = await this.qdrant.getPointsCount(this.qdrant.globalCollection);
    } catch {
      globalChunkCount = 0;
    }

    return {
      collection: this.qdrant.clientCollection,
      documentCount,
      indexedDocumentCount,
      chunkCount,
      globalChunkCount,
      embeddingModel: this.embedding.model,
    };
  }

  async uploadDocument(
    file: Express.Multer.File,
    uploadedBy: number,
  ): Promise<RagDocumentRecord> {
    if (!file) {
      throw new BadRequestException('Brak pliku do uploadu.');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!isRagSourceExtension(ext)) {
      throw new BadRequestException(
        `Dozwolone formaty: ${formatRagSourceExtensions()}`,
      );
    }

    await mkdir(this.storageDir, { recursive: true });

    const storageName = `${randomUUID()}${ext}`;
    const storagePath = path.join(this.storageDir, storageName);
    await this.persistUploadedFile(file, storagePath);

    const now = new Date().toISOString();
    const result = this.db.connection
      .prepare(
        `INSERT INTO rag_documents (
          original_name, storage_name, mime_type, size_bytes, storage_path,
          status, chunk_count, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(
        file.originalname,
        storageName,
        file.mimetype || mimeTypeForExtension(ext),
        file.size,
        storagePath,
        uploadedBy,
        now,
      );

    const documentId = Number(result.lastInsertRowid);
    return this.indexDocument(documentId);
  }

  private async persistUploadedFile(
    file: Express.Multer.File,
    storagePath: string,
  ): Promise<void> {
    if (file.path) {
      try {
        await rename(file.path, storagePath);
      } catch {
        const { copyFile } = await import('fs/promises');
        await copyFile(file.path, storagePath);
        await rm(file.path, { force: true });
      }
      return;
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('Brak pliku do uploadu.');
    }
    await writeFile(storagePath, file.buffer);
  }

  async reindexDocument(documentId: number): Promise<RagDocumentRecord> {
    const row = this.getRow(documentId);
    if (!row) {
      throw new NotFoundException('Nie znaleziono dokumentu.');
    }
    return this.indexDocument(documentId);
  }

  async deleteDocument(documentId: number): Promise<void> {
    const row = this.getRow(documentId);
    if (!row) {
      throw new NotFoundException('Nie znaleziono dokumentu.');
    }

    try {
      await this.clientRagIngest.removeDocument(documentId);
    } catch (error) {
      this.logger.warn(
        `Nie udało się usunąć wektorów dokumentu ${documentId}: ${error instanceof Error ? error.message : error}`,
      );
    }

    await rm(row.storage_path, { force: true });
    this.db.connection.prepare('DELETE FROM rag_documents WHERE id = ?').run(documentId);
  }

  private async indexDocument(documentId: number): Promise<RagDocumentRecord> {
    const row = this.getRow(documentId);
    if (!row) {
      throw new NotFoundException('Nie znaleziono dokumentu.');
    }

    this.updateStatus(documentId, 'processing', { errorMessage: null });

    try {
      const chunkCount = await this.clientRagIngest.ingestFile(
        documentId,
        row.storage_path,
        row.original_name,
      );
      const indexedAt = new Date().toISOString();
      this.db.connection
        .prepare(
          `UPDATE rag_documents
           SET status = 'indexed', chunk_count = ?, error_message = NULL, indexed_at = ?
           WHERE id = ?`,
        )
        .run(chunkCount, indexedAt, documentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nieznany błąd indeksacji.';
      this.updateStatus(documentId, 'failed', { errorMessage: message });
      throw new BadRequestException(message);
    }

    const updated = this.getRow(documentId);
    if (!updated) {
      throw new NotFoundException('Nie znaleziono dokumentu po indeksacji.');
    }
    return this.mapRow(updated);
  }

  private updateStatus(
    documentId: number,
    status: RagDocumentRecord['status'],
    extra: { errorMessage?: string | null },
  ): void {
    this.db.connection
      .prepare('UPDATE rag_documents SET status = ?, error_message = ? WHERE id = ?')
      .run(status, extra.errorMessage ?? null, documentId);
  }

  private getRow(documentId: number): DocumentRow | undefined {
    return this.db.connection
      .prepare(
        `SELECT d.*, u.display_name AS uploader_name, u.oracle_username
         FROM rag_documents d
         LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE d.id = ?`,
      )
      .get(documentId) as (DocumentRow & { oracle_username?: string }) | undefined;
  }

  private mapRow(row: DocumentRow & { oracle_username?: string }): RagDocumentRecord {
    return {
      id: row.id,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      status: row.status,
      chunkCount: row.chunk_count,
      errorMessage: row.error_message,
      uploadedBy: row.uploaded_by,
      uploaderName: row.uploader_name ?? row.oracle_username ?? null,
      createdAt: row.created_at,
      indexedAt: row.indexed_at,
    };
  }
}

function mimeTypeForExtension(ext: string): string {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.csv':
      return 'text/csv';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.html':
    case '.htm':
      return 'text/html';
    default:
      return 'text/plain';
  }
}
