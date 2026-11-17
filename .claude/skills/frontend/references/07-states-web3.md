# States and web3: wallets, transactions, addresses, amounts, Ledger

Read when: a section connects a wallet, asks for a signature, sends or tracks a transaction, shows an address, an amount, a network or an explorer link, or uses a Ledger; also for loading, empty and error states of any data panel.

## Purpose
Every state on the judge's path is part of the demo: connecting, waiting, failing, recovering. This file gives one state machine keyed on wallet signals (CIP-30, EIP-1193, the Ledger Device Management Kit), timings measured on the chains, explorer links checked by existence, and address and amount display that cannot mislead.
The catalogue's copy column is FD18's proposed wording, not a quote [FD18 UI state catalogue]; placeholders in braces are filled from real data, never invented. Copy rules in general: `14-copy.md`. Recording of device steps: `09-recording.md`.

## Rules

### WS-01 - Drive every wallet and transaction view from one state machine
- **Rule:** Implement the states of the catalogue below (C0-C6, L1-L2, T0-T11, R1-R2, E1) as one state machine entered on wallet signals. Map CIP-30 APIError -3 to "not connected, can retry", -4 to a silent re-`enable()` and refresh, TxSignError 2 to "cancelled, nothing sent", TxSignError 1 to "this account cannot sign", TxSendError 1 or 2 to "not sent". Keep an unknown-error branch that stores the raw error for a Details block.
- **Why:** CIP-30's error codes map one-to-one onto UI states, the spec defines no timeout, and wallets may throw objects with no `code` [FD18-F01]. The catalogue joins Cardano, Ledger and EVM signals [FD18 UI state catalogue].
- **Check:** critic (the FD18 hooks have no gate id yet, see Gaps)
- **Not when:** never.

### WS-02 - Build the connect dialog yourself
- **Rule:** Build the connect dialog from the project's own primitives and tokens: raw CIP-30 on Cardano, wagmi and viem on EVM chains. Use libraries for transaction building and state only. Ship no prebuilt connect component in a judged demo; if one must stay, override every default it shows.
- **Why:** Mesh's dialog closes before `connect` resolves, so it never shows a connecting or failed state, and carries its maker's credit line; the Cardano Foundation button falls back to a browser alert and a placeholder dApp name [FD18-F05]. The default is an own dialog plus one transaction SDK [FD18-F04] [FD18 Library choices].
- **Check:** tells.score (rule SL-G03, a candidate until calibrated)
- **Not when:** never.

### WS-03 - List the wallets people have, detected first
- **Rule:** Show detected wallets first, then Eternl, Lace, Yoroi (now SecondFi), Vespr, Typhon, NuFi and Begin, each missing one marked Install. Detect by registry key (Typhon injects `typhoncip30`). Label a tile with the wallet's injected `name` only for keys on the app's own allowlist. Leave out Nami and Flint. Add no terms checkbox the project does not have; a consent line is enough.
- **Why:** Store counters and the registry; Nami is now a migration path into Lace, Flint's listing is gone, and any extension can inject a name and an icon [FD18-F06]. Liqwid marks each missing wallet Install; Liqwid and Minswap use a consent line, not a checkbox, and a demo has no terms to show [FD18-F07].
- **Check:** critic
- **Not when:** an EVM-only project.

### WS-04 - Keep each error beside its source until the next action
- **Rule:** Show a connection or signing error as text beside its source (the wallet row, the action button): first what happened in plain words, then one next action. Keep it visible until the user's next action. Put codes and raw messages in a collapsible Details block. Say what an input is not ("This isn't a Cardano address."), never that the user is wrong. Use a modal only for a blocking state, and never a browser dialog.
- **Why:** The refusal messages of two live Cardano dApps vanished within 6 s, which a judge glancing away misses; Liqwid's message says what happened, then what to do [FD18-F07]. NN/g: human-readable errors, codes for diagnostics only, constructive advice, no blame, modals for severe errors [FD18-F19]. WCAG 3.3.1 and 3.3.3 want errors in text with suggestions [FD18-F18].
- **Check:** critic (hook: a mock refusal `{code:-3}` shows text within 1 s that is still visible 10 s later [FD18 Checker hooks])
- **Not when:** never.

