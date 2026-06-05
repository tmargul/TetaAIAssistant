import type { FC } from 'react';
import { APP_NAME } from '@teta/shared';
import {
  IconChat,
  IconDashboard,
  IconDocuments,
  IconHistory,
  IconSettings,
} from './icons';
import './layout.css';

export type NavItem = 'dashboard' | 'chat' | 'documents' | 'history' | 'settings';

const NAV_ITEMS: { id: NavItem; label: string; icon: FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Panel', icon: IconDashboard },
  { id: 'chat', label: 'Asystent AI', icon: IconChat },
  { id: 'documents', label: 'Dokumenty', icon: IconDocuments },
  { id: 'history', label: 'Historia', icon: IconHistory },
  { id: 'settings', label: 'Ustawienia', icon: IconSettings },
];

type SidebarProps = {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
};

export function Sidebar({ active, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__logo">T</div>
        <div>
          <p className="sidebar__title">{APP_NAME}</p>
          <p className="sidebar__subtitle">Intranet AI</p>
        </div>
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar__link${active === id ? ' sidebar__link--active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon className="sidebar__icon" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <span className="sidebar__status-dot" />
        System intranetowy
      </div>
    </aside>
  );
}
