# -*- coding: utf-8 -*-
"""FD14 companion: static scan of the owner's past hackathon frontends for the 20 'vibecoding' tells.

Produced the MEASURED numbers in internal-negative-corpus.md (run 2026-09-30, final pass).
Read-only. Never opens .env files (nor env.js / env.ts). Skips node_modules, dist, build, .next, out,
__tests__, __live__, test(s). Classifies files as authored / library (components/ui, components/figma)
/ compiled (precompiled Tailwind output, detected by its '/*! tailwindcss v' banner).

Usage (Git Bash):  PYTHONIOENCODING=utf-8 python internal-negative-corpus.scan.py [corpus ...] > out.txt
   corpora: xrpl bnb hedera monad-static monad-web inflexion sui-figma sui-final basebatches ethdenver
   EMX=40 prints up to 40 prose em-dash examples per corpus.
Needs the third-party 'regex' module (for \\p{Extended_Pictographic}).

This is a research prototype, not the /frontend checker: per-line regexes over comment-stripped text,
hue classification of gradient stops, WCAG contrast of declared tokens, UI-copy extraction from
JSX text / string literals / markup inside template literals. Known gaps are listed in the dossier.
"""
import os
import sys
import json
import collections
import colorsys
import html
import regex as re

BASE = "C:/Users/Utilisateur/Documents/Coding"

CORPORA = {
    "xrpl": ["XRPL_Hackathon_2026/app/src", "XRPL_Hackathon_2026/app/index.html"],
    "bnb": ["BNB/holdover/apps/web/src", "BNB/holdover/brand"],
    "hedera": [
        "Hedera/scaffold-hbar-saucerswap-v2/packages/nextjs/app",
        "Hedera/scaffold-hbar-saucerswap-v2/packages/nextjs/components",
        "Hedera/scaffold-hbar-saucerswap-v2/packages/nextjs/styles",
    ],
    "monad-static": ["Monad_Blitz_Paris/auramaxx/frontend"],
    "monad-web": [
        "Monad_Blitz_Paris/auramaxx/web/src",
        "Monad_Blitz_Paris/auramaxx/web/index.html",
        "Monad_Blitz_Paris/auramaxx/web/regie.html",
        "Monad_Blitz_Paris/auramaxx/web/screen.html",
        "Monad_Blitz_Paris/auramaxx/web/calibrate.html",
    ],
    "inflexion": [
        "inflexion/apps/web/app",
        "inflexion/apps/web/components",
        "inflexion/apps/web/lib",
        "inflexion/apps/web/tailwind.config.ts",
    ],
    "sui-figma": [
        "Hackathon_SUI/Insurance DApp Frontend Design/src",
        "Hackathon_SUI/Insurance DApp Frontend Design/index.html",
    ],
    "sui-final": ["Hackathon_SUI/repo/web/src", "Hackathon_SUI/repo/web/index.html"],
    "basebatches": [
        "BaseBatches/spark-onchain-app/apps/web/src",
        "BaseBatches/spark-onchain-app/apps/web/index.html",
    ],
    "ethdenver": ["ETHDenver/agentfi/frontend/src", "ETHDenver/agentfi/frontend/tailwind.config.ts"],
}

EXTS = {".tsx", ".jsx", ".ts", ".js", ".mjs", ".css", ".html", ".svg"}
SKIP_DIRS = {"node_modules", "dist", "build", ".next", "out", ".git", "__tests__", "__live__", "test", "tests"}


def is_skipped_file(name):
    low = name.lower()
    if low.startswith(".env") or low == "env.js" or low == "env.ts":
        return True
    if low.endswith(".d.ts") or ".test." in low or ".spec." in low:
        return True
    return False


def list_files(roots):
    out = []
    for r in roots:
        p = os.path.join(BASE, r)
        if os.path.isfile(p):
            if os.path.splitext(p)[1] in EXTS and not is_skipped_file(os.path.basename(p)):
                out.append(p)
            continue
        for dp, dns, fns in os.walk(p):
            dns[:] = [d for d in dns if d not in SKIP_DIRS]
            for fn in fns:
                if os.path.splitext(fn)[1] in EXTS and not is_skipped_file(fn):
                    out.append(os.path.join(dp, fn))
    return sorted(set(out))


def rel(p):
    return os.path.relpath(p, BASE).replace("\\", "/")


def kind_of(path, text):
    """library = shadcn/figma primitives; compiled = precompiled tailwind output."""
    rp = rel(path)
    if "/components/ui/" in rp or "/components/figma/" in rp:
        return "library"
    if "/*! tailwindcss v" in text[:400]:
        return "compiled"
    return "authored"


