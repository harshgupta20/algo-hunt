/*
 * Algo Hunt setup wizard. Talks to the app through window.algoHunt (preload.ts); with ?mock=1 (or opened in a plain
 * browser) a pretend bridge stands in, so the pages can be looked at without the desktop app.
 */
'use strict';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') === 'edit' ? 'edit' : 'first';
const bridge = window.algoHunt && params.get('mock') !== '1' ? window.algoHunt : mockBridge();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ALL_STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'terms', label: 'Disclaimer' },
  { id: 'database', label: 'Database' },
  { id: 'kite', label: 'Kite Connect' },
  { id: 'password', label: 'Password' },
  { id: 'telegram', label: 'Telegram', optional: true },
  { id: 'email', label: 'Email', optional: true },
  { id: 'finish', label: MODE === 'edit' ? 'Save' : 'Finish' },
];
// Changing settings later skips the welcome and the disclaimer (already accepted).
const STEPS = MODE === 'edit' ? ALL_STEPS.filter((s) => s.id !== 'welcome' && s.id !== 'terms') : ALL_STEPS;

const state = {
  index: 0,
  reached: 0,
  busy: false,
  finishing: false,
  acceptedTermsAt: null,
  /** step → the value that passed its check (a change means checking again). */
  verified: {},
};

const field = {
  db: $('#f-db'),
  key: $('#f-key'),
  secret: $('#f-secret'),
  pw: $('#f-pw'),
  pw2: $('#f-pw2'),
  tg: $('#f-tg'),
  chat: $('#f-chat'),
  resend: $('#f-resend'),
};
const value = {
  database: () => field.db.value.trim(),
  kite: () => `${field.key.value.trim()}\n${field.secret.value.trim()}`,
  telegram: () => `${field.tg.value.trim()}\n${field.chat.value.trim()}`,
  email: () => field.resend.value.trim(),
};

// ---- start (called at the end of this file, once everything below is defined) ----------------------

async function init() {
  document.title = MODE === 'edit' ? 'Algo Hunt — settings' : 'Set up Algo Hunt';
  $('#rail-sub').textContent = MODE === 'edit' ? 'Change settings' : 'Setup';
  renderRail();
  wireCommon();
  wireTerms();
  wireChecks();
  wirePassword();
  wireNav();
  wireFinish();
  show(0, true);

  const { config, system } = await bridge.load();
  $('#rail-version').textContent = system?.version ? `v${system.version}` : '';
  renderSystem(system);
  if (config) prefill(config);
  // Opened for one thing (e.g. "Fix Kite keys"): straight to that step.
  const start = STEPS.findIndex((st) => st.id === params.get('step'));
  if (start > 0) show(start);
}

function prefill(c) {
  field.db.value = c.databaseUrl ?? '';
  field.key.value = c.kiteApiKey ?? '';
  field.secret.value = c.kiteApiSecret ?? '';
  field.pw.value = c.appPassword ?? '';
  field.pw2.value = c.appPassword ?? '';
  field.tg.value = c.telegramBotToken ?? '';
  field.chat.value = c.telegramChatId ?? '';
  field.resend.value = c.resendApiKey ?? '';
  state.acceptedTermsAt = c.acceptedTermsAt ?? null;
  // What is saved already works — it only needs checking again when changed.
  for (const step of Object.keys(value)) if (value[step]().trim()) state.verified[step] = value[step]();
  meter();
  if (MODE === 'edit') {
    state.reached = STEPS.length - 1;
    renderRail();
  }
}

// ---- left rail + pages ------------------------------------------------------------------------------

function renderRail() {
  const list = $('#steps');
  list.innerHTML = '';
  STEPS.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = i === state.index ? 'active' : i <= state.reached ? 'done' : '';
    li.innerHTML = `<span class="dot"><span>${i + 1}</span></span><span>${s.label}</span>${s.optional ? '<span class="opt">optional</span>' : ''}`;
    if (i !== state.index && i <= state.reached) li.addEventListener('click', () => !state.busy && !state.finishing && show(i));
    list.append(li);
  });
  const pct = Math.round((state.index / (STEPS.length - 1)) * 100);
  $('#rail-bar').style.width = `${pct}%`;
  $('#rail-count').textContent = `Step ${state.index + 1} of ${STEPS.length}`;
}

