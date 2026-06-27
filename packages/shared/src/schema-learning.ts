export const SCHEMA_ENTITY_OBJECT_TYPES = [
  'table',
  'view',
  'package',
  'procedure',
  'function',
] as const;

export type SchemaEntityObjectType = (typeof SCHEMA_ENTITY_OBJECT_TYPES)[number];

export const SCHEMA_ENTITY_LINK_SOURCES = [
  'seed',
  'learned',
  'admin',
  'conversation',
  'clarification',
  'confirmed',
] as const;

export type SchemaEntityLinkSource = (typeof SCHEMA_ENTITY_LINK_SOURCES)[number];

export const SCHEMA_ENTITY_RAG_SOURCE_PREFIX = 'schema-entities/' as const;

export interface SchemaEntityLinkRecord {
  id: number;
  tags: string[];
  objectType: SchemaEntityObjectType;
  owner: string | null;
  name: string;
  columnHints: string[];
  confidence: number;
  useCount: number;
  source: SchemaEntityLinkSource;
  userQuestion: string | null;
  conversationId: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SchemaEntityLinkInput {
  tags: string[];
  objectType: SchemaEntityObjectType;
  owner?: string | null;
  name: string;
  columnHints?: string[];
  confidence?: number;
  source?: SchemaEntityLinkSource;
  userQuestion?: string | null;
  conversationId?: string | null;
  notes?: string | null;
}

export interface SchemaEntityLinksListResponse {
  links: SchemaEntityLinkRecord[];
  total: number;
}

export interface SchemaEntityLearningStatsResponse {
  linkCount: number;
  tagCount: number;
  ragChunkCount: number;
  lastSyncedAt: string | null;
}

export interface SchemaEntityRagSyncResult {
  chunkCount: number;
  collection: string;
  syncedAt: string;
}

export interface SchemaEntityLearnConversationResult {
  linksCreated: number;
  linksUpdated: number;
}
