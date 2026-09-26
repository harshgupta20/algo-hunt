import type { ReactNode } from 'react';
import { AlertNotifier } from '@/client/components/layout/AlertNotifier';
import { AppLayout } from '@/client/components/layout/AppLayout';
import { ThemePreferenceSync } from '@/client/theme/useThemePreference';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AlertNotifier />
      <ThemePreferenceSync />
      <AppLayout>{children}</AppLayout>
    </>
  );
}