# ---------------------------------------------------------------- colour helpers
TW_FAMILY = {
    # families by hue class, Tailwind v3/v4 names
    "purple": "purple", "violet": "purple", "fuchsia": "purple",
    "blue": "blue", "sky": "blue", "cyan": "blue", "indigo": "blue",
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h[:3])
    elif len(h) == 8:
        h = h[:6]
    if len(h) != 6:
        return None
    try:
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return None


def hue_class(rgb):
    if rgb is None:
        return None
    h, l, s = colorsys.rgb_to_hls(*rgb)
    if s < 0.3 or l < 0.12 or l > 0.92:
        return None
    deg = h * 360
    if 250 <= deg < 320:
        return "purple"
    if 180 <= deg < 250:
        return "blue"
    return "other"


def rel_lum(rgb):
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")
RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")
VAR_DEF_RE = re.compile(r"(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);")


def colours_in(s, varmap):
    out = []
    for m in HEX_RE.finditer(s):
        out.append(hex_to_rgb(m.group(0)))
    for m in RGB_RE.finditer(s):
        out.append(tuple(int(m.group(i)) / 255 for i in (1, 2, 3)))
    for m in re.finditer(r"var\((--[A-Za-z0-9_-]+)", s):
        v = varmap.get(m.group(1))
        if v:
            out.extend(colours_in(v, {}))
    return [c for c in out if c]


# ---------------------------------------------------------------- copy extraction
COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.S)
COMMENT_HTML = re.compile(r"<!--.*?-->", re.S)
COMMENT_LINE = re.compile(r"(?<![:\"'`\\])//[^\n]*")
STRING_RE = re.compile(r"(?<![A-Za-z0-9_])(['\"`])((?:\\.|(?!\1).){1,1200}?)\1", re.S)
JSX_TEXT_RE = re.compile(r">([^<>{}]*[A-Za-z][^<>{}]*)<")
JSX_BRACE_TEXT_RE = re.compile(r"([>}])([^<>{}`'\"]*[A-Za-z][^<>{}`'\"]*)([<{])")
CLASSY = re.compile(r"^[\w\-:/\[\]\.#%&>()!*=,@]+(\s+[\w\-:/\[\]\.#%&>()!*=,@]+)*$")


def strip_comments(text, ext):
    t = COMMENT_BLOCK.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    t = COMMENT_HTML.sub(lambda m: "\n" * m.group(0).count("\n"), t)
    if ext in (".ts", ".tsx", ".js", ".jsx", ".mjs"):
        t = COMMENT_LINE.sub("", t)
    return t


def looks_like_copy(s):
    s = s.strip()
    if not s or not re.search(r"[A-Za-z]{2}", s) and "\u2014" not in s:
        return s in ("\u2014", "\u2013")
    if s.startswith(("http", "/", "./", "@", "#", "data:", "var(", "--")):
        return False
    if re.search(r"\b(import|from|require)\b", s) and ";" in s:
        return False
    words = s.split()
    if len(words) == 1:
        # single token: copy only if it is a capitalised word or pure dash
        return bool(re.fullmatch(r"[A-Z][a-z]{2,}[.!?]?", s)) or s in ("\u2014", "\u2013")
    classy = sum(1 for w in words if re.search(r"[-:/\[\]]|^\d", w) and not re.fullmatch(r"[A-Za-z]+-[a-z]+[.,]?", w))
    if CLASSY.match(s) and classy / len(words) > 0.5:
        return False
    if re.search(r"\b(flex|grid|px-|py-|text-|bg-|rounded|border|items-|justify-|w-|h-)", s) and classy / len(words) > 0.3:
        return False
    return True


