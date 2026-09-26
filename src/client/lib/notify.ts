/**
 * Browser notifications + the alert alarm.
 *
 * The alert tune is generated with Web Audio (no audio file): three quick rising notes and a long
 * high note with vibrato, played three times (~3.3 s) through a compressor so it's loud without
 * distorting. An alarm repeats the tune every few seconds until it's stopped (Stop, opening the
 * alerts, acknowledging, clicking the desktop notification) or 90 s pass, and flashes the tab title.
 *
 * Browsers only allow sound after the user has interacted with the page: `unlockAudio()` runs on the
 * first click / key press, and the alarm reports `blocked` so the UI can offer a "Play sound" button.
 */

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return 'denied';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

/** Desktop notification. `sticky` keeps it on screen until dismissed; clicking it focuses the app. */
export function showNotification(title: string, body: string, opts: { sticky?: boolean; tag?: string; onClick?: () => void } = {}): void {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: opts.tag, requireInteraction: opts.sticky ?? false });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

// ---- Sound ------------------------------------------------------------------------------------

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let playing: AudioScheduledSourceNode[] = [];

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 6;
      comp.ratio.value = 10;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture (click / key) so later alerts may make sound. */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

// One burst: C6 · E6 · G6 staccato, then a long C7 with vibrato. Three bursts per ring.
const BURST: Array<[freq: number, start: number, dur: number]> = [
  [1046.5, 0, 0.11],
  [1318.5, 0.12, 0.11],
  [1568, 0.24, 0.11],
  [2093, 0.37, 0.5],
];
const BURST_SPAN = 1.1;
const BURSTS = 3;

function note(c: AudioContext, freq: number, t: number, dur: number): void {
  const out = c.createGain();
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 6500;
  tone.connect(out);
  out.connect(master!);
  // Bright but not harsh: square for bite, triangle for body, a sine an octave down for weight.
  const layers: Array<[OscillatorType, number, number]> = [
    ['square', 0.22, 1],
    ['triangle', 0.75, 1],
    ['sine', 0.4, 0.5],
  ];
  for (const [type, level, mult] of layers) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    if (dur > 0.3) {
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = 7;
      depth.gain.value = freq * mult * 0.015;
      lfo.connect(depth);
      depth.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.06);
      playing.push(lfo);
    }
    const g = c.createGain();
    g.gain.value = level;
    o.connect(g);
    g.connect(tone);
    o.start(t);
    o.stop(t + dur + 0.06);
    playing.push(o);
  }
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(1, t + 0.006);
  out.gain.setValueAtTime(1, t + Math.max(0.01, dur - 0.05));
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
}

/** Play the alert tune once (three bursts). Resolves false when the browser is blocking sound. */
export async function playAlertTune(): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  if (c.state !== 'running') {
    try {
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      /* still blocked */
    }
  }
  if (c.state !== 'running') return false;
  playing = playing.filter((n) => {
    try {
      n.stop();
    } catch {
      /* already stopped */
    }
    return false;
  });
  const t0 = c.currentTime + 0.04;
  for (let b = 0; b < BURSTS; b++) for (const [f, s, d] of BURST) note(c, f, t0 + b * BURST_SPAN + s, d);
  return true;
}

function silence(): void {
  for (const n of playing) {
    try {
      n.stop();
    } catch {
      /* already stopped */
    }
  }
  playing = [];
}

// ---- Alarm ------------------------------------------------------------------------------------

export interface AlarmItem {
  id: string;
  title: string;
  detail: string;
}

export interface AlarmState {
  active: boolean;
  /** The browser refused to play sound (no click on the page yet). */
  blocked: boolean;
  items: AlarmItem[];
}

const REPEAT_MS = 6_000;
const MAX_MS = 90_000;
const IDLE: AlarmState = { active: false, blocked: false, items: [] };

let state: AlarmState = IDLE;
let startedAt = 0;
let repeatTimer: ReturnType<typeof setInterval> | undefined;
let titleTimer: ReturnType<typeof setInterval> | undefined;
let baseTitle = '';
const listeners = new Set<(s: AlarmState) => void>();

function set(next: AlarmState): void {
  state = next;
  for (const l of listeners) l(state);
}

export function subscribeAlarm(fn: (s: AlarmState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

async function ring(): Promise<void> {
  const ok = await playAlertTune();
  if (state.active && state.blocked === ok) set({ ...state, blocked: !ok });
}

/** Raise (or extend) the alarm for new alerts. */
export function raiseAlarm(items: AlarmItem[], opts: { sound: boolean; repeat: boolean }): void {
  const fresh = !state.active;
  if (fresh) startedAt = Date.now();
  set({ active: true, blocked: state.blocked, items: [...items, ...state.items.filter((i) => !items.some((n) => n.id === i.id))].slice(0, 20) });
  if (opts.sound) {
    void ring();
    clearInterval(repeatTimer);
    if (opts.repeat) {
      repeatTimer = setInterval(() => {
        if (Date.now() - startedAt > MAX_MS) {
          clearInterval(repeatTimer);
          return;
        }
        void ring();
      }, REPEAT_MS);
    }
  }
  if (fresh && typeof document !== 'undefined') {
    baseTitle = document.title;
    let on = false;
    clearInterval(titleTimer);
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 ALERT · ${state.items[0]?.title ?? ''}` : baseTitle;
    }, 1_000);
  }
}

/** Silence and dismiss the alarm. */
export function stopAlarm(): void {
  if (!state.active) return;
  clearInterval(repeatTimer);
  clearInterval(titleTimer);
  silence();
  if (typeof document !== 'undefined' && baseTitle) document.title = baseTitle;
  set(IDLE);
}

/** From the "Play sound" button (a user gesture): unlock audio and ring now. */
export function playAlarmNow(): void {
  unlockAudio();
  void ring();
}
