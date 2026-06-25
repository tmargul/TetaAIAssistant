import { useEffect, useRef, useState } from 'react';
import {
  CHAT_QUALITY_HINTS,
  CHAT_QUALITY_LABELS,
  CHAT_QUALITY_MODES,
  type ChatQualityMode,
} from '@teta/shared';
import './chat.css';

type QualitySelectProps = {
  value: ChatQualityMode;
  onChange: (quality: ChatQualityMode) => void;
  disabled?: boolean;
};

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chat__select-chevron${open ? ' chat__select-chevron--open' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function QualitySelect({ value, onChange, disabled = false }: QualitySelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="chat__select chat__select--quality" ref={rootRef}>
      <button
        type="button"
        className="chat__select-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={CHAT_QUALITY_HINTS[value]}
        disabled={disabled}
      >
        <span className="chat__select-value">{CHAT_QUALITY_LABELS[value]}</span>
        <span className="chat__select-icon" aria-hidden>
          <IconChevron open={open} />
        </span>
      </button>

      {open && (
        <ul className="chat__select-menu chat__select-menu--quality" role="listbox">
          {CHAT_QUALITY_MODES.map((mode) => (
            <li key={mode} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={mode === value}
                className={`chat__select-option${mode === value ? ' chat__select-option--active' : ''}`}
                title={CHAT_QUALITY_HINTS[mode]}
                onClick={() => {
                  onChange(mode);
                  setOpen(false);
                }}
              >
                <span className="chat__select-option-label">{CHAT_QUALITY_LABELS[mode]}</span>
                <span className="chat__select-option-hint">{CHAT_QUALITY_HINTS[mode]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
