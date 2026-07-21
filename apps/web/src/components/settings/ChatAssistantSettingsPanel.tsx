import { useEffect, useState } from 'react';
import type { ChatAssistantSettingsResponse } from '@teta/shared';
import { authFetch } from '../../lib/auth-storage';

export function ChatAssistantSettingsPanel() {
  const [settings, setSettings] = useState<ChatAssistantSettingsResponse | null>(null);
  const [timeoutSec, setTimeoutSec] = useState('180');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await authFetch('/api/admin/chat-assistant');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as ChatAssistantSettingsResponse;
    setSettings(data);
    setTimeoutSec(String(data.queryTimeoutSec));
  };

  useEffect(() => {
    load().catch(() => setError('Nie udało się wczytać ustawień asystenta.'));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/chat-assistant', {
        method: 'POST',
        body: JSON.stringify({ queryTimeoutSec: Number(timeoutSec) }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message);
      }
      setSettings(data as ChatAssistantSettingsResponse);
      setTimeoutSec(String((data as ChatAssistantSettingsResponse).queryTimeoutSec));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 className="panel__title">Asystent AI</h2>
      <p className="settings__hint">
        Jeden limit czasu dla całego zapytania (Oracle, dokumentacja, doprecyzowanie, model).
        Nie ma osobnych limitów na poszczególne fazy.
      </p>

      {error && <div className="settings__message settings__message--error">{error}</div>}

      <div className="settings__grant-form">
        <label className="settings__field">
          <span className="settings__label">Limit odpowiedzi (sekundy)</span>
          <input
            className="settings__input"
            type="number"
            min={30}
            max={600}
            step={10}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
          />
        </label>
      </div>

      {settings && (
        <p className="settings__hint">
          Aktualnie: {settings.queryTimeoutSec} s na zapytanie (przeglądarka:{' '}
          {Math.round(settings.clientStreamTimeoutMs / 1000)} s).
          {settings.updatedAt ? ` Ostatnia zmiana: ${settings.updatedAt}.` : ' Wartość domyślna.'}
        </p>
      )}

      <div className="settings__actions">
        <button
          type="button"
          className="settings__btn"
          disabled={saving || !timeoutSec.trim()}
          onClick={() => void handleSave()}
        >
          {saving ? 'Zapisywanie…' : 'Zapisz'}
        </button>
      </div>
    </>
  );
}
