export function Hero({ tvl }: { tvl: string }) {
  return (
    <section>
      <h1>Settle invoices on Cardano in 2026</h1>
      <p data-metric data-ledger="C-012" className="text-5xl font-semibold">$12.4M</p>
      <p data-metric data-source="testnet" data-as-of="2026-10-01T10:00:00Z" className="text-5xl">{tvl}</p>
      <p className="text-4xl">$19</p>
      <p className="text-5xl">3</p>
      <p className="text-sm">1,284 validators</p>
      <h2 className="text-4xl">CIP-30 and Web3 wallets</h2>
    </section>
  );
}

export function Pitch() {
  return <h1 data-ledger="C-001">Fees down 40% on preprod</h1>;
}
