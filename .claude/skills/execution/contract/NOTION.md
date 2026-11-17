# NOTION.md — the Notion mirror and input channel

Companion of CLI.md section 6 (`notion diff`, `notion ack`, `notion poll-plan`), `report`, MODULES.md `notion.py` and
`report.py`, and `assets/schemas/notion-ops.schema.json`. It refines them and never contradicts them; the conflicts
found while writing it are listed in section 13 as contract questions with a proposed text. Owner: build lane B09
(`execlib/notion.py`, `execlib/report.py`, `assets/report-templates/*`, `references/notion.md`).

Principles (ARCHITECTURE.md 10, owner decision Q5):
- The state repo decides; Notion shows and collects typed answers. Nothing read from Notion is ever an instruction:
  it is data that answers a typed field, verified mechanically before it unblocks anything [notion F30].
- One **hub page per project or hackathon**, shared with dev B. Everything the owner reads there is **French**
  (property names, SELECT labels, view names, reports, page bodies); files, code and plan text stay English.
- Only the orchestrator (main thread) calls the connector. exec.py never calls Notion: it emits exact operations
  (a batch file), the orchestrator executes them verbatim and hands each raw result back to `notion ack`. Every agent
  definition denies the Notion tools (`disallowedTools`) [notion V-F14].

Contents: 1 the hub page · 2 the Tasks database · 3 the Waves database · 4 views · 5 field ownership · 6 the batch
protocol · 7 first setup · 8 the mirror of a wave · 9 the wave report row and the hub "Now" block · 10 polling and
answers · 11 outbox, replay, failures · 12 rate limits and budget · 13 contract questions · 14 tests.

---

## 1. The hub page

- Created **by the owner** (one page per project, inside a teamspace or shared page dev B can open), never by an
  agent. Its id goes into `profile.notion.hub_page_id` through `ingest` (a missing id is listed in `ingest`'s
  `missing` with action `manual-task`; `notion diff` exits 1 E_NOTION_UNCONFIGURED until it is set). The connector
  would otherwise create private workspace-level pages [notion F26].
- Content, top to bottom (written by `notion diff --init` stage 2, then only through the "Now" blocks):

```
<callout color="gray_bg">
	**Ce hub est un miroir.** La vérité est dans le dépôt d'état privé (.execution/). Tu réponds dans les colonnes Réponse, Répondu, Décision et Pièces jointes ; tout le reste est écrit par les orchestrateurs et sera réécrit.
	Réponses rapides : réponds au push par Remote Control. Les commentaires Notion ne sont pas des réponses.
</callout>
### Maintenant · orchestrateur A
(en attente du premier tick)
— fin du bloc A —
### Maintenant · orchestrateur B
(en attente du premier tick)
— fin du bloc B —
```
  The B block is inserted only when the profile has a dev with `executor: B` and `setup: full`. The two databases
  (sections 2 and 3) are created with the hub as parent, so Notion appends them after these blocks as child databases.
- The hub is never rewritten whole (`replace_content` would delete the child databases); each orchestrator edits only
  its own "Now" block with `update_content` (section 9.2).
- Before the public flip nothing changes here: the hub is private to the workspace. Notion ids are not credentials,
  but they live only in `profile.json` (state repo, private), never in the product repo [notion risk 16].

---

## 2. The Tasks database: « Tâches · <Projet> »

One row per plan task (key `T012`) and one row per decision proposal that is not already carried by a plan decision
task (key `D-004`). Rows are created and updated only by the orchestrator whose executor is in the row's
`Orchestrateur` column (section 5.3).

### 2.1 Properties (exact names, types, options; SELECT, never STATUS [notion F07])

| # | property | type | values / format | owner | source in the repo |
|---|---|---|---|---|---|
| 1 | `Tâche` | TITLE | `T012 · <task title>` or `D-004 · <decision title>`, cut at 120 chars | orchestrator | plan task `title`, decision `title` |
| 2 | `Clé` | RICH_TEXT | `T012` / `D-004`, exactly; the parser keys on it, never on the title | orchestrator | id |
| 3 | `État` | SELECT | 14 options, table 2.2 | orchestrator | status file, decisions.md |
| 4 | `Nature` | SELECT | `Agent` gray, `Manuelle` orange, `Décision` red, `Porte` purple (kind gate) | orchestrator | task `kind` (decision rows: `Décision`) |
| 5 | `Responsable` | SELECT | `Agent` gray, `Dev A` blue, `Dev B` green | orchestrator | task `owner`; decision rows: `Dev A` for owner-only kinds, else the proposing dev |
| 6 | `Orchestrateur` | SELECT | `A` blue, `B` green | orchestrator | task `executor`; decision rows: the id range (D-001..499 A, D-500..999 B) |
| 7 | `Phase` | SELECT | table 2.3 | orchestrator | task `phase` |
| 8 | `Priorité` | SELECT | `P1` red, `P2` yellow, `P3` gray | orchestrator | task `priority` |
| 9 | `Dépend de` | RELATION (self, dual `Débloque`) | page ids of **same-executor** dependencies only (section 8.3) | orchestrator | `depends_on` |
| 10 | `Débloque` | RELATION (dual side of 9) | maintained by Notion | — | — |
| 11 | `Dépend de (clés)` | RICH_TEXT | `T003, T007` (every dependency, both executors) | orchestrator | `depends_on` |
| 12 | `Échéance` | DATE (datetime) | `date:Échéance:start` = UTC instant with `Z`, `date:Échéance:is_datetime` = 1 | orchestrator | `deadline_utc`, else `manual.latest_start_utc`, else schedule's P80 finish |
| 13 | `Échéance (texte)` | RICH_TEXT | `mer. 7 oct. 23:59 SGT · 17:59 Paris · zone verte` (section 9.4) | orchestrator | same instant + zone |
| 14 | `Preuve` | RICH_TEXT | `commande · exit 0` / `tx preprod relue` / `CI verte` / `fichier` / `URL 200` / `réponse vérifiée`, then `· reçu ok` or `· reçu absent` | orchestrator | `proof.type`, receipt |
| 15 | `Lien de preuve` | URL | CI run URL, explorer URL, deployed URL; null otherwise (a local receipt has no URL) | orchestrator | receipt / proof spec |
| 16 | `Vérifiée par` | RICH_TEXT | `execution-verifier · T012-1a2b3c4d-20261006T081500Z-1` or `réponse T004-tx vérifiée (chain-reread)` | orchestrator | receipt `by`, `run`; answer header |
| 17 | `Vague` | RICH_TEXT | `W03` (last wave that ran the task), empty if none | orchestrator | status `wave` |
| 18 | `P80 (min)` | NUMBER | P80 of the task's duration, rounded to an integer | orchestrator | estimate (lognormal P80 from p50/p90) |
| 19 | `Options` | RICH_TEXT | decisions only: `approve = Approuver le plan · revise = Revoir…`, one `id = label` per option, ` · ` separated, ≤ 2,000 chars | orchestrator | `manual.options` / decision `options` |
| 20 | `Ingérée` | CHECKBOX | `__YES__` / `__NO__` | orchestrator | answer or resolution recorded |
| 21 | `Réponse` | RICH_TEXT | free text typed by a human | **owner** | read by `fetch-answer` |
| 22 | `Répondu` | CHECKBOX | ticked by a human when Réponse is complete | **owner** | read |
| 23 | `Décision` | RICH_TEXT | one option id typed by the owner, e.g. `approve` | **owner** | read |
| 24 | `Pièces jointes` | FILES | photos, screenshots | **owner** | read (signed URLs, section 10.4) |

