export function Panel() {
  return (
    <section className="bg-zinc-950 p-8">
      <p className="text-zinc-300">Collateral ratio, updated each block</p>
      <p className="text-white/70">Fees are paid in ADA</p>
      <input className="placeholder:text-zinc-600" placeholder="Amount" />
      <button className="text-zinc-600 disabled:opacity-50" disabled>Locked</button>
      <svg className="text-zinc-700" viewBox="0 0 24 24" />
      <ChevronIcon className="text-gray-600" />
      {/* <p className="text-gray-600">old caption</p> */}
    </section>
  );
}
