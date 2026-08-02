import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, PageHeader, Spinner } from '../components/ui';

export function Strategies() {
  const strategies = useQuery({ queryKey: ['strategies'], queryFn: api.strategies });

  return (
    <div>
      <PageHeader
        title="Strategies"
        subtitle="Pluggable strategy engine. New strategies register without changing the pipeline."
      />

      {strategies.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {strategies.data?.map((s) => (
            <Card key={s.key}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                  <Workflow className="w-5 h-5 text-accent-soft" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-white font-semibold">{s.name}</h2>
                    <Badge tone="accent">{s.key}</Badge>
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{s.description}</p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                    <Param label="RSI Period" value={s.defaultParams.rsiPeriod} />
                    <Param label="Future Level" value={s.defaultParams.futureLevel} />
                    <Param label="Call Level" value={s.defaultParams.callLevel} />
                    <Param label="Put Level" value={s.defaultParams.putLevel} />
                  </div>

                  <div className="mt-4 space-y-2">
                    {s.scenarios.map((sc) => (
                      <div key={sc.id} className="flex gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-bull shrink-0 mt-0.5" />
                        <div>
                          <span className="text-slate-200 font-medium">
                            Scenario {sc.id}: {sc.title}
                          </span>
                          <p className="text-slate-400 text-xs mt-0.5">{sc.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Param({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-ink-850 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}