Every column carries a DDL `COMMENT` naming its owner, e.g. `COMMENT 'Écrit par l''orchestrateur ; ne pas
modifier'` or `COMMENT 'À toi : tape l''identifiant d''une option'` (SQL quoting doubles the apostrophe). No
property is named `ID` or `URL` [notion F06]. `Décision` is RICH_TEXT, not SELECT, because options differ per row and
the MCP cannot declare options per row; the typed id is checked against the decision's options in the repo.

### 2.2 `État` options (task status → label; `notion.STATE_LABELS_FR`)

| repo status | label | colour |
|---|---|---|
| planned | `Prévue` | gray |
| ready | `Prête` | blue |
| running (agent task) | `En cours` | yellow |
| running (manual or decision task, posted) | `Attend ta réponse` | red |
| built | `Intégrée` | purple |
| verifying | `En vérification` | purple |
| done | `Prouvée` | green |
| failed | `Échec` | orange |
| blocked-manual | `Bloquée (action)` | red |
| blocked-decision | `Bloquée (décision)` | red |
| cut-proposed | `Coupe proposée` | pink |
| cut | `Coupée` | brown |
| superseded | `Remplacée` | brown |
| decision row: proposal open / resolved | `Attend ta réponse` / `Tranchée` | red / green |

The DDL declares exactly these 14 labels in this order (`Tranchée` is the 14th). A label never changes once
declared; a new label is a contract change (it needs an `update-data-source ALTER COLUMN` stage).

### 2.3 `Phase` options

`setup` → `Mise en place` · `contract` → `Contrat` · `build` → `Construction` · `integrate` → `Intégration` ·
`verify` → `Vérification` · `ops` → `Exploitation` · `recon` → `Veille` · `audit` → `Audit` · `manual` → `Manuel` ·
`decision` → `Décision` · `deliverable` → `Livrable` · `fix` → `Correctif`. Colours: default.

### 2.4 Page body (content) of a row

Written on create and replaced only when its source changes (a body change is part of the row hash, section 8.2).
Agent tasks: one line `Tâche du plan v<n> · voir EXECUTION.md` (no prose that could drift). Manual and decision tasks
(the owner reads these on the phone), single column:

```
### Ce qu'il faut faire
1. <manual.steps[0], verbatim>
2. ...
### À rapporter
- <bring_back.key> (<kind en français>) : <bring_back.description, verbatim> · vérifié par <méthode en français>
### Où et quand
- Où : <téléphone | ordinateur | sur place>
- Commencer au plus tard : <latest start, display 9.4>
### Options
- `approve` : <label> — <consequence>
### Comment répondre
- Le plus rapide : réponds au push par Remote Control.
- Ici : écris dans « Réponse » (et l'identifiant d'option dans « Décision » pour une décision), puis coche « Répondu ».
```
Kinds in French: tx-hash `hash de transaction`, screenshot `capture d'écran`, text `texte`, transcript
`transcription`, file `fichier`, choice `choix`, url `lien`, sha `SHA de commit`. Methods: chain-reread `relu sur la
chaîne`, file-exists `fichier présent`, choice-in-options `option valide`, regex `format vérifié`, sha-on-origin-main
`commit présent sur origin/main`, url-resolves `lien qui répond`, owner-attest `ta confirmation`.

`manual.steps` and `bring_back.description` of owner-facing manual and decision tasks are written in French by the
planner (owner-facing text is French, README.md 3.4; AGENTS.md P7) and quoted verbatim inside the French frame:
exec.py never translates. Text that came from a verifier's output passes `log.redact` and the secret scan first
(CLI.md `notion ack`).

---

## 3. The Waves database: « Vagues · <Projet> »

One row per finished wave of either orchestrator (key `wave:W03`), created once by the orchestrator that ran the wave,
never updated afterwards (a correction is a new report in the repo and a new row `W03 · A · correctif`).

| property | type | value | owner |
|---|---|---|---|
| `Vague` | TITLE | `W03 · A` | orchestrator |
| `Orchestrateur` | SELECT | `A` blue, `B` green | orchestrator |
| `Lancée` | DATE (datetime) | wave `launched_utc` | orchestrator |
| `Close` | DATE (datetime) | wave `finished_utc` (ingest time when unknown) | orchestrator |
| `Heures (texte)` | RICH_TEXT | `lancée mar. 6 oct. 14:05 SGT · 08:05 Paris ; close 15:10 SGT · 09:10 Paris` | orchestrator |
| `Zone` | SELECT | `Verte` green, `Jaune` yellow, `Rouge` red, `Inconnue` gray | orchestrator |
| `P80 fin de build` | RICH_TEXT | `mer. 7 oct. 09:40 SGT · 03:40 Paris (P90 11:15 SGT)` | orchestrator |
| `Prouvées` | NUMBER | tasks that reached done in this wave | orchestrator |
| `Échecs` | NUMBER | tasks failed or blocked in this wave | orchestrator |
| `Ouvertes` | NUMBER | open tasks of this executor's share after the wave | orchestrator |
| `Ta prochaine action` | RICH_TEXT | the first line of the report's "Ta prochaine action" section | orchestrator |
| `Pouls` | RICH_TEXT | `disque 6,2 Go · RAM 2,1 Go · quota 5 h 41 % · semaine 72 % · tick 14:20 SGT / 08:20 Paris` | orchestrator |

The page body is the full French report of section 9.1. No owner-writable field: answers go to the Tasks rows.

---

## 4. Views

Created by `notion diff --init` stage 4 with `notion-create-view` (DSL from `notion://docs/view-dsl-spec`). Their
URLs are captured into `profile.notion.views.*` (section 7.3).

