import { Suspense } from 'react';
import { PageLoader } from '@/client/components/loaders';
import { KiteRedirect } from '@/client/views/KiteRedirect';

/** Alternate Kite Redirect URL (`https://<domain>/redirect/zerodha`) — same flow as /zerodhaRedirection. */
export default function Page() {
  return (
    <Suspense fallback={<PageLoader />}>
      <KiteRedirect />
    </Suspense>
  );
}