function show(i, first = false) {
  const backwards = i < state.index;
  state.index = i;
  state.reached = Math.max(state.reached, i);
  const id = STEPS[i].id;
  for (const page of $$('.page')) {
    const on = page.dataset.step === id;
    page.classList.toggle('back', !on && backwards);
    if (on) {
      page.classList.remove('show');
      void page.offsetWidth; // restart the illustration's animation
      page.classList.add('show');
      page.scrollTop = 0;
    } else page.classList.remove('show');
  }
  renderRail();
  renderNav();
  if (id === 'terms') unlockTermsIfShort();
  if (id === 'finish') renderReview();
  if (!first) setTimeout(() => $('.page.show input:not([type=checkbox]), .page.show textarea')?.focus({ preventScroll: true }), 350);
}

function renderNav() {
  const step = STEPS[state.index];
  const last = state.index === STEPS.length - 1;
  $('#nav-back').classList.toggle('hidden', state.index === 0);
  $('#nav-skip').classList.toggle('hidden', !step.optional);
  const next = $('#nav-next');
  next.textContent = last ? (MODE === 'edit' ? 'Save and restart' : 'Start Algo Hunt') : step.id === 'welcome' ? 'Get started' : 'Next';
  next.disabled = step.id === 'terms' && !($('#t-read').checked && $('#t-own').checked);
}

function wireNav() {
  $('#nav-back').addEventListener('click', () => !state.busy && state.index > 0 && show(state.index - 1));
  $('#nav-next').addEventListener('click', next);
  $('#nav-skip').addEventListener('click', () => {
    const id = STEPS[state.index].id;
    if (id === 'telegram') [field.tg, field.chat].forEach((f) => (f.value = ''));
    if (id === 'email') field.resend.value = '';
    setStatus(id, '');
    show(state.index + 1);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.type === 'checkbox') return;
    e.preventDefault();
    next();
  });
}

async function next() {
  if (state.busy || state.finishing) return;
  const step = STEPS[state.index];
  if (step.id === 'finish') return finish();
  if (!(await validate(step.id))) {
    const page = $('.page.show');
    page.classList.remove('shake');
    void page.offsetWidth;
    page.classList.add('shake');
    return;
  }
  show(state.index + 1);
}

/** Is the step done? Runs its live check when the value hasn't been checked yet. */
async function validate(id) {
  switch (id) {
    case 'terms':
      if (!state.acceptedTermsAt) state.acceptedTermsAt = new Date().toISOString();
      return $('#t-read').checked && $('#t-own').checked;
    case 'database':
      if (!value.database()) return fail('database', 'Paste the connection string from Neon first.', field.db);
      return state.verified.database === value.database() || runCheck('database');
    case 'kite':
      if (!field.key.value.trim() || !field.secret.value.trim()) return fail('kite', 'Both the API key and the API secret are needed.', !field.key.value.trim() ? field.key : field.secret);
      return state.verified.kite === value.kite() || runCheck('kite');
    case 'password':
      return checkPassword(true);
    case 'telegram':
      if (!field.tg.value.trim()) {
        if (field.chat.value.trim()) return fail('telegram', 'A chat ID needs the bot token too — or clear it to skip Telegram.', field.tg);
        return true;
      }
      return state.verified.telegram === value.telegram() || runCheck('telegram');
    case 'email':
      if (!value.email()) return true;
      return state.verified.email === value.email() || runCheck('email');
    default:
      return true;
  }
}

function fail(id, message, input) {
  setStatus(id, message, false);
  if (input) {
    input.closest('.field')?.classList.add('bad');
    input.focus();
  }
  return false;
}

// ---- welcome ----------------------------------------------------------------------------------------

