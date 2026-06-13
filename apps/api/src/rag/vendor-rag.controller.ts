import { join } from 'path';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { GlobalRagIngestResult } from '@teta/shared';
import { getRepoRoot } from '../config/repo-root';
import { GlobalRagIngestService } from './global-rag-ingest.service';
import { GlobalRagService } from './global-rag.service';
import { VendorAccessGuard } from './vendor-access.guard';

@Controller('vendor/rag')
@UseGuards(VendorAccessGuard)
export class VendorRagController {
  constructor(
    private readonly globalRag: GlobalRagService,
    private readonly globalRagIngest: GlobalRagIngestService,
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
}
