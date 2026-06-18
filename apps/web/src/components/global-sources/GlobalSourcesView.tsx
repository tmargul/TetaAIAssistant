import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatRagSourceExtensions,
  getRagSourceFileAccept,
  isRagSourceExtension,
  VIDEO_INGEST_ACCEPT,
  type GlobalRagStatusResponse,
  type GlobalSourceFileRecord,
  type GlobalSourcesListResponse,
  type VideoIngestJobRecord,
  type VideoIngestJobsListResponse,
  type VideoIngestJobStatus,
  type VideoIngestStreamEvent,
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

function formatVideoStatus(status: VideoIngestJobStatus): string {
  switch (status) {
    case 'queued':
      return 'W kolejce';
    case 'extracting':
      return 'Ekstrakcja audio';
    case 'transcribing':
      return 'Transkrypcja';
    case 'indexing':
      return 'Indeksacja';
    case 'done':
      return 'Gotowe';
    case 'failed':
      return 'Błąd';
    default:
      return status;
  }
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

async function uploadVideoFile(file: File, merge: boolean): Promise<VideoIngestJobRecord> {
  const form = new FormData();
  form.append('file', file);
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const query = merge ? '?merge=true' : '';
  const res = await fetch(`/api/vendor/rag/ingest/video${query}`, {
    method: 'POST',
    body: form,
    headers,
  });

  const data = (await res.json()) as VideoIngestJobRecord & { message?: string | string[] };
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message ?? `HTTP ${res.status}`);
  }
  return data;
}

