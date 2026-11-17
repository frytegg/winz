import { Card } from '@/components/ui/card';

// FD14-F23 T5 (b), as in SUI InsuredQuestionnaire.tsx:203 and BaseBatches HomePage.tsx:176; (c) a gradient ring.
export function Offers() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Card className="p-6 border-primary/10">Gas cover</Card>
      <Card className="p-6 border-violet-500/20 hover:border-violet-500/40">Premiums</Card>
      <div className="rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 p-px">
        <div className="rounded-xl bg-black p-6">Claims</div>
      </div>
      <div className="feature-card">Payouts</div>
    </section>
  );
}
