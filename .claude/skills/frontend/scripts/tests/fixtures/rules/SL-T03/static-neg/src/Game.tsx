// FD14-F16: emoji in toasts, result badges and game pieces, outside any heading.
const pieces = [{ icon: '⭕', name: 'Circle' }, { icon: '✊', name: 'Rock' }];

export function Game({ won }: { won: boolean }) {
  if (won) toast.success('✅ Saved to your history');
  return (
    <div>
      {/* <h2>🚀 Old headline</h2> */}
      <h2>Play ▶</h2>
      <h3>Contracts → Debug</h3>
      <h4>© 2026 Vaultline</h4>
      <h5>Pricing ✓</h5>
      <span className="badge">🏆 Winner</span>
      <select>
        <option>🇫🇷 France</option>
      </select>
      <Link href="/starred">⭐ Starred</Link>
      <Link href="/recent">🕒 Recent</Link>
      {pieces.map((p) => (
        <span key={p.name}>{p.icon}</span>
      ))}
    </div>
  );
}