### WS-05 - Check the network at connect and after every account change
- **Rule:** At connect and after every AccountChange (-4): `getNetworkId()` must equal the app's network id; if `getExtensions()` includes 142, compare the network magic (764824073 mainnet, 1 preprod, 2 preview); otherwise treat preprod and preview as indistinguishable from the wallet's answers. On a mismatch show the blocking C4 panel, which names both networks and the fix, with every action disabled. Never surface a connector's developer error text.
- **Why:** `getNetworkId()` returns 0 for every testnet; CIP-142 is only Proposed and missing from the accepted-extensions register; the portal's own fix wording is "switch the network to Preprod or Preview in settings" [FD18-F02].
- **Check:** critic
- **Not when:** never.

### WS-06 - Request extensions, then trust only what the wallet enabled
- **Rule:** Request extensions in `enable({ extensions })` and read only `getExtensions()`. Request CIP-95 when the transaction carries Conway governance content (certificates, votes, proposals, DRep keys); when 95 is missing, show "this wallet can't sign this kind of transaction yet". Do not block a plain Plutus V3 spend on a missing 95.
- **Why:** Wallets are not expected to fail on an unsupported extension and report their choice through `getExtensions()`; CIP-95's text never mentions Plutus; with 95 enabled, `api.signTx()` is CIP-95's version [FD18-F03].
- **Check:** critic
- **Not when:** the transaction carries no Conway content.

### WS-07 - Show a review screen before every signature
- **Rule:** Before every signature, show the review state T0: the action, the amount with its unit, the full recipient address, the fee estimate, the network and what happens next. Never truncate anything inside it.
- **Why:** WCAG 3.3.4 requires financial transactions to be reversible, checked or confirmed, and the wallet popup alone cannot be counted on [FD18-F18]. The full address belongs wherever the user decides [FD18-F23].
- **Check:** critic
- **Not when:** never.

### WS-08 - Give each wait the feedback its length needs
- **Rule:** Show the press state and disable the button within 0.1 s of the first click; a second click must not cause a second `signTx`. Reads show a skeleton first and a spinner only after 500 ms, kept at least 200 ms. A wait on a person (a wallet window, a device) adds help at 10 s. A wait on a block shows a step indicator with an expected time, never a percentage and never a bare spinner, and offers a way out: "You can close this; tracking continues."
- **Why:** Nielsen's 0.1 s and 10 s limits, spin-delay's 500/200 ms defaults, and missing feedback causing "double orders" [FD18-F15]. A double-clicked submit produces `BadInputsUTxO` [FD18-F16]. Inclusion time is not predictable [FD18-F14].
- **Check:** critic (hook: the action button is disabled within 100 ms and a second click causes no second `signTx` [FD18 Checker hooks])
- **Not when:** BSC, where a 500 ms spinner will rarely appear: go from sent to recorded (WS-09).

### WS-09 - Use the measured times in pending copy
- **Rule:** Cardano: say "usually about 20 seconds", switch to "taking longer than usual" at about 60 s, show the expiry derived from the TTL, and keep polling until the validity window ends. Call a transaction final only at 10 or more confirmations. BSC: go straight from sent to recorded, with a slow path for the 79 to 108 s fallback finality. In a 3-minute video, cut the wait but keep the step indicator honest.
- **Why:** Over 1,000 blocks, preprod intervals had a mean of 22.7 s, a p90 of 51 s and a p99 of 111 s; the developer portal reports 10-20 confirmations as common practice for strong finality; BSC runs 0.45 s blocks with about 1.125 s finality [FD18-F14].
- **Check:** critic
- **Not when:** other chains: no measured times in the research, so do not reuse these.

### WS-10 - Never read "not found" as "failed"
- **Rule:** "Pending" means the transaction id is known and the confirmation count is null. Never infer failure from not-found. After an uncertain submit, poll by transaction id (T6) before offering anything; never offer a blind "Try again". Count confirmations from the app's own indexer, never from an explorer page.
- **Why:** Koios answers an unknown hash with HTTP 200 and a null; Cexplorer showed 0 confirmations for a transaction Koios counted at 153 [FD18-F17]. Ledger Wallet's copy for an uncertain broadcast tells the user to check the history before trying again [FD18-F12].
- **Check:** critic (hook: confirmation counts come from the indexer [FD18 Checker hooks])
- **Not when:** never.

