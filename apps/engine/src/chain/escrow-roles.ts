import { getAddress, type Address, type PublicClient } from "viem";

import { winzEscrowAbi } from "@winz/shared";

import { describeError } from "./decode-error";
import { ChainIdMismatchError, TxSenderError } from "./errors";
import type { SignerAccounts, SignerName } from "./types";

/** What the start check reads on the chain. A viem `PublicClient` satisfies it. */
export type EscrowRolesClient = Pick<PublicClient, "getChainId" | "getCode" | "readContract">;

/**
 * The engine's configuration does not fit the chain it points at: the escrow is not where it is
 * said to be, or its relayer and oracle are not the keys the engine signs with. A start-up error:
 * the engine refuses to start its services, as for a wrong chain id. Messages name addresses,
 * never a key.
 */
export class EscrowConfigError extends TxSenderError {
  constructor(message: string) {
    super(message);
    this.name = "EscrowConfigError";
  }
}

/** No contract code at `ARC_ESCROW_ADDRESS` on the chain the node serves. */
export class EscrowNotFoundError extends EscrowConfigError {
  constructor(
    public readonly escrowAddress: Address,
    public readonly chainId: number,
  ) {
    super(
      `ARC_ESCROW_ADDRESS ${escrowAddress} holds no contract code on chain ${chainId.toString()}: ` +
        "the address is wrong, or the node (ARC_RPC_URL) serves another network than the one " +
        "the escrow was deployed on (packages/contracts/deployments/<chain id>.json).",
    );
    this.name = "EscrowNotFoundError";
  }
}

/** The contract at the address does not answer `relayer()` and `oracle()`: not a WinzEscrow. */
export class EscrowRolesUnreadableError extends EscrowConfigError {
  constructor(
    public readonly escrowAddress: Address,
    cause: unknown,
  ) {
    super(
      `The contract at ARC_ESCROW_ADDRESS ${escrowAddress} does not answer relayer() and ` +
        `oracle(): it is not a WinzEscrow (${describeError(cause)}).`,
    );
    this.name = "EscrowRolesUnreadableError";
  }
}

export interface RoleMismatch {
  role: SignerName;
  /** What the escrow expects (`relayer()` or `oracle()`). */
  escrow: Address;
  /** Address of the key configured for that role. */
  configured: Address;
}

/**
 * The escrow's relayer or oracle is not the address of the configured key. With the keys
 * swapped, the engine would start, answer healthy, then see every campaign creation revert
 * (`onlyRelayer`) and every purchase revert (`QuoteBadSignature`), each one refunded.
 */
export class EscrowRolesMismatchError extends EscrowConfigError {
  constructor(
    public readonly escrowAddress: Address,
    public readonly mismatches: readonly RoleMismatch[],
    /** The two configured keys are the escrow's two roles, the other way round. */
    public readonly swapped: boolean,
  ) {
    const variable = (role: SignerName): string =>
      role === "relayer" ? "ARC_RELAYER_PRIVATE_KEY" : "ARC_ORACLE_PRIVATE_KEY";
    const lines = mismatches.map(
      (mismatch) =>
        `the escrow's ${mismatch.role} is ${mismatch.escrow}, ${variable(mismatch.role)} is the key ` +
        `of ${mismatch.configured}`,
    );
    super(
      `The keys do not match the escrow at ${escrowAddress}: ${lines.join("; ")}. ` +
        (swapped
          ? "The two keys are swapped: exchange ARC_RELAYER_PRIVATE_KEY and ARC_ORACLE_PRIVATE_KEY."
          : "Set each variable to the key of the address the escrow expects " +
            "(packages/contracts/deployments/<chain id>.json), or rotate the escrow's roles " +
            "(setRoles, owner only)."),
    );
    this.name = "EscrowRolesMismatchError";
  }
}

export interface EscrowRolesCheck {
  client: EscrowRolesClient;
  chainId: number;
  escrowAddress: Address;
  accounts: SignerAccounts;
}

/**
 * The start check of the escrow (run by `startEngine` before any service, and by the process at
 * boot): the node serves the configured chain, the escrow address holds code there, and the
 * escrow's `relayer()` and `oracle()` are the addresses of the configured keys. Returns the two
 * addresses read. Throws `ChainIdMismatchError`, `EscrowNotFoundError`,
 * `EscrowRolesUnreadableError` or `EscrowRolesMismatchError`; a node that cannot be reached
 * throws `TxSenderError`.
 */
export async function checkEscrowRoles(
  check: EscrowRolesCheck,
): Promise<{ relayer: Address; oracle: Address }> {
  const escrowAddress = getAddress(check.escrowAddress);
  let chainId: number;
  let code: string | undefined;
  try {
    chainId = await check.client.getChainId();
    code = await check.client.getCode({ address: escrowAddress });
  } catch (error: unknown) {
    throw new TxSenderError(
      `The node could not be reached to check the escrow: ${describeError(error)}`,
      { cause: error },
    );
  }
  if (chainId !== check.chainId) throw new ChainIdMismatchError(check.chainId, chainId);
  if (code === undefined || code === "0x" || code === "") {
    throw new EscrowNotFoundError(escrowAddress, chainId);
  }

  let onchain: { relayer: Address; oracle: Address };
  try {
    const [relayer, oracle] = await Promise.all([
      check.client.readContract({
        address: escrowAddress,
        abi: winzEscrowAbi,
        functionName: "relayer",
      }),
      check.client.readContract({
        address: escrowAddress,
        abi: winzEscrowAbi,
        functionName: "oracle",
      }),
    ]);
    onchain = { relayer: getAddress(relayer), oracle: getAddress(oracle) };
  } catch (error: unknown) {
    throw new EscrowRolesUnreadableError(escrowAddress, error);
  }

  const configured = {
    relayer: getAddress(check.accounts.relayer.address),
    oracle: getAddress(check.accounts.oracle.address),
  };
  const mismatches: RoleMismatch[] = (["relayer", "oracle"] as const)
    .filter((role) => onchain[role] !== configured[role])
    .map((role) => ({ role, escrow: onchain[role], configured: configured[role] }));
  if (mismatches.length > 0) {
    const swapped = configured.relayer === onchain.oracle && configured.oracle === onchain.relayer;
    throw new EscrowRolesMismatchError(escrowAddress, mismatches, swapped);
  }
  return onchain;
}
