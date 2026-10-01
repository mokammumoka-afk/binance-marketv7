import './globals.css';
import AppShell from '../components/AppShell';

export const metadata = {
  title: 'Market Intelligence — Binance',
  description: 'Real-time Binance market structure, volume profile and signal confluence engine. Analysis only — not a trade execution bot.',
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0D12',
};

export default function RootLayout({ children }) {
  return (
    <html suppressHydrationWarning>
      <body className="bg-base-950 text-base-100 font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
