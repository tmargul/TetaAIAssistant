export type TetaOracleBackendMode = 'fake' | 'real';

export type OracleConnectionMode = 'basic' | 'tns';

export type OracleIdentifierType = 'sid' | 'serviceName';

export interface OracleConnectionConfig {
  mode: OracleConnectionMode;
  host?: string;
  port?: number;
  identifierType?: OracleIdentifierType;
  identifier?: string;
  tnsAlias?: string;
  username: string;
}

export interface OracleConnectionInput extends OracleConnectionConfig {
  /** Puste przy edycji — zachowane zostanie dotychczasowe hasło. */
  password?: string;
}

export interface OracleConnectionStatusResponse {
  configured: boolean;
  backendMode: TetaOracleBackendMode;
  config?: OracleConnectionConfig & { updatedAt: string };
  /** Podpowiedź kont testowych (tylko gdy backendMode=fake). */
  fakeLoginHint?: {
    adminUsername: string;
    userUsername: string;
  };
}

export interface OracleTestConnectionResponse {
  success: boolean;
  message: string;
  databaseVersion?: string;
}

export interface TnsEntry {
  alias: string;
  host?: string;
  port?: number;
  serviceName?: string;
  sid?: string;
}

export interface TnsListResponse {
  entries: TnsEntry[];
  source?: string;
}

export type OracleMetadataImportStatus = 'idle' | 'running' | 'done' | 'failed';

export interface OracleMetadataCounts {
  tables: number;
  views: number;
  columns: number;
  packages: number;
  procedures: number;
  functions: number;
}

/** Rzeczywiste liczby obiektów w katalogu Oracle (z ostatniego importu). */
export type OracleMetadataCatalogTotals = OracleMetadataCounts;

export type OracleMetadataObjectKind =
  | 'tables'
  | 'views'
  | 'packages'
  | 'procedures'
  | 'functions';

export interface OracleMetadataObjectsPageResponse {
  kind: OracleMetadataObjectKind;
  total: number;
  offset: number;
  limit: number;
  items: string[];
}

export interface OracleMetadataObjects {
  tables: string[];
  views: string[];
  packages: string[];
  procedures: string[];
  functions: string[];
}

/** Status automatycznego importu metadanych Oracle (POC). */
export interface OracleMetadataStatusResponse {
  /** Czy endpoint importera jest już podpięty w tej wersji aplikacji. */
  available: boolean;
  status: OracleMetadataImportStatus;
  lastImportedAt: string | null;
  owners: string[];
  counts: OracleMetadataCounts;
  /** Nazwy obiektów — pobieraj przez GET /api/oracle/metadata/objects (paginacja). */
  objects: OracleMetadataObjects;
  /** Czy listy nazw są dostępne po zakończonym imporcie. */
  objectListsAvailable?: boolean;
  pilotModule: string | null;
  tetaVersion: string | null;
  /** Pełne liczby w katalogu Oracle (jeśli znane z ostatniego importu). */
  catalogTotals?: OracleMetadataCatalogTotals | null;
  /** 0–100 podczas importu (queued/running). */
  progress?: number | null;
  /** Szczegółowy opis etapu importu. */
  progressMessage?: string | null;
  message?: string;
}
