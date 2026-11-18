import { describe, expect, it } from "vitest";

import { privyClientConfig } from "./privy-config";

describe("privyClientConfig", () => {
  it("runs on Arc testnet, chain id 5042002, and on nothing else", () => {
    expect(privyClientConfig.defaultChain?.id).toBe(5042002);
    expect(privyClientConfig.supportedChains?.map((chain) => chain.id)).toEqual([5042002]);
  });

  it("offers an e-mail code and a passkey, no other way in", () => {
    expect(privyClientConfig.loginMethods).toEqual(["email", "passkey"]);
  });

  it("creates the wallet by itself and never shows a wallet screen", () => {
    expect(privyClientConfig.embeddedWallets?.ethereum?.createOnLogin).toBe(
      "users-without-wallets",
    );
    expect(privyClientConfig.embeddedWallets?.showWalletUIs).toBe(false);
    // Only the Ethereum wallet: the escrow and the pre-generated wallets of the server are Ethereum's.
    expect(privyClientConfig.embeddedWallets?.solana).toBeUndefined();
  });
});
