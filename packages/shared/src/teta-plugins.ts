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
