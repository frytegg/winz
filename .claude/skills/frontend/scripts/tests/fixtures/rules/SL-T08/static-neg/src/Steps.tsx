// Numbered steps carry their order, not a decorative glyph.
export function Steps() {
  return (
    <ol className="grid grid-cols-3 gap-6">
      <li><span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">1</span><h3>Deposit</h3></li>
      <li><span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">2</span><h3>Borrow</h3></li>
      <li><span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">3</span><h3>Repay</h3></li>
      {/* <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10"><Zap /></div> */}
    </ol>
  );
}
