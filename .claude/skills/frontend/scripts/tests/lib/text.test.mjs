// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commentRanges, emDashRate, lineOf, normaliseText, stripComments, wordCount } from '../../lib/text.mjs';

const ch = (/** @type {number} */ code) => String.fromCharCode(code);
const EM = ch(0x2014);
const EN = ch(0x2013);

/**
 * Strips and checks the invariants every caller relies on: same length, same line breaks at the same places.
 * @param {string} src
 * @param {string} kind
 * @returns {string}
 */
function strip(src, kind) {
  const out = stripComments(src, kind);
  assert.equal(out.length, src.length, 'length is preserved');
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\n' || src[i] === '\r') assert.equal(out[i], src[i], `line break kept at ${i}`);
  }
  return out;
}

test('js: line and block comments become spaces; strings keep comment-like text', () => {
  const src = `const a = 'x // not' + "/* no */"; // yes\nconst b = 1; /* block\nspanning */ const c = 2;`;
  const out = strip(src, 'js');
  assert.ok(out.includes(`'x // not' + "/* no */";`));
  assert.ok(!out.includes('yes') && !out.includes('block') && !out.includes('spanning'));
  assert.ok(out.includes('const c = 2;'));
  assert.equal(lineOf(out, out.indexOf('const c')), 3);
});

test('js: regex literals are skipped, division is not a regex', () => {
  const src = String.raw`const r = /\/\*x/g; // c1
const k = /[/]/.test(s); // c2
function f() { return /a\/b/.test(s) } // c3
const d = a / b / c; // c4
const e = (x) / 2 / y; // c5`;
  const out = strip(src, 'js');
  assert.ok(out.includes(String.raw`/\/\*x/g;`), 'regex containing /* survives');
  assert.ok(out.includes('/[/]/.test(s);'), 'slash inside a class');
  assert.ok(out.includes(String.raw`return /a\/b/.test(s)`), 'regex after return');
  assert.ok(out.includes('const d = a / b / c;') && out.includes('const e = (x) / 2 / y;'));
  for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) assert.ok(!out.includes(c), `${c} removed`);
});

test('js: template literals nest, and comments inside substitutions are removed', () => {
  const src = 'const t = `a // keep ${ b /* gone */ } ${ `inner ${ x } // keep2` } /* keep3 */`; // gone2';
  const out = strip(src, 'js');
  assert.ok(out.includes('a // keep') && out.includes('// keep2') && out.includes('/* keep3 */'));
  assert.ok(!out.includes('gone'));
});

test('js: an unterminated string ends at the line break, so later comments are still found', () => {
  const src = "const s = 'abc\nconst t = 1; // later";
  const out = strip(src, 'js');
  assert.ok(!out.includes('later'));
});

test('js: a hashbang line is kept; property names that are keywords do not start a regex', () => {
  const src = '#!/usr/bin/env node\nconst x = a.return / 2 / b; // c';
  const out = strip(src, 'js');
  assert.ok(out.startsWith('#!/usr/bin/env node'));
  assert.ok(out.includes('a.return / 2 / b;') && !out.includes('// c'));
});

test('jsx: text children keep // and apostrophes; JSX comments and tag comments are removed', () => {
  const src = [
    'export const C = () => (',
    '  <div title="https://x.y" // tag comment',
    '    data-x={1 /* attr comment */}>',
    "    Don't visit https://example.com // literal text",
    '    {/* jsx comment */}',
    "    <a href='//cdn.example.com'>it's</a>",
    '    <>fragment // text</>',
    '  </div>',
    '); // after',
  ].join('\n');
  const out = strip(src, 'jsx');
  assert.ok(out.includes('title="https://x.y"'));
  assert.ok(out.includes("Don't visit https://example.com // literal text"));
  assert.ok(out.includes("<a href='//cdn.example.com'>it's</a>"));
  assert.ok(out.includes('<>fragment // text</>'));
  for (const gone of ['tag comment', 'attr comment', 'jsx comment', 'after']) assert.ok(!out.includes(gone), `${gone} removed`);
  assert.ok(out.includes('{                 }'), 'the JSX comment container is blanked in place');
});

test('jsx: elements nest inside expressions inside elements', () => {
  const src = "const v = <ul>{items.map((i) => <li key={i}>{i} // text</li>)}</ul>; // gone";
  const out = strip(src, 'jsx');
  assert.ok(out.includes('{i} // text</li>') && !out.includes('gone'));
});

test('js files may hold JSX (create-react-app style)', () => {
  const out = strip("const a = <p>Don't // keep</p>; // gone", 'js');
  assert.ok(out.includes("<p>Don't // keep</p>;") && !out.includes('gone'));
});

