import type { AppContext } from '../context';
import type { Handler } from '../http';
import { liveStatus, runLiveTick } from '../../services/live/liveTick';

export function liveController(ctx: AppContext) {
  /** Evaluator health (Kite connection, market window, last run). */
  const status: Handler = () => liveStatus(ctx);

  /**
   * Dashboard-driven evaluation: an open dashboard pings this so monitoring runs
   * even without an external scheduler. The DB lease makes it a no-op when the
   * cron (or another tab) already ran this minute.
   */
  const tick: Handler = async () => {
    const r = await runLiveTick(ctx);
    return { ran: r.ran, reason: r.reason, at: r.at, alerts: r.alerts ?? 0 };
  };

  return { status, tick };
}
