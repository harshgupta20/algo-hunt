/**
 * The platform's color language, in one place:
 *  - green (bull) = bullish / up / RSI in the upper zone; red (bear) = bearish / down / lower zone;
 *    neutral = no directional signal. Red never appears unless something is bearish.
 *  - Future / Call / Put have their own identity colors (sky / violet / pink), never green/red.
 *  - amber (warn) = needs attention (draft, stale, reconnect), not direction.
 */
import type { Leg } from '@ash/shared';

export type Tone = 'bull' | 'bear' | 'neutral';

/** The strategy's momentum zones: RSI ≥ 60 is bullish strength, ≤ 40 bearish weakness. */
export const RSI_UPPER = 60;
export const RSI_LOWER = 40;

export function rsiZone(rsi: number | null | undefined, upper = RSI_UPPER, lower = RSI_LOWER): Tone {
  if (rsi == null) return 'neutral';
  if (rsi >= upper) return 'bull';
  if (rsi <= lower) return 'bear';
  return 'neutral';
}

/** Direction of a move (e.g. previous → current RSI). */
export function moveTone(prev: number | null | undefined, curr: number | null | undefined): Tone {
  if (prev == null || curr == null || prev === curr) return 'neutral';
  return curr > prev ? 'bull' : 'bear';
}

export const TONE_TEXT: Record<Tone, string> = {
  bull: 'text-bull',
  bear: 'text-bear',
  neutral: 'text-slate-300',
};

export const TONE_BG: Record<Tone, string> = {
  bull: 'bg-bull',
  bear: 'bg-bear',
  neutral: 'bg-slate-500',
};

export interface LegMeta {
  short: 'FUT' | 'CE' | 'PE';
  name: string;
  text: string;
  dot: string;
}

export const LEGS: Record<Leg, LegMeta> = {
  future: { short: 'FUT', name: 'Future', text: 'text-leg-fut', dot: 'bg-leg-fut' },
  call: { short: 'CE', name: 'Call', text: 'text-leg-ce', dot: 'bg-leg-ce' },
  put: { short: 'PE', name: 'Put', text: 'text-leg-pe', dot: 'bg-leg-pe' },
};

export const LEG_ORDER: Leg[] = ['future', 'call', 'put'];

export function isLeg(x: string): x is Leg {
  return x === 'future' || x === 'call' || x === 'put';
}

/** "Future RSI(14)" → "RSI(14)" when the leg is already shown as a tag. */
export function withoutLegName(label: string, leg: Leg): string {
  const name = `${LEGS[leg].name} `;
  return label.startsWith(name) ? label.slice(name.length) : label;
}
