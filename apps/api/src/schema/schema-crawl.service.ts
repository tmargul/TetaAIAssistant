import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { SchemaCrawlStatus, SchemaGraphStatsResponse } from '@teta/shared';
import { DatabaseService } from '../database/database.service';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import { SchemaGraphService } from './schema-graph.service';

type JobStatus = 'queued' | 'running' | 'done' | 'failed';

type JobRow = {
  id: number;
  status: JobStatus;
  progress: number;
  progress_message: string | null;
  error_message: string | null;
  node_count: number | null;
  column_count: number | null;
  edge_count: number | null;
  source_line_count: number | null;
  owners_json: string | null;
  teta_version: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

@Injectable()
export class SchemaCrawlService implements OnModuleInit {
  private readonly logger = new Logger(SchemaCrawlService.name);
  private processing = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly oracleConnection: OracleConnectionService,
    private readonly graph: SchemaGraphService,
  ) {}

  onModuleInit(): void {
    const now = new Date().toISOString();
    const orphaned = this.db.connection
      .prepare(
        `UPDATE schema_crawl_jobs
         SET status = 'failed',
             progress = 0,
             progress_message = 'Przerwano (restart serwera).',
             error_message = 'Analiza została przerwana przez restart API.',
             finished_at = ?
         WHERE status = 'running'`,
      )
      .run(now);

    if (orphaned.changes > 0) {
      this.logger.warn(`Oznaczono ${orphaned.changes} przerwanych analiz schematu jako failed.`);
    }
  }

  getStats(): SchemaGraphStatsResponse {
    const configured = this.oracleConnection.getStatus().configured;
    const active = this.getActiveJob();
    const latest = this.getLatestFinishedJob();
    const counts = this.graph.getCounts();

    if (active) {
      return this.buildStatsFromJob(active, configured, counts);
    }

    if (latest) {
      return this.buildStatsFromJob(latest, configured, counts);
    }

    return {
      available: configured,
      status: counts.nodeCount > 0 ? 'done' : 'idle',
      lastAnalyzedAt: null,
      nodeCount: counts.nodeCount,
      columnCount: counts.columnCount,
      edgeCount: counts.edgeCount,
      experiencePathCount: counts.experiencePathCount,
      sourceLineCount: counts.sourceLineCount,
      tetaVersion: null,
      owners: [],
      message: configured
        ? 'Połączenie skonfigurowane. Uruchom analizę bazy.'
        : 'Skonfiguruj połączenie Oracle, potem uruchom analizę.',
    };
  }

  async buildGraphFromCatalog(
    catalog: import('../oracle/metadata/oracle-metadata.types').OracleMetadataCatalogSnapshot,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<GraphBuildJobResult> {
    const now = new Date().toISOString();
    const insert = this.db.connection
      .prepare(
        `INSERT INTO schema_crawl_jobs (status, progress, progress_message, created_at, started_at)
         VALUES ('running', 5, 'Budowanie grafu schematu…', ?, ?)`,
      )
      .run(now, now);
    const jobId = Number(insert.lastInsertRowid);

    try {
      onProgress?.(55, 'Budowanie grafu relacji (węzły, krawędzie)…');
      const result = this.graph.buildFromCatalog(catalog, jobId);
      const finishedAt = new Date().toISOString();

      this.db.connection
        .prepare(
          `UPDATE schema_crawl_jobs
           SET status = 'done',
               progress = 100,
               progress_message = 'Graf schematu gotowy.',
               node_count = ?,
               column_count = ?,
               edge_count = ?,
               source_line_count = ?,
               owners_json = ?,
               teta_version = ?,
               finished_at = ?
           WHERE id = ?`,
        )
        .run(
          result.nodeCount,
          result.columnCount,
          result.edgeCount,
          result.sourceLineCount,
          JSON.stringify(catalog.owners),
          catalog.tetaVersion,
          finishedAt,
          jobId,
        );

      return { jobId, ...result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.connection
        .prepare(
          `UPDATE schema_crawl_jobs
           SET status = 'failed',
               progress = 0,
               progress_message = 'Budowa grafu nie powiodła się.',
               error_message = ?,
               finished_at = ?
           WHERE id = ?`,
        )
        .run(message, new Date().toISOString(), jobId);
      throw err;
    }
  }

  scheduleProcess(run: () => Promise<void>): void {
    if (this.processing) return;
    this.processing = true;
    void run()
      .catch((err) => {
        this.logger.error(`Schema crawl processor error: ${String(err)}`);
      })
      .finally(() => {
        this.processing = false;
      });
  }

  getActiveJob(): JobRow | null {
    return (
      (this.db.connection
        .prepare(
          `SELECT * FROM schema_crawl_jobs
           WHERE status IN ('queued', 'running')
           ORDER BY id DESC LIMIT 1`,
        )
        .get() as JobRow | undefined) ?? null
    );
  }

  private getLatestFinishedJob(): JobRow | null {
    return (
      (this.db.connection
        .prepare(
          `SELECT * FROM schema_crawl_jobs
           WHERE status IN ('done', 'failed')
           ORDER BY finished_at DESC, id DESC LIMIT 1`,
        )
        .get() as JobRow | undefined) ?? null
    );
  }

  private buildStatsFromJob(
    row: JobRow,
    configured: boolean,
    liveCounts: ReturnType<SchemaGraphService['getCounts']>,
  ): SchemaGraphStatsResponse {
    const status: SchemaCrawlStatus =
      row.status === 'queued' || row.status === 'running'
        ? 'running'
        : row.status === 'done'
          ? 'done'
          : row.status === 'failed'
            ? 'failed'
            : 'idle';

    let owners: string[] = [];
    if (row.owners_json) {
      try {
        owners = JSON.parse(row.owners_json) as string[];
      } catch {
        owners = [];
      }
    }

    return {
      available: configured,
      status,
      lastAnalyzedAt: row.finished_at ?? row.started_at ?? row.created_at,
      nodeCount: liveCounts.nodeCount || row.node_count || 0,
      columnCount: liveCounts.columnCount || row.column_count || 0,
      edgeCount: liveCounts.edgeCount || row.edge_count || 0,
      experiencePathCount: liveCounts.experiencePathCount,
      sourceLineCount: liveCounts.sourceLineCount || row.source_line_count || 0,
      tetaVersion: row.teta_version,
      owners,
      progress: row.status === 'running' || row.status === 'queued' ? row.progress : null,
      progressMessage: row.progress_message,
      message:
        row.status === 'failed'
          ? row.error_message ?? 'Analiza schematu nie powiodła się.'
          : undefined,
    };
  }
}

export type GraphBuildJobResult = {
  jobId: number;
  nodeCount: number;
  columnCount: number;
  edgeCount: number;
  sourceLineCount: number;
};
