export function Chrome({ date, author, tag }: { date: string; author: string; tag: string }) {
  return (
    <main>
      <a href="/docs">Read the docs →</a>
      <a href="/app">Open app →</a>
      <button>Continue →</button>
      <p>Oct 1 · 4 min read · Research</p>
      <p>v2 · Testnet · Audited</p>
      <p>
        {date} · {author} · {tag}
      </p>
      <span className="font-mono text-[10px] uppercase tracking-wider">Status</span>
      <span className="font-mono text-xs uppercase">Network</span>
      <span className="font-mono text-[11px] uppercase">Block</span>
    </main>
  );
}
