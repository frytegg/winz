# Solidity and Web3 hardening beyond linters: manual audit checklist, invariant testing, severity rubrics and off-chain signer hygiene
> Code G207 · slug web3-audit-practice · verified 2026-09-23 · counts: verified 10 / corrected 13 / downgraded 1 / dropped 0

**How this was checked.** The WebSearch budget for this session was already used up, so every cited URL was opened directly. HTML pages were read with WebFetch, or downloaded with curl and searched as text when the quote had to be exact. That covers OWASP SC Top 10 2026, EthTrust v3, the rekt.news postmortems, Sherlock, Code4rena, Immunefi, Halborn, Chainalysis, OpenZeppelin, Chainlink, Uniswap and SEAL.

The PDFs were downloaded and searched with pypdf:
- Chaliasos et al., ICSE '24.
- Grieco et al., ISSTA '20.
- The Web3Bugs ICSE '23 paper. The researcher could not reach it; it is linked from the repo README and was retrieved from the author's site.

Primary files were read directly:
- The Slither wiki, from its raw markdown.
- ERC-1967, ERC-7201 and ERC-2535, from the ethereum/ERCs repo.
- The Cyfrin checklist JSON.
- The Halmos docs.

Trace2Inv's venue was resolved through Crossref. Its arXiv DOI field is truncated, but the real DOI is 10.1145/3660786.

Binance blocks curl, so its FAQ was read only through WebFetch. The Kraken page is served in French.

## Summary

Scope: EVM smart-contract hardening beyond what linters catch. That covers the manual review order, invariant and property testing, when to escalate to formal methods, how to grade findings, and the off-chain side (signing keys, RPC trust, nonces, exchange API keys, multisig operations). Contract fixes to deployed code are almost always report-only or need an upgrade, so run the proxy check in F09 before any storage-affecting edit. Every source was re-opened for this verification. Forum voice (HN, Reddit, Ethereum StackExchange) is missing: HN returned HTTP 429, the other two were blocked, and WebSearch was exhausted.

**Versions confirmed on the pages themselves:**
- OWASP Smart Contract Top 10: 2026. It is based on "122 smart-contract incidents (deduplicated)" and "≈ $905.4M in 2025 smart-contract involved losses only".
- EEA EthTrust Security Levels v3, "EEA Specification March 2025". In v3, [Q] Protect against Front-Running was renamed [Q] Protect against Ordering Attacks.
- Immunefi Vulnerability Severity Classification System v2.3. The page carries no date.
- The current Sherlock judging guidelines, Code4rena severity categorization and CodeHawks matrix.
- Foundry config reference: invariant runs=256, depth=500, fail_on_revert=false, shrink_run_limit=5000, show_metrics=true.
- OpenZeppelin Contracts 5.x. Its ECDSA malleability rejection is marked "DEPRECATED and will be removed in v6.0".
- OpenZeppelin Relayer, stable v1.5.x. The signer page read is the unreleased main-branch doc.
- Medusa v1 (Trail of Bits, Feb 2025). Echidna is now in maintenance for minor bug fixes.
- Chainalysis (Dec 2024 report on 2024; mid-2025 update) and Halborn's Top 100 DeFi Hacks Report 2025, which covers 2014–2024 with a 2024 section.

