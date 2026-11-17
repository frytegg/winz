# Research provenance for /frontend

Every rule in `references/` and every detector in `scripts/rules/` cites a finding here (`[FDnn-Fmm]`) and the external
source behind it. The dossiers are the evidence base; the references are the compressed, actionable form. Nothing is
cited from model memory: the agents that build the frontends share that memory and its blind spots.

## How this evidence was produced (2026-09-30 to 2026-10-01)

1. **Research wave (FD01-FD17, 2026-09-30).** One researcher agent per topic: the tools the owner named (taste-skill,
   impeccable, Emil Kowalski's skills, Vercel's Web Interface Guidelines, awesome-design-md, the Playwright CLI, Figma
   MCP and Claude Design), the methods (image to code, logo and favicon, visual QA, first impressions and juries,
   copying and IP, stack and typography, Anthropic's own guidance), the AI-slop tells, and two internal studies (how
   /frontend plugs into /hackathon, /execution, /harden and /prose; the owner's past hackathon frontends as a corpus).
   Primary sources first; grades A-D; MEASURED, ASSERTED or OBSERVED.
2. **Adversarial verification.** A separate fact-checker per dossier re-opened every source and marked each finding
   VERIFIED, CORRECTED, DOWNGRADED or DROPPED, or added a missed primary source.
3. **Completeness critic** (`_critic-round1.md`): 13 missing topics, 20 contradictions between dossiers, weak
   dossiers, owner decisions, architecture implications.
4. **Gap round (FD18-FD21, 2026-10-01)** on the four gaps that touch the October events (wallet and transaction
   states beyond EVM, capture etiquette, recording readiness, sponsor brand kits), researched and verified the same way.
   The other critic gaps (runtime calibration, owner labels, evals of the skill, a UI-copy standard, hosting, mode B on
   an existing app, charts and diagrams) are build and calibration work, recorded in `../ARCHITECTURE.md`.

Totals across 21 dossiers: 323 verified, 265 corrected, 7 downgraded, 0 dropped, 33 added at verification.
About 42% of findings needed a correction, close to /harden's rate: misquotes, wrong numbers, dates or versions,
misattributions and claims stronger than their source.

## Dossiers

| Code | Slug | Topic | Verified | Corrected | Downgraded | Added |
|---|---|---|---|---|---|---|
| FD01 | [tool-taste-skill](tool-taste-skill.md) | The "taste skill" (Leonxlnx/taste-skill) for frontend design | 13 | 16 | 0 | 1 |
| FD02 | [tool-impeccable](tool-impeccable.md) | The "impeccable" design skill (pbakaus/impeccable) | 14 | 16 | 0 | 3 |
| FD03 | [tool-emil-kowalski](tool-emil-kowalski.md) | Emil Kowalski design-engineering principles (animation and interaction) | 17 | 12 | 1 | 1 |
| FD04 | [tool-web-design-guidelines](tool-web-design-guidelines.md) | Web Interface Guidelines and the web-design-guidelines skill | 17 | 7 | 0 | 2 |
| FD05 | [tool-awesome-design-md](tool-awesome-design-md.md) | awesome-design-md, the DESIGN.md format, and design-language extraction from live sites | 17 | 10 | 0 | 2 |
| FD06 | [tool-playwright-cli](tool-playwright-cli.md) | Playwright CLI for coding agents, and the build-screenshot-iterate loop | 20 | 9 | 0 | 1 |
| FD07 | [tool-figma-claude-design](tool-figma-claude-design.md) | Figma MCP and Claude Design: what each adds to a hackathon build | 15 | 17 | 0 | 3 |
| FD08 | [technique-image-to-code](technique-image-to-code.md) | Image-to-code: evidence, methods and a fidelity pipeline | 13 | 16 | 0 | 2 |
| FD09 | [policy-copying-and-ip](policy-copying-and-ip.md) | Copying website aspects: copyright, parasitism, trademarks, fonts, hackathon rules | 20 | 11 | 0 | 1 |
| FD10 | [evidence-ai-slop-tells](evidence-ai-slop-tells.md) | AI-slop tells in generated frontends: causes, detection, false positives | 13 | 17 | 0 | 1 |
| FD11 | [evidence-first-impressions-jury](evidence-first-impressions-jury.md) | First impressions, prototypicality, and how a jury understands a product fast | 18 | 12 | 0 | 2 |
| FD12 | [technique-logo-favicon-brand](technique-logo-favicon-brand.md) | Logo, SVG mark, favicon, OG image and naming checks for a protocol | 20 | 6 | 4 | 0 |
| FD13 | [internal-contracts](internal-contracts.md) | How /frontend plugs into /hackathon, /execution, /harden and /prose | 14 | 17 | 0 | 2 |
| FD14 | [internal-negative-corpus](internal-negative-corpus.md) | The owner's past hackathon frontends: a slop corpus for calibration | 10 | 15 | 0 | 1 |
| FD15 | [anthropic-frontend-guidance](anthropic-frontend-guidance.md) | Anthropic's own guidance on frontend design with Claude | 21 | 10 | 0 | 3 |
| FD16 | [stack-components-typography](stack-components-typography.md) | Default stack, components, typography, icons, motion, charts and wallet UI | 19 | 10 | 0 | 2 |
| FD17 | [technique-visual-qa-critique](technique-visual-qa-critique.md) | Automated visual QA and model critique of a built UI | 12 | 14 | 1 | 2 |
| FD18 | [ui-wallet-tx-states](ui-wallet-tx-states.md) | Wallet connection and transaction-state UI beyond EVM: Cardano, Ledger, and chain-agnostic states | 16 | 10 | 0 | 1 |
| FD19 | [policy-capture-etiquette](policy-capture-etiquette.md) | Automated capture of third-party sites: robots.txt, terms of use, text-and-data-mining law, bot walls, Singapore | 15 | 11 | 0 | 1 |
| FD20 | [technique-recording-readiness](technique-recording-readiness.md) | Recording-ready screens: legibility after compression, cursor, frozen data, projectors | 7 | 16 | 1 | 1 |
| FD21 | [sponsor-brand-kits](sponsor-brand-kits.md) | Sponsor brand kits and usage rules for the October events | 12 | 13 | 0 | 1 |

## Known systemic limits

- No rule threshold has been run on a rendered positive or control corpus yet; every detector threshold is a
  candidate until `calibration/` records it (critic M1).
- The owner's 20 tells come from one social video with no data (FD10-F01); no controlled study measures how a single
  UI tell changes a viewer's or a judge's rating (FD10).
- Model-critic agreement figures come from older models (GPT-4V, Claude 3.5 to 4.5 Sonnet) (FD17); no study validates
  a model as a five-second-test participant.
- Image-to-code benchmarks all measure replication with placeholder images, never a new page in a borrowed design
  language (FD08).
- Legal findings are not legal advice; several French lower-court decisions were read from reprints; Singapore
  copyright was read only for the capture exception (FD09, FD19).
- Live pages, vendor docs, star counts and package versions drift; re-read them before relying on a dated figure.
- Agent process incidents during the research, reported to the owner: one Unpaywall lookup sent the owner's email
  address as its required parameter; Artifact reads created new versions of two of the owner's Design canvases (content
  unchanged); a stray `npm install` created and then removed a home-folder node_modules; FD20 started a Chromium window
  that wrote to the Chrome for Testing profile. Three FD05 live extractions (`*_ua.json`) were obtained with a
  user-agent swap that FD19 now forbids.

## Local evidence (not committed)

`evidence/` and `assets/` hold screenshots, saved pages and probe outputs of third-party sites, kept as provenance and
ignored by git (see `../.gitignore`). `_scripts/` holds the probe and reference scripts the dossiers cite
(`fd19/capture-gate.mjs`, `fd20/recording-check.mjs`, contrast and tabular-figure checks).