def extract_copy(text, ext):
    """Return list of (line_no, copy_string)."""
    t = strip_comments(text, ext)
    out = []
    if ext == ".css":
        for m in re.finditer(r"content\s*:\s*(['\"])(.*?)\1", t):
            out.append((t.count("\n", 0, m.start()) + 1, m.group(2)))
        return out
    if ext == ".svg":
        return out
    # CSS inside <style> of html: drop it
    if ext == ".html":
        t = re.sub(r"<style.*?</style>", lambda m: "\n" * m.group(0).count("\n"), t, flags=re.S)
        t = re.sub(r"<script.*?</script>", lambda m: m.group(0) if 'type="module"' in m.group(0) else "\n" * m.group(0).count("\n"), t, flags=re.S)
    if ext in (".tsx", ".jsx", ".html"):
        # JSX / HTML text nodes, then blank them so the string pass cannot see them twice
        def _take(m):
            s = html.unescape(m.group(1)).strip()
            if s and looks_like_copy(s):
                out.append((t.count("\n", 0, m.start()) + 1, s))
            return ">" + re.sub(r"[^\n]", " ", m.group(1)) + "<"
        t = JSX_TEXT_RE.sub(_take, t)
        if ext in (".tsx", ".jsx"):
            # JSX text bounded by an expression on either side: `{x} some words {" "}`
            def _take2(m):
                s = html.unescape(m.group(2)).strip()
                code = re.search(r"[;=]|=>|&&|\|\||\breturn\b|\bconst\b|\bif\b\s*\(|\)\s*\{|^\s*\)|\bexport\b|\bimport\b", s)
                if s and not code and len(WORD_RE.findall(s)) >= 3 and looks_like_copy(s):
                    out.append((t.count("\n", 0, m.start()) + 1, s))
                    return m.group(1) + re.sub(r"[^\n]", " ", m.group(2)) + m.group(3)
                return m.group(0)
            t = JSX_BRACE_TEXT_RE.sub(_take2, t)
    if ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".html"):
        for m in STRING_RE2.finditer(t):
            s = m.group(2)
            if s is None:
                continue
            # drop className-ish attributes
            pre = t[max(0, m.start() - 20):m.start()]
            if re.search(r"(className|class|cn\(|clsx\(|cva\(|variant|style|href|src|key|id|type|name|role|htmlFor|import|from)\s*[=:(]?\s*\{?\s*$", pre):
                continue
            if s.startswith("${") or "=>" in s:
                continue
            base = t.count("\n", 0, m.start()) + 1
            if "<" in s and ">" in s:
                # markup in a template literal: keep only its text nodes
                s2 = re.sub(r"\$\{[^{}]*\}", " ", s)
                for x in re.split(r"<[^<>]*>", s2):
                    x = x.strip()
                    if x and looks_like_copy(x):
                        out.append((base, x))
                continue
            if re.search(r"\b(?:d|viewBox|transform|stroke|fill)=", s) or re.fullmatch(r"[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+", s):
                continue
            s = re.sub(r"\$\{[^{}]*\}", " ", s)
            if looks_like_copy(s):
                out.append((base, s))
    return out


STRING_RE2 = re.compile(r"(?<![A-Za-z0-9_])(?:'((?:\\.|[^'\\\n]){1,400})'|\"((?:\\.|[^\"\\\n]){1,400})\"|`((?:\\.|[^`\\]){1,6000})`)")


def _wrap(pattern):
    """adapter so STRING_RE2 matches expose group(2) as the string body"""
    class W:
        def __init__(self, p):
            self.p = p

        def finditer(self, s):
            for m in self.p.finditer(s):
                yield _Match(m)
    return W(pattern)


class _Match:
    def __init__(self, m):
        self.m = m

    def start(self):
        return self.m.start()

    def group(self, i):
        if i == 2:
            return self.m.group(1) or self.m.group(2) or self.m.group(3)
        return self.m.group(i)


STRING_RE2 = _wrap(STRING_RE2)


WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\u2019-]*")

BUZZ = [
    r"seamless(?:ly)?", r"effortless(?:ly)?", r"revolution(?:ary|ize|izes|izing)?",r"unlock(?:s|ed|ing)?",
    r"empower(?:s|ed|ing)?", r"leverag(?:e|es|ed|ing)", r"cutting[- ]edge", r"next[- ]gen(?:eration)?",
    r"game[- ]chang(?:er|ing)", r"supercharg(?:e|ed|es|ing)", r"elevat(?:e|es|ed|ing)", r"harness(?:es|ing)?",
    r"unleash(?:es|ed|ing)?", r"powerful", r"innovative", r"state[- ]of[- ]the[- ]art", r"blazing(?:ly)?[- ]fast",
    r"lightning[- ]fast", r"world[- ]class", r"best[- ]in[- ]class", r"reimagin(?:e|ed|es|ing)",
    r"democratiz(?:e|es|ed|ing)", r"frictionless", r"the future of", r"all[- ]in[- ]one", r"one[- ]stop",
    r"enterprise[- ]grade", r"institutional[- ]grade", r"(?:ai|AI)[- ]powered", r"robust", r"scalable",
    r"intelligent", r"smart(?:er)?", r"instant(?:ly)?", r"trustless", r"transform(?:s|ing|ative)?",
    r"cutting", r"ultimate", r"premium", r"magic(?:al)?", r"stunning", r"beautiful(?:ly)?", r"delightful",
    r"secure(?:ly)?", r"exclusive", r"elite", r"legendary", r"epic",
]
WEAK = {r"robust", r"scalable", r"intelligent", r"smart(?:er)?", r"instant(?:ly)?", r"trustless",
        r"transform(?:s|ing|ative)?", r"cutting", r"premium", r"secure(?:ly)?", r"exclusive", r"elite",
        r"legendary", r"epic", r"beautiful(?:ly)?", r"magic(?:al)?", r"ultimate"}
