"""Recompute FD14 T16 rates applying the exclusions FD14-F06 itself proposes:
title/og:title/twitter:title separators removed (reported separately), and placeholder dashes
extended to the 'X —/N' counter form. Uses the scanner's own extraction."""
import importlib.util
import os
import regex as re

spec = importlib.util.spec_from_file_location(
    "scan", "C:/Users/Utilisateur/.claude/skills/frontend/research/_scripts/fd14/internal-negative-corpus.scan.py")
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

DASH = "\u2014"
TITLE_LINE = re.compile(r"<title>|og:title|twitter:title|PAGE_TITLE|title:\s*['\"]")
PH_BASE = re.compile(r"(?:^|[\u00b7|:])\s*\u2014\s*(?=$|[\u00b7|])|\u2014\s*$")
PH_EXTRA = re.compile(r"\u2014\s*/")

for n in ["inflexion", "bnb", "monad-web", "xrpl", "ethdenver", "hedera", "basebatches", "sui-final"]:
    r = s.scan_corpus(n, s.CORPORA[n])
    files = {s.rel(f): open(f, encoding="utf-8", errors="replace").read().split("\n") for f in s.list_files(s.CORPORA[n])}
    seen = set()
    words = prose = titles = extra_ph = title_words = 0
    title_ex = []
    for loc, st in r["copy"]:
        if (loc, st) in seen:
            continue
        seen.add((loc, st))
        w = len(s.WORD_RE.findall(st))
        words += w
        st2 = st.strip()
        c = st2.count(DASH)
        if st2 in (DASH, "\u2013", DASH + " " + DASH, DASH + DASH):
            continue
        ph = len(PH_BASE.findall(st2))
        p = c - ph
        if p <= 0:
            continue
        f, ln = loc.rsplit(":", 1)
        src = files.get(f, [""])[int(ln) - 1] if f in files and int(ln) - 1 < len(files[f]) else ""
        if TITLE_LINE.search(src):
            titles += p
            title_words += w
            title_ex.append(loc.split("/")[-1])
            continue
        e = len(PH_EXTRA.findall(st2))
        extra_ph += min(e, p)
        prose += p - min(e, p)
    rate_raw = (prose + titles + extra_ph) / words * 1000
    rate_adj = prose / (words - title_words) * 1000
    print(f"{n:12s} words={words} raw_prose={prose + titles + extra_ph} ({rate_raw:.2f}) titles={titles} "
          f"extra_placeholders={extra_ph} -> prose={prose} ({rate_adj:.2f}/1000w) title_locs={title_ex}")
