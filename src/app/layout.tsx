import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASH · RSI Alert Platform',
  description: 'Real-time RSI synchronized Future / Call / Put alerting on Zerodha Kite.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0a0e17' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div id="__app">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
