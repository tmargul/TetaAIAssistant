import {
  BadRequestException,
  Body,
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
import type {
  ClientUpdatesStatusResponse,
  GlobalRagImportResult,
  OllamaModelPullResult,
  OllamaModelsImportResult,
  OllamaPullModel,
} from '@teta/shared';
import { OLLAMA_PULL_MODELS } from '@teta/shared';
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

  @Post('ollama/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, file, callback) => {
          const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
          callback(null, `teta-models-import-${Date.now()}-${safeName}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.zip')) {
          callback(
            new BadRequestException('Plik musi być archiwum ZIP (teta-models-update-*.zip).'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async importOllamaModels(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<OllamaModelsImportResult> {
    if (!file?.path) {
      throw new BadRequestException('Nie przesłano pliku paczki modeli.');
    }

    try {
      return await this.updates.importOllamaModels(file.path);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Post('ollama/import-path')
  importOllamaModelsFromPath(
    @Body() body: { path?: string },
  ): Promise<OllamaModelsImportResult> {
    const filePath = body.path?.trim();
    if (!filePath) {
      throw new BadRequestException('Podaj ścieżkę do pliku ZIP na serwerze (np. E:\\modele\\teta-models.zip).');
    }
    return this.updates.importOllamaModels(filePath);
  }

  @Post('ollama/pull')
  pullOllamaModel(@Body() body: { model?: string }): Promise<OllamaModelPullResult> {
    const model = body.model?.trim() as OllamaPullModel | undefined;
    if (!model || !OLLAMA_PULL_MODELS.includes(model)) {
      throw new BadRequestException(
        `Podaj model: ${OLLAMA_PULL_MODELS.join(', ')}.`,
      );
    }
    return this.updates.pullOllamaModel(model);
  }
}
