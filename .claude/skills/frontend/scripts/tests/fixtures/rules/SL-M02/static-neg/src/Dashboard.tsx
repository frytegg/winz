export function Dashboard() {
  return (
    <main>
      <section>
        <p className="text-xs uppercase tracking-wide">Overview</p>
        <h2>Vault health</h2>
      </section>
      <section>
        <h2>Positions</h2>
      </section>
      <section>
        <h2 className="uppercase tracking-wide">Risk</h2>
      </section>
      <section>
        <h2>History</h2>
      </section>
      <section>
        <h3>Fees</h3>
      </section>
      <button className="uppercase tracking-wide">Deposit</button>
      <h2>Docs</h2>
    </main>
  );
}
