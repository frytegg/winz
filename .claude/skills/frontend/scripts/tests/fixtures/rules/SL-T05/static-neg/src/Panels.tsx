import { Card } from '@/components/ui/card';

// One highlighted card is a choice, not the pattern; status callouts, neutral and grey-gradient borders are not tints.
export function Panels() {
  return (
    <section className="grid gap-4">
      <Card className="p-6 border-violet-500/40">Recommended plan</Card>
      <Card className="p-6 border-border">Basic plan</Card>
      <div className="rounded-lg border border-warning/30 p-4">Back up this key before you continue.</div>
      <div className="rounded-lg border border-destructive/40 p-4">The transaction was rejected.</div>
      <div className="rounded-lg border border-line-subtle p-4">Ledger row</div>
      <div className="rounded-xl bg-gradient-to-r from-gray-700 to-gray-600 p-px">
        <div className="rounded-xl bg-black p-6">Grey ring</div>
      </div>
      <div className="panel">Grey border box</div>
    </section>
  );
}
