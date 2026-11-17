import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const _inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = { title: 'Ledgerline' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={_inter.className}>{children}</body>
    </html>
  );
}