### WS-11 - Name dropped, replaced and failed the way each chain means them
- **Rule:** Cardano: no "Speed up" or "Cancel"; classify "dropped" only when the TTL has passed and the transaction is not on chain; a rebuild says "you'll need to approve again"; a resubmit answered by `BadInputsUTxO` goes to "checking", then to the on-chain status; "failed on chain" names the collateral cost. EVM: follow the replacement hash reported by `onReplaced`.
- **Why:** A Cardano node silently drops stale transactions, `BadInputsUTxO` after a resubmission "can simply mean it succeeded", and only a phase-2 failure costs collateral; viem reports repriced, cancelled and replaced transactions [FD18-F16].
- **Check:** critic
- **Not when:** never.

### WS-12 - Announce state changes in one status region per panel
- **Rule:** Each transaction panel has exactly one persistent `role="status"` region that carries every state change. Use `role="alert"` only for blocking states (wrong network, not accepted, expired, failed). Do not move focus on progress updates.
- **Why:** WCAG 4.1.3 exposes status messages without focus; WAI-ARIA `status` is polite and atomic, `alert` is for important, time-sensitive information [FD18-F18].
- **Check:** critic (hook: one live region changes text across the scripted flow, idle to recorded [FD18 Checker hooks])
- **Not when:** never.

### WS-13 - Never show a false "nothing"
- **Rule:** Render no zero balance and no "nothing yet" message until the query has succeeded. On a read failure keep the last good data with its as-of time and retry with backoff (R1). Show the empty state E1 only after a successful load, with the first action to take.
- **Why:** NN/g: totally empty states confuse, and a "No records" message shown before loading finishes is "particularly harmful" [FD18-F19].
- **Check:** critic
- **Not when:** never.

### WS-14 - Show addresses so a lookalike cannot pass
- **Rule:** Encode CIP-30 hex addresses to bech32 with a length limit above 90, or with the SDK's helper. On review, verify and confirm screens and in the Ledger mirror, show the full address. Elsewhere show the prefix plus at least 8 leading and 8 trailing data characters, with the full value in `title` and in the accessible name. A copy button copies the full value and announces "Copied" in the status region, with a select-to-copy fallback when the clipboard throws. Never pre-fill a recipient from history. For assets show name, ticker and fingerprint, with the policy id on demand, and never use the fingerprint as a unique key.
- **Why:** CIP-30 returns hex; the `bech32` package defaults to 90 characters while a mainnet base address runs to 103; CIP-14 fingerprints can collide [FD18-F22]. Address poisoning counted 270M attempts and at least 83.8M USD lost, with lookalikes matching up to 20 hex digits, so 8...8 only lowers risk where the user does not decide [FD18-F23].
- **Check:** critic (hook: no address shorter than prefix+8...8 outside review states, none truncated inside them [FD18-F23])
- **Not when:** never.

### WS-15 - Resolve handles, then resolve again on submit
- **Rule:** Accept a `$name` recipient, strip the `$` before resolving, resolve through the Handle API or on chain (official policy plus hex name, CIP-68 prefix for new handles), show the resolved address (full on review), resolve again on submit, and ignore an empty handle. On preprod use `https://preprod.api.handle.me` and the `f0ff48bb...` policy.
- **Why:** The `$` is display-only, Kora Labs points to its API, and its best-practice page says to re-fetch on submit and never allow an empty string [FD18-F24].
- **Check:** critic
- **Not when:** the flow has no recipient input.

### WS-16 - Format amounts from integers or decimal strings only
- **Rule:** Keep amounts as BigInt or as the provider's decimal strings and format them with ``new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(`${units}E-${decimals}`)``. Never apply `Number()` or `parseFloat` to an amount. Take decimals from CIP-68 or CIP-26 metadata; with no decimals metadata, show integer units labelled "units (no decimals metadata)". Set amount columns in tabular figures. Compare formatted output through `Intl`, never against literals.
- **Why:** 1 ADA is 1,000,000 lovelace and the maximum supply is 5 times `Number.MAX_SAFE_INTEGER`; in the measurement the `Number` path lost digits while the string path stayed exact [FD18-F25].
- **Check:** `rg -n "parseFloat\(|Number\(" <ui>/src`, then review each hit on an amount path [FD18 Checker hooks]
- **Not when:** never.

