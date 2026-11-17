export function Split() {
  return (
    <section className="grid grid-cols-2 items-start gap-12">
      <div>
        <h1 className="text-5xl font-bold">Vault health at a glance</h1>
        <a href="/app">Get started</a>
        <a href="/docs">Learn more</a>
      </div>
      <img src="/screens/vault.png" alt="The vault dashboard on testnet" />
    </section>
  );
}
