import { describe, expect, it } from "vitest";

import { hasEthereumEmbeddedWallet, isWalletAlreadyThere } from "./privy-wallet";

describe("hasEthereumEmbeddedWallet", () => {
  it("is false for a user who only has an e-mail", () => {
    expect(hasEthereumEmbeddedWallet([{ type: "email" }])).toBe(false);
    expect(hasEthereumEmbeddedWallet([])).toBe(false);
  });

  it("is true for the Ethereum wallet Privy created", () => {
    expect(
      hasEthereumEmbeddedWallet([
        { type: "email" },
        { type: "wallet", walletClientType: "privy", chainType: "ethereum" },
      ]),
    ).toBe(true);
  });

  it("ignores another chain and a wallet the user brought", () => {
    expect(
      hasEthereumEmbeddedWallet([
        { type: "wallet", walletClientType: "privy", chainType: "solana" },
      ]),
    ).toBe(false);
    expect(
      hasEthereumEmbeddedWallet([
        { type: "wallet", walletClientType: "metamask", chainType: "ethereum" },
      ]),
    ).toBe(false);
  });
});

describe("isWalletAlreadyThere", () => {
  it("recognises the answer of Privy to a second wallet", () => {
    const error = Object.assign(new Error("exists"), {
      privyErrorCode: "embedded_wallet_already_exists",
    });
    expect(isWalletAlreadyThere(error)).toBe(true);
    expect(isWalletAlreadyThere(new Error("network"))).toBe(false);
  });
});
