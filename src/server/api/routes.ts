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
import { mcxV2Controller } from './controllers/mcxV2Controller';
import { v2Controller } from './controllers/v2Controller';

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

  // MCX V2 (beta) — isolated alerting subsystem
  const m2 = mcxV2Controller(ctx);
  r.get('/mcx/v2/status', m2.status);
  r.get('/mcx/v2/products', m2.products);
  r.get('/mcx/v2/instruments', m2.instruments);
  r.post('/mcx/v2/instruments/sync', m2.syncInstruments);
  r.post('/mcx/v2/universe/preview', m2.previewUniverse);
  r.post('/mcx/v2/validate', m2.validate);
  r.post('/mcx/v2/explain', m2.explainDraft);
  r.post('/mcx/v2/replay', m2.replay);
  r.get('/mcx/v2/strategies', m2.listStrategies);
  r.post('/mcx/v2/strategies', m2.createStrategy);
  r.get('/mcx/v2/strategies/:id', m2.getStrategy);
  r.put('/mcx/v2/strategies/:id', m2.updateStrategy);
  r.delete('/mcx/v2/strategies/:id', m2.removeStrategy);
  r.post('/mcx/v2/strategies/:id/duplicate', m2.duplicateStrategy);
  r.post('/mcx/v2/strategies/:id/enable', m2.enable);
  r.post('/mcx/v2/strategies/:id/disable', m2.disable);
  r.get('/mcx/v2/strategies/:id/versions', m2.versions);
  r.get('/mcx/v2/strategies/:id/units', m2.units);
  r.post('/mcx/v2/strategies/:id/explain', m2.explainStrategy);
  r.get('/mcx/v2/alerts', m2.alerts);
  r.get('/mcx/v2/alerts/:id', m2.alert);
  r.post('/mcx/v2/alerts/:id/acknowledge', m2.acknowledge);
  r.get('/mcx/v2/signals', m2.signals);
  r.post('/mcx/v2/scan', m2.scan);
  r.get('/mcx/v2/scan-runs', m2.scanRuns);
  r.get('/mcx/v2/scan-runs/:id', m2.scanRun);
  r.get('/mcx/v2/settings', m2.settings);
  r.put('/mcx/v2/settings', m2.saveSettings);
  r.get('/mcx/v2/calendar', m2.calendar);
  r.put('/mcx/v2/calendar', m2.saveCalendar);
  r.get('/mcx/v2/channels', m2.channels);
  r.post('/mcx/v2/channels/test', m2.testChannel);

  // V2 — product-agnostic strategies + product connections
  const v2 = v2Controller(ctx);
  r.get('/v2/status', v2.status);
  r.get('/v2/products', v2.products);
  r.post('/v2/products/sync', v2.syncProducts);
  r.get('/v2/products/:id', v2.product);
  r.get('/v2/strategies', v2.listStrategies);
  r.post('/v2/strategies', v2.createStrategy);
  r.post('/v2/strategies/validate', v2.validateStrategy);
  r.get('/v2/strategies/:id', v2.getStrategy);
  r.put('/v2/strategies/:id', v2.updateStrategy);
  r.delete('/v2/strategies/:id', v2.removeStrategy);
  r.post('/v2/strategies/:id/duplicate', v2.duplicateStrategy);
  r.get('/v2/strategies/:id/versions', v2.versions);
  r.get('/v2/connections', v2.listConnections);
  r.post('/v2/connections', v2.createConnections);
  r.post('/v2/connections/validate', v2.validateConnection);
  r.post('/v2/connections/preview', v2.previewConnection);
  r.post('/v2/connections/explain', v2.explainDraft);
  r.put('/v2/connections/:id', v2.updateConnection);
  r.delete('/v2/connections/:id', v2.removeConnection);
  r.post('/v2/connections/:id/enable', v2.enableConnection);
  r.post('/v2/connections/:id/disable', v2.disableConnection);
  r.get('/v2/connections/:id/units', v2.units);
  r.post('/v2/connections/:id/explain', v2.explainConnection);
  r.post('/v2/compare', v2.compare);
  r.get('/v2/alerts', v2.alerts);
  r.post('/v2/alerts/:id/acknowledge', v2.acknowledge);
  r.get('/v2/signals', v2.signals);
  r.post('/v2/scan', v2.scan);
  r.get('/v2/scan-runs', v2.scanRuns);
  r.get('/v2/settings', v2.settings);
  r.put('/v2/settings', v2.saveSettings);
  r.get('/v2/calendar', v2.calendar);
  r.put('/v2/calendar', v2.saveCalendar);
  r.get('/v2/channels', v2.channels);
  r.post('/v2/channels/test', v2.testChannel);

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
