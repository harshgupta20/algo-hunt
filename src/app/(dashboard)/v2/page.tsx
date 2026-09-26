import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { V2Hub } from '@/client/v2/V2Hub';

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <V2Hub />
    </Suspense>
  );
}
