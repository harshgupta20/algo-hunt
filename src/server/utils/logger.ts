/**
 * Structured logger. Emits one JSON line per entry (what Vercel's log viewer
 * indexes best) with the same `log.info(obj, msg)` call shape the codebase uses.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? 'info') as Level;
  return ORDER[lvl] ?? ORDER.info;
}

function serialize(value: unknown): unknown {
  if (value instanceof Error) return { message: value.message, name: value.name, stack: value.stack };
  if (value && typeof value === 'object' && 'err' in value) {
    const v = value as Record<string, unknown>;
    return { ...v, err: serialize(v.err) };
  }
  return value;
}

export interface Logger {
  debug(objOrMsg: unknown, msg?: string): void;
  info(objOrMsg: unknown, msg?: string): void;
  warn(objOrMsg: unknown, msg?: string): void;
  error(objOrMsg: unknown, msg?: string): void;
}

function make(component?: string): Logger {
  const write = (level: Level, objOrMsg: unknown, msg?: string) => {
    if (ORDER[level] < threshold()) return;
    const fields = typeof objOrMsg === 'string' ? {} : (serialize(objOrMsg) as Record<string, unknown>);
    const message = typeof objOrMsg === 'string' ? objOrMsg : msg;
    const line = JSON.stringify({ level, time: new Date().toISOString(), component, msg: message, ...fields });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (o, m) => write('debug', o, m),
    info: (o, m) => write('info', o, m),
    warn: (o, m) => write('warn', o, m),
    error: (o, m) => write('error', o, m),
  };
}

export const logger = make();

/** Create a child logger tagged with a component name. */
export function childLogger(component: string): Logger {
  return make(component);
}
