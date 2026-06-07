import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import archiver from 'archiver';
import type { GlobalRagExportResult, RagPackManifest, RagPackVectorRecord } from '@teta/shared';
import { RAG_PACK_FORMAT } from '@teta/shared';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';

@Injectable()
export class GlobalRagExportService {
  private readonly logger = new Logger(GlobalRagExportService.name);

  constructor(
    private readonly qdrant: QdrantService,
    private readonly embedding: EmbeddingService,
    private readonly builds: RagGlobalBuildService,
  ) {}

  async exportPackage(version: string, outputPath: string): Promise<GlobalRagExportResult> {
    const points = await this.qdrant.scrollAllPoints(this.qdrant.globalCollection);
    if (points.length === 0) {
      throw new Error(
        'Kolekcja globalnego RAG jest pusta. Najpierw uruchom ingest (rag:global:ingest).',
      );
    }

    const sources = [...new Set(points.map((point) => point.payload.source))].sort();
    const builtAt = new Date().toISOString();
    const manifest: RagPackManifest = {
      format: RAG_PACK_FORMAT,
      version,
      embeddingModel: this.embedding.model,
      embeddingDimensions: this.embedding.dimensions,
      chunkCount: points.length,
      builtAt,
      sources,
    };

    const resolvedOutput = path.resolve(outputPath);
    await mkdir(path.dirname(resolvedOutput), { recursive: true });

    const workDir = path.join(path.dirname(resolvedOutput), `.ragpack-work-${Date.now()}`);
    await mkdir(workDir, { recursive: true });

    const vectorsPath = path.join(workDir, 'vectors.jsonl');
    const gzipPath = path.join(workDir, 'vectors.jsonl.gz');
    const manifestPath = path.join(workDir, 'manifest.json');
    const checksumPath = path.join(workDir, 'checksum.sha256');

    const lines = points.map((point) => {
      const record: RagPackVectorRecord = {
        id: point.id,
        vector: point.vector,
        payload: point.payload,
      };
      return JSON.stringify(record);
    });

    await writeFile(vectorsPath, `${lines.join('\n')}\n`, 'utf8');
    await pipeline(createReadStream(vectorsPath), createGzip(), createWriteStream(gzipPath));
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const checksum = createHash('sha256')
      .update(await readFile(manifestPath))
      .update(await readFile(gzipPath))
      .digest('hex');

    await writeFile(checksumPath, `${checksum}\n`, 'utf8');
    await this.createZipArchive(resolvedOutput, [
      { path: manifestPath, name: 'manifest.json' },
      { path: gzipPath, name: 'vectors.jsonl.gz' },
      { path: checksumPath, name: 'checksum.sha256' },
    ]);

    this.builds.recordBuild({
      version,
      chunkCount: points.length,
      sources,
      packagePath: resolvedOutput,
    });

    this.logger.log(`Wyeksportowano paczkę ${resolvedOutput} (${points.length} chunków).`);

    return {
      version,
      chunkCount: points.length,
      outputPath: resolvedOutput,
      checksum,
    };
  }

  private async createZipArchive(
    outputPath: string,
    files: Array<{ path: string; name: string }>,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      for (const file of files) {
        archive.file(file.path, { name: file.name });
      }
      void archive.finalize();
    });
  }
}
