import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { Alerts } from '@/client/views/Alerts';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Alerts />
    </Suspense>
  );
}
