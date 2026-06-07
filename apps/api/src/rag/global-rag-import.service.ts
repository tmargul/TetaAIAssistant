import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, readFile, rm } from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { tmpdir } from 'os';
import { createGunzip } from 'zlib';
import extract from 'extract-zip';
import type { GlobalRagImportResult, RagPackManifest, RagPackVectorRecord } from '@teta/shared';
import { RAG_PACK_FORMAT } from '@teta/shared';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { RagGlobalBuildService } from './rag-global-build.service';

@Injectable()
export class GlobalRagImportService {
  private readonly logger = new Logger(GlobalRagImportService.name);

  constructor(
    private readonly qdrant: QdrantService,
    private readonly embedding: EmbeddingService,
    private readonly builds: RagGlobalBuildService,
  ) {}

  async importPackage(packagePath: string): Promise<GlobalRagImportResult> {
    const resolved = path.resolve(packagePath);
    const workDir = path.join(tmpdir(), `ragpack-import-${Date.now()}`);
    await mkdir(workDir, { recursive: true });

    try {
      await extract(resolved, { dir: workDir });

      const manifestPath = path.join(workDir, 'manifest.json');
      const gzipPath = path.join(workDir, 'vectors.jsonl.gz');
      const checksumPath = path.join(workDir, 'checksum.sha256');

      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RagPackManifest;
      if (manifest.format !== RAG_PACK_FORMAT) {
        throw new Error(`Nieobsługiwany format paczki RAG: ${manifest.format}`);
      }

      const expectedChecksum = (await readFile(checksumPath, 'utf8')).trim();
      const actualChecksum = createHash('sha256')
        .update(await readFile(manifestPath))
        .update(await readFile(gzipPath))
        .digest('hex');

      if (expectedChecksum !== actualChecksum) {
        throw new Error('Niezgodny checksum paczki RAG — plik mógł zostać uszkodzony.');
      }

      if (manifest.embeddingDimensions !== this.embedding.dimensions) {
        throw new Error(
          `Wymiar embeddingu w paczce (${manifest.embeddingDimensions}) nie zgadza się z konfiguracją (${this.embedding.dimensions}).`,
        );
      }

      const points = await this.readVectorRecords(gzipPath);
      if (points.length === 0) {
        throw new Error('Paczka RAG nie zawiera wektorów.');
      }

      if (manifest.chunkCount !== points.length) {
        this.logger.warn(
          `Manifest podaje ${manifest.chunkCount} chunków, wczytano ${points.length} — kontynuuję import.`,
        );
      }

      await this.qdrant.recreateCollection(this.qdrant.globalCollection, manifest.embeddingDimensions);
      await this.qdrant.upsertPoints(this.qdrant.globalCollection, points);

      this.builds.recordBuild({
        version: manifest.version,
        chunkCount: points.length,
        sources: manifest.sources,
        packagePath: resolved,
      });

      this.logger.log(
        `Zaimportowano RAG ${manifest.version}: ${points.length} chunków do ${this.qdrant.globalCollection}.`,
      );

      return {
        version: manifest.version,
        chunkCount: points.length,
        sources: manifest.sources,
        collection: this.qdrant.globalCollection,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async readVectorRecords(gzipPath: string): Promise<
    Array<{ id: string; vector: number[]; payload: RagPackVectorRecord['payload'] }>
  > {
    const points: Array<{ id: string; vector: number[]; payload: RagPackVectorRecord['payload'] }> = [];
    const stream = createReadStream(gzipPath).pipe(createGunzip());
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      const record = JSON.parse(line) as RagPackVectorRecord;
      points.push({
        id: record.id,
        vector: record.vector,
        payload: record.payload,
      });
    }

    return points;
  }
}
