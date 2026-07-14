export const TETA_PLUGIN_RAG_SOURCE_PREFIX = 'teta-plugins/' as const;

export interface TetaPluginDllRecord {
  dllName: string;
  dllPath: string;
  /** Ścieżka względem katalogu Plugins (forward slashes). */
  relativePath: string;
  /** Pierwszy segment pod Plugins (pusty gdy DLL bezpośrednio w Plugins). */
  categoryDir: string;
  imported: boolean;
  importedAt: string | null;
  chunkCount: number;
}

export interface TetaPluginsStatusResponse {
  clientDirectory: string;
  pluginsRoot: string;
  scannedAt: string;
  totalAvailable: number;
  totalImported: number;
  plugins: TetaPluginDllRecord[];
}

export interface TetaPluginImportRequest {
  dllPath: string;
}

export interface TetaPluginImportResponse {
  dllName: string;
  dllPath: string;
  relativePath: string;
  chunkCount: number;
  collection: string;
  importedAt: string;
  gatewayCount: number;
  columnCount: number;
  extractionMode: 'tchelper' | 'source-scan' | 'server-deployment' | 'hybrid';
}

export interface TetaPluginImportDetailResponse {
  dllName: string;
  dllPath: string;
  relativePath: string;
  importedAt: string;
  chunkCount: number;
  metadata: Record<string, unknown>;
}

export interface TetaPluginDeleteRagResponse {
  dllName: string;
  dllPath: string;
  relativePath: string;
  ok: true;
}

/** Potwierdzenie: wpisz dokładnie tę frazę w polu confirm. */
export const TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM = 'USUN_WSZYSTKIE_RAG_WTYCZEK' as const;

export interface TetaPluginDeleteAllRagRequest {
  confirm: string;
}

export interface TetaPluginDeleteAllRagResponse {
  deletedImports: number;
  ok: true;
}

export interface TetaPluginBulkImportRequest {
  /** Pusty / brak = wszystkie kategorie. Wartość `(Plugins)` = DLL bezpośrednio w Plugins. */
  categoryDir?: string;
  /** Gdy true — tylko DLL bez wpisu w RAG (domyślnie true). */
  skipImported?: boolean;
  /** Gdy true — importuje także już zaimportowane (reimport). */
  reimport?: boolean;
}

export type TetaPluginBulkImportJobStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface TetaPluginBulkImportStatusResponse {
  status: TetaPluginBulkImportJobStatus;
  current: number;
  total: number;
  progress: number;
  progressMessage: string;
  currentDllName: string | null;
  errors: Array<{ dllName: string; dllPath: string; message: string }>;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TetaPluginBulkImportStartResponse {
  ok: true;
  total: number;
  status: TetaPluginBulkImportStatusResponse;
}
