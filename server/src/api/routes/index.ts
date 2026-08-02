import { Router } from 'express';
import type { AppContext } from '../context.js';
import { config } from '../../config/index.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { configController } from '../controllers/configController.js';
import { alertController } from '../controllers/alertController.js';
import { analyticsController } from '../controllers/analyticsController.js';
import { strategyController } from '../controllers/strategyController.js';
import { instrumentController } from '../controllers/instrumentController.js';
import { preferencesController } from '../controllers/preferencesController.js';
import { simulateController } from '../controllers/simulateController.js';
import { analyzerController } from '../controllers/analyzerController.js';
import { strategyBuilderController } from '../controllers/strategyBuilderController.js';
import { kiteController } from '../controllers/kiteController.js';
import { groupController } from '../controllers/groupController.js';

export function createRouter(ctx: AppContext): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ status: 'ok', provider: config.marketProvider, store: ctx.store.kind });
  });

  const cfg = configController(ctx);
  r.get('/configs', asyncHandler(cfg.list));
  r.post('/configs', asyncHandler(cfg.create));
  r.get('/configs/snapshots', asyncHandler(cfg.snapshots)); // must precede /configs/:id
  r.get('/configs/:id', asyncHandler(cfg.get));
  r.put('/configs/:id', asyncHandler(cfg.update));
  r.delete('/configs/:id', asyncHandler(cfg.remove));
  r.post('/configs/:id/activate', asyncHandler(cfg.activate));
  r.post('/configs/:id/deactivate', asyncHandler(cfg.deactivate));

  // Group monitors (one config per member underlying)
  r.post('/config-groups', asyncHandler(cfg.createGroup));
  r.post('/config-groups/:groupId/activate', asyncHandler(cfg.activateGroup));
  r.post('/config-groups/:groupId/deactivate', asyncHandler(cfg.deactivateGroup));
  r.delete('/config-groups/:groupId', asyncHandler(cfg.removeGroup));

  // Underlying groups (reusable named sets)
  const grp = groupController(ctx);
  r.get('/groups', asyncHandler(grp.list));
  r.post('/groups', asyncHandler(grp.create));
  r.get('/groups/:id', asyncHandler(grp.get));
  r.put('/groups/:id', asyncHandler(grp.update));
  r.delete('/groups/:id', asyncHandler(grp.remove));

  const alert = alertController(ctx);
  r.get('/alerts', asyncHandler(alert.list));
  r.get('/alerts/:id', asyncHandler(alert.get));

  const analytics = analyticsController(ctx);
  r.get('/analytics/summary', asyncHandler(analytics.summary));

  const strat = strategyController(ctx);
  r.get('/strategies', asyncHandler(strat.list));
  r.get('/strategies/:key', asyncHandler(strat.get));

  const inst = instrumentController(ctx);
  r.get('/instruments/meta', asyncHandler(inst.meta));
  r.get('/instruments/underlyings', asyncHandler(inst.underlyings));
  r.get('/instruments/:underlying/expiries', asyncHandler(inst.expiries));
  r.get('/instruments/:underlying/strikes', asyncHandler(inst.strikes));

  const prefs = preferencesController(ctx);
  r.get('/preferences', asyncHandler(prefs.get));
  r.put('/preferences', asyncHandler(prefs.save));

  const sim = simulateController(ctx);
  r.post('/simulate/trigger', asyncHandler(sim.trigger));

  const analyzer = analyzerController(ctx);
  r.post('/analyzer/run', asyncHandler(analyzer.run));
  r.post('/analyzer/chart', asyncHandler(analyzer.chart));

  // Strategy Builder (custom, JSON-defined strategies)
  // Kite Connect broker login (OAuth-style)
  const kite = kiteController(ctx);
  r.get('/kite/status', asyncHandler(kite.status));
  r.get('/kite/login', asyncHandler(kite.login));
  r.get('/kite/login-url', asyncHandler(kite.loginUrlJson));
  r.get('/kite/callback', asyncHandler(kite.callback));
  r.post('/kite/session', asyncHandler(kite.session));
  r.post('/kite/logout', asyncHandler(kite.logout));

  const sb = strategyBuilderController(ctx);
  r.get('/builder/catalog', asyncHandler(sb.catalog));
  r.get('/builder/template', asyncHandler(sb.template));
  r.get('/custom-strategies', asyncHandler(sb.list));
  r.post('/custom-strategies', asyncHandler(sb.create));
  r.get('/custom-strategies/:id', asyncHandler(sb.get));
  r.put('/custom-strategies/:id', asyncHandler(sb.update));
  r.delete('/custom-strategies/:id', asyncHandler(sb.remove));
  r.post('/custom-strategies/:id/duplicate', asyncHandler(sb.duplicate));
  r.post('/custom-strategies/:id/publish', asyncHandler(sb.publish));
  r.post('/custom-strategies/:id/disable', asyncHandler(sb.disable));
  r.get('/custom-strategies/:id/versions', asyncHandler(sb.versions));
  r.get('/custom-strategies/:id/stats', asyncHandler(sb.stats));

  return r;
}
