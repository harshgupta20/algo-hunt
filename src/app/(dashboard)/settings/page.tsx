import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { Settings } from '@/client/views/Settings';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Settings />
    </Suspense>
  );
}
