import { chromium } from "playwright-core";
import fs from "node:fs";

const OUT = "C:/Users/Utilisateur/AppData/Local/Temp/fe-art";
fs.mkdirSync(OUT, { recursive: true });
const W = 1000;
const f = (n) => Math.round(n * 10) / 10;

// isometric grid (2:1), faded by a radial mask
let grid = "";
for (let c = -1200; c <= 1600; c += 56) {
  grid += `<line x1="0" y1="${f(c)}" x2="${W}" y2="${f(c + W * 0.5)}"/>`;
  grid += `<line x1="0" y1="${f(c)}" x2="${W}" y2="${f(c - W * 0.5)}"/>`;
}

// cube (2:1 iso), base centre (cx, by), half-width a, half-depth a/2, height H
const cx = 500, by = 700, a = 150, H = 178;
const ty = by - H;
const P = {
  L: [cx - a, ty], B: [cx, ty + a / 2], R: [cx + a, ty], K: [cx, ty - a / 2],
  Ld: [cx - a, by], Bd: [cx, by + a / 2], Rd: [cx + a, by],
};
const pt = (p) => `${f(p[0])},${f(p[1])}`;
const poly = (...ps) => ps.map(pt).join(" ");

function facePoint(start, end, u, v) {
  return [start[0] + (end[0] - start[0]) * u, start[1] + (end[1] - start[1]) * u + H * v];
}
function traces(start, end, shift) {
  let s = "";
  [0.26, 0.48, 0.7].forEach((v, i) => {
    const u0 = 0.14 + ((i + shift) % 2) * 0.1;
    const u1 = 0.62 + ((i + shift) % 2) * 0.14;
    const p0 = facePoint(start, end, u0, v);
    const p1 = facePoint(start, end, u1, v);
    const p2 = facePoint(start, end, u1, v + 0.1);
    s += `<polyline fill="none" points="${poly(p0, p1, p2)}"/>`;
    s += `<rect x="${f(p2[0] - 2.5)}" y="${f(p2[1] - 2.5)}" width="5" height="5" rx="1"/>`;
    s += `<circle cx="${f(p0[0])}" cy="${f(p0[1])}" r="2.6"/>`;
  });
  return s;
}
const rh = (s) => poly([cx - a * s, ty], [cx, ty + (a / 2) * s], [cx + a * s, ty], [cx, ty - (a / 2) * s]);

const ICON = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h6M9.5 15.5h6M9.5 19h4"/>',
  chart: '<path d="M4 20h16M7 17v-5M12 17V7M17 17v-8"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.8 7l8.2 6.2L20.2 7"/>',
  note: '<path d="M4.5 19.5l1-4.2L16 4.8a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z"/><path d="M14.5 6.3l3.2 3.2M4.5 19.5h6"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/><circle cx="9" cy="14.5" r=".9"/><circle cx="12" cy="14.5" r=".9"/><circle cx="15" cy="14.5" r=".9"/>',
  chat: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.6-4.2 4.4-6.2 7.5-6.2s5.9 2 7.5 6.2"/>',
};
const LOCK = '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11"/>';

