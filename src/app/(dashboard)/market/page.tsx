import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { MarketView } from '@/client/market/MarketView';

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <MarketView />
    </Suspense>
  );
}
