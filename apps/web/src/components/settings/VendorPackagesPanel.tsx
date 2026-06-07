import { useEffect, useState } from 'react';
import type { GlobalRagStatusResponse } from '@teta/shared';
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
  const [appUpdateLoading, setAppUpdateLoading] = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [ragLoading, setRagLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

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
    <>
      <h2 className="panel__title">Paczki wdrożeniowe</h2>
      <p className="settings__hint">
        Przygotuj paczki do przekazania klientowi. Dostępne tylko w trybie vendor (u Tety).
      </p>

      {message && <div className="settings__message settings__message--ok">{message}</div>}
      {error && <div className="settings__message settings__message--error">{error}</div>}

      <div className="settings__package-grid">
        <article className="settings__package-card settings__package-card--featured">
          <div className="settings__package-body">
            <h3 className="settings__package-title">1. Instalacja klienta (pełna)</h3>
            <p className="settings__package-desc">
              Pierwsza instalacja — aplikacja, silnik, RAG i uruchomienie. Gdy u klienta nie ma
              jeszcze niczego.
            </p>
            <ul className="settings__package-list">
              <li>Rozpakuj ZIP → <code>Instaluj-Klienta.bat</code> (Admin)</li>
            </ul>
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
            <h3 className="settings__package-title">2. Aktualizacja aplikacji</h3>
            <p className="settings__package-desc">
              Tylko React + NestJS (kod i zależności). Bez Ollama, Qdrant i RAG — gdy u klienta
              system już działa i chcesz podmienić samą apkę.
            </p>
            <ul className="settings__package-list">
              <li>Rozpakuj na istniejący katalog instalacji</li>
              <li>Uruchom <code>Aktualizuj-Aplikacje.bat</code></li>
            </ul>
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
            <h3 className="settings__package-title">3. Setup offline (silnik)</h3>
            <p className="settings__package-desc">
              Qdrant, NSSM, modele Ollama, pnpm store. Aktualizacja silnika bez zmiany kodu
              aplikacji.
            </p>
            <ul className="settings__package-list">
              <li>
                U klienta: <code>setup:client:offline -NoStart</code>
              </li>
            </ul>
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

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">4. RAG globalny</h3>
            <p className="settings__package-desc">
              Eksport wektorów z bazy wiedzy. Admin klienta importuje bez dostępu do dokumentów
              Tety.
            </p>
            {ragStatus && (
              <dl className="settings__package-stats">
                <div>
                  <dt>Chunków</dt>
                  <dd>{ragStatus.chunkCount}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{ragStatus.embeddingModel}</dd>
                </div>
                <div>
                  <dt>Wersja</dt>
                  <dd>{ragStatus.lastVersion ?? '—'}</dd>
                </div>
              </dl>
            )}
            {!ragStatus?.chunkCount && (
              <p className="settings__package-warn">
                Baza RAG pusta — uruchom <code>pnpm rag:global:ingest</code>
              </p>
            )}
          </div>
          <div className="settings__package-actions">
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
      </div>
    </>
  );
}
