import { join } from 'path';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage, diskStorage } from 'multer';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import type {
  GlobalRagChunksImportResult,
  GlobalRagIngestResult,
  GlobalSourceFileRecord,
  GlobalSourcesListResponse,
  RagImportMode,
} from '@teta/shared';
import { getRepoRoot } from '../config/repo-root';
import { GlobalRagChunksImportService } from './global-rag-chunks-import.service';
import { GlobalRagIngestService } from './global-rag-ingest.service';
import { GlobalRagService } from './global-rag.service';
import { GlobalSourcesService } from './global-sources.service';
import { VendorAccessGuard } from './vendor-access.guard';

@Controller('vendor/rag')
@UseGuards(VendorAccessGuard)
export class VendorRagController {
  constructor(
    private readonly globalRag: GlobalRagService,
    private readonly globalRagIngest: GlobalRagIngestService,
    private readonly globalRagChunksImport: GlobalRagChunksImportService,
    private readonly globalSources: GlobalSourcesService,
  ) {}

  @Get('status')
  getStatus() {
    return this.globalRag.getStatus();
  }

  @Post('ingest')
  ingestFromSources(): Promise<GlobalRagIngestResult> {
    const sourcesDir = join(getRepoRoot(), 'sources', 'global');
    return this.globalRagIngest.ingestFromDirectory(sourcesDir);
  }

  @Post('ingest/chunks')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, file, callback) => {
          const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
          callback(null, `teta-chunks-import-${Date.now()}-${safeName}`);
        },
      }),
      limits: { fileSize: 512 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.jsonl')) {
          callback(
            new BadRequestException('Plik musi być knowledge-chunks.jsonl (format teta-knowledge-chunk-v1).'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async ingestFromChunksFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('merge') merge?: string,
  ): Promise<GlobalRagChunksImportResult> {
    if (!file?.path) {
      throw new BadRequestException('Nie przesłano pliku JSONL.');
    }

    const importMode: RagImportMode = merge === 'true' || merge === '1' ? 'merge' : 'replace';

    try {
      return await this.globalRagChunksImport.importFromJsonlFile(file.path, importMode);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Get('sources')
  listSources(): Promise<GlobalSourcesListResponse> {
    return this.globalSources.listSources();
  }

  @Post('sources/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadSource(@UploadedFile() file: Express.Multer.File): Promise<GlobalSourceFileRecord> {
    return this.globalSources.uploadSource(file);
  }

  @Delete('sources')
  async deleteSource(@Query('path') path: string): Promise<{ ok: true }> {
    await this.globalSources.deleteSource(path);
    return { ok: true };
  }
}
