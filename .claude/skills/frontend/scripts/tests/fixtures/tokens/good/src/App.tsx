export function App() {
  return (
    <main className="bg-bg text-text font-body">
      <h1 className="type-display-l">Settlement in one row</h1>
      <p className="text-text-muted type-body-m">Amounts reconcile against the statement.</p>
      <button className="bg-primary text-on-primary rounded-sm transition-transform duration-(--duration-press) active:scale-97">
        Settle
      </button>
      <span className="font-mono tabular-nums type-figure-m">1,204.50</span>
    </main>
  );
}
