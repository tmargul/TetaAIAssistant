import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import type { Request, Response } from 'express';
import type { AuthUser, VideoIngestStreamEvent } from '@teta/shared';
import { VendorAccessGuard } from '../vendor-access.guard';
import { VideoIngestJobsService } from './video-ingest-jobs.service';

type VendorRequest = Request & { user?: AuthUser };

function videoUploadDir(): string {
  const dir = join(process.cwd(), 'data', 'video-ingest', 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

@Controller('vendor/rag/ingest/video')
@UseGuards(VendorAccessGuard)
export class VendorVideoIngestController {
  constructor(private readonly jobs: VideoIngestJobsService) {}

  @Get()
  listJobs() {
    return this.jobs.listJobs();
  }

  @Get(':id/events')
  async streamEvents(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const job = this.jobs.getJob(id);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeEvent = (event: VideoIngestStreamEvent) => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    if (job.status === 'done') {
      writeEvent({
        type: 'complete',
        jobId: id,
        status: 'done',
        chunkCount: job.chunkCount ?? 0,
        source: job.source,
      });
      res.end();
      return;
    }

    if (job.status === 'failed') {
      writeEvent({
        type: 'error',
        jobId: id,
        message: job.errorMessage ?? 'Ingest wideo nie powiódł się.',
      });
      res.end();
      return;
    }

    writeEvent({
      type: 'progress',
      jobId: id,
      status: job.status,
      progress: job.progress,
      message: job.progressMessage ?? 'Oczekiwanie…',
    });

    const unsubscribe = this.jobs.subscribe(id, (event) => {
      writeEvent(event);
      if (event.type === 'complete' || event.type === 'error') {
        unsubscribe();
        res.end();
      }
    });

    res.on('close', () => {
      unsubscribe();
    });
  }

  @Get(':id')
  getJob(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.getJob(id);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          callback(null, videoUploadDir());
        },
        filename: (_req, file, callback) => {
          const safeName = file.originalname.replace(/[^\w.\-]+/g, '_');
          callback(null, `video-${Date.now()}-${safeName}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.mp4')) {
          callback(new BadRequestException('Obsługiwany jest tylko format .mp4.'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Query('merge') merge: string | undefined,
    @Req() req: VendorRequest,
  ) {
    this.jobs.validateMp4Upload(file);
    const mergeMode = merge === 'true' || merge === '1';
    return this.jobs.createJob({
      originalFilename: file.originalname,
      storagePath: file.path,
      merge: mergeMode,
      uploadedBy: req.user?.id ?? null,
    });
  }
}
