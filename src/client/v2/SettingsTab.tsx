'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, CalendarPlus, Check, Copy, Database, ExternalLink, Plus, Save, Search, Send, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { CalendarEntry, DatabaseInfo, Market, TelegramChat, V2Settings } from '@/shared/v2';
import { DEFAULT_TELEGRAM_BOT, HISTORY_DAY_CHOICES } from '@/shared/v2';
import { FieldLabel, InfoTip, Tooltip } from '../components/Tooltip';
import { Card, IconButton } from '../components/ui';
import { v2Api } from './api';
import { istToday, minutesToClock } from './format';
import { H } from './help';
import { InlineSpinner, SkeletonCards } from '../components/loaders';

const clockToMinutes = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const cleanChats = (list: TelegramChat[]) => list.filter((c) => c.id.trim()).map((c) => ({ id: c.id.trim(), name: c.name?.trim() || undefined }));

/** Telegram recipients: named chats, a finder for chat ids, and a per-chat test. */
function TelegramChatsEditor({ chats, onChange, saved, detail, configured }: { chats: TelegramChat[]; onChange: (c: TelegramChat[]) => void; saved: TelegramChat[]; detail?: string; configured: boolean }) {
  const find = useMutation({ mutationFn: v2Api.telegramChats });
  const test = useMutation({ mutationFn: () => v2Api.testChannel('telegram') });
  const bot = useQuery({ queryKey: ['v2-telegram-bot'], queryFn: v2Api.telegramBot, staleTime: 10 * 60_000 });
  const handle = bot.data?.username ?? DEFAULT_TELEGRAM_BOT;
  const link = `https://t.me/${handle}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible to copy by hand */
    }
  };
  const set = (i: number, patch: Partial<TelegramChat>) => onChange(chats.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const has = (id: string) => chats.some((c) => c.id.trim() === id);
  const dirty = JSON.stringify(cleanChats(chats)) !== JSON.stringify(cleanChats(saved));
  return (
    <div className="md:col-span-2">
      <FieldLabel help={H.settings.telegramChats}>Telegram chats</FieldLabel>
      <div className="mb-3 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-slate-300">
        <p className="mb-1.5 font-semibold text-slate-200">
          Connect Telegram · our bot is <span className="text-accent-soft">@{handle}</span>
        </p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>
            Each person opens <b>@{handle}</b> in Telegram and presses <b>Start</b>. For a group, add @{handle} to the group and send a message there.
          </li>
          <li>
            Press <b>Find chat IDs</b> below and <b>Add</b> them (or type a chat id).
          </li>
          <li>
            Give each a name if you like, then <b>Save</b> — every alert goes to all of them.
          </li>
        </ol>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Tooltip content={H.settings.openBot}>
            <a href={link} target="_blank" rel="noreferrer" className="btn-primary py-1 text-xs">
              <Send className="h-3.5 w-3.5" /> Open @{handle}
            </a>
          </Tooltip>
          <Tooltip content={H.settings.openBotWeb}>
            <a href={`https://web.telegram.org/k/#@${handle}`} target="_blank" rel="noreferrer" className="btn-ghost py-1 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> Telegram Web
            </a>
          </Tooltip>
          <Tooltip content={H.settings.copyBotLink}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </Tooltip>
          <span className="font-mono text-[11px] text-slate-500">{link}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {chats.map((c, i) => (
          <div key={i} className="flex gap-2">
            <Tooltip content={H.settings.chatName}>
              <input aria-label="Name" className="input w-44" placeholder="Name (optional)" value={c.name ?? ''} onChange={(e) => set(i, { name: e.target.value })} />
            </Tooltip>
            <Tooltip content={H.settings.chatId} className="flex flex-1">
              <input aria-label="Chat id" className="input flex-1 font-mono" placeholder="123456789 or -1001234567890" value={c.id} onChange={(e) => set(i, { id: e.target.value })} />
            </Tooltip>
            <IconButton help={H.settings.removeChat} onClick={() => onChange(chats.filter((_, j) => j !== i))} className="btn-ghost px-2">
              <Trash2 className="w-4 h-4" />
            </IconButton>
          </div>
        ))}
        {chats.length === 0 && <p className="text-xs text-slate-500">No chats added{configured ? ' — alerts go to TELEGRAM_CHAT_ID from the server' : ''}.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip content={H.settings.addChat}>
            <button type="button" className="btn-ghost text-xs" disabled={chats.length >= 20} onClick={() => onChange([...chats, { id: '' }])}>
              <Plus className="w-4 h-4" /> Add chat
            </button>
          </Tooltip>
          <Tooltip content={H.settings.findChats}>
            <button type="button" className="btn-ghost text-xs" disabled={find.isPending} onClick={() => find.mutate()}>
              {find.isPending ? <InlineSpinner /> : <Search className="w-4 h-4" />} Find chat IDs
            </button>
          </Tooltip>
          <Tooltip content={dirty ? { ...H.settings.testTelegram, note: 'Save first — the test uses the saved chats.' } : H.settings.testTelegram}>
            <button type="button" className="btn-ghost text-xs" disabled={test.isPending || dirty || !configured} onClick={() => test.mutate()}>
              {test.isPending ? <InlineSpinner /> : <Send className="w-4 h-4" />} Send test to all
            </button>
          </Tooltip>
          {dirty && <span className="text-[11px] text-warn">Unsaved changes</span>}
        </div>
        {detail && <p className={clsx('text-[11px]', configured ? 'text-slate-500' : 'text-warn')}>{detail}</p>}
        {test.data && (
          <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-2 text-xs">
            {test.data.results.map((r, i) => (
              <p key={i} className={r.ok ? 'text-slate-300' : 'text-bear'}>
                {r.ok ? '✓' : '✗'} {r.target ?? 'Telegram'}
                {r.error ? ` — ${r.error}` : ' — received'}
              </p>
            ))}
          </div>
        )}
        {test.error && <p className="text-xs text-bear">{(test.error as Error).message}</p>}
        {find.error && <p className="text-xs text-bear">{(find.error as Error).message}</p>}
        {find.data && (
          <div className="rounded-lg border border-ink-700/60 bg-ink-850 p-2">
            {find.data.length === 0 ? (
              <p className="text-xs text-slate-500">
                No recent chats. Ask each person to open <b>@{handle}</b> in Telegram and press <b>Start</b> (or send it any message) — for a group, add @{handle} and send a message there — then press Find chat IDs again.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-ink-700/50">
                {find.data.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-1.5 text-xs">
                    <span className="font-medium text-slate-200">{c.name}</span>
                    <span className="text-slate-500">
                      {c.type === 'private' ? 'person' : c.type}
                      {c.username ? ` · @${c.username}` : ''}
                    </span>
                    <span className="font-mono text-slate-400">{c.id}</span>
                    <Tooltip content={has(c.id) ? { title: 'Already added', body: 'This chat is in the list.' } : { title: 'Add', body: `Send alerts to ${c.name} too (after you save).` }}>
                      <button type="button" className="btn-ghost ml-auto py-1 text-xs" disabled={has(c.id)} onClick={() => onChange([...chats.filter((x) => x.id.trim()), { id: c.id, name: c.name }])}>
                        {has(c.id) ? 'Added' : <><Plus className="w-3.5 h-3.5" /> Add</>}
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelsCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['v2-settings'], queryFn: v2Api.settings });
  const channels = useQuery({ queryKey: ['v2-channels'], queryFn: v2Api.channels });
  const [form, setForm] = useState<V2Settings | null>(null);
  const [emails, setEmails] = useState('');
  useEffect(() => {
    if (settings.data && !form) {
      setForm(settings.data);
      setEmails(settings.data.emailRecipients.join(', '));
    }
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (s: V2Settings) => v2Api.saveSettings(s),
    onSuccess: (s) => {
      setForm(s);
      qc.invalidateQueries({ queryKey: ['v2-settings'] });
      qc.invalidateQueries({ queryKey: ['v2-channels'] });
      qc.invalidateQueries({ queryKey: ['v2-status'] });
    },
  });
  const test = useMutation({ mutationFn: (c: 'telegram' | 'email') => v2Api.testChannel(c) });

  if (!form) return <SkeletonCards count={2} lines={3} />;
  const submit = () =>
    save.mutate({
      ...form,
      telegramChats: cleanChats(form.telegramChats),
      emailRecipients: emails
        .split(/[,\s]+/)
        .map((e) => e.trim())
        .filter(Boolean),
    });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-slate-300">Alert destinations &amp; limits</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TelegramChatsEditor
          chats={form.telegramChats}
          onChange={(telegramChats) => setForm({ ...form, telegramChats })}
          saved={settings.data?.telegramChats ?? []}
          detail={channels.data?.telegram.detail}
          configured={channels.data?.telegram.configured ?? false}
        />
        <div>
          <FieldLabel help={H.settings.emailTo} htmlFor="em">
            Email recipients
          </FieldLabel>
          <div className="flex gap-2">
            <input id="em" className="input w-full" placeholder="you@example.com, desk@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} />
            <Tooltip content={H.settings.test}>
              <button type="button" className="btn-ghost" disabled={test.isPending} onClick={() => test.mutate('email')}>
                <Send className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
          <p className={clsx('text-[11px] mt-1', channels.data?.email.configured ? 'text-slate-500' : 'text-warn')}>{channels.data?.email.detail}</p>
        </div>
        <div>
          <FieldLabel help={H.settings.emailFrom} htmlFor="from">
            Email sender
          </FieldLabel>
          <input id="from" className="input w-full" value={form.emailFrom} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })} />
        </div>
        <div>
          <FieldLabel help={H.settings.budget} htmlFor="budget">
            Requests / cycle
          </FieldLabel>
          <input id="budget" type="number" min={10} max={600} className="input w-full" value={form.requestBudget} onChange={(e) => setForm({ ...form, requestBudget: Number(e.target.value) })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Tooltip content={H.settings.save}>
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? <InlineSpinner /> : <Save className="w-4 h-4" />} Save
          </button>
        </Tooltip>
        {save.isSuccess && <span className="text-xs text-bull">Saved</span>}
        {save.error && <span className="text-xs text-bear">{(save.error as Error).message}</span>}
        {test.isSuccess && <span className="text-xs text-bull">Test email sent</span>}
        {test.error && <span className="text-xs text-bear">{(test.error as Error).message}</span>}
      </div>
    </Card>
  );
}

