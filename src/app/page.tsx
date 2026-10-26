import type { Metadata } from 'next';
import { Landing } from '@/client/landing/Landing';

export const metadata: Metadata = {
  title: 'Algo Hunt · Strategy + Product = Alert',
  description:
    'Build a trading strategy once, connect it to any NSE index, stock or MCX commodity, and get Kite-verified alerts seconds after the candle closes. Paper trading, backtests, equity pyramiding, market view and a trading AI.',
};

export default function HomePage() {
  return <Landing />;
}
