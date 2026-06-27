export type SchemaCrawlStatus = 'idle' | 'running' | 'done' | 'failed';

export type SchemaNodeType = 'table' | 'view';

export type SchemaEdgeType = 'fk' | 'inferred' | 'learned';

export interface SchemaGraphStatsResponse {
  available: boolean;
  status: SchemaCrawlStatus;
  lastAnalyzedAt: string | null;
  nodeCount: number;
  columnCount: number;
  edgeCount: number;
  experiencePathCount: number;
  sourceLineCount: number;
  tetaVersion: string | null;
  owners: string[];
  progress?: number | null;
  progressMessage?: string | null;
  message?: string;
}

export interface SchemaPathStep {
  owner: string;
  table: string;
  column: string;
  edgeType: SchemaEdgeType;
  confidence: number;
}

export interface SchemaFindPathResponse {
  from: string;
  to: string;
  found: boolean;
  cached: boolean;
  steps: SchemaPathStep[];
  message?: string;
}

export interface SchemaColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPk: boolean;
  comment: string | null;
  /** NOT NULL bez DEFAULT — wymagane przy INSERT (nie to samo co pole obowiązkowe w formularzu Teta). */
  insertRequired?: boolean;
}

export interface SchemaTableInfo {
  owner: string;
  name: string;
  nodeType: SchemaNodeType;
  comment: string | null;
  columns: SchemaColumnInfo[];
}

export interface SchemaDescribeTableResponse {
  found: boolean;
  table: SchemaTableInfo | null;
  message?: string;
}

export interface SchemaDescribeColumnResponse {
  found: boolean;
  owner: string | null;
  table: string | null;
  column: SchemaColumnInfo | null;
  message?: string;
}

export interface SchemaSearchTablesResponse {
  query: string;
  items: string[];
  total: number;
}

export type OracleAgentDomain =
  | 'general'
  | 'payroll'
  | 'hr'
  | 'attendance'
  | 'config';

export const ORACLE_AGENT_DOMAINS: OracleAgentDomain[] = [
  'general',
  'payroll',
  'hr',
  'attendance',
  'config',
];

export const ORACLE_AGENT_DOMAIN_LABELS: Record<OracleAgentDomain, string> = {
  general: 'Ogólny',
  payroll: 'Płace',
  hr: 'Kadry',
  attendance: 'Czasy pracy',
  config: 'Konfiguracja',
};

export type ChatSourceMode = 'docs' | 'oracle';

export const CHAT_SOURCE_MODES: ChatSourceMode[] = ['docs', 'oracle'];

export const CHAT_SOURCE_LABELS: Record<ChatSourceMode, string> = {
  docs: 'Dokumentacja',
  oracle: 'Baza Oracle',
};

export interface OracleReport {
  sql: string;
  columns: string[];
  rows: string[][];
  rowCount: number;
  truncated: boolean;
}

export interface OracleAgentSqlStep {
  sql: string;
  rowCount: number;
  columns: string[];
  rows: string[][];
  truncated: boolean;
  /** @deprecated Użyj columns/rows — zachowane dla kompatybilności */
  preview?: string[];
}

export interface ChatOracleStep {
  tool: string;
  summary: string;
}
