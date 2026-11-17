import { chromium } from "playwright-core";
import fs from "node:fs";

// Badge context illustration, transparent: the objects float on the page, like the Ledger device further down.
// Two variants of one drawing: "light" for the paper ground, "dark" for the dark theme.
const OUT = "C:/Users/Utilisateur/AppData/Local/Temp/fe-art";
fs.mkdirSync(OUT, { recursive: true });
const W = 1000;
const f = (n) => Math.round(n * 10) / 10;

const THEMES = {
  light: {
    coLine: "#2f62d9", coGlow: "#5c99ff", coGlowOp: 0.16, coDot: "#2f62d9", coDotStroke: "#ffffff",
    meLine: "#7255c9", meOp: 0.95,
    lockFill: "#fff3ea", lockStroke: "#d98d60", lockIcon: "#b9673d",
    tileCo: "#7fb2ff", tileMe: "#b6a8f5", tileHalo: "shadow",
    pool: "#8f7dff", poolOp: 0.32,
    rings: [["#2f62d9", 1.4, 0.22, "3 12"], ["#2f62d9", 1.6, 0.32, ""], ["#7255c9", 2, 0.5, "14 9"], ["#8f7dff", 2.6, 0.85, ""]],
    beam: "#8f7dff", beamOp: 0.28, beamCore: false,
    sparks: false, shadowOp: 0.28,
  },
  dark: {
    coLine: "#7fb2ff", coGlow: "#5c99ff", coGlowOp: 0.35, coDot: "#eef4ff", coDotStroke: "none",
    meLine: "#c8bef9", meOp: 0.9,
    lockFill: "#2a1d18", lockStroke: "#e9ab86", lockIcon: "#f3c3a6",
    tileCo: "#7fb2ff", tileMe: "#c8bef9", tileHalo: "glow",
    pool: "#836ef9", poolOp: 0.55,
    rings: [["#5c99ff", 1.4, 0.22, "3 12"], ["#5c99ff", 1.6, 0.38, ""], ["#836ef9", 2, 0.55, "14 9"], ["#a99bff", 2.4, 0.9, ""]],
    beam: "#a99bff", beamOp: 0.55, beamCore: true,
    sparks: true, shadowOp: 0.0,
  },
};

