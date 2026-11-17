import { useConnect } from 'wagmi';
import { useState } from 'react';

export function WalletDialog() {
  const { connectors, connect } = useConnect();
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="dialog" aria-labelledby="wallet-title">
      <h2 id="wallet-title">Connect a wallet</h2>
      {connectors.map((c) => (
        <button key={c.uid} onClick={() => connect({ connector: c }, { onError: (e) => setError(e.message) })}>
          {c.name}
        </button>
      ))}
      {error ? <p role="alert">The wallet refused the connection. Open it and approve the request.</p> : null}
    </div>
  );
}
