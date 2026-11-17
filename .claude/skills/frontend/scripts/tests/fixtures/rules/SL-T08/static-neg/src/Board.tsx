// FD14-F10: a game board is a grid of real content, not icon tiles.
export function Board({ cells }: { cells: string[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {cells.map((c, i) => (
        <button key={i} className="flex h-16 w-16 items-center justify-center rounded-md bg-zinc-100 text-2xl">
          {c}
        </button>
      ))}
    </div>
  );
}
