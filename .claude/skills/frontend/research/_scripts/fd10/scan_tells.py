"""Read-only static scan of the owner's past hackathon frontends for the 20 tells.

Pure-Python walk (no ripgrep). Skips dependencies, build output, lockfiles and any
.env* file. Counts regex matches per project and prints a table. Writes nothing.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(r"C:/Users/Utilisateur/Documents/Coding")
PROJECTS = [
    "XRPL_Hackathon/hackathon-rwa",
    "XRPL_Hackathon_2026/app",
    "Hackathon_SUI/repo/web",
    "Hackathon_SUI/Insurance DApp Frontend Design",
    "Monad_Blitz_Paris/auramaxx/web",
    "Monad_Hackathon/Monad_ETHDenver/frontend",
    "ETHDenver/agentfi/frontend",
    "BaseBatches/spark-onchain-app/apps/web",
]
SKIP_DIRS = {"node_modules", ".next", "dist", "build", "out", ".git", ".turbo", ".vercel", "coverage"}
EXTS = {".tsx", ".jsx", ".ts", ".js", ".css", ".scss", ".html", ".mdx"}

EMOJI = "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]"

PATTERNS = {
    "T01 purple->blue gradient": r"from-(purple|violet|indigo|fuchsia)-[0-9]+[^\"'`\n]*to-(blue|indigo|cyan|sky|purple|violet|pink)-[0-9]+",
    "T02 gradient text": r"bg-clip-text|background-clip:\s*text|-webkit-background-clip:\s*text",
    "T03 emoji in heading": r"<h[1-6][^>]*>[^<]*" + EMOJI,
    "T04 Inter (font import)": r"\{\s*Inter\s*[,}]|family=Inter\b|@fontsource(-variable)?/inter|font-family:\s*['\"]?Inter\b",
    "T05 accent border l/t": r"\bborder-[lt]-[2-8]\b|border-(left|top):\s*[2-9]px\s+solid",
    "T06 backdrop blur": r"backdrop-blur|backdrop-filter:\s*blur",
    "T07 muted grey text 500/600": r"\btext-(gray|zinc|slate|neutral|stone)-(500|600)\b",
    "T08 grid-cols-3": r"\b(?:sm:|md:|lg:|xl:)?grid-cols-3\b",
    "T09 pill badge classes": r"rounded-full[^\"'`\n]*\bpx-[23]\b[^\"'`\n]*\bpy-(?:0\.5|1)\b|\bpx-[23]\b[^\"'`\n]*\bpy-(?:0\.5|1)\b[^\"'`\n]*rounded-full",
    "T10 lucide-react import": r"from\s+['\"]lucide-react['\"]",
    "T11 shadcn default hover/data-slot": r"hover:bg-primary/90|data-slot=",
    "T12 scroll reveal": r"whileInView|useInView|IntersectionObserver|data-aos=",
    "T13 pointer tracking": r"onMouseMove|onPointerMove|['\"](?:mousemove|pointermove)['\"]",
    "T14 hover opacity/alpha": r"hover:opacity-[0-9]+|hover:bg-[a-z]+(?:-[0-9]+)?/[0-9]+",
    "T15 arbitrary spacing": r"(?<![\w-])-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-\[[0-9.]+(?:px|rem)\]",
    "T16 em dash": "\u2014|&mdash;|\\\\u2014",
    "T17 buzzword": r"(?i)streamline your|empower your|supercharge your|unleash|leverage the power|seamless|next-generation|cutting-edge|revolutioniz|game-chang|world-class|enterprise-grade|harness the power",
    "T18 serif+italic classes": r"font-serif[^\"'`\n]*italic|italic[^\"'`\n]*font-serif",
    "T19 Space Grotesk/Instrument Serif": r"Space[_ ]Grotesk|Instrument[_ ]Serif",
    "T20 grain/noise": r"feTurbulence|(?i:\bgrain\b)|noise\.(?:png|svg)",
}
COMPILED = {k: re.compile(v) for k, v in PATTERNS.items()}


def iter_files(base: Path):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.startswith(".env"):
                continue
            p = Path(dirpath) / fn
            if p.suffix.lower() not in EXTS:
                continue
            if fn.endswith(".d.ts") or ".min." in fn:
                continue
            yield p


def main() -> None:
    results = {}
    nfiles = {}
    for proj in PROJECTS:
        base = ROOT / proj
        counts = {k: 0 for k in PATTERNS}
        files = list(iter_files(base)) if base.exists() else []
        nfiles[proj] = len(files)
        for f in files:
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for k, rx in COMPILED.items():
                counts[k] += len(rx.findall(text))
        results[proj] = counts
    short = [p.split("/")[0][:12] + "/" + p.split("/")[-1][:14] for p in PROJECTS]
    print("tell | " + " | ".join(short))
    print("source files | " + " | ".join(str(nfiles[p]) for p in PROJECTS))
    for k in PATTERNS:
        print(k + " | " + " | ".join(str(results[p][k]) for p in PROJECTS))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
