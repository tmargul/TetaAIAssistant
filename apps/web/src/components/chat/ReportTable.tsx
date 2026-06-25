import type { OracleReport } from '@teta/shared';

function rowLabel(count: number): string {
  if (count === 1) return '1 wiersz';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} wiersze`;
  }
  return `${count} wierszy`;
}

export function ReportTable({ report }: { report: OracleReport }) {
  return (
    <div className="chat__report">
      <div className="chat__report-header">
        <span className="chat__report-title">Raport</span>
        <span className="chat__report-meta">
          {rowLabel(report.rowCount)}
          {report.truncated ? ' · pokazano pierwsze wiersze (limit)' : ''}
        </span>
      </div>
      {report.columns.length > 0 ? (
        <div className="chat__report-scroll">
          <table className="chat__report-table">
            <thead>
              <tr>
                {report.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={report.columns.length} className="chat__report-empty">
                    Brak wierszy
                  </td>
                </tr>
              ) : (
                report.rows.map((row, rowIndex) => (
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
      ) : (
        <p className="chat__report-empty">Zapytanie nie zwróciło kolumn.</p>
      )}
      <details className="chat__report-sql">
        <summary>Zapytanie SQL</summary>
        <pre>{report.sql}</pre>
      </details>
    </div>
  );
}
