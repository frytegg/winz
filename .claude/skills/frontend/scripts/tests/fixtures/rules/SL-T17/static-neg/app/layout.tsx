export const metadata = {
  title: 'Vaultline: next-generation escrow',
  description: 'Escrow for small sellers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
