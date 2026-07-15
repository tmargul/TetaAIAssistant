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

      CREATE TABLE IF NOT EXISTS schema_crawl_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
        progress INTEGER NOT NULL DEFAULT 0,
        progress_message TEXT,
        error_message TEXT,
        node_count INTEGER,
        column_count INTEGER,
        edge_count INTEGER,
        source_line_count INTEGER,
        owners_json TEXT,
        teta_version TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS schema_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        node_type TEXT NOT NULL CHECK (node_type IN ('table', 'view')),
        comment TEXT,
        crawl_job_id INTEGER REFERENCES schema_crawl_jobs(id),
        UNIQUE(owner, name, node_type)
      );

      CREATE INDEX IF NOT EXISTS idx_schema_nodes_name ON schema_nodes(name);
      CREATE INDEX IF NOT EXISTS idx_schema_nodes_owner_name ON schema_nodes(owner, name);

      CREATE TABLE IF NOT EXISTS schema_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL REFERENCES schema_nodes(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data_type TEXT NOT NULL,
        nullable INTEGER NOT NULL DEFAULT 1,
        is_pk INTEGER NOT NULL DEFAULT 0,
        comment TEXT,
        UNIQUE(node_id, name)
      );

      CREATE INDEX IF NOT EXISTS idx_schema_columns_node ON schema_columns(node_id);

      CREATE TABLE IF NOT EXISTS schema_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_node_id INTEGER NOT NULL REFERENCES schema_nodes(id) ON DELETE CASCADE,
        to_node_id INTEGER NOT NULL REFERENCES schema_nodes(id) ON DELETE CASCADE,
        from_column TEXT NOT NULL,
        to_column TEXT NOT NULL,
        edge_type TEXT NOT NULL CHECK (edge_type IN ('fk', 'inferred', 'learned')),
        confidence REAL NOT NULL DEFAULT 1.0,
        source TEXT,
        crawl_job_id INTEGER REFERENCES schema_crawl_jobs(id),
        UNIQUE(from_node_id, to_node_id, from_column, to_column)
      );

      CREATE INDEX IF NOT EXISTS idx_schema_edges_from ON schema_edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_schema_edges_to ON schema_edges(to_node_id);

      CREATE TABLE IF NOT EXISTS experience_paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_table TEXT NOT NULL,
        to_table TEXT NOT NULL,
        path_json TEXT NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 1,
        last_used_at TEXT,
        created_by TEXT,
        UNIQUE(from_table, to_table, path_json)
      );

      CREATE TABLE IF NOT EXISTS schema_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        line INTEGER NOT NULL,
        text TEXT NOT NULL,
        UNIQUE(owner, name, object_type, line)
      );

      CREATE INDEX IF NOT EXISTS idx_schema_sources_object
        ON schema_sources(owner, name, object_type);

      CREATE TABLE IF NOT EXISTS oracle_agent_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        domain TEXT,
        action_type TEXT NOT NULL,
        sql_text TEXT,
        success INTEGER NOT NULL,
        row_count INTEGER,
        error_message TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_entity_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_type TEXT NOT NULL CHECK (object_type IN ('table', 'view', 'package', 'procedure', 'function')),
        owner TEXT,
        name TEXT NOT NULL,
        column_hints TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        use_count INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL CHECK (source IN ('seed', 'learned', 'admin', 'conversation', 'clarification', 'confirmed')),
        user_question TEXT,
        conversation_id TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        UNIQUE(object_type, owner, name)
      );

      CREATE INDEX IF NOT EXISTS idx_schema_entity_links_name ON schema_entity_links(name);
      CREATE INDEX IF NOT EXISTS idx_schema_entity_links_owner_name ON schema_entity_links(owner, name);

      CREATE TABLE IF NOT EXISTS schema_entity_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_id INTEGER NOT NULL REFERENCES schema_entity_links(id) ON DELETE CASCADE,
        tag TEXT NOT NULL COLLATE NOCASE,
        UNIQUE(link_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_schema_entity_tags_tag ON schema_entity_tags(tag);

      CREATE TABLE IF NOT EXISTS schema_learning_sync (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_synced_at TEXT,
        rag_chunk_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teta_plugin_imports (
        dll_path TEXT PRIMARY KEY,
        dll_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        category_dir TEXT,
        imported_at TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_teta_plugin_imports_name ON teta_plugin_imports(dll_name);
    `);

    this.ensureColumn('teta_plugin_imports', 'metadata_json', 'TEXT');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teta_app_objects (
        object_id TEXT PRIMARY KEY,
        dll_path TEXT NOT NULL,
        dll_name TEXT NOT NULL,
        form_guid TEXT,
        form_name TEXT NOT NULL,
        field_label TEXT,
        help_title TEXT,
        help_summary TEXT,
        help_field_text TEXT,
        help_section TEXT,
        binding_json TEXT,
        keywords_json TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'inferred')),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_teta_app_objects_dll ON teta_app_objects(dll_path);
      CREATE INDEX IF NOT EXISTS idx_teta_app_objects_form ON teta_app_objects(form_name);
      CREATE INDEX IF NOT EXISTS idx_teta_app_objects_field ON teta_app_objects(field_label);
    `);

    this.ensureColumn('oracle_metadata_import_jobs', 'catalog_totals_json', 'TEXT');
    this.ensureColumn('oracle_metadata_import_jobs', 'import_limits_json', 'TEXT');
    this.ensureColumn('schema_columns', 'data_default', 'TEXT');
    this.migrateSchemaEntityLinkSources();
  }

  private migrateSchemaEntityLinkSources() {
    const ddl = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'schema_entity_links'")
      .get() as { sql?: string } | undefined;
    if (!ddl?.sql || ddl.sql.includes("'confirmed'")) {
      return;
    }

    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE schema_entity_links_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_type TEXT NOT NULL CHECK (object_type IN ('table', 'view', 'package', 'procedure', 'function')),
        owner TEXT,
        name TEXT NOT NULL,
        column_hints TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        use_count INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL CHECK (source IN ('seed', 'learned', 'admin', 'conversation', 'clarification', 'confirmed')),
        user_question TEXT,
        conversation_id TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        UNIQUE(object_type, owner, name)
      );
      INSERT INTO schema_entity_links_new
      SELECT * FROM schema_entity_links;
      DROP TABLE schema_entity_links;
      ALTER TABLE schema_entity_links_new RENAME TO schema_entity_links;
      CREATE INDEX IF NOT EXISTS idx_schema_entity_links_name ON schema_entity_links(name);
      CREATE INDEX IF NOT EXISTS idx_schema_entity_links_owner_name ON schema_entity_links(owner, name);
      PRAGMA foreign_keys = ON;
    `);
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
