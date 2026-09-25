'use client';

/**
 * Rich tooltip used for every feature, control and icon in the app.
 *
 *  - Content: a title, what it is / what it does, an optional example and note.
 *  - Opens on hover (short delay, no flicker) and on keyboard focus; closes on
 *    leave, blur, click or Escape. `InfoTip` (ⓘ) also toggles on tap for touch.
 *  - Rendered in a portal with fixed positioning, so cards/tables with
 *    `overflow: hidden` never clip it; flips to stay inside the viewport.
 *  - Accessible: role="tooltip" + aria-describedby on the trigger.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import clsx from 'clsx';

export interface TooltipContent {
  title: string;
  /** What it is and what it does. */
  body?: ReactNode;
  /** A concrete example (rendered monospace). */
  example?: string;
  /** Caveat, requirement or tip (rendered muted, below a divider). */
  note?: ReactNode;
}

export type TooltipSide = 'top' | 'bottom' | 'right' | 'left';

const OPEN_DELAY_MS = 300;
const GAP = 8;
const MARGIN = 8;

interface Position {
  top: number;
  left: number;
  side: TooltipSide;
  /** Arrow offset along the tooltip edge, in px. */
  arrow: number;
}

function place(trigger: DOMRect, tip: DOMRect, preferred: TooltipSide): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = {
    top: trigger.top - tip.height - GAP >= MARGIN,
    bottom: trigger.bottom + tip.height + GAP <= vh - MARGIN,
    right: trigger.right + tip.width + GAP <= vw - MARGIN,
    left: trigger.left - tip.width - GAP >= MARGIN,
  };
  const order: Record<TooltipSide, TooltipSide[]> = {
    top: ['top', 'bottom', 'right', 'left'],
    bottom: ['bottom', 'top', 'right', 'left'],
    right: ['right', 'left', 'top', 'bottom'],
    left: ['left', 'right', 'top', 'bottom'],
  };
  const side = order[preferred].find((s) => fits[s]) ?? preferred;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

  if (side === 'top' || side === 'bottom') {
    const left = clamp(trigger.left + trigger.width / 2 - tip.width / 2, MARGIN, vw - tip.width - MARGIN);
    const top = side === 'top' ? trigger.top - tip.height - GAP : trigger.bottom + GAP;
    return { top, left, side, arrow: clamp(trigger.left + trigger.width / 2 - left, 12, tip.width - 12) };
  }
  const top = clamp(trigger.top + trigger.height / 2 - tip.height / 2, MARGIN, vh - tip.height - MARGIN);
  const left = side === 'right' ? trigger.right + GAP : trigger.left - tip.width - GAP;
  return { top, left, side, arrow: clamp(trigger.top + trigger.height / 2 - top, 12, tip.height - 12) };
}

function TooltipBody({ content }: { content: TooltipContent }) {
  return (
    <>
      <div className="text-xs font-semibold text-fg">{content.title}</div>
      {content.body && <div className="mt-1 text-xs leading-relaxed text-slate-300">{content.body}</div>}
      {content.example && (
        <div className="mt-2 rounded-md bg-ink-850 border border-ink-700/60 px-2 py-1 font-mono text-[11px] text-slate-200">
          {content.example}
        </div>
      )}
      {content.note && (
        <div className="mt-2 pt-2 border-t border-ink-700/60 text-[11px] leading-relaxed text-slate-500">{content.note}</div>
      )}
    </>
  );
}

function useTooltip(side: TooltipSide) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  const reposition = useCallback(() => {
    if (!triggerRef.current || !tipRef.current) return;
    setPos(place(triggerRef.current.getBoundingClientRect(), tipRef.current.getBoundingClientRect(), side));
  }, [side]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, reposition, hide]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { open, pos, triggerRef, tipRef, show, hide, setOpen };
}

