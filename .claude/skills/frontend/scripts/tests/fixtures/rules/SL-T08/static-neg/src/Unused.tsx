import { Shield, Zap, Lock } from 'lucide-react';

// FD14-F12: vendored, never rendered by a page.
export function Unused() {
  return (
    <section className="grid grid-cols-3 gap-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Shield /></div>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Zap /></div>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Lock /></div>
    </section>
  );
}
