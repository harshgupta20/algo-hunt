'use client';

/** Connection settings: expiry, strike positions (option strategies) and alert policy. */
import type { ConnectionConfig, StrategyDefinition } from '@/shared/v2';
import { EXPIRY_MODES, STRIKE_SHIFT_PRESETS } from '@/shared/v2';
import { Tooltip } from '../../components/Tooltip';
import { Cell, Segmented, Toggle } from '../components';
import { H } from '../help';

export function ConfigEditor({
  value,
  onChange,
  definition,
  expiries,
}: {
  value: ConnectionConfig;
  onChange: (c: ConnectionConfig) => void;
  definition?: StrategyDefinition;
  /** Listed expiries when a single product is being configured (for “Specific date”). */
  expiries?: string[];
}) {
  const hasOptions = definition?.legs.some((l) => l.kind === 'CE' || l.kind === 'PE') ?? true;
  const live = definition?.evaluation.mode === 'LIVE_CANDLE';
  const preset = STRIKE_SHIFT_PRESETS.find((p) => p.shifts.length === value.strikeShifts.length && p.shifts.every((s, i) => s === [...value.strikeShifts].sort((a, b) => a - b)[i]));
  const a = value.alert;
  const setAlert = (patch: Partial<ConnectionConfig['alert']>) => onChange({ ...value, alert: { ...a, ...patch } });

  return (
    <div className="flex flex-wrap items-end gap-5">
      <Cell label={hasOptions ? 'Option expiry' : 'Futures expiry'} help={H.connection.expiry}>
        <select
          aria-label="Expiry"
          className="input py-1 text-xs"
          value={value.expiry.mode}
          onChange={(e) => {
            const mode = e.target.value as ConnectionConfig['expiry']['mode'];
            onChange({ ...value, expiry: mode === 'SPECIFIC' ? { mode, date: expiries?.[0] ?? '' } : { mode } });
          }}
        >
          {EXPIRY_MODES.filter((m) => m.mode !== 'SPECIFIC' || expiries?.length).map((m) => (
            <option key={m.mode} value={m.mode}>
              {m.label}
            </option>
          ))}
        </select>
        {value.expiry.mode === 'SPECIFIC' && (
          <select aria-label="Expiry date" className="input py-1 text-xs" value={value.expiry.date} onChange={(e) => onChange({ ...value, expiry: { mode: 'SPECIFIC', date: e.target.value } })}>
            {(expiries ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </Cell>
      {hasOptions && (
        <Cell label="Strike positions" help={H.connection.shifts}>
          <select
            aria-label="Strike positions"
            className="input py-1 text-xs"
            value={preset?.key ?? 'atm'}
            onChange={(e) => onChange({ ...value, strikeShifts: STRIKE_SHIFT_PRESETS.find((p) => p.key === e.target.value)!.shifts })}
          >
            {STRIKE_SHIFT_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Cell>
      )}
      <Cell label="Channels" help={H.connection.channels}>
        <Toggle checked={a.channels.telegram} onChange={(v) => setAlert({ channels: { ...a.channels, telegram: v } })} label="Telegram" help={{ title: 'Telegram', body: 'Send to the Telegram chat set in V2 → Settings.' }} />
        <Toggle checked={a.channels.email} onChange={(v) => setAlert({ channels: { ...a.channels, email: v } })} label="Email" help={{ title: 'Email', body: 'Send to the email recipients set in V2 → Settings.' }} />
      </Cell>
      <Cell label="Alert when" help={H.connection.trigger}>
        <Segmented
          label="Alert trigger"
          value={a.trigger}
          onChange={(trigger) => setAlert({ trigger })}
          options={[
            { value: 'ON_TRANSITION', label: 'Becomes true', help: { title: 'Becomes true', body: 'First trigger candle it turns true after being false.' } },
            { value: 'WHILE_TRUE', label: 'While true', help: { title: 'While true', body: 'Every trigger candle it stays true (limited by the cooldown).' } },
          ]}
        />
      </Cell>
      <Cell label="Cooldown (min)" help={H.connection.cooldown}>
        <Tooltip content={H.connection.cooldown}>
          <input
            type="number"
            min={0}
            aria-label="Cooldown minutes"
            className="input py-1 text-xs w-20"
            value={a.cooldownMinutes ?? 0}
            onChange={(e) => {
              const m = Math.round(Number(e.target.value));
              setAlert({ cooldownMinutes: m > 0 ? m : null });
            }}
          />
        </Tooltip>
      </Cell>
      <Cell label="Repeats" help={H.connection.oncePerCandle}>
        <Toggle checked={a.oncePerCandle} disabled={!live} onChange={(v) => setAlert({ oncePerCandle: v })} label="Once per candle" help={H.connection.oncePerCandle} />
      </Cell>
    </div>
  );
}
