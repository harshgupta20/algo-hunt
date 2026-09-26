import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { V2Hub } from '@/client/v2/V2Hub';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <V2Hub />
    </Suspense>
  );
}
