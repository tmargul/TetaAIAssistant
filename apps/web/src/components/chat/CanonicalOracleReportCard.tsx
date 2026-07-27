import { useState } from 'react';
import type { TetaCanonicalChatReportResponse } from '@teta/shared';
import {
  canonicalReportDownloadButtonLabel,
  formatCanonicalReportExpiresAt,
  isCanonicalReportDownloadEnabled,
  parseContentDispositionFilename,
  type CanonicalReportDownloadUiState,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';

async function downloadCanonicalReportXlsx(token: string): Promise<'ok' | 'expired' | 'error'> {
  const res = await authFetch(`/api/chat/reports/download/${encodeURIComponent(token)}`, {
    method: 'GET',
  });

  if (res.status === 410) {
    return 'expired';
  }
  if (!res.ok) {
    return 'error';
  }

  const blob = await res.blob();
  const filename = parseContentDispositionFilename(res.headers.get('Content-Disposition'));
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return 'ok';
}

export function CanonicalOracleReportCard({
  report,
}: {
  report: TetaCanonicalChatReportResponse;
}) {
  const [downloadState, setDownloadState] = useState<CanonicalReportDownloadUiState>(
    report.download.available && report.download.token ? 'default' : 'expired',
  );

  const dataExpired = report.report.dataExpired === true || report.report.rows === null;
  const columns = report.report.columns;
  const rows = report.report.rows ?? [];
  const expiresLabel = formatCanonicalReportExpiresAt(report.download.expiresAt);

  const onDownload = async () => {
    const token = report.download.token;
    if (!token || dataExpired) {
      setDownloadState('expired');
      return;
    }
    setDownloadState('loading');
    const result = await downloadCanonicalReportXlsx(token);
    if (result === 'ok') setDownloadState('success');
    else if (result === 'expired') setDownloadState('expired');
    else setDownloadState('error');
  };

  const downloadEnabled = isCanonicalReportDownloadEnabled({
    downloadAvailable: report.download.available,
    tokenPresent: Boolean(report.download.token),
    dataExpired,
    downloadState,
  });

  return (
    <div className="chat__canonical-report" data-status={report.status}>
      <div className="chat__canonical-report-header">
        <span className="chat__canonical-report-title">{report.title}</span>
        <span className="chat__canonical-report-meta">
          {report.report.rowCount} rekordów · {report.report.columnCount} kolumn
          {report.report.limitReached ? ' · limit 500' : ''}
        </span>
      </div>

      {report.report.limitReached && (
        <p className="chat__canonical-report-warning">
          Wyświetlono maksymalny limit 500 rekordów. Wynik może być niepełny.
        </p>
      )}

      {dataExpired ? (
        <p className="chat__canonical-report-expired">
          Dane tego raportu nie są przechowywane. Uruchom raport ponownie.
        </p>
      ) : columns.length > 0 ? (
        <div className="chat__report-scroll">
          <table className="chat__report-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={`${col.ordinal}-${col.businessRole}`}>{col.displayLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="chat__report-empty">
                    Brak wierszy
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="chat__canonical-report-actions">
        <button
          type="button"
          className="chat__canonical-download"
          disabled={!downloadEnabled}
          onClick={() => void onDownload()}
        >
          {canonicalReportDownloadButtonLabel(downloadState)}
        </button>
        {expiresLabel && !dataExpired && report.download.available && (
          <span className="chat__canonical-report-expires">Wygasa: {expiresLabel}</span>
        )}
      </div>
    </div>
  );
}
