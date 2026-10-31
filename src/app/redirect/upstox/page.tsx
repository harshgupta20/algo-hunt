import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { UpstoxRedirect } from '@/client/views/UpstoxRedirect';

/** Upstox Redirect URL (`http://localhost:3000/redirect/upstox`, saved on the Upstox app and in UPSTOX_REDIRECT_URI). */
export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <UpstoxRedirect />
    </Suspense>
  );
}
