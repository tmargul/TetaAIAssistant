import { useEffect, useState, type ReactNode } from 'react';
import type { AuthSetupStatusResponse, LoginResponse } from '@teta/shared';
import { AuthProvider } from '../../context/AuthContext';
import { authFetch, setAccessToken } from '../../lib/auth-storage';
import { AdminBootstrapForm } from './AdminBootstrapForm';
import { LoginForm } from './LoginForm';
import '../oracle/oracle-setup.css';

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthSetupStatusResponse | null>(null);

  const refreshStatus = () => {
    authFetch('/api/auth/setup-status')
      .then(async (res) => {
        if (!res.ok) throw new Error('HTTP error');
        return res.json() as Promise<AuthSetupStatusResponse>;
      })
      .then(setStatus)
      .catch(() =>
        setStatus({
          oracleConfigured: true,
          adminBootstrapped: false,
          authenticated: false,
        }),
      );
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  if (!status) {
    return <div className="oracle-setup__loading">Sprawdzanie sesji…</div>;
  }

  const handleAuthSuccess = (response: LoginResponse) => {
    setAccessToken(response.accessToken);
    setStatus({
      oracleConfigured: status.oracleConfigured,
      adminBootstrapped: true,
      authenticated: true,
      user: response.user,
    });
  };

  if (!status.adminBootstrapped) {
    return <AdminBootstrapForm onSuccess={handleAuthSuccess} />;
  }

  if (!status.authenticated || !status.user) {
    return <LoginForm onSuccess={handleAuthSuccess} />;
  }

  return <AuthProvider initialUser={status.user}>{children}</AuthProvider>;
}
