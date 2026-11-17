// @ts-check

/**
 * @typedef {{r: number, g: number, b: number, a: number}} Rgba sRGB, gamma-encoded, each channel and alpha in 0..1
 * @typedef {{r: number, g: number, b: number}} Rgb
 * @typedef {{l: number, c: number, h: number}} Oklch
 */

/** Chroma below which a colour counts as grey and has no hue (OKLCH units). */
export const ACHROMATIC_CHROMA = 0.03;

const NAMED_HEX =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 ' +
  'black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 ' +
  'cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc ' +
  'crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 ' +
  'darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f ' +
  'darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
  'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 ' +
  'deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 ' +
  'floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 ' +
  'goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 ' +
  'indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 ' +
  'lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
  'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 ' +
  'lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 ' +
  'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff ' +
  'maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db ' +
  'mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc ' +
  'mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 ' +
  'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 ' +
  'orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 ' +
  'papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 ' +
  'rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
  'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb ' +
  'slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 ' +
  'tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 ' +
  'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';

/** The 148 CSS named colours, name to 6-digit hex. */
export const NAMED_COLORS = Object.freeze(
  Object.fromEntries(NAMED_HEX.split(' ').map((pair) => /** @type {[string, string]} */ (pair.split(':')))),
);

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[Vec3, Vec3, Vec3]} Mat3 */