test('tsx: generic arrows, generic calls and type-level generics are not JSX', () => {
  const src = [
    'type F = <T>(x: T) => T; // c1',
    'const g = <T,>(x: T) => x; // c2',
    'const h = <T extends object>(x: T) => x; // c3',
    'const [n] = useState<number>(0); // c4',
    'const el = <Select<Opt> value={v} />; // c5',
    'const lt = a < b && c > d; // c6',
    "const p = <p>it's // text</p>; // c7",
  ].join('\n');
  const out = strip(src, 'tsx');
  for (const c of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']) assert.ok(!out.includes(c), `${c} removed`);
  assert.ok(out.includes("<p>it's // text</p>"));
});

test('ts: angle-bracket assertions are not JSX', () => {
  const out = strip("const x = <number>y; // c1\nconst s = 'it''s'; // c2", 'ts');
  assert.ok(!out.includes('c1') && !out.includes('c2'));
});

test('css: strings and unquoted url() keep their slashes', () => {
  const src = 'a { content: "/* no */"; background: url(//cdn.x/a.png); } /* yes */\nb { c: d } /* multi\nline */';
  const out = strip(src, 'css');
  assert.ok(out.includes('"/* no */"') && out.includes('url(//cdn.x/a.png)'));
  assert.ok(!out.includes('yes') && !out.includes('multi'));
  assert.ok(strip('a { b: c } // not a css comment', 'css').includes('// not a css comment'));
});

test('scss and less: // line comments, except inside url()', () => {
  const src = '$x: 1; // gone\n.a { background: url(http://x/y.png); } /* gone2 */';
  for (const kind of ['scss', 'less', 'sass']) {
    const out = strip(src, kind);
    assert.ok(!out.includes('gone') && out.includes('url(http://x/y.png)'), kind);
  }
});

test('html: comments, script and style blocks in their own syntax; raw text elements untouched', () => {
  const src = [
    '<!doctype html><!-- page comment -->',
    "<p title='<!-- not a comment -->'>t</p>",
    '<script>const u = "http://x"; // js comment',
    '</script>',
    '<script type="application/ld+json">{"url": "https://example.com/a//b"}</script>',
    '<script type="text/template"><!-- template keep --></script>',
    '<style>/* css comment */ a { b: c }</style>',
    '<textarea><!-- textarea keep --></textarea>',
    '<title>// title keep</title>',
  ].join('\n');
  const out = strip(src, 'html');
  assert.ok(!out.includes('page comment') && !out.includes('js comment') && !out.includes('css comment'));
  assert.ok(out.includes("title='<!-- not a comment -->'"));
  assert.ok(out.includes('const u = "http://x";'));
  assert.ok(out.includes('https://example.com/a//b'));
  assert.ok(out.includes('<!-- template keep -->') && out.includes('<!-- textarea keep -->') && out.includes('// title keep'));
});

test('vue and svelte: template comments, TypeScript script and SCSS style', () => {
  const vue = '<template><!-- t --><div/></template>\n<script setup lang="ts">\nconst x: number = 1 // ts\n</script>\n<style lang="scss">\na { b: c } // s\n</style>';
  const outVue = strip(vue, 'vue');
  assert.ok(!outVue.includes('<!-- t -->') && !outVue.includes('// ts') && !outVue.includes('// s'));
  const svelte = '<script>\n  let n = 1; // gone\n</script>\n<!-- gone2 -->\n<p>{n} // text</p>';
  const outSvelte = strip(svelte, 'svelte');
  assert.ok(!outSvelte.includes('gone') && outSvelte.includes('{n} // text'));
});

test('CRLF sources keep their CR and LF; astral characters in comments keep the length', () => {
  const smile = String.fromCodePoint(0x1f600);
  const src = `a(); // one ${smile}\r\nb(); /* two\r\n${smile} */ c();`;
  const out = strip(src, 'js');
  assert.ok(out.includes('c();') && !out.includes('one') && !out.includes(smile));
});

test('kinds: aliases accepted, json untouched, unknown kind refused', () => {
  assert.equal(stripComments('{"a": "//b"}', 'json'), '{"a": "//b"}');
  assert.ok(!stripComments('x(); // c', 'mjs').includes('// c'));
  assert.ok(!stripComments('<!-- c --><p>x</p>', 'htm').includes('<!--'));
  assert.ok(!stripComments('const a: T = 1; // c', 'mts').includes('// c'));
  assert.throws(() => stripComments('x', 'astro'), TypeError);
});

test('commentRanges reports the blanked ranges in order', () => {
  const src = 'a(); // one\nb(); /* two */';
  assert.deepEqual(commentRanges(src, 'js'), [[5, 11], [17, 26]]);
});

test('lineOf is 1-based and clamps out-of-range indexes', () => {
  const s = 'a\nb\r\nc';
  assert.equal(lineOf(s, 0), 1);
  assert.equal(lineOf(s, 1), 1, 'the newline belongs to its line');
  assert.equal(lineOf(s, 2), 2);
  assert.equal(lineOf(s, s.length - 1), 3);
  assert.equal(lineOf(s, 999), 3);
  assert.equal(lineOf(s, -5), 1);
  assert.equal(lineOf('', 0), 1);
  assert.equal(lineOf('x\ny', 2), 2, 'a second source invalidates the cache');
});

test('wordCount counts Unicode words, not punctuation', () => {
  assert.equal(wordCount("Hello, world. Don't stop: 1,000 well-known items"), 8);
  assert.equal(wordCount(`caf${ch(0xe9)} na${ch(0xef)}ve`), 2);
  assert.equal(wordCount(`one${EM}two`), 2);
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('  ...  '), 0);
});

test('emDashRate counts U+2014 only, per 1,000 words', () => {
  const text = `Fast ${EM} and safe ${EN} really ${EM} yes`;
  const rate = emDashRate(text);
  assert.equal(rate.count, 2);
  assert.equal(rate.words, 5);
  assert.equal(rate.per1000, 400);
  assert.deepEqual(emDashRate(''), { count: 0, words: 0, per1000: 0 });
  assert.deepEqual(emDashRate(EM), { count: 1, words: 0, per1000: 0 });
});

test('normaliseText applies NFKC and collapses whitespace', () => {
  const fullwidthA = ch(0xff21);
  const fiLigature = ch(0xfb01);
  const nbsp = ch(0xa0);
  assert.equal(normaliseText(`  ${fullwidthA}${nbsp}${fiLigature}le \n\t done  `), 'A file done');
  assert.equal(normaliseText(''), '');
});
