import { Shield, Zap, Lock } from 'lucide-react';

export function Features() {
  return (
    <section className="grid grid-cols-1 gap-8 md:grid-cols-3">
      <div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10">
          <Shield className="h-6 w-6" />
        </div>
        <h3>Secure</h3>
      </div>
      <div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10">
          <Zap className="h-6 w-6" />
        </div>
        <h3>Fast</h3>
      </div>
      <div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10">
          <Lock className="h-6 w-6" />
        </div>
        <h3>Private</h3>
      </div>
    </section>
  );
}
