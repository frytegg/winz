import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  maxUint256,
  parseAbi,
  type Abi,
  type AbiParameter,
  type Address,
  type Chain,
  type Hash,
  type HDAccount,
  type Hex,
  type HttpTransport,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";

import { QUOTE_TYPES, quoteDomain, winzEscrowAbi, type Quote } from "@winz/shared";

import type { AnvilInstance } from "./anvil";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ARTIFACTS_DIR = resolve(REPO_ROOT, "packages/contracts/artifacts");

/** One USDC in micro-USDC. */
const ONE_USDC = 1_000_000n;
/** What the treasury holds after deployment unless told otherwise: one million test USDC. */
export const DEFAULT_TREASURY_FUNDS = 1_000_000n * ONE_USDC;

/**
 * The parts of TestUSDC's ABI the tests use, typed. Checked against the committed artifact when
 * it is loaded, so a change to the contract cannot leave this list silently wrong.
 */
export const testUsdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() pure returns (uint8)",
  "function setBlocked(address account, bool isBlocked)",
  "function blocked(address account) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "error AccountBlocked(address account)",
]);

export class TestEscrowError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TestEscrowError";
  }
}

/** `{ abi, bytecode }` of a contract, as committed under packages/contracts/artifacts. */
export interface ContractArtifact {
  abi: Abi;
  bytecode: Hex;
}

export type ArtifactName = "WinzEscrow" | "TestUSDC";

/** Reads a committed artifact (written by scripts/export-abi.mjs) and checks its shape. */
export function loadArtifact(name: ArtifactName): ContractArtifact {
  const path = resolve(ARTIFACTS_DIR, `${name}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    throw new TestEscrowError(`cannot read the artifact ${path}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TestEscrowError(`artifact ${name} is not an object`);
  }
  const { abi, bytecode } = parsed as Record<string, unknown>;
  if (!Array.isArray(abi)) throw new TestEscrowError(`artifact ${name} has no ABI`);
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) {
    throw new TestEscrowError(`artifact ${name} has no bytecode`);
  }
  return { abi: abi as Abi, bytecode: bytecode as Hex };
}

function parameterTypes(parameters: readonly AbiParameter[] | undefined): string {
  return (parameters ?? [])
    .map((parameter) =>
      parameter.type.startsWith("tuple") && "components" in parameter
        ? `(${parameterTypes(parameter.components)})${parameter.type.slice("tuple".length)}`
        : parameter.type,
    )
    .join(",");
}

/** `function mint(address,uint256)`: what identifies an ABI item, names left out. */
function itemSignature(item: Abi[number]): string {
  const name = "name" in item ? item.name : "";
  const inputs = "inputs" in item ? parameterTypes(item.inputs) : "";
  return `${item.type} ${name}(${inputs})`;
}

/** Throws unless every item of `subset` exists in `full`. */
function assertAbiSubset(subset: Abi, full: Abi, label: string): void {
  const known = new Set(full.map(itemSignature));
  const missing = subset.map(itemSignature).filter((signature) => !known.has(signature));
  if (missing.length > 0) {
    throw new TestEscrowError(`${label}: not in the committed artifact: ${missing.join("; ")}`);
  }
}

export type EscrowRole = "owner" | "relayer" | "oracle" | "treasury" | "merchant";

export type TestEscrowAccounts = Record<EscrowRole, HDAccount>;

export type TestWalletClient = WalletClient<HttpTransport, Chain, HDAccount>;
export type TestPublicClient = PublicClient<HttpTransport, Chain>;

export interface DeployTestEscrowOptions {
  /**
   * True (the default, as in the hackathon setup): the treasury is the relayer's account.
   * False: the treasury gets its own account, which needs a fifth anvil account.
   */
  treasuryIsRelayer?: boolean;
  /** Test tokens minted to the treasury, in micro-USDC. Defaults to one million USDC. */
  treasuryFunds?: bigint;
}

export interface TestEscrow {
  chain: Chain;
  chainId: number;
  escrow: Address;
  /** TestUSDC, the escrow's token. Its owner (who can block addresses) is `accounts.owner`. */
  usdc: Address;
  /** Block of the escrow's deployment receipt. */
  deployedAtBlock: bigint;
  /** Distinct funded anvil accounts, except `treasury`, which is `relayer` by default. */
  accounts: TestEscrowAccounts;
  publicClient: TestPublicClient;
  /** One wallet client per role, each signing with that role's account. */
  wallets: Record<EscrowRole, TestWalletClient>;
  /** Signs `quote` with EIP-712, the shared `QUOTE_TYPES` and `quoteDomain`. Oracle by default. */
  signQuote: (quote: Quote, signer?: LocalAccount) => Promise<Hex>;
  /** Timestamp of the latest block, in Unix seconds. */
  latestTimestamp: () => Promise<bigint>;
  /** Moves chain time forward by `seconds` and mines a block; returns the new block's timestamp. */
  advanceTime: (seconds: bigint | number) => Promise<bigint>;
  /** Mints test tokens to `to`, in micro-USDC. */
  mint: (to: Address, amount: bigint) => Promise<void>;
}