function CalendarCard() {
  const qc = useQueryClient();
  const cal = useQuery({ queryKey: ['v2-calendar'], queryFn: v2Api.calendar });
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  useEffect(() => {
    if (cal.data && !entries) setEntries(cal.data);
  }, [cal.data, entries]);
  const save = useMutation({
    mutationFn: (e: CalendarEntry[]) => v2Api.saveCalendar(e),
    onSuccess: (e) => {
      setEntries(e);
      qc.invalidateQueries({ queryKey: ['v2-calendar'] });
      qc.invalidateQueries({ queryKey: ['v2-status'] });
    },
  });
  if (!entries) return <SkeletonCards count={1} lines={3} />;
  const update = (i: number, e: CalendarEntry) => setEntries(entries.map((x, j) => (j === i ? e : x)));

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-300">Market calendar</h2>
        <InfoTip content={H.settings.calendar} />
        <div className="ml-auto flex gap-2">
          <Tooltip content={H.settings.addHoliday}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setEntries([...entries, { market: 'NSE', date: istToday(), kind: 'HOLIDAY', note: '' }])}>
              <CalendarOff className="w-3.5 h-3.5" /> Holiday
            </button>
          </Tooltip>
          <Tooltip content={H.settings.addSpecial}>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setEntries([...entries, { market: 'NSE', date: istToday(), kind: 'SPECIAL_SESSION', openMin: 18 * 60, closeMin: 19 * 60 + 15, note: '' }])}>
              <CalendarPlus className="w-3.5 h-3.5" /> Special session
            </button>
          </Tooltip>
        </div>
      </div>
      {entries.length === 0 && <p className="text-xs text-slate-500">No overrides — NSE / BSE weekdays 09:15–15:30; MCX weekdays 09:00–23:30 (US summer) / 23:55 (US winter) IST.</p>}
      {entries.map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Tooltip content={{ title: 'Market', body: 'Which market this entry applies to.' }}>
            <select aria-label="Market" className="input py-1 text-xs" value={e.market} onChange={(x) => update(i, { ...e, market: x.target.value as Market })}>
              <option value="NSE">NSE / BSE</option>
              <option value="MCX">MCX</option>
            </select>
          </Tooltip>
          <input type="date" aria-label="Date" className="input py-1 text-xs" value={e.date} onChange={(x) => update(i, { ...e, date: x.target.value })} />
          <span className={clsx('text-xs font-medium w-28', e.kind === 'HOLIDAY' ? 'text-warn' : 'text-accent-soft')}>{e.kind === 'HOLIDAY' ? 'Holiday' : 'Special session'}</span>
          {e.kind === 'SPECIAL_SESSION' && (
            <>
              <input type="time" aria-label="Opens" className="input py-1 text-xs" value={minutesToClock(e.openMin)} onChange={(x) => update(i, { ...e, openMin: clockToMinutes(x.target.value) })} />
              <span className="text-xs text-slate-500">to</span>
              <input type="time" aria-label="Closes" className="input py-1 text-xs" value={minutesToClock(e.closeMin)} onChange={(x) => update(i, { ...e, closeMin: clockToMinutes(x.target.value) })} />
            </>
          )}
          <input aria-label="Note" className="input py-1 text-xs flex-1 min-w-[10rem]" placeholder="Note (e.g. Diwali)" value={e.note ?? ''} onChange={(x) => update(i, { ...e, note: x.target.value })} />
          <IconButton help={{ title: 'Remove', body: 'Remove this calendar entry.' }} onClick={() => setEntries(entries.filter((_, j) => j !== i))} className="p-1.5 rounded-md text-slate-500 hover:text-bear hover:bg-bear/10">
            <Trash2 className="w-4 h-4" />
          </IconButton>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Tooltip content={H.settings.save}>
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(entries.map((e) => ({ ...e, note: e.note || undefined })))}>
            {save.isPending ? <InlineSpinner /> : <Save className="w-4 h-4" />} Save calendar
          </button>
        </Tooltip>
        {save.isSuccess && <span className="text-xs text-bull">Saved</span>}
        {save.error && <span className="text-xs text-bear">{(save.error as Error).message}</span>}
      </div>
    </Card>
  );
}

