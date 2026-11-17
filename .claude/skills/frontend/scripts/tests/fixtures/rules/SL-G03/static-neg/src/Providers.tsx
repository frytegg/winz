import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RainbowKitProvider theme={darkTheme({ accentColor: 'var(--accent)', borderRadius: 'small', fontStack: 'system' })}>
      {children}
    </RainbowKitProvider>
  );
}
