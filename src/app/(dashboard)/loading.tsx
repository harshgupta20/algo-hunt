import { PageLoader } from '@/client/components/loaders';

/** Shown while a signed-in page loads (Next.js route loading UI). */
export default function Loading() {
  return <PageLoader />;
}
