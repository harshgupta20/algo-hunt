/**
 * The REST API surface (served by src/app/api/[...path]/route.ts). Paths are
 * relative to /api. Register literal segments before `:param` siblings.
 */
import type { AppContext } from './context';
import { Router } from './http';
import { configController } from './controllers/configController';
import { alertController } from './controllers/alertController';
import { analyticsController } from './controllers/analyticsController';
import { strategyController } from './controllers/strategyController';
import { instrumentController } from './controllers/instrumentController';
import { preferencesController } from './controllers/preferencesController';
import { analyzerController } from './controllers/analyzerController';
import { strategyBuilderController } from './controllers/strategyBuilderController';
import { kiteController } from './controllers/kiteController';
import { groupController } from './controllers/groupController';
import { liveController } from './controllers/liveController';
import { mcxController } from './controllers/mcxController';

export function createRouter(ctx: AppContext): Router {
  const r = new Router();

  r.get('/health', async () => {
    const kite = await ctx.kiteAuth.status();
    return { status: 'ok', store: 'postgres', kite: kite.state };
  });

  const cfg = configController(ctx);
  r.get('/configs', cfg.list);
  r.post('/configs', cfg.create);
  r.get('/configs/snapshots', cfg.snapshots); // must precede /configs/:id
  r.get('/configs/:id', cfg.get);
  r.put('/configs/:id', cfg.update);
  r.delete('/configs/:id', cfg.remove);
  r.post('/configs/:id/activate', cfg.activate);
  r.post('/configs/:id/deactivate', cfg.deactivate);

  // Group monitors (one config per member underlying)
  r.post('/config-groups', cfg.createGroup);
  r.post('/config-groups/:groupId/activate', cfg.activateGroup);
  r.post('/config-groups/:groupId/deactivate', cfg.deactivateGroup);
  r.delete('/config-groups/:groupId', cfg.removeGroup);

  // Underlying groups (reusable named sets)
  const grp = groupController(ctx);
  r.get('/groups', grp.list);
  r.post('/groups', grp.create);
  r.get('/groups/:id', grp.get);
  r.put('/groups/:id', grp.update);
  r.delete('/groups/:id', grp.remove);

  const alert = alertController(ctx);
  r.get('/alerts', alert.list);
  r.get('/alerts/:id', alert.get);

  const analytics = analyticsController(ctx);
  r.get('/analytics/summary', analytics.summary);

  const strat = strategyController(ctx);
  r.get('/strategies', strat.list);
  r.get('/strategies/:key', strat.get);

  const inst = instrumentController(ctx);
  r.get('/instruments/meta', inst.meta);
  r.get('/instruments/underlyings', inst.underlyings);
  r.get('/instruments/:underlying/expiries', inst.expiries);
  r.get('/instruments/:underlying/strikes', inst.strikes);

  // MCX commodities tab
  const mcx = mcxController(ctx);
  r.get('/mcx/products', mcx.products);

  const prefs = preferencesController(ctx);
  r.get('/preferences', prefs.get);
  r.put('/preferences', prefs.save);

  const analyzer = analyzerController(ctx);
  r.post('/analyzer/run', analyzer.run);
  r.post('/analyzer/chart', analyzer.chart);

  // Live monitoring (serverless evaluator)
  const live = liveController(ctx);
  r.get('/live/status', live.status);
  r.post('/live/tick', live.tick);

  // Kite Connect broker login (OAuth-style)
  const kite = kiteController(ctx);
  r.get('/kite/status', kite.status);
  r.get('/kite/login', kite.login);
  r.get('/kite/login-url', kite.loginUrlJson);
  r.get('/kite/callback', kite.callback);
  r.post('/kite/session', kite.session);
  r.post('/kite/logout', kite.logout);
  r.get('/kite/instruments', kite.instruments);
  r.post('/kite/instruments/sync', kite.syncInstruments);

  // Strategy Builder (custom, JSON-defined strategies)
  const sb = strategyBuilderController(ctx);
  r.get('/builder/catalog', sb.catalog);
  r.get('/builder/template', sb.template);
  r.get('/custom-strategies', sb.list);
  r.post('/custom-strategies', sb.create);
  r.get('/custom-strategies/:id', sb.get);
  r.put('/custom-strategies/:id', sb.update);
  r.delete('/custom-strategies/:id', sb.remove);
  r.post('/custom-strategies/:id/duplicate', sb.duplicate);
  r.post('/custom-strategies/:id/publish', sb.publish);
  r.post('/custom-strategies/:id/disable', sb.disable);
  r.get('/custom-strategies/:id/versions', sb.versions);
  r.get('/custom-strategies/:id/stats', sb.stats);

  return r;
}
