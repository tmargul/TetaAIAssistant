import { useCallback, useEffect, useState } from 'react';
import type {
  OracleAgentDomain,
  SchemaDescribeTableResponse,
  SchemaFindPathResponse,
  SchemaGraphStatsResponse,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { readResponseJson } from '../../lib/read-response-json';
import { DomainSelect } from '../chat/DomainSelect';
import '../oracle-metadata/oracle-metadata.css';

export function SchemaExplorerPanel() {
  const [stats, setStats] = useState<SchemaGraphStatsResponse | null>(null);
  const [fromTable, setFromTable] = useState('SL_BADANIA_BHP');
  const [toTable, setToTable] = useState('T_PRAC');
  const [tableName, setTableName] = useState('SL_BADANIA_BHP');
  const [domain, setDomain] = useState<OracleAgentDomain>('general');
  const [pathResult, setPathResult] = useState<SchemaFindPathResponse | null>(null);
  const [tableResult, setTableResult] = useState<SchemaDescribeTableResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshStats = useCallback(async () => {
    const res = await authFetch('/api/schema/stats');
    if (res.ok) {
      setStats(await readResponseJson<SchemaGraphStatsResponse>(res));
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const runFindPath = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(
        `/api/schema/path?from=${encodeURIComponent(fromTable)}&to=${encodeURIComponent(toTable)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPathResult(await readResponseJson<SchemaFindPathResponse>(res));
      await refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd find_path');
    } finally {
      setLoading(false);
    }
  };

  const runDescribeTable = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/schema/table?name=${encodeURIComponent(tableName)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTableResult(await readResponseJson<SchemaDescribeTableResponse>(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd describe_table');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="oracle-metadata__section">
      <h3 className="oracle-metadata__detail-title">Schema Explorer</h3>
      <p className="oracle-metadata__lead" style={{ marginTop: 0 }}>
        Narzędzia grafu schematu — ścieżki relacji i pełne metadane tabel (bez LLM).
      </p>

      {stats && (
        <div className="oracle-metadata__banner oracle-metadata__banner--muted">
          Graf: {stats.nodeCount} węzłów · {stats.columnCount} kolumn · {stats.edgeCount} krawędzi ·{' '}
          {stats.experiencePathCount} zapamiętanych ścieżek
        </div>
      )}

      {error && <p className="oracle-metadata__message oracle-metadata__message--error">{error}</p>}

      <div className="oracle-metadata__grid" style={{ marginTop: '1rem' }}>
        <div>
          <h4 className="oracle-metadata__connection-title">find_path</h4>
          <div className="chat__filters-grid">
            <label className="chat__filter-field">
              <span>Od</span>
              <input value={fromTable} onChange={(e) => setFromTable(e.target.value)} />
            </label>
            <label className="chat__filter-field">
              <span>Do</span>
              <input value={toTable} onChange={(e) => setToTable(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="oracle-metadata__btn oracle-metadata__btn--secondary"
            disabled={loading}
            onClick={() => void runFindPath()}
          >
            Szukaj ścieżki
          </button>
          {pathResult && (
            <pre className="oracle-metadata__object-list" style={{ whiteSpace: 'pre-wrap', marginTop: '0.75rem' }}>
              {pathResult.found
                ? pathResult.steps.map((s) => `${s.table} (${s.column})`).join('\n↓\n')
                : pathResult.message ?? 'Brak ścieżki'}
              {pathResult.cached ? '\n[cache]' : ''}
            </pre>
          )}
        </div>

        <div>
          <h4 className="oracle-metadata__connection-title">describe_table</h4>
          <label className="chat__filter-field">
            <span>Tabela</span>
            <input value={tableName} onChange={(e) => setTableName(e.target.value)} />
          </label>
          <div style={{ marginBottom: '0.5rem' }}>
            <span className="chat__model-label">Domena search_tables: </span>
            <DomainSelect value={domain} onChange={setDomain} disabled={loading} />
          </div>
          <button
            type="button"
            className="oracle-metadata__btn oracle-metadata__btn--secondary"
            disabled={loading}
            onClick={() => void runDescribeTable()}
          >
            Opisz tabelę
          </button>
          {tableResult?.table && (
            <ul className="oracle-metadata__object-list" style={{ marginTop: '0.75rem' }}>
              {tableResult.table.columns.map((col) => (
                <li key={col.name}>
                  {col.name} — {col.dataType}
                  {col.isPk ? ' PK' : ''}
                  {col.comment ? ` — ${col.comment}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        type="button"
        className="oracle-metadata__btn oracle-metadata__btn--secondary"
        style={{ marginTop: '1rem' }}
        onClick={() => void refreshStats()}
      >
        Odśwież statystyki grafu
      </button>
    </section>
  );
}
