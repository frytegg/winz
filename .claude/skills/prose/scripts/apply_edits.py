#!/usr/bin/env python3
"""Apply prose edits to a document, and refuse any edit that moves a fact.

    python apply_edits.py edits.json --repo .            # apply
    python apply_edits.py edits.json --repo . --dry-run  # say what would happen

`edits.json` is a list of `{file, edits: [{old, new, why}], note}`. Each `old` must appear exactly once in its
file, and is replaced by `new`.

Invariant 3 of this skill says never invent a fact to fix a sentence. That is a promise an editor makes about its
own work, and a promise nobody checks is a promise that breaks. So this checks it: the edit is applied to a copy
of the whole file, and the protected tokens of the file before and after have to be identical. Protected means
every number, every link, every hash or address, and every inline code span, which is where paths, commands,
identifiers and quoted error strings live, and where a project's own checks look.

The comparison runs over the whole file and never over the snippet. A snippet can begin or end inside a code
span, and then nothing about the snippet alone says which of its backticks opens and which closes: one holding
two backticks may be ordinary prose sitting between two spans. The file always knows. A first version compared
snippets, refused a good edit on 1 October 2026 for exactly that reason, and a parity test did not save it.

When a factual correction IS the point of the edit, declare it with --allow "old text=>new text".

Measured on the first real use, 1 October 2026: 202 edits over four documents, each carrying out the numbers,
links and identifiers it carried in, confirmed afterwards by twelve independent repository checks that resolve
every one of those against the tree.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

PROTECTED = re.compile(
    r"`[^`]*`"  # inline code: paths, commands, identifiers, quoted error strings
    r"|\bhttps?://\S+"  # links
    r"|\b0x[0-9a-fA-F]{6,}\b"  # hashes and addresses
    r"|\b\d[\d,._]*\b"  # every number
)


def protected_tokens(text: str) -> Counter:
    """Every token an edit may not invent, lose or alter. Run over a whole file, never over a fragment."""
    return Counter(match.group(0) for match in PROTECTED.finditer(text))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("edits", type=Path)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        metavar="OLD=>NEW",
        help="a factual change this pass is meant to make; may be repeated",
    )
    args = parser.parse_args(argv)

    allowed = []
    for rule in args.allow:
        before, _, after = rule.partition("=>")
        if not after:
            print(f"--allow needs OLD=>NEW, got {rule!r}", file=sys.stderr)
            return 2
        allowed.append((before, after))

    applied = refused = missed = 0
    for document in json.loads(args.edits.read_text(encoding="utf-8")):
        target = args.repo / document["file"]
        text = target.read_text(encoding="utf-8")
        for edit in document["edits"]:
            old, new = edit["old"], edit["new"]
            found = text.count(old)
            if found != 1:
                print(f"  unmatched  {document['file']}: {found} matches for {old[:70]!r}")
                missed += 1
                continue
            candidate = text.replace(old, new, 1)
            before, after = protected_tokens(text), protected_tokens(candidate)
            if before != after and not any(a in old and b in new for a, b in allowed):
                print(f"  REFUSED    {document['file']}: a fact moved")
                print(f"             lost {dict(before - after)} gained {dict(after - before)}")
                print(f"             in {old[:90]!r}")
                refused += 1
                continue
            text = candidate
            applied += 1
        if not args.dry_run:
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"{document['file']}: written")

    verb = "would apply" if args.dry_run else "applied"
    print(f"\n{verb} {applied}, refused {refused}, unmatched {missed}")
    return 0 if refused == 0 and missed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
