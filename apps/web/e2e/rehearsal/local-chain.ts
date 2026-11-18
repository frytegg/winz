/**
 * A local chain to rehearse on (from apps/web): anvil with chain id 31337, the WinzEscrow and its
 * test token deployed by the engine's test helper, the treasury funded with one million test USDC
 * and approving the escrow. Prints the variables the rehearsal reads, never a key, and runs until
 * Ctrl-C.
 *
 *   pnpm exec tsx e2e/rehearsal/local-chain.ts
 *
 * Its roles are anvil's public development accounts: relayer and treasury index 1, oracle index 2
 * of Foundry's mnemonic (see apps/web/README.md, "Répétition"). Local chains only.
 */
import { startAnvil } from "../../../engine/src/testing/anvil";
import { deployTestEscrow } from "../../../engine/src/testing/escrow";
import { LOCAL_CHAIN_ID } from "./runner";

async function main(): Promise<void> {
  const anvil = await startAnvil({ chainId: LOCAL_CHAIN_ID, accounts: 5 });
  const escrow = await deployTestEscrow(anvil);
  process.stdout.write(
    [
      `export ARC_RPC_URL=${anvil.rpcUrl}`,
      `export ARC_CHAIN_ID=${LOCAL_CHAIN_ID.toString()}`,
      `export ARC_ESCROW_ADDRESS=${escrow.escrow}`,
      `export ARC_ESCROW_DEPLOY_BLOCK=${escrow.deployedAtBlock.toString()}`,
      "# local chain running; Ctrl-C stops it",
      "",
    ].join("\n"),
  );
  const stop = (): void => {
    void anvil.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Keeps the process alive until a signal stops it.
  setInterval(() => undefined, 3_600_000);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `local chain failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
