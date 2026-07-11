import { useCallback, useEffect, useState } from 'react';
import type { PathBrowseEntry, PathBrowseResponse } from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';

type DirectoryPathPickerProps = {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  inputId?: string;
  placeholder?: string;
  dialogTitle?: string;
};

function entryLabel(entry: PathBrowseEntry): string {
  if (entry.kind === 'directory' || entry.kind === 'drive') return `${entry.name}/`;
  return entry.name;
}

export function DirectoryPathPicker({
  value,
  onChange,
  disabled = false,
  inputId,
  placeholder = 'C:\\Teta\\Client',
  dialogTitle = 'Wybierz katalog',
}: DirectoryPathPickerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftPath, setDraftPath] = useState('');
  const [browse, setBrowse] = useState<PathBrowseResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const loadBrowse = useCallback(async (path?: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const params = new URLSearchParams({ filter: 'directories' });
      if (path != null && path !== '') {
        params.set('path', path);
      }
      const res = await authFetch(`/api/admin/updates/browse?${params.toString()}`);
      const data = (await res.json()) as PathBrowseResponse | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((data as { message?: string[] }).message)
          ? (data as { message: string[] }).message.join(', ')
          : (data as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      const page = data as PathBrowseResponse;
      setBrowse(page);
      if (page.currentPath) {
        setDraftPath(page.currentPath);
      }
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Nie udało się wczytać katalogu.');
      setBrowse(null);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const openDialog = () => {
    const initial = value.trim();
    setDraftPath(initial);
    setBrowse(null);
    setBrowseError(null);
    setDialogOpen(true);
    void loadBrowse(initial || undefined);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setBrowseError(null);
  };

  const confirmSelection = () => {
    const selected = (browse?.currentPath ?? draftPath).trim();
    if (!selected) return;
    onChange(selected);
    closeDialog();
  };

  const navigateTo = (path: string) => {
    void loadBrowse(path);
  };

  const goUp = () => {
    if (!browse) return;
    if (browse.parentPath === '') {
      void loadBrowse();
      return;
    }
    if (browse.parentPath) {
      void loadBrowse(browse.parentPath);
    }
  };

  const goToDraftPath = () => {
    void loadBrowse(draftPath.trim() || undefined);
  };

  useEffect(() => {
    if (!dialogOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDialog();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  return (
    <>
      <div className="settings__path-picker">
        <input
          id={inputId}
          type="text"
          className="settings__input settings__path-picker-input"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="settings__btn settings__btn--secondary settings__path-picker-browse"
          disabled={disabled}
          onClick={openDialog}
        >
          Przeglądaj…
        </button>
      </div>

      {dialogOpen && (
        <div
          className="settings__folder-dialog-backdrop"
          role="presentation"
          onClick={closeDialog}
        >
          <div
            className="settings__folder-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={inputId ? `${inputId}-dialog-title` : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings__folder-dialog-header">
              <h3
                className="settings__folder-dialog-title"
                id={inputId ? `${inputId}-dialog-title` : undefined}
              >
                {dialogTitle}
              </h3>
              <button
                type="button"
                className="settings__folder-dialog-close"
                aria-label="Zamknij"
                onClick={closeDialog}
              >
                ×
              </button>
            </div>

            <div className="settings__folder-dialog-path-row">
              <input
                type="text"
                className="settings__input settings__folder-dialog-path"
                value={draftPath}
                spellCheck={false}
                autoComplete="off"
                placeholder={placeholder}
                onChange={(e) => setDraftPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    goToDraftPath();
                  }
                }}
              />
              <button
                type="button"
                className="settings__btn settings__btn--secondary"
                disabled={browseLoading}
                onClick={goToDraftPath}
              >
                Przejdź
              </button>
            </div>

            <div className="settings__path-browser settings__path-browser--dialog">
              <div className="settings__path-browser-toolbar">
                <button
                  type="button"
                  className="settings__path-browser-up"
                  disabled={browseLoading || browse?.parentPath == null}
                  onClick={goUp}
                >
                  ↑ W górę
                </button>
                <span className="settings__path-browser-current">
                  {browse?.currentPath ?? 'Dyski / katalogi'}
                </span>
              </div>

              {browseLoading && <p className="settings__path-browser-hint">Wczytywanie…</p>}
              {browseError && <p className="settings__path-browser-error">{browseError}</p>}

              {!browseLoading && browse && (
                <ul className="settings__path-browser-list">
                  {browse.entries.length === 0 && (
                    <li className="settings__path-browser-empty">Brak podkatalogów.</li>
                  )}
                  {browse.entries.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={`settings__path-browser-item${
                          draftPath === entry.path ? ' settings__path-browser-item--selected' : ''
                        }`}
                        onClick={() => navigateTo(entry.path)}
                        onDoubleClick={() => {
                          navigateTo(entry.path);
                        }}
                      >
                        <span className="settings__path-browser-item-kind">DIR</span>
                        <span className="settings__path-browser-item-name">{entryLabel(entry)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="settings__folder-dialog-footer">
              <button type="button" className="settings__btn settings__btn--secondary" onClick={closeDialog}>
                Anuluj
              </button>
              <button
                type="button"
                className="settings__btn"
                disabled={browseLoading || !(browse?.currentPath ?? draftPath).trim()}
                onClick={confirmSelection}
              >
                Wybierz ten katalog
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
