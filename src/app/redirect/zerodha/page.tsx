import { Suspense } from 'react';
import { Spinner } from '@/client/components/ui';
import { KiteRedirect } from '@/client/views/KiteRedirect';

/** Alternate Kite Redirect URL (`https://<domain>/redirect/zerodha`) — same flow as /zerodhaRedirection. */
export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <KiteRedirect />
    </Suspense>
  );
}
