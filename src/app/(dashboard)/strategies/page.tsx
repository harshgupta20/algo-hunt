import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { StrategiesHub } from '@/client/views/StrategiesHub';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <StrategiesHub />
    </Suspense>
  );
}
