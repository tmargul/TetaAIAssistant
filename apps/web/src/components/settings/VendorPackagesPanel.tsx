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
      setMessage(
        'Paczka offline pobrana. Rozpakuj ZIP u klienta i uruchom setup:client:offline (lub Setup.ps1 -Mode client -Offline).',
      );
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
      setMessage(
        `Paczka RAG global ${version} pobrana. Admin klienta zaimportuje ją w trybie client (wkrótce w UI).`,
      );
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
        <article className="settings__package-card">
          <h3 className="settings__package-title">1. Paczka setup offline</h3>
          <p className="settings__package-desc">
            Zawiera Qdrant, NSSM, modele Ollama, pnpm store i opcjonalnie paczki RAG. Wymaga
            internetu podczas budowy. Przed budową upewnij się, że masz modele Ollama (np.{' '}
            <code>nomic-embed-text</code>) oraz opcjonalnie instalatory w{' '}
            <code>data/offline-installers/</code>.
          </p>
          <ul className="settings__package-list">
            <li>Rozpakuj ZIP na nośniku klienta</li>
            <li>
              U klienta: <code>pnpm setup:client:offline</code>
            </li>
          </ul>
          <button
            type="button"
            className="settings__btn"
            onClick={handleOfflineExport}
            disabled={offlineLoading}
          >
            {offlineLoading ? 'Przygotowywanie… (może potrwać)' : 'Przygotuj i pobierz paczkę offline'}
          </button>
        </article>

        <article className="settings__package-card">
          <h3 className="settings__package-title">2. Paczka RAG globalny</h3>
          <p className="settings__package-desc">
            Eksport wektorów z globalnej bazy wiedzy. Admin klienta importuje paczkę bez dostępu do
            źródeł dokumentów Tety.
          </p>
          {ragStatus && (
            <dl className="settings__package-stats">
              <div>
                <dt>Chunków w bazie</dt>
                <dd>{ragStatus.chunkCount}</dd>
              </div>
              <div>
                <dt>Model embeddingu</dt>
                <dd>{ragStatus.embeddingModel}</dd>
              </div>
              <div>
                <dt>Ostatnia wersja</dt>
                <dd>{ragStatus.lastVersion ?? '—'}</dd>
              </div>
            </dl>
          )}
          <div className="settings__package-form">
            <input
              className="settings__input"
              placeholder="Wersja paczki (np. 1.0.0)"
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
          {!ragStatus?.chunkCount && (
            <p className="settings__package-warn">
              Baza RAG jest pusta — najpierw uruchom ingest: <code>pnpm rag:global:ingest</code>
            </p>
          )}
        </article>
      </div>
    </>
  );
}
