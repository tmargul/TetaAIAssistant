import { useEffect, useRef, useState } from 'react';
import './custom-select.css';

export type CustomSelectOption = {
  value: string;
  label: string;
};

type CustomSelectProps = {
  id?: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`custom-select__chevron${open ? ' custom-select__chevron--open' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function CustomSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Wybierz…',
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder;
  const isPlaceholder = !selected;

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

  const handleSelect = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="custom-select" ref={rootRef}>
      <button
        id={id}
        type="button"
        className="custom-select__trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`custom-select__value${isPlaceholder ? ' custom-select__value--placeholder' : ''}`}>
          {label}
        </span>
        <span className="custom-select__icon" aria-hidden>
          <IconChevron open={open} />
        </span>
      </button>

      {open && !disabled && (
        <ul className="custom-select__menu" role="listbox">
          {options.map((option) => (
            <li key={option.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`custom-select__option${option.value === value ? ' custom-select__option--active' : ''}`}
                onClick={() => handleSelect(option.value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
