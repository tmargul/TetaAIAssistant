import { useEffect, useState } from 'react';
import { APP_NAME, type HealthResponse } from '@teta/shared';
import './App.css';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then(setHealth)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Błąd połączenia z API');
      });
  }, []);

  return (
    <main className="layout">
      <header>
        <h1>{APP_NAME}</h1>
        <p className="subtitle">Intranetowy asystent AI — szkielet monorepo</p>
      </header>

      <section className="card">
        <h2>Status API</h2>
        {health && (
          <dl>
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Wersja</dt>
            <dd>{health.version}</dd>
            <dt>Czas</dt>
            <dd>{health.timestamp}</dd>
          </dl>
        )}
        {error && <p className="error">{error}</p>}
        {!health && !error && <p>Łączenie z API…</p>}
      </section>

      <section className="card muted">
        <h2>Stack (planowany)</h2>
        <ul>
          <li>React + NestJS + SQLite</li>
          <li>Ollama (Qwen3, DeepSeek-R1)</li>
          <li>Qdrant (RAG) + JWT</li>
        </ul>
      </section>
    </main>
  );
}
