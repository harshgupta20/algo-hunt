'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, CalendarPlus, Loader2, Save, Send, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { CalendarEntry, Market, V2Settings } from '@/shared/v2';
import { FieldLabel, InfoTip, Tooltip } from '../components/Tooltip';
import { Card, IconButton, Spinner } from '../components/ui';
import { v2Api } from './api';
import { istToday, minutesToClock } from './format';
import { H } from './help';

const clockToMinutes = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

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

  if (!form) return <Spinner />;
  const submit = () =>
    save.mutate({
      ...form,
      telegramChatId: form.telegramChatId?.trim() || undefined,
      emailRecipients: emails
        .split(/[,\s]+/)
        .map((e) => e.trim())
        .filter(Boolean),
    });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-slate-300">Alert destinations &amp; limits</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <FieldLabel help={H.settings.telegramChat} htmlFor="tg">
            Telegram chat id
          </FieldLabel>
          <div className="flex gap-2">
            <input id="tg" className="input w-full" placeholder="From TELEGRAM_CHAT_ID" value={form.telegramChatId ?? ''} onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })} />
            <Tooltip content={H.settings.test}>
              <button type="button" className="btn-ghost" disabled={test.isPending} onClick={() => test.mutate('telegram')}>
                <Send className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
          <p className={clsx('text-[11px] mt-1', channels.data?.telegram.configured ? 'text-slate-500' : 'text-warn')}>{channels.data?.telegram.detail}</p>
        </div>
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
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </Tooltip>
        {save.isSuccess && <span className="text-xs text-bull">Saved</span>}
        {save.error && <span className="text-xs text-bear">{(save.error as Error).message}</span>}
        {test.isSuccess && <span className="text-xs text-bull">Test message sent</span>}
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
  if (!entries) return <Spinner />;
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
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save calendar
          </button>
        </Tooltip>
        {save.isSuccess && <span className="text-xs text-bull">Saved</span>}
        {save.error && <span className="text-xs text-bear">{(save.error as Error).message}</span>}
      </div>
    </Card>
  );
}

export function SettingsTab() {
  return (
    <div className="flex flex-col gap-4">
      <ChannelsCard />
      <CalendarCard />
    </div>
  );
}
