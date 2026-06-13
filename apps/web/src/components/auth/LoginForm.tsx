import { useState } from 'react';
import { APP_NAME } from '@teta/shared';
import type { LoginRequest, LoginResponse } from '@teta/shared';
import '../oracle/oracle-setup.css';

type LoginFormProps = {
  onSuccess: (response: LoginResponse) => void;
  onOpenOracleRecovery?: () => void;
};

export function LoginForm({ onSuccess, onOpenOracleRecovery }: LoginFormProps) {
  const [form, setForm] = useState<LoginRequest>({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
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
      onSuccess(data as LoginResponse);
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