const cx = 500, by = 700, a = 150, H = 178;
const ty = by - H;
const P = {
  L: [cx - a, ty], B: [cx, ty + a / 2], R: [cx + a, ty], K: [cx, ty - a / 2],
  Ld: [cx - a, by], Bd: [cx, by + a / 2], Rd: [cx + a, by],
};
const pt = (p) => `${f(p[0])},${f(p[1])}`;
const poly = (...ps) => ps.map(pt).join(" ");
const facePoint = (s, e, u, v) => [s[0] + (e[0] - s[0]) * u, s[1] + (e[1] - s[1]) * u + H * v];
function traces(start, end, shift) {
  let s = "";
  [0.26, 0.48, 0.7].forEach((v, i) => {
    const u0 = 0.14 + ((i + shift) % 2) * 0.1;
    const u1 = 0.62 + ((i + shift) % 2) * 0.14;
    const p0 = facePoint(start, end, u0, v), p1 = facePoint(start, end, u1, v), p2 = facePoint(start, end, u1, v + 0.1);
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
const bez = (s0, m, e, s) => [
  (1 - s) ** 2 * s0[0] + 2 * (1 - s) * s * m[0] + s * s * e[0],
  (1 - s) ** 2 * s0[1] + 2 * (1 - s) * s * m[1] + s * s * e[1],
];

function draw(th) {
  const t = THEMES[th];
  let lines = "", glowLines = "", tileSvg = "", locks = "", dots = "";
  for (const tile of tiles) {
    const from = [tile.x, tile.y];
    const mid = [(from[0] + tile.to[0]) / 2, (from[1] + tile.to[1]) / 2 - 26];
    const d = `M${pt(from)} Q${pt(mid)} ${pt(tile.to)}`;
    if (tile.team === "co") {
      glowLines += `<path d="${d}" stroke="${t.coGlow}" stroke-width="7" opacity="${t.coGlowOp}"/>`;
      lines += `<path d="${d}" stroke="${t.coLine}" stroke-width="2.6"/>`;
      for (const s of [0.32, 0.68]) {
        const q = bez(from, mid, tile.to, s);
        dots += `<circle cx="${f(q[0])}" cy="${f(q[1])}" r="4" fill="${t.coDot}" stroke="${t.coDotStroke}" stroke-width="1.5"${th === "dark" ? ' filter="url(#glow)"' : ""}/>`;
      }
    } else {
      lines += `<path d="${d}" stroke="${t.meLine}" stroke-width="2.6" stroke-dasharray="8 8" opacity="${t.meOp}"/>`;
      const q = bez(from, mid, tile.to, 0.56);
      locks += `<g transform="translate(${f(q[0] - 18)},${f(q[1] - 18)})"><circle cx="18" cy="18" r="18" fill="${t.lockFill}" stroke="${t.lockStroke}" stroke-width="2.2"/><g transform="translate(6,5.2)" fill="none" stroke="${t.lockIcon}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${LOCK}</g></g>`;
    }
    const col = tile.team === "co" ? t.tileCo : t.tileMe;
    const fill = tile.team === "co" ? "url(#tileCo)" : "url(#tileMe)";
    const halo = t.tileHalo === "glow"
      ? `<rect x="-6" y="-6" width="${T + 12}" height="${T + 12}" rx="30" fill="${col}" opacity=".2" filter="url(#soft)"/>`
      : `<rect x="4" y="14" width="${T - 8}" height="${T - 4}" rx="26" fill="#141535" opacity=".28" filter="url(#soft)"/>`;
    tileSvg += `<g transform="translate(${f(tile.x - T / 2)},${f(tile.y - T / 2)})">${halo}
      <rect width="${T}" height="${T}" rx="24" fill="${fill}" stroke="${col}" stroke-width="2"/>
      <rect x="1.5" y="1.5" width="${T - 3}" height="${(T - 3) / 2}" rx="22" fill="#ffffff" opacity=".06"/>
      <g transform="translate(${T / 2 - 25.2},${T / 2 - 25.2}) scale(2.1)" fill="none" stroke="#f1f3ff" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${ICON[tile.k]}</g>
    </g>`;
  }
  const sparks = t.sparks
    ? [[120,180],[860,140],[930,380],[70,360],[180,880],[820,880],[560,90],[440,920],[640,900],[330,420],[690,420],[930,650],[75,640]]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.2 : 1.4}" fill="#c8d6ff" opacity="${i % 2 ? 0.45 : 0.7}"/>`).join("")
    : "";
  const ring = ([stroke, width, op, dash], rx) =>
    `<ellipse cx="${cx}" cy="${by + 8}" rx="${rx}" ry="${rx / 2}" stroke="${stroke}" stroke-width="${width}" opacity="${op}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
  const [r1, r2, r3, r4] = t.rings;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" fill="none">
<defs>
  <radialGradient id="pool" cx="500" cy="708" r="300" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${t.pool}" stop-opacity="${t.poolOp}"/><stop offset="1" stop-color="${t.pool}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="shadow" cx="500" cy="${by + 60}" r="230" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#141535" stop-opacity="${t.shadowOp}"/><stop offset="1" stop-color="#141535" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="faceL" x1="0" y1="${ty}" x2="0" y2="${by + a / 2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2d2672"/><stop offset="1" stop-color="#141236"/></linearGradient>
  <linearGradient id="faceR" x1="0" y1="${ty}" x2="0" y2="${by + a / 2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1f1c55"/><stop offset="1" stop-color="#0c0b26"/></linearGradient>
  <linearGradient id="faceT" x1="${cx - a}" y1="${ty}" x2="${cx + a}" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3b3396"/><stop offset="1" stop-color="#2a2475"/></linearGradient>
  <linearGradient id="tileCo" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a2c63"/><stop offset="1" stop-color="#0d1536"/></linearGradient>
  <linearGradient id="tileMe" x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2c2163"/><stop offset="1" stop-color="#160f38"/></linearGradient>
  <linearGradient id="beam" x1="0" y1="70" x2="0" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${t.beam}" stop-opacity="0"/><stop offset="1" stop-color="${t.beam}" stop-opacity="${t.beamOp}"/></linearGradient>
  <linearGradient id="beamCore" x1="0" y1="90" x2="0" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity=".45"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="glowBig" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
</defs>
  <ellipse cx="${cx}" cy="${by + 8}" rx="330" ry="150" fill="url(#pool)"/>
  ${ring(r1, 400)}${ring(r2, 320)}${ring(r3, 250)}
  <g${th === "dark" ? ' filter="url(#glow)"' : ""}>${ring(r4, 190)}</g>
  <g fill="none" stroke-linecap="round">${glowLines}</g>
  <g fill="none" stroke-linecap="round"${th === "dark" ? ' filter="url(#glow)"' : ""}>${lines}</g>
  <ellipse cx="${cx}" cy="${by + 58}" rx="230" ry="70" fill="url(#shadow)"/>
  <rect x="${cx - 38}" y="70" width="76" height="${ty - 70}" fill="url(#beam)" filter="url(#soft)"/>
  ${t.beamCore ? `<rect x="${cx - 4}" y="90" width="8" height="${ty - 90}" fill="url(#beamCore)"/>` : ""}
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
    <polyline points="${poly(P.L, P.K, P.R)}"/><polyline points="${poly(P.L, P.B, P.R)}"/>
    <polyline points="${poly(P.L, P.Ld, P.Bd, P.Rd, P.R)}"/>
    <line x1="${P.B[0]}" y1="${P.B[1]}" x2="${P.Bd[0]}" y2="${P.Bd[1]}"/>
  </g>
  ${dots}${sparks}${tileSvg}${locks}
</svg>`;
}

const browser = await chromium.launch();
for (const th of ["light", "dark"]) {
  const svg = draw(th);
  fs.writeFileSync(`${OUT}/context-${th}.svg`, svg);
  const page = await browser.newPage({ viewport: { width: W, height: W } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: `${OUT}/context-${th}.png`, omitBackground: true });
  const ground = th === "light" ? "#f5f7fc" : "#0b0d17";
  const b64 = fs.readFileSync(`${OUT}/context-${th}.png`).toString("base64");
  const pv = await browser.newPage({ viewport: { width: 560, height: 560 } });
  await pv.setContent(`<html><body style="margin:0;display:grid;place-items:center;height:560px;background:${ground}"><img src="data:image/png;base64,${b64}" style="width:520px"></body></html>`);
  await pv.screenshot({ path: `${OUT}/preview-${th}.png` });
  console.log(th, fs.statSync(`${OUT}/context-${th}.png`).size);
}
await browser.close();
