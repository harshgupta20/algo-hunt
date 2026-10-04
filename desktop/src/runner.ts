/**
 * What start-algo-hunt.bat does, inside the desktop app. The web app's code lives on this computer
 * (%LOCALAPPDATA%\AlgoHunt\app) and every start:
 *   1. latest    gets the latest version from GitHub (clones it the first time; offline → the version it has)
 *   2. install   npm install — only when the package list changed
 *   3. build     npm run build (database updates + build) — only for a new version
 *   4. start     next start on 127.0.0.1:3000, until Algo Hunt quits
 * Needs Git and Node.js on the computer, like the .bat. No Electron here (testable with plain Node.js).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const PORT = 3000;
export const APP_URL = `http://localhost:${PORT}`;

export type Step = 'save' | 'latest' | 'install' | 'build' | 'start';
export interface Extra {
  /** The last lines of the command's output, for "Show details". */
  detail?: string;
  /** A button next to the problem, e.g. "Download Node.js". */
  link?: { label: string; url: string };
}
export type Report = (step: Step, state: 'run' | 'done' | 'fail', message?: string, extra?: Extra) => void;

/** Where the code comes from. `url` may carry the access token; `plainUrl` never does. */
export interface Source {
  url: string;
  plainUrl: string;
  branch: string;
  /** Hidden from every log and message. */
  secret?: string;
}

export interface Tools {
  git: string;
  node: string;
  /** The environment with Git and Node.js on its PATH. */
  env: NodeJS.ProcessEnv;
}

type Env = NodeJS.ProcessEnv;
const MIN_NODE: [number, number] = [22, 13]; // package.json "engines"
const win = process.platform === 'win32';

/** Runs a command; resolves with its exit code (null: couldn't run it) and the last lines it printed. */
function run(cmd: string, args: string[], o: { cwd?: string; env: Env; shell?: boolean; onLine?: (line: string) => void; log?: (t: string) => void; secret?: string }): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const hide = (t: string) => (o.secret ? t.split(o.secret).join('***') : t);
    const lines: string[] = [];
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: o.cwd, env: o.env, shell: o.shell ?? false, windowsHide: true });
    } catch (err) {
      return resolve({ code: null, out: String(err) });
    }
    const take = (d: Buffer) => {
      const text = hide(d.toString());
      o.log?.(text.trimEnd());
      for (const raw of text.split(/\r?\n|\r/)) {
        const line = raw.trim();
        if (!line) continue;
        lines.push(line);
        if (lines.length > 40) lines.shift();
        o.onLine?.(line);
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.once('error', (err) => resolve({ code: null, out: hide(String(err)) }));
    child.once('close', (code) => resolve({ code, out: lines.join('\n') }));
  });
}

const pathKey = (env: Env) => Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';

/** Finds Git and Node.js (also in their usual install folders when the PATH doesn't have them yet). */
export async function findTools(base: Env = process.env): Promise<{ tools?: Tools; git?: string; node?: string; problem?: { message: string; link: { label: string; url: string } } }> {
  const env: Env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  if (win) {
    const key = pathKey(env);
    const extra = [
      path.join(env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'),
      path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd'),
      path.join(env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'cmd'),
    ].filter((d) => existsSync(d) && !(env[key] ?? '').toLowerCase().split(';').includes(d.toLowerCase()));
    if (extra.length) env[key] = [env[key], ...extra].filter(Boolean).join(';');
  }
  const git = await run('git', ['--version'], { env });
  const node = await run('node', ['--version'], { env });
  const gitVersion = git.code === 0 ? git.out.match(/\d+\.\d+(\.\d+)?/)?.[0] : undefined;
  const nodeVersion = node.code === 0 ? node.out.trim().replace(/^v/, '') : undefined;
  if (!gitVersion) return { node: nodeVersion, problem: { message: 'Git isn’t installed on this computer. Install it (keep the default options), then press Try again.', link: { label: 'Download Git', url: 'https://git-scm.com/download/win' } } };
  if (!nodeVersion) return { git: gitVersion, problem: { message: 'Node.js isn’t installed on this computer. Install the LTS version, then press Try again.', link: { label: 'Download Node.js', url: 'https://nodejs.org/en/download' } } };
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    return { git: gitVersion, node: nodeVersion, problem: { message: `Node.js ${nodeVersion} is too old for Algo Hunt. Install the LTS version, then press Try again.`, link: { label: 'Download Node.js', url: 'https://nodejs.org/en/download' } } };
  }
  return { tools: { git: 'git', node: 'node', env }, git: gitVersion, node: nodeVersion };
}