**Core evidence (re-checked):**
- **Tools alone are not enough.** Chaliasos et al. (ICSE '24) tested 5 tools: Solhint, Slither, Mythril, ConFuzzius and Oyente. They could have prevented "a mere 8%" of 127 real attacks ($149M of $2.3B), all of them reentrancy.
  - The two largest root causes were "Absence of coding logic or sanity check" (42 attacks) and "On-chain oracle manipulation" (29). The paper states that current automated tools cannot detect either.
  - Zhang et al. (ICSE '23, Web3Bugs) report that "More than 80% exploitable bugs are beyond existing tools". Their Fig. 2 gives 79.5% for both datasets: 271 of 341 Code4rena bugs and 35 of 44 real exploits, i.e. 306 of the 385 in-scope bugs, not of all 516 studied. The researcher had left this figure unverified; it is now confirmed from the paper.
- **Hand-written properties change the picture.**
  - Trail of Bits (2019): "almost 78% of the most important findings" were potentially detectable by static plus dynamic analysis, and "almost 49%" of all findings are nearly impossible for tools.
  - The Echidna paper (ISSTA '20) cites "up to 63%" of the most severe flaws for user-defined properties.
  - Trace2Inv (FSE 2024, peer-reviewed, not a preprint as the researcher thought) blocked 18 of 27 exploits with one invariant guard, and up to 23 of 27 with combined guards.
- **Much of the risk is off-chain.**
  - Chainalysis: "Private key compromises accounted for the largest share of stolen crypto in 2024, at 43.8%."
  - Halborn: "Off-chain incidents now account for 56.5% of attacks and 80.5% of funds lost in 2024".
  - Halborn's audit and multisig percentages (20% audited, 10.8% of value, 19% multisig) describe the top-100 hacks of 2014–2024, not 2024 alone. The researcher had them scoped to 2024.
- **Contest rubrics push these risks aside.**
  - Code4rena files centralisation findings as QA.
  - Sherlock assumes admin functions are "used correctly".
  - Immunefi's default out-of-scope list includes "Impacts involving centralization risks" and "attacks requiring access to leaked keys/credentials".

**Deliverables (unchanged in structure):**
- An ordered manual checklist. F02 gives the order; the items are F03–F11, F14, F15 and F23, mapped to OWASP SC01–SC10 (2026) and to EthTrust v3 requirement names, now checked against the spec text.
- An invariant-testing recipe (F12) and rules for escalating to formal methods (F13).
- A severity mapping (F16), downgraded to grade C: the combination is a synthesis, and Sherlock explicitly ignores likelihood.
- Off-chain signer, RPC, nonce and exchange-key rules (F17–F22).
- Process rules (F01, F24).

## Findings

### G207-F01 — Analyzer output is a baseline, never evidence of hardening
- **Grade:** A · **Verdict:** CORRECTED (the Web3Bugs figure is now verified from the paper: ">80%" in the text, 79.5% in Fig. 2; the 38.1% survey figure clarified; the unverifiable "attacks 2018–2022" range replaced with the dataset's real provenance; SEAL added as corroboration) (audit correction: the Web3Bugs ~80% is of the 385 in-scope bugs, 271/341 Code4rena and 35/44 exploits, i.e. 306 of 385, not 80% of all 516 studied.)
- **Rule:** Never declare a Solidity or Vyper codebase "hardened" because static analyzers (Slither, Aderyn, Mythril and similar) came back clean. Run them as a baseline. Then run the ordered manual checklist (F02) and property-based tests (F12), and record for each checklist item: checked, not applicable, or finding.
- **Rationale:** Across three independent datasets, tools catch only a minority of exploitable bugs:
  - Chaliasos: 8% of 127 high-impact attacks, all reentrancy.
  - Zhang et al.: 79.5% of in-scope exploitable bugs were beyond existing tools: 271 of 341 Code4rena bugs and 35 of 44 real-world exploits (306 of 385), not 80% of all 516 bugs studied.
  - Trail of Bits: about 49% of audit findings could not realistically be found by tools.
  
  The largest loss classes are missing logic or sanity checks and oracle manipulation, which tools do not model. Most auditors in the Chaliasos survey (76%) spend at most 20% of audit time on tools.
- **Evidence:**
  - [Smart Contract and DeFi Security Tools: Do They Meet the Needs of Practitioners?](https://arxiv.org/abs/2304.02981) — Chaliasos, Charalambous, Zhou, Galanopoulou, Gervais, Mitropoulos, Livshits, 2024 (ICSE '24, DOI 10.1145/3597503.3623302) — peer_reviewed.
    - Quotes: "the tools could have prevented a mere 8% of the attacks in our dataset, amounting to $149 million out of the $2.3 billion in losses. Notably, all preventable attacks were related to reentrancy vulnerabilities." Fig. 2: Absence of coding logic or sanity check 42, On-chain oracle manipulation 29, Reentrancy 13. "52.4% rating them as 4 or 5 on a 5-point scale … (38.1%) did not find security tools to be helpful or found them only somewhat helpful (rated 1-2)". "The majority of auditors (76%) reported using security tools for up to 20% of their audit time."
    - Verified in the arXiv PDF (v2).
    - Tools evaluated: Solhint, Slither, Mythril, ConFuzzius, Oyente.
    - Dataset: filtered from Zhou et al.'s SoK of 181 DeFi attacks. 11 of the 32 in-scope attacks were preventable.
  - [Demystifying Exploitable Bugs in Smart Contracts (ICSE '23)](https://zhangzhuosjtu.github.io/res/ICSE23.pdf) ([repo README](https://github.com/ZhangZhuoSJTU/Web3Bugs)) — Zhuo Zhang, Brian Zhang, Wen Xu, Zhiqiang Lin, 2023 — peer_reviewed.
    - Quotes: "More than 80% exploitable bugs are beyond existing tools (we call them machine unauditable bugs (MUBs))"; Fig. 2: 271 (79.5%) of 341 Code4rena bugs and 35 (79.5%) of 44 real-world exploits are machine-unauditable. The dataset has 516 bugs from 2021–2022: 462 from Code4rena and 54 exploits. Fig. 2 counts only the in-scope bugs (341 + 44 = 385), so the 79.5% is 306 of 385, not a share of all 516; the paper's own "More than 80%" headline is equally loose (citation audit).
    - Paper PDF read. The README says "a significant number of exploitable bugs … fall under the category of functional bugs".
  - [246 Findings From Our Smart Contract Audits: An Executive Summary](https://blog.trailofbits.com/2019/08/08/246-findings-from-our-smart-contract-audits-an-executive-summary/) — Trail of Bits, 2019 — engineering_blog.
    - Quotes: 246 findings from 23 paid audits; "almost 49%" almost impossible to detect with a tool; "almost 78% of the most important findings" potentially detectable by static plus dynamic analysis; data validation 36%, access control 10%.
    - Verified via WebFetch.
  - [SEAL Security Frameworks – Security Testing](https://frameworks.securityalliance.org/security-testing/overview) — Security Alliance, 2025 — industry_report.
    - Quote: "Static analysis: always; tools such as Slither and Aderyn are common baselines".
    - Verified in the page text. It supports "baseline, not assurance".
- **Detect:** Run `slither . --exclude-dependencies` and `aderyn .` as the baseline. The violation is a hardening report whose only evidence is analyzer output, with no per-item log for F03–F11, F14, F15 and F23 and no property tests.
- **Tools:** slither, aderyn
- **Applies to:** Every smart-contract project, and especially DeFi contracts that custody funds or price assets.
- **When not to apply / counterpoints:**
  - Trail of Bits' 78% figure means human-written properties (Echidna) plus static analysis, not default detectors.
  - Chaliasos tested 5 tools, one of them a linter, on attacks from one historical dataset. Newer tools may do better.
  - Analyzers stay cheap and reliable for reentrancy, unchecked returns and similar low-level classes.
- **Fix risk:** low

### G207-F03 — Build an access-control matrix for every state-changing entry point
- **Grade:** A · **Verdict:** CORRECTED (the OWASP quotes were paraphrases in quotation marks and are now the exact text; OWASP says roles are "ideally" held by multisigs, which is softer than the researcher's wording; the EthTrust [Q] Enforce Least Privilege body text is now verified)
- **Rule:** For every external or public non-view function, record the state it writes, the msg.sender or role check that guards it, and who holds that role. Flag:
  - (a) Writes to privileged state (owner, implementation, oracle, fee, minter, pause, allowlist) without authorization.
  - (b) `tx.origin` used for authorization.
  - (c) Hooks and callbacks (flash-loan, Uniswap v4 hooks, ERC-721/1155 receivers, bridge receive handlers) that do not check the caller.
  - (d) Initializers anyone can call (F10).
  - (e) Stale allowlist members.
- **Rationale:** OWASP ranks access control first for 2026. Its 2025 cases are Zoth (a single EOA deployer led to a malicious upgrade, $8.4M) and Cork (a Uniswap v4 hook with no `onlyPoolManager` check, $11–12M). Trail of Bits found access-control issues were 10% of 246 audit findings, and 25% of those were high severity with low difficulty. Ronin's allowlist entry that "was never revoked" supplied the 5th of 9 validator signatures.
- **Evidence:**
  - [SC01:2026 Access Control Vulnerabilities](https://scs.owasp.org/sctop10/SC01-AccessControlVulnerabilities/) — OWASP, 2026 — standard.
    - Quotes: "Privileged roles should be few, clearly documented, and ideally held by well‑secured multisigs or governance modules instead of EOAs." "Initialization routines for upgradeable contracts must be locked after first use, with initializer / reinitializer guards and explicit versioning". "Hook and callback entry points must validate the caller (e.g., onlyPoolManager) explicitly on-chain." "Any cross-chain or cross-module 'owner' concept must be verified on-chain".
    - Page text downloaded. Zoth (March 2025, $8.4M) and Cork (May 2025, $11–12M) confirmed.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — Enterprise Ethereum Alliance, 2025 — standard.
    - Quotes: "[S] No tx.origin … Tested Code MUST not contain a tx.origin instruction unless it meets the Overriding Requirement [Q] Verify tx.origin Usage". "[Q] Enforce Least Privilege: Tested code that enables privileged access MUST implement appropriate access control mechanisms that provide the least privilege necessary for those interactions".
    - Spec text downloaded and searched.
  - [246 Findings From Our Smart Contract Audits](https://blog.trailofbits.com/2019/08/08/246-findings-from-our-smart-contract-audits-an-executive-summary/) — Trail of Bits, 2019 — engineering_blog.
    - Data: access control is 10% of findings, and 25% of those are high severity with low difficulty.
    - Verified.
  - [Slither Printer documentation](https://github.com/crytic/slither/wiki/Printer-documentation) — Crytic / Trail of Bits, 2025 — official_docs.
    - Quotes: `vars-and-auth` "Print the variables written and the check on `msg.sender` of each function"; `modifiers` "Print the modifiers called by each function".
    - Wiki markdown read.
  - [Ronin Network - REKT](https://rekt.news/ronin-rekt/) — rekt.news, 2022 — incident_report.
    - Quotes: "~$624M stolen"; "Of these nine validators, a consensus of five is necessary"; "the whitelist access was never revoked"; "nobody noticed for six days".
    - Verified. The researcher's "March 23" date is not on the page and was replaced with "six days".
- **Detect:** Run `slither . --print vars-and-auth` and `slither . --print modifiers`. Run these Slither detectors, all confirmed to exist in the detector wiki: `suicidal`, `arbitrary-send-eth`, `arbitrary-send-erc20`, `arbitrary-send-erc20-permit`, `unprotected-upgrade`, `tx-origin`, `protected-vars` and `controlled-delegatecall`. Search with `rg -n 'tx[.]origin' -g '*.sol'`. Manually confirm that every callback entry point has a `msg.sender == expectedCaller` check.
- **Tools:** slither, ripgrep, cast
- **Applies to:** All contracts with privileged functions, hooks or callbacks. Cross-chain routers and governance modules come first.
- **When not to apply / counterpoints:** Some functions are permissionless by design: keeper pokes, liquidations, harvests. Adding auth to them breaks liveness, so confirm intent from the docs before calling a missing modifier a bug.
- **Fix risk:** medium

### G207-F05 — Price and exchange-rate sources must be manipulation-resistant, fresh and bounded
- **Grade:** A · **Verdict:** CORRECTED (OWASP quote wording fixed; the claim that latestAnswer is "deprecated" is not in the cited docs, so it is replaced by the API reference's statement that latestAnswer carries no timestamp; the EthTrust oracle requirement text is now verified)
- **Rule:** Flag any price used for collateral, minting, liquidation or redemption when:
  - (a) It comes from same-block manipulable state: AMM reserves (`getReserves`, `slot0`), pool `balanceOf`, or a vault's own `totalAssets/totalSupply` read as an oracle.
  - (b) It uses Chainlink `latestRoundData` without checking `updatedAt` against that feed's heartbeat, or without checking the answer is within sane bounds (at least > 0).
  - (c) It uses `latestAnswer`, which has no timestamp.
  - (d) On an L2, it ignores the sequencer uptime feed and its grace period.
  - (e) It relies on the aggregator's `minAnswer/maxAnswer` as circuit breakers.
  
  Stale or out-of-bounds data must lead to fail-safe behaviour: pause or revert. Maps to OWASP SC03/SC04 (2026) and EthTrust [Q] Protect against Oracle Failure.
- **Rationale:** Oracle manipulation was the second-largest root cause in Chaliasos (29 of 127 attacks), and no evaluated tool detects it. OWASP's 2025 cases include NGP, whose `getPrice()` "relied solely on DEX pair … reserve balances" (~$2M), and GMX, where price manipulation was one part of a $42M reentrancy attack. Chainlink states that heartbeats can last hours and that min/max answers are mostly unused.
- **Evidence:**
  - [SC03:2026 Price Oracle Manipulation](https://scs.owasp.org/sctop10/SC03-PriceOracleManipulation/) — OWASP, 2026 — standard.
    - Quotes: "Use TWAPs over sufficient windows to resist short-lived manipulations. Reject prices older than a maximum staleness threshold." "Avoid basing core prices on illiquid pools." "On suspicious or unavailable data, halt sensitive operations (borrowing, liquidations)." NGP (September 2025, ~$2M). GMX (July 2025, $42M), where reentrancy was the "primary root cause".
    - Page text downloaded.
  - [So you want to use a price oracle](https://www.paradigm.xyz/2020/11/so-you-want-to-use-a-price-oracle) — samczsun (Paradigm), 2020 — engineering_blog.
    - Quote: "the spot price on a decentralized exchange may be wildly incorrect during a transaction". Case studies: bZx, Harvest (~$33M), yVault, Synthetix. Recommends TWAPs, M-of-N reporters and checking liquidity.
    - Verified.
  - [Chainlink Data Feeds](https://docs.chain.link/data-feeds) and [API reference](https://docs.chain.link/data-feeds/api-reference) — Chainlink, 2026 — official_docs.
    - Quotes: "Your application should track the latestTimestamp variable or use the updatedAt value from the latestRoundData() function to make sure that the latest answer is recent enough". "Some heartbeats are configured to last several hours". "On most data feeds, these values are no longer used and they do not stop your application from reading the most recent answer." L2 sequencer feeds help "prevent mass liquidations by providing a grace period". latestAnswer: "No timestamp is included to check data freshness."
    - Page text downloaded.
  - [Solcurity](https://github.com/transmissions11/solcurity) — transmissions11 (the Rari-Capital/solcurity URL redirects here), 2021 — practitioner_forum.
    - Quotes: D3 "Don't use spot price from an AMM as an oracle."; D5 "Use sanity checks to prevent oracle/price manipulation."
    - Verified. The repo was last pushed in 2023.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quotes: "[Q] Protect against Oracle Failure: Tested Code MUST protect itself against malfunctions in Oracles it relies on." TWAP "provides some level of security against sudden spikes such as those created by a Flashloan attack, but at the cost of providing stale information. It is important to choose time windows carefully".
    - Spec text searched.
- **Detect:** Search with `rg -n 'getReserves[(]|slot0[(]|latestAnswer[(]|latestRoundData[(]|balanceOf[(]address[(]this[)][)]' -g '*.sol'`. For each `latestRoundData` call, confirm that `updatedAt` is compared with a per-feed threshold and that the answer is range-checked. On L2 deployments, confirm the sequencer-uptime check. Trace every price used in collateral or mint math back to its source.
- **Tools:** ripgrep, slither, manual review
- **Applies to:** Lending, CDPs, perps, share-pricing vaults, and anything that values tokens.
- **When not to apply / counterpoints:**
  - TWAPs lag in volatile markets and can still be pushed over several blocks on illiquid pools (EthTrust notes the staleness trade-off).
  - Staleness thresholds tighter than the heartbeat cause false reverts.
  - Spot prices are acceptable for non-collateral uses such as UI quotes.
- **Fix risk:** high

### G207-F06 — Signed actions must bind domain, nonce, deadline and every value-relevant parameter
- **Grade:** A · **Verdict:** CORRECTED
  - "[M] Signature Management" is a section heading in EthTrust v3. The actual requirements are [M] Proper Signature Verification and [M] No Improper Usage of Signatures for Replay Attack Protection, with a [Q] Intended Replay override.
  - OpenZeppelin marks ECDSA's malleability rejection as DEPRECATED and to be removed in v6.0, so the rule no longer relies on it.
  - Cyfrin SOL-AM-ReplayAttack-1 covers replay of failed transactions, not signatures.
- **Rule:** Every signature-authorised action must bind:
  - An EIP-712 domain containing chainId and verifyingContract.
  - A per-signer nonce, or a used-hash mapping, that is consumed on use.
  - A deadline.
  - Every economically relevant parameter.
  
  Verify with OpenZeppelin ECDSA/`SignatureChecker`, which supports ERC-1271 wallets. Never use raw `ecrecover` without an `address(0)` check. **Never use the signature bytes as a unique identifier for replay protection.** OpenZeppelin says to use nonces or hash invalidation, and its malleability rejection is deprecated for v6.0. The domain separator must follow `block.chainid` and the proxy's address. OZ's upgradeable EIP712 rebuilds it from the live values, so hand-rolled caches are the risk. Do not use `abi.encodePacked` with consecutive dynamic arguments.
- **Rationale:** EthTrust v3 requires chainid in transaction hashes. It also requires that signatures cannot be reused across the same function, several functions, several contract addresses or several chains, unless the replay is intended and documented. Dacian's catalogue ties each missing binding to real contest findings.
- **Evidence:**
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quotes: "[S] Encode Hashes with chainid: Tested code MUST create hashes for transactions that incorporate chainid values following the recommendation described in [EIP-155]". "[S] No Hashing Consecutive Variable Length Arguments: Tested Code MUST NOT use abi.encodePacked() with consecutive variable length arguments". "[M] Proper Signature Verification: Tested Code MUST properly verify signatures to ensure authenticity of messages that were signed off-chain." "[M] No Improper Usage of Signatures for Replay Attack Protection: Tested Code using signatures to prevent replay attacks MUST ensure that signatures cannot be reused: In the same function … nor In more than one function … nor In more than one contract address … nor In the same contract address across multiple chains". "[Q] Intended Replay: If a signature within the Tested Code can be reused, the replay instance MUST be intended, documented, and safe for re-use."
    - Spec text searched.
  - [OpenZeppelin Contracts 5.x – Cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography) — OpenZeppelin, 2025 — official_docs.
    - Quotes: "this function rejects them by requiring the s value to be in the lower half order, and the v value to be either 27 or 28 … This restriction is DEPRECATED and will be removed in v6.0. Developers SHOULD NOT use signatures as unique identifiers; use hash invalidation or nonces for replay protection." "hash must be the result of a hash operation for the verification to be secure". EIP712 is designed for "properly updating the chain id to protect against replay attacks on an eventual fork of the chain". "In the upgradeable version of this contract, the cached values will correspond to the address, and the domain separator of the implementation contract. This will cause the EIP712._domainSeparatorV4 function to always rebuild the separator".
    - Page text downloaded.
  - [Signature Replay Attacks](https://dacian.me/signature-replay-attacks) — Dacian (Cyfrin), 2023 — engineering_blog.
    - Findings by category:
      - Missing nonce: Ondo C4 2023-01, Rigor C4 2022-08, Foundation C4 2022-02, Harpie Sherlock 2022-09.
      - Cross-chain replay: Biconomy C4 2023-01, Harpie, Unlimited Network.
      - Missing parameter: Biconomy `tokenGasPriceFactor`, Sparkn.
      - No expiration: NFTPort Sherlock 2022-10.
      - `ecrecover` returning 0: Swivel C4 2021-09, Astaria.
      - Malleability: Meebits C4 2021-04, HyperLiquid, Harpie.
    - Verified.
  - [Solcurity](https://github.com/transmissions11/solcurity) — transmissions11, 2021 — practitioner_forum.
    - Quotes: C10 "Are signatures protected against replay with a nonce and `block.chainid` (SWC-121)"; C11 "Ensure all signatures use EIP-712."
    - Verified.
  - [Cyfrin audit-checklist](https://github.com/Cyfrin/audit-checklist) — Cyfrin, 2024 — practitioner_forum.
    - Quote: SOL-AM-ReplayAttack-2 "Is there protection against replaying signatures on different chains?"
    - Read from checklist.json.
- **Detect:** Search with `rg -n 'ecrecover[(]' -g '*.sol'`; every hit is a candidate. Search with `rg -n 'DOMAIN_SEPARATOR|_domainSeparatorV4|EIP712|nonces[[]' -g '*.sol'` and confirm the nonce is consumed on the same path. Flag any `mapping(bytes => bool)` keyed on the signature bytes. Run the Slither detector `encode-packed-collision` (High/High). Manually confirm that every value-affecting field is in the typehash.
- **Tools:** ripgrep, slither, manual review
- **Applies to:** Permit and meta-transactions, off-chain orders, allowlist mints, oracle-signed prices, relayers, bridges.
- **When not to apply / counterpoints:** Some signatures are meant to be reusable, such as standing allowlists. EthTrust's [Q] Intended Replay allows this if it is documented and shown safe. Supporting ERC-1271 widens the attack surface to contract wallets.
- **Fix risk:** high

### G207-F07 — User-facing value paths need caller-supplied slippage bounds and deadlines; deploy+init must be atomic
- **Grade:** A · **Verdict:** CORRECTED (EthTrust v3 renamed "[Q] Protect against Front-Running" to "[Q] Protect against Ordering Attacks"; the Uniswap doc URL now redirects to a new path; EthTrust's text on atomic initialization added)
- **Rule:**
  - Every user-facing function whose outcome depends on price or state that another actor can change in the same block must take a caller bound (`minAmountOut`/`maxAmountIn`, `minShares`/`maxAssets`) and a deadline. That covers swaps, zaps, vault operations routed through AMMs, mint-at-price and liquidation rewards.
  - Flag a hard-coded `0` minimum, and `deadline: block.timestamp` in internal router calls.
  - Flag get-or-create and deploy-then-initialize sequences that someone can front-run.
  - Off-chain bots on public-mempool chains should submit value-extracting transactions through a private route.
  
  Maps to EthTrust [Q] Protect against Ordering Attacks and [Q] Protect against MEV Attacks.
- **Rationale:** Uniswap's own guide calls `amountOutMinimum = 0` "a significant risk in production". EthTrust v3 makes ordering and MEV protection a [Q] requirement and says atomic initialization "reduces the risk that a malicious actor takes control". Sherlock calibrates severity by chain (private mempool means one level lower) but does not dismiss the issue.
- **Evidence:**
  - [Uniswap v3 single-hop swapping guide](https://developers.uniswap.org/docs/protocols/v3/guides/swapping/single-hop-swapping) — Uniswap Labs, 2026 — official_docs.
    - Quotes: "`amountOutMinimum`: we are setting to zero, but this is a significant risk in production. For a real deployment, this value should be calculated using our SDK or an onchain price oracle". "`deadline`: the unix time after which a swap will fail, to protect against long-pending transactions and wild swings in prices".
    - Read from the page source. The researcher's URL redirects here. The guide's own example code uses `deadline: block.timestamp` and `amountOutMinimum: 0` as demo shortcuts.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quotes: the changelog renames "[Q] Protect against Front-Running to [Q] Protect against Ordering Attacks to cover a broader class of attacks". "[Q] Protect against Ordering Attacks: Tested Code MUST manage information in such a way that it protects against Ordering Attacks." "[Q] Protect against MEV Attacks: Tested Code that is susceptible to MEV attacks MUST follow appropriate design patterns to mitigate this risk." "Initializing a contract in the same transaction as its deployment reduces the risk that a malicious actor takes control of the contract."
    - Spec text searched.
  - [Cyfrin audit-checklist](https://github.com/Cyfrin/audit-checklist) — Cyfrin, 2024 — practitioner_forum.
    - Quotes: SOL-AM-SandwichAttack-1 "Does the protocol have an explicit slippage protection on user interactions?"; SOL-AM-FrA-1 "Are "get-or-create" patterns protected against front-running attacks?"
    - Read from checklist.json.
  - [Sherlock Judging Guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, 2025 — official_docs.
    - Quote: "Issues that depend on front-running will get their severity downgraded if the deployment chain has a private mempool. High will be Medium, and Medium will be Invalid."
    - Verified.
  - [Flashbots Protect overview](https://docs.flashbots.net/flashbots-protect/overview) — Flashbots, 2026 — official_docs.
    - Quotes: "Transactions are sent to a private Flashbots mempool where they will be hidden from frontrunning and sandwich bots." "Transactions are only included in the block if they do not revert."
    - Verified.
- **Detect:** Search with `rg -n 'amountOutMin(imum)? *[:=] *0|minAmountOut *[:=] *0|deadline *: *block[.]timestamp' -g '*.sol'`. Manually check that each external function calling a DEX or vault takes a user-supplied bound. In deploy scripts, check that proxy deploy and initialize happen in one transaction. In bot code, check which RPC transactions are sent through.
- **Tools:** ripgrep, manual review
- **Applies to:** DEX integrations, vaults, zaps, liquidations, arbitrage bots, deployment scripts.
- **When not to apply / counterpoints:**
  - Private-mempool L2s reduce ordering risk but do not remove it.
  - Private RPCs require trusting builders.
  - Over-tight bounds cause failed transactions and missed liquidations.
- **Fix risk:** high

### G207-F09 — Detect proxies before touching storage; validate layouts mechanically
- **Grade:** A · **Verdict:** CORRECTED (the OWASP SC10 quotes were paraphrases and are now exact; the researcher's "never EOA-controlled" overstates OWASP, which says "never leave them on EOAs without strong operational controls")
- **Rule:** Before editing any state variable, inheritance order, base contract or storage struct, find out whether the contract is upgradeable or sits behind a proxy.
  
  Source signals: `Initializable`, `UUPSUpgradeable`, `ERC1967Proxy`/`TransparentUpgradeableProxy` imports, `initialize()`, `__gap`, `@custom:storage-location erc7201:`, `diamondCut`/facets, `delegatecall`.
  
  On-chain signals: `cast implementation <addr>` for the ERC-1967 implementation slot, `cast implementation --beacon <addr>`, the admin slot, and the Diamond loupe `facets()`.
  
  If the contract is upgradeable:
  - Never reorder, insert, remove or retype variables. Append only, or use an ERC-7201 namespace, and shrink `__gap` to match.
  - Validate with `npx @openzeppelin/upgrades-core validate --contract V2 --reference V1`, which needs `build_info = true` and `extra_output = ["storageLayout"]` in Foundry.
  - Also run `slither-check-upgradeability` and diff `slither --print variable-order` before and after.
  
  Maps to OWASP SC10:2026.
- **Rationale:** ERC-1967 standardises slots so tools can find proxies. ERC-7201 (Final) defines collision-safe namespaces. OpenZeppelin forbids reordering, retyping, inserting before existing variables, and removing variables. Audius lost 18.56M AUDIO (~$6M valued, ~$1M realised) to a known proxy/Initializable storage collision despite audits by Kudelski and OpenZeppelin.
- **Evidence:**
  - [ERC-1967: Proxy Storage Slots](https://eips.ethereum.org/EIPS/eip-1967) — Ethereum EIPs, 2019 — standard.
    - Data: status Final. Implementation slot `0x360894a1…382bbc`, admin `0xb5312768…5d6103`, beacon `0xa3f0ad74…133d50`.
    - All three slot constants confirmed in the ERC source.
  - [ERC-7201: Namespaced Storage Layout](https://eips.ethereum.org/EIPS/eip-7201) — Ethereum EIPs, 2023 — standard.
    - Quotes: status Final. "`@custom:storage-location erc7201:<NAMESPACE_ID>`"; formula `keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff))`; Solidity v0.8.20 is recommended as the minimum.
    - Confirmed in the ERC source.
  - [ERC-2535: Diamonds](https://eips.ethereum.org/EIPS/eip-2535) — Ethereum EIPs, 2020 — standard.
    - Quote: status Final. "A `DiamondCut` event must be emitted any time external functions are added, replaced, or removed."; loupe `facets()`, `facetAddress()`.
    - Confirmed.
  - [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin, 2025 — official_docs.
    - Data: no reordering, retyping, inserting before existing variables, or removing; `__gap`; ERC-7201 needs Solidity ≥0.8.20 for plugin validation.
    - Verified via WebFetch.
  - [OpenZeppelin Upgrades Core CLI](https://docs.openzeppelin.com/upgrades-plugins/api-core) — OpenZeppelin, 2025 — official_docs.
    - Quote: "npx @openzeppelin/upgrades-core validate [<BUILD_INFO_DIR>] [<OPTIONS>]" with `--contract`, `--reference`, `--requireReference`, `--unsafeAllow`; `@custom:oz-upgrades-from`; Foundry `build_info = true`, `extra_output = ["storageLayout"]`.
    - Verified.
  - [Slither Upgradeability Checks](https://github.com/crytic/slither/wiki/Upgradeability-Checks) — Crytic, 2025 — official_docs.
    - Data: 17 checks. High: became-constant, function-id-collision, function-shadowing, missing-calls, missing-init-modifier, multiple-calls, order-vars-contracts, order-vars-proxy, variables-initialized, were-constant.
    - Wiki markdown read.
  - [cast implementation](https://getfoundry.sh/cast/reference/implementation) — Foundry, 2026 — official_docs.
    - Quotes: "Fetch the EIP-1967 implementation for a contract Can read from the implementation slot or the beacon slot"; `-B` accepts "earliest, finalized, safe, latest, or pending".
    - Verified.
  - [Audius - REKT](https://rekt.news/audius-rekt/) — rekt.news, 2022 — incident_report.
    - Data: the storage collision "allowed the attacker to take control of the governance contract"; 18,564,497 AUDIO; "the vulnerability is a known issue".
    - Verified.
  - [SC10:2026 Proxy & Upgradeability Vulnerabilities](https://scs.owasp.org/sctop10/SC10-ProxyAndUpgradeabilityVulnerabilities/) — OWASP, 2026 — standard.
    - Quotes: "Use well-established proxy patterns and libraries (e.g., OpenZeppelin UUPS/transparent proxies) instead of bespoke designs. Protect upgrade and admin roles with robust governance / multisigs ; never leave them on EOAs without strong operational controls." "Maintain comprehensive upgrade runbooks and checklists, including: Testing of migrations. Verification of new implementation code and storage layout."
    - Page text downloaded.
- **Detect:**
  - Search with `rg -n 'Initializable|UUPSUpgradeable|ERC1967|TransparentUpgradeableProxy|__gap|erc7201:|diamondCut|facetAddress|delegatecall' -g '*.sol'`.
  - On-chain: run `cast implementation <addr> -r $RPC`, `cast implementation --beacon <addr>` and `cast storage <addr> 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`. A zero admin slot does **not** prove the contract is not a proxy, because UUPS proxies usually have no ERC-1967 admin. Rely on the implementation slot.
  - Snapshot `slither . --print variable-order` before and after the edit.
  - Run `upgrades-core validate` and `slither-check-upgradeability`.
- **Tools:** cast (Foundry), @openzeppelin/upgrades-core, slither-check-upgradeability, slither
- **Applies to:** Any contract behind UUPS, Transparent, Beacon or Diamond proxies, or that inherits upgradeable bases.
- **When not to apply / counterpoints:** Trail of Bits (2018) "strongly advise[s] against" delegatecall upgradeability and prefers migration. That is a dated dissent against current OWASP and OpenZeppelin practice. Non-upgradeable contracts have no storage constraint, but fixing them means a redeploy or migration.
- **Fix risk:** high

### G207-F10 — Initializers must be locked, complete, and executed atomically with deployment
- **Grade:** A · **Verdict:** VERIFIED (EthTrust v3's atomic-initialization text added as corroboration)
- **Rule:** For upgradeable code, check that:
  - The implementation constructor calls `_disableInitializers()`, annotated `@custom:oz-upgrades-unsafe-allow constructor`.
  - `initialize()` has the `initializer` modifier, and later versions use `reinitializer(n)` with n increasing.
  - Every parent `__X_init` is called exactly once.
  - UUPS `_authorizeUpgrade` is overridden with access control.
  - Implementations contain no `selfdestruct` and no `delegatecall` to caller-controlled targets.
  - Deploy scripts deploy and initialize the proxy in one transaction.
  - Deployed proxies are actually initialized: read the owner on-chain.
  - Upgrades that change validation logic are reviewed like new code.
- **Rationale:** OpenZeppelin warns that an uninitialized implementation "can be taken over by an attacker". OWASP SC10 cites Kinto ($1.55M) and a 2025 campaign against uninitialized ERC-1967 proxies ($10M+ across protocols). Nomad lost $190M after a routine upgrade's initialization made `0x00` a trusted root.
- **Evidence:**
  - [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) — OpenZeppelin, 2025 — official_docs.
    - Quote: "An uninitialized implementation contract can be taken over by an attacker, which may impact the proxy." Also covers `_disableInitializers()` with `@custom:oz-upgrades-unsafe-allow constructor`, and prohibits `selfdestruct` and `delegatecall`.
    - Verified.
  - [OpenZeppelin Contracts 5.x Proxy API](https://docs.openzeppelin.com/contracts/5.x/api/proxy) — OpenZeppelin, 2025 — official_docs.
    - Quote: "_authorizeUpgrade function must be overridden to include access restriction to the upgrade mechanism". The ERC-1822 check "will prevent any upgrades to a non UUPS compliant implementation". Also covers `reinitializer(uint64 version)` and `onlyInitializing`.
    - Verified via WebFetch.
  - [The Proxy Hack: Uninitialized Contracts Costing DeFi $10M+ in Losses](https://audita.io/blog-articles/the-proxy-hack-uninitialized-contracts-costing-defi-10m-in-losses) — Audita, 2025 (July 16) — engineering_blog.
    - Quotes: "freshly deployed ERC1967 Proxy contracts left uninitialized by their developers"; "a backdoor that could lay dormant for months"; Kinto $1.55M on July 10, 2025; "Initialize proxy contracts in the same transaction as deployment".
    - Verified.
  - [Nomad Bridge - REKT](https://rekt.news/nomad-rekt/) — rekt.news, 2022 — incident_report.
    - Quotes: "Following a routine upgrade in June, the bridge's Replica contract was initialised with a fatal security flaw … The 0x00 address was set as a trusted root, meaning that all messages were read as valid by default." "$190M … in a savage attack lasting two and a half hours". QSP-19 "foreshadowing a similar vulnerability"; "We believe the Nomad team has misunderstood the issue".
    - Page text downloaded.
  - [SC10:2026 Proxy & Upgradeability Vulnerabilities](https://scs.owasp.org/sctop10/SC10-ProxyAndUpgradeabilityVulnerabilities/) — OWASP, 2026 — standard.
    - Data: Kinto Protocol (July 2025, $1.55M); "Uninitialized Proxy Campaign (2025, $10M+ across protocols)".
    - Verified.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quote: a "non-atomic deployment in which the initializing function is not called in the same transaction as the contract deployment … is ripe for Front-running attacks … Initializing a contract in the same transaction as its deployment reduces the risk".
    - Spec text searched.
  - [Security Pitfalls & Best Practices 101](https://secureum.substack.com/p/security-pitfalls-and-best-practices-101) — Secureum, 2021 — practitioner_forum.
    - Quote: #95 "Proxy-based upgradeable contracts need to use public initializer functions instead of constructors that need to be explicitly called only once."
    - Verified.
- **Detect:**
  - Run `slither-check-upgradeability` and look for missing-init-modifier, missing-calls, multiple-calls, initialize-target and initializer-missing. All exist.
  - Search with `rg -n 'function initialize' -g '*.sol'` and check each hit for a modifier.
  - Search with `rg -n '_disableInitializers' -g '*.sol'`.
  - Search with `rg -n '_authorizeUpgrade' -A3 -g '*.sol'`; an empty body without auth is a finding.
  - In deploy scripts, check that the init calldata is passed to the proxy constructor.
  - On-chain, `cast call <proxy> 'owner()(address)'` should return the expected owner.
- **Tools:** slither-check-upgradeability, ripgrep, cast, @openzeppelin/upgrades-core
- **Applies to:** All proxied contracts and their deploy scripts. Bridges and message receivers come first.
- **When not to apply / counterpoints:** A deployed implementation cannot be patched in place: the fix is a new implementation plus an upgrade, which is itself risky (Nomad). Non-upgradeable contracts correctly initialize in the constructor.
- **Fix risk:** medium

### G207-F15 — Treat every external call as untrusted
- **Grade:** A · **Verdict:** CORRECTED (Hashmasks was a disclosed vulnerability, not an executed exploit: samczsun showed an attacker *could* mint 39 against the cap of 20; EthTrust requirement list completed with [S] Check External Calls Return)
- **Rule:**
  - Wrap ERC-20 operations in SafeERC20 and check low-level call results.
  - Use checks-effects-interactions, or reentrancy guards across every function that shares state.
  - Never call caller-supplied router or target addresses with the contract's privileges.
  - Confirm code exists at the target before low-level calls to addresses that might be empty.
  - Support only the token behaviours the README declares (fee-on-transfer, rebasing, missing return, ERC-777 hooks) and document the rest.
  
  Maps to OWASP SC06/SC08 (2026) and EthTrust [S] Check External Calls Return, [S] Use Check-Effects-Interaction, [M] Protect External Calls, [M] Handle External Call Returns and [Q] Verify External Calls.
- **Rationale:** OWASP SC06:2026 cites GMX ($42M), where `executeDecreaseOrder` sent a refund to an attacker-supplied contract and allowed re-entry, and Arcadia ($3.5M), which made arbitrary calls to user-supplied routers. Reentrancy is the one class tools reliably catch (Chaliasos), so always run Slither here. "Safe" helpers can hide external calls (Hashmasks).
- **Evidence:**
  - [SC06:2026 Unchecked External Calls](https://scs.owasp.org/sctop10/SC06-UncheckedExternalCalls/) — OWASP, 2026 — standard.
    - Quotes: "Treat all external calls as untrusted: Even "standard" tokens or well-known protocols can be upgraded or replaced." "Use libraries like OpenZeppelin's SafeERC20 to wrap token operations." Arcadia: "arbitrary external calls to user-supplied router addresses via swapData parameters, without validating the callee".
    - Page text downloaded.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quotes: "[S] Check External Calls Return: Tested Code that makes external calls using the Low-level Call Functions … MUST check the returned value". "[S] Use Check-Effects-Interaction". "[M] Handle External Call Returns: Tested Code that makes external calls MUST reasonably handle possible errors." "[Q] Verify External Calls: Tested Code that contains external calls MUST document the need for them".
    - Spec text searched.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2025 — official_docs.
    - Data (severity/confidence): unchecked-transfer High/Medium, unchecked-lowlevel Medium/Medium, reentrancy-eth High/Medium, reentrancy-no-eth Medium/Medium, controlled-delegatecall High/Medium, erc20-interface Medium/High, arbitrary-send-erc20 High/High.
    - All confirmed in the wiki markdown.
  - [The Dangers of Surprising Code](https://samczsun.com/the-dangers-of-surprising-code/) — samczsun, 2021 — engineering_blog.
    - Quote: "This results in a total of 39 masks being minted, even though the maximum allowable was only 20."
    - Verified; it describes a vulnerability disclosure.
  - [Sherlock Judging Guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, 2025 — official_docs.
    - Quote: "Issues related to tokens with non-standard behaviors, such as weird-tokens are not considered valid by default unless these tokens are explicitly mentioned in the README."
    - Verified.
- **Detect:**
  - Run the Slither detectors `reentrancy-eth`, `reentrancy-no-eth`, `unchecked-transfer`, `unchecked-lowlevel`, `controlled-delegatecall`, `arbitrary-send-erc20` and `erc20-interface`.
  - Search with `rg -n '[.]call[{(]|[.]delegatecall[(]' -g '*.sol'`.
  - Search with `rg -n 'IERC20[(].*[)][.]transfer' -g '*.sol'` for transfers not wrapped in SafeERC20.
  - Confirm that caller-supplied call targets are allowlisted.
- **Tools:** slither, ripgrep
- **Applies to:** All contracts that call tokens, routers, hooks or user-supplied addresses.
- **When not to apply / counterpoints:** Supporting every odd token is out of scope for many protocols, and documenting unsupported tokens can be the right fix. Adding `nonReentrant` to view-like paths can break integrations.
- **Fix risk:** medium

### G207-F17 — No plaintext signing keys; use keystores, hardware wallets or KMS/remote signers
- **Grade:** A · **Verdict:** VERIFIED (note: the OZ Relayer signer page read is the unreleased main-branch doc; stable is v1.5.x)
- **Rule:** Off-chain signing keys that control mainnet value (deployer, keeper, liquidation or arbitrage bot, relayer) must not live in plaintext in the repo, `.env`, Docker `ENV`/`ARG`, CLI flags (`--private-key`) or logs.
  - Deployments: a hardware wallet, or an encrypted keystore via `cast wallet import`.
  - Bots: a KMS/HSM-backed signer (AWS KMS `ECC_SECG_P256K1`, Google Cloud KMS) or a remote signer (OpenZeppelin Relayer with `aws_kms`, `google_cloud_kms`, `vault_transit` or `turnkey`).
  
  Fixable in the repo: remove committed keys and then rotate them, add `.gitignore` and `.env.example`, redact logs, validate config at startup, and put a Signer interface in front of signing. Report-only: the custody migration itself.
- **Rationale:** Foundry, OWASP and AWS all say the same thing: keys should be encrypted or held in hardware or KMS, not in env vars. Key compromise is the largest share of 2024 theft (Chainalysis, 43.8%). Note that figure covers centralized services as well as protocols; it is not specific to bot keys in `.env`.
- **Evidence:**
  - [Foundry – Key management best practices](https://getfoundry.sh/guides/best-practices/key-management) — Foundry, 2026 — official_docs.
    - Quotes: "Store keys encrypted, not as plaintext environment variables"; "Store production keys in encrypted keystores or hardware wallets"; "For mainnet deployments, use a hardware wallet"; "Never use Anvil's default keys on public networks. They are publicly known."
    - Verified.
  - [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — OWASP, 2025 — standard.
    - Quotes: "Environment variables are generally accessible to all processes and may be included in logs or system dumps. Using environment variables is therefore not recommended unless the other methods are not possible." Also: do not use `docker ENV`/`ARG`; rotate secrets; use HSMs; Yelp detect-secrets.
    - Verified.
  - [AWS KMS key spec reference](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html) — AWS, 2026 — official_docs.
    - Quotes: "ECC_SECG_P256K1 (secp256k1), commonly used for cryptocurrencies." "The private key that generates signatures or derives shared secrets never leaves AWS KMS unencrypted." "If you're creating an asymmetric KMS key to use with cryptocurrencies, use the ECC_SECG_P256K1 key spec."
    - Verified in full page text.
  - [OpenZeppelin Relayer – Signers](https://docs.openzeppelin.com/relayer/configuration/signers) — OpenZeppelin, 2026 — official_docs.
    - Data: signer types `local`, `vault`, `vault_transit`, `turnkey`, `google_cloud_kms`, `aws_kms`, `cdp`. Quotes: "Use HSM-backed keys for production environments when available"; "chmod 0500 config/keys/*".
    - Verified, but this is the main-branch doc (stable is v1.5.x). Confirm signer availability for the version in use.
  - [$2.2 Billion Stolen from Crypto Platforms in 2024](https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2025/) — Chainalysis, 2024 (Dec 19) — industry_report.
    - Quote: "Private key compromises accounted for the largest share of stolen crypto in 2024, at 43.8%." $2.2B across 303 incidents.
    - Verified.
- **Detect:**
  - Search with `rg -n --hidden -g '!node_modules' -g '!.git' 'PRIVATE_KEY|privateKeyToAccount[(]|new (ethers[.])?Wallet[(]|fromMnemonic|MNEMONIC|--private-key'`.
  - Search Dockerfiles with `rg -n 'ENV .*KEY|ARG .*KEY' -g 'Dockerfile*'`.
  - Scan git history with detect-secrets.
  - Check whether loggers can serialise config that contains keys, and whether the signer is built directly from `process.env`.
- **Tools:** ripgrep, detect-secrets, git log -p
- **Applies to:** Deploy scripts, keepers, liquidation and arbitrage bots, relayers, dApp backends that sign.
- **When not to apply / counterpoints:** KMS adds a round-trip per signature, which matters for latency-sensitive arbitrage. A compromised IAM principal can still use the key. OZ Relayer itself suggests env vars and dedicated service accounts for *service* credentials, so env vars remain, holding KMS credentials instead of raw keys. For testnet and hackathon work, an encrypted keystore is proportionate.
- **Fix risk:** medium

### G207-F04 — Derive accounting invariants from the docs and check every state-changing path against them
- **Grade:** B · **Verdict:** CORRECTED (Trace2Inv is peer-reviewed: Proceedings of the ACM on Software Engineering, vol. 1, FSE 2024, DOI 10.1145/3660786, not "preprint, venue not verified"; the OWASP invariant quote corrected to its exact wording)
- **Rule:** Derive the protocol's accounting invariants from the docs and check that every state-changing function preserves them. Examples:
  - The sum of balances equals totalSupply.
  - totalAssets covers all redeemable shares.
  - Total value withdrawn cannot exceed total deposits plus realized yield.
  - No account ends an action above the allowed LTV.
  - The share price does not fall outside loss events.
  
  Functions added later (donations, reserves, rebalancers, emergency paths) come first. Encode the invariants as property tests (F12). Where the team accepts it, add on-chain guards.
- **Rationale:** Business logic is OWASP SC02:2026. The largest root cause in Chaliasos (42 of 127) is missing logic or sanity checks, which tools cannot detect. Euler lost about $197M because `donateToReserves` "did not account for the donator's debt health". In the peer-reviewed Trace2Inv study, one invariant guard would have blocked 18 of 27 real exploits.
- **Evidence:**
  - [SC02:2026 Business Logic Vulnerabilities](https://scs.owasp.org/sctop10/SC02-BusinessLogicVulnerabilities/) — OWASP, 2026 — standard.
    - Quotes: "Express core invariants in code and tests: "Total value withdrawn cannot exceed total deposits + realized yield"". "Use formal verification and property-based fuzzing for key accounting paths (vaults, strategies, reward distribution)." Abracadabra (March 2025, $12.9M): "Flawed collateral accounting". Yearn yETH (November 2025, $9M).
    - Page text downloaded.
  - [Demystifying Invariant Effectiveness for Securing Smart Contracts (Trace2Inv)](https://arxiv.org/abs/2404.14580) — Chen, Liu, Beillahi, Li, Long, 2024 — peer_reviewed (PACMSE 1(FSE), DOI [10.1145/3660786](https://doi.org/10.1145/3660786)).
    - Quote: "the most effective invariant guard alone can successfully block 18 of the 27 identified exploits with minimal gas overhead … blocking up to 23 of the 27 benchmark exploits and achieving false positive rates as low as 0.32%."
    - Abstract verified. Venue confirmed via Crossref. The arXiv DOI field is truncated.
  - [Euler Finance - REKT](https://rekt.news/euler-rekt/) — rekt.news, 2023 — incident_report.
    - Quotes: Omniscia: "The attack ultimately arose from an incorrect donation mechanism and did not account for the donator's debt health, permitting them to create an unbacked DToken debt that will never be liquidated." "$197M"; "one of Euler's six auditors". Sherlock "has taken responsibility for missing the vulnerability in their review of EIP-14 last year, and will pay a claim of $4.5M".
    - Page text downloaded.
  - [Smart Contract and DeFi Security Tools](https://arxiv.org/abs/2304.02981) — Chaliasos et al., 2024 — peer_reviewed.
    - Quote: "the top two types of vulnerabilities in the attack dataset involve concepts such as coding logic or sanity checks or on-chain oracle manipulation, which in turn cannot be detected by current automated security tools."
    - Verified in the PDF.
- **Detect:** Build a function × invariant table. For each function that reduces balance, debt or collateral, verify it runs the same health or solvency check as the main path (the Euler pattern). Write each invariant as a Foundry `invariant_*` (F12). A function that bypasses the common accounting hook is a finding candidate.
- **Tools:** manual review, forge (invariant tests), medusa/echidna
- **Applies to:** Lending, ERC-4626 vaults, AMMs, staking and rewards, anything with internal accounting.
- **When not to apply / counterpoints:** Invariants are only as good as the spec, so undocumented economics make them guesses. On-chain guards cost gas and can false-revert; 0.32% is not zero. Trace2Inv's 27 exploits all predate 2024, and replication on newer exploits is unknown.
- **Fix risk:** medium

### G207-F08 — Flag denial-of-service vectors in loops, push payments and griefable state
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Flag:
  - (a) Loops over storage arrays or sets that any user can grow.
  - (b) External calls inside loops.
  - (c) Push payments to arbitrary addresses; prefer pull.
  - (d) `msg.value` read inside loops or batched `delegatecall`.
  - (e) Low-level calls that copy unbounded return data (return bombs).
  - (f) Griefable state, such as dust positions that block liquidation, or a front-run that fills a queue.
  
  Rate with Sherlock: Medium if funds are locked for more than a week, or a time-sensitive function is blocked; High if both. Immunefi rates griefing as Medium.
- **Rationale:** SWC-128 and Secureum #43/#44 describe gas-limit DoS and DoS from calls inside loops. In samczsun's MISO finding, about $350M (109k ETH) was at risk because `msg.value` persisted across a `delegatecall` batch.
- **Evidence:**
  - [SWC-128: DoS With Block Gas Limit](https://swcregistry.io/docs/SWC-128) — SWC Registry, 2020 — standard.
    - Quote: "If you absolutely must loop over an array of unknown size, then you should plan for it to potentially take multiple blocks". The notice says the registry "has not been thoroughly updated since 2020. It is known to be incomplete and may contain errors".
    - Verified. Treat it as legacy.
  - [Security Pitfalls & Best Practices 101](https://secureum.substack.com/p/security-pitfalls-and-best-practices-101) — Secureum, 2021 — practitioner_forum.
    - Quotes: #43 "Calls to external contracts inside a loop are dangerous … could lead to DoS if one of the calls reverts or execution runs out of gas"; #44 "looping over arrays of unknown size may lead to DoS when the gas cost of execution exceeds the block gas limit".
    - Verified.
  - [Two Rights Might Make A Wrong](https://samczsun.com/two-rights-might-make-a-wrong/) — samczsun, 2021 — engineering_blog.
    - Quotes: "Inside a delegatecall, msg.sender and msg.value are persisted." "If you use msg.value to check that payment was received, you absolutely cannot place that logic in a loop." About $350M.
    - Verified.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2025 — official_docs.
    - Data: calls-loop Low/Medium, "Calls inside a loop might lead to a denial-of-service attack."; msg-value-loop High/Medium; delegatecall-loop High/Medium; costly-loop Informational/Medium; return-bomb Low/Medium, "A low level callee may consume all callers gas unexpectedly."
    - Confirmed.
  - [Sherlock Judging Guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, 2025 — official_docs.
    - Quote: "The issue causes funds to be locked for more than a week. The issue impacts the availability of time-sensitive functions … If at least one of these is describing the case, the issue can be Medium. If both apply, the issue can be considered High severity."
    - Verified.
  - [Immunefi Severity Classification v2.3](https://immunefi.com/immunefi-vulnerability-severity-classification-system-v2-3/) — Immunefi, n.d. — official_docs.
    - Quote: Medium: "Griefing (e.g. no profit motive for an attacker, but damage to the users or the protocol)", "Unbounded gas consumption".
    - Verified.
- **Detect:** Run the Slither detectors `calls-loop`, `costly-loop`, `msg-value-loop`, `delegatecall-loop` and `return-bomb`. Search with `rg -n 'for *[(].*[.]length' -g '*.sol'` and check whether a non-privileged path can grow each array. List the caller-chosen recipients inside loops.
- **Tools:** slither, ripgrep
- **Applies to:** Reward distributors, auctions, queues, multicall and batch functions, liquidation engines, governance.
- **When not to apply / counterpoints:** Admin-bounded loops are fine. Pagination and pull patterns change the UX and the ABI. Gas limits differ by chain.
- **Fix risk:** medium

### G207-F11 — Inventory privileged powers and who holds them; report centralisation separately
- **Grade:** B · **Verdict:** CORRECTED (Halborn's "19% multisig" and "2.4% cold storage" describe the top-100 DeFi hacks of 2014–2024, not 2024 alone; the EthTrust timelock text and Immunefi's default exclusions were added)
- **Rule:**
  - Inventory every privileged power: upgrade, mint, pause, sweep/rescue, oracle/fee/parameter setters, role admin.
  - Record who holds each one on-chain: an EOA, a Safe k-of-n, or a timelock.
  - Classify each on Trail of Bits' maturity scale: L1 single EOA, L2 multisig, L3 timelock plus separated roles, L4 immutable.
  - Flag EOA-held upgrade or mint power, sensitive operations with no timelock, low thresholds, and bot hot keys that hold admin roles.
  - Report these in a separate "centralisation / operational risk" section instead of dropping them as QA.
- **Rationale:** Loss data points at keys. Chainalysis puts key compromise at 43.8% of 2024 theft. Halborn puts off-chain incidents at 80.5% of 2024 DeFi funds lost. Wintermute lost over $160M through a hot wallet that was a vault admin. Radiant lost over $53M with a 3-of-11 multisig. Contest and bounty rubrics exclude these risks by default, so a rubric-only review under-reports them.
- **Evidence:**
  - [Maturing your smart contracts beyond private key risk](https://blog.trailofbits.com/2025/06/25/maturing-your-smart-contracts-beyond-private-key-risk/) — Trail of Bits (Benjamin Samuels), 2025 — engineering_blog.
    - Quotes: "43.8% of all funds stolen via hacks stemmed from compromised keys - more than any other verified attack type by a factor of five". Level 2: "the control point is still singular". Level 3 roles: core, operations, pause guardian (low threshold, no timelock), cancel guardian. Level 4: radical immutability.
    - Verified.
  - [$2.2 Billion Stolen from Crypto Platforms in 2024](https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2025/) — Chainalysis, 2024 — industry_report.
    - Quote: "Private key compromises accounted for the largest share of stolen crypto in 2024, at 43.8%."
    - Verified in the page HTML.
  - [Top 100 DeFi Hacks Report 2025](https://www.halborn.com/reports/top-100-defi-hacks-2025) — Halborn, 2025 — industry_report.
    - Quotes: "Off-chain incidents now account for 56.5% of attacks and 80.5% of funds lost in 2024". Top-100 hacks 2014–2024 ($10.77B total): "19% of protocols used multi-sig wallets", "2.4% relied on cold wallets".
    - Scope corrected.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quote: "[Q] Use TimeLock Delays for Sensitive Operations: Sensitive operations that affect all or a majority of users MUST use [TimeLock] delays."
    - Spec text searched.
  - [Code4rena Judging Criteria](https://docs.code4rena.com/competitions/judging-criteria.md) and [Severity Categorization](https://docs.code4rena.com/competitions/severity-categorization) — Code4rena, 2026 — official_docs.
    - Quotes: "Low risk and Governance/Centralization risk findings must be submitted as a *single* QA report per warden." "Reckless admin mistakes are invalid. Assume calls are previewed." "Direct misuse of privileges should be submitted within a QA report."
    - Verified from the markdown source.
  - [Immunefi Severity Classification v2.3](https://immunefi.com/immunefi-vulnerability-severity-classification-system-v2-3/) — Immunefi, n.d. — official_docs.
    - Quote: the default out-of-scope list includes "Impacts caused by attacks requiring access to leaked keys/credentials", "Impacts caused by attacks requiring access to privileged addresses", and "Impacts involving centralization risks".
    - Verified.
  - [Wintermute - REKT](https://rekt.news/wintermute-rekt-2/) — rekt.news, 2022 — incident_report.
    - Quote: "The vault only allows admins to do these transfers and Wintermute's hot wallet is an admin, as expected. Therefore, the contracts worked as expected but the admin address itself was likely compromised." Over $160M; Profanity vanity address.
    - Verified.
  - [Radiant Capital - REKT 2](https://rekt.news/radiant-capital-rekt2/) — rekt.news, 2024 — incident_report.
    - Quotes: "an 11-signer multi-sig wallet … only 3 signatures were required"; "drained over $53 million".
    - Verified.
  - [Cyfrin audit-checklist](https://github.com/Cyfrin/audit-checklist) — Cyfrin, 2024 — practitioner_forum.
    - Data: "Centralization Risk" is one of 13 top-level checklist categories.
    - Read from checklist.json.
- **Detect:** Run `slither . --print vars-and-auth`. On-chain, identify holders with `cast call <addr> 'owner()(address)'` or `hasRole(bytes32,address)`. `cast code <holder>` tells an EOA (empty code) from a contract. For Safes, read `getThreshold()` and `getOwners()`. Check for a timelock between the owner and sensitive setters. Cross-reference bot and keeper addresses against admin roles.
- **Tools:** slither, cast, manual review
- **Applies to:** Deployed protocols; hackathon contracts moving to mainnet; bots that own or administer contracts.
- **When not to apply / counterpoints:** Contest rubrics deliberately assume trusted admins because they audit code, not operations. Timelocks slow emergencies; ToB's L3 answers this with a pause guardian that has no timelock. Immutability rules out fixes.
- **Fix risk:** low

### G207-F12 — Invariant-testing recipe with handlers, metrics and a coverage-driven budget
- **Grade:** B · **Verdict:** CORRECTED
  - Dacian's post has 10 examples, but Example 1 comes from Damn Vulnerable DeFi; 9 come from private audits.
  - The Foundry "depth 100" is an example config in the invariant guide, not a stated default.
  - "5 to 15 invariants" has no source and is the skill's own choice.
- **Rule:**
  1. Write the invariants in plain English from the docs and F04: conservation, solvency, access, monotonicity. The count is the skill's choice; no source gives one.
  2. Build a Foundry handler-based suite. Handlers bound inputs, use several actors, and keep ghost variables for sums. Point `targetContract` at the handler and restrict it with `targetSelector`.
  3. Run at the Foundry defaults on every change (config reference: `runs=256`, `depth=500`, `fail_on_revert=false`, `shrink_run_limit=5000`, `show_metrics=true`). Read the metrics to confirm every handler selector is called and not mostly reverting.
  4. Reuse the properties through Chimera in Medusa or Echidna for longer, coverage-guided campaigns. Extend until coverage shows every value-moving branch reached.
  5. Measure property strength with mutation testing.
  6. Keep every counterexample as a regression unit test.
  
  Budget guidance from the tools themselves: run a short campaign per step, aim to reveal issues within 5 minutes with no upper bound, and use coverage to decide whether to extend. No source gives an hour count.
- **Rationale:** Hand-written properties are the lever beyond analyzers. The Echidna paper cites "up to 63%" of severe flaws for user-defined properties (an estimate from Groce et al. 2020, not a replicated measurement). SEAL asks for fuzzing "always where practical" and mutation testing. Trail of Bits has moved primary fuzzer development to Medusa.
- **Evidence:**
  - [Foundry config reference – testing](https://getfoundry.sh/config/reference/testing) — Foundry, 2026 — official_docs.
    - Data: invariant `runs` 256, `depth` 500 ("The number of calls executed to attempt to break invariants in one run"), `fail_on_revert` false, `shrink_run_limit` 5000, `show_metrics` true, `timeout` None.
    - Page text downloaded.
  - [Foundry – Invariant testing](https://getfoundry.sh/forge/invariant-testing) — Foundry, 2026 — official_docs.
    - Quotes: "Handlers wrap target contracts to constrain inputs and track state". The example `foundry.toml` sets `depth = 100 # Calls per run`. Mentions Foundry v1.7.0 options such as `check_interval`.
    - Page text downloaded. The 100 is an example value, not a default.
  - [Echidna: Effective, Usable, and Fast Fuzzing for Smart Contracts (ISSTA '20)](https://agroce.github.io/issta20.pdf) — Grieco, Song, Cygan, Feist, Groce, 2020 — peer_reviewed.
    - Quotes: "fuzzing using custom user-defined properties might detect up to 63% of the most severe and exploitable flaws in contracts"; "there is no upper bound on how long Echidna can run … Nonetheless, the goal of Echidna is to reveal issues to the user in less than 5 minutes"; "used in more than 10 large paid security audits".
    - Verified in the PDF.
  - [How to write good properties step by step](https://secure-contracts.com/program-analysis/echidna/basic/property-creation.html) — Trail of Bits, 2024 — official_docs.
    - Quotes: "start writing simple properties first and then improving them"; "At each step, you should run a short fuzzing campaign".
    - Verified.
  - [Echidna FAQ](https://raw.githubusercontent.com/crytic/building-secure-contracts/master/program-analysis/echidna/frequently_asked_questions.md) — Trail of Bits, 2024 — official_docs.
    - Quote: "monitoring the code coverage of your smart contracts can be a good way to determine if the fuzzing campaign should be extended."
    - Verified.
  - [Unleashing Medusa](https://blog.trailofbits.com/2025/02/14/unleashing-medusa-fast-and-scalable-smart-contract-fuzzing/) — Trail of Bits, 2025 — engineering_blog.
    - Quotes: "Parallel fuzzing: Scales seamlessly with your hardware"; "While we will continue maintaining Echidna for minor bug fixes, our primary focus now shifts to Medusa's evolution."
    - Verified.
  - [Chimera](https://github.com/Recon-Fuzz/chimera) — Recon, 2025 — official_docs.
    - Data: supports Foundry, Echidna, Medusa, Halmos and Kontrol; only HEVM-supported cheatcodes.
    - Verified.
  - [Find Highs Before External Auditors Using Invariant Fuzz Testing](https://dacian.me/find-highs-before-external-auditors-using-invariant-fuzz-testing) — Dacian (Cyfrin), 2024 — engineering_blog.
    - Quote: "Many high severity findings found during private audits by external auditors could have been found by the protocol developers themselves using invariant fuzz testing prior to engaging external auditors." 10 examples: 1 from Damn Vulnerable DeFi and 9 from private audits.
    - Count corrected.
  - [SEAL – Security Testing](https://frameworks.securityalliance.org/security-testing/overview) — SEAL, 2025 — industry_report.
    - Quotes: "Fuzz testing: always where practical; many unit tests can become fuzzer targets"; "Mutation testing: use to measure whether existing tests would catch realistic faults".
    - Verified.
- **Detect:**
  - Check for missing `function invariant_` with `rg -n 'function invariant_' -g '*.sol'`.
  - Handler-based suites contain `targetContract(address(handler))`.
  - Run `forge test --match-test invariant` and read the per-selector call and revert metrics. Zero calls, or about 100% reverts, is a gap.
  - Confirm the effective settings with `forge config | rg invariant`.
  - For Medusa, read the coverage HTML.
- **Tools:** forge, medusa, echidna, chimera
- **Applies to:** Every contract that holds or accounts for value. For hackathon code, at least steps 1–3.
- **When not to apply / counterpoints:** Fuzzers only find violations of the properties someone wrote. Balancer's formally verified solvency did not cover rounding (F13). Open, non-handler invariant tests waste calls on reverts. No published curve relates campaign length to yield.
- **Fix risk:** low

### G207-F14 — Arithmetic precision and rounding direction must favour the protocol
- **Grade:** B · **Verdict:** VERIFIED (OWASP quote wording aligned)
- **Rule:**
  - Multiply before dividing, including inside wmul/wdiv helpers.
  - Round in the protocol's favour: shares minted and assets paid out round down; fees and shares burned round up.
  - Normalise mixed-decimals tokens, and never hard-code 1e18 for arbitrary tokens.
  - Guard downcasts with SafeCast.
  - Handle zero-rounding: revert when a computed deduction rounds to 0.
  - Give ERC-4626 vaults an inflation defence: virtual shares/assets with `_decimalsOffset`, or a dead deposit.
  
  Maps to OWASP SC07/SC09 (2026).
- **Rationale:** OWASP SC07 cites zkLend (~$9.5M) and Bunni ($8.4M) in 2025. OpenZeppelin documents the donation attack and its defence. Dacian catalogues 7 precision-loss classes with contest findings. Balancer's $128M loss came from rounding direction.
- **Evidence:**
  - [SC07:2026 Arithmetic Errors](https://scs.owasp.org/sctop10/SC07-ArithmeticErrors/) — OWASP, 2026 — standard.
    - Quotes: "Clearly document and test your rounding strategy: Decide whether rounding should favor the protocol or users. Prove that repeated interactions cannot create "free value"." "Incorporate invariant checks: E.g., totalAssets vs. sum of user balances". "Use fuzz testing and differential testing". zkLend (February 2025, $9.5M): "A rounding error in the mint() function—integer division rounding down". Bunni (September 2025, $8.4M).
    - Page text downloaded.
  - [ERC-4626 (OpenZeppelin 5.x)](https://docs.openzeppelin.com/contracts/5.x/erc4626) — OpenZeppelin, 2025 — official_docs.
    - Data: rounding "takes away value from the user in favor of the vault"; the attack condition u < 1 + a₁/a₀; defence by decimal offset plus virtual assets and shares.
    - Verified.
  - [Precision Loss Errors](https://dacian.me/precision-loss-errors) — Dacian (Cyfrin), 2023 — engineering_blog.
    - Quotes: "always want to perform multiplication before division"; rounding "should always favor the protocol". 7 categories; cases Numoen, Cooler, Notional (~50% LP undervaluation), Yearn, SudoSwap.
    - Verified.
  - [Slither Detector Documentation](https://github.com/crytic/slither/wiki/Detector-Documentation) — Crytic, 2025 — official_docs.
    - Data: divide-before-multiply Medium/Medium, "Solidity's integer division truncates. Thus, performing division before multiplication can lead to precision loss."; incorrect-equality Medium/High.
    - Confirmed.
- **Detect:**
  - Run the Slither detectors `divide-before-multiply` and `incorrect-equality`.
  - Search with `rg -n 'uint(8|16|32|40|48|64|96|112|128|160|192|224)[(]' -g '*.sol'` for unchecked downcasts.
  - Search with `rg -n '1e18|10[*][*]18' -g '*.sol'` near token amounts.
  - For ERC-4626, check for `_decimalsOffset` or a dead deposit.
  - Record the intended rounding direction for each `mulDiv`.
- **Tools:** slither, ripgrep, forge (fuzz/differential tests)
- **Applies to:** Vaults, AMMs, lending, reward accrual, fee logic.
- **When not to apply / counterpoints:** Changing rounding shifts outputs by a few wei. That breaks exact-value tests and integrators, and on upgradeable systems it can create accounting discontinuities. Some user-favourable rounding is a deliberate UX choice with bounded cost.
- **Fix risk:** medium

### G207-F18 — Segregate keys by function and blast radius
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Bot and keeper hot keys hold only operational roles, never owner, admin, upgrader or minter.
  - Use separate keys per bot, per chain role and per environment.
  - Cap hot-wallet balances, with top-ups from a colder wallet.
  - Revoke roles and allowlist entries when a key or partner is retired.
  - Never use keys from vanity generators or other unvetted tools.
  
  On-chain role changes are report-only. Separate config entries per key are fixable in the repo.
- **Rationale:** Wintermute's vault-admin hot wallet had a Profanity vanity key, and over $160M was lost. At Ronin, an allowlist entry that "was never revoked" supplied the 5th of 9 validator signatures. ToB's Level 3 separates roles. OWASP applies least privilege to secrets, and Foundry separates keys by environment.
- **Evidence:**
  - [Wintermute - REKT](https://rekt.news/wintermute-rekt-2/) — rekt.news, 2022 — incident_report.
    - Quotes: "their hot wallet has been compromised, likely through the use of a vanity address, created with the vulnerable tool Profanity"; "the contracts worked as expected but the admin address itself was likely compromised."
    - Verified.
  - [Ronin Network - REKT](https://rekt.news/ronin-rekt/) — rekt.news, 2022 — incident_report.
    - Quotes: "the whitelist access was never revoked"; "We discovered the attack this morning after a report from a user being unable to withdraw 5k ETH from the bridge."
    - Verified.
  - [Maturing your smart contracts beyond private key risk](https://blog.trailofbits.com/2025/06/25/maturing-your-smart-contracts-beyond-private-key-risk/) — Trail of Bits, 2025 — engineering_blog.
    - Data: Level 3 core, operations, pause guardian and cancel guardian roles.
    - Verified.
  - [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — OWASP, 2025 — standard.
    - Quote: "Engineers should not have access to all secrets in the secrets management system, and the Least Privilege principle should be applied."
    - Verified.
  - [Foundry – Key management](https://getfoundry.sh/guides/best-practices/key-management) — Foundry, 2026 — official_docs.
    - Data: Anvil defaults locally, encrypted keystores for testnets, hardware wallets for mainnet.
    - Verified.
- **Detect:** Extract every signer address from bot and service configs. On-chain, check `owner()`, each `hasRole(...)` for admin, upgrader and minter, and each allowlist. A match with a bot address is a finding. Detect the same key shared across processes or environments. Search with `rg -n -i 'profanity|vanity' .`.
- **Tools:** cast, ripgrep, manual review
- **Applies to:** Trading, liquidation and keeper bots; market makers; protocols with automated signers.
- **When not to apply / counterpoints:** More keys means more nonce management (F21), funding and monitoring. A bot that must pause should get a narrow pause role, not owner.
- **Fix risk:** low

### G207-F19 — Scope centralized-exchange API keys to least privilege
- **Grade:** B · **Verdict:** CORRECTED (the researcher's first Binance quote, "the system-generated API Key's permission can only be set to [Enable Reading] if your IP is unrestricted", could not be confirmed; it is replaced with the wording WebFetch returned, since curl is blocked)
- **Rule:**
  - Monitoring keys are read-only.
  - Trading keys have withdrawals disabled.
  - If withdrawals are needed, require an IP allowlist, plus an address allowlist where the exchange offers one.
  - Use one key per bot or strategy, with an expiry where supported.
  - Store keys like passwords.
  
  Exchange-side settings are report-only. The skill checks code and config for a separate key per purpose and for key material in logs.
- **Rationale:** Binance gives unrestricted-IP keys read-only access and advises against anything more without IP restrictions. Kraken offers granular permissions, an IP whitelist and key expiry, and says to handle keys like login credentials.
- **Evidence:**
  - [How to create API keys on Binance](https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072) — Binance, 2026 — official_docs.
    - Quotes: "Unrestricted-IP-Access HMAC API Key(s) won't have any permission other than reading." "We strongly recommend against enabling API keys for permissions other than reading without defining the appropriate IP access restrictions."
    - WebFetch only (curl blocked). The second quote matches the researcher; the first replaces the researcher's wording.
  - [How to create an API key (Kraken, served in French)](https://support.kraken.com/hc/en-us/articles/360000919966-How-to-create-an-API-key) — Kraken, 2026 — official_docs.
    - Data: permissions include Withdraw, and order add/modify/cancel. Options: IP whitelist, nonce window, key expiration. Quote: "La clé API, la clé privée et le code QR doivent être gérés de la même manière que votre identifiant/mot de passe."
    - Verified.
- **Detect:** Search with `rg -n -i 'api[_-]?key|api[_-]?secret' --hidden -g '!node_modules'` for plaintext keys. Check that each bot reads its own key variable and that telemetry never serialises the exchange client config. Ask the owner, as a report item, to confirm on the exchange dashboard that withdrawals are off and an IP allowlist is set.
- **Tools:** ripgrep, exchange dashboard (manual)
- **Applies to:** CEX-DEX arbitrage, funding-rate and market-making bots, monitoring dashboards.
- **When not to apply / counterpoints:** IP allowlisting needs static egress IPs. Some strategies need automated withdrawals, and then address allowlists are the mitigation.
- **Fix risk:** low

### G207-F22 — Multisig admin actions need a documented signing procedure
- **Grade:** B · **Verdict:** VERIFIED (SEAL key takeaway quoted exactly)
- **Rule:** For admin actions executed through multisigs, require:
  - Independent calldata decoding and verification, outside the signing UI.
  - A comparison of the on-device Safe transaction hash with an independently computed one.
  - Dedicated signing devices.
  - Thresholds in proportion to the blast radius.
  - A timelock review window for sensitive operations.
  - Drilled playbooks for lost keys and for a compromised communication channel.
  
  Report-only. Flag the absence whenever F11 finds powers held by a multisig.
- **Rationale:** Bybit signers "saw the masked UI which showed the correct address", and $1.43B was lost (rekt; Chainalysis says $1.5B). Radiant used a 3-of-11 threshold. SEAL says multisigs "fail operationally more often than cryptographically".
- **Evidence:**
  - [SEAL – Multisig for Protocols](https://frameworks.securityalliance.org/multisig-for-protocols/overview) — Security Alliance, 2025 — industry_report.
    - Quotes: "Protocol multisigs fail operationally more often than cryptographically. Separate functions, match thresholds to blast radius, verify calldata—not just hashes—and drill emergency and backup paths." "Timelocks and review windows are intentional controls, not friction to bypass".
    - Page text downloaded.
  - [SEAL – Wallet Security](https://frameworks.securityalliance.org/wallet-security/overview) — Security Alliance, 2025 — industry_report.
    - Quote: "Wallet security is control of keys and verification of every signature. Hardware and multisig fail if users sign attacker-controlled calldata blindly."
    - Page text downloaded.
  - [Bybit - REKT](https://rekt.news/bybit-rekt/) — rekt.news, 2025 — incident_report.
    - Quotes: "It appears that this specific transaction was masked, all the signers saw the masked UI which showed the correct address and the URL was from Safe." "$1.43 billion gone!"
    - Verified.
  - [Crypto Crime Mid-year Update 2025](https://www.chainalysis.com/blog/2025-crypto-crime-mid-year-update/) — Chainalysis, 2025 — industry_report.
    - Quote: "The DPRK's $1.5 billion hack of ByBit, the largest single hack in crypto history, accounts for the majority of service losses"; over $2.17B stolen from services in 2025 so far.
    - Verified.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quote: "Sensitive operations that affect all or a majority of users MUST use [TimeLock] delays."
    - Verified.
- **Detect:** Look for a SIGNING.md, runbook or IR doc covering calldata verification, thresholds, timelocks and key loss. On-chain, read the Safe threshold and owner count, and check for a timelock between the Safe and sensitive setters.
- **Tools:** cast, manual review
- **Applies to:** Protocols and treasuries whose admin powers sit in Safe or Squads multisigs.
- **When not to apply / counterpoints:** Timelocks and high thresholds slow incident response; ToB's answer is a low-threshold pause guardian. Small teams cannot staff many independent signers.
- **Fix risk:** low

### G207-F23 — Cross-chain handlers must authenticate source and never trust default values
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** For bridge and cross-chain code:
  - Authenticate every inbound message by source chain, source sender and endpoint `msg.sender`.
  - Make sure no default or zero value (root, confirmAt, validator, sender) can count as proven.
  - Bind replay protection to chainId plus a per-message nonce or processed hash.
  - Review validator, relayer and allowlist sets for stale members.
  - Treat any upgrade that touches message validation as new code (F24).
- **Rationale:** Nomad's `0x00` trusted root made "all messages … valid by default" ($190M). Ronin needed 5 of 9 validators and got one through a stale allowlist entry (~$624M). OWASP names cross-chain assumptions and routers as risk areas, and says cross-chain "owner" concepts must be verified on-chain.
- **Evidence:**
  - [Nomad Bridge - REKT](https://rekt.news/nomad-rekt/) — rekt.news, 2022 — incident_report.
    - Quote: "The 0x00 address was set as a trusted root, meaning that all messages were read as valid by default."
    - Verified.
  - [Ronin Network - REKT](https://rekt.news/ronin-rekt/) — rekt.news, 2022 — incident_report.
    - Quotes: "Of these nine validators, a consensus of five is necessary"; four were run by Sky Mavis, and the fifth came via the Axie DAO whitelist that "was never revoked".
    - Verified.
  - [SC02:2026 Business Logic Vulnerabilities](https://scs.owasp.org/sctop10/SC02-BusinessLogicVulnerabilities/) — OWASP, 2026 — standard.
    - Quote: "Cross-module and cross-chain assumptions (e.g., bridge liquidity, L2 finality, message ordering)".
    - Verified.
  - [SC01:2026 Access Control](https://scs.owasp.org/sctop10/SC01-AccessControlVulnerabilities/) — OWASP, 2026 — standard.
    - Quote: "Any cross-chain or cross-module 'owner' concept must be verified on-chain, not assumed from message origin."
    - Verified.
  - [Signature Replay Attacks](https://dacian.me/signature-replay-attacks) — Dacian (Cyfrin), 2023 — engineering_blog.
    - Data: cross-chain replay findings Biconomy (C4 2023-01), Harpie (Sherlock 2022-09), Unlimited Network.
    - Verified.
- **Detect:** Find the inbound handlers, for example with `rg -n 'lzReceive|ccipReceive|receiveWormholeMessages|_execute[(]|handle[(]uint32|onMessage' -g '*.sol'`; these names are only examples. For each handler, check the endpoint `msg.sender`, the source chain and sender allowlist, and replay marking. Look for acceptance checks that a default 0 could satisfy, such as `confirmAt[root] != 0`. On-chain, compare validator and relayer sets with the active operators.
- **Tools:** ripgrep, cast, manual review
- **Applies to:** Bridges, omnichain tokens (OFT/CCIP/Wormhole), cross-chain governance, messaging receivers.
- **When not to apply / counterpoints:** Much bridge risk lies in validator key custody (F17, F18, F22). Messaging-framework defaults vary by version, so check the framework docs for the version in use.
- **Fix risk:** high

### G207-F24 — Changed, upgraded or out-of-scope code is unaudited
- **Grade:** B · **Verdict:** CORRECTED
  - Euler's `donateToReserves` *was* reviewed. Sherlock reviewed EIP-14, missed the bug, and paid a $4.5M claim. So Euler shows that a narrower review of a later change missed it, not that the code was never audited.
  - Halborn's "20% audited / 10.8% of value" covers the top-100 hacks of 2014–2024, not 2024 victims.
  - "Audits help" is softened: Halborn's figures are correlational.
- **Rule:** Treat as needing full review:
  - Code changed after the last audit baseline.
  - Every upgrade transaction.
  - Dependencies and math libraries outside the audit's stated scope.
  
  Record the audit commit, the scope list and every out-of-scope import. For deployed contracts, classify each fix as source-only for the next deploy, requires upgrade (then F09/F10 apply), or requires migration.
- **Rationale:** Several of the largest losses sat in code added or changed after the original audits, or excluded from scope:
  - Euler: a later eIP-14 change whose separate review missed the bug.
  - Nomad: a routine June upgrade, with the audit's QSP-19 foreshadowing the flaw.
  - Cetus: an out-of-scope library, in an audit finished 41 days earlier.
  - Balancer: over a dozen audits, yet the rounding path fell outside what was proven.
  
  EthTrust says certifying a proxy does not cover upgraded logic.
- **Evidence:**
  - [Euler Finance - REKT](https://rekt.news/euler-rekt/) — rekt.news, 2023 — incident_report.
    - Quotes: "Sherlock has taken responsibility for missing the vulnerability in their review of EIP-14 last year, and will pay a claim of $4.5M"; "one of Euler's six auditors".
    - Verified; this corrects the researcher's framing.
  - [Cetus - REKT](https://rekt.news/cetus-rekt/) — rekt.news, 2025 — incident_report.
    - Quotes: Zellic: "the vulnerability was part of the integer-mate library in the checked_shlw method. But the integer-mate library was not included in the scope of our audit." "wasn't even in the audit scope completed just 41 days earlier". Per Verichains, Kriya and FlowX had "same bug"; Turbo Finance had the "vulnerable code present but unused". Turbos disputes that it was exploitable.
    - Verified. Cetus is Sui/Move, not EVM; the lesson about scope transfers.
  - [Top 100 DeFi Hacks Report 2025](https://www.halborn.com/reports/top-100-defi-hacks-2025) — Halborn, 2025 — industry_report.
    - Quote: "Only 20% of hacked protocols were audited"; "Audited protocols accounted for 10.8% of the total value lost". This is the top-100 set, 2014–2024, $10.77B.
    - Scope corrected. The figures are correlational: the sample contains only hacked protocols.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, 2025 — standard.
    - Quote: "EEA EthTrust Certification of a Proxy Contract does not apply to the internal logic of an Upgradable Contract, so a new Execution Contract needs to be certified before upgrading to it".
    - Spec text searched.
  - [Nomad Bridge - REKT](https://rekt.news/nomad-rekt/) — rekt.news, 2022 — incident_report.
    - Quotes: "Following a routine upgrade in June, the bridge's Replica contract was initialised with a fatal security flaw"; "completed a Quantstamp audit in June, with issue QSP-19 foreshadowing a similar vulnerability".
    - Verified.
- **Detect:** Find the audited commit and run `git diff <audited_commit>..HEAD --stat -- src/ contracts/`; every changed file gets the full checklist. Compare the audit's scope table with `rg -n '^import' -g '*.sol'` and the remappings or `lib/`. For deployed contracts, compare `cast implementation <proxy>` with the verified source of the audited commit.
- **Tools:** git, ripgrep, cast
- **Applies to:** Projects with prior audits, upgrades, or vendored or forked math libraries.
- **When not to apply / counterpoints:** Full re-review is costly; a diff-scoped review is the proportionate minimum. Audits still correlate with lower losses in Halborn's sample, even with blind spots outside their scope.
- **Fix risk:** low

### G207-F02 — Run the manual review in a fixed, logged order
- **Grade:** C · **Verdict:** VERIFIED (practitioner convention; no study compares orderings)
- **Rule:** Review in a fixed order and log what each step produces:
  1. Docs, README and NatSpec: extract the invariants, trust assumptions, tokens and chains. Where the README and code comments conflict, the README wins (Sherlock).
  2. Actor and privilege map (F03, F11).
  3. Value-moving paths against the accounting invariants (F04).
  4. External dependencies: oracles (F05), tokens and external calls (F15), bridges (F23).
  5. Signatures (F06), ordering and MEV (F07), DoS (F08).
  6. Upgradeability and initialization (F09, F10).
  7. Arithmetic (F14).
  8. An adversarial pass from each actor's point of view.
  9. Test and coverage gaps, then the tools.
  10. Comparison with past findings on similar protocols.
  
  OWASP SC 2026 mapping: SC01→F03/F11, SC02→F04, SC03/SC04→F05, SC05→F03/F04, SC06/SC08→F15, SC07/SC09→F14, SC10→F09/F10. Step 1 corresponds to EthTrust [Q] Document Contract Logic, [Q] Document System Architecture and [Q] Implement as Documented.
- **Rationale:** Solcurity prescribes docs → mental model → architecture → threat model → value-exchange functions → external interfaces → line-by-line → per-actor review → tests and coverage → tools → related audits. The Cyfrin checklist opens with "Attacker's Mindset". Starting with logic matches the loss data (F01).
- **Evidence:**
  - [Solcurity](https://github.com/transmissions11/solcurity) — transmissions11 (originally Rari Capital; the old URL redirects), 2021 — practitioner_forum.
    - Quote: "Read the project's docs, specs, and whitepaper … Create a threat model … Look at areas that can do value exchange … Look at areas that interface with external contracts … Do a generic line-by-line review … Do another review from the perspective of every actor … Glance over the project's tests + code coverage … Run tools like Slither/Solhint … Look at related projects and their audits".
    - Verified.
  - [Cyfrin audit-checklist](https://github.com/Cyfrin/audit-checklist) — Cyfrin / Solodit, 2024 — practitioner_forum.
    - Data: derived from 13 named auditor checklists. 13 top-level categories, the first "Attacker's Mindset", then "Basics", with Centralization Risk, Defi, External Call, Signature and others. SOL-Basics-AC-1 "Did you clarify all the actors and their allowed interactions in the protocol?"
    - Read from checklist.json.
  - [Sherlock Judging Guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, 2025 — official_docs.
    - Quote: "In cases where there is a contradiction between the README and CODE COMMENTS, the README should be considered the primary source of truth. The judge can decide that CODE COMMENTS are outdated. In that case, the default guidelines apply." "The protocol team can use the README (and only the README) to define the protocol's invariants/properties."
    - Verified.
  - [EEA EthTrust Security Levels v3](https://entethalliance.github.io/wg-ethtrust-site/spec/v3/) — EEA, March 2025 — standard.
    - Quotes: "[Q] Document Contract Logic: Tested Code MUST be accompanied by documentation that describes what the contract is intended to do"; "[Q] Implement as Documented: Tested Code MUST implement the contract logic as described in [Q] Document Contract Logic".
    - Spec text searched.
  - [OWASP Smart Contract Top 10: 2026](https://scs.owasp.org/sctop10/) — OWASP, 2026 — standard.
    - Data: the SC01–SC10 names; "122 smart-contract incidents (deduplicated) … ≈ $905.4M in 2025".
    - Verified.
- **Detect:** Manual. Three artefacts are required: (a) invariants and assumptions quoted from the docs, (b) an actor/privilege table, and (c) a log marking each OWASP SC01–SC10 item as checked, not applicable, or finding. Any missing artefact is a process violation.
- **Tools:** manual review, Solodit / Cyfrin checklist
- **Applies to:** Every manual review of finished contracts. Scale the depth to the value at risk.
- **When not to apply / counterpoints:** No empirical study compares orderings. Hackathon code often has no docs, so step 1 means reconstructing intent from tests.
- **Fix risk:** low

### G207-F13 — Escalate to symbolic or formal tools only for math-heavy or insolvency-critical code, and list what was abstracted
- **Grade:** C · **Verdict:** VERIFIED (note: Cetus is Sui/Move, so the scope lesson transfers but its tooling does not)
- **Rule:** Escalate beyond fuzzing only in two cases:
  - Pure or math-heavy code where random sampling rarely reaches edge cases: fixed-point and share conversion, tick or curve math, rounding, custom overflow checks.
  - Protocols where one violated invariant means insolvency.
  
  How to use the tools:
  - For Halmos or Kontrol, reuse the Foundry tests.
  - Treat the results as bounded: loops are unrolled to a bound and dynamic arrays get a fixed size.
  - In Halmos, prefer `vm.assume` over `bound()`, and remember that only `Panic(1)` assertion failures are reported.
  - Use Certora/CVL for the core invariants of high-TVL systems.
  
  Always list what was abstracted or summarised, and treat excluded libraries as unverified.
- **Rationale:** Halmos "prioritizes automation over completeness", and Kontrol supports loop invariants and bounded model checking. SEAL calls formal verification situation-dependent, "especially math-heavy logic". Balancer ($128M) and Cetus ($223M) both failed in math that the proofs or audits did not cover.
- **Evidence:**
  - [Symbolic testing with Halmos](https://a16zcrypto.com/posts/article/symbolic-testing-with-halmos-leveraging-existing-tests-for-formal-verification/) — a16z crypto (Daejun Park), 2023 — engineering_blog.
    - Quotes: "Halmos symbolically iterates this unbounded loop only up to a specified bound"; "Halmos prioritizes automation over completeness"; found an overflow bug in an earlier ERC721A.
    - Verified.
  - [Halmos getting started](https://raw.githubusercontent.com/a16z/halmos/main/docs/getting-started.md) — a16z, 2025 — official_docs.
    - Quotes: "Halmos requires dynamically-sized arrays (including `bytes` and `string`) to be given with a fixed size"; "In symbolic tests, avoid using `bound()` as it tends to perform poorly"; "Only assertion violations, that is, `Panic(1)` errors, are reported, whereas other errors such as arithmetic overflows are disregarded."
    - Read from the markdown.
  - [Kontrol documentation](https://docs.runtimeverification.com/kontrol) — Runtime Verification, 2025 — official_docs.
    - Quote: "Kontrol is built on the open-source, validated, and intuitive formal semantics of Ethereum Virtual Machine (EVM) bytecode, KEVM"; supports "lemmas, loop invariants, and bounded model checking".
    - Verified.
  - [Balancer - REKT II](https://rekt.news/balancer-rekt2/) — rekt.news, 2025 — incident_report.
    - Quotes: "The _upscale() function only used mulDown - always rounding in one direction regardless of context." "Over a dozen audit reports" from OpenZeppelin, Trail of Bits, Certora and ABDK. "Certora's 2022 audit proved solvency. It abstracted away StableMath functions to simplify proofs." Trail of Bits flagged rounding in 2021 (TOB-BALANCER-004) but "couldn't definitively determine whether the identified rounding behavior was exploitable".
    - Page text downloaded.
  - [Cetus - REKT](https://rekt.news/cetus-rekt/) — rekt.news, 2025 — incident_report.
    - Data: $223M drained, $162M frozen. Zellic: integer-mate "was not included in the scope of our audit."
    - Verified.
  - [SC07:2026 Arithmetic Errors](https://scs.owasp.org/sctop10/SC07-ArithmeticErrors/) — OWASP, 2026 — standard.
    - Quote: "Use fuzz testing and differential testing to discover edge cases around small/large values and repeated operations." zkLend and Bunni cases.
    - Verified.
  - [SEAL – Security Testing](https://frameworks.securityalliance.org/security-testing/overview) — SEAL, 2025 — industry_report.
    - Quote: "Formal verification: situation-dependent—especially math-heavy logic, critical invariants, or parity with a reference model".
    - Verified.
- **Detect:** A manual scoping table. List every math and library file imported, including vendored ones, and mark each as fuzzed, symbolically checked, formally verified or unverified. For Certora, grep `.spec` and `.conf` files for summaries (NONDET, DISPATCHER, ALWAYS) and harness abstractions. For Halmos, record the `--loop` bound.
- **Tools:** halmos, kontrol, certora prover, forge
- **Applies to:** AMM and stableswap math, interest and index math, ERC-4626 conversions, custom fixed-point libraries, high-TVL protocols.
- **When not to apply / counterpoints:** Formal methods are expensive and need expertise. Bounded results and summaries can give false confidence, as they did at Balancer. For hackathon-scale code, F12 is the better use of time. No source compares the yield of Halmos, Kontrol and Certora on finished code.
- **Fix risk:** low

### G207-F16 — Grade findings with a published impact scale, state the likelihood precondition, and keep operational risk separate
- **Grade:** C (was B) · **Verdict:** DOWNGRADED
  - Why downgraded: combining Immunefi impact classes with the CodeHawks likelihood matrix and Sherlock's thresholds is the researcher's own synthesis, not a published method. Sherlock states: "Likelihood is not considered when identifying the severity and the validity of the report."
  - Corrections: the Code4rena Medium definition is now quoted in full. Immunefi v2.3 carries no date on its page, so "2023" is unverified. Immunefi's out-of-scope defaults are added.
- **Rule:** Every contract finding carries:
  - An impact class quoted from Immunefi v2.3 Smart Contracts:
    - Critical: direct theft of user funds other than unclaimed yield, permanent freezing, protocol insolvency.
    - High: theft of unclaimed yield, temporary freezing.
    - Medium: unable to operate for lack of token funds, griefing.
    - Low: fails to deliver promised returns without losing value.
  - The attack precondition written out, and a likelihood level following CodeHawks: direct call = High, special conditions such as a non-standard token = Medium, rare circumstances = Low.
  - Optionally the CodeHawks matrix cell.
  - Where a loss can be quantified, Sherlock's test: High above 1% and $10; Medium above 0.01% and $10.
  
  Also:
  - Apply Sherlock's DoS rule (more than a week, or time-sensitive).
  - Apply Code4rena's bar: High needs an attack path "that does not have hand-wavy hypotheticals".
  - Downgrade front-running on private-mempool chains.
  - Keep admin, centralisation and key-compromise risks in a separate operational section (F11).
  - Say which platform's rubric a grade follows, because the platforms disagree about likelihood.
- **Rationale:** These are the published, widely used severity scales for smart-contract findings. They are useful anchors but were built to settle contest and bounty payouts. The operational carve-out is needed because all three platforms exclude or down-rank admin and key risks by default.
- **Evidence:**
  - [Immunefi Vulnerability Severity Classification System v2.3](https://immunefi.com/immunefi-vulnerability-severity-classification-system-v2-3/) — Immunefi, n.d. — official_docs.
    - Quotes: Critical "Direct theft of any user funds, whether at-rest or in-motion, other than unclaimed yield", "Permanent freezing of funds", "Protocol insolvency"; High "Theft of unclaimed yield", "Temporary freezing of funds"; Medium "Smart contract unable to operate due to lack of token funds", "Griefing"; Low "Contract fails to deliver promised returns, but doesn't lose value". The default out-of-scope list includes "Impacts involving centralization risks".
    - Page text downloaded.
  - [Sherlock Judging Guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, 2025 — official_docs.
    - Quotes: "Direct loss of funds without (extensive) limitations of external conditions"; "Users lose more than 1% and more than $10 of their principal"; Medium "more than 0.01% and more than $10"; "Likelihood is not considered when identifying the severity and the validity of the report." "Design decisions are not valid issues." "Chain re-org and network liveness issues are not valid." "Admin functions are generally assumed to be used correctly".
    - Page text downloaded.
  - [Code4rena Severity Categorization](https://docs.code4rena.com/competitions/severity-categorization) — Code4rena, 2026 — official_docs.
    - Quotes: High "Assets can be stolen/lost/compromised directly (or indirectly if there is a valid attack path that does not have hand-wavy hypotheticals)." Medium "Assets not at direct risk, but the function of the protocol or its availability could be impacted, or leak value with a hypothetical attack path with stated assumptions, but external requirements." "Reckless admin mistakes are invalid. Assume calls are previewed."
    - Read from the markdown source.
  - [How to evaluate a finding severity](https://docs.codehawks.com/hawks-auditors/how-to-evaluate-a-finding-severity) — CodeHawks (Cyfrin), 2025 — official_docs.
    - Data: matrix H/H=H, H/M=H/M, H/L=M, M/M=M, M/L=M/L, L/L=L. Likelihood examples: "a hacker can call a function directly", "a peculiar ERC20 token is used", "a hard-to-change variable is set to a unique value on a specific block". Quote: "there remains a degree of subjectivity in classifying findings".
    - Verified.
- **Detect:** A finding without a written attack path cannot be High. A finding without an Immunefi impact class, or without the platform named for its severity, is incomplete.
- **Tools:** manual review
- **Applies to:** All contract findings the skill produces. Off-chain findings use the operational section plus Immunefi's Websites and Apps classes.
- **When not to apply / counterpoints:** These rubrics bake in contest assumptions (trusted admins, invalid reorgs, likelihood ignored at Sherlock) that do not hold in operations. The Cantina rubric returned 404 and is not included.
- **Fix risk:** low

### G207-F20 — Do not base value-moving off-chain decisions on a single RPC response
- **Grade:** C · **Verdict:** VERIFIED (rests on official docs; no loss data)
- **Rule:** For liquidations, arbitrage, deposit confirmation before release, and oracle or pool reads:
  - Use a quorum of independent providers (for example ethers v6 `FallbackProvider` with quorum ≥ 2) or your own node, or cross-check critical reads.
  - Read at a `finalized` or `safe` tag before irreversible actions.
  - Send MEV-sensitive transactions privately (F07).
  
  Fixable behind a config flag: provider quorum and block tag. Report-only: running your own node.
- **Rationale:** ethers documents quorum as "security by requiring multiple backends to aggree". ethereum.org: your own node means you "don't have to rely on any other nodes". Sherlock treats reorg and liveness issues as invalid, so contest-audited code may never have been checked for them.
- **Evidence:**
  - [ethers v6 FallbackProvider](https://docs.ethers.org/v6/api/providers/fallback-provider/) — ethers.js, 2026 — official_docs.
    - Quotes: "manages several Providers providing resilience by switching between slow or misbehaving nodes, security by requiring multiple backends to aggree and performance by allowing faster backends to respond earlier"; quorum: "The number of backends that must agree on a value before it is accpeted." (original spelling)
    - Verified.
  - [Nodes and clients](https://ethereum.org/en/developers/docs/nodes-and-clients/) — ethereum.org, 2026 — official_docs.
    - Quote: "Your node verifies all the transactions and blocks against consensus rules by itself. This means you don't have to rely on any other nodes in the network or fully trust them."
    - Verified.
  - [cast implementation (block tags)](https://getfoundry.sh/cast/reference/implementation) — Foundry, 2026 — official_docs.
    - Quote: `-B` accepts "earliest, finalized, safe, latest, or pending".
    - Verified.
  - [Sherlock Judging Guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, 2025 — official_docs.
    - Quote: "Chain re-org and network liveness issues are not valid."
    - Verified.
- **Detect:** Search with `rg -n 'JsonRpcProvider[(]|WebSocketProvider[(]|createPublicClient[(]|http[(]|FallbackProvider[(]|fallback[(]' -g '*.ts' -g '*.js' -g '*.py'`. For each value-moving path, count the independent providers; a single vendor URL is the finding. Check the block tag; a default of `latest` before irreversible actions is the finding.
- **Tools:** ripgrep, manual review
- **Applies to:** Liquidation, keeper and arbitrage bots; bridges and relayers; deposit watchers.
- **When not to apply / counterpoints:** A quorum adds latency and can lose competitive races. Vendors may share upstream infrastructure. Waiting for finality delays action. No loss data on RPC-caused losses was found.
- **Fix risk:** medium

### G207-F21 — One nonce authority per hot key
- **Grade:** C · **Verdict:** CORRECTED (the Kraken "nonce window" analogy was removed from the rationale: it governs exchange API request ordering, which is a different mechanism from EVM account nonces)
- **Rule:**
  - Each hot key has exactly one nonce authority: a serialized nonce manager in one process, or a relayer.
  - Never let two instances sign with the same key using independently fetched nonces.
  - On nonce errors, resync from the chain.
  - Replace stuck transactions at the same nonce with a bumped fee.
  
  Fixable: wrap the signer in a nonce manager or route it through a relayer. Report-only: consolidating deployments that share a key.
- **Rationale:** ethers' NonceManager exists to guarantee "serialized and sequential nonces" and has `reset()`. viem's nonce manager handles parallel sends, but only for local accounts. OZ Relayer lists nonce management as a core feature.
- **Evidence:**
  - [ethers v6 NonceManager](https://docs.ethers.org/v6/api/providers/#NonceManager) — ethers.js, 2026 — official_docs.
    - Quotes: "A NonceManager wraps another Signer and automatically manages the nonce, ensuring serialized and sequential nonces are used during transaction." reset(): "Resets the nonce, causing the NonceManager to reload the current nonce from the blockchain on the next transaction."
    - Verified.
  - [viem createNonceManager](https://viem.sh/docs/accounts/local/createNonceManager) — viem, 2026 — official_docs.
    - Quote: "A Nonce Manager can only be used with Local Accounts (ie. Private Key, Mnemonic, etc)"; the example uses `Promise.all`.
    - Verified.
  - [OpenZeppelin Relayer](https://docs.openzeppelin.com/relayer) — OpenZeppelin, 2026 — official_docs.
    - Quote: "Transaction Nonce Management: Handle nonce management to ensure transaction order"; stable v1.5.x.
    - Verified.
- **Detect:** Search with `rg -n 'getTransactionCount[(]|nonce *:' -g '*.ts' -g '*.js' -g '*.py'`; per-call nonces inside concurrent code (`Promise.all`, worker pools) are a finding. Check manifests for more than one replica sharing one key. Check that error handlers recognise nonce errors and resync.
- **Tools:** ripgrep, manual review
- **Applies to:** Any bot or backend that sends transactions from an EOA.
- **When not to apply / counterpoints:** An in-memory manager is lost on restart and must resync. Relayers add a dependency. No loss data specific to nonce handling was found.
- **Fix risk:** medium

## Practitioner voice

- [Audius - REKT](https://rekt.news/audius-rekt/) — An 18.56M AUDIO (~$6M, ~$1M realised) governance takeover through a proxy/Initializable storage collision, after audits by Kudelski and OpenZeppelin. rekt: "the vulnerability is a known issue". Known pitfalls pass audits unless a layout check is actually run.
- [Nomad Bridge - REKT](https://rekt.news/nomad-rekt/) — $190M drained in about two and a half hours after a routine upgrade's initialization made `0x00` a trusted root. Quantstamp's QSP-19 had foreshadowed it, and the auditor wrote "We believe the Nomad team has misunderstood the issue".
- [Euler Finance - REKT](https://rekt.news/euler-rekt/) — ~$197M lost through `donateToReserves`, added by EIP-14, which skipped the donor's debt-health check. Euler had six auditors, and Sherlock paid $4.5M for missing the bug in its EIP-14 review.
- [Balancer - REKT II](https://rekt.news/balancer-rekt2/) — $128M lost in November 2025 through one-directional rounding in `_upscale()`, despite over a dozen audit reports. Trail of Bits flagged similar rounding in 2021 but could not prove it exploitable, and Certora's 2022 proofs abstracted StableMath.
- [Cetus - REKT](https://rekt.news/cetus-rekt/) — $223M drained ($162M frozen) through `checked_shlw` in the integer-mate library, which Zellic says was outside its audit scope. Per Verichains, Kriya and FlowX had the same bug, and Turbo had it present but unused. Shared math libraries are systemic risk.
- [Wintermute - REKT](https://rekt.news/wintermute-rekt-2/) — Over $160M lost through a Profanity vanity key on a hot wallet that was also vault admin: "the contracts worked as expected but the admin address itself was likely compromised."
- [Bybit - REKT](https://rekt.news/bybit-rekt/) — $1.43B lost after signers approved a masked Safe transaction. A practitioner quoted by rekt: "There is a name for this and it's BLIND SIGNING."
- [Radiant Capital - REKT 2](https://rekt.news/radiant-capital-rekt2/) — Over $53M lost with an 11-signer multisig that needed only 3 signatures. It was Radiant's second incident of 2024.
- [Ronin Network - REKT](https://rekt.news/ronin-rekt/) — ~$624M lost through 5 of 9 validators, one via an allowlist entry that "was never revoked". "Nobody noticed for six days", until a user could not withdraw.
- [Two Rights Might Make A Wrong](https://samczsun.com/two-rights-might-make-a-wrong/) — samczsun: ~$350M at risk in MISO because `msg.value` persisted across a `delegatecall` batch loop. "Safe components can come together to make something unsafe."
- [The Dangers of Surprising Code](https://samczsun.com/the-dangers-of-surprising-code/) — `_safeMint`'s receiver callback allowed re-entry, so an attacker could mint 39 Hashmasks against a cap of 20. Functions named "safe" can hide external calls.
- [Find Highs Before External Auditors Using Invariant Fuzz Testing](https://dacian.me/find-highs-before-external-auditors-using-invariant-fuzz-testing) — A Cyfrin auditor shows 10 invariant-fuzzing examples, 9 of them from private audits, of High and Critical bugs that developers could have found themselves.
- [Signature Replay Attacks](https://dacian.me/signature-replay-attacks) — Recurring signature bugs catalogued from Code4rena, Sherlock and Cyfrin reports: missing nonce, chainId, parameter or expiry; unchecked `ecrecover` zero address; malleability.
- [Contract upgrade anti-patterns](https://blog.trailofbits.com/2018/09/05/contract-upgrade-anti-patterns/) — Josselin Feist (Trail of Bits, 2018): "We strongly advise against the use of these patterns for upgradable smart contracts"; recommends migration. A dated dissent.
- [Maturing your smart contracts beyond private key risk](https://blog.trailofbits.com/2025/06/25/maturing-your-smart-contracts-beyond-private-key-risk/) — Benjamin Samuels (Trail of Bits, 2025): the industry over-focuses on code bugs while key compromise dominates theft. Proposes a 4-level admin-control maturity model.
- [The Proxy Hack](https://audita.io/blog-articles/the-proxy-hack-uninitialized-contracts-costing-defi-10m-in-losses) — Automated scanning for uninitialized ERC-1967 proxies, dormant backdoors, and $10M+ drained including Kinto's $1.55M. Deploy and initialize atomically.
- [Chaliasos et al. survey](https://arxiv.org/abs/2304.02981) — Of 49 practitioners surveyed, 38.1% of auditors rated tools 1–2 out of 5 for helpfulness. 76% spend at most 20% of audit time on tools. Developers and auditors both want better coverage of logic bugs and oracle manipulation.

## Contradictions and open questions

**Contradictions:**
1. **How much can tools find?**
   - Default detectors catch very little: Chaliasos found 8% of 127 attacks, all reentrancy. Zhang et al. put 79.5% of in-scope exploitable bugs (271/341 Code4rena, 35/44 exploits) beyond existing tools.
   - With human-written properties, tools reach much more: Trail of Bits 2019 estimated about 78% of its most important findings were reachable, and the Echidna paper cites "up to 63%".
   - Reconciliation: the low numbers measure off-the-shelf detectors on exploits. The high numbers assume properties written by people.
2. **Admin risk.**
   - Contest and bounty rubrics exclude or down-rank admin and key risk:
     - Code4rena: "Reckless admin mistakes are invalid", and centralisation goes in QA.
     - Sherlock: admin functions are "assumed to be used correctly".
     - Immunefi's defaults: "Impacts involving centralization risks" and "leaked keys/credentials" are out of scope.
   - Loss data says keys dominate: Chainalysis 43.8% of 2024 theft; Halborn 80.5% of 2024 DeFi losses off-chain. Hence the separate section in F11/F16.
3. **Severity method.** CodeHawks grades impact × likelihood. Sherlock states "Likelihood is not considered when identifying the severity". F16's combined scheme is a synthesis, so a grade must name the rubric it follows.
4. **Balancer V2 (Nov 2025, ~$128M) is classified two ways.** OWASP SC01:2026 files it under access control (`manageUserBalance`). rekt.news attributes the root cause to one-directional rounding in `_upscale()` and describes `manageUserBalance(WITHDRAW_INTERNAL)` only as the extraction step. OWASP category statistics are noisy as a result.
5. **Upgradeability.** Trail of Bits (2018) "strongly advise[s] against" delegatecall proxies and favours migration. OWASP SC10:2026 and OpenZeppelin treat audited proxy patterns as standard practice. Slither's own upgradeability wiki still links the 2018 post.
6. **Environment variables.**
   - OWASP discourages env vars for secrets.
   - Foundry: "Store keys encrypted, not as plaintext environment variables".
   - OZ Relayer still suggests env vars and service accounts for service credentials.
   - The practical line: env vars may hold KMS or service credentials, not raw signing keys.
7. **Signature malleability.** OZ 5.x ECDSA rejects high-s signatures today, but marks this "DEPRECATED and will be removed in v6.0" and says not to use signatures as unique identifiers. Any rule or code that relies on malleability rejection for replay protection will break on OZ v6.
8. **Foundry depth.** The config reference default is `depth = 500`. The invariant guide's example `foundry.toml` sets `depth = 100`. The latter is an example, not a default, but copying it cuts depth fivefold. Check with `forge config`.
9. **Audits and losses.**
   - In Halborn's top-100 hacks (2014–2024), only 20% of hacked protocols were audited and they account for 10.8% of value lost.
   - Yet the largest single losses were audited: Euler, Balancer, Nomad, Audius, Cetus.
   - These reconcile through scope and post-audit changes (F24). Halborn's numbers cannot show causation, because the sample contains only hacked protocols.
10. **EthTrust naming drift.** v3 renamed [Q] Protect against Front-Running to [Q] Protect against Ordering Attacks. "Signature Management" is a section heading, not a requirement. A skill quoting v2 names will cite requirements that no longer exist.

**Open questions (still unresolved):**
- No external source gives a numeric budget (hours, runs, CPU) or a yield curve for invariant or fuzz campaigns on finished code. Hour figures and invariant counts would be the skill's own choice.
- No comparable yield or cost data was found for Halmos, Kontrol and Certora on finished codebases.
- Forum-level practitioner voice is missing: HN returned 429, Reddit and Ethereum StackExchange were blocked, and WebSearch was exhausted. So are Code4rena "Supreme Court" verdicts and the Cantina severity page (404).
- Whether Trace2Inv's 18 of 27 result replicates on post-2023 exploits is unknown.
- No empirical loss data specific to single-RPC trust or nonce races in bots was found, so F20 and F21 remain grade C.
- The OWASP SC Top 10 2026 methodology mentions a practitioner survey but gives no respondent count or per-category loss totals on the pages read, so the ranking's statistical strength is unknown.
- Immunefi v2.3's publication date is not on the page.

## Dropped findings

None. All 24 findings survived verification: 10 unchanged, 13 corrected and 1 downgraded (F16, from B to C).