function renderSystem(sys) {
  const box = $('#syscheck');
  if (!sys) return;
  const chips = [];
  if (sys.platform === 'win32') {
    const build = Number(String(sys.release).split('.')[2] ?? 0);
    chips.push({ text: build >= 22000 ? 'Windows 11' : 'Windows 10', ok: build >= 10240 });
  } else chips.push({ text: sys.platform === 'darwin' ? 'macOS' : sys.platform === 'linux' ? 'Linux' : sys.platform, ok: true });
  chips.push({ text: `${sys.memoryGb} GB memory`, ok: sys.memoryGb >= 4, tip: 'At least 4 GB is recommended' });
  chips.push({ text: `${sys.cpus} processor cores`, ok: sys.cpus >= 2 });
  chips.push({ text: navigator.onLine ? 'Online' : 'No internet', ok: navigator.onLine, tip: 'Algo Hunt needs the internet for Kite and the database' });
  // Git and Node.js: Algo Hunt downloads and builds its latest version with them (as start-algo-hunt.bat did).
  const problem = sys.toolsProblem;
  chips.push(sys.git ? { text: `Git ${sys.git}`, ok: true } : { text: 'Git not installed', ok: false, link: { label: 'Download Git', url: 'https://git-scm.com/download/win' } });
  const nodeOld = Boolean(sys.node && problem && /too old/.test(problem.message));
  if (sys.node && !nodeOld) chips.push({ text: `Node.js ${sys.node}`, ok: true });
  else chips.push({ text: nodeOld ? `Node.js ${sys.node} is too old` : 'Node.js not installed', ok: false, link: { label: 'Download Node.js', url: 'https://nodejs.org/en/download' } });
  box.innerHTML = '';
  chips.forEach((c, i) => {
    const el = document.createElement('span');
    el.className = `chip${c.ok ? '' : ' warn'}`;
    el.style.animationDelay = `${0.15 + i * 0.12}s`;
    el.innerHTML = `<i></i>${escapeHtml(c.text)}`;
    if (!c.ok && c.tip) el.innerHTML += ` — <span>${escapeHtml(c.tip)}</span>`;
    if (c.link) el.innerHTML += ` <a href="#" data-open="${escapeHtml(c.link.url)}">${escapeHtml(c.link.label)}</a>`;
    box.append(el);
  });
  if (chips.some((c) => c.link)) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Install what’s missing (default options) before the last step — or continue now and install it when Algo Hunt asks.';
    box.after(hint);
  }
}

// ---- disclaimer -------------------------------------------------------------------------------------

function wireTerms() {
  const box = $('#terms');
  const boxes = [$('#t-read'), $('#t-own')];
  for (const b of boxes) {
    b.closest('.check').classList.add('locked');
    b.addEventListener('change', renderNav);
  }
  box.addEventListener('scroll', () => {
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 12) unlockTerms();
  });
}

function unlockTermsIfShort() {
  const box = $('#terms');
  if (box.scrollHeight <= box.clientHeight + 12) unlockTerms();
}

function unlockTerms() {
  for (const c of $$('.check.locked')) c.classList.remove('locked');
  const hint = $('#terms-hint');
  hint.textContent = 'Thanks for reading — tick both boxes to continue.';
  hint.classList.add('ok');
}

// ---- live checks ---------------------------------------------------------------------------------------

const CHECKS = {
  database: { button: '#b-db', fields: () => [field.db], run: () => bridge.checkDatabase(value.database()) },
  kite: { button: '#b-kite', fields: () => [field.key, field.secret], run: () => bridge.checkKite(field.key.value.trim(), field.secret.value.trim()) },
  telegram: { button: '#b-tg', fields: () => [field.tg, field.chat], run: () => bridge.checkTelegram(field.tg.value.trim(), field.chat.value.trim() || undefined) },
  email: { button: '#b-resend', fields: () => [field.resend], run: () => bridge.checkResend(value.email()) },
};
const STATUS = { database: '#s-db', kite: '#s-kite', password: '#s-pw', telegram: '#s-tg', email: '#s-resend' };

function wireChecks() {
  for (const [id, c] of Object.entries(CHECKS)) {
    $(c.button).addEventListener('click', () => {
      if (id === 'telegram' && !field.tg.value.trim()) return fail('telegram', 'Paste the bot token first.', field.tg);
      if (id === 'email' && !value.email()) return fail('email', 'Paste the Resend API key first.', field.resend);
      if (id === 'database' && !value.database()) return fail('database', 'Paste the connection string from Neon first.', field.db);
      void runCheck(id);
    });
    for (const f of c.fields()) {
      f.addEventListener('input', () => {
        f.closest('.field')?.classList.remove('bad', 'good');
        if (state.verified[id] !== value[id]()) setStatus(id, '');
        else setStatus(id, 'Checked', true);
      });
    }
  }
}

