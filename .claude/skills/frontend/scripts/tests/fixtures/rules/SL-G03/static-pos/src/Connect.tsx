import { ConnectWalletButton } from '@cardano-foundation/cardano-connect-with-wallet';
import { CardanoWallet } from '@meshsdk/react';

export function Connect() {
  const onError = () => alert('Could not connect the wallet');
  return (
    <div>
      <ConnectWalletButton />
      <CardanoWallet />
      <footer className="mesh-dark">
        <span>Powered by</span> <span>Mesh SDK</span>
      </footer>
      <button onClick={onError}>Retry</button>
    </div>
  );
}
