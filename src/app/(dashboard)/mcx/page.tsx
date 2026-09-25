import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { McxHub } from '@/client/views/mcx/McxHub';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <McxHub />
    </Suspense>
  );
}