async function runCheck(id) {
  const c = CHECKS[id];
  const button = $(c.button);
  const nextBtn = $('#nav-next');
  const tested = value[id]();
  state.busy = true;
  button.disabled = nextBtn.disabled = true;
  button.classList.add('busy');
  setStatus(id, id === 'database' ? 'Connecting to your database…' : 'Checking…');
  let result;
  try {
    result = await c.run();
  } catch (err) {
    result = { ok: false, message: String(err?.message ?? err) };
  } finally {
    state.busy = false;
    button.disabled = nextBtn.disabled = false;
    button.classList.remove('busy');
  }
  if (value[id]() !== tested) return false; // changed while checking
  setStatus(id, result.message, result.ok);
  for (const f of c.fields()) if (f.value.trim()) f.closest('.field')?.classList.toggle(result.ok ? 'good' : 'bad', true);
  if (result.ok) state.verified[id] = tested;
  else delete state.verified[id];
  return result.ok;
}

function setStatus(id, text, ok) {
  const el = $(STATUS[id]);
  if (!el) return;
  el.textContent = text;
  el.className = `status${ok === true ? ' ok' : ok === false ? ' bad' : ''}`;
}

// ---- password -------------------------------------------------------------------------------------------

function wirePassword() {
  for (const f of [field.pw, field.pw2]) {
    f.addEventListener('input', () => {
      f.closest('.field')?.classList.remove('bad', 'good');
      meter();
      if (field.pw2.value) checkPassword(false);
      else setStatus('password', '');
    });
  }
  $('#b-gen').addEventListener('click', async () => {
    const pw = generatePassword();
    field.pw.value = field.pw2.value = pw;
    field.pw.type = 'text';
    $('[data-eye="#f-pw"]').textContent = 'Hide';
    meter();
    await bridge.copy(pw);
    setStatus('password', 'Made and copied — paste it somewhere safe (a password manager or notebook).', true);
  });
}

function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 5);
}

function meter() {
  const s = field.pw.value ? strength(field.pw.value) : 0;
  const bar = $('#pw-bar');
  bar.style.width = `${(s / 5) * 100}%`;
  bar.style.background = s <= 2 ? 'var(--bad)' : s === 3 ? 'var(--warn)' : 'var(--ok)';
}

function checkPassword(final) {
  const pw = field.pw.value;
  if (pw.length < 8) return final ? fail('password', 'Use at least 8 characters.', field.pw) : (setStatus('password', 'At least 8 characters', false), false);
  if (pw !== field.pw2.value) return final ? fail('password', 'The two passwords are different.', field.pw2) : (setStatus('password', 'Not the same yet', false), false);
  const s = strength(pw);
  setStatus('password', s <= 2 ? 'Matches — a longer one would be safer' : 'Strong — and both match', true);
  return true;
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)].map((g) => g.join('')).join('-');
}

// ---- links, copy, show/hide -------------------------------------------------------------------------------

function wireCommon() {
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-open]');
    if (link) {
      e.preventDefault();
      return bridge.openExternal(link.dataset.open);
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      e.preventDefault();
      await bridge.copy($(copy.dataset.copy).textContent.trim());
      const was = copy.textContent;
      copy.textContent = 'Copied ✓';
      setTimeout(() => (copy.textContent = was), 1500);
      return;
    }
    const eye = e.target.closest('[data-eye]');
    if (eye) {
      e.preventDefault();
      const input = $(eye.dataset.eye);
      input.type = input.type === 'password' ? 'text' : 'password';
      eye.textContent = input.type === 'password' ? 'Show' : 'Hide';
    }
  });
}

// ---- review + finish ----------------------------------------------------------------------------------------

