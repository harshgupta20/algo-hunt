/** Browser Notification API + a lightweight WebAudio alert chime. */

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return 'denied';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

export function showNotification(title: string, body: string): void {
  if (canNotify() && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

let audioCtx: AudioContext | undefined;

/** Short two-tone chime, generated so no audio asset is bundled. */
export function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx ??= new Ctx();
    const now = audioCtx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(audioCtx.destination);
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.start(t);
      o.stop(t + 0.14);
    }
  } catch {
    /* audio not available */
  }
}