/** @type {Mat3} */
const XYZ65_TO_LINEAR_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
/** @type {Mat3} */
const LINEAR_SRGB_TO_XYZ65 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
/** @type {Mat3} */
const D50_TO_D65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
/** @type {Mat3} */
const LINEAR_P3_TO_XYZ65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
/** @type {Mat3} */
const LINEAR_REC2020_TO_XYZ65 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
/** @type {Mat3} */
const LINEAR_A98_TO_XYZ65 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
/** @type {Mat3} */
const LINEAR_PROPHOTO_TO_XYZ50 = [
  [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
  [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
  [0, 0, 0.8251046025104601],
];
/** D50 white point, XYZ with Y = 1. */
const D50_WHITE = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/**
 * @param {Mat3} m @param {Vec3} v @returns {Vec3}
 */
function mul(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** @param {number} c @returns {number} sRGB transfer, extended to negative values */
function srgbToLinear(c) {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
}

/** @param {number} c @returns {number} */
function linearToSrgb(c) {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055);
}

/** @param {Vec3} xyz65 @returns {Vec3} gamma-encoded sRGB, unclipped */
function xyz65ToSrgb(xyz65) {
  const lin = mul(XYZ65_TO_LINEAR_SRGB, xyz65);
  return [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
}

/** @param {number} L @param {number} a @param {number} b @returns {Vec3} */
function oklabToLinearSrgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** @param {Vec3} lin linear sRGB @returns {Vec3} OKLab */
function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** @param {number} L @param {number} a @param {number} b @returns {Vec3} CIE Lab (D50) to XYZ D65 */
function labToXyz65(L, a, b) {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const y = L > kappa * epsilon ? ((L + 16) / 116) ** 3 : L / kappa;
  const z = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
  return mul(D50_TO_D65, [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]]);
}

/** @param {number} h degrees @param {number} s 0..1 @param {number} l 0..1 @returns {Vec3} */
function hslToSrgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const f = (/** @type {number} */ n) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** @param {number} h @param {number} w 0..1 @param {number} bk 0..1 @returns {Vec3} */
function hwbToSrgb(h, w, bk) {
  if (w + bk >= 1) {
    const grey = w / (w + bk);
    return [grey, grey, grey];
  }
  const [r, g, b] = hslToSrgb(h, 1, 0.5);
  return [r * (1 - w - bk) + w, g * (1 - w - bk) + w, b * (1 - w - bk) + w];
}

/**
 * Predefined RGB spaces of `color()`: gamma-encoded components to XYZ D65.
 * @type {Record<string, (v: Vec3) => Vec3>}
 */
const COLOR_SPACES = {
  srgb: (v) => mul(LINEAR_SRGB_TO_XYZ65, [srgbToLinear(v[0]), srgbToLinear(v[1]), srgbToLinear(v[2])]),
  'srgb-linear': (v) => mul(LINEAR_SRGB_TO_XYZ65, v),
  'display-p3': (v) => mul(LINEAR_P3_TO_XYZ65, [srgbToLinear(v[0]), srgbToLinear(v[1]), srgbToLinear(v[2])]),
  rec2020: (v) => {
    const alpha = 1.09929682680944;
    const beta = 0.018053968510807;
    const lin = (/** @type {number} */ c) => {
      const a = Math.abs(c);
      return Math.sign(c) * (a < beta * 4.5 ? a / 4.5 : ((a + alpha - 1) / alpha) ** (1 / 0.45));
    };
    return mul(LINEAR_REC2020_TO_XYZ65, [lin(v[0]), lin(v[1]), lin(v[2])]);
  },
  'a98-rgb': (v) => {
    const lin = (/** @type {number} */ c) => Math.sign(c) * Math.abs(c) ** (563 / 256);
    return mul(LINEAR_A98_TO_XYZ65, [lin(v[0]), lin(v[1]), lin(v[2])]);
  },
  'prophoto-rgb': (v) => {
    const lin = (/** @type {number} */ c) => {
      const a = Math.abs(c);
      return Math.sign(c) * (a <= 16 / 512 ? a / 16 : a ** 1.8);
    };
    return mul(D50_TO_D65, mul(LINEAR_PROPHOTO_TO_XYZ50, [lin(v[0]), lin(v[1]), lin(v[2])]));
  },
  xyz: (v) => v,
  'xyz-d65': (v) => v,
  'xyz-d50': (v) => mul(D50_TO_D65, v),
};

/**
 * @typedef {{kind: 'number' | 'percent' | 'angle' | 'none', value: number}} Component
 */

/**
 * @param {string} token
 * @returns {Component | null}
 */
function component(token) {
  if (token === 'none') return { kind: 'none', value: 0 };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(token);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2];
  if (unit === '%') return { kind: 'percent', value };
  if (unit === undefined) return { kind: 'number', value };
  const degrees = unit === 'deg' ? value : unit === 'rad' ? (value * 180) / Math.PI : unit === 'grad' ? value * 0.9 : value * 360;
  return { kind: 'angle', value: degrees };
}

/**
 * A number, or a percentage scaled so that 100% equals `full`.
 * @param {Component} c @param {number} full @returns {number | null}
 */
function scalar(c, full) {
  if (c.kind === 'none') return 0;
  if (c.kind === 'number') return c.value;
  if (c.kind === 'percent') return (c.value / 100) * full;
  return null;
}

/** @param {Component} c @returns {number | null} hue in degrees */
function hue(c) {
  if (c.kind === 'none') return 0;
  if (c.kind === 'number' || c.kind === 'angle') return c.value;
  return null;
}

/**
 * @param {Component | undefined} c @returns {number | null}
 */
function alphaOf(c) {
  if (c === undefined) return 1;
  const a = scalar(c, 1);
  return a === null ? null : clamp01(a);
}

/** @param {number} x @returns {number} */
function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

/**
 * Splits the arguments of a colour function into components and an optional alpha, for both the legacy comma
 * syntax and the modern space syntax with `/ alpha`.
 * @param {string} args
 * @returns {{parts: string[], alpha: string | undefined} | null}
 */
function splitArguments(args) {
  if (args.includes(',')) {
    if (args.includes('/')) return null;
    const parts = args.split(',').map((p) => p.trim());
    if (parts.some((p) => p === '')) return null;
    return parts.length === 4 ? { parts: parts.slice(0, 3), alpha: parts[3] } : { parts, alpha: undefined };
  }
  const [main, alpha, extra] = args.split('/');
  if (extra !== undefined) return null;
  const parts = main.trim().split(/\s+/).filter(Boolean);
  if (alpha !== undefined && alpha.trim() === '') return null;
  return { parts, alpha: alpha === undefined ? undefined : alpha.trim() };
}

/**
 * Parses a CSS colour: hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba(), hsl()/hsla(), hwb(), lab(), lch(),
 * oklab(), oklch(), color(<space> ...) for srgb, srgb-linear, display-p3, rec2020, a98-rgb, prophoto-rgb and xyz,
 * the 148 named colours and 'transparent'. Returns gamma-encoded sRGB in 0..1, clipped per channel the way
 * Chromium draws out-of-gamut colours on an sRGB surface, or null for anything else (currentcolor, var(),
 * color-mix(), relative colours, system colours, malformed input).
 * @param {string} css
 * @returns {Rgba | null}
 */
export function parseColor(css) {
  if (typeof css !== 'string') return null;
  const s = css.trim().toLowerCase();
  if (s === '') return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) return parseHex(s.slice(1));
  if (Object.hasOwn(NAMED_COLORS, s)) return parseHex(NAMED_COLORS[s]);
  const m = /^([a-z][a-z0-9-]*)\((.*)\)$/s.exec(s);
  if (!m) return null;
  const fn = m[1];
  const args = m[2].trim();
  if (args.startsWith('from ') || /\b(?:var|calc|env)\(/.test(args)) return null;
  if (fn === 'color') {
    const space = /^([a-z0-9-]+)\s+(.*)$/s.exec(args);
    if (!space || !Object.hasOwn(COLOR_SPACES, space[1]) || space[2].includes(',')) return null;
    const split = splitArguments(space[2]);
    if (!split || split.parts.length !== 3) return null;
    const comps = split.parts.map(component);
    if (comps.some((c) => c === null || c.kind === 'angle')) return null;
    const values = /** @type {Vec3} */ (comps.map((c) => /** @type {number} */ (scalar(/** @type {Component} */ (c), 1))));
    const alphaComponent = split.alpha === undefined ? undefined : component(split.alpha);
    if (alphaComponent === null) return null;
    const a = alphaOf(alphaComponent);
    if (a === null) return null;
    if (space[1] === 'srgb') return finish(values, a);
    if (space[1] === 'srgb-linear') return finish([linearToSrgb(values[0]), linearToSrgb(values[1]), linearToSrgb(values[2])], a);
    return finish(xyz65ToSrgb(COLOR_SPACES[space[1]](values)), a);
  }
  const split = splitArguments(args);
  if (!split || split.parts.length !== 3) return null;
  const comps = split.parts.map(component);
  if (comps.some((c) => c === null)) return null;
  const [c1, c2, c3] = /** @type {[Component, Component, Component]} */ (comps);
  const alphaComponent = split.alpha === undefined ? undefined : component(split.alpha);
  if (alphaComponent === null) return null;
  const a = alphaOf(alphaComponent);
  if (a === null) return null;
  switch (fn) {
    case 'rgb':
    case 'rgba': {
      if ([c1, c2, c3].some((c) => c.kind === 'angle')) return null;
      const [r, g, b] = [c1, c2, c3].map((c) => /** @type {number} */ (scalar(c, 255)) / 255);
      return finish([r, g, b], a);
    }
    case 'hsl':
    case 'hsla': {
      const h = hue(c1);
      const sat = c2.kind === 'angle' ? null : scalar(c2, 100);
      const light = c3.kind === 'angle' ? null : scalar(c3, 100);
      if (h === null || sat === null || light === null) return null;
      return finish(hslToSrgb(h, clamp01(sat / 100), clamp01(light / 100)), a);
    }
    case 'hwb': {
      const h = hue(c1);
      const w = c2.kind === 'angle' ? null : scalar(c2, 100);
      const bk = c3.kind === 'angle' ? null : scalar(c3, 100);
      if (h === null || w === null || bk === null) return null;
      return finish(hwbToSrgb(h, clamp01(w / 100), clamp01(bk / 100)), a);
    }
    case 'lab':
    case 'lch': {
      const L = c1.kind === 'angle' ? null : scalar(c1, 100);
      if (L === null) return null;
      let A;
      let B;
      if (fn === 'lab') {
        A = c2.kind === 'angle' ? null : scalar(c2, 125);
        B = c3.kind === 'angle' ? null : scalar(c3, 125);
      } else {
        const C = c2.kind === 'angle' ? null : scalar(c2, 150);
        const H = hue(c3);
        if (C === null || H === null) return null;
        A = Math.max(0, C) * Math.cos((H * Math.PI) / 180);
        B = Math.max(0, C) * Math.sin((H * Math.PI) / 180);
      }
      if (A === null || B === null) return null;
      return finish(xyz65ToSrgb(labToXyz65(Math.max(0, L), A, B)), a);
    }
    case 'oklab':
    case 'oklch': {
      const L = c1.kind === 'angle' ? null : scalar(c1, 1);
      if (L === null) return null;
      let A;
      let B;
      if (fn === 'oklab') {
        A = c2.kind === 'angle' ? null : scalar(c2, 0.4);
        B = c3.kind === 'angle' ? null : scalar(c3, 0.4);
      } else {
        const C = c2.kind === 'angle' ? null : scalar(c2, 0.4);
        const H = hue(c3);
        if (C === null || H === null) return null;
        A = Math.max(0, C) * Math.cos((H * Math.PI) / 180);
        B = Math.max(0, C) * Math.sin((H * Math.PI) / 180);
      }
      if (A === null || B === null) return null;
      const lin = oklabToLinearSrgb(clamp01(L), A, B);
      return finish([linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])], a);
    }
    default:
      return null;
  }
}

