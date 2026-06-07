import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type BuildRow = {
  id: number;
  version: string | null;
  chunk_count: number;
  sources_json: string;
  built_at: string;
  package_path: string | null;
};

@Injectable()
export class RagGlobalBuildService {
  constructor(private readonly db: DatabaseService) {}

  recordBuild(input: {
    version?: string;
    chunkCount: number;
    sources: string[];
    packagePath?: string;
  }): void {
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO rag_global_builds (version, chunk_count, sources_json, built_at, package_path)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.version ?? null,
        input.chunkCount,
        JSON.stringify(input.sources),
        now,
        input.packagePath ?? null,
      );
  }

  getLatestBuild(): {
    version: string | null;
    chunkCount: number;
    sources: string[];
    builtAt: string;
    packagePath: string | null;
  } | null {
    const row = this.db.connection
      .prepare('SELECT * FROM rag_global_builds ORDER BY id DESC LIMIT 1')
      .get() as BuildRow | undefined;

    if (!row) {
      return null;
    }

    return {
      version: row.version,
      chunkCount: row.chunk_count,
      sources: JSON.parse(row.sources_json) as string[],
      builtAt: row.built_at,
      packagePath: row.package_path,
    };
  }
}
