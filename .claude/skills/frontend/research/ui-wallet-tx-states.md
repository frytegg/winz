# Wallet connection and transaction-state UI beyond EVM: Cardano, Ledger, and chain-agnostic states
> Code FD18 · slug ui-wallet-tx-states · researched 2026-10-01 · verified 2026-10-01 · counts: verified 16 / corrected 10 / downgraded 0 / dropped 0 / added 1

## Summary

- CIP-30 (Active) is a two-stage bridge: `enable()` asks for consent once, and every `signTx`/`signData` must ask again. Its error codes map directly onto UI states: APIError -1 to -4, where -3 is Refused and -4 is AccountChange ("call `wallet.enable()`"); TxSignError 1 ProofGeneration and 2 UserDeclined (CIP-95 adds 3 DeprecatedCertificate); TxSendError 1 Refused and 2 Failure. Returned addresses are hex bytes and must be encoded to bech32 before display (F01, F03).
- `getNetworkId()` returns 0 for every testnet, so CIP-30 alone cannot tell preprod (magic 1) from preview (magic 2). CIP-142 `getNetworkMagic()` is only "Proposed" and absent from the accepted-extensions register. The app must compare the wallet's network with its own provider and block on a wrong-network state that says how to switch (F02).
- Libraries on 2026-10-01: `@meshsdk/core` 1.9.1 (Apache-2.0). `@meshsdk/react`'s `latest` tag is 2.0.0-beta.2; its last stable release is 1.8.14 (2025-01-25) and its repository was last pushed 2026-02-12. `@lucid-evolution/lucid` 0.6.5 (MIT). `lucid-cardano` is deprecated. `@cardano-foundation/cardano-connect-with-wallet` 0.2.22 (Apache-2.0). Ledger DMK 1.10.0 (Apache-2.0, peers `rxjs` at exactly 7.8.2) (F04, F08).
- Prebuilt Cardano connect UIs put their defaults on the jury's screen. Mesh's dialog closes before `connect` resolves and carries "Powered by Mesh SDK". The Cardano Foundation button's error handler defaults to `window.alert`, and its CIP-45 name defaults to "Awesome DApp". Build the dialog yourself and use the libraries only for state (F05).
- Wallets: Chrome Web Store counters show Yoroi (now "SecondFi") at 200,000 users, Eternl 100,000, Lace 80,000, Typhon, NuFi and Vespr 10,000 each, and Begin 1,000. Nami is now a migration path into Lace, and Flint's listing is gone. Live dApps list 5 to 8 wallets. Liqwid marks each missing wallet "Install"; SundaeSwap shows only detected wallets. Indigo's toast and Liqwid's banner after a refused connection both disappeared within 6 s (F06, F07) (corrected: transience added from the verification run).
- Ledger: LedgerJS is deprecated, and per Ledger "Starting in September 2026, it will no longer work with the Ethereum app". Use the DMK. No DMK signer kit exists for Cardano (12 kits are published), yet a live Cardano dApp, Minswap, connects a Ledger directly over USB or Bluetooth without a browser wallet, apparently through the LedgerJS-style `@cardano-foundation/ledgerjs-hw-app-cardano` (F27, added at verification). The DMK exposes 5 action statuses and 18 `UserInteractionRequired` values, and Ledger warns that a promise wrapper "discards intermediate states" that a UI needs. WebHID works only in desktop Chromium, in a secure context, from a user gesture (F08 to F10).
- Device versus screen: the device shows the intent first, then From, Amount, To and Fees, then "Hold to sign" (2 s). Blind signing is off by default and warned every time. Address verification shows the full address "to compare with its software counterpart". The screen must say whether clear signing is active (F11). Ledger Wallet (formerly Ledger Live) itself says "Broadcasting transaction..." and, for an uncertain broadcast, "Your transaction may have failed. Please wait a moment then check the transaction history before trying again." (F12). Ledger's marks "may not be used for products or services that are not respectively manufactured or offered by Ledger": name the device in instructions, never use the logo (F13).
- Timing: Cardano targets a block about every 20 s (active slot coefficient 0.05, 1 s slots). Measured over 1,000 blocks on 2026-09-30: preprod mean 22.7 s, p90 51 s, p99 111 s, max 162 s; mainnet mean 19.6 s, p99 87 s (percentiles by Python's default exclusive method; linear interpolation gives preprod p99 108 s). The Cardano Developer Portal says "most applications treat 10-20 confirmations (a few minutes) as strong finality", with k = 2160 blocks (~12 h) as the hard rollback bound (corrected: the portal reports common practice rather than setting the threshold itself; percentile method stated). BSC runs 0.45 s blocks (BEP-619; measured 450.3 ms) with fast finality in ~1.125 s (F14).
- Waiting: give feedback within 0.1 s. Show a spinner only after 500 ms and keep it at least 200 ms (spin-delay defaults). Past 10 s a wait needs an estimate and a way out (Nielsen), so a Cardano inclusion wait needs a step indicator reading "usually about 20 seconds", not a bare spinner (F15).
- Dropped, replaced and failed mean different things per chain. On EVM a transaction is replaced, repriced or cancelled through its nonce (viem). A Cardano node silently drops a transaction whose inputs were spent or whose validity window passed. Resubmitting the same bytes is safe only while the window is open, and a `BadInputsUTxO` after resubmission "can simply mean it succeeded". Only a phase-2 script failure costs collateral (F16). Indexers answer "not yet" with HTTP 200 and a null, not a 404 (Koios, F17), and explorer confirmation counts can be wrong: Cexplorer's preprod page showed "Low (0)" for a transaction Koios counted at 153 confirmations (F17) (corrected: added at verification).
- Explorer links: HTTP status never separated a real hash from a fake one. Cexplorer returns the same 200 shell for both, and its fake-hash page switches to "This page doesn't exist..." only 3 to 10 s after load; Etherscan returns 200 with "Transaction Hash not found"; Cardanoscan and BscScan return 403 Cloudflare challenges even to headless Chromium. Check existence through an indexer, render-check Cexplorer on both markers after waiting, and build Cardano URLs from the Cardano Foundation's resolver templates (F20, F21) (corrected: the original said Cexplorer never shows a not-found message).
- Addresses: the USENIX Security 2025 study counts 270M poisoning attempts against 17M victims, with at least 83.8M USD lost. The wallets it checked showed 4+4 (MetaMask, Phantom) or 2+4 (Trust Wallet) characters, and the largest attacker group matched up to 20 hex digits across both ends. Show the full address wherever the user decides or verifies; elsewhere show more characters, with the full value in a tooltip and in the accessible name, knowing that no short truncation stops a 20-digit match (F22, F23) (corrected: "the attack exploits 4+4 abbreviations" was an inference; the 20-digit bound added). For ADA Handles the `$` is display-only; re-resolve on submit; preprod Handles resolve through `preprod.api.handle.me` (F24).
- Amounts: 1 ADA = 1,000,000 lovelace, and the maximum supply of 45e15 lovelace is 5 times `Number.MAX_SAFE_INTEGER`. Format from BigInt or decimal strings, which `Intl.NumberFormat` keeps exact (measured). Token decimals come from CIP-26 (0 to 19) or CIP-68 (optional); when decimals are unknown, show raw units with a label saying the decimals are unknown (ERC-7730's "Unknown token" warning is for a token that cannot be resolved, not for missing decimals) (corrected: the original summary conflated the two). Testnet values say "tADA" and never show fiat (F25, F26).

## Findings

### FD18-F01 — CIP-30 gives a two-stage consent model and an error vocabulary that maps one-to-one onto UI states
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - CIP-30 ("Cardano dApp-Wallet Web Bridge", Status: Active, created 2021-04-29, CC-BY-4.0) injects `window.cardano.{walletName}` with `enable()`, `isEnabled()`, `apiVersion`, `supportedExtensions`, `name` and `icon`.
  - `enable()` returns the full API once the user consents; a wallet may keep an allowlist and skip the prompt next time.
  - Read methods need no interaction. `signTx()` and `signData()` must ask the user "for each and every API call".
  - Error types:
    - `APIError`: InvalidRequest -1, InternalError -2, Refused -3, AccountChange -4.
    - `TxSignError`: ProofGeneration 1, UserDeclined 2.
    - `DataSignError`: ProofGeneration 1, AddressNotPK 2, UserDeclined 3.
    - `TxSendError`: Refused 1, Failure 2.
    - `PaginateError`: `{maxSize}`.
  - Every returned `Address` is hex bytes, not bech32.
  - `submitTx()` returns the transaction id "for the dApp to track".
  - The spec defines no timeout for `enable()` or `signTx()`, and no signal that the user closed the wallet window other than a rejected promise (OBSERVED, by reading the full text).
- **Implication for /frontend:**
  - Model the connection and signing flow as a state machine keyed on these codes (Deliverable A):
    - -3 means "not connected, user can retry";
    - -4 means "re-run `enable()` silently and refresh", not an error screen;
    - `TxSignError` 2 means "cancelled, nothing sent";
    - `TxSignError` 1 means "this account cannot sign";
    - `TxSendError` 1 or 2 means "not sent".
  - Encode addresses to bech32 before display (F22).
  - Never show the wallet's `info` string as the headline: it is free text written by the wallet.
  - Because there is no timeout, the "awaiting signature" state needs its own help text and a way to stop waiting (F15).
- **Evidence:**
  - [CIP-0030 README](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) — Cardano Foundation CIPs repository, master, accessed 2026-10-01 — specification.
    - "The API is split into two stages to maintain the user's privacy, as the user will have to consent to `cardano.{walletName}.enable()` in order for the dApp to read any information pertaining to the user's wallet"
    - "All read-only methods (all but the signing functionality) should not require any user interaction as the user has already consented to the dApp reading information about the wallet's state when they agreed to `cardano.{walletName}.enable()`. The remaining methods `api.signTx()` and `api.signData()` must request the user's consent in an informative way for each and every API call in order to maintain security."
    - "AccountChange - The account has changed. The dApp should call `wallet.enable()` to reestablish connection to the new account. The wallet should not ask for confirmation as the user was the one who initiated the account change in the first place."
    - "UserDeclined - User declined to sign the transaction" · "Refused - Wallet refuses to send the tx (could be rate limiting)" · "Failure - Wallet could not send the tx"
    - "All return types containing `Address` must return the hex-encoded bytes format, but must accept either format for inputs."
    - "If the wallet accepts the transaction and tries to send it, it shall return the transaction id for the dApp to track."
- **Limits / false positives:**
  - The spec says what wallets should do. I tested no real wallet in this session.
  - Wallets may throw non-conforming objects (for example a plain `Error` with no `code`), so the state machine needs a fallback "unknown error" branch that keeps the raw error for diagnostics.
  - `getCollateral()` is deprecated in the same document.

### FD18-F02 — CIP-30 cannot tell preprod from preview; CIP-142 is only Proposed, so the app must cross-check the network itself
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - `getNetworkId()` returns 0 for testnet and 1 for mainnet.
  - CIP-142 (Status: Proposed, created 2024-01-17) adds `api.cip142.getNetworkMagic()`, returning 764824073 (mainnet), 1 (preprod) or 2 (preview).
    - Its acceptance checklist ticks Eternl and Gero and leaves Lace unticked.
    - It is not in the CIP-30 Accepted Extensions Register, which lists only 95, 103, 104 and 106.
  - Addresses carry the same distinction: the address header's low nibble is `0000` for "Testnet(s)" and `0001` for "Mainnet" (CIP-19), and the bech32 prefix is `addr` for mainnet and `addr_test` for testnets (CIP-5).
  - The genesis files, read on 2026-10-01:

    | Network | `networkMagic` | `epochLength` (slots) | `slotLength` | `activeSlotsCoeff` | `securityParam` |
    |---|---|---|---|---|---|
    | preprod | 1 | 432,000 | 1 | 0.05 | 2160 |
    | preview | 2 | 86,400 | 1 | 0.05 | 432 |
    | mainnet | 764824073 | 432,000 | 1 | 0.05 | 2160 |

  - Lucid Evolution says a CIP-30 wallet "will follow the current web-wallet's network", leaving the provider match to the developer.
  - The Cardano Foundation connector's `limitNetwork` accepts only `MAINNET` or `TESTNET`. It reads the network from the address header nibble (`Number(hexAddress.charAt(1))`), and its error message is written for developers.
- **Implication for /frontend:**
  - The wrong-network check runs at connect time and after every AccountChange (-4), in this order:
    1. `getNetworkId()` must equal the app's network id.
    2. If `getExtensions()` includes 142, compare the magic.
    3. Otherwise preprod and preview are indistinguishable from the wallet's answers, because testnet addresses share network tag 0. Derived heuristic, not tested: look up one of `getUtxos()`'s transaction inputs in the app's own preprod indexer. If it is not found, the wallet is probably on preview. The heuristic is undecidable for an empty wallet.
  - The blocking state names both networks and the fix. The portal's own wording supports that fix: "switch the network to Preprod or Preview in settings".
  - Never surface the connector's "You have tried to call functions on Testnet, while the network type is limited to Mainnet".
- **Evidence:**
  - [CIP-0030 README](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) — accessed 2026-10-01.
    - "Returns the network id of the currently connected account. 0 is testnet and 1 is mainnet but other networks can possibly be returned by wallets."
  - [CIP-0142 README](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0142/README.md) — Status: Proposed, created 2024-01-17, accessed 2026-10-01.
    - "Mainnet: 764824073" · "Preview Testnet: 2" · "Preprod Testnet: 1" · checklist "- [x] Eternl" "- [ ] Lace" "- [x] Gero"
  - [CIP-30 Accepted Extensions Register](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/extensions-register.md) — accessed 2026-10-01 — lists CIP-0095, CIP-0103, CIP-0104 and CIP-0106 only.
  - [CIP-0019](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0019/README.md) — accessed 2026-10-01 — network-tag table: "`....0000` | Testnet(s)", "`....0001` | Mainnet".
  - [shelley-genesis.json for preprod](https://book.play.dev.cardano.org/environments/preprod/shelley-genesis.json), [preview](https://book.play.dev.cardano.org/environments/preview/shelley-genesis.json) and [mainnet](https://book.play.dev.cardano.org/environments/mainnet/shelley-genesis.json) — Cardano Operations Book, accessed 2026-10-01 — configuration files; values in the table above.
  - [Lucid Evolution: Make Wallet From API](https://github.com/Anastasia-Labs/lucid-evolution/blob/main/docs/pages/documentation/core-concepts/wallet/wallet-creation/from-api.mdx) — Anastasia Labs, main, accessed 2026-10-01.
    - "Notice that the network will follow the current web-wallet's network. Make sure to provide a correct provider accordingly."
  - [cardano-connect-with-wallet react README](https://github.com/cardano-foundation/cardano-connect-with-wallet/blob/main/react/README.md) and [core/utils/errors.ts](https://github.com/cardano-foundation/cardano-connect-with-wallet/blob/main/core/utils/errors.ts) — Cardano Foundation, main, accessed 2026-10-01.
    - "| `limitNetwork` | `NetworkType` | — | Restrict to `MAINNET` or `TESTNET` |"
    - "You have tried to call functions on ${capitalize(currentNetwork)}, while the network type is limited to ${capitalize(targetNetwork)}."
  - [Choose a Network](https://developers.cardano.org/docs/developers/curriculum/start-building/networks-and-test-ada/) — Cardano Developer Portal (source last changed 2026-09-22), accessed 2026-10-01.
    - "Most Cardano browser and mobile wallets support both testnets: switch the network to Preprod or Preview in settings"
- **Limits / false positives:**
  - Which wallets implement CIP-142 today was not tested; the CIP's checklist is self-reported.
  - The UTxO-lookup heuristic is my derivation and was not run against a wallet.

### FD18-F03 — Extensions are negotiated, not guaranteed: request with `enable({ extensions })`, then trust only `getExtensions()`
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED (namespacing is recommended, not required, and CIP-95 overrides `signTx` un-namespaced; the CIP-95 gate for Plutus V3 dApps had no support in the CIP's text)
- **Claim:**
  - A dApp requests extensions as `[{ cip: N }]` at `enable()`. Wallets "aren't expected to fail" when they do not support one; they report what they enabled through `api.getExtensions()`. Extension endpoints are usually namespaced `api.cipN.*`: CIP-30 leaves namespacing "at the extension author's discretion" while "highly" recommending it, and CIP-95 deliberately leaves `.signTx()` un-namespaced so that it overrides CIP-30's (corrected: the original said extension endpoints are namespaced, as if always).
  - The register lists four accepted extensions:
    - CIP-95, Conway era (Active);
    - CIP-103, bulk signing (Active);
    - CIP-104, account public key (Proposed);
    - CIP-106, multisig.
  - CIP-95 repurposes the CIP-30 errors: `Refused` also covers "extension is no longer enabled", and `TxSignError` gains `DeprecatedCertificate: 3`, "Returned regardless of user consent".
  - CIP-95 calls itself a "flag to signal to apps at connection time a wallet's compatibility with Conway leger era".
  - CIP-95 lists Eternl, GeroWallet, Lace, Mesh, mLabs, NuFi, Typhon, Lido Nation, Vespr and Yoroi as implementors.
- **Implication for /frontend:**
  - Request `{ cip: 95 }` when the transaction carries Conway governance content (certificates, votes, proposals, DRep keys), read `getExtensions()`, and render a separate "this wallet can't sign this kind of transaction yet" state when 95 is missing. CIP-95's text never mentions Plutus, so do not block a plain Plutus V3 spend on a missing 95; let a `TxSignError` fall through to T3 (corrected: the original told every Plutus V3 dApp to gate on CIP-95, which the CIP does not support).
  - Whether current wallets sign a plain Plutus V3 spend without CIP-95 was not tested (see limits). Treat the extension as a capability to check, not an assumption.
  - With CIP-95 enabled, `api.signTx()` is CIP-95's version, not CIP-30's; code that feature-detects by namespace alone will miss it.
- **Evidence:**
  - [CIP-0030 README](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) — accessed 2026-10-01.
    - "Hence wallets aren't expected to fail should they not recognize or not support a particular combination of extensions. Instead, they should decide what they enable and reflect their choice in the response to `api.getExtensions()` in the Full API."
    - "It is at the extension author's discretion if they wish to separate their endpoints from the base API via namespacing. Although, it is highly recommend that authors do namespace all of their extensions." (added at verification)
  - [CIP-0095 README](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0095/README.md) — Status: Active, accessed 2026-10-01.
    - "`Refused` - The request was refused due to lack of access - e.g. wallet disconnects or extension is no longer enabled."
    - "`DeprecatedCertificate` - Returned regardless of user consent if the transaction contains a deprecated certificate."
    - "By providing _updated_ CIP-30 endpoints we essentially use the CIP-95 extension object as a flag to signal to apps at connection time a wallet's compatibility with Conway leger era."
    - "In this specification we have chosen to explicitly namespace all endpoint except `.signTx()` where we omit the namespacing. By not namespacing `.signTx()` we intend to offer client apps an override of the CIP-30 `.signTx()`." (added at verification)
    - A case-insensitive search of the CIP-95 text for "Plutus" returns no match (verification, 2026-10-01).
  - [CIP-0103](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0103/README.md) (Active; implementors JPG Store, Eternl, Typhon) and [CIP-0104](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0104/README.md) (Proposed) — accessed 2026-10-01.
- **Limits / false positives:** Implementor lists in CIPs are self-declared and dated; I did not test extension support in any wallet.

### FD18-F04 — Cardano connector libraries on 2026-10-01: versions, licences and maintenance signals
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The npm registry and GitHub report the following. "Pushed" is the repository's last push date.

  | Package | `latest` (published) | Licence | Maintenance signal | Note |
  |---|---|---|---|---|
  | `@meshsdk/core` | 1.9.1 (2026-06-19) | Apache-2.0 | MeshJS/mesh pushed 2026-09-28 | Depends on `@meshsdk/wallet` 1.9.1 |
  | `@meshsdk/react` | 2.0.0-beta.2 (2026-02-12); last stable 1.8.14 (2025-01-25) | Apache-2.0 | MeshJS/react pushed 2026-02-12 | The beta depends on `@meshsdk/wallet` 2.0.0-beta.5 and `@utxos/sdk` 0.1.5 |
  | `@meshsdk/wallet` | 2.0.0-beta.11 (2026-07-25); stable 1.9.1 | Apache-2.0 | — | A bare install pulls the beta |
  | `@lucid-evolution/lucid` | 0.6.5 (2026-09-17) | MIT | Anastasia-Labs pushed 2026-09-25 | — |
  | `lucid-cardano` | 0.10.11 (2024-11-27) | MIT | Deprecated on npm; spacebudz/lucid archived | Avoid |
  | `@cardano-foundation/cardano-connect-with-wallet` | 0.2.22 (2026-05-16) | Apache-2.0 | Pushed 2026-05-16 | Peers React >= 18.2.0, styled-components >= 6.3.12 |
  | `@cardano-foundation/cardano-connect-with-wallet-core` | 0.2.12 (2026-05-16) | Apache-2.0 | Same repository | No React dependency |
  | `@blaze-cardano/sdk` | 0.3.1 (2026-07-21) | None declared on npm; repository Apache-2.0 | Pushed 2026-08-24 | — |
  | `@evolution-sdk/evolution` | 0.5.16 (2026-09-30) | MIT | IntersectMBO, pushed 2026-09-30 | Pre-1.0 |
  | `@ada-anvil/weld` | 0.7.0 (2026-03-11) | MIT | Pushed 2026-06-19 | Peers `ethers` and `@solana/web3.js` (multi-chain) |
  | `@cardano-sdk/dapp-connector` | 0.13.31 (2026-09-25) | Apache-2.0 | input-output-hk/cardano-js-sdk pushed 2026-09-25 | — |
  | `@emurgo/cardano-serialization-lib-browser` | 17.0.0 (2026-08-07) | MIT (GitHub reports NOASSERTION) | Pushed 2026-09-25 | Beta 18.0.0-beta.1 |
  | `@fabianbormann/cardano-peer-connect` | 1.2.21 (2026-09-05) | Apache-2.0 | Pushed 2026-09-05 | CIP-45 peer-to-peer (QR) connection |
  | `bech32` | 2.0.0 (2021-02-15) | MIT | — | Default length limit 90 (F22) |

  - CIP-30's own deprecation note names Blaze, Mesh, Lucid Evolution and CSL as the current transaction-building SDKs.
  - Verification note: npm also carries `@blaze-cardano/sdk` 1.0.0 (published 2026-07-27, no licence field) under a `catalyst` dist-tag; `latest` stays 0.3.1.
- **Implication for /frontend:**
  - Pin exact versions. Never `pnpm add @meshsdk/react` or `@meshsdk/wallet` unpinned: the `latest` tag installs betas that pin a different `@meshsdk/wallet` from `@meshsdk/core` 1.9.1's.
  - If Mesh's React components are wanted, pin one consistent set: 1.8.14 exists for `core`, `wallet`, `common` and `react`.
  - Default: the project's own connect dialog on raw CIP-30, plus one transaction SDK (`@lucid-evolution/lucid` 0.6.5 or `@meshsdk/core` 1.9.1). Plutus V3 support in each was not verified here.
  - `@cardano-foundation/cardano-connect-with-wallet-core` 0.2.12 is useful only for its wallet registry (store links, CIP-158 deep links).
- **Evidence:**
  - npm registry documents `https://registry.npmjs.org/<package>` (`dist-tags`, `time`, `license`, `deprecated`, `peerDependencies`), accessed 2026-10-01, and `gh api repos/<owner>/<repo>` (`pushed_at`, `license`, `archived`), accessed 2026-10-01 — registry and repository metadata.
    - `lucid-cardano`: `deprecated='Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.'`; `spacebudz/lucid archived=true`
    - `@meshsdk/react`: `dist-tags {'latest': '2.0.0-beta.2'}`; last stable `('2025-01-25T06:28:16.294Z', '1.8.14')`; 2.0.0-beta.2 deps `'@meshsdk/wallet': '2.0.0-beta.5'`
  - [CIP-0030 README, getCollateral deprecation notice](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) — accessed 2026-10-01.
    - "Transaction-building SDKs and libraries now all support this functionality as well (see [Blaze](https://blaze.butane.dev/), [Mesh](https://meshjs.dev/), [Lucid Evolution](https://anastasia-labs.github.io/lucid-evolution/), [CSL](https://github.com/Emurgo/cardano-serialization-lib))."
- **Limits / false positives:**
  - Publish and push dates are maintenance signals, not quality.
  - I installed and ran none of these packages in this session.
  - Registry metadata can change within hours; re-query on the day.

### FD18-F05 — The prebuilt Cardano connect components ship visible defaults and hide failures
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **Mesh `CardanoWallet`**, from the MeshJS/react repository HEAD (package version 2.0.0-beta.2) and the same logic in the published 1.8.14 bundle:
    - Clicking a wallet calls `connect(...)` and immediately `setOpen(false)`, so the dialog never shows a connecting or failed state.
    - The dialog content always carries the `mesh-dark` class.
    - The footer links "Powered by … Mesh SDK" to meshjs.dev.
    - `showDownload` defaults to `true` and adds a "Download" tile that opens developers.cardano.org's wallet showcase.
    - The underlying `WalletContext` does track `NOT_CONNECTED | CONNECTING | CONNECTED` plus `error`, so a custom UI can render failure.
  - **Cardano Foundation `ConnectWalletButton` 0.2.22:**
    - `onConnectError` defaults to `alert(...)`.
    - `dAppName` defaults to `'Awesome DApp'` and `dAppUrl` to `'http://awesome-dapp-url.tld/'`; both are used in the CIP-45 QR dialog.
    - `peerConnectEnabled` defaults to `true`, and the accent defaults to `#0538AF`.
    - When a wallet is not installed, it opens the Chrome Web Store in a new window.
- **Implication for /frontend:**
  - Do not ship either component in a judged demo. Build the dialog from the project's primitives and drive it with CIP-30 directly, or with Mesh's context state.
  - If a component is kept anyway, override every default above.
  - The checker greps the built output for `Awesome DApp`, `awesome-dapp-url.tld`, `Powered by`, `mesh-dark` and `alert(` (see Deliverable F for the false-positive caveat on `alert(`).
- **Evidence:**
  - [MeshJS/react src/cardano-wallet/screen-main.tsx](https://github.com/MeshJS/react/blob/main/src/cardano-wallet/screen-main.tsx), [index.tsx](https://github.com/MeshJS/react/blob/main/src/cardano-wallet/index.tsx) and [contexts/WalletContext.ts](https://github.com/MeshJS/react/blob/main/src/contexts/WalletContext.ts) — MeshJS, HEAD = 2.0.0-beta.2, accessed 2026-10-01 — source code.
    - `connect(wallet.id, persist);` followed by `setOpen(false);`
    - `className="sm:mesh-max-w-[425px] mesh-dark"` · `<span className="">Powered by</span>` · `<span className="">Mesh SDK</span>` · `showDownload = true,`
    - `NOT_CONNECTED = "NOT_CONNECTED", CONNECTING = "CONNECTING", CONNECTED = "CONNECTED",` · in the catch branch: `setError(error); setState(WalletState.NOT_CONNECTED);`
  - [unpkg @meshsdk/react@1.8.14/dist/index.js](https://unpkg.com/@meshsdk/react@1.8.14/dist/index.js) — published bundle, accessed 2026-10-01.
    - `connect2(wallet.id, extensions, persist);` then `setOpen(false);` · `className: "sm:mesh-max-w-[425px] mesh-dark"`
  - [ConnectWalletButton.tsx](https://github.com/cardano-foundation/cardano-connect-with-wallet/blob/main/react/src/components/ConnectWalletButton/ConnectWalletButton.tsx) — Cardano Foundation, last commit 2026-05-15, accessed 2026-10-01 — source code.
    - ``onConnectError = (walletName: string, error: Error, level: 'error' | 'warn' = 'error') => alert(`${level}: ${error.message} (${walletName})`),``
    - `dAppName = 'Awesome DApp',` · `dAppUrl = 'http://awesome-dapp-url.tld/',` · `peerConnectEnabled = true,` · `Color('#0538AF')`
- **Limits / false positives:**
  - I read source code and did not render either component.
  - `onOpenAutoFocus={(event) => event.preventDefault()}` in Mesh's dialog may also affect keyboard focus; that was not tested.

### FD18-F06 — Which Cardano wallets people have: store counters, the registry and what is gone
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** The Chrome Web Store pages, read by the extension IDs in the Cardano Foundation connector registry on 2026-10-01:

  | Wallet (registry key) | Store title | Users shown | Updated | Version |
  |---|---|---|---|---|
  | Yoroi (`yoroi`) | "SecondFi (Yoroi)" | 200,000 | 2026-09-11 | 10.4.30 |
  | Eternl (`eternl`) | "Eternl" | 100,000 | 2026-09-21 | 2.2.0.13 |
  | Nami (`nami`) | "Nami" | 100,000 | 2025-02-06 | 3.9.6 |
  | Lace (`lace`) | "Lace" | 80,000 | 2026-09-30 | 2.4.2 |
  | Typhon (`typhoncip30`) | "Typhon Wallet" | 10,000 | 2026-09-30 | 3.2.36 |
  | NuFi (`nufi`) | "NUFI" | 10,000 | 2026-09-26 | 35.2.0 |
  | Vespr (`vespr`) | "VESPR Wallet" | 10,000 | 2026-05-18 | 300.4.0.3 |
  | GeroWallet (`gerowallet`) | "Gero Dashboard" | 9,000 | 2026-09-16 | 2.7.1 |
  | Begin (`begin`) | "Begin: Bitcoin Cardano Solana Wallet" | 1,000 | 2026-07-12 | 2.6.3 |
  | Flint (`flint`) | page resolves to "empty-title" | — | — | — |

  - Nami's page says it was integrated into Lace in December 2024 and will become "a full migration tool, only supporting the transition to Lace".
  - Yoroi's page calls it "SecondFi (formerly Yoroi)".
  - CIP-30's own implementor list (Begin, Eternl, Flint, GeroWallet, Lace, Nami, NuFi, RayWallet, Yoroi) and cardano-caniuse.io (Flint, Nami, Eternl, Gero, NuFi, Begin, Lace, Yoroi) still include Flint and Nami, and omit Vespr and Typhon.
  - Typhon injects itself as `window.cardano.typhoncip30`, not `typhon`.
- **Implication for /frontend:**
  - Default list, detected wallets first: Eternl, Lace, Yoroi (SecondFi), Vespr, Typhon, NuFi, Begin.
  - Do not list Nami or Flint.
  - Detect by the registry key (`typhoncip30` included).
  - Label tiles with the wallet's injected `name`, backed by the app's own allowlist of keys: any extension can inject a `name` and an `icon`.
- **Evidence:**
  - [Cardano Foundation wallet registry core/wallets.ts](https://github.com/cardano-foundation/cardano-connect-with-wallet/blob/main/core/wallets.ts) — accessed 2026-10-01 — `key: 'typhoncip30'`, `chromeExtensionId: 'kmhcihpebfmpgmihbkipmjlmmioameka'` (Eternl), and the others in the table.
  - Chrome Web Store detail pages, e.g. [Eternl](https://chromewebstore.google.com/detail/kmhcihpebfmpgmihbkipmjlmmioameka), [Lace](https://chromewebstore.google.com/detail/gafhhkghbfjjkeiendhlofajokpaflmk), [Nami](https://chromewebstore.google.com/detail/lpfcbjknijpeeillifnkikgncikgfhdo), [SecondFi (Yoroi)](https://chromewebstore.google.com/detail/ffnbelfdoeiohenkjibnmadjiehjhajb) — Google, accessed 2026-10-01 — store listings (vendor data).
    - Nami: "Nami is now part of the Lace family, bringing enhanced security and robust infrastructure to its users. As we integrated Nami into Lace in December 2024, we’re excited to introduce Nami Mode in Lace." · "in the future Nami will be a full migration tool, only supporting the transition to Lace."
    - Yoroi: "Join 1M+ users on SecondFi (formerly Yoroi), a self-custody neofinance platform"
  - [cardano-caniuse.io](https://www.cardano-caniuse.io/) — community, accessed 2026-10-01 — "Cardano Wallet API Compatiblity Matrix".
- **Limits / false positives:**
  - Store counters are bucketed, desktop Chrome only, and their definition of "users" was not verified. Mobile wallets (Vespr, Eternl mobile) are invisible here.
  - The "1M+ users" line is SecondFi's marketing, not a measurement.

### FD18-F07 — How live Cardano dApps present connection and its failures (observed 2026-10-01)
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** CORRECTED (Liqwid's error is a transient banner at the panel's foot, not an inline row error; Liqwid does not gate on terms; Minswap's dialog was observed at verification)
- **Claim:** In headless Chromium 1440×900, first with no wallet and then with an injected mock wallet whose `enable()` rejects with `{ code: -3 }`:
  - **Indigo** (app.indigoprotocol.io):
    - "Connect Wallet" dialog with a terms checkbox and 8 rows: Eternl, NuFi, Lace, Vespr, Typhon, OKX Wallet, Begin Wallet, Tokeo.
    - No installed or not-installed state per row; the row uses the icon injected by the wallet.
    - The wallet rows did not respond until the terms box was ticked: in the verification run, clicking Eternl first made no `enable()` call (added at verification).
    - After the refusal: a corner toast, "Connection failed" / "Failed to connect to Eternl. Please try again.", while the console logged `code: -3`. In the verification run the toast was visible from 0.5 s to at least 4 s after the click and gone by 6 s (corrected: transience added).
  - **Liqwid** (app.liqwid.finance):
    - A side panel with 5 rows (Eternl, Lace, Begin Wallet, Yoroi, Tokeo). Each missing wallet shows "Install →"; the mocked Eternl row lost its "Install".
    - After the refusal: a red banner with a close button at the bottom of the panel, not beside the Eternl row, "eternl: Connection declined (code: -3). Please approve the connection request in your wallet". In the verification run it was visible from 0.5 s to at least 4 s and gone by 6 s (corrected: the original called it an inline banner and did not record that it disappears).
    - No terms checkbox: the panel only says "By connecting a wallet, you agree to Liqwid's Terms of Service and consent to its Privacy Policy." (added at verification)
  - **SundaeSwap** (app.sundae.fi):
    - With no wallet, the grid showed only "CONNECT P2P WALLET (BETA)", a "Legal Disclaimer" consent, "Learn more about Wallets" and "Can't find your wallet?".
    - With the mock, an "ETERNL" tile appeared, so the dApp lists detected wallets only.
    - Connecting is two steps: pick a tile, then press "Connect to a Wallet". After that press with the refusing mock, no visible message appeared within 5 s.
  - **Minswap** (app.minswap.org redirects to minswap.org): a settings dialog lets the user choose the explorer (Cardanoscan, Cexplorer, AdaStat) and the display currency (USD or ADA). At verification the connect panel was also opened: it lists MinWallet, a direct Ledger connection, MetaMask, then Eternl, Begin and NUFI, each desktop wallet badged "Chromium only", with a consent line and no checkbox (F27) (corrected: the original reported the connect flow as unobserved).
  - **jpg.store**, still listed in CIP-30's acceptance criteria, now says "JPG Store says goodbye" and that the platforms "have been sunset".
- **Implication for /frontend:**
  - Copy Liqwid's per-row install state and its message pattern (what happened, then what to do), but put the error beside the wallet row and keep it until the next action: both observed refusal messages vanished within 6 s, which a judge glancing away would miss (corrected: the original presented Liqwid's error as an inline row error to copy).
  - Do not copy Indigo's generic "Please try again" or SundaeSwap's silence.
  - Keep the numeric code out of the headline (F19).
  - Indigo gates the wallet rows behind a terms checkbox and SundaeSwap's dialog carries one; Liqwid and Minswap use a consent-by-connecting line instead. A hackathon demo has no terms to show, so leave the gate out rather than invent one (corrected: the original said all three dApps gate on terms consent).
  - Minswap offers an explorer choice; one dApp does not show that users expect it. Link to the Cardano Foundation chooser (F20), or state which explorer the app uses (corrected: "Cardano users expect an explorer choice" overreached from one dApp).
- **Evidence:**
  - Playwright scripts `observe_dapps.py`, `observe_dapps2.py`, `mock_wallet_refusal.py` and `mock_sundae.py`, with screenshots `shots/dapp-indigo-1.png`, `shots/dapp2-liqwid.png`, `shots/mock-indigo-after.png`, `shots/mock-liqwid-after.png` and `shots/mock-sundaeswap-after-connect.png`, in the FD18 scratch folder — run 2026-10-01 — first-hand observation.
    - Indigo dialog text: "Connect Wallet By connecting your wallet, you agree to our Disclaimer , Use Terms , and our Privacy Policy . Eternl NuFi Lace Vespr Typhon OKX Wallet Begin Wallet Tokeo Close"
    - SundaeSwap dialog text: "Connect a Wallet Select the wallet you want to connect below. … CONNECT P2P WALLET (BETA) Legal Disclaimer … Can't find your wallet? Connect to a Wallet"
  - Verification scripts `fc/fc_dapps.py`, `fc/fc_dapps_timing.py` and `fc/fc_minswap.py`, outputs `fc/fc-dapps.json`, `fc/fc-dapps-timing.json` and `fc/fc-minswap.json` — run 2026-10-01 — first-hand observation.
    - `indigo_enable_calls_without_terms: 0`; snapshots after the click: 0.5 s to 4.0 s "Connection failed Failed to connect to Eternl. Please try again."; 6.0 s unchanged from the pre-click page.
    - Liqwid snapshots: 0.5 s to 4.0 s "eternl: Connection declined (code: -3). Please approve the connection request in your wallet"; 6.0 s unchanged from the pre-click page; `dialog_checkboxes: 0`.
    - SundaeSwap `dialog_checkboxes: 1`; after "Connect to a Wallet" the page text was unchanged 5 s later.
  - [CIP-0030, acceptance criteria](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0030/README.md) — lists "https://www.jpg.store/", "https://app.minswap.org/", "https://exchange.sundaeswap.finance/" and "https://app.indigoprotocol.io/".
- **Limits / false positives:**
  - Two runs per site (one original, one at verification), headless, no real wallet.
  - The mock exposes only `enable`, `isEnabled`, `name`, `icon`, `apiVersion` and `supportedExtensions`. SundaeSwap's silence may come from the mock, not from its error handling.
  - Liqwid and Indigo copy may change at any deploy.

### FD18-F08 — The Ledger Device Management Kit is the supported web stack; LedgerJS is deprecated; Cardano has no DMK signer
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (the Peers column marked four packages "—" although each declares peers; the Cardano-plus-Ledger implication ignored the direct dApp path observed on Minswap)
- **Claim:**
  - Registry on 2026-10-01, all Apache-2.0:

    | Package | Version (published) | Peers |
    |---|---|---|
    | `@ledgerhq/device-management-kit` | 1.10.0 (2026-09-28) | `rxjs` 7.8.2 (exact) |
    | `@ledgerhq/device-transport-kit-web-hid` | 1.2.4 | `rxjs` 7.8.2, DMK ^1.7.0 |
    | `@ledgerhq/device-transport-kit-web-ble` | 1.3.2 | `rxjs` 7.8.2, DMK ^1.0.0 |
    | `@ledgerhq/device-signer-kit-ethereum` | 1.18.1 | `@ledgerhq/context-module` ^2.6.0, DMK ^1.9.1 |
    | `@ledgerhq/context-module` | 2.6.0 | DMK ^1.9.1 |
    | `@ledgerhq/device-signer-kit-solana` | 1.13.3 | DMK ^1.10.0 |
    | `@ledgerhq/device-signer-kit-bitcoin` | 1.3.3 | `bitcoinjs-lib` ^6.1.6, DMK ^1.7.1 |
    | `@ledgerhq/device-transport-kit-speculos` | 1.2.1 | `rxjs` 7.8.2, DMK ^1.5.1 (emulator) |

    (corrected: the original table showed "—" for web-ble, context-module, bitcoin and speculos, and omitted `rxjs` for web-hid)
  - Ledger publishes 12 signer kits: ethereum, solana, cosmos, icp, concordium, zcash, bitcoin, aleo, hyperliquid, xrp, polkadot and tron. None is for Cardano.
  - Cardano's Ledger app binding is `@cardano-foundation/ledgerjs-hw-app-cardano` 8.0.0 (2026-07-07, Apache-2.0), a LedgerJS-style library.
  - Ledger's migration guide states that LedgerJS is deprecated and that "Starting in September 2026" it stops working with the Ethereum app. The same guide lists Tron and XRP among chains without a DMK signer, although kits for both are on npm.
- **Implication for /frontend:**
  - For Ledger OP3N (EVM): DMK 1.10.0 + web-hid 1.2.4 + signer-kit-ethereum 1.18.1 + context-module 2.6.0, with `rxjs` pinned to 7.8.2. The peer ranges above are compatible with that set.
    - Build the DMK once, as a singleton.
    - Use the Speculos transport for development and screen recordings when no device is at hand.
  - For Cardano plus a Ledger (Origins), two paths exist (corrected: the original named only the first):
    - The user's CIP-30 wallet paired with their Ledger ("Hardware devices work through the same browser extensions"). The dApp then sees only CIP-30 and cannot read device prompts, so it can only hint: "If your wallet uses a Ledger, confirm on the device."
    - The dApp drives the device itself, as Minswap does (F27), through `@cardano-foundation/ledgerjs-hw-app-cardano` over a LedgerJS transport, or through the DMK's raw `sendApdu()`/`sendCommand()`, which Ledger names as the route for chains without a signer. Either way the dApp sees the device steps and can show the mirror panel of F11, at the cost of building on a library family Ledger calls deprecated or of writing APDUs by hand. Neither was tested here.
- **Evidence:**
  - [Migrate from LedgerJS to the DMK](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/migrations/ledgerjs-to-dmk) (raw `.md`) — Ledger, accessed 2026-10-01 — official docs.
    - "LedgerJS (`hw-transport-*` and `hw-app-*`) is deprecated. Starting in September 2026, it will no longer work with the Ethereum app due to a breaking change in EIP-712 signing. All integrations must move to the Device Management Kit (DMK)."
    - "For chains that do not yet have a DMK signer (Algorand, Stellar, Tezos, Tron, XRP, and others), you can still communicate with the device using `dmk.sendCommand()` and `dmk.sendApdu()`."
  - [Initializing and Configuring the DMK](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/init_dmk) — accessed 2026-10-01.
    - "Important: The DMK should be initialized only once in your application. Always import the same instance rather than creating multiple instances."
  - [Transports](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/how_to/transports) — accessed 2026-10-01.
    - "The Speculos transport is used to communicate with the speculos device simulator."
  - npm registry and npm search `text=device-signer-kit` — accessed 2026-10-01 — registry data (versions, peers, the 12 kits); `gh api repos/LedgerHQ/device-sdk-ts/contents/packages/signer?ref=develop` lists the same chains plus `context-module` and `signer-utils`, and no Cardano signer (verification).
    - `@cardano-foundation/ledgerjs-hw-app-cardano@8.0.0` dependencies: `{'base-x': '^5.0.1', 'bech32': '^2.0.0', '@ledgerhq/hw-transport': '^6.31.2'}` (the LedgerJS transport interface).
  - [Choose a Network](https://developers.cardano.org/docs/developers/curriculum/start-building/networks-and-test-ada/) — Cardano Developer Portal, accessed 2026-10-01.
    - "Hardware devices work through the same browser extensions."
- **Limits / false positives:**
  - The September 2026 cut-off is Ledger's statement; I did not test LedgerJS against a current Ethereum app.
  - Which Cardano wallets support which Ledger flows was not tested.

### FD18-F09 — The DMK exposes the device state machine a UI needs; promise wrappers throw it away
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (two statements lacked a cited source: the `never` default in Ledger's examples and the EIP-1193 4001 code; both sources added and checked)
- **Claim:**
  - `DeviceActionStatus` has five values: `not-started`, `pending` (carries `intermediateValue`), `stopped`, `completed` (carries `output`) and `error` (carries `error`).
  - `UserInteractionRequired` has 18 values: `none`, `unlock-device`, `allow-secure-connection`, `confirm-open-app`, `sign-transaction`, `sign-typed-data`, `allow-list-apps`, `verify-address`, `sign-personal-message`, `sign-delegation-authorization`, `web3-checks-opt-in`, `verify-safe-address`, `register-wallet`, `confirm-load-image`, `confirm-commit-image`, `confirm-remove-image`, `grant-consent` and `allow-install-firmware`. The published 1.10.0 type declarations carry the same 18 (verification).
  - Device session states are `connected`, `locked`, `busy` and `disconnected`.
  - The Ethereum signer's steps include `BLIND_SIGN_TRANSACTION_FALLBACK` and `DETECT_BLIND_SIGNING`.
  - DMK's global command errors map `5515` to "Device is locked." (`DeviceLockedError`) and `5501` to "Action refused on device." (`ActionRefusedError`). The Ethereum app's `6985` surfaces only as "Condition not satisfied".
  - Ledger's own error classifier treats `0x6985` and `0x5501` as `user_device_refused`, and EIP-1193 `4001` as `user_modal_dismissed`, "declined in the UI, not on device". EIP-1193 itself defines 4001 as "User Rejected Request" (source added at verification).
- **Implication for /frontend:**
  - Subscribe to the observable and never await a promise.
  - Write an exhaustive `switch` on `requiredUserInteraction` that maps every value to one short on-screen instruction mirroring the device. Ledger's own examples use a `never` default for this (source added at verification).
  - Show two different rejection states, "cancelled in the wallet window" and "rejected on the device", both ending "Nothing was sent".
  - Map raw messages such as "Condition not satisfied" to plain copy.
  - On `disconnected`, offer reconnect through `dmk.reconnect()`.
- **Evidence:**
  - [DeviceActionState.ts](https://github.com/LedgerHQ/device-sdk-ts/blob/develop/packages/device-management-kit/src/api/device-action/model/DeviceActionState.ts), [UserInteractionRequired.ts](https://github.com/LedgerHQ/device-sdk-ts/blob/develop/packages/device-management-kit/src/api/device-action/model/UserInteractionRequired.ts), [SignTransactionDeviceActionTypes.ts](https://github.com/LedgerHQ/device-sdk-ts/blob/develop/packages/signer/signer-eth/src/api/app-binder/SignTransactionDeviceActionTypes.ts), [GlobalCommandError.ts](https://github.com/LedgerHQ/device-sdk-ts/blob/develop/packages/device-management-kit/src/api/command/utils/GlobalCommandError.ts) and [ethAppErrors.ts](https://github.com/LedgerHQ/device-sdk-ts/blob/develop/packages/signer/signer-eth/src/internal/app-binder/command/utils/ethAppErrors.ts) — LedgerHQ/device-sdk-ts, develop (pushed 2026-09-30), accessed 2026-10-01 — source code.
    - `"5515": { message: "Device is locked.", tag: "DeviceLockedError" },` · `"5501": { message: "Action refused on device.", tag: "ActionRefusedError" },` · `"6985": { message: "Condition not satisfied" },`
  - [unpkg @ledgerhq/device-management-kit@1.10.0 lib/types/src/api/device-action/model/UserInteractionRequired.d.ts](https://unpkg.com/@ledgerhq/device-management-kit@1.10.0/lib/types/src/api/device-action/model/UserInteractionRequired.d.ts) — published package, accessed 2026-10-01 — 18 enum members, identical to develop (added at verification).
  - [Ethereum Signer Kit reference](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/eth) (raw `.md`) — Ledger, accessed 2026-10-01 — official docs (added at verification).
    - `default:` · `// Type guard to ensure all cases are handled` · `const uncaughtUserInteraction: never = requiredUserInteraction;`
  - [EIP-1193](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-1193.md) — status Final, created 2018-06-30, accessed 2026-10-01 — specification (added at verification).
    - "| 4001 | User Rejected Request | The user rejected the request. |"
  - [Migrate from LedgerJS to the DMK](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/migrations/ledgerjs-to-dmk) — accessed 2026-10-01.
    - "The `toPromise` wrapper discards intermediate states, including `requiredUserInteraction`. These states are important for building responsive wallet UIs (for example, showing a "Confirm on your Ledger" message). Prefer the full observable subscription for production code."
  - [Device Management Kit how-to](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/how_to/dmk) — accessed 2026-10-01.
    - "`locked`: The device is locked. User needs to unlock it to perform operations." · "`busy`: The device is busy, so not reachable."
  - [ledger-live libs/transaction-observability/src/errorCategory.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/transaction-observability/src/errorCategory.ts) and [apps/wallet-cli/src/device/classify-device-error.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/src/device/classify-device-error.ts) — Ledger, develop, accessed 2026-10-01 — source code.
    - "// EIP-1193 4001, unwrapped from a dApp provider error: declined in the UI, not on device."
    - `if (statusCode === 0x6985 || statusCode === 0x5501) return ErrorCategory.UserDeviceRefused;`
    - "// DMK refused-by-user (RefusedByUserDAError) happens when the user declines the OpenApp prompt."
- **Limits / false positives:** Enum membership changes between DMK releases. Re-read the installed version's `.d.ts` before writing the switch. Ledger's `never` example switches over the Ethereum signer's narrower interaction type, not over all 18 values.

### FD18-F10 — WebHID means desktop Chromium, a secure context and a user gesture
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - MDN's compatibility data lists `HID` as supported in Chrome 89 (Edge mirrors Chrome) and unsupported in Firefox, Safari and Chrome for Android; it is marked experimental.
  - Web Bluetooth is listed for Chrome 70 (partial: "Linux support is not enabled by default") and Chrome for Android 56, and not for Firefox or Safari.
  - `HID.requestDevice()` requires a secure context and transient user activation.
  - Ledger's DMK docs require `startDiscovering` to be called from a user gesture.
  - Ledger Wallet Provider's requirements page lists "Firefox 89+, Safari 14.1+" as supported, and says mobile is unsupported because the APIs "are not available on iOS or Android". The first claim contradicts MDN for USB and Bluetooth alike; the Android half of the second contradicts MDN for Web Bluetooth.
- **Implication for /frontend:**
  - Feature-detect `navigator.hid`. When it is missing, show a state that says "Use Chrome or Edge on a computer to connect a Ledger" instead of a dead button.
  - Make "Connect Ledger" a click handler that calls discovery synchronously: no auto-connect on page load, no discovery behind an `await` chain.
  - Serve over HTTPS or `localhost`.
  - For the OP3N finals on a projector, present from desktop Chrome or Edge.
- **Evidence:**
  - [mdn/browser-compat-data api/HID.json](https://github.com/mdn/browser-compat-data/blob/main/api/HID.json) and [api/Bluetooth.json](https://github.com/mdn/browser-compat-data/blob/main/api/Bluetooth.json) — MDN, main, accessed 2026-10-01 — compatibility data.
    - HID: `chrome {'version_added': '89'}`, `firefox {'version_added': False}`, `safari {'version_added': False}`, `chrome_android {'version_added': False, ...}`
  - [HID: requestDevice()](https://github.com/mdn/content/blob/main/files/en-us/web/api/hid/requestdevice/index.md) — MDN, accessed 2026-10-01.
    - "Transient user activation is required. The user has to interact with the page or a UI element in order for this feature to work."
  - [Migrate from LedgerJS to the DMK](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/migrations/ledgerjs-to-dmk) — accessed 2026-10-01.
    - "`startDiscovering` for WebHID must be called as a direct result of a user gesture (such as a button `click` event) because browsers require user activation before showing the HID device picker."
  - [Ledger Wallet Provider: Requirements](https://developers.ledger.com/docs/ledger-wallet-provider/requirements) — accessed 2026-10-01.
    - "**Desktop**: Chrome 89+, Firefox 89+, Safari 14.1+, Edge 89+" · "Mobile browsers are not supported because Web HID and Web Bluetooth APIs are not available on iOS or Android."
- **Limits / false positives:**
  - Browser-compat data is community-maintained.
  - I tested no physical device or browser in this session.

### FD18-F11 — What the Ledger device shows, and what the screen must say about it (clear signing, ERC-7730)
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED ("English only" overstated ERC-7730's "expected to be authored in English")
- **Claim:** Ledger's design rules for device apps:
  - The intent page comes first, and its prompt "must start with "Review"".
  - Fields for a simple transfer follow the order "From" address, "Amount", "To" address, "Fees".
  - Signing is "Hold to sign" for 2 seconds, and "Reject" is available on every screen.
  - Blind signing is a setting that "must be off by default", and users "must still be warned for every blind transaction".
  - Address verification shows "the full address to compare with its software counterpart".

  For wallets integrating clear signing through the DMK:
  - If no ERC-7730 descriptor exists, "the signer falls back to blind signing".
  - The UI must "Tell users whether Clear Signing is active".
  - The `originToken` needed for clear signing and Transaction Check requires "enrollment in Ledger's partner program".
  - A new descriptor goes through automated checks, "a maintainer review" and "the next scheduled update".

  ERC-7730 itself:
  - Status: Draft. Its version table marks 1.0.0 Deprecated, 2.0.0 Superseded, 2.1.0 Active and 3.0.0-next Draft, while Ledger's quick reference says Ledger's tools and registry "target ERC-7730 v1".
  - Display strings "are expected to be authored in English" (corrected: the original said "English only").
  - Wallets "MUST display either `interpolatedIntent` strings or screens generated from `intent` and individual `fields`".
  - An amount whose token is unknown is shown raw "with an "Unknown token" warning".
  - Raw address "Truncation is device dependent".
- **Implication for /frontend:**
  - While the device is in `sign-transaction`, show a mirror panel on screen: "Your Ledger shows: Review [intent] → From → Amount → To → Fees → Hold to sign", with the same values and the full recipient address. Label it with a clear-signing badge or a blind-signing warning.
  - On a projector the audience cannot see the device, so the mirror panel carries the demo (derived).
  - For a hackathon contract, do not count on a merged descriptor within the event. Preview it with Ledger's ERC-7730 Tester or Speculos, and design the blind-signing path honestly: "Your Ledger can't show the details of this contract call and will display a warning."
- **Evidence:**
  - [Device app design guidelines: transactions](https://developers.ledger.com/docs/device-app/integration/design-guidelines/transactions) (raw `.md`) — Ledger, accessed 2026-10-01 — official docs.
    - "The transaction intent is the first page displayed to users." · "The prompt sentence must start with "Review"."
    - "Ensure consistency by presenting common fields in a standard order. For simple transfers, this is: 1. "From" address 2. "Amount" (value and currency) 3. "To" address 4. "Fees" (value and currency)"
    - "Confirming a transaction always uses the same press-and-hold gesture on the dedicated area of the screen: "Hold to sign". After 2 seconds, the transaction is signed and the user receives a success notification accompanied by a sound."
    - "The "blind signing" setting must be off by default. When it is off, a specific warning is presented when the user attempts to sign a non-decoded transaction." · "After enabling the setting, users must still be warned for every blind transaction."
  - [Device app design guidelines: address verification](https://developers.ledger.com/docs/device-app/integration/design-guidelines/address) — accessed 2026-10-01.
    - "Once the user continues, they are shown the full address to compare with its software counterpart."
  - [How to integrate Clear Signing into your wallet](https://developers.ledger.com/docs/clear-signing/for-wallets) — accessed 2026-10-01.
    - "Both the wallet and the dApp must support ERC-7730 for the details to display. If no descriptor exists for the target contract, the signer falls back to blind signing."
    - "**Show signing status.** Tell users whether Clear Signing is active for a given transaction. When no descriptor is available, display a clear blind-signing warning."
    - "Wallet integration requires enrollment in Ledger's partner program to obtain an `originToken`."
  - [Validate and submit a descriptor](https://developers.ledger.com/docs/clear-signing/for-dapps/validate-submit) — accessed 2026-10-01.
    - "The registry runs automated checks (schema, linting, ABI and deployment consistency) before a maintainer review." · "(after the next scheduled update)"
  - [ERC-7730](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-7730.md) — status Draft, created 2024-02-07, accessed 2026-10-01 — specification.
    - "Wallets MUST display either `interpolatedIntent` strings or screens generated from `intent` and individual `fields`."
    - "All display strings in ERC-7730 files—including intents, labels, field names, and enumeration values—are expected to be authored in English."
    - "If ticker is not found or `tokenPath`/`token` is not set, the wallet SHOULD display the raw value instead with an "Unknown token" warning"
  - [ERC-7730 quick reference](https://developers.ledger.com/docs/clear-signing/reference/erc7730-reference) — Ledger, accessed 2026-10-01.
    - "Ledger's tools and the registry currently target **ERC-7730 v1**. Version 2 is in draft"
- **Limits / false positives:**
  - The device rules bind device-app developers, and I apply them to the web screen by analogy.
  - Ledger's docs pages carry an `agent_config` front-matter block pointing to external instruction files. I treated it as data and did not follow it.

### FD18-F12 — Ledger Wallet's own copy for each state: broadcast, sent, uncertain, confirmed
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The Ledger Wallet desktop English strings (the app was formerly Ledger Live; the file was last changed 2026-09-30):
  - `send.steps.confirmation.pending.title` "Broadcasting transaction..."
  - `send.steps.confirmation.success.title` "Transaction sent"
  - `send.steps.confirmation.success.text` "Your account balance will be updated when the blockchain confirms the transaction"
  - `send.steps.confirmation.broadcastError` "Your transaction may have failed. Please wait a moment then check the transaction history before trying again." The same string is reused across dozens of chain flows (55 keys at verification), including `cardano.delegation`.
  - `operationDetails.confirmed` "Confirmed", `operationDetails.notConfirmed` "Not confirmed", `operationDetails.failed` "Failed".
  - Device prompts:
    - `DeviceAction.connectAndUnlockDevice` "Connect and unlock your device"
    - `DeviceAction.allowAppPermission` "Open the {{wording}} app on your device"
    - `DeviceAction.allowManagerPermission` "Allow secure connection"
    - `DeviceAction.swap.simpleViewNotice.default` "Verify the swap details on your Ledger before sending it."
  - Ledger's shop confirms the rename: "The Ledger Wallet™ app (formerly Ledger Live™)".
- **Implication for /frontend:**
  - Follow the structure: sending, then sent (with "will update when the blockchain confirms"), then confirmed, not confirmed or failed.
  - The broadcast-error principle is load-bearing: after an uncertain submit, tell the user to check before retrying, and never offer a blind "Try again" that could double-pay (F16).
  - Adapt the wording rather than paste it wholesale.
  - Refer to "Ledger Wallet (formerly Ledger Live)" if the product must be named.
- **Evidence:**
  - [ledger-live apps/ledger-live-desktop/static/i18n/en/app.json](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/ledger-live-desktop/static/i18n/en/app.json) — Ledger, develop, last commit 2026-09-30, accessed 2026-10-01 — localisation file (6,329 keys).
    - "Broadcasting transaction..." · "Your account balance will be updated when the blockchain confirms the transaction" · "Your transaction may have failed. Please wait a moment then check the transaction history before trying again."
  - [Ledger x San Antonio Spurs](https://shop.ledger.com/pages/san-antonio-spurs) — Ledger, accessed 2026-10-01.
    - "The Ledger Wallet™ app (formerly Ledger Live™) is your secure gateway to the world of digital assets."
- **Limits / false positives:** These are desktop app strings, not guidance for dApps. The repository path still says `ledger-live-desktop`.

### FD18-F13 — Ledger's name and marks: describe the device in instructions; no logo, no endorsement
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - Ledger's Website Terms of Use say its marks "may not be used for products or services that are not respectively manufactured or offered by Ledger, or in any way that could cause confusion in the public".
  - The developer portal footer lists Ledger, Ledger Stax, Ledger Flex, Ledger Nano, Ledger Nano S, Ledger OS, Ledger Wallet and the two logos as trademarks of Ledger SAS.
  - Ledger's own DMK docs expect third-party UIs to show "Confirm on your Ledger" (F09), so descriptive use of the word in instructions is anticipated by Ledger.
  - Ledger branding legitimately appears inside an app only through Ledger's own component: the Ledger Wallet Provider "embeds Ledger's official connect flow". It is configured per partner. Its npm `license` field is empty; its GitHub repository (LedgerHQ/ledger-button-public) is Apache-2.0. The docs describe v2, yet its family packages (`-evm`, `-solana`) exist only as release candidates; `-core` has a stable 1.4.3.
  - Co-branding goes through Ledger's "co-branded partnership".
  - No public brand guideline for third-party dApps was found (see "not found").
- **Implication for /frontend:**
  - Plain text only: "Connect a Ledger", "Confirm on your Ledger".
  - No Ledger logo, no device renders, no Ledger-styled wordmark, no "Ledger" in the app's name, `<title>` or favicon.
  - No "official", "approved" or "partner" claims.
  - For OP3N, read the hackathon's own brand rules; this research did not find them.
  - A device illustration, if needed, is a neutral generic shape.
- **Evidence:**
  - [Website Terms of Use](https://shop.ledger.com/pages/website-terms-of-use) — Ledger, section "B. Intellectual Property Rights", undated page, accessed 2026-10-01.
    - "Ledger's names and logos are trademarks of Ledger. Ledger's trademarks and logos may not be used for products or services that are not respectively manufactured or offered by Ledger, or in any way that could cause confusion in the public, or in any way that disparages or discredits Ledger. Accordingly, you agree not to reproduce, represent, extract and use in any way any or all of Ledger's trademarks, logos, Site or Products."
  - [Ledger Developer Portal footer](https://developers.ledger.com/) — accessed 2026-10-01.
    - "Ledger, Ledger Stax, Ledger Flex, Ledger Nano, Ledger Nano S, Ledger OS, Ledger Wallet, [LEDGER] (logo), [L] (logo) are trademarks owned by Ledger SAS."
  - [Ledger Wallet Provider overview](https://developers.ledger.com/docs/ledger-wallet-provider/overview) — accessed 2026-10-01.
    - "Ledger Wallet Provider is a web component SDK that embeds Ledger's official connect flow directly inside your application" · "the SDK announces the blockchain families enabled in your partner configuration"
  - npm registry `@ledgerhq/ledger-wallet-provider` 1.4.3 (2026-09-16, `license=None`); `@ledgerhq/ledger-wallet-provider-evm` and `-solana` latest `0.0.0-rc-20260915155054`; `@ledgerhq/ledger-wallet-provider-core` latest 1.4.3; `gh api repos/LedgerHQ/ledger-button-public` `license=Apache-2.0` — accessed 2026-10-01.
  - [Device app marketing deliverables](https://developers.ledger.com/docs/device-app/submission-process/deliverables/marketing) — accessed 2026-10-01.
    - "Finally, Ledger offers a co-branded partnership that will help you customize your marketing and reward your community."
- **Limits / false positives:**
  - This is not legal advice. The Terms govern Ledger's website, and read literally they forbid any use of the marks, which Ledger's own docs contradict in practice.
  - Nominative use was not researched.

### FD18-F14 — How long each state lasts: Cardano and BSC numbers, specified and measured
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - **Cardano, specified.** One-second slots and an active slot coefficient of 0.05 (all three genesis files) give a block every 20 s on average.
    - The portal: "Mainnet produces a block roughly every 20 seconds and the public testnets match it".
    - Latency is "~20s average block time". "most applications treat 10-20 confirmations (a few minutes) as strong finality".
    - "beyond k = 2160 blocks (~12 hours) chain selection refuses to roll back at all". Preview's k is 432.
  - **Cardano, measured** (1,000 consecutive blocks each, Koios, 2026-09-30):

    | Network | Window (UTC) | Mean interval | Median | p90 | p99 | Max | Intervals > 60 s |
    |---|---|---|---|---|---|---|---|
    | preprod | 15:28 to 21:47 | 22.7 s | 17 s | 51 s | 111 s | 162 s | 6.3% |
    | mainnet | 16:20 to 21:47 | 19.6 s | 13 s | 46 s | 87 s | 149 s | 3.7% |

    Percentiles use Python's `statistics.quantiles` default (exclusive method). Linear interpolation on the same data gives preprod p99 108 s and mainnet p90 45 s (verification note).
  - **BSC.** BEP-619 (Status: Enabled) set the block interval to 0.45 s. Finality is "~1.125s" with fast finality working; if it fails, 79.2 s (> 1/2 of validators) to 108 s (> 2/3). Measured: a mean of 450.3 ms over 2,000 blocks ending 2026-09-30T22:10:47Z.
- **Implication for /frontend:**
  - Cardano "pending" copy: "usually about 20 seconds".
  - Switch to "taking longer than usual" at about 60 s, just above the measured p90 (51 s on preprod).
  - Keep polling to the validity-window end (F16).
  - Show confirmation counts, and call a transaction "final" only at 10 or more confirmations, citing the portal.
  - On BSC a spinner delayed by 500 ms will rarely appear: go straight from "sent" to "confirmed". Keep a slow path for the 79 to 108 s fallback.
  - For a 3-minute video, cut the wait but show the step indicator honestly.
- **Evidence:**
  - Shelley genesis files for [preprod](https://book.play.dev.cardano.org/environments/preprod/shelley-genesis.json), [preview](https://book.play.dev.cardano.org/environments/preview/shelley-genesis.json) and [mainnet](https://book.play.dev.cardano.org/environments/mainnet/shelley-genesis.json) — accessed 2026-10-01: `activeSlotsCoeff 0.05`, `slotLength 1`, `securityParam 2160` (preprod and mainnet) and `432` (preview).
  - [Choose a Network](https://developers.cardano.org/docs/developers/curriculum/start-building/networks-and-test-ada/), [Transactions](https://developers.cardano.org/docs/developers/curriculum/fundamentals/core-concepts/transactions/) and [Consensus and Ouroboros](https://developers.cardano.org/docs/developers/curriculum/fundamentals/consensus-and-ouroboros/) — Cardano Developer Portal (sources in cardano-foundation/developer-portal, staging), accessed 2026-10-01.
    - "Mainnet produces a block roughly every 20 seconds and the public testnets match it"
    - "**Finality**: time to become practically irreversible. Depends on your risk tolerance; most applications treat 10-20 confirmations (a few minutes) as strong finality, high-value transfers wait longer."
    - "beyond k = 2160 blocks (~12 hours) chain selection refuses to roll back at all, making k a hard bound on rollback depth rather than a probability. Practical finality is 10-20 confirmations, a few minutes."
  - Koios `GET /blocks?select=block_height,block_time&block_height=not.is.null&limit=1000&order=block_height.desc` on `preprod.koios.rest` and `api.koios.rest` — run 2026-10-01 — first-hand measurement (statistics in the table). Re-run at verification on the same height ranges (preprod 5,237,866 to 5,238,865; mainnet 14,008,366 to 14,009,365) with identical results.
  - [BEP-619](https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP-619.md) — BNB Chain, Status: Enabled, created 2025-09-11, accessed 2026-10-01.
    - "This proposal shortens the block interval from 0.75 seconds to 0.45 seconds, further improving transaction confirmation speed and enhancing user experience."
    - "**With fast finality working correctly**: transaction finality improves from ~1.875s to ~1.125s."
  - BSC JSON-RPC `eth_getBlockByNumber` (`milliTimestamp`) on `bsc-dataseed.bnbchain.org`, blocks 124,984,197 to 124,986,197 — run 2026-10-01 — first-hand measurement. Re-run at verification: 1,790,805,347,000 to 1,790,806,247,550 ms, 450.275 ms per block.
- **Limits / false positives:**
  - A block interval is not the time to inclusion: a transaction can miss a block, and mempools vary by node.
  - The sample covers about 6 hours on one day and no congestion.
  - Ethereum timing was not researched.

### FD18-F15 — Waiting: give feedback within 0.1 s, delay spinners 500 ms, and give anything past 10 s an estimate and a way out
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - Nielsen's limits are 0.1 s (instant), 1 s (flow of thought) and 10 s (attention). "Anything slower than 10 seconds needs a percent-done indicator as well as a clearly signposted way for the user to interrupt the operation."
  - NN/g: use a progress indicator for anything over about 1 s. Reserve looped animations (spinners) for actions of 2 to 10 s. Missing feedback causes "extra clicks and double orders".
  - The `spin-delay` library (2.0.1, MIT) defaults to showing a spinner only after 500 ms and keeping it at least 200 ms, to avoid flicker.
- **Implication for /frontend:**
  - Press state and disabled button within 0.1 s. That also prevents the double-submit that causes `BadInputsUTxO` (F16).
  - Reads: skeleton first, spinner after 500 ms, minimum 200 ms.
  - Waiting on a human in a wallet or device: after 10 s, add help ("Can't see the wallet window? Click the extension icon").
  - Waiting on a block: no percentage, since inclusion time is not predictable. Use a step indicator with an expected time (F14). The "way to interrupt" is leaving the view ("You can close this; tracking continues"), because a submitted Cardano transaction cannot be cancelled.
- **Evidence:**
  - [Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/) — Jakob Nielsen, NN/g, 1993 with a 2014 update, accessed 2026-10-01.
    - "0.1 second is about the limit for having the user feel that the system is reacting instantaneously"
    - "10 seconds: Limit for users keeping their attention on the task. Anything slower than 10 seconds needs a percent-done indicator as well as a clearly signposted way for the user to interrupt the operation."
  - [Progress Indicators Make a Slow System Less Insufferable](https://www.nngroup.com/articles/progress-indicators/) — Katie Sherwin, NN/g, 2014-10-26, accessed 2026-10-01 (author added at verification).
    - "Use a progress indicator for any action that takes longer than about 1.0 second."
    - "This indicator should be reserved for actions that take between 2-10 seconds. For anything that takes less than 1 second to load, it is distracting to use a looped animation, because users cannot keep up with what happened and might feel anxious about whatever flashed on the screen."
    - "Plenty of extra clicks and double orders have resulted from such user-hostile design."
  - [smeijer/spin-delay src/index.ts](https://github.com/smeijer/spin-delay/blob/main/src/index.ts) — v2.0.1, accessed 2026-10-01 — source code.
    - `export const defaultOptions = { delay: 500, minDuration: 200, ssr: true, };`
- **Limits / false positives:** NN/g's thresholds predate blockchains, and the 500/200 ms values are library defaults, not measured optima.

### FD18-F16 — Dropped, replaced and failed mean different things on EVM chains and on Cardano
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - **EVM (viem).** Transactions sent from the same nonce can be `repriced` (different `maxFeePerGas`), `cancelled` (`value === 0n`) or `replaced` (different `value` or `data`). `waitForTransactionReceipt` reports these through `onReplaced`, with defaults `timeout` 180,000 ms and `retryCount` 6 (the number of retries "if the transaction or block is not found").
  - **Cardano.** There is no replacement:
    - A transaction has a validity interval whose upper bound, `invalid_hereafter`, is "also called the TTL".
    - The node "silently drops" pending transactions whose inputs are spent or whose window has passed.
    - Resubmitting the same bytes helps only while the window is open and the inputs are unspent; otherwise it must be rebuilt, which means a new signature.
    - After a resubmission, `BadInputsUTxO` "can simply mean it succeeded".
    - `BadInputsUTxO` also comes from "a second browser tab, a double-clicked submit, or a concurrent backend build".
    - Only a phase-2 script failure costs anything: "the node consumes your collateral". Phase-1 failures never reach the chain.
- **Implication for /frontend:**
  - Cardano UI has no "Speed up" or "Cancel".
  - Show the expiry time derived from the TTL.
  - Classify "dropped" only on positive evidence: the TTL has passed and the transaction is not on chain.
  - A rebuild prompt says "you'll need to approve again".
  - A resubmit that returns `BadInputsUTxO` routes to "checking…", then to the on-chain status.
  - The "failed on-chain" state names the collateral cost. EVM UI follows the replacement hash.
- **Evidence:**
  - [viem waitForTransactionReceipt](https://viem.sh/docs/actions/public/waitForTransactionReceipt) (source `site/pages/docs/actions/public/waitForTransactionReceipt.md`, wevm/viem main; viem 2.57.1, MIT) — accessed 2026-10-01.
    - "`repriced`: The gas price has been modified (ie. different `maxFeePerGas`)" · "`cancelled`: The Transaction has been cancelled (ie. `value === 0n`)" · "`replaced`: The Transaction has been replaced (ie. different `value` or `data`)"
    - timeout "**Default:** `180_000`" · retryCount "**Default:** `6`" · "Number of times to retry if the transaction or block is not found."
  - [When transactions fail](https://developers.cardano.org/docs/developers/curriculum/start-building/transaction-failures/) — Cardano Developer Portal, source last changed 2026-08-07, accessed 2026-10-01.
    - "**Pending is not a queue.** On every change of tip the node re-runs the state-dependent checks (are the inputs still unspent, is the validity window still open) and silently drops transactions that fail them. A transaction that vanished was not lost in transit; the chain moved underneath it."
    - "Resubmitting the unchanged transaction makes sense after a capacity rejection, or after a silent drop while the validity window is still open and the inputs are still unspent. Once the window has passed or an input is gone, only a rebuild helps. And if a resubmission returns `BadInputsUTxO`, check the chain before assuming failure: a transaction that was already included consumed its own inputs, so the same bytes are now invalid on that chain, and that error can simply mean it succeeded."
    - "A phase-2 failure (a validator returns false, or exhausts its budget) is the one case where a *submitted* transaction costs you: the node consumes your collateral."
  - [Transactions](https://developers.cardano.org/docs/developers/curriculum/fundamentals/core-concepts/transactions/) — Cardano Developer Portal, accessed 2026-10-01.
    - "**Upper bound** (`invalid_hereafter`, also called the TTL, for time to live): expires after this slot."
- **Limits / false positives:** How often phase-2 failures reach the chain with current wallets (which usually evaluate scripts before submitting) was not measured.

### FD18-F17 — Indexers and explorers lag: "not found yet" is not "failed", and a submit error is not proof of failure
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED (Cexplorer's "Low (0)" was not the state of a fresh transaction: the count stayed at 0 while Koios counted 153 confirmations)
- **Claim:**
  - Koios `POST /tx_status` ("Get the number of block confirmations for a given transaction hash list") answered an unknown hash with HTTP 200 and `"num_confirmations":null` (measured on preprod), not a 404.
  - Blockfrost's mempool endpoints show "only transactions submitted via Blockfrost.io", so a transaction submitted by the user's wallet may be invisible there while pending.
  - Etherscan answers an unknown hash with HTTP 200 and "Transaction Hash not found on Ethereum". It tells users to wait "at least 30 seconds before refreshing" and, "If it still does not show up after 1 hour", to check with their "sender/exchange/wallet/transaction provider".
  - Cexplorer shows a qualitative confirmation level with a number, and the TTL, but its number is not a reliable confirmation count. At verification its preprod page for transaction `4206…b0d0` still read "Confirmations Low (0)" while Koios returned `"num_confirmations":153` for the same transaction; its mainnet page for `982b…bbc1` read "Confirmations High (165)" while Koios returned 177. The TTL read "TTL Locking in 7m 1s" shortly after inclusion and "TTL Locked 50m 53s ago" an hour later (corrected: the original presented "Low (0)" as the reading of a fresh transaction and "Medium (7)" on mainnet, which was not re-observed).
- **Implication for /frontend:**
  - "Pending" means the transaction id is known and confirmations are null.
  - Never infer failure from not-found; infer "dropped" only per F16.
  - Link to an explorer only once the app's own indexer sees the transaction, or label the link "may take a moment to appear".
  - Count confirmations from the app's own indexer, never from an explorer page (added at verification).
  - After an uncertain submit, poll by transaction id before offering any retry (F12's principle).
- **Evidence:**
  - Koios `POST https://preprod.koios.rest/api/v1/tx_status` with `{"_tx_hashes":["000…000"]}` → `[{"tx_hash":"0000000000000000000000000000000000000000000000000000000000000000","num_confirmations":null}]` HTTP 200 — run 2026-10-01, re-run at verification with the same answer — measurement. Spec: [koiosapi-preprod.yaml](https://github.com/cardano-community/koios-artifacts/blob/main/specs/results/koiosapi-preprod.yaml) v1.4.2.
  - Koios `tx_status` at verification: preprod `420686093ba362189bb9f2a158c94996d157296fbf881f716455c3ea4926b0d0` → `"num_confirmations":153`; mainnet `982b3b7b86186427b340666421c4024cbb3177cc8aaf414f2abd3fd99f50bbc1` → `"num_confirmations":177` — run 2026-10-01 — measurement (added at verification).
  - [Blockfrost OpenAPI](https://github.com/blockfrost/openapi/blob/master/openapi.yaml) — version 0.1.93, accessed 2026-10-01.
    - "Return transactions that are currently stored in Blockfrost mempool, waiting to be included in a newly minted block. Shows only transactions submitted via Blockfrost.io."
  - `https://etherscan.io/tx/0xabab…ab` (fabricated hash), fetched and rendered 2026-10-01 — observation.
    - "If you have just submitted a transaction please wait for at least 30 seconds before refreshing this page. It could still be in the TX Pool of a different node, waiting to be broadcasted." · "If it still does not show up after 1 hour, please check with your sender/exchange/wallet/transaction provider for additional information."
  - `https://preprod.cexplorer.io/tx/420686093ba362189bb9f2a158c94996d157296fbf881f716455c3ea4926b0d0`, rendered 2026-10-01 (original run and verification script `fc/fc_cexplorer.py`) — observation — "TTL Locked 50m 53s ago Confirmations Low (0)"; `https://cexplorer.io/tx/982b3b7b86186427b340666421c4024cbb3177cc8aaf414f2abd3fd99f50bbc1` — "TTL Locking in 46m 22s Confirmations High (165)".
- **Limits / false positives:** Explorer and indexer behaviour can change without notice. Koios public endpoints are rate-limited. Why Cexplorer's preprod count stays at 0 is unknown; it may be a preprod-only fault.

### FD18-F18 — State changes must be announced, errors described in text, and money actions reviewable before they are final
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - WCAG 2.2 (W3C Recommendation, 12 December 2024):
    - 4.1.3 requires status messages to be exposed "without receiving focus".
    - 3.3.1 requires errors to be "described to the user in text".
    - 3.3.3 requires suggestions when known.
    - 3.3.4 requires that pages causing "financial transactions" be reversible, checked, or offer "A mechanism … for reviewing, confirming, and correcting information before finalizing the submission".
    - 2.5.3 requires a component's accessible name to contain its visible label.
  - WAI-ARIA 1.2 (Recommendation, 06 June 2023): `status` is "advisory information", with implicit `aria-live` polite and `aria-atomic` true. `alert` is "important, and usually time-sensitive, information".
- **Implication for /frontend:**
  - One persistent `role="status"` region per transaction panel carries every state change. `role="alert"` is only for blocking states (wrong network, failed, dropped).
  - Do not move focus on progress updates.
  - A review screen before `signTx` meets 3.3.4 "Confirmed", since the wallet popup alone cannot be counted on.
  - Every error is text next to its source, with a suggestion.
- **Evidence:**
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C Recommendation 12 December 2024, accessed 2026-10-01 — standard.
    - "In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus."
    - "If an input error is automatically detected, the item that is in error is identified and the error is described to the user in text."
    - "For web pages that cause legal commitments or financial transactions for the user to occur, … at least one of the following is true: Reversible … Checked … Confirmed A mechanism is available for reviewing, confirming, and correcting information before finalizing the submission."
    - "For user interface components with labels that include text or images of text, the name contains the text that is presented visually."
  - [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) — W3C Recommendation 06 June 2023, accessed 2026-10-01.
    - "Elements with the role status have an implicit aria-live value of polite and an implicit aria-atomic value of true."
    - "A type of live region with important, and usually time-sensitive, information."
- **Limits / false positives:** Screen-reader announcement behaviour varies, and I tested no assistive technology here.

### FD18-F19 — Error and empty-state copy: say what happened and what to do, and never show a false "nothing"
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - NN/g's error guidelines (2023):
    - Use human-readable language and keep error codes "for technical diagnostic purposes only".
    - Give constructive advice.
    - Do not blame the user ("invalid, illegal, or incorrect").
    - Reserve modal dialogs "for severe errors".
  - NN/g's empty-state guidelines (2021): totally empty states cause confusion, and a "No records" message shown before loading finishes is "particularly harmful".
- **Implication for /frontend:**
  - Headline plus next action. The code and raw message go in a collapsible details block (Liqwid shows "(code: -3)" in the headline, F07).
  - No "invalid address"; write "This isn't a Cardano address."
  - Never render "0 tADA" or "No transactions yet" until the query has succeeded.
  - On read failure, keep the last good data with an "as of" time.
- **Evidence:**
  - [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/) — Tim Neusesser and Evan Sunwall, NN/g, 2023-05-15 (JSON-LD `datePublished` 2023-05-15T05:00Z; the page displays "May 14, 2023"), accessed 2026-10-01 (authors added at verification).
    - "Hide or minimize the use of obscure error codes or abbreviations; show them for technical diagnostic purposes only."
    - "Offer constructive advice. Merely stating the problem is also not enough; offer some potential remedies."
    - "Don't use phrasing that blames users or implies they are doing something wrong, such as invalid, illegal, or incorrect."
    - "modal dialogs require the user's attention and resolution and should be reserved for severe errors."
  - [Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/) — Kate Kaplan, NN/g, 2021-09-19, accessed 2026-10-01 (author added at verification).
    - "Totally empty states cause confusion about how and whether the system is working."
    - "Inaccurate system-status messages for empty states are particularly harmful."
- **Limits / false positives:** This is expert guidance, not measured for crypto dApps.

### FD18-F20 — Explorer URL templates: EIP-3091 on EVM chains, the Cardano Foundation resolver on Cardano
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - **EVM.** EIP-3091 (status: Stagnant) defines `/block/`, `/tx/`, `/address/` and `/token/`. The `ethereum-lists/chains` registry marks Etherscan, Sepolia Etherscan, BscScan and `testnet.bscscan.com` with `"standard": "EIP3091"`.
  - **Cardano.** explorer.cardano.org's source (`DeepLinkResolver.jsx`, last changed 2026-09-25) builds:
    - Cardanoscan: `https://{preprod.|preview.}cardanoscan.io/transaction/<hash>`, `/address/<bech32>`, `/token/<policyId+assetNameHex>`, `/block/<n>`, `/epoch/<n>` and `/pool/<hex>`.
    - Cexplorer: `https://{preprod.|preview.}cexplorer.io/tx/<hash>`, `/address/<bech32>`, `/asset/<policyId+assetNameHex>`, `/epoch/<n>`, `/block?search=block_no%3A<n>` and `/pool/<bech32>`.
    - AdaStat (mainnet only): `/transactions/`, `/addresses/` and `/tokens/`.
    - Pool PM: `/<fingerprint>`.
  - The aggregator itself accepts `https://explorer.cardano.org/[preprod|preview/]{tx|transaction|address|asset|block|epoch|pool|drep|governance-action}/<id>`. It has no policy route: "does not match any of the supported paths: transaction, block, epoch, address, tx, governance-action, drep, asset, pool". Its asset IDs are the hex "unit", not the `asset1…` fingerprint.
  - Policy pages: `preprod.cexplorer.io/policy/<policyId>` rendered a Policy page (observed). A Cardanoscan `/tokenPolicy/<policyId>` route appears only in third-party code and could not be rendered (F21).
- **Implication for /frontend:**
  - Keep one explorer config per network and derive every link from it, with the same network value the provider uses. Templates are in Deliverable D.
  - Use the unit form (policy ID + hex asset name) for assets.
  - Offer explorer.cardano.org as the neutral "choose your explorer" link.
- **Evidence:**
  - [cf-explorer-landing src/common/DeepLinkResolver.jsx](https://github.com/cardano-foundation/cf-explorer-landing/blob/main/src/common/DeepLinkResolver.jsx) — Cardano Foundation, Apache-2.0, last commit 2026-09-25, accessed 2026-10-01 — source code.
    - `acceptedDeepLinks = ["transaction", "block", "epoch", "address", "tx", "governance-action", "drep", "asset", "pool"];` · `acceptedNetworks = ["preprod", "preview"]; // mainnet is default`
    - Cardanoscan: ``link += `transaction/${this.getValue()}`;`` · ``link += `token/${this.getAssetSubject()}`;``; Cexplorer: ``link += `tx/${this.getValue()}`;`` · ``link += `asset/${this.getAssetSubject()}`;``
  - explorer.cardano.org rendered at `/tx/<hash>`, `/preprod/tx/<hash>`, `/preprod/address/<addr>`, `/preprod/asset/<unit>` and `/preprod/policy/<id>` — 2026-10-01 — observation. Chooser links generated for the preprod transaction: `https://preprod.cexplorer.io/tx/4206…b0d0` and `https://preprod.cardanoscan.io/transaction/4206…b0d0`.
  - [EIP-3091](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-3091.md) — status Stagnant, accessed 2026-10-01 — "`<BLOCK_EXPLORER_URL>/tx/<TX_HASH>`" etc.
  - [ethereum-lists/chains eip155-97.json](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-97.json), plus `eip155-56`, `eip155-1` and `eip155-11155111` — accessed 2026-10-01.
    - `{'name': 'bscscan-testnet', 'url': 'https://testnet.bscscan.com', 'standard': 'EIP3091'}`
  - GitHub code search `cardanoscan.io/tokenPolicy` — hits in third-party repositories (e.g. ADAOcommunity/fracada-dapp `components/Nft.tsx`) — accessed 2026-10-01 — grade C for this sub-claim only.
- **Limits / false positives:** Explorer routes are not a standard on Cardano, and any explorer may change them. The Cardanoscan policy route is unverified.

### FD18-F21 — HTTP status is useless for checking explorer links, and two explorers block automated rendering
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED (Cexplorer's fake-hash page does show a not-found message, 3 to 10 s after load; the original run stopped too early)
- **Claim:** Real IDs (from Koios) against a fabricated hash (`ab`×32), run 2026-10-01 with curl (Chrome User-Agent), with Playwright Chromium headless shell and with full Chromium in new headless mode:

  | Explorer | Real hash: status / result | Fake hash: status / result |
  |---|---|---|
  | Cexplorer (mainnet, preprod) | 200 · title "Tx 4206… detail - Content \| Cexplorer.io", overview rendered | 200 · same 3,247-byte shell; title "Tx abab… detail \| Cexplorer.io" and only the hash and footer for the first 3 to 6 s (preprod) or 6 to 10 s (mainnet), then "This page doesn't exist... Go back" with the title reduced to "Cexplorer.io" (corrected: the original reported no "not found" text) |
  | Etherscan (mainnet) | — | 200 · title unchanged ("Ethereum Transaction Hash (Txhash) Details \| Etherscan"); body "Transaction Hash not found on Ethereum" |
  | Cardanoscan (mainnet, preprod; tx, address, tokenPolicy, token) | 403 "Just a moment..." (Cloudflare) | 403 "Just a moment..." |
  | BscScan (mainnet, testnet) | — | 403 "Just a moment..." |
  | explorer.cardano.org | 200, chooser | 200, chooser still says "link available" (no existence check) |

  - At verification one render of the Cexplorer mainnet real-transaction page showed "503 Service Temporarily Unavailable" for 15 s behind an HTTP 200 navigation; a render two minutes later succeeded (added at verification).
- **Implication for /frontend:** for the checker:
  1. Check existence through an indexer (Koios `tx_status`/`tx_info`, or `eth_getTransactionReceipt` on the chain's RPC).
  2. Check the URL against the templates (F20).
  3. Render-check only where a marker exists:
     - Cexplorer: wait up to 15 s for either marker. Pass on the positive marker (" - Content" in the title, "Transaction Overview" in the body); fail on the negative marker ("This page doesn't exist" in the body). A timeout or a 503 page means "not rendered", not "failed" (corrected: the original had a positive marker only).
     - Etherscan fails on the negative marker ("Transaction Hash not found").
  4. Report Cardanoscan and BscScan links as "pattern-checked, not rendered (Cloudflare)" instead of passing or failing them.
  5. Never use the HTTP status code.
- **Evidence:**
  - Scripts `render_explorers.py`, `render_extra.py` and `ecorg_links.py`, output files `explorer-render.json` and `explorer-render-extra.json`, and screenshots in `shots/`, FD18 scratch folder — run 2026-10-01 — first-hand measurement.
    - `{"explorer": "cardanoscan", "network": "preprod", "kind": "tx-real", "http_status": 403, "title": "Just a moment..."}`
    - `{"explorer": "cexplorer", "network": "preprod", "kind": "tx-fake", "http_status": 200, "title": "Tx abababab…abab detail | Cexplorer.io"}`
    - `{"explorer": "etherscan", "network": "mainnet", "kind": "tx-fake", "http_status": 200, "title": "Ethereum Transaction Hash (Txhash) Details | Etherscan", "markers": ["not found"]}`
  - Verification scripts `fc/fc_explorers.py` and `fc/fc_cexplorer.py` (headless shell and full Chromium, snapshots at 1, 3, 6, 10 and 15 s), output `fc/fc-cexplorer.json`, screenshots `fc/shots/fc-cex-*.png` — run 2026-10-01 — first-hand measurement (added at verification).
    - preprod fake, headless shell: 1 s and 3 s title "Tx abababababababababababababababababababababababababababababababab detail | Cexplorer.io", no marker; 6 s title "Cexplorer.io", body "This page doesn't exist... Go back".
    - mainnet fake: 1 s to 6 s title "Tx abab… detail | Cexplorer.io"; 10 s title "Cexplorer.io", body "This page doesn't exist... Go back".
    - Cardanoscan preprod real and BscScan fake with full Chromium: 403 "Just a moment...".
- **Limits / false positives:**
  - Bot-protection outcomes depend on IP, User-Agent and Cloudflare heuristics. A headed browser, or a different network, may pass.
  - The delay before Cexplorer's negative marker varied between runs and networks; a slow connection could exceed 15 s.

### FD18-F22 — Address and identifier formats: what to decode, what to show, how to truncate
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED (two of the quoted Carbon sentences are not on the live Carbon page; they come from the page's repository source)
- **Claim:**
  - CIP-30 returns hex. CIP-19 prefers bech32 "as its built-in error detection may protect users against accidental misspellings or truncations", and Cardano "does not impose a length limit".
  - The sampled mainnet base address is 103 characters and the preprod script address 63. The `bech32` npm package (2.0.0) defaults to a 90-character limit and throws "Exceeds length limit" unless a larger limit is passed.
  - CIP-5 prefixes: `addr`, `addr_test`, `stake`, `stake_test`, `asset` (CIP-14 fingerprint), `pool`, `script`, `drep`.
  - CIP-14 fingerprints are "somewhat unique (although collisions are plausible)", and CIP-14 recommends showing a visual checksum alongside them.
  - BIP-173: "The last six characters of the data part form a checksum and contain no information."
  - Carbon's truncation rules (IBM design-system guidance, grade B for these sub-claims):
    - An ellipsis stands for three or more characters, and at least four characters stay visible.
    - The full string is always available on hover.
    - Mid-line truncation "requires JavaScript".
    - Never truncate "page headers, titles, labels, error messages, validation messages, or notifications".
    - The four-character minimum and the always-on hover tooltip are stated in the carbon-website repository source and in Exa's cached copy, but not in the live page as served and rendered on 2026-10-01, which keeps the three-character, "requires JavaScript" and "should not be used on" sentences (corrected: the original cited the live page for all four rules).
  - ERC-7730 leaves truncation "device dependent". Ledger shows the full address during verification (F11).
- **Implication for /frontend:**
  - Encode hex addresses with `bech32` passing a large limit, or with the transaction SDK's own helper.
  - Middle-truncate only for display. Keep the prefix plus leading data characters and the trailing characters; the length is set in F23.
  - Put the full value in `title` and in the accessible name, e.g. visually hidden text inside the link, which satisfies 2.5.3 because the name starts with the visible start.
  - Copy buttons copy the full value.
  - Never truncate inside error messages or the review screen.
  - For assets, show name, ticker and fingerprint, with the policy ID available on demand. Do not treat the fingerprint as a unique key.
  - `navigator.clipboard.writeText` works only in a secure context and can throw `NotAllowedError`: show "Copied" in the status region on success, and a select-to-copy fallback on failure.
- **Evidence:**
  - [CIP-0019](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0019/README.md) — accessed 2026-10-01.
    - "By convention, **Shelley** and stake addresses are encoded using **[Bech32][]**, with the exception that Cardano does not impose a length limit on the sequence of characters." · "Bech32 is the preferred encoding, as its built-in error detection may protect users against accidental misspellings or truncations."
  - [CIP-0005](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0005/README.md) — "| `addr_test` | Testnet address |" — and [CIP-0014](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0014/README.md), accessed 2026-10-01.
    - "The asset fingerprint needs to be _somewhat unique_ (although collisions are plausible, see next section)" · "We recommend however that in addition to the asset fingerprint, applications also show whenever possible a visual checksum calculated from the policy id and the asset name"
  - [unpkg bech32@2.0.0/dist/index.js](https://unpkg.com/bech32@2.0.0/dist/index.js) — accessed 2026-10-01 — `LIMIT = LIMIT || 90;` · `throw new TypeError('Exceeds length limit');`
  - [BIP-173](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki) — accessed 2026-10-01 — quote above.
  - [Carbon: Overflow content](https://carbondesignsystem.com/patterns/overflow-content/) — IBM, live page, accessed 2026-10-01 (served HTML and a Playwright render).
    - "should represent three or more truncated characters in a text string."
    - "Truncation should not be used on page headers, titles, labels, error messages, validation messages, or notifications."
    - "Mid-line truncation does not have its own class as it requires JavaScript."
  - [carbon-website src/pages/patterns/overflow-content/index.mdx](https://github.com/carbon-design-system/carbon-website/blob/main/src/pages/patterns/overflow-content/index.mdx) — IBM, main, last changed 2025-06-11, accessed 2026-10-01 — page source (added at verification).
    - "There must be at least four characters of non-truncated content in a truncated string. Truncated items always include a browser tooltip on hover to show the entire string, name, or phrase that the ellipsis is representing."
  - [Clipboard: writeText()](https://github.com/mdn/content/blob/main/files/en-us/web/api/clipboard/writetext/index.md) — MDN, accessed 2026-10-01.
    - "Writing to the clipboard can only be done in a secure context." · "`NotAllowedError` … Thrown if writing to the clipboard is not allowed."
- **Limits / false positives:** Whether hiding the full value in the accessible name reads well aloud (a 103-character address) was not tested. An alternative is an accessible name of "Address ending 9saxvg" plus a copy action. Carbon's live page may still be mid-migration; the two dropped sentences may be withdrawn guidance or a rendering gap.

### FD18-F23 — Address poisoning makes 4+4 truncation a security choice, not a style choice
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED (the 8…8 heuristic was presented as a margin above the attack; the study's largest group matched 20 digits, more than 8…8 shows)
- **Claim:**
  - Tsuchiya, Dong, Soska and Christin (USENIX Security 2025, pp. 1243-1262) measured address poisoning on Ethereum and BSC from 2022-07-01 to 2024-06-30: "270M on-chain attacks targeting 17M victims", and "6,633 incidents have caused at least 83.8M USD in losses".
  - Lookalike addresses match the first and last characters, because "the middle part of a string matters significantly less".
  - The largest group reached 20-digit matches; the others reached 14. A match counts the hex digits that agree at the beginning and at the end together (added at verification).
  - In January 2025 MetaMask and Phantom showed 4+4 characters and Trust Wallet 2+4. The paper adds that most wallets "used to show only the first and last 3–5 characters", and scan services such as Etherscan "the first and last 6–7 characters" (added at verification).
  - Wallet-level mitigation: "show more of the address to make lookalike addresses easier to spot".
  - The authors expect the attack to apply to "any blockchain whose addresses are represented by strings or objects complex enough".
- **Implication for /frontend:**
  - Wherever the user decides or verifies (review before signing, Ledger mirror panel, confirmation), show the full address. Grouping it into blocks is optional, and untested.
  - Elsewhere, keep at least 8 data characters after the `addr1`/`addr_test1` prefix and at least 8 at the end. This length is my heuristic and is not validated. It exceeds the 14-digit matches of most groups in the study but not the 20-digit matches of the largest one, so it only reduces risk in views where the user does not decide; it does not replace the full address on decision screens (corrected: the original framed 8…8 as simply "above the 4+4 the study found exploited").
  - Never pre-fill a recipient from transaction history.
  - The checker flags any displayed address shorter than prefix+8…8 outside review states, and any truncated address inside them.
- **Evidence:**
  - [Blockchain Address Poisoning](https://www.usenix.org/conference/usenixsecurity25/presentation/tsuchiya) — Taro Tsuchiya, Jin-Dong Dong, Kyle Soska, Nicolas Christin, 34th USENIX Security Symposium, 2025 (BibTeX on the page: `pages = {1243--1262}`); [arXiv 2501.16681v3](https://arxiv.org/abs/2501.16681) (02 Jul 2025) — peer-reviewed.
    - "We identify 13 times more attack attempts than reported previously—totaling 270M on-chain attacks targeting 17M victims. 6,633 incidents have caused at least 83.8M USD in losses"
    - "the middle part of a string matters significantly less in address poisoning"
    - "Group 1 produces a maximum 20-digit match while other groups (Groups 2, 3, and 4) achieve 14-digit matches."
    - "We instead use the number of matching hexadecimal digits at the beginning and" [end] (verification, arXiv v3 HTML)
    - "Most wallet software (e.g., MetaMasks, Phantom Wallet) used to show only the first and last 3–5 characters, while blockchain scan services (e.g., Etherscan) used to display the first and last 6–7 characters." (added at verification)
    - "All three services abbreviate addresses by only showing the first a and last b characters. Metamask uses (a,b)=(4,4), Trust Wallet uses (2, 4), and Phantom uses (4, 4)." (the paper dates this check "as of Jan. 2nd, 2025")
    - "For example, one can show more of the address to make lookalike addresses easier to spot."
- **Limits / false positives:**
  - The measurement covers EVM chains with hex addresses. Cardano poisoning was not measured, and bech32's 32-character alphabet raises the cost per matched character.
  - Wallet abbreviation lengths are as of January 2025.

### FD18-F24 — ADA Handles: the `$` is display-only; resolve against the official policy and re-resolve on submit
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** CORRECTED (preprod Handle resolution was checked at verification and works through a preprod API; the cached policy page also lists a testnet policy with no assets)
- **Claim:**
  - Kora Labs' resolution sheet points to its API ("just use our API! - https://api.handle.me/swagger") and gives the CIP-68 (222) label prefix `000de140`. Its tip reads "Don't encode the '$'".
  - Classic Handles "were only minted on `f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a`".
  - The live API: `GET https://api.handle.me/handles/web3` returned `name`, `hex`, `policy f0ff48bb…`, `resolved_addresses.ada` (an `addr1…` value), `holder_type` and `handle_type`.
  - ADA Handle's best-practice page, served only from a search cache because the domain did not resolve on 2026-10-01, says:
    - start a Handle lookup with `$`;
    - "Show the last few characters of the resolved Handle";
    - "Re-fetch the final Handle on submit";
    - "never allow an empty string".
  - The sheet's example datum lists a second policy, `f1ff…b`, but Koios returned no assets under it.
  - Preprod: `https://preprod.api.handle.me/handles` returned preprod Handles on the same policy `f0ff48bb…`, resolving to `addr_test1…` addresses, and Koios preprod lists assets under that policy. `preprod.api.handle.me/handles/web3` returned 404, because that Handle is not minted on preprod. The cached Official Policy IDs page also lists a testnet policy `8d18d786e92776c824607fd8e193ec535c79dc61ea2405ddf3b09fe3` ("Version 0 (beta)"), under which Koios shows no assets on preprod or preview (added at verification).
- **Implication for /frontend:**
  - Accept a `$name` recipient, and strip the `$` before resolving.
  - Resolve through the Handle API or on-chain (official policy + hex name, with the CIP-68 prefix for new Handles).
  - Show the resolved address (full on the review screen), and resolve again on submit.
  - Ignore an empty handle.
  - On preprod, resolve through `https://preprod.api.handle.me` and the `f0ff48bb…` policy; ignore the `8d18d786…` testnet policy. This was checked at API level only, not end to end in a wallet (corrected: the original said preprod resolution was not verified).
- **Evidence:**
  - [HandleResolution.pdf](https://public.koralabs.io/documentation/HandleResolution.pdf) — Kora Labs, undated, accessed 2026-10-01 — vendor documentation.
    - "For easiest resolution and to skip the steps below, just use our API! - https://api.handle.me/swagger" · "(TIP: These were only minted on f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a)" · "CIP-68 (222) label 000de140". The quote marks around `$` were lost in PDF text extraction.
  - `https://api.handle.me/handles/web3` and `https://api.handle.me/swagger.json` — Kora Labs, accessed 2026-10-01 — live API; routes include `handles/{handle}` and `handles/{handle}/personalized`.
  - `https://preprod.api.handle.me/handles?records_per_page=3` → three Handles with `policy f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a` and `resolved_addresses.ada` starting `addr_test1`; Koios `policy_asset_list` for `f0ff48bb…` on `preprod.koios.rest` and for `8d18d786…` on `preprod.koios.rest` and `preview.koios.rest` — accessed 2026-10-01 (added at verification).
  - [ADA Handle Best Practices](https://docs.adahandle.com/best-practices) and [Official Policy IDs](https://docs.adahandle.com/official-policy-ids) — read via Exa's cached copy, 2026-10-01; live `getaddrinfo ENOTFOUND docs.adahandle.com` (at verification, curl exit 6: host not resolved).
    - "**Show the last few characters of the resolved Handle** so the user can independently verify the destination address if they so choose." · "**Re-fetch the final Handle on submit.**" · "When querying a Handle, you should **never allow an empty string**."
    - Official Policy IDs: "Mainnet … Version 0 (beta) `f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a`" · "Testnet … Version 0 (beta) `8d18d786e92776c824607fd8e193ec535c79dc61ea2405ddf3b09fe3`"
- **Limits / false positives:** The docs quotes come from a cache of an unreachable site, and the second-policy status is unresolved.

### FD18-F25 — Amounts: lovelace integers, token decimals from metadata, BigInt-safe locale formatting
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - "One ada equals 1,000,000 lovelaces", and "All on-chain ada amounts are tracked in lovelace; wallet UIs convert to ada for display".
  - Genesis `maxLovelaceSupply` is 45,000,000,000,000,000, which is 5.0 times `Number.MAX_SAFE_INTEGER`.
  - Token decimals:
    - CIP-26 (off-chain registry): `decimals` is an integer from 0 to 19, "When the metadata subject refers to a monetary policy".
    - CIP-68 FT label 333: `? decimals: int`, which is optional.
    - ERC-7730's rule for an unknown token: raw value plus an "Unknown token" warning.
  - MDN: `Intl.NumberFormat.prototype.format()` accepts Number, BigInt or string, and "will use the exact value that the string represents". Output "may vary between implementations … You should not compare the results of `format()` to hardcoded constants."
  - Measured on Node 24.13.0 for 45,000,000,000,123,456,789 lovelace at 6 decimals:
    - decimal-string path "45,000,000,000,123.456789";
    - `` `${bigint}E-6` `` path identical;
    - `Number` path "45,000,000,000,123.450000" (digits lost);
    - `fr-FR` "45 000 000 000 123,456789", with narrow no-break spaces.
- **Implication for /frontend:**
  - Keep amounts as BigInt, or as the provider's decimal strings.
  - Format with `new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(\`${units}E-${decimals}\`)`.
  - Never use `Number()` or `parseFloat` on amounts.
  - Resolve decimals from CIP-68 or CIP-26 metadata. When decimals are missing, show integer units labelled "units (no decimals metadata)".
  - Use tabular figures in amount columns (FD16-F16 lists which fonts have them).
  - The checker compares formatted output via `Intl` or with normalised spaces, never against literals.
- **Evidence:**
  - [Lovelace](https://cardano.org/glossary/lovelace/) — cardano.org glossary, accessed 2026-10-01.
    - "The smallest divisible unit of ada. One ada equals 1,000,000 lovelaces." · "All on-chain ada amounts are tracked in lovelace; wallet UIs convert to ada for display."
  - [Mainnet shelley-genesis.json](https://book.play.dev.cardano.org/environments/mainnet/shelley-genesis.json) — `maxLovelaceSupply 45000000000000000`, accessed 2026-10-01.
  - [CIP-0026](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0026/README.md) — "When the metadata subject refers to a monetary policy, refers to the number of decimals of the currency.", `"minimum": 0`, `"maximum": 19` — and [CIP-0068](https://github.com/cardano-foundation/CIPs/blob/master/CIP-0068/README.md) — `? decimals: int` — accessed 2026-10-01.
  - [Intl.NumberFormat.prototype.format()](https://github.com/mdn/content/blob/main/files/en-us/web/javascript/reference/global_objects/intl/numberformat/format/index.md) — MDN, last change 2026-07-20, accessed 2026-10-01.
    - "Strings are parsed in the same way as in number conversion, except that `format()` will use the exact value that the string represents, avoiding loss of precision during implicitly conversion to a number."
    - "You should not compare the results of `format()` to hardcoded constants."
  - `node -e` run on Node v24.13.0, 2026-10-01 — first-hand measurement (outputs above; re-run at verification with identical output, the four separators being U+202F).
- **Limits / false positives:** CIP-26 registry coverage of preprod tokens was not checked. The test value is synthetic and exceeds the supply cap; it only exercises precision.

### FD18-F26 — Testnet values must look like test values
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - The Cardano Developer Portal: "the testnets use test ADA (tAda), which has no value". Testnet addresses start with `addr_test`.
  - The EVM chain registry names BSC testnet's currency symbol `tBNB`, while Sepolia keeps the `ETH` symbol under the name "Sepolia Ether".
  - Cexplorer's preprod pages show a "preprod" label, yet also print a dollar value next to test ADA ("Total Output ₳ 4.53 ($1.15 | ₿0.0414)") and the mainnet ADA price in the header.
- **Implication for /frontend:**
  - On any non-mainnet network, show a persistent network badge in the header, use the unit "tADA" (or "tBNB"), and never convert to fiat.
  - For judges new to blockchain, say "test ADA (no real value)" at first mention.
  - The checker fails a testnet build that renders a currency sign or fiat amount next to a test token.
- **Evidence:**
  - [Choose a Network](https://developers.cardano.org/docs/developers/curriculum/start-building/networks-and-test-ada/) — Cardano Developer Portal, accessed 2026-10-01.
    - "addresses carry a network tag (testnet addresses start with `addr_test`)" · "the testnets use test ADA (tAda), which has no value and is free from a faucet."
  - [ethereum-lists/chains eip155-97.json](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-97.json) and [eip155-11155111.json](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-11155111.json) — accessed 2026-10-01 — `{'name': 'BNB Chain Native Token', 'symbol': 'tBNB', 'decimals': 18}` · `{'name': 'Sepolia Ether', 'symbol': 'ETH', 'decimals': 18}`.
  - `https://preprod.cexplorer.io/tx/420686093ba362189bb9f2a158c94996d157296fbf881f716455c3ea4926b0d0`, rendered 2026-10-01 — observation — "Total Output ₳ 4.53 ($1.15 | ₿0.0414)"; header "preprod ADA: $0.25 +2.4% (303 sats)" at verification.
- **Limits / false positives:** Spelling varies across Cardano's own pages ("tAda", "test ada", "test ADA"); I chose "tADA" as the display unit.

### FD18-F27 — A live Cardano dApp connects a Ledger directly, without a browser wallet (added at verification)
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** added at verification
- **Claim:** Minswap (app.minswap.org redirects to minswap.org), headless Chromium 1440×900, no wallet and no device, 2026-10-01:
  - The "Connect wallet" side panel lists "MinWallet" ("Mobile support"), "Ledger" ("Mobile support"), "MetaMask" ("Chromium only"), then "Featured wallets" Eternl, Begin and NUFI (each "Chromium only"), "Add Custom Wallet" and "More wallets...". It ends with a consent line and no checkbox: "By connecting a wallet, you agree to Minswap Labs' Terms of Service and consent to its Privacy Policy."
  - Choosing Ledger opens a form inside the dApp, with no extension involved: "Transport type" (USB or Bluetooth), "Account index" (#0 to #23), "Give your wallet a name" (prefilled "My Ledger"), then "Connect" and "Back".
  - Minswap's JavaScript bundle contains `getExtendedPublicKeys`, `signTransaction`, "Cardano app" and LedgerJS's "Ledger device: " status-error prefix. `getExtendedPublicKeys` and `signTransaction` are methods of the `Ada` class in `@cardano-foundation/ledgerjs-hw-app-cardano` 8.0.0. Inference, not confirmed from Minswap's source: Minswap talks to the Cardano Ledger app through that binding over a LedgerJS transport.
  - The settings panel offers "Explorer: Cardanoscan, Cexplorer, AdaStat" and "Currency: USD, ADA", as F07 reported.
- **Implication for /frontend:**
  - For Origins (Cardano track) with a Ledger, a dApp-side device path exists in production, so a demo can show the device steps (F09, F11) instead of only hinting through a CIP-30 wallet (F08). It rests on the LedgerJS-style Cardano binding, which Ledger's deprecation covers, or on raw APDUs through the DMK; budget time for either and test with a real device before the recording.
  - A per-wallet "Chromium only" badge is a live pattern for the WebHID and extension limits (F10); reuse it instead of a dead button.
  - The consent-by-connecting line, not a checkbox, is what Liqwid and Minswap use (F07).
- **Evidence:**
  - Verification scripts `fc/fc_minswap2.py`, `fc/fc_minswap3.py` and `fc/fc_minswap4.py`, outputs `fc/fc-minswap2.json` and `fc/fc-minswap3.json`, screenshots `fc/shots/fc-minswap-connect.png` and `fc/shots/fc-minswap-ledger.png`, FD18 scratch folder — run 2026-10-01 — first-hand observation.
    - Open dialog text: "Connect wallet MinWallet Mobile support Ledger Mobile support MetaMask Chromium only Featured wallets Eternl Chromium only Begin Chromium only NUFI Chromium only Other wallets Add Custom Wallet More wallets... By connecting a wallet, you agree to Minswap Labs' Terms of Service and consent to its Privacy Policy."
    - After choosing Ledger: "Connect wallet Go back Ledger Transport type USB USB Bluetooth Account index #0 #0 #1 … #23 Give your wallet a name Connect Back"
    - Bundle markers in `https://minswap.org/_next/static/chunks/0qsy61~q3kqy8.js`: `getExtendedPublicKeys`, `signTransaction`, "Cardano app", `CLA_NOT_SUPPORTED`; in `0k3dlq_ru46vm.js`: "Ledger device: ".
  - [unpkg @cardano-foundation/ledgerjs-hw-app-cardano@8.0.0/dist/Ada.d.ts](https://unpkg.com/@cardano-foundation/ledgerjs-hw-app-cardano@8.0.0/dist/Ada.d.ts) — Cardano Foundation, accessed 2026-10-01 — type declarations: `export declare class Ada {` · `getExtendedPublicKeys({ paths, }: GetExtendedPublicKeysRequest): Promise<GetExtendedPublicKeysResponse>;` · `signTransaction(request: SignTransactionRequest): Promise<SignTransactionResponse>;`
- **Limits / false positives:**
  - One run, headless, with no device attached; the flow after "Connect" was not exercised.
  - The library is inferred from strings in a minified bundle; another library with the same method names would match too.
  - What "Mobile support" means for the Ledger row (Bluetooth on phones, or a mobile app) was not verified.

## Deliverable

### A. UI state catalogue (chain-agnostic, with Cardano, Ledger and EVM signals)

The copy column is proposed wording, derived from the cited findings. It is written for a viewer new to blockchain (TOKEN2049's UX criterion) and is not quoted from any source. Timings come from F14 and F15.

| # | State | Signal that enters it | What the screen shows | Copy pattern (proposed) | A11y rule | Timing |
|---|---|---|---|---|---|---|
| C0 | No wallet found | No CIP-30 key in `window.cardano`; for Ledger, `navigator.hid` missing | Supported wallets, each with "Install"; one line on what a wallet is | "No Cardano wallet in this browser. Install Eternl or Lace, then reload." · Ledger: "Connecting a Ledger needs Chrome or Edge on a computer." | Text in the dialog body, not a toast | Rendered at open, no spinner |
| C1 | Disconnected | No enabled wallet | "Connect wallet" and a network badge showing the app's network | "Connect wallet" · badge "Preprod: test network" | Badge is text, not colour only | — |
| C2 | Waiting for connection consent | `enable()` pending | Selected wallet row shows "Waiting…"; Cancel; help after 10 s | "Approve the connection in the Eternl window." After 10 s: "Can't see it? Click the Eternl icon in your browser's toolbar." | `role="status"`; focus stays in the dialog | Pressed state ≤ 0.1 s; help at 10 s |
| C3 | Connection declined | APIError -3, or `enable()` rejects | Inline message on the wallet row, Retry | "Eternl didn't connect: the request was declined or closed. Try again when you're ready." Code in "Details" | Inline text; not a modal | Persists until the next action (Indigo's and Liqwid's messages vanished within 6 s, F07) |
| C4 | Wrong network | `getNetworkId()` ≠ expected; CIP-142 magic ≠ expected; `addr`/`addr_test` mismatch | Blocking panel; all actions disabled | "Your wallet is on Mainnet. This demo uses Preprod, Cardano's test network (no real money). Switch the network in your wallet's settings, then reconnect." | `role="alert"` | At connect and after -4 |
| C5 | Connected | `enable()` resolved, network OK | Chip: wallet name, bech32 or Handle, network badge, tADA balance | "Eternl · addr_test1qz4k…c9x7kd · Preprod" | Accessible name contains the visible text (F22) | — |
| C6 | Account changed | APIError -4 on any call | Silent re-`enable()`, refreshed data, one-line notice | "Wallet account changed. Updated." | `role="status"` | Immediate |
| L1 | Ledger: connect | Click → `startDiscovering` (user gesture) | Browser device picker; instructions | "Plug in your Ledger and unlock it with your PIN." | Button calls discovery directly | — |
| L2 | Ledger: needs action | `pending` + `unlock-device`, `confirm-open-app` or `allow-secure-connection`; session `locked` or `busy` | Large mirror text of the device instruction (no Ledger logo) | "Unlock your Ledger." · "Open the Ethereum app on your Ledger." · "Allow the connection on your Ledger." | `role="status"`; large type for a projector | Unbounded; help at 10 s |
| T0 | Review | User pressed the action | Action, amount with unit, full recipient address, fee estimate, network, what happens next | "You're about to lock 50 tADA in the dispute escrow. Network fee ≈ 0.19 tADA. Your wallet will ask you to approve." | WCAG 3.3.4 "Confirmed"; headings; full address | — |
| T1 | Waiting for approval (browser wallet) | `signTx` pending | Step 1 of a stepper; what to check in the wallet window; "Stop waiting" | "Approve in Eternl. It should show 50 tADA going to addr_test1wp5l…ggng4dg." | `role="status"` | No CIP-30 timeout; help at 10 s |
| T1L | Waiting for approval (Ledger) | `pending` + `sign-transaction` (DMK), or the direct Cardano path of F27 | Mirror: Review [intent] → From → Amount → To → Fees → Hold to sign; clear-signing badge or blind-signing warning | "Check the details on your Ledger, then hold to sign." Blind: "Your Ledger can't read this contract call and will show a warning. Only continue if you started this action." | `role="status"`; announce step changes | Device hold 2 s |
| T2 | Cancelled in wallet | TxSignError 2; EIP-1193 4001 | Back to Review with a note | "You cancelled in Eternl. Nothing was sent." | Status, not alert | Persists |
| T2L | Rejected on device | 0x6985, 0x5501 (`ActionRefusedError`), `RefusedByUserDAError` | Back to Review with a note | "You rejected it on your Ledger. Nothing was sent." | Status | Persists |
| T3 | Can't sign | TxSignError 1 (ProofGeneration), 3 (DeprecatedCertificate) | Error with the fix | "This account can't sign for these funds. Switch to the account that holds them." | `role="alert"` | — |
| T4 | Sending | `submitTx` / broadcast pending | Step 2 | "Sending to Cardano…" | `role="status"` | Spinner after 500 ms, min 200 ms |
| T5 | Not accepted | TxSendError 1 or 2; node errors `BadInputsUTxO`, `OutsideValidityIntervalUTxO`, mempool full | One-sentence reason and one action: retry (transient) or rebuild (new approval) | "Cardano didn't accept it: one of the coins it spends was already used. We'll prepare a new one; you'll approve again." | `role="alert"`; error in text | Backoff for transient failures |
| T6 | Outcome unknown | Timeout or network error after submit | "Checking…" while polling by transaction id; no blind resend | "We couldn't confirm it was sent. Checking the network before doing anything else…" | `role="status"` | Poll; resend the same bytes only while the TTL is open |
| T7 | Pending | Transaction id known; `num_confirmations` null | Step 3 with expected time; transaction id with copy; explorer link pending | "Sent. Waiting for Cardano to record it (usually about 20 seconds)." After 60 s: "Taking longer than usual. It will expire at 14:32 if not recorded." | `role="status"`; no spinner-only UI | Cardano mean ~20 s, p90 ~51 s (preprod); BSC < 1 s |
| T8 | Recorded | Confirmations ≥ 1 from the app's own indexer; EVM receipt `status` 1 | Step 4 done; block number; explorer link live; confirmation count | "Recorded on Cardano in block 5,238,868 (1 confirmation)." | `role="status"` | — |
| T9 | Final | Cardano ≥ 10 confirmations; BSC fast finality | "Final" badge | "Final: 10 confirmations." | `role="status"` | Cardano a few minutes; BSC ~1.1 s |
| T10 | Expired or dropped (Cardano) | Current slot > `invalid_hereafter`, not on chain | Explanation and "Prepare again" | "This transaction expired before Cardano recorded it. No funds moved." | `role="alert"` | At the TTL |
| T10E | Replaced (EVM) | viem `onReplaced`: `replaced`, `repriced`, `cancelled` | Follow the new hash | "Your wallet sped it up; following the new transaction." · "Cancelled in your wallet. No funds moved." | `role="status"` | — |
| T11 | Failed on chain | Cardano phase-2 failure (collateral taken); EVM receipt `status` 0 | Cause and cost | "The contract rejected this transaction. 5 tADA of collateral paid the network's fee for checking it." | `role="alert"` | — |
| R1 | Data unavailable | RPC or indexer error or timeout | Last good data with "as of"; Retry; never "0" or "No transactions" | "Can't reach Cardano data right now. Showing values from 14:05. Retrying…" | `role="status"` | Exponential backoff (viem's HTTP transport defaults: `retryCount` 3, `retryDelay` 150 ms base) (corrected: the original cited `waitForTransactionReceipt`'s `retryCount` 6, which counts retries for a transaction or block not found) |
| R2 | Loading | Query pending | Skeleton in layout; spinner only after 500 ms | — | `aria-busy` on the region | 500 ms / 200 ms |
| E1 | Empty | Query succeeded with `[]` | Explanation and first action | "No disputes yet. Open one to see it here." | — | Only after a successful load |

Source for the R1 correction: [viem http transport](https://viem.sh/docs/clients/transports/http) (source `site/pages/docs/clients/transports/http.md`, wevm/viem main, accessed 2026-10-01): `retryCount` "**Default:** `3`" · "The max number of times to retry when a request fails." · `retryDelay` "**Default:** `150`", with exponential backoff `~~(1 << count) * retryDelay`.

### B. Timing constants

| Constant | Value | Source |
|---|---|---|
| Press feedback | ≤ 0.1 s | F15 (Nielsen) |
| Spinner show-delay / minimum | 500 ms / 200 ms | F15 (spin-delay defaults) |
| Help hint while waiting on a human | 10 s | F15 (Nielsen's attention limit) |
| Cardano expected block | ~20 s | F14 (portal; `activeSlotsCoeff` 0.05) |
| Cardano "taking longer" | ~60 s (measured p90: preprod 51 s, mainnet 46 s by the exclusive method, 45 s by linear interpolation) | F14 |
| Cardano worst observed interval (1,000 blocks) | 162 s preprod, 149 s mainnet | F14 |
| Cardano strong finality | 10-20 confirmations ("a few minutes"), per the portal's account of common practice | F14 (portal) |
| Cardano rollback hard bound | k = 2160 blocks (~12 h); preview 432 | F14 |
| BSC block / finality | 0.45 s / ~1.125 s (fallback 79.2-108 s) | F14 (BEP-619, measured 450.3 ms) |
| Etherscan indexing advice | ≥ 30 s before refresh; escalate after 1 h | F17 |
| viem receipt wait | timeout 180 s, retryCount 6 (retries when the transaction or block is not found) | F16 |
| viem HTTP request retries | retryCount 3, retryDelay 150 ms base, exponential | Deliverable A, R1 source |
| Cexplorer render wait before judging a link | up to 15 s (its not-found text appeared 3 to 10 s after load) | F21 |
| Ledger hold to sign | 2 s | F11 |
| CIP-158 store fallback (CF connector) | 2.5 s | [CF README](https://github.com/cardano-foundation/cardano-connect-with-wallet/blob/main/README.md): "If the wallet app opens within 2.5 s the app store redirect is cancelled" |

### C. Library choices with pinned versions and licences (npm, 2026-10-01)

| Use | Package @ version | Licence | Why / caveat |
|---|---|---|---|
| Cardano connect UI | none: own dialog on raw CIP-30 | — | F05 defaults; F07 patterns |
| Cardano wallet registry and deep links (optional) | `@cardano-foundation/cardano-connect-with-wallet-core@0.2.12` | Apache-2.0 | Framework-free; skip the React package's defaults |
| Cardano transaction building (pick one) | `@lucid-evolution/lucid@0.6.5` or `@meshsdk/core@1.9.1` | MIT or Apache-2.0 | Plutus V3 support not verified in this dossier |
| Mesh React (only if required) | whole set pinned at `1.8.14` (`core`, `wallet`, `common`, `react`) | Apache-2.0 | `latest` = 2.0.0-beta.2 with a different wallet dependency |
| Alternatives to watch | `@blaze-cardano/sdk@0.3.1`; `@evolution-sdk/evolution@0.5.16` | Apache-2.0 (repository) / MIT | Blaze has no licence on npm (a 1.0.0 sits under the `catalyst` tag); Evolution is pre-1.0 |
| Hex → bech32 | `bech32@2.0.0` with a limit above 90, or the SDK helper | MIT | 90-character default (F22) |
| Mobile QR connection (CIP-45) | `@fabianbormann/cardano-peer-connect@1.2.21` | Apache-2.0 | Only if mobile wallets must connect |
| Cardano data | Koios REST (public, no key) | — | `tx_status` returns null for pending (F17) |
| Ledger core | `@ledgerhq/device-management-kit@1.10.0` + `rxjs@7.8.2` | Apache-2.0 | Exact `rxjs` peer |
| Ledger transport | `@ledgerhq/device-transport-kit-web-hid@1.2.4` (dev: `…-speculos@1.2.1`) | Apache-2.0 | Chromium desktop only (F10); both peer `rxjs` 7.8.2 |
| Ledger EVM signing | `@ledgerhq/device-signer-kit-ethereum@1.18.1` + `@ledgerhq/context-module@2.6.0` | Apache-2.0 | Clear signing and Transaction Check need an `originToken` (partner program) |
| Ledger official connect flow (if Ledger provides partner config) | `@ledgerhq/ledger-wallet-provider@1.4.3` | npm: none; repository Apache-2.0 | v2 family packages (`-evm`, `-solana`) are release candidates only, and they peer `@ledgerhq/device-management-kit` at exactly 1.9.0, which conflicts with a 1.10.0 pin (registry, 2026-10-01; added at verification) |
| Cardano Ledger app binding | `@cardano-foundation/ledgerjs-hw-app-cardano@8.0.0` | Apache-2.0 | LedgerJS-style; no DMK kit exists. Used by wallets, and apparently by Minswap in the dApp itself (F27) (corrected: the original labelled it wallet-side only) |
| EVM | `viem@2.57.1`, `wagmi@3.7.7` | MIT | See FD16-F24/F25 |
| Spinner delay | `spin-delay@2.0.1`, or 20 lines of its logic | MIT | 500/200 defaults |

### D. Explorer URL templates

| Network | Transaction | Address | Asset / token | Policy |
|---|---|---|---|---|
| Cardano mainnet, Cexplorer | `https://cexplorer.io/tx/{hash}` | `…/address/{bech32}` | `…/asset/{policyId}{assetNameHex}` | `…/policy/{policyId}` (observed on preprod) |
| Cardano preprod, Cexplorer | `https://preprod.cexplorer.io/tx/{hash}` | same pattern | same pattern | same pattern |
| Cardano mainnet, Cardanoscan | `https://cardanoscan.io/transaction/{hash}` | `…/address/{bech32}` | `…/token/{policyId}{assetNameHex}` | `…/tokenPolicy/{policyId}` (third-party usage only; unverified) |
| Cardano preprod, Cardanoscan | `https://preprod.cardanoscan.io/transaction/{hash}` | same pattern | same pattern | same caveat |
| Cardano, neutral chooser | `https://explorer.cardano.org/[preprod/]tx/{hash}` | `…/[preprod/]address/{bech32}` | `…/[preprod/]asset/{policyId}{assetNameHex}` | not supported |
| BSC mainnet / testnet | `https://bscscan.com/tx/{hash}` / `https://testnet.bscscan.com/tx/{hash}` | `…/address/{0x…}` | `…/token/{0x…}` | — |
| Ethereum / Sepolia | `https://etherscan.io/tx/{hash}` / `https://sepolia.etherscan.io/tx/{hash}` | `…/address/{0x…}` | `…/token/{0x…}` | — |

Checker rule: existence through an indexer or RPC; pattern against this table; render only Cexplorer (wait up to 15 s; pass on "Transaction Overview", fail on "This page doesn't exist", report a timeout or 503 as not rendered) and Etherscan (negative marker); report Cardanoscan and BscScan as "pattern-only (Cloudflare)" (F21) (corrected: Cexplorer has a delayed negative marker).

### E. Display rules (addresses, handles, amounts, network)

1. Encode CIP-30 hex to bech32 before display, with a length limit above 90 (F01, F22).
2. On review, verify and confirm screens and in the Ledger mirror, show the full address. Elsewhere show at least prefix + 8 … 8 characters, with the full value in `title` and in the accessible name, and a copy button that copies the full value and announces "Copied". The 8…8 minimum does not defeat the 20-digit lookalikes the study measured, so it never replaces the full address where the user decides (F22, F23).
3. Handles: accept a `$name`, resolve without the `$`, show the resolved address, and re-resolve on submit; on preprod use `preprod.api.handle.me` (F24).
4. Amounts: BigInt or decimal strings only. `Intl.NumberFormat` with the string or `E-n` form. Decimals from CIP-68 or CIP-26 metadata; unknown decimals mean raw units plus a label. Tabular figures (F25).
5. Network: a persistent badge on testnets, "tADA" and "tBNB" units, no fiat on testnets, and "test ADA (no real value)" at first mention (F26).
6. Errors: headline in plain words plus one action; codes inside "Details"; no "invalid"; modals only for blocking states (F19).

### F. Checker hooks (deterministic)

- Built output contains none of: `Awesome DApp`, `awesome-dapp-url.tld`, `Powered by` (a wallet-kit footer), `mesh-dark`, `alert(` (F05). Caveat added at verification: `alert(` and `Powered by` also occur in unrelated bundled libraries and in the project's own copy, so run these greps on first-party source and on chunks that contain a wallet-kit marker, and report other hits as candidates, not failures.
- Exactly one live region (`role="status"` or `aria-live="polite"`) per transaction panel changes text across the scripted flow: idle → review → approval → sending → pending → recorded (F18). Drive the flow with a CIP-30 mock like `mock_wallet_refusal.py` (F07).
- The mock refusal (`{code:-3}`) produces visible text within 1 s, and not only a console log, and the text is still visible 10 s later (F07: the live dApps' messages vanished within 6 s).
- The action button is disabled within 100 ms of the first click; a second click causes no second `signTx` call (F15, F16).
- No `parseFloat(` or `Number(` applied to amount fields; formatting goes through `Intl.NumberFormat` (F25).
- On a testnet build: a network badge is visible on every screen, and no `$`/`€` amount appears next to a tADA value (F26).
- Explorer links match Deliverable D for the configured network, and their IDs exist per the indexer (F20, F21). Confirmation counts shown in the UI come from the indexer, not from an explorer (F17).
- The Ledger path: the `switch (requiredUserInteraction)` has a `never` default; "Connect Ledger" is a click handler; there is no DMK call at module load (F09, F10).

## Contradictions between sources

- CIP-142 lists Lace as an implementor, yet leaves Lace unticked in its own acceptance checklist and is absent from the CIP-30 Accepted Extensions Register. It also says the functions go "under the `cip-142` namespace" while its example calls `api.cip142`.
- CIP-30 "highly" recommends namespacing every extension endpoint, while CIP-95 overrides `api.signTx()` without a namespace by design (added at verification).
- The Cardano Developer Portal's former Testnets page, served by Exa's cache, gave Preview a "Standard (5 days)" epoch. Preview's genesis says `epochLength 86400` (1 day), and the current page says "1-day epochs". The old URL now redirects (the page was removed in the 2026-06-25 "Portal 2026" commit). At verification the cached page was found at `developers.cardano.org/docs/get-started/networks/testnets/` (cache dated 2026-05-15), and the table came from commit 9b0e09d (2025-11-28).
- Ledger's migration guide lists Tron and XRP among chains "that do not yet have a DMK signer", while npm has `@ledgerhq/device-signer-kit-tron` 0.3.0 and `@ledgerhq/device-signer-kit-xrp` 0.2.0.
- Ledger Wallet Provider's requirements list "Firefox 89+, Safari 14.1+" as supported desktop browsers. MDN's compatibility data lists no WebHID or Web Bluetooth support in either. The same page says the APIs are unavailable on Android, while MDN lists Web Bluetooth in Chrome for Android 56.
- ERC-7730's version table marks 1.0.0 "Deprecated" and 2.1.0 "Active". Ledger's quick reference says Ledger's tools and registry "target ERC-7730 v1" and calls v2 "in draft".
- ADA Handle's policy page lists one mainnet policy, "Version 0 (beta)" `f0ff48bb…`. Kora Labs' resolution sheet shows a second policy, `f1ff48bb…b`, in its example datum. Koios shows no assets under the second policy.
- CIP-30's acceptance criteria and implementor list still name jpg.store (sunset), Nami (now a migration path into Lace) and Flint (store page gone), and omit Vespr and Typhon, which CIP-95 lists.
- Ledger's Website Terms, read literally, forbid any use of the marks, while Ledger's own DMK docs suggest the on-screen copy "Confirm on your Ledger".
- EIP-3091 is "Stagnant", yet the chain registry tags Etherscan and BscScan as `"standard": "EIP3091"`, and both follow its routes.
- The brief says "Ledger Live"; Ledger now calls the app "Ledger Wallet (formerly Ledger Live)".
- Carbon's overflow-content page: its repository source (and Exa's cache) states a four-character minimum and an always-on hover tooltip; the live page served on 2026-10-01 omits both sentences (added at verification).
- Cexplorer's preprod page showed "Confirmations Low (0)" for a transaction Koios counted at 153 confirmations (added at verification).

## What could not be found, and how it was searched

- **A Ledger brand guideline for third-party dApps** (badge, logo use, "Works with Ledger"). Searched Exa and WebSearch ("Ledger trademark policy … third parties", `site:developers.ledger.com trademark OR brand`) and read the developer-portal marketing page and the website Terms. Found only the Terms clause, the trademark list and the co-branding programme. OP3N-specific brand rules were not searched.
- **Cardanoscan's policy route and not-found rendering.** Every Cardanoscan request (curl, headless shell, full Chromium) returned a Cloudflare 403, again at verification. The Cardano Foundation resolver has no policy type. `tokenPolicy` appears only in third-party code (GitHub code search).
- **BscScan not-found rendering.** Also Cloudflare 403, again at verification.
- **Minswap's connect dialog.** Blocked by a "What's new?" dialog in the original two attempts; opened at verification after pressing Escape three times and clicking the header's "Connect wallet" (F27).
- **Real wallet behaviour** for CIP-142, CIP-95 and signing a Plutus V3 transaction without CIP-95. No wallet extension was installable in this environment; only a mock was used.
- **ADA Handle docs, live.** `docs.adahandle.com` did not resolve (DNS `ENOTFOUND`; curl exit 6 at verification); the quotes come from Exa's cached copy. Preprod Handle resolution was checked at API level at verification (F24), not in a wallet.
- **Wallet usage shares beyond desktop Chrome counters** (mobile installs, on-chain wallet attribution). Not found; not searched further.
- **The Chrome Web Store's definition of "users".** Not verified.
- **Ethereum block time and finality.** Out of scope for this round and not researched.
- **A Cardano analogue of ERC-7730** (clear-signing descriptors for Plutus dApps on the Ledger Cardano app). Not researched.
- **Which Ledger library Minswap uses.** Inferred from bundle strings (F27); its source is not public in this session's search.

## Weak spots of this dossier

- The dApp observations (F07, F27) come from one or two headless runs each, with a minimal mock wallet and no device. SundaeSwap's silence after a refusal may be an artefact of the mock.
- The explorer rendering results (F21) depend on Cloudflare heuristics for this IP and User-Agent, and Cexplorer's not-found delay varied between runs. A headed browser or another network may get through.
- The block-interval sample (F14) is about 6 hours on one day: 1,000 blocks per Cardano network and 2,000 on BSC. Time to inclusion was not measured.
- Several implications are my derivations, not quoted rules, and are labelled as such:
  - the UTxO-lookup network heuristic;
  - the 8…8 truncation minimum;
  - the 60 s "taking longer" threshold;
  - the Ledger mirror panel for projectors;
  - all proposed copy in Deliverable A.
- The trademark reading (F13) is not legal advice.
- No package was installed or run: Mesh, Lucid Evolution, the Cardano Foundation connector, DMK and Ledger Wallet Provider were judged from registry metadata, docs and source.
- The NN/g pages were first read through Exa's full-text fetch; at verification they were re-read from raw HTML and their authors and dates added (F15, F19).
- Several Ledger developer-portal pages begin with an `agent_config` block pointing at external AI instruction files. I read them as data and did not follow them; /frontend should do the same.

## Dropped at verification

None.

## Verification notes

- **Method.** Every cited source was re-opened on 2026-10-01 in the verification session, not read from the researcher's scratch copies. Fresh copies are in the FD18 scratch folder under `fc/`.
  - Specifications and source: CIP-5, 14, 19, 26, 30 (and its extension register), 68, 95, 103, 104, 106 and 142 from `raw.githubusercontent.com`; the Cardano Foundation connector (`core/index.ts`, `core/utils/wallet.ts`, `errors.ts`, `wallets.ts`, `ConnectWalletButton.tsx`, both READMEs); Mesh React source at HEAD and the 1.8.14 bundle on unpkg; DMK and signer-eth source on develop and the published DMK 1.10.0 declarations on unpkg; Ledger Live `app.json`, `errorCategory.ts` and `classify-device-error.ts`; `DeepLinkResolver.jsx` and `App.jsx` of cf-explorer-landing; spin-delay source; bech32 2.0.0 bundle; BIP-173; EIP-1193, EIP-3091, ERC-7730, BEP-619; viem docs source; MDN content and browser-compat-data; W3C WCAG 2.2 and WAI-ARIA 1.2; carbon-website source.
  - Docs pages: Ledger developer docs as raw `.md` (migration guide, init, transports, DMK how-to, Ethereum Signer Kit reference, device-app guidelines, clear-signing pages, Ledger Wallet Provider pages, marketing deliverables); developers.cardano.org sources on the staging branch plus the live pages; NN/g articles as raw HTML (authors and dates read from the page and its JSON-LD); Ledger shop pages; cardano.org glossary; Carbon live page (HTML and a Playwright render); the USENIX page and arXiv v3 HTML of the poisoning paper; Kora Labs' PDF (text extracted with pypdf).
  - Registries: npm registry for every package in F04, F08, F13, F16 and Deliverable C, and `gh api` for repository metadata.
  - Measurements re-run: Koios block intervals on the same height ranges (identical statistics), BSC interval from the two end blocks (450.275 ms), Koios `tx_status` (unknown hash and two real ones), the Node `Intl.NumberFormat` test (identical), explorer HTTP statuses and renders (headless shell and full Chromium, timed snapshots), the mock-wallet runs on Indigo, Liqwid and SundaeSwap (with timed snapshots and an `enable()` call counter), jpg.store, Minswap's settings, connect panel, Ledger form and bundle strings, and the mainnet and preprod Handle APIs.
- **Sources I could not open.** WebFetch returned a session limit once (Carbon); curl, Playwright and Exa covered it. `docs.adahandle.com` does not resolve, so its quotes still rest on Exa's cache. Cardanoscan and BscScan return Cloudflare 403 to every client used. The Cexplorer mainnet transaction page served a 503 page once and rendered two minutes later.
- **Residual doubts.**
  - F14 percentiles depend on the method; both methods are now stated.
  - Cexplorer's not-found delay (3 to 10 s here) could exceed the 15 s wait on a slow link, and why its preprod confirmation count stays at 0 is unknown.
  - "Medium (7)" on Cexplorer mainnet (original run) was not re-observed; at verification the page read "High (165)".
  - Minswap's Ledger library (F27) is inferred from minified strings.
  - The live Carbon page may be mid-migration; the missing sentences could return or be withdrawn guidance.
  - The NN/g error-guidelines date is 2023-05-15 in its JSON-LD but "May 14, 2023" on the page; the dossier keeps 2023-05-15 and states both.
  - Real-wallet and real-device behaviour (CIP-142, CIP-95, Plutus V3 signing, Ledger flows, Minswap's Ledger path) remains untested.
- **Grades after verification.** A 19, B 8 (F27 added at B). No finding was downgraded or dropped.
