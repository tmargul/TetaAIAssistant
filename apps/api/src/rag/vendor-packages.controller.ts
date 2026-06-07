import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { rm } from 'fs/promises';
import * as path from 'path';
import { GlobalRagExportService } from './global-rag-export.service';
import { OfflineBundleService } from './offline-bundle.service';
import { VendorAccessGuard } from './vendor-access.guard';

type ExportGlobalRagBody = {
  version?: string;
};

@Controller('vendor/packages')
@UseGuards(VendorAccessGuard)
export class VendorPackagesController {
  constructor(
    private readonly offlineBundle: OfflineBundleService,
    private readonly globalRagExport: GlobalRagExportService,
  ) {}

  @Post('offline-bundle/export')
  async exportOfflineBundle(@Res() res: Response): Promise<void> {
    const result = await this.offlineBundle.buildAndZip();
    res.download(result.zipPath, result.filename, (err) => {
      void rm(result.zipPath, { force: true });
      if (err && !res.headersSent) {
        res.status(500).json({ message: 'Nie udało się pobrać paczki offline.' });
      }
    });
  }

  @Post('global-rag/export')
  async exportGlobalRag(@Body() body: ExportGlobalRagBody, @Res() res: Response): Promise<void> {
    const version = body.version?.trim();
    if (!version || !/^[\w][\w.\-]{0,63}$/.test(version)) {
      throw new BadRequestException(
        'Podaj wersję paczki (np. 1.0.0 lub 2025-06-05) — do 64 znaków, litery, cyfry, kropki, myślniki.',
      );
    }

    const repoRoot = this.offlineBundle.getRepoRoot();
    const outputPath = path.join(repoRoot, 'data', 'vendor-packages', `global-rag-${version}.zip`);
    const result = await this.globalRagExport.exportPackage(version, outputPath);
    const filename = `global-rag-${version}.zip`;

    res.download(result.outputPath, filename, (err) => {
      void rm(result.outputPath, { force: true });
      if (err && !res.headersSent) {
        res.status(500).json({ message: 'Nie udało się pobrać paczki RAG.' });
      }
    });
  }
}
