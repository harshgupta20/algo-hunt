import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { api } from '../lib/api';
import { useLive } from '../context/LiveContext';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { AlertItem } from '../components/AlertItem';

export function LiveAlerts() {
  const { status } = useLive();
  const alerts = useQuery({ queryKey: ['alerts', {}], queryFn: () => api.listAlerts() });

  return (
    <div>
      <PageHeader
        title="Live Alerts"
        subtitle="Newest first. Each combined alert represents the full strategy firing — never a single leg."
        actions={
          <Badge tone={status === 'connected' ? 'bull' : 'warn'}>
            <Radio className="w-3 h-3 mr-1" /> {status}
          </Badge>
        }
      />

      {alerts.isLoading ? (
        <Spinner />
      ) : (alerts.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="Waiting for alerts"
            hint="When Future, Call and Put RSI align on a closed candle, a single alert appears here instantly."
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
