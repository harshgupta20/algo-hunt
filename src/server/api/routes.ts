/**
 * The REST API surface (served by src/app/api/[...path]/route.ts). Paths are
 * relative to /api. Register literal segments before `:param` siblings.
 */
import type { AppContext } from './context';
import { Router } from './http';
import { preferencesController } from './controllers/preferencesController';
import { kiteController } from './controllers/kiteController';
import { v2Controller } from './controllers/v2Controller';

export function createRouter(ctx: AppContext): Router {
  const r = new Router();

  r.get('/health', async () => {
    const kite = await ctx.kiteAuth.status();
    return { status: 'ok', store: 'postgres', kite: kite.state };
  });

  // V2 — product-agnostic strategies + product connections
  const v2 = v2Controller(ctx);
  r.get('/v2/status', v2.status);
  r.get('/v2/live', v2.live);
  r.get('/v2/products', v2.products);
  r.post('/v2/products/sync', v2.syncProducts);
  r.get('/v2/products/counts', v2.productCounts); // before /v2/products/:id
  r.get('/v2/products/:id', v2.product);
  r.get('/v2/strategies', v2.listStrategies);
  r.post('/v2/strategies', v2.createStrategy);
  r.post('/v2/strategies/validate', v2.validateStrategy);
  r.get('/v2/strategies/:id', v2.getStrategy);
  r.put('/v2/strategies/:id', v2.updateStrategy);
  r.delete('/v2/strategies/:id', v2.removeStrategy);
  r.post('/v2/strategies/:id/duplicate', v2.duplicateStrategy);
  r.get('/v2/strategies/:id/versions', v2.versions);
  r.post('/v2/strategies/:id/connections/enable', v2.enableStrategyConnections);
  r.post('/v2/strategies/:id/connections/disable', v2.disableStrategyConnections);
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
  r.post('/v2/backtest', v2.backtest);
  r.get('/v2/alerts', v2.alerts);
  r.get('/v2/alerts/feed', v2.alertFeed); // before /v2/alerts/:id
  r.get('/v2/alerts/:id', v2.alert);
  r.post('/v2/alerts/:id/acknowledge', v2.acknowledge);
  r.get('/v2/signals', v2.signals);
  r.post('/v2/scan', v2.scan);
  r.get('/v2/scan-runs', v2.scanRuns);
  r.get('/v2/paper/plans/:id', v2.paperPlan);
  r.put('/v2/paper/plans/:id', v2.savePaperPlan);
  r.get('/v2/paper/summary', v2.paperSummary);
  r.get('/v2/paper/settings', v2.paperSettings);
  r.put('/v2/paper/connections/:id', v2.saveConnectionPaper);
  r.delete('/v2/paper/connections/:id', v2.resetConnectionPaper);
  r.get('/v2/paper/trades', v2.paperTrades);
  r.post('/v2/paper/trades/:id/close', v2.closePaperTrade);
  r.delete('/v2/paper/strategies/:id/trades', v2.resetPaper);
  r.get('/v2/settings', v2.settings);
  r.put('/v2/settings', v2.saveSettings);
  r.get('/v2/calendar', v2.calendar);
  r.put('/v2/calendar', v2.saveCalendar);
  r.get('/v2/channels', v2.channels);
  r.post('/v2/channels/test', v2.testChannel);
  r.get('/v2/channels/telegram/chats', v2.telegramChats);
  r.get('/v2/channels/telegram/bot', v2.telegramBot);

  const prefs = preferencesController(ctx);
  r.get('/preferences', prefs.get);
  r.put('/preferences', prefs.save);

  // Kite Connect OAuth: status, login redirect, callback, token submit, logout.
  const kite = kiteController(ctx);
  r.get('/kite/status', kite.status);
  r.get('/kite/login', kite.login);
  r.get('/kite/login-url', kite.loginUrlJson);
  r.get('/kite/callback', kite.callback);
  r.post('/kite/session', kite.session);
  r.post('/kite/logout', kite.logout);

  return r;
}
