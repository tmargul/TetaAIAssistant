import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import type {
  ClientUpdatesStatusResponse,
  GlobalRagImportResult,
  OllamaModelPullProgress,
  OllamaModelPullStreamEvent,
  OllamaModelsImportResult,
  OllamaPullModel,
  PathBrowseResponse,
} from '@teta/shared';
import { OLLAMA_PULL_MODELS } from '@teta/shared';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminPathBrowserService } from './admin-path-browser.service';
import { AdminUpdatesService } from './admin-updates.service';

@Controller('admin/updates')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUpdatesController {
  constructor(
    private readonly updates: AdminUpdatesService,
    private readonly pathBrowser: AdminPathBrowserService,
  ) {}

  @Get('status')
  getStatus(): Promise<ClientUpdatesStatusResponse> {
    return this.updates.getStatus();
  }

  @Get('browse')
  browsePaths(
    @Query('path') browsePath?: string,
    @Query('filter') filter?: 'zip' | 'directories',
  ): Promise<PathBrowseResponse> {
    const fileFilter = filter === 'directories' ? 'directories' : 'zip';
    return this.pathBrowser.browse(browsePath, fileFilter);
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
  async pullOllamaModel(
    @Body() body: { model?: string },
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const model = body.model?.trim() as OllamaPullModel | undefined;
    if (!model || !OLLAMA_PULL_MODELS.includes(model)) {
      throw new BadRequestException(
        `Podaj model: ${OLLAMA_PULL_MODELS.join(', ')}.`,
      );
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event: OllamaModelPullStreamEvent) => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await this.updates.pullOllamaModelWithProgress(model, (progress: OllamaModelPullProgress) => {
        writeEvent({ type: 'progress', ...progress });
      });
      writeEvent({ type: 'complete', model, status: 'complete' });
      res.end();
    } catch (error) {
      const message =
        error instanceof BadRequestException
          ? (error.getResponse() as string | { message?: string | string[] })
          : error instanceof Error
            ? error.message
            : 'Pobieranie modelu nie powiodło się.';

      const text =
        typeof message === 'string'
          ? message
          : Array.isArray(message.message)
            ? message.message.join(', ')
            : (message.message ?? 'Pobieranie modelu nie powiodło się.');

      if (!res.headersSent) {
        res.status(400).json({ message: text });
        return;
      }

      writeEvent({ type: 'error', message: text });
      res.end();
    }
  }
}
