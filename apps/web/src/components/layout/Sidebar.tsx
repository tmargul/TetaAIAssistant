import type { FC } from 'react';
import { APP_NAME } from '@teta/shared';
import {
  IconChat,
  IconDashboard,
  IconDatabase,
  IconDoctor,
  IconDocuments,
  IconHistory,
  IconSettings,
  IconWizard,
} from './icons';
import './layout.css';

export type NavItem =
  | 'dashboard'
  | 'doctor'
  | 'chat'
  | 'documents'
  | 'globalSources'
  | 'oracleMetadata'
  | 'vendorWizard'
  | 'history'
  | 'settings';

const BASE_NAV_ITEMS: {
  id: NavItem;
  label: string;
  icon: FC<{ className?: string }>;
  vendorOnly?: boolean;
  clientOnly?: boolean;
}[] = [
  { id: 'dashboard', label: 'Panel', icon: IconDashboard },
  { id: 'doctor', label: 'AIA Doctor', icon: IconDoctor },
  { id: 'chat', label: 'Asystent AI', icon: IconChat },
  { id: 'history', label: 'Historia', icon: IconHistory },
  { id: 'vendorWizard', label: 'Kreator wiedzy', icon: IconWizard, vendorOnly: true },
  { id: 'globalSources', label: 'Źródła globalne', icon: IconDocuments, vendorOnly: true },
  { id: 'oracleMetadata', label: 'Metadane Oracle', icon: IconDatabase, vendorOnly: true },
  { id: 'documents', label: 'Dokumenty', icon: IconDocuments, clientOnly: true },
  { id: 'settings', label: 'Ustawienia', icon: IconSettings },
];

type SidebarProps = {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  isVendorMode?: boolean;
};

export function Sidebar({ active, onNavigate, isVendorMode = false }: SidebarProps) {
  const navItems = BASE_NAV_ITEMS.filter((item) => {
    if (item.vendorOnly) return isVendorMode;
    if (item.clientOnly) return !isVendorMode;
    return true;
  });
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
        {navItems.map(({ id, label, icon: Icon }) => (
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
