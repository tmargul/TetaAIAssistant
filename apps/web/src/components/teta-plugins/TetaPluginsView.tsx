import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TetaAppPathsStatusResponse,
  TetaPluginDllRecord,
  TetaPluginImportDetailResponse,
  TetaPluginsStatusResponse,
} from '@teta/shared';
import type { NavItem } from '../layout/Sidebar';
import { authFetch } from '../../lib/auth-storage';
import { readResponseJson } from '../../lib/read-response-json';
import './teta-plugins.css';
import { TetaPluginImportDetailPanel } from './TetaPluginImportDetailPanel';

type TetaPluginsViewProps = {
  onNavigate: (item: NavItem) => void;
};

type ImportStatusFilter = 'all' | 'imported' | 'pending';

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
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const loadAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wczytać wtyczek.');
      setStatus(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
          <button
            type="button"
            className="teta-plugins__btn"
            disabled={loading || refreshing || !pathsConfigured}
            onClick={() => void loadAll(true)}
          >
            {refreshing ? 'Odświeżanie…' : 'Odśwież skan'}
          </button>
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
                      <button
                        type="button"
                        className={`teta-plugins__tile-import${isImporting ? ' teta-plugins__tile-import--loading' : ''}`}
                        disabled={isImporting}
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
    </div>
  );
}
