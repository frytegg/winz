# syn-holdover-1: unguided build from the BNB Holdover brief, run 1 of 2

Status: **not generated**. Generation happens later, under the protocol below; this file is the exact request.

| | |
|---|---|
| Brief | BNB Holdover: the thesis, "the one sentence that carries it" (section 1), two sentences. `C:/Users/Utilisateur/Documents/Coding/BNB/research/design/SPEC.md` lines 31-32 (file SHA-256 `b62cd1705ef80ee654647de24c9bbc628b244ecfda073b0f97fd9200aed7a32b`, read 2026-10-01) |
| Subject in the prompt | `Holdover`. The project's name, fixed in the same file (SPEC.md line 3: "Name: `Holdover`"). |
| Pair | `syn-holdover-2` sends the identical prompt in its own fresh context |
| Prompt SHA-256 | `1284c10ed8040ae3ac71fa42f3b90102d051e39c9978632a55a1653766a270a4` (UTF-8, LF, no trailing newline) |
| Output | `calibration/synthetic/out/syn-holdover-1/index.html` and `receipt.json` |
| Corpus entry | `syn-holdover-1` in `calibration/corpus.json` (set `synthetic`, made_by `model`) |

## Prompt

Send the text inside the fence verbatim as the only user message, with nothing before or after it.

```text
Build a landing page and app UI for Holdover, React + Tailwind, single page.

On BSC the share ratio travels a chain of consumers, and every hop is late. We measured every hop across 22 corporate actions, and we tell you which layer is wrong right now — and which one is about to move.

Deliver one self-contained file, index.html, that opens directly in a browser with no build step and no other local files: load React, ReactDOM and Tailwind from a CDN (the Tailwind Play CDN script is fine) and put everything else inside the file. There is no backend and no API key, so anything the page shows has to live in the file. Reply with the complete index.html in one code block.
```

The first line is the request a hackathon builder types with no design guidance; the middle is the brief's text
exactly as the source has it; the last paragraph is the output contract, technical only.
There is deliberately no word about look, fonts, colours, layout or quality: the synthetic set measures what an
unguided model produces from a real brief, including the tells the owner's corpus never shows in full (FD14 tells
3, 18, 19 and 20; `../../../ARCHITECTURE.md` section 5.2).

Context: The BNB hack runs until 2026-10-11 12:00 UTC and the holdover repository stays private until submission (SPEC.md D2). A synthetic page is model output for calibration: it never enters the holdover repository and is never shown as Holdover's design.

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