STRONG = [b for b in BUZZ if b not in WEAK]
BUZZ_RE = re.compile(r"\b(" + "|".join(STRONG) + r")\b", re.I)
WEAK_RE = re.compile(r"\b(" + "|".join(sorted(WEAK)) + r")\b", re.I)

EMOJI_RE = re.compile(r"[\p{Extended_Pictographic}\u2B50\u2B55](?<![\u00A9\u00AE\u2122\u2190-\u21FF\u2194-\u2199\u21A9\u21AA])")

# ---------------------------------------------------------------- per-tell line rules
R = {
    "T02_tw": re.compile(r"bg-clip-text"),
    "T02_css": re.compile(r"background-clip\s*:\s*text"),
    "T03_heading_ctx": re.compile(r"<h[1-6][\s>]|CardTitle|DialogTitle|SheetTitle|AlertTitle|\btitle\s*[:=]|\bheading\s*[:=]|\blabel\s*:"),
    "T04": re.compile(r"(family=Inter\b|font-family\s*:[^;]*\bInter\b|['\"]Inter['\"]|\bInter\s*\(|@fontsource(?:-variable)?/inter\b|\bInter_Tight\b)"),
    "T05_side": re.compile(r"\bborder-[lt]-(?:2|4|8|\[\d+px\])\b|border-(?:left|top)\s*:\s*(?:[2-9]|\d{2})px\s+solid|border-(?:left|top)-width\s*:\s*(?:[2-9]|\d{2})px|inset\s+(?:[2-9])px\s+0\s+0"),
    "T05_colour": re.compile(r"\bborder(?:-[ltrbxy])?-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary|secondary|accent)(?:-\d{2,3})?(?:/\d{1,3})?\b"),
    "T06": re.compile(r"backdrop-blur|backdrop-filter\s*:\s*blur|-webkit-backdrop-filter"),
    "T07_alpha": re.compile(r"\btext-(?:white|black|foreground|base-content|fg|muted-foreground|gray-\d{3}|slate-\d{3}|zinc-\d{3}|neutral-\d{3}|primary|secondary|accent)/(?:[1-5]?\d|60)\b"),
    "T07_dimgray": re.compile(r"\btext-(?:gray|slate|zinc|neutral|stone)-(?:500|600|700|800)\b"),
    "T08_grid3": re.compile(r"\b(?:[a-z]{2}:)?grid-cols-3\b|grid-template-columns\s*:\s*(?:repeat\(\s*3\s*,|1fr\s+1fr\s+1fr\b)"),
    "T08_tile": re.compile(r"(?=.*\b(?:w|h|size)-(?:8|9|10|11|12|14|16)\b)(?=.*\brounded(?:-[a-z0-9]+)?\b)(?=.*\bitems-center\b)(?=.*\bjustify-center\b)"),
    "T08_iconkey": re.compile(r"\bicon\s*:\s*[A-Z<'\"]"),
    "T10_lucide": re.compile(r"from\s+['\"]lucide-react(?:@[\d.]+)?['\"]"),
    "T10_heroicons": re.compile(r"from\s+['\"]@heroicons/react"),
    "T10_reacticons": re.compile(r"from\s+['\"]react-icons/"),
    "T11_pinned": re.compile(r"from\s+['\"](?:@?[a-z0-9./-]+)@\d+\.\d+\.\d+['\"]"),
    "T11_defaults": re.compile(r"oklch\(0\.145 0 0\)|oklch\(0\.205 0 0\)|oklch\(0\.985 0 0\)|oklch\(0\.269 0 0\)|--radius:\s*0\.625rem|222\.2 84% 4\.9%|240 10% 3\.9%|0 0% 3\.9%"),
    "T12": re.compile(r"whileInView|useInView|IntersectionObserver|ScrollTrigger|data-aos|initial=\{\{\s*opacity\s*:\s*0|\bopacity\s*:\s*0\s*,\s*[xy]\s*:|animate-fade|fade-?in|fadeUp|FadeContent|AnimatedContent|BlurText|SplitText|TextAnimate|TextReveal|animate-in\b"),
    "T13": re.compile(r"onMouseMove|onPointerMove|['\"]mousemove['\"]|['\"]pointermove['\"]|--mouse-[xy]|--pointer-[xy]|--glow-[xy]|--spotlight"),
    "T14_tw": re.compile(r"\bhover:opacity-\d+\b"),
    "T14_css": re.compile(r":hover[^{]*\{[^}]*\bopacity\s*:"),
    "T18_tw": re.compile(r"(?=.*\bitalic\b)(?=.*\bfont-(?:serif|display|editorial|heading|instrument)\b)"),
    "T18_css": re.compile(r"font-style\s*:\s*italic"),
    "T18_em": re.compile(r"<h[1-3][^>]*>[^<]*<(?:em|i)\b"),
    "T19": re.compile(r"Space[ _+]?Grotesk|Instrument[ _+]?Serif", re.I),
    "T20_grain": re.compile(r"noise\.(?:png|svg|webp|gif)|\bgrain\b|feTurbulence|fractalNoise|film-grain", re.I),
    "GRAD_any": re.compile(r"(?:linear|radial|conic)-gradient\(|\bbg-gradient-to-|\bbg-linear-to-|\bbg-radial\b"),
    "FONT_gf": re.compile(r"fonts\.googleapis\.com/css2?\?family=([^'\"&)]+(?:&family=[^'\"&)]+)*)"),
    "FONT_next": re.compile(r"import\s*\{([^}]*)\}\s*from\s*['\"]next/font/(?:google|local)['\"]"),
    "FONT_face": re.compile(r"@font-face\s*\{[^}]*font-family\s*:\s*['\"]?([^;'\"]+)", re.S),
    "FONT_family": re.compile(r"font-family\s*:\s*([^;}{]+)"),
}

