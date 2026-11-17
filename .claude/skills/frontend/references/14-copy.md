# Copy: every word a judge reads on the page

Read when: you write or review any rendered text (the hero, headings, labels, buttons, state and error messages, sponsor mentions), or you hand the UI copy to /prose at P8.

## Purpose
A judge reads the words before deciding whether to look further, and the jury met the project's name minutes earlier [FD11-F12, FD11-F18]. This file sets how the page says what it is, for whom and with what proof: the hero from its source, the one-sentence proposition, NN/g's two copy tests, Anthropic's rules for UI copy, the copy patterns the checker flags, sponsor phrasing, and the hand-off to /prose. It never permits an invented fact.
Related files: section structure and proof in `06-build.md`, wallet and transaction wording in `07-states-web3.md`, sponsor logos and notices in `15-ip-provenance.md`. `[critic Mn]` cites `research/_critic-round1.md`.

## Rules

### CP-01 - Take the hero from its source, verbatim
- **Rule:** The H1 (`data-hero="h1"`) and the hero sentence (`data-hero="sentence"`) come verbatim from `brief.hero`, which cites the two-sentences source. Never paraphrase them. When the source changes, for example after /prose edits the README opening, re-render the hero from the source instead of editing the page by hand.
- **Why:** The two sentences already exist upstream, /prose requires them identical in the README, the submission form and the video, and the hero is a fourth copy [FD13-F07].
- **Check:** coverage.hero
- **Not when:** never.

### CP-02 - Say what it is and for whom in one sentence
- **Rule:** The hero sentence names a user, an action and an object, in the customers' vocabulary, as a plain declarative of the shape "a tool that does X for Y". No greeting in place of a tagline, and no vague brand-style line borrowed from a famous protocol.
- **Why:** NN/g asks for a tagline that states what the site does unless the name gives it away, meaningful taglines instead of welcomes, and the users' language; the H1 plus subhead should name a user, an action and an object [FD11-F13]. Established brands can skip the sentence, a hackathon project cannot [FD11-F18]. Judges report that teams opening with "this is a tool that does X for Y" scored better (anecdote, grade C) [FD11-F26].
- **Check:** firstview.contract; critic for the three parts.
- **Not when:** never.

### CP-03 - Run the competitor-swap test
- **Rule:** Put the hero and each section heading next to the taglines of the sponsor's competitors, names removed. If a reader cannot tell which line is the project's, rewrite it with the specific mechanism, user or measured figure.
- **Why:** Nielsen's first test: "Would it work just as well for competitors?" [FD11-F13].
- **Check:** critic
- **Not when:** never.

### CP-04 - Run the opposite test
- **Rule:** Rewrite each claim to say the opposite. If no company would ever claim the opposite, the claim says nothing: cut it, or replace it with a sourced fact.
- **Why:** Nielsen's second test: "Would any company ever claim the opposite?"; generic taglines are "content-free word count" [FD11-F13].
- **Check:** tells.score (rule SL-T17); critic.
- **Not when:** never.

### CP-05 - Lead with the outcome; put the technology in the mechanism
- **Rule:** The headline states the outcome for the sponsor's customer. Name the technology (a proof system, AI, the chain, the sponsor's product) in the mechanism section and the integration section.
- **Why:** "Powered by X" describes how, not what; "AI is a technology, not a user benefit" [FD11-F16].
- **Check:** critic
- **Not when:** a track that rewards naming the sponsor's technology: name it in the integration section, still not as the value proposition [FD11-F16].

### CP-06 - Write objective, specific lines
- **Rule:** Every hero and feature line names a mechanism, a user, a figure from the ledger or a sponsor. Prefer a concrete example to an umbrella term and a plain description to selling. No grandiose claim, and no comparative ("faster", "cheaper") without a sourced reference and amount.
- **Why:** Objective text scored 27% higher in measured usability than the promotional control [FD11-F15]. NN/g prefers curated examples to umbrella terms [FD11-F13]. Relative descriptors signal an undefined value proposition [FD11-F16]. Phrase lists found no hit in the owner's past frontends, so specificity is the check [FD10-F19]. DoraHacks advises against grandiose claims [FD11-F25].
- **Check:** tells.score (rule SL-T17); critic.
- **Not when:** quoting a sponsor's own tagline, marked as a quote.

### CP-07 - Use the user's words, not the system's
- **Rule:** Name things by what the user understands, not by how the system is built. Rewrite protocol jargon into the terms of the audience the brief names, and when the brief names one, keep a list of internal terms that never reach rendered text.
- **Why:** "A user manages notifications, not webhook config" [FD15-F16]. Orma rewrote "vault" as "facility" and "oracle" as "calculation agent" for a credit analyst and banned 27 terms from rendered text [FD11-F27].
- **Check:** critic
- **Not when:** terms of art that are the subject's own content (units, identifiers) stay [FD15-F07].

