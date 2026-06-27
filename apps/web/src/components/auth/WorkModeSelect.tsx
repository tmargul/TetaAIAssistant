import type { AppMode } from '@teta/shared';
import { WORK_MODE_LABELS } from '@teta/shared';

type WorkModeSelectProps = {
  value: AppMode;
  onChange: (mode: AppMode) => void;
  id?: string;
};

export function WorkModeSelect({ value, onChange, id = 'work-mode' }: WorkModeSelectProps) {
  return (
    <div className="oracle-setup__field">
      <label className="oracle-setup__label" htmlFor={id}>
        Tryb pracy aplikacji
      </label>
      <select
        id={id}
        className="oracle-setup__input"
        value={value}
        onChange={(e) => onChange(e.target.value as AppMode)}
      >
        <option value="client">{WORK_MODE_LABELS.client.title}</option>
        <option value="vendor">{WORK_MODE_LABELS.vendor.title}</option>
      </select>
      <p className="oracle-setup__desc" style={{ marginTop: '0.35rem' }}>
        {WORK_MODE_LABELS[value].hint}
      </p>
    </div>
  );
}