function renderReview() {
  const host = (() => {
    try {
      return new URL(value.database().replace(/^postgres(ql)?:/, 'http:')).hostname;
    } catch {
      return 'set';
    }
  })();
  const mask = (s) => (s.length <= 6 ? '••••' : `${s.slice(0, 4)}••••${s.slice(-2)}`);
  const items = [
    { step: 'database', icon: '✓', title: 'Database', text: host },
    { step: 'kite', icon: '✓', title: 'Kite Connect', text: `key ${field.key.value.trim()} · secret ${mask(field.secret.value.trim())}` },
    { step: 'password', icon: '✓', title: 'Password', text: `${'•'.repeat(Math.min(field.pw.value.length, 16))} (${field.pw.value.length} characters)` },
    field.tg.value.trim()
      ? { step: 'telegram', icon: '✓', title: 'Telegram', text: field.chat.value.trim() ? `bot set · test chat ${field.chat.value.trim()}` : 'bot set — add chats in Settings' }
      : { step: 'telegram', icon: '–', title: 'Telegram', text: 'not set — can be added later', off: true },
    value.email()
      ? { step: 'email', icon: '✓', title: 'Email (Resend)', text: `key ${mask(value.email())}` }
      : { step: 'email', icon: '–', title: 'Email (Resend)', text: 'not set — can be added later', off: true },
  ];
  if (MODE === 'first') items.push({ step: 'terms', icon: '✓', title: 'Disclaimer', text: 'read and accepted' });
  const box = $('#review');
  box.innerHTML = '';
  items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = `rv${it.off ? ' off' : ''}`;
    el.style.animationDelay = `${i * 0.07}s`;
    el.innerHTML = `<span class="rv-ic">${it.icon}</span><div><b>${escapeHtml(it.title)}</b><small>${escapeHtml(it.text)}</small></div>`;
    if (it.step !== 'terms') {
      const change = document.createElement('button');
      change.className = 'mini';
      change.textContent = 'Change';
      change.addEventListener('click', () => !state.finishing && show(STEPS.findIndex((s) => s.id === it.step)));
      el.append(change);
    }
    box.append(el);
  });
  if (MODE === 'edit') {
    $('#finish-title').textContent = 'Save your changes';
    $('#finish-lead').textContent = 'Algo Hunt saves the settings (encrypted on this computer) and restarts with them.';
    $('#next-steps').classList.add('hidden');
  }
}

function wireFinish() {
  bridge.onProgress(onProgress);
  $('#b-retry').addEventListener('click', finish);
  $('#b-logs').addEventListener('click', () => bridge.openLogs());
  $('#b-back').addEventListener('click', () => {
    state.finishing = false;
    $('#progress').classList.add('hidden');
    $('#review').classList.remove('hidden');
    $('.nav').classList.remove('hidden');
    renderNav();
  });
}

async function finish() {
  if (state.finishing) return;
  state.finishing = true;
  $('#review').classList.add('hidden');
  $('.nav').classList.add('hidden');
  $('#p-actions').classList.add('hidden');
  $('#p-detail').classList.add('hidden');
  $('#b-link').classList.add('hidden');
  $('#done').classList.add('hidden');
  const progress = $('#progress');
  progress.classList.remove('hidden');
  for (const row of $$('.p-row')) {
    row.className = 'p-row';
    row.querySelector('em').textContent = '';
  }
  let result;
  try {
    result = await bridge.finish({
      databaseUrl: value.database(),
      kiteApiKey: field.key.value.trim(),
      kiteApiSecret: field.secret.value.trim(),
      appPassword: field.pw.value,
      telegramBotToken: field.tg.value.trim() || undefined,
      telegramChatId: field.chat.value.trim() || undefined,
      resendApiKey: value.email() || undefined,
      acceptedTermsAt: state.acceptedTermsAt ?? undefined,
    });
  } catch (err) {
    result = { ok: false, message: String(err?.message ?? err) };
  }
  if (result?.ok) {
    $('#done').classList.remove('hidden');
    $('.page.show .hero')?.classList.add('launch');
    confetti();
    $('#rail-bar').style.width = '100%';
    return;
  }
  if (result?.message && !$('.p-row.fail')) {
    const row = $('.p-row.run') ?? $('.p-row[data-p="save"]');
    row.className = 'p-row fail';
    row.querySelector('em').textContent = result.message;
  }
  $('#p-actions').classList.remove('hidden');
}

function onProgress(p) {
  const row = $(`.p-row[data-p="${p.step}"]`);
  if (!row) return;
  row.className = `p-row ${p.state}`;
  row.querySelector('em').textContent = p.state === 'fail' ? p.message ?? 'Failed' : p.message ?? (p.state === 'done' ? 'Done' : '');
  if (p.state !== 'fail') return;
  if (p.extra?.detail) {
    $('#p-detail').textContent = p.extra.detail;
    $('#p-detail').classList.remove('hidden');
  }
  if (p.extra?.link) {
    const b = $('#b-link');
    b.textContent = p.extra.link.label;
    b.dataset.open = p.extra.link.url;
    b.classList.remove('hidden');
  }
}

