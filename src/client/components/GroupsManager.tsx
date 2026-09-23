import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { Badge, Card, Spinner } from './ui';

export function GroupsManager() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });
  const underlyings = useQuery({ queryKey: ['underlyings'], queryFn: api.underlyings });
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['groups'] });
  const create = useMutation({
    mutationFn: () => api.createGroup({ name, members }),
    onSuccess: () => {
      setName('');
      setMembers([]);
      invalidate();
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteGroup(id), onSuccess: invalidate });

  const toggle = (sym: string) =>
    setMembers((m) => (m.includes(sym) ? m.filter((x) => x !== sym) : [...m, sym]));

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-300 mb-1 flex items-center gap-2">
        <Layers className="w-4 h-4" /> Underlying Groups
      </h2>
      <p className="text-xs text-slate-500 mb-3">Apply one strategy across a set of underlyings (each fires its own alert).</p>

      <div className="space-y-2 mb-4">
        {groups.isLoading ? (
          <Spinner />
        ) : (
          groups.data?.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg bg-ink-850 px-3 py-2">
              <div>
                <div className="text-sm text-slate-200 flex items-center gap-2">
                  {g.name} {g.builtin && <Badge>preset</Badge>}
                </div>
                <div className="text-xs text-slate-500">{g.members.join(', ')}</div>
              </div>
              {!g.builtin && (
                <button className="text-slate-500 hover:text-bear" onClick={() => del.mutate(g.id)} title="Delete group">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-ink-700/60 pt-3 space-y-2">
        <input className="input w-full text-sm" placeholder="New group name (e.g. My Indices)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {underlyings.data?.map((u) => (
            <button
              key={u.symbol}
              onClick={() => toggle(u.symbol)}
              className={clsx(
                'rounded-md px-2 py-1 text-xs border',
                members.includes(u.symbol) ? 'bg-accent/20 border-accent/40 text-accent-soft' : 'bg-ink-800 border-ink-700 text-slate-400',
              )}
            >
              {u.symbol}
            </button>
          ))}
        </div>
        <button
          className="btn-ghost text-xs w-full justify-center"
          disabled={!name.trim() || members.length === 0 || create.isPending}
          onClick={() => create.mutate()}
        >
          <Plus className="w-4 h-4" /> Create Group
        </button>
      </div>
    </Card>
  );
}
