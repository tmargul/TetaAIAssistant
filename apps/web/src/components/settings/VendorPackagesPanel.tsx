import { useEffect, useState } from 'react';
import type { GlobalRagIngestResult, GlobalRagStatusResponse } from '@teta/shared';
import { formatRagSourceExtensions } from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';

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

export function VendorPackagesPanel() {
  const [ragStatus, setRagStatus] = useState<GlobalRagStatusResponse | null>(null);
  const [ragVersion, setRagVersion] = useState('');
  const [clientInstallLoading, setClientInstallLoading] = useState(false);
  const [vendorInstallLoading, setVendorInstallLoading] = useState(false);
  const [vendorOnlineInstallLoading, setVendorOnlineInstallLoading] = useState(false);
  const [appUpdateLoading, setAppUpdateLoading] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragIngestLoading, setRagIngestLoading] = useState(false);
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
  }, []);

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
        'Paczka vendor (online) pobrana. U kolegi: rozpakuj ZIP → Instaluj-Vendor-Online.bat (Admin, wymaga internetu).',
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
        'Paczka instalacji klienta pobrana. U klienta: rozpakuj ZIP → Instaluj-Klienta.bat (Admin).',
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
        'Paczka aktualizacji aplikacji pobrana. U klienta: rozpakuj na istniejący katalog → Aktualizuj-Aplikacje.bat.',
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
      setMessage(`Paczka RAG global ${version} pobrana. U klienta: Aktualizuj-RAG.bat lub pnpm rag:global:import.`);
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

      <div className="settings__package-layout">
        <article className="settings__package-card settings__package-card--accent settings__package-card--rag">
          <div className="settings__package-body">
            <h3 className="settings__package-title">RAG globalny</h3>
            <p className="settings__package-desc">
              Po dodaniu materiałów w <strong>Źródła globalne</strong> zbuduj indeks wektorów w Qdrant,
              a następnie pobierz paczkę <code>global-rag-X.zip</code> do wdrożeń u wszystkich klientów.
            </p>
            <ol className="settings__package-steps">
              <li>Dodaj pliki ({formatRagSourceExtensions()}) w menu Źródła globalne</li>
              <li>Kliknij „Zbuduj indeks RAG”</li>
              <li>Podaj wersję i pobierz paczkę dla klientów</li>
            </ol>
            {ragStatus && (
              <dl className="settings__package-stats">
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
                Indeks pusty — najpierw dodaj pliki w Źródła globalne.
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

        <div className="settings__package-grid">
          <article className="settings__package-card">
            <div className="settings__package-body">
              <h3 className="settings__package-title">Instalacja vendor</h3>
              <p className="settings__package-desc">
                Stanowisko budowy globalnego RAG u Tety. <strong>Online</strong> (~100 MB) — setup
                pobiera Node, Ollamę, Qdrant i modele z internetu. <strong>Offline</strong> (~7 GB) —
                cała paczka bez sieci u celu.
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
                Pełna instalacja na pustej maszynie u klienta: aplikacja (React + NestJS), silnik AI
                (Ollama, Qdrant), import globalnego RAG i skrypt startowy — wszystko w jednym ZIP.
              </p>
            </div>
            <div className="settings__package-actions">
              <button
                type="button"
                className="settings__btn"
                onClick={handleClientInstallExport}
                disabled={clientInstallLoading}
              >
                {clientInstallLoading ? 'Przygotowywanie…' : 'Pobierz paczkę instalacji'}
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
            <div className="settings__package-actions">
              <button
                type="button"
                className="settings__btn"
                onClick={handleOfflineExport}
                disabled={offlineLoading}
              >
                {offlineLoading ? 'Przygotowywanie…' : 'Pobierz paczkę offline'}
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
