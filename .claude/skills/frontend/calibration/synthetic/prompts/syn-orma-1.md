# syn-orma-1: unguided build from the XRPL Orma brief, run 1 of 2

Status: **not generated**. Generation happens later, under the protocol below; this file is the exact request.

| | |
|---|---|
| Brief | XRPL Orma: the README's opening paragraph, used whole: Orma has no two-sentence form, and this paragraph is its own statement of what is broken (sentences 1-2) and what Orma does (sentence 3). `C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/README.md` lines 3-8 (file SHA-256 `bc2e214717e7be4bcf9767b47d2d003ad9323087d67bc1f5d8fff0c505e79da0`, read 2026-10-01) |
| Subject in the prompt | `Orma`. The project's name (README.md line 1, `# Orma`). |
| Pair | `syn-orma-2` sends the identical prompt in its own fresh context |
| Prompt SHA-256 | `aa5c5bbc8fe23dc941ce7b7938b6f0e9f96c51e4746dcefef2ed5d28e124ca3c` (UTF-8, LF, no trailing newline) |
| Output | `calibration/synthetic/out/syn-orma-1/index.html` and `receipt.json` |
| Corpus entry | `syn-orma-1` in `calibration/corpus.json` (set `synthetic`, made_by `model`) |

## Prompt

Send the text inside the fence verbatim as the only user message, with nothing before or after it.

```text
Build a landing page and app UI for Orma, React + Tailwind, single page.

A lending vault on XRPL Devnet took 51 XRP, lent 10, and the borrower stopped paying. The manager wrote the loan down, the unit fell from 1.000000 to 0.803922, and the transaction metadata that every indexer diffs came back with `PreviousFields: {}`, an empty change set. Orma is a credit measurement, publication and enforcement layer for XLS-65 vaults and XLS-66 lending that reads solvency from ledger state instead of from metadata diffs, publishes the result as a native XLS-47 Oracle object and as a pointer inside the share token's own metadata, and lets an independent third party gate deposits on it through XLS-70 credentials.

Deliver one self-contained file, index.html, that opens directly in a browser with no build step and no other local files: load React, ReactDOM and Tailwind from a CDN (the Tailwind Play CDN script is fine) and put everything else inside the file. There is no backend and no API key, so anything the page shows has to live in the file. Reply with the complete index.html in one code block.
```

The first line is the request a hackathon builder types with no design guidance; the middle is the brief's text
exactly as the source has it; the last paragraph is the output contract, technical only.
There is deliberately no word about look, fonts, colours, layout or quality: the synthetic set measures what an
unguided model produces from a real brief, including the tells the owner's corpus never shows in full (FD14 tells
3, 18, 19 and 20; `../../../ARCHITECTURE.md` section 5.2).

Context: The event is over (12-13 Sept 2026) and the repository is public (BuzzBallz/orma).

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
