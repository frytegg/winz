import { Instrument_Serif, Space_Grotesk } from 'next/font/google';
import './globals.css';

const sans = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-serif' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
