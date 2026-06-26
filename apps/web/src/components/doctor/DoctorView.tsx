import { useCallback, useEffect, useState } from 'react';
import type { DoctorCheck, DoctorReport, DoctorRepairResult } from '@teta/shared';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../lib/auth-storage';
import './doctor.css';

function statusIcon(status: DoctorCheck['status']): string {
  switch (status) {
    case 'ok':
      return '✔';
    case 'warning':
      return '⚠';
    case 'error':
      return '✖';
    default:
      return '–';
  }
}

function overallLabel(overall: DoctorReport['overall']): string {
  switch (overall) {
    case 'ok':
      return 'Środowisko gotowe';
    case 'warning':
      return 'Wymaga uwagi';
    default:
      return 'Wykryto problemy';
  }
}

export function DoctorView() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairResult, setRepairResult] = useState<DoctorRepairResult | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/doctor');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport((await res.json()) as DoctorReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się uruchomić diagnostyki.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleRepair = async () => {
    setRepairing(true);
    setRepairResult(null);
    setError(null);
    try {
      const res = await authFetch('/api/doctor/repair', { method: 'POST' });
      const body = (await res.json()) as DoctorRepairResult | { message?: string };
      if (!res.ok) {
        throw new Error('message' in body && body.message ? body.message : `HTTP ${res.status}`);
      }
      setRepairResult(body as DoctorRepairResult);
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Naprawa środowiska nie powiodła się.');
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="doctor">
      <section className="panel doctor__panel">
        <div className="doctor__header">
          <div>
            <h2 className="panel__title doctor__title">AI Doctor</h2>
            <p className="doctor__subtitle">
              Diagnostyka Ollama, Qdrant, embeddingów, bazy wiedzy i serwera HTTP.
            </p>
          </div>
          <button type="button" className="doctor__refresh-btn" onClick={() => void loadReport()} disabled={loading}>
            {loading ? 'Sprawdzam…' : 'Odśwież'}
          </button>
        </div>

        {error && <div className="doctor__error">{error}</div>}

        {report && (
          <>
            <p className={`doctor__overall doctor__overall--${report.overall}`}>
              {overallLabel(report.overall)}
              <span className="doctor__timestamp">
                {new Date(report.checkedAt).toLocaleString('pl-PL')}
              </span>
            </p>

            <ul className="doctor__checks">
              {report.checks.map((check) => (
                <li key={check.id} className={`doctor__check doctor__check--${check.status}`}>
                  <span className="doctor__check-icon" aria-hidden>
                    {statusIcon(check.status)}
                  </span>
                  <div className="doctor__check-body">
                    <strong>{check.label}</strong>
                    <span>{check.message}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {isAdmin && report?.repairAvailable && (
          <div className="doctor__actions">
            <button
              type="button"
              className="doctor__repair-btn"
              onClick={() => void handleRepair()}
              disabled={repairing || loading}
            >
              {repairing ? 'Naprawiam środowisko…' : 'Napraw środowisko'}
            </button>
            <p className="doctor__actions-hint">
              Restartuje usługę Windows <code>TetaAI-Qdrant</code> i weryfikuje połączenie z bazą wektorową.
            </p>
          </div>
        )}

        {!isAdmin && report?.repairAvailable && (
          <p className="doctor__actions-hint">Naprawa środowiska wymaga uprawnień administratora.</p>
        )}

        {repairResult && (
          <div className={`doctor__repair-result${repairResult.success ? '' : ' doctor__repair-result--error'}`}>
            <p>{repairResult.message}</p>
            {repairResult.actions.length > 0 && (
              <ul>
                {repairResult.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
