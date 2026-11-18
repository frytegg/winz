import type { PrivyClientConfig } from "@privy-io/react-auth";
import { arcTestnet } from "viem/chains";

/**
 * The Privy client configuration (SPEC section 11: e-mail code, passkey, an embedded wallet, Arc
 * testnet chain id 5042002).
 *
 * The chain comes from viem, the same definition the server and the engine use, so the id and the
 * RPC addresses are written once.
 *
 * Settings that live in the Privy dashboard and cannot be set from here (they are listed in the
 * I-01 report): the allowed origins, e-mail and passkey as enabled login methods, and the
 * embedded wallets themselves. A value here can only narrow what the dashboard allows.
 */
export const privyClientConfig: PrivyClientConfig = {
  loginMethods: ["email", "passkey"],
  embeddedWallets: {
    // Fans never see a wallet and neither do merchants: it is created at the first sign-in, for
    // anyone who has none, and no Privy window is ever shown for it.
    ethereum: { createOnLogin: "users-without-wallets" },
    showWalletUIs: false,
  },
  defaultChain: arcTestnet,
  supportedChains: [arcTestnet],
};
