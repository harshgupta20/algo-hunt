import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { Settings } from '@/client/views/Settings';

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Settings />
    </Suspense>
  );
}
