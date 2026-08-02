import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Polls Kite auth status so the UI can prompt for (re)login when needed. */
export function useKiteStatus() {
  return useQuery({
    queryKey: ['kite-status'],
    queryFn: api.kiteStatus,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
}
