import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { McxV2Hub } from '@/client/mcx/McxV2Hub';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <McxV2Hub />
    </Suspense>
  );
}
