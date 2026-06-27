import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OracleConnectionStatusResponse,
  OracleMetadataObjectKind,
  OracleMetadataObjectsPageResponse,
  OracleMetadataStatusResponse,
  SchemaGraphStatsResponse,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { readResponseJson } from '../../lib/read-response-json';
import {
  formatOracleConnectionSummary,
  formatOracleMetadataStatValue,
  hasOracleMetadataTruncation,
  ORACLE_METADATA_OBJECT_LABELS,
  oracleImportStatusLabel,
} from '../../lib/oracle-metadata';
import { OracleConnectionForm } from '../oracle/OracleConnectionForm';
import { SchemaExplorerPanel } from './SchemaExplorerPanel';
import './oracle-metadata.css';

const STAT_KINDS: OracleMetadataObjectKind[] = [
  'tables',
  'views',
  'packages',
  'procedures',
  'functions',
];

export function OracleMetadataView() {
  const [oracleStatus, setOracleStatus] = useState<OracleConnectionStatusResponse | null>(null);
  const [metadata, setMetadata] = useState<OracleMetadataStatusResponse | null>(null);
  const [graphStats, setGraphStats] = useState<SchemaGraphStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importStarting, setImportStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<OracleMetadataObjectKind | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [objectItems, setObjectItems] = useState<string[]>([]);
  const [objectTotal, setObjectTotal] = useState(0);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [importElapsedSec, setImportElapsedSec] = useState(0);
  const importStartedRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [oracleRes, metadataRes, graphRes] = await Promise.all([
        authFetch('/api/oracle/status'),
        authFetch('/api/oracle/metadata/status'),
        authFetch('/api/schema/stats'),
      ]);
      if (oracleRes.ok) {
        setOracleStatus(await readResponseJson<OracleConnectionStatusResponse>(oracleRes));
      }
      if (metadataRes.ok) {
        setMetadata(await readResponseJson<OracleMetadataStatusResponse>(metadataRes));
      }
      if (graphRes.ok) {
        setGraphStats(await readResponseJson<SchemaGraphStatsResponse>(graphRes));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nie udało się wczytać statusu metadanych Oracle.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadObjectPage = useCallback(
    async (kind: OracleMetadataObjectKind, offset: number, append: boolean) => {
      setObjectsLoading(true);
      try {
        const res = await authFetch(
          `/api/oracle/metadata/objects?kind=${encodeURIComponent(kind)}&offset=${offset}&limit=200`,
        );
        if (!res.ok) {
          const body = await readResponseJson<{ message?: string | string[] }>(res).catch(() => null);
          const msg = body?.message;
          throw new Error(
            Array.isArray(msg) ? msg.join(', ') : msg ?? `HTTP ${res.status}`,
          );
        }
        const page = await readResponseJson<OracleMetadataObjectsPageResponse>(res);
        setObjectTotal(page.total);
        setObjectItems((prev) => (append ? [...prev, ...page.items] : page.items));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Nie udało się wczytać listy obiektów.');
        if (!append) {
          setObjectItems([]);
          setObjectTotal(0);
        }
      } finally {
        setObjectsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedKind || !metadata?.objectListsAvailable) {
      setObjectItems([]);
      setObjectTotal(0);
      return;
    }
    void loadObjectPage(selectedKind, 0, false);
  }, [selectedKind, metadata?.objectListsAvailable, loadObjectPage]);

  useEffect(() => {
    void refresh();
    const intervalMs = metadata?.status === 'running' ? 1500 : 20000;
    const timer = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, metadata?.status]);

  useEffect(() => {
    if (metadata?.status !== 'running') {
      importStartedRef.current = null;
      setImportElapsedSec(0);
      return;
    }
    if (!importStartedRef.current) {
      importStartedRef.current = Date.now();
    }
    const tick = () => {
      const started = importStartedRef.current ?? Date.now();
      setImportElapsedSec(Math.floor((Date.now() - started) / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [metadata?.status]);

  const oracleConfigured = oracleStatus?.configured === true;
  const importRunning = metadata?.status === 'running';
  const connectionSummary = oracleStatus?.config
    ? formatOracleConnectionSummary(oracleStatus.config)
    : null;

  const handleStartImport = async () => {
    if (!metadata?.available || importRunning || importStarting) return;
    setError(null);
    setMessage(null);
    setImportStarting(true);
    try {
      const res = await authFetch('/api/oracle/metadata/import', { method: 'POST' });
      if (!res.ok) {
        const body = await readResponseJson<{ message?: string | string[] }>(res).catch(() => null);
        const msg = body?.message;
        throw new Error(
          Array.isArray(msg) ? msg.join(', ') : msg ?? `HTTP ${res.status}`,
        );
      }
      await readResponseJson<OracleMetadataStatusResponse>(res);
      setMessage('Analiza bazy Oracle uruchomiona (graf + indeks).');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się uruchomić importu.');
    } finally {
      setImportStarting(false);
    }
  };

  const handleStatClick = (kind: OracleMetadataObjectKind) => {
    const count = metadata?.counts[kind] ?? 0;
    if (count === 0) return;
    setSelectedKind((prev) => (prev === kind ? null : kind));
  };

  const importTruncated =
    metadata?.catalogTotals != null &&
    hasOracleMetadataTruncation(metadata.counts, metadata.catalogTotals);

  return (
    <div className="oracle-metadata">
      <p className="oracle-metadata__lead">
        Analiza struktury bazy Teta: crawler Oracle buduje graf relacji (SQLite), a opcjonalny indeks
        Qdrant służy wyłącznie do pytań merytorycznych w trybie Dokumentacja.
      </p>

      {message && <p className="oracle-metadata__message oracle-metadata__message--ok">{message}</p>}
      {error && <p className="oracle-metadata__message oracle-metadata__message--error">{error}</p>}

      {graphStats && graphStats.nodeCount > 0 && (
        <div className="oracle-metadata__banner oracle-metadata__banner--ok">
          <strong>Graf schematu:</strong> {graphStats.nodeCount} tabel/widoków · {graphStats.columnCount}{' '}
          kolumn · {graphStats.edgeCount} relacji · {graphStats.experiencePathCount} zapamiętanych ścieżek
        </div>
      )}

      <div
        className={`oracle-metadata__banner${
          metadata?.status === 'done'
            ? ' oracle-metadata__banner--ok'
            : importRunning
              ? ' oracle-metadata__banner--warn'
              : ' oracle-metadata__banner--muted'
        }`}
      >
        <strong>Status importu:</strong>{' '}
        {metadata ? oracleImportStatusLabel(metadata.status) : loading ? 'Wczytywanie…' : '—'}
        {metadata?.lastImportedAt && (
          <>
            {' '}
            · ostatnio: {new Date(metadata.lastImportedAt).toLocaleString('pl-PL')}
            {metadata.tetaVersion ? ` · Teta ${metadata.tetaVersion}` : ''}
          </>
        )}
        {metadata?.message && !importRunning && (
          <>
            <br />
            {metadata.message}
          </>
        )}
      </div>

      {importRunning && (
        <div className="oracle-metadata__progress oracle-metadata__progress--active">
          <div className="oracle-metadata__progress-header">
            <span>Postęp analizy</span>
            <strong>{metadata?.progress ?? 0}%</strong>
          </div>
          <div className="oracle-metadata__progress-bar">
            <div
              className="oracle-metadata__progress-fill"
              style={{ width: `${Math.max(2, Math.min(100, metadata?.progress ?? 0))}%` }}
            />
          </div>
          <p className="oracle-metadata__progress-label">
            {metadata?.progressMessage ?? metadata?.message ?? 'Analiza bazy Oracle w toku…'}
          </p>
          <p className="oracle-metadata__progress-meta">
            Czas: {importElapsedSec} s · odświeżanie statusu co 1,5 s
          </p>
        </div>
      )}

      {importTruncated && (
        <div className="oracle-metadata__banner oracle-metadata__banner--warn">
          Liczby w statystykach różnią się od katalogu Oracle — część obiektów mogła nie zostać
          zaimportowana. Uruchom import ponownie lub sprawdź logi API.
        </div>
      )}

      <div className="oracle-metadata__grid">
        <div className="oracle-metadata__connection">
          <h3 className="oracle-metadata__connection-title">Połączenie Oracle</h3>
          {oracleConfigured && connectionSummary ? (
            <>
              <p className="oracle-metadata__connection-line">{connectionSummary}</p>
              <p className="oracle-metadata__connection-line">
                Tryb:{' '}
                <strong>{oracleStatus?.backendMode === 'real' ? 'prawdziwa baza' : 'symulator (dev)'}</strong>
              </p>
              {oracleStatus?.config?.updatedAt && (
                <p className="oracle-metadata__connection-line">
                  Ostatnia zmiana ustawień połączenia:{' '}
                  {new Date(oracleStatus.config.updatedAt).toLocaleString('pl-PL')}
                </p>
              )}
              {metadata?.lastImportedAt && (
                <p className="oracle-metadata__connection-line">
                  Ostatnia analiza bazy:{' '}
                  {new Date(metadata.lastImportedAt).toLocaleString('pl-PL')}
                  {metadata.tetaVersion ? ` (${metadata.tetaVersion})` : ''}
                </p>
              )}
            </>
          ) : (
            <p className="oracle-metadata__connection-line">
              Brak konfiguracji — rozwiń sekcję poniżej i zapisz parametry połączenia.
            </p>
          )}
        </div>

        <div className="oracle-metadata__stats">
          {STAT_KINDS.map((kind) => {
            const count = metadata?.counts[kind] ?? 0;
            const total = metadata?.catalogTotals?.[kind];
            const label = formatOracleMetadataStatValue(count, total);
            return (
              <button
                key={kind}
                type="button"
                className={`oracle-metadata__stat${
                  selectedKind === kind ? ' oracle-metadata__stat--active' : ''
                }`}
                disabled={count === 0}
                onClick={() => handleStatClick(kind)}
                title={
                  count === 0
                    ? 'Brak obiektów — uruchom import'
                    : total != null && total > count
                      ? `Zaimportowano ${count} z ${total} w katalogu Oracle`
                      : 'Pokaż listę nazw'
                }
              >
                <span className="oracle-metadata__stat-label">
                  {ORACLE_METADATA_OBJECT_LABELS[kind]}
                </span>
                <span className="oracle-metadata__stat-value">{label}</span>
              </button>
            );
          })}
          <div className="oracle-metadata__stat" aria-hidden style={{ cursor: 'default', opacity: 0.85 }}>
            <span className="oracle-metadata__stat-label">Kolumny (tabele)</span>
            <span className="oracle-metadata__stat-value">
              {formatOracleMetadataStatValue(
                metadata?.counts.columns ?? 0,
                metadata?.catalogTotals?.columns,
              )}
            </span>
          </div>
        </div>
      </div>

      {selectedKind && (
        <section className="oracle-metadata__detail">
          <div className="oracle-metadata__detail-header">
            <h3 className="oracle-metadata__detail-title">
              {ORACLE_METADATA_OBJECT_LABELS[selectedKind]} (
              {objectTotal > 0 ? objectTotal : metadata?.counts[selectedKind] ?? 0})
            </h3>
            <button
              type="button"
              className="oracle-metadata__detail-close"
              onClick={() => setSelectedKind(null)}
            >
              Zamknij
            </button>
          </div>
          {objectsLoading && objectItems.length === 0 ? (
            <p className="oracle-metadata__detail-empty">Wczytywanie listy…</p>
          ) : objectItems.length === 0 ? (
            <p className="oracle-metadata__detail-empty">
              Brak nazw obiektów — lista pojawi się po zakończeniu importu metadanych.
            </p>
          ) : (
            <>
              <ul className="oracle-metadata__object-list">
                {objectItems.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              {objectItems.length < objectTotal && (
                <div className="oracle-metadata__actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className="oracle-metadata__btn oracle-metadata__btn--secondary"
                    disabled={objectsLoading}
                    onClick={() => void loadObjectPage(selectedKind, objectItems.length, true)}
                  >
                    {objectsLoading
                      ? 'Wczytywanie…'
                      : `Pokaż więcej (${objectItems.length} / ${objectTotal})`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!oracleConfigured && (
        <div className="oracle-metadata__banner oracle-metadata__banner--warn">
          Skonfiguruj połączenie read-only, zanim uruchomisz import.
        </div>
      )}

      {importRunning && (
        <div className="oracle-metadata__banner oracle-metadata__banner--warn">
          Import w toku — status odświeża się automatycznie co ok. 3 s.
        </div>
      )}

      <div className="oracle-metadata__actions">
        <button
          type="button"
          className="oracle-metadata__btn"
          disabled={!oracleConfigured || !metadata?.available || importRunning || importStarting}
          onClick={() => void handleStartImport()}
        >
          {importStarting
            ? 'Uruchamianie…'
            : importRunning
              ? 'Analiza w toku…'
              : 'Analizuj bazę'}
        </button>
        <button
          type="button"
          className="oracle-metadata__btn oracle-metadata__btn--secondary"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? 'Odświeżanie…' : 'Odśwież status'}
        </button>
      </div>

      <section className="oracle-metadata__section">
        <button
          type="button"
          className="oracle-metadata__section-toggle"
          onClick={() => setConfigOpen((open) => !open)}
        >
          <span>Konfiguracja połączenia</span>
          <span>{configOpen ? 'Ukryj' : 'Pokaż'}</span>
        </button>
        {configOpen && (
          <div className="oracle-metadata__form-wrap">
            <OracleConnectionForm
              variant="settings"
              onSaved={(status) => {
                setOracleStatus(status);
                setMessage('Zaktualizowano połączenie Oracle.');
                setError(null);
                void refresh();
              }}
            />
          </div>
        )}
      </section>

      <SchemaExplorerPanel />
    </div>
  );
}
