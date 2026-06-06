import { useEffect, useRef, useState } from 'react';
import { CHAT_MODELS, type ChatModel } from '@teta/shared';
import './chat.css';

type ModelSelectProps = {
  value: ChatModel;
  onChange: (model: ChatModel) => void;
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

export function ModelSelect({ value, onChange }: ModelSelectProps) {
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
    <div className="chat__select" ref={rootRef}>
      <button
        type="button"
        className="chat__select-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="chat__select-value">{value}</span>
        <span className="chat__select-icon" aria-hidden>
          <IconChevron open={open} />
        </span>
      </button>

      {open && (
        <ul className="chat__select-menu" role="listbox">
          {CHAT_MODELS.map((m) => (
            <li key={m} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={m === value}
                className={`chat__select-option${m === value ? ' chat__select-option--active' : ''}`}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
