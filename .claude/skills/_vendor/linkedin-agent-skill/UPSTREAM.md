# linkedin-agent-skill (vendored)

The eleven `li-*` skills in `~/.claude/skills/` are a pinned copy of a third-party pack. This folder holds what
the pack ships besides the skills: its MIT licence (the notice must travel with the copy), its README and the
voice template. It has no `SKILL.md`, so Claude Code does not load it as a skill.

| | |
|---|---|
| Source | https://github.com/Jakeschincariol/linkedin-agent-skill |
| Commit | `add2c23882fe79180737d242ff80a5da205eda6a` (2026-09-07) |
| Installed | 2026-10-13 |
| Licence | MIT, Jake Schincariol, see `LICENSE` |
| Installed as | `skills/li-{audit,carousel,comment,dm,human,inbox,plan,post,profile,reply,repurpose}` |

Vendored rather than added as a plugin marketplace: the copy is the one that was read before it was installed,
and an upstream change cannot reach the config without a reviewed update.

## Review at install

- Every `SKILL.md`, both scripts and the three JSON data files were read in full. No instruction aimed at the
  model beyond the skill's own job, no invisible or format characters in any file.
- `li-human/humanize.py` and `detect.py` use the standard library only: no network, no subprocess, and the only
  write is the `-o` output file.
- Every skill writes text and stops. None posts, scrapes or drives a browser on LinkedIn.

## Local patches

Re-apply these after every update.

1. `li-human/SKILL.md`, frontmatter `description` only: scoped to social posts and messages (LinkedIn, X) and
   pointed away from READMEs, docs and pitches. Upstream says "use whenever text needs to sound human", which
   competed with `/prose` and would have run the slop regex over technical docs ("robust" -> "solid").

## Known limits on this machine (measured 2026-10-13)

- **English only.** The lexicon and the `detect.py` regexes are English. On a French sample, VOICE scored 0
  contractions and 0 pronouns (no `je`, `on`, `nous`), FINGERPRINT counted the curly apostrophes a French
  keyboard produces, and `humanize.py` removed the space French typography puts before `:` and `?`. Do not trust
  the score on a French post, and do not run `humanize.py` over French text without reading the diff.
- **`python`, not `python3`.** The skill text says `python3`, which does not exist on this Windows install.
- **Windows stdout is cp1252.** `humanize.py` without `-o` prints accented text as mojibake and would crash on an
  emoji. Use `-o clean.txt` (the skill's own order of operations already does), or set `PYTHONUTF8=1`.

## Data files the skills use

The skills read and write `~/.claude/linkedin/`: `voice.md` (the voice profile), `plan.md` (from `/li-plan`) and
`log.md` (posts approved, read by `/li-audit`). Only `voice.md` is synced by the config repo; `plan.md` and
`log.md` stay on the machine. `templates/voice.md` here is the blank template. Do not copy it into place empty:
`/li-post` reads the file when it exists and would take a blank template as the voice. Let `/li-post` write it
from three real posts, or fill the template first.

## Updating

```bash
git clone --depth 1 https://github.com/Jakeschincariol/linkedin-agent-skill /tmp/li
cd /tmp/li && git log -1 --format='%H %ci'
git diff --no-index ~/.claude/skills/li-post skills/li-post   # repeat per skill: read every change
```

Read the diff of every `SKILL.md`, script and JSON before copying anything over, then copy `skills/li-*`,
`LICENSE`, `README.md` and `templates/voice.md`, re-apply the local patches above, and update the commit in the
table.
