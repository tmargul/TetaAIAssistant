import type { AuthUser } from '@teta/shared';
import { useAuth } from '../../context/AuthContext';
import { useSystemHealth } from '../../hooks/useSystemHealth';
import { IconBell } from './icons';
import './layout.css';

type HeaderProps = {
  title: string;
  subtitle?: string;
};

function AppModeBadge() {
  const { health } = useSystemHealth();

  if (!health) {
    return null;
  }

  if (health.appMode === 'vendor') {
    const label = health.vendorEnabled ? 'Vendor' : 'Vendor (nieaktywny)';
    const className = health.vendorEnabled
      ? 'header__mode-badge header__mode-badge--vendor'
      : 'header__mode-badge header__mode-badge--vendor-off';

    return <span className={className}>{label}</span>;
  }

  return <span className="header__mode-badge header__mode-badge--client">Client</span>;
}

function HeaderUser({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  const initials = user.displayName?.[0] ?? user.oracleUsername[0]?.toUpperCase() ?? 'U';

  return (
    <div className="header__actions">
      <button type="button" className="header__icon-btn" aria-label="Powiadomienia">
        <IconBell className="header__icon" />
      </button>
      <div className="header__user">
        <div className="header__avatar">{initials}</div>
        <div className="header__user-info">
          <span className="header__user-name">
            {user.displayName ?? user.oracleUsername}
          </span>
          <span className="header__user-role">
            {user.role === 'admin' ? 'Administrator' : 'Użytkownik'}
          </span>
        </div>
      </div>
      <button type="button" className="header__logout-btn" onClick={logout}>
        Wyloguj
      </button>
    </div>
  );
}

export function Header({ title, subtitle }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="header">
      <div>
        <div className="header__title-row">
          <h1 className="header__title">{title}</h1>
          <AppModeBadge />
        </div>
        {subtitle && <p className="header__subtitle">{subtitle}</p>}
      </div>

      {user && <HeaderUser user={user} />}
    </header>
  );
}
