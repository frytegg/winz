export function Cards() {
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border-l-4 border-violet-500 bg-white p-4">
        <h3>Collateral</h3>
      </div>
      <article className="border-t-4 border-emerald-500 p-6">
        <h3>Yield</h3>
      </article>
      <div style={{ borderLeft: '4px solid #f59e0b', padding: 16 }}>
        <h3>Liquidation</h3>
      </div>
    </div>
  );
}
