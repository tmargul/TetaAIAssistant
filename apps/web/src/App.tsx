import { useState } from 'react';
import type { SystemHealthResponse } from '@teta/shared';
import { useSystemHealth } from './hooks/useSystemHealth';
import { ChatView } from './components/chat/ChatView';
import { AppShell } from './components/layout/AppShell';
import { AuthGate } from './components/auth/AuthGate';
import { OracleSetupGate } from './components/oracle/OracleSetupGate';
import { DocumentsView } from './components/documents/DocumentsView';
import { GlobalSourcesView } from './components/global-sources/GlobalSourcesView';
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
    subtitle: 'Baza wiedzy RAG klienta — Qdrant',
  },
  globalSources: {
    title: 'Źródła globalne',
    subtitle: 'Materiały szkoleniowe do globalnego RAG (teta_global)',
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

function serviceLabel(status: 'ok' | 'offline' | 'loading'): string {
  if (status === 'ok') return 'Online';
  if (status === 'offline') return 'Offline';
  return '…';
}

function DashboardView({
  health,
  error,
}: {
  health: SystemHealthResponse | null;
  error: string | null;
}) {
  const apiStatus = error ? 'offline' : health ? 'ok' : 'loading';
  const ollamaStatus = health?.ollama.status ?? 'loading';
  const qdrantStatus = health?.qdrant.status ?? 'loading';

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
            {serviceLabel(apiStatus)}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Tryb aplikacji</p>
          <p className="stat-card__value">
            {health ? (health.appMode === 'vendor' ? 'Vendor' : 'Client') : '…'}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Ollama</p>
          <p
            className={`stat-card__value${
              ollamaStatus === 'ok' ? ' stat-card__value--ok' : ollamaStatus === 'offline' ? ' stat-card__value--error' : ''
            }`}
          >
            {serviceLabel(ollamaStatus)}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Qdrant (RAG)</p>
          <p
            className={`stat-card__value${
              qdrantStatus === 'ok' ? ' stat-card__value--ok' : qdrantStatus === 'offline' ? ' stat-card__value--error' : ''
            }`}
          >
            {serviceLabel(qdrantStatus)}
          </p>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel__title">Status systemu</h2>
        {health && (
          <dl className="data-grid">
            <dt>Status ogólny</dt>
            <dd>{health.status === 'ok' ? 'OK' : 'Ograniczony'}</dd>
            <dt>Tryb</dt>
            <dd>
              {health.appMode === 'vendor' ? 'Vendor (budowa RAG)' : 'Client (wdrożenie)'}
              {health.appMode === 'vendor' && (
                <> — vendor {health.vendorEnabled ? 'aktywny' : 'nieaktywny'}</>
              )}
            </dd>
            <dt>Aplikacja</dt>
            <dd>{health.app}</dd>
            <dt>Wersja</dt>
            <dd>{health.version}</dd>
            <dt>Ollama</dt>
            <dd>
              {health.ollama.status === 'ok'
                ? `Online (${health.ollama.modelCount} modeli)`
                : 'Offline'}
            </dd>
            <dt>Qdrant</dt>
            <dd>
              {health.qdrant.status === 'ok'
                ? `Online — ${health.qdrant.collection}, ${health.qdrant.pointsCount ?? 0} wektorów`
                : 'Offline'}
            </dd>
            <dt>Czas sprawdzenia</dt>
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
          <li>Ollama (Qwen3, DeepSeek-R1, nomic-embed-text)</li>
          <li>Qdrant (RAG globalny + klienta)</li>
          <li>Autoryzacja Oracle + JWT</li>
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
  const { health, error } = useSystemHealth();
  const isVendorMode = health?.appMode === 'vendor' && health?.vendorEnabled;

  const meta = PAGE_META[activeNav];

  return (
    <OracleSetupGate>
      <AuthGate>
      <AppShell
        activeNav={activeNav}
        onNavigate={setActiveNav}
        title={meta.title}
        subtitle={meta.subtitle}
        isVendorMode={isVendorMode}
      >
        {activeNav === 'dashboard' && <DashboardView health={health} error={error} />}
        {activeNav === 'chat' && <ChatView />}
        {activeNav === 'documents' && !isVendorMode && <DocumentsView />}
        {activeNav === 'globalSources' && isVendorMode && <GlobalSourcesView />}
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
