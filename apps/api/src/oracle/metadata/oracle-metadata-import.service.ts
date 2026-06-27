import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { join } from 'path';
import type {
  OracleMetadataObjectKind,
  OracleMetadataObjects,
  OracleMetadataObjectsPageResponse,
  OracleMetadataStatusResponse,
} from '@teta/shared';
import { DatabaseService } from '../../database/database.service';
import { OracleConnectionService } from '../oracle-connection.service';
import { OracleMetadataImportPipelineService } from './oracle-metadata-import.pipeline.service';
import {
  catalogToCounts,
  catalogToObjects,
  emptyOracleMetadataCounts,
  emptyOracleMetadataObjects,
} from './oracle-metadata.types';

type JobStatus = 'queued' | 'running' | 'done' | 'failed';

type JobRow = {
  id: number;
  status: JobStatus;
  progress: number;
  progress_message: string | null;
  error_message: string | null;
  chunk_count: number | null;
  jsonl_path: string | null;
  counts_json: string | null;
  objects_json: string | null;
  owners_json: string | null;
  catalog_totals_json: string | null;
  teta_version: string | null;
  pilot_module: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

@Injectable()
export class OracleMetadataImportService implements OnModuleInit {
  private readonly logger = new Logger(OracleMetadataImportService.name);
  private processing = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly oracleConnection: OracleConnectionService,
    private readonly pipeline: OracleMetadataImportPipelineService,
  ) {}

  onModuleInit(): void {
    const now = new Date().toISOString();
    const orphaned = this.db.connection
      .prepare(
        `UPDATE oracle_metadata_import_jobs
         SET status = 'failed',
             progress = 0,
             progress_message = 'Przerwano (restart serwera).',
             error_message = 'Import został przerwany przez restart API. Uruchom import ponownie.',
             finished_at = ?
         WHERE status = 'running'`,
      )
      .run(now);

    if (orphaned.changes > 0) {
      this.logger.warn(
        `Oznaczono ${orphaned.changes} przerwanych importów Oracle jako failed po restarcie API.`,
      );
    }

    void this.scheduleProcess();
  }

  getStatus(): OracleMetadataStatusResponse {
    const configured = this.oracleConnection.getStatus().configured;
    const active = this.getActiveJob();
    const latest = this.getLatestFinishedJob();

    if (active) {
      return this.buildStatusFromJob(active, configured, true);
    }

    if (latest) {
      return this.buildStatusFromJob(latest, configured, true);
    }

    return {
      available: true,
      status: 'idle',
      lastImportedAt: null,
      owners: [],
      counts: emptyOracleMetadataCounts(),
      objects: emptyOracleMetadataObjects(),
      pilotModule: null,
      tetaVersion: null,
      message: configured
        ? 'Połączenie skonfigurowane. Uruchom import metadanych Oracle.'
        : 'Skonfiguruj konto read-only w sekcji poniżej, potem uruchom import.',
    };
  }

  async startImport(): Promise<OracleMetadataStatusResponse> {
    if (!this.oracleConnection.getStatus().configured) {
      throw new BadRequestException('Skonfiguruj połączenie Oracle przed importem metadanych.');
    }

    if (this.getActiveJob()) {
      throw new BadRequestException('Import metadanych Oracle jest już w toku.');
    }

    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO oracle_metadata_import_jobs (status, progress, progress_message, created_at)
         VALUES ('queued', 0, 'Oczekiwanie w kolejce…', ?)`,
      )
      .run(now);

    void this.scheduleProcess();
    return this.getStatus();
  }

  listObjects(
    kind: OracleMetadataObjectKind,
    offset = 0,
    limit = 200,
  ): OracleMetadataObjectsPageResponse {
    const job = this.getLatestDoneJobWithObjects();
    if (!job?.objects_json) {
      return { kind, total: 0, offset: 0, limit, items: [] };
    }

    const objects = JSON.parse(job.objects_json) as OracleMetadataObjects;
    const all = objects[kind] ?? [];
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(Math.max(1, limit), 500);

    return {
      kind,
      total: all.length,
      offset: safeOffset,
      limit: safeLimit,
      items: all.slice(safeOffset, safeOffset + safeLimit),
    };
  }

  private getLatestDoneJobWithObjects(): JobRow | undefined {
    return this.db.connection
      .prepare(
        `SELECT * FROM oracle_metadata_import_jobs
         WHERE status = 'done' AND objects_json IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get() as JobRow | undefined;
  }

  private getActiveJob(): JobRow | undefined {
    return this.db.connection
      .prepare(
        `SELECT * FROM oracle_metadata_import_jobs
         WHERE status IN ('queued', 'running')
         ORDER BY id DESC LIMIT 1`,
      )
      .get() as JobRow | undefined;
  }

  private getLatestFinishedJob(): JobRow | undefined {
    return this.db.connection
      .prepare(
        `SELECT * FROM oracle_metadata_import_jobs
         WHERE status IN ('done', 'failed')
         ORDER BY id DESC LIMIT 1`,
      )
      .get() as JobRow | undefined;
  }

  private buildStatusFromJob(
    row: JobRow,
    configured: boolean,
    available: boolean,
  ): OracleMetadataStatusResponse {
    const counts = row.counts_json
      ? (JSON.parse(row.counts_json) as OracleMetadataStatusResponse['counts'])
      : emptyOracleMetadataCounts();
    const owners = row.owners_json
      ? (JSON.parse(row.owners_json) as string[])
      : [];
    const catalogTotals = row.catalog_totals_json
      ? (JSON.parse(row.catalog_totals_json) as OracleMetadataStatusResponse['catalogTotals'])
      : null;

    const uiStatus =
      row.status === 'queued' || row.status === 'running'
        ? 'running'
        : row.status === 'done'
          ? 'done'
          : row.status === 'failed'
            ? 'failed'
            : 'idle';

    let message = row.progress_message ?? undefined;
    if (row.status === 'failed' && row.error_message) {
      message = row.error_message;
    } else if (row.status === 'done') {
      message =
        (row.chunk_count ?? 0) > 0
          ? `Import zakończony — ${row.chunk_count} chunków w Qdrant.`
          : 'Import zakończony — graf schematu gotowy (indeks Qdrant pominięty domyślnie).';
    } else if (row.status === 'running' || row.status === 'queued') {
      message = row.progress_message ?? 'Import metadanych Oracle w toku…';
    } else if (!configured) {
      message = 'Skonfiguruj konto read-only przed importem.';
    }

    return {
      available,
      status: uiStatus,
      lastImportedAt: row.status === 'done' ? row.finished_at : null,
      owners,
      counts,
      objects: emptyOracleMetadataObjects(),
      objectListsAvailable: row.status === 'done' && !!row.objects_json,
      pilotModule: row.pilot_module,
      tetaVersion: row.teta_version,
      catalogTotals,
      progress:
        row.status === 'queued' || row.status === 'running' ? row.progress : row.status === 'done' ? 100 : null,
      progressMessage:
        row.status === 'queued' || row.status === 'running'
          ? row.progress_message
          : row.status === 'done'
            ? 'Zakończono.'
            : null,
      message,
    };
  }

  private async scheduleProcess(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const row = this.db.connection
          .prepare(
            `SELECT * FROM oracle_metadata_import_jobs
             WHERE status = 'queued'
             ORDER BY id ASC LIMIT 1`,
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
    const outputDir = join(process.cwd(), 'data', 'oracle-metadata', String(jobId));

    this.updateJob(jobId, {
      status: 'running',
      progress: 5,
      progressMessage: 'Rozpoczęto import metadanych Oracle…',
      startedAt,
      errorMessage: null,
    });

    try {
      const result = await this.pipeline.run(outputDir, (update) => {
        this.updateJob(jobId, {
          progress: update.progress,
          progressMessage: update.message,
        });
      });

      const counts = catalogToCounts(result.catalog);
      const objects = catalogToObjects(result.catalog);
      const finishedAt = new Date().toISOString();

      this.updateJob(jobId, {
        status: 'done',
        progress: 100,
        progressMessage: 'Zakończono.',
        chunkCount: result.chunkCount,
        jsonlPath: result.jsonlPath,
        countsJson: JSON.stringify(counts),
        objectsJson: JSON.stringify(objects),
        ownersJson: JSON.stringify(result.catalog.owners),
        catalogTotalsJson: JSON.stringify(result.catalogTotals),
        tetaVersion: result.catalog.tetaVersion,
        pilotModule: result.catalog.pilotModule,
        finishedAt,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Oracle metadata import #${jobId} failed: ${message}`);
      this.updateJob(jobId, {
        status: 'failed',
        progress: 0,
        progressMessage: 'Import nie powiódł się.',
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  private updateJob(
    jobId: number,
    patch: {
      status?: JobStatus;
      progress?: number;
      progressMessage?: string | null;
      errorMessage?: string | null;
      chunkCount?: number;
      jsonlPath?: string;
      countsJson?: string;
      objectsJson?: string;
      ownersJson?: string;
      catalogTotalsJson?: string;
      tetaVersion?: string | null;
      pilotModule?: string | null;
      startedAt?: string;
      finishedAt?: string;
    },
  ): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    const set = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.status !== undefined) set('status', patch.status);
    if (patch.progress !== undefined) set('progress', patch.progress);
    if (patch.progressMessage !== undefined) set('progress_message', patch.progressMessage);
    if (patch.errorMessage !== undefined) set('error_message', patch.errorMessage);
    if (patch.chunkCount !== undefined) set('chunk_count', patch.chunkCount);
    if (patch.jsonlPath !== undefined) set('jsonl_path', patch.jsonlPath);
    if (patch.countsJson !== undefined) set('counts_json', patch.countsJson);
    if (patch.objectsJson !== undefined) set('objects_json', patch.objectsJson);
    if (patch.ownersJson !== undefined) set('owners_json', patch.ownersJson);
    if (patch.catalogTotalsJson !== undefined) set('catalog_totals_json', patch.catalogTotalsJson);
    if (patch.tetaVersion !== undefined) set('teta_version', patch.tetaVersion);
    if (patch.pilotModule !== undefined) set('pilot_module', patch.pilotModule);
    if (patch.startedAt !== undefined) set('started_at', patch.startedAt);
    if (patch.finishedAt !== undefined) set('finished_at', patch.finishedAt);

    if (fields.length === 0) return;

    values.push(jobId);
    this.db.connection
      .prepare(`UPDATE oracle_metadata_import_jobs SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }
}
