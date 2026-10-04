/**
 * Algo Hunt desktop app — start-algo-hunt.bat as a Windows program:
 *
 *   first start     the setup wizard (setup/index.html): disclaimer, settings one by one — each checked live —
 *                   saved encrypted for this Windows user (config.ts), instead of the .bat's .env file
 *   every start     a start-up screen while it gets the latest version from GitHub, installs, builds (runner.ts —
 *                   install / build only when something changed), then the Algo Hunt window, already signed in
 *   window closed   Algo Hunt keeps running in the tray, so alerts and paper trades continue; Quit stops it cleanly
 *   --hidden        (Start with Windows) starts in the tray without opening the window
 */
import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, session, shell, type MenuItemConstructorOptions } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { checkDatabase, checkKite, checkResend, checkTelegram } from './checks';
import { appEnv, loadConfig, saveConfig, type DesktopConfig } from './config';
import { logFile } from './log';
import { APP_URL, AppRunner, PORT, appAnswers, findTools, portTaken, type Extra, type Report, type Source, type Step, type Tools } from './runner';
import { SESSION_COOKIE, sessionCookie } from './session';

// Filled in when the app is built (scripts/build.mjs): which repository, and the token that can read it.
declare const __REPO__: string;
declare const __BRANCH__: string;
declare const __GITHUB_TOKEN__: string;
const SOURCE: Source = {
  url: __GITHUB_TOKEN__ ? `https://x-access-token:${__GITHUB_TOKEN__}@github.com/${__REPO__}.git` : `https://github.com/${__REPO__}.git`,
  plainUrl: `https://github.com/${__REPO__}.git`,
  branch: __BRANCH__,
  secret: __GITHUB_TOKEN__ || undefined,
};

const ROOT = path.join(__dirname, '..'); // dist/.. — the app (inside its archive once installed)
const DATA = app.getPath('userData'); // %APPDATA%\Algo Hunt — settings, logs
// The code, its packages and its build (~1 GB): local, not in the roaming profile.
const CODE = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'AlgoHunt', 'app') : path.join(DATA, 'app');
const LOGS = path.join(DATA, 'logs');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const TRAY_ICON = path.join(ROOT, 'assets', 'tray.png');
const PRELOAD = path.join(__dirname, 'preload.js');

const log = logFile(LOGS, 'app.log');
const runner = new AppRunner(CODE, path.join(DATA, 'app-state.json'), logFile(LOGS, 'server.log'));
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

let main: BrowserWindow | null = null;
let setup: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;
let config: DesktopConfig | null = null;
let quitting = false;
let launching = false;
let trayHintShown = false;
let crashes: number[] = [];
let lastRun: { tools: Tools; env: NodeJS.ProcessEnv } | null = null;
const hidden = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  app.quit(); // Algo Hunt is already open: the other copy shows its window
} else {
  app.on('second-instance', () => (setup ? setup.focus() : splash ? splash.focus() : showMain()));
  app.whenReady().then(boot);
}

async function boot(): Promise<void> {
  app.setAppUserModelId('com.algohunt.desktop'); // Windows: notifications and the taskbar know the app
  Menu.setApplicationMenu(appMenu());
  registerIpc();
  log(`[desktop] Algo Hunt ${app.getVersion()} starting (${os.platform()} ${os.release()}, ${Math.round(os.totalmem() / 1e9)} GB) — code in ${CODE}`);
  config = loadConfig(DATA);
  if (!config) return void openSetup('first');
  if (hidden) {
    ensureTray();
    if (!(await launch(silentReport))) await startupScreen(); // a problem: show it
    return;
  }
  await startupScreen();
}

// ---- starting the app ---------------------------------------------------------------------------

// Steps that finished or failed (each command's own output is in server.log).
const silentReport: Report = (step, state, message, extra) => {
  if (state === 'run') return;
  log(`[start] ${step} ${state}${message ? `: ${message}` : ''}`);
  if (extra?.detail) log(extra.detail);
};

function windowReport(win: () => BrowserWindow | null): Report {
  return (step: Step, state, message, extra?: Extra) => {
    silentReport(step, state, message, extra);
    win()?.webContents.send('progress', { step, state, message, extra });
  };
}