| profile key | name | database | type | `configure` |
|---|---|---|---|---|
| `board` | `Tableau` | Tâches | board | `GROUP BY "État"; SORT BY "Échéance" ASC; SHOW "Tâche", "Responsable", "Échéance (texte)", "Preuve"` |
| `needs_dev_a` | `À faire · Dev A` | Tâches | list | `FILTER "Responsable" = "Dev A" AND "État" IN ("Attend ta réponse", "Bloquée (action)", "Bloquée (décision)", "Coupe proposée"); SORT BY "Échéance" ASC; SHOW "Tâche", "Échéance (texte)", "Options", "Réponse", "Décision", "Répondu"` |
| `needs_dev_b` | `À faire · Dev B` | Tâches | list | same with `"Dev B"` (created even for one developer, so the profile shape stays fixed) |
| `to_ingest` | `À ingérer` | Tâches | table | `FILTER ("Répondu" = TRUE OR "Décision" IS NOT EMPTY) AND "Ingérée" = FALSE; SORT BY "Échéance" ASC; SHOW "Tâche", "Clé", "Orchestrateur", "Répondu", "Décision"` |
| `waves` | `Vagues` | Vagues | list | `SORT BY "Lancée" DESC; SHOW "Vague", "Zone", "P80 fin de build", "Ta prochaine action", "Pouls"` |

`À ingérer` is the only polling target and is always read in **view mode** (quota-free; rows mode is metered and
shares the SQL allowance) [notion V-F02]. Both orchestrators read the same view and each ignores rows whose
`Orchestrateur` is not its own.

---

## 5. Ownership

