import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatRagSourceExtensions,
  getRagSourceFileAccept,
  isRagSourceExtension,
  type GlobalRagStatusResponse,
  type GlobalSourceFileRecord,
  type GlobalSourcesListResponse,
} from '@teta/shared';
import { useAuth } from '../../context/AuthContext';
import { authFetch, getAccessToken } from '../../lib/auth-storage';
import '../documents/documents.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pl-PL');
}

async function uploadSourceFile(file: File): Promise<GlobalSourceFileRecord> {
  const form = new FormData();
  form.append('file', file);
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch('/api/vendor/rag/sources/upload', {
    method: 'POST',
    body: form,
    headers,
  });

  const data = (await res.json()) as GlobalSourceFileRecord & { message?: string | string[] };
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message ?? `HTTP ${res.status}`);
  }
  return data;
}

export function GlobalSourcesView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<GlobalSourceFileRecord[]>([]);
  const [directory, setDirectory] = useState('');
  const [ragStatus, setRagStatus] = useState<GlobalRagStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionName, setActionName] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [sourcesRes, statusRes] = await Promise.all([
      authFetch('/api/vendor/rag/sources'),
      authFetch('/api/vendor/rag/status'),
    ]);
    if (sourcesRes.ok) {
      const data = (await sourcesRes.json()) as GlobalSourcesListResponse;
      setSources(data.files);
      setDirectory(data.directory);
    }
    if (statusRes.ok) {
      setRagStatus(await statusRes.json());
    }
  }, []);

  useEffect(() => {
    loadData()
      .catch(() => setError('Nie udało się wczytać źródeł globalnych RAG.'))
      .finally(() => setLoading(false));
  }, [loadData]);

  const handleFiles = async (files: FileList | File[]) => {
    if (!isAdmin) return;
    const list = [...files];
    if (list.length === 0) return;

    const unsupported = list.filter((file) => {
      const dot = file.name.lastIndexOf('.');
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
      return !isRagSourceExtension(ext);
    });
    if (unsupported.length > 0) {
      setError(
        `Nieobsługiwany format: ${unsupported.map((f) => f.name).join(', ')}. Dozwolone: ${formatRagSourceExtensions()}`,
      );
      setDragOver(false);
      return;
    }

    setMessage(null);
    setError(null);
    setUploading(true);

    try {
      for (const file of list) {
        await uploadSourceFile(file);
      }
      setMessage(
        list.length === 1
          ? `Dodano plik: ${list[0].name}`
          : `Dodano ${list.length} plików do bazy wiedzy.`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload nie powiódł się.');
      await loadData();
    } finally {
      setUploading(false);
      setDragOver(false);
    }
  };

  const handleDelete = async (file: GlobalSourceFileRecord) => {
    if (file.protected) return;
    if (!window.confirm(`Usunąć plik „${file.name}" z katalogu źródeł?`)) return;

    setActionName(file.name);
    setMessage(null);
    setError(null);
    try {
      const res = await authFetch(
        `/api/vendor/rag/sources?path=${encodeURIComponent(file.name)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? `HTTP ${res.status}`);
      }
      setMessage(`Usunięto: ${file.name}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Usuwanie nie powiodło się.');
    } finally {
      setActionName(null);
    }
  };

  const editableFiles = sources.filter((f) => !f.protected);

  return (
    <div className="documents">
      <div className="documents__stats">
        <div className="documents__stat">
          <span className="documents__stat-label">Pliki źródłowe</span>
          <strong>{editableFiles.length}</strong>
        </div>
        <div className="documents__stat">
          <span className="documents__stat-label">W indeksie RAG</span>
          <strong>{ragStatus?.sources.length ?? '…'}</strong>
        </div>
        <div className="documents__stat">
          <span className="documents__stat-label">Chunków (global)</span>
          <strong>{ragStatus?.chunkCount ?? '…'}</strong>
        </div>
        <div className="documents__stat">
          <span className="documents__stat-label">Ostatnia wersja</span>
          <strong>{ragStatus?.lastVersion ?? '—'}</strong>
        </div>
      </div>

      {message && <div className="documents__alert documents__alert--ok">{message}</div>}
      {error && <div className="documents__alert documents__alert--error">{error}</div>}

      {isAdmin && (
        <div
          className={`documents__dropzone${dragOver ? ' documents__dropzone--active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            void handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={getRagSourceFileAccept()}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="documents__dropzone-title">
            {uploading
              ? 'Zapisywanie plików…'
              : `Upuść pliki ${formatRagSourceExtensions(' / ')} lub kliknij, aby wybrać`}
          </p>
          <p className="documents__dropzone-hint">
            Pliki trafiają do katalogu źródeł globalnego RAG. Po dodaniu materiałów przejdź do{' '}
            <strong>Ustawienia → Paczki</strong> i kliknij <strong>Zbuduj indeks RAG</strong>.
            {directory && (
              <>
                {' '}
                Katalog: <code>{directory}</code>
              </>
            )}
          </p>
        </div>
      )}

      {!isAdmin && (
        <p className="documents__readonly-hint">
          Tylko administrator może dodawać i usuwać pliki źródłowe. Poniżej lista materiałów.
        </p>
      )}

      <section className="panel documents__panel">
        <h2 className="panel__title">Materiały w katalogu źródeł</h2>
        {loading ? (
          <p className="documents__empty">Ładowanie…</p>
        ) : (
          <table className="documents__table">
            <thead>
              <tr>
                <th>Nazwa pliku</th>
                <th>W indeksie</th>
                <th>Rozmiar</th>
                <th>Ostatnia zmiana</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {sources.map((file) => (
                <tr key={file.name}>
                  <td>
                    {file.name}
                    {file.protected && (
                      <span className="documents__badge documents__badge--indexed" title="Plik instrukcji">
                        {' '}
                        instrukcja
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`documents__badge documents__badge--${
                        file.indexed ? 'indexed' : 'pending'
                      }`}
                    >
                      {file.indexed ? 'Tak' : 'Nie'}
                    </span>
                  </td>
                  <td>{formatBytes(file.sizeBytes)}</td>
                  <td>{formatDate(file.modifiedAt)}</td>
                  {isAdmin && (
                    <td className="documents__actions">
                      {!file.protected && (
                        <button
                          type="button"
                          className="documents__action-btn documents__action-btn--danger"
                          disabled={actionName === file.name || uploading}
                          onClick={() => handleDelete(file)}
                        >
                          Usuń
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {sources.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="documents__empty">
                    Brak plików — dodaj materiały szkoleniowe ({formatRagSourceExtensions()}).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
