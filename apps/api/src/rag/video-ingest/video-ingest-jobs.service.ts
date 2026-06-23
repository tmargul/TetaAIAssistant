import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import type {
  RagImportMode,
  VideoIngestJobRecord,
  VideoIngestJobsListResponse,
  VideoIngestJobStatus,
  VideoIngestStreamEvent,
} from '@teta/shared';
import { DatabaseService } from '../../database/database.service';
import { getRepoRoot } from '../../config/repo-root';
import { QdrantService } from '../qdrant.service';
import { VideoIngestPipelineService } from './video-ingest-pipeline.service';

type JobRow = {
  id: number;
  original_filename: string;
  storage_path: string;
  output_dir: string | null;
  status: VideoIngestJobStatus;
  progress: number;
  progress_message: string | null;
  error_message: string | null;
  chunk_count: number | null;
  source: string | null;
  film_key: string | null;
  merge_mode: number;
  uploaded_by: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

@Injectable()
export class VideoIngestJobsService implements OnModuleInit {
  private readonly logger = new Logger(VideoIngestJobsService.name);
  private processing = false;
  private readonly listeners = new Map<number, Set<(event: VideoIngestStreamEvent) => void>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly pipeline: VideoIngestPipelineService,
    private readonly qdrant: QdrantService,
  ) {}

  onModuleInit(): void {
    void this.scheduleProcess();
  }

  private get uploadsDir(): string {
    const configured = this.config.get<string>('TETA_VIDEO_UPLOAD_DIR')?.trim();
    if (configured) {
      return configured;
    }
    return join(process.cwd(), 'data', 'video-ingest', 'uploads');
  }

  private get workDir(): string {
    return join(process.cwd(), 'data', 'video-ingest', 'work');
  }

  getMaxUploadBytes(): number {
    const raw = this.config.get<string>('TETA_VIDEO_MAX_UPLOAD_BYTES');
    const parsed = raw ? Number(raw) : 8 * 1024 * 1024 * 1024;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8 * 1024 * 1024 * 1024;
  }

  async createJob(input: {
    originalFilename: string;
    storagePath: string;
    merge: boolean;
    uploadedBy?: number | null;
  }): Promise<VideoIngestJobRecord> {
    const now = new Date().toISOString();
    const result = this.db.connection
      .prepare(
        `INSERT INTO video_ingest_jobs (
          original_filename, storage_path, status, progress, merge_mode, uploaded_by, created_at
        ) VALUES (?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .run(
        input.originalFilename,
        input.storagePath,
        input.merge ? 1 : 0,
        input.uploadedBy ?? null,
        now,
      );

    const job = this.getJob(Number(result.lastInsertRowid));
    void this.scheduleProcess();
    return job;
  }

  listJobs(limit = 50): VideoIngestJobsListResponse {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM video_ingest_jobs ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as JobRow[];

    return { jobs: rows.map((row) => this.mapRow(row)) };
  }

  getJob(jobId: number): VideoIngestJobRecord {
    const row = this.db.connection
      .prepare('SELECT * FROM video_ingest_jobs WHERE id = ?')
      .get(jobId) as JobRow | undefined;

    if (!row) {
      throw new NotFoundException(`Nie znaleziono zadania ingest wideo #${jobId}.`);
    }

    return this.mapRow(row);
  }

  findJobBySource(source: string): VideoIngestJobRecord | null {
    const row = this.db.connection
      .prepare(
        `SELECT * FROM video_ingest_jobs
         WHERE source = ? AND status = 'done'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(source) as JobRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listDoneJobs(limit = 100): VideoIngestJobRecord[] {
    const rows = this.db.connection
      .prepare(
        `SELECT * FROM video_ingest_jobs
         WHERE status = 'done' AND source IS NOT NULL
         ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as JobRow[];
    return rows.map((row) => this.mapRow(row));
  }

  async deleteTraining(input: { jobId?: number; source?: string }): Promise<void> {
    let job: VideoIngestJobRecord | null = null;
    if (input.jobId != null) {
      job = this.getJob(input.jobId);
    } else if (input.source) {
      job = this.findJobBySource(input.source);
    }

    const source = job?.source ?? input.source ?? null;
    if (!job && !source) {
      throw new NotFoundException('Nie znaleziono materiału wideo do usunięcia.');
    }

    if (job && job.status !== 'done' && job.status !== 'failed') {
      throw new BadRequestException(
        'Nie można usunąć wideo w trakcie przetwarzania — poczekaj na zakończenie zadania.',
      );
    }

    const row = job
      ? (this.db.connection.prepare('SELECT * FROM video_ingest_jobs WHERE id = ?').get(job.id) as JobRow)
      : null;

    if (source) {
      try {
        await this.qdrant.deletePointsBySource(this.qdrant.globalCollection, source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Nie udało się usunąć wektorów dla ${source}: ${message}`);
      }
    }

    await this.deleteTrainingFiles(source, job?.filmKey ?? null, row?.storage_path ?? null, row?.output_dir ?? null);

    if (job) {
      this.db.connection.prepare('DELETE FROM video_ingest_jobs WHERE id = ?').run(job.id);
      this.logger.log(`Usunięto materiał wideo: job #${job.id}, source=${source ?? '—'}`);
    } else if (source) {
      this.logger.log(`Usunięto osierocony plik wideo: ${source}`);
    }
  }

  private async deleteTrainingFiles(
    source: string | null,
    filmKey: string | null,
    storagePath: string | null,
    outputDir: string | null,
  ): Promise<void> {
    const globalRoot = join(getRepoRoot(), 'sources', 'global');
    if (source) {
      await rm(join(globalRoot, source.replace(/\\/g, '/')), { force: true });
      if (!filmKey) {
        const inferred = source.replace(/\\/g, '/').split('/').pop()?.replace(/\.mp4$/i, '');
        if (inferred) {
          await rm(join(globalRoot, 'assets', inferred), { recursive: true, force: true });
        }
      }
    }
    if (filmKey) {
      await rm(join(globalRoot, 'assets', filmKey), { recursive: true, force: true });
    }
    if (storagePath) {
      await rm(storagePath, { force: true });
    }
    if (outputDir) {
      await rm(outputDir, { recursive: true, force: true });
    }
  }

  async getTrainingFileSize(job: VideoIngestJobRecord): Promise<number> {
    const candidates = [
      job.source ? join(getRepoRoot(), 'sources', 'global', job.source.replace(/\\/g, '/')) : null,
    ];
    const row = this.db.connection
      .prepare('SELECT storage_path FROM video_ingest_jobs WHERE id = ?')
      .get(job.id) as { storage_path: string } | undefined;
    if (row?.storage_path) {
      candidates.push(row.storage_path);
    }

    for (const path of candidates) {
      if (!path) continue;
      try {
        const info = await stat(path);
        if (info.isFile()) return info.size;
      } catch {
        // spróbuj następną ścieżkę
      }
    }
    return 0;
  }

  subscribe(jobId: number, listener: (event: VideoIngestStreamEvent) => void): () => void {
    const job = this.getJob(jobId);
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);

    if (job.status === 'done') {
      listener({
        type: 'complete',
        jobId,
        status: 'done',
        chunkCount: job.chunkCount ?? 0,
        source: job.source,
      });
    } else if (job.status === 'failed') {
      listener({
        type: 'error',
        jobId,
        message: job.errorMessage ?? 'Ingest wideo nie powiódł się.',
      });
    } else {
      listener({
        type: 'progress',
        jobId,
        status: job.status,
        progress: job.progress,
        message: job.progressMessage ?? 'Oczekiwanie…',
      });
    }

    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(jobId);
      }
    };
  }

  private emit(jobId: number, event: VideoIngestStreamEvent): void {
    const set = this.listeners.get(jobId);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }

  private updateJob(
    jobId: number,
    patch: Partial<{
      status: VideoIngestJobStatus;
      progress: number;
      progressMessage: string | null;
      errorMessage: string | null;
      chunkCount: number | null;
      source: string | null;
      filmKey: string | null;
      outputDir: string | null;
      startedAt: string | null;
      finishedAt: string | null;
    }>,
  ): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.progress !== undefined) {
      fields.push('progress = ?');
      values.push(patch.progress);
    }
    if (patch.progressMessage !== undefined) {
      fields.push('progress_message = ?');
      values.push(patch.progressMessage);
    }
    if (patch.errorMessage !== undefined) {
      fields.push('error_message = ?');
      values.push(patch.errorMessage);
    }
    if (patch.chunkCount !== undefined) {
      fields.push('chunk_count = ?');
      values.push(patch.chunkCount);
    }
    if (patch.source !== undefined) {
      fields.push('source = ?');
      values.push(patch.source);
    }
    if (patch.filmKey !== undefined) {
      fields.push('film_key = ?');
      values.push(patch.filmKey);
    }
    if (patch.outputDir !== undefined) {
      fields.push('output_dir = ?');
      values.push(patch.outputDir);
    }
    if (patch.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      fields.push('finished_at = ?');
      values.push(patch.finishedAt);
    }

    if (fields.length === 0) return;

    values.push(jobId);
    this.db.connection
      .prepare(`UPDATE video_ingest_jobs SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);

    if (
      patch.status !== undefined ||
      patch.progress !== undefined ||
      patch.progressMessage !== undefined
    ) {
      const job = this.getJob(jobId);
      if (job.status !== 'done' && job.status !== 'failed') {
        this.emit(jobId, {
          type: 'progress',
          jobId,
          status: job.status,
          progress: job.progress,
          message: job.progressMessage ?? '',
        });
      }
    }
  }

  private async scheduleProcess(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const row = this.db.connection
          .prepare(
            `SELECT * FROM video_ingest_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1`,
          )
          .get() as JobRow | undefined;

        if (!row) break;
        await this.processJob(row);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(row: JobRow): Promise<void> {
    const jobId = row.id;
    const startedAt = new Date().toISOString();
    const outputDir = join(this.workDir, String(jobId));
    const importMode: RagImportMode = row.merge_mode === 1 ? 'merge' : 'replace';

    this.updateJob(jobId, {
      status: 'extracting',
      progress: 5,
      progressMessage: 'Rozpoczęto przetwarzanie…',
      outputDir,
      startedAt,
      errorMessage: null,
    });

    try {
      await mkdir(outputDir, { recursive: true });

      const result = await this.pipeline.runFromMp4File(
        row.storage_path,
        outputDir,
        importMode,
        (update) => {
          this.updateJob(jobId, {
            status: update.status,
            progress: update.progress,
            progressMessage: update.message,
          });
        },
      );

      const finishedAt = new Date().toISOString();
      this.updateJob(jobId, {
        status: 'done',
        progress: 100,
        progressMessage: 'Zakończono.',
        chunkCount: result.chunkCount,
        source: result.pythonResult.source,
        filmKey: result.pythonResult.filmKey,
        finishedAt,
      });

      this.emit(jobId, {
        type: 'complete',
        jobId,
        status: 'done',
        chunkCount: result.chunkCount,
        source: result.pythonResult.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Video ingest job #${jobId} failed: ${message}`);

      this.updateJob(jobId, {
        status: 'failed',
        progress: 100,
        progressMessage: null,
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      });

      this.emit(jobId, { type: 'error', jobId, message });
    }
  }

  async ensureUploadDir(): Promise<string> {
    await mkdir(this.uploadsDir, { recursive: true });
    return this.uploadsDir;
  }

  validateMp4Upload(file: Express.Multer.File | undefined): void {
    if (!file?.path) {
      throw new BadRequestException('Nie przesłano pliku MP4.');
    }
    if (!file.originalname.toLowerCase().endsWith('.mp4')) {
      throw new BadRequestException('Obsługiwany jest tylko format .mp4.');
    }
    if (file.size > this.getMaxUploadBytes()) {
      throw new BadRequestException(
        `Plik jest za duży (max ${Math.round(this.getMaxUploadBytes() / (1024 * 1024 * 1024))} GB).`,
      );
    }
  }

  private mapRow(row: JobRow): VideoIngestJobRecord {
    return {
      id: row.id,
      originalFilename: row.original_filename,
      status: row.status,
      progress: row.progress,
      progressMessage: row.progress_message,
      errorMessage: row.error_message,
      chunkCount: row.chunk_count,
      source: row.source,
      filmKey: row.film_key,
      mergeMode: row.merge_mode === 1,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}
