const partners = [{ name: 'Cardano Foundation', href: 'https://cardanofoundation.org' }];

export function Partners() {
  return (
    <section>
      <h2>Trusted by these partners</h2>
      <ul>
        {partners.map((p) => (
          <li key={p.name}>
            <a href={p.href}>
              <img src="/partners/cf.svg" alt={p.name} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