/** The start-up screen (logo, steps, and — when something fails — what to do). */
async function startupScreen(): Promise<void> {
  if (!splash) {
    splash = new BrowserWindow({ width: 600, height: 470, frame: false, resizable: false, show: false, center: true, backgroundColor: '#0b1d4d', icon: ICON, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
    splash.on('closed', () => (splash = null));
    await splash.loadFile(path.join(ROOT, 'setup', 'starting.html'));
    splash.show();
  }
  if (await launch(windowReport(() => splash))) splash?.close();
}

/** Latest version → packages → build → start → signed in → the window. False (reported) when a step failed. */
async function launch(report: Report): Promise<boolean> {
  if (!config) {
    openSetup('first');
    return false;
  }
  if (launching) return false;
  launching = true;
  try {
    if (runner.running) await runner.stop();
    if (await portTaken()) {
      // Started another way (start-algo-hunt.bat, npm start): use it, as the .bat does.
      if (await appAnswers()) {
        report('start', 'done', 'Algo Hunt is already running on this computer — opening it.');
        await openSignedIn();
        return true;
      }
      report('start', 'fail', `Port ${PORT} is used by another program. Close it, then press Try again.`);
      return false;
    }
    report('latest', 'run', 'Checking Git and Node.js…');
    const found = await findTools(process.env);
    if (!found.tools) {
      report('latest', 'fail', found.problem?.message, { link: found.problem?.link });
      return false;
    }
    const env = appEnv(config, DATA, found.tools.env);
    if (!(await runner.prepare(found.tools, SOURCE, env, report))) return false;
    report('start', 'run', 'Starting Algo Hunt…');
    lastRun = { tools: found.tools, env };
    runner.onExit = onAppExit;
    runner.start(found.tools, env);
    if (!(await runner.ready())) {
      await runner.stop();
      report('start', 'fail', 'Algo Hunt didn’t start. “Open logs” shows why — send the server.log file to your admin.');
      return false;
    }
    report('start', 'done', 'Running');
    await openSignedIn();
    return true;
  } catch (err) {
    log(`[desktop] start failed: ${err instanceof Error ? err.stack : String(err)}`);
    report('start', 'fail', `Something went wrong: ${msg(err)}`);
    return false;
  } finally {
    launching = false;
  }
}

async function openSignedIn(): Promise<void> {
  await signIn();
  await openMain();
  ensureTray();
}

/** The app stopped by itself: start it again (up to 3 times in 10 minutes), then show the problem. */
function onAppExit(code: number | null): void {
  const now = Date.now();
  crashes = [...crashes.filter((t) => now - t < 10 * 60_000), now];
  log(`[desktop] app stopped unexpectedly (code ${code}) — ${crashes.length} time(s) in 10 minutes`);
  if (crashes.length <= 3 && lastRun) {
    runner.start(lastRun.tools, lastRun.env);
    void runner.ready().then((ok) => ok && main?.reload());
  } else {
    new Notification({ title: 'Algo Hunt stopped', body: 'The app stopped several times — open it to see what happened.' }).show();
    main?.hide();
    void startupScreen();
  }
}

/** Tray / menu → "Get the latest version": stop, update, start again. */
async function restartWithLatest(): Promise<void> {
  main?.hide();
  await startupScreen();
}

async function signIn(): Promise<void> {
  const c = sessionCookie(config!.appPassword);
  await session.defaultSession.cookies.set({ url: APP_URL, name: SESSION_COOKIE, value: c.value, expirationDate: c.expires, httpOnly: true, sameSite: 'lax' });
}

// ---- windows ------------------------------------------------------------------------------------

const isApp = (url: string) => url.startsWith(APP_URL) || url.startsWith(`http://127.0.0.1:${PORT}`);
/** Kite's login runs inside the window and comes back to localhost:3000. */
const isKite = (url: string) => /^https:\/\/([a-z0-9-]+\.)*zerodha\.com(\/|$)/i.test(url);

async function openMain(): Promise<void> {
  if (main) {
    await main.loadURL(`${APP_URL}/v2`);
    if (!hidden) showMain();
    return;
  }
  main = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Algo Hunt',
    icon: ICON,
    backgroundColor: '#f4f6fb',
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (isApp(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  main.webContents.on('will-navigate', (e, url) => {
    if (isApp(url) || isKite(url)) return;
    e.preventDefault();
    void shell.openExternal(url);
  });
  main.webContents.on('render-process-gone', () => main?.reload());
  main.webContents.on('did-navigate', (_e, url, code) => void kiteProblem(url, code));
  main.webContents.on('did-navigate-in-page', (_e, url) => void kiteProblem(url, 200));
  main.on('page-title-updated', (e) => e.preventDefault()); // keep "Algo Hunt"
  main.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // closing the window keeps alerts running
    main?.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      new Notification({ title: 'Algo Hunt is still running', body: 'Alerts and paper trades continue. Open it again from the tray icon — or right-click it to quit.' }).show();
    }
  });
  main.on('closed', () => (main = null));
  await main.loadURL(`${APP_URL}/v2`);
  if (!hidden) showMain();
}

/**
 * Wrong Kite keys only show at the Kite login, on Kite's own page — so say what's wrong and offer the fix:
 *   wrong API key     Kite's login page answers HTTP 400 {"message":"Invalid `api_key`."}
 *   wrong API secret  the login comes back, the token exchange fails → /settings?kite=error&message=…checksum…
 */
let kiteDialogOpen = false;
async function kiteProblem(url: string, code: number): Promise<void> {
  if (!main || kiteDialogOpen) return;
  let what: 'key' | 'secret' | null = null;
  if (/^https:\/\/kite\.zerodha\.com\/connect\/login/.test(url) && code === 400) {
    const text = String(await main.webContents.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => ''));
    if (/api_key/i.test(text)) what = 'key';
  } else if (isApp(url) && /[?&]kite=error/.test(url)) {
    const message = new URL(url).searchParams.get('message') ?? '';
    if (/checksum|api_secret|api_key/i.test(message)) what = 'secret';
  }
  if (!what) return;
  kiteDialogOpen = true;
  try {
    const { response } = await dialog.showMessageBox(main, {
      type: 'warning',
      title: 'Kite keys',
      message: what === 'key' ? 'Kite doesn’t accept the API key saved in Algo Hunt.' : 'Kite didn’t accept the API secret saved in Algo Hunt.',
      detail: `Open your app on developers.kite.trade, copy the API ${what === 'key' ? 'key' : 'secret'} again and correct it in the settings. Then press Connect Kite again.`,
      buttons: ['Fix Kite keys', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (what === 'key') await main?.loadURL(`${APP_URL}/v2`); // off Kite's error page
    if (response === 0) openSetup('edit', 'kite');
  } finally {
    kiteDialogOpen = false;
  }
}

function showMain(): void {
  if (!main) return void (config ? startupScreen() : openSetup('first'));
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}

/** The setup wizard; `step` opens it on one step (e.g. 'kite'). */
function openSetup(mode: 'first' | 'edit', step?: string): void {
  if (setup) return setup.focus();
  splash?.close();
  setup = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 960,
    minHeight: 660,
    show: false,
    title: mode === 'first' ? 'Set up Algo Hunt' : 'Algo Hunt — settings',
    icon: ICON,
    backgroundColor: '#0b1d4d',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  void setup.loadFile(path.join(ROOT, 'setup', 'index.html'), { query: step ? { mode, step } : { mode } });
  setup.once('ready-to-show', () => setup?.show());
  setup.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  setup.on('closed', () => {
    setup = null;
    if (!config) app.quit(); // closed before finishing the first setup
  });
}

// ---- tray, menu --------------------------------------------------------------------------------

function ensureTray(): void {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('Algo Hunt — running, alerts on');
  tray.on('click', showMain);
  tray.on('double-click', showMain);
  refreshTray();
}

function refreshTray(): void {
  if (!tray) return;
  const startWithWindows = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Algo Hunt', click: showMain },
      { type: 'separator' },
      { label: 'Get the latest version (restarts)', click: () => void restartWithLatest() },
      { label: 'Start with Windows (in the tray)', type: 'checkbox', checked: startWithWindows, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) },
      { label: 'Change settings (keys, database)…', click: () => openSetup('edit') },
      { label: 'Open logs folder', click: () => void shell.openPath(LOGS) },
      { type: 'separator' },
      { label: 'Quit Algo Hunt (stops alerts)', click: () => app.quit() },
    ]),
  );
}

