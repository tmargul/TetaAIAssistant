import { IconBell } from './icons';
import './layout.css';

type HeaderProps = {
  title: string;
  subtitle?: string;
};

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="header">
      <div>
        <h1 className="header__title">{title}</h1>
        {subtitle && <p className="header__subtitle">{subtitle}</p>}
      </div>

      <div className="header__actions">
        <button type="button" className="header__icon-btn" aria-label="Powiadomienia">
          <IconBell className="header__icon" />
        </button>
        <div className="header__user">
          <div className="header__avatar">U</div>
          <div className="header__user-info">
            <span className="header__user-name">Użytkownik</span>
            <span className="header__user-role">Intranet</span>
          </div>
        </div>
      </div>
    </header>
  );
}
