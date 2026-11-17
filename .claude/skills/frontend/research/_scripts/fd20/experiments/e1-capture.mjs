// E1: render text at known sizes/colours/weights at 1920x1080 (DPR 1) and save
// lossless screenshots plus the bounding box and ground truth of every string.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('out/e1');
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME_EXE;

// Deterministic PRNG (mulberry32) so every run produces the same strings.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ('escrow settled dispute buyer seller refund window oracle price feed vault ' +
  'deposit withdraw balance pending confirmed block proof signer ledger device ' +
  'amount collateral ratio health factor liquidation reward epoch validator ' +
  'claim release timeout network testnet preprod mainnet fee total status').split(' ');
function makeString(r) {
  const parts = [];
  while (parts.join(' ').length < 26) parts.push(WORDS[Math.floor(r() * WORDS.length)]);
  const n = (Math.floor(r() * 90000) + 1000).toLocaleString('en-US') + '.' + String(Math.floor(r() * 100)).padStart(2, '0');
  const pos = Math.floor(r() * (parts.length + 1));
  parts.splice(pos, 0, n);
  const s = parts.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28];
const VARIANTS = [
  { id: 'v1-ink-white-400', fg: '#111827', bg: '#ffffff', w: 400 },
  { id: 'v2-gray500-white-400', fg: '#6b7280', bg: '#ffffff', w: 400 },
  { id: 'v3-gray400-white-400', fg: '#9ca3af', bg: '#ffffff', w: 400 },
  { id: 'v4-light-dark-400', fg: '#e5e7eb', bg: '#0a0a0a', w: 400 },
  { id: 'v5-gray500-dark-400', fg: '#6b7280', bg: '#0a0a0a', w: 400 },
  { id: 'v6-ink-white-300', fg: '#111827', bg: '#ffffff', w: 300 },
  { id: 'v7-blue-dark-400', fg: '#3b82f6', bg: '#0a0a0a', w: 400 },
  { id: 'v8-red-dark-400', fg: '#ef4444', bg: '#0a0a0a', w: 400 },
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const manifest = [];
let seed = 20261001;
for (const v of VARIANTS) {
  const r = rng(seed++);
  const rows = [...SIZES, ...SIZES].map((s) => ({ size: s, cols: [makeString(r), makeString(r), makeString(r)] }));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400&display=block" rel="stylesheet">
<style>html,body{margin:0;background:${v.bg};color:${v.fg};font-family:Inter,Arial,sans-serif;font-weight:${v.w}}
.row{display:grid;grid-template-columns:repeat(3,590px);column-gap:30px;padding:0 30px;align-items:baseline}
.row span{white-space:nowrap;line-height:1.35}
</style></head><body><div style="padding-top:12px">
${rows.map((row) => `<div class="row" style="font-size:${row.size}px;height:${Math.round(row.size * 1.55 + 10)}px">${row.cols.map((c) => `<span data-size="${row.size}">${c}</span>`).join('')}</div>`).join('\n')}
</div></body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate((w) => document.fonts.check(`${w} 16px Inter`), v.w);
  const boxes = await page.$$eval('span[data-size]', (els) => els.map((e) => {
    const rg = document.createRange(); rg.selectNodeContents(e);
    const r = rg.getBoundingClientRect();
    return { size: Number(e.dataset.size), text: e.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  // Rendered glyph body height (ascender of 'h' to descender of 'g') per size, via canvas metrics.
  const body = await page.evaluate(({ sizes, w }) => {
    const c = document.createElement('canvas').getContext('2d');
    return sizes.map((s) => {
      c.font = `${w} ${s}px Inter`;
      const m = c.measureText('hg');
      const x = c.measureText('x');
      return { size: s, body: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, xHeight: x.actualBoundingBoxAscent };
    });
  }, { sizes: SIZES, w: v.w });
  const file = path.join(OUT, `${v.id}.png`);
  await page.screenshot({ path: file });
  manifest.push({ variant: v, fontOk, file, boxes, body });
  console.log(v.id, 'fontOk=', fontOk, 'maxBottom=', Math.max(...boxes.map((b) => b.y + b.h)).toFixed(0));
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();
