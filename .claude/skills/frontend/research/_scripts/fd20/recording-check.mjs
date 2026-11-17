// recording-check.mjs — reference "recording profile" checker for /frontend (dossier FD20).
//
// Renders a page the way a judge will see it (1920x1080 capture, then a 720p and a 540p H.264
// copy, then a projector at 125% and 150% browser zoom) and reports what will not survive.
// Deterministic: the same page, browser build and ffmpeg build give the same report.
//
// Checks (thresholds and their sources are in THRESHOLDS below; codes refer to FD20 findings):
//   text-size    smallest rendered text; x-height in the delivered 720p/540p frame
//   contrast     rendered contrast sampled from the screenshot, plus a projector model
//   hover-only   text that appears only on :hover (CSS scan + a live hover probe) and title= tooltips
//   gradients    dark CSS gradients likely to band; CAMBI on the 720p encode when ffmpeg has libvmaf
//   grain        noise/grain overlays (feTurbulence, noise images), animated or not
//   hairlines    1 px borders whose contrast will fade below visibility at 720p
//   motion       infinite animations, sub-333 ms blinking (flash risk), marquee/ticker motion
//   provenance   visible numbers without a visible data label (live / testnet / simulated) or timestamp
//   zoom         horizontal overflow and key elements pushed out of the first viewport at 125% / 150%
// Outputs in --out: capture-1080.png, capture-720.png, capture-540.png, capture-zoom125.png,
// capture-zoom150.png, report.json, report.md, blind-read-prompt.md.
//
// Usage:
//   node recording-check.mjs --url http://localhost:3000/ [--out ./rec-check] [--wait 1500]
// Environment (optional):
//   PLAYWRIGHT_CORE_PATH  directory of an installed playwright-core package (default: bare import)
//   CHROMIUM_PATH         Chromium/Chrome executable (default: Playwright's resolution)
//   FFMPEG_PATH           ffmpeg executable (default: "ffmpeg" on PATH); without it the 720p/540p
//                         frames are browser-downscaled PNGs and the CAMBI check is skipped.
// Page contract (optional attributes the checker understands):
//   data-rec-role="key"    text a judge must read (claim, proof values, state labels): stricter tier
//   data-rec-role="decor"  decorative text, exempt from size checks
//   data-provenance="live|testnet|simulated|fixture" and data-as-of="<ISO time>" on data regions
// Exit codes: 0 no FAIL, 2 at least one FAIL, 1 error.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const THRESHOLDS = {
  // FD20-F04: in a 720p H.264 copy, OCR read the embedded number exactly in 47-48 of 48 strings at
  // 18 px Inter (x-height 6.6 px delivered), 36-41 of 48 at 16 px (5.8 px) and 19-27 of 48 at 14 px
  // (5.1 px). FAIL below the 16 px level, WARN below the 18 px level. XAG 101 PC minimum: 18 px at 1080p.
  minDeliveredXHeight720: 5.8,
  warnDeliveredXHeight720: 6.5,
  // FD20-F04: in a 540p copy (the video at half size in a slide pane) numbers held in 48 of 48 strings at
  // 24 px Inter (6.6 px delivered) and 36 of 48 at 20 px (5.5 px). Text marked key must survive this tier.
  // XAG 101 console minimum 26 px, Apple tvOS minimum 23 pt, point the same way (FD20-F05).
  minDeliveredXHeight540Key: 6.5,
  // WCAG 2.2 SC 1.4.3 (large text: >= 24 px, or >= 18.66 px bold)
  minContrast: 4.5,
  minContrastLarge: 3,
  // FD20-F17: PISCR minimum system contrast for basic decision making is 15:1 (passive viewing 7:1)
  projectorSystemContrast: 15,
  projectorPassiveContrast: 7,
  // FD20-F09: Netflix CAMBI rule of thumb, "around 5 is where banding starts to become slightly annoying"
  maxCambi: 5,
  // FD20-F09: heuristic from 8 test pages; every gradient whose stops stayed below this luminance banded
  darkGradientMaxLuminance: 0.1,
  minGradientAreaRatio: 0.05,
  // FD20-F11: 1 px lines at <= 1.48:1 fell to <= 1.26:1 at 720p
  hairlineMinContrast: 1.5,
  // WCAG 2.2 SC 2.3.1: no more than three flashes in any one second
  minBlinkPeriodMs: 333,
};