const tiles = [
  { k: "globe", x: 190, y: 300, team: "co", to: [cx - a * 0.55, ty - 18] },
  { k: "doc", x: 360, y: 150, team: "co", to: [cx - a * 0.18, ty - a * 0.42] },
  { k: "chart", x: 130, y: 520, team: "co", to: [cx - a, ty + 40] },
  { k: "mail", x: 175, y: 760, team: "co", to: [cx - a * 0.72, by - 22] },
  { k: "note", x: 640, y: 150, team: "me", to: [cx + a * 0.18, ty - a * 0.42] },
  { k: "cal", x: 810, y: 300, team: "me", to: [cx + a * 0.55, ty - 18] },
  { k: "chat", x: 870, y: 520, team: "me", to: [cx + a, ty + 40] },
  { k: "person", x: 825, y: 760, team: "me", to: [cx + a * 0.72, by - 22] },
];
const T = 96;
const bez = (from, mid, to, s) => [
  (1 - s) ** 2 * from[0] + 2 * (1 - s) * s * mid[0] + s * s * to[0],
  (1 - s) ** 2 * from[1] + 2 * (1 - s) * s * mid[1] + s * s * to[1],
];
let lines = "", glowLines = "", tileSvg = "", locks = "", dots = "";
for (const t of tiles) {
  const from = [t.x, t.y];
  const mid = [(from[0] + t.to[0]) / 2, (from[1] + t.to[1]) / 2 - 26];
  const d = `M${pt(from)} Q${pt(mid)} ${pt(t.to)}`;
  if (t.team === "co") {
    glowLines += `<path d="${d}" stroke="#5c99ff" stroke-width="6" opacity=".35"/>`;
    lines += `<path d="${d}" stroke="#7fb2ff" stroke-width="2.2"/>`;
    for (const s of [0.32, 0.68]) {
      const q = bez(from, mid, t.to, s);
      dots += `<circle cx="${f(q[0])}" cy="${f(q[1])}" r="3.4" fill="#eef4ff" filter="url(#glow)"/>`;
    }
  } else {
    lines += `<path d="${d}" stroke="#c8bef9" stroke-width="2.2" stroke-dasharray="7 8" opacity=".9"/>`;
    const q = bez(from, mid, t.to, 0.56);
    locks += `<g transform="translate(${f(q[0] - 17)},${f(q[1] - 17)})"><circle cx="17" cy="17" r="17" fill="#2a1d18" stroke="#e9ab86" stroke-width="2"/><g transform="translate(5,4.5)" fill="none" stroke="#f3c3a6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${LOCK}</g></g>`;
  }
  const col = t.team === "co" ? "#7fb2ff" : "#c8bef9";
  const fill = t.team === "co" ? "url(#tileCo)" : "url(#tileMe)";
  tileSvg += `<g transform="translate(${f(t.x - T / 2)},${f(t.y - T / 2)})">
    <rect x="-6" y="-6" width="${T + 12}" height="${T + 12}" rx="30" fill="${col}" opacity=".2" filter="url(#soft)"/>
    <rect width="${T}" height="${T}" rx="24" fill="${fill}" stroke="${col}" stroke-width="2"/>
    <rect x="1.5" y="1.5" width="${T - 3}" height="${(T - 3) / 2}" rx="18" fill="#ffffff" opacity=".05"/>
    <g transform="translate(${T / 2 - 25.2},${T / 2 - 25.2}) scale(2.1)" fill="none" stroke="#f1f3ff" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${ICON[t.k]}</g>
  </g>`;
}
const sparks = [[120,180],[860,140],[930,380],[70,360],[180,820],[820,820],[560,90],[440,880],[640,860],[330,420],[690,420],[900,650],[95,640]]
  .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.2 : 1.4}" fill="#c8d6ff" opacity="${i % 2 ? 0.45 : 0.7}"/>`)
  .join("");
