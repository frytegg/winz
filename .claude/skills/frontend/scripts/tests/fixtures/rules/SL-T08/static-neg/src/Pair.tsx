import { Shield, Zap } from 'lucide-react';

// Two columns are a comparison, not the three-up row.
export function Pair() {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Shield /></div>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Zap /></div>
    </div>
  );
}