### WS-17 - Make test values look like test values
- **Rule:** On any non-mainnet network, show a persistent network badge in the header of every screen, use the test unit (tADA, tBNB), never show a fiat amount or currency sign next to a test value, and say "test ADA (no real value)" at first mention. Mark figures `data-source="testnet"` with `data-as-of`.
- **Why:** The portal says test ADA "has no value"; the chain registry names BSC testnet's currency tBNB; Cexplorer prints a dollar value next to test ADA, the confusion to avoid [FD18-F26]. Label testnet data and time-stamp it [FD20-F21].
- **Check:** coverage.metrics for the markers; critic for the badge and fiat (hook in [FD18 Checker hooks])
- **Not when:** never.

### WS-18 - Build explorer links from one config and verify them by existence
- **Rule:** Keep one explorer config per network, set from the same network value the provider uses, and derive every link from the templates below; assets use the unit form (policy id plus hex asset name). Link a transaction only once the app's indexer sees it, or label the link "may take a moment to appear". Offer explorer.cardano.org as the neutral chooser, or state which explorer the app uses. To verify a link: check existence through an indexer (Koios `tx_status` or `tx_info`, or `eth_getTransactionReceipt`), then the URL against the template, then render only where a marker exists. Cexplorer: wait up to 15 s, pass on " - Content" in the title or "Transaction Overview" in the body, fail on "This page doesn't exist", report a timeout or a 503 page as not rendered. Etherscan: fail on "Transaction Hash not found". Report Cardanoscan and BscScan links as "pattern-checked, not rendered (Cloudflare)". Never use the HTTP status.
- **Why:** EIP-3091 routes on EVM and the Cardano Foundation resolver's templates [FD18-F20]. Cexplorer serves the same 200 shell for real and fake hashes and shows its not-found text 3 to 10 s later; Etherscan answers 200 with "not found"; Cardanoscan and BscScan answer 403 Cloudflare challenges even to headless Chromium [FD18-F21]. Indexers lag [FD18-F17]. One dApp's explorer setting does not show users expect a choice [FD18-F07].
- **Check:** critic (hook: links match the templates and their ids exist per the indexer [FD18 Checker hooks])
- **Not when:** never.

### WS-19 - Pin the wallet and Ledger packages
- **Rule:** Install the exact versions of the library table below and re-query the npm registry on the day before installing. Never install `@meshsdk/react` or `@meshsdk/wallet` unpinned. Pin `rxjs` at 7.8.2 next to the DMK.
- **Why:** Mesh's `latest` tags install betas that pin a different wallet package from `@meshsdk/core` 1.9.1, and registry metadata can change within hours [FD18-F04]. The DMK and its transports peer `rxjs` 7.8.2 exactly [FD18-F08].
- **Check:** `pnpm ls --depth 0`, compared with the library table [FD18 Library choices]
- **Not when:** never.

### WS-20 - Drive a Ledger from the DMK's observable states
- **Rule:** Initialise the DMK once, as a singleton, and make no DMK call at module load. Subscribe to each device action's observable; never await a promise wrapper. Write an exhaustive `switch` on `requiredUserInteraction` that maps every value of the installed version to one short instruction mirroring the device, with a `never` default. Show two rejection states, "cancelled in the wallet window" and "rejected on the device", both ending "Nothing was sent." Map raw device messages to plain copy. On `disconnected`, offer reconnect through `dmk.reconnect()`. Use the Speculos transport in development and for recordings without a device.
- **Why:** LedgerJS is deprecated, the DMK should be initialised only once, and Speculos emulates the device [FD18-F08]. The promise wrapper "discards intermediate states"; the published DMK has 18 interaction values; Ledger's own examples use a `never` default; 0x6985 and 0x5501 mean refused on the device, EIP-1193 4001 declined in the UI [FD18-F09].
- **Check:** critic (hook: the switch has a `never` default and no DMK call runs at module load [FD18 Checker hooks])
- **Not when:** the project uses no Ledger.

### WS-21 - Gate WebHID on the browser and a click
- **Rule:** Feature-detect `navigator.hid`. Without it, show "Use Chrome or Edge on a computer to connect a Ledger", or a per-wallet "Chromium only" badge, never a dead button. Make "Connect Ledger" a click handler that calls discovery synchronously, with no auto-connect on load and no discovery behind an `await` chain. Serve over HTTPS or localhost. Present a Ledger finals demo from desktop Chrome or Edge.
- **Why:** WebHID is listed for desktop Chromium only, needs a secure context and transient user activation, and the DMK docs require discovery from a user gesture [FD18-F10]. Minswap badges desktop wallets "Chromium only" [FD18-F27].
- **Check:** critic (hook: "Connect Ledger" is a click handler [FD18 Checker hooks])
- **Not when:** the project uses no Ledger.

