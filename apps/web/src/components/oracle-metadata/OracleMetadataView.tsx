import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  OracleConnectionStatusResponse,
  OracleMetadataObjectKind,
  OracleMetadataStatusResponse,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import {
  formatOracleConnectionSummary,
  ORACLE_METADATA_OBJECT_LABELS,
  oracleImportStatusLabel,
} from '../../lib/oracle-metadata';
import { OracleConnectionForm } from '../oracle/OracleConnectionForm';
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
  const [loading, setLoading] = useState(true);
  const [importStarting, setImportStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<OracleMetadataObjectKind | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [oracleRes, metadataRes] = await Promise.all([
        authFetch('/api/oracle/status'),
        authFetch('/api/oracle/metadata/status'),
      ]);
      if (oracleRes.ok) {
        setOracleStatus((await oracleRes.json()) as OracleConnectionStatusResponse);
      }
      if (metadataRes.ok) {
        setMetadata((await metadataRes.json()) as OracleMetadataStatusResponse);
      }
    } catch {
      setError('Nie udało się wczytać statusu metadanych Oracle.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const oracleConfigured = oracleStatus?.configured === true;
  const importRunning = metadata?.status === 'running';
  const connectionSummary = oracleStatus?.config
    ? formatOracleConnectionSummary(oracleStatus.config)
    : null;

  const selectedItems = useMemo(() => {
    if (!metadata || !selectedKind) return [];
    return metadata.objects[selectedKind] ?? [];
  }, [metadata, selectedKind]);

  const handleStartImport = async () => {
    if (!metadata?.available || importRunning || importStarting) return;
    setError(null);
    setMessage(null);
    setImportStarting(true);
    try {
      const res = await authFetch('/api/oracle/metadata/import', { method: 'POST' });
      const body = (await res.json()) as { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      setMessage('Import metadanych Oracle uruchomiony.');
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

  return (
    <div className="oracle-metadata">
      <p className="oracle-metadata__lead">
        Import struktury bazy Teta (tabele, widoki, pakiety, procedury, funkcje) do warstwy wiedzy RAG.
        Wymaga konta read-only z dostępem do widoków katalogowych — bez danych operacyjnych.
      </p>

      {message && <p className="oracle-metadata__message oracle-metadata__message--ok">{message}</p>}
      {error && <p className="oracle-metadata__message oracle-metadata__message--error">{error}</p>}

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
        {metadata?.message && (
          <>
            <br />
            {metadata.message}
          </>
        )}
      </div>

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
                  Ostatnia zmiana:{' '}
                  {new Date(oracleStatus.config.updatedAt).toLocaleString('pl-PL')}
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
            return (
              <button
                key={kind}
                type="button"
                className={`oracle-metadata__stat${
                  selectedKind === kind ? ' oracle-metadata__stat--active' : ''
                }`}
                disabled={count === 0}
                onClick={() => handleStatClick(kind)}
                title={count === 0 ? 'Brak obiektów — uruchom import' : 'Pokaż listę nazw'}
              >
                <span className="oracle-metadata__stat-label">
                  {ORACLE_METADATA_OBJECT_LABELS[kind]}
                </span>
                <span className="oracle-metadata__stat-value">{count}</span>
              </button>
            );
          })}
          <div className="oracle-metadata__stat" aria-hidden style={{ cursor: 'default', opacity: 0.85 }}>
            <span className="oracle-metadata__stat-label">Kolumny</span>
            <span className="oracle-metadata__stat-value">{metadata?.counts.columns ?? 0}</span>
          </div>
        </div>
      </div>

      {selectedKind && (
        <section className="oracle-metadata__detail">
          <div className="oracle-metadata__detail-header">
            <h3 className="oracle-metadata__detail-title">
              {ORACLE_METADATA_OBJECT_LABELS[selectedKind]} ({selectedItems.length})
            </h3>
            <button
              type="button"
              className="oracle-metadata__detail-close"
              onClick={() => setSelectedKind(null)}
            >
              Zamknij
            </button>
          </div>
          {selectedItems.length === 0 ? (
            <p className="oracle-metadata__detail-empty">
              Brak nazw obiektów — lista pojawi się po zakończeniu importu metadanych.
            </p>
          ) : (
            <ul className="oracle-metadata__object-list">
              {selectedItems.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
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
          Import w toku — status odświeża się automatycznie co ok. 20 s.
        </div>
      )}

      {!metadata?.available && metadata?.status !== 'done' && oracleConfigured && (
        <div className="oracle-metadata__banner oracle-metadata__banner--muted">
          Importer w przygotowaniu — po wdrożeniu przycisk poniżej uruchomi import bez ręcznego
          eksportu SQL.
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
              ? 'Import w toku…'
              : 'Rozpocznij import metadanych'}
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
    </div>
  );
}
