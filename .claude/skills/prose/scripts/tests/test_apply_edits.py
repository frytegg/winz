"""Does the fact guard catch what it must and pass what it must? Four cases, one of them the real refusal."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(r"C:\Users\Utilisateur\.claude\skills\prose\scripts\apply_edits.py")

DOC = """# A page

The failed swap burnt 0.13498778 HBAR, and the code is in `lib/hedera/units.ts`, next to the mirror node's
view of it in `lib/hedera/mirror.ts`, with the transaction at https://hashscan.io/testnet/tx/0xdf368443228e69.
"""

CASES = [
    ("plain rewrite, nothing protected moves", "The failed swap burnt 0.13498778 HBAR, and the code is in", "The swap failed and burnt 0.13498778 HBAR. Its code is in", True),
    ("a snippet that straddles a code span, which the old guard refused", "`, next to the mirror node's\nview of it in `", "`. The mirror node's view of it sits in `", True),
    ("a number quietly altered", "burnt 0.13498778 HBAR", "burnt 0.13 HBAR", False),
    ("an identifier quietly altered", "`lib/hedera/units.ts`", "`lib/hedera/unit.ts`", False),
]

passed = failed = 0
for name, old, new, should_apply in CASES:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "page.md").write_text(DOC, encoding="utf-8")
        edits = root / "edits.json"
        edits.write_text(json.dumps([{"file": "page.md", "edits": [{"old": old, "new": new, "why": name}], "note": ""}]), encoding="utf-8")
        run = subprocess.run([sys.executable, str(SCRIPT), str(edits), "--repo", str(root)], capture_output=True, text=True)
        applied = "applied 1," in run.stdout
    ok = applied == should_apply
    passed, failed = (passed + ok, failed + (not ok))
    print(f"{'ok  ' if ok else 'FAIL'} {name}: applied={applied}, expected={should_apply}")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
