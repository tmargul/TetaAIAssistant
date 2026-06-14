import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientUpdatesStatusResponse, GlobalRagImportResult } from '@teta/shared';
import { getAccessToken, authFetch } from '../../lib/auth-storage';
import './settings.css';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pl-PL');
}

export function ClientUpdatesPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ClientUpdatesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
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

  const handleImportFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Wybierz plik ZIP (global-rag-X.zip) od Tety.');
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

      const res = await fetch('/api/admin/updates/global-rag/import', {
        method: 'POST',
        body: form,
        headers,
      });

      const result = (await res.json()) as GlobalRagImportResult | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((result as { message?: string[] }).message)
          ? (result as { message: string[] }).message.join(', ')
          : (result as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      const imported = result as GlobalRagImportResult;
      setMessage(
        `Zaimportowano RAG ${imported.version}: ${imported.chunkCount} chunków z ${imported.sources.length} plików.`,
      );
      setStatus(await loadStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import paczki RAG nie powiódł się.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return <p className="settings__hint">Wczytywanie statusu aktualizacji…</p>;
  }

  const rag = status?.globalRag;

  return (
    <div className="settings__updates">
      {message && <div className="settings__message settings__message--ok">{message}</div>}
      {error && <div className="settings__message settings__message--error">{error}</div>}

      <p className="settings__packages-lead">
        Aktualizacje wdrożenia u klienta. Globalny RAG importujesz z paczki od Tety; aplikację i
        modele AI zwykle aktualizuje IT (instrukcje poniżej).
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
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="settings__updates-file"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
              }}
            />
            <button
              type="button"
              className="settings__btn"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? 'Importowanie…' : 'Importuj paczkę RAG (ZIP)'}
            </button>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Aplikacja</h3>
            <p className="settings__package-desc">
              Aktualna wersja: <strong>{status?.appVersion ?? '—'}</strong>. Nową wersję dostarcza
              Teta jako paczkę aktualizacji — rozpakuj na katalog instalacji i uruchom{' '}
              <code>Aktualizuj-Aplikacje.bat</code> (wymaga dostępu IT do serwera).
            </p>
          </div>
        </article>

        <article className="settings__package-card">
          <div className="settings__package-body">
            <h3 className="settings__package-title">Modele AI (Ollama)</h3>
            <p className="settings__package-desc">
              Status:{' '}
              <strong>{status?.ollama.status === 'ok' ? 'online' : 'offline'}</strong>
              {status?.ollama.status === 'ok' && (
                <>
                  {' '}
                  · modele czatu:{' '}
                  {status.ollama.chatModels.length > 0
                    ? status.ollama.chatModels.join(', ')
                    : 'brak (zainstaluj qwen3)'}
                </>
              )}
            </p>
            <p className="settings__package-desc">
              Aktualizacja modeli: <code>ollama pull qwen3</code> na serwerze lub ponowny setup z
              paczki offline (IT). Opcjonalnie deepseek-r1 — wolniejszy model rozumujący.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
