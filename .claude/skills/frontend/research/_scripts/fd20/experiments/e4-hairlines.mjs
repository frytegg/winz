// E4: what happens to 1 px borders and dividers after a 1080p -> 720p (and 540p) H.264 encode.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const OUT = path.resolve('out/e4'); mkdirSync(OUT, { recursive: true });
const LINES = [
  { id: 'gray200-on-white-1px', bg: '#ffffff', c: '#e5e7eb', w: 1 },
  { id: 'gray300-on-white-1px', bg: '#ffffff', c: '#d1d5db', w: 1 },
  { id: 'gray200-on-white-2px', bg: '#ffffff', c: '#e5e7eb', w: 2 },
  { id: 'gray400-on-white-1px', bg: '#ffffff', c: '#9ca3af', w: 1 },
  { id: 'white8-on-dark-1px', bg: '#0a0a0a', c: 'rgba(255,255,255,0.08)', w: 1 },
  { id: 'white15-on-dark-1px', bg: '#0a0a0a', c: 'rgba(255,255,255,0.15)', w: 1 },
  { id: 'white15-on-dark-2px', bg: '#0a0a0a', c: 'rgba(255,255,255,0.15)', w: 2 },
  { id: 'zinc700-on-dark-1px', bg: '#0a0a0a', c: '#3f3f46', w: 1 },
];
const html = `<!doctype html><html><body style="margin:0;width:1920px;height:1080px;display:grid;grid-template-columns:repeat(8,240px)">
${LINES.map((l) => `<div style="background:${l.bg};height:1080px;position:relative">${Array.from({ length: 12 }, (_, i) =>
  `<div style="position:absolute;left:20px;right:20px;top:${60 + i * 83}px;height:0;border-top:${l.w}px solid ${l.c}"></div>`).join('')}</div>`).join('')}
</body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
await page.setContent(html);
const src = path.join(OUT, 'lines.png');
await page.screenshot({ path: src });
await browser.close();
for (const [w, h] of [[1280, 720], [960, 540]]) {
  const mp4 = path.join(OUT, `lines.${h}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', '2', '-i', src, '-vf',
    `scale=${w}:${h}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-crf', '23',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', mp4]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', 'select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24',
    '-frames:v', '1', '-update', '1', path.join(OUT, `lines.${h}.png`)]);
}
writeFileSync(path.join(OUT, 'lines.json'), JSON.stringify(LINES));
console.log('done');
