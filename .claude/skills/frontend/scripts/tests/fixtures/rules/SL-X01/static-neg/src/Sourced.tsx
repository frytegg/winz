// Mapped figures that carry their source, and a mapped array of names: neither is an unsourced claim.
const vaults = [
  { value: '4.2%', name: 'Senior tranche' },
  { value: '9.8%', name: 'Junior tranche' },
];
const steps = [{ title: 'Deposit' }, { title: 'Borrow' }];

export function Vaults() {
  return (
    <div>
      {vaults.map((v) => (
        <p key={v.name} className="text-4xl" data-source="vault-api" data-as-of="2026-10-01">{v.value}</p>
      ))}
      {steps.map((s) => (
        <h3 key={s.title} className="text-3xl">{s.title}</h3>
      ))}
    </div>
  );
}
