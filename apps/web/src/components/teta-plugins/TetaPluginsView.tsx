import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TetaAppPathsStatusResponse,
  TetaPluginBulkImportStatusResponse,
  TetaPluginDllRecord,
  TetaPluginImportDetailResponse,
  TetaPluginsStatusResponse,
} from '@teta/shared';
import { TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM } from '@teta/shared';
import type { NavItem } from '../layout/Sidebar';
import { authFetch } from '../../lib/auth-storage';
import { readResponseJson } from '../../lib/read-response-json';
import './teta-plugins.css';
import { TetaPluginImportDetailPanel } from './TetaPluginImportDetailPanel';

type TetaPluginsViewProps = {
  onNavigate: (item: NavItem) => void;
};

type ImportStatusFilter = 'all' | 'imported' | 'pending';

type ConfirmDialogState =
  | { kind: 'delete-all'; phrase: string }
  | { kind: 'bulk-reimport'; categoryLabel: string }
  | { kind: 'delete-one'; plugin: TetaPluginDllRecord }
  | null;

function parseError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function pluginMatchesSearch(plugin: TetaPluginDllRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    plugin.dllName,
    plugin.dllPath,
    plugin.relativePath,
    plugin.categoryDir,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

export function TetaPluginsView({ onNavigate }: TetaPluginsViewProps) {
  const [paths, setPaths] = useState<TetaAppPathsStatusResponse | null>(null);
  const [status, setStatus] = useState<TetaPluginsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [importStatusFilter, setImportStatusFilter] = useState<ImportStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<TetaPluginDllRecord | null>(null);
  const [importDetail, setImportDetail] = useState<TetaPluginImportDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<TetaPluginBulkImportStatusResponse | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const bulkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBulkCurrentRef = useRef(0);
  const wasBulkRunningRef = useRef(false);
  const loadAllInFlightRef = useRef(false);
  const loadAllQueuedRef = useRef(false);

  const loadAll = useCallback(async (isRefresh = false) => {
    if (loadAllInFlightRef.current) {
      loadAllQueuedRef.current = true;
      return;
    }
    loadAllInFlightRef.current = true;
    loadAllQueuedRef.current = false;

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    if (!isRefresh) setError(null);

    try {
      const pathsRes = await authFetch('/api/vendor/teta-app/paths');
      const pathsData = await readResponseJson<TetaAppPathsStatusResponse>(pathsRes);
      if (!pathsRes.ok) {
        throw new Error(parseError(pathsData, `HTTP ${pathsRes.status}`));
      }
      setPaths(pathsData);

      if (!pathsData.clientDirectory.trim()) {
        setStatus(null);
        return;
      }

      const statusRes = await authFetch('/api/vendor/teta-plugins/status');
      const statusData = await readResponseJson<TetaPluginsStatusResponse>(statusRes);
      if (!statusRes.ok) {
        throw new Error(parseError(statusData, `HTTP ${statusRes.status}`));
      }
      setStatus(statusData);
      if (isRefresh) setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nie udało się wczytać wtyczek.';
      // Przy odświeżaniu w tle (np. podczas bulk) nie czyść listy — inaczej zakładka „pada”.
      if (!isRefresh) {
        setError(message);
        setStatus(null);
      } else {
        setError(message);
      }
    } finally {
      loadAllInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
      if (loadAllQueuedRef.current) {
        loadAllQueuedRef.current = false;
        void loadAll(true);
      }
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadImportDetail = useCallback(async (plugin: TetaPluginDllRecord) => {
    setDetailLoading(true);
    setImportDetail(null);
    try {
      const params = new URLSearchParams({ dllPath: plugin.dllPath });
      const res = await authFetch(`/api/vendor/teta-plugins/import/detail?${params.toString()}`);
      const data = await readResponseJson<TetaPluginImportDetailResponse>(res);
      if (!res.ok) {
        throw new Error(parseError(data, `HTTP ${res.status}`));
      }
      setImportDetail(data);
    } catch (err) {
      setImportDetail(null);
      setError(err instanceof Error ? err.message : 'Nie udało się wczytać szczegółów importu.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const pollBulkStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/vendor/teta-plugins/import/bulk/status');
      const data = await readResponseJson<TetaPluginBulkImportStatusResponse>(res);
      if (!res.ok) {
        return;
      }
      setBulkStatus(data);

      if (data.status === 'running') {
        wasBulkRunningRef.current = true;
        // Backend ustawia `current` przed startem kolejnej DLL — wtedy poprzednia już jest w SQLite/RAG.
        if (data.current !== lastBulkCurrentRef.current) {
          lastBulkCurrentRef.current = data.current;
          void loadAll(true);
        }
        return;
      }

      if (
        wasBulkRunningRef.current &&
        (data.status === 'completed' || data.status === 'failed')
      ) {
        wasBulkRunningRef.current = false;
        lastBulkCurrentRef.current = 0;
        setImportMessage(data.progressMessage);
        await loadAll(true);
      }
    } catch {
      // Kolejny tick spróbuje ponownie — nie chowaj paska przy chwilowym błędzie.
    }
  }, [loadAll]);

  /** Przez cały czas trwania widoku odpytuj status bulk — także po wyjściu i powrocie. */
  useEffect(() => {
    void pollBulkStatus();
    bulkPollRef.current = setInterval(() => {
      void pollBulkStatus();
    }, 1200);
    return () => {
      if (bulkPollRef.current) {
        clearInterval(bulkPollRef.current);
        bulkPollRef.current = null;
      }
    };
  }, [pollBulkStatus]);

  const handleBulkImport = useCallback(
    async (options: { reimport?: boolean }) => {
      setError(null);
      setImportMessage(null);
      const categoryDir =
        categoryFilter === 'all' ? undefined : categoryFilter;
      try {
        const res = await authFetch('/api/vendor/teta-plugins/import/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryDir,
            skipImported: !options.reimport,
            reimport: options.reimport === true,
          }),
        });
        const data = await readResponseJson<{ total?: number; status?: TetaPluginBulkImportStatusResponse }>(
          res,
        );
        if (!res.ok) {
          throw new Error(parseError(data, `HTTP ${res.status}`));
        }
        lastBulkCurrentRef.current = 0;
        wasBulkRunningRef.current = true;
        setBulkStatus(data.status ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import zbiorczy nie powiódł się.');
      }
    },
    [categoryFilter],
  );

  const handleDeleteRag = useCallback(
    async (plugin: TetaPluginDllRecord) => {
      setDeletingPath(plugin.dllPath);
      setError(null);
      setImportMessage(null);
      try {
        const params = new URLSearchParams({ dllPath: plugin.dllPath });
        const res = await authFetch(`/api/vendor/teta-plugins/rag?${params.toString()}`, {
          method: 'DELETE',
        });
        const data = await readResponseJson<{ message?: string | string[] }>(res);
        if (!res.ok) {
          throw new Error(parseError(data, `HTTP ${res.status}`));
        }
        setImportMessage(`Usunięto RAG dla ${plugin.dllName}.`);
        if (selectedPlugin?.dllPath === plugin.dllPath) {
          setSelectedPlugin(null);
          setImportDetail(null);
        }
        await loadAll(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Usuwanie RAG nie powiodło się.');
      } finally {
        setDeletingPath(null);
        setConfirmDialog(null);
      }
    },
    [loadAll, selectedPlugin],
  );

  const handleDeleteAllRag = useCallback(
    async (phrase: string) => {
      setError(null);
      setImportMessage(null);
      try {
        const res = await authFetch('/api/vendor/teta-plugins/rag/all', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: phrase }),
        });
        const data = await readResponseJson<{ deletedImports?: number; message?: string | string[] }>(
          res,
        );
        if (!res.ok) {
          throw new Error(parseError(data, `HTTP ${res.status}`));
        }
        setImportMessage(
          `Usunięto RAG wszystkich wtyczek (${data.deletedImports ?? 0} wpisów).`,
        );
        setSelectedPlugin(null);
        setImportDetail(null);
        await loadAll(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Usuwanie całego RAG nie powiodło się.');
      } finally {
        setConfirmDialog(null);
      }
    },
    [loadAll],
  );

  const handleImport = useCallback(
    async (plugin: TetaPluginDllRecord) => {
      setImportingPath(plugin.dllPath);
      setImportMessage(null);
      setError(null);
      try {
        const res = await authFetch('/api/vendor/teta-plugins/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dllPath: plugin.dllPath }),
        });
        const data = await readResponseJson<{
          chunkCount?: number;
          extractionMode?: string;
          message?: string | string[];
        }>(res);
        if (!res.ok) {
          throw new Error(parseError(data, `HTTP ${res.status}`));
        }
        setImportMessage(
          `Zaimportowano ${plugin.dllName}: ${data.chunkCount ?? 0} chunków (${data.extractionMode ?? 'source-scan'}).`,
        );
        await loadAll(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import wtyczki nie powiódł się.');
      } finally {
        setImportingPath(null);
      }
    },
    [loadAll],
  );

  const categories = useMemo(() => {
    if (!status) return [];
    const set = new Set<string>();
    for (const plugin of status.plugins) {
      set.add(plugin.categoryDir || '(Plugins)');
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'));
  }, [status]);

  const categoryFilteredPlugins = useMemo(() => {
    if (!status) return [];
    if (categoryFilter === 'all') return status.plugins;
    if (categoryFilter === '(Plugins)') {
      return status.plugins.filter((plugin) => !plugin.categoryDir);
    }
    return status.plugins.filter((plugin) => plugin.categoryDir === categoryFilter);
  }, [status, categoryFilter]);

  const importFilterCounts = useMemo(() => {
    const imported = categoryFilteredPlugins.filter((plugin) => plugin.imported).length;
    return {
      all: categoryFilteredPlugins.length,
      imported,
      pending: categoryFilteredPlugins.length - imported,
    };
  }, [categoryFilteredPlugins]);

  const filteredPlugins = useMemo(() => {
    return categoryFilteredPlugins.filter((plugin) => {
      if (importStatusFilter === 'imported' && !plugin.imported) return false;
      if (importStatusFilter === 'pending' && plugin.imported) return false;
      return pluginMatchesSearch(plugin, searchQuery);
    });
  }, [categoryFilteredPlugins, importStatusFilter, searchQuery]);

  const pathsConfigured = !!paths?.clientDirectory.trim();
  const bulkRunning = bulkStatus?.status === 'running';
  const categoryLabel = categoryFilter === 'all' ? 'wszystkie kategorie' : categoryFilter;
  const pendingInScope = importFilterCounts.pending;

  return (
    <div className="teta-plugins">
      {error && <div className="teta-plugins__message teta-plugins__message--error">{error}</div>}
      {importMessage && (
        <div className="teta-plugins__message teta-plugins__message--ok">{importMessage}</div>
      )}
      {importingPath && (
        <div className="teta-plugins__message teta-plugins__message--progress">
          Trwa import wtyczki… ekstrakcja metadanych, embedding i zapis do RAG — przy pierwszym imporcie
          z serwera aplikacyjnego może to potrwać 1–3 minuty.
        </div>
      )}
      {bulkRunning && bulkStatus && (
        <div className="teta-plugins__message teta-plugins__message--progress">
          <div className="teta-plugins__bulk-progress">
            <div className="teta-plugins__bulk-progress-label">{bulkStatus.progressMessage}</div>
            <div className="teta-plugins__bulk-progress-bar" aria-hidden="true">
              <div
                className="teta-plugins__bulk-progress-fill"
                style={{ width: `${bulkStatus.progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <section className="panel teta-plugins__panel">
        <div className="teta-plugins__toolbar">
          <div>
            <h2 className="panel__title teta-plugins__title">Wtyczki Teta</h2>
            <p className="teta-plugins__hint teta-plugins__hint--compact">
              Skan katalogu{' '}
              <code className="teta-plugins__code">{status?.pluginsRoot ?? '{Client}/Plugins'}</code>
              . Import wykorzystuje też{' '}
              <strong>Katalog Teta Serwer Aplikacyjny</strong> (BusinessObjects, Interfaces) oraz
              zasoby kolumn z DLL wtyczki. Wykluczone segmenty: <strong>en</strong>, <strong>hu</strong>.
            </p>
          </div>
          <div className="teta-plugins__toolbar-actions">
            <button
              type="button"
              className="teta-plugins__btn"
              disabled={loading || refreshing || !pathsConfigured || bulkRunning}
              onClick={() => void loadAll(true)}
            >
              {refreshing ? 'Odświeżanie…' : 'Odśwież skan'}
            </button>
            <button
              type="button"
              className="teta-plugins__btn teta-plugins__btn--primary"
              disabled={
                loading || !pathsConfigured || bulkRunning || pendingInScope === 0 || !!importingPath
              }
              onClick={() => void handleBulkImport({ reimport: false })}
            >
              Importuj oczekujące ({pendingInScope})
            </button>
            <button
              type="button"
              className="teta-plugins__btn"
              disabled={loading || !pathsConfigured || bulkRunning || !!importingPath}
              onClick={() =>
                setConfirmDialog({ kind: 'bulk-reimport', categoryLabel })
              }
            >
              Reimportuj kategorię
            </button>
            <button
              type="button"
              className="teta-plugins__btn teta-plugins__btn--danger"
              disabled={loading || !pathsConfigured || bulkRunning || (status?.totalImported ?? 0) === 0}
              onClick={() => setConfirmDialog({ kind: 'delete-all', phrase: '' })}
            >
              Usuń cały RAG
            </button>
          </div>
        </div>

        {loading && <p className="teta-plugins__hint">Wczytywanie…</p>}

        {!loading && !pathsConfigured && (
          <div className="teta-plugins__actions">
            <button
              type="button"
              className="teta-plugins__btn teta-plugins__btn--primary"
              onClick={() => {
                sessionStorage.setItem('teta-settings-tab', 'tetaApp');
                onNavigate('settings');
              }}
            >
              Ustaw ścieżki w Ustawieniach
            </button>
          </div>
        )}

        {!loading && status && (
          <>
            <div className="teta-plugins__summary">
              <div className="teta-plugins__summary-stat">
                <span className="teta-plugins__summary-label">Zaimportowane wtyczki</span>
                <span className="teta-plugins__summary-value">
                  {status.totalImported} / {status.totalAvailable}
                </span>
              </div>
              <div className="teta-plugins__summary-meta">
                Ostatni skan: {new Date(status.scannedAt).toLocaleString('pl-PL')}
              </div>
            </div>

            <div className="teta-plugins__filters">
              {categories.length > 1 && (
                <div className="teta-plugins__filter-group">
                  <label className="teta-plugins__filter-label" htmlFor="teta-plugins-category">
                    Kategoria
                  </label>
                  <select
                    id="teta-plugins-category"
                    className="teta-plugins__filter-select"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">Wszystkie ({status.totalAvailable})</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category} (
                        {
                          status.plugins.filter(
                            (p) => (p.categoryDir || '(Plugins)') === category,
                          ).length
                        }
                        )
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="teta-plugins__filter-group">
                <label className="teta-plugins__filter-label" htmlFor="teta-plugins-import-status">
                  Status RAG
                </label>
                <select
                  id="teta-plugins-import-status"
                  className="teta-plugins__filter-select"
                  value={importStatusFilter}
                  onChange={(e) => setImportStatusFilter(e.target.value as ImportStatusFilter)}
                >
                  <option value="all">Wszystkie ({importFilterCounts.all})</option>
                  <option value="imported">W RAG ({importFilterCounts.imported})</option>
                  <option value="pending">Bez importu ({importFilterCounts.pending})</option>
                </select>
              </div>

              <div className="teta-plugins__filter-group teta-plugins__filter-group--search">
                <label className="teta-plugins__filter-label" htmlFor="teta-plugins-search">
                  Szukaj
                </label>
                <input
                  id="teta-plugins-search"
                  type="search"
                  className="teta-plugins__search-input"
                  placeholder="Nazwa DLL, kategoria, ścieżka…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {filteredPlugins.length === 0 ? (
              <p className="teta-plugins__hint">
                {status.plugins.length === 0
                  ? 'Nie znaleziono plików .dll w katalogu Plugins.'
                  : 'Brak wtyczek pasujących do filtrów — zmień kryteria wyszukiwania.'}
              </p>
            ) : (
              <div className="teta-plugins__grid">
                {filteredPlugins.map((plugin) => {
                  const isImporting = importingPath === plugin.dllPath;
                  const isDeleting = deletingPath === plugin.dllPath;
                  return (
                    <div
                      key={plugin.dllPath}
                      className={`teta-plugins__tile${
                        plugin.imported ? ' teta-plugins__tile--imported' : ' teta-plugins__tile--pending'
                      }`}
                      title={plugin.dllPath}
                    >
                      <button
                        type="button"
                        className="teta-plugins__tile-main"
                        disabled={!plugin.imported}
                        onClick={() => {
                          setSelectedPlugin(plugin);
                          void loadImportDetail(plugin);
                        }}
                      >
                        <span className="teta-plugins__tile-name">{plugin.dllName}</span>
                        {plugin.categoryDir && (
                          <span className="teta-plugins__tile-category">{plugin.categoryDir}</span>
                        )}
                        <span
                          className={`teta-plugins__tile-badge${
                            plugin.imported
                              ? ' teta-plugins__tile-badge--ok'
                              : ' teta-plugins__tile-badge--pending'
                          }`}
                        >
                          {plugin.imported
                            ? `W RAG · ${plugin.chunkCount} chunków`
                            : 'Nie zaimportowano'}
                        </span>
                      </button>
                      <div className="teta-plugins__tile-actions">
                        <button
                          type="button"
                          className={`teta-plugins__tile-import${isImporting ? ' teta-plugins__tile-import--loading' : ''}`}
                          disabled={isImporting || isDeleting || bulkRunning}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleImport(plugin);
                          }}
                        >
                          {isImporting && (
                            <span className="teta-plugins__spinner" aria-hidden="true" />
                          )}
                          <span>
                            {isImporting
                              ? 'Import…'
                              : plugin.imported
                                ? 'Reimportuj'
                                : 'Importuj'}
                          </span>
                        </button>
                        {plugin.imported && (
                          <button
                            type="button"
                            className="teta-plugins__tile-delete"
                            disabled={isDeleting || isImporting || bulkRunning}
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmDialog({ kind: 'delete-one', plugin });
                            }}
                          >
                            {isDeleting ? 'Usuwanie…' : 'Usuń RAG'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {selectedPlugin && (
        <div
          className="teta-plugins__dialog-backdrop"
          role="presentation"
          onClick={() => {
            setSelectedPlugin(null);
            setImportDetail(null);
          }}
        >
          <div
            className="teta-plugins__dialog teta-plugins__dialog--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="teta-plugin-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="teta-plugins__dialog-header">
              <h3 id="teta-plugin-detail-title" className="teta-plugins__dialog-title">
                {selectedPlugin.dllName}
              </h3>
              <button
                type="button"
                className="teta-plugins__dialog-close"
                aria-label="Zamknij"
                onClick={() => {
                  setSelectedPlugin(null);
                  setImportDetail(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="teta-plugins__dialog-body">
              <dl className="teta-plugins__detail teta-plugins__detail--compact">
                <div>
                  <dt>Ścieżka</dt>
                  <dd>{selectedPlugin.dllPath}</dd>
                </div>
                <div>
                  <dt>Kategoria</dt>
                  <dd>{selectedPlugin.categoryDir || '—'}</dd>
                </div>
                <div>
                  <dt>Import</dt>
                  <dd>
                    {selectedPlugin.importedAt
                      ? new Date(selectedPlugin.importedAt).toLocaleString('pl-PL')
                      : '—'}
                  </dd>
                </div>
              </dl>

              <TetaPluginImportDetailPanel importDetail={importDetail} loading={detailLoading} />
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div
          className="teta-plugins__dialog-backdrop"
          role="presentation"
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="teta-plugins__dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDialog.kind === 'delete-one' && (
              <>
                <h3 className="teta-plugins__dialog-title">Usunąć RAG wtyczki?</h3>
                <p className="teta-plugins__hint">
                  Zostaną usunięte chunki w Qdrant i wpis metadanych dla{' '}
                  <strong>{confirmDialog.plugin.dllName}</strong>. Plik DLL na dysku pozostaje.
                </p>
                <div className="teta-plugins__dialog-actions">
                  <button
                    type="button"
                    className="teta-plugins__btn"
                    onClick={() => setConfirmDialog(null)}
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    className="teta-plugins__btn teta-plugins__btn--danger"
                    onClick={() => void handleDeleteRag(confirmDialog.plugin)}
                  >
                    Usuń RAG
                  </button>
                </div>
              </>
            )}

            {confirmDialog.kind === 'delete-all' && (
              <>
                <h3 className="teta-plugins__dialog-title">Usunąć cały RAG wtyczek?</h3>
                <p className="teta-plugins__hint">
                  Operacja usuwa <strong>wszystkie</strong> chunki <code>teta_plugin</code> z Qdrant
                  oraz wpisy w bazie metadanych. Aby potwierdzić, wpisz:
                </p>
                <p className="teta-plugins__confirm-phrase">{TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM}</p>
                <input
                  type="text"
                  className="teta-plugins__search-input"
                  value={confirmDialog.phrase}
                  onChange={(e) =>
                    setConfirmDialog({ kind: 'delete-all', phrase: e.target.value })
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="teta-plugins__dialog-actions">
                  <button
                    type="button"
                    className="teta-plugins__btn"
                    onClick={() => setConfirmDialog(null)}
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    className="teta-plugins__btn teta-plugins__btn--danger"
                    disabled={confirmDialog.phrase.trim() !== TETA_PLUGIN_DELETE_ALL_RAG_CONFIRM}
                    onClick={() => void handleDeleteAllRag(confirmDialog.phrase.trim())}
                  >
                    Usuń wszystko
                  </button>
                </div>
              </>
            )}

            {confirmDialog.kind === 'bulk-reimport' && (
              <>
                <h3 className="teta-plugins__dialog-title">Reimportować wtyczki?</h3>
                <p className="teta-plugins__hint">
                  Zostaną ponownie zaimportowane wszystkie DLL z zakresu:{' '}
                  <strong>{confirmDialog.categoryLabel}</strong>. Istniejące chunki każdej wtyczki
                  zostaną zastąpione.
                </p>
                <div className="teta-plugins__dialog-actions">
                  <button
                    type="button"
                    className="teta-plugins__btn"
                    onClick={() => setConfirmDialog(null)}
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    className="teta-plugins__btn teta-plugins__btn--primary"
                    onClick={() => {
                      setConfirmDialog(null);
                      void handleBulkImport({ reimport: true });
                    }}
                  >
                    Rozpocznij reimport
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
