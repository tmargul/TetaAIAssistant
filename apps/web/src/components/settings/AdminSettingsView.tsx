import { useEffect, useState } from 'react';
import type { AppUserRecord, CreateTetaServerRequest, TetaServer } from '@teta/shared';
import { useAuth } from '../../context/AuthContext';
import { useSystemHealth } from '../../hooks/useSystemHealth';
import { authFetch } from '../../lib/auth-storage';
import { VendorPackagesPanel } from './VendorPackagesPanel';
import { ClientUpdatesPanel } from './ClientUpdatesPanel';
import { OracleConnectionForm } from '../oracle/OracleConnectionForm';
import './settings.css';

type SettingsTab = 'users' | 'servers' | 'oracle' | 'packages' | 'updates';

const SETTINGS_TAB_KEY = 'teta-settings-tab';

export function AdminSettingsView() {
  const { user } = useAuth();
  const { health } = useSystemHealth();
  const isVendorMode = health?.appMode === 'vendor' && health?.vendorEnabled;
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const pending = sessionStorage.getItem(SETTINGS_TAB_KEY) as SettingsTab | null;
    if (pending && ['users', 'servers', 'oracle', 'packages', 'updates'].includes(pending)) {
      sessionStorage.removeItem(SETTINGS_TAB_KEY);
      return pending;
    }
    return 'users';
  });
  const [users, setUsers] = useState<AppUserRecord[]>([]);
  const [servers, setServers] = useState<TetaServer[]>([]);
  const [grantUsername, setGrantUsername] = useState('');
  const [grantDisplayName, setGrantDisplayName] = useState('');
  const [newServer, setNewServer] = useState<CreateTetaServerRequest>({ name: '', description: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    const [usersRes, serversRes] = await Promise.all([
      authFetch('/api/admin/users'),
      authFetch('/api/admin/teta-servers'),
    ]);
    if (usersRes.ok) setUsers(await usersRes.json());
    if (serversRes.ok) setServers(await serversRes.json());
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      loadData().catch(() => setError('Nie udało się wczytać ustawień administracyjnych.'));
    }
  }, [user?.role]);

  if (user?.role !== 'admin') {
    return (
      <div className="placeholder-view">
        <p className="placeholder-view__title">Ustawienia</p>
        <p className="placeholder-view__desc">
          Ta sekcja jest dostępna tylko dla administratora aplikacji.
        </p>
      </div>
    );
  }

  const handleGrant = async () => {
    setMessage(null);
    setError(null);
    const res = await authFetch('/api/admin/users/grant', {
      method: 'POST',
      body: JSON.stringify({
        oracleUsername: grantUsername,
        displayName: grantDisplayName || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(Array.isArray(data.message) ? data.message.join(', ') : data.message);
      return;
    }
    setGrantUsername('');
    setGrantDisplayName('');
    setMessage(`Przyznano dostęp użytkownikowi ${data.oracleUsername}.`);
    await loadData();
  };

  const handleRevoke = async (id: number) => {
    setMessage(null);
    setError(null);
    const res = await authFetch(`/api/admin/users/${id}/revoke`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      setError(Array.isArray(data.message) ? data.message.join(', ') : data.message);
      return;
    }
    setMessage('Odebrano dostęp użytkownikowi.');
    await loadData();
  };

  const handleAddServer = async () => {
    setMessage(null);
    setError(null);
    const res = await authFetch('/api/admin/teta-servers', {
      method: 'POST',
      body: JSON.stringify(newServer),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(Array.isArray(data.message) ? data.message.join(', ') : data.message);
      return;
    }
    setNewServer({ name: '', description: '' });
    setMessage(`Dodano serwer Teta: ${data.name}.`);
    await loadData();
  };

  const toggleServer = async (server: TetaServer) => {
    setMessage(null);
    setError(null);
    await authFetch(`/api/admin/teta-servers/${server.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: !server.isEnabled }),
    });
    await loadData();
  };

  return (
    <div className="settings">
      {message && <div className="settings__message settings__message--ok">{message}</div>}
      {error && <div className="settings__message settings__message--error">{error}</div>}

      <div className="settings__tabs">
        <button
          type="button"
          className={`settings__tab${activeTab === 'users' ? ' settings__tab--active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Użytkownicy aplikacji
        </button>
        <button
          type="button"
          className={`settings__tab${activeTab === 'servers' ? ' settings__tab--active' : ''}`}
          onClick={() => setActiveTab('servers')}
        >
          Serwery dostępne dla użytkowników
        </button>
        <button
          type="button"
          className={`settings__tab${activeTab === 'oracle' ? ' settings__tab--active' : ''}`}
          onClick={() => setActiveTab('oracle')}
        >
          Połączenie Oracle
        </button>
        {isVendorMode && (
          <button
            type="button"
            className={`settings__tab${activeTab === 'packages' ? ' settings__tab--active' : ''}`}
            onClick={() => setActiveTab('packages')}
          >
            Paczki wdrożeniowe
          </button>
        )}
        {!isVendorMode && (
          <button
            type="button"
            className={`settings__tab${activeTab === 'updates' ? ' settings__tab--active' : ''}`}
            onClick={() => setActiveTab('updates')}
          >
            Aktualizacje
          </button>
        )}
      </div>

      <section className="panel settings__panel">
        {activeTab === 'users' && (
          <>
            <h2 className="panel__title">Użytkownicy aplikacji</h2>
            <p className="settings__hint">
              Użytkownicy logują się kontem Oracle. Administrator nadaje dostęp wpisując login
              Oracle.
            </p>

            <div className="settings__grant-form">
              <input
                className="settings__input"
                placeholder="Login Oracle"
                value={grantUsername}
                onChange={(e) => setGrantUsername(e.target.value)}
              />
              <input
                className="settings__input"
                placeholder="Nazwa wyświetlana (opcjonalnie)"
                value={grantDisplayName}
                onChange={(e) => setGrantDisplayName(e.target.value)}
              />
              <button
                type="button"
                className="settings__btn"
                onClick={handleGrant}
                disabled={!grantUsername.trim()}
              >
                Przyznaj dostęp
              </button>
            </div>

            <table className="settings__table">
              <thead>
                <tr>
                  <th>Login Oracle</th>
                  <th>Rola</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.oracleUsername}</td>
                    <td>{u.role === 'admin' ? 'Administrator' : 'Użytkownik'}</td>
                    <td>
                      <span
                        className={`settings__badge${
                          u.isActive ? ' settings__badge--ok' : ' settings__badge--off'
                        }`}
                      >
                        {u.isActive ? 'Aktywny' : 'Zablokowany'}
                      </span>
                    </td>
                    <td>
                      {u.role !== 'admin' && u.isActive && (
                        <button
                          type="button"
                          className="settings__link-btn"
                          onClick={() => handleRevoke(u.id)}
                        >
                          Odbierz dostęp
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="settings__empty">
                      Brak użytkowników z dostępem do aplikacji.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {activeTab === 'packages' && isVendorMode && <VendorPackagesPanel />}

        {activeTab === 'updates' && !isVendorMode && <ClientUpdatesPanel />}

        {activeTab === 'oracle' && (
          <>
            <h2 className="panel__title">Połączenie z bazą Oracle</h2>
            <p className="settings__hint">
              Parametry połączenia z bazą Teta (host, SID, login techniczny). Administrator może je
              zmienić w każdej chwili — np. przejść z symulatora (fake) na prawdziwy serwer klienta.
              Zmiany są zapisywane lokalnie i wymagają pomyślnego testu połączenia. Hasło można
              pozostawić puste, aby zachować dotychczasowe.
            </p>
            <OracleConnectionForm
              variant="settings"
              onSaved={() => setMessage('Zaktualizowano konfigurację połączenia Oracle.')}
            />
          </>
        )}

        {activeTab === 'servers' && (
          <>
            <h2 className="panel__title">Serwery dostępne dla użytkowników</h2>
            <p className="settings__hint">
              Lista serwerów Teta widoczna dla zwykłych użytkowników (np. przy wyborze środowiska).
            </p>

            <div className="settings__grant-form">
              <input
                className="settings__input"
                placeholder="Nazwa serwera"
                value={newServer.name}
                onChange={(e) => setNewServer((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="settings__input"
                placeholder="Opis (opcjonalnie)"
                value={newServer.description ?? ''}
                onChange={(e) => setNewServer((prev) => ({ ...prev, description: e.target.value }))}
              />
              <button
                type="button"
                className="settings__btn"
                onClick={handleAddServer}
                disabled={!newServer.name.trim()}
              >
                Dodaj serwer
              </button>
            </div>

            <table className="settings__table">
              <thead>
                <tr>
                  <th>Nazwa</th>
                  <th>Opis</th>
                  <th>Dostępny</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.description ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className={`settings__toggle${s.isEnabled ? ' settings__toggle--on' : ''}`}
                        onClick={() => toggleServer(s)}
                      >
                        {s.isEnabled ? 'Tak' : 'Nie'}
                      </button>
                    </td>
                  </tr>
                ))}
                {servers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="settings__empty">
                      Brak zdefiniowanych serwerów Teta.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