SPACING_TW = re.compile(r"(?<![\w-])(?:[a-z0-9]+:)*-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-(\[[^\]\s]+\]|\d+(?:\.\d+)?|px)(?![\w-])")
SPACING_CSS = re.compile(r"(?<![\w-])(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-start|-end)?)?\s*:\s*([^;}{\n]+)")
LEN_RE = re.compile(r"(-?\d*\.?\d+)(px|rem)\b")


def scan_corpus(name, roots):
    files = list_files(roots)
    res = {
        "name": name, "files": [], "kinds": collections.Counter(), "lines": 0,
        "hits": collections.defaultdict(list), "copy": [], "fonts": collections.Counter(),
        "varmap": {}, "lucide_icons": collections.Counter(), "lucide_files": set(),
        "ui_components": [], "ui_used": set(), "spacing_tw": collections.Counter(),
        "spacing_css": collections.Counter(), "grain_files": set(), "grad_files": set(),
        "iconkey_files": collections.Counter(), "grid3_files": set(), "tile_files": set(),
        "gradient_classdefs": {}, "cliptext_classdefs": set(),
    }
    texts = {}
    for f in files:
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                t = fh.read()
        except OSError:
            continue
        texts[f] = t
    # pass 1: css variable map (authored + library css only; compiled excluded)
    for f, t in texts.items():
        if f.endswith((".css", ".ts", ".tsx", ".html")) and kind_of(f, t) != "compiled":
            for m in VAR_DEF_RE.finditer(t):
                res["varmap"].setdefault(m.group(1), m.group(2).strip())
    varmap = res["varmap"]
    # tailwind theme tokens -> colour, from @theme inline mapping (--color-x: var(--x))
    for k, v in list(varmap.items()):
        if k.startswith("--color-"):
            pass

    def tw_colour(tok):
        """tok like 'violet-500', 'primary', '[#14B8A6]'. returns hue class or None"""
        tok = tok.split("/")[0]
        m = re.fullmatch(r"\[(#[0-9a-fA-F]{3,8})\]", tok)
        if m:
            return hue_class(hex_to_rgb(m.group(1)))
        fam = tok.split("-")[0]
        if fam in TW_FAMILY and re.fullmatch(r"[a-z]+-\d{2,3}", tok):
            return TW_FAMILY[fam]
        if re.fullmatch(r"[a-z]+-\d{2,3}", tok):
            return "other"
        v = varmap.get("--" + tok) or varmap.get("--color-" + tok)
        if v:
            cs = colours_in(v, varmap)
            if cs:
                return hue_class(cs[0])
        return None

    for f, t in texts.items():
        k = kind_of(f, t)
        rp = rel(f)
        res["kinds"][k] += 1
        n_lines = t.count("\n") + 1
        res["files"].append((rp, k, n_lines))
        if k == "compiled":
            continue
        ext = os.path.splitext(f)[1]
        if k == "library" and rp.endswith(".tsx"):
            res["ui_components"].append(os.path.splitext(os.path.basename(f))[0])
        res["lines"] += n_lines if k == "authored" else 0
        # rules run on comment-stripped text (line count preserved): a tell named in a comment is not a tell
        lines = strip_comments(t, ext).split("\n")
        # css rule blocks for custom gradient / clip-text classes
        if ext in (".css",) or (ext in (".ts", ".tsx", ".html") and "{" in t):
            for m in re.finditer(r"\.([A-Za-z][\w-]*)\s*\{([^{}]*)\}", t):
                body = m.group(2)
                if re.search(r"(linear|radial|conic)-gradient\(", body):
                    cls = [hue_class(c) for c in colours_in(body, varmap)]
                    if "purple" in cls and "blue" in cls:
                        res["gradient_classdefs"][m.group(1)] = rp + ":" + str(t.count("\n", 0, m.start()) + 1)
                if re.search(r"background-clip\s*:\s*text", body):
                    res["cliptext_classdefs"].add(m.group(1))
        for i, line in enumerate(lines, 1):
            loc = f"{rp}:{i}"
            snippet = line.strip()[:220]
            tag = "" if k == "authored" else f"[{k}]"
            # T01 purple->blue gradient
            if R["GRAD_any"].search(line) or re.search(r"\b(from|via|to)-", line):
                if R["GRAD_any"].search(line):
                    res["grad_files"].add(rp)
                cls = [hue_class(c) for c in colours_in(line, varmap)] if "gradient(" in line else []
                tw = [tw_colour(m.group(2)) for m in re.finditer(r"(?<![\w-])(?:[a-z]+:)*(from|via|to)-([a-z]+(?:-\d{2,3})?(?:/\d+)?|\[#[0-9a-fA-F]{3,8}\])(?![\w-])", line)]
                allc = cls + tw
                if "purple" in allc and "blue" in allc:
                    res["hits"]["T01_purple_blue_gradient"].append((loc, tag, snippet))
            # T02
            if (R["T02_tw"].search(line) and "text-transparent" in line) or R["T02_css"].search(line):
                res["hits"]["T02_gradient_text"].append((loc, tag, snippet))
            # T03 emoji
            if EMOJI_RE.search(line) and ext != ".svg":
                ctx = " ".join(lines[max(0, i - 3):i])
                inhead = bool(R["T03_heading_ctx"].search(line)) or bool(re.search(r"<h[1-6][\s>](?![^<]*</h[1-6])", ctx))
                key = "T03_emoji_in_heading_ctx" if inhead else "T03_emoji_elsewhere"
                res["hits"][key].append((loc, tag, snippet))
            for key, rk in (("T04_inter", "T04"), ("T05_side_accent_border", "T05_side"),
                            ("T05_coloured_border", "T05_colour"), ("T06_glass_backdrop_blur", "T06"),
                            ("T07_low_alpha_text", "T07_alpha"), ("T07_dim_gray_text", "T07_dimgray"),
                            ("T10_lucide_import", "T10_lucide"), ("T10_heroicons_import", "T10_heroicons"),
                            ("T10_reacticons_import", "T10_reacticons"), ("T11_version_pinned_import", "T11_pinned"),
                            ("T11_shadcn_default_token", "T11_defaults"), ("T12_entrance_or_scroll_motion", "T12"),
                            ("T13_pointer_tracking", "T13"), ("T14_hover_opacity_tw", "T14_tw"),
                            ("T18_italic_serif_tw", "T18_tw"), ("T18_font_style_italic", "T18_css"),
                            ("T18_em_in_heading", "T18_em"), ("T19_space_grotesk_instrument", "T19"),
                            ("T20_grain", "T20_grain")):
                if R[rk].search(line):
                    res["hits"][key].append((loc, tag, snippet))
            if R["T08_grid3"].search(line):
                res["hits"]["T08_grid_cols_3"].append((loc, tag, snippet))
                if k == "authored":
                    res["grid3_files"].add(rp)
            if R["T08_tile"].search(line):
                res["hits"]["T08_icon_tile"].append((loc, tag, snippet))
                if k == "authored":
                    res["tile_files"].add(rp)
            if R["T08_iconkey"].search(line) and k == "authored":
                res["iconkey_files"][rp] += 1
            if R["T20_grain"].search(line):
                res["grain_files"].add(rp)
            if R["GRAD_any"].search(line) and "gradient(" in line:
                cc = [hue_class(c) for c in colours_in(line, varmap)]
                if any(x in ("purple", "blue", "other") for x in cc):
                    res.setdefault("chroma_grad_files", set()).add(rp)
            if k == "authored":
                for m in R["T10_lucide"].finditer(line):
                    res["lucide_files"].add(rp)
                for m in SPACING_TW.finditer(line):
                    res["spacing_tw"][m.group(2)] += 1
                if ext == ".css" or "style" in line or ext in (".html",) or rp.endswith("styles.ts"):
                    for m in SPACING_CSS.finditer(line):
                        for lm in LEN_RE.finditer(m.group(2)):
                            v = float(lm.group(1)) * (16 if lm.group(2) == "rem" else 1)
                            res["spacing_css"][abs(v)] += 1
        # T09 badge/pill directly above a headline: look back up to 10 lines from each <h1 / hero <h2
        if k == "authored" and ext in (".tsx", ".jsx", ".html", ".ts"):
            for i, line in enumerate(lines, 1):
                if re.search(r"<h1[\s>]", line):
                    back = lines[max(0, i - 11):i - 1]
                    for j, bl in enumerate(back):
                        pill = (re.search(r"\brounded-full\b", bl) and re.search(r"\bp[xy]-(?:0\.5|1|1\.5|2|2\.5|3|4)\b", bl)
                                and not re.search(r"\b(?:w|h|size)-(?:\d{2,}|\[)", bl))
                        named = re.search(r"<Badge\b|class(?:Name)?=[\"'`{][^\"'`]*\b(?:badge|pill|eyebrow|kicker|tagline-pill)\b", bl)
                        if pill or named:
                            res["hits"]["T09_badge_above_h1"].append((f"{rp}:{i - len(back) + j}", "", bl.strip()[:200]))
                            break
        # multi-line lucide import names
        if k == "authored":
            for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*['\"]lucide-react(?:@[\d.]+)?['\"]", t):
                for nm in m.group(1).split(","):
                    nm = nm.strip().split(" as ")[0].strip()
                    if nm and nm != "type":
                        res["lucide_icons"][nm] += 1
            for m in re.finditer(r"from\s+['\"](?:\.\.?/)*(?:[\w@/-]*/)?(?:components/)?ui/([\w-]+)['\"]", t):
                res["ui_used"].add(m.group(1))
            # css hover-opacity blocks (multi-line)
            for m in re.finditer(r"([^{}\n]*:hover[^{}\n]*)\{([^{}]*)\}", t):
                if re.search(r"(?<![-\w])opacity\s*:", m.group(2)):
                    ln = t.count("\n", 0, m.start()) + 1
                    res["hits"]["T14_hover_opacity_css"].append((f"{rp}:{ln}", "", (m.group(1).strip() + " { " + m.group(2).strip())[:200]))
            # fonts
            for m in R["FONT_gf"].finditer(t):
                for fam in m.group(1).split("&family="):
                    res["fonts"]["gfonts:" + fam.split(":")[0].replace("+", " ")] += 1
            for m in R["FONT_next"].finditer(t):
                for nm in m.group(1).split(","):
                    if nm.strip():
                        res["fonts"]["next/font:" + nm.strip()] += 1
            for m in R["FONT_face"].finditer(t):
                res["fonts"]["@font-face:" + m.group(1).strip()] += 1
            for m in R["FONT_family"].finditer(t):
                fam = m.group(1).strip().split(",")[0].strip().strip("'\"")
                res["fonts"]["font-family:" + fam] += 1
            # copy
            for ln, s in extract_copy(t, ext):
                res["copy"].append((f"{rp}:{ln}", s))
    # usages of custom gradient / clip-text classes in authored markup
    names = set(res["gradient_classdefs"]) | set(res["cliptext_classdefs"])
    for f, t in texts.items():
        if kind_of(f, t) != "authored" or not f.endswith((".tsx", ".jsx", ".html", ".ts")):
            continue
        for i, line in enumerate(t.split("\n"), 1):
            for nm in names:
                if re.search(r"(?<![\w-])" + re.escape(nm) + r"(?![\w-])", line) and "{" not in line.split(nm)[1][:3]:
                    key = "USE_cliptext_class" if nm in res["cliptext_classdefs"] else "USE_purpleblue_class"
                    res["hits"][key].append((f"{rel(f)}:{i}", "", nm + " :: " + line.strip()[:160]))
    return res


