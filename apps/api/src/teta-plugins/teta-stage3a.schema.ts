/**
 * Stage 3A — SQLite schema DDL for canonical graph index.
 */

export const STAGE3A_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = OFF;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS kg_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kg_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  domain TEXT,
  name TEXT,
  canonical_name TEXT,
  normalized_name TEXT,
  owner TEXT,
  object_type TEXT,
  confidence TEXT,
  source_stages_json TEXT,
  attributes_json TEXT,
  evidence_json TEXT,
  semantic_normalization_json TEXT
);

CREATE TABLE IF NOT EXISTS kg_edges (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  confidence TEXT,
  source_stages_json TEXT,
  attributes_json TEXT,
  evidence_json TEXT
);

CREATE TABLE IF NOT EXISTS kg_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  name_kind TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kg_conflicts (
  conflict_id TEXT PRIMARY KEY,
  conflict_type TEXT,
  subject_id TEXT,
  resolution_status TEXT,
  alternatives_json TEXT,
  evidence_json TEXT
);

CREATE TABLE IF NOT EXISTS kg_reference_chains (
  reference_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  node_ids_json TEXT,
  edge_ids_json TEXT,
  validation_json TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON kg_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_domain ON kg_nodes(domain);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_normalized_name ON kg_nodes(normalized_name);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_name ON kg_nodes(name);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_cname ON kg_nodes(canonical_name);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_owner_otype_cname ON kg_nodes(owner, object_type, canonical_name);

CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON kg_edges(to_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_type ON kg_edges(type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_from_type ON kg_edges(from_id, type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to_type ON kg_edges(to_id, type);

CREATE INDEX IF NOT EXISTS idx_kg_names_norm ON kg_names(normalized_value);
CREATE INDEX IF NOT EXISTS idx_kg_names_kind_norm ON kg_names(name_kind, normalized_value);

CREATE INDEX IF NOT EXISTS idx_kg_conflicts_subject ON kg_conflicts(subject_id);
CREATE INDEX IF NOT EXISTS idx_kg_conflicts_status ON kg_conflicts(resolution_status);
`;
