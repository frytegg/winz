# Automated capture of third-party sites: robots.txt, terms of use, text-and-data-mining law, bot walls, Singapore

> Code FD19 · slug policy-capture-etiquette · researched 2026-10-01 · verified 2026-10-01 · counts: verified 15 / corrected 11 / downgraded 0 / dropped 0 / added 1

## Summary

This is not legal advice. The author is not a lawyer and nothing here was reviewed by one. It maps the rules around one step of /frontend: loading 2 to 4 public pages of a sponsor's customers in Playwright to measure design conventions (computed styles, fonts, viewport screenshots). FD09 (policy-copying-and-ip.md) covers what may be taken from those pages. This dossier covers how they may be fetched, kept and destroyed.

- **The line runs through the bot wall.** The EU baseline requires Member States to punish access without right "where committed by infringing a security measure", and says terms-of-service restrictions alone "should not incur criminal liability" (Directive 2013/40, F21). France punishes fraudulent access or remaining in a system with 3 years and EUR 100,000 (C. pén. 323-1). The Cour de cassation upheld a conviction for staying in a system "après avoir découvert que celui-ci était protégé" (Bluetouff, 2015, F22). Singapore's Computer Misuse Act punishes access "without authority" with up to S$5,000 or 2 years for a first offence, and applies whenever the accused is in Singapore (F25). France also punishes the attempt with the same penalties (C. pén. 323-7, F27), so a bypass that fails is not safe either. Honoring a bot wall keeps a capture on the etiquette side of that line. Changing identity to pass one supplies the protection and the knowledge those texts turn on. No court decision on user-agent spoofing or CAPTCHA bypass was found.
- **What the first round did is part of the documented bad pattern.** FD05-F25 swapped Playwright's "HeadlessChrome" user agent for a plain Chrome one to get past Coinbase's and Revolut's challenges. Cloudflare delisted Perplexity as a verified bot after documenting that, when blocked, it switched to "a generic browser intended to impersonate Google Chrome", rotated IPs outside its published ranges, changed ASNs and ignored robots.txt (F05). FD05's script changed only the UA. (corrected: the de-listing rested on the whole stealth pattern, not on the UA switch alone) RFC 9110 asks implementations not to borrow other products' tokens (F04). Anthropic's Usage Policy forbids using Claude to "circumvent the guardrails or terms of other platforms or services" (F06).
- **robots.txt** is a Proposed Standard (RFC 9309, September 2022) whose rules "are not a form of access authorization" and which treats every automated client as a crawler (F01). Vendors split on user-directed fetches: Google and OpenAI say robots.txt may not apply, and Anthropic says all its bots, including Claude-User, honor it and "will not attempt to bypass CAPTCHAs" (F02). Claude Code's WebFetch has identified as Claude-User since v2.1.83, and the Claude Code tools reference says it "sets a User-Agent header beginning with Claude-User" (F03). The capture should therefore obey the `*` group and any group naming `frontend-capture` or `Claude-User`.
- **Text and data mining.** EU Art. 4 and CPI L122-5-3 III let anyone copy lawfully accessible works to mine them, unless the right holder objected "notamment par des procédés lisibles par machine" (F10, F13). In France, website terms of use count as such an objection (R122-28). The copies must be "détruites à l'issue de la fouille", which is stricter than "delete after the event", and the miner must prove the destruction on request (R122-27). A deliberate, programmed download for analysis is not a temporary copy even if it is deleted automatically (LG Hamburg 2024, OLG Hamburg 2025 in agreement, F12). On the OLG Hamburg's reasoning, a capture that feeds a program or a model is very likely TDM. A human browsing screenshots is not, and the private-copy exception excludes collective use (F11).
- **Form of the opt-out.** The LG Hamburg (2024) inclined to treat natural-language terms as machine-readable. The OLG Hamburg (10 Dec 2025) held that a reservation must be machine-interpretable, and that a natural-language one was not shown to be readable in 2021. It did not rule on today's technology. The BGH will announce its decision on 17 Dec 2026 (F14). TDMRep, ai.txt and the IETF aipref drafts are the machine-readable forms in use (F15-F17). The EU GPAI Code commits AI providers to robots.txt per RFC 9309 and to not circumventing paywalls, and the Commission lists Anthropic among its signatories (F18). The CNIL tells scrapers to exclude sites that object "par l'utilisation des protocoles d'exclusion robots.txt ou la mise en place de CAPTCHA" (F19).
- **Terms of use** rarely bind a casual visitor contractually in France (C. civ. 1119: known and accepted; a 2025 Paris judgment reported the same for an anti-scraping clause, F20). They still matter through the TDM objection, the Usage Policy and etiquette.
- **Singapore.** The computational-data-analysis exception (s. 244) needs lawful access. Its illustrations exclude access "by circumventing paywalls" and access "in breach of the terms of use of a database". The copy may not be used for any other purpose, and may be supplied to others only to verify the results or for collaborative research or study on the same analysis (F24). (corrected: the summary said the copy may not be supplied to others at all)
- **Measured on 2026-09-30.** All 8 sampled crypto and fintech robots.txt files allow the home page, and none names Claude-User. None of the 8 serves a TDMRep file or an ai.txt (F08). An honest headless Chromium was admitted by kraken.com and stripe.com and stopped by Cloudflare challenges on coinbase.com and revolut.com (F07, F09). Automatic terms discovery reached no terms text on either admitted site, so a human or model read is mandatory (F09).
- **Deliverable.** An 18-row policy table and a reference gate, `_scripts/fd19/capture-gate.mjs`. Its 9 offline tests pass (re-run at verification), it ran live in dry-run mode on 4 sites, and its storage and purge path was run on example.com (receipts in `evidence/policy-capture-etiquette/capture-purge-example-2026-09-30/`). It checks robots.txt, TDM reservations and bot walls, requires a terms attestation before storing anything, writes outside any git work tree, and purges with a deletion receipt. It has no option to change the user agent and no retry after a block.

## Findings

### FD19-F01 — RFC 9309 is a Proposed Standard whose rules "are not a form of access authorization"; it defines crawlers as automated clients, so a one-page Playwright capture is in scope
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (RFC text, JSON metadata and errata page re-fetched with curl on 2026-10-01: every quote verbatim; 4 errata, all "Reported", 7995 dated 2024-06-18 and 8895 dated 2026-04-28)
- **Claim:** RFC 9309 "Robots Exclusion Protocol" (M. Koster, G. Illyes, H. Zeller, L. Sassman, September 2022) has status PROPOSED STANDARD and is neither obsoleted nor updated. It defines crawlers only as "automated clients", with no condition of recursion or volume. It asks crawlers to honor rules but says they are not authorization. Processing rules:
  - A crawler uses the group matching its product token, or else the `*` group. The longest match wins, and allow wins a tie.
  - 4xx on robots.txt means "unavailable", and the crawler MAY access anything. 5xx or a network error means "unreachable", and the crawler MUST assume complete disallow.
  - The cache SHOULD NOT be used for more than 24 hours. The parsing limit is at least 500 KiB. The product token SHOULD appear in the User-Agent.
  - The RFC has 4 reported, unverified errata. 7995 (2024-06-18) says path patterns may start with `*`, as in the RFC's own example. 8895 (2026-04-28) proposes comma-separated user-agent tokens.
