import importlib.util

spec = importlib.util.spec_from_file_location(
    "scan", "C:/Users/Utilisateur/.claude/skills/frontend/research/_scripts/fd14/internal-negative-corpus.scan.py")
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

BACKSLASH = chr(92)
needles = ["&mdash;", "&#8212;", "&#x2014;", BACKSLASH + "u2014", BACKSLASH + "u{2014}"]
for n in s.CORPORA:
    for f in s.list_files(s.CORPORA[n]):
        t = open(f, encoding="utf-8", errors="replace").read()
        for i, line in enumerate(t.split("\n"), 1):
            for nd in needles:
                if nd in line:
                    print(n, s.rel(f) + ":" + str(i), s.kind_of(f, t), repr(nd), line.strip()[:110])
