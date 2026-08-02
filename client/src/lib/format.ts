import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function fmtRsi(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(2);
}

export function fmtTime(iso: string): string {
  return format(parseISO(iso), 'dd MMM yyyy, HH:mm:ss');
}

export function fmtRelative(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

export function fmtDate(iso: string): string {
  return format(parseISO(iso), 'dd MMM yyyy');
}
