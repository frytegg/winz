import { Badge } from '@/components/ui/badge';

export function Hero() {
  return (
    <section className="py-24 text-center">
      <span className="inline-flex rounded-full border px-3 py-1 text-sm">Now live on mainnet</span>
      <h1 className="text-5xl font-bold">Lend against any token</h1>
    </section>
  );
}

export function LaunchHero() {
  return (
    <section>
      <Badge variant="secondary">New</Badge>
      <h1>Credit, priced in one block</h1>
    </section>
  );
}
