'use client';

/**
 * Building blocks of the condition builders (V2 strategies + paper trailing rules, Equity entry / exit) — one
 * structure everywhere, so a strategy reads the same way wherever it's built:
 *
 *   LogicToggle   All of these (AND) | Any of these (OR) — must be true · N items
 *   ItemCard      ▾ ① sentence of the item ……………………………… tools     (collapses to the sentence)
 *                 └ body: Value panel → comparison → Compared-with panel (.cond-body / .cond-cols in globals.css)
 *   Joiner        the group's AND / OR between two items
 *   Panel / Row   a titled box with a fixed label column ("What", "Indicator", "Settings", "Leg", "Candles")
 *   Mini          a small labelled setting inside a row ("Period [20]")
 */
import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronDown, FolderPlus } from 'lucide-react';
import { Tooltip, type TooltipContent } from './Tooltip';
import { IconButton } from './ui';
import { HELP } from '../lib/help';

const B = HELP.builder;

/** One line of a panel: a fixed label column, then the controls. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">{children}</div>
    </div>
  );
}

/** A small labelled setting inside a row: "Period [20]". */
export function Mini({ label, help, children }: { label: string; help: TooltipContent; children: ReactNode }) {
  return (
    <Tooltip content={help}>
      <label className="inline-flex items-center gap-0.5 text-[11px] text-slate-500">
        {label}
        {children}
      </label>
    </Tooltip>
  );
}

/** A titled box of rows; `footer` (e.g. the leg / candles rows) sits under a dashed divider. */
export function Panel({ title, help, children, footer }: { title: string; help: TooltipContent; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-ink-700/70 bg-ink-850 p-2.5">
      <Tooltip content={help} className="self-start">
        <span className="cursor-help text-[11px] font-semibold text-slate-300">{title}</span>
      </Tooltip>
      {children}
      {footer && (
        <>
          <div className="border-t border-dashed border-ink-700" />
          {footer}
        </>
      )}
    </div>
  );
}

/** The comparison between the two panels: → [select] → side by side, a plain row when stacked. */
export function OperatorBox({ children }: { children: ReactNode }) {
  return (
    <div className="cond-op flex items-center justify-center gap-1">
      <span aria-hidden className="cond-arrow text-slate-500">→</span>
      {children}
      <span aria-hidden className="cond-arrow text-slate-500">→</span>
    </div>
  );
}

/** The comparison highlighted inside an item's sentence. */
export function OpWord({ children }: { children: ReactNode }) {
  return <span className="rounded bg-accent/10 px-1.5 py-px text-[12px] font-semibold text-accent-soft">{children}</span>;
}

/** An item of a group: a header (collapse, number, its sentence, tools) and its editor below. */
export function ItemCard({
  number,
  sentence,
  tools,
  tone = 'plain',
  badge,
  children,
}: {
  number: number;
  sentence: ReactNode;
  tools: ReactNode;
  /** `group`: a nested group (accent); `not`: wrapped in NOT (amber). */
  tone?: 'plain' | 'group' | 'not';
  /** Shown before the sentence (e.g. the NOT tag). */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const group = tone === 'group';
  return (
    <div className={clsx('overflow-hidden rounded-lg border', tone === 'not' ? 'border-warn/50' : group ? 'border-accent/30' : 'border-ink-700')}>
      <div className={clsx('flex items-center gap-2 px-2.5 py-1.5', open && 'border-b border-ink-700/70', tone === 'not' ? 'bg-warn/5' : group ? 'bg-accent/[0.04]' : 'bg-ink-900')}>
        <IconButton help={open ? B.collapse : B.expand} onClick={() => setOpen(!open)} className="rounded-md p-1 text-slate-500 hover:bg-ink-800 hover:text-slate-200">
          <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        </IconButton>
        <Tooltip content={group ? B.groupNumber : B.itemNumber}>
          <span className={clsx('inline-flex h-5 min-w-5 shrink-0 cursor-help items-center justify-center rounded-full px-1 text-[11px] font-bold', group ? 'bg-accent text-white' : 'bg-accent/15 text-accent-soft')}>
            {group ? <FolderPlus className="h-3 w-3" aria-label={`Group ${number}`} /> : number}
          </span>
        </Tooltip>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 py-0.5 text-[13px] text-slate-300">
          {badge}
          {sentence}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{tools}</div>
      </div>
      {open && <div className={clsx('p-3', tone === 'not' ? 'bg-warn/[0.03]' : 'bg-ink-900')}>{children}</div>}
    </div>
  );
}

/** The group's AND / OR drawn between its items, so the logic reads down the list. */
export function Joiner({ type, help }: { type: 'AND' | 'OR'; help: TooltipContent }) {
  return (
    <div className="flex items-center gap-2 pl-6">
      <span className="h-3 w-px bg-accent/40" />
      <Tooltip content={help}>
        <span className="block cursor-help rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-accent-soft">{type}</span>
      </Tooltip>
      <span className="h-px flex-1 bg-accent/15" />
    </div>
  );
}

/** "All of these (AND) | Any of these (OR) — must be true · 3 items". */
export function LogicToggle({ value, onChange, count, note }: { value: 'AND' | 'OR'; onChange: (v: 'AND' | 'OR') => void; count: number; note?: ReactNode }) {
  return (
    <>
      <div role="radiogroup" aria-label="Group logic" className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
        {(['AND', 'OR'] as const).map((l) => (
          <Tooltip key={l} content={l === 'AND' ? B.all : B.any}>
            <button
              type="button"
              role="radio"
              aria-checked={value === l}
              onClick={() => onChange(l)}
              className={clsx('px-3 py-1.5 font-semibold', value === l ? 'bg-accent text-white' : 'bg-ink-900 text-slate-400 hover:text-slate-200')}
            >
              {l === 'AND' ? 'All of these' : 'Any of these'} <span className={clsx('font-normal', value === l ? 'text-white/75' : 'text-slate-500')}>({l})</span>
            </button>
          </Tooltip>
        ))}
      </div>
      <span className="text-[12px] text-slate-400">
        {value === 'AND' ? 'must be true' : 'is enough'} · {count} item{count === 1 ? '' : 's'}
      </span>
      {note}
    </>
  );
}
