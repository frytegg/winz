# @winz/contracts

`WinzEscrow`, the escrow behind "refunded if the team wins" promotions (SPEC section 8), with
`TestUSDC`, a mintable 6-decimal token that can block an address. Foundry project, Solidity 0.8.28,
EVM version Cancun. Testnet only: every script refuses to run on Ethereum mainnet (chain id 1) and
Arc mainnet (chain id 5042).

| Path                  | What it holds                                                                           |
| --------------------- | --------------------------------------------------------------------------------------- |
| `src/`                | `WinzEscrow.sol`, `interfaces/IWinzEscrow.sol`, `mocks/TestUSDC.sol`                    |
| `script/`             | `Deploy.s.sol`, `Approve.s.sol`, and `TestnetOnly.sol`, their shared mainnet guard      |
| `test/`               | Unit, scenario and invariant tests; `test/script/` runs both scripts in-process         |
| `artifacts/`          | Committed `{ abi, bytecode }` of `WinzEscrow` and `TestUSDC`, for TypeScript tests      |
| `deployments/`        | One `<chainId>.json` per chain the escrow was deployed on (see below)                   |

## Build, test, check the artifacts

From this directory:

```sh
pnpm exec forge build
pnpm test              # forge test, then node ../../scripts/export-abi.mjs --check
pnpm exec forge fmt --check
```

`pnpm test` fails when the committed ABI or artifacts no longer match what the compiler produces,
so CI catches a contract change that was not exported. After changing a contract:

```sh
pnpm export-abi        # forge build, then node ../../scripts/export-abi.mjs
```

This rewrites three files, all to be committed with the change:

- `packages/shared/src/abi/winz-escrow.ts`: `winzEscrowAbi`, the ABI of the implementation
  `WinzEscrow`. It is a superset of `IWinzEscrow`: it adds `setRoles`, the `Ownable` functions and
  events, `eip712Domain`, `QUOTE_TYPEHASH` and the OpenZeppelin custom errors
  (`OwnableUnauthorizedAccount`, `SafeERC20FailedOperation`, ...), so the engine can decode every
  revert the deployed contract can produce.
- `artifacts/WinzEscrow.json` and `artifacts/TestUSDC.json`: `{ abi, bytecode }`. The engine's
  `deployTestEscrow` (`apps/engine/src/testing/escrow.ts`) deploys from these, without forge.

The bytecode is reproducible: `foundry.toml` sets `bytecode_hash = "none"` and
`cbor_metadata = false`, so no metadata hash is appended and the output does not depend on the
machine or the directory it was built in. Two clean builds in two different directories gave
byte-identical bytecode for both contracts.

## Deploy to Arc testnet

Nothing in this repository has been deployed by these scripts yet. The commands below are what to
run; read them before running them.

Arc specifics (SPEC section 8): gas is paid in USDC and the base fee never goes below 20 gwei, so
every transaction needs a `maxFeePerGas` of at least 20 gwei. `--with-gas-price` sets exactly that
for EIP-1559 transactions. The public RPC is limited to about 10 requests per second: prefer the
QuickNode URL.

### 1. Environment

Keys stay in environment variables, never in a file of this package and never in a command you
paste into a shared log. Load them from the repository's `.env` (not committed) or from your
secret manager, then:

```sh
export ARC_RPC_URL="https://rpc.testnet.arc.io"   # or the QuickNode URL
# The relayer deploys, and is also the treasury in the hackathon setup.
export DEPLOY_RELAYER="$(cast wallet address --private-key "$ARC_RELAYER_PRIVATE_KEY")"
export DEPLOY_ORACLE="$(cast wallet address --private-key "$ARC_ORACLE_PRIVATE_KEY")"
export DEPLOY_TREASURY="$DEPLOY_RELAYER"
export DEPLOY_OWNER="0x..."                       # the address allowed to rotate the roles
# Token: unset means the USDC ERC-20 interface on Arc, 0x3600000000000000000000000000000000000000.
# export DEPLOY_USDC="0x..."
# Fallback when no testnet USDC allocation came through (SPEC hypothesis 8): deploy TestUSDC.
# export DEPLOY_TEST_USDC="true"
```

| Variable           | Required | Meaning                                                                   |
| ------------------ | -------- | ------------------------------------------------------------------------- |
| `DEPLOY_RELAYER`   | yes      | Creates campaigns, buys, pauses and closes for merchants                  |
| `DEPLOY_ORACLE`    | yes      | Signs quotes, charges hedge costs, settles                                |
| `DEPLOY_TREASURY`  | yes      | Pays purchases and budgets; must approve the escrow (step 3)              |
| `DEPLOY_OWNER`     | yes      | Can rotate the three roles above, nothing else                            |
| `DEPLOY_USDC`      | no       | Token address; defaults to the Arc USDC ERC-20 interface                  |
| `DEPLOY_TEST_USDC` | no       | `"true"` deploys `TestUSDC` first and uses it; refused with `DEPLOY_USDC` |
| `APPROVE_ESCROW`   | no       | Escrow for `Approve.s.sol`; defaults to `deployments/<chainId>.json`      |

