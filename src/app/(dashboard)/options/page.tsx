import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { OptionsHub } from '@/client/v2/options/OptionsHub';

export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <OptionsHub />
    </Suspense>
  );
}
