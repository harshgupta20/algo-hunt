import type { ReactNode } from 'react';
import { AppLayout } from '@/client/components/layout/AppLayout';
import { LiveProvider } from '@/client/context/LiveContext';
import { ThemePreferenceSync } from '@/client/theme/useThemePreference';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <LiveProvider>
      <ThemePreferenceSync />
      <AppLayout>{children}</AppLayout>
    </LiveProvider>
  );
}
