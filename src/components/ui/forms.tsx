import { useId, type ReactElement, type ReactNode } from 'react';
import { parseMoney } from '../../lib/money';

/**
 * A row in a .list form: label on the left, control on the right.
 * The child control receives the generated id so the label is always associated.
 */
export function Field({ label, children }: { label: string; children: (id: string) => ReactElement }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/** The large amount entry used on add/edit screens. Holds text; parse with parseMoney. */
export function MoneyInput({
  value,
  onChange,
  label = 'Amount in pounds',
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const invalid = value !== '' && parseMoney(value) === null;
  return (
    <label className="amount-input">
      <span aria-hidden="true">£</span>
      <input
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        aria-invalid={invalid}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
