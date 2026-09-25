'use client';

import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { api } from '../lib/api';
import { useLive, type LiveHealth } from '../context/LiveContext';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { AlertItem } from '../components/AlertItem';
import { Tooltip, type TooltipContent } from '../components/Tooltip';
import { HELP } from '../lib/help';

const HEALTH_HELP: Record<LiveHealth, TooltipContent> = {
  live: HELP.topbar.live,
  stale: HELP.topbar.stale,
  'market-closed': HELP.topbar.marketClosed,
  'kite-offline': HELP.topbar.kiteOffline,
  unknown: HELP.topbar.connecting,
};

const HEALTH: Record<LiveHealth, { label: string; tone: 'bull' | 'warn' | 'bear' | 'default' }> = {
  live: { label: 'monitoring', tone: 'bull' },
  stale: { label: 'scheduler idle', tone: 'warn' },
  'market-closed': { label: 'market closed', tone: 'default' },
  'kite-offline': { label: 'kite offline', tone: 'bear' },
  unknown: { label: 'connecting', tone: 'default' },
};

export function LiveAlerts() {
  const { health } = useLive();
  const alerts = useQuery({ queryKey: ['alerts', {}], queryFn: () => api.listAlerts() });

  return (
    <div>
      <PageHeader
        title="Live Alerts"
        subtitle="Newest first. Each combined alert represents the full strategy firing — never a single leg."
        actions={
          <Tooltip content={HEALTH_HELP[health]} side="left">
            <Badge tone={HEALTH[health].tone}>
              <Radio className="w-3 h-3 mr-1" /> {HEALTH[health].label}
            </Badge>
          </Tooltip>
        }
      />

      {alerts.isLoading ? (
        <Spinner />
      ) : (alerts.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="Waiting for alerts"
            hint="When Future, Call and Put RSI align on a closed candle, a single alert appears here within seconds of the candle closing."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {alerts.data!.map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}