function confetti() {
  const colors = ['#1157f1', '#7aa7ff', '#12a150', '#ffd166', '#ff6b9a', '#0b1d4d'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 240}px`);
    c.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
    c.style.animationDuration = `${1.6 + Math.random() * 1.8}s`;
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 4200);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// ---- pretend bridge (plain browser / ?mock=1) -----------------------------------------------------------------

function mockBridge() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const failAt = params.get('fail'); // e.g. ?mock=1&fail=server
  const listeners = new Set();
  const emit = (step, s, message) => listeners.forEach((fn) => fn({ step, state: s, message }));
  return {
    load: async () => ({
      config:
        MODE === 'edit'
          ? { databaseUrl: 'postgresql://neondb_owner:secret@ep-quiet-sky-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require', kiteApiKey: 'abcd1234efgh5678', kiteApiSecret: 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6', appPassword: 'Kx7p-M2qa-Zr4t-Hn8w', telegramBotToken: '', acceptedTermsAt: '2026-10-04T10:00:00.000Z' }
          : null,
      system: { memoryGb: 16, cpus: 8, platform: 'win32', release: '10.0.22631', version: '1.0.0', git: '2.47.1', node: params.get('nonode') ? null : '24.11.0', toolsProblem: null },
    }),
    checkDatabase: async (url) => (await wait(900), /^postgres(ql)?:\/\//.test(url) ? { ok: true, message: 'Connected — PostgreSQL 17.5 on Neon · empty, ready to set up' } : { ok: false, message: 'That isn’t a database link — it starts with postgresql:// (copy it from Neon → Connect).' }),
    checkKite: async (k, s) => (await wait(300), k && s && k !== s ? { ok: true, message: 'Looks right — Kite confirms them when you log in at the end.' } : { ok: false, message: 'The key and the secret are different codes.' }),
    checkTelegram: async (t) => (await wait(700), /^\d{5,}:[\w-]{30,}$/.test(t) ? { ok: true, message: 'Bot @AlgoHuntBot found — test message sent.' } : { ok: false, message: 'A bot token looks like 123456789:AA… (from @BotFather, or your admin).' }),
    checkResend: async (k) => (await wait(600), /^re_/.test(k) ? { ok: true, message: 'Resend accepted the key.' } : { ok: false, message: 'Resend didn’t accept this key.' }),
    finish: async () => {
      const steps = [
        ['save', 'Saving…', 'Done'],
        ['latest', 'Downloading Algo Hunt — a minute or two…', 'Version c5dc181 from 2026-10-04'],
        ['install', 'added 412 packages in 48s', 'Packages installed'],
        ['build', '✓ Compiled successfully in 6.5s', 'Ready'],
        ['start', 'Starting Algo Hunt…', 'Running'],
      ];
      for (const [step, running, done] of steps) {
        emit(step, 'run', running);
        await wait(step === 'build' ? 1600 : 900);
        if (failAt === step) {
          const fails = {
            latest: ['Node.js isn’t installed on this computer. Install the LTS version, then press Try again.', { link: { label: 'Download Node.js', url: 'https://nodejs.org/en/download' } }],
            build: ['Preparing the app failed. Press Try again; if it keeps failing, send the details to your admin.', { detail: 'Type error: Property \'x\' does not exist on type \'Y\'.\n  at src/app/page.tsx:12:5\nnext build failed' }],
          };
          const [message, extra] = fails[step] ?? ['Algo Hunt didn’t start. “Open logs” shows why — send the server.log file to your admin.', {}];
          listeners.forEach((fn) => fn({ step, state: 'fail', message, extra }));
          return { ok: false };
        }
        emit(step, 'done', done);
      }
      return { ok: true };
    },
    onProgress: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    retry: async () => undefined,
    settings: async () => undefined,
    openLogs: async () => undefined,
    quit: async () => undefined,
    openExternal: async (url) => void window.open(url, '_blank'),
    copy: async (text) => navigator.clipboard?.writeText(text).catch(() => undefined),
  };
}

init().catch((err) => console.error(err));
