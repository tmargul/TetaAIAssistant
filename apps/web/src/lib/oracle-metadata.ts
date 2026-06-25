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

export function formatOracleMetadataStatValue(
  imported: number,
  total?: number | null,
): string {
  if (total != null && total > imported) {
    return `${imported} / ${total}`;
  }
  return String(imported);
}

export function hasOracleMetadataTruncation(
  counts: { tables: number; views: number; packages: number; procedures: number; functions: number },
  totals?: { tables: number; views: number; packages: number; procedures: number; functions: number } | null,
): boolean {
  if (!totals) return false;
  return (
    totals.tables > counts.tables ||
    totals.views > counts.views ||
    totals.packages > counts.packages ||
    totals.procedures > counts.procedures ||
    totals.functions > counts.functions
  );
}
