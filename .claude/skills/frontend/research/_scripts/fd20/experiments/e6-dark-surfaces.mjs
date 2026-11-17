// E6: dark-UI surface steps after a correct 720p encode and after a range mismatch
// (full-range pixels tagged as limited range, the classic "crushed blacks" recording fault).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const OUT = path.resolve('out/e6'); mkdirSync(OUT, { recursive: true });
const SURF = ['#0a0a0a', '#0f0f0f', '#111111', '#141414', '#18181b', '#1f1f23', '#27272a', '#3f3f46'];
const html = `<!doctype html><html><body style="margin:0;background:#000;width:1920px;height:1080px;display:grid;grid-template-columns:repeat(8,240px)">
${SURF.map((c) => `<div style="background:${c};height:1080px"></div>`).join('')}</body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
await page.setContent(html);
const src = path.join(OUT, 'surfaces.png');
await page.screenshot({ path: src });
await browser.close();
const enc = (name, range, tag) => {
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', '2', '-i', src, '-vf',
    `scale=1280:720:flags=bicubic:out_color_matrix=bt709:out_range=${range},format=yuv420p`, '-c:v', 'libx264', '-crf', '23',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', tag, mp4]);
  // decode as a player would: trust the tag
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=${tag}:out_range=pc,format=rgb24`,
    '-frames:v', '1', '-update', '1', path.join(OUT, `${name}.png`)]);
};
enc('correct', 'tv', 'tv');       // limited-range pixels, tagged limited
enc('mismatch', 'pc', 'tv');      // full-range pixels, tagged limited -> player stretches: blacks crush
writeFileSync(path.join(OUT, 'surfaces.json'), JSON.stringify(SURF));
console.log('done');
