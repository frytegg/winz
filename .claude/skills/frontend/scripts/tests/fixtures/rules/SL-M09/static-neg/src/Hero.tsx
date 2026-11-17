export function Hero() {
  return (
    <section className="relative">
      <div className="absolute inset-0 bg-black/40 blur-sm" />
      <div className="rounded-xl shadow-lg">Card</div>
      <div className="absolute h-40 w-40 rounded-full bg-blue-500/20 blur-3xl" />
    </section>
  );
}
