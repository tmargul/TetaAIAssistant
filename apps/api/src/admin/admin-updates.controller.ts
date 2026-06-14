import {
  BadRequestException,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ClientUpdatesStatusResponse, GlobalRagImportResult } from '@teta/shared';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUpdatesService } from './admin-updates.service';

@Controller('admin/updates')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUpdatesController {
  constructor(private readonly updates: AdminUpdatesService) {}

  @Get('status')
  getStatus(): Promise<ClientUpdatesStatusResponse> {
    return this.updates.getStatus();
  }

  @Post('global-rag/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, file, callback) => {
          const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
          callback(null, `teta-rag-import-${Date.now()}-${safeName}`);
        },
      }),
      limits: { fileSize: 512 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.zip')) {
          callback(new BadRequestException('Plik musi być archiwum ZIP (global-rag-X.zip).'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async importGlobalRag(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<GlobalRagImportResult> {
    if (!file?.path) {
      throw new BadRequestException('Nie przesłano pliku paczki RAG.');
    }

    try {
      return await this.updates.importGlobalRag(file.path);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }
}