function parseArgs(argv) {
  const a = { out: './rec-check', wait: 1500 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--url') a.url = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--wait') a.wait = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.url) throw new Error('--url is required');
  if (!/^[a-z]+:\/\//i.test(a.url)) a.url = pathToFileURL(resolve(a.url)).href;
  return a;
}

async function loadPlaywright() {
  const p = process.env.PLAYWRIGHT_CORE_PATH;
  const mod = p ? await import(pathToFileURL(join(p, 'index.mjs')).href) : await import('playwright-core');
  return mod.chromium ?? mod.default.chromium;
}

function ffmpegInfo() {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    const enc = execFileSync(bin, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const fil = execFileSync(bin, ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return { bin, x264: /libx264/.test(enc), vmaf: /\blibvmaf\b/.test(fil) };
  } catch { return null; }
}

// Encode the capture as a judge's copy: bicubic downscale, H.264 CRF 23 (x264 default), 4:2:0, BT.709 limited.
function simulate(ff, src, dst, w, h, outDir) {
  const mp4 = join(outDir, `tmp-${h}.mp4`);
  execFileSync(ff.bin, ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', '2', '-i', src, '-vf',
    `scale=${w}:${h}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
    '-c:v', 'libx264', '-crf', '23', mp4]);
  execFileSync(ff.bin, ['-v', 'error', '-y', '-i', mp4, '-vf',
    'select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-frames:v', '1', '-update', '1', dst]);
  let cambi = null;
  if (ff.vmaf) {
    execFileSync(ff.bin, ['-v', 'error', '-y', '-i', mp4, '-i', mp4, '-lavfi',
      '[0:v][1:v]libvmaf=feature=name=cambi:log_path=cambi.json:log_fmt=json', '-f', 'null', '-'], { cwd: outDir });
    const d = JSON.parse(readFileSync(join(outDir, 'cambi.json'), 'utf8'));
    const v = d.frames.map((f) => f.metrics.cambi);
    cambi = Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 1000) / 1000;
    rmSync(join(outDir, 'cambi.json'), { force: true });
  }
  rmSync(mp4, { force: true });
  return cambi;
}

// ---------- in-page analysis (runs inside Chromium) ----------
function pageAnalysis(T) {
  const vw = innerWidth, vh = innerHeight;
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parseColors = (s) => [...s.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  });
  const effectiveBg = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parseColors(getComputedStyle(e).backgroundColor)[0];
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const visible = (el) => el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;

  // font metrics cache: x-height ratio via canvas
  const cv = document.createElement('canvas').getContext('2d');
  const metricCache = new Map();
  const metrics = (cs) => {
    const key = `${cs.fontStyle} ${cs.fontWeight} 1000px ${cs.fontFamily}`;
    if (!metricCache.has(key)) {
      cv.font = key; // measured at 1000 px because Chromium rounds the bounding-box metrics to whole pixels
      const x = cv.measureText('x'), hg = cv.measureText('hg');
      metricCache.set(key, { x: x.actualBoundingBoxAscent / 1000, body: (hg.actualBoundingBoxAscent + hg.actualBoundingBoxDescent) / 1000 });
    }
    return metricCache.get(key);
  };

  // ---- text runs
  const runs = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const m = metrics(cs);
    const roleEl = el.closest('[data-rec-role]');
    const role = roleEl ? roleEl.getAttribute('data-rec-role') : (el.closest('[aria-hidden="true"]') ? 'decor' : 'text');
    const r0 = rects[0];
    runs.push({
      text: text.slice(0, 80), size, weight: Number(cs.fontWeight) || 400, family: cs.fontFamily.split(',')[0].trim(),
      xHeight: +(m.x * size).toFixed(2), bodyHeight: +(m.body * size).toFixed(2), role,
      inFirstViewport: rects.some(inView), rect: { x: r0.x, y: r0.y, w: r0.width, h: r0.height },
    });
  }

  // ---- hover-only CSS rules
  const hoverRules = []; const unreadableSheets = [];
  const walkRules = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !(r instanceof CSSStyleRule)) { walkRules(r.cssRules); continue; }
      if (!(r instanceof CSSStyleRule) || !r.selectorText.includes(':hover')) continue;
      const props = ['display', 'visibility', 'opacity', 'max-height', 'height', 'clip-path', 'transform'].filter((p) => r.style.getPropertyValue(p));
      if (props.length) {
        // trigger = the compound that carries :hover (".card:hover .tip" -> ".card"), used by the live probe
        const triggers = r.selectorText.split(',').map((sel) => {
          const i = sel.indexOf(':hover'); if (i < 0) return null;
          const rest = sel.slice(i + 6); const end = rest.search(/[\s>+~]/);
          return (sel.slice(0, i) + (end < 0 ? rest : rest.slice(0, end))).trim() || '*';
        }).filter(Boolean);
        hoverRules.push({ selector: r.selectorText.slice(0, 160), props, triggers });
      }
      if (r.cssRules && r.cssRules.length) walkRules(r.cssRules);
    }
  };
  for (const sh of document.styleSheets) {
    try { walkRules(sh.cssRules); } catch { unreadableSheets.push(sh.href || '(inline)'); }
  }
  const titles = [...document.querySelectorAll('[title]')].filter((e) => visible(e) && inView(e.getBoundingClientRect()))
    .map((e) => ({ tag: e.tagName.toLowerCase(), title: e.getAttribute('title').slice(0, 80) }));

  // ---- gradients, grain, hairlines
  const gradients = []; const grain = []; const hairlines = [];
  const all = [...document.querySelectorAll('body, body *')];
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!inView(r) || !visible(el)) continue;
    const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (cs.backgroundImage.includes('gradient(') && area / (vw * vh) >= T.minGradientAreaRatio) {
      const base = effectiveBg(el.parentElement || el);
      const own = parseColors(cs.backgroundColor)[0];
      const under = own && own.a > 0 ? own : base;
      const stops = parseColors(cs.backgroundImage).map((c) => {
        const r_ = c.r * c.a + under.r * (1 - c.a), g_ = c.g * c.a + under.g * (1 - c.a), b_ = c.b * c.a + under.b * (1 - c.a);
        return { L: +lum(r_, g_, b_).toFixed(4), Y: Math.round(0.2126 * r_ + 0.7152 * g_ + 0.0722 * b_) };
      });
      if (stops.length) {
        const maxL = Math.max(...stops.map((s) => s.L));
        const ySpan = Math.max(...stops.map((s) => s.Y)) - Math.min(...stops.map((s) => s.Y));
        const span = Math.max(r.width, r.height);
        gradients.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), areaRatio: +(area / (vw * vh)).toFixed(2),
          maxStopLuminance: maxL, lumaCodeSpan: ySpan, pxPerLumaCode: ySpan ? Math.round(span / ySpan) : null,
          dark: maxL < T.darkGradientMaxLuminance });
      }
    }
    const bgi = cs.backgroundImage.toLowerCase();
    if (/feturbulence|noise|grain/.test(bgi) || /(^|[\s-])(noise|grain)([\s-]|$)/.test(String(el.className).toLowerCase())) {
      grain.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), animated: cs.animationName !== 'none', via: 'css' });
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs[`border${side}Style`] === 'none' || parseFloat(cs[`border${side}Width`]) !== 1) continue;
      const bc = parseColors(cs[`border${side}Color`])[0];
      if (!bc) continue;
      const bg = effectiveBg(el);
      const cr_ = bc.r * bc.a + bg.r * (1 - bc.a), cg = bc.g * bc.a + bg.g * (1 - bc.a), cb = bc.b * bc.a + bg.b * (1 - bc.a);
      const l1 = lum(cr_, cg, cb), l2 = lum(bg.r, bg.g, bg.b);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < T.hairlineMinContrast) { hairlines.push({ tag: el.tagName.toLowerCase(), side, contrast: +ratio.toFixed(2) }); break; }
    }
  }
  for (const f of document.querySelectorAll('feTurbulence')) {
    const host = f.closest('svg');
    grain.push({ tag: 'svg', cls: host ? String(host.getAttribute('class') || '') : '', animated: !!f.closest('svg')?.querySelector('animate, animateTransform'), via: 'svg feTurbulence' });
  }

  // ---- motion
  const motion = [];
  for (const a of document.getAnimations()) {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    if (!t) continue;
    const target = a.effect.target;
    const kf = a.effect.getKeyframes ? a.effect.getKeyframes() : [];
    const props = [...new Set(kf.flatMap((k) => Object.keys(k).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))))];
    motion.push({ name: a.animationName || a.transitionProperty || a.constructor.name, target: target ? target.tagName.toLowerCase() + (target.className ? '.' + String(target.className).split(' ')[0] : '') : '',
      durationMs: Number(t.duration) || 0, infinite: t.iterations === Infinity, props,
      blinkRisk: t.iterations === Infinity && (Number(t.duration) || 0) < T.minBlinkPeriodMs && props.some((p) => /opacity|visibility|color|background/i.test(p)) });
  }
  const marquees = document.querySelectorAll('marquee').length;

  // ---- provenance
  const firstViewportText = runs.filter((r) => r.inFirstViewport).map((r) => r.text).join(' • ');
  const hasNumbers = /\d[\d,]*\.\d+|\d{1,3}(,\d{3})+/.test(firstViewportText);
  const label = firstViewportText.match(/\b(simulated|simulation|mock(ed)?|fixture|demo data|sample data|testnet|preprod|pre-prod|devnet|sepolia|holesky|mainnet|live)\b/i);
  const stamp = firstViewportText.match(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b\d{1,2}:\d{2}(:\d{2})?\s?(UTC|GMT|SGT|CET|CEST)\b|\bblock\s#?\d{3,}/i);
  const provenanceAttrs = [...document.querySelectorAll('[data-provenance]')].map((e) => ({ provenance: e.getAttribute('data-provenance'), asOf: e.getAttribute('data-as-of') }));

  return { vw, vh, runs, hoverRules, unreadableSheets, titles, gradients, grain, hairlines, motion, marquees,
    provenance: { hasNumbers, label: label ? label[0] : null, stamp: stamp ? stamp[0] : null, attrs: provenanceAttrs } };
}

// Deterministic frame: finite animations jump to their end state, infinite ones pause on their first
// keyframe (they stay listed by getAnimations, so the motion check still sees them).
function freezeAnimations() {
  for (const a of document.getAnimations()) {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    if (t && t.iterations === Infinity) { a.pause(); a.currentTime = 0; } else { try { a.finish(); } catch { a.pause(); } }
  }
}

// Visible text set, used by the live hover probe.
function visibleTexts() {
  const out = new Set();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
    out.add(t.slice(0, 120));
  }
  return [...out];
}

// Contrast sampled from pixels: background = most frequent colour on a ring just outside the text box,
// foreground = the pixel inside the box farthest in luminance from it (XAG 102: measure against the
// lowest-contrasting area, reported as worst).
async function sampleContrast(browser, pngPath, rects) {
  const page = await browser.newPage();
  const b64 = readFileSync(pngPath).toString('base64');
  await page.setContent(`<img id="i" src="data:image/png;base64,${b64}">`);
  await page.waitForFunction(() => document.getElementById('i').complete);
  const res = await page.evaluate((rects) => {
    const img = document.getElementById('i');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    return rects.map((r) => {
      const x0 = Math.max(0, Math.floor(r.x) - 2), y0 = Math.max(0, Math.floor(r.y) - 2);
      const x1 = Math.min(c.width - 1, Math.ceil(r.x + r.w) + 2), y1 = Math.min(c.height - 1, Math.ceil(r.y + r.h) + 2);
      if (x1 <= x0 || y1 <= y0) return null;
      const d = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data, W = x1 - x0 + 1, H = y1 - y0 + 1;
      const ring = new Map(); const ringL = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (x > 0 && y > 0 && x < W - 1 && y < H - 1) continue;
        const i = (y * W + x) * 4; const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
        ring.set(k, (ring.get(k) || 0) + 1); ringL.push(L([d[i], d[i + 1], d[i + 2]]));
      }
      const bg = [...ring.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
      const bgL = L(bg);
      let fgL = bgL, best = 0;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const i = (y * W + x) * 4; const l = L([d[i], d[i + 1], d[i + 2]]);
        if (Math.abs(l - bgL) > best) { best = Math.abs(l - bgL); fgL = l; }
      }
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const worstBg = ringL.reduce((w, l) => (Math.abs(l - fgL) < Math.abs(w - fgL) ? l : w), bgL);
      return { fgL, bgL, contrast: +ratio(fgL, bgL).toFixed(2), worst: +ratio(fgL, worstBg).toFixed(2) };
    });
  }, rects);
  await page.close();
  return res;
}

// Projector model: black floor 1/C added to both colours (white = 1). WCAG's +0.05 is the C = 21 case.
export function projected(fgL, bgL, C) {
  const f = 1 / C; const a = f + (1 - f) * fgL, b = f + (1 - f) * bgL;
  return +(Math.max(a, b) / Math.min(a, b)).toFixed(2);
}

async function main() {
  const args = parseArgs(process.argv);
  const out = resolve(args.out); mkdirSync(out, { recursive: true });
  const T = THRESHOLDS;
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  const findings = [];
  const add = (severity, check, message, data) => findings.push({ severity, check, message, ...(data ? { data } : {}) });
  try {
    // 1. the 1080p capture, first frame complete at rest
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(args.url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(args.wait);
    await page.evaluate(freezeAnimations);
    const cap = join(out, 'capture-1080.png');
    await page.screenshot({ path: cap });
    const A = await page.evaluate(pageAnalysis, T);

    // 2. text size in the delivered frames
    const scored = A.runs.filter((r) => r.role !== 'decor');
    const smallest = scored.reduce((m, r) => (!m || r.xHeight < m.xHeight ? r : m), null);
    if (smallest) add('INFO', 'text-size', `smallest text: ${smallest.size}px ${smallest.family} (x-height ${smallest.xHeight}px at 1080p, ${(smallest.xHeight * 2 / 3).toFixed(1)}px at 720p) "${smallest.text}"`);
    const fail720 = scored.filter((r) => r.xHeight * 2 / 3 < T.minDeliveredXHeight720);
    if (fail720.length) add('FAIL', 'text-size', `${fail720.length} text runs fall below ${T.minDeliveredXHeight720}px x-height in a 720p copy`, fail720.slice(0, 15).map((r) => ({ text: r.text, size: r.size, xHeight: r.xHeight })));
    const warn720 = scored.filter((r) => r.xHeight * 2 / 3 >= T.minDeliveredXHeight720 && r.xHeight * 2 / 3 < T.warnDeliveredXHeight720);
    if (warn720.length) add('WARN', 'text-size', `${warn720.length} text runs sit between ${T.minDeliveredXHeight720} and ${T.warnDeliveredXHeight720}px x-height in a 720p copy (numbers misread in up to a quarter of OCR trials)`, warn720.slice(0, 15).map((r) => ({ text: r.text, size: r.size, xHeight: r.xHeight })));
    const keyFail = A.runs.filter((r) => r.role === 'key' && r.xHeight * 0.5 < T.minDeliveredXHeight540Key);
    if (keyFail.length) add('FAIL', 'text-size', `${keyFail.length} key runs fall below ${T.minDeliveredXHeight540Key}px x-height when the video plays at half size (540p)`, keyFail.map((r) => ({ text: r.text, size: r.size, xHeight: r.xHeight })));
    if (!A.runs.some((r) => r.role === 'key')) add('WARN', 'text-size', 'no element carries data-rec-role="key"; the stricter tier for claims and proof values was not applied');

    // 3. rendered contrast + projector model (first viewport only)
    const vis = A.runs.filter((r) => r.inFirstViewport).slice(0, 300);
    const cs = await sampleContrast(browser, cap, vis.map((r) => r.rect));
    vis.forEach((r, i) => { r.sampled = cs[i]; });
    const lowC = vis.filter((r) => r.sampled && r.role !== 'decor' && r.sampled.contrast < ((r.size >= 24 || (r.size >= 18.66 && r.weight >= 700)) ? T.minContrastLarge : T.minContrast));
    if (lowC.length) add('FAIL', 'contrast', `${lowC.length} visible text runs below WCAG 1.4.3 contrast on the rendered pixels`, lowC.slice(0, 15).map((r) => ({ text: r.text, contrast: r.sampled.contrast })));
    const projC = vis.filter((r) => r.sampled && r.role !== 'decor').map((r) => ({ text: r.text, size: r.size, wcag: r.sampled.contrast,
      at15: projected(r.sampled.fgL, r.sampled.bgL, T.projectorSystemContrast), at7: projected(r.sampled.fgL, r.sampled.bgL, T.projectorPassiveContrast) }))
      .filter((r) => r.at15 < T.minContrast && r.wcag >= T.minContrast);
    if (projC.length) add('WARN', 'contrast', `${projC.length} runs pass WCAG on screen but drop below ${T.minContrast}:1 on a projector at the ${T.projectorSystemContrast}:1 PISCR floor`, projC.slice(0, 15));

    // 4. hover-only content: CSS scan, title tooltips, live probe
    if (A.hoverRules.length) add('WARN', 'hover-only', `${A.hoverRules.length} :hover rules change display/visibility/opacity/size; content they reveal is invisible in a recording unless the cursor is scripted there`, A.hoverRules.slice(0, 20));
    if (A.titles.length) add('WARN', 'hover-only', `${A.titles.length} visible elements rely on title= tooltips (drawn by the browser outside the page, shown only while the cursor rests)`, A.titles.slice(0, 20));
    if (A.unreadableSheets.length) add('INFO', 'hover-only', `${A.unreadableSheets.length} cross-origin stylesheets could not be scanned`, A.unreadableSheets);
    const base = new Set(await page.evaluate(visibleTexts));
    const triggerSel = ['a', 'button', '[role="button"]', '[tabindex]', 'summary', '[data-tooltip]', '[aria-describedby]', '[title]',
      ...A.hoverRules.flatMap((h) => h.triggers)].join(', ');
    let triggers;
    try { triggers = await page.$$(triggerSel); } catch { triggers = await page.$$('a, button, [role="button"], [tabindex], summary, [data-tooltip], [aria-describedby], [title]'); }
    const revealed = [];
    for (const h of triggers.slice(0, 60)) {
      const box = await h.boundingBox();
      if (!box || box.y > 1080 || box.width < 2) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(350);
      const now = await page.evaluate(visibleTexts);
      const fresh = now.filter((t) => !base.has(t) && t.length >= 3);
      if (fresh.length) revealed.push({ trigger: (await h.evaluate((e) => e.tagName.toLowerCase() + ' ' + (e.textContent || '').trim().slice(0, 40))), reveals: fresh.slice(0, 5) });
      await page.mouse.move(1919, 1079); await page.waitForTimeout(150);
    }
    if (revealed.length) add('FAIL', 'hover-only', `${revealed.length} elements reveal text only on hover; show it at rest or script the hover in the recording`, revealed);

    // 5. gradients and grain
    const dark = A.gradients.filter((g) => g.dark);
    if (dark.length) add('WARN', 'gradients', `${dark.length} large dark gradients (all stops below luminance ${T.darkGradientMaxLuminance}); dark gradients banded after H.264 in every FD20 test`, dark);
    if (A.grain.length) add('WARN', 'grain', `${A.grain.length} grain/noise layers; x264 erased animated grain and static grain did not stop banding after encoding (FD20-F10)`, A.grain);

    // 6. hairlines
    if (A.hairlines.length) add('WARN', 'hairlines', `${A.hairlines.length} elements draw 1 px borders under ${T.hairlineMinContrast}:1; at 720p they fade toward invisible; use 2 px or fills if the line carries structure`, A.hairlines.slice(0, 20));

    // 7. motion
    const loops = A.motion.filter((m) => m.infinite);
    if (loops.length) add('WARN', 'motion', `${loops.length} infinite animations; freeze decorative loops for the recording (they cost bitrate and pull the eye)`, loops.slice(0, 20));
    const blink = A.motion.filter((m) => m.blinkRisk);
    if (blink.length) add('FAIL', 'motion', `${blink.length} animations toggle opacity/colour faster than ${T.minBlinkPeriodMs} ms per cycle: WCAG 2.3.1 flash risk`, blink);
    if (A.marquees) add('WARN', 'motion', `${A.marquees} <marquee> elements`);

    // 8. provenance
    const P = A.provenance;
    if (P.hasNumbers && !P.label && !P.attrs.length) add('WARN', 'provenance', 'numbers are visible in the first viewport but no data label (live / testnet / preprod / simulated) is visible');
    if (P.hasNumbers && !P.stamp) add('WARN', 'provenance', 'no visible timestamp or block height next to the data in the first viewport');
    add('INFO', 'provenance', `label: ${P.label || 'none'}; stamp: ${P.stamp || 'none'}; data-provenance attributes: ${P.attrs.length}`, P.attrs.slice(0, 10));
    await ctx.close();

    // 9. delivered frames and CAMBI
    const ff = ffmpegInfo();
    if (ff && ff.x264) {
      const c720 = simulate(ff, cap, join(out, 'capture-720.png'), 1280, 720, out);
      simulate(ff, cap, join(out, 'capture-540.png'), 960, 540, out);
      if (c720 !== null) {
        add(c720 > T.maxCambi ? 'FAIL' : 'INFO', 'gradients', `CAMBI on the 720p H.264 copy: ${c720} (threshold ${T.maxCambi})`);
      } else add('INFO', 'gradients', 'ffmpeg has no libvmaf: CAMBI skipped');
    } else {
      add('WARN', 'frames', 'ffmpeg with libx264 not found: 720p/540p frames are browser-downscaled PNGs without codec loss');
      const p2 = await browser.newPage();
      const b64 = readFileSync(cap).toString('base64');
      for (const [w, h] of [[1280, 720], [960, 540]]) {
        await p2.setViewportSize({ width: w, height: h });
        await p2.setContent(`<body style="margin:0"><img src="data:image/png;base64,${b64}" style="width:${w}px;height:${h}px;display:block"></body>`);
        await p2.screenshot({ path: join(out, `capture-${h}.png`) });
      }
      await p2.close();
    }

    // 10. projector zoom: same 1920x1080 device pixels at 125% and 150% browser zoom
    for (const z of [1.25, 1.5]) {
      const zctx = await browser.newContext({ viewport: { width: Math.round(1920 / z), height: Math.round(1080 / z) }, deviceScaleFactor: z });
      const zp = await zctx.newPage();
      await zp.goto(args.url, { waitUntil: 'networkidle' });
      await zp.waitForTimeout(args.wait);
      await zp.evaluate(freezeAnimations);
      await zp.screenshot({ path: join(out, `capture-zoom${Math.round(z * 100)}.png`) });
      const zr = await zp.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth - innerWidth,
        keysBelowFold: [...document.querySelectorAll('[data-rec-role="key"]')].filter((e) => e.getBoundingClientRect().top > innerHeight).map((e) => e.textContent.trim().slice(0, 60)),
      }));
      if (zr.overflowX > 1) add('FAIL', 'zoom', `at ${Math.round(z * 100)}% zoom the page scrolls sideways by ${zr.overflowX} CSS px`);
      if (zr.keysBelowFold.length) add('WARN', 'zoom', `at ${Math.round(z * 100)}% zoom ${zr.keysBelowFold.length} key elements leave the first viewport`, zr.keysBelowFold);
      await zctx.close();
    }
  } finally {
    await browser.close();
  }
  const fails = findings.filter((f) => f.severity === 'FAIL').length;
  const report = { url: args.url, generated: new Date().toISOString(), thresholds: T, findings };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  const md = ['# Recording check', '', `URL: ${args.url}`, '', '| severity | check | message |', '|---|---|---|',
    ...findings.map((f) => `| ${f.severity} | ${f.check} | ${f.message.replace(/\|/g, '/')} |`)].join('\n');
  writeFileSync(join(out, 'report.md'), md + '\n');
  writeFileSync(join(out, 'blind-read-prompt.md'), [
    '# Blind read (run in a fresh subagent that has not seen the brief or the code)',
    '',
    'Open only `capture-540.png` (a 960x540 frame: the first frame of the demo video playing at half size in a slide).',
    'Answer in at most five lines, without guessing beyond what is on screen:',
    '1. What is this product, in one sentence?',
    '2. What does it do for its user?',
    '3. What evidence on screen shows that it works (quote the values you can read)?',
    '4. Is the data live, testnet or simulated, and as of when? Quote the label.',
    '5. What could a newcomer to blockchain not understand here?',
    '',
    'Scoring: compare answers 1 to 4 with the brief. This check is one-way: a model reads small degraded text',
    'better than a person at projector distance (FD20-F07), so a pass does not prove legibility; the',
    'text-size gate does that. A failure here means the frame does not carry the message.',
  ].join('\n') + '\n');
  console.log(md);
  process.exitCode = fails ? 2 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
