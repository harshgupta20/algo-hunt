import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { EquityHub } from '@/client/equity/EquityHub';

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <EquityHub />
    </Suspense>
  );
}
