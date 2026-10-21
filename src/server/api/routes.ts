/**
 * The REST API surface (served by src/app/api/[...path]/route.ts). Paths are
 * relative to /api. Register literal segments before `:param` siblings.
 */
import type { AppContext } from './context';
import { Router } from './http';
import { preferencesController } from './controllers/preferencesController';
import { kiteController } from './controllers/kiteController';
import { marketController } from './controllers/marketController';
import { v2Controller } from './controllers/v2Controller';
import { equityController } from './controllers/equityController';

export function createRouter(ctx: AppContext): Router {
  const r = new Router();

  r.get('/health', async () => {
    const kite = await ctx.kiteAuth.status();
    return { status: 'ok', store: 'postgres', kite: kite.state };
  });

  // Equity — NSE cash stocks: its own strategies, watchlists, backtests and screens (independent of V2)
  const eq = equityController(ctx);
  r.get('/equity/stocks', eq.stocks);
  r.get('/equity/presets', eq.presets);
  r.get('/equity/templates', eq.templates);
  r.get('/equity/strategies', eq.listStrategies);
  r.post('/equity/strategies', eq.createStrategy);
  r.post('/equity/strategies/validate', eq.validate); // before /equity/strategies/:id
  r.get('/equity/strategies/:id', eq.getStrategy);
  r.put('/equity/strategies/:id', eq.updateStrategy);
  r.delete('/equity/strategies/:id', eq.removeStrategy);
  r.post('/equity/strategies/:id/duplicate', eq.duplicateStrategy);
  r.get('/equity/watchlists', eq.listWatchlists);
  r.post('/equity/watchlists', eq.createWatchlist);
  r.put('/equity/watchlists/:id', eq.updateWatchlist);
  r.delete('/equity/watchlists/:id', eq.removeWatchlist);
  r.post('/equity/backtests', eq.startBacktest);
  r.get('/equity/backtests/latest', eq.latestBacktest); // before /equity/backtests/:id
  r.get('/equity/backtests/:id', eq.backtestJob);
  r.delete('/equity/backtests/:id', eq.cancelBacktest);
  r.get('/equity/backtest-history', eq.backtestHistory);
  r.get('/equity/backtest-history/:id', eq.backtestRecord);
  r.delete('/equity/backtest-history/:id', eq.removeBacktestRecord);
  r.post('/equity/screens', eq.startScreen);
  r.get('/equity/screens/latest', eq.latestScreen); // before /equity/screens/:id
  r.get('/equity/screens/:id', eq.screenJob);
  r.delete('/equity/screens/:id', eq.cancelScreen);

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
  r.post('/v2/backtest/jobs', v2.startBacktest);
  r.get('/v2/backtest/jobs/latest', v2.latestBacktestJob); // before /v2/backtest/jobs/:id
  r.get('/v2/backtest/jobs/:id', v2.backtestJob);
  r.delete('/v2/backtest/jobs/:id', v2.cancelBacktest);
  r.get('/v2/alerts', v2.alerts);
  r.get('/v2/alerts/feed', v2.alertFeed); // before /v2/alerts/:id
  r.get('/v2/alerts/counts', v2.alertCounts);
  r.get('/v2/alerts/:id', v2.alert);
  r.post('/v2/alerts/:id/acknowledge', v2.acknowledge);
  r.get('/v2/signals', v2.signals);
  r.get('/v2/signals/counts', v2.signalCounts);
  r.post('/v2/scan', v2.scan);
  r.get('/v2/scan-runs', v2.scanRuns);
  r.get('/v2/paper/plans/:id', v2.paperPlan);
  r.put('/v2/paper/plans/:id', v2.savePaperPlan);
  r.get('/v2/paper/summary', v2.paperSummary);
  r.get('/v2/paper/settings', v2.paperSettings);
  r.put('/v2/paper/connections/:id', v2.saveConnectionPaper);
  r.delete('/v2/paper/connections/:id', v2.resetConnectionPaper);
  r.get('/v2/paper/trades', v2.paperTrades);
  r.get('/v2/paper/counts', v2.paperCounts);
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
  r.get('/v2/database', v2.database);
  r.put('/v2/database/history', v2.setHistory);

  const prefs = preferencesController(ctx);
  r.get('/preferences', prefs.get);
  r.put('/preferences', prefs.save);

  // Market eagle view: indices, sectors, stocks, movers, F&O, world, news, calendar (read-only).
  const market = marketController(ctx);
  r.get('/market/overview', market.overview);
  r.get('/market/map', market.map);
  r.get('/market/movers', market.movers);
  r.get('/market/options', market.options);
  r.get('/market/global', market.global);
  r.get('/market/news', market.news);
  r.get('/market/calendar', market.calendar);
  r.get('/market/company/:symbol', market.company);

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
