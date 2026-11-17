# syn-hedera-2: unguided build from the Hedera Scaffold-HBAR template brief, run 2 of 2

Status: **not generated**. Generation happens later, under the protocol below; this file is the exact request.

| | |
|---|---|
| Brief | Hedera Scaffold-HBAR template: section 1 "The two sentences", the primary (recommended) form. `C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/DOCS-PLAN.md` lines 20-24 (file SHA-256 `b8198977afb1a6c3b8ffc2d1269f886d625ea7ed7066afb3b2631ac920d3fbe3`, read 2026-10-01) |
| Subject in the prompt | "this project". The template has no name beyond its repository slug, and its two sentences say "This template". |
| Pair | `syn-hedera-1` sends the identical prompt in its own fresh context |
| Prompt SHA-256 | `74162dad51a19757195073e3266aa4b96882b1b381c5a500514a5106dbe3f614` (UTF-8, LF, no trailing newline) |
| Output | `calibration/synthetic/out/syn-hedera-2/index.html` and `receipt.json` |
| Corpus entry | `syn-hedera-2` in `calibration/corpus.json` (set `synthetic`, made_by `model`) |

## Prompt

Send the text inside the fence verbatim as the only user message, with nothing before or after it.

```text
Build a landing page and app UI for this project, React + Tailwind, single page.

On Hedera, a swap can pass every simulator — `eth_call`, `eth_estimateGas`, the mirror node — and still be rejected by the network, and the wallet shows no warning at all: MetaMask displayed a fee, sent it, and the failed swap cost 0.135 HBAR. This template is the swap path that knows: pre-flight checks that refuse what the network will refuse, errors decoded into one sentence and an action, gas rules for the calls no simulator can price, and every claim backed by a testnet transaction you can open.

Deliver one self-contained file, index.html, that opens directly in a browser with no build step and no other local files: load React, ReactDOM and Tailwind from a CDN (the Tailwind Play CDN script is fine) and put everything else inside the file. There is no backend and no API key, so anything the page shows has to live in the file. Reply with the complete index.html in one code block.
```

The first line is the request a hackathon builder types with no design guidance; the middle is the brief's text
exactly as the source has it; the last paragraph is the output contract, technical only.
There is deliberately no word about look, fonts, colours, layout or quality: the synthetic set measures what an
unguided model produces from a real brief, including the tells the owner's corpus never shows in full (FD14 tells
3, 18, 19 and 20; `../../../ARCHITECTURE.md` section 5.2).

Context: The bounty is due 2026-10-04 and its repository is private (gh api, 2026-10-01). A synthetic page never enters that repository and is never shown as the template's design.

## Generation protocol (identical for the eight synthetic builds)

1. **Model.** Opus 5.5 (Claude Code reports it as `claude-opus-5-5`). Record the model id the response reports.
2. **One clean context per run, one request.** Preferred: the Anthropic Messages API with no system prompt, the
   prompt above as the only user message, default sampling, `max_tokens` 32000. Accepted alternative:
   `claude -p --bare --disable-slash-commands --tools "" --model claude-opus-5-5 "<prompt>"`. Claude Code 2.1.286's
   help says `--bare` skips CLAUDE.md auto-discovery and hooks and authenticates only with `ANTHROPIC_API_KEY`,
   `--disable-slash-commands` disables all skills and `--tools ""` disables all tools; the receipt then records the
   CLI version and that Claude Code's default system prompt was present. Never generate from a workflow agent or a
   session that has CLAUDE.md, memory or a skill list loaded: this /frontend skill and the artifact-design skill are
   design guidance, which is exactly what this set must not have.
3. **No selection.** Keep the first complete reply. Retry only on a technical failure (stop reason `max_tokens`, no
   code block, an empty file), at most three attempts in total, each recorded. Never regenerate for a better or a
   worse page: the two runs of a brief sample run-to-run variance, they are not a choice.
4. **Save byte-exact.** The content of the single code block becomes `index.html` (UTF-8, LF). No edit, not even a
   fix: a page that breaks is data, flagged when it is rendered.
5. **Receipt.** `receipt.json` beside it: `{id, prompt_file, prompt_sha256, route: "messages-api"|"claude-cli",
   cli_version, model, created_at (UTC), max_tokens, temperature: "default", stop_reason, usage, attempts,
   output_sha256, extracted_from_code_block}`. `prompt_sha256` must equal the value in the table above.
6. **Then** set the corpus entry's `status` to `ready`. Never publish a synthetic page, never commit it into a
   product repository, never show it as the project's design.
