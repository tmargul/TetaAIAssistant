import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/auth-storage';
import { useAuth } from '../../context/AuthContext';
import { useSystemHealth } from '../../hooks/useSystemHealth';

type ActiveSnapshot = {
  snapshotId: string;
  status: string;
  importedAt: string;
  reportGeneratedAt: string | null;
  kpVersion: string | null;
  paVersion: string | null;
  fileSha256: string;
  summary: {
    componentCount: number;
    directDependencyCount: number;
    unparsedRecordCount: number;
    warningCount: number;
  };
};

export function PayrollParameterSnapshotPanel() {
  const { user } = useAuth();
  const { health } = useSystemHealth();
  const isVendorMode = health?.appMode === 'vendor' && health?.vendorEnabled;
  const [active, setActive] = useState<ActiveSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    const res = await authFetch('/api/payroll-parameter-snapshots/active');
    if (!res.ok) {
      setError('Nie udało się pobrać statusu snapshotu parametrów płacowych.');
      return;
    }
    const data = await res.json();
    setActive(data.active ?? null);
  };

  useEffect(() => {
    load().catch(() => setError('Nie udało się pobrać statusu snapshotu.'));
  }, []);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await authFetch('/api/payroll-parameter-snapshots/import', {
        method: 'POST',
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          Array.isArray(data.message)
            ? data.message.join(', ')
            : data.errors?.join?.(', ') || data.message || 'Import odrzucony',
        );
        return;
      }
      setMessage(
        data.status === 'already_imported'
          ? 'Ten raport był już zaimportowany (idempotentnie).'
          : data.status === 'older_report_requires_activation'
            ? 'Zaimportowano starszy raport jako nieaktywny — wymagana jawna aktywacja.'
            : 'Snapshot parametrów płacowych załadowany.',
      );
      await load();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">Parametryzacja płac</h2>
      <p className="settings-panel__desc">
        W Teta wybierz: <strong>Wydruki → Płace → Wydruk parametrów płacowych</strong>. Wygeneruj
        raport i zapisz go w formacie RTF.
      </p>

      {!active ? (
        <p>Brak aktywnego snapshotu parametrów płacowych.</p>
      ) : (
        <ul className="settings-panel__list">
          <li>Status: {active.status}</li>
          <li>Data raportu: {active.reportGeneratedAt ?? 'nierozpoznana'}</li>
          <li>Data importu: {active.importedAt}</li>
          <li>KP / PA: {active.kpVersion ?? '—'} / {active.paVersion ?? '—'}</li>
          <li>Składniki: {active.summary.componentCount}</li>
          <li>Zależności: {active.summary.directDependencyCount}</li>
          <li>Nierozpoznane rekordy: {active.summary.unparsedRecordCount}</li>
          <li>Ostrzeżenia: {active.summary.warningCount}</li>
          <li>SHA: {active.fileSha256.slice(0, 16)}…</li>
        </ul>
      )}

      {(user?.role === 'admin' || isVendorMode) ? (
        <div className="settings-panel__actions">
          <label className="settings-panel__file">
            {uploading ? 'Wczytywanie…' : active ? 'Załaduj nowszy raport RTF' : 'Załaduj raport RTF'}
            <input
              type="file"
              accept=".rtf,application/rtf,text/rtf"
              disabled={uploading}
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      ) : (
        <p className="settings-panel__hint">
          Upload raportu RTF jest dostępny dla administratora / trybu vendor. Przekaż plik
          administratorowi AIA.
        </p>
      )}

      {message && <p className="settings-panel__ok">{message}</p>}
      {error && <p className="settings-panel__error">{error}</p>}
    </div>
  );
}