### 2. Deploy

Rehearse first. Without `--broadcast` nothing is sent and `deployments/` is not written; the
record is printed instead:

```sh
pnpm exec forge script script/Deploy.s.sol \
  --rpc-url "$ARC_RPC_URL" --private-key "$ARC_RELAYER_PRIVATE_KEY"
```

Then broadcast:

```sh
pnpm exec forge script script/Deploy.s.sol \
  --rpc-url "$ARC_RPC_URL" --private-key "$ARC_RELAYER_PRIVATE_KEY" \
  --broadcast --with-gas-price 25gwei --priority-gas-price 1gwei
```

The constructor refuses a token whose `decimals()` is not 6. After deploying, the script reads
`usdc()`, `relayer()`, `oracle()`, `treasury()` and `owner()` back from the escrow and reverts if
any differs from its input. With `DEPLOY_TEST_USDC=true` the broadcasting account owns `TestUSDC`,
and is the only one able to block an address on it.

### 3. Treasury approval

The escrow pulls budgets, purchases and merchant payments from the treasury with `transferFrom`,
so the treasury approves it once, for the maximum amount, with the treasury's own key:

```sh
pnpm exec forge script script/Approve.s.sol \
  --rpc-url "$ARC_RPC_URL" --private-key "$ARC_RELAYER_PRIVATE_KEY" \
  --broadcast --with-gas-price 25gwei --priority-gas-price 1gwei
```

The script approves the escrow's own token (`usdc()`), refuses to run when the broadcasting account
is not the escrow's `treasury()`, and checks the allowance afterwards. Run it again after the owner
rotates the treasury with `setRoles`, from the new treasury.

### 4. Configure the apps

Copy `escrow` and `usdc` from `deployments/5042002.json` into `ARC_ESCROW_ADDRESS` and
`ARC_USDC_ADDRESS` of the engine and web app environments, and commit the deployment record.

### 5. Verify on the explorer

The explorer is Blockscout at https://explorer.testnet.arc.io. This was run on 17 November 2026
for the deployment in `deployments/5042002.json` and the explorer answered "Pass - Verified"
(a partial match, which is expected: the build strips the metadata hash to keep bytecode
reproducible). The exact command and the result are in `docs/arc-testnet.md`. The form below is
the same command with the addresses read from the deployment record:

```sh
ESCROW="$(jq -r .escrow deployments/5042002.json)"
USDC="$(jq -r .usdc deployments/5042002.json)"
pnpm exec forge verify-contract "$ESCROW" src/WinzEscrow.sol:WinzEscrow \
  --chain-id 5042002 --rpc-url "$ARC_RPC_URL" \
  --verifier blockscout --verifier-url "https://explorer.testnet.arc.io/api/" \
  --compiler-version 0.8.28 \
  --constructor-args "$(cast abi-encode "constructor(address,address,address,address,address)" \
    "$USDC" "$DEPLOY_RELAYER" "$DEPLOY_ORACLE" "$DEPLOY_TREASURY" "$DEPLOY_OWNER")"
```

For `TestUSDC`, when it was deployed: the same command with `"$USDC" src/mocks/TestUSDC.sol:TestUSDC`
and no `--constructor-args`. Because the bytecode carries no metadata hash, Blockscout can at best
report a partial match (sources compile to the same bytecode), not a full metadata match.

### Local rehearsal

To run the whole sequence on a local chain, start anvil with a chain id of its own, so the record
lands in `deployments/31337.json` and never overwrites the Arc testnet one:

```sh
pnpm exec anvil --chain-id 31337
```

then run steps 2 and 3 with `--rpc-url http://127.0.0.1:8545` and one of anvil's printed
development keys. Do not commit `deployments/31337.json`.

## `deployments/<chainId>.json`

Written by `Deploy.s.sol` on a broadcast run (and by its tests, which delete their records):

```json
{
  "chainId": 5042002,
  "deployedAtBlock": 12345678,
  "escrow": "0x...",
  "oracle": "0x...",
  "owner": "0x...",
  "relayer": "0x...",
  "testUsdc": false,
  "treasury": "0x...",
  "usdc": "0x..."
}
```

| Field             | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `chainId`         | Chain the escrow lives on; also the file name                                 |
| `escrow`          | `WinzEscrow` address                                                          |
| `usdc`            | Token the escrow settles in: Arc USDC, a given token, or the deployed TestUSDC |
| `testUsdc`        | `true` when `usdc` is a `TestUSDC` deployed by the script                     |
| `relayer`, `oracle`, `treasury`, `owner` | The roles set at construction, as read back from the chain |
| `deployedAtBlock` | Block number at simulation time, just before broadcasting                     |

`deployedAtBlock` is a lower bound of the block that actually includes the deployment, never
above it, so it is a safe starting block for an indexer. The record is written during the
simulation that precedes the broadcast: if the broadcast then fails, the file describes a
deployment that did not happen. Check the escrow address on the explorer before committing it.
Fields are written in alphabetical order by Foundry's JSON serializer.
