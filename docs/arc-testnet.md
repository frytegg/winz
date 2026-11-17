# Arc testnet: deployment and receipts

Chain id 5042002 · RPC `https://rpc.testnet.arc.io` · explorer `https://explorer.testnet.arc.io`

## Addresses

| What | Address |
|---|---|
| WinzEscrow | `0x81d2d4050E617184b2B832c30BE68f8811b37D2c` |
| USDC (ERC-20 interface, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Relayer, treasury and owner | `0x39bbD1b075B43194588d65209A25292C76C88D31` |
| Oracle | `0x8EECc9D6C14E99eeebC9ec078111B4c7c356c602` |

The machine-readable record is `packages/contracts/deployments/5042002.json` (deployed at block 72727350).
The treasury has approved the escrow for the maximum amount.

## How it was deployed (17 November 2026)

Standard Foundry 1.7.1 from npm, no Arc-specific fork: the dry run and the broadcast both worked
against the public RPC with `--with-gas-price 25gwei` (the node quoted 25 gwei; Arc's floor is 20).
Deployment cost about 0.076 USDC of gas.

```bash
cd packages/contracts
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.io --private-key "$ARC_RELAYER_PRIVATE_KEY" --with-gas-price 25gwei --broadcast
forge script script/Approve.s.sol --rpc-url https://rpc.testnet.arc.io --private-key "$ARC_RELAYER_PRIVATE_KEY" --with-gas-price 25gwei --broadcast
```

The source is verified on the explorer (Blockscout), contract name `WinzEscrow`:
https://explorer.testnet.arc.io/address/0x81d2d4050E617184b2B832c30BE68f8811b37D2c

```bash
forge verify-contract 0x81d2d4050E617184b2B832c30BE68f8811b37D2c src/WinzEscrow.sol:WinzEscrow \
  --chain-id 5042002 --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address,address)' <usdc> <relayer> <oracle> <treasury> <owner>)" --watch
```

## Receipt: one full campaign lifecycle on the real chain

Campaign 1, ticket 1. Unit price 1.00 USDC, refund rate 50 %, budget 1.00, two units bought
(paid 2.00, refundable 1.00, hedge guarantee 0.20), hedge charged 0.15, settled YES.
Merchant and buyer were the oracle wallet, so no USDC left wallets we hold.

| Step | Transaction | Gas |
|---|---|---|
| createCampaignFor | `0x0f279f44a3e9b51ed2b34616f71dc4ff61e583abe230aaa627841aad884681b3` | 161,513 |
| buyFor, quote signed by the oracle (EIP-712) | `0x6132ec1792934d3bbf0c68c99087f3b4dead55da64d6a1a9938d1ac2bdf79e62` | 243,761 |
| closeSales | `0x791252b1a221bc61857265cf8a8c6cd99dded14b3fbaf19e50a98de34e2c1137` | 32,662 |
| chargeHedge | `0x025a2fdf5e187711d8e83a564d5e499f52a59a97e16c9a1bf58cc901e72728b2` | 85,043 |
| settle (YES) | `0xa4ba6df96d631cfdcd412892b51d5fc660343f9633649bccd7cf45b579320157` | 57,439 |
| refundBatch (1 ticket) | `0x040bf4e3e37c8bfb6a3e43464e170db809099acac9d848740260c0292abe0d1b` | 79,144 |
| payMerchant | `0x66d4cf0429f12f42ec32fe6b89cb17d78aa2effeec6642676d5cd441cee55750` | 73,984 |
| release | `0x7967d582e5b724116edcbf6bd14c64ab36eca955c7b007e2c8a107db0114819a` | 70,083 |

Balances, in USDC:

| Wallet | Before | After | Change |
|---|---|---|---|
| Relayer and treasury | 97.921599 | 94.055071 | −3.85 and gas: budget 1.00, purchase 2.00, merchant payout 1.00, less 0.15 of hedge charge received |
| Oracle (merchant and buyer here) | 2.000000 | 5.846437 | +3.85 less gas: 1.00 non-refundable part, 1.00 refund, 1.00 payout, 0.85 unused budget |
| Escrow | 0 | 0 | holds nothing once the campaign is settled and released |

The engine was then run against the real chain with an empty database: it read all ten events of
the contract (two from the deployment, eight from this lifecycle) from the public RPC in about
1.5 s, in chain order. This campaign has no row off-chain, so the engine leaves its events
unprojected; set `ARC_ESCROW_DEPLOY_BLOCK=72727571` to start reading after it.

Final on-chain state of the campaign: status SettledYes, hedge spent 0.15, hedge reserved 0,
locked refunds 0, merchant due 0, released.
