export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute -top-20 left-10 h-72 w-72 rounded-full bg-purple-500/30 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-cyan-400/20 blur-[100px]" />
      <h1>Launch day</h1>
      <button className="shadow-[0_0_30px_rgba(139,92,246,0.6)]">Launch</button>
    </section>
  );
}
