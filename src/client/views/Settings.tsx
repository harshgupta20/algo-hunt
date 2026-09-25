'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Send, Volume2 } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import type { UserPreferences } from '@ash/shared';
import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, PageHeader, Spinner, Help } from '../components/ui';
import { KiteConnectionCard } from '../components/KiteConnectionCard';
import { playChime, requestNotificationPermission, showNotification } from '../lib/notify';
import { useLive } from '../context/LiveContext';
import { useThemePreference } from '../theme/useThemePreference';
import { InfoTip, Tooltip, type TooltipContent } from '../components/Tooltip';
import { HELP } from '../lib/help';

function Toggle({
  label,
  hint,
  checked,
  onChange,
  help,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help: TooltipContent;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="flex items-center gap-1.5 text-sm text-slate-200">
          {label} <InfoTip content={help} />
        </div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <Tooltip content={{ title: `${label}: ${checked ? 'on' : 'off'}`, body: checked ? 'Click to turn off.' : 'Click to turn on.' }} side="left">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-ink-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
      </Tooltip>
    </div>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const prefsQuery = useQuery({ queryKey: ['preferences'], queryFn: api.getPreferences });
  const { status: live } = useLive();
  const { theme, setTheme } = useThemePreference();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);

  useEffect(() => {
    if (prefsQuery.data) setPrefs(prefsQuery.data);
  }, [prefsQuery.data]);

  const saveMut = useMutation({
    mutationFn: (p: UserPreferences) => api.savePreferences(p),
    onSuccess: (p) => qc.setQueryData(['preferences'], p),
  });

  const update = (patch: Partial<UserPreferences>) => {
    // The theme is owned by useThemePreference; always save the one on screen.
    const next = { ...prefs, ...patch, theme };
    setPrefs(next);
    saveMut.mutate(next);
  };

  const testNotification = async () => {
    await requestNotificationPermission();
    showNotification('Algo Hunt test notification', 'Browser notifications are working.');
  };

  if (prefsQuery.isLoading) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Broker connection, appearance, notifications and runtime information." />

      <KiteConnectionCard />

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Notifications</h2>
        <div className="divide-y divide-ink-700/50">
          <Toggle
            label="Browser notifications"
            hint="Show a desktop notification when the strategy triggers."
            checked={prefs.browserNotifications}
            onChange={(v) => update({ browserNotifications: v })}
            help={HELP.settings.browserNotifications}
          />
          <Toggle
            label="Sound alert"
            hint="Play a chime on each new alert."
            checked={prefs.soundEnabled}
            onChange={(v) => update({ soundEnabled: v })}
            help={HELP.settings.sound}
          />
          <Toggle
            label="Dark theme"
            hint="Light is the default. Also available from the sun/moon button in the top bar."
            checked={theme === 'dark'}
            onChange={(v) => setTheme(v ? 'dark' : 'light')}
            help={HELP.settings.darkTheme}
          />
        </div>
        <div className="flex gap-2 mt-4">
          <Help content={HELP.settings.testNotification}>
            <button className="btn-ghost text-xs" onClick={testNotification}>
              <Bell className="w-4 h-4" /> Test notification
            </button>
          </Help>
          <Help content={HELP.settings.testSound}>
            <button className="btn-ghost text-xs" onClick={() => playChime()}>
              <Volume2 className="w-4 h-4" /> Test sound
            </button>
          </Help>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Live Evaluator</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="flex items-center gap-1 text-slate-400">
              Market session <InfoTip content={HELP.settings.marketSession} />
            </span>
            <Badge tone={live?.marketOpen ? 'bull' : 'default'}>{live ? (live.marketOpen ? 'open' : 'closed') : '—'}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="flex items-center gap-1 text-slate-400">
              Active monitors <InfoTip content={HELP.stats.activeMonitors} />
            </span>
            <Badge tone="accent">{live?.activeMonitors ?? '—'}</Badge>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="flex items-center gap-1 text-slate-400">
              Last evaluator run <InfoTip content={HELP.settings.lastRun} />
            </span>
            <span className="text-slate-300 text-xs">
              {live?.lastRunAt
                ? `${formatDistanceToNowStrict(new Date(live.lastRunAt))} ago · ${live.lastRunSummary?.monitors ?? 0} monitors · ${live.lastRunSummary?.alerts ?? 0} alerts${live.lastRunSummary?.errors ? ` · ${live.lastRunSummary.errors} errors` : ''}`
                : 'never'}
            </span>
          </div>
        </div>
        <p className="mt-3 pt-3 border-t border-ink-700/60 text-[11px] text-slate-500 leading-relaxed">
          Monitors are evaluated on every closed candle by <code className="text-accent-soft">/api/cron/tick</code>, which a
          scheduler should call every minute during market hours (Vercel Cron on Pro, or a free service such as
          cron-job.org). While this dashboard is open it also triggers evaluation itself, so alerts keep flowing even
          without a scheduler.
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-300 mb-1">Server-side channels</h2>
        <p className="text-xs text-slate-500 mb-3">
          Delivered by the server, so they reach you even when no dashboard is open.
        </p>
        <div className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-slate-300">
            <Send className="w-4 h-4 text-slate-500" /> Telegram <InfoTip content={HELP.settings.telegram} />
          </span>
          {live?.channels.includes('telegram') ? (
            <Badge tone="bull">enabled</Badge>
          ) : (
            <span className="text-xs text-slate-500">
              set <code>TELEGRAM_BOT_TOKEN</code> + <code>TELEGRAM_CHAT_ID</code> to enable
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
