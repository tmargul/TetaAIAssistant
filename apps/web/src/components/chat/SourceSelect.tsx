import type { ChatSourceMode } from '@teta/shared';
import { CHAT_SOURCE_LABELS, CHAT_SOURCE_MODES } from '@teta/shared';
import { CustomSelect } from '../ui/CustomSelect';

type SourceSelectProps = {
  value: ChatSourceMode;
  onChange: (value: ChatSourceMode) => void;
  disabled?: boolean;
};

export function SourceSelect({ value, onChange, disabled }: SourceSelectProps) {
  return (
    <CustomSelect
      value={value}
      disabled={disabled}
      onChange={(next) => onChange(next as ChatSourceMode)}
      options={CHAT_SOURCE_MODES.map((mode) => ({
        value: mode,
        label: CHAT_SOURCE_LABELS[mode],
      }))}
    />
  );
}
