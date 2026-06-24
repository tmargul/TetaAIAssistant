import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientUpdatesStatusResponse,
  GlobalRagImportResult,
  OllamaModelPullStreamEvent,
  OllamaModelsImportResult,
  OllamaPullModel,
} from '@teta/shared';
import { getAccessToken, authFetch } from '../../lib/auth-storage';
import { GlobalRagImportButton } from './GlobalRagImportButton';
import { ServerPathPicker } from './ServerPathPicker';
import './settings.css';

function hasEmbeddingModel(models: string[]): boolean {
  return models.some((name) => name.split(':')[0].toLowerCase().includes('embed'));
}

type ModelOperationProgress = {
  kind: 'pull' | 'import' | 'import-path';
  model?: OllamaPullModel;
  percent: number | null;
  status: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatPullStatus(
  status: string,
  percent: number | null,
  completed?: number,
  total?: number,
): string {
  if (percent != null && total) {
    return `${status} — ${percent}% (${formatBytes(completed ?? 0)} / ${formatBytes(total)})`;
  }
  return status;
}

export function ClientUpdatesPanel() {
  const modelsFileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ClientUpdatesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelsImporting, setModelsImporting] = useState(false);
  const [modelsPathImporting, setModelsPathImporting] = useState(false);
  const [pullingModel, setPullingModel] = useState<OllamaPullModel | null>(null);
  const [operationProgress, setOperationProgress] = useState<ModelOperationProgress | null>(null);
  const [modelsPath, setModelsPath] = useState('');
  const [pathBrowseOpen, setPathBrowseOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await authFetch('/api/admin/updates/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ClientUpdatesStatusResponse>;
  }, []);

  useEffect(() => {
    loadStatus()
      .then(setStatus)
      .catch(() => setError('Nie udało się wczytać statusu aktualizacji.'))
      .finally(() => setLoading(false));
  }, [loadStatus]);

  const refreshStatus = async () => {
    setStatus(await loadStatus());
  };

  const handleImportFile = async (
    file: File,
    url: string,
    setImporting: (value: boolean) => void,
    onSuccess: (result: OllamaModelsImportResult | GlobalRagImportResult) => void,
  ) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Wybierz plik ZIP.');
      return;
    }

    setMessage(null);
    setError(null);
    setImporting(true);
    if (url.includes('ollama/import')) {
      setOperationProgress({ kind: 'import', percent: null, status: 'Importowanie paczki modeli…' });
    }

    try {
      const form = new FormData();
      form.append('file', file);
      const headers = new Headers();
      const token = getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const res = await fetch(url, {
        method: 'POST',
        body: form,
        headers,
      });

      const result = (await res.json()) as
        | OllamaModelsImportResult
        | GlobalRagImportResult
        | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((result as { message?: string[] }).message)
          ? (result as { message: string[] }).message.join(', ')
          : (result as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      onSuccess(result as OllamaModelsImportResult | GlobalRagImportResult);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import nie powiódł się.');
    } finally {
      setImporting(false);
      if (url.includes('ollama/import')) {
        setOperationProgress(null);
      }
    }
  };

  const handleRagImportSuccess = (imported: GlobalRagImportResult) => {
    setMessage(
      `Zaimportowano RAG ${imported.version}: ${imported.chunkCount} chunków z ${imported.sources.length} plików.`,
    );
  };

  const handleModelsImport = (file: File) => {
    void handleImportFile(
      file,
      '/api/admin/updates/ollama/import',
      setModelsImporting,
      (result) => {
        const imported = result as OllamaModelsImportResult;
        setMessage(
          `Zaimportowano modele (${imported.mergedFiles} plików): ${
            imported.importedModels.length > 0
              ? imported.importedModels.join(', ')
              : 'sprawdź listę w Ollama'
          }. Zrestartuj Ollama, jeśli modele nie pojawią się od razu.`,
        );
        if (modelsFileInputRef.current) modelsFileInputRef.current.value = '';
      },
    );
  };

  const handleModelsPathImport = async () => {
    const filePath = modelsPath.trim();
    if (!filePath) {
      setError('Podaj ścieżkę do pliku ZIP na serwerze (np. E:\\Teta\\teta-models-update.zip).');
      return;
    }

    setMessage(null);
    setError(null);
    setModelsPathImporting(true);
    setOperationProgress({
      kind: 'import-path',
      percent: null,
      status: 'Importowanie modeli ze ścieżki…',
    });

    try {
      const res = await authFetch('/api/admin/updates/ollama/import-path', {
        method: 'POST',
        body: JSON.stringify({ path: filePath }),
      });
      const result = (await res.json()) as OllamaModelsImportResult | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((result as { message?: string[] }).message)
          ? (result as { message: string[] }).message.join(', ')
          : (result as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      const imported = result as OllamaModelsImportResult;
      setMessage(
        `Zaimportowano modele ze ścieżki (${imported.mergedFiles} plików). Zrestartuj Ollama, jeśli trzeba.`,
      );
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import modeli ze ścieżki nie powiódł się.');
    } finally {
      setModelsPathImporting(false);
      setOperationProgress(null);
    }
  };

  const handlePullModel = async (model: OllamaPullModel) => {
    setMessage(null);
    setError(null);
    setPullingModel(model);
    setOperationProgress({
      kind: 'pull',
      model,
      percent: null,
      status: 'Łączenie z Ollama…',
    });

    try {
      const res = await authFetch('/api/admin/updates/ollama/pull', {
        method: 'POST',
        body: JSON.stringify({ model }),
      });

      const contentType = res.headers.get('Content-Type') ?? '';
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { message?: string | string[] };
          if (Array.isArray(data.message)) {
            message = data.message.join(', ');
          } else if (data.message) {
            message = data.message;
          }
        } catch {
          // response nie był JSON
        }
        throw new Error(message);
      }

      if (!contentType.includes('ndjson') || !res.body) {
        throw new Error('Serwer nie zwrócił strumienia postępu pobierania.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const event = JSON.parse(trimmed) as OllamaModelPullStreamEvent;
          if (event.type === 'progress') {
            setOperationProgress({
              kind: 'pull',
              model,
              percent: event.percent,
              status: formatPullStatus(event.status, event.percent, event.completed, event.total),
            });
          } else if (event.type === 'complete') {
            completed = true;
            setMessage(`Model ${event.model} pobrany z Ollama.`);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }

      if (!completed) {
        throw new Error('Pobieranie modelu zakończyło się bez potwierdzenia.');
      }

      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pobieranie modelu nie powiodło się.');
    } finally {
      setPullingModel(null);
      setOperationProgress(null);
    }
  };

  if (loading) {
    return <p className="settings__hint">Wczytywanie statusu aktualizacji…</p>;
  }

  const rag = status?.globalRag;
  const ollama = status?.ollama;
  const installed = ollama?.installedModels ?? [];
  const modelsBusy = modelsImporting || modelsPathImporting || pullingModel !== null;

  return (
    <div className="settings__updates">
      {message && <div className="settings__message settings__message--ok">{message}</div>}
      {error && <div className="settings__message settings__message--error">{error}</div>}

      <p className="settings__packages-lead">
        Aktualizacje wdrożenia u klienta. RAG i modele AI importujesz z paczek od Tety (pendrive
        lub sieć). Przy dostępnym internecie modele można też pobrać bezpośrednio z Ollama.
      </p>

      <div className="settings__packages-grid">
        <article className="settings__package-card settings__package-card--accent">
          <div className="settings__package-body">
            <h3 className="settings__package-title">RAG globalny (Teta)</h3>
            <p className="settings__package-desc">
              Paczka <code>global-rag-X.zip</code> od zespołu Tety. Zastępuje bazę wiedzy w Qdrant (
              <code>teta_global</code>).
            </p>
            {rag && (
              <dl className="settings__package-stats settings__package-stats--row">
                <div>
                  <dt>Chunków</dt>
                  <dd>{rag.chunkCount}</dd>
                </div>
                <div>
                  <dt>Plików</dt>
                  <dd>{rag.sources.length}</dd>
                </div>
                <div>
                  <dt>Wersja</dt>
                  <dd>{rag.lastVersion ?? '—'}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{rag.embeddingModel}</dd>
                </div>
              </dl>
            )}
            {!rag?.chunkCount && (
              <p className="settings__package-warn">
                Baza RAG pusta — zaimportuj paczkę od Tety.
              </p>
            )}
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <GlobalRagImportButton
              secondary={false}
              onStarted={() => {
                setMessage(null);
                setError(null);
              }}
              onSuccess={async (imported) => {
                handleRagImportSuccess(imported);
                await refreshStatus();
              }}
              onError={setError}
            />
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Modele AI (Ollama)</h3>
            <p className="settings__package-desc">
              Status:{' '}
              <strong>{ollama?.status === 'ok' ? 'online' : 'offline'}</strong>
              {ollama?.status === 'ok' && (
                <>
                  {' '}
                  · czat:{' '}
                  {ollama.chatModels.length > 0 ? ollama.chatModels.join(', ') : 'brak (qwen3)'}
                  {' '}
                  · embedding:{' '}
                  {hasEmbeddingModel(installed) ? 'nomic-embed-text' : 'brak'}
                </>
              )}
            </p>
            <p className="settings__package-desc">
              Offline: paczka <code>teta-models-update-*.zip</code> z pendrive’a — wybierz plik na
              serwerze lub zaimportuj mniejszą paczkę przez upload.
            </p>
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            {operationProgress && (
              <div className="settings__progress">
                <div
                  className={`settings__progress-bar${
                    operationProgress.percent == null ? ' settings__progress-bar--indeterminate' : ''
                  }`}
                >
                  <div
                    className="settings__progress-fill"
                    style={
                      operationProgress.percent != null
                        ? { width: `${operationProgress.percent}%` }
                        : undefined
                    }
                  />
                </div>
                <p className="settings__progress-label">{operationProgress.status}</p>
              </div>
            )}
            <input
              ref={modelsFileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="settings__updates-file"
              disabled={modelsBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleModelsImport(file);
              }}
            />
            <button
              type="button"
              className="settings__btn"
              disabled={modelsBusy}
              onClick={() => modelsFileInputRef.current?.click()}
            >
              {modelsImporting ? 'Importowanie…' : 'Importuj paczkę (upload ZIP)'}
            </button>

            <div className="settings__updates-divider" aria-hidden />

            <div className="settings__updates-path">
              <p className="settings__updates-path-label">Plik ZIP na serwerze</p>
              <ServerPathPicker
                value={modelsPath}
                onChange={setModelsPath}
                disabled={modelsBusy}
                browseOpen={pathBrowseOpen}
                onBrowseOpenChange={setPathBrowseOpen}
              />
              <button
                type="button"
                className="settings__btn settings__btn--secondary"
                disabled={modelsBusy || !modelsPath.trim()}
                onClick={() => void handleModelsPathImport()}
              >
                {modelsPathImporting ? 'Importowanie…' : 'Import ze ścieżki'}
              </button>
            </div>

            <div className="settings__updates-divider" aria-hidden />

            <p className="settings__updates-section-label">Pobierz z internetu (Ollama)</p>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              disabled={modelsBusy || ollama?.status !== 'ok'}
              onClick={() => void handlePullModel('qwen3')}
            >
              {pullingModel === 'qwen3' ? 'Pobieranie qwen3…' : 'Pobierz qwen3 (online)'}
            </button>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              disabled={modelsBusy || ollama?.status !== 'ok'}
              onClick={() => void handlePullModel('nomic-embed-text')}
            >
              {pullingModel === 'nomic-embed-text'
                ? 'Pobieranie embedding…'
                : 'Pobierz nomic-embed-text'}
            </button>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              disabled={modelsBusy || ollama?.status !== 'ok'}
              onClick={() => void handlePullModel('deepseek-r1')}
            >
              {pullingModel === 'deepseek-r1'
                ? 'Pobieranie deepseek-r1…'
                : 'Pobierz deepseek-r1 (opcja)'}
            </button>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Aplikacja</h3>
            <p className="settings__package-desc">
              Aktualna wersja: <strong>{status?.appVersion ?? '—'}</strong>. Aktualizacja kodu wymaga
              dostępu IT — paczka od Tety, rozpakowanie na katalog instalacji i{' '}
              <code>Aktualizuj-Aplikacje.bat</code> (bez przycisku w panelu — restart aplikacji).
            </p>
          </div>
          <div className="settings__package-actions">
            <p className="settings__package-desc settings__package-desc--muted">
              Aktualizacja przez IT — brak importu z panelu.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