async function confirm(publicClient: TestPublicClient, hash: Hash, what: string): Promise<bigint> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new TestEscrowError(`${what} reverted (${hash})`);
  return receipt.blockNumber;
}

async function deploy(
  publicClient: TestPublicClient,
  wallet: TestWalletClient,
  artifact: ContractArtifact,
  args: readonly unknown[],
  what: string,
): Promise<{ address: Address; blockNumber: bigint }> {
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || receipt.contractAddress == null) {
    throw new TestEscrowError(`deployment of ${what} failed (${hash})`);
  }
  return { address: getAddress(receipt.contractAddress), blockNumber: receipt.blockNumber };
}

/**
 * Deploys TestUSDC and WinzEscrow on a local chain from the committed artifacts (no forge
 * needed), funds the treasury with test tokens and has it approve the escrow. Test helper: the
 * accounts come from anvil's public mnemonic.
 *
 * Accounts by anvil index: 0 owner (also deploys both contracts), 1 relayer, 2 oracle,
 * 3 merchant, 4 treasury when `treasuryIsRelayer` is false.
 */
export async function deployTestEscrow(
  anvil: AnvilInstance,
  options: DeployTestEscrowOptions = {},
): Promise<TestEscrow> {
  const treasuryIsRelayer = options.treasuryIsRelayer ?? true;
  const treasuryFunds = options.treasuryFunds ?? DEFAULT_TREASURY_FUNDS;
  const needed = treasuryIsRelayer ? 4 : 5;
  if (anvil.accounts.length < needed) {
    throw new TestEscrowError(
      `deployTestEscrow needs ${String(needed)} anvil accounts, the chain has ${String(anvil.accounts.length)}`,
    );
  }
  const at = (index: number): HDAccount => {
    const account = anvil.accounts[index];
    if (account === undefined) throw new TestEscrowError(`no anvil account ${String(index)}`);
    return account;
  };
  const relayer = at(1);
  const accounts: TestEscrowAccounts = {
    owner: at(0),
    relayer,
    oracle: at(2),
    merchant: at(3),
    treasury: treasuryIsRelayer ? relayer : at(4),
  };

  const escrowArtifact = loadArtifact("WinzEscrow");
  const usdcArtifact = loadArtifact("TestUSDC");
  if (JSON.stringify(escrowArtifact.abi) !== JSON.stringify(winzEscrowAbi)) {
    throw new TestEscrowError(
      "artifacts/WinzEscrow.json and winzEscrowAbi differ: run node scripts/export-abi.mjs",
    );
  }
  assertAbiSubset(testUsdcAbi, usdcArtifact.abi, "testUsdcAbi");

  const chain = defineChain({
    id: anvil.chainId,
    name: "Local anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [anvil.rpcUrl] } },
  });
  const transport = http(anvil.rpcUrl);
  const publicClient: TestPublicClient = createPublicClient({ chain, transport });
  const walletFor = (account: HDAccount): TestWalletClient =>
    createWalletClient({ account, chain, transport });
  const wallets: Record<EscrowRole, TestWalletClient> = {
    owner: walletFor(accounts.owner),
    relayer: walletFor(accounts.relayer),
    oracle: walletFor(accounts.oracle),
    treasury: walletFor(accounts.treasury),
    merchant: walletFor(accounts.merchant),
  };

  const usdc = await deploy(publicClient, wallets.owner, usdcArtifact, [], "TestUSDC");
  const escrow = await deploy(
    publicClient,
    wallets.owner,
    escrowArtifact,
    [
      usdc.address,
      accounts.relayer.address,
      accounts.oracle.address,
      accounts.treasury.address,
      accounts.owner.address,
    ],
    "WinzEscrow",
  );

  const mint = async (to: Address, amount: bigint): Promise<void> => {
    const hash = await wallets.owner.writeContract({
      address: usdc.address,
      abi: testUsdcAbi,
      functionName: "mint",
      args: [to, amount],
    });
    await confirm(publicClient, hash, "TestUSDC.mint");
  };

  await mint(accounts.treasury.address, treasuryFunds);
  const approval = await wallets.treasury.writeContract({
    address: usdc.address,
    abi: testUsdcAbi,
    functionName: "approve",
    args: [escrow.address, maxUint256],
  });
  await confirm(publicClient, approval, "treasury approval");

  const domain = quoteDomain(anvil.chainId, escrow.address);
  const latestTimestamp = async (): Promise<bigint> =>
    (await publicClient.getBlock({ blockTag: "latest" })).timestamp;

  return {
    chain,
    chainId: anvil.chainId,
    escrow: escrow.address,
    usdc: usdc.address,
    deployedAtBlock: escrow.blockNumber,
    accounts,
    publicClient,
    wallets,
    signQuote: (quote, signer = accounts.oracle) =>
      signer.signTypedData({ domain, types: QUOTE_TYPES, primaryType: "Quote", message: quote }),
    latestTimestamp,
    advanceTime: async (seconds) => {
      const step = BigInt(seconds);
      if (step < 0n) throw new TestEscrowError("chain time cannot move backwards");
      await anvil.rpc("evm_increaseTime", [Number(step)]);
      await anvil.rpc("evm_mine");
      return latestTimestamp();
    },
    mint,
  };
}
