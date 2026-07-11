import { useEffect, useState } from 'react';
import { APP_NAME, type AppMode, type LoginRequest, type LoginResponse, type OracleConnectionStatusResponse, type SystemHealthResponse } from '@teta/shared';
import { fetchWithRetry } from '../../lib/api-fetch';
import { getStoredWorkMode } from '../../lib/work-mode-storage';
import { WorkModeSelect } from './WorkModeSelect';
import '../oracle/oracle-setup.css';

type LoginFormProps = {
  onSuccess: (response: LoginResponse, workMode?: AppMode) => void;
  onOpenOracleRecovery?: () => void;
};

export function LoginForm({ onSuccess, onOpenOracleRecovery }: LoginFormProps) {
  const [form, setForm] = useState<LoginRequest>({ username: '', password: '' });
  const [workMode, setWorkMode] = useState<AppMode>(() => getStoredWorkMode());
  const [workModeSelectable, setWorkModeSelectable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFakeMode, setIsFakeMode] = useState(false);
  const [fakeUser, setFakeUser] = useState('teta_user');

  useEffect(() => {
    fetchWithRetry('/api/health/system')
      .then(async (res) => res.json() as Promise<SystemHealthResponse>)
      .then((health) => {
        setWorkModeSelectable(health.workModeSelectable);
        if (!health.workModeSelectable) {
          setWorkMode('client');
        }
      })
      .catch(() => {
        if (import.meta.env.DEV) {
          setWorkModeSelectable(true);
        }
      });

    fetchWithRetry('/api/oracle/status')
      .then(async (res) => res.json() as Promise<OracleConnectionStatusResponse>)
      .then((status) => {
        const fake = status.backendMode === 'fake';
        setIsFakeMode(fake);
        if (fake) {
          setFakeUser(status.fakeLoginHint?.userUsername ?? 'teta_user');
        }
      })
      .catch(() => undefined);
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithRetry('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
        setError(msg ?? 'Logowanie nie powiodło się.');
        return;
      }
      onSuccess(data as LoginResponse, workModeSelectable ? workMode : undefined);
    } catch {
      setError('Błąd połączenia z API.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="oracle-setup">
      <div className="oracle-setup__card">
        <div className="oracle-setup__header">
          <div className="oracle-setup__logo">T</div>
          <h1 className="oracle-setup__title">Logowanie</h1>
          <p className="oracle-setup__desc">
            Zaloguj się kontem Oracle, które ma dostęp do {APP_NAME}. Jeśli nie masz dostępu,
            skontaktuj się z administratorem Teta.
          </p>
        </div>

        {isFakeMode && (
          <div className="oracle-setup__banner">
            <strong>Tryb symulatora</strong> — logowanie testowe: administrator{' '}
            <code>teta_admin</code> / <code>admin</code>, użytkownik <code>{fakeUser}</code> /{' '}
            <code>user</code> (po nadaniu dostępu przez admina). Hasła w{' '}
            <code>TETA_FAKE_*</code> w <code>apps/api/.env</code>.
          </div>
        )}

        <div className="oracle-setup__form">
          <div className="oracle-setup__field">
            <label className="oracle-setup__label" htmlFor="login-username">
              Login Oracle
            </label>
            <input
              id="login-username"
              className="oracle-setup__input"
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              autoComplete="username"
            />
          </div>

          <div className="oracle-setup__field">
            <label className="oracle-setup__label" htmlFor="login-password">
              Hasło
            </label>
            <input
              id="login-password"
              className="oracle-setup__input"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {workModeSelectable && (
            <WorkModeSelect id="login-work-mode" value={workMode} onChange={setWorkMode} />
          )}

          {error && <div className="oracle-setup__result oracle-setup__result--error">{error}</div>}

          <div className="oracle-setup__actions">
            <button
              type="button"
              className="oracle-setup__btn oracle-setup__btn--primary"
              onClick={handleSubmit}
              disabled={loading || !form.username || !form.password}
            >
              {loading ? 'Logowanie…' : 'Zaloguj się'}
            </button>
          </div>

          {onOpenOracleRecovery && (
            <p className="oracle-setup__footer">
              <button
                type="button"
                className="oracle-setup__link"
                onClick={onOpenOracleRecovery}
              >
                Problemy z logowaniem? Zmień parametry połączenia Oracle
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
