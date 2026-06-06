import { useEffect, useState } from 'react';
import type { HealthResponse } from '@teta/shared';
import { ChatView } from './components/chat/ChatView';
import { AppShell } from './components/layout/AppShell';
import { AuthGate } from './components/auth/AuthGate';
import { OracleSetupGate } from './components/oracle/OracleSetupGate';
import { AdminSettingsView } from './components/settings/AdminSettingsView';
import type { NavItem } from './components/layout/Sidebar';
import './components/layout/layout.css';

const PAGE_META: Record<NavItem, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Panel główny',
    subtitle: 'Przegląd statusu systemu i komponentów',
  },
  chat: {
    title: 'Asystent AI',
    subtitle: 'Rozmowa z modelem lokalnym (Ollama)',
  },
  documents: {
    title: 'Dokumenty',
    subtitle: 'Baza wiedzy RAG — Qdrant',
  },
  history: {
    title: 'Historia',
    subtitle: 'Poprzednie sesje i zapytania',
  },
  settings: {
    title: 'Ustawienia',
    subtitle: 'Konfiguracja aplikacji i konta',
  },
};

function DashboardView({
  health,
  error,
}: {
  health: HealthResponse | null;
  error: string | null;
}) {
  const apiStatus = error ? 'offline' : health ? health.status : 'loading';

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card__label">Status API</p>
          <p
            className={`stat-card__value${
              apiStatus === 'ok' ? ' stat-card__value--ok' : apiStatus === 'offline' ? ' stat-card__value--error' : ''
            }`}
          >
            {apiStatus === 'ok' ? 'Online' : apiStatus === 'offline' ? 'Offline' : '…'}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Wersja</p>
          <p className="stat-card__value">{health?.version ?? '—'}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Ollama</p>
          <p className="stat-card__value">Planowany</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Qdrant (RAG)</p>
          <p className="stat-card__value">Planowany</p>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel__title">Status API</h2>
        {health && (
          <dl className="data-grid">
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Aplikacja</dt>
            <dd>{health.app}</dd>
            <dt>Wersja</dt>
            <dd>{health.version}</dd>
            <dt>Czas</dt>
            <dd>{new Date(health.timestamp).toLocaleString('pl-PL')}</dd>
          </dl>
        )}
        {error && <p style={{ color: 'var(--error)', margin: 0 }}>{error}</p>}
        {!health && !error && <p style={{ color: 'var(--text-muted)', margin: 0 }}>Łączenie z API…</p>}
      </section>

      <section className="panel">
        <h2 className="panel__title">Stack</h2>
        <ul className="panel__list">
          <li>React + NestJS + SQLite</li>
          <li>Ollama (Qwen3, DeepSeek-R1)</li>
          <li>Qdrant (RAG) + JWT</li>
          <li>Autoryzacja domenowa (planowana)</li>
        </ul>
      </section>
    </>
  );
}

function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="placeholder-view">
      <p className="placeholder-view__title">{title}</p>
      <p className="placeholder-view__desc">{description}</p>
    </div>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavItem>('dashboard');
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

  const meta = PAGE_META[activeNav];

  return (
    <OracleSetupGate>
      <AuthGate>
      <AppShell
        activeNav={activeNav}
        onNavigate={setActiveNav}
        title={meta.title}
        subtitle={meta.subtitle}
      >
        {activeNav === 'dashboard' && <DashboardView health={health} error={error} />}
        {activeNav === 'chat' && <ChatView />}
        {activeNav === 'documents' && (
          <PlaceholderView
            title="Dokumenty"
            description="Upload i zarządzanie dokumentami do indeksu RAG (Qdrant)."
          />
        )}
        {activeNav === 'history' && (
          <PlaceholderView
            title="Historia"
            description="Lista poprzednich konwersacji i zapytań do asystenta."
          />
        )}
        {activeNav === 'settings' && <AdminSettingsView />}
      </AppShell>
      </AuthGate>
    </OracleSetupGate>
  );
}
