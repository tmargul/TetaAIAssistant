import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENT_RAG_SUPPORTED_EXTENSIONS,
  type ClientRagStatusResponse,
  type RagDocumentRecord,
  isClientRagSupportedExtension,
} from '@teta/shared';
import { useAuth } from '../../context/AuthContext';
import { authFetch, getAccessToken } from '../../lib/auth-storage';
import './documents.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pl-PL');
}

function statusLabel(status: RagDocumentRecord['status']): string {
  switch (status) {
    case 'indexed':
      return 'Zaindeksowany';
    case 'processing':
      return 'Indeksowanie…';
    case 'failed':
      return 'Błąd';
    default:
      return 'Oczekuje';
  }
}

async function uploadDocumentFile(file: File): Promise<RagDocumentRecord> {
  const form = new FormData();
  form.append('file', file);
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch('/api/documents/upload', {
    method: 'POST',
    body: form,
    headers,
  });

  const data = (await res.json()) as { document?: RagDocumentRecord; message?: string | string[] };
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message ?? `HTTP ${res.status}`);
  }
  if (!data.document) {
    throw new Error('Nieprawidłowa odpowiedź serwera.');
  }
  return data.document;
}

export function DocumentsView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<RagDocumentRecord[]>([]);
  const [status, setStatus] = useState<ClientRagStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    const [docsRes, statusRes] = await Promise.all([
      authFetch('/api/documents'),
      authFetch('/api/documents/status'),
    ]);
    if (docsRes.ok) setDocuments(await docsRes.json());
    if (statusRes.ok) setStatus(await statusRes.json());
  }, []);

  useEffect(() => {
    loadData()
      .catch(() => setError('Nie udało się wczytać dokumentów RAG.'))
      .finally(() => setLoading(false));
  }, [loadData]);

  const handleFiles = async (files: FileList | File[]) => {
    if (!isAdmin) return;
    const list = [...files];
    if (list.length === 0) return;

    const unsupported = list.filter((file) => {
      const dot = file.name.lastIndexOf('.');
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
      return !isClientRagSupportedExtension(ext);
    });
    if (unsupported.length > 0) {
      setError(
        `Nieobsługiwany format: ${unsupported.map((f) => f.name).join(', ')}. Dozwolone: ${CLIENT_RAG_SUPPORTED_EXTENSIONS.join(', ')}`,
      );
      setDragOver(false);
      return;
    }

    setMessage(null);
    setError(null);
    setUploading(true);

    try {
      for (const file of list) {
        await uploadDocumentFile(file);
      }
      setMessage(
        list.length === 1
          ? `Dodano i zaindeksowano: ${list[0].name}`
          : `Dodano i zaindeksowano ${list.length} dokumentów.`,
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

  const handleDelete = async (doc: RagDocumentRecord) => {
    if (!window.confirm(`Usunąć dokument „${doc.originalName}" z bazy RAG?`)) return;
    setActionId(doc.id);
    setMessage(null);
    setError(null);
    try {
      const res = await authFetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? `HTTP ${res.status}`);
      }
      setMessage(`Usunięto: ${doc.originalName}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Usuwanie nie powiodło się.');
    } finally {
      setActionId(null);
    }
  };

  const handleReindex = async (doc: RagDocumentRecord) => {
    setActionId(doc.id);
    setMessage(null);
    setError(null);
    try {
      const res = await authFetch(`/api/documents/${doc.id}/reindex`, { method: 'POST' });
      const data = (await res.json()) as RagDocumentRecord & { message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      setMessage(`Ponownie zaindeksowano: ${doc.originalName}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Indeksacja nie powiodła się.');
      await loadData();
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="documents">
      <div className="documents__stats">
        <div className="documents__stat">
          <span className="documents__stat-label">Dokumenty klienta</span>
          <strong>{status?.documentCount ?? '…'}</strong>
        </div>
        <div className="documents__stat">
          <span className="documents__stat-label">Zaindeksowane</span>
          <strong>{status?.indexedDocumentCount ?? '…'}</strong>
        </div>
        <div className="documents__stat">
          <span className="documents__stat-label">Chunków (klient)</span>
          <strong>{status?.chunkCount ?? '…'}</strong>
        </div>
        <div className="documents__stat">
          <span className="documents__stat-label">Chunków (global)</span>
          <strong>{status?.globalChunkCount ?? '…'}</strong>
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
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="documents__dropzone-title">
            {uploading
              ? 'Indeksowanie dokumentu…'
              : 'Upuść pliki .txt / .md / .pdf lub kliknij, aby wybrać'}
          </p>
          <p className="documents__dropzone-hint">
            Dokumenty trafiają do lokalnej bazy RAG klienta ({status?.collection ?? 'teta_client'}).
            Model: {status?.embeddingModel ?? 'nomic-embed-text'}.
          </p>
        </div>
      )}

      {!isAdmin && (
        <p className="documents__readonly-hint">
          Tylko administrator może dodawać i usuwać dokumenty. Poniżej lista zaindeksowanych plików.
        </p>
      )}

      <section className="panel documents__panel">
        <h2 className="panel__title">Dokumenty w indeksie RAG</h2>
        {loading ? (
          <p className="documents__empty">Ładowanie…</p>
        ) : (
          <table className="documents__table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Status</th>
                <th>Chunków</th>
                <th>Rozmiar</th>
                <th>Dodany</th>
                <th>Autor</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.originalName}</td>
                  <td>
                    <span
                      className={`documents__badge documents__badge--${doc.status}`}
                      title={doc.errorMessage ?? undefined}
                    >
                      {statusLabel(doc.status)}
                    </span>
                  </td>
                  <td>{doc.chunkCount}</td>
                  <td>{formatBytes(doc.sizeBytes)}</td>
                  <td>{formatDate(doc.createdAt)}</td>
                  <td>{doc.uploaderName ?? '—'}</td>
                  {isAdmin && (
                    <td className="documents__actions">
                      <button
                        type="button"
                        className="documents__action-btn"
                        disabled={actionId === doc.id || uploading}
                        onClick={() => handleReindex(doc)}
                      >
                        Reindex
                      </button>
                      <button
                        type="button"
                        className="documents__action-btn documents__action-btn--danger"
                        disabled={actionId === doc.id || uploading}
                        onClick={() => handleDelete(doc)}
                      >
                        Usuń
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="documents__empty">
                    Brak dokumentów w lokalnym indeksie RAG.
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
