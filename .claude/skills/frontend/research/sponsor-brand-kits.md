# Sponsor brand kits and usage rules for the October events

> Code FD21 · slug sponsor-brand-kits · researched 2026-10-01 · verified 2026-10-01 · counts: verified 12 / corrected 13 / downgraded 0 / dropped 0 / added 1

## Summary

This is not legal advice. It records what each sponsor, the organiser and the owner's association publish about their marks, as read on 2026-10-01, and turns it into a `sponsor_allowlist` for the `frontend` block of `profile.json`.

- **Text by default, logos only where a published rule allows them.** Only Cardano publishes an explicit grant: "automatic permission" for the official logo "in a standalone and unaltered form" when nothing implies endorsement (F03). Solana's brand page offers the official files for download and asks readers to follow its guidelines when promoting Solana on "websites"; those guidelines forbid combinations and alterations but set no approval step for an unaltered file (F12, F13). That is tacit permission, not a grant, and the guidelines' ban on use that "Is descriptive of any products or services" could be read against a "built on Solana" logo (Contradictions 9). (corrected at verification: the draft said "two parties publish terms under which a hackathon page can show their logo without asking"; only Cardano's text grants anything). Chainlink requires "prior written consent" for its logo (F09). BNB Chain asks projects to "seek approval" and send the proposed use (F20). Ledger's website terms say "you agree not to reproduce" its logos (F16). TOKEN2049 needs "prior approval" for its wordmark (F21). IOG and DVB reserve their logos and grant no general permission (F07, F22). Masumi, which the Cardano track names, publishes a press kit but no statement of permission (F26, added at verification).
- **No self-serve badge exists any more.** Chainlink's "Powered by" and "Secured by" badges (2022) were free downloads. They gave way to an approval-only "Secured With Chainlink" programme, whose enrolment page was still captured live by the Wayback Machine on 2026-07-22. chain.link/badge returned 404 on 2026-10-01 (F10). (corrected at verification: the draft dated the approval-only programme to 2024 only). No "Built on Cardano", Solana or "Works with Ledger" badge was found (F10).
- **Wording.** BNB lists "Powered by", "Available on" and "Building on". Cardano wants its mark used as an adjective ("a Cardano application"), never as a possessive ("Cardano’s"). Its short notice reads "Cardano™ is a trademark of the Cardano Foundation, CHE-184.477.354" (F05). Chainlink's Trademark Guidelines allow descriptive use "only when necessary", and its Terms §3 add that one may use "an accurate descriptive term" (F09). TOKEN2049 "must always be capitalised, without space" (F21). Ledger is renaming "Ledger Live" to "Ledger Wallet" and the hardware "wallet" to "signer" (F18).
- **Names.** Cardano's §2.2.8 bars "Cardano", "ADA" or "an obvious variation" from product, company or domain names (F04). The same policy grants automatic permission for names "exclusively intended to support the Cardano Code and Project". The Foundation's forum guidance lists creative names such as "Cardanitos.com" and "Cardanoist" under "Dos" (F04, corrected at verification). A naming hit is therefore a question for the owner, not an automatic fail. Solana forbids combining its marks with "your name" or logo without "explicit, written permission" (F13).
- **Geometry.** Cardano: minimum 64 px on the web (60 on tablet, 56 on phone, 20 mm in print), clear space "six dots" of the starburst, and the Cardano logo "equal or larger" when shown beside a partner logo (F02). BNB: minimum widths of 70 px (vertical lockup), 97 px (horizontal lockup) and 15 px (logomark); clear space X equal to the logomark height; horizontal lockup "should never be aligned right" (F20). Cardano Foundation logotype: minimum 40 px (F06). Chainlink specifies only "a reasonable amount of margin" (F08). Solana gives a diagram without numbers (F12). Masumi: 14 px wordmark, 30 px lock-up height (F26). Ledger (in the pages read) and TOKEN2049 publish no geometry (F17, F21).
- **Motion and focus.** Chainlink forbids "animating or morphing any Marks" and using them as "the visual focal point" (F09). Cardano and Solana forbid rotating, stretching and recolouring their marks (F02, F13).
- **Gradients (tell 1).** All 36 official logo SVGs checked for Cardano, Chainlink, BNB Chain and Ledger are flat single colours. At verification, the four SVGs in the Cardano Foundation kit and two sampled TOKEN2049 SVGs were also found flat (F24). Only Solana's colour logos carry a gradient: six stops from #9945FF through #5497D5 (a blue) to #19FB9B, at about 41° from vertical (F14, F24). The other brand gradients belong to organisations, not to logos. The Cardano Foundation has nine two-stop gradients, including #0084FF→#BFA8FF, and blurred "Layer Blur 150" shapes (F06). Ledger has purple and "liquid" backgrounds (F17). Masumi builds "dynamic gradients" and "ink" visuals (F26). Solana claims its gradient, colours and "look and feel" as marks (F13). Therefore the checker should exempt a sponsor gradient only inside an allowlisted official file, matched by SHA-256, and never as page decoration.
- **Fonts found in sponsor kits are commercial fonts with non-transferable licences; downloading them gives the team no licence.** Solana's kit contains ABC Diatype (Dinamo EULA 2.51: licence for the "License Owner", non-transferable, no sharing with third parties). Ledger's kit contains Brut Grotesque with the Bureau Brut licence, which is "personal and non-transferable to third parties" (F15). (corrected at verification: the draft said these fonts are "licensed to the sponsor"; no source shows who holds the licences).
- **Judges discount branding.** Ledger's ETHGlobal prize text asks for "Concrete use of Ledger primitives, not just wallet branding". Ledger's own XRPL hackathon page repeats "not just wallet branding". The Origins rules say "Superficial integrations added solely to qualify for a track or prize will not be considered eligible." The Cardano track gives 20% to UX and asks "Could someone new to blockchain understand it quickly?" (F23).
- **Deliverable.** A JSON allowlist with one entry per party (ten after verification, Masumi added): phrases (with regexes), official file URLs with SHA-256, colours and gradients, geometry, default logo policy, approval state and contacts. It is followed by the gate logic that consumes it.

## Findings

### FD21-F01 — The Cardano word marks and logos belong to the Cardano Foundation (Zug), whose Trademark Policy, "Updated 06.03.24", governs their use; the open-source licences of Cardano code and of cardano.org grant no trademark right
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The policy says the Marks are owned by the Cardano Foundation (UID CHE-184.477.354, Zug). Its Appendix 1 lists the word marks ADA, ADACOIN, ADAPAY, CARDANO and CARDANO FOUNDATION, plus logo images and two katakana marks. The policy states that the protocol's open-source copyright licence gives no right to the Marks. The repository behind cardano.org, where the logo files live, is licensed Apache-2.0, whose section 6 excludes trademarks. The policy names three "Cardano Partners": the Cardano Foundation, IOHK and EMURGO.
- **Implication for /frontend:** Treat the Cardano logo files as trademarks, whatever licence the repository that serves them carries. Add CARDANO, ADA, ADACOIN, ADAPAY and CARDANO FOUNDATION to the naming checker's blocklist (see F04).
- **Evidence:**
  - [Trademark Policy](https://cardanofoundation.org/en/trademark-policy) — Cardano Foundation, "Updated 06.03.24", accessed 2026-10-01 — owner's policy, raw HTML via curl (the older path /policy/trademark-policy answered HTTP 429 to curl).
    - "The Marks that are covered in this Policy, from time to time, are owned by the Cardano Foundation, UID CHE-184.477.354, with registered address located at: Dammstrasse 16, 6300 Zug, Switzerland."
    - "While our protocol is available under a free and open source software copyright licence, the copyright licence does not include an express or implied right or licence to use our Marks."
    - "ADA, ADACOIN, ADAPAY, CARDANO, CARDANO FOUNDATION"
    - "Updated 06.03.24"
  - [cardano-org LICENSE](https://github.com/cardano-foundation/cardano-org/blob/staging/LICENSE) — Cardano Foundation repository (default branch `staging`), Apache License 2.0, accessed 2026-10-01 via `gh api` — licence file.
    - "6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file." (line breaks and indentation removed)
- **Limits / false positives:** "06.03.24" is read as 6 March 2024 (Swiss day-month order); the page does not spell it out. The logos and katakana marks in Appendix 1 are images, identified only by their alt texts (`Cardano-RGB_Logo-Full-White`, `CF-Logo-Full-White-RGB` and others). Registration status per country is outside this finding; F25 gives one US record.
- **Verification note:** At verification curl also received HTTP 429 (a Vercel security checkpoint) on the /en/ path. The page was read with headless Chromium, which lands on /policy/trademark-policy. All quotes matched verbatim, as did the Partners list ("Input Output Hong Kong (or IOHK*)", EMURGO) and the Appendix 1 katakana text (カルダノ, エイダ).

### FD21-F02 — cardano.org/brand-assets is the protocol kit: nine flat SVGs (starburst, stacked and horizontal lockups, each in white, black and blue #0033AD), a 2020 ZIP of SVG and PNG files, Chivo, minimum sizes of 64/60/56 px and 20 mm, a clear space of "six dots", and a co-branding rule
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The page gives the following.
  - Colours: Blue #0033AD (Pantone 286), Black #000000, White #FFFFFF, Paper #f8f8f5; secondary Red #ff5553 (Pantone 178) and Green #3b7982 (Pantone 569).
  - Type: Chivo "by Omnibus-Type — Google Fonts", with the fallback "Arial, sans-serif".
  - Minimum sizes: Web 64 px, Tablet 60 px, Phone 56 px, Print 20 mm.
  - Clear space, three do's, three don'ts and a co-branding rule (quoted below).
  - Files: nine SVGs under `/img/brand-assets/`, and a ZIP at `/downloads/cardano-brand-assets.zip` of 166,296 bytes. The ZIP holds 9 SVG and 9 PNG files dated 2020-06-29 in its entries, plus macOS debris (`.DS_Store`, `__MACOSX`). In the ZIP, "Full" names the horizontal lockup.
  - Measured: the blue SVGs use only `fill="#0033ad"`, the white ones only `#fff`, and none contains a gradient.
  - History: the usage section was first committed on 2026-03-19 (50028a82eb, "feat: expand brand-assets page with colors, typography, usage guidelines and SEO") and reverted six minutes later (b951fb6565). The re-application (d17eeca2aa) keeps the 2026-03-19 author date but was committed on 2026-04-08. The strings were last synced on 2026-09-02. (corrected: the draft said the change "was reverted and re-applied the same day"; the re-applying commit's committer date is 2026-04-08)
- **Implication for /frontend:** If the Cardano logo is shown, use one of these nine files unaltered: the white version on dark grounds, the blue one on light grounds. Keep it at least 64 px on the web, with the six-dot clear space and no effects. Never place it smaller than the project's own mark beside it. A spinning starburst used as a loading indicator breaks "Do not stretch, rotate, or distort the logo". Strip the macOS debris when unpacking the ZIP.
- **Evidence:**
  - [Cardano Logo Download: Brand Assets, Colors and Guidelines](https://cardano.org/brand-assets/) — cardano.org (Cardano Foundation), accessed 2026-10-01 — official kit page, raw HTML.
    - "The horizontal logo (shown here) is the primary version and should be used as the default version."
    - "Always maintain a clear space around the logo equal to the width of six dots from the starburst icon."
    - "Do not stretch, rotate, or distort the logo" · "Do not recolor the logo outside brand colors" · "Do not use the wordmark without the icon"
    - "When the Cardano logo appears alongside a partner logo, the Cardano logo should be displayed at an equal or larger size to maintain brand prominence."
  - [UsageGuidelines.js](https://github.com/cardano-foundation/cardano-org/blob/staging/src/components/BrandAssetsSection/UsageGuidelines.js) — cardano-foundation/cardano-org, accessed 2026-10-01 — page source.
    - `{ context: "Web", size: "64 px" },` · `{ context: "Tablet", size: "60 px" },` · `{ context: "Phone", size: "56 px" },` · `{ context: "Print", size: "20 mm" },`
  - Commit history of `src/pages/brand-assets.js` (`gh api repos/cardano-foundation/cardano-org/commits?path=...`), accessed 2026-10-01: d31107bcfc (2026-09-02, "i18n: sync English source strings with current page copy"), d17eeca2aa (authored 2026-03-19, committed 2026-04-08, the re-applied expansion), b951fb6565 (the revert, 2026-03-19), 50028a82eb (the first expansion, 2026-03-19). The logo files and the ZIP were added in commit f457b6d455 "Add brand assets page" on 2024-02-26.
  - Measured on 2026-10-01: the nine SVGs were downloaded and hashed (SHA-256 in the Deliverable). The ZIP's central directory was listed with Python `zipfile`.
- **Limits / false positives:** The phrase "six dots" is ambiguous because the starburst dots come in several sizes. The page does not say whether the minimum sizes are widths or heights. It also does not define "partner logo", so whether a hackathon project's own mark counts is an inference (see Contradictions 3).

### FD21-F03 — Cardano's permission model: written permission is required "as part of your project or associated assets", except for four automatic cases (fostering the code, names exclusively supporting the code, the standalone unaltered official logo, descriptive use) that must not imply endorsement; four kinds of use always need approval, and silence for three months means refusal
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Section 3 opens with a general requirement of written permission.
  - Section 3.1 lists four cases where "Explicit permission to use the Mark is not required": use that exclusively fosters the Cardano Code; use of the Marks "in a domain name, title of website, seminar, software package, book, magazine or video that is exclusively intended to support the Cardano Code and Project"; the standalone unaltered official logo; and descriptive use. Each case carries the proviso that nothing implies "an official sponsorship or endorsement by the Cardano Partners". (corrected: the draft listed three cases and omitted the domain-name, title and software-package case)
  - Section 3.3 always requires approval when a use suggests an "official link", sits in a domain or company name, appears on branded goods, or appears in advertising. Its listed examples include "Google Adwords/Adsense" and "Facebook promoted posts".
  - Requests go through a form linked from the policy (an Asana form) or by email (§3.5, with `mailto:legal@cardanofoundation.org` linked in the page). An unanswered request counts as refused after three months.
- **Implication for /frontend:** A project page may say it is a Cardano application and may show the official logo unaltered, set apart from the project's own mark, without asking permission. The older forum guidance asks for a courtesy email showing the use; see Limits. (corrected: the draft said "without writing to anyone"). Anything that looks like a relationship needs written approval, which cannot arrive before 6 October: a lockup with the project mark, "partner" wording, or a sponsor-style logo wall. Record the logo's status in the profile as `automatic_permission` with the conditions attached, not as "approved".
- **Evidence:**
  - [Trademark Policy](https://cardanofoundation.org/en/trademark-policy) — Cardano Foundation, Updated 06.03.24, accessed 2026-10-01.
    - "Written permission from Cardano Foundation is required to use the Marks as part of your project or associated assets."
    - "In some special cases, we will grant automatic permission for a project to use the Marks. Explicit permission to use the Mark is not required when a project meets the following criteria:"
    - "The Marks are used in a domain name, title of website, seminar, software package, book, magazine or video that is exclusively intended to support the Cardano Code and Project, provided it does not imply an official sponsorship or endorsement by the Cardano Partners and only where this Policy is strictly observed." (added at verification)
    - "You want to display the official Cardano logo (whether for commercial or non-commercial use) in a standalone and unaltered form, provided it does not imply an official sponsorship or endorsement by the Cardano Partners and only where this Policy is strictly observed."
    - "You want to use the Marks in a descriptive manner to describe your product or services provided it does not imply an official sponsorship or endorsement by the Cardano Partners and only where this Policy is strictly observed."
    - "Permitted use: referring to your services as specialising in Cardano development"
    - "The use of the Marks suggests an “official link” between your product or service and the Cardano Foundation;"
    - "If you would like to apply for permission to use the Marks based on the guidelines above, please email us directly including your full details and the details of your requested use." (added at verification)
    - "If we do not respond within three (3) months, this will be deemed as a rejected application."
- **Limits / false positives:** The example under the logo criterion ("Putting the Cardano Logo on your product packaging after you have and obtained our prior permission to do so") contradicts "automatic" (Contradictions 2). The criteria read as alternatives, but the text does not say so. The Foundation's 2021 forum guidance (F05) asks users of the standalone logo to "Send us an email to legal@cardanofoundation.org to show your use of our Marks with examples", and policy §3.4 ("Use Specimens") lets the Foundation request evidence of use. Neither is a permission step.

### FD21-F04 — Cardano's prohibitions constrain /frontend's naming, lockups and styling: no alteration, no combining with the project's mark, no implied affiliation, and no "Cardano", "ADA" or look-alike variation in a product, company or domain name (with a §3.1 carve-out for names that exclusively support the Cardano Code, and forum "Dos" that accept creative names)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Rules 2.2.3, 2.2.5, 2.2.7, 2.2.8 and 2.2.10 prohibit altering the marks, combining them with a third party's marks without prior written permission, implying more affiliation than exists, using them in names, and using obvious variations, phonetic equivalents or abbreviations. Section 2.2 applies these rules "(irrespective of whether you received automatic or explicit permission for use)", but opens with "With the exception of the “nominative fair use” of the Marks". (corrected: the draft's quote left out the nominative-fair-use exception). The policy is not uniform on names. §3.1 grants automatic permission for the Marks in names "exclusively intended to support the Cardano Code and Project" (example: "howtoinstallcardano.com"). §3.3 still requires approval for any domain name, and §2.2.8 forbids the Marks in product names. The Foundation's forum guidance (2021, edited 2022) lists "Cardanitos.com", "Adaforpresident.com", "IloveCardada.com", "Swissie Cardano", "Cardanoist" and "cardaniers.com" under "Dos" for website and stake-pool names. Under "Don'ts" it lists names that sound official, such as "Cardano.com", "Adastakepool", "cardano-staking.com" and place-based names. (corrected: added the §3.1 name case and the forum's "Dos", which cut against an absolute ban)
- **Implication for /frontend:** The logo step must not produce a combined "Project × Cardano" lockup, and must not borrow the starburst geometry into the project's mark (2.2.3, 2.2.10). The naming step (FD12) should flag names containing CARDANO, ADA, ADACOIN or ADAPAY, and phonetic or abbreviated variants of them, for the owner's decision. A hackathon product is not "exclusively intended to support the Cardano Code", so §2.2.8 applies and the conservative choice stands: keep the mark out of the product name shown to judges. The Origins primary must be renamed anyway. Repository slugs are a grey zone.
- **Evidence:**
  - [Trademark Policy](https://cardanofoundation.org/en/trademark-policy) — Cardano Foundation, Updated 06.03.24, accessed 2026-10-01.
    - "With the exception of the “nominative fair use” of the Marks, your use of our Marks is subject to the following rules (irrespective of whether you received automatic or explicit permission for use):" (added at verification)
    - "2.2.3 You may not alter the Word Marks or Logos, such as changing the proportions of the design elements or the design itself, rearrange the spacing, alignment, or relative locations of the design elements (you may resize as appropriate but must retain all proportions);"
    - "2.2.5 You may not incorporate and or combine the Word Marks or Logos into a third party company’s marks, names, and or logos without prior written permission by Cardano Foundation;"
    - "2.2.7 You may not use the Marks in ways that imply a greater level of sponsorship by or affiliation with Cardano Foundation and or any of the other Cardano Partner than actually exists;"
    - "2.2.8 You may not use or register, in whole or in part, the Marks as part of your own trademark, service mark, domain name, company name, trade name, product name or service name in any part of the world;"
    - "2.2.10 Trademark law does not allow your use of names or trademarks that are too similar to ours. You therefore may not use, or otherwise register, an obvious variation of any of our Marks or any phonetic equivalent, foreign language equivalent, takeoff, or abbreviation for a similar or compatible product or service in any part of the world."
    - "Permitted use: A non-commercial website called: howtoinstallcardano.com" · "The use of the Marks is in a domain name;" (§3.3) (added at verification)
  - [Trademark examples: quick guidance on how you can use the Cardano brand](https://forum.cardano.org/t/trademark-examples-quick-guidance-on-how-you-can-use-the-cardano-brand/66787) — Cardano Foundation account on the Cardano Forum, posted 2021-07-13, edited 2022-03-03, accessed 2026-10-01 through the Discourse JSON endpoint — owner's guidance.
    - "Mix your own brand/logo with a Cardano trademark."
    - That line appears under "Don’ts".
    - "When choosing a name for your website domain or stake pool etc. we ask you to be creative and have fun distinguishing yourself." followed by "Cardanitos.com", "Adaforpresident.com", "IloveCardada.com", "Swissie Cardano (with regards to Switzerland)", "Cardanoist (with regards to Istanbul)", "cardaniers.com" (added at verification)
    - "Names that sound official, that are neither creative nor distinct need to be avoided." (added at verification)
- **Limits / false positives:** How far "an obvious variation" extends (for example a name such as "Cardex") is a legal judgement; the checker can only flag substrings and near-misses for the owner to decide. The forum "Dos" address website and stake-pool names, predate the 2024 policy, and conflict with §2.2.8 (Contradictions 14).

### FD21-F05 — Cardano copy rules: a ™ notice "wherever possible", the mark as an adjective, never a possessive, never a verb, always capitalised; the 2021 forum guidance asks instead for ® on the logo
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Rule 2.2.2 asks that the Marks be accompanied "wherever possible" by ™ and a notice. It gives three notice texts: two for the word mark (a short one and one with the Zug address) and one for materials that show the Logo. (corrected: the draft said "two notice texts")
  - The policy forbids anyone other than the owner to turn ™ into ®.
  - Section 4 requires initial capitals, adjective use ("a Cardano application"), no possessive, no verb and no translation.
  - The older forum guidance (2021, edited 2022) asks users to add ® at the top right of the logo and to email `legal@cardanofoundation.org` with examples of use.
- **Implication for /frontend:** Wherever the Cardano logo appears, put one line in the footer or on the credits slide: "Cardano™ and the Cardano Logo™ are trademarks of Cardano Foundation, CHE-184.477.354, Dammstrasse 16, 6300 Zug, Switzerland, in Switzerland and other countries". Use the shorter notice when only the word appears. Do not add ® to the logo file: that alters the mark (2.2.3), and the newer policy forbids the switch. Copy lint on rendered prose should flag "Cardano's" or "Cardano’s", a lowercase "cardano", and "Official" or "Certified" before "Cardano".
- **Evidence:**
  - [Trademark Policy](https://cardanofoundation.org/en/trademark-policy) — Cardano Foundation, Updated 06.03.24, accessed 2026-10-01.
    - "2.2.2 Wherever possible, the Marks should be accompanied by the trademark symbol ™ and the following text (or an appropriate translation), for example:"
    - "“Cardano™ is a trademark of the Cardano Foundation, CHE-184.477.354”"
    - "“Cardano™ is a trademark of Cardano Foundation, CHE-184.477.354, Dammstrasse 16, 6300 Zug, Switzerland, in Switzerland and other countries”" (added at verification)
    - "For materials in which only the Logo is displayed or both the Logo and the Word Mark (Cardano) are displayed:" (added at verification; the logo notice follows)
    - "In particular, a ™ should not be changed to an ® in a trademark notice by anyone other than the owner."
    - "Always use a trademark as an adjective modifying a noun. Unacceptable: This is a Cardano. Anyone can install it. Acceptable: This is a Cardano application. Anyone can install it."
    - "Don’t use a trademark as a possessive."
    - "Not permitted: referring to yourself as “The Official Cardano Consultant” or “Certified Cardano Consultant""
  - [Trademark examples: quick guidance](https://forum.cardano.org/t/trademark-examples-quick-guidance-on-how-you-can-use-the-cardano-brand/66787) — Cardano Foundation, 2021-07-13 (edited 2022-03-03), accessed 2026-10-01.
    - "Kindly ensure to add the registered trademark symbol (®) at the top right corner of the logo."
    - "Send us an email to legal@cardanofoundation.org to show your use of our Marks with examples (pictures of how you use the Marks and for which products)."
- **Limits / false positives:** The owner does not follow its own rule. The developer portal's blog writes "Cardano’s native token", and the Origins track page, written by the organiser, says "Cardano's unique features" (F23). The lint fires on the team's copy, not on quoted third-party text. "Built on Cardano" is common in Cardano Foundation copy. A GitHub code search of the `cardano-foundation` organisation finds it in developer-portal blog posts and in cardano.org's own navigation copy ("Explore curated applications built on Cardano."). cardano.org's app directory also lists a third-party directory titled "Built on Cardano" (builtoncardano.com), and Masumi's press page says "Built on Cardano" (F26). (corrected: the draft said the search returns it "in blog posts" only). Section 4 still prefers the adjective form, so the allowlist offers "built on the Cardano blockchain".

### FD21-F06 — The Cardano Foundation's own organisational brand is not the protocol brand: its 2024 guidelines set a 40 px minimum, a misuse list, greys plus #0084FF, nine two-stop gradients (among them blue-to-lavender #0084FF→#BFA8FF) and blurred gradient shapes ("Layer Blur 150")
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Kit page: cardanofoundation.org/brand lists greys #272727, #404040, #808080, #c6c6c6, #d9d9d9 and #f2f2f2, and nine gradients: Blue #00E0FF/#0084FF/#BFA8FF, Green #2BFFB3/#00BE7A/#E1FF2B and Red #E58C9C/#FF4768/#FFF647, each family combined in three pairs. The type is Switzer, from Fontshare.
  - ZIP: 16,282,706 bytes, `Content-Disposition: drive-download-20250206T094817Z-001.zip`, `Last-Modified` 6 Feb 2025. It contains the Cardano icon (SVG and PNG, black and white), the CF logotype, three brand images and "Cardano Foundation Brand Guidelines.pdf".
  - PDF: 22 pages, created 2024-06-18. It gives a safe space drawn as clusters of starburst dots, "min. 40px" (drawn as a height), a misuse list, Red1000 #D64A2E, Blue1000 #0084FF, and "Gradient shapes" (blurred ovals, "Layer Blur 150").
- **Implication for /frontend:** A Cardano-track project refers to the protocol (F02), not to the Foundation, so the CF logo stays out and so do CF's gradients. A page that adopts #0084FF→#BFA8FF washes or blurred blobs looks like Cardano Foundation material; that is both an implied link (F04) and the owner's tell 1. The checker must therefore not exempt these gradients as page decoration. They only appear inside CF-authored media.
- **Evidence:**
  - [Cardano Foundation Brand Kit](https://cardanofoundation.org/en/brand) — Cardano Foundation, accessed 2026-10-01 — kit page. It shows "Download Brand Kit", ".ZIP 15.9 MB", the hex lists and "Switzer", with a link to Fontshare.
  - [Brand kit ZIP](https://ucarecdn.com/0d0df764-0cae-4736-baed-5a13f16609bc/) — HTTP headers and central directory read on 2026-10-01; SHA-256 2e8d5d96…fc38f65.
  - "Cardano Foundation Brand Guidelines.pdf" (inside the ZIP) — Cardano Foundation, "Brand Guidelines 2024", PDF CreationDate 2024-06-18, text extracted with pypdf 6.18.1, pages 6, 8, 9, 12 and 17 rendered with pypdfium2 and inspected.
    - "The safe space is an area where no elements should be placed so as to preserve the visual impact from external factors."
    - "min. 40px"
    - "Do not change the shape, proportions, or spacing between the elements in both logomark and logotype."
    - "Avoid changing the colour of the logo" · "Avoid shadow effects" · "Avoid placing logo on busy images"
    - "Blue 2+3" with "#0084FF" and "#BFA8FF"; "Blue Gradient 1+2" with "Layer Blur 150" (page 17)
- **Limits / false positives:** The safe space is only drawn. The ZIP was deleted after reading to respect the scratch quota, so its SVGs were not checked for gradients. The PDF's creation date may not be its publication date.
- **Verification note:** At verification the ZIP was downloaded again (SHA-256 identical) and its four SVGs were checked. `CF-Logo-Full-Black.svg`, `CF-Logo-Full-White.svg` and the two Cardano icons are flat, and the two icons are byte-identical to cardano.org's `cardano-starburst-black.svg` and `cardano-starburst-white.svg`. The PDF quotes were re-matched on pages 6, 8, 9, 11, 12 and 17, and page 8 was re-rendered: "min. 40px" sits beside a vertical measure. The greys' names (Grey1000 to Grey50), Red50 #FEF3F1 and "Helvetica Neue" as the Google Workspace substitute (page 15) used in the Deliverable were confirmed.

### FD21-F07 — Input Output (IOG, formerly IOHK) publishes no brand or press kit; its terms reserve "IOG’s name, logos or trademarks" and forbid their use without "express written permission"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** `https://www.iog.io/press`, `/brand`, `/media-kit` and `/press-kit` return 404, and the old paths on iohk.io redirect there. The newsroom page links to press releases but to no kit. The terms were "Last Updated: January 30, 2025".
- **Implication for /frontend:** Name Input Output in text only when the mechanism needs it (for example, a library it maintains). Never show its logo.
- **Evidence:**
  - [Terms and conditions](https://www.iog.io/terms-and-conditions) — Input Output, Last Updated January 30, 2025, accessed 2026-10-01.
    - "All intellectual property in or related to the Products (including, but not limited to, our software and IOG’s name, logos or trademarks) ("Our Content and Materials") is the exclusive property of IOG or its licensors."
    - "Except as expressly provided in these Terms, you agree not to use, modify, reproduce, distribute, sell, license, reverse engineer, decompile or otherwise exploit Our Content and Materials without our express written permission."
  - HTTP probes on 2026-10-01: `curl -L` on www.iog.io/press, /brand, /media-kit, /press-kit and iohk.io/en/press(-kit) all end at 404 pages; www.iog.io/newsroom answers 200, with no kit link.
- **Limits / false positives:** Absence is not proof: IOG may share a kit on request. The terms govern IOG's websites and products, not a trademark policy as such.
- **Verification note:** Re-probed on 2026-10-01 with the same results. www.iog.io/newsroom answers 200 after a redirect to /news, which contains no "press kit", "media kit" or "brand" link.

### FD21-F08 — Chainlink's kit (chain.link/brand-assets): logo and symbol in blue, white and black (SVG and PNG, ZIP of 55,752 bytes), four colours led by Chainlink Blue #0847F7, TASA Orbiter (OFL-1.1) with Inter as a substitute, and a margin rule without a number
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Colours: Chainlink Blue #0847F7, Dark #0E1119, Light Blue #DCEBFF, Light Gray #F5F7FA.
  - Files: six SVG and six PNG files, each also on the Webflow CDN. The ZIP's entries are dated 2024-05-29, and the ZIP itself was last modified on 2026-09-02.
  - Measured: the blue SVGs contain only #0847F7, and none of the six contains a gradient. The CDN copies hash identically to the ZIP copies.
  - Fonts: TASA Orbiter comes from `localremotetw/TASA-Typeface-Collection`, licensed OFL-1.1 according to the GitHub API.
  - Links: the page links logo use to the Trademark Guidelines (F09).
  - Earlier kits: the 2023 kit used Chainlink Blue #375bd2 with Circular and Montserrat (Wayback, 2023-06-04), so older screenshots and memory are out of date.
- **Implication for /frontend:** If a Chainlink logo is ever approved, use these files unaltered and keep more than a token margin around them. The kit gives no number; one symbol-height is my working default, not a Chainlink rule. Inter is Chainlink's recommended substitute font, which is one reason the Inter tell cannot be tier 1 on a Chainlink-track page (ARCHITECTURE §3, FD11).
- **Evidence:**
  - [Brand Assets | Chainlink](https://chain.link/brand-assets) — Chainlink, accessed 2026-10-01 — official kit page, raw HTML.
    - "The Chainlink logo displayed in the official colors and usage patterns. Do not place the logo on top of other objects and leave a reasonable amount of margin around the outside so the logo is clearly visible."
    - "TASA Orbiter is our primary font. TASA Orbiter is a free open-source font for commercial use available on Github."
    - "Inter is a free open-source font for commercial use available on Google Fonts. We suggest using Inter as a replacement for Tasa Orbiter."
    - "If you’d like to use Chainlink logos, please be sure to read and follow our Trademark Guidelines, which provides specific guidance for how you may use and display Chainlink trademarks."
  - [Chainlink-Logo.zip](https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6a9849f95bf2c3b1c26d7353_Chainlink-Logo.zip) — `Content-Length: 55752`, `Last-Modified: Wed, 02 Sep 2026 16:08:27 GMT`; entries listed and SVGs hashed on 2026-10-01.
  - [Brand Assets (Wayback 2023-06-04)](https://web.archive.org/web/20230604083444/https://chain.link/brand-assets) — archived official page — "Chainlink Blue" "#375bd2".
- **Limits / false positives:** The page's `<meta name="description">` still says "logo, colors, badges, and fonts", but the body has no badge section (F10).

### FD21-F09 — Chainlink's Trademark Guidelines (Terms of Service v6.0, effective 18 August 2026) require prior written consent for the logo, forbid "animating or morphing any Marks" and making them "the visual focal point", and allow descriptive use "only when necessary"; Terms §3 separately allows "an accurate descriptive term"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The Guidelines sit at the end of the Chainlink Foundation Terms of Service. chain.link/terms loads them from a PactSafe document at run time. They require the Foundation's prior written permission for several uses, including use of the Chainlink logo "except as expressly permitted under these Guidelines". Section 3 of the same Terms ("PROPRIETARY RIGHTS") says one "may generally use the Foundation’s name and logo to refer to the Foundation’s mission and activities" without implying partnership (Contradictions 6). The next sentences allow indicating the relationship of one's products to the Foundation's mission "by using an accurate descriptive term", and forbid using the name and logo "as a trademark for your products or services". (corrected: the draft omitted the §3 descriptive-term sentence, which bears on the copy rules)
- **Implication for /frontend:** This matters for the Origins fallback on Chainlink CRE. Name "Chainlink Runtime Environment (CRE)" in text where the mechanism needs it; that is the product name as chain.link writes it in its navigation. An accurate descriptive sentence ("uses Chainlink CRE to …") is covered by §3. Do not put the Chainlink logo on the site, the deck or the video without written consent from legal@chain.link. Never animate it. Never make it the largest or most central element of a slide. Treat any reveal, pulse or morph of a sponsor mark in the video as a blocking finding.
- **Evidence:**
  - [Chainlink Foundation Terms of Service, Trademark Guidelines](https://chain.link/terms#trademark) — Chainlink Foundation, "Version 6.0", "Effective August 18th 2026", accessed 2026-10-01. The text was read from the source the page loads, `https://vault.pactsafe.io/s/e8308c3d-97af-4f76-8e65-6072d90342ea/legal.html`, fetched with curl `--compressed`.
    - "In order to ensure that you do not infringe on any the Marks, you must avoid doing any of the following without the prior written permission of the Foundation:"
    - "Using the Chainlink logo or any Foundation logo in your materials except as expressly permitted under these Guidelines or with the Foundation’s prior written consent."
    - "Altering, adapting, modifying, animating or morphing any Marks."
    - "Using the Foundation name or Marks as the visual focal point of any materials."
    - "the name of the Foundation and other Marks, may be used only when necessary to describe the subject matter of the materials, products, and/or programs."
    - "To request permission to use a Foundation Mark, please contact the Foundation at legal@chain.link."
    - Section 3: "You may generally use the Foundation’s name and logo to refer to the Foundation’s mission and activities, provided that any such reference does not in any way suggest or imply partnership or collaboration with, sponsorship, endorsement or approval by the Foundation."
    - Section 3: "You may also indicate the relationship of your products and services to the Foundation’s mission and activities by using an accurate descriptive term in connection with your product or service." (added at verification)
    - Section 3: "You may not use the Foundation’s name and logo as a trademark for your products or services or in a manner that may cause confusion with others or result in genericization." (added at verification)
- **Limits / false positives:** The conservative reading is taken, namely a logo only with consent. Section 3 could be read as a general permission to use the logo referentially.

### FD21-F10 — Chainlink has no badge today: "Powered by" and "Secured by" badges were free downloads in 2022; an approval-only "Secured With Chainlink" enrolment ("Once approved, you will receive the badge via email.") ran from at least 2024 until at least 22 July 2026; chain.link/badge returns 404 on 2026-10-01
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The May 2022 brand page offered "Powered by" and "Secured by" badge downloads (Dropbox links) and suggested linking them to chain.link. The September 2024 badge page required a claim form and approval, and carried a disclaimer of sponsorship; it also offered a separate badge to existing Chainlink Build members. The same enrolment page, with the claim form, approval by email and disclaimer, was still captured with HTTP 200 on 2025-10-27, 2026-05-11 and 2026-07-22. The July 2026 capture no longer has the Build-member section. On 2026-10-01 chain.link/badge renders "Page not found | Chainlink", the brand page body contains no badge, and chain.link's sitemap (1,332 URLs) lists no badge page. The programme was therefore withdrawn between 22 July and 1 October 2026. (corrected: the draft placed the approval-only programme in 2024 and did not see the 2025-2026 captures)
- **Implication for /frontend:** Render no "Powered by Chainlink" or "Secured with Chainlink" badge, and avoid those exact phrases in copy. "Secured With Chainlink" was the name of an approval-only badge until at least July 2026. The 2022 "Powered by" and "Secured by" badges were free downloads but have not been offered since. None of them points to anything now. (corrected: the draft said all were "badges that once needed approval"). Plain descriptive text is enough and is what Terms §3 allows (F09): "uses Chainlink CRE for …".
- **Evidence:**
  - [Brand Assets (Wayback 2022-05-18)](https://web.archive.org/web/20220518204722/https://chain.link/brand-assets) — archived official page, raw capture (`id_`), accessed 2026-10-01.
    - "Projects who use Chainlink can display this badge on their pages and applications. We suggest linking badges to https://chain.link"
    - "Download "Powered by" badges" · "Download "Secured by" badges"
  - [Chainlink Badge Enrollment (Wayback 2024-09-14)](https://web.archive.org/web/20240914134647/https://chain.link/badge) — archived official page, accessed 2026-10-01.
    - "Claim your Secured With Chainlink badge and let your users know that your Web3 App is powered by Chainlink’s industry-standard secure infrastructure."
    - "Once approved, you will receive the badge via email."
    - "Badged projects are not sponsored by, endorsed by, or affiliated with the Chainlink Foundation."
  - [Chainlink Badge Enrollment (Wayback 2026-07-22)](https://web.archive.org/web/20260722122057/https://chain.link/badge) — archived official page, raw capture (`id_`), title "Chainlink Badge Enrollment | Chainlink", accessed 2026-10-01 (added at verification).
    - "Click the “Claim Your Badge Today” button below and fill out the form. Once approved, you will receive the badge via email."
    - "Badged projects are not sponsored by, endorsed by, or affiliated with the Chainlink Foundation."
  - Wayback CDX (`cdx/search/cdx?url=chain.link/badge&from=2024`), queried 2026-10-01: 25 captures with status 200 from 2024-03-13 to 2026-07-22 (added at verification).
  - [chain.link/badge](https://chain.link/badge) — live, 2026-10-01: HTTP 404, "Page not found | Chainlink", "We can't seem to find the page you're looking for." chain.link/badges, /secured-with-chainlink and /badge-enrollment also return 404.
- **Limits / false positives:** Archived captures can miss lazily loaded content. The withdrawal date is bracketed by captures, not announced. A badge could exist inside a partner programme (for example Chainlink BUILD) that was not researched; the 2024 page offered one to existing Build members.

### FD21-F11 — Chainlink's own hackathon rules (Block Magic 2024, sponsor SmartContract Chainlink Limited SEZC) required demo videos to exclude "third party trademarks" unless the entrant had permission
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** In the official rules of Chainlink's April to June 2024 hackathon on Devpost, the video portion "must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission to use such material."
- **Implication for /frontend:** Origins judges a recorded video of at most 3 minutes, and BNB judges may watch a muted 1920x1080 recording. The video gate should list every third-party mark visible in any frame: customer logos, wallet UIs, exchange screens and sponsor logos. Each one must be allowlisted or replaced by text. Captions name parties in words.
- **Evidence:**
  - [Block Magic: A Chainlink Hackathon — Official Rules](https://chainlinkblockmagic.devpost.com/rules) — Devpost page, Sponsor and Administrator SmartContract Chainlink Limited SEZC, Submission Period 29 April to 2 June 2024, accessed 2026-10-01.
    - "Sponsor and Administrator: SmartContract Chainlink Limited SEZC, Strathvale House, 90 North Church Street 5th Floor Suite 504 George Town, Grand Cayman KY1-9012 Cayman Islands"
    - "must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission to use such material."
- **Limits / false positives:** This is a different event, and a Devpost rule. The Origins rules on BuilderBase contain no such clause (F21). It is a precedent from the same sponsor, not a rule that binds the Origins hackathon.

### FD21-F12 — Solana's brand page (solana.com/branding) sets don'ts, two colours (#9945FF, #14F195), a clear-space diagram and five downloadable asset families; its Drive kit also ships Black and White versions of the logomark
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Page: six don'ts, colours "solana purple" #9945FF and "solana green" #14F195 plus a "solana gradient" PNG, and five asset families (main logotype, logomark, wordmark, vertical lockup, Foundation logotype), each in PNG and SVG.
  - Clear space: the page draws it without numbers. In the diagram, the horizontal logotype's margin is a unit X drawn as wide as the logomark column, and the standalone logomark's corners are labelled "X=2".
  - Drive folder linked as "Download assets" (listed through `embeddedfolderview`): logomark files "Solana Logomark - Color.svg", "- Black.svg" and "- White.svg" (July 2023); logotype files named "Size=18" to "Size=96" in black, white, color-black and color-white; "Gradient/solanaGradient.png" (May 2023); and a "Fonts" folder (F15).
  - Press contact: press@solana.org.
- **Implication for /frontend:** For a Solana-track page, use the official White or Black logomark when the page's palette should not carry Solana's gradient. The mono files are official, so this is not recolouring. Never use the logo "as a frame for imagery", with a shadow or outline, or on a low-contrast ground.
- **Evidence:**
  - [Brand & Press | Solana](https://solana.com/branding) — Solana Foundation, accessed 2026-10-01 — official kit page, raw HTML.
    - "Follow these guidelines when promoting Solana in marketing communications, including advertising, articles, websites, and printed promotions."
    - "A certain amount of space is needed around the logomark to prevent it from becoming cluttered by surrounding artwork, images, or the edge of a page. Below are the minimum spacings for both logomark and wordmark."
    - "Don’t add shadows behind the logo" · "Don’t add outlines to the logo" · "Don’t stretch the logo" · "Don’t apply logo in low resolution" · "Don’t use logo as a frame for imagery" · "Don’t place on low contrast colors"
    - "Please direct inquiries to press@solana.org."
  - Clearspace image `spacing.f0b480df.png`, viewed on 2026-10-01. The original at `/_next/static/media/spacing.f0b480df.png` is 4680 × 4272; `/_next/image` serves it at 1920 × 1753 when asked for w=1920. (corrected: the draft gave 1920 × 1753 as the image's size)
  - [Solana assets on Google Drive](https://drive.google.com/drive/u/1/folders/1Y882o7uxW4Bx2vL6MXI-IozbGTX3ztBk) — Solana Foundation, listed on 2026-10-01 through `drive.google.com/embeddedfolderview`.
- **Limits / false positives:** Reading X from the diagram is my interpretation. The "Size=" values may be pixel heights, but the kit does not say.

### FD21-F13 — The Solana Foundation Brand Guidelines (June 2026) claim Solana's "look and feel", including its gradient, colours and typefaces, as "Solana Marks"; they forbid changing their scale or colours, combining them with "your name" or logos without "explicit, written permission", and using them descriptively
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The guidelines are linked from the brand page as a Word file on Google Drive, and the export's first line reads "Solana Foundation Brand Guidelines (June 2026)". They list the word marks SOLANA, SOL, ACCELERATE and BREAKPOINT and five logo images. They claim the look and feel "inclusive of" an inline image, which in the .docx is `word/media/image6.jpg`, the purple-to-green gradient, and also "designs, color(s), names, typeface(s)". Written permission requests go to operations@solana.foundation.
- **Implication for /frontend:** Solana is the only sponsor here that claims its colours and gradient as marks. A project must not adopt the Solana gradient or palette as its own theme, whatever the checker says about tells. It must not build a lockup of the project name with the Solana logo, and must not put SOLANA or SOL in its program or product name. The mark may appear only as an unaltered official file.
- **Evidence:**
  - [Solana Foundation Brand Guidelines](https://docs.google.com/document/d/1gOjdCVI2tp-hpCJciSNZAR93cxgw_gh2/edit?usp=sharing) — Solana Foundation, "(June 2026)", accessed 2026-10-01 as `export?format=txt` and as the .docx through `uc?export=download` (the image was mapped by walking `word/document.xml` relationships).
    - "is also the owner of the look and feel of goods and services offered under its trademarks inclusive of"
    - "designs, color(s), names, typeface(s), and other elements that serve to distinguish Solana from others as depicted on the Solana Brand & Press page, which may be updated from time to time (all collectively referred to as the “Solana Marks”)."
    - "Modifies, alters, changes the scale of, skews, rotates, or changes the design or colors of any of the Solana Marks."
    - "Combines any of the Solana Marks with any third-party design, word, color, graphic, text, or other element—including your name, any other company or organization’s logos, word marks, or product or service names—or any generic terms, unless you have received explicit, written permission from the Solana Foundation."
    - "Is descriptive of any products or services, or is used as a noun or verb."
    - "Is false or misleading, or that is likely to cause confusion as to source, or to suggest sponsorship, endorsement or affiliation with the Solana Foundation where none exists."
    - "please contact operations@solana.foundation."
- **Limits / false positives:** Read literally, "changes the scale of" would forbid any resizing, and "descriptive … or … noun" would forbid ordinary sentences such as the Solana track's own "Build a program that interacts with the Solana blockchain." and "Build on Solana's high-performance blockchain" (Contradictions 9). The .docx core properties carry placeholder dates (1900-01-01), so "June 2026" comes only from the title.
- **Verification note:** The export and the .docx were re-downloaded. Five inline images (`image1.png` to `image5.png`) sit between "SOL," and "ACCELERATE". `image6.jpg` (1429 × 496) follows "inclusive of" and samples #9945FF at the left and #14F194 at the right.

### FD21-F14 — Measured: every official Solana colour logo carries the same six-stop gradient, #9945FF → #8752F3 → #5497D5 → #43B4CA → #28E0B9 → #19FB9B, running from bottom-left to top-right at about 41° from vertical; it passes through blue, so a "purple-to-blue gradient" rule fires on it
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - Stops: `solanaLogo.svg`, `solanaLogoMark.svg`, `solanaVerticalLogo.svg` and `solanaFoundationLogo.svg`, from `solana.com/src/img/branding/`, each define one `linearGradient` with stops at 0.08 #9945FF, 0.3 #8752F3, 0.5 #5497D5, 0.6 #43B4CA, 0.72 #28E0B9 and 0.97 #19FB9B. `solanaWordMark.svg` has none.
  - Direction: in the logomark, the vector runs from (8.53, 90.10) to (88.99, −3.02), so dx 80.47 and dy (up) 93.11, which gives 40.8° from vertical. The logotype, vertical lockup and Foundation logotype give 41.6°.
  - Gradient image: `solanaGradient.jpg` (5440 × 1888) samples #9945FF at the left edge, #5799CB at the centre and #14F194 at the right edge.
  - The logo's end stop (#19FB9B) is not the page's "solana green" (#14F195).
  - An angle of 135° appears on third-party colour sites. It was not found in the official files and is not used here.
- **Implication for /frontend:** Exempt the gradient only when it comes from an allowlisted Solana file (SHA-256 match) or from that file's own `<linearGradient>` inlined unchanged in the logo's SVG. A CSS `linear-gradient()` using these stops on a section, button or text is not exempt. Under F13 it is also a use of Solana's claimed look and feel.
- **Evidence:**
  - [solanaLogoMark.svg](https://solana.com/src/img/branding/solanaLogoMark.svg) — Solana Foundation, accessed 2026-10-01 — official file (SHA-256 3d340110…bbe1f08a).
    - `<linearGradient id="paint0_linear_174_4403" x1="8.52558" y1="90.0973" x2="88.9933" y2="-3.01622" gradientUnits="userSpaceOnUse">`
    - `<stop offset="0.08" stop-color="#9945FF"/>` … `<stop offset="0.5" stop-color="#5497D5"/>` … `<stop offset="0.97" stop-color="#19FB9B"/>`
  - [solanaGradient.jpg](https://solana.com/src/img/branding/solanaGradient.jpg) — Solana Foundation, sampled with Pillow 10.4 on 2026-10-01.
  - The angle was computed as `atan2(dx, dy_up)` from the SVG coordinates.
- **Limits / false positives:** The angle is in each file's user space, so the equivalent CSS angle depends on the box's aspect ratio. Sampling JPEG pixels adds compression noise (#14F194 against #14F195).

### FD21-F15 — Fonts found in sponsor kits are commercial fonts under non-transferable licences, so downloading them gives the team no licence: Solana's kit contains ABC Diatype (Dinamo, whose EULA 2.51 is non-transferable and forbids sharing), and Ledger's contains Brut Grotesque with the Bureau Brut licence ("personal and non-transferable"); the open fonts in these kits are Chivo, TASA Orbiter and Inter
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Solana: the Drive "Fonts" folder holds ABC Diatype and ABC Diatype Semi-Mono `.otf` files, ten weights each, dated 7 July 2021. Dinamo's EULA 2.51 licenses the "License Owner" and forbids giving the fonts to third parties without a Subcontractor licence.
  - Ledger: the brand site's download modal offers "Brut Grotesque" ("For use in websites and apps"), "HM ALPHA MONO" ("For use as tags and highlight") and "LEDGER MONO" ("For use in printing only"). The Ledger fonts folder on Drive holds a "BureauBrut-Licence" subfolder with `BureauBrut-Licence_FR.pdf` and `BureauBrut-License_EN.pdf`. The English licence (Bureau Brut v1.2) says its licences are "personal and non-transferable to third parties" and lists among forbidden acts giving or distributing the font file (added at verification: the draft had seen only the folder name).
  - Who holds the licences for these copies is not published. (corrected: the draft asserted the fonts are "licensed to the sponsor"; no source shows that)
  - Open alternatives: Cardano's Chivo is in google/fonts under `ofl/chivo` (with `OFL.txt`), and TASA Orbiter is OFL-1.1 (F08).
- **Implication for /frontend:** The ip gate (ARCHITECTURE §5) must reject any font file whose provenance is a sponsor kit unless a licence file there says OFL, Apache, UFL or MIT. Even an open sponsor font should not become the project's own voice, since that copies the sponsor's trade dress (FD09).
- **Evidence:**
  - [Licensing Terms — Dinamo Typefaces](https://abcdinamo.com/licenses) — Dinamo, "End User License Agreement", "Version 2.51", accessed 2026-10-01.
    - "we grant the License Owner a perpetual, worldwide, non-exclusive, non-transferable, non-assignable license to use the fonts for the purposes allowed by this contract."
    - "Share the fonts with third parties (unless you buy a Subcontractor license)" (in "§ 10 Restrictions", the list of things "you can’t do")
  - [Solana assets, Fonts folder](https://drive.google.com/drive/u/1/folders/1Y882o7uxW4Bx2vL6MXI-IozbGTX3ztBk) — listing on 2026-10-01: "ABC Diatype" → "ABCDiatype-Bold.otf" … "ABCDiatype-ThinItalic.otf".
  - [Ledger brand site](https://brand.ledger.com/brand-design/logo) — Ledger SAS, accessed 2026-10-01 — download modal: "Brut Grotesque" "For use in websites and apps"; "LEDGER MONO" "For use in printing only". Drive folder `1WPt-TBh3VKYFB5L_6GlzTr6NaqKjRis1` lists "BrutGrotesque/BureauBrut-Licence".
  - `BureauBrut-License_EN.pdf` — Bureau Brut, "Bureau Brut v 1.2", PDF created 2021-03-02, Drive file `1M_Nza94Ya7MyMcRSFH5vrT9bjG4Mml7f` in the Ledger fonts folder, downloaded and read with pypdf 6.18.1 on 2026-10-01 (added at verification).
    - "As with any font license, our licenses are personal and non-transferable to third parties." (line breaks removed)
    - "resell, rent, lend, give, distribute, make available to the public or sublicense the license or the font file" (listed under "Some examples of what is not allowed:"; line breaks removed)
  - [google/fonts ofl/chivo](https://github.com/google/fonts/tree/main/ofl/chivo) — listed with `gh api` on 2026-10-01: `Chivo[wght].ttf`, `OFL.txt`.
- **Limits / false positives:** The Dinamo sentence is quoted as the Licensing Terms page renders it. The HM Alpha Mono and Ledger Mono licences were not found.

### FD21-F16 — Ledger's marks: website terms say "you agree not to reproduce, represent, extract and use in any way" Ledger's trademarks and logos; the press page invites partners, affiliates and anyone who shows "any Ledger visual" to use its October 2025 press kit, which holds logos, product shots and a company text but no usage rules
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Ledger SAS lists as its trademarks "Ledger, Ledger Stax, Ledger Flex, Ledger Nano, Ledger Nano S, Ledger OS, Ledger Wallet, [LEDGER] (logo), and [L] (logo)".
  - The press kit ZIP is `Ledger_Press_kit_october_2025.zip`: 71,789,323 bytes, last modified 22 Oct 2025, 58 entries dated 21 Oct 2025. It contains Ledger logos (three SVG and two PNG, including `LEDGER-WORDMARK-BLACK-RGB.svg` and `White -Ledger logo.svg`), four Ledger Enterprise logos (PNG only), product shots and "About Ledger" (PDF and DOCX). (corrected: the draft's "Ledger and Ledger Enterprise logos (SVG and PNG …)" implied Enterprise SVGs; there are none)
  - The ZIP contains no guidelines file, although the page promises "brand guidelines".
- **Implication for /frontend:** For Ledger OP3N, name Ledger products in text (F18) and show no Ledger logo by default. If the organisers supply assets or say yes, store that as `approval_evidence` in the profile, and only then allow the press-kit files, unaltered.
- **Evidence:**
  - [Website Terms of Use](https://shop.ledger.com/pages/website-terms-of-use) — Ledger SAS, undated, accessed 2026-10-01.
    - "Ledger's names and logos are trademarks of Ledger."
    - "Accordingly, you agree not to reproduce, represent, extract and use in any way any or all of Ledger's trademarks, logos, Site or Products."
    - "Ledger, Ledger Stax, Ledger Flex, Ledger Nano, Ledger Nano S, Ledger OS, Ledger Wallet, [LEDGER] (logo), and [L] (logo) are trademarks owned by Ledger SAS"
  - [Ledger Press Kit](https://www.ledger.com/press) — Ledger SAS, accessed 2026-10-01.
    - "Are you a Ledger partner, affiliate, or display any Ledger visual on your website or social platforms? If yes, make sure you are up to date and currently using our brand new visual assets."
    - "Please find our most current logos, brand guidelines, product visuals & anything else you may need, here."
  - [Ledger_Press_kit_october_2025.zip](https://downloads.ctfassets.net/ge894kijjvls/5h5wCwz5ttJ0G1t7MT4rDX/902db9a4f79412a45e64993c3f061ee0/Ledger_Press_kit_october_2025.zip) — central directory read with HTTP range requests (9,562 bytes fetched out of 71,789,323), and four members extracted the same way on 2026-10-01.
- **Limits / false positives:** The website terms are general terms of use, not a trademark policy written for developers. The press page asks people to update their assets but does not grant permission.

### FD21-F17 — Ledger's visual language (brand.ledger.com and the March 2025 brand book): white and black with Serenity Purple #D4A0FF and Safety Orange #FF5300, "a ratio of 80% black and white", three house taglines, bracket iconography, and purple and "liquid" gradient backgrounds; no clear space or minimum size is published
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Colours: the website lists White #FFFFFF, Black 950 #000000, Serenity Purple #D4A0FF (Pantone 2572), Safety Orange #FF5300 (Orange 021), Success Green #6EC85C (7479 C) and Error Red #E40046 (192 C). The brand book "[LEDGER] Brand Book.pdf" (Drive, 27 Mar 2025, 22 pages) prints Black 950 as #0A0A0A.
  - Taglines: "Free from compromise", "Now you’re in control" and "This is what security feels like".
  - Brackets: the logo page calls the brackets "the core visual iconography for all existing offerings or elements that are made possible by Ledger".
  - Backgrounds: the brand Drive holds "01. Gradient/PURPLE_ANIMATED", "Purple.png" and "03. Liquid Gradient/liquid-purple.png". Sampling liquid-purple.png gives near-black with purple highlights (#521387 at the top centre).
  - The brand-site pages read (overview, logo, colour, taglines, about) and the brand book state no clear space, no minimum size and no rule for third parties. The typography, HUD and tone-of-voice pages were not read.
- **Implication for /frontend:** Do not borrow Ledger's taglines, its "[ ]" bracket framing, its HUD style or its purple and liquid backgrounds for the project's UI: they are Ledger's identity, and brackets mean "made possible by Ledger". Purple glows on a black page stay flagged by the checker even for a Ledger-track project. Exempt #D4A0FF only inside Ledger's own files or SDK UI (F19).
- **Evidence:**
  - [Color — Ledger brand](https://brand.ledger.com/brand-design/color) — Ledger SAS, accessed 2026-10-01.
    - "Our primary palette is comprised of juxtaposing cool and warm hues - white/black, purple/orange."
    - "Sticking to a ratio of 80% black and white."
  - [Taglines — Ledger brand](https://brand.ledger.com/brand-design/taglines) — Ledger SAS, accessed 2026-10-01 — "Free from compromise" · "Now you’re in control" · "This is what security feels like".
  - [Logo — Ledger brand](https://brand.ledger.com/brand-design/logo) — Ledger SAS, accessed 2026-10-01 — "The Brackets consist solely of the custom brackets, the core visual iconography for all existing offerings or elements that are made possible by Ledger."
  - "[LEDGER] Brand Book.pdf" — Ledger SAS, Drive folder linked from brand.ledger.com, 29,616,967 bytes, SHA-256 fb6137d4…12759f04. Text extracted with pypdf; page 15 rendered and read: "Black 950", "#0A0A0A".
  - Drive listing of backgrounds folder `1wAUknFIM5YjTokNJhfSJDH4SPCR_GWlD` on 2026-10-01. "Purple.png" and "liquid-purple.png" were downloaded and sampled.
- **Limits / false positives:** The brand site is written for Ledger's own designers. The Black 950 value differs between the site and the book (Contradictions 10).
- **Verification note:** The brand book was re-downloaded (same size and SHA-256). Its 22 pages contain no "clear space", "safe space", "minimum", "partner" or "permission". liquid-purple.png (652 × 367) samples #6E1AB6 at (326, 0) and #521387 at (326, 5), with a dark body (#10041A at the centre), so the dossier's value depends on the exact row sampled.

### FD21-F18 — Ledger naming in copy: "Ledger Live" is being renamed "Ledger Wallet", and the hardware "wallet" is now a "signer"; product names are the trademarked ones
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Ledger's developer documentation states that the renaming is in progress. The trademark list (F16) names Ledger Stax, Ledger Flex, Ledger Nano, Ledger Nano S, Ledger OS and Ledger Wallet. The Wallet Provider docs use "signer" throughout ("secure signer pairing", "direct signer connections").
- **Implication for /frontend:** Copy lint for Ledger projects should flag "Ledger Live" (suggest "Ledger Wallet") and "hardware wallet" (suggest "signer") as advisories, and should require the exact product names. This is the vocabulary Ledger's judges use.
- **Evidence:**
  - [How to update your dApp for Ledger Wallet](https://developers.ledger.com/docs/ledger-live/discover/integration/dapp-browser/dapp-customisation) — Ledger Developer Portal, accessed 2026-10-01 (Markdown version at the same path with `.md`).
    - "The renaming of "Ledger Live" to "Ledger Wallet" and "wallet" (in the hardware sense) to "signer" is still in progress."
  - [Ledger Wallet Provider](https://developers.ledger.com/docs/ledger-wallet-provider/overview) — Ledger Developer Portal, accessed 2026-10-01.
    - "Give your users a first-party Ledger experience inside your application with secure signer pairing, Clear Signing, and Transaction Check built in." (line break removed)
- **Limits / false positives:** Legacy pages still say "Ledger Live" and "hardware wallet", so the lint must stay advisory.

### FD21-F19 — Legitimate routes for Ledger UI in a dApp: the Ledger Wallet Provider SDK renders Ledger's "official connect flow" but needs partner-programme API keys; Ledger's legacy tutorial puts a Ledger logo on a wallet-choice button; a Ledger technical review "does not constitute a vetting or endorsement"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The Wallet Provider "embeds Ledger's official connect flow directly inside your application". It mounts its own UI (a floating button, a modal and a side panel) and requires enrolment in the partner programme to obtain API keys. The floating button can be hidden (`hideButton`) or anchored inside an element of the dApp (`floatingButtonTarget`). (corrected: the draft gave no source for the UI description; the SDK's Configuration page is now cited). A LedgerJS beginner tutorial, still online but under a banner telling LedgerJS users to migrate to the Device Management Kit, builds a modal with `<img src="./assets/ledger-logo.jpg" ... alt="Ledger" />` and tells the reader to "Click on the Ledger logo." Ledger's device-app terms say a review creates no endorsement or partnership.
- **Implication for /frontend:**
  - With open DMK, the connect control is the team's own UI. Label it in words ("Connect a Ledger signer"). A Ledger logo on that button matches Ledger's own tutorial but conflicts with the website terms (F16), so it stays off unless the organisers approve.
  - If the team obtains Wallet Provider keys, the SDK draws Ledger's first-party UI. The checker should exempt that component's subtree from the tell and ip gates, which requires identifying the SDK's root element at build time. With `floatingButtonTarget`, that subtree can sit inside the page's own header.
  - No copy may claim Ledger review, certification or endorsement.
- **Evidence:**
  - [Ledger Wallet Provider](https://developers.ledger.com/docs/ledger-wallet-provider/overview) — Ledger Developer Portal, accessed 2026-10-01.
    - "Ledger Wallet Provider is a web component SDK that embeds Ledger's official connect flow directly inside your application"
  - [Get started (v2)](https://developers.ledger.com/docs/ledger-wallet-provider/get-started/v2) — Ledger Developer Portal, accessed 2026-10-01.
    - "**Partner program**: Ledger Wallet Provider requires enrollment in Ledger's partner program to obtain API keys."
  - [Configuration](https://developers.ledger.com/docs/ledger-wallet-provider/configuration) — Ledger Developer Portal, accessed 2026-10-01 (Markdown version at the same path with `.md`) (added at verification).
    - "Hides the floating Ledger button entirely. Defaults to `false`."
    - "The Ledger UI (modal, side panel) is still mounted"
    - "When provided, the floating button renders as a compact button inside the target element instead of being positioned on screen."
  - [Transfer of Ethers between accounts](https://developers.ledger.com/docs/device-interaction/dmk-ts/ledgerjs/beginner/transfer-eth) — Ledger Developer Portal (legacy LedgerJS tutorial), HTTP 200 on 2026-10-01.
    - "Click on the Ledger logo."
    - `src="./assets/ledger-logo.jpg"`
  - [Warranty and liability](https://developers.ledger.com/docs/device-app/submission-process/deliverables/legal) — Ledger Developer Portal, accessed 2026-10-01.
    - "This technical review does not constitute a vetting or endorsement of the App by Ledger, nor does it create any kind of partnership between you and Ledger or limit your responsibility for your App."
- **Limits / false positives:** The DOM structure of the SDK (shadow root or not) was not inspected. The tutorial is legacy and not a licence.

### FD21-F20 — BNB Chain's full kit (confirming and completing FD09-F17): yellow #F0B90B (Pantone 116C), #0B0E11 and white; minimum widths of 70, 97 and 15 px; clear space X equal to the logomark's height; alignment and placement rules; three phrases; logo use only after approval; a September 2026 ZIP of flat logos
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Colours: the page lists three colours with hex, RGB and CMYK values.
  - Sizes: minimum width 70 px for the vertical lockup, 97 px for the horizontal lockup and 15 px for the logomark.
  - Clear space: "‘X’", derived from the height of the logomark.
  - Placement: the horizontal lockup is left-aligned, never right; the vertical lockup is centred. The logomark alone is only for "Buttons", "Profile Picture", "An expression for the BNB Token" and "As an Icon". The yellow logo is used "wherever possible", and mono versions only against low-contrast grounds.
  - Don'ts: no outline, shadow, gradient, recolouring, stretching, busy grounds or low-contrast grounds.
  - Wording and approval: the phrases and the approval steps are quoted below; FD09 already covered them.
  - ZIP: `BNBChain-Logo.zip` is 150,418 bytes, last modified 18 Sep 2026. It holds nine SVG and nine PNG files (horizontal, stacked and symbol × Yellow, Black and White). The yellow files are dated 2023-03-26 and the black and white ones 2025-10-22. Measured: #F0B90B, #0B0E11 or white fills, no gradients.
- **Implication for /frontend:** For the BNB board (holdover), keep "Building on BNB Chain" or "Powered by BNB Chain" in text. Add the logo only after BNB approves the proposed use, and then as the yellow horizontal lockup at least 97 px wide, left-aligned, with X clear space. The board's own use of #F0B90B as an accent is not governed by this page, which regulates the logo (internal-contracts F15). Placed next to the BNB logo, however, it reads as official.
- **Evidence:**
  - [Brand Guidelines - BNB Chain](https://www.bnbchain.org/en/brand-guidelines) — BNB Chain, undated, accessed 2026-10-01 — raw HTML.
    - "The horizontal lockup (logomark with wordmark) should not be smaller than 97px in width. This applies to coloured and mono-coloured versions of the logo."
    - "There should always be a safe space of ‘X’ around the BNB Chain logo to ensure its legibility. The measurement of X is derived from the height of the logomark."
    - "The horizontal lockup should always be aligned left on a page. It should never be aligned right."
    - "The mono-coloured logos should only be used if the yellow logo is used against a background colour that results in low-contrast."
    - "Do not add a gradient or change the original colours of the logo."
    - "Projects must use wording like ‘Powered by,’ ‘Available on,’ ‘Building on’ BNB Chain and tag BNB Chain’s handle on socials."
    - "Projects must not use wording like ‘Official,’ ‘Partnering,’ ‘Collaborating’ with BNB Chain unless cleared by management."
    - "Projects should seek approval from BNB Chain before using the logo."
    - "Projects need to send the proposed way they wish to use the logo and explain how it will be distributed."
  - [BNBChain-Logo.zip](https://static.bnbchain.org/home-ui/static/images/brand-guidelines/BNBChain-Logo.zip) — path taken from the page's JS chunk (`/images/brand-guidelines/BNBChain-Logo.zip`); downloaded, listed and hashed on 2026-10-01.
- **Limits / false positives:** The yellow's CMYK is printed as "C:0 M:100 Y:26 K:0", which does not match R240 G185 B11 (magenta and yellow look swapped), so use the hex value. The "can add" and "should seek approval" sentences still conflict (FD09, Contradictions 6 there).

### FD21-F21 — TOKEN2049 publishes no Singapore or Origins brand kit; its Dubai 2027 kit requires "prior approval" for the wordmark and pairs the logo with the event location; the name "must always be capitalised, without space"; its terms allow use of site material "only as expressly authorised"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Singapore: `token2049.com/singapore/brand-kit` and `/brand-kit` return 404, and the Wayback CDX API lists no capture of either.
  - Dubai kit: the page offers four ZIPs (Primary 2027, Secondary 2027, Wordmark, and a Logomarks 2027 set whose folders include a Tertiary logo) in PNG, SVG and EPS. Most lockups are Dubai-specific ("Token2049 Dubai Primary"). The Primary ZIP also holds a location-free "Primary Logo" set (black, white, stacked) that shows "TOKEN2049" alone. The page publishes no colour values. (corrected: the draft said "The lockups are Dubai-specific")
  - The Dubai page invites use of its assets ("Our Brand Kit helps you represent TOKEN2049 Dubai correctly in digital and printed materials"). It asks prior approval only for the wordmark and for removing the logo's assisting text. (added at verification)
  - Terms: the site's terms were "last updated in December 2017" (operator BOB Group Limited, Hong Kong).
  - Origins pages: neither the Origins page on token2049.com nor the four BuilderBase track pages (main, Cardano, Chainlink, Solana, live JSON of 2026-10-01) contain any rule on participants using TOKEN2049 marks.
- **Implication for /frontend:** Put no TOKEN2049 logo or glyph in the site, deck or video. Write the event's name in text as the organiser does: "TOKEN2049 Origins Hackathon". Copy lint flags "Token2049", "Token 2049" and "TOKEN 2049". Whether a finalist deck may carry the event logo is a question to put to the organisers; the owner's drafted questions do not ask it.
- **Evidence:**
  - [Brand Kit | TOKEN2049 | 21-22 April 2027 | Dubai](https://www.token2049.com/dubai/brand-kit) — TOKEN2049, accessed 2026-10-01.
    - "The wordmark should not be used without prior approval from TOKEN2049."
    - "Don’t use TOKEN2049 standalone glyph. The TOKEN2049 logo should always be used in combination with the event location."
    - "The brand name TOKEN2049 must always be capitalised, without space."
    - "Our Brand Kit helps you represent TOKEN2049 Dubai correctly in digital and printed materials." (added at verification)
    - "Don’t remove assisting text from the logo, without prior agreement from TOKEN2049." (added at verification)
  - [TOKEN2049 LOGOS - Primary - 2027.zip](https://token2049.nyc3.cdn.digitaloceanspaces.com/Dubai/Brandkit/TOKEN2049%20LOGOS%20-%20Primary%20-%202027.zip) — 1,605,604 bytes, central directory read by HTTP range requests on 2026-10-01: folders `Primary /` ("Primary Logo - Black.svg", "Primary Logo - White.svg", "Primary Logo - stacked - black.svg") and `Dubai/` ("Token2049 Dubai Primary  - Black .svg"). The two SVGs named were extracted and rendered: the first shows "TOKEN2049" alone, the second "TOKEN2049" over "DUBAI" (added at verification).
  - [Terms & Conditions | TOKEN2049](https://www.token2049.com/terms-conditions) — BOB Group Limited, last updated December 2017, accessed 2026-10-01.
    - "You are permitted to use this material only as expressly authorised by us."
  - [BuilderBase public event API](https://edge.builderbase.com/events/public/token2049-origins-hackathon) and the three partner-track slugs — TOKEN2049 on BuilderBase, `updated_at` 2026-09-24T13:39:53Z, fetched 2026-10-01. A grep for brand, logo and trademark in the rendered text found none.
- **Limits / false positives:** The Dubai kit governs Dubai. The Singapore team may apply other rules or grant permission on request.

### FD21-F22 — DeVinci Blockchain (DVB) publishes no brand kit; its site terms (January 2025) reserve its logos and require "express written permission"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The association's site devinciblockchain.com (found through a link in an ESILV article) has sections About, Activities, Bureau, FAQ and Partners, plus Terms and Privacy pages, and no kit. Its GitHub organisation `DeVinciBlockchain` (created 2025-12-27) has 0 public repositories. ESILV writes the name "DeVinci Blockchain (DVB)". The association's own site writes "DeVinci Blockchain - DVB" (page title), "DeVinci Blockchain" with alternateName "DVB" (JSON-LD), and "DeVinci Blockchain Association" (terms). (corrected: the draft said "ESILV and the association write the name 'DeVinci Blockchain (DVB)'"; the parenthesised form is ESILV's)
- **Implication for /frontend:** The DVB logo appears only with the board's written yes; the owner is a member and can ask. Write the name in text as "DeVinci Blockchain (DVB)", which combines the association's name and short name as ESILV does. The Ledger OP3N post goes out from the club's account (owner's brief), so DVB's own brand arrives with the account.
- **Evidence:**
  - [Terms of Service — DVB](https://devinciblockchain.com/terms) — DeVinci Blockchain Association, "Last updated: January 2025", accessed 2026-10-01.
    - "All content on the DVB website, including text, graphics, logos, and images, is the property of DeVinci Blockchain Association. You may not reproduce, distribute, or create derivative works without our express written permission."
  - [ETHGlobal New York : les équipes de DeVinci Blockchain remportent cinq récompenses internationales](https://www.esilv.fr/ethglobal-new-york-les-equipes-de-devinci-blockchain-remportent-cinq-recompenses-internationales/) — ESILV, 2026-06-26, accessed 2026-10-01.
    - "DeVinci Blockchain (DVB) rassemble des étudiants du Pôle Léonard de Vinci autour des technologies blockchain, des crypto-actifs et des applications décentralisées."
  - [DeVinci Blockchain home page](https://devinciblockchain.com/) — accessed 2026-10-01 (added at verification): `<title>` "DeVinci Blockchain - DVB"; JSON-LD `"name":"DeVinci Blockchain","alternateName":"DVB"`.
  - `gh api orgs/DeVinciBlockchain` on 2026-10-01: `"public_repos":0`, `"created_at":"2025-12-27T17:06:57Z"`.
- **Limits / false positives:** The site's English path `/en` returns 404, and only the French and root pages were read. The site lists members' names, which are deliberately not reproduced here.

### FD21-F23 — Judges and rules discount branding: Ledger's prize text wants "Concrete use of Ledger primitives, not just wallet branding"; Origins rules make "Superficial integrations" ineligible; the Cardano track gives UX 20% and asks whether "someone new to blockchain" understands quickly
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Ledger's own "WHAT WE LIKE" list on the ETHGlobal New York 2026 prize page contains the branding line. The live Origins main-track data contains a meaningful-integration clause. The Cardano track's criteria give 20% to "User Experience & Design", phrased as quoted below.
- **Implication for /frontend:** A sponsor mark is attribution, never proof of integration. Show integration as working mechanism (transactions, workflow runs, signer prompts) and keep marks small and secondary, which is also what F02, F09 and F13 require. For Cardano, the first view must explain the product to a newcomer without relying on the logo.
- **Evidence:**
  - [Ledger prize — ETHGlobal New York 2026](https://ethglobal.com/events/newyork2026/prizes/ledger) — ETHGlobal (Ledger's prize text), accessed 2026-10-01.
    - "Concrete use of Ledger primitives, not just wallet branding."
  - [BuilderBase public event API — main track](https://edge.builderbase.com/events/public/token2049-origins-hackathon) — TOKEN2049, fetched 2026-10-01.
    - "Superficial integrations added solely to qualify for a track or prize will not be considered eligible."
  - [BuilderBase public event API — Cardano track](https://edge.builderbase.com/events/public/cardano-agentic-commerce) — TOKEN2049, updated 2026-09-24, fetched 2026-10-01.
    - "Could someone new to blockchain understand it quickly?"
    - "Projects must be built entirely during the 36-hour hackathon and must integrate Cardano meaningfully into the core functionality."
  - [Ledger × XRPL Hackathon](https://developers.ledger.com/xrplnyc) — Ledger Developer Portal, event of 24-25 October 2026 in New York, accessed 2026-10-01 through Exa's page fetch (a direct curl was redirected to a sign-in page) (added at verification).
    - "Pick one track. Whatever you build, we want Ledger used as a real trust layer, not just wallet branding, and a working demo, ideally on the XRP Ledger or its EVM sidechain."
- **Limits / false positives:** ETHGlobal's text and the XRPL page are from events other than OP3N, whose rubric was unpublished when the owner last checked (22 Sept). An Exa search on 2026-10-01 still found no OP3N hackathon rules.

### FD21-F24 — Measured across the downloaded official files: logos are flat single-colour for Cardano (18 SVGs), Chainlink (6), BNB Chain (9) and Ledger (3); only Solana's colour logos (4 of 5 web SVGs) contain a gradient, so the gradient tell collides with a logo only for Solana, and with organisations' decorative brand elsewhere
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** 36 SVGs from four sponsors were searched for the string "gradient", case-insensitively, and none contains one. They are the nine on cardano.org and the nine in the Cardano ZIP, the six in the Chainlink ZIP, the nine in the BNB ZIP and three from the Ledger press kit. Solana's logotype, logomark, vertical lockup and Foundation logotype contain the gradient of F14, and the wordmark does not. Brand gradients also exist outside logos: the Cardano Foundation's (F06), Ledger's backgrounds (F17) and Solana's claimed look and feel (F13).
- **Implication for /frontend:** Tell 1's sponsor allowlist can be narrow. Exempt a gradient only when the element is an allowlisted file matched by hash, or when it is that file's own unmodified `<linearGradient>`. Everything else, including gradients copied from a sponsor's decorative brand, keeps firing and may pass only with a tier-2 waiver whose reason cites this dossier. For Solana the waiver is refused outright, because it claims the gradient.
- **Evidence:**
  - Measurement on 2026-10-01 (Python `zipfile` and `grep -i gradient`): "cl-logo.zip 6 svg; 0 with gradient", "bnb-logo.zip 9 svg; 0 with gradient", "cardano-brand-assets.zip 9 svg; 0 with gradient". The nine cardano.org SVGs gave 0 files, the Ledger SVGs 0 each, and the Solana SVGs 2 matches each (opening and closing tags) except `solanaWordMark.svg` with 0.
    - Painted colours per file: one each (#0033AD, #F0B90B, #0B0E11, #0847F7, black or white). Four files also contain `fill="white"`, but only on a `<clipPath>` rectangle, which is not painted: `Chainlink-Logo-Blue.svg`, `Chainlink-Logo-Black.svg`, `BNB Chain_Logo_Black.svg` and `BNB Chain_Stacked_Logo_Black.svg`, each with its single occurrence inside the clipPath.
  - Files and hashes: see the Deliverable (`logo_sources[].sha256`).
- **Limits / false positives:** Only the downloaded variants were checked. The Cardano Foundation's kit SVGs and TOKEN2049's files were not checked. A sponsor may update a file, which changes its hash, so the allowlist must be refreshed before each event.
- **Verification note:** All 36 files were re-downloaded (the Ledger SVGs by range request from the press-kit ZIP) and all 35 non-null hashes in the Deliverable matched. The "2 matches" for Solana are `grep -c` line counts: each file has three occurrences, `<linearGradient`, `gradientUnits` and `</linearGradient>`, on two lines. The limit above is now partly closed. The four SVGs in the Cardano Foundation kit (F06) and two TOKEN2049 SVGs ("Primary Logo - Black.svg", "Token2049 Dubai Primary  - Black .svg") are flat. The other TOKEN2049 files remain unchecked.

### FD21-F25 — US registration records (USPTO TSDR, with Justia as a cross-check): CARDANO is registered (Reg. 6549522, 2021-11-09) to the Cardano Foundation; CHAINLINK (Reg. 5694500, 2019-03-12) is owned by SmartContract Chainlink Limited SEZC, not by the Chainlink Foundation that chain.link's terms name as owner, and its Sections 8 and 15 declaration was accepted on 2025-06-27
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - CARDANO: standard-character mark, serial 79282570, filed 2020-03-02 and registered 2021-11-09 on the Principal Register, status "LIVE/REGISTRATION/Issued and Active". Current owner "CARDANO Foundation", Dammstrasse 16, CH-6300 Zug. It is based on international registration 1349883 of 2016-12-14.
  - CHAINLINK: serial 87653484, filed 2017-10-20 and registered 2019-03-12. Current owner "SMARTCONTRACT CHAINLINK LIMITED SEZC" (Cayman Islands), recorded by Justia as "1st New Owner Entered After Registration"; the original registrant was SmartContract ChainLink, Ltd. TSDR status: "A Sections 8 and 15 combined declaration has been accepted and acknowledged.", dated 2025-06-27. Justia still shows "700 - Registered" with a 2019-03-12 status date, so its status is stale.
  - Chainlink's Terms of Service say the Foundation owns "the Foundation’s product or service names, logos, and other marks" "or its applicable licensors".
  - (corrected: the draft rested on Justia alone at grade B. The USPTO's own records were read at verification, so the grade rises to A, and the CHAINLINK maintenance status is added)
- **Implication for /frontend:** ® can be correct for CARDANO in the US, but Cardano's policy tells third parties to write ™, so follow the policy (F05). For Chainlink, send any permission request where the Terms say (legal@chain.link). Who holds which registration does not change what a hackathon page may do.
- **Evidence:**
  - [TSDR status, serial 79282570](https://tsdr.uspto.gov/statusview/sn79282570) — USPTO, "This page was generated by TSDR on 2026-09-30 18:49:22 EDT" (2026-10-01 in Paris), accessed 2026-10-01 (added at verification).
    - "Mark: CARDANO" · "US Registration Number: 6549522" · "Registration Date: Nov. 09, 2021" · "TM5 Common Status Descriptor: LIVE/REGISTRATION/Issued and Active" · "Owner Name: CARDANO Foundation" (labels and values joined; the page is a table)
  - [TSDR status, serial 87653484](https://tsdr.uspto.gov/statusview/sn87653484) — USPTO, generated 2026-09-30 18:48:40 EDT, accessed 2026-10-01 (added at verification).
    - "US Registration Number: 5694500" · "Registration Date: Mar. 12, 2019" · "Status: A Sections 8 and 15 combined declaration has been accepted and acknowledged." · "Status Date: Jun. 27, 2025" · "Owner Name: SMARTCONTRACT CHAINLINK LIMITED SEZC"
  - [CARDANO Trademark of CARDANO Foundation - Registration Number 6549522](https://trademarks.justia.com/792/82/cardano-79282570.html) — Justia Trademarks (USPTO data aggregator), accessed 2026-10-01 through Exa's full-page fetch (curl got HTTP 403; a second Exa fetch at the end of the session failed with CRAWL_UNKNOWN_ERROR, so the quotes come from the first fetch).
    - "Status 700 - Registered" · "Filing Date 2020-03-02" · "Registration Date 2021-11-09" · "Mark Drawing 4000 - Standard character mark Typeset"
  - [CHAINLINK Trademark of SMARTCONTRACT CHAINLINK LIMITED SEZC - Registration Number 5694500](https://trademarks.justia.com/876/53/chainlink-87653484.html) — Justia Trademarks, accessed 2026-10-01 via Exa.
    - "SMARTCONTRACT CHAINLINK LIMITED SEZC" · "31 - 1st New Owner Entered After Registration" · "Registration Date 2019-03-12"
- **Limits / false positives:** Only US records were read; Swiss, EU and Singapore registers were not checked. TSDR's JSON API now requires an API key, so the HTML status view was used. Attorney contact details in the records are deliberately not reproduced.

### FD21-F26 — Masumi, the agent-payment network the Cardano track names, publishes a press kit with a 52-page internal brand book ("2503-Agentic-Brand Guidelines.pdf") that sets minimum sizes, partnership lockups, Inter and gradient "ink" visuals, but no statement of permission, trademark or approval for third parties (added at verification)
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** ADDED AT VERIFICATION
- **Claim:**
  - The Cardano track's criteria ask "How well does it leverage Cardano's unique features (Masumi, EUTXO, native tokens, smart contracts, etc.)?" (BuilderBase JSON, 2026-10-01).
  - Masumi's press page says "Download logos, brand guidelines, and media assets from our press kit." It links a Drive folder holding `Brand Guidelines/2503-Agentic-Brand Guidelines.pdf` (59,424,996 bytes, 52 pages, SHA-256 10b7cf3b…370b9bf) and `Logos/` subfolders for Masumi, Kodosumi and Sokosumi, all dated 7 April 2025. The page describes Masumi as "Built on Cardano".
  - The book covers three brands ("masumi, the blockchain layer, kodosumi, the code and sokosumi the marketplace"). It sets minimum sizes of 14 px for the wordmark and 30 px height for the lock-up with Kanji (12 mm and 24 mm in print), and two drawn clearspaces. Partnership lockups use the wordmark only, with partner logos "optically sized". Logos on coloured backgrounds are black or white. The typeface is Inter. Colours are pink-to-red-and-yellow tones for masumi, lime-green-blue for kodosumi and deep purple for sokosumi, over neutral greys. The visuals are built from "dynamic gradients", "ink" and blur glows.
  - The extracted text contains none of "trademark", "permission", "approval" or "third".
- **Implication for /frontend:** Masumi publishes files for the press but no licence and no rule for third parties. Treat it like IOG: name it in text where the mechanism needs it ("settles agent payments through Masumi") and show no logo without a written yes. If a logo is ever approved, use the wordmark alone, in black or white, at least 14 px, and never locked up with the project mark: Masumi's partnership lockups describe co-branding Masumi makes itself. Its gradients and ink visuals are its decoration and get no tell-1 exemption. Masumi's use of Inter joins Chainlink's (F08) as a reason the Inter tell cannot be tier 1 on these tracks.
- **Evidence:**
  - [Press | Masumi](https://www.masumi.network/press) — Masumi, accessed 2026-10-01.
    - "Download logos, brand guidelines, and media assets from our press kit."
    - "Built on Cardano, Masumi enables a new economy where AI agents can discover, hire, and pay other agents to complete complex tasks."
  - [Masumi press kit on Google Drive](https://drive.google.com/drive/u/1/folders/1WbjV0HBr9ztn1C5Zyc7_xeuya3az3FEY) — listed through `embeddedfolderview` on 2026-10-01; the PDF's size and file name come from the `Content-Range` and `Content-Disposition` headers of a one-byte range request.
  - "2503-Agentic-Brand Guidelines.pdf" — Masumi, downloaded into memory (not written to disk) and read with pypdf 6.18.1 on 2026-10-01; quotes with line breaks removed.
    - "We created this document to give you a better understanding of the Sumi brand as well as offer you inspiration for current and future projects." (page 2)
    - "The AGENTIC family has multiple logos – masumi, the blockchain layer, kodosumi, the code and sokosumi the marketplace." (page 4)
    - "For collaborations and partnerships with other brands - depending on the surface - we can choose between horizontal and vertical lockups." · "In this case, we use only the wordmark without the associated Kanji characters." (page 12)
    - "Always make sure that logos are optically sized; do not attempt to match height or width." (page 13)
    - "The minimum logo size for adequate legibility is 14px for workmark only and 30px height for lock-up with Kanji (Web, 72ppi) or 12mm / 24mm (Print, 300dpi)." (page 14)
    - "If placed on a single- or multi-colored background, the logo should always be used in the primary neutral colors (black or white)." (page 16)
    - "Our typographic system is built on the versatility and clarity of Inter, emphasising simplicity and modernity across all touchpoints." (page 19)
    - "To create a diverse range of dynamic gradients and visuals, each brand needs secondary colors that work well in combination." (page 28)
  - [BuilderBase public event API — Cardano track](https://edge.builderbase.com/events/public/cardano-agentic-commerce) — TOKEN2049, fetched 2026-10-01 — "How well does it leverage Cardano's unique features (Masumi, EUTXO, native tokens, smart contracts, etc.)?"
- **Limits / false positives:** Only the PDF's text layer was read. Its pages were not rendered, so the drawn clearspaces and colour swatches (no hex values in the text) were not inspected, and the Drive logo files were not downloaded or hashed. Masumi's imprint and privacy pages were not read. Absence of a permission statement is not a prohibition; Masumi may grant use on request (press contact info@masumi.network).

## Deliverable

### 1. `sponsor_allowlist` for `profile.json` (`frontend` block)

Conventions: `allowed_phrases[].basis` says whether a phrase is **listed** by the sponsor or **derived** by this dossier from a sponsor rule. Regexes in `forbidden_phrases` run on **rendered text only** (not code, URLs or identifiers). `logo_default` is what /frontend does without recorded approval. `approval_evidence` stays `null` until the owner stores a written yes (path to the email or message). Hashes are SHA-256 of the files downloaded on 2026-10-01; a mismatch means the sponsor changed a file, so re-read the kit. At verification every non-null hash below was reproduced from a fresh download. The `masumi` entry was added at verification (F26).

```json
{
  "schema": "frontend.sponsor_allowlist/0.1 (FD21)",
  "accessed": "2026-10-01",
  "sponsor_allowlist": [
    {
      "sponsor": "cardano",
      "display_name": "Cardano (protocol marks owned by the Cardano Foundation)",
      "events": ["token2049-origins:cardano-agentic-commerce"],
      "kit_url": "https://cardano.org/brand-assets/",
      "policy_urls": [
        "https://cardanofoundation.org/en/trademark-policy",
        "https://forum.cardano.org/t/trademark-examples-quick-guidance-on-how-you-can-use-the-cardano-brand/66787"
      ],
      "allowed_phrases": [
        {"text": "a Cardano application", "basis": "listed (Trademark Policy §4)"},
        {"text": "compatible with the Cardano Code", "basis": "listed (§2.1)"},
        {"text": "specialising in Cardano development", "basis": "listed (§3.1)"},
        {"text": "built on the Cardano blockchain", "basis": "derived: descriptive use (§3.1) in adjective form (§4)"},
        {"text": "runs on the Cardano preprod testnet", "basis": "derived: same"}
      ],
      "forbidden_phrases": [
        {"regex": "\\b(Official|Certified)\\s+Cardano\\b", "flags": "i", "basis": "§3.1 examples; §2.2.7"},
        {"regex": "\\bCardano\\s+(partner|partnership|endorsed|approved|certified)\\b", "flags": "i", "basis": "derived from §2.2.7 (implied affiliation)"},
        {"regex": "\\bCardano['\u2019]s\\b", "flags": "", "basis": "§4 no possessive"},
        {"regex": "(?<![\\w./-])cardano(?![\\w./-])", "flags": "", "basis": "§4 initial capital; prose only"}
      ],
      "naming_blocklist": ["CARDANO", "ADA", "ADACOIN", "ADAPAY", "CARDANO FOUNDATION"],
      "naming_rule": "No mark, obvious variation, phonetic or foreign-language equivalent, takeoff or abbreviation in product, company, domain or service names (§2.2.8, §2.2.10). The policy's §3.1 grants automatic permission for names 'exclusively intended to support the Cardano Code and Project' (§3.3 still requires approval for any domain name), and the 2021 forum 'Dos' accept creative, distinct website or stake-pool names such as 'Cardanitos.com'; a hackathon product fits neither, so a hit goes to the owner for decision (corrected at verification).",
      "logo_default": "official_file_unaltered_allowed",
      "logo_conditions": [
        "standalone and unaltered, one of the nine official SVGs",
        "never combined or locked up with the project mark (§2.2.5)",
        "equal to or larger than any partner logo shown beside it (cardano.org co-branding rule)",
        "no rotation, stretch, distortion, recolouring, effects or animation",
        "trademark notice present on the same page or slide"
      ],
      "logo_sources": [
        {"variant": "horizontal-blue", "url": "https://cardano.org/img/brand-assets/cardano-horizontal-blue.svg", "format": "svg", "sha256": "94fb110ebb3475a0f3de620fbeaad91ae59a182a0d971eae865c556e1b6aa6e7"},
        {"variant": "horizontal-white", "url": "https://cardano.org/img/brand-assets/cardano-horizontal-white.svg", "format": "svg", "sha256": "82389ed5e7b7e5bae62b8c8de6b55dafe8815240698ef274c33379c0b9a38db8"},
        {"variant": "horizontal-black", "url": "https://cardano.org/img/brand-assets/cardano-horizontal-black.svg", "format": "svg", "sha256": "f5b1961963e9396d068f41b79855431ff919449e3c60480111e493d87400e0f4"},
        {"variant": "stacked-blue", "url": "https://cardano.org/img/brand-assets/cardano-stacked-blue.svg", "format": "svg", "sha256": "d6464ec6ac1f4fd67ffe55d3585e549d2f17f5f0ab169daf31f1f93642b75144"},
        {"variant": "stacked-white", "url": "https://cardano.org/img/brand-assets/cardano-stacked-white.svg", "format": "svg", "sha256": "47f138c97c70eaf6999e5d9a66a8b046401f7cbf23316de5c98f794fa591df3b"},
        {"variant": "stacked-black", "url": "https://cardano.org/img/brand-assets/cardano-stacked-black.svg", "format": "svg", "sha256": "a3668e586fbcec5e49b61b9bb067c3e675e3ec28424db7437d8f38c34dca1d55"},
        {"variant": "starburst-blue", "url": "https://cardano.org/img/brand-assets/cardano-starburst-blue.svg", "format": "svg", "sha256": "25e5fb6747e58495c87463df84177cc5626dac2fb4ec14a6fee5df7c045f4f19"},
        {"variant": "starburst-white", "url": "https://cardano.org/img/brand-assets/cardano-starburst-white.svg", "format": "svg", "sha256": "e4744a97f74a1c0de1b3baf24f7f5b8504af83e18c2ea50b0c588777f6eb4a06"},
        {"variant": "starburst-black", "url": "https://cardano.org/img/brand-assets/cardano-starburst-black.svg", "format": "svg", "sha256": "939788ab5d94dbac48189e6f57e773c77f29ed0a2e88fa5664da091924203a2a"},
        {"variant": "zip (svg+png, 2020)", "url": "https://cardano.org/downloads/cardano-brand-assets.zip", "format": "zip", "sha256": "79910a3c0a0e53a9044c357f7de88339d3fa47bcd204491daa2ed66a21a403a2"}
      ],
      "colours": {
        "core": [
          {"name": "Blue", "hex": "#0033AD", "pantone": "286"},
          {"name": "Black", "hex": "#000000"},
          {"name": "White", "hex": "#FFFFFF"},
          {"name": "Paper", "hex": "#F8F8F5"}
        ],
        "secondary": [
          {"name": "Red", "hex": "#FF5553", "pantone": "178"},
          {"name": "Green", "hex": "#3B7982", "pantone": "569"}
        ],
        "gradients": [],
        "claimed_as_mark": false
      },
      "typography": [{"family": "Chivo", "licence": "OFL (google/fonts ofl/chivo)", "fallback": "Arial, sans-serif"}],
      "clear_space": {
        "rule": "clear space equal to the width of six dots from the starburst icon",
        "min_size": {"web_px": 64, "tablet_px": 60, "phone_px": 56, "print_mm": 20, "dimension": "not stated"}
      },
      "approval_required": {
        "descriptive_text": false,
        "official_logo_standalone_unaltered": false,
        "lockup_or_combination_with_project_mark": true,
        "official_link_domain_company_merch_or_ads": true,
        "deemed_rejected_after": "3 months without reply",
        "contact": "permission form linked from the policy; legal@cardanofoundation.org; PR@cardanofoundation.org for high-resolution marks"
      },
      "approval_evidence": null,
      "trademark_notice": {
        "word_only": "Cardano\u2122 is a trademark of the Cardano Foundation, CHE-184.477.354",
        "with_logo": "Cardano\u2122 and the Cardano Logo\u2122 are trademarks of Cardano Foundation, CHE-184.477.354, Dammstrasse 16, 6300 Zug, Switzerland, in Switzerland and other countries"
      },
      "checker": {
        "tell1_exemption": "none needed: official files are flat (#0033AD, black, white)",
        "flag": ["any gradient, glow or filter applied to a Cardano logo element", "Cardano logo smaller than an adjacent project mark", "Cardano logo inside an animated element"]
      },
      "notes": [
        "The Cardano Foundation organisational brand (gradients, blurred shapes, Switzer) is a separate entry; do not import it into a Cardano-track UI.",
        "The 2021 forum guidance asks for (R) at the logo's top right; the 2024 policy asks for TM and forbids switching TM to (R). Follow the policy and do not edit the logo file.",
        "The 2021 forum guidance also asks users of the standalone logo to email legal@cardanofoundation.org with examples of the use (a courtesy notice, not a permission step); policy §3.4 lets the Foundation request specimens of use (added at verification)."
      ],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "cardano-foundation",
      "display_name": "Cardano Foundation (organisation brand)",
      "events": [],
      "kit_url": "https://cardanofoundation.org/en/brand",
      "policy_urls": ["https://cardanofoundation.org/en/trademark-policy"],
      "allowed_phrases": [{"text": "Cardano Foundation developer portal", "basis": "derived: naming the organisation in text when necessary"}],
      "forbidden_phrases": [
        {"regex": "\\bCardano Foundation[- ](approved|endorsed|partner|certified)\\b", "flags": "i", "basis": "§2.2.7"}
      ],
      "naming_blocklist": ["CARDANO FOUNDATION"],
      "logo_default": "text_only",
      "logo_sources": [
        {"variant": "brand kit zip (CF logotype, Cardano icon, guidelines PDF 2024)", "url": "https://ucarecdn.com/0d0df764-0cae-4736-baed-5a13f16609bc/", "format": "zip", "sha256": "2e8d5d965783658cebcdffed2a197800abc752a5927cce0bb4b220547fc38f65"}
      ],
      "colours": {
        "core": [
          {"name": "Grey1000", "hex": "#272727"}, {"name": "Grey800", "hex": "#404040"}, {"name": "Grey600", "hex": "#808080"},
          {"name": "Grey400", "hex": "#C6C6C6"}, {"name": "Grey200", "hex": "#D9D9D9"}, {"name": "Grey50", "hex": "#F2F2F2"},
          {"name": "Red1000", "hex": "#D64A2E"}, {"name": "Red50", "hex": "#FEF3F1"}, {"name": "Blue1000", "hex": "#0084FF"}
        ],
        "gradients": [
          {"name": "Blue 1+2", "stops": ["#00E0FF", "#0084FF"]},
          {"name": "Blue 2+3", "stops": ["#0084FF", "#BFA8FF"]},
          {"name": "Blue 3+1", "stops": ["#BFA8FF", "#00E0FF"]},
          {"name": "Green 1+2", "stops": ["#2BFFB3", "#00BE7A"]},
          {"name": "Green 2+3", "stops": ["#00BE7A", "#E1FF2B"]},
          {"name": "Green 3+1", "stops": ["#E1FF2B", "#2BFFB3"]},
          {"name": "Red 1+2", "stops": ["#E58C9C", "#FF4768"]},
          {"name": "Red 2+3", "stops": ["#FF4768", "#FFF647"]},
          {"name": "Red 3+1", "stops": ["#FFF647", "#E58C9C"]}
        ],
        "decorative_shapes": "gradient ovals with 'Layer Blur 150'",
        "claimed_as_mark": false
      },
      "typography": [{"family": "Switzer", "licence": "Fontshare (licence not read)"}, {"family": "Helvetica Neue", "use": "Google Workspace substitute"}],
      "clear_space": {"rule": "drawn only (clusters of starburst dots at the corners)", "min_size": {"logotype_px": 40, "dimension": "height (as drawn)"}},
      "approval_required": {"descriptive_text": false, "logo": true, "contact": "legal@cardanofoundation.org"},
      "approval_evidence": null,
      "checker": {
        "tell1_exemption": "none in the project UI; these gradients and blurred shapes are the organisation's trade dress",
        "flag": ["#0084FF->#BFA8FF or other CF gradient pairs used as page decoration", "blurred gradient blobs"]
      },
      "notes": [
        "Relevant only to recognise CF material; a Cardano-track project refers to the protocol, not to the Foundation.",
        "The ZIP's four SVGs (CF logotype black and white, Cardano icon black and white) are flat; the two icons are byte-identical to cardano.org's starburst black and white files (verified 2026-10-01)."
      ],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "input-output",
      "display_name": "Input Output (IOG, formerly IOHK)",
      "events": [],
      "kit_url": null,
      "policy_urls": ["https://www.iog.io/terms-and-conditions"],
      "allowed_phrases": [{"text": "Input Output", "basis": "derived: naming the company in text when necessary"}],
      "forbidden_phrases": [{"regex": "\\b(IOG|IOHK|Input Output)[- ](approved|endorsed|partner|certified)\\b", "flags": "i", "basis": "derived: terms reserve name and logos"}],
      "logo_default": "text_only",
      "logo_sources": [],
      "colours": {"core": [], "gradients": [], "claimed_as_mark": false},
      "clear_space": null,
      "approval_required": {"descriptive_text": false, "logo": true, "contact": "not published"},
      "approval_evidence": null,
      "notes": ["No press or brand kit found: www.iog.io/press, /brand, /media-kit, /press-kit return 404 on 2026-10-01."],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "chainlink",
      "display_name": "Chainlink (marks per the Chainlink Foundation Terms of Service v6.0)",
      "events": ["token2049-origins:chainlink-best-workflow-with-cre (fallback)"],
      "kit_url": "https://chain.link/brand-assets",
      "policy_urls": ["https://chain.link/terms#trademark", "https://vault.pactsafe.io/s/e8308c3d-97af-4f76-8e65-6072d90342ea/legal.html"],
      "allowed_phrases": [
        {"text": "uses the Chainlink Runtime Environment (CRE)", "basis": "derived: descriptive use 'only when necessary' and Terms §3 'accurate descriptive term'; product name as written on chain.link"},
        {"text": "CRE workflow simulated with the CRE CLI", "basis": "derived: the track's own wording ('Demonstrate a successful simulation (via the CRE CLI)')"}
      ],
      "forbidden_phrases": [
        {"regex": "\\b(Powered|Secured)\\s+(by|with)\\s+Chainlink\\b", "flags": "i", "basis": "derived (conservative): former badge names. The 2022 'Powered by' and 'Secured by' badges were free downloads; 'Secured With Chainlink' was an approval-only badge until at least 2026-07-22; no badge page exists on 2026-10-01 (F10). Terms §3 allow 'an accurate descriptive term', so replace with a plain descriptive sentence (corrected at verification)."},
        {"regex": "\\bChainlink[- ](partner|partnership|approved|endorsed|certified)\\b", "flags": "i", "basis": "Trademark Guidelines: implied affiliation or endorsement"},
        {"regex": "\\bofficial\\b.{0,20}\\bChainlink\\b", "flags": "i", "basis": "same"}
      ],
      "logo_default": "text_only",
      "logo_conditions_if_approved": [
        "unaltered official file",
        "never animated or morphed",
        "never the visual focal point of a page or slide",
        "not placed on top of other objects; generous margin (no number published)"
      ],
      "logo_sources": [
        {"variant": "logo-blue", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef794684220a0f5a14a_Chainlink-Logo-Blue.svg", "format": "svg", "sha256": "61f41cd0554a5cf1dd3518e9d20fb6594045083ae05b9053a6c7b13ab2de5022"},
        {"variant": "logo-white", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef7d50e112425683256_Chainlink-Logo-White.svg", "format": "svg", "sha256": "e3fe5876a2352e8f7131a11c99dbe8b456334411e930e920b82647be90a65f00"},
        {"variant": "logo-black", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef75ebf01293ddc6b0e_Chainlink-Logo-Black.svg", "format": "svg", "sha256": "75159a9d11d721191fa9c0894ca660d037e3e317dd0446cd7c491c565c105769"},
        {"variant": "symbol-blue", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef7f56d1f1d953c589d_Chainlink-Symbol-Blue.svg", "format": "svg", "sha256": "baf12d3c3c62a86c7ae649f5126d8055141d0927954fa355292c18f4a8e0f12e"},
        {"variant": "symbol-white", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef7a31aed5b1bf78dd7_Chainlink-Symbol-White.svg", "format": "svg", "sha256": "1e3545577c2aee8f1fbde72181a47b71b9fb70a12b5254efd8bae60549948b2b"},
        {"variant": "symbol-black", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6aa7fef9544e069b62b31acd_Chainlink-Symbol-Black.svg", "format": "svg", "sha256": "1928411ba63045ad971cd13a72c3d884c2f208275c7db1d083aa9aa9d200191b"},
        {"variant": "zip", "url": "https://cdn.prod.website-files.com/5f6b7190899f41fb70882d08/6a9849f95bf2c3b1c26d7353_Chainlink-Logo.zip", "format": "zip", "sha256": "bac18b6c8dcd5b4b088b491a13f769195cb22783f104a2eaa02050bd92d0ee80"}
      ],
      "colours": {
        "core": [
          {"name": "Chainlink Blue", "hex": "#0847F7"},
          {"name": "Dark", "hex": "#0E1119"},
          {"name": "Light Blue", "hex": "#DCEBFF"},
          {"name": "Light Gray", "hex": "#F5F7FA"}
        ],
        "gradients": [],
        "claimed_as_mark": false,
        "superseded": [{"name": "Chainlink Blue (2023 kit)", "hex": "#375BD2"}]
      },
      "typography": [{"family": "TASA Orbiter", "licence": "OFL-1.1"}, {"family": "Inter", "licence": "OFL", "note": "Chainlink's suggested replacement"}],
      "clear_space": {"rule": "do not place on top of other objects; leave a reasonable amount of margin", "min_size": null},
      "approval_required": {"descriptive_text": false, "logo": true, "contact": "legal@chain.link"},
      "approval_evidence": null,
      "checker": {
        "tell1_exemption": "none needed: official files are flat",
        "flag": ["any animation, transform or filter on a Chainlink logo element", "Chainlink logo as the largest element in a viewport or slide"]
      },
      "notes": ["Page meta description still mentions badges; the body has none and chain.link/badge is 404. The approval-only enrolment page was still captured live by the Wayback Machine on 2026-07-22 (corrected at verification)."],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "ledger",
      "display_name": "Ledger (Ledger SAS)",
      "events": ["ledger-op3n-2026"],
      "kit_url": "https://www.ledger.com/press",
      "policy_urls": ["https://shop.ledger.com/pages/website-terms-of-use", "https://brand.ledger.com/"],
      "allowed_phrases": [
        {"text": "Ledger Wallet", "basis": "listed trademark; current app name"},
        {"text": "Ledger signer", "basis": "listed vocabulary (developer portal renaming)"},
        {"text": "Connect a Ledger signer", "basis": "derived: nominative use in a control label"},
        {"text": "Ledger Nano S Plus / Ledger Nano X / Ledger Flex / Ledger Stax", "basis": "listed trademarks and press-kit product names"},
        {"text": "Clear Signing", "basis": "listed Ledger feature name (developer portal)"}
      ],
      "forbidden_phrases": [
        {"regex": "\\bLedger Live\\b", "flags": "", "basis": "renamed to Ledger Wallet (advisory)", "severity": "advisory"},
        {"regex": "\\bhardware wallets?\\b", "flags": "i", "basis": "renamed to signer (advisory)", "severity": "advisory"},
        {"regex": "\\b(Ledger[- ](approved|endorsed|certified|partner)|(approved|endorsed|certified|vetted) by Ledger)\\b", "flags": "i", "basis": "terms; a technical review 'does not constitute a vetting or endorsement'"},
        {"regex": "Free from compromise|Now you[’']re in control|This is what security feels like", "flags": "i", "basis": "Ledger house taglines"}
      ],
      "naming_blocklist": ["LEDGER"],
      "logo_default": "text_only",
      "logo_exceptions": ["UI rendered by the official Ledger Wallet Provider SDK (partner programme API key required)"],
      "logo_sources": [
        {"variant": "press kit zip (Oct 2025)", "url": "https://downloads.ctfassets.net/ge894kijjvls/5h5wCwz5ttJ0G1t7MT4rDX/902db9a4f79412a45e64993c3f061ee0/Ledger_Press_kit_october_2025.zip", "format": "zip", "sha256": null},
        {"variant": "wordmark-black (in zip: Logos/Ledger/LEDGER-WORDMARK-BLACK-RGB.svg)", "url": null, "format": "svg", "sha256": "d34dd4e99d45dcda63c6c8b8e58d0fdeb8caba441f9510e21bb046d98d2c7eb4"},
        {"variant": "single-character (in zip: Logos/Ledger/LEDGER-WORDMARK-SINGLE-CHARACTER-BLACK-CMYK-01.svg)", "url": null, "format": "svg", "sha256": "ff2408c70d73cd6d1ba3fd91d82d78f4f0fc6a15261678c68701d72b90d407fc"},
        {"variant": "logo-white (in zip: Logos/Ledger/White -Ledger logo.svg)", "url": null, "format": "svg", "sha256": "a1cb851d669f679e7a05198ee181a542d648a0e835fce05b7b2026640a0252cb"}
      ],
      "colours": {
        "core": [
          {"name": "White 0", "hex": "#FFFFFF"},
          {"name": "Black 950", "hex": "#000000", "note": "brand book (Mar 2025) prints #0A0A0A"},
          {"name": "Serenity Purple", "hex": "#D4A0FF", "pantone": "2572"},
          {"name": "Safety Orange", "hex": "#FF5300", "pantone": "Orange 021"},
          {"name": "Success Green", "hex": "#6EC85C", "pantone": "7479 C"},
          {"name": "Error Red", "hex": "#E40046", "pantone": "192 C"}
        ],
        "ratio_rule": "80% black and white",
        "gradients": [{"name": "purple and liquid-purple backgrounds (brand Drive)", "stops": "raster assets, not specified"}],
        "claimed_as_mark": false
      },
      "typography": [
        {"family": "Brut Grotesque", "licence": "proprietary: Bureau Brut licence v1.2, 'personal and non-transferable to third parties'; giving or distributing the font file is not allowed (read at verification)"},
        {"family": "HM Alpha Mono", "licence": "proprietary (not read)"},
        {"family": "Ledger Mono", "licence": "Ledger; 'For use in printing only'"}
      ],
      "clear_space": null,
      "approval_required": {"descriptive_text": false, "logo": true, "contact": "OP3N organisers (Ledger N3XT team); press contact on ledger.com/press"},
      "approval_evidence": null,
      "checker": {
        "tell1_exemption": "only inside the official SDK's UI subtree or an allowlisted file",
        "flag": ["'[ ]' bracket framing of the project name (Ledger iconography)", "purple glow on black backgrounds imitating Ledger creative"]
      },
      "notes": ["Ledger's ETHGlobal prize text: 'Concrete use of Ledger primitives, not just wallet branding.' Ledger's XRPL hackathon page: 'we want Ledger used as a real trust layer, not just wallet branding'."],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "bnb-chain",
      "display_name": "BNB Chain",
      "events": ["bnb-hack-tokenized-stocks-2026"],
      "kit_url": "https://www.bnbchain.org/en/brand-guidelines",
      "policy_urls": ["https://www.bnbchain.org/en/brand-guidelines"],
      "allowed_phrases": [
        {"text": "Powered by BNB Chain", "basis": "listed"},
        {"text": "Available on BNB Chain", "basis": "listed"},
        {"text": "Building on BNB Chain", "basis": "listed"}
      ],
      "unlisted_avoid": ["Built on BNB Chain"],
      "forbidden_phrases": [
        {"regex": "\\b(Official|Partnering|Partnered|Partner|Collaborating|Collaboration)\\b.{0,25}\\bBNB Chain\\b", "flags": "i", "basis": "listed: 'Official', 'Partnering', 'Collaborating' need management clearance"},
        {"regex": "\\bBNB Chain\\b.{0,25}\\b(official|partner|endorsed|sponsored)\\b", "flags": "i", "basis": "no implied endorsement or sponsorship"}
      ],
      "social_rule": "tag BNB Chain's handle on socials",
      "logo_default": "text_only_until_approved",
      "logo_conditions_if_approved": [
        "yellow logo wherever possible; mono only when yellow gives low contrast",
        "horizontal lockup left-aligned, never right; vertical lockup centred",
        "logomark alone only for buttons, profile picture, the BNB token or an icon",
        "no outline, shadow, gradient, recolouring, stretching, busy or low-contrast background"
      ],
      "logo_sources": [
        {"variant": "zip (Sep 2026)", "url": "https://static.bnbchain.org/home-ui/static/images/brand-guidelines/BNBChain-Logo.zip", "format": "zip", "sha256": "dca3fb9a6579e04b996dbae71b6e84be3efaf48145692af5a3df6d01fded5db8"},
        {"variant": "logo-yellow (in zip: SVG/BNB Chain_Logo_Yellow.svg)", "url": null, "format": "svg", "sha256": "69c4390202dca23410fea6bb4c2b6b946429fdc06f2e73ffe8085e1dc6bc7746"},
        {"variant": "logo-black (in zip)", "url": null, "format": "svg", "sha256": "3f236a5a0259af5095e97c2b880459c39abc5b39dc4153c03415ba19f4659297"},
        {"variant": "logo-white (in zip)", "url": null, "format": "svg", "sha256": "fa31d4ed5d277e3d2836d20aa526f897c4a1dfeeb95614cbd0dcbf8f3ac795e8"},
        {"variant": "stacked-yellow (in zip)", "url": null, "format": "svg", "sha256": "c4ce3e5280ad7f193641dae27898ed4a99ac619355b045546f0bae9ee53c2815"},
        {"variant": "stacked-black (in zip)", "url": null, "format": "svg", "sha256": "3e9db5d49583ceff98a2f075e48e534249784cd18159adaf8654b843dfe8a5f6"},
        {"variant": "stacked-white (in zip)", "url": null, "format": "svg", "sha256": "e82f9f01cc8dcd9015abe2b238599cad35599224ff675cc5f08f876c6cc750eb"},
        {"variant": "symbol-yellow (in zip)", "url": null, "format": "svg", "sha256": "b8ff1ce0b5af2e2d9bcf5ec89fedd5224079f4f7267e306e23e8d691024f5eff"},
        {"variant": "symbol-black (in zip)", "url": null, "format": "svg", "sha256": "95621a88c55cadaff217977c9929f9443894bf56a8d8d195165cf25c2dc9e536"},
        {"variant": "symbol-white (in zip)", "url": null, "format": "svg", "sha256": "e2790497ff60f117c2956b186d26c2acb6fba4fbe6e89e3dd91327e8247ece2b"}
      ],
      "colours": {
        "core": [
          {"name": "Yellow", "hex": "#F0B90B", "pantone": "116C", "note": "page CMYK (C0 M100 Y26 K0) does not match; use hex"},
          {"name": "Dark", "hex": "#0B0E11"},
          {"name": "White", "hex": "#FFFFFF"}
        ],
        "gradients": [],
        "claimed_as_mark": false
      },
      "clear_space": {
        "rule": "safe space X around the logo; X = height of the logomark",
        "min_size": {"vertical_lockup_width_px": 70, "horizontal_lockup_width_px": 97, "logomark_width_px": 15}
      },
      "approval_required": {"descriptive_text": false, "logo": true, "procedure": "send the proposed use and how it will be distributed", "contact": "BNB Chain PR (via the hackathon organisers)"},
      "approval_evidence": null,
      "checker": {"tell1_exemption": "none needed: official files are flat", "flag": ["BNB logo narrower than its minimum", "horizontal lockup right-aligned", "logomark used alone outside the four listed scenarios"]},
      "notes": ["The holdover board's own #F0B90B accent is outside this page's scope (the page regulates the logo)."],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "solana",
      "display_name": "Solana (Solana Foundation)",
      "events": ["token2049-origins:solana-best-use-of-solana"],
      "kit_url": "https://solana.com/branding",
      "policy_urls": ["https://docs.google.com/document/d/1gOjdCVI2tp-hpCJciSNZAR93cxgw_gh2/edit?usp=sharing"],
      "allowed_phrases": [
        {"text": "Program deployed on Solana Devnet", "basis": "derived: factual statement; the track asks for 'Program ID and cluster (Devnet or Mainnet Beta)'"}
      ],
      "forbidden_phrases": [
        {"regex": "\\b(Official|Certified)\\s+Solana\\b", "flags": "i", "basis": "no suggestion of sponsorship or endorsement"},
        {"regex": "\\bSolana[- ](approved|endorsed|partner)\\b", "flags": "i", "basis": "same"}
      ],
      "naming_blocklist": ["SOLANA", "SOL", "ACCELERATE", "BREAKPOINT"],
      "naming_rule": "No Solana Mark combined with the project's name, logo, product name or a generic term without explicit written permission.",
      "logo_default": "official_file_unaltered_allowed",
      "logo_default_basis": "inferred, not granted: the brand page offers the files for use on 'websites' and the Guidelines set no approval step for an unaltered file; the Guidelines' ban on use that 'Is descriptive of any products or services' could be read against it (added at verification)",
      "logo_conditions": [
        "unaltered official file; prefer the official White or Black logomark to keep the gradient off the page",
        "never locked up or combined with the project's name or logo",
        "no shadow, outline, stretch, low resolution, use as an image frame, or low-contrast ground",
        "no rotation, skew or recolouring"
      ],
      "logo_sources": [
        {"variant": "logotype-color", "url": "https://solana.com/src/img/branding/solanaLogo.svg", "format": "svg", "sha256": "ccdc416707911112da5933a6ed9f60ce1f819333e70447a5701bc012d6865f51"},
        {"variant": "logomark-color", "url": "https://solana.com/src/img/branding/solanaLogoMark.svg", "format": "svg", "sha256": "3d3401109aa061dec40a8659f1847817a8e647f98de1e65e76e86a95bbe1f08a"},
        {"variant": "wordmark", "url": "https://solana.com/src/img/branding/solanaWordMark.svg", "format": "svg", "sha256": "e785361bfb1f7d08921b8599173016481ac2042a468d5db1f604aaf00c5f3a3c"},
        {"variant": "vertical-lockup-color", "url": "https://solana.com/src/img/branding/solanaVerticalLogo.svg", "format": "svg", "sha256": "29923dcd00ff8c738ff14882eccc6d63806988acd4c53a82b1ee00bbd668860c"},
        {"variant": "logomark black/white and logotype sizes 18-96", "url": "https://drive.google.com/drive/u/1/folders/1Y882o7uxW4Bx2vL6MXI-IozbGTX3ztBk", "format": "svg/png", "sha256": null}
      ],
      "colours": {
        "core": [
          {"name": "solana purple", "hex": "#9945FF"},
          {"name": "solana green", "hex": "#14F195"}
        ],
        "gradients": [
          {"name": "logo gradient (official SVGs)", "stops": [[0.08, "#9945FF"], [0.3, "#8752F3"], [0.5, "#5497D5"], [0.6, "#43B4CA"], [0.72, "#28E0B9"], [0.97, "#19FB9B"]], "direction": "bottom-left to top-right, about 41 degrees from vertical in file user space"}
        ],
        "claimed_as_mark": true
      },
      "typography": [{"family": "ABC Diatype / ABC Diatype Semi-Mono", "licence": "Dinamo EULA 2.51 (non-transferable, no sharing with third parties); the holder of the kit's copy is not published; not usable by the team (corrected at verification)"}],
      "clear_space": {"rule": "diagram only: unit X drawn as wide as the logomark for the lockup; corners labelled 'X=2' for the standalone logomark", "min_size": null},
      "approval_required": {"descriptive_text": false, "official_logo_standalone_unaltered": false, "lockup_or_combination_with_project_mark": true, "contact": "operations@solana.foundation; press@solana.org"},
      "approval_evidence": null,
      "checker": {
        "tell1_exemption": "only for an allowlisted file (hash match) or that file's own unmodified linearGradient",
        "waiver_policy": "refuse tier-2 waivers for Solana gradients as page decoration (colours and look and feel claimed as marks)"
      },
      "notes": ["The logo's end stop (#19FB9B) differs from the page's 'solana green' (#14F195)."],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "token2049",
      "display_name": "TOKEN2049 (organiser, BOB Group Limited)",
      "events": ["token2049-origins"],
      "kit_url": "https://www.token2049.com/dubai/brand-kit",
      "policy_urls": ["https://www.token2049.com/terms-conditions"],
      "allowed_phrases": [
        {"text": "TOKEN2049 Origins Hackathon", "basis": "listed: the organiser's event name on BuilderBase"},
        {"text": "built at the TOKEN2049 Origins Hackathon, Singapore, 6-8 October 2026", "basis": "derived: Dubai kit's name-plus-place-plus-dates pattern"}
      ],
      "forbidden_phrases": [
        {"regex": "\\bToken\\s?2049\\b|\\bTOKEN\\s2049\\b", "flags": "", "basis": "'TOKEN2049 must always be capitalised, without space'"},
        {"regex": "\\bofficial\\b.{0,20}\\bTOKEN2049\\b", "flags": "i", "basis": "use only as expressly authorised"}
      ],
      "logo_default": "text_only",
      "logo_sources": [],
      "colours": {"core": [], "gradients": [], "claimed_as_mark": false, "observed_not_published": "BuilderBase track CSS comment lists tokens 'lifted from token2049.com' (#11151f page, #0776fe accent); do not adopt"},
      "clear_space": null,
      "approval_required": {"descriptive_text": false, "logo": true, "wordmark": true, "basis": "wordmark: listed ('prior approval'); logo: derived (no Singapore kit; the Dubai kit's logos are for Dubai, and its terms allow site material 'only as expressly authorised')", "contact": "Origins organisers (acceptance mail or BuilderBase messaging)"},
      "approval_evidence": null,
      "notes": [
        "No Singapore or Origins kit: /singapore/brand-kit and /brand-kit are 404; the Dubai 2027 kit says the logo is always used with the event location and the glyph never alone.",
        "The Dubai Primary 2027 ZIP also ships a location-free 'Primary Logo' set showing TOKEN2049 alone; the kit's own rule still pairs the logo with the event location (added at verification)."
      ],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "dvb",
      "display_name": "DeVinci Blockchain (DVB)",
      "events": ["token2049-origins", "ledger-op3n-2026"],
      "kit_url": null,
      "policy_urls": ["https://devinciblockchain.com/terms"],
      "allowed_phrases": [{"text": "DeVinci Blockchain (DVB)", "basis": "listed: ESILV's spelling; the association writes 'DeVinci Blockchain' (alternateName 'DVB'), 'DeVinci Blockchain - DVB' and 'DeVinci Blockchain Association' (corrected at verification)"}],
      "forbidden_phrases": [],
      "logo_default": "text_only_until_board_approval",
      "logo_sources": [],
      "colours": {"core": [], "gradients": [], "claimed_as_mark": false},
      "clear_space": null,
      "approval_required": {"descriptive_text": false, "logo": true, "contact": "DVB board (the owner is a member)"},
      "approval_evidence": null,
      "notes": ["Site terms (January 2025): logos are the association's property; express written permission required."],
      "accessed": "2026-10-01"
    },
    {
      "sponsor": "masumi",
      "display_name": "Masumi (agent payment and identity network; 'Sumi' brand family with Kodosumi and Sokosumi)",
      "events": ["token2049-origins:cardano-agentic-commerce (named in the judging criteria)"],
      "kit_url": "https://www.masumi.network/press",
      "policy_urls": [],
      "allowed_phrases": [{"text": "settles agent payments through Masumi", "basis": "derived: descriptive use in text; no published phrase list"}],
      "forbidden_phrases": [{"regex": "\\bMasumi[- ](partner|partnership|approved|endorsed|certified)\\b", "flags": "i", "basis": "derived: no published grant; avoid implied affiliation"}],
      "logo_default": "text_only",
      "logo_sources": [
        {"variant": "press kit Drive folder (Logos/Masumi, Kodosumi, Sokosumi; Brand Guidelines PDF)", "url": "https://drive.google.com/drive/u/1/folders/1WbjV0HBr9ztn1C5Zyc7_xeuya3az3FEY", "format": "folder", "sha256": null}
      ],
      "colours": {
        "core": [],
        "described": "masumi: pink to red and yellow tones; kodosumi: lime, green and blue; sokosumi: deep purple; shared neutral greys with black and white as primary colours (text layer only, no hex values)",
        "gradients": [{"name": "dynamic gradients and 'ink' visuals", "stops": "raster visuals, not specified"}],
        "claimed_as_mark": false
      },
      "typography": [{"family": "Inter", "licence": "OFL (google/fonts ofl/inter)"}],
      "clear_space": {"rule": "two drawn clearspaces, below and above 30 px height (not read as numbers)", "min_size": {"wordmark_px": 14, "lockup_with_kanji_height_px": 30, "wordmark_print_mm": 12, "lockup_print_mm": 24}},
      "approval_required": {"descriptive_text": false, "logo": "unknown: no grant or restriction published", "contact": "info@masumi.network (press inquiries)"},
      "approval_evidence": null,
      "checker": {"tell1_exemption": "none: gradients and ink visuals are Masumi's decoration", "flag": ["Masumi logo locked up with the project mark", "Masumi wordmark smaller than 14 px"]},
      "notes": ["Added at verification (F26). The brand book is written for Masumi's own designers; its partnership lockups describe co-branding Masumi makes itself, not a licence."],
      "accessed": "2026-10-01"
    }
  ]
}
```

### 2. How the gates use it (design proposal, derived from the findings)

| Gate | Rule | Source |
|---|---|---|
| ip / logos | Every third-party image or inline SVG in the rendered page, deck or video frames must match a `logo_sources[].sha256` whose sponsor has `logo_default` equal to `official_file_unaltered_allowed`, or has a non-null `approval_evidence`. Everything else fails. | F02, F03, F09, F13, F16, F20, F21, F22, F24, F26 |
| ip / treatment | A matched logo fails if any ancestor applies `transform` other than scale with a preserved ratio, `filter`, `mix-blend-mode`, animations or transitions (from `getAnimations()`), or if its box is smaller than `clear_space.min_size`. | F02, F09, F12, F20 |
| ip / lockup | A sponsor logo whose box sits within one clear-space unit of the project mark counts as a lockup and fails for Cardano, Solana and Chainlink. | F04, F13, F09 |
| ip / focal | In any viewport or slide, a sponsor logo must not be the largest visual element (Chainlink rule, applied to all sponsors). | F09 |
| copy | Run `forbidden_phrases` regexes on rendered text. Suggest an `allowed_phrases` replacement. Severity follows the entry; advisory entries never block. | F05, F09, F10, F18, F20, F21 |
| notice | If a Cardano logo is rendered, the page or slide must contain `trademark_notice`. | F05 |
| tells / tell 1 | A gradient finding is exempt only if its element is a hash-matched sponsor file, or that file's unmodified `<linearGradient>`, or a subtree rendered by an allowlisted SDK. Tier-2 waivers citing a sponsor are refused when `claimed_as_mark` is true. | F14, F24, F13, F19 |
| fonts | A font file whose provenance is a sponsor kit fails unless an OFL, Apache, UFL or MIT licence file ships with it. | F15 |
| naming | The project name, product name, domain and handles must not contain any `naming_blocklist` entry as a token or a leading or trailing part of a compound (so "Cardanex" and "AdaPay" match, but "Canada" does not), nor a near variant (edit distance of 2 or less, or a phonetic match). A hit goes to the owner for a decision, because short entries such as ADA and SOL produce false positives, and because Cardano's own forum guidance accepts creative names such as "Cardanitos.com" for websites and stake pools (F04, added at verification). | F04, F13 |

## Contradictions between sources

1. **Cardano ™ versus ®.** The policy (Updated 06.03.24) prescribes ™ notices and says "a ™ should not be changed to an ® in a trademark notice by anyone other than the owner". The Foundation's forum guidance (2021, edited 2022) says "add the registered trademark symbol (®) at the top right corner of the logo". cardano.org's own footer shows "® Cardano", and a US registration exists (F25). This dossier follows the newer policy and never edits the logo file.
2. **Cardano: automatic permission versus "prior permission".** §3.1 lists the standalone unaltered logo among the cases where "Explicit permission to use the Mark is not required". Its own example reads "Putting the Cardano Logo on your product packaging after you have and obtained our prior permission to do so". §3 opens with "Written permission from Cardano Foundation is required to use the Marks as part of your project or associated assets."
3. **Relative size of sponsor and project marks.** cardano.org says the Cardano logo "should be displayed at an equal or larger size" next to a partner logo. The policy's event rule (3.2.3, for events using the Marks) wants the organiser's own name to "feature more prominently". Chainlink forbids its marks being "the visual focal point". Masumi's book asks for partner logos to be "optically sized" rather than matched (F26). These are reconcilable only by never placing the marks side by side, which is this dossier's rule.
4. **Cardano's possessive rule versus practice.** The policy forbids "Cardano’s". The Foundation's developer-portal blog writes "Cardano’s native token", and the organiser's Cardano track page asks about "Cardano's unique features".
5. **Minimum sizes of the "same" starburst.** cardano.org gives 64 px (web) for the Cardano logo. The Cardano Foundation's 2024 guidelines give "min. 40px" for the CF logotype. These are different marks, so the checker must key sizes by file, not by sponsor.
6. **Chainlink: general referential licence versus consent.** Terms §3: "You may generally use the Foundation’s name and logo to refer to the Foundation’s mission and activities…", and "You may also indicate the relationship of your products and services to the Foundation’s mission and activities by using an accurate descriptive term" (added at verification). Trademark Guidelines: avoid "Using the Chainlink logo … except as expressly permitted under these Guidelines or with the Foundation’s prior written consent." Separately, the Terms name the Chainlink Foundation as owner, while the US record for CHAINLINK (USPTO TSDR) names SmartContract Chainlink Limited SEZC (F25).
7. **Chainlink page metadata versus content.** `<meta name="description">` says "logo, colors, badges, and fonts". The body has no badges, and /badge is 404, although the Wayback Machine still captured the approval-only enrolment page on 2026-07-22 (F10).
8. **Ledger: prohibition versus invitation versus tutorial.** Website terms: "you agree not to reproduce, represent, extract and use in any way any or all of Ledger's trademarks, logos". The press page invites anyone who shows "any Ledger visual on your website" to update to the new assets. The developer tutorial puts the Ledger logo on a connect button (F16, F19).
9. **Solana: literal guideline text versus ordinary use.** The guidelines forbid use that "changes the scale of" a Mark or "Is descriptive of any products or services, or is used as a noun". The Solana track page (live on 2026-10-01) says "Build a program that interacts with the Solana blockchain." and "Build on Solana's high-performance blockchain", using the name as a noun and a possessive. The brand page itself offers the files for use on websites, which implies resizing. The brand page's green is #14F195, while the logo files end at #19FB9B.
10. **Ledger colour values.** The brand site lists "Black 950" as #000000 and both purple and orange as "Primary". The March 2025 brand book prints Black 950 as #0A0A0A and orange as "Secondary", and gives White as "RGB 225 225 225" against #FFFFFF.
11. **BNB colour notation.** The page's CMYK for the yellow (C0 M100 Y26 K0) describes a magenta-red, not #F0B90B. The "can add the BNB Chain logo" versus "should seek approval" conflict (FD09) still stands.
12. **TOKEN2049 capitalisation.** The rule says "TOKEN2049 must always be capitalised, without space". The site's own navigation reads "Token2049 global", and some kit file names read "Token2049 Dubai Primary".
13. **Ledger press page versus press kit.** The page promises "brand guidelines" in the download. The October 2025 ZIP holds logos, product shots and "About Ledger" only.
14. **Cardano names: rule versus carve-out versus forum practice** (added at verification). §2.2.8 forbids the Marks "as part of your own … domain name, company name, trade name, product name or service name". §3.1 grants automatic permission for the Marks "in a domain name, title of website, seminar, software package, book, magazine or video that is exclusively intended to support the Cardano Code and Project". §3.3 always requires approval for "a domain name". The 2021 forum guidance lists "Cardanitos.com", "Adaforpresident.com" and "Cardanoist" as acceptable creative names. This dossier keeps the mark out of hackathon product names and sends every hit to the owner.
15. **TOKEN2049 location rule versus kit contents** (added at verification). The Dubai kit says "The TOKEN2049 logo should always be used in combination with the event location", yet its Primary 2027 ZIP ships a location-free "Primary Logo" set.

## What could not be found, and how it was searched

- **An Input Output (IOG) brand or press kit.** Probed www.iog.io/press, /brand, /media-kit and /press-kit, and iohk.io/en/press(-kit) (all 404), plus the newsroom page (no kit link). The WebSearch "Input Output IOG press kit brand assets logo usage" found none.
- **A "Built on Cardano" badge or an official phrase list for Cardano.** WebSearch for "Built on Cardano" OR "Made on Cardano" badge found none. `gh search code "Built on Cardano" --owner cardano-foundation` returned descriptive uses in developer-portal blog posts and templates, cardano.org navigation copy, and an app-directory entry for a third-party site titled "Built on Cardano" (builtoncardano.com); none is a badge. (corrected at verification: the draft said "only descriptive uses in blog posts and templates")
- **A current Chainlink badge.** chain.link/badge is 404 and the brand page has no badge section. The chain.link sitemap (1,332 URLs) lists no badge page, and /badges, /secured-with-chainlink and /badge-enrollment are 404. A Wayback CDX query for chain.link/badge from 2024 onwards lists 25 captures with status 200 from 2024-03-13 to 2026-07-22. The 2024-09-14 and 2026-07-22 captures were read and show the approval-only enrolment page. (corrected at verification: the draft said the captures ran only to 2024-09-14.) go.chain.link/archives/brand-assets redirects to chain.link.
- **A "Works with Ledger" or similar programme for third-party apps or hackathon projects.** WebSearch "Works with Ledger" program badge found none. A grep of `developers.ledger.com/llms-full.txt` (1.42 MB) for `badge|works with ledger|ledger compatible|certified by ledger|ledger certified` found only UI-component badges. Ledger's co-branded partnership is for co-branded devices and was not researched.
- **Ledger clear space and minimum size.** They are absent from the brand.ledger.com pages read (overview, logo, colour, taglines, about) and from the 22-page brand book; a grep of those texts for clear space, safe space, minimum, third party, partner, permission and usage found only an unrelated "third-party" service mention.
- **Ledger OP3N hackathon terms.** Not published per the owner's rubric (22 Sept). A WebSearch "Ledger OP3N hackathon 2026 students rules" returned only the N3XT research-competition terms. An Exa search at verification (2026-10-01) found the same terms, Ledger's "Save The Date: Ledger Op3n 2026" post (Op3n on 15 October in Paris) and the Ledger × XRPL hackathon page, but no OP3N hackathon rules.
- **A Solana badge ("Powered by Solana", "Built on Solana").** WebSearch found none.
- **A TOKEN2049 Singapore or Origins brand kit.** `token2049.com/singapore/brand-kit` and `/brand-kit` are 404. The Wayback CDX API lists no capture of either, and a grep of the Origins page and the four BuilderBase track JSONs for brand, logo and trademark found none.
- **TOKEN2049 colours.** The Dubai kit page publishes none in text. Only BuilderBase's page CSS was observed.
- **A DVB brand kit.** Searched with WebSearch and Exa. Found the association's site (via ESILV), its terms, and a GitHub organisation with 0 public repositories.
- **Masumi's brand guidelines** (the standard the Cardano track builds on). Found in the Drive folder linked from Masumi's press page as "2503-Agentic-Brand Guidelines.pdf", 59,424,996 bytes. It was not read in the research pass because it would exceed the scratch quota. It was read at verification by streaming it into memory (F26).
- **Binance brand rules** (Binance Web3 Wallet co-funds the BNB Hack). Not researched; out of the brief's list.
- **Hedera** (its purple-to-blue gradient is cited in ARCHITECTURE §3). Out of this brief's list.

## Weak spots of this dossier

- **Not legal advice.** Where a rule is ambiguous, the dossier takes the most conservative reading, and it says so each time. That choice belongs to me, not to the sponsors.
- **Several "allowed" phrases are derived, not listed.** Each carries `basis: derived` in the JSON. Only BNB publishes a phrase list, and Cardano publishes examples.
- **Diagrams were read by eye.** The Cardano "six dots" rule and the Solana and Cardano Foundation clear spaces are drawings, and my X interpretations may be wrong.
- **Drive contents were read through `embeddedfolderview` listings.** File names and dates are Drive's metadata. Only the files named in the findings were opened: the Solana .docx, Ledger's brand book, the Bureau Brut licence and two backgrounds, the Cardano Foundation's ZIP and Masumi's brand book.
- **Large files were deleted after reading** to respect the scratch quota: the Cardano Foundation ZIP and PDF, and Ledger's brand book. Their SHA-256 values are recorded, but re-verification needs a new download.
- **Only US trademark records were read** (F25, USPTO TSDR at verification); Swiss, EU and Singapore registers were not queried.
- **Pages change fast.** Chainlink went from free badges (2022) to an approval-only badge (from at least 2024 until at least July 2026) to none (October 2026), and changed its blue from #375bd2 to #0847F7. The allowlist's hashes will drift, so re-run the fetch before each event (6, 11 and 13 October).
- **Access dates.** The session ran from late 30 September to early 1 October, Paris time. All sources are dated 2026-10-01 as the brief requires, although some fetches happened minutes before midnight UTC+2.
- **Event-specific permission is unknown.** No answer from the Origins organisers to the owner's question 1 (naming parties on a slide) was found in the owner's research files. No sponsor has been asked about logo use.

## Verification notes

**Method.** Every cited source was re-opened on 2026-10-01, independently of the researcher's saved copies, into a separate `verify/` scratch folder. Quotes were matched with a script that tries an exact match first, then one with whitespace and quote characters normalised. Pages behind bot checks or rendered by JavaScript were read with headless Chromium (Playwright 1.58): the Cardano Foundation policy and brand pages, and brand.ledger.com. GitHub facts came from `gh api`. Remote ZIPs were listed from their central directories with HTTP range requests (the TOKEN2049 and Ledger kits). The Cardano, Chainlink, BNB, Solana and Cardano Foundation files were downloaded in full and the three Ledger SVGs extracted by range request. All were re-hashed, and all 35 non-null SHA-256 values in the Deliverable matched. The gradient stops and angles, the JPEG samples, the clipPath fills and the ZIP dates were recomputed. The Wayback Machine was queried through the CDX API and raw `id_` captures. Justia was replaced as the evidence base for F25 by the USPTO's own TSDR status view.

**Outcome.** 12 findings verified as written (F01, F06, F07, F08, F11, F13, F14, F17, F18, F20, F23, F24). Some carry verification notes or added supporting evidence that does not change their claims. 13 corrected in place (F02, F03, F04, F05, F09, F10, F12, F15, F16, F19, F21, F22, F25). None downgraded or dropped. One added (F26, Masumi). F25 moved from grade B to A because it now rests on the primary USPTO record, so all 26 findings are grade A. The substantive corrections:
- the Chainlink badge programme's timeline (F10 and "What could not be found"): the approval-only enrolment page was live until at least 2026-07-22, not only in 2024;
- Cardano §3.1's fourth automatic case and the nominative-fair-use exception (F03, F04);
- the forum's "Dos" for creative names (F04);
- three notice texts, not two (F05);
- Chainlink Terms §3's "accurate descriptive term" (F09);
- the unsupported "licensed to the sponsor" (F15);
- the location-free TOKEN2049 logo set (F21);
- the misattributed DVB spelling (F22);
- the stale Justia status (F25).
The summary's claim that "two parties publish terms" for logo use was also narrowed to Cardano, with Solana's permission marked as inferred.

**Sources that could not be opened or were opened only indirectly.**
- WebSearch hit its session limit during verification, so Exa's search was used instead.
- The Justia CARDANO page returned 403 to curl, a Cloudflare challenge to Chromium and CRAWL_UNKNOWN_ERROR to Exa. The CHAINLINK Justia page was read through Exa.
- The TSDR JSON API now requires an API key, so its HTML status view was used.
- developers.ledger.com/xrplnyc redirects curl to a sign-in page; its text was read through Exa's fetch.
- These were not re-checked because they are the owner's internal files or other dossiers: FD09, FD11, FD12, ARCHITECTURE §3 and §5, internal-contracts F15, "the owner's drafted questions", "the owner's brief" and the rubric dated 22 Sept.
- The research-pass figure "9,562 bytes fetched" (F16) describes that pass's own method and was not reproduced.
- Brand.ledger.com's typography, HUD and tone-of-voice pages remain unread.

**Residual doubts.**
- Solana's logo permission rests on an inference: the files are offered "for websites" with no approval step. The Guidelines grant nothing explicitly, and their ban on use that "Is descriptive of any products or services" could be read against a "built on Solana" logo.
- Cardano's §3 opening sentence still conflicts with §3.1's automatic permission (Contradictions 2).
- The Chainlink badge withdrawal is bracketed by captures (after 2026-07-22, before 2026-10-01), not dated by Chainlink.
- The liquid-purple.png sample value depends on the exact row sampled.
- The Masumi book was read from its text layer only, so its drawn clearspaces and swatches were not inspected.
- The TOKEN2049 kit files other than the two sampled SVGs were not checked for gradients.
- Every hash will drift when a sponsor updates a file.
