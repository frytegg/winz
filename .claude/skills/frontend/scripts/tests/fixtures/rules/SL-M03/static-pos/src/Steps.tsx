const items = [
  { number: '01', title: 'Connect' },
  { number: '02', title: 'Deposit' },
  { number: '03', title: 'Earn' },
];

export function Steps() {
  return (
    <ol>
      {items.map((item, i) => (
        <li key={item.title}>
          <span className="font-mono">{String(i + 1).padStart(2, '0')}</span>
          <h3>{item.title}</h3>
        </li>
      ))}
    </ol>
  );
}
