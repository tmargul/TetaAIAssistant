import type {
  OracleConnectionConfig,
  OracleMetadataImportStatus,
  OracleMetadataObjectKind,
} from '@teta/shared';

export function oracleImportStatusLabel(status: OracleMetadataImportStatus): string {
  switch (status) {
    case 'running':
      return 'Import w toku…';
    case 'done':
      return 'Import zakończony';
    case 'failed':
      return 'Błąd importu';
    default:
      return 'Oczekuje na start';
  }
}

export const ORACLE_METADATA_OBJECT_LABELS: Record<OracleMetadataObjectKind, string> = {
  tables: 'Tabele',
  views: 'Widoki',
  packages: 'Pakiety',
  procedures: 'Procedury',
  functions: 'Funkcje',
};

export function formatOracleConnectionSummary(config: OracleConnectionConfig): string {
  if (config.mode === 'tns') {
    return `TNS: ${config.tnsAlias ?? '—'} · ${config.username}`;
  }
  const idLabel = config.identifierType === 'serviceName' ? 'Service' : 'SID';
  return `${config.host ?? '—'}:${config.port ?? 1521} · ${idLabel}: ${config.identifier ?? '—'} · ${config.username}`;
}
