import { useEffect, useState } from 'react';
import type {
  ClientUpdatesStatusResponse,
  GlobalRagImportResult,
  GlobalRagIngestResult,
  GlobalRagStatusResponse,
  OllamaModelPullStreamEvent,
  OllamaPullModel,
} from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { GlobalRagImportButton } from './GlobalRagImportButton';

async function downloadPackage(
  url: string,
  body?: Record<string, string>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await authFetch(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `Błąd HTTP ${res.status}`;
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
    return { ok: false, message };
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] ?? 'teta-package.zip';

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);

  return { ok: true };
}

function formatPullStatus(
  status: string,
  percent: number | null,
  completed?: number,
  total?: number,
): string {
  if (percent != null && total) {
    const mb = (n: number) =>
      n < 1024 * 1024 * 1024
        ? `${(n / (1024 * 1024)).toFixed(1)} MB`
        : `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return `${status} — ${percent}% (${mb(completed ?? 0)} / ${mb(total)})`;
  }
  return status;
}

export function VendorPackagesPanel() {
  const [ragStatus, setRagStatus] = useState<GlobalRagStatusResponse | null>(null);
  const [ragVersion, setRagVersion] = useState('');
  const [clientInstallLoading, setClientInstallLoading] = useState(false);
  const [clientOnlineInstallLoading, setClientOnlineInstallLoading] = useState(false);
  const [vendorInstallLoading, setVendorInstallLoading] = useState(false);
  const [vendorOnlineInstallLoading, setVendorOnlineInstallLoading] = useState(false);
  const [appUpdateLoading, setAppUpdateLoading] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [modelsUpdateLoading, setModelsUpdateLoading] = useState(false);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragIngestLoading, setRagIngestLoading] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<ClientUpdatesStatusResponse | null>(null);
  const [pullingModel, setPullingModel] = useState<OllamaPullModel | null>(null);
  const [pullProgress, setPullProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRagStatus = () => {
    authFetch('/api/vendor/rag/status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<GlobalRagStatusResponse>;
      })
      .then((status) => {
        setRagStatus(status);
        if (status.lastVersion) {
          setRagVersion(status.lastVersion);
        }
      })
      .catch(() => setError('Nie udało się wczytać statusu RAG globalnego.'));
  };

  useEffect(() => {
    loadRagStatus();
    authFetch('/api/admin/updates/status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ClientUpdatesStatusResponse>;
      })
      .then(setOllamaStatus)
      .catch(() => undefined);
  }, []);

  const refreshOllamaStatus = () => {
    authFetch('/api/admin/updates/status')
      .then(async (res) => res.json() as Promise<ClientUpdatesStatusResponse>)
      .then(setOllamaStatus)
      .catch(() => undefined);
  };

  const handlePullModel = async (model: OllamaPullModel) => {
    setMessage(null);
    setError(null);
    setPullingModel(model);
    setPullProgress('Łączenie z Ollama…');

    try {
      const res = await authFetch('/api/admin/updates/ollama/pull', {
        method: 'POST',
        body: JSON.stringify({ model }),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { message?: string | string[] };
          errMsg = Array.isArray(data.message) ? data.message.join(', ') : (data.message ?? errMsg);
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }

      if (!res.body) {
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
            setPullProgress(
              formatPullStatus(event.status, event.percent, event.completed, event.total),
            );
          } else if (event.type === 'complete') {
            completed = true;
            setMessage(`Model ${event.model} pobrany z Ollama. Wybierz go w czacie (lista modeli).`);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }

      if (!completed) {
        throw new Error('Pobieranie modelu zakończyło się bez potwierdzenia.');
      }

      refreshOllamaStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pobieranie modelu nie powiodło się.');
    } finally {
      setPullingModel(null);
      setPullProgress(null);
    }
  };

  const handleRagIngest = async () => {
    setMessage(null);
    setError(null);
    setRagIngestLoading(true);
    try {
      const res = await authFetch('/api/vendor/rag/ingest', { method: 'POST' });
      const result = (await res.json()) as GlobalRagIngestResult | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((result as { message?: string[] }).message)
          ? (result as { message: string[] }).message.join(', ')
          : (result as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      const ingest = result as GlobalRagIngestResult;
      setMessage(
        `Indeks RAG zbudowany: ${ingest.chunkCount} chunków z ${ingest.sources.length} plików.`,
      );
      loadRagStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Budowa indeksu RAG nie powiodła się.');
    } finally {
      setRagIngestLoading(false);
    }
  };

  const handleVendorOnlineInstallExport = async () => {
    setMessage(null);
    setError(null);
    setVendorOnlineInstallLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/vendor-install-online/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        'Paczka vendor (online) pobrana. Rozpakuj ZIP i uruchom TetaAI-Vendor-Setup-Online.exe (Admin). Po instalacji otworzy się przeglądarka. Gdy brak .exe — Instaluj-Vendor-Online.bat.',
      );
    } finally {
      setVendorOnlineInstallLoading(false);
    }
  };

  const handleVendorInstallExport = async () => {
    setMessage(null);
    setError(null);
    setVendorInstallLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/vendor-install/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        'Paczka vendor (offline) pobrana. Zawiera offline-bundle (~7 GB) — Instaluj-Vendor.bat bez internetu.',
      );
    } finally {
      setVendorInstallLoading(false);
    }
  };

  const handleClientOnlineInstallExport = async () => {
    setMessage(null);
    setError(null);
    setClientOnlineInstallLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/client-install-online/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        'Paczka klienta (online) pobrana. Na stanowisku docelowym (z internetem): Instaluj-Klienta-Online.bat (Admin), następnie import RAG.',
      );
    } finally {
      setClientOnlineInstallLoading(false);
    }
  };

  const handleClientInstallExport = async () => {
    setMessage(null);
    setError(null);
    setClientInstallLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/client-install/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        'Paczka klienta (offline) pobrana. Na stanowisku docelowym (bez sieci): Instaluj-Klienta.bat (Admin, ~7 GB).',
      );
    } finally {
      setClientInstallLoading(false);
    }
  };

  const handleAppUpdateExport = async () => {
    setMessage(null);
    setError(null);
    setAppUpdateLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/app-update/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        'Paczka aktualizacji aplikacji pobrana. Rozpakuj na istniejący katalog instalacji i uruchom Aktualizuj-Aplikacje.bat.',
      );
    } finally {
      setAppUpdateLoading(false);
    }
  };

  const handleOfflineExport = async () => {
    setMessage(null);
    setError(null);
    setOfflineLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/offline-bundle/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage('Paczka offline pobrana.');
    } finally {
      setOfflineLoading(false);
    }
  };

  const handleModelsUpdateExport = async () => {
    setMessage(null);
    setError(null);
    setModelsUpdateLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/models-update/export');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(
        'Paczka modeli pobrana. Import w panelu Aktualizacje u klienta: ze ścieżki lub z pliku ZIP.',
      );
    } finally {
      setModelsUpdateLoading(false);
    }
  };

  const handleRagExport = async () => {
    setMessage(null);
    setError(null);
    const version = ragVersion.trim();
    if (!version) {
      setError('Podaj wersję paczki RAG (np. 1.0.0).');
      return;
    }

    setRagLoading(true);
    try {
      const result = await downloadPackage('/api/vendor/packages/global-rag/export', { version });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(`Paczka RAG global ${version} pobrana. Import u klienta: Aktualizuj-RAG.bat lub pnpm rag:global:import.`);
    } finally {
      setRagLoading(false);
    }
  };

  return (
    <div className="settings__packages">
      <h2 className="settings__packages-heading">Paczki wdrożeniowe</h2>
      <p className="settings__packages-lead">
        Budowa i eksport globalnego RAG. Materiały dodajesz w menu{' '}
        <strong>Źródła globalne</strong>, potem budujesz indeks i pobierasz paczkę dla klientów.
      </p>

      {message && <div className="settings__message settings__message--ok">{message}</div>}
      {error && <div className="settings__message settings__message--error">{error}</div>}

      <div className="settings__packages-grid">
        <article className="settings__package-card settings__package-card--accent">
          <div className="settings__package-body">
            <h3 className="settings__package-title">RAG globalny</h3>
            <p className="settings__package-desc">
              Źródła w <strong>Źródła globalne</strong>, budowa indeksu i eksport{' '}
              <code>global-rag-X.zip</code>. Możesz też importować gotową paczkę.
            </p>
            {ragStatus && (
              <dl className="settings__package-stats settings__package-stats--row">
                <div>
                  <dt>Chunków</dt>
                  <dd>{ragStatus.chunkCount}</dd>
                </div>
                <div>
                  <dt>Plików</dt>
                  <dd>{ragStatus.sources.length}</dd>
                </div>
                <div>
                  <dt>Wersja</dt>
                  <dd>{ragStatus.lastVersion ?? '—'}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{ragStatus.embeddingModel}</dd>
                </div>
              </dl>
            )}
            {!ragStatus?.chunkCount && (
              <p className="settings__package-warn">
                Indeks pusty — dodaj pliki w Źródła globalne lub importuj ZIP.
              </p>
            )}
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <button
              type="button"
              className="settings__btn"
              onClick={handleRagIngest}
              disabled={ragIngestLoading || ragLoading}
            >
              {ragIngestLoading ? 'Indeksowanie…' : 'Zbuduj indeks RAG'}
            </button>
            <GlobalRagImportButton
              disabled={ragIngestLoading || ragLoading}
              onStarted={() => {
                setMessage(null);
                setError(null);
              }}
              onSuccess={(imported: GlobalRagImportResult) => {
                setMessage(
                  `Zaimportowano RAG ${imported.version}: ${imported.chunkCount} chunków z ${imported.sources.length} plików.`,
                );
                loadRagStatus();
              }}
              onError={setError}
            />
            <div className="settings__package-form">
              <input
                className="settings__input"
                placeholder="Wersja (np. 1.0.0)"
                value={ragVersion}
                onChange={(e) => setRagVersion(e.target.value)}
              />
              <button
                type="button"
                className="settings__btn"
                onClick={handleRagExport}
                disabled={ragLoading || !ragStatus?.chunkCount}
              >
                {ragLoading ? 'Eksportowanie…' : 'Pobierz paczkę RAG'}
              </button>
            </div>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Instalacja vendor</h3>
            <p className="settings__package-desc">
              Stanowisko budowy globalnego RAG u Tety. <strong>Online</strong> (ZIP ~1–5 MB) —
              setup pobiera zależności npm (~100–300 MB), Node, Ollamę, Qdrant i modele AI (~5–6 GB;
              opcjonalnie deepseek-r1 ~15 GB).
              <strong>Offline</strong> (~8–12 GB) — cała paczka bez sieci u celu.
            </p>
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <button
              type="button"
              className="settings__btn"
              onClick={handleVendorOnlineInstallExport}
              disabled={vendorOnlineInstallLoading || vendorInstallLoading}
            >
              {vendorOnlineInstallLoading ? 'Przygotowywanie…' : 'Paczka vendor (online)'}
            </button>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              onClick={handleVendorInstallExport}
              disabled={vendorInstallLoading || vendorOnlineInstallLoading}
            >
              {vendorInstallLoading ? 'Przygotowywanie…' : 'Paczka vendor (offline)'}
            </button>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Instalacja klienta</h3>
            <p className="settings__package-desc">
              Pełna instalacja u klienta. <strong>Online</strong> (ZIP ~1–5 MB) — setup pobiera
              zależności npm i silnik AI z internetu; RAG osobno (<code>global-rag-X.zip</code>).
              <strong>Offline</strong> (~8–12 GB) — wszystko w jednym ZIP, bez sieci u celu.
            </p>
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <button
              type="button"
              className="settings__btn"
              onClick={handleClientOnlineInstallExport}
              disabled={clientOnlineInstallLoading || clientInstallLoading}
            >
              {clientOnlineInstallLoading ? 'Przygotowywanie…' : 'Paczka klienta (online)'}
            </button>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              onClick={handleClientInstallExport}
              disabled={clientInstallLoading || clientOnlineInstallLoading}
            >
              {clientInstallLoading ? 'Przygotowywanie…' : 'Paczka klienta (offline)'}
            </button>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Aktualizacja aplikacji</h3>
            <p className="settings__package-desc">
              Tylko kod aplikacji (React + NestJS) — bez zmiany Ollamy, Qdrant ani bazy RAG. Rozpakuj
              na istniejący katalog instalacji i uruchom <code>Aktualizuj-Aplikacje.bat</code>.
            </p>
          </div>
          <div className="settings__package-actions">
            <button
              type="button"
              className="settings__btn"
              onClick={handleAppUpdateExport}
              disabled={appUpdateLoading}
            >
              {appUpdateLoading ? 'Pakowanie…' : 'Pobierz paczkę aktualizacji'}
            </button>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Setup offline</h3>
            <p className="settings__package-desc">
              Sam silnik offline: Qdrant, Ollama, modele embedding/czat i pnpm store. Do odświeżenia
              infrastruktury AI u klienta bez przebudowy aplikacji.
            </p>
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <button
              type="button"
              className="settings__btn"
              onClick={handleOfflineExport}
              disabled={offlineLoading || modelsUpdateLoading}
            >
              {offlineLoading ? 'Przygotowywanie…' : 'Pobierz paczkę offline'}
            </button>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              onClick={handleModelsUpdateExport}
              disabled={modelsUpdateLoading || offlineLoading}
            >
              {modelsUpdateLoading ? 'Pakowanie…' : 'Pobierz paczkę modeli'}
            </button>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Modele czatu (Ollama)</h3>
            <p className="settings__package-desc">
              Domyślnie setup instaluje <strong>qwen3</strong> (szybki czat). Opcjonalnie{' '}
              <strong>deepseek-r1</strong> (~15 GB) — wolniejszy, lepszy do trudniejszych pytań.
              Wymaga internetu i działającej Ollamy.
            </p>
            {ollamaStatus?.ollama && (
              <p className="settings__package-desc">
                Ollama:{' '}
                <strong>{ollamaStatus.ollama.status === 'ok' ? 'online' : 'offline'}</strong>
                {ollamaStatus.ollama.status === 'ok' && (
                  <>
                    {' '}
                    · zainstalowane modele czatu:{' '}
                    {ollamaStatus.ollama.chatModels.length > 0
                      ? ollamaStatus.ollama.chatModels.join(', ')
                      : 'brak'}
                  </>
                )}
              </p>
            )}
            {pullProgress && (
              <p className="settings__package-desc settings__hint">{pullProgress}</p>
            )}
          </div>
          <div className="settings__package-actions settings__package-actions--stack">
            <button
              type="button"
              className="settings__btn"
              onClick={() => void handlePullModel('deepseek-r1')}
              disabled={pullingModel !== null || ollamaStatus?.ollama?.status !== 'ok'}
            >
              {pullingModel === 'deepseek-r1'
                ? 'Pobieranie deepseek-r1…'
                : 'Pobierz deepseek-r1 (online)'}
            </button>
            <button
              type="button"
              className="settings__btn settings__btn--secondary"
              onClick={() => void handlePullModel('qwen3')}
              disabled={pullingModel !== null || ollamaStatus?.ollama?.status !== 'ok'}
            >
              {pullingModel === 'qwen3' ? 'Pobieranie qwen3…' : 'Pobierz / odśwież qwen3'}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
