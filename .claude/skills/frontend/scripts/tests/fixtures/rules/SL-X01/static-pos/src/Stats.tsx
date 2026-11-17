// The dominant generated shape: a stats array mapped into display-size tiles.
const stats = [
  { value: '10K+', label: 'Active users' },
  { value: '99.9%', label: 'Uptime' },
  { value: '$2.5M', label: 'Volume' },
];

export function Stats() {
  return (
    <div className="grid grid-cols-3">
      {stats.map((s) => (
        <div key={s.label}>
          <p className="text-4xl font-bold">{s.value}</p>
          <p className="text-sm">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