### WS-22 - Mirror the device in the page while it signs
- **Rule:** While the device is in `sign-transaction`, show a mirror panel in large type with the device's values in the device's order: Review and the intent, then From, Amount, To and Fees, then Hold to sign, with the full recipient address. Label it with a clear-signing badge, or with a blind-signing warning: "Your Ledger can't show the details of this contract call and will display a warning." Drive it from `intermediateValue.requiredUserInteraction` and `step`.
- **Why:** Ledger's device rules: the intent first, the fields in a standard order, "Hold to sign" for 2 s, full addresses on verification; wallets must "Tell users whether Clear Signing is active", and with no ERC-7730 descriptor the signer falls back to blind signing, which a hackathon contract will not escape within the event [FD18-F11]. On camera or a projector the device screen is invisible [FD20-F22].
- **Check:** recording.g15 when the profile has a video; critic otherwise.
- **Not when:** the project uses no Ledger.

### WS-23 - Name Ledger in words only
- **Rule:** Name the device in plain text in instructions ("Connect a Ledger signer", "Confirm on your Ledger"). No Ledger logo, device render or Ledger-styled wordmark, and no "Ledger" in the app's name, `<title>` or favicon. No "official", "approved" or "partner" claim. Use current names: Ledger Wallet (formerly Ledger Live), signer. A device illustration, if one is needed, is a neutral generic shape.
- **Why:** Ledger's website terms reserve its names and logos, while its own docs expect "Confirm on your Ledger" in third-party UIs [FD18-F13]. Ledger is renaming the app to Ledger Wallet and the hardware wallet to "signer" [FD21-F18].
- **Check:** ip.logos, ip.sponsor-marks
- **Not when:** the team holds partner keys for the Ledger Wallet Provider SDK, which draws Ledger's own UI [FD21-F19] (`15-ip-provenance.md`).

### WS-24 - Choose the Cardano-plus-Ledger path in the plan
- **Rule:** For a Cardano project with a Ledger, pick one path and say it on screen. Path 1: the user's CIP-30 wallet paired with the device; the dApp sees only CIP-30 and can only hint "If your wallet uses a Ledger, confirm on the device." Path 2: the dApp drives the device itself, through `@cardano-foundation/ledgerjs-hw-app-cardano` over a LedgerJS transport or raw APDUs through the DMK, and shows the mirror panel (WS-22). Test path 2 with a real device before any recording.
- **Why:** No DMK signer kit exists for Cardano among the 12 Ledger publishes [FD18-F08]. Minswap connects a Ledger directly over USB or Bluetooth, apparently through the LedgerJS-style binding [FD18-F27].
- **Check:** owner review of the path choice; critic for the screens.
- **Not when:** the project uses no Ledger.

## State catalogue
Copy is proposed wording [FD18 UI state catalogue]; fill every brace from real data. Timings from [FD18-F14, FD18-F15].

