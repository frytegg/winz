export function Hero({ active }: { active: boolean }) {
  return (
    <section className="bg-gradient-to-r from-violet-600 to-blue-500 px-8 py-24">
      <h1 className={cn('bg-linear-to-r', 'from-purple-500', active && 'to-cyan-400')}>Settle in one block</h1>
      <a className="bg-gradient-to-br from-primary to-accent px-4 py-2" href="/app">Open the app</a>
    </section>
  );
}
