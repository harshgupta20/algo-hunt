import { format, parseISO } from 'date-fns';

/** Local date-time, e.g. "28 Sep 2026, 06:00:00". */
export function fmtTime(iso: string): string {
  return format(parseISO(iso), 'dd MMM yyyy, HH:mm:ss');
}
