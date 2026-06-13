import { join } from 'path';
import {
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
import { memoryStorage } from 'multer';
import type {
  GlobalRagIngestResult,
  GlobalSourceFileRecord,
  GlobalSourcesListResponse,
} from '@teta/shared';
import { getRepoRoot } from '../config/repo-root';
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
