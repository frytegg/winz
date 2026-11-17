import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const _inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'RWA Tokenization Admin',
  generator: 'v0.app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
