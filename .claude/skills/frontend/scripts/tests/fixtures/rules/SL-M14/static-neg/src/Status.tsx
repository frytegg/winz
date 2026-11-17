export function Status({ live }: { live: boolean }) {
  return (
    <div>
      <span className={live ? 'size-2 rounded-full bg-green-500 animate-pulse' : 'size-2 rounded-full bg-zinc-500'} />
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
    </div>
  );
}
