import type { ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar, type NavItem } from './Sidebar';
import './layout.css';

type AppShellProps = {
  activeNav: NavItem;
  onNavigate: (item: NavItem) => void;
  title: string;
  subtitle?: string;
  isVendorMode?: boolean;
  children: ReactNode;
};

export function AppShell({
  activeNav,
  onNavigate,
  title,
  subtitle,
  isVendorMode,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <Sidebar active={activeNav} onNavigate={onNavigate} isVendorMode={isVendorMode} />
      <div className="app-shell__main">
        <Header title={title} subtitle={subtitle} />
        <div className="app-shell__content">{children}</div>
      </div>
    </div>
  );
}
