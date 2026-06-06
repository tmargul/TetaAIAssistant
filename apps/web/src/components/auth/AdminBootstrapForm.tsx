import { useState } from 'react';
import { APP_NAME } from '@teta/shared';
import type { LoginRequest, LoginResponse } from '@teta/shared';
import '../oracle/oracle-setup.css';

type AdminBootstrapFormProps = {
  onSuccess: (response: LoginResponse) => void;
};

export function AdminBootstrapForm({ onSuccess }: AdminBootstrapFormProps) {
  const [form, setForm] = useState<LoginRequest>({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/bootstrap-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = Array.isArray(data.message) ? data.message.join(', ') : data.message;
        setError(msg ?? 'Rejestracja administratora nie powiodła się.');
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
          <h1 className="oracle-setup__title">Rejestracja administratora</h1>
          <p className="oracle-setup__desc">
            Pierwsze logowanie musi być wykonane na koncie <strong>administratora Teta</strong>.
            Konto zostanie zapisane w bazie {APP_NAME} i będzie mogło nadawać dostępy innym
            użytkownikom oraz zarządzać ustawieniami aplikacji.
          </p>
        </div>

        <div className="oracle-setup__form">
          <div className="oracle-setup__field">
            <label className="oracle-setup__label" htmlFor="admin-username">
              Login Oracle (administrator Teta)
            </label>
            <input
              id="admin-username"
              className="oracle-setup__input"
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              autoComplete="username"
            />
          </div>

          <div className="oracle-setup__field">
            <label className="oracle-setup__label" htmlFor="admin-password">
              Hasło
            </label>
            <input
              id="admin-password"
              className="oracle-setup__input"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              autoComplete="current-password"
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
              {loading ? 'Weryfikacja…' : 'Zarejestruj administratora'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
