import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Alert, ProviderStatus, RsiUpdatePayload, UserPreferences } from '@ash/shared';
import { getSocket } from '../lib/socket';
import { playChime, showNotification } from '../lib/notify';

interface LiveValue {
  status: ProviderStatus;
  rsiByConfig: Record<string, RsiUpdatePayload>;
  subscribeConfig: (id: string) => void;
  unsubscribeConfig: (id: string) => void;
}

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ProviderStatus>('connecting');
  const [rsiByConfig, setRsiByConfig] = useState<Record<string, RsiUpdatePayload>>({});
  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    const onStatus = (s: ProviderStatus) => setStatus(s);
    const onRsi = (p: RsiUpdatePayload) => setRsiByConfig((prev) => ({ ...prev, [p.configId]: p }));
    const onAlert = (a: Alert) => {
      qc.setQueryData<Alert[]>(['alerts', {}], (old) => (old ? [a, ...old] : [a]));
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      const prefs = qc.getQueryData<UserPreferences>(['preferences']);
      if (prefs?.browserNotifications !== false) {
        showNotification(a.title, `Scenario ${a.scenario} · ${a.underlying} ${a.strike} · ${a.timeframe}`);
      }
      if (prefs?.soundEnabled !== false) playChime();
    };
    const onConnect = () => setStatus((s) => (s === 'disconnected' ? 'connecting' : s));
    const onDisconnect = () => setStatus('disconnected');

    socket.on('status:provider', onStatus);
    socket.on('rsi:update', onRsi);
    socket.on('alert:new', onAlert);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('status:provider', onStatus);
      socket.off('rsi:update', onRsi);
      socket.off('alert:new', onAlert);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket, qc]);

  const value = useMemo<LiveValue>(
    () => ({
      status,
      rsiByConfig,
      subscribeConfig: (id) => socket.emit('subscribe:config', id),
      unsubscribeConfig: (id) => socket.emit('unsubscribe:config', id),
    }),
    [status, rsiByConfig, socket],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error('useLive must be used within LiveProvider');
  return v;
}
