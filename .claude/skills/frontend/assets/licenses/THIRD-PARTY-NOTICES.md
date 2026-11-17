# Third-party notices

The /frontend skill installs no third-party skill whole. Some detector code adapts rule data (regular expressions,
phrase lists, thresholds) from the projects below, at pinned commits. Each entry names the licence, the files that
carry adapted material, and where the licence text and notices shipped with this skill are kept.

## impeccable

- **Project:** https://github.com/pbakaus/impeccable
- **Copyright:** 2025 Paul Bakaus
- **Licence:** Apache License 2.0, full text in `impeccable-LICENSE.txt` (copied verbatim from the project).
- **Commit:** 909726c7e8 (read on 2026-09-30).
- **NOTICE:** the project's NOTICE file, copied verbatim in `impeccable-NOTICE.md`. Its one entry concerns
  impeccable's iOS and Android platform reference files, which this skill does not use; it is kept because Apache
  2.0 section 4(d) asks derivative works to carry the NOTICE file's attribution notices.
- **Adapted material:** regular expressions from `crates/detect/src/regex_matchers.rs` (FROM_PURPLE_RE and the
  gradient patterns, the side-tab border patterns, BUZZWORDS) in `scripts/rules/static/SL-T01.mjs`, `SL-T02.mjs`,
  `SL-T05.mjs` and `SL-T17.mjs`; the promotional phrase list and the em-dash floor in `scripts/rules/runtime/SL-T16.mjs`
  and `SL-T17.mjs`; the entry names and thresholds cited in the SL-M09, SL-M10, SL-M14, SL-M15, SL-M16 and SL-M17
  detectors (static and runtime) and the SL-T15 heading-rhythm check.
- **Changes:** the patterns were rewritten in JavaScript, narrowed to rendered or shipped UI source, and combined
  with this skill's own scope and exemption rules; each detector's header comment names what it took.

## Adding an entry

Vendoring rule text from another project (taste-skill, Vercel's Web Interface Guidelines, Emil Kowalski's skills,
Anthropic's frontend-design) means adding its licence file here and an entry above in the same change, with the
commit, the files and what was changed. Today only impeccable's material is marked as adapted in a detector header;
the other projects ARCHITECTURE section 9 names are cited as research sources (FD01 to FD04), not shipped.
