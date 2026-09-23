import type { AppContext } from '../context';
import type { Handler } from '../http';

export function analyticsController(ctx: AppContext) {
  const summary: Handler = () => ctx.alertService.analytics();
  return { summary };
}