def summarise(res, show=3):
    out = []
    n = res["name"]
    out.append("=" * 100)
    out.append(f"CORPUS {n}: files={len(res['files'])} kinds={dict(res['kinds'])} authored_lines={res['lines']}")
    # copy metrics
    words = 0
    em_total = em_place = en_total = 0
    buzz = collections.Counter()
    weak = collections.Counter()
    buzz_ex = collections.defaultdict(list)
    em_ex = []
    seen = set()
    for loc, s in res["copy"]:
        key = (loc, s)
        if key in seen:
            continue
        seen.add(key)
        w = len(WORD_RE.findall(s))
        words += w
        st = s.strip()
        c = st.count("\u2014")
        if st in ("\u2014", "\u2013", "\u2014 \u2014", "\u2014\u2014"):
            em_place += c
        else:
            ph = len(re.findall(r"(?:^|[\u00b7|:])\s*\u2014\s*(?=$|[\u00b7|])|\u2014\s*$", st))
            em_place += ph
            em_total += c - ph
            if c - ph > 0 and len(em_ex) < int(os.environ.get("EMX", "3")):
                em_ex.append((loc, st[:200]))
        en_total += st.count("\u2013")
        for m in BUZZ_RE.finditer(s):
            b = m.group(1).lower()
            buzz[b] += 1
            if len(buzz_ex[b]) < 2:
                buzz_ex[b].append((loc, st[:140]))
        for m in WEAK_RE.finditer(s):
            weak[m.group(1).lower()] += 1
    rate = (em_total / words * 1000) if words else 0
    out.append(f"  COPY: strings={len(seen)} words={words} emdash_prose={em_total} ({rate:.2f}/1000w) emdash_placeholder={em_place} endash={en_total}")
    for loc, s in em_ex:
        out.append(f"    emdash ex: {loc} :: {s}")
    btot = sum(buzz.values())
    out.append(f"  BUZZ strong: total={btot} ({(btot / words * 1000) if words else 0:.2f}/1000w) top={buzz.most_common(12)}")
    out.append(f"  BUZZ weak (context-dependent): total={sum(weak.values())} top={weak.most_common(10)}")
    for b, exs in list(buzz_ex.items())[:12]:
        for loc, s in exs[:1]:
            out.append(f"    buzz[{b}]: {loc} :: {s}")
    out.append(f"  FONTS: {res['fonts'].most_common(14)}")
    out.append(f"  LUCIDE: files={len(res['lucide_files'])} distinct_icons={len(res['lucide_icons'])} top={res['lucide_icons'].most_common(10)}")
    out.append(f"  UI components shipped={len(res['ui_components'])} imported_by_authored={len(res['ui_used'] & set(res['ui_components']))} used={sorted(res['ui_used'] & set(res['ui_components']))}")
    out.append(f"  GRADIENT CLASSDEFS purple+blue: {res['gradient_classdefs']}  CLIPTEXT CLASSDEFS: {sorted(res['cliptext_classdefs'])}")
    tw = res["spacing_tw"]
    arb = sum(v for k, v in tw.items() if k.startswith("["))
    out.append(f"  SPACING tw: uses={sum(tw.values())} distinct={len(tw)} arbitrary_uses={arb} values={sorted(tw.keys(), key=lambda x: (x.startswith('['), float(x) if x.replace('.', '', 1).isdigit() else 999))[:40]}")
    css = res["spacing_css"]
    off = sum(v for k, v in css.items() if k and k % 4 != 0)
    tot = sum(css.values())
    out.append(f"  SPACING css(px): uses={tot} distinct={len(css)} off_4px_grid_uses={off} ({(off / tot * 100) if tot else 0:.0f}%) values={sorted(css.keys())[:40]}")
    out.append(f"  T08 files: grid3={sorted(res['grid3_files'])} tile={sorted(res['tile_files'])} iconkey={dict(res['iconkey_files'])}")
    cg = res.get("chroma_grad_files", set())
    out.append(f"  T20 grain files={sorted(res['grain_files'])} ; gradient files={len(res['grad_files'])}; grain+any-gradient={sorted(res['grain_files'] & res['grad_files'])}; grain+CHROMATIC-gradient={sorted(res['grain_files'] & cg)}")
    order = sorted(res["hits"].keys())
    for key in order:
        hits = res["hits"][key]
        auth = [h for h in hits if not h[1]]
        out.append(f"  {key}: total={len(hits)} authored={len(auth)}")
        shown = 0
        for loc, tag, sn in (auth + [h for h in hits if h[1]]):
            if shown >= show:
                break
            out.append(f"      {tag}{loc} :: {sn}")
            shown += 1
    return "\n".join(out)


def contrast_report(res):
    vm = res["varmap"]
    out = []
    bgs = [k for k in vm if re.search(r"^--(bg|background|canvas|base|card|surface)(-\d)?$", k)]
    fgs = [k for k in vm if re.search(r"(muted-foreground|fg-dim|fg-idle|fg-muted|text-muted|text-secondary|tertiary|--muted$|--dim|--fg$|--foreground$|--text$|subtle)", k)]
    for b in bgs:
        cb = colours_in(vm[b], vm)
        if not cb:
            continue
        for fk in fgs:
            cf = colours_in(vm[fk], vm)
            if not cf:
                continue
            out.append(f"    {fk}={vm[fk][:24]} on {b}={vm[b][:24]} -> {contrast(cf[0], cb[0]):.2f}:1")
    return "\n".join(out[:30])


if __name__ == "__main__":
    names = sys.argv[1:] or list(CORPORA)
    for n in names:
        r = scan_corpus(n, CORPORA[n])
        print(summarise(r))
        print("  CONTRAST (declared tokens, first colour of each var; alpha ignored):")
        print(contrast_report(r))
        if os.environ.get("DUMP_FILES"):
            for fp, k, nl in r["files"]:
                print(f"    FILE {k:9s} {nl:6d} {fp}")