| id | state | enters on | screen shows | copy pattern | a11y | timing |
|---|---|---|---|---|---|---|
| C0 | No wallet found | no CIP-30 key in `window.cardano`; Ledger: no `navigator.hid` | supported wallets with Install; one line on what a wallet is | "No Cardano wallet in this browser. Install {wallet} or {wallet}, then reload." Ledger: "Connecting a Ledger needs Chrome or Edge on a computer." | text in the dialog body, not a toast | at open, no spinner |
| C1 | Disconnected | no enabled wallet | Connect wallet; network badge | "Connect wallet"; badge "{Network}: test network" | badge is text, not colour only | - |
| C2 | Waiting for consent | `enable()` pending | the row shows Waiting; Cancel | "Approve the connection in the {wallet} window." After 10 s: "Can't see it? Click the {wallet} icon in your browser's toolbar." | `role="status"`; focus stays in the dialog | press 0.1 s; help at 10 s |
| C3 | Connection declined | APIError -3, or `enable()` rejects | inline message on the wallet row; Retry | "{wallet} didn't connect: the request was declined or closed. Try again when you're ready." Code in Details | inline text, not a modal | until the next action |
| C4 | Wrong network | network id, CIP-142 magic or address prefix mismatch | blocking panel; actions disabled | "Your wallet is on {network}. This demo uses {network}, the {chain} test network (no real money). Switch the network in your wallet's settings, then reconnect." (FD18's draft used the possessive, which the Cardano trademark policy forbids [FD21-F05]) | `role="alert"` | at connect and after -4 |
| C5 | Connected | `enable()` resolved, network OK | wallet name, short address or handle, network badge and test-unit balance as separate elements | - | accessible name contains the visible text | - |
| C6 | Account changed | APIError -4 on any call | silent re-`enable()`, refreshed data, one-line notice | "Wallet account changed. Updated." | `role="status"` | immediate |
| L1 | Ledger: connect | click calls `startDiscovering` | browser device picker; instructions | "Plug in your Ledger and unlock it with your PIN." | the button calls discovery directly | - |
| L2 | Ledger: needs action | `pending` with `unlock-device`, `confirm-open-app` or `allow-secure-connection`; session `locked` or `busy` | large mirror of the device instruction, no logo | "Unlock your Ledger." / "Open the {app} app on your Ledger." / "Allow the connection on your Ledger." | `role="status"`; large type | unbounded; help at 10 s |
| T0 | Review | the user pressed the action | action, amount with unit, full recipient, fee, network, what happens next | "You're about to {action} {amount} {unit}. Network fee about {fee} {unit}. Your wallet will ask you to approve." | WCAG 3.3.4; headings; full address | - |
| T1 | Approval (browser wallet) | `signTx` pending | step 1 of a stepper; what to check; Stop waiting | "Approve in {wallet}. It should show {amount} {unit} going to {address}." | `role="status"` | no CIP-30 timeout; help at 10 s |
| T1L | Approval (Ledger) | `pending` with `sign-transaction`, or the direct Cardano path | mirror panel (WS-22) with clear-signing badge or blind-signing warning | "Check the details on your Ledger, then hold to sign." | `role="status"`; announce step changes | device hold 2 s |
| T2 | Cancelled in wallet | TxSignError 2; EIP-1193 4001 | back to Review with a note | "You cancelled in {wallet}. Nothing was sent." | status, not alert | persists |
| T2L | Rejected on device | 0x6985, 0x5501, `RefusedByUserDAError` | back to Review with a note | "You rejected it on your Ledger. Nothing was sent." | status | persists |
| T3 | Can't sign | TxSignError 1 or 3 | error with the fix | "This account can't sign for these funds. Switch to the account that holds them." | `role="alert"` | - |
| T4 | Sending | submit or broadcast pending | step 2 | "Sending to {chain}..." | `role="status"` | spinner after 500 ms, min 200 ms |
| T5 | Not accepted | TxSendError 1 or 2; `BadInputsUTxO`, `OutsideValidityIntervalUTxO`, mempool full | one-sentence reason and one action: retry (transient) or rebuild (new approval) | "{chain} didn't accept it: one of the coins it spends was already used. We'll prepare a new one; you'll approve again." | `role="alert"` | backoff for transient failures |
| T6 | Outcome unknown | timeout or network error after submit | Checking, polling by id; no blind resend | "We couldn't confirm it was sent. Checking the network before doing anything else..." | `role="status"` | resend the same bytes only while the TTL is open |
| T7 | Pending | id known; confirmations null | step 3 with expected time; id with copy; explorer link pending | "Sent. Waiting for Cardano to record it (usually about 20 seconds)." After 60 s: "Taking longer than usual. It will expire at {time} if not recorded." | `role="status"`; never spinner-only | Cardano mean about 20 s, p90 51 s on preprod; BSC under 1 s |
| T8 | Recorded | 1+ confirmation from the app's indexer; EVM receipt status 1 | step 4 done; block; live explorer link; count | "Recorded on {chain} in block {block} ({n} confirmation)." | `role="status"` | - |
| T9 | Final | Cardano 10+ confirmations; BSC fast finality | Final badge | "Final: {n} confirmations." | `role="status"` | Cardano a few minutes; BSC about 1.1 s |
| T10 | Expired (Cardano) | current slot past `invalid_hereafter`, not on chain | explanation; Prepare again | "This transaction expired before Cardano recorded it. No funds moved." | `role="alert"` | at the TTL |
| T10E | Replaced (EVM) | viem `onReplaced`: replaced, repriced, cancelled | follow the new hash | "Your wallet sped it up; following the new transaction." / "Cancelled in your wallet. No funds moved." | `role="status"` | - |
| T11 | Failed on chain | Cardano phase-2 failure; EVM receipt status 0 | cause and cost | "The contract rejected this transaction. {collateral} {unit} of collateral paid the network's fee for checking it." | `role="alert"` | - |
| R1 | Data unavailable | RPC or indexer error or timeout | last good data with as-of; Retry; never 0 or "none" | "Can't reach {chain} data right now. Showing values from {time}. Retrying..." | `role="status"` | exponential backoff (viem HTTP: 3 retries, 150 ms base) |
| R2 | Loading | query pending | skeleton in the layout; spinner only after 500 ms | - | `aria-busy` on the region | 500 ms / 200 ms |
| E1 | Empty | query succeeded with nothing | explanation and the first action | "No {items} yet. {First action} to see it here." | - | only after a successful load |

## Timing constants [FD18 Timing constants]

| constant | value |
|---|---|
| press feedback | 0.1 s or less |
| spinner show-delay / minimum | 500 ms / 200 ms |
| help while waiting on a person | 10 s |
| Cardano expected block | about 20 s |
| Cardano "taking longer" | about 60 s (measured p90: preprod 51 s, mainnet 46 s) |
| Cardano worst interval seen (1,000 blocks) | 162 s preprod, 149 s mainnet |
| Cardano strong finality | 10-20 confirmations, "a few minutes" (common practice per the portal) |
| Cardano rollback bound | k = 2160 blocks, about 12 h (preview 432) |
| BSC block / finality | 0.45 s / about 1.125 s (fallback 79.2-108 s) |
| Etherscan indexing advice | wait at least 30 s before refreshing; escalate after 1 h |
| viem receipt wait | timeout 180 s, 6 retries when the transaction or block is not found |
| viem HTTP request retries | 3 retries, 150 ms base, exponential |
| Cexplorer render wait before judging a link | up to 15 s |
| Ledger hold to sign | 2 s |

## Library choices, pinned 2026-10-01 [FD18 Library choices]

| use | package at version | licence | note |
|---|---|---|---|
| Cardano connect UI | none: own dialog on raw CIP-30 | - | WS-02 |
| wallet registry and deep links (optional) | `@cardano-foundation/cardano-connect-with-wallet-core@0.2.12` | Apache-2.0 | framework-free; skip the React package's defaults |
| Cardano transaction building (pick one) | `@lucid-evolution/lucid@0.6.5` or `@meshsdk/core@1.9.1` | MIT / Apache-2.0 | Plutus V3 support not verified |
| Mesh React (only if required) | the whole set at `1.8.14` (core, wallet, common, react) | Apache-2.0 | `latest` is a beta with another wallet dependency |
| hex to bech32 | `bech32@2.0.0` with a limit above 90, or the SDK helper | MIT | 90-character default |
| mobile QR connection (CIP-45) | `@fabianbormann/cardano-peer-connect@1.2.21` | Apache-2.0 | only if mobile wallets must connect |
| Cardano data | Koios REST (public, no key) | - | `tx_status` returns null while pending |
| Ledger core | `@ledgerhq/device-management-kit@1.10.0` + `rxjs@7.8.2` | Apache-2.0 | exact `rxjs` peer |
| Ledger transport | `@ledgerhq/device-transport-kit-web-hid@1.2.4` (dev: `@ledgerhq/device-transport-kit-speculos@1.2.1`) | Apache-2.0 | desktop Chromium only |
| Ledger EVM signing | `@ledgerhq/device-signer-kit-ethereum@1.18.1` + `@ledgerhq/context-module@2.6.0` | Apache-2.0 | clear signing and Transaction Check need a partner-programme `originToken` |
| Ledger's own connect flow (partner config only) | `@ledgerhq/ledger-wallet-provider@1.4.3` | repository Apache-2.0 | its v2 family packages peer the DMK at exactly 1.9.0, which conflicts with a 1.10.0 pin |
| Cardano Ledger app binding | `@cardano-foundation/ledgerjs-hw-app-cardano@8.0.0` | Apache-2.0 | LedgerJS-style; no DMK kit exists |
| EVM | `viem@2.57.1`, `wagmi@3.7.7` | MIT | - |
| spinner delay | `spin-delay@2.0.1`, or its logic | MIT | 500/200 ms defaults |

## Explorer URL templates [FD18 Explorer URL templates]

| network, explorer | transaction | address | asset or token | policy |
|---|---|---|---|---|
| Cardano mainnet, Cexplorer | `https://cexplorer.io/tx/{hash}` | `/address/{bech32}` | `/asset/{policyId}{assetNameHex}` | `/policy/{policyId}` (observed on preprod) |
| Cardano preprod, Cexplorer | `https://preprod.cexplorer.io/tx/{hash}` | same pattern | same pattern | same pattern |
| Cardano mainnet, Cardanoscan | `https://cardanoscan.io/transaction/{hash}` | `/address/{bech32}` | `/token/{policyId}{assetNameHex}` | unverified |
| Cardano preprod, Cardanoscan | `https://preprod.cardanoscan.io/transaction/{hash}` | same pattern | same pattern | unverified |
| Cardano, neutral chooser | `https://explorer.cardano.org/[preprod/]tx/{hash}` | `/[preprod/]address/{bech32}` | `/[preprod/]asset/{policyId}{assetNameHex}` | not supported |
| BSC mainnet / testnet | `https://bscscan.com/tx/{hash}` / `https://testnet.bscscan.com/tx/{hash}` | `/address/{0x...}` | `/token/{0x...}` | - |
| Ethereum / Sepolia | `https://etherscan.io/tx/{hash}` / `https://sepolia.etherscan.io/tx/{hash}` | `/address/{0x...}` | `/token/{0x...}` | - |

## Checker hooks [FD18 Checker hooks]
Deterministic checks FD18 specifies; none has a gate id in CONTRACTS 4 yet (see Gaps).

| hook | rule |
|---|---|
| built output carries none of the prebuilt connect kits' default strings (scan first-party source and chunks with a wallet-kit marker; other hits are candidates) | WS-02 (registry rule SL-G03) |
| exactly one live region per transaction panel changes text across the scripted flow, idle to recorded | WS-12 |
| a mock refusal `{code:-3}` produces visible text within 1 s that is still visible 10 s later | WS-04 |
| the action button is disabled within 100 ms; a second click causes no second `signTx` | WS-08 |
| no `parseFloat(` or `Number(` on amount fields; formatting goes through `Intl.NumberFormat` | WS-16 |
| on a testnet build, a network badge on every screen and no currency amount next to a test value | WS-17 |
| explorer links match the templates for the configured network and their ids exist per the indexer; confirmation counts come from the indexer | WS-18, WS-10 |
| the `requiredUserInteraction` switch has a `never` default; "Connect Ledger" is a click handler; no DMK call at module load | WS-20, WS-21 |

## Procedure
1. Read the profile's chain, network and sponsors, and the judge's path; list the catalogue states the path passes through, and add them to `design/routes.json` `states` so record mode can show each one.
2. Install the pinned packages (WS-19).
3. Build the state machine (WS-01) with every state, failure states included, before any styling pass.
4. Drive the flow with a CIP-30 mock that refuses with `{code:-3}` and one that accepts, as FD18 did; walk the hooks of WS-04, WS-08 and WS-12 [FD18 Checker hooks].
5. For a Ledger: build against Speculos first, then test on a real device before any recording (WS-20, WS-24).
6. Check every explorer link (WS-18) and the testnet labelling (WS-17), then run the proof with `--phase {mode}` (`build` in full mode, `small` in small mode; `10-gates.md`).

## Gaps
- CONTRACTS section 4 has no gate group for the FD18 checker hooks (the registry's `web3` family holds no rule yet), so most Check lines here say critic. Implementing those hooks as gates is open work.
- Real wallets and devices were never exercised: CIP-142 and CIP-95 support, Plutus V3 signing without CIP-95, Ledger flows and Minswap's direct path rest on specs, source and a mock [FD18 Weak spots].
- The 8...8 truncation, the 60 s "taking longer" threshold, the mirror panel and every proposed copy line are FD18's derivations, not measured rules [FD18 Weak spots].
- Telling preprod from preview without CIP-142 has only an untested heuristic (look up one input of `getUtxos()` in the app's preprod indexer) [FD18-F02].
- Ethereum block time and finality, and any Cardano analogue of ERC-7730 clear signing, were not researched [FD18 What could not be found].
- Whether a 103-character address in the accessible name reads well aloud was not tested; an alternative is "Address ending {last 6}" plus a copy action [FD18-F22].
- Explorer render outcomes depend on Cloudflare heuristics for this IP and user agent [FD18-F21].
