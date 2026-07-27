export type CanonicalReportDownloadUiState =
  | 'default'
  | 'loading'
  | 'success'
  | 'expired'
  | 'error';

export function formatCanonicalReportExpiresAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pl-PL');
}

export function parseContentDispositionFilename(disposition: string | null): string {
  if (!disposition) return 'raport.xlsx';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? 'raport.xlsx';
}

export function canonicalReportDownloadButtonLabel(
  state: CanonicalReportDownloadUiState,
): string {
  switch (state) {
    case 'loading':
      return 'Pobieranie…';
    case 'success':
      return 'Pobrano';
    case 'expired':
      return 'Plik wygasł — uruchom raport ponownie';
    case 'error':
      return 'Nie udało się pobrać pliku';
    default:
      return 'Pobierz Excel';
  }
}

/** Whether download button should be enabled for the given report snapshot. */
export function isCanonicalReportDownloadEnabled(options: {
  downloadAvailable: boolean;
  tokenPresent: boolean;
  dataExpired: boolean;
  downloadState: CanonicalReportDownloadUiState;
}): boolean {
  if (options.downloadState === 'loading' || options.downloadState === 'expired') {
    return false;
  }
  return options.downloadAvailable && options.tokenPresent && !options.dataExpired;
}