/** True when something already listens on the port. */
export function portTaken(port = PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => srv.close(() => resolve(false)));
    srv.listen(port, '127.0.0.1');
  });
}

/** Is Algo Hunt answering on the port (e.g. already started by the .bat)? */
export async function appAnswers(): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/login`, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

interface State {
  /** package-lock.json of the last successful npm install. */
  lock?: string;
  /** The version built last. */
  built?: string;
  /** The database the migrations last ran on (a hash). */
  database?: string;
}

const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export class AppRunner {
  private proc: ChildProcess | null = null;
  private stopping = false;
  onExit: ((code: number | null) => void) | null = null;

  constructor(
    /** The app's code folder. */
    readonly dir: string,
    private readonly stateFile: string,
    private readonly log: (text: string) => void,
  ) {}

  get running(): boolean {
    return this.proc !== null;
  }

  private readState(): State {
    try {
      return JSON.parse(readFileSync(this.stateFile, 'utf8')) as State;
    } catch {
      return {};
    }
  }

  private writeState(s: State): void {
    try {
      mkdirSync(path.dirname(this.stateFile), { recursive: true });
      writeFileSync(this.stateFile, JSON.stringify(s));
    } catch (err) {
      this.log(`[desktop] could not save ${this.stateFile}: ${String(err)}`);
    }
  }

  /** Steps 1–3. False when one failed (already reported). */
  async prepare(tools: Tools, source: Source, env: Env, report: Report): Promise<boolean> {
    const { dir } = this;
    let shown = 0;
    // The command's latest line under the step (a few times a second at most).
    const show = (step: Step) => (line: string) => {
      if (Date.now() - shown < 250) return;
      shown = Date.now();
      report(step, 'run', line.length > 140 ? `${line.slice(0, 140)}…` : line);
    };
    const opts = (step: Step, extraEnv: Env = {}) => ({ cwd: dir, env: { ...env, ...extraEnv }, log: this.log, secret: source.secret, onLine: show(step) });
    const gitEnv: Env = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }; // never stop to ask for a password
    const git = (args: string[], cwd = dir) => run(tools.git, args, { ...opts('latest', gitEnv), cwd, onLine: undefined });
    const npm = (args: string[], step: Step) => run('npm', args, { ...opts(step), shell: win }); // npm.cmd needs a shell on Windows

    // 1. Latest version
    let note = '';
    const fresh = async (): Promise<boolean> => {
      report('latest', 'run', 'Downloading Algo Hunt — a minute or two…');
      rmSync(dir, { recursive: true, force: true }); // a half-finished earlier download would block this one
      mkdirSync(path.dirname(dir), { recursive: true });
      const r = await git(['clone', '--quiet', '--branch', source.branch, source.url, dir], path.dirname(dir));
      if (r.code !== 0) {
        report('latest', 'fail', 'Algo Hunt couldn’t be downloaded from GitHub. Check the internet connection. If it keeps failing, the access token in this app may have expired — tell your admin.', { detail: r.out });
        return false;
      }
      await git(['remote', 'set-url', 'origin', source.plainUrl]); // keep the token out of the folder's settings
      return true;
    };
    if (!existsSync(path.join(dir, '.git'))) {
      if (!(await fresh())) return false;
    } else {
      report('latest', 'run', 'Checking GitHub for a new version…');
      const f = await git(['fetch', '--quiet', source.url, source.branch]);
      if (f.code !== 0) note = 'Couldn’t reach GitHub (no internet, or the access token expired) — starting the version already on this computer.';
      else if ((await git(['reset', '--quiet', '--hard', 'FETCH_HEAD'])).code !== 0) {
        if (!(await fresh())) return false; // the folder is damaged: a fresh copy
      }
    }
    const head = (await git(['rev-parse', '--short', 'HEAD'])).out.trim();
    const date = (await git(['log', '-1', '--date=short', '--format=%ad'])).out.trim();
    report('latest', 'done', note || `Version ${head} from ${date}`);

    // 2. Packages — only when the list changed (or none are installed yet)
    const state = this.readState();
    const lockFile = path.join(dir, 'package-lock.json');
    const lock = existsSync(lockFile) ? hash(readFileSync(lockFile)) : 'none';
    if (state.lock !== lock || !existsSync(path.join(dir, 'node_modules'))) {
      report('install', 'run', 'Installing packages — a few minutes the first time…');
      const r = await npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], 'install');
      if (r.code === 0) {
        state.lock = lock;
        this.writeState(state);
        report('install', 'done', 'Packages installed');
      } else if (existsSync(path.join(dir, 'node_modules'))) {
        report('install', 'done', 'Installing failed — continuing with the packages already installed.');
      } else {
        report('install', 'fail', 'Installing the packages failed. Check the internet connection and press Try again.', { detail: r.out });
        return false;
      }
    } else report('install', 'done', 'Packages up to date');

    // 3. Build — only for a new version. Same version on another database: just its updates.
    const database = hash(String(env.DATABASE_URL ?? ''));
    if (state.built !== head || !existsSync(path.join(dir, '.next', 'BUILD_ID'))) {
      report('build', 'run', 'Preparing the app — about 1 to 3 minutes…');
      const r = await npm(['run', 'build'], 'build');
      if (r.code !== 0) {
        const db = /\[migrate\]/.test(r.out) && !/Compiled|Creating an optimized/.test(r.out);
        report('build', 'fail', db ? 'The database couldn’t be reached or updated. Check the internet connection, or the database link in Change settings.' : 'Preparing the app failed. Press Try again; if it keeps failing, send the details to your admin.', { detail: r.out });
        return false;
      }
      Object.assign(state, { built: head, database });
      this.writeState(state);
      report('build', 'done', 'Ready');
    } else if (state.database !== database) {
      report('build', 'run', 'Setting up the database…');
      const r = await run(tools.node, ['scripts/migrate.mjs'], opts('build'));
      if (r.code !== 0) {
        report('build', 'fail', 'The database couldn’t be reached or updated. Check the internet connection, or the database link in Change settings.', { detail: r.out });
        return false;
      }
      state.database = database;
      this.writeState(state);
      report('build', 'done', 'Ready');
    } else report('build', 'done', 'Already prepared');
    return true;
  }

  /** Step 4: `next start` (127.0.0.1 only — this computer). */
  start(tools: Tools, env: Env): void {
    this.stopping = false;
    const next = path.join(this.dir, 'node_modules', 'next', 'dist', 'bin', 'next');
    const child = spawn(tools.node, [next, 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: this.dir, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    child.stdout?.on('data', (d: Buffer) => this.log(d.toString().trimEnd()));
    child.stderr?.on('data', (d: Buffer) => this.log(d.toString().trimEnd()));
    child.once('error', (err) => this.log(`[desktop] could not start the app: ${String(err)}`));
    child.once('exit', (code) => {
      if (this.proc === child) this.proc = null;
      this.log(`[desktop] app exited with code ${code}`);
      if (!this.stopping) this.onExit?.(code);
    });
    this.proc = child;
  }

  /** Waits until the app answers (the login page), or it stops / `ms` pass. */
  async ready(ms = 120_000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!this.proc) return false;
      if (await appAnswers()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /** Asks the app to stop (it saves what's waiting for the database first); forced after `ms`. */
  async stop(ms = 8_000): Promise<void> {
    const child = this.proc;
    if (!child) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', () => resolve())));
    try {
      child.send('shutdown'); // Windows has no SIGTERM: src/server/background.ts listens for this
    } catch {
      /* already gone */
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, ms))]);
    if (child.exitCode === null) child.kill();
    this.proc = null;
  }
}
