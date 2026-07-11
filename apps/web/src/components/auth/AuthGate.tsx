import { useEffect, useState, type ReactNode } from 'react';
import type { AuthSetupStatusResponse, LoginResponse, AppMode } from '@teta/shared';
import { fetchWithRetry } from '../../lib/api-fetch';
import { AuthProvider } from '../../context/AuthContext';
import { setAccessToken } from '../../lib/auth-storage';
import { setStoredWorkMode } from '../../lib/work-mode-storage';
import { AdminBootstrapForm } from './AdminBootstrapForm';
import { LoginForm } from './LoginForm';
import { OracleConnectionForm } from '../oracle/OracleConnectionForm';
import '../oracle/oracle-setup.css';

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthSetupStatusResponse | null>(null);
  const [oracleRecovery, setOracleRecovery] = useState(false);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const refreshStatus = () => {
    setStatusLoading(true);
    setApiUnavailable(false);
    fetchWithRetry('/api/auth/setup-status', undefined, 2)
      .then(async (res) => {
        if (!res.ok) throw new Error('HTTP error');
        return res.json() as Promise<AuthSetupStatusResponse>;
      })
      .then((next) => {
        setStatus(next);
      })
      .catch(() => {
        setStatus(null);
        setApiUnavailable(true);
      })
      .finally(() => {
        setStatusLoading(false);
      });
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  if (statusLoading) {
    return <div className="oracle-setup__loading">Sprawdzanie sesji…</div>;
  }

  if (apiUnavailable || !status) {
    return (
      <div className="oracle-setup">
        <div className="oracle-setup__card">
          <div className="oracle-setup__header">
            <div className="oracle-setup__logo">T</div>
            <h1 className="oracle-setup__title">Backend API niedostępny</h1>
            <p className="oracle-setup__desc">
              Aplikacja webowa działa, ale nie ma połączenia z API na{' '}
              <code>http://localhost:3000</code>. Bez API zobaczysz niewłaściwy ekran logowania
              lub błędy importu.
            </p>
          </div>
          <div className="oracle-setup__banner">
            Uruchom w katalogu projektu: <code>pnpm dev</code> (API + web) albo samo API:{' '}
            <code>pnpm --filter @teta/api dev</code>.
          </div>
          <div className="oracle-setup__actions">
            <button
              type="button"
              className="oracle-setup__btn oracle-setup__btn--primary"
              onClick={() => refreshStatus()}
            >
              Spróbuj ponownie
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleAuthSuccess = (response: LoginResponse, workMode?: AppMode) => {
    if (workMode) {
      setStoredWorkMode(workMode);
    }
    setAccessToken(response.accessToken);
    setStatus({
      oracleConfigured: status.oracleConfigured,
      adminBootstrapped: true,
      authenticated: true,
      user: response.user,
    });
  };

  if (!status.oracleConfigured && !status.adminBootstrapped) {
    return (
      <OracleConnectionForm
        variant="setup"
        onConfigured={() => refreshStatus()}
      />
    );
  }

  if (!status.adminBootstrapped) {
    if (oracleRecovery) {
      return (
        <OracleConnectionForm
          variant="recovery"
          onConfigured={() => setOracleRecovery(false)}
          onCancel={() => setOracleRecovery(false)}
        />
      );
    }
    return <AdminBootstrapForm onSuccess={handleAuthSuccess} onOpenOracleRecovery={() => setOracleRecovery(true)} />;
  }

  if (!status.authenticated || !status.user) {
    if (oracleRecovery) {
      return (
        <OracleConnectionForm
          variant="recovery"
          onConfigured={() => setOracleRecovery(false)}
          onCancel={() => setOracleRecovery(false)}
        />
      );
    }
    return <LoginForm onSuccess={handleAuthSuccess} onOpenOracleRecovery={() => setOracleRecovery(true)} />;
  }

  return <AuthProvider initialUser={status.user}>{children}</AuthProvider>;
}