// The window's menu bar (always shown): settings are one click — or Ctrl+, — away.
function appMenu(): Menu {
  const history = () => main?.webContents.navigationHistory;
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Algo Hunt',
      submenu: [
        { label: 'Change settings (keys, database)…', accelerator: 'CmdOrCtrl+,', click: () => openSetup('edit') },
        { label: 'Fix Kite keys…', click: () => openSetup('edit', 'kite') },
        { label: 'Get the latest version (restarts)', click: () => void restartWithLatest() },
        { label: 'Open logs folder', click: () => void shell.openPath(LOGS) },
        { type: 'separator' },
        { label: 'Quit Algo Hunt (stops alerts)', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'View',
      submenu: [
        // No address bar: a way back from Kite's pages (e.g. "Forgot password").
        { label: 'Back', accelerator: 'Alt+Left', click: () => history()?.canGoBack() && history()?.goBack() },
        { label: 'Algo Hunt home', accelerator: 'Alt+Home', click: () => void main?.loadURL(`${APP_URL}/v2`) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
    { label: 'Help', submenu: [{ label: `Algo Hunt ${app.getVersion()}`, enabled: false }, { label: 'Open logs folder', click: () => void shell.openPath(LOGS) }] },
  ];
  return Menu.buildFromTemplate(template);
}

// Quit (tray, menu, Windows shutting down): stop the app first — it saves what's waiting for the database.
app.on('before-quit', (e) => {
  quitting = true;
  if (runner.running) {
    e.preventDefault();
    void runner.stop().then(() => app.quit());
  }
});
app.on('window-all-closed', () => {
  /* keep running in the tray */
});

// ---- the setup / start-up windows' requests ----------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('setup:load', async () => {
    const tools = await findTools(process.env);
    return {
      config,
      system: { memoryGb: Math.round(os.totalmem() / 1e9), cpus: os.cpus().length, platform: os.platform(), release: os.release(), version: app.getVersion(), git: tools.git ?? null, node: tools.node ?? null, toolsProblem: tools.problem ?? null },
    };
  });
  ipcMain.handle('check:database', (_e, url: string) => checkDatabase(url));
  ipcMain.handle('check:kite', (_e, key: string, secret: string) => checkKite(key, secret));
  ipcMain.handle('check:telegram', (_e, token: string, chatId?: string) => checkTelegram(token, chatId));
  ipcMain.handle('check:resend', (_e, key: string) => checkResend(key));
  ipcMain.handle('setup:finish', async (_e, input: Partial<DesktopConfig>) => {
    const report = windowReport(() => setup);
    if (!input.databaseUrl || !input.kiteApiKey || !input.kiteApiSecret || !input.appPassword) return { ok: false, message: 'Some required settings are missing.' };
    report('save', 'run');
    try {
      config = saveConfig(DATA, {
        databaseUrl: input.databaseUrl.trim(),
        kiteApiKey: input.kiteApiKey.trim(),
        kiteApiSecret: input.kiteApiSecret.trim(),
        appPassword: input.appPassword,
        telegramBotToken: input.telegramBotToken?.trim() || undefined,
        telegramChatId: input.telegramChatId?.trim() || undefined,
        resendApiKey: input.resendApiKey?.trim() || undefined,
        cronSecret: config?.cronSecret,
        acceptedTermsAt: input.acceptedTermsAt || config?.acceptedTermsAt || new Date().toISOString(),
      });
    } catch (err) {
      report('save', 'fail', `Couldn’t save the settings: ${msg(err)}`);
      return { ok: false };
    }
    report('save', 'done');
    const ok = await launch(report);
    if (ok) setTimeout(() => setup?.close(), 1_800); // let the last step's tick show
    return { ok };
  });
  ipcMain.handle('start:retry', () => startupScreen());
  ipcMain.handle('start:settings', () => openSetup('edit'));
  ipcMain.handle('app:logs', () => shell.openPath(LOGS));
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:open', (_e, url: string) => (/^https:\/\//.test(url) ? shell.openExternal(url) : undefined));
  ipcMain.handle('app:copy', (_e, text: string) => clipboard.writeText(String(text)));
}