const ring = (rx, stroke, width, op, dash = "") =>
  `<ellipse cx="${cx}" cy="${by + 8}" rx="${rx}" ry="${rx / 2}" stroke="${stroke}" stroke-width="${width}" opacity="${op}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" fill="none">
<defs>
  <radialGradient id="bg" cx="500" cy="520" r="640" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#241b5c"/><stop offset=".5" stop-color="#0f1031"/><stop offset="1" stop-color="#05060f"/>
  </radialGradient>
  <radialGradient id="pool" cx="500" cy="708" r="300" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#836ef9" stop-opacity=".55"/><stop offset="1" stop-color="#836ef9" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="fade" cx="500" cy="560" r="520" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
  </radialGradient>
  <mask id="gridMask"><rect width="${W}" height="${W}" fill="url(#fade)"/></mask>
  <linearGradient id="faceL" x1="0" y1="${ty}" x2="0" y2="${by + a / 2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2d2672"/><stop offset="1" stop-color="#141236"/></linearGradient>
  <linearGradient id="faceR" x1="0" y1="${ty}" x2="0" y2="${by + a / 2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1f1c55"/><stop offset="1" stop-color="#0c0b26"/></linearGradient>
  <linearGradient id="faceT" x1="${cx - a}" y1="${ty}" x2="${cx + a}" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3b3396"/><stop offset="1" stop-color="#2a2475"/></linearGradient>
  <linearGradient id="tileCo" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a2c63"/><stop offset="1" stop-color="#0d1536"/></linearGradient>
  <linearGradient id="tileMe" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2c2163"/><stop offset="1" stop-color="#160f38"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="glowBig" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
  <linearGradient id="beam" x1="0" y1="70" x2="0" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#836ef9" stop-opacity="0"/><stop offset="1" stop-color="#a99bff" stop-opacity=".55"/></linearGradient>
  <linearGradient id="beamCore" x1="0" y1="90" x2="0" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity=".45"/></linearGradient>
  <clipPath id="card"><rect width="${W}" height="${W}" rx="64"/></clipPath>
</defs>
<g clip-path="url(#card)">
  <rect width="${W}" height="${W}" fill="url(#bg)"/>
  <g stroke="#4b52a3" stroke-width="1" opacity=".22" mask="url(#gridMask)">${grid}</g>
  <ellipse cx="${cx}" cy="${by + 8}" rx="330" ry="150" fill="url(#pool)"/>
  ${ring(400, "#5c99ff", 1.4, 0.22, "3 12")}
  ${ring(320, "#5c99ff", 1.6, 0.38)}
  ${ring(250, "#836ef9", 2, 0.55, "14 9")}
  <g filter="url(#glow)">${ring(190, "#a99bff", 2.4, 0.9)}</g>
  <g fill="none" stroke-linecap="round">${glowLines}</g>
  <g fill="none" stroke-linecap="round" filter="url(#glow)">${lines}</g>
  <rect x="${cx - 38}" y="70" width="76" height="${ty - 70}" fill="url(#beam)" filter="url(#soft)"/>
  <rect x="${cx - 4}" y="90" width="8" height="${ty - 90}" fill="url(#beamCore)"/>
  <polygon points="${poly(P.L, P.B, P.Bd, P.Ld)}" fill="url(#faceL)"/>
  <polygon points="${poly(P.B, P.R, P.Rd, P.Bd)}" fill="url(#faceR)"/>
  <polygon points="${poly(P.K, P.R, P.B, P.L)}" fill="url(#faceT)"/>
  <g stroke="#8f7dff" stroke-width="1.3" opacity=".55" fill="#8f7dff">${traces(P.L, P.B, 0)}</g>
  <g stroke="#6ea8ff" stroke-width="1.3" opacity=".45" fill="#6ea8ff">${traces(P.B, P.R, 1)}</g>
  <g filter="url(#glowBig)" opacity=".55"><polygon points="${rh(1)}" stroke="#a99bff" stroke-width="3"/></g>
  <polygon points="${rh(0.72)}" stroke="#c8bef9" stroke-width="1.4" opacity=".55"/>
  <polygon points="${rh(0.46)}" stroke="#c8bef9" stroke-width="1.6" opacity=".8"/>
  <g filter="url(#glowBig)"><polygon points="${rh(0.18)}" fill="#f4f1ff"/></g>
  <g filter="url(#glow)" stroke="#d9d2ff" stroke-width="2.2" stroke-linejoin="round" fill="none">
    <polyline points="${poly(P.L, P.K, P.R)}"/>
    <polyline points="${poly(P.L, P.B, P.R)}"/>
    <polyline points="${poly(P.L, P.Ld, P.Bd, P.Rd, P.R)}"/>
    <line x1="${P.B[0]}" y1="${P.B[1]}" x2="${P.Bd[0]}" y2="${P.Bd[1]}"/>
  </g>
  ${dots}
  ${sparks}
  ${tileSvg}
  ${locks}
</g>
<rect x="1" y="1" width="${W - 2}" height="${W - 2}" rx="63" stroke="#c8bef9" stroke-opacity=".22" stroke-width="2"/>
</svg>`;

fs.writeFileSync(`${OUT}/context.svg`, svg);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: W }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: `${OUT}/context.png`, omitBackground: true });
const preview = await browser.newPage({ viewport: { width: 520, height: 520 } });
const b64 = fs.readFileSync(`${OUT}/context.png`).toString("base64");
await preview.setContent(`<html><body style="margin:0;display:grid;place-items:center;height:520px;background:#f5f7fc"><img src="data:image/png;base64,${b64}" style="width:360px"></body></html>`);
await preview.screenshot({ path: `${OUT}/context-preview.png` });
await browser.close();
console.log("ok", fs.statSync(`${OUT}/context.png`).size);
