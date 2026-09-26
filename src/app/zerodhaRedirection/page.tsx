import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { KiteRedirect } from '@/client/views/KiteRedirect';

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <KiteRedirect />
    </Suspense>
  );
}
