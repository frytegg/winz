import { ArrowRight, Sparkles, Rocket } from 'lucide-react';

export function Hero() {
  return (
    <section>
      <Sparkles className="h-4 w-4" />
      <h1>Launch your vault</h1>
      <a href="/app">Start <ArrowRight /></a>
      <Rocket />
    </section>
  );
}