### CP-08 - Make every action say what happens, under one name
- **Rule:** A button names the action and its object ("Lock {amount}", never a generic submit). The action keeps the same verb from the button to the review screen to the result ("Publish" produces "Published"). One primary action per page.
- **Why:** Anthropic's v3 skill: "A CTA says exactly what happens when it is used: 'Save changes,' not 'Submit.'", an action keeps one name through the flow, and its Design type asks for "One primary action per page" [FD15-F16].
- **Check:** critic
- **Not when:** never.

### CP-09 - Write errors and empty states as directions
- **Rule:** An error says what happened and what to do, as text beside its source, with no apology and no blame. An empty screen invites the first action. Codes go in a Details block. Wallet and transaction wording: `07-states-web3.md`.
- **Why:** "Errors don't apologize, and they are never vague about what happened. An empty screen is an invitation to act." [FD15-F16]. NN/g keeps codes for diagnostics and asks for constructive advice without blaming words [FD18-F19].
- **Check:** critic
- **Not when:** never.

### CP-10 - Write plain sentences in sentence case
- **Rule:** Use sentence case for headings, labels and buttons. No filler and no stock phrases. No asides set off by dashes, no "not X, but Y" framing, no colon-then-reveal sentences, no scare quotes around invented labels.
- **Why:** Anthropic's copy rules ask for sentence case and no filler, and its artifact-design skill names these "mannered devices" [FD15-F16].
- **Check:** critic; tells.score
- **Not when:** quoted third-party text.

### CP-11 - Write no em dashes
- **Rule:** Write no em dash in UI copy: use a colon, a comma or two sentences. The checker counts U+2014 in rendered text only, so code comments do not count and quoted text does not need rewriting.
- **Why:** Claude Opus 4.6 wrote 9.09 em dashes per 1,000 words against a human essay mean of 3.23, and 0.19 when told to write plain prose: tell the model, then check the rendered copy [FD10-F17]. Count rendered text, never whole source files [FD10-F18]. Instruction text leaks style, and Anthropic's own guidance exceeds the owner's threshold [FD15-F30].
- **Check:** tells.score (rule SL-T16); `python ~/.claude/skills/prose/scripts/prose_check.py <state>/ui-copy.md` (candidates).
- **Not when:** a proper name or a quoted text that contains one.

### CP-12 - Keep labels plain words
- **Rule:** A label is plain words. No decorative symbol at the end of a button or link, no meta strings joined by dots, no label built from a word, a dash and a fragment, no tiny uppercase monospace labels on text that is not code.
- **Why:** Anthropic's v3 skill lists these as "template chrome that appears whatever the subject" [FD15-F05]; FD10 catalogues them as tell M13 [FD10 Catalogue: tells missing from the 20].
- **Check:** tells.score (rule SL-M13)
- **Not when:** real metadata lines; monospace for hashes, addresses and code [FD15-F05].

### CP-13 - Make headlines say what the protocol does
- **Rule:** Page and section headlines state what the protocol does and for whom. No audience formula and no social-proof formula in a headline.
- **Why:** FD10 catalogues headline formulas of both kinds as tell M17, with the fix "Say what the protocol does and for whom" [FD10 Catalogue: tells missing from the 20]; the same formulas sit in impeccable's phrase list [FD10-F19].
- **Check:** tells.score (rule SL-M17)
- **Not when:** a real, sourced audience statement.

### CP-14 - Never invent a fact
- **Rule:** No number, name, quote, testimonial, date, price, address or URL that the brief, the claims ledger or a data source does not provide. A missing fact becomes a question (mode B) or a manual task (mode A). Until it is answered, its slot shows the visible "not yet verified" state: never a bracketed placeholder, an estimate or a plausible invented value.
- **Why:** Invented precise numbers are banned unless real or labelled mock, and taste-skill's own "organic, messy data" fallback contradicts that [FD01-F12]. Nothing ships as unverified [FD13-F10]. "If a number is not in those responses, it does not exist" [FD13-F20]. Anthropic: never fabricate a missing fact [FD15-F16].
- **Check:** coverage.metrics, coverage.placeholders
- **Not when:** never.

### CP-15 - Render backend and spec strings verbatim
- **Rule:** Strings the backend or the spec fixes as pitch copy render verbatim; the frontend never rephrases them.
- **Why:** XRPL's spec: "The strings are fixed. ... Render them verbatim." [FD13-F20].
- **Check:** critic
- **Not when:** never.

