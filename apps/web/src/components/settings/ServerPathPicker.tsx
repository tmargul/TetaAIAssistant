import { useCallback, useEffect, useRef, useState } from 'react';
import type { PathBrowseEntry, PathBrowseResponse } from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';

type ServerPathPickerProps = {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  browseOpen: boolean;
  onBrowseOpenChange: (open: boolean) => void;
};

function entryLabel(entry: PathBrowseEntry): string {
  if (entry.kind === 'directory') return `${entry.name}/`;
  return entry.name;
}

export function ServerPathPicker({
  value,
  onChange,
  disabled = false,
  browseOpen,
  onBrowseOpenChange,
}: ServerPathPickerProps) {
  const [browse, setBrowse] = useState<PathBrowseResponse | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const wasBrowseOpen = useRef(false);

  const loadBrowse = useCallback(async (path?: string) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const query = path != null && path !== '' ? `?path=${encodeURIComponent(path)}` : '';
      const res = await authFetch(`/api/admin/updates/browse${query}`);
      const data = (await res.json()) as PathBrowseResponse | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((data as { message?: string[] }).message)
          ? (data as { message: string[] }).message.join(', ')
          : (data as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      setBrowse(data as PathBrowseResponse);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Nie udało się wczytać katalogu.');
      setBrowse(null);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  useEffect(() => {
    if (browseOpen && !wasBrowseOpen.current) {
      void loadBrowse(value.trim() || undefined);
    }
    wasBrowseOpen.current = browseOpen;
  }, [browseOpen, value, loadBrowse]);

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

  const selectEntry = (entry: PathBrowseEntry) => {
    if (entry.kind === 'directory' || entry.kind === 'drive') {
      navigateTo(entry.path);
      return;
    }
    if (entry.selectable) {
      onChange(entry.path);
      onBrowseOpenChange(false);
    }
  };

  return (
    <div className="settings__path-picker">
      <input
        type="text"
        className="settings__input settings__path-picker-input"
        placeholder="E:\Teta\teta-models-update.zip"
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
        onClick={() => onBrowseOpenChange(!browseOpen)}
      >
        {browseOpen ? 'Zamknij wybór pliku' : 'Wybierz plik na serwerze…'}
      </button>

      {browseOpen && (
        <div className="settings__path-browser">
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
                <li className="settings__path-browser-empty">Brak plików ZIP w tym katalogu.</li>
              )}
              {browse.entries.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={`settings__path-browser-item${
                      entry.selectable && value === entry.path
                        ? ' settings__path-browser-item--selected'
                        : ''
                    }`}
                    onClick={() => selectEntry(entry)}
                  >
                    <span className="settings__path-browser-item-kind">
                      {entry.kind === 'file' ? 'ZIP' : 'DIR'}
                    </span>
                    <span className="settings__path-browser-item-name">{entryLabel(entry)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
