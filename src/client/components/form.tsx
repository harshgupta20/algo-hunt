'use client';

/** Form building blocks shared by the sections (F&O / V2, Equity): captioned cells and a forgiving number box. */
import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { InfoTip, type TooltipContent } from './Tooltip';

export function Cell({ label, help, children, className }: { label: string; help: TooltipContent; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
        <InfoTip content={help} />
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * A number box that can be typed into freely: a value is taken while it is a number within [min, max];
 * leaving the box puts back the last good value (a number outside the range is brought into it), so a
 * half-typed amount ("5" on the way to "50000") is never forced to the minimum.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
  disabled,
  placeholder,
  label,
}: {
  value: number | null;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const inRange = (n: number) => (min === undefined || n >= min) && (max === undefined || n <= max);
  const parse = (raw: string) => (raw.trim() === '' ? NaN : Number(raw));
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      value={text ?? (value === null ? '' : String(value))}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (Number.isFinite(n) && inRange(n)) onChange(n);
      }}
      onBlur={(e) => {
        const n = parse(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        setText(null);
      }}
    />
  );
}
