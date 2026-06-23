import { useEffect, useState } from 'react';
import { APP_NAME } from '@teta/shared';
import { CustomSelect } from '../ui/CustomSelect';
import { authFetch } from '../../lib/auth-storage';
import type {
  OracleConnectionInput,
  OracleConnectionMode,
  OracleConnectionStatusResponse,
  OracleIdentifierType,
  OracleTestConnectionResponse,
  TetaOracleBackendMode,
  TnsEntry,
  TnsListResponse,
} from '@teta/shared';
import './oracle-setup.css';

type OracleConnectionFormProps = {
  variant?: 'setup' | 'settings' | 'recovery';
  onConfigured?: () => void;
  onSaved?: (status: OracleConnectionStatusResponse) => void;
  onCancel?: () => void;
};

const EMPTY_FORM: OracleConnectionInput = {
  mode: 'basic',
  host: '',
  port: 1521,
  identifierType: 'sid',
  identifier: '',
  tnsAlias: '',
  username: '',
  password: '',
};

export function OracleConnectionForm({
  variant = 'setup',
  onConfigured,
  onSaved,
  onCancel,
}: OracleConnectionFormProps) {
  const isSettings = variant === 'settings';
  const isRecovery = variant === 'recovery';
  const isEmbedded = isSettings;
  const [mode, setMode] = useState<OracleConnectionMode>('basic');
  const [form, setForm] = useState(EMPTY_FORM);
  const [tnsEntries, setTnsEntries] = useState<TnsEntry[]>([]);
  const [tnsSource, setTnsSource] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<OracleTestConnectionResponse | null>(null);
  const [backendMode, setBackendMode] = useState<TetaOracleBackendMode>('fake');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const apiFetch = isSettings ? authFetch : fetch;

  const configHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isRecovery) {
      headers['X-Teta-Oracle-Recovery'] = '1';
    }
    return headers;
  };

  useEffect(() => {
    apiFetch('/api/oracle/status')
      .then(async (res) => res.json() as Promise<OracleConnectionStatusResponse>)
      .then((status) => {
        setBackendMode(status.backendMode);
        if (status.config) {
          const { updatedAt, ...config } = status.config;
          setMode(config.mode);
          setForm({
            ...config,
            password: '',
          });
          setLastUpdatedAt(updatedAt);
        } else if (status.backendMode === 'fake') {
          const admin = status.fakeLoginHint?.adminUsername ?? 'teta_admin';
          setForm((prev) => ({
            ...prev,
            host: '192.168.1.10',
            identifier: 'TETA',
            username: admin,
            password: 'admin',
          }));
        }
      })
      .catch(() => setBackendMode('fake'));
  }, [isSettings, isRecovery]);

  useEffect(() => {
    fetch('/api/oracle/tns')
      .then(async (res) => {
        if (!res.ok) throw new Error('Nie udało się wczytać listy TNS.');
        return res.json() as Promise<TnsListResponse>;
      })
      .then((data) => {
        setTnsEntries(data.entries);
        setTnsSource(data.source);
        if (!isSettings && data.entries.length > 0) {
          setForm((prev) => ({ ...prev, tnsAlias: data.entries[0].alias }));
        }
      })
      .catch(() => {
        setTnsEntries([]);
      });
  }, [isSettings, isRecovery]);

  const buildPayload = (): OracleConnectionInput => {
    const payload: OracleConnectionInput = {
      ...form,
      mode,
    };
    if ((isSettings || isRecovery) && !payload.password?.trim()) {
      delete payload.password;
    }
    return payload;
  };

  const update = <K extends keyof OracleConnectionInput>(key: K, value: OracleConnectionInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/oracle/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = (await res.json()) as OracleTestConnectionResponse | { message: string };
      if ('success' in data) {
        setTestResult(data);
      } else {
        setTestResult({ success: false, message: data.message ?? 'Błąd testu połączenia.' });
      }
    } catch {
      setTestResult({ success: false, message: 'Błąd połączenia z API.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/oracle/config', {
        method: 'POST',
        headers: configHeaders(),
        body: JSON.stringify(buildPayload()),
      });
      const data = (await res.json()) as OracleConnectionStatusResponse | { message?: string | string[] };
      if (!res.ok) {
        const err = data as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
        setTestResult({ success: false, message: msg ?? 'Nie udało się zapisać konfiguracji.' });
        return;
      }
      const status = data as OracleConnectionStatusResponse;
      setLastUpdatedAt(status.config?.updatedAt ?? null);
      setForm((prev) => ({ ...prev, password: '' }));
      setTestResult({ success: true, message: 'Konfiguracja została zapisana.' });
      if (isSettings) {
        onSaved?.(status);
      } else {
        onConfigured?.();
      }
    } catch {
      setTestResult({ success: false, message: 'Błąd połączenia z API.' });
    } finally {
      setSaving(false);
    }
  };

  const busy = testing || saving;

  const connectionSummary =
    isSettings && form.mode === 'basic'
      ? `${form.host ?? '—'}:${form.port ?? 1521} / ${form.identifierType === 'serviceName' ? 'Service' : 'SID'}: ${form.identifier ?? '—'}`
      : isSettings && form.mode === 'tns'
        ? `TNS: ${form.tnsAlias ?? '—'}`
        : null;

  const formContent = (
    <>
      {isSettings && (
        <div className="oracle-setup__status">
          <p>
            <strong>Tryb backendu:</strong> {backendMode === 'real' ? 'Oracle (real)' : 'Symulator (fake)'}
          </p>
          {connectionSummary && (
            <p>
              <strong>Aktualne połączenie:</strong> {connectionSummary}
            </p>
          )}
          {lastUpdatedAt && (
            <p>
              <strong>Ostatnia zmiana:</strong>{' '}
              {new Date(lastUpdatedAt).toLocaleString('pl-PL')}
            </p>
          )}
        </div>
      )}

      {isRecovery && (
        <div className="oracle-setup__banner">
          Popraw parametry połączenia z bazą Oracle, aby móc się zalogować. Po zapisaniu wrócisz do
          ekranu logowania.
        </div>
      )}

      {backendMode === 'fake' && !isSettings && !isRecovery && (
        <div className="oracle-setup__banner">
          <strong>Tryb symulatora (fake)</strong> — bez prawdziwej bazy Oracle. Test połączenia
          zawsze się powiedzie. <strong>Logowanie do aplikacji</strong> (nie to pole poniżej):{' '}
          administrator <code>teta_admin</code> / <code>admin</code>, użytkownik{' '}
          <code>teta_user</code> / <code>user</code>. Przełącz na{' '}
          <code>TETA_ORACLE_MODE=real</code> w <code>.env</code> po podłączeniu VM.
        </div>
      )}

      {backendMode === 'fake' && isSettings && (
        <div className="oracle-setup__banner">
          <strong>Tryb symulatora (fake)</strong> — parametry są zapisywane lokalnie; połączenie z
          prawdziwą bazą Oracle wymaga <code>TETA_ORACLE_MODE=real</code> w pliku <code>.env</code>{' '}
          na serwerze API.
        </div>
      )}

      <div className="oracle-setup__tabs">
        <button
          type="button"
          className={`oracle-setup__tab${mode === 'basic' ? ' oracle-setup__tab--active' : ''}`}
          onClick={() => setMode('basic')}
        >
          Host / Port / SID
        </button>
        <button
          type="button"
          className={`oracle-setup__tab${mode === 'tns' ? ' oracle-setup__tab--active' : ''}`}
          onClick={() => setMode('tns')}
        >
          TNS Names
        </button>
      </div>

      <div className="oracle-setup__form">
        {mode === 'basic' ? (
          <>
            <div className="oracle-setup__row">
              <div className="oracle-setup__field">
                <label className="oracle-setup__label" htmlFor="host">
                  Host / Adres IP
                </label>
                <input
                  id="host"
                  className="oracle-setup__input"
                  value={form.host ?? ''}
                  onChange={(e) => update('host', e.target.value)}
                  placeholder="np. 192.168.1.10"
                  autoComplete="off"
                />
              </div>
              <div className="oracle-setup__field">
                <label className="oracle-setup__label" htmlFor="port">
                  Port
                </label>
                <input
                  id="port"
                  className="oracle-setup__input"
                  type="number"
                  value={form.port ?? 1521}
                  onChange={(e) => update('port', Number(e.target.value))}
                />
              </div>
            </div>

            <div className="oracle-setup__field">
              <span className="oracle-setup__label">Typ połączenia</span>
              <div className="oracle-setup__radios">
                <label className="oracle-setup__radio">
                  <input
                    type="radio"
                    name="identifierType"
                    checked={form.identifierType === 'sid'}
                    onChange={() => update('identifierType', 'sid' as OracleIdentifierType)}
                  />
                  SID
                </label>
                <label className="oracle-setup__radio">
                  <input
                    type="radio"
                    name="identifierType"
                    checked={form.identifierType === 'serviceName'}
                    onChange={() => update('identifierType', 'serviceName' as OracleIdentifierType)}
                  />
                  Service Name
                </label>
              </div>
            </div>

            <div className="oracle-setup__field">
              <label className="oracle-setup__label" htmlFor="identifier">
                {form.identifierType === 'serviceName' ? 'Service Name' : 'SID'}
              </label>
              <input
                id="identifier"
                className="oracle-setup__input"
                value={form.identifier ?? ''}
                onChange={(e) => update('identifier', e.target.value)}
                placeholder={form.identifierType === 'serviceName' ? 'np. TETA' : 'np. ORCL'}
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <div className="oracle-setup__field">
            <label className="oracle-setup__label" htmlFor="tnsAlias">
              Serwer (TNS alias)
            </label>
            <CustomSelect
              id="tnsAlias"
              value={form.tnsAlias ?? ''}
              disabled={tnsEntries.length === 0}
              placeholder="Brak wpisów w tnsnames.ora"
              options={tnsEntries.map((entry) => ({
                value: entry.alias,
                label: `${entry.alias}${entry.host ? ` — ${entry.host}:${entry.port ?? 1521}` : ''}`,
              }))}
              onChange={(alias) => update('tnsAlias', alias)}
            />
            {tnsSource && <p className="oracle-setup__tns-info">Źródło: {tnsSource}</p>}
            {tnsEntries.length === 0 && (
              <p className="oracle-setup__tns-info">
                Nie znaleziono pliku tnsnames.ora. Użyj zakładki Host / Port / SID lub ustaw
                zmienną TNS_ADMIN.
              </p>
            )}
          </div>
        )}

        <div className="oracle-setup__field">
          <label className="oracle-setup__label" htmlFor="username">
            Login (użytkownik techniczny)
          </label>
          <input
            id="username"
            className="oracle-setup__input"
            value={form.username}
            onChange={(e) => update('username', e.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="oracle-setup__field">
          <label className="oracle-setup__label" htmlFor="password">
            Hasło
          </label>
          <input
            id="password"
            className="oracle-setup__input"
            type="password"
            value={form.password ?? ''}
            onChange={(e) => update('password', e.target.value)}
            placeholder={
              isSettings || isRecovery ? 'Pozostaw puste, aby zachować obecne hasło' : undefined
            }
            autoComplete="current-password"
          />
        </div>

        {testResult && (
          <div
            className={`oracle-setup__result${
              testResult.success ? ' oracle-setup__result--ok' : ' oracle-setup__result--error'
            }`}
          >
            {testResult.message}
            {testResult.databaseVersion && (
              <>
                <br />
                <small>{testResult.databaseVersion}</small>
              </>
            )}
          </div>
        )}

        <div className="oracle-setup__actions">
          {isRecovery && onCancel && (
            <button
              type="button"
              className="oracle-setup__btn oracle-setup__btn--secondary"
              onClick={onCancel}
              disabled={busy}
            >
              Anuluj
            </button>
          )}
          <button
            type="button"
            className="oracle-setup__btn oracle-setup__btn--secondary"
            onClick={handleTest}
            disabled={busy}
          >
            {testing ? 'Testowanie…' : 'Testuj połączenie'}
          </button>
          <button
            type="button"
            className="oracle-setup__btn oracle-setup__btn--primary"
            onClick={handleSave}
            disabled={busy}
          >
            {saving
              ? 'Zapisywanie…'
              : isSettings
                ? 'Zapisz zmiany'
                : isRecovery
                  ? 'Zapisz i wróć do logowania'
                  : 'Zapisz i kontynuuj'}
          </button>
        </div>
      </div>
    </>
  );

  if (isEmbedded) {
    return <div className="oracle-setup oracle-setup--embedded">{formContent}</div>;
  }

  return (
    <div className="oracle-setup">
      <div className="oracle-setup__card">
        <div className="oracle-setup__header">
          <div className="oracle-setup__logo">T</div>
          <h1 className="oracle-setup__title">
            {isRecovery ? 'Zmiana połączenia Oracle' : 'Połączenie z bazą Oracle Teta'}
          </h1>
          <p className="oracle-setup__desc">
            {isRecovery
              ? `Zaktualizuj parametry bazy Teta, jeśli logowanie do ${APP_NAME} nie działa.`
              : `Skonfiguruj połączenie z bazą danych Teta, aby uruchomić ${APP_NAME}. Dane zostaną zapisane lokalnie w bazie SQLite aplikacji.`}
          </p>
        </div>
        {formContent}
      </div>
    </div>
  );
}
