import type { AuthUser } from '@teta/shared';
import { useAuth } from '../../context/AuthContext';
import { IconBell } from './icons';
import './layout.css';

type HeaderProps = {
  title: string;
  subtitle?: string;
};

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
        <h1 className="header__title">{title}</h1>
        {subtitle && <p className="header__subtitle">{subtitle}</p>}
      </div>

      {user && <HeaderUser user={user} />}
    </header>
  );
}
