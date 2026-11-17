"""Split em-dash matches in the past frontends into comment vs non-comment lines.

Read-only. Rough heuristic: a match is 'comment' when it sits after // on the line,
inside /* ... */ or {/* ... */}, or on a line starting with * (JSDoc body).
"""
import os
import re
from pathlib import Path

ROOT = Path(r"C:/Users/Utilisateur/Documents/Coding")
PROJECTS = [
    "XRPL_Hackathon_2026/app",
    "Monad_Blitz_Paris/auramaxx/web",
    "ETHDenver/agentfi/frontend",
    "Monad_Hackathon/Monad_ETHDenver/frontend",
    "Hackathon_SUI/repo/web",
]
SKIP_DIRS = {"node_modules", ".next", "dist", "build", "out", ".git", ".turbo", ".vercel", "coverage"}
EXTS = {".tsx", ".jsx", ".ts", ".js", ".css", ".scss", ".html", ".mdx"}
DASH = "\u2014"
BLOCK = re.compile(r"/\*.*?\*/", re.S)


def iter_files(base: Path):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.startswith(".env"):
                continue
            p = Path(dirpath) / fn
            if p.suffix.lower() in EXTS and not fn.endswith(".d.ts"):
                yield p


for proj in PROJECTS:
    total = in_comment = 0
    ui_like = 0
    for f in iter_files(ROOT / proj):
        text = f.read_text(encoding="utf-8", errors="replace")
        total += text.count(DASH) + text.count("&mdash;")
        stripped = BLOCK.sub(lambda m: " " * len(m.group(0)), text)
        block_count = (text.count(DASH) + text.count("&mdash;")) - (stripped.count(DASH) + stripped.count("&mdash;"))
        line_comment = 0
        for line in stripped.splitlines():
            s = line.lstrip()
            if s.startswith("*"):
                line_comment += line.count(DASH)
                continue
            if "//" in line:
                idx = line.index("//")
                if "://" not in line[max(0, idx - 1):idx + 2]:
                    line_comment += line[idx:].count(DASH)
                    line = line[:idx]
            ui_like += line.count(DASH) + line.count("&mdash;")
        in_comment += block_count + line_comment
    print(f"{proj}: total={total} in_comments~={in_comment} non_comment~={ui_like}")
