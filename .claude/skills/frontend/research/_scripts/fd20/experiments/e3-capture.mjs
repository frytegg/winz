// E2: typical hero backgrounds (gradients, glow, grain) rendered at 1920x1080 DPR 1.
// Also E3: 30 frames of an animated grain overlay piped straight into ffmpeg (no PNGs on disk).
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const OUT = path.resolve('out/e2');
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME_EXE;

const grain = (seed, opacity) => `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%' style='position:fixed;inset:0;opacity:${opacity};pointer-events:none;mix-blend-mode:overlay'>
<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' seed='${seed}' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter>
<rect width='100%' height='100%' filter='url(#n)'/></svg>`;

const PAGES = {
  'g1-dark-purple-3stop': { bg: 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)', fg: '#ffffff' },
  'g2-near-black-subtle': { bg: 'linear-gradient(180deg,#0a0a0a 0%,#171727 100%)', fg: '#e5e7eb' },
  'g3-light-subtle': { bg: 'linear-gradient(180deg,#ffffff 0%,#eef2ff 100%)', fg: '#111827' },
  'g4-radial-glow': { bg: 'radial-gradient(ellipse 80% 60% at 50% 0%,rgba(124,58,237,0.35),rgba(124,58,237,0) 70%),#09090b', fg: '#fafafa' },
  'g5-subtle-plus-grain': { bg: 'linear-gradient(180deg,#0a0a0a 0%,#171727 100%)', fg: '#e5e7eb', grain: 0.12 },
  'g6-glow-plus-grain': { bg: 'radial-gradient(ellipse 80% 60% at 50% 0%,rgba(124,58,237,0.35),rgba(124,58,237,0) 70%),#09090b', fg: '#fafafa', grain: 0.12 },
  'g7-flat-control': { bg: '#0a0a0a', fg: '#e5e7eb' },
  'g8-vivid-purple-blue': { bg: 'linear-gradient(135deg,#7c3aed 0%,#2563eb 100%)', fg: '#ffffff' },
};

const html = (p, seed = 1) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
body{background:${p.bg};color:${p.fg};font-family:Arial,sans-serif}
h1{position:absolute;left:120px;top:380px;margin:0;font-size:72px;font-weight:700;letter-spacing:-1px}
p{position:absolute;left:120px;top:490px;margin:0;font-size:24px;opacity:.85}
</style></head><body><h1>Settle disputes in one block</h1><p>Escrow 12,480.00 ADA held on preprod since 09:41 UTC</p>${p.grain ? grain(seed, p.grain) : ''}</body></html>`;

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
// E3: animated grain, 30 frames at 1280x720, each with a new turbulence seed, piped to ffmpeg as lossless FFV1.
async function pipeFrames(id, p, animate) {
  await page.setViewportSize({ width: 1280, height: 720 });
  const out = path.join(OUT, `${id}.720.mkv`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
    '-c:v', 'ffv1', '-pix_fmt', 'rgb24', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < 30; i++) {
    await page.setContent(html(p, animate ? i + 1 : 1));
    const buf = await page.screenshot();
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('piped', id);
}
await pipeFrames('e3-no-grain', PAGES['g2-near-black-subtle'], false);
await pipeFrames('e3-static-grain', PAGES['g5-subtle-plus-grain'], false);
await pipeFrames('e3-animated-grain', PAGES['g5-subtle-plus-grain'], true);
await browser.close();
