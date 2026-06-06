import { useEffect, useState } from 'react';
import { APP_NAME } from '@teta/shared';
import type {
  OracleConnectionInput,
  OracleConnectionMode,
  OracleIdentifierType,
  OracleTestConnectionResponse,
  TnsEntry,
  TnsListResponse,
} from '@teta/shared';
import './oracle-setup.css';

type OracleConnectionFormProps = {
  onConfigured: () => void;
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

export function OracleConnectionForm({ onConfigured }: OracleConnectionFormProps) {
  const [mode, setMode] = useState<OracleConnectionMode>('basic');
  const [form, setForm] = useState(EMPTY_FORM);
  const [tnsEntries, setTnsEntries] = useState<TnsEntry[]>([]);
  const [tnsSource, setTnsSource] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<OracleTestConnectionResponse | null>(null);

  useEffect(() => {
    fetch('/api/oracle/tns')
      .then(async (res) => {
        if (!res.ok) throw new Error('Nie udało się wczytać listy TNS.');
        return res.json() as Promise<TnsListResponse>;
      })
      .then((data) => {
        setTnsEntries(data.entries);
        setTnsSource(data.source);
        if (data.entries.length > 0) {
          setForm((prev) => ({ ...prev, tnsAlias: data.entries[0].alias }));
        }
      })
      .catch(() => {
        setTnsEntries([]);
      });
  }, []);

  const buildPayload = (): OracleConnectionInput => ({
    ...form,
    mode,
  });

  const update = <K extends keyof OracleConnectionInput>(key: K, value: OracleConnectionInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/oracle/test', {
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
      const res = await fetch('/api/oracle/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const err = (await res.json()) as { message?: string | string[] };
        const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
        setTestResult({ success: false, message: msg ?? 'Nie udało się zapisać konfiguracji.' });
        return;
      }
      onConfigured();
    } catch {
      setTestResult({ success: false, message: 'Błąd połączenia z API.' });
    } finally {
      setSaving(false);
    }
  };

  const busy = testing || saving;

  return (
    <div className="oracle-setup">
      <div className="oracle-setup__card">
        <div className="oracle-setup__header">
          <div className="oracle-setup__logo">T</div>
          <h1 className="oracle-setup__title">Połączenie z bazą Oracle Teta</h1>
          <p className="oracle-setup__desc">
            Skonfiguruj połączenie z bazą danych Teta, aby uruchomić {APP_NAME}. Dane zostaną
            zapisane lokalnie w bazie SQLite aplikacji.
          </p>
        </div>

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
              <select
                id="tnsAlias"
                className="oracle-setup__select"
                value={form.tnsAlias ?? ''}
                onChange={(e) => update('tnsAlias', e.target.value)}
                disabled={tnsEntries.length === 0}
              >
                {tnsEntries.length === 0 ? (
                  <option value="">Brak wpisów w tnsnames.ora</option>
                ) : (
                  tnsEntries.map((entry) => (
                    <option key={entry.alias} value={entry.alias}>
                      {entry.alias}
                      {entry.host ? ` — ${entry.host}:${entry.port ?? 1521}` : ''}
                    </option>
                  ))
                )}
              </select>
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
              Login
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
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
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
              {saving ? 'Zapisywanie…' : 'Zapisz i kontynuuj'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
