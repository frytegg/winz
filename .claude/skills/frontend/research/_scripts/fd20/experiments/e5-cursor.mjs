// E5: does a Playwright recordVideo capture show the mouse pointer? Plain grey page, mouse moved along a path.
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const OUT = path.resolve('out/e5'); mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.setContent('<body style="margin:0;background:#808080;height:720px"></body>');
await page.waitForTimeout(300);
for (let i = 0; i <= 40; i++) {
  await page.mouse.move(100 + i * 25, 100 + i * 12);
  await page.waitForTimeout(40);
}
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(300);
await ctx.close(); await browser.close();
const webm = readdirSync(OUT).find((f) => f.endsWith('.webm'));
renameSync(path.join(OUT, webm), path.join(OUT, 'cursor-test.webm'));
// Count non-grey pixels over all frames: a rendered pointer would add black/white pixels.
const stats = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(OUT, 'cursor-test.webm'), '-vf',
  'format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMIN:file=-', '-f', 'null', '-']).toString();
const ymins = [...stats.matchAll(/YMIN=(\d+)/g)].map((m) => Number(m[1]));
const ymaxStats = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(OUT, 'cursor-test.webm'), '-vf',
  'format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-', '-f', 'null', '-']).toString();
const ymaxs = [...ymaxStats.matchAll(/YMAX=(\d+)/g)].map((m) => Number(m[1]));
console.log('frames', ymins.length, 'min YMIN', Math.min(...ymins), 'max YMAX', Math.max(...ymaxs));
