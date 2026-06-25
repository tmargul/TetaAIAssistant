import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('DATABASE_URL', 'file:./data/teta.sqlite');
    const filePath = url.startsWith('file:') ? url.slice(5) : url;
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  onModuleDestroy() {
    this.db?.close();
  }

  get connection(): Database.Database {
    return this.db;
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oracle_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL,
        host TEXT,
        port INTEGER,
        identifier_type TEXT,
        identifier TEXT,
        tns_alias TEXT,
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oracle_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        is_active INTEGER NOT NULL DEFAULT 1,
        granted_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS teta_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by INTEGER REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS rag_global_builds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT,
        chunk_count INTEGER NOT NULL,
        sources_json TEXT NOT NULL,
        built_at TEXT NOT NULL,
        package_path TEXT
      );

      CREATE TABLE IF NOT EXISTS rag_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL,
        storage_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'indexed', 'failed')),
        chunk_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        indexed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS video_ingest_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_filename TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        output_dir TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'transcribing', 'indexing', 'done', 'failed')),
        progress INTEGER NOT NULL DEFAULT 0,
        progress_message TEXT,
        error_message TEXT,
        chunk_count INTEGER,
        source TEXT,
        film_key TEXT,
        merge_mode INTEGER NOT NULL DEFAULT 1,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS oracle_metadata_import_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
        progress INTEGER NOT NULL DEFAULT 0,
        progress_message TEXT,
        error_message TEXT,
        chunk_count INTEGER,
        jsonl_path TEXT,
        counts_json TEXT,
        objects_json TEXT,
        owners_json TEXT,
        teta_version TEXT,
        pilot_module TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        messages_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_updated
        ON chat_conversations(user_id, updated_at DESC);
    `);

    this.ensureColumn('oracle_metadata_import_jobs', 'catalog_totals_json', 'TEXT');
    this.ensureColumn('oracle_metadata_import_jobs', 'import_limits_json', 'TEXT');
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as { name: string }[];
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
