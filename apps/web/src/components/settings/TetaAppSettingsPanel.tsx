import { useCallback, useEffect, useState } from 'react';
import type { TetaAppPathsStatusResponse } from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';
import { DirectoryPathPicker } from './DirectoryPathPicker';
import './settings.css';

export function TetaAppSettingsPanel() {
  const [clientDirectory, setClientDirectory] = useState('');
  const [serverDirectory, setServerDirectory] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyStatus = (data: TetaAppPathsStatusResponse) => {
    setClientDirectory(data.clientDirectory);
    setServerDirectory(data.serverDirectory);
    setUpdatedAt(data.updatedAt);
  };

  const loadPaths = useCallback(async () => {
    const res = await authFetch('/api/vendor/teta-app/paths');
    const data = (await res.json()) as TetaAppPathsStatusResponse | { message?: string | string[] };
    if (!res.ok) {
      const msg = Array.isArray((data as { message?: string[] }).message)
        ? (data as { message: string[] }).message.join(', ')
        : (data as { message?: string }).message;
      throw new Error(msg ?? `HTTP ${res.status}`);
    }
    applyStatus(data as TetaAppPathsStatusResponse);
  }, []);

  useEffect(() => {
    loadPaths()
      .catch(() => setError('Nie udało się wczytać ścieżek aplikacji Teta.'))
      .finally(() => setLoading(false));
  }, [loadPaths]);

  const handleSave = async () => {
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      const res = await authFetch('/api/vendor/teta-app/paths', {
        method: 'PUT',
        body: JSON.stringify({ clientDirectory, serverDirectory }),
      });
      const data = (await res.json()) as TetaAppPathsStatusResponse | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((data as { message?: string[] }).message)
          ? (data as { message: string[] }).message.join(', ')
          : (data as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      applyStatus(data as TetaAppPathsStatusResponse);
      setMessage('Zapisano ścieżki katalogów aplikacji Teta.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać ścieżek.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="settings__hint">Wczytywanie…</p>;
  }

  return (
    <>
      {message && <div className="settings__message settings__message--ok">{message}</div>}
      {error && <div className="settings__message settings__message--error">{error}</div>}

      <h2 className="panel__title">Aplikacja Teta</h2>
      <p className="settings__hint">
        Ścieżki instalacji Tety na serwerze, z których moduł vendor będzie czytał metadane wtyczek
        i formularzy. Katalogi muszą istnieć na maszynie, na której działa API.
      </p>

      <div className="settings__field">
        <label className="settings__label" htmlFor="teta-client-directory">
          Katalog Teta Aplikacja Klienta
        </label>
        <DirectoryPathPicker
          inputId="teta-client-directory"
          value={clientDirectory}
          onChange={setClientDirectory}
          disabled={saving}
          placeholder="C:\\Teta\\Client"
          dialogTitle="Katalog Teta Aplikacja Klienta"
        />
      </div>

      <div className="settings__field">
        <label className="settings__label" htmlFor="teta-server-directory">
          Katalog Teta Serwer Aplikacyjny
        </label>
        <DirectoryPathPicker
          inputId="teta-server-directory"
          value={serverDirectory}
          onChange={setServerDirectory}
          disabled={saving}
          placeholder="C:\\Teta\\Server"
          dialogTitle="Katalog Teta Serwer Aplikacyjny"
        />
      </div>

      {updatedAt && (
        <p className="settings__hint">
          Ostatnia zmiana: {new Date(updatedAt).toLocaleString('pl-PL')}
        </p>
      )}

      <div className="settings__actions">
        <button
          type="button"
          className="settings__btn"
          onClick={() => void handleSave()}
          disabled={saving || !clientDirectory.trim() || !serverDirectory.trim()}
        >
          {saving ? 'Zapisywanie…' : 'Zapisz ścieżki'}
        </button>
      </div>
    </>
  );
}
