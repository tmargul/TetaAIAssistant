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
  password: string;
}

export interface OracleConnectionStatusResponse {
  configured: boolean;
  backendMode: TetaOracleBackendMode;
  config?: OracleConnectionConfig & { updatedAt: string };
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