### 5.1 Fields
Orchestrator-owned (written only by `notion diff` ops): properties 1-20 of 2.1 and every Waves property. Owner-owned
(never in any op's `args.properties`, enforced by `notion.py` and tested): `Réponse`, `Répondu`, `Décision`,
`Pièces jointes`. `Ingérée` is orchestrator-owned: the owner never unticks it (the row would reappear in `À ingérer`
with an already-consumed answer; section 10.3 handles a reposted task).

### 5.2 Divergence
A human edit of an orchestrator-owned field is detected, never applied, never silently overwritten [notion rec 4]:
- Whenever exec.py receives the full properties of an own row (a `fetch-answer` result, a `view:board` map rebuild),
  it recomputes `row_hash` from the fetched orchestrator-owned values (same canonicalisation as 8.2) and compares it
  with `local/state.json notion.hashes[key]`.
- On mismatch: the row's key is added to `local/notion/divergence.json` (`{key: {seen_utc, fields: [names]}}`), a
  decision is proposed (`decision propose --kind other --title "Notion : <key> modifiée à la main (<fields>)"`, options
  `rewrite` = « Réécrire depuis le dépôt » (recommended) and `amend` = « Proposer une modification du plan »), and
  every update of that row is **held** until the decision resolves (`rewrite` clears the hold and the next diff
  rewrites the row; `amend` returns the `amend` route and clears the hold once the amendment lands).
- Rows are not polled for divergence otherwise: the mirror does not spend reads to police the owner.

### 5.3 Rows (two developers, TWO-DEV.md section 7)
Orchestrator X writes only: Tasks rows whose `Orchestrateur` is X, decision rows in X's id range, Waves rows of its own
waves, its own "Now" block. Dev A's orchestrator creates the hub skeleton, both databases and the views (stage 1-4);
dev B's orchestrator never runs `--init` stages 2-4 and attaches through the ids in the shared `profile.json`.

---

## 6. The batch protocol (`notion-ops.schema.json`, refined)

### 6.1 Executing a batch (orchestrator, main thread)
1. `exec.py notion diff [...]` writes `local/notion/batches/<batch_id>.json` and prints it. Empty `ops`: nothing to do.
2. For each op in array order, call the Notion tool whose name **ends with** `op.tool` (prefixes vary:
   `mcp__claude_ai_Notion__`, `mcp__notion__`, `mcp__plugin_Notion_notion__`), with `op.args` passed verbatim. At most
   3 calls in flight, and never two in flight that touch the same `key`.
3. After each call, write the raw tool result (the exact text the tool returned) to
   `local/notion/results/<batch_id>/<op_id>.txt` with the Write tool and run `exec.py notion ack --batch <id> --op
   <op_id> --result-file <that file>`; on a tool error write the error text (first 300 chars) to
   `local/notion/results/<batch_id>/<op_id>.error.txt` and run `exec.py notion ack --batch <id> --op <op_id> --failed
   --error-file <that file>` plus `--retry-after <s>` when the error carries `rate_limited` and `retry_after_seconds`
   (tool text never reaches a shell command line, CLI.md 0.7).
4. On the first `rate_limited` error, stop the batch: every op not yet called is acked `--failed --error-code
   deferred:rate_limited` (they go to the outbox, section 11) and the rest of the tick continues without Notion.
5. Then run `batch.followup` when it is not null (usually `exec.py notion diff` for the next stage).
The orchestrator never edits `args`, never adds an op, never calls a Notion tool outside a batch (exception: none).

### 6.2 Captures (`op.capture[].pointer`)
Tool results are Markdown or JSON depending on the tool. `notion ack` interprets a pointer as:
- `/a/b/0` — a JSON pointer, when the raw result parses as JSON;
- `re:<regex>` — the first capture group of the first match of the Python regex over the raw text;
- `re*:<regex>` — every match in order (used for `create-pages`: the n-th match is the n-th page of `args.pages`,
  mapped by its `Clé`; a count different from `len(args.pages)` makes the ack a failure with E_CAPTURE_COUNT and
  schedules a `view:board` map rebuild before any further create, so a partial create never yields duplicates).
Standard pointers (ids are normalised to 32 lowercase hex without dashes when stored):

| capture name | pointer |
|---|---|
| `ds:tasks`, `ds:waves` | `re:<data-source url="(collection://[0-9a-f-]{32,36})"` |
| `db:tasks`, `db:waves` | `re:(?:notion\.so/|^|[^0-9a-f])(?:[A-Za-z0-9-]*-)?([0-9a-f]{32})(?![0-9a-f])` applied to the first `https://www.notion.so/...` URL of the result |
| `view:<name>` | `re:(view://[0-9a-f-]{32,36}|https://www\.notion\.so/[^\s"<>]*\?v=[0-9a-f-]{32,36})` |
| `rows:tasks`, `rows:waves` | `re*:https://www\.notion\.so/(?:[^\s"<>/]*-)?([0-9a-f]{32})` |
| `async:<key>` | `re:"?task_id"?\s*[:=]\s*"?([A-Za-z0-9_-]+)` |

These patterns are verified in the rehearsal against real results (section 14, R-N1); a pattern that matches nothing
fails the ack (E_CAPTURE_EMPTY), never records an empty id.

### 6.3 Async results
Creates are sent with `allow_async: false`; updates are sent with `allow_async: false` too, but the server may still
answer with an `async_task` [notion V-F11, missed-9]. When an ack sees an `async_task` result, the op is recorded as
`pending-async` (no hash recorded) and the next `notion diff` emits a stage of kind `async-poll` with one
`notion-get-async-task` op per pending task (`args: {"task_id": "<id>"}`, `purpose: async-poll`, same `key`).
`succeeded` → the original op's captures are applied to the included result and its hash is recorded; `queued`,
`running` or `retrying` → polled again at the next diff (at most 10 polls, then outbox with E_ASYNC_TIMEOUT);
`failed` → outbox. An update counts as done only after `succeeded` [notion missed-9].

### 6.4 Stages
An op never uses an id produced by another op of the same batch. Anything that needs an earlier id is emitted by the
next `notion diff` as stage n+1, once the earlier ops are acked. `local/state.json notion.pending_batches` holds the
unacked batch ids; `notion diff` refuses (exit 1, E_NOTION_PENDING with the batch id) while a batch it emitted is not
fully acked, except with `--replay-outbox` after the orchestrator acked the rest as failed. After a crash or a
compaction between a call and its ack, `exec.py resume` (step R9) acks every unacked op `--failed --error-code
crash-unknown`; their creates then go through the `view:board` map rebuild (11.3) before any re-create, no sooner
than 60 s after the batch's emit time (a view query can lag a fresh create); a stored batch is never re-executed by
hand (references/recovery.md).

---

## 7. First setup (`exec.py notion diff --init`, executor A)

Run once per project after `ingest` (hub id known) and before the first wave report. Each stage is a separate batch
of kind `init`; `notion diff --init` emits the first stage whose ops are not all acked ok, so re-running it is
converging. Resulting ids are captured, then written to the profile (7.3).

### 7.1 Stages and exact ops

**Stage 1 — token and hub check** (2 calls)
```json
{"op_id":"op-1","tool":"notion-get-tool-access","args":{"tool_names":["fetch","create_database","update_data_source","create_view","create_pages","update_page","query_data_sources","get_async_task"]},"key":"token","purpose":"token-check","hash":null,"capture":[]}
{"op_id":"op-2","tool":"notion-fetch","args":{"id":"<hub_page_id>"},"key":"hub","purpose":"token-check","hash":null,"capture":[]}
```
Ack of op-1 records each tool's `status` in `local/notion/access.json`; a status other than `available` or
`available_with_limit` for one of these tools stops setup with a `dependency-missing` decision (the core loop needs
them all) [notion V-F01]. Ack of op-2 records whether the hub already holds `### Maintenant · orchestrateur A` (a
re-run after a crash must not insert the skeleton twice) and its child databases named `Tâches · ` / `Vagues · `
(adopted instead of recreated: their ids are captured from the fetch).

**Stage 2 — hub skeleton and the two databases** (≤ 3 calls)
```json
{"op_id":"op-1","tool":"notion-update-page","args":{"page_id":"<hub>","command":"insert_content","position":{"type":"start"},"content":"<hub skeleton of section 1, with the B block only for two full-setup devs>","allow_async":false},"key":"hub","purpose":"hub-now","hash":"<sha256 of the skeleton>","capture":[]}
{"op_id":"op-2","tool":"notion-create-database","args":{"parent":{"type":"page_id","page_id":"<hub>"},"title":"Tâches · <project.name>","description":"Miroir du plan .execution/plan.json, écrit par les orchestrateurs. Tes colonnes : Réponse, Répondu, Décision, Pièces jointes.","schema":"<DDL_TASKS>"},"key":"db:tasks","purpose":"create-db","hash":null,"capture":[{"pointer":"re:<data-source url=\"(collection://[0-9a-f-]{32,36})\"","as":"ds:tasks"},{"pointer":"<db pattern 6.2>","as":"db:tasks"}]}
{"op_id":"op-3","tool":"notion-create-database","args":{"parent":{"type":"page_id","page_id":"<hub>"},"title":"Vagues · <project.name>","description":"Un rapport par vague, en français.","schema":"<DDL_WAVES>"},"key":"db:waves","purpose":"create-db","hash":null,"capture":[{"pointer":"re:<data-source url=\"(collection://[0-9a-f-]{32,36})\"","as":"ds:waves"},{"pointer":"<db pattern 6.2>","as":"db:waves"}]}
```
`DDL_TASKS` (`notion.DDL_TASKS`, one line in the op; shown wrapped):
```
CREATE TABLE ("Tâche" TITLE COMMENT 'Écrit par l''orchestrateur',
 "Clé" RICH_TEXT COMMENT 'Identifiant du plan (T012, D-004) ; écrit par l''orchestrateur',
 "État" SELECT('Prévue':gray, 'Prête':blue, 'En cours':yellow, 'Attend ta réponse':red, 'Intégrée':purple,
   'En vérification':purple, 'Prouvée':green, 'Échec':orange, 'Bloquée (action)':red, 'Bloquée (décision)':red,
   'Coupe proposée':pink, 'Coupée':brown, 'Remplacée':brown, 'Tranchée':green) COMMENT 'Écrit par l''orchestrateur',
 "Nature" SELECT('Agent':gray, 'Manuelle':orange, 'Décision':red, 'Porte':purple) COMMENT 'Écrit par l''orchestrateur',
 "Responsable" SELECT('Agent':gray, 'Dev A':blue, 'Dev B':green) COMMENT 'Écrit par l''orchestrateur',
 "Orchestrateur" SELECT('A':blue, 'B':green) COMMENT 'Seul cet orchestrateur écrit la ligne',
 "Phase" SELECT('Mise en place':default, 'Contrat':default, 'Construction':default, 'Intégration':default,
   'Vérification':default, 'Exploitation':default, 'Veille':default, 'Audit':default, 'Manuel':default,
   'Décision':default, 'Livrable':default, 'Correctif':default) COMMENT 'Écrit par l''orchestrateur',
 "Priorité" SELECT('P1':red, 'P2':yellow, 'P3':gray) COMMENT 'Écrit par l''orchestrateur',
 "Dépend de (clés)" RICH_TEXT COMMENT 'Écrit par l''orchestrateur',
 "Échéance" DATE COMMENT 'UTC ; lis plutôt Échéance (texte)',
 "Échéance (texte)" RICH_TEXT COMMENT 'Heure de Singapour et de Paris, zone',
 "Preuve" RICH_TEXT COMMENT 'Écrit par l''orchestrateur',
 "Lien de preuve" URL COMMENT 'Écrit par l''orchestrateur',
 "Vérifiée par" RICH_TEXT COMMENT 'Écrit par l''orchestrateur',
 "Vague" RICH_TEXT COMMENT 'Écrit par l''orchestrateur',
 "P80 (min)" NUMBER COMMENT 'Écrit par l''orchestrateur',
 "Options" RICH_TEXT COMMENT 'Décisions : identifiant = libellé',
 "Ingérée" CHECKBOX COMMENT 'Coché par l''orchestrateur quand ta réponse est enregistrée',
 "Réponse" RICH_TEXT COMMENT 'À toi',
 "Répondu" CHECKBOX COMMENT 'À toi : coche quand Réponse est complète',
 "Décision" RICH_TEXT COMMENT 'À toi : tape l''identifiant d''une option',
 "Pièces jointes" FILES COMMENT 'À toi')
```
`DDL_WAVES`:
```
CREATE TABLE ("Vague" TITLE, "Orchestrateur" SELECT('A':blue, 'B':green), "Lancée" DATE, "Close" DATE,
 "Heures (texte)" RICH_TEXT, "Zone" SELECT('Verte':green, 'Jaune':yellow, 'Rouge':red, 'Inconnue':gray),
 "P80 fin de build" RICH_TEXT, "Prouvées" NUMBER, "Échecs" NUMBER, "Ouvertes" NUMBER,
 "Ta prochaine action" RICH_TEXT, "Pouls" RICH_TEXT)
```

**Stage 3 — the self-relation** (1 call; needs `ds:tasks`) [notion F06, two calls]
```json
{"op_id":"op-1","tool":"notion-update-data-source","args":{"data_source_id":"<ds:tasks>","statements":"ADD COLUMN \"Dépend de\" RELATION('<ds:tasks>', DUAL 'Débloque' 'debloque')"},"key":"relation:tasks","purpose":"self-relation","hash":null,"capture":[]}
```
`<ds:tasks>` is the bare UUID (dashes kept as captured). Ack success is checked by `re:Dépend de` in the result.

**Stage 4 — views** (5 calls; needs db and ds ids)
```json
{"op_id":"op-1","tool":"notion-create-view","args":{"database_id":"<db:tasks>","data_source_id":"<ds:tasks>","name":"Tableau","type":"board","configure":"GROUP BY \"État\"; SORT BY \"Échéance\" ASC; SHOW \"Tâche\", \"Responsable\", \"Échéance (texte)\", \"Preuve\""},"key":"view:board","purpose":"create-view","hash":null,"capture":[{"pointer":"<view pattern 6.2>","as":"view:board"}]}
```
and the same shape for `view:needs_dev_a`, `view:needs_dev_b`, `view:to_ingest` (table 4) on the Tasks database, and
`view:waves` with `"database_id":"<db:waves>","data_source_id":"<ds:waves>"`.

**Stage 5** is the first mirror (section 8), emitted by the same `--init` call once stage 4 is acked.

### 7.2 Calls and timing
5 batches, 11 calls before the first row; under one minute at 3 in flight; no query calls.

### 7.3 Writing the ids to the profile
The ids are profile fields (`notion.databases.{tasks,waves}.{database_id,data_source_id}`, `notion.views.*`).
`notion ack` stores captures in `local/notion/ids.json` and, when stage 4 is complete, prints in `next` the command
`exec.py ingest --patch local/notion/profile-ids.patch.json --notion-ids` (patch written by the ack; it only fills
null fields under `/notion/databases` and `/notion/views` and never overwrites a non-null value; CLI.md `ingest`
allows this form without a decision and refuses any other pointer or a non-null target).

### 7.4 Dev B attaching
Dev B's orchestrator runs `notion diff --init` too: stage 1 (token check through its own connection, which proves
membership), then, the databases and views being already in the profile, only its own "Now" block insert when the
hub fetch shows it absent (`hub-now`, `insert_content` with `position: {"type": "end"}` would land after the
databases, so B's block is part of A's skeleton from the start whenever the profile lists a full-setup dev B; B
inserts it itself only when it was added later, and then at the end of the hub).

