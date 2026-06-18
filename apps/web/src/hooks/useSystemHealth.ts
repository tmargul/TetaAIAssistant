import { useEffect, useState } from 'react';
import type { SystemHealthResponse } from '@teta/shared';
import { fetchWithRetry } from '../lib/api-fetch';

export function useSystemHealth() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithRetry('/api/health/system')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SystemHealthResponse>;
      })
      .then(setHealth)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Błąd połączenia z API');
      });
  }, []);

  return { health, error };
}
