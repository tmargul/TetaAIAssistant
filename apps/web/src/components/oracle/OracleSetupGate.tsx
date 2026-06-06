import { useEffect, useState, type ReactNode } from 'react';
import type { OracleConnectionStatusResponse } from '@teta/shared';
import { OracleConnectionForm } from './OracleConnectionForm';
import './oracle-setup.css';

type OracleSetupGateProps = {
  children: ReactNode;
};

export function OracleSetupGate({ children }: OracleSetupGateProps) {
  const [status, setStatus] = useState<'loading' | 'configured' | 'not_configured'>('loading');

  useEffect(() => {
    fetch('/api/oracle/status')
      .then(async (res) => {
        if (!res.ok) throw new Error('HTTP error');
        return res.json() as Promise<OracleConnectionStatusResponse>;
      })
      .then((data) => setStatus(data.configured ? 'configured' : 'not_configured'))
      .catch(() => setStatus('not_configured'));
  }, []);

  if (status === 'loading') {
    return <div className="oracle-setup__loading">Sprawdzanie konfiguracji Oracle…</div>;
  }

  if (status === 'not_configured') {
    return <OracleConnectionForm onConfigured={() => setStatus('configured')} />;
  }

  return <>{children}</>;
}
