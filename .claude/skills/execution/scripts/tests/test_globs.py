"""Glob matching, intersection, containment, manifests and resources (SCHEMAS.md 7.1-7.3, P-10; TESTS.md 3.2).

Protects: the truth tables of TESTS.md 3.2; the property that `intersects` never answers false when some path of a
generated corpus matches both globs (no false negative) and `contains` never answers true when some path matches
the inner glob but not the outer one (no false positive); manifest detection; ordered versus serialized resources.

Run: python -m unittest discover -s scripts/tests -p "test_globs.py" -v
"""
from __future__ import annotations

import random
import unittest

import _support as S  # noqa: F401
from execlib import globs, resources
from execlib.errors import ValidationFailed

INTERSECTS = [
    ("src/queue/**", "src/queue/model/*.ts", True),
    ("src/**/*.ts", "src/**/*.css", False),
    ("src/engine/**", "src/ui/**", False),
    ("**", "README.md", True),
    ("docs/*.md", "docs/api/x.md", False),
    ("data/*.json", "data/requests.json", True),
    ("src/a.ts", "src/a.ts", True),
    ("src/a.ts", "src/b.ts", False),
    ("**/*.ts", "src/x/y.ts", True),
    ("src/**", "src", True),
    ("a/**/b", "a/x/y/b", True),
    ("a/*/c", "a/**/d", False),
]

SEGMENTS = ["src", "docs", "data", "a", "b", "x.ts", "y.css", "README.md", "test", "c.ts", "ab.ts", "model"]
GLOB_SEGMENTS = ["src", "docs", "a", "*", "*.ts", "*.css", "**", "[ab]*.ts", "?.ts", "x*", "model", "test",
                 "README.md", "a*b"]


def corpus(seed: int, n: int) -> list[str]:
    rng = random.Random(seed)
    shapes = [1, 2, 3, 4, 5, 6]
    out = set()
    while len(out) < n:
        depth = rng.choice(shapes)
        out.add("/".join(rng.choice(SEGMENTS) for _ in range(depth)))
    return sorted(out)


def gen_globs(seed: int, n: int) -> list[str]:
    rng = random.Random(seed)
    out = set()
    while len(out) < n:
        depth = rng.choice([1, 2, 3, 4])
        out.add(globs.normalize("/".join(rng.choice(GLOB_SEGMENTS) for _ in range(depth))))
    return sorted(g for g in out if g)


class TruthTables(unittest.TestCase):
    def test_intersects_table(self) -> None:
        for a, b, want in INTERSECTS:
            with self.subTest(a=a, b=b):
                self.assertEqual(globs.intersects(a, b), want)
                self.assertEqual(globs.intersects(b, a), want, "symmetric")

    def test_character_class_never_false_negative(self) -> None:
        self.assertTrue(globs.intersects("test/[ab]*.ts", "test/a1.ts"))
        # test/c.ts matches no path of test/[ab]*.ts: true would be allowed (conservative), false is exact.
        self.assertIn(globs.intersects("test/[ab]*.ts", "test/c.ts"), (True, False))

    def test_contains_table(self) -> None:
        self.assertTrue(globs.contains("src/queue/**", "src/queue/model/*.ts"))
        self.assertFalse(globs.contains("src/*", "src/a/b.ts"))
        self.assertTrue(globs.contains("src/**", "src/**"))
        self.assertTrue(globs.contains("**", "anything/at/all.md"))
        self.assertTrue(globs.contains("src/*.ts", "src/a*.ts"))
        self.assertFalse(globs.contains("src/a*.ts", "src/*.ts"))
        self.assertFalse(globs.contains("src/**/x", "src/**/[ab]"), "unsure: false")
        self.assertTrue(globs.contains("src/**", "src"), "** matches zero segments")

    def test_matches(self) -> None:
        self.assertTrue(globs.matches("src/**/*.ts", "src/a/b/c.ts"))
        self.assertTrue(globs.matches("src/**/*.ts", "src/c.ts"))
        self.assertFalse(globs.matches("docs/*.md", "docs/api/x.md"))
        self.assertFalse(globs.matches("README.md", "readme.md"), "case-sensitive like git")
        self.assertEqual(globs.normalize("./src//**/**/a/"), "src/**/a")

    def test_overlapping(self) -> None:
        self.assertEqual(globs.overlapping(["src/**", "docs/*.md"], ["src/a.ts", "README.md"]),
                         [("src/**", "src/a.ts")])


class Properties(unittest.TestCase):
    def test_no_false_negative_no_false_positive(self) -> None:
        paths = corpus(20261003, 2000)
        cands = gen_globs(7, 160)
        matched = {g: {p for p in paths if globs.matches(g, p)} for g in cands}
        checked_pos = checked_neg = 0
        for i, a in enumerate(cands):
            for b in cands[i:]:
                both = matched[a] & matched[b]
                if both:
                    checked_pos += 1
                    self.assertTrue(globs.intersects(a, b), f"false negative: {a} vs {b} share {sorted(both)[:2]}")
                if globs.contains(a, b):
                    checked_neg += 1
                    extra = matched[b] - matched[a]
                    self.assertFalse(extra, f"false positive: {a} contains {b} but not {sorted(extra)[:2]}")
        self.assertGreater(checked_pos, 100, "the corpus exercises real overlaps")
        self.assertGreater(checked_neg, 20, "the corpus exercises real containments")


class Manifests(unittest.TestCase):
    def test_is_manifest_glob(self) -> None:
        for g in ("package.json", "pnpm-lock.yaml", ".github/workflows/ci.yml", "tsconfig.base.json", "**",
                  "packages/a/package.json", "requirements-dev.txt"):
            with self.subTest(glob=g):
                self.assertTrue(globs.is_manifest_glob(g))
        for g in ("packages/a/src/x.ts", "src/**/*.ts", "docs/tsconfig.json", "README.md"):
            with self.subTest(glob=g):
                self.assertFalse(globs.is_manifest_glob(g))


class Resources(unittest.TestCase):
    def test_parse_and_conflicts(self) -> None:
        self.assertEqual(resources.parse("wallet:hot"), resources.Resource("wallet", "hot"))
        self.assertEqual(resources.parse("manifest"), resources.Resource("manifest", None))
        with self.assertRaises(ValidationFailed):
            resources.parse("gpu")
        a = ["manifest", "wallet:hot", "browser", "port:5173", "human:devA"]
        b = ["wallet:hot", "browser", "port:5173", "db:main", "human:devA"]
        self.assertEqual(resources.ordered_conflicts(a, b), ["wallet:hot"])
        self.assertEqual(resources.serialized_conflicts(a, b), ["browser", "human:devA", "port:5173"])
        self.assertEqual(resources.ordered_conflicts(["wallet:a"], ["wallet:b"]), [])


if __name__ == "__main__":
    unittest.main()
