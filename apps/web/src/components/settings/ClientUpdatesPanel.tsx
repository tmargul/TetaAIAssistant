import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientUpdatesStatusResponse,
  GlobalRagImportResult,
  OllamaModelPullResult,
  OllamaModelsImportResult,
  OllamaPullModel,
} from '@teta/shared';
import { getAccessToken, authFetch } from '../../lib/auth-storage';
import './settings.css';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pl-PL');
}

function hasEmbeddingModel(models: string[]): boolean {
  return models.some((name) => name.split(':')[0].toLowerCase().includes('embed'));
}

export function ClientUpdatesPanel() {
  const ragFileInputRef = useRef<HTMLInputElement>(null);
  const modelsFileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ClientUpdatesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ragImporting, setRagImporting] = useState(false);
  const [modelsImporting, setModelsImporting] = useState(false);
  const [modelsPathImporting, setModelsPathImporting] = useState(false);
  const [pullingModel, setPullingModel] = useState<OllamaPullModel | null>(null);
  const [modelsPath, setModelsPath] = useState('');
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
    }
  };

  const handleRagImport = (file: File) => {
    void handleImportFile(file, '/api/admin/updates/global-rag/import', setRagImporting, (result) => {
      const imported = result as GlobalRagImportResult;
      setMessage(
        `Zaimportowano RAG ${imported.version}: ${imported.chunkCount} chunków z ${imported.sources.length} plików.`,
      );
      if (ragFileInputRef.current) ragFileInputRef.current.value = '';
    });
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
    }
  };

  const handlePullModel = async (model: OllamaPullModel) => {
    setMessage(null);
    setError(null);
    setPullingModel(model);

    try {
      const res = await authFetch('/api/admin/updates/ollama/pull', {
        method: 'POST',
        body: JSON.stringify({ model }),
      });
      const result = (await res.json()) as OllamaModelPullResult | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((result as { message?: string[] }).message)
          ? (result as { message: string[] }).message.join(', ')
          : (result as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      setMessage(`Model ${(result as OllamaModelPullResult).model} pobrany z Ollama.`);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pobieranie modelu nie powiodło się.');
    } finally {
      setPullingModel(null);
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

      <div className="settings__updates-grid">
        <article className="settings__package-card settings__package-card--accent">
          <div className="settings__package-body">
            <h3 className="settings__package-title">RAG globalny (Teta)</h3>
            <p className="settings__package-desc">
              Paczka <code>global-rag-X.zip</code> od zespołu Tety. Zastępuje bazę wiedzy w Qdrant
              (<code>teta_global</code>).
            </p>
            {rag && (
              <dl className="settings__package-stats">
                <div>
                  <dt>Wersja</dt>
                  <dd>{rag.lastVersion ?? '—'}</dd>
                </div>
                <div>
                  <dt>Chunków</dt>
                  <dd>{rag.chunkCount}</dd>
                </div>
                <div>
                  <dt>Plików</dt>
                  <dd>{rag.sources.length}</dd>
                </div>
                <div>
                  <dt>Ostatni import</dt>
                  <dd>{formatDate(rag.lastBuiltAt)}</dd>
                </div>
              </dl>
            )}
            {!rag?.chunkCount && (
              <p className="settings__package-warn">
                Baza RAG pusta — zaimportuj paczkę od Tety lub poproś IT o instalację.
              </p>
            )}
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <input
              ref={ragFileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="settings__updates-file"
              disabled={ragImporting}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRagImport(file);
              }}
            />
            <button
              type="button"
              className="settings__btn"
              disabled={ragImporting}
              onClick={() => ragFileInputRef.current?.click()}
            >
              {ragImporting ? 'Importowanie…' : 'Importuj paczkę RAG (ZIP)'}
            </button>
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
              Offline: paczka <code>teta-models-update-*.zip</code> z pendrive’a (zalecane dla
              dużych plików — import ze ścieżki serwera). Online: pobierz modele z Ollama.
            </p>
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
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
              {modelsImporting ? 'Importowanie…' : 'Importuj paczkę modeli (ZIP)'}
            </button>
            <div className="settings__updates-path">
              <p className="settings__updates-path-label">Ścieżka na serwerze (pendrive / dysk lokalny)</p>
              <input
                type="text"
                className="settings__input"
                placeholder="E:\Teta\teta-models-update.zip"
                value={modelsPath}
                disabled={modelsBusy}
                onChange={(e) => setModelsPath(e.target.value)}
              />
              <button
                type="button"
                className="settings__btn settings__btn--secondary"
                disabled={modelsBusy}
                onClick={() => void handleModelsPathImport()}
              >
                {modelsPathImporting ? 'Importowanie…' : 'Import ze ścieżki'}
              </button>
            </div>
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
        </article>
      </div>
    </div>
  );
}
