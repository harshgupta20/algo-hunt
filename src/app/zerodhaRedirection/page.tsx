import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { KiteRedirect } from '@/client/views/KiteRedirect';

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <KiteRedirect />
    </Suspense>
  );
}
