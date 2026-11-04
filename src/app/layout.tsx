import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { DEFAULT_THEME, THEME_COLOR, THEME_INIT_SCRIPT } from '@/client/theme/theme';
import { DEFAULT_LOOK, LOOK_INIT_SCRIPT } from '@/client/theme/look';
import './globals.css';
import './fresh-look.css';

export const metadata: Metadata = {
  title: 'Algo Hunt · Alert Platform',
  description: 'Strategy + Product = Alert — product-agnostic strategies on NSE and MCX, alerted from live Zerodha Kite data.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: THEME_COLOR[DEFAULT_THEME] };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Light by default; the inline script switches to a stored theme before first paint.
    // suppressHydrationWarning: that script may change data-theme before React hydrates.
    <html lang="en" data-theme={DEFAULT_THEME} data-look={DEFAULT_LOOK} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOOK_INIT_SCRIPT }} />
      </head>
      <body>
        <div id="__app">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