async function streamVideoJobEvents(
  jobId: number,
  onEvent: (event: VideoIngestStreamEvent) => void,
): Promise<void> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api/vendor/rag/ingest/video/${jobId}/events`, { headers });
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
    throw new Error('Serwer nie zwrócił strumienia postępu ingest wideo.');
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

      const event = JSON.parse(trimmed) as VideoIngestStreamEvent;
      onEvent(event);
      if (event.type === 'complete' || event.type === 'error') {
        completed = true;
      }
    }
  }

  if (!completed) {
    throw new Error('Ingest wideo zakończył się bez potwierdzenia.');
  }
}

export function GlobalSourcesView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<GlobalSourceFileRecord[]>([]);
  const [videoJobs, setVideoJobs] = useState<VideoIngestJobRecord[]>([]);
  const [directory, setDirectory] = useState('');
  const [ragStatus, setRagStatus] = useState<GlobalRagStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoMerge, setVideoMerge] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionName, setActionName] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<{
    jobId: number;
    filename: string;
    percent: number | null;
    status: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    const [sourcesRes, statusRes, jobsRes] = await Promise.all([
      authFetch('/api/vendor/rag/sources'),
      authFetch('/api/vendor/rag/status'),
      authFetch('/api/vendor/rag/ingest/video'),
    ]);
    if (sourcesRes.ok) {
      const data = (await sourcesRes.json()) as GlobalSourcesListResponse;
      setSources(data.files);
      setDirectory(data.directory);
    }
    if (statusRes.ok) {
      setRagStatus(await statusRes.json());
    }
    if (jobsRes.ok) {
      const data = (await jobsRes.json()) as VideoIngestJobsListResponse;
      setVideoJobs(data.jobs);
    }
  }, []);

  useEffect(() => {
    loadData()
      .catch(() => setError('Nie udało się wczytać źródeł globalnych RAG.'))
      .finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    const hasActive = videoJobs.some(
      (job) => job.status !== 'done' && job.status !== 'failed',
    );
    if (!hasActive || videoProgress) return undefined;

    const timer = window.setInterval(() => {
      void loadData();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [videoJobs, videoProgress, loadData]);

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

  const handleVideoFiles = async (files: FileList | File[]) => {
    if (!isAdmin) return;
    const list = [...files].filter((file) => file.name.toLowerCase().endsWith('.mp4'));
    if (list.length === 0) {
      setError('Wybierz plik wideo .mp4.');
      setVideoDragOver(false);
      return;
    }
    if (list.length > 1) {
      setError('Prześlij jeden plik MP4 naraz — kolejka przetwarza zadania po kolei.');
      setVideoDragOver(false);
      return;
    }

    const file = list[0];
    setMessage(null);
    setError(null);
    setVideoUploading(true);

    try {
      const job = await uploadVideoFile(file, videoMerge);
      setVideoProgress({
        jobId: job.id,
        filename: file.name,
        percent: job.progress,
        status: job.progressMessage ?? formatVideoStatus(job.status),
      });
      await loadData();

      await streamVideoJobEvents(job.id, (event) => {
        if (event.type === 'progress') {
          setVideoProgress({
            jobId: event.jobId,
            filename: file.name,
            percent: event.progress,
            status: event.message || formatVideoStatus(event.status),
          });
        } else if (event.type === 'complete') {
          setMessage(
            `Wideo „${file.name}” zindeksowane (${event.chunkCount} chunków${event.source ? `, ${event.source}` : ''}).`,
          );
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      });

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest wideo nie powiódł się.');
      await loadData();
    } finally {
      setVideoUploading(false);
      setVideoDragOver(false);
      setVideoProgress(null);
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
        <>
          <section className="panel documents__panel">
            <h2 className="panel__title">Ingest wideo MP4</h2>
            <p className="documents__dropzone-hint" style={{ marginBottom: '0.75rem' }}>
              Transkrypcja szkolenia (ffmpeg + Whisper) i automatyczny import do Qdrant. Wymaga
              Pythona, faster-whisper i ffmpeg na serwerze API.
            </p>
            <div
              className={`documents__dropzone${videoDragOver ? ' documents__dropzone--active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setVideoDragOver(true);
              }}
              onDragLeave={() => setVideoDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                void handleVideoFiles(e.dataTransfer.files);
              }}
              onClick={() => videoInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') videoInputRef.current?.click();
              }}
              role="button"
              tabIndex={0}
            >
              <input
                ref={videoInputRef}
                type="file"
                accept={VIDEO_INGEST_ACCEPT}
                hidden
                onChange={(e) => {
                  if (e.target.files) void handleVideoFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <p className="documents__dropzone-title">
                {videoUploading
                  ? 'Przesyłanie i przetwarzanie wideo…'
                  : 'Upuść plik .mp4 lub kliknij, aby wybrać szkolenie'}
              </p>
              <p className="documents__dropzone-hint">
                Po zakończeniu film trafia do indeksu globalnego RAG. Klatki zapisywane są w{' '}
                <code>sources/global/assets/</code>.
              </p>
              <label className="documents__video-options" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={videoMerge}
                  onChange={(e) => setVideoMerge(e.target.checked)}
                  disabled={videoUploading}
                />
                Dołącz do istniejącego indeksu (merge) zamiast zastępować
              </label>
              {videoProgress && (
                <div className="documents__progress">
                  <div
                    className={`documents__progress-bar${
                      videoProgress.percent == null ? ' documents__progress-bar--indeterminate' : ''
                    }`}
                  >
                    <div
                      className="documents__progress-fill"
                      style={{
                        width:
                          videoProgress.percent == null ? undefined : `${videoProgress.percent}%`,
                      }}
                    />
                  </div>
                  <p className="documents__progress-label">
                    {videoProgress.filename}: {videoProgress.status}
                  </p>
                </div>
              )}
            </div>
          </section>

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
        </>
      )}

      {!isAdmin && (
        <p className="documents__readonly-hint">
          Tylko administrator może dodawać i usuwać pliki źródłowe. Poniżej lista materiałów.
        </p>
      )}

      {isAdmin && videoJobs.length > 0 && (
        <section className="panel documents__panel">
          <h2 className="panel__title">Zadania ingest wideo</h2>
          <table className="documents__table">
            <thead>
              <tr>
                <th>Plik</th>
                <th>Status</th>
                <th>Postęp</th>
                <th>Chunków</th>
                <th>Utworzono</th>
              </tr>
            </thead>
            <tbody>
              {videoJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.originalFilename}</td>
                  <td>
                    <span
                      className={`documents__badge documents__badge--${
                        job.status === 'done'
                          ? 'indexed'
                          : job.status === 'failed'
                            ? 'failed'
                            : 'processing'
                      }`}
                    >
                      {formatVideoStatus(job.status)}
                    </span>
                    {job.errorMessage && (
                      <span className="documents__dropzone-hint" title={job.errorMessage}>
                        {' '}
                        — {job.errorMessage.slice(0, 80)}
                      </span>
                    )}
                  </td>
                  <td>{job.progress}%</td>
                  <td>{job.chunkCount ?? '—'}</td>
                  <td>{formatDate(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