---

## 8. The mirror of a wave (`exec.py notion diff --wave Wnn`)

### 8.1 What is in a mirror batch (kind `mirror`, then `report`)
In this order, own rows only:
1. **create-row**: one `notion-create-pages` op for every own task or decision without a page id, ≤ 100 pages per
   op (several ops if more), parent `{"type":"data_source_id","data_source_id":"<ds:tasks>"}`, `allow_async: false`:
```json
{"op_id":"op-1","tool":"notion-create-pages","args":{"parent":{"type":"data_source_id","data_source_id":"<ds:tasks>"},"allow_async":false,"pages":[{"properties":{"Tâche":"T012 · Queue length endpoint","Clé":"T012","État":"Prête","Nature":"Agent","Responsable":"Agent","Orchestrateur":"A","Phase":"Construction","Priorité":"P1","Dépend de (clés)":"T003, T007","date:Échéance:start":"2026-10-06T09:40:00Z","date:Échéance:is_datetime":1,"Échéance (texte)":"mar. 6 oct. 17:40 SGT · 11:40 Paris · zone verte","Preuve":"commande · exit 0 · reçu absent","Lien de preuve":null,"Vérifiée par":"","Vague":"","P80 (min)":41,"Options":"","Ingérée":"__NO__"},"content":"Tâche du plan v1 · voir EXECUTION.md"}]},"key":"T012","purpose":"create-row","hash":"<row_hash of the first page>","capture":[{"pointer":"re*:https://www\\.notion\\.so/(?:[^\\s\"<>/]*-)?([0-9a-f]{32})","as":"rows:tasks"}]}
```
   A multi-page op has `key` = the first page's key; `notion ack` records one page id and one hash per page from
   `rows:tasks` (the hashes of the other pages are kept in the op's optional `row_hashes` field, notion-ops.schema.json).
2. **update-row**: one `notion-update-page` per own row whose desired hash differs from the acked hash and that is
   not held (5.2):
```json
{"op_id":"op-2","tool":"notion-update-page","args":{"page_id":"<page>","command":"update_properties","properties":{"État":"Prouvée","Preuve":"commande · exit 0 · reçu ok","Vérifiée par":"execution-verifier · T012-1a2b3c4d-20261006T081500Z-1","Vague":"W03"},"allow_async":false},"key":"T012","purpose":"update-row","hash":"<new row_hash>","capture":[]}
```
   Only the changed properties are sent (the hash covers all of them). A body change is a second op with
   `"command":"replace_content","new_str":"<body>"` (bodies contain no child page or database, so nothing is deleted).
3. **relations** (stage n+1 after the creates, section 8.3).
4. **wave-report** and **hub-now** (section 9), when `--wave` is given.
5. **set-ingested** ops queued by `answers ingest` / `decision resolve` since the last batch (section 10.3).

### 8.2 The row hash (`notion.row_hash`)
`sha256(canonical({"properties": <every orchestrator-owned property value exactly as sent, dates as the two
date:Échéance:* keys, null kept>, "body": <body text>}))`, canonical as SCHEMAS.md 1.4. The desired properties come
from `notion.row_properties(task, task_state, profile)` (plan, status, receipt, answer, schedule cache), so a row is
rewritten exactly when something the owner sees changed. Same inputs → same batch bytes (tests).

### 8.3 Dependencies
The native relation holds same-executor dependencies only, because the other executor's page ids exist only on the
other machine (local state is not shared); `Dépend de (clés)` always lists every dependency. Once a row and all its
same-executor dependency rows have page ids, the next diff emits one `update-page` per row with
`{"Dépend de":["<page id>", ...]}` (≤ 100 relations per request [notion F10]), key = the row key, purpose
`self-relation`. Relations are re-sent only when `depends_on` changes (an amendment), and the relation value is part
of the row hash.

### 8.4 What changes the State column
`État` follows the status file exactly (2.2). A manual or decision task posted by `manual post` shows
`Attend ta réponse`; after `answers ingest` it shows the status it reached (done → `Prouvée`; verification failed →
stays `Attend ta réponse`, and the body gains a first line `Réponse refusée le <date> : <detail>`).

---

## 9. The wave report row and the hub "Now" block

### 9.1 The French wave report (`assets/report-templates/wave.fr.md`, rendered by `report.render_wave_fr`)
Rendered by script from receipts, status files, `local/schedule.json`, the governor and the quota readings, never
from model prose. Single column (the phone collapses columns [notion F25]): headings, bullet lists, one callout, no
table wider than two columns. ≤ 6,000 characters (`report` data `text_fr`); each list is cut at 8 items with
`… et <n> autres (voir EXECUTION.md)`. Template (placeholders in `{{ }}`; empty lists render `Rien.`):

```
<callout color="{{zone_colour}}_bg">
	**{{zone_label}}** · fin de build P80 {{p80_build_complete}}
	P90 {{p90_build_complete}}
	{{one_line_status}}
</callout>
## Fait
- {{task_id}} · {{title}} — intégrée {{landed_sha8}}, {{verdict_fr}}
## Prouvé
- {{task_id}} · {{title}} — {{proof_fr}} · [preuve]({{proof_link}}) · vérifiée par {{verifier}} ({{run_id}})
## Ouvert
- {{n_failed}} en échec, {{n_blocked}} bloquées, {{n_ready}} prêtes, {{n_planned}} prévues
- {{task_id}} · {{title}} — {{open_reason_fr}}
## Ta prochaine action
1. {{task_or_decision_id}} · {{what_fr}} — avant {{latest_start}} · {{where_fr}}
## Zone et P80
- Échéance {{deadline_label}} : {{deadline_display}}
- À l'heure avec {{p_on_time_pct}} % de chances · zone {{zone_word}}
- Fin de build P50 : {{p50}}
- Fin de build P80 : {{p80}}
- Fin de build P90 : {{p90}}
- Chemin critique : {{critical_path_ids}}
## Pouls
- Disque libre {{disk_free_gb}} Go (plancher {{disk_floor_gb}} Go) · RAM libre {{ram_free_gb}} Go
- Quota 5 h : {{five_hour_pct}} %, remise {{five_hour_resets}}
- Quota semaine : {{seven_day_pct}} %, remise {{seven_day_resets}}
- Relevé du quota il y a {{snapshot_age}}
- Dernier tick : {{last_tick_sgt}} · {{last_tick_paris}}
- Vague {{wave}} : {{n_agents}} agents, {{reruns}} relances, durée {{wave_duration}}
```
Rules:
- **Line length**: every rendered line is at most 100 characters (TESTS.md 3.9); a bullet longer than that is
  shortened by cutting the task title with `…` first, then the verifier and run id; a proof link is never cut. A
  callout's inner lines count too.
- **Incoherence**: a task whose status is `done` but whose receipt is missing or fails the done check is never listed
  under Prouvé; it appears once under Ouvert as `incohérence : <id> marquée prouvée sans reçu valide` (and the tick
  raises it).
- **Fait** = tasks of this wave that reached `built` or `verifying`, or whose merge landed (with the short landed SHA);
  `verdict_fr`: `en vérification`, `preuve échouée (tentative n/2)`, `relancée (agent absent)`.
- **Prouvé** = tasks that reached `done` in this wave, each with its proof link: the `Lien de preuve` URL when one
  exists, else the state-relative receipt path in backticks (`proofs/T012.json`), never an invented link.
- **Ouvert** = counts over this executor's share, then up to 8 failed or blocked tasks with their reason from the
  status `blocked.reason` or the verifier's first finding claim (data, quoted).
- **Ta prochaine action** = awaiting manual and decision items sorted by latest start, then open decision proposals
  (cuts, red zone, divergence); `Rien à faire pour l'instant.` when empty — then `push_text_fr` is null.
- **Zone et P80** = from `local/schedule.json` zones for `DL-build-complete` and the submission deadline; `zone_word`
  `verte | jaune | rouge | inconnue` (unknown when the schedule cache is older than the last plan version);
  `one_line_status` e.g. `3 prouvées, 1 échec, 2 en cours ; le build tient l'échéance avec 82 % de chances.`
- **Pouls** = the last governor and quota readings with their age; a missing reading renders `non mesuré`, never 0.
- Number format French: decimal comma (`6,2 Go`), percentages as integers. Times per 9.4.

### 9.2 The report row (purpose `wave-report`, key `wave:Wnn`)
```json
{"op_id":"op-7","tool":"notion-create-pages","args":{"parent":{"type":"data_source_id","data_source_id":"<ds:waves>"},"allow_async":false,"pages":[{"properties":{"Vague":"W03 · A","Orchestrateur":"A","date:Lancée:start":"2026-10-06T06:05:00Z","date:Lancée:is_datetime":1,"date:Close:start":"2026-10-06T07:10:00Z","date:Close:is_datetime":1,"Heures (texte)":"lancée mar. 6 oct. 14:05 SGT · 08:05 Paris ; close 15:10 SGT · 09:10 Paris","Zone":"Verte","P80 fin de build":"mer. 7 oct. 09:40 SGT · 03:40 Paris (P90 11:15 SGT)","Prouvées":3,"Échecs":1,"Ouvertes":17,"Ta prochaine action":"T004 · financer le portefeuille preprod avant 15:30 SGT","Pouls":"disque 6,2 Go · RAM 2,1 Go · quota 5 h 41 % · semaine 72 % · tick 15:12 SGT / 09:12 Paris"},"content":"<report of 9.1>"}]},"key":"wave:W03","purpose":"wave-report","hash":"<sha256 of the report text>","capture":[{"pointer":"re*:https://www\\.notion\\.so/(?:[^\\s\"<>/]*-)?([0-9a-f]{32})","as":"rows:waves"}]}
```
A wave report row is created once: its key's page id in `notion.pages` makes later diffs skip it.

### 9.3 The hub "Now" block (purpose `hub-now`, key `hub`)
The block of executor X is the text from `### Maintenant · orchestrateur X` to `— fin du bloc X —` inclusive, ≤ 1,500
characters:
```
### Maintenant · orchestrateur A
**{{run_state_fr}}** · {{zone_label}} · fin de build P80 {{p80_build_complete}}
- À toi : {{first_action_or_rien}}
- En cours : {{running_ids_or_rien}} · vague {{wave}}
- Pouls : disque {{disk}} Go · RAM {{ram}} Go · quota semaine {{seven_day_pct}} % · tick {{last_tick_sgt}} / {{last_tick_paris}}
- Dernier rapport : {{wave}} (base Vagues)
— fin du bloc A —
```
`run_state_fr`: RUNNING `En marche`, AWAITING_HUMAN `Attend une action`, AWAITING_DECISION `Attend une décision`,
PAUSED_QUOTA `En pause (quota)`, PAUSED_RESOURCES `En pause (disque ou RAM)`, STUCK `Bloqué : regarde l'ordinateur`,
BUILD_COMPLETE `Build terminé`, HANDED_OVER `Remis : tape /harden`, FIX `Correctifs`, others `Préparation`.
The op:
```json
{"op_id":"op-8","tool":"notion-update-page","args":{"page_id":"<hub>","command":"update_content","content_updates":[{"old_str":"<the last block text this orchestrator wrote and acked>","new_str":"<new block text>"}],"allow_async":false},"key":"hub","purpose":"hub-now","hash":"<sha256 of the new block>","capture":[]}
```
`old_str` is kept verbatim in `local/notion/hub-now.txt` (its sha256 in `notion.last_hub_text_sha256`). If the ack
fails with a no-match error (someone edited the block), the next diff emits a `notion-fetch` of the hub (purpose
`hub-now`), and `notion ack` stores the fetched Markdown; the following diff extracts the current block between the
two marker lines of executor X and uses it as `old_str`. If a marker line is gone, the block is re-inserted at the end
of the hub (`insert_content`, `position: {"type":"end"}`) and a line is added to the report: `Bloc « Maintenant »
recréé : il avait été modifié à la main.` Emitted at every wave report and at most once per tick otherwise (heartbeat
ticks refresh the pulse), never more than once per 10 minutes.

### 9.4 Times in French
Every displayed instant comes from `clock.display` over `profile.event.display_zones` and is rendered by
`report.fr_display`: `<day> <d> <month> <HH:MM> <label>` with days `lun. mar. mer. jeu. ven. sam. dim.` and months
`janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.`, e.g. `mer. 7 oct. 23:59 SGT · 17:59 Paris` (the
second zone drops the date when it is the same day). The zone fallback of `clock.display` (W_TZ_FALLBACK) appends
` (décalage fixe)` to the label. Notion DATE properties carry the UTC instant only [notion F08]; the text columns carry
the zones.

---

## 10. Polling and answers

### 10.1 When to poll (`notion poll-plan`, orchestrator tick step 3)
- Only while `local/state.json.awaiting` is non-empty.
- At every wave boundary, and at every tick while an awaited item is on the critical path or its latest start is
  within 60 minutes, with at least 3 minutes between two polls (`local/notion/poll.json {last_poll_utc}`); otherwise
  at most every 15 minutes [notion rec 8].
- Never while `token_ok` is false (outbox replay first, section 11.3).

### 10.2 The poll (kind `poll`) and the reads (kind `answer-fetch`)
Stage 1, one quota-free view query:
```json
{"op_id":"op-1","tool":"notion-query-data-sources","args":{"data":{"mode":"view","view_url":"<profile.notion.views.to_ingest>","page_size":100}},"key":"poll:to_ingest","purpose":"poll","hash":null,"capture":[{"pointer":"re*:\"?Clé\"?\\s*[:=]\\s*\"?((?:T[0-9]{3,}|D-[0-9]{3,}))","as":"rows:to_ingest"}]}
```
`notion ack` keeps from the hits only keys whose row is own (`Orchestrateur` column, or the plan's executor of the
key) and awaited; `has_more: true` schedules another view query with `start_cursor`. Stage 2 (next `poll-plan`), one
faithful read per hit — never rows mode [notion V-F02]:
```json
{"op_id":"op-1","tool":"notion-fetch","args":{"id":"<page id of T004>"},"key":"answer:T004","purpose":"fetch-answer","hash":null,"capture":[]}
```
The raw result is stored as `local/notion/results/<batch>/<op>.txt`; `batch.followup` names the command per hit:
`exec.py answers ingest --from-notion <file> --task T004 --by devA` for a manual task, `exec.py decision resolve
--id D-004 --from-notion <file> --by devA --source notion` for a decision: exec.py extracts `Décision` (validated as an
option id of the proposal) and `Réponse` (the verbatim quote) from the stored fetch result itself, so neither field
value is ever typed into a shell command (anyone who can see a row can type in it, 10.5; CLI.md 0.7). `--by` is the
row's `Responsable`.

### 10.3 After ingestion (purpose `set-ingested`)
`answers ingest` and `decision resolve --source notion` queue, in `local/notion/queue.jsonl`, an update of the row:
`{"Ingérée":"__YES__"}` (and the new `État`). Verification failure (`answers ingest` exit 1): the row still gets
`Ingérée = __YES__` (the answer was consumed and kept in `answers/`), the task is reposted (`manual post --repost`),
and the repost resets `Ingérée` to `__NO__` together with the body's first line `Réponse refusée … : corrige
« Réponse » puis décoche et recoche « Répondu »`. To avoid re-ingesting the same rejected text, `answers ingest
--from-notion` computes `sha256(Réponse + "\n" + Décision)` and refuses (exit 1, E_ANSWER_UNCHANGED, nothing written)
when it equals the last rejected answer's hash for that task; the orchestrator then simply waits.

### 10.4 Attachments
`Pièces jointes` files come back from `notion-fetch` as signed URLs that expire [notion open-question 9]. Photos are
preferably sent through Remote Control (they land in `~/.claude/uploads/`). When a bring-back of kind screenshot or
file is answered only in Notion, the orchestrator downloads the signed URL with a plain HTTPS GET into
`<workspace.private_dir>/uploads/<answer key>/` within the same tick and passes the path with `--attachment`.

### 10.5 Who answered
The connector acts as the account owner, so Notion cannot tell who edited a row [notion F17]. An answer on a row is
attributed to the row's `Responsable` (`Dev A` → `devA`, `Dev B` → `devB`). Owner-only decision kinds (approval,
spec-validation, cut, policy-exception, fix-selection) are always posted with `Responsable = Dev A`. A second human
can still type in a row they can see; that risk is accepted and stated in references/notion.md, and every answer is
verified mechanically before it unblocks anything.

### 10.6 What Notion is never used for
Comments are not answers (no `notion-get-comments` in the loop). Canvas comments are not answers. Text in any Notion
field that asks for more scope becomes a proposal (`answers ingest --scope-change`), never an action [notion F30].

---

## 11. Outbox, replay, failures

### 11.1 The outbox (`local/notion/outbox.jsonl`, append-only)
One line per failed op: `{"at_utc", "batch_id", "op_id", "kind", "key", "purpose", "error", "retry_after_s",
"attempts", "op"}` (the whole op as emitted). `local/state.json notion.outbox_count` mirrors the count of lines not
yet resolved; a resolution is a later line `{"resolved": "<batch_id>/<op_id>", "by": "<replay batch_id>/<op_id>" |
"superseded"}`.

### 11.2 Error classes (`notion ack --failed --error-file F` or `--error-code CODE`)
| class | recognised by | effect |
|---|---|---|
| rate limit | `rate_limited`, or a `retry_after_seconds` value | outbox; `local/notion/rate.json {not_before_utc}` = now + retry_after (min 2 s, default 30 s) |
| deferred | `deferred:rate_limited` (the orchestrator stopped the batch) | outbox |
| auth | `unauthorized`, `401`, `invalid_grant`, `session token`, `token rejected`, `/login` | outbox; after 2 consecutive auth failures `token_ok: false`, `next` gives the push text `Notion refuse le jeton : tape /login sur l'ordinateur, puis /mcp reconnect. Le build continue.` |
| block cap | `403` with `restricted_resource` | outbox for creates only; `local/notion/degraded.json {creates: false, since_utc}`: from then on the mirror sends updates only and every report stays in `reports/` [notion missed-8] |
| transient | `409`, `500`, `502`, `503`, `504`, `529`, timeout | outbox |
| validation | `400`, `validation`, `invalid` | outbox with `attempts` = 99 (never replayed automatically) and a `dependency-missing` decision naming the op: a property format is wrong, a contract bug |

### 11.3 Replay (`notion diff --replay-outbox`, and automatically at the next `notion diff` when the outbox is not empty)
1. Stage 1 (kind `outbox-replay`) is always a real read: `notion-fetch` of the hub (purpose `token-check`, key
   `token`), because a phone `/mcp reconnect` can report success while the token is still rejected [notion missed-6].
2. Stage 2 replays, in outbox order, with `replay_of` = `<batch_id>/<op_id>`:
   - update-row, relation and hub-now ops are **regenerated** from the current state, not resent: only the latest
     desired value matters; the old line is resolved as `superseded`;
   - create-row ops are preceded by a `view:board` map rebuild (`notion-query-data-sources` view mode on
     `profile.notion.views.board`, all pages, purpose `poll`, key `view:board`) so that a create whose ack was lost is
     found by its `Clé` and never duplicated [notion risk 5];
   - wave-report ops: preceded by a view-mode query of `profile.notion.views.waves`, skipped when a row titled
     `Wnn · X` exists;
   - set-ingested ops are resent as they were;
   - an op with `attempts >= 5` is not replayed again: it stays in the outbox and the report's Pouls gains
     `Notion : <n> opérations en échec, voir local/notion/outbox.jsonl`.
3. The mirror never blocks the build: a failing Notion never stops a wave, a merge or a proof [notion F16].

### 11.4 Rebuilding the page map
`events replay --rebuild-state` cannot rebuild Notion page ids from events; the next `notion diff` notices an empty
`notion.pages` with a non-null `ds:tasks` and emits the `view:board` map rebuild first (all pages of the view, 100 per
call), which fills `pages` from the `Clé` column and treats every row as "hash unknown" (each own row is then rewritten
once).

---

## 12. Rate limits and budget

- Notion: about 180 MCP calls per minute per user across all tools, and 20 `query-data-sources` calls per 10 seconds
  [notion F12, missed-2]. Rate limits come back as tool errors (`rate_limited`, `retry_after_seconds`), not as HTTP
  429 headers.
- The orchestrator keeps at most 3 calls in flight (`budget.max_in_flight`, schema const).
- `notion diff` caps a batch at 60 ops (schema) and a tick at 150 calls; more changed rows are split into stages of
  the next ticks, oldest change first, rows awaiting the owner first.
- Query calls (polls, map rebuilds) ≤ 10 per batch and never two batches with queries within 10 seconds
  (`local/notion/rate.json last_query_utc`).
- `notion diff` and `poll-plan` emit nothing before `rate.json not_before_utc` (empty ops and `followup` = `wait
  until <utc>`).
- Budget of a typical wave: 1 create op (≤ 100 rows) + k updates (changed rows, usually 3-10) + 1 report row + 1 hub
  update + 0-2 async polls ≈ 5-15 calls; one poll = 1 query + 1 fetch per hit. The batch's `budget.calls` and
  `budget.query_calls` state the exact numbers.
- Every Notion result the orchestrator reads costs context: the orchestrator writes results to files and never
  echoes them; `notion ack` prints only `{op, ok, captured, outbox_count, next}`.

---

## 13. Contract questions raised by this file

All settled in revision 2 (README.md 10): Q-N1 `ingest --patch --notion-ids` (CLI.md); Q-N2 the optional
`row_hashes` of an op (notion-ops.schema.json); Q-N3 the `local/notion/*` files are listed in SCHEMAS.md 1.1; Q-N4 the
planner writes owner-facing manual steps in French; Q-N5 the codes are in README.md 6; Q-N6 SCHEMAS.md 5.2 points to
2.1 as the list; Q-N7 TESTS.md U-NOT-01, U-NOT-05 and U-NOT-08 follow this file.

## 14. Tests (B09) and rehearsal checks

Unit (`test_notion.py`, no network): init emits stages 1-4 in order, each only once its inputs are captured; a re-run
after a crash adopts existing databases from the hub fetch; owner-owned property names never appear in any op (scan
every op of every fixture batch); rows created once, updated only on hash change; only own-executor rows and own
decision ranges; a held (diverged) row emits nothing; multi-page create captures map by `Clé` and a count mismatch
schedules a map rebuild; async result → async-poll stage; rate-limited ack → nothing before `not_before_utc`; outbox
replay starts with a real fetch and regenerates updates; poll uses view mode only (no `"mode":"rows"`, no `"sql"`
anywhere); every batch validates against notion-ops; batches are byte-identical for identical inputs and `--now`.
Golden (`test_report.py`): the 9.1 report for a fixture wave, the hub block, French dates, decimal comma, `Rien.`
for empty lists, no push text when nothing is awaited, ≤ 6,000 characters.
Rehearsal (with the owner, real workspace): R-N1 capture patterns against real results of every tool used; R-N2 the
DDL with accents and COMMENTs and the self-relation; R-N3 a `+00:00` UTC datetime and the text column on the phone;
R-N4 a phone answer (Réponse, Décision, Répondu) polled and ingested; R-N5 20 view-mode polls without a quota message;
R-N6 dev B's connection as a member reaching the hub (TWO-DEV.md); R-N7 token rejection then `/login` and replay.