/**
 * @param {string} hex digits without '#'
 * @returns {Rgba | null}
 */
function parseHex(hex) {
  if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((d) => d + d).join('') : hex;
  const byte = (/** @type {number} */ i) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) : 1 };
}

/**
 * @param {Vec3} rgb @param {number} a @returns {Rgba}
 */
function finish(rgb, a) {
  return { r: clamp01(rgb[0]), g: clamp01(rgb[1]), b: clamp01(rgb[2]), a };
}

/**
 * OKLCH of a gamma-encoded sRGB colour: lightness 0..1, chroma (about 0..0.4), hue in degrees 0..360 (0 for a
 * colour with no chroma at all; see `hueOf` for the achromatic threshold).
 * @param {Rgb} rgb
 * @returns {Oklch}
 */
export function toOklch({ r, g, b }) {
  const [L, A, B] = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/**
 * WCAG 2.x relative luminance of a gamma-encoded sRGB colour (object or CSS string; alpha ignored).
 * @param {Rgb | string} rgb
 * @returns {number}
 */
export function relativeLuminance(rgb) {
  const c = typeof rgb === 'string' ? parseColor(rgb) : rgb;
  if (!c) throw new TypeError(`relativeLuminance: cannot parse colour ${JSON.stringify(rgb)}`);
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/**
 * Source-over compositing of `top` on `bottom` (both gamma-encoded, as browsers blend).
 * @param {Rgba} top
 * @param {Rgba} bottom
 * @returns {Rgba}
 */
export function composite(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (/** @type {number} */ t, /** @type {number} */ u) => (t * top.a + u * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

const WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

/**
 * WCAG 2.x contrast ratio (1..21, unrounded: 4.499 fails 4.5). A translucent background is first composited on
 * white, then the foreground on the background. Colours are CSS strings or Rgba objects; returns null when either
 * cannot be parsed.
 * @param {Rgba | string} fg
 * @param {Rgba | string} bg
 * @returns {number | null}
 */
export function contrastRatio(fg, bg) {
  const f = typeof fg === 'string' ? parseColor(fg) : fg;
  const b0 = typeof bg === 'string' ? parseColor(bg) : bg;
  if (!f || !b0) return null;
  const b = b0.a < 1 ? composite(b0, WHITE) : b0;
  const top = f.a < 1 ? composite(f, b) : f;
  const l1 = relativeLuminance(top);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * OKLCH hue in degrees of a CSS colour, or null when it is achromatic (chroma below ACHROMATIC_CHROMA), fully
 * transparent or unparseable.
 * @param {string} css
 * @returns {number | null}
 */
export function hueOf(css) {
  const c = parseColor(css);
  if (!c || c.a === 0) return null;
  const { c: chroma, h } = toOklch(c);
  return chroma < ACHROMATIC_CHROMA ? null : h;
}

/**
 * `#rrggbb` (or `#rrggbbaa` when translucent) of an Rgba colour.
 * @param {Rgba} c
 * @returns {string}
 */
export function toHex(c) {
  const byte = (/** @type {number} */ x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${c.a < 1 ? byte(c.a) : ''}`;
}