const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const historyLabel = (days: number | null) =>
  days === null ? 'Everything (default)' : days % 365 === 0 ? `${days / 365} year${days === 365 ? '' : 's'}` : days % 30 === 0 ? `${days / 30} month${days === 30 ? '' : 's'}` : `${days} days`;
const istTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Database: space used (vs Neon's free 0.5 GB), how long history is kept, records waiting to be saved. */
function DatabaseCard() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['v2-database'], queryFn: v2Api.database, staleTime: 10 * 60_000 });
  const save = useMutation({
    mutationFn: (days: number | null) => v2Api.setHistoryDays(days),
    onSuccess: (d) => {
      qc.setQueryData(['v2-database'], d);
      qc.invalidateQueries({ queryKey: ['v2-alerts'] });
      qc.invalidateQueries({ queryKey: ['v2-signals'] });
      qc.invalidateQueries({ queryKey: ['v2-paper'] });
    },
  });
  const d: DatabaseInfo | undefined = info.data;
  const pick = (v: string) => {
    const days = v === 'all' ? null : Number(v);
    if (days !== null && !window.confirm(`Delete alerts, signals and closed paper trades older than ${historyLabel(days).toLowerCase()} — now and then every day? This cannot be undone. Strategies, connections, settings and open trades are kept.`)) return;
    save.mutate(days);
  };
  const pct = d?.bytes != null && d.limitBytes ? Math.min(100, (d.bytes / d.limitBytes) * 100) : null;
  const where = d?.engine === 'postgres' ? (d.limitBytes ? 'Neon (free plan)' : 'Postgres') : 'Memory';

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-300">Database</h2>
        <InfoTip content={H.settings.database} />
        {d && <span className="text-xs text-slate-500">· {where}</span>}
      </div>
      {info.isLoading && <SkeletonCards count={1} lines={2} />}
      {info.error && <p className="text-xs text-bear">{(info.error as Error).message}</p>}
      {d && (
        <>
          <div className="flex flex-col gap-1.5">
            <FieldLabel help={H.settings.dbSize}>Space used</FieldLabel>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tabular-nums text-slate-200">
                {d.bytes == null ? '—' : fmtBytes(d.bytes)}
                {d.limitBytes ? <span className="font-normal text-slate-500"> of {fmtBytes(d.limitBytes)}</span> : null}
              </span>
              {pct !== null && (
                <div className="h-2 w-48 max-w-full overflow-hidden rounded-full bg-ink-700" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Space used">
                  <div className={clsx('h-full rounded-full', pct >= 80 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
              )}
              {pct !== null && <span className={clsx('text-xs tabular-nums', pct >= 80 ? 'font-semibold text-warn' : 'text-slate-500')}>{pct.toFixed(0)} %</span>}
            </div>
            {d.tables.length > 0 && (
              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">
                  <Tooltip content={H.settings.dbTables}>
                    <span>Largest tables</span>
                  </Tooltip>
                </summary>
                <ul className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {d.tables.slice(0, 8).map((t) => (
                    <li key={t.name} className="flex justify-between gap-3 tabular-nums">
                      <span className="truncate font-mono text-slate-400">{t.name}</span>
                      <span className="text-slate-500">{fmtBytes(t.bytes)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FieldLabel help={H.settings.history}>Keep history</FieldLabel>
            <Tooltip content={H.settings.history}>
              <select aria-label="Keep history" className="input py-1 text-xs" value={d.historyDays === null ? 'all' : String(d.historyDays)} disabled={save.isPending} onChange={(e) => pick(e.target.value)}>
                <option value="all">{historyLabel(null)}</option>
                {[...new Set([...HISTORY_DAY_CHOICES, ...(d.historyDays ? [d.historyDays] : [])])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {historyLabel(n)}
                    </option>
                  ))}
              </select>
            </Tooltip>
            {save.isPending && <InlineSpinner />}
            {save.error && <span className="text-xs text-bear">{(save.error as Error).message}</span>}
            {d.lastPrune && (
              <span className="text-xs text-slate-500">
                Last clean-up {istTime(d.lastPrune.at)}: {d.lastPrune.alerts} alert(s), {d.lastPrune.signals} signal(s), {d.lastPrune.paperTrades} paper trade(s) removed
              </span>
            )}
          </div>
          {d.pending && (d.pending.count > 0 || d.pending.dropped > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs text-slate-300">
              <InfoTip content={H.settings.pending} />
              <p>
                {d.pending.count > 0 && (
                  <>
                    <b className="text-warn">{d.pending.count} record(s) waiting to be saved</b>
                    {d.pending.failingSince ? ` — the database can’t be reached since ${istTime(d.pending.failingSince)}` : ' — saving now'}
                    {d.pending.lastError ? ` (${d.pending.lastError})` : ''}.{' '}
                  </>
                )}
                {d.pending.dropped > 0 && `${d.pending.dropped} record(s) were refused by the database since the app started (see the app’s log).`}
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function SettingsTab() {
  return (
    <div className="flex flex-col gap-4">
      <ChannelsCard />
      <DatabaseCard />
      <CalendarCard />
    </div>
  );
}
