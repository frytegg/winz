const features = [
  { title: '⚡ Instant settlement', body: 'Two seconds on testnet.' },
  { title: 'Audited vaults', body: 'Two independent reviews.' },
];

export function Features() {
  return (
    <section>
      <h2 className="text-3xl">🚀 Launch your vault</h2>
      <CardTitle>Rates 📈</CardTitle>
      {features.map((f) => (
        <h3 key={f.title}>{f.title}</h3>
      ))}
    </section>
  );
}