function Bubble({
  id,
  content,
  pos,
  tipRef,
}: {
  id: string;
  content: TooltipContent;
  pos: Position | null;
  tipRef: RefObject<HTMLDivElement | null>;
}) {
  const arrowStyle: CSSProperties =
    pos?.side === 'top'
      ? { bottom: -5, left: pos.arrow - 5 }
      : pos?.side === 'bottom'
        ? { top: -5, left: pos.arrow - 5 }
        : pos?.side === 'right'
          ? { left: -5, top: pos.arrow - 5 }
          : { right: -5, top: (pos?.arrow ?? 0) - 5 };
  return createPortal(
    <div
      ref={tipRef}
      id={id}
      role="tooltip"
      className={clsx(
        'fixed z-[60] w-max max-w-[300px] rounded-lg border border-ink-700 bg-ink-900 dark:bg-ink-800 px-3 py-2.5 shadow-xl pointer-events-none',
        'transition-opacity duration-100',
        pos ? 'opacity-100' : 'opacity-0',
      )}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
    >
      <TooltipBody content={content} />
      <span
        className="absolute w-2.5 h-2.5 rotate-45 bg-ink-900 dark:bg-ink-800 border-ink-700"
        style={{
          ...arrowStyle,
          borderStyle: 'solid',
          borderWidth:
            pos?.side === 'top' ? '0 1px 1px 0' : pos?.side === 'bottom' ? '1px 0 0 1px' : pos?.side === 'right' ? '0 0 1px 1px' : '1px 1px 0 0',
        }}
      />
    </div>,
    document.body,
  );
}

/**
 * Wrap any element to give it a rich tooltip. `className` styles the inline
 * wrapper (e.g. move `ml-auto` here when wrapping a flex child).
 */
export function Tooltip({
  content,
  side = 'top',
  className,
  children,
}: {
  content: TooltipContent;
  side?: TooltipSide;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const t = useTooltip(side);
  // Inline by default; a display class from the caller (e.g. `flex` for a full-width nav row) wins.
  const hasDisplay = /(^|\s)(flex|block|grid|inline-block|inline|hidden)(\s|$)/.test(className ?? '');
  return (
    <span
      ref={t.triggerRef}
      className={clsx(!hasDisplay && 'inline-flex', className)}
      aria-describedby={t.open ? id : undefined}
      onMouseEnter={() => t.show(OPEN_DELAY_MS)}
      onMouseLeave={t.hide}
      onPointerDown={t.hide}
      onFocus={(e) => {
        // Keyboard focus only — a mouse click shouldn't pin the tooltip open.
        if ((e.target as HTMLElement).matches?.(':focus-visible')) t.show(0);
      }}
      onBlur={t.hide}
    >
      {children}
      {t.open && <Bubble id={id} content={content} pos={t.pos} tipRef={t.tipRef} />}
    </span>
  );
}

/** A small ⓘ button that explains the element next to it (hover, focus or tap). */
export function InfoTip({ content, side = 'top', className }: { content: TooltipContent; side?: TooltipSide; className?: string }) {
  const id = useId();
  const t = useTooltip(side);
  return (
    <span ref={t.triggerRef} className={clsx('inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={`About: ${content.title}`}
        aria-describedby={t.open ? id : undefined}
        className="inline-flex items-center justify-center rounded-full text-slate-500 hover:text-accent-soft focus-visible:text-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onMouseEnter={() => t.show(150)}
        onMouseLeave={t.hide}
        onFocus={() => t.show(0)}
        onBlur={t.hide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          t.setOpen((o) => !o);
        }}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {t.open && <Bubble id={id} content={content} pos={t.pos} tipRef={t.tipRef} />}
    </span>
  );
}

/** Form label with an ⓘ explanation. Drop-in for `<label className="label">`. */
export function FieldLabel({ children, help, htmlFor }: { children: ReactNode; help?: TooltipContent; htmlFor?: string }) {
  return (
    <div className="flex items-center gap-1 mb-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {children}
      </label>
      {help && <InfoTip content={help} />}
    </div>
  );
}
