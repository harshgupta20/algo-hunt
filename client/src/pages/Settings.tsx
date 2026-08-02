import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Volume2 } from 'lucide-react';
import type { UserPreferences } from '@ash/shared';
import { DEFAULT_USER_PREFERENCES } from '@ash/shared';
import { api } from '../lib/api';
import { Badge, Card, PageHeader, Spinner } from '../components/ui';
import { KiteConnectionCard } from '../components/KiteConnectionCard';
import { playChime, requestNotificationPermission, showNotification } from '../lib/notify';

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-3 cursor-pointer">
      <div>
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-ink-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const prefsQuery = useQuery({ queryKey: ['preferences'], queryFn: api.getPreferences });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);

  useEffect(() => {
    if (prefsQuery.data) setPrefs(prefsQuery.data);
  }, [prefsQuery.data]);

  const saveMut = useMutation({
    mutationFn: (p: UserPreferences) => api.savePreferences(p),
    onSuccess: (p) => qc.setQueryData(['preferences'], p),
  });

  const update = (patch: Partial<UserPreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveMut.mutate(next);
  };

  const testNotification = async () => {
    await requestNotificationPermission();
    showNotification('ASH test notification', 'Browser notifications are working.');
  };

  if (prefsQuery.isLoading) return <Spinner />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Broker connection, notifications and runtime information." />

      <KiteConnectionCard />

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Notifications</h2>
        <div className="divide-y divide-ink-700/50">
          <Toggle
            label="Browser notifications"
            hint="Show a desktop notification when the strategy triggers."
            checked={prefs.browserNotifications}
            onChange={(v) => update({ browserNotifications: v })}
          />
          <Toggle
            label="Sound alert"
            hint="Play a chime on each new alert."
            checked={prefs.soundEnabled}
            onChange={(v) => update({ soundEnabled: v })}
          />
          <Toggle
            label="Dark theme"
            hint="Interface theme preference."
            checked={prefs.theme === 'dark'}
            onChange={(v) => update({ theme: v ? 'dark' : 'light' })}
          />
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-ghost text-xs" onClick={testNotification}>
            <Bell className="w-4 h-4" /> Test notification
          </button>
          <button className="btn-ghost text-xs" onClick={() => playChime()}>
            <Volume2 className="w-4 h-4" /> Test sound
          </button>
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Runtime</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Market provider</span>
            <Badge tone="accent">{health.data?.provider ?? '—'}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Data store</span>
            <Badge>{health.data?.store ?? '—'}</Badge>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-300 mb-1">Additional channels</h2>
        <p className="text-xs text-slate-500 mb-3">On the roadmap — the notification layer already supports pluggable channels.</p>
        <div className="flex flex-wrap gap-2">
          {['Telegram', 'Email', 'WhatsApp', 'Firebase Push'].map((c) => (
            <span key={c} className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs text-slate-500">
              {c} · soon
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
