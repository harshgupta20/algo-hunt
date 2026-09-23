import type { ReactNode } from 'react';
import { AppLayout } from '@/client/components/layout/AppLayout';
import { LiveProvider } from '@/client/context/LiveContext';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <LiveProvider>
      <AppLayout>{children}</AppLayout>
    </LiveProvider>
  );
}