- **Implication for /frontend:** A Playwright capture of even one page is an automated client in RFC terms. The gate implements RFC 9309 matching, tolerates both errata, fetches robots.txt fresh on every run (so it never relies on a copy older than 24 hours), treats 5xx or a network error as "skip site", and puts a product token in its User-Agent. Honoring robots.txt is a courtesy and a TDM signal (F10, F18), not an access-control mechanism. It does not make any other conduct lawful.
- **Evidence:**
  - [RFC 9309 (text)](https://www.rfc-editor.org/rfc/rfc9309.txt) — IETF, September 2022, accessed 2026-10-01 — specification.
    - "Crawlers are automated clients."
    - "These rules are not a form of access authorization."
    - "If no matching group exists, crawlers MUST obey the group with a user-agent line with the "*" value, if present."
    - "If a server status code indicates that the robots.txt file is unavailable to the crawler, then the crawler MAY access any resources on the server."
    - "If the robots.txt file is unreachable due to server or network errors, this means the robots.txt file is undefined and the crawler MUST assume complete disallow."
    - "Crawlers SHOULD NOT use the cached version for more than 24 hours, unless the robots.txt file is unreachable."
    - "The product token SHOULD be a substring of the identification string that the crawler sends to the service."
  - [rfc9309.json](https://www.rfc-editor.org/rfc/rfc9309.json) — RFC Editor, accessed 2026-10-01 — metadata: `"pub_status": "PROPOSED STANDARD"`, `"obsoleted_by": []`, `"updated_by": []`.
  - [RFC 9309 errata](https://www.rfc-editor.org/errata/rfc9309) — RFC Editor, accessed 2026-10-01 — 4 errata, all "Reported": 7124, 7128, 7995 and 8895.
- **Limits / false positives:** RFC 9309 says nothing about legal effect. "MAY access" on 4xx is permissive; the policy stops on 401, 403, 407 and 429, which is stricter than the RFC (see Contradictions). Crawl-delay is not part of the RFC.

### FD19-F02 — Vendors split on user-directed fetches: Google and OpenAI say robots.txt may not apply to them, and Anthropic says all its bots, including Claude-User, honor robots.txt and never bypass CAPTCHAs
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (all three pages re-fetched with curl on 2026-10-01: quotes verbatim; Google "Last updated 2026-08-19 UTC"; platform.openai.com/docs/bots answers 301 to developers.openai.com/api/docs/bots, title "Overview of OpenAI Crawlers", no date found; Anthropic article dateModified 2026-04-07T21:18:35Z)
- **Claim:** Each operator's own documentation states its policy:
  - **Google:** its user-triggered fetchers "generally ignore robots.txt rules" (page last updated 2026-08-19).
  - **OpenAI:** for ChatGPT-User, "robots.txt rules may not apply".
  - **Anthropic** (page updated 2026-04-07): "Claude-User allows site owners to control which sites can be accessed through these user-initiated requests." It lists as principles that its bots honor robots.txt, respect anti-circumvention technologies ("we will not attempt to bypass CAPTCHAs"), pace their crawling and respect Crawl-delay.
- **Implication for /frontend:** No industry norm exempts user-directed fetches. /frontend runs inside Claude Code, so it follows the stricter published practice of the vendor whose model drives it: obey robots.txt, never bypass a CAPTCHA, pace requests. It also treats a site's `Claude-User` group as a statement about Claude-directed fetches (F03).
- **Evidence:**
  - [Google user-triggered fetchers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers) — Google, last updated 2026-08-19 UTC, accessed 2026-10-01 — vendor documentation.
    - "Because the fetch was requested by a user, these fetchers generally ignore robots.txt rules."
  - [Overview of OpenAI Crawlers](https://developers.openai.com/api/docs/bots) (redirect from platform.openai.com/docs/bots) — OpenAI, undated, accessed 2026-10-01 — vendor documentation.
    - "Because these actions are initiated by a user, robots.txt rules may not apply."
  - [Does Anthropic crawl data from the web, and how can site owners block the crawler?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) — Anthropic, dateModified 2026-04-07, accessed 2026-10-01 — vendor documentation.
    - "Claude-User allows site owners to control which sites can be accessed through these user-initiated requests."
    - "Anthropic’s Bots respect “do not crawl” signals by honoring industry standard directives in robots.txt."
    - "Anthropic’s Bots respect anti-circumvention technologies (e.g., we will not attempt to bypass CAPTCHAs for the sites we crawl.)"
    - "We aim for minimal disruption by being thoughtful about how quickly we crawl the same domains and respecting Crawl-delay where appropriate."
- **Limits / false positives:** These are statements of policy, not measured behaviour. None of them has legal force over /frontend. OpenAI's page carries no date.

### FD19-F03 — Claude Code's WebFetch has identified as `Claude-User` since v2.1.83, and the Claude API web fetch tool refuses robots.txt-blocked URLs
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (changelog re-fetched: the entry is at line 5502, inside the "## 2.1.83" section that runs from line 5455 to 5533; web fetch tool quote verbatim; `claude --version` gives `2.1.286 (Claude Code)`. Evidence added at verification: the Claude Code tools reference)
- **Claim:** The Claude Code changelog, section 2.1.83, says: "Improved `WebFetch` to identify as `Claude-User` so site operators can recognize and allowlist Claude Code traffic via `robots.txt`". The Claude API web fetch tool lists `url_not_allowed` for "Anthropic-side restrictions, such as private addresses, robots.txt". The installed Claude Code is 2.1.286.
- **Implication for /frontend:** Site owners who write rules for Claude-directed fetches write them under `Claude-User`. A Playwright capture launched from the same session should obey those rules too. It should not borrow the `Claude-User` identity, which belongs to Anthropic's fetcher. The gate evaluates robots.txt for both `frontend-capture` and `Claude-User`, falling back to `*`, and proceeds only if both are allowed (stricter-of).
- **Evidence:**
  - [anthropics/claude-code CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) — Anthropic, entry under "## 2.1.83" (line 5502 of the file on 2026-10-01), accessed 2026-10-01 — changelog.
    - "Improved `WebFetch` to identify as `Claude-User` so site operators can recognize and allowlist Claude Code traffic via `robots.txt`"
  - [Web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) — Anthropic, accessed 2026-10-01 — API documentation.
    - "url_not_allowed : URL blocked by domain filtering rules (including your organization's settings) or by Anthropic-side restrictions, such as private addresses, robots.txt , and URLs that appear to contain a credential you did not provide"
  - `claude --version` on this machine, 2026-10-01: `2.1.286 (Claude Code)`.
  - [Tools reference](https://code.claude.com/docs/en/tools-reference) — Anthropic, Claude Code docs, accessed 2026-10-01 (curl) — product documentation (added at verification).
    - "WebFetch sets a User-Agent header beginning with Claude-User , and an Accept header that prefers Markdown over HTML so servers that support content negotiation can return Markdown directly."
- **Limits / false positives:** The changelog and the tools reference document identification, not enforcement. The tools reference's "WebFetch tool behavior" section does not mention robots.txt. Whether Claude Code's WebFetch itself refuses robots-disallowed URLs was not verified; the refusal quoted is for the API tool.

### FD19-F04 — Standards make the default automation identity the honest one: RFC 9110 discourages borrowing other products' tokens, WebDriver announces automation, and Playwright's default headless Chromium sends "HeadlessChrome" with `navigator.webdriver = true`
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED (RFC 9110 §10.1.5 re-read: both quotes verbatim, header shows STD 97, June 2022; W3C page shows "W3C Working Draft 02 July 2026", §4 quotes verbatim; the researcher's `ua.mjs` probe was re-run on `about:blank` at verification, 2026-09-30T22:38Z, and returned the same two UA strings and `webdriver: true`. The probe points playwright-core 1.63.0 at revision 1217 executables through `executablePath`; 1.63.0's own revision, 1243 (Chromium 153.0.8010.12), is not installed)
- **Claim:** RFC 9110 (HTTP Semantics, STD 97, June 2022), section 10.1.5, encourages implementations not to use other implementations' product tokens, because that "circumvents the purpose of the field". The W3C WebDriver draft (02 July 2026) sets a webdriver-active flag "when the user agent is under remote control". Measured on 2026-09-30 at 21:48 UTC, with playwright-core 1.63.0 and Chromium 147.0.7727.15 (Windows 11):
  - The headless shell sends `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/147.0.7727.15 Safari/537.36`.
  - Full Chromium in headless mode sends `... HeadlessChrome/147.0.0.0 ...`.
  - Both report `navigator.webdriver === true`.
- **Implication for /frontend:** The default identity already tells the site the truth twice: in the UA and in the WebDriver flag. The gate keeps the default UA and appends `(compatible; frontend-capture/1.0; one-off design-reference capture, human-directed)`, with no e-mail and no personal data. There is no `--user-agent` option and no path that switches to headed mode, spoofs `navigator.webdriver` or loads stealth plugins. Replacing "HeadlessChrome" with "Chrome", as FD05-F25 did, is masquerading in RFC 9110's sense.
- **Evidence:**
  - [RFC 9110 (text)](https://www.rfc-editor.org/rfc/rfc9110.txt) — IETF, R. Fielding, M. Nottingham, J. Reschke (eds.), June 2022, accessed 2026-10-01 — specification, §10.1.5.
    - "A user agent SHOULD send a User-Agent header field in each request unless specifically configured not to do so."
    - "Likewise, implementations are encouraged not to use the product tokens of other implementations in order to declare compatibility with them, as this circumvents the purpose of the field."
  - [WebDriver](https://www.w3.org/TR/webdriver2/) — W3C, Working Draft 02 July 2026, accessed 2026-10-01 — specification, §4 Interface.
    - "The webdriver-active flag is set to true when the user agent is under remote control."
    - "Defines a standard way for co-operating user agents to inform the document that it is controlled by WebDriver, for example so that alternate code paths can be triggered during automation."
  - [evidence/policy-capture-etiquette/playwright-default-ua-2026-09-30.json](evidence/policy-capture-etiquette/playwright-default-ua-2026-09-30.json) — own measurement on `about:blank`, no network.
- **Limits / false positives:** The RFC wording is "encouraged", not MUST. The WebDriver document is a Working Draft. The measured UA varies with the Chromium build and the operating system.

### FD19-F05 — Swapping the user agent after a block is part of what Cloudflare documented as "stealth crawling" (together with undeclared IPs, ASN changes and ignored robots.txt) and punished by delisting; its verified-bot bar asks for honest identity, obeying robots.txt, reasonable rates and no evasion
- **Grade:** B · **Kind:** OBSERVED · **Verdict:** CORRECTED (post, verified-bots page and LINC article re-fetched with curl on 2026-10-01; quotes, authors, dates and the 20-25m / 3-6m figures confirmed; the reason for the de-listing and the description of FD05's run were narrowed)
- **Claim:** On 4 August 2025, Cloudflare reported that Perplexity used a declared UA, `Perplexity-User/1.0` (20-25 million daily requests), and, "when their declared crawler was blocked", a generic Chrome-on-macOS UA (3-6 million daily requests). The same post says the undeclared crawler rotated through IPs outside Perplexity's published range, changed source ASNs, and ignored or failed to fetch robots.txt. The de-listing is justified by "Perplexity's observed behavior" as a whole, not by the UA switch alone. (corrected: the dossier presented the UA switch as the reason for the de-listing) Cloudflare de-listed Perplexity as a verified bot and listed what good bots do: identify honestly, avoid "stealth tactics", respect robots.txt, stay "within rate limits" and never bypass "security protections". Its verified-bots page (last updated 1 July 2026) sets two bars: honest self-identification and "non-abusive behavior". The CNIL's lab describes the same pattern: blocking measures mainly catch bots that stay "undetected, by simulating existing browsers and credible human behavior".
- **Implication for /frontend:** FD05's run did one part of what Cloudflare describes: after challenge pages, `extract.js` was run again with a plain Chrome UA passed through its `UA` environment variable. The script has no automatic retry and no proxy setting. (corrected: the dossier said `extract.js` itself retried) A capture tool that switches identity after a block is doing what the largest bot-management vendor classes as stealth crawling. The gate makes the rule structural: one honest identity, no retry after a block.
- **Evidence:**
  - [Perplexity is using stealth, undeclared crawlers to evade website no-crawl directives](https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/) — Cloudflare (G. Corral, V. Singhal, B. Mitchell, R. Tatoris), 2025-08-04, accessed 2026-10-01 — vendor blog.
    - "We observed that Perplexity uses not only their declared user-agent, but also a generic browser intended to impersonate Google Chrome on macOS when their declared crawler was blocked."
    - "Based on Perplexity’s observed behavior, which is incompatible with those preferences, we have de-listed them as a verified bot"
    - "We see continued evidence that Perplexity is repeatedly modifying their user agent and changing their source ASNs to hide their crawling activity, as well as ignoring — or sometimes failing to even fetch — robots.txt files." (added at verification)
    - "This undeclared crawler utilized multiple IPs not listed in Perplexity’s official IP range, and would rotate through these IPs in response to the restrictive robots.txt policy and block from Cloudflare." (added at verification)
    - "Be transparent . Identify themselves honestly, using a unique user-agent, a declared list of IP ranges or Web Bot Auth integration, and provide contact information if something goes wrong."
    - "Follow the rules . That means checking for and respecting website signals like robots.txt , staying within rate limits, and never bypassing security protections."
  - [Verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/) — Cloudflare, last updated Jul 1, 2026, accessed 2026-10-01 — vendor documentation.
    - "Non-abusive behavior — it obeys robots.txt and crawl directives, maintains reasonable request rates, and has not been observed evading website owner preferences or attacking sites."
  - [[Article 3/3] Prevent web data extraction by blocking access to the website](https://linc.cnil.fr/en/article-33-prevent-web-data-extraction-blocking-access-website) — CNIL LINC, Romain Darous, 02 June 2026, accessed 2026-10-01 — regulator's lab article.
    - "Nevertheless, these measures are primarily effective at blocking bots that disregard the rules set by website publishers and that may seek to collect publicly available content while remaining undetected, by simulating existing browsers and credible human behavior."
- **Limits / false positives:** Cloudflare is an interested party, and Perplexity's response was not read. Cloudflare's criteria are a private standard, not law. Graded B for that reason. FD05's UA swap matches only the UA part of the documented pattern. Its script (`evidence/tool-awesome-design-md/live-extraction/extract.js`) reads the UA from `process.env.UA` (line 11), sets no proxy (line 10) and does not read robots.txt; the home pages it loaded are allowed by those sites' robots.txt (F08).

### FD19-F06 — Anthropic's Usage Policy forbids using Claude to "circumvent the guardrails or terms of other platforms or services" and to "bypass security controls"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (page re-fetched with curl on 2026-10-01: "Effective September 15, 2025"; both bullets verbatim under the headings named. The second heading, "Do Not Compromise Computer or Network Systems", is about attacks on systems, which makes applying it to a UA swap this dossier's reading, as the Limits say)
- **Claim:** The Usage Policy, effective 15 September 2025, contains two relevant bullets. Under "Do Not Engage in Fraudulent, Abusive, or Predatory Practices" it lists "Engage in actions or behaviors that circumvent the guardrails or terms of other platforms or services". Under "Do Not Compromise Computer or Network Systems" it lists "Bypass security controls such as authenticated systems, endpoint protection, or monitoring tools".
- **Implication for /frontend:** A bot wall is a guardrail of another platform. A Claude-driven capture that swaps its identity to pass one, or ignores terms that forbid automated access, runs against the policy the tool itself operates under, whatever the criminal-law analysis says. This is the most direct reason why "detect and stop" is the only allowed response.
- **Evidence:**
  - [Usage Policy](https://www.anthropic.com/legal/aup) — Anthropic, "Effective September 15, 2025", accessed 2026-10-01 — provider policy.
    - "Engage in actions or behaviors that circumvent the guardrails or terms of other platforms or services"
    - "Bypass security controls such as authenticated systems, endpoint protection, or monitoring tools"
- **Limits / false positives:** Applying these bullets to UA swapping and to breach of terms is this dossier's reading. The policy gives no example about web capture. The first bullet sits under a heading about fraudulent and abusive practices.

### FD19-F07 — Bot walls announce themselves in machine-readable ways: Cloudflare's `cf-mitigated: challenge`, AWS WAF's `x-amzn-waf-action: challenge` (HTTP 202) or `captcha` (HTTP 405); the first two were observed live on 2026-09-30
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED (Cloudflare page "Last updated May 5, 2026" and AWS page re-fetched: quotes verbatim; saved headers show revolut `/ai.txt` 403 `Cf-Mitigated: challenge` at 21:48:55 GMT and binance `/ai.txt` 202 `x-amzn-waf-action: challenge`, `Content-Length: 0` at 21:49:20 GMT; gate reports show coinbase 403, "Just a moment...", 1 element at 22:05:40Z and, in `v0-first-run/`, revolut 403, "Just a quick security check | Revolut", 12 elements at 22:01:10Z)
- **Claim:** Documentation:
  - Cloudflare (last updated 5 May 2026): every Challenge Page response carries `cf-mitigated: challenge`, and "challenge is the only valid value".
  - AWS WAF: a Challenge answers with `x-amzn-waf-action: challenge` and "202 Request Accepted"; a CAPTCHA answers with `x-amzn-waf-action: captcha` and "405 Method Not Allowed".

  Observed on 2026-09-30 between 21:48 and 22:06 UTC from Paris, using an identified client:
  - `revolut.com/ai.txt`: 403, `Cf-Mitigated: challenge`, `Server: cloudflare`.
  - `binance.com/ai.txt`: 202, `x-amzn-waf-action: challenge`, `Server: CloudFront`, empty body.
  - With the gate's honest headless Chromium, `www.coinbase.com/` answered 403 with `cf-mitigated: challenge`, title "Just a moment...", 1 visible element.
  - With the same client, `www.revolut.com/` stopped at the pre-fetch. An earlier version of the gate, without the pre-fetch stop, had navigated and received 403, `cf-mitigated: challenge`, title "Just a quick security check | Revolut", 12 visible elements.
  - The `captcha` (405) signal was not observed.
- **Implication for /frontend:** Bot-wall detection can rest on vendor-documented headers first, then on HTTP status, then on interstitial titles and near-empty pages. The gate classifies 4 kinds. `captcha` and `hard` (401/403 without a challenge header, 405, 407, 429, 451, 503) stop at once. `challenge` and `interstitial` get one passive 8-second wait with the same identity and no interaction; if the page is still a challenge, the gate stops.
- **Evidence:**
  - [Detect a Challenge Page response](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) — Cloudflare, last updated May 5, 2026, accessed 2026-10-01 — vendor documentation.
    - "When a request encounters a Cloudflare Challenge Page instead of the originally anticipated response, the Challenge Page response (regardless of the Challenge Page type) will have the cf-mitigated header present and set to challenge ."
    - "For the cf-mitigated header, challenge is the only valid value. The header is set for all Challenge Page types."
  - [CAPTCHA and Challenge action behavior](https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html) — AWS, undated, accessed 2026-10-01 — vendor documentation.
    - "Challenge – AWS WAF includes the following in the response: The header x-amzn-waf-action with a value of challenge ."
    - "The HTTP status code 202 Request Accepted ."
    - "CAPTCHA – AWS WAF includes the following in the response: The header x-amzn-waf-action with a value of captcha ."
    - "The HTTP status code 405 Method Not Allowed ."
  - Saved headers (cookies stripped): [evidence/policy-capture-etiquette/survey-2026-09-30/](evidence/policy-capture-etiquette/survey-2026-09-30/) `revolut.com__ai_txt.txt.hdr`, `binance.com__ai_txt.txt.hdr`. Gate reports: [evidence/policy-capture-etiquette/gate-dry-run-2026-10-01/](evidence/policy-capture-etiquette/gate-dry-run-2026-10-01/) `www.coinbase.com.json`, `www.revolut.com.json`, and the earlier version's run in `v0-first-run/`.
- **Limits / false positives:** Other vendors (Akamai, DataDome, HUMAN, Imperva) were not documented here. The gate's CAPTCHA selectors for them are unverified heuristics, and a missed wall only means that a challenge page gets measured. Behaviour varies with IP reputation, country and time.

### FD19-F08 — In a sample of 8 sponsor-adjacent sites, robots.txt allows every home page, none names Claude-User, and none serves a TDMRep file or an ai.txt; robots.txt is near-universal and TDMRep is rare
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED (every saved header file re-read: final statuses match the counts, `Date` headers run from 21:48:42 to 21:49:44 GMT; the gate's offline test re-run confirms that all 8 files allow `/`; two statements were narrowed and one gate claim limited to same-origin paths)
- **Claim:** On 2026-09-30 between 21:48 and 21:50 UTC, the survey fetched `/robots.txt`, `/.well-known/tdmrep.json` and `/ai.txt` from binance.com, cardano.org, chain.link, coinbase.com, kraken.com, ledger.com, revolut.com and stripe.com. It used a declared UA: `Mozilla/5.0 (compatible; fd19-policy-research/1.0; one-off robots.txt and TDMRep check)`.
  - **robots.txt:** all 8 returned 200, and all 8 allow `/` for `*`. None has a `Claude-User` group. ledger.com explicitly allows GPTBot, ClaudeBot, PerplexityBot and Google-Extended. revolut.com disallows URLs with a query string (`Disallow: *?*`), except those matching `Allow: *?amount=` and `Allow: *?amount-to=`, and every `.json` URL (`Disallow: /*.json$`), which covers `/.well-known/tdmrep.json`. (corrected: the dossier said every query-string URL was disallowed; two longer Allow rules win for those parameters) stripe.com sets `Crawl-delay: 2` for `rogerbot` only.
  - **TDMRep file:** 0 of 8. Six returned 404; binance returned an S3 AccessDenied 403 and ledger a Cloudflare 403 "Forbidden".
  - **ai.txt:** 0 of 8. Six returned 404; revolut returned a Cloudflare challenge 403 and binance an AWS WAF 202.
  - **Context:** the CNIL's lab reports robots.txt on 30 of 37 million domains (about 81%) in Common Crawl's November/December 2023 crawl, and TDMRep on fewer than 0.002% of websites when counting the `tdm-reservation` and `tdm-policy` fields in HTTP headers and website metadata. (corrected: the LINC figure covers those two channels only, not `tdmrep.json` files; the dossier's quote had been cut before that qualifier)
- **Implication for /frontend:** For the home pages of large crypto and fintech brands, robots.txt will rarely be what stops a capture; bot walls and terms will. The robots check is still mandatory, because deep paths (`/join/` at Coinbase, query-string URLs at Revolut, `/handoff` at Stripe) are often disallowed. The gate checks robots.txt before it fetches any other same-origin path. A cross-origin link picked by its terms scan is fetched without checking that origin's robots.txt (corrected: the dossier said "any other path"; see the Deliverable's known gaps). The survey itself fetched revolut's `tdmrep.json` before this was noticed, a slip the gate now prevents.
- **Evidence:**
  - Raw robots.txt files and response headers: [evidence/policy-capture-etiquette/survey-2026-09-30/](evidence/policy-capture-etiquette/survey-2026-09-30/) — own survey, 2026-09-30 — primary artifacts as served.
    - revolut.com: `Disallow: *?*`, `Allow: *?amount=`, `Allow: *?amount-to=` and `Disallow: /*.json$`
    - ledger.com: `User-agent: ClaudeBot` / `Allow: /`
    - stripe.com: `User-agent: rogerbot` / `Crawl-delay: 2`
  - [[Article 2/3] Preventing web data extraction using declarative methods](https://linc.cnil.fr/en/article-23-preventing-web-data-extraction-using-declarative-methods) — CNIL LINC, Romain Darous, 02 June 2026, accessed 2026-10-01 — regulator's lab article.
    - "According to Common Crawl, 30 million of the 37 million domains included in their November/December 2023 crawl had a « robots.txt » file (approximately 81%). By contrast, for example, fewer than 0.002% of websites had implemented the TDMRep protocol when combining the presence of the tdm-reservation and tdm-policy fields in HTTP request headers and website metadata."
    - "declarative methods, meaning they do not block a bot’s access to the website but instead specify access rights in a non-binding way."
- **Limits / false positives:** The sample is 8 sites on one day, not a random sample. The TDMRep header and HTML meta were not checked site-wide, only by the gate on the pages it loaded. The LINC figures come from a secondary compilation (B-level) inside an A-level finding.

### FD19-F09 — Gate dry run on 4 sites: an honest headless Chromium was admitted by kraken.com and stripe.com and stopped by Cloudflare on coinbase.com and revolut.com; automatic terms discovery reached no terms text on either admitted site
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED (the four reports match the table: `checkedAt` 22:05:40Z to 22:06:35Z, element counts 1,178 and 1,616, Kraken `/legal` 8,517 characters, Stripe candidates as stated; `node --test` re-run at verification: `pass 9`, `fail 0`; the researcher's saved copy of `kraken.com/legal` contains the footer link `href="/legal"` labelled "Conditions de service" and none of "scrap", "crawl", "robot", "automated", "you agree" or "vous acceptez", even inside its scripts; the example.com manifest and receipt were found in the researcher's scratch folder and copied into the evidence folder)
- **Claim:** `capture-gate.mjs --dry-run` (no storage) ran on 2026-09-30 between 22:05 and 22:07 UTC, with the headless shell of Chromium 147, the default UA plus the `frontend-capture` suffix, from Paris.

  | Site | robots.txt | TDMRep / ai.txt | Navigation | Verdict |
  |---|---|---|---|---|
  | www.kraken.com | allowed | 404 / 404 | 200, 1,178 visible elements | allowed so far, terms unread |
  | stripe.com | allowed | 404 / 404 | 200, 1,616 visible elements | allowed so far, terms unread |
  | www.coinbase.com | allowed | 404 / 404 | 403, `cf-mitigated: challenge`, "Just a moment...", 1 element | stop (exit 3) |
  | www.revolut.com | allowed | skipped (robots) / 403 `cf-mitigated: challenge` | not attempted | stop (exit 3) |

  The terms heuristic, which picks the first two links whose text or href matches "terms", "conditions", "legal" and similar, did not reach terms text on either admitted site.
  - **Stripe:** it picked `/fr/privacy` and `/fr/legal/restricted-businesses`.
  - **Kraken:** it reached `/legal`, which the footer labels "Conditions de service", but the server-rendered page holds only 8,517 characters of navigation and footer text. The clause text is not in the HTML a plain fetch receives.
- **Implication for /frontend:** Bot walls, not robots.txt, decide which of the famous brands can be measured automatically: 2 of these 4. A skill that promises "capture 2 to 4 references" must pick candidates with a fallback list. Terms cannot be checked by a regex over whatever link looks legal. The gate therefore stores nothing until a human, or the model reading the rendered page, passes `--terms-reviewed <url>`, and it records that URL in the manifest.
- **Evidence:**
  - Gate reports: [evidence/policy-capture-etiquette/gate-dry-run-2026-10-01/](evidence/policy-capture-etiquette/gate-dry-run-2026-10-01/) (`www.kraken.com.json`, `stripe.com.json`, `www.coinbase.com.json`, `www.revolut.com.json`) — own run.
  - Code and tests: [_scripts/fd19/capture-gate.mjs](_scripts/fd19/capture-gate.mjs), [_scripts/fd19/capture-gate.test.mjs](_scripts/fd19/capture-gate.test.mjs) — `node --test` result on 2026-10-01: `pass 9`, `fail 0`.
  - Storage path test on `https://example.com/`, with `--terms-reviewed https://www.iana.org/help/example-domains`:
    - Run without the attestation: exit 4, nothing stored.
    - Run with the capture directory inside the project: exit 6, refused.
    - Run with the capture directory outside the project: 2 PNGs and `facts.json` stored with SHA-256 in `manifest.json`.
    - `--purge`: `deletion-receipt.json` written, all three files `stillExists: false`.
    - Receipts (copied at verification from the researcher's scratch folder): [evidence/policy-capture-etiquette/capture-purge-example-2026-09-30/](evidence/policy-capture-etiquette/capture-purge-example-2026-09-30/) `gate-report.json` (verdict "captured", `checkedAt` 22:03:06Z), `manifest.json` (3 files with SHA-256, `termsReviewed` the IANA page), `deletion-receipt.json` (`deletedAt` 22:03:10.505Z). The exit-4 and exit-6 runs left no files; they were checked by reading the code (lines 368 and 371-372) and by the offline storage-guard test.
- **Limits / false positives:** This is one run from one French IP, and the admission of Kraken and Stripe may change tomorrow. The first dry run hit a truncation bug in the terms scan, which was fixed; the Kraken report was re-run after the fix. The bug itself could not be checked; `v0-first-run/` shows the earlier report format. The example.com capture ran at 22:03Z, before the last edit of the gate file (22:06Z), so the storage path was exercised on an intermediate version. The visible-element threshold (60) is tuned on 6 observed pages. Graded B because the measurement depends on this dossier's own heuristics.

### FD19-F10 — EU Article 4 lets anyone reproduce lawfully accessible works for text and data mining unless the right holder reserved it "in an appropriate manner, such as machine-readable means"; online, Recital 18 says only machine-readable means count, "including metadata and terms and conditions"; the exception covers reproduction and extraction only, and contracts can override it
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (EUR-Lex HTML fetched with curl on 2026-10-01, this time 200: Art. 2(2), 4(1)-(3), 7(1), Art. 3 and recital 18 verbatim; Art. 4(1) cites Art. 2 of Directive 2001/29, not Art. 3; the OJ notice of C-250/25, seen in search results, shows question 3 asks whether LLM training falls within Art. 4)
- **Claim:** Directive (EU) 2019/790 of 17 April 2019:
  - Art. 4(1) creates an exception "for reproductions and extractions of lawfully accessible works and other subject matter for the purposes of text and data mining". It does not extend to the communication-to-the-public right in Art. 3 of Directive 2001/29.
  - Art. 4(2): copies "may be retained for as long as is necessary for the purposes of text and data mining".
  - Art. 4(3): the exception applies only if use "has not been expressly reserved by their rightholders in an appropriate manner, such as machine-readable means in the case of content made publicly available online".
  - Recital 18: online content may be reserved only "by the use of machine-readable means, including metadata and terms and conditions of a website or a service".
  - Art. 7(1) makes contract terms contrary to Arts 3, 5 and 6 unenforceable; Art. 4 is not listed.
  - Art. 3 is reserved to research organisations and cultural heritage institutions.
- **Implication for /frontend:** A hackathon team is not a research organisation, so only Art. 4 can apply. Three consequences follow:
  - Any machine-readable reservation, or reservation in the terms, removes the exception, so the gate treats one as a stop.
  - The exception never covers putting captures in public (repo, deployed site, deck, video), so redistribution is forbidden in the policy.
  - Retention ends with the mining purpose. French law is stricter (F13).
- **Evidence:**
  - [Directive (EU) 2019/790](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790) — EU, OJ L 130, 17.5.2019, accessed 2026-10-01 via Exa full-page fetch (EUR-Lex answers curl with a WAF 202) — legislation.
    - Art. 2(2): "‘text and data mining’ means any automated analytical technique aimed at analysing text and data in digital form in order to generate information which includes but is not limited to patterns, trends and correlations;"
    - Art. 4(2): "Reproductions and extractions made pursuant to paragraph 1 may be retained for as long as is necessary for the purposes of text and data mining."
    - Art. 4(3): "The exception or limitation provided for in paragraph 1 shall apply on condition that the use of works and other subject matter referred to in that paragraph has not been expressly reserved by their rightholders in an appropriate manner, such as machine-readable means in the case of content made publicly available online."
    - Recital 18: "In the case of content that has been made publicly available online, it should only be considered appropriate to reserve those rights by the use of machine-readable means, including metadata and terms and conditions of a website or a service."
    - Recital 18: "Rightholders should be able to apply measures to ensure that their reservations in this regard are respected."
    - Art. 7(1): "Any contractual provision contrary to the exceptions provided for in Articles 3, 5 and 6 shall be unenforceable."
- **Limits / false positives:** The CJEU has not ruled on the form of an Art. 4(3) reservation. C-250/25 Like Company, on LLM training and Art. 4, is pending and was not researched.

### FD19-F11 — The legal definition of TDM needs automated analysis that generates information, with no volume threshold; the OLG Hamburg treated even an image-to-caption comparison as TDM that uses "information" and not the work's concrete form; a human leafing through screenshots is not TDM, and the private-copy exception excludes collective use
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (L122-5-3 and L122-5 read on Légifrance through Exa: versions in force since 26 November 2021 and 1 January 2023, quotes verbatim; OLG judgment re-fetched with curl from Open Legal Data, Rn. 83 and 88 verbatim)
- **Claim:**
  - **Definition:** Art. 2(2) (F10) and CPI L122-5-3 I define TDM as "la mise en œuvre d'une technique d'analyse automatisée de textes et données sous forme numérique afin d'en dégager des informations, notamment des constantes, des tendances et des corrélations".
  - **Low threshold in the OLG Hamburg:** the image-caption comparison was already "eine Analyse zum Zwecke der Gewinnung von Informationen" (Rn. 83), and it evaluates only the image's "Information" and not "dessen konkrete Ausgestaltung" (Rn. 88).
  - **Private copy:** the French exception (L122-5 2°) covers copies "strictement réservées à l'usage privé du copiste et non destinées à une utilisation collective".
- **Implication for /frontend:** A capture whose screenshots and computed styles feed a program or Claude to derive type scales, spacing and palettes is very likely TDM. It fits the OLG's line that TDM extracts information, not expression, which is the FD09 boundary. Screenshots kept as a mood board for teammates to browse are neither TDM nor a private copy. So the policy routes captures only into the automated extraction, and humans look at the live site instead. Image-to-code on a capture uses the concrete form and stays forbidden (FD09).
- **Evidence:**
  - [Article L122-5-3, CPI](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044363192) — Légifrance, in force since 26 November 2021 (Ordonnance n°2021-1518), accessed 2026-10-01 via Exa — statute.
    - "I.-On entend par fouille de textes et de données, au sens du 10° de l'article L. 122-5, la mise en œuvre d'une technique d'analyse automatisée de textes et données sous forme numérique afin d'en dégager des informations, notamment des constantes, des tendances et des corrélations."
  - [OLG Hamburg, Urteil vom 10.12.2025 – 5 U 104/24](https://de.openlegaldata.io/case/olghh-2025-12-10-5-u-10424) — Hanseatisches Oberlandesgericht, 5. Zivilsenat, full text on Open Legal Data, accessed 2026-10-01 — judgment.
    - Rn. 83: "Da bereits der Abgleich zwischen Bild und Bildbeschreibung eine Analyse zum Zwecke der Gewinnung von Informationen i.S.d. § 44b Abs. 1 UrhG darstellt"
    - Rn. 88: "Bei dem Abgleich zwischen Bild und Bildbeschreibung wird nur die im Bild enthaltene „Information“ ausgewertet und nicht dessen konkrete Ausgestaltung."
  - [Article L122-5, CPI](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048603495) — Légifrance, version in force since 1 January 2023, accessed 2026-10-01 via Exa — statute.
    - "2° Les copies ou reproductions réalisées à partir d'une source licite et strictement réservées à l'usage privé du copiste et non destinées à une utilisation collective"
- **Limits / false positives:** Applying this to design capture is an analogy; no court has ruled on style extraction. German decisions do not bind French courts, and the BGH has not ruled (F14). Whether a solo developer's own screenshots are a private copy was not researched.

### FD19-F12 — Viewing is covered, keeping is not: on-screen and cache copies made while browsing are exempt (CJEU C-360/13), but a deliberate, programmed download for analysis is neither transient nor incidental even if it is deleted automatically (LG Hamburg 2024, endorsed obiter by the OLG Hamburg 2025)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (C-360/13 read on EUR-Lex through Exa, ruling and para 57 verbatim; LG PDF pp. 9-10 and OLG Rn. 211 verbatim; recital 9 verbatim) (corrected: the title said "confirmed by the OLG Hamburg 2025"; Rn. 211 is an obiter remark, as the body and the Limits already said, so the title now reads "endorsed obiter")
- **Claim:**
  - **Recital 9 of Directive 2019/790:** TDM on "mere facts or data that are not protected by copyright" needs no authorisation, and TDM whose copies stay within the temporary-copy exception is covered by it.
  - **CJEU C-360/13 PRCA (5 June 2014):** on-screen and cache copies "made by an end-user in the course of viewing a website" meet Art. 5(1) of Directive 2001/29 and need no authorisation. Para 57 also notes that making works available on a site is itself a communication to the public.
  - **LG Hamburg (27 September 2024), on LAION's download for analysis:** deletion "aufgrund einer entsprechenden bewussten Programmierung" does not make a copy transient. The download was "ein der Analyse vorgelagerter bewusster und aktiv gesteuerter Beschaffungsprozess", not an incidental copy.
  - **OLG Hamburg (10 December 2025, Rn. 211):** the point was not decisive on appeal, but the court agreed that a targeted download of an image to analyse it with software is "weder eine flüchtige noch eine (rein) begleitende Vervielfältigung".
- **Implication for /frontend:** Reading computed styles in the live browser and keeping only numbers is closest to viewing plus facts. A saved screenshot is a deliberate copy that the temporary-copy exception will not cover, even with auto-delete, so it needs the TDM exception and therefore all the TDM conditions (F10, F13). This is why the gate, when TDM is reserved, skips the site rather than "just screenshotting and deleting".
- **Evidence:**
  - [Directive (EU) 2019/790, recital 9](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790) — EU, accessed 2026-10-01 — legislation.
    - "Text and data mining can also be carried out in relation to mere facts or data that are not protected by copyright, and in such instances no authorisation is required under copyright law."
  - [Judgment C-360/13, Public Relations Consultants Association v Newspaper Licensing Agency](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62013CJ0360) — CJEU Fourth Chamber, 5 June 2014, accessed 2026-10-01 via Exa — judgment.
    - "the copies on the user’s computer screen and the copies in the internet ‘cache’ of that computer’s hard disk, made by an end-user in the course of viewing a website, satisfy the conditions ... and that they may therefore be made without the authorisation of the copyright holders."
  - [LG Hamburg, Urteil vom 27.09.2024 – 310 O 227/23 (anonymised full text)](https://chatgptiseatingtheworld.com/wp-content/uploads/2024/09/LG-Hamburg-310-O-227-23-Urteil-vom-2024-09-27-anonymisiert.pdf) — Landgericht Hamburg, 10. Zivilkammer, PDF pp. 9-10, accessed 2026-10-01 — judgment (third-party host of the text the court attached to its press release).
    - "erfolgte die Löschung gerade nicht „nutzerunabhängig“, sondern aufgrund einer entsprechenden bewussten Programmierung des Analyseprozesses durch den Beklagten."
    - "Damit ist das Herunterladen kein bloß begleitender Prozess zu der durchgeführten Analyse, sondern ein der Analyse vorgelagerter bewusster und aktiv gesteuerter Beschaffungsprozess."
  - [OLG Hamburg 5 U 104/24](https://de.openlegaldata.io/case/olghh-2025-12-10-5-u-10424) — 10 December 2025, Rn. 211, accessed 2026-10-01 — judgment.
    - "Darauf, ob außerdem die Regelung des § 44a UrhG greift, kommt es nicht entscheidungserheblich an. Das Landgericht hat aber zu Recht angenommen, dass die Vervielfältigung nicht durch § 44a UrhG gedeckt ist."
    - "Insbesondere stellt das gezielte Herunterladen einer Bilddatei, um sie mittels einer spezifischen Software zu analysieren, weder eine flüchtige noch eine (rein) begleitende Vervielfältigung dar."
- **Limits / false positives:** PRCA concerned a human end-user viewing, not an automated browser measuring styles. That measure-only capture is covered by Art. 5(1) is an inference. The OLG's agreement on § 44a is an obiter remark ("kommt es nicht entscheidungserheblich an"), and both decisions apply German law (§ 44a UrhG), which transposes Art. 5(1).

### FD19-F13 — France: anyone may mine lawfully accessed works unless the author objected "de manière appropriée, notamment par des procédés lisibles par machine"; the copies are "détruites à l'issue de la fouille"; the miner must prove secure storage and destruction on request; an objection "peut être exprimée par tout moyen", including the site's terms of use
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (L122-5-3 III and R122-27/R122-28 read on Légifrance through Exa: verbatim; R122-27 and R122-28 created by Décret n°2022-928 du 23 juin 2022, in force since 25 June 2022. One implication called R122-28 a statute)
- **Claim:**
  - **CPI L122-5-3 III** (in force since 26 November 2021) transposes Art. 4 for "toute personne, quelle que soit la finalité de la fouille". Copies are "stockées avec un niveau de sécurité approprié puis détruites à l'issue de la fouille de textes et de données".
  - **R122-27** (in force since 25 June 2022): on request, the miner provides the right holder with documents proving secure storage and destruction.
  - **R122-28:** the objection needs no reason, "peut être exprimée par tout moyen", and online "notamment ... au moyen de procédés lisibles par machine, y compris des métadonnées, et par le recours à des conditions générales d'utilisation d'un site internet ou d'un service".
- **Implication for /frontend:** Three rules follow:
  - Destroy raw captures when the extraction is done, not at the end of the event. "At the latest when the event ends" is only a backstop.
  - Keep a deletion receipt listing file hashes and timestamps. The gate's `--purge` writes one.
  - In France a terms-of-use clause is a valid objection under R122-28, whatever its contract status (F20). So terms that reserve TDM or forbid automated access end automated capture. (corrected: the dossier said "by statute"; R122-28 is a regulatory article created by décret, and the statute, L122-5-3 III, says only "notamment par des procédés lisibles par machine")
- **Evidence:**
  - [Article L122-5-3, CPI](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044363192) — Légifrance, accessed 2026-10-01 via Exa — statute.
    - "III.-Sans préjudice des dispositions du II, des copies ou reproductions numériques d'œuvres auxquelles il a été accédé de manière licite peuvent être réalisées en vue de fouilles de textes et de données menées à bien par toute personne, quelle que soit la finalité de la fouille, sauf si l'auteur s'y est opposé de manière appropriée, notamment par des procédés lisibles par machine pour les contenus mis à la disposition du public en ligne."
    - "Les copies et reproductions sont stockées avec un niveau de sécurité approprié puis détruites à l'issue de la fouille de textes et de données."
  - [Articles R122-27 and R122-28, CPI](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069414/LEGISCTA000045960683/) — Légifrance, created by Décret n°2022-928 du 23 juin 2022, in force since 25 June 2022, accessed 2026-10-01 via Exa — regulation.
    - R122-27: "Les personnes effectuant une fouille de textes et de données dans les conditions mentionnées au III de l'article L. 122-5-3 fournissent aux titulaires de droits d'auteur, à la demande de ceux-ci, tous documents et justificatifs permettant d'établir que les copies et reproductions numériques effectuées lors d'une fouille de textes et de données sont stockées avec un niveau de sécurité approprié et qu'elles ont été détruites à l'issue de la fouille de textes et de données."
    - R122-28: "L'opposition mentionnée au III de l'article L. 122-5-3 n'a pas à être motivée et peut être exprimée par tout moyen. Dans le cas de contenus mis à la disposition du public en ligne, cette opposition peut notamment être exprimée au moyen de procédés lisibles par machine, y compris des métadonnées, et par le recours à des conditions générales d'utilisation d'un site internet ou d'un service."
- **Limits / false positives:** No French decision interpreting L122-5-3 III or R122-28 was found. "À l'issue de la fouille" is not defined. This dossier reads it as the end of the extraction step.

### FD19-F14 — German courts on the form of the opt-out: the LG Hamburg (2024) inclined to accept natural-language terms; the OLG Hamburg (10 Dec 2025) required machine-interpretability and found it not shown for 2021; the BGH heard the case on 3 Sep 2026 and will announce its decision on 17 Dec 2026
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (LG press release PDF: "Hanseatisches Oberlandesgericht, Gerichtspressestelle, 27. September 2024", quote verbatim, and it cites the AI Act's "modernste Technologien"; LG PDF p. 15 quote verbatim, followed by the time-of-use caveat; OLG Rn. 70, 112, 115-122 and the operative part checked; OLG press release "Stand: 10.12.2025"; the BGH notice was fetched with curl this time (200): "Verkündungstermin am 17. Dezember 2026 um 8:45 Uhr ... (Verhandlung: 3.9.2026)" and the "automated programs, applets, bots or the like" quote, verbatim)
- **Claim:**
  - **LG Hamburg (27 Sep 2024):** it decided the case on the research exception (§ 60d UrhG). In an obiter it said it "neigt ... dazu" to treat a natural-language reservation as machine-understandable, depending on the technology at the time of use. Its press release adds that "zum jetzigen Zeitpunkt" natural-language reservations "dürften" be machine-readable, citing the AI Act's "modernste Technologien".
  - **OLG Hamburg (5 U 104/24, 10 Dec 2025):** it upheld on both § 44b and § 60d. The law's form requirement is technology-neutral ("technikoffen", Rn. 116). The text must be machine-interpretable so that an automated process can skip reserved content (Rn. 117). The right holder bears the burden (Rn. 112). The reservation, which forbade access by "automated programs, applets, bots or the like" and did not name TDM, needed interpretation and "ein maschinelles Textverständnis". It was not shown to be readable in the second half of 2021 (Rn. 118-122). The court names robots.txt and TDMRep as the forms discussed in the literature (Rn. 115) and allowed a further appeal.
  - **BGH (I ZR 281/25):** hearing on 3 Sep 2026; announcement set for 17 Dec 2026, 8:45.
- **Implication for /frontend:** Two points:
  - The OLG's test is time-dependent, and /frontend itself runs a language model that reads natural-language terms. The conservative reading for October 2026 is that a clear clause in the terms against automated access or data mining is a machine-readable reservation. The gate's rule "terms forbid it: skip" follows from that.
  - Re-check this finding after 17 Dec 2026 (BGH), and after any CJEU reference.
- **Evidence:**
  - [Pressemitteilung "KI und Urheberrecht: Landgericht Hamburg weist Klage ab"](https://justiz.hamburg.de/resource/blob/1157658/144d5418a6d1833148fc5d64eb92872c/ki-und-urheberrecht-data.pdf) — Hanseatisches Oberlandesgericht, Gerichtspressestelle, 27 September 2024, accessed 2026-10-01 — court press release.
    - "Angesichts der Fortschritte in der Entwicklung von KI-Anwendungen, die in der Lage sind, in natürlicher Sprache geschriebenen Text inhaltlich zu erfassen, dürften jedenfalls zum jetzigen Zeitpunkt nicht (mehr) nur im Webseiten-Code hinterlegte Nutzungsvorbehalte, sondern auch in natürlicher Sprache formulierte Nutzungsvorbehalte als maschinenlesbar im Sinne der Vorschrift anzusehen sein."
  - [LG Hamburg 310 O 227/23, anonymised full text](https://chatgptiseatingtheworld.com/wp-content/uploads/2024/09/LG-Hamburg-310-O-227-23-Urteil-vom-2024-09-27-anonymisiert.pdf) — PDF p. 15, accessed 2026-10-01 — judgment.
    - "Die Kammer neigt allerdings dazu, als „maschinenverständlich“ auch einen allein in „natürlicher Sprache“ verfassten Nutzungsvorbehalt anzusehen"
  - [OLG Hamburg 5 U 104/24](https://de.openlegaldata.io/case/olghh-2025-12-10-5-u-10424) — 10 December 2025, accessed 2026-10-01 — judgment.
    - Rn. 116: "Nach Ansicht des Senats hat der Gesetzgeber keine konkrete Form vorgegeben, sondern die Voraussetzung aufgestellt, dass die gewählte Form maschinenlesbar sein muss. Dies ist technikoffen formuliert."
    - Rn. 117: "Bei der Frage der Maschinenlesbarkeit kommt es nicht nur darauf an, dass der Text maschinell erfasst werden kann, sondern dass er auch in dem Sinn maschinell interpretiert werden kann, dass er bei einem automatisierten Vorgehen dazu führen kann, dass die vom Vorbehalt erfassten Inhalten nicht ausgewertet werden"
    - Rn. 122: "Dies erfordert ein maschinelles Textverständnis."
    - Operative part: "Die Revision gegen dieses Urteil wird zugelassen."
  - [KI und Urheberrecht: Hanseatisches Oberlandesgericht weist Berufung zurück](https://justiz.hamburg.de/gerichte/oberlandesgericht/gerichtspressestelle/ki-und-urheberrecht-hanseatisches-oberlandesgericht-weist-berufung-zurueck-1126528) — OLG Hamburg press office, 10.12.2025, accessed 2026-10-01 — court press release.
  - [Verkündungstermin am 17. Dezember 2026 in Sachen I ZR 281/25](https://www.bundesgerichtshof.de/SharedDocs/Termine/DE/Termine/IZR281-25.html) — Bundesgerichtshof, accessed 2026-10-01 via Exa (curl was reset) — court notice.
    - "Verkündungstermin am 17. Dezember 2026 um 8:45 Uhr in Sachen I ZR 281/25 (Erstellen eines Datensatzes für KI-Training) (Verhandlung: 3.9.2026)"
    - "Die Bildagentur hatte auf ihrer Webseite den Zugriff auf ihre Webseite durch "automated programs, applets, bots or the like" untersagt."
- **Limits / false positives:** German law applies § 44b UrhG, which says "in maschinenlesbarer Form"; the French text says "notamment par des procédés lisibles par machine" plus R122-28, which explicitly admits terms of use. Reports that the BGH is considering a CJEU reference come from secondary sources and were not verified.

### FD19-F15 — TDMRep is a W3C Community Group Final Report (10 May 2024), "not a W3C Standard", with four techniques, three of which apply to a web page: `/.well-known/tdmrep.json`, an HTTP header and an HTML meta tag; `tdm-reservation: 1` is the Article 4 opt-out
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (report re-fetched with curl on 2026-10-01: status, editor and all quotes verbatim; the count of channels was wrong)
- **Claim:** TDMRep (editor Laurent Le Meur, EDRLab) expresses the Art. 4 reservation.
  - **Channels:** a file `tdmrep.json` in `/.well-known` (an array of rules; the first matching `location` applies), a `tdm-reservation` HTTP header, and `<meta name="tdm-reservation" content="1">`. The report's fourth technique, metadata inside EPUB and PDF files, does not apply to a web page. (corrected: the dossier said "three channels"; the report says "four complementary techniques")
  - **Precedence:** a header supersedes the file, and HTML metadata supersedes both.
  - **Agent duty:** an agent "MUST check the presence of a TDM file on the origin server before it starts scraping".
- **Implication for /frontend:** The gate fetches `/.well-known/tdmrep.json` when robots.txt allows it, and checks the header and the meta tag on the loaded page. Any `1` for the page stops automated capture (exit 5).
- **Evidence:**
  - [TDM Reservation Protocol (TDMRep)](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/) — W3C TDM Reservation Protocol Community Group, Final Community Group Report 10 May 2024, accessed 2026-10-01 — specification.
    - "It is not a W3C Standard nor is it on the W3C Standards Track."
    - "The "opt-out" option specified by the Article 4 of the CDSM Directive is expressed by the use of tdm-reservation with value equal 1 ."
    - "This specification defines a JSON file named tdmrep.json , which MUST be hosted in the /.well-known repository of a Web server."
    - "A TDM Agent MUST check the presence of a TDM file on the origin server before it starts scraping the content of the Web server."
    - "A TDM Agent MUST check the presence of TDM Metadata in every html file fetched from the Web server. The values of tdm-reservation and tdm-policy found here supercede previous values."
    - "This specification provides four complementary techniques for expressing rightsholders' choices." (added at verification)
    - "The most specific match found MUST be used. The most specific match is the first in sequence." (added at verification)
- **Limits / false positives:** Adoption is tiny (F08). The duty to check the file first can clash with robots.txt (revolut disallows `*.json`); the gate lets robots.txt win.

### FD19-F16 — The IETF AI Preferences drafts (August and September 2026, not RFCs) add a `Content-Usage` HTTP header and robots.txt rule; their "AI Use" category covers feeding an asset to a generative model "where the asset is not directly provided by the user", and whether a URL counts as "direct" is an open issue
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (both drafts re-fetched from the IETF archive: authors, dates, "Updates: 9309 (if approved)", the label table `train-ai` / `ai-use` / `search` and the §4.2 text with the Issue 249 note verbatim; the datatracker API gives rev 05 and 08, states Active, I-D Exists and WG Document, intended level Proposed Standard, `rfc` null. The drafts' own headers say "Intended status: Standards Track")
- **Claim:**
  - **Status:** `draft-ietf-aipref-attach-05` (G. Illyes and M. Thomson, 19 August 2026) and `draft-ietf-aipref-vocab-08` (P. Keller and M. Thomson (ed.), 14 September 2026) are active IETF working-group documents with intended status Proposed Standard, not published as RFCs.
  - **Mechanism:** the attach draft defines a `Content-Usage` header and a robots.txt `Content-Usage` rule, and would update RFC 9309.
  - **Vocabulary:** labels `train-ai`, `ai-use` and `search`.
  - **Open question:** a note in the "AI Use" definition says Issue 249 addresses "whether "direct" includes referencing assets, by URL or other means".
- **Implication for /frontend:** A capture that hands a site's pages to Claude is "AI Use" in the draft's sense, arguably even when the user supplied the URL. The gate treats `ai-use=n`, in the header or in the robots.txt rule, as a stop. `train-ai=n` does not apply, since /frontend trains nothing.
- **Evidence:**
  - [draft-ietf-aipref-attach-05](https://www.ietf.org/archive/id/draft-ietf-aipref-attach-05.txt) — IETF AI Preferences WG, 19 August 2026, accessed 2026-10-01 — Internet-Draft.
    - "This document defines attachment methods using the Robots Exclusion Protocol and HTTP header fields."
    - "This document updates RFC 9309 to allow for the inclusion of usage preferences."
  - [draft-ietf-aipref-vocab-08](https://www.ietf.org/archive/id/draft-ietf-aipref-vocab-08.txt) — IETF AI Preferences WG, 14 September 2026, accessed 2026-10-01 — Internet-Draft (in the NOTE, the draft's "//" line-comment markers and line breaks were removed).
    - "Using an asset as input to a generative AI model, where the asset is not directly provided by the user."
    - "NOTE: Issue 249 (https://github.com/ietf-wg-aipref/drafts/issues/249) addresses the question of whether "direct" includes referencing assets, by URL or other means."
  - Datatracker API `draft-ietf-aipref-vocab` and `draft-ietf-aipref-attach`, accessed 2026-10-01: states `active`, `I-D Exists`, `WG Document`; `rfc: None`.
- **Limits / false positives:** These are drafts that may change. Their legal weight as Art. 4 reservations is untested.

### FD19-F17 — ai.txt is a vendor proposal (Spawning, 30 May 2023) that calls itself a machine-readable Article 4 opt-out; it is read "when a site's media is downloaded"
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED (Substack post re-fetched: datePublished 2023-05-30, author Cullen Miller, both quotes verbatim; generator page quotes verbatim; the CNIL's French focus sheet lists under "Mesures non- bloquantes" "D'autres protocoles d'exclusion (outre robots.txt, ai.txt ( Spawning AI ), TDMRep (tdmrep.json, W3C)". "By default all content is opted out" describes the generator's default output, not what the absence of an ai.txt means)
- **Claim:** Spawning introduced `/ai.txt`, a robots.txt-shaped file of Allow and Disallow rules by file type. It asserts that ai.txt "takes direct aim at the EU TDM Article 4 exception by explicitly providing a machine readable opt-out". Spawning's generator page says that "By default all content is opted out". The CNIL's focus sheet lists ai.txt among non-blocking exclusion protocols (F19).
- **Implication for /frontend:** It is cheap to check and rarely present (0 of 8 in F08). The gate reads `/ai.txt` when robots.txt allows it. If the file disallows the page, or image files under `*`, the gate treats that as a reservation and stops.
- **Evidence:**
  - [ai.txt: A new way for websites to set permissions for AI](https://spawning.substack.com/p/aitxt-a-new-way-for-websites-to-set) — Spawning (Cullen Miller), 2023-05-30, accessed 2026-10-01 — vendor blog.
    - "Unlike robots.txt, which is commonly read when a website is crawled, ai.txt is read when a site’s media is downloaded."
    - "In contrast, ai.txt takes direct aim at the EU TDM Article 4 exception by explicitly providing a machine readable opt-out method for commercial text and data mining."
  - [Spawning's ai.txt Generator](https://site.spawning.ai/spawning-ai-txt) — Spawning, undated, accessed 2026-10-01 — vendor page.
    - "An ai.txt file sets machine readable permissions for commercial text and data mining."
- **Limits / false positives:** It is self-described, with no court or standards body behind it. An IETF individual draft for `/.well-known/ai.txt` appeared in search results but was not opened.

### FD19-F18 — The EU GPAI Code of Practice (published 10 July 2025) commits signatory AI providers to crawlers that follow robots.txt per RFC 9309, to other machine-readable protocols, and to not circumventing effective technological measures such as paywalls
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (chapter PDF re-fetched: Measures 1.2(1)(a), 1.3(1)(a) and 1.3(1)(b) verbatim, chairs as stated; the Commission page says "The code was published on July 10, 2025." The question the dossier left open, whether Anthropic signed, is answered by the same page)
- **Claim:** The Copyright chapter binds its signatories, providers of general-purpose AI models, not their users. Its crawler measures apply when signatories crawl "for the purpose of text and data mining ... and the training of their general-purpose AI models". The Commission's list of signatories includes Anthropic; only xAI is flagged as having signed just the Safety and Security chapter. (corrected: added at verification; the dossier said this was not checked)
  - Measure 1.2(1)(a): "not to circumvent effective technological measures ... in particular by respecting any technological denial or restriction of access imposed by subscription models or paywalls".
  - Measure 1.3(1)(a): "to employ web-crawlers that read and follow instructions expressed in accordance with the Robot Exclusion Protocol (robots.txt), as specified in ... Request for Comments No. 9309".
  - Measure 1.3(1)(b): to "identify and comply with other appropriate machine-readable protocols".
- **Implication for /frontend:** This is the EU state of the art for AI-driven collection. Anthropic, a listed signatory, has taken these commitments on for its own crawling for TDM and training. They do not bind /frontend, which is a user's tool, but a skill driven by a signatory's model should not do less: follow robots.txt, honor other protocols, and never circumvent access restrictions. (corrected: the dossier made this conditional on an unchecked signature)
- **Evidence:**
  - [Code of Practice for General-Purpose AI Models — Copyright Chapter (PDF)](https://ec.europa.eu/newsroom/dae/redirection/document/118115) — European Commission (Working Group 1 Co-Chair A. Peukert, Vice-Chair C. Castets-Renard), accessed 2026-10-01 — official soft-law instrument.
    - "a) not to circumvent effective technological measures as defined in Article 6(3) of Directive 2001/29/EC that are designed to prevent or restrict unauthorised acts in respect of works and other protected subject matter, in particular by respecting any technological denial or restriction of access imposed by subscription models or paywalls"
    - "a) to employ web -crawlers that read and follow instructions expressed in accordance with the Robot Exclusion Protocol (robots.txt), as specified in the Internet Engineering Task Force (IETF) Request for Comments No. 9309"
  - [The General-Purpose AI Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai) — European Commission, accessed 2026-10-01 — official page.
    - "The code was published on July 10, 2025."
    - Section "Signatories of the code of practice": the list includes "Anthropic" (with Amazon, Google, IBM, Microsoft, Mistral AI and OpenAI, among others). (added at verification)
    - "In addition, xAI signed up to the Safety and Security Chapter; this means that it will have to demonstrate compliance with the AI Act’s obligations concerning transparency and copyright via alternative adequate means." (added at verification)
- **Limits / false positives:** It is voluntary and addressed to model providers. The Commission's list does not break signatures down by chapter except for xAI; that Anthropic signed the Copyright chapter is read from that. Bot walls are not named.

### FD19-F19 — The CNIL tells scrapers to exclude sites that object "par l'utilisation des protocoles d'exclusion robots.txt ou la mise en place de CAPTCHA", and says publishers' robots.txt or CAPTCHAs are something the controller "est tenu de respecter"
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (both pages re-fetched with curl: French sheet dated "19 juin 2025", both quotes verbatim, the exclusion and immediate-deletion bullets sit under "Les mesures obligatoires"; English page dated "05 January 2026", marked as "a courtesy translation", both quotes verbatim)
- **Claim:** The CNIL's focus sheet on legitimate interest and web scraping (French original, 19 June 2025; English courtesy translation, 5 January 2026) lists as mandatory measures:
  - exclude sites that clearly oppose scraping through robots.txt or a CAPTCHA;
  - delete irrelevant data "immédiatement".

  It adds that processing cannot meet data subjects' reasonable expectations if sites that object through robots.txt or CAPTCHAs are not excluded. Its scope is personal data collected to build AI training datasets.
- **Implication for /frontend:** France's data regulator reads a CAPTCHA as an objection, not a puzzle. /frontend's captures can contain personal data: faces and names in testimonials, team pages, user-generated content. Where they do, the same logic applies: skip such pages or crop them, and delete stray personal data at once. The CNIL frames the CAPTCHA as requiring "une action qui ne peut être effectuée que par un être humain". The policy therefore stops at any interactive CAPTCHA and allows only a passive wait for silent challenges (see Contradictions).
- **Evidence:**
  - [La base légale de l'intérêt légitime : fiche focus sur les mesures à prendre en cas de collecte des données par moissonnage (web scraping)](https://www.cnil.fr/fr/focus-interet-legitime-collecte-par-moissonnage) — CNIL, 19 juin 2025, accessed 2026-10-01 — regulator guidance.
    - "exclure de la collecte les sites qui s’opposent clairement au moissonnage de leur contenu à des fins de constitution de bases de données pour l’entrainement, par l’utilisation des protocoles d’exclusion robots.txt ou la mise en place de CAPTCHA, qui, en imposant une action qui ne peut être effectuée que par un être humain, vise à interdire l’accès aux pages à des robots."
    - "S’ils souhaitent protéger le contenu de leur site, les éditeurs de site doivent mettre en place un protocole d’exclusion robot.txt ou des CAPTCHAs, que le responsable du traitement est tenu de respecter."
  - [The legal basis of legitimate interest: focus sheet on the measures to implement in the case of data collection by web scraping](https://www.cnil.fr/en/legal-basis-legitimate-interest-focus-sheet-measures-implement-case-data-collection-web-scraping) — CNIL, 05 January 2026, accessed 2026-10-01 — courtesy translation.
    - "the CNIL considers that the processing cannot fall within the reasonable expectations of data subjects if the controller does not exclude from collection websites that explicitly object to scraping through robots.txt or CAPTCHAs."
    - "ensure that any irrelevant data that may have been collected despite these criteria is deleted immediately after collection or as soon as it is identified as such"
- **Limits / false positives:** The sheet is guidance on GDPR legitimate interest for AI training datasets, not a statute on design capture. Graded A as the regulator's own text, with the kind ASSERTED.

### FD19-F20 — Terms of use: the CJEU lets the maker of an unprotected database restrict use by contract "without prejudice to the applicable national law"; in France general conditions bind only if brought to the other party's knowledge and accepted, and silence is not acceptance; a 2025 Paris judgment reportedly refused to hold a scraper to an anti-scraping clause it never accepted
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (C-30/14 read on EUR-Lex through Exa: para 16 and the ruling verbatim; arts 1119 and 1120 verbatim in search-result excerpts of Légifrance pages, both "Version en vigueur depuis le 01 octobre 2016"; Lexing article re-fetched with curl: author, date, case number and quote verbatim. A party name and one word in the implication were changed)
- **Claim:**
  - **CJEU C-30/14 Ryanair v PR Aviation (15 January 2015):** Directive 96/9 does not stop the maker of a database with neither copyright nor sui generis protection "from laying down contractual limitations on its use by third parties, without prejudice to the applicable national law". Ryanair's terms were accepted "by ticking a box" (para 16).
  - **Code civil art. 1119:** general conditions "n'ont effet à l'égard de l'autre que si elles ont été portées à la connaissance de celle-ci et si elle les a acceptées".
  - **Art. 1120:** "Le silence ne vaut pas acceptation", unless law, usage, business relations or particular circumstances say otherwise.
  - **TJ Paris, 21 Feb 2025, n° 21/09261 (LeBonCoin v DirectAnnonces, as the report names the parties), as reported by a law firm:** the leboncoin anti-scraping clause did not bind a scraper, because the site needs no registration or acceptance. (corrected: the dossier named the claimant "LBC France", which the source read does not)
- **Implication for /frontend:** A capture of a public page with no click-through is unlikely to be a contract breach in France. That is not a licence:
  - The same clause is a TDM objection under R122-28 (F13). (corrected: "statutory" changed; R122-28 is regulatory)
  - Ignoring it runs against the Usage Policy (F06).
  - In Singapore, breach of database terms defeats "lawful access" (F24).

  So the policy treats terms that forbid automated access as a stop, and records the terms review.
- **Evidence:**
  - [Judgment C-30/14, Ryanair Ltd v PR Aviation BV](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62014CJ0030) — CJEU Second Chamber, 15 January 2015, accessed 2026-10-01 via Exa — judgment.
    - Para 16: "Access to that website presupposes that the visitor to the site accepts the application of Ryanair’s general terms and conditions by ticking a box to that effect."
    - Ruling: "Articles 6(1), 8 and 15 of that directive do not preclude the author of such a database from laying down contractual limitations on its use by third parties, without prejudice to the applicable national law."
  - [Code civil, articles 1119 and 1120](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070721/LEGISCTA000006118032/2024-05-18/) — Légifrance, in force since 1 October 2016, accessed 2026-10-01 via Exa — statute.
    - Art. 1119: "Les conditions générales invoquées par une partie n'ont effet à l'égard de l'autre que si elles ont été portées à la connaissance de celle-ci et si elle les a acceptées."
    - Art. 1120: "Le silence ne vaut pas acceptation, à moins qu'il n'en résulte autrement de la loi, des usages, des relations d'affaires ou de circonstances particulières."
  - [Web scraping vs Producteur de base de données : un jeu d'équilibriste](https://www.lexing.law/avocats/web-scraping-vs-producteur-de-base-de-donnees/2025/09/05/) — Lexing Avocats (Virginie Brunot), 05/09/2025, accessed 2026-10-01 — law-firm report of TJ Paris, 21 February 2025, n° 21/09261 (secondary).
    - "Cependant, la base LeBonCoin et sa sous-base « immobilier » sont librement accessibles et ne nécessitent aucune inscription, autorisation ou acceptation de conditions contractuelles. De fait, la société DirectAnnonces n’a pas consenti aux conditions générales d’utilisation et n’est donc pas liée contractuellement avec LeBonCoin."
- **Limits / false positives:** The TJ Paris judgment itself was not opened; only a law firm's account, plus a concordant search excerpt from another firm (JP Karsenty), was read. A first-instance judgment may be appealed. Other forms of acceptance (logged-in use, explicit click-through) change the analysis.

### FD19-F21 — The EU cybercrime baseline criminalises access "without right ... where committed by infringing a security measure", and says terms-of-service restrictions alone "should not incur criminal liability"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (EUR-Lex answered curl with 202 at verification; recital 17 read verbatim through Exa; Art. 3 and Art. 2(d) confirmed from EUR-Lex search results. Art. 2(d) in full: "not authorised by the owner or by another right holder of the system or of part of it, or not permitted under national law")
- **Claim:** Directive 2013/40/EU of 12 August 2013:
  - Art. 3 requires Member States to punish intentional access without right to an information system "where committed by infringing a security measure, at least for cases which are not minor".
  - Recital 17 says access restricted only "by way of a user policy or terms of service" should not ground criminal liability where it would be "the sole basis for criminal proceedings".
  - Art. 2(d) defines "without right" as conduct not authorised by the owner or by law.
- **Implication for /frontend:** This is the cleanest statement of where the risk sits. Reading a public page against a site's terms is, at the EU baseline, not the crime. Getting past a measure the site deploys to keep automated clients out plausibly is "infringing a security measure". UA swaps, stealth plugins, CAPTCHA solvers and IP rotation are all ways of infringing such a measure. Hence "stop at the wall".
- **Evidence:**
  - [Directive 2013/40/EU on attacks against information systems](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32013L0040) — EU, OJ L 218, 14.8.2013, accessed 2026-10-01 via Exa — legislation.
    - Art. 3: "Member States shall take the necessary measures to ensure that, when committed intentionally, the access without right, to the whole or to any part of an information system, is punishable as a criminal offence where committed by infringing a security measure, at least for cases which are not minor."
    - Recital 17: "contractual obligations or agreements to restrict access to information systems by way of a user policy or terms of service, as well as labour disputes as regards the access to and use of information systems of an employer for private purposes, should not incur criminal liability where the access under such circumstances would be deemed unauthorised and thus would constitute the sole basis for criminal proceedings."
- **Limits / false positives:** A directive sets minimum rules. French law (F22) is broader and does not require a security measure. Whether a bot challenge is a "security measure" has not been decided by any court found.

### FD19-F22 — France punishes fraudulently accessing or remaining in a system (3 years, EUR 100,000) and fraudulent extraction (5 years, EUR 150,000); the Cour de cassation upheld a conviction for staying in a system "après avoir découvert que celui-ci était protégé"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (Code pénal section read on Légifrance through Exa: 323-1, 323-3 and 323-3-1 verbatim, dates as stated; Legalis copy re-fetched with curl: both quotes, the EUR 3,000 fine and the acquittal on access confirmed; the pourvoi number, absent from the Legalis page, was matched in search results for vLex, "14-81336", ECLI:FR:CCASS:2015:CR01566, and Lexing's PDF, "Pourvoi n°14-81336". The defendant's description was changed)
- **Claim:**
  - **C. pén. 323-1** (in force since 26 January 2023, as amended by LOI n°2023-22 of 24 January 2023): fraudulent access or maintenance is punished by 3 years and EUR 100,000; 5 years and EUR 150,000 if data are deleted or modified or the system is altered.
  - **323-3:** fraudulent extraction, holding, reproduction or transmission of data carries 5 years and EUR 150,000.
  - **323-3-1:** holding or supplying tools designed or specially adapted for these offences "sans motif légitime" is punished like the offence.
  - **Bluetouff (Cass. crim., 20 May 2015, n° 14-81.336):** the defendant, who wrote for the news site Reflets.info (the motifs mention "un autre rédacteur du site reflet info"; the judgment states no profession), reached an extranet through a technical failure and was acquitted of access. (corrected: the dossier called him "a journalist", which the judgment does not say) He was convicted of maintenance and theft, fined EUR 3,000, because he stayed and downloaded after seeing the access control.
- **Implication for /frontend:** French law turns on "frauduleusement", and Bluetouff shows how courts read it: knowledge of a protection, then continuing anyway. A capture script that detects a challenge page and then changes identity to get past it documents both elements in its own logs. No French decision on UA spoofing or CAPTCHA bypass was found, so the risk is unquantified, not zero. The attempt is punished too (323-7, F27). The gate's structure (detect, then stop, with no alternative code path) is the mitigation.
- **Evidence:**
  - [Code pénal, articles 323-1 à 323-8](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070719/LEGISCTA000006149839/) — Légifrance, 323-1 in force since 26/01/2023 (LOI n°2023-22), accessed 2026-10-01 via Exa — statute.
    - 323-1: "Le fait d'accéder ou de se maintenir, frauduleusement, dans tout ou partie d'un système de traitement automatisé de données est puni de trois ans d'emprisonnement et de 100 000 € d'amende."
    - 323-3: "Le fait d'introduire frauduleusement des données dans un système de traitement automatisé, d'extraire, de détenir, de reproduire, de transmettre, de supprimer ou de modifier frauduleusement les données qu'il contient est puni de cinq ans d'emprisonnement et de 150 000 € d'amende."
    - 323-3-1: "Le fait, sans motif légitime, notamment de recherche ou de sécurité informatique, d'importer, de détenir, d'offrir, de céder ou de mettre à disposition un équipement, un instrument, un programme informatique ou toute donnée conçus ou spécialement adaptés pour commettre une ou plusieurs des infractions prévues par les articles 323-1 à 323-3 est puni des peines prévues respectivement pour l'infraction elle-même ou pour l'infraction la plus sévèrement réprimée."
  - [Cour de cassation, chambre criminelle, arrêt du 20 mai 2015](https://www.legalis.net/jurisprudences/cour-de-cassation-chambre-criminelle-arret-du-20-mai-2015/) — Legalis copy of Cass. crim. 20 May 2015, n° 14-81.336, accessed 2026-10-01 — judgment.
    - "d’où il résulte que O. L. s’est maintenu dans un système de traitement automatisé après avoir découvert que celui-ci était protégé et a soustrait des données qu’il a utilisées sans le consentement de leur propriétaire, la cour d’appel, qui a caractérisé les délits en tous leurs éléments, a justifié sa décision"
    - Motifs of the cour d'appel, quoted by the Court: "il avait constaté la présence de contrôles d’accès et la nécessité d’une authentification par identifiant et mot de passe"
- **Limits / false positives:** Bluetouff concerned a password-protected extranet and confidential documents, not a public marketing page behind a bot challenge. The analogy is this dossier's.

### FD19-F23 — Copyright anti-circumvention rules in France and Singapore could reach a bot wall if a court saw it as a technological or access-control measure, which is untested; the "lawful access" conditions of TDM exceptions exclude circumventing paywalls
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (Council of Europe PDF re-fetched with curl; the same wording of L335-3-1 appears in a Conseil constitutionnel dossier seen in search results; Singapore ss. 423 and 425 re-fetched from Singapore Statutes Online, "Current version as at 01 Oct 2026", verbatim. The French quote had been cut before a limiting condition)
- **Claim:**
  - **CPI L335-3-1 I:** EUR 3,750 fine for knowingly defeating, for purposes other than research, "une mesure technique efficace telle que définie à l'article L. 331-5", to alter the protection of a work, "lorsque cette atteinte est réalisée par d'autres moyens que l'utilisation d'une application technologique, d'un dispositif ou d'un composant existant mentionné au II". **L335-3-1 II** punishes knowingly procuring or offering to others means designed or specially adapted to defeat such a measure with six months and EUR 30,000. (corrected: the dossier's quote stopped before the condition that limits I to circumvention by one's own means, and omitted II)
  - **Singapore Copyright Act 2021, s. 425:** a person infringes by circumventing an "access control measure", defined in s. 423 as "any technology, device or component that, in the normal course of its operation, effectively controls access to a protected copy", applied by the rights owner "in connection with the exercise of the copyright".
  - **Lawful access:** the GPAI Code treats paywalls as measures not to circumvent (F18), and s. 244's illustration denies lawful access to whoever circumvents a paywall (F24).
- **Implication for /frontend:** A second, independent reason to stop at the wall. If a bot wall is an access control over the page's works, passing it both removes lawful access, and with it the TDM or CDA exception, and may be an infringement of its own. Nothing in the policy depends on resolving this.
- **Evidence:**
  - [Code de la propriété intellectuelle, articles L335-2 et suivants (Council of Europe copy)](https://rm.coe.int/cpintellartl335-2/16808e9364) — Council of Europe hosting of the French text, undated, accessed 2026-10-01 — statute copy (Légifrance page for L335-3-1 not opened).
    - "I.-Est puni de 3 750 euros d'amende le fait de porter atteinte sciemment, à des fins autres que la recherche, à une mesure technique efficace telle que définie à l'article L. 331-5, afin d'altérer la protection d'une oeuvre par un décodage, un décryptage ou toute autre intervention personnelle destinée à contourner, neutraliser ou supprimer un mécanisme de protection ou de contrôle, lorsque cette atteinte est réalisée par d'autres moyens que l'utilisation d'une application technologique, d'un dispositif ou d'un composant existant mentionné au II." (quote completed at verification)
    - "II.-Est puni de six mois d'emprisonnement et de 30 000 euros d'amende le fait de procurer ou proposer sciemment à autrui, directement ou indirectement, des moyens conçus ou spécialement adaptés pour porter atteinte à une mesure technique efficace telle que définie à l'article L. 331-5" (added at verification)
  - [Copyright Act 2021, s. 423](https://sso.agc.gov.sg/Act/CA2021?ProvIds=pr423-#pr423-) — Singapore Statutes Online, "Current version as at 01 Oct 2026", accessed 2026-10-01 — statute.
    - "“access control measure”, in relation to a protected copy — ( a ) means any technology, device or component that, in the normal course of its operation, effectively controls access to a protected copy"
  - [Copyright Act 2021, s. 425](https://sso.agc.gov.sg/Act/CA2021?ProvIds=pr425-#pr425-) — Singapore Statutes Online, accessed 2026-10-01 — statute.
    - "Subject to the provisions of this Division, a person infringes this section if the person circumvents an access control measure."
    - "( a ) the access control measure is applied — (i) to a protected copy; (ii) by or with the authority of the rights owner of the protected copy; and (iii) in connection with the exercise of the copyright or any right in the performance, as the case may be;"
- **Limits / false positives:** Both regimes aim at measures protecting works (DRM, paywalls). Bot management is mainly security, and no decision treating a bot challenge as a TPM was found. The L335-3-1 text was read from a Council of Europe copy, not Légifrance. The definition in L331-5 was not opened on Légifrance. In search results only, the 2006 act (WIPO Lex) and Arcom's deliberation n° 2021-09 quote it as protecting measures "destinées à empêcher ou à limiter les utilisations non autorisées par les titulaires d'un droit d'auteur", deemed effective when a use "est contrôlée par les titulaires de droits grâce à l'application d'un code d'accès". Whether a site's bot manager is such a measure stays open.

### FD19-F24 — Singapore's computational data analysis exception (s. 244) allows copies for analysis if the user does not use them otherwise, supplies them to others only to verify results or for collaborative research or study on the analysis, and has lawful access, which the Act's own illustrations deny to anyone circumventing paywalls or breaching a database's terms; s. 187 voids contract terms that restrict the exception; fair use (ss. 190-191) is a four-factor test
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (ss. 187, 191, 243 and 244 re-fetched from Singapore Statutes Online, "Current version as at 01 Oct 2026": all quotes verbatim and the claim's list of conditions accurate. The title and the implication overstated the ban on supplying copies)
- **Claim:** Copyright Act 2021, current version as at 1 October 2026.
  - **s. 243:** computational data analysis "includes" using a program "to identify, extract and analyse information or data from the work".
  - **s. 244(2)** conditions:
    - the copy is made for that analysis;
    - it is not used "for any other purpose";
    - it is not supplied to anyone except to verify results or for collaborative research;
    - the user has lawful access to the first copy. Illustrations: no lawful access "by circumventing paywalls" or "in breach of the terms of use of a database (ignoring any terms that are void by virtue of section 187)";
    - the first copy is not infringing, subject to knowledge qualifiers.
  - **s. 244(3):** "making a copy includes ... storing or retaining the copy".
  - **s. 187(1):** any contract term is void to the extent it purports to exclude or restrict a Division 8 permitted use.
  - **ss. 190-191:** fair use weighs purpose and character (including commercial nature), nature of the work, amount used and market effect.
- **Implication for /frontend:** A capture made in Singapore during the Origins window, for the same measurement, fits s. 244 if access was lawful:
  - honest identity, no wall passed, no terms breached;
  - captures go to nobody except people verifying the results or collaborating on the same analysis (s. 244(2)(c));
  - they are used only for the analysis.

  A teammate who works on the same extraction may receive the captures under s. 244(2)(c)(ii). Posting them in a general team chat, or showing them in the pitch video, is a use for another purpose (s. 244(2)(b)) and outside s. 244. (corrected: the dossier said any sharing in a team chat was outside s. 244) The video would have to rely on fair use, which FD09 advises against for whole screenshots. The policy's stricter rule, not sending captures to teammates at all (P12), is a design choice.
- **Evidence:**
  - [Copyright Act 2021, s. 244](https://sso.agc.gov.sg/Act/CA2021?ProvIds=pr244-#pr244-) — Singapore Statutes Online, accessed 2026-10-01 — statute.
    - "( b ) X does not use the copy for any other purpose;"
    - "( c ) X does not supply (whether by communication or otherwise) the copy to any person other than for the purpose of — (i) verifying the results of the computational data analysis carried out by X ; or (ii) collaborative research or study relating to the purpose of the computational data analysis carried out by X ;" (added at verification)
    - "( d ) X has lawful access to the material (called in this section the first copy) from which the copy is made"
    - "( a ) X does not have lawful access to the first copy if X accessed the first copy by circumventing paywalls. ( b ) X does not have lawful access to the first copy if X accessed the first copy in breach of the terms of use of a database (ignoring any terms that are void by virtue of section 187)."
  - [Copyright Act 2021, s. 243](https://sso.agc.gov.sg/Act/CA2021?ProvIds=pr243-#pr243-) — accessed 2026-10-01 — statute.
    - "( a ) using a computer program to identify, extract and analyse information or data from the work or recording"
  - [Copyright Act 2021, s. 187](https://sso.agc.gov.sg/Act/CA2021?ProvIds=pr187-#pr187-) — accessed 2026-10-01 — statute.
    - "Any contract term is void to the extent that it purports, directly or indirectly, to exclude or restrict any permitted use under any provision in — ... ( c ) Division 8 (computational data analysis)"
  - [Copyright Act 2021, ss. 190-191](https://sso.agc.gov.sg/Act/CA2021?ProvIds=pr191-#pr191-) — accessed 2026-10-01 — statute.
    - s. 191: "( a ) the purpose and character of the use, including whether the use is of a commercial nature or is for non‑profit educational purposes; ( b ) the nature of the work or performance; ( c ) the amount and substantiality of the portion used in relation to the whole work or performance; and ( d ) the effect of the use upon the potential market for, or value of, the work or performance."
- **Limits / false positives:** How s. 187 interacts with illustration (b) for a website's "no bots" clause is unsettled; the clause may be void as a restriction on analysis, or effective as an access term. No Singapore case on s. 244 was found. Whether a marketing site is a "database" in illustration (b) is unclear. s. 244(4), read at verification, makes it a permitted use to communicate a work to the public when the communication uses a copy made "in circumstances to which subsection (1) applies" and the copy is not supplied beyond (2)(c). Because (1) requires that the copy not be used for any other purpose, this dossier reads (4) as not covering a pitch video; that reading is untested.

### FD19-F25 — Singapore's Computer Misuse Act punishes causing a computer to secure access "without authority" (up to S$5,000 and/or 2 years for a first offence) and applies whenever the accused was in Singapore; "without authority" means no consent to access "of the kind in question"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (ss. 2, 3 and 13 re-fetched from Singapore Statutes Online: "Current version as at 01 Oct 2026", timeline "30 Dec 2025 Amended by Act 21 of 2025"; penalties, s. 2(5) and s. 13(1), (3)(a) and (3)(b) verbatim; the TOKEN2049 FAQ confirms "Physical attendance at Marina Bay Sands in Singapore is required for the full 36 hours")
- **Claim:** Computer Misuse Act 1993, current version as at 1 October 2026 (last amended by Act 21 of 2025, in force 30 Dec 2025).
  - **s. 3(1):** knowingly causing a computer to perform a function to secure access without authority is an offence. First conviction: fine up to S$5,000 or up to 2 years, or both. Repeat: S$10,000 or 3 years. If damage is caused (s. 3(2)): S$50,000 or 7 years.
  - **s. 2(5):** access is unauthorised if the person is not entitled to control access "of the kind in question" and lacks consent from someone who is.
  - **s. 13(1), (3):** the Act applies "outside as well as within Singapore" if, among other cases, "the accused was in Singapore at the material time" or the computer, program or data was in Singapore.
- **Implication for /frontend:** Captures run from a laptop at Marina Bay Sands between Tue 6 Oct 12:00 and Wed 7 Oct 23:59 SGT are under the CMA, whatever the site's location. A bot wall is the site's statement that it does not consent to automated access of that kind. The same gate applies unchanged in Singapore, and the "stop, do not spoof" rule is what keeps the capture within consent.
- **Evidence:**
  - [Computer Misuse Act 1993, s. 3](https://sso.agc.gov.sg/Act/CMA1993?ProvIds=pr3-#pr3-) — Singapore Statutes Online, accessed 2026-10-01 — statute.
    - "any person who knowingly causes a computer to perform any function for the purpose of securing access without authority to any program or data held in any computer shall be guilty of an offence and shall be liable on conviction — ( a ) to a fine not exceeding $5,000 or to imprisonment for a term not exceeding 2 years or to both"
  - [Computer Misuse Act 1993, s. 2](https://sso.agc.gov.sg/Act/CMA1993?ProvIds=pr2-#pr2-) — accessed 2026-10-01 — statute.
    - "(5) For the purposes of this Act, access of any kind by any person to any program or data held in a computer is unauthorised or done without authority if the person — ( a ) is not himself or herself entitled to control access of the kind in question to the program or data; and ( b ) does not have consent to access by him or her of the kind in question to the program or data from any person who is so entitled."
  - [Computer Misuse Act 1993, s. 13](https://sso.agc.gov.sg/Act/CMA1993?ProvIds=pr13-#pr13-) — accessed 2026-10-01 — statute.
    - "( a ) for the offence in question, the accused was in Singapore at the material time"
- **Limits / false positives:** No Singapore judgment applying s. 3 to web scraping, user-agent spoofing or a bot challenge was found (none was searched in depth). Reading a bot wall as withdrawn consent is this dossier's inference.

### FD19-F26 — TOKEN2049 Origins allows brainstorming before kickoff but "no code, designs, or prototypes before kickoff"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (page re-fetched with curl on 2026-10-01: FAQ quote verbatim, typo "beings" included; FD09-F27 does class research on customer sites as brainstorming. One jurisdiction claim in the implication overreached)
- **Claim:** The organiser's FAQ, re-read on 2026-10-01, still says that all project work must begin after the official hacking period starts, and allows brainstorming only.
- **Implication for /frontend:** Measuring customers' sites and writing the convention brief is research on others' work, which FD09-F27 already classed as brainstorming. Any artifact of the team's own design (tokens chosen for the protocol, logo, mockups) waits for kickoff. Captures made before departure also avoid the accused-in-Singapore link of s. 13(3)(a); the CMA can still apply if the target computer, program or data was in Singapore (s. 13(3)(b), F25). (corrected: the dossier said pre-departure captures stay out of Singapore's jurisdiction) Under French law their raw files must then be destroyed once the brief is written (F13), so the brief, not the screenshots, travels to Singapore.
- **Evidence:**
  - [2049 Origins Hackathon](https://www.token2049.com/singapore/2049-origins) — TOKEN2049, accessed 2026-10-01 (curl) — organiser FAQ.
    - "Can I start working on my project before the event beings? No. To maintain fairness, all project work must begin after the official hacking period starts. You can brainstorm ideas, but no code, designs, or prototypes before kickoff."
  - [Computer Misuse Act 1993, s. 13](https://sso.agc.gov.sg/Act/CMA1993?ProvIds=pr13-#pr13-) — Singapore Statutes Online, accessed 2026-10-01 — statute (added at verification).
    - "( b ) for the offence in question (being one under section 3, 4, 5, 6, 7 or 8), the computer, program or data was in Singapore at the material time;"
- **Limits / false positives:** Whether a convention brief counts as "designs" is the organiser's call. The FAQ is not the full terms. Where a sponsor-adjacent site is hosted, or served from a Singapore point of presence, was not checked.

### FD19-F27 — France punishes the attempt with the same penalties: C. pén. 323-7 covers attempts at the 323-1 to 323-3-1 offences, so a bypass that fails is not safe (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** Article 323-7 of the Code pénal, in force since 22 June 2004 (as amended by Loi n° 2004-575 of 21 June 2004, art. 46), punishes the attempt at the offences of articles 323-1 to 323-3-1 with the same penalties as the completed offence. Those articles include fraudulent access or remaining (323-1, F22) and fraudulent extraction or reproduction of data (323-3).
- **Implication for /frontend:** If passing a bot wall with a changed identity would be fraudulent access, trying it is already exposed even when the wall holds. The rule therefore has to be "never try", not "stop if it fails". That is what P9 and `retriesAfterBlock: 0` encode. This does not settle whether a bot challenge is a protection whose bypass is "frauduleux" (F21, F22); it only removes the idea that a failed attempt is harmless.
- **Evidence:**
  - [Code pénal, articles 323-1 à 323-8](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070719/LEGISCTA000006149839/) — Légifrance, accessed 2026-10-01 via Exa — statute.
    - 323-7: "La tentative des délits prévus par les articles 323-1 à 323-3-1 est punie des mêmes peines."
  - [Code pénal, articles 121-1 à 121-7](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070719/LEGISCTA000006149817) — Légifrance, in force since 1 March 1994, seen in search results on 2026-10-01 (Exa) — statute.
    - 121-5: "La tentative est constituée dès lors que, manifestée par un commencement d'exécution, elle n'a été suspendue ou n'a manqué son effet qu'en raison de circonstances indépendantes de la volonté de son auteur."
- **Limits / false positives:** An attempt needs a "commencement d'exécution" of an offence that would itself be fraudulent; applying it to a UA swap is this dossier's inference. No decision on an attempted bot-wall bypass was found. Article 121-5 was read only in a search-result excerpt of the Légifrance page.

## Deliverable

### Scope and status

This is not legal advice. It is an engineering policy built from the sources above, for a hackathon team that captures 2 to 4 public reference sites to extract design conventions. When a rule rests on inference and not on a source, the row says so. The policy is stricter than the law where the law is unsettled, on purpose: skipping a site costs little when only 2 to 4 references are needed.

### Capture policy table

| # | Situation or action | Verdict | How a script enforces it | Basis | Grade |
|---|---|---|---|---|---|
| P1 | Fetch `/robots.txt`, then `/.well-known/tdmrep.json` and `/ai.txt` (only if robots.txt allows those paths), then one navigation to the chosen public page | Allowed | Gate steps 1-3, in this order | F01, F15, F17 | A |
| P2 | Identity: the browser's default UA plus `(compatible; frontend-capture/1.0; one-off design-reference capture, human-directed)`; never an e-mail or personal data | Allowed (required) | `UA_SUFFIX` constant; no override option exists | F01, F04 | A |
| P3 | robots.txt disallows the page for `frontend-capture`, `Claude-User`, or `*` (when neither is named) | Forbidden: skip the site | `stricterOf()` over both tokens; exit 2 | F01-F03 | A |
| P4 | robots.txt answers 5xx or fails; answers 401/403/407/429; answers any other 4xx (such as 404 or 410) | 5xx or failure: skip site. 401/403/407/429: stop. Other 4xx: allowed | Status branch in step 1; exit 2 or 3 | F01 (policy stricter than RFC on 401/403/429) | A |
| P5 | A TDM reservation exists: TDMRep `1` (file, header or meta), ai.txt disallowing the page or images, `Content-Usage` with `ai-use=n` (header or robots rule) | Forbidden for automated capture; manual notes only (P16) | `tdmrepDecision()`, `aiTxtReserves()`, `contentUsageReserves()`; exit 5 | F10, F13, F15-F17 | A |
| P6 | The site's terms forbid automated access, scraping, crawling or data mining | Forbidden for automated capture; manual notes only | Nothing is stored without `--terms-reviewed <url>` (human or model read of the rendered terms); advisory regex flags clauses, exit 4 | F06, F13, F14, F20 | A |
| P7 | Hard block or interactive CAPTCHA: 401, 403 without a challenge header, 405, 407, 429, 451, 503, `x-amzn-waf-action: captcha`, or a CAPTCHA widget | Forbidden to continue: stop at once | `classifyResponse()` kinds `hard`, `captcha`; exit 3 | F07, F19, F21-F23, F25 | A |
| P8 | Silent challenge: `cf-mitigated: challenge`, `x-amzn-waf-action: challenge`, HTTP 202 with empty body, interstitial title | Allowed with conditions: one passive 8 s wait with the same identity, no click or input; still challenged, stop | Step 3 grace wait; re-classify; exit 3 | F07, F19 (the CNIL targets human-action CAPTCHAs); the grace wait is a policy choice | B |
| P9 | After any block: change the UA, switch headless to headed, stealth plugins, spoof `navigator.webdriver` or fingerprints, proxies, VPN or IP rotation, CAPTCHA solvers or farms, driving the user's logged-in browser over CDP to get past the wall, archive mirrors as a workaround | Forbidden | No code path exists; review rule for the skill: any such flag or dependency fails review | F04-F06, F21-F25, F27 | A |
| P10 | Pages behind login, paywall, age or geo gate; form submission; user-generated content; team or testimonial sections with faces and names | Login, paywall, forms: forbidden. Personal data: allowed with conditions (skip or crop, delete stray data at once) | Skill-level (not in the gate): URL allowlist of public marketing pages; human check of each viewport before extraction | F19, F23-F25 | A |
| P11 | What is stored: computed-style facts plus at most 2 viewport screenshots per page, at most 3 pages per host, at most 4 hosts; never HTML, CSS, JS, fonts or images from the site | Allowed with conditions | The gate writes only `facts.json` and viewport PNGs (2 viewports by default) for one URL per run. Only the per-host page limit is an exported constant (`MAX_PAGES_PER_HOST = 3`); the gate has no host-count constant and does not cap `--viewports`, so the skill's loop must enforce the 4-host and 2-viewport limits (corrected: the dossier said the host and page limits were both exported constants) | F10-F12 (limits are design choices) | A |
| P12 | Where it is stored: outside the product repository and outside any git work tree; not synced to shared drives; not sent to teammates | Allowed with conditions | `checkStorage()` refuses paths inside the project or a git work tree; exit 6 | F10, F13, F24 ("not sent to teammates" is stricter than s. 244(2)(c)(ii), which allows supply for collaborative research on the same analysis: a design choice) | A |
| P13 | When it is destroyed: when the convention brief has been extracted and checked, at the latest at the end of the event; a deletion receipt is kept; the brief (facts and ideas) may be kept | Required | `--purge` deletes the manifest's files and writes `deletion-receipt.json` with hashes and time | F10, F13 (R122-27) | A |
| P14 | Redistribution: captures in the repo, deployed site, deck, video, gist, issue, chat or shared drive | Forbidden | Recommended pre-commit hook: reject files whose SHA-256 is in any capture manifest (not in the gate) | F10, F24; FD09-F32 | A |
| P15 | Feeding captures to Claude to extract conventions | Allowed with conditions: only after P3-P9 pass; never image-to-code | Gate verdict precondition; FD09 policy | F11, F16; FD09 | A |
| P16 | Manual fallback when the gate stops: a person opens the site in their own browser, reads it, and writes notes in words and numbers (DevTools on a page they opened themselves) | Allowed | No automation | F11, F20, F22; FD09-F10 (ideas are free); DevTools use is this dossier's reasoning | B |
| P17 | Pace: sequential; at least 10 s between navigations on one host, or the robots.txt Crawl-delay if larger; no retry after a block; robots.txt never older than 24 h; no refetch to refresh a capture | Allowed with conditions | The gate makes a single attempt per run and reports `crawlDelay`; `MIN_DELAY_MS` is an exported constant that the skill's loop must wait between runs on one host | F01, F02, F05 (no standard number exists; 10 s is a design choice) | B |
| P18 | Origins timing and place: capture and extract others' conventions before kickoff as research, own design artifacts after kickoff; captures made in Singapore use the same gate | Allowed with conditions | Calendar rule in the skill | F24-F26 | A |

### Enforcement flow

1. **Parse the target URL.** Refuse non-HTTPS URLs and URLs with credentials. This check is not in the reference gate; the skill adds it.
2. **robots.txt.** Evaluate with `stricterOf(groups, path)` for `frontend-capture` and `Claude-User`. Disallowed or unreachable: exit 2. Challenged or refused: exit 3.
3. **TDMRep file and ai.txt.** Fetch each only if robots.txt allows the path. A challenge on either: exit 3. A reservation: exit 5.
4. **One navigation.** Use the default UA plus the suffix. Classify the result:
   - `captcha` or `hard`: exit 3.
   - `challenge` or `interstitial`: wait once for 8 s, re-classify, and exit 3 if still blocked.
   - Then check the TDM header and meta and the `Content-Usage` header: exit 5 on a reservation.
5. **Terms.** List candidate links and scan up to two, advisory only; a flag means exit 4. Store nothing without `--terms-reviewed <url>` (exit 4).
6. **Store.** Check that the directory is outside the project and outside any git work tree (else exit 6). Save `facts.json`, the viewport PNGs and `manifest.json` with SHA-256, the UA, the reviewed terms URL and the deletion deadline.
7. **Extract** the brief, then `--purge`, keeping `deletion-receipt.json`.

### Policy constants (JSON)

```json
{
  "policy": "FD19 capture policy (not legal advice)",
  "productToken": "frontend-capture",
  "alsoObeyRobotsTokens": ["Claude-User"],
  "userAgent": "<browser default UA> (compatible; frontend-capture/1.0; one-off design-reference capture, human-directed)",
  "limits": { "hosts": 4, "pagesPerHost": 3, "viewportsPerPage": 2, "minDelayMsPerHost": 10000, "robotsCacheMaxHours": 24, "retriesAfterBlock": 0, "silentChallengeGraceMs": 8000 },
  "robots": { "5xxOrNetworkError": "skip-site", "401_403_407_429": "stop", "other4xx": "allowed", "challengeHeaderOnRobots": "stop", "patternsMayStartWithStar": true, "commaSeparatedAgents": true },
  "stopSignals": {
    "headers": { "cf-mitigated": ["challenge"], "x-amzn-waf-action": ["challenge", "captcha"] },
    "status": [401, 403, 405, 407, 429, 451, 503],
    "status202EmptyBody": true,
    "interstitialTitleRegex": "(un instant|just a moment|security check|v[ée]rification de s[ée]curit[ée]|verify (that )?you are (a )?human|access denied)",
    "captchaSelectors": ["iframe[src*=\"hcaptcha.com\"]", "iframe[src*=\"/recaptcha/\"]", "iframe[src*=\"captcha-delivery.com\"]", "#px-captcha"],
    "challengeSelectors": ["iframe[src*=\"challenges.cloudflare.com\"]"],
    "nearEmptyPageVisibleElements": 60
  },
  "tdmReservation": { "tdmrepFile": "/.well-known/tdmrep.json", "tdmHeader": "tdm-reservation: 1", "tdmMeta": "meta[name=tdm-reservation][content=1]", "aiTxt": "/ai.txt disallowing the page or image files for *", "contentUsage": "ai-use=n" },
  "terms": { "attestationRequiredToStore": "--terms-reviewed <url>", "stopIfTermsForbid": ["automated access", "scraping", "crawling", "robots or bots", "data mining", "text and data mining"] },
  "storage": { "outsideProjectRoot": true, "outsideGitWorkTree": true, "manifest": "sha256 per file", "deleteWhen": "brief extracted and checked; at the latest the end of the event", "receipt": "deletion-receipt.json" },
  "forbidden": ["user-agent change", "headless-to-headed switch after a block", "stealth plugin", "navigator.webdriver or fingerprint spoofing", "CAPTCHA solver or farm", "proxy, VPN or IP rotation", "CDP attach to a personal browser profile to pass a wall", "archive mirror as a workaround", "captures in repo, site, deck, video or chat"]
}
```

The CAPTCHA and challenge selectors other than the documented headers are unverified heuristics (F07 limits). Everything under `limits` is a design choice, not a sourced standard.

### Reference implementation and how it was checked

- **Code:** [_scripts/fd19/capture-gate.mjs](_scripts/fd19/capture-gate.mjs) (423 lines, ESM, `playwright-core`). Exit codes: 0 allowed or captured, 2 robots, 3 bot wall, 4 needs human review, 5 TDM reservation, 6 storage refused, 1 error. Environment variables `PLAYWRIGHT_CORE_PATH` and `CHROMIUM_PATH` point at an installed package and browser. On this machine, playwright-core 1.63.0 expects Chromium revision 1243, while revisions 1208 and 1217 are installed.
- **Offline tests:** [_scripts/fd19/capture-gate.test.mjs](_scripts/fd19/capture-gate.test.mjs), 9 tests, all passing on 2026-10-01 (re-run at verification with node 24.13.0: `pass 9`, `fail 0`). They cover:
  - RFC 9309 §5.1 and §5.2 examples, including `Disallow: *.gif$`;
  - group merging across other records;
  - the stricter-of rule;
  - the 8 surveyed robots.txt files;
  - TDMRep spec examples;
  - `Content-Usage` parsing;
  - classification of the observed Cloudflare, AWS and FD05 responses;
  - the storage guard.
- **Live checks:** a dry run on 4 sites (F09) and a full capture-and-purge on example.com (F09 evidence; receipts copied at verification to `evidence/policy-capture-etiquette/capture-purge-example-2026-09-30/`).
- **Known gaps found at verification** (code read line by line; none of them lets the gate pass a wall, but the dossier's descriptions were broader than the code):
  - The terms scan (step 5) fetches up to two candidate links with a plain `fetch`. For a cross-origin link it does not check that origin's robots.txt, and it does not run `classifyResponse()` on those responses, so a challenge page returned for a terms link is scanned as text instead of stopping the run.
  - There is no host-count constant, and `--viewports` is not capped (P11).
  - `checkStorage()` creates the capture directory before it checks for a git work tree, so a refused run can leave an empty directory behind.
  - `manifest.json` stores the deletion deadline as a sentence ("end of extraction, and at the latest the end of the event"), not as a date.

## Contradictions between sources

1. **User-directed fetches.** Google ("generally ignore robots.txt rules") and OpenAI ("may not apply") exempt user-initiated fetches; Anthropic says all its bots, including Claude-User, honor robots.txt (F02). The policy follows Anthropic, because /frontend runs on Anthropic's model and product.
2. **Natural-language reservations.** The LG Hamburg (2024) inclined to count natural-language terms as machine-readable; the OLG Hamburg (2025) required machine interpretation and found it not shown for 2021 (F14). They agree that the test depends on the technology at the time of use. The BGH decides on 17 Dec 2026.
3. **Deletion time.** The brief says "delete after the event". Art. 4(2) allows retention "for as long as is necessary for the purposes of text and data mining". CPI L122-5-3 III says copies are "détruites à l'issue de la fouille" (F10, F13). The policy uses the French rule, with the end of the event only as a backstop.
4. **robots.txt 4xx.** RFC 9309 lets a crawler access everything when robots.txt is "unavailable" (4xx). The policy stops on 401, 403, 407 and 429, reading them as a refusal of the client rather than an absent file (F01).
5. **Contracts versus the exception.** In the EU, contract terms may override Art. 4 TDM (Art. 7(1) protects only Arts 3, 5, 6). In Singapore, s. 187 voids terms that restrict computational data analysis, yet s. 244's illustration still denies lawful access to whoever breaches a database's terms of use, "ignoring any terms that are void by virtue of section 187" (F10, F24). The Act thus anticipates the clash but does not say which access terms survive s. 187.
6. **TDMRep versus robots.txt.** TDMRep says an agent "MUST check the presence of a TDM file ... before it starts scraping", but revolut.com's robots.txt disallows `/*.json$`, which covers `/.well-known/tdmrep.json` (F08, F15). The gate lets robots.txt win; the survey, run before the gate existed, did not.
7. **CAPTCHA versus silent challenge.** The CNIL treats a CAPTCHA, which requires "une action qui ne peut être effectuée que par un être humain", as an objection to honor (F19). Cloudflare and AWS also run silent challenges that a real browser passes without human action (F07). No source says whether passing a silent challenge with an honest identity is acceptable. The policy allows one passive wait (P8, grade B) and stops at anything interactive.
8. **CJEU C-250/25 (not researched further).** In search-result excerpts only, a law firm's news page (Hengeler Mueller, 13 March 2026) said Advocate General Szpunar would deliver his opinion on 3 September 2026, and an EU-law blog dated 21 September 2026 said no opinion had been delivered. Neither page, the court's calendar nor any opinion was opened; this item carries no weight in the policy. At verification, again in search results only: the hearing was held on 10 March 2026 (LexisNexis UK, 17 April 2026), a LinkedIn post of 19 August 2026 announced the Opinion for 3 September, and EU Law Radar's post of 21 September 2026 says "no Advocate General’s Opinion has yet been delivered". No CURIA source was opened, so the status stays unresolved.

## What could not be found, and how it was searched

- **A court decision on user-agent spoofing, bot-challenge or CAPTCHA bypass** under C. pén. 323-1, Directive 2013/40, Singapore's CMA, or anti-circumvention rules. Searched with Exa (French queries on "scraping", "323-1", "contournement protection"; results were Bluetouff, Leboncoin database cases and a 2025 case on an administrator's maintenance). Not found.
- **A French decision giving robots.txt direct legal effect.** A practitioner blog (legavox.fr) cites CA Paris, SAIF c/ Google, 26 January 2011, on robots.txt as a way to oppose indexing. That decision was not opened.
- **The primary text of TJ Paris, 21 February 2025, n° 21/09261.** Two law-firm accounts were read, one in full; Judilibre was not queried.
- **A Singapore judgment applying s. 244 or the CMA to scraping.** Not searched in depth; none surfaced in the searches run.
- **A numeric industry standard for request rates.** RFC 9309 has no Crawl-delay; Anthropic supports the non-standard Crawl-delay; Cloudflare says "reasonable request rates". No number was found, so 10 s per host is a design choice.
- **Whether Claude Code's WebFetch enforces robots.txt**, beyond identifying as Claude-User. Not documented in the pages opened. At verification the Claude Code tools reference was opened: it documents the `Claude-User` User-Agent and says nothing about robots.txt (F03).
- **The Internet Archive's terms,** relevant to a Wayback fallback. Not researched; the policy forbids using mirrors as a workaround for a wall, as a design choice.
- **The Légifrance page for CPI L335-3-1 and the current L331-5.** The text was read from a Council of Europe copy and a WIPO search result. At verification the Council of Europe copy was re-read in full (it contains the condition the first quote had cut, F23), and L331-5 was seen in search results for the 2006 act and Arcom's deliberation n° 2021-09; Légifrance itself was still not opened for either.
- **The IETF individual draft `draft-car-ai-txt-wellknown-00`.** Seen in search results, not opened.
- **Whether Anthropic signed the GPAI Code's Copyright chapter.** Not checked by the researcher. Resolved at verification: Anthropic is on the Commission's list of signatories, and only xAI is flagged as having signed a single chapter (F18).
- **Perplexity's reply to Cloudflare's August 2025 post.** Not read.

## Weak spots of this dossier

- This is not legal advice, and no lawyer reviewed it. Several rows apply statutes to design capture by analogy; no court has ruled on style extraction, bot-challenge bypass or robots.txt for a one-off capture.
- The German cases are persuasive only. The CJEU has not ruled on the form of an Art. 4 reservation, and the BGH will not decide before 17 December 2026.
- **Measurements are small:**
  - 8 robots.txt files and 4 gate runs, from one French IP, on one evening;
  - bot-wall behaviour depends on IP reputation, country and time, and may differ in Singapore;
  - the gate's interstitial regex and 60-element threshold are tuned on 6 observed pages;
  - the terms scan is advisory and failed on 2 of 2 admitted sites, so the real control is a human or model attestation, which a hurried team can fake.
- Own measurements of primary artifacts (robots.txt files, headers, the default UA) are graded A; measurements that depend on the gate's own heuristics are graded B. A stricter reader could grade all own measurements B.
- **FD05's live-extraction outputs are affected.** `coinbase_ua.json`, `revolut_ua.json` and `binance_ua.json`, in `evidence/tool-awesome-design-md/live-extraction/`, were obtained by the UA swap this policy forbids. This dossier did not delete or modify them; that decision is the owner's.
- **This dossier's own research kept third-party HTML that its policy would destroy** (found at verification). The researcher's scratch folder (`scratchpad/research2/policy-capture-etiquette/`) holds full HTML copies of the kraken.com home page (1.4 MB), `kraken.com/legal` (two copies, 868 KB each) and the stripe.com home page (694 KB) in `dryrun/` and `dryrun2/`, plus the survey's raw response bodies in `survey/`. P11 forbids storing site HTML and P13 requires destruction after extraction. The verifier did not delete them, because deleting files is the owner's decision; they should be deleted now that F09 has been checked.
- **The gate's descriptions were broader than its code in a few places** (found at verification): the robots.txt check covers same-origin paths only, the terms scan does not classify walls, and only the per-host page limit is a constant. See "Known gaps" under the reference implementation.
- Several sources were read through Exa's full-page fetch rather than curl. EUR-Lex answered curl with an empty HTTP 202, the BGH reset the connection, curia.europa.eu served a JavaScript shell, and Légifrance was read through Exa from the start (the first round reported Cloudflare challenges to curl). Exa returns page text, not a model summary, but formatting (spaces before punctuation, table layouts) differs from the original. Quotes were normalised for whitespace only. At verification, curl got 200 from EUR-Lex for Directive 2019/790 and from the BGH notice, 202 from EUR-Lex for C-360/13, C-30/14 and Directive 2013/40, and a Cloudflare challenge (403, `Cf-Mitigated: challenge`) from Légifrance; the verifier did not retry with another identity and read those pages through Exa instead.

## Dropped at verification

None. Every finding's central source was re-opened and held; the errors found were overreach, cut quotes and wrong details, corrected in place.

## Verification notes

**Method.** Each of the 26 findings was checked against its cited sources, re-opened on 2026-10-01 (Paris time; late on 2026-09-30 UTC):
- Specifications, vendor pages, regulator pages, the Singapore statutes, the German judgment and press releases, the Legalis copy of Bluetouff and the Lexing article were fetched with curl under a declared UA (`fd19-factcheck/1.0`) and searched for each quote.
- EUR-Lex (C-360/13, C-30/14, Directive 2013/40) and Légifrance (CPI L122-5-3, L122-5, R122-27/28, Code pénal 323-1 to 323-8) were read through Exa's page fetch after curl met a 202 or a Cloudflare challenge.
- The IETF datatracker API was queried for both aipref drafts.
- PDFs (LG Hamburg judgment and press release, GPAI copyright chapter, Council of Europe CPI copy) were parsed with pypdf.
- The local evidence was re-read: 24 survey header files and 8 robots.txt files, the 4 current and 4 `v0-first-run` gate reports, and the UA JSON.
- Code and runs: the gate's source was read line by line against every claim the dossier makes about it. `node --test` was re-run (9 of 9 pass). The researcher's offline UA probe was re-run on `about:blank` with the same result. The installed playwright-core 1.63.0 `browsers.json` and the `ms-playwright` folder were listed.
- FD05-F25 and FD09-F27 were read to check the cross-references.

**Corrections, in short:**
- F05: the de-listing rested on the whole stealth pattern, and FD05's run was a manual re-run with a UA variable.
- F08: Revolut's query-string rule has Allow exceptions, the LINC 0.002% counts headers and metadata only, and the gate's robots.txt check covers same-origin paths only.
- F12: "confirmed" became "endorsed obiter".
- F13 and F20: R122-28 is regulatory, not statutory. F20 also: the party name follows the source read.
- F15: TDMRep defines four techniques.
- F18: Anthropic is a listed signatory.
- F22: "journalist" is not in the judgment.
- F23: the L335-3-1 I quote omitted its limiting condition, and II was added.
- F24: s. 244(2)(c)(ii) allows supply for collaborative research on the same analysis.
- F26: CMA s. 13(3)(b) can still reach captures made outside Singapore.
- Deliverable: P11 constants, P12 basis, P9 basis (F27), and the known gaps of the gate.

**Added:** F27 (C. pén. 323-7, attempt). Extra evidence was also added to F03 (Claude Code tools reference), F05, F15, F18, F24 and F26. The example.com capture-and-purge receipts were copied from the researcher's scratch folder into `evidence/policy-capture-etiquette/capture-purge-example-2026-09-30/`.

**Sources not opened, or opened only as search results:**
- CURIA and the AG's calendar for C-250/25; its status is still unresolved (Contradictions 8).
- The primary text of TJ Paris, 21 February 2025, n° 21/09261; only Lexing's account was read in full.
- Légifrance pages for CPI L335-3-1 and L331-5 (Council of Europe copy and search results only), Code pénal 121-5 (search-result excerpt of the Légifrance page), and Code civil 1119 and 1120 (search-result excerpts of Légifrance pages; the cited section page was fetched through Exa but cut off before art. 1119).
- The vLex and Lexing copies of Bluetouff, used only to confirm the pourvoi number (search results).
- The EUR-Lex text of Directive 2013/40 Art. 2(d) and Art. 3 (EUR-Lex PDF and ELI page seen as search results; recital 17 read in full through Exa).
- Perplexity's reply to Cloudflare, and the Hengeler Mueller page.
- The Kraken and Stripe website terms themselves (not needed to check F09, which is about the heuristic).

**Residual doubts:**
- The exit-4 (no attestation) and exit-6 (capture directory inside the project) runs left no receipt; they were checked from the code and the offline storage-guard test, not reproduced live.
- The truncation bug in the first terms scan could not be checked.
- The survey's declared UA (`fd19-policy-research/1.0`) cannot be checked from the saved response headers.
- The response bodies behind F08's "S3 AccessDenied 403" (binance) and "Cloudflare 403 'Forbidden'" (ledger) were saved only in the researcher's scratch folder, not in the evidence folder. At verification they read `<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>` and `Forbidden`, which confirms F08. The evidence folder alone does not show this.
- The GPAI signatory list is not broken down by chapter except for xAI.
- Whether a bot challenge is a "security measure" (Directive 2013/40), a protection whose bypass is "frauduleux" (C. pén. 323-1), a "mesure technique efficace" (CPI L331-5) or an "access control measure" (Singapore s. 423) remains undecided by any court found. Every "stop at the wall" rule rests on caution, not on a holding.
- The researcher's scratch folder still holds third-party HTML (see Weak spots). It should be deleted by the owner.