### CP-16 - Write sponsor names and relations as their owners allow
- **Rule:** Describe each sponsor relation as an accurate sentence about what the product uses, with the owner's exact spelling. Use the listed or derived phrases: "Building on BNB Chain", "Powered by BNB Chain", "Available on BNB Chain"; "a Cardano application", "built on the Cardano blockchain" (Cardano as an adjective, never a possessive or a verb, always capitalised); "uses the Chainlink Runtime Environment (CRE) to ..." (a plain sentence, no badge wording); "TOKEN2049 Origins Hackathon" (capitals, no space); "Ledger Wallet", "Ledger signer"; "DeVinci Blockchain (DVB)"; "settles agent payments through Masumi". These phrases attribute; they sit in the integration section or the footer, never in the headline (CP-05). Never claim a partnership, an endorsement, an approval, a certification or an official status.
- **Why:** BNB lists its three phrases and requires management clearance for partnership or official wording [FD21-F20]. Cardano's policy wants its mark as an adjective, never a possessive [FD21-F05]. Chainlink allows "an accurate descriptive term" and has no badge today [FD21-F09, FD21-F10]. TOKEN2049 "must always be capitalised, without space" [FD21-F21]. Ledger renames its app and its hardware "wallet" [FD21-F18]. DVB and Masumi grant nothing beyond descriptive text [FD21-F22, FD21-F26]. The full per-sponsor list is in [FD21 sponsor_allowlist].
- **Check:** ip.sponsor-marks
- **Not when:** quoted third-party text, marked as a quote.

### CP-17 - Show the integration as mechanism, not as a mark
- **Rule:** Each sponsor mention points at what the integration does in the product and at its proof (`06-build.md`, BD-12). A sponsor's name or mark is attribution, never proof.
- **Why:** Ledger's prize text asks for "Concrete use of Ledger primitives, not just wallet branding"; Origins rules make superficial integrations ineligible; the Cardano track asks whether someone new to blockchain understands quickly [FD21-F23].
- **Check:** critic
- **Not when:** never.

### CP-18 - Add the Cardano notice wherever its mark appears
- **Rule:** Wherever the Cardano logo renders, the same page or slide carries the logo notice from the allowlist; where only the word appears, use the short notice "Cardano™ is a trademark of the Cardano Foundation, CHE-184.477.354" wherever possible. Logo rules: `15-ip-provenance.md`.
- **Why:** The policy asks for a ™ notice "wherever possible" and gives the texts [FD21-F05]; the notice gate fails a rendered Cardano logo without one [FD21 How the gates use it].
- **Check:** ip.sponsor-marks
- **Not when:** no Cardano mark on the page.

### CP-19 - Hand the rendered copy to /prose through ui-copy.md
- **Rule:** Before hand-over, export the rendered text of every route (headings, sentences, labels, buttons, state and error messages) to `ui-copy.md` in the state directory (CONTRACTS 6.3), grouped by route and element. /prose reads it after /harden. Run its checker on the file now, and treat what it prints as candidates.
- **Why:** /prose checks Markdown only, never mentions UI copy, and its per-1,000-word densities were measured on long documents, unproven on a 200-word page [FD13-F23].
- **Check:** `test -s <state>/ui-copy.md`, then `python ~/.claude/skills/prose/scripts/prose_check.py <state>/ui-copy.md`
- **Not when:** never.

## Procedure
1. Gather the sources: `brief.hero` and `brief.sentences`, the claims-ledger ids, the audience and its vocabulary, the sponsor allowlist entries for the profile's sponsors.
2. Write the hero from the source (CP-01, CP-02) and the section headings as feature plus result (`06-build.md`, BD-06).
3. Write every action, state, error and empty message (CP-08, CP-09; `07-states-web3.md` for wallet flows).
4. Run the swap and opposite tests on the hero and the headings (CP-03, CP-04), then the specificity pass (CP-05 to CP-07).
5. Write sponsor mentions from the allowlist phrases (CP-16 to CP-18).
6. Run the gates: `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates coverage,firstview,tells,ip --serve <ui>/dist --profile <abs profile>`
7. Export `ui-copy.md` and run the /prose checker on it (CP-19). After /prose edits the two sentences, re-render the hero from the source (CP-01).

## Gaps
- No calibrated standard for short rendered UI text exists: /prose's PR-01 density was set on long documents, impeccable's em-dash threshold sits about five times higher, taste-skill bans every em dash, and none is proven on a 200-word page [critic M4] [FD10-F18].
- The swap test and the user-action-object test need a model or a person; only a word list of claims nobody would negate is deterministic [FD11-F13].
- Phrase lists found no hit in the owner's past frontends, so the owner's real copy failure may be vagueness about the protocol; that is FD10's hypothesis, not a measurement [FD10-F19].
- /prose has no UI-text input mode; the hand-off rests on `ui-copy.md` [FD13-F23].
- Most sponsor phrases are derived from a rule, not listed by the sponsor; only BNB publishes a phrase list, and every kit must be re-read before each event [FD21 Weak spots].
- Ledger OP3N's own brand and copy rules were not found [FD21 What could not be found].
