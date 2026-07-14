import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type TetaPluginImportRow = {
  dll_path: string;
  dll_name: string;
  relative_path: string;
  category_dir: string | null;
  imported_at: string;
  chunk_count: number;
  metadata_json: string | null;
  updated_at: string;
};

export type TetaPluginImportUpsert = {
  dllPath: string;
  dllName: string;
  relativePath: string;
  categoryDir: string;
  importedAt: string;
  chunkCount: number;
  metadataJson?: string | null;
};

@Injectable()
export class TetaPluginRegistryService {
  constructor(private readonly db: DatabaseService) {}

  listImportsByPath(): Map<string, TetaPluginImportRow> {
    const rows = this.db.connection
      .prepare('SELECT * FROM teta_plugin_imports')
      .all() as TetaPluginImportRow[];

    const map = new Map<string, TetaPluginImportRow>();
    for (const row of rows) {
      map.set(row.dll_path.toLowerCase(), row);
    }
    return map;
  }

  getImportByPath(dllPath: string): TetaPluginImportRow | null {
    const row = this.db.connection
      .prepare('SELECT * FROM teta_plugin_imports WHERE lower(dll_path) = lower(?)')
      .get(dllPath) as TetaPluginImportRow | undefined;
    return row ?? null;
  }

  findImportByRelativePath(relativePath: string): TetaPluginImportRow | null {
    const target = this.normalizeRelativePathKey(relativePath);
    const rows = this.db.connection
      .prepare('SELECT * FROM teta_plugin_imports')
      .all() as TetaPluginImportRow[];

    for (const row of rows) {
      if (this.normalizeRelativePathKey(row.relative_path) === target) {
        return row;
      }
    }
    return null;
  }

  findImportByDllName(dllName: string): TetaPluginImportRow | null {
    const normalized = dllName.trim().toLowerCase().replace(/\.dll$/i, '');
    const rows = this.db.connection
      .prepare('SELECT * FROM teta_plugin_imports')
      .all() as TetaPluginImportRow[];

    for (const row of rows) {
      const rowName = row.dll_name.toLowerCase().replace(/\.dll$/i, '');
      if (rowName === normalized) {
        return row;
      }
    }
    return null;
  }

  private normalizeRelativePathKey(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/\.dll$/i, '').toLowerCase();
  }

  upsertImport(input: TetaPluginImportUpsert): void {
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO teta_plugin_imports (
          dll_path, dll_name, relative_path, category_dir,
          imported_at, chunk_count, metadata_json, updated_at
        ) VALUES (
          @dll_path, @dll_name, @relative_path, @category_dir,
          @imported_at, @chunk_count, @metadata_json, @updated_at
        )
        ON CONFLICT(dll_path) DO UPDATE SET
          dll_name = excluded.dll_name,
          relative_path = excluded.relative_path,
          category_dir = excluded.category_dir,
          imported_at = excluded.imported_at,
          chunk_count = excluded.chunk_count,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
      )
      .run({
        dll_path: input.dllPath,
        dll_name: input.dllName,
        relative_path: input.relativePath,
        category_dir: input.categoryDir || null,
        imported_at: input.importedAt,
        chunk_count: input.chunkCount,
        metadata_json: input.metadataJson ?? null,
        updated_at: now,
      });
  }

  deleteImport(dllPath: string): boolean {
    const result = this.db.connection
      .prepare('DELETE FROM teta_plugin_imports WHERE lower(dll_path) = lower(?)')
      .run(dllPath);
    return result.changes > 0;
  }

  deleteAllImports(): number {
    const result = this.db.connection.prepare('DELETE FROM teta_plugin_imports').run();
    return result.changes;
  }

  listImports(): TetaPluginImportRow[] {
    return this.db.connection
      .prepare('SELECT * FROM teta_plugin_imports ORDER BY dll_name COLLATE NOCASE')
      .all() as TetaPluginImportRow[];
  }
}
