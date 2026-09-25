import type { AppContext } from '../context';
import type { Handler } from '../http';

export function analyticsController(ctx: AppContext) {
  /** `?segment=NSE|MCX` limits the summary to one market. */
  const summary: Handler = (req) => {
    const seg = req.query.get('segment');
    return ctx.alertService.analytics(seg === 'MCX' || seg === 'NSE' ? seg : undefined);
  };
  return { summary };
}
