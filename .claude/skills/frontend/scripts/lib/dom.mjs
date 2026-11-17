// @ts-check
/*
 * In-page collectors. Each exported function is passed to page.evaluate, so it must be self-contained: no import, no
 * reference to anything outside its own body. Each collector therefore carries its own copy of selectorFor; a test
 * asserts the copies stay identical to the exported one.
 */

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Box document coordinates, CSS px
 * @typedef {{sel: string, tag: string, role: string, box: Box, visible: boolean, text: string,
 *   styles: Record<string, string>, attrs: Record<string, string>, meta: Record<string, string>, parent: number,
 *   depth: number}} ElementInfo
 * @typedef {{root?: string, max?: number, textMax?: number, svgChildren?: boolean, styles?: boolean}} CollectElementsOptions
 * @typedef {'text' | 'before' | 'after' | 'value' | 'placeholder'} TextSource
 * @typedef {{sel: string, text: string, fontSize: number, fontFamily: string, fontWeight: number, fontStyle: string,
 *   color: string, bg: string, bgImage: string | null, box: Box, inViewport: boolean, recRole: string | null,
 *   tag: string, source: TextSource, visible: boolean, opacity: number, textTransform: string,
 *   letterSpacing: string, lineHeight: string}} TextInfo
 * @typedef {{max?: number}} CollectTextOptions
 * @typedef {{sel: string | null, name: string, type: 'css-animation' | 'css-transition' | 'web-animation',
 *   duration: number, delay: number, endDelay: number, easing: string, iterations: number | 'infinite',
 *   direction: string, fill: string, playState: string, pseudo: string | null, properties: string[],
 *   keyframes: Array<Record<string, string | number | null>>}} AnimationInfo
 * @typedef {{maxKeyframes?: number}} CollectAnimationsOptions
 */

/** Computed styles reported by collectElements (CONTRACTS section 3 whitelist), keyed as written there. */
export const STYLE_WHITELIST = Object.freeze([
  'display', 'position', 'visibility', 'opacity', 'color', 'backgroundColor', 'backgroundImage', 'backgroundClip',
  'webkitBackgroundClip', 'backdropFilter', 'filter', 'mixBlendMode', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor',
  'borderLeftColor', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'letterSpacing', 'textTransform', 'lineHeight', 'textAlign', 'marginTop', 'marginBottom', 'paddingTop',
  'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'transition', 'transitionProperty', 'transitionDuration',
  'transitionTimingFunction', 'animationName', 'transform', 'pointerEvents', 'zIndex', 'cursor',
  'gridTemplateColumns',
]);

/**
 * Short, stable CSS selector that matches exactly `el` in its document: a unique id, data-feature or data-testid
 * when one exists on the element or an ancestor, then a child chain of tag names with :nth-of-type where needed,
 * shortened to the shortest unique suffix (up to four steps). `counts` memoises querySelectorAll counts across
 * calls. Returns '' for a non-element.
 * @param {Element} el
 * @param {Map<string, number> | void} [counts]
 * @returns {string}
 */
export const selectorFor = function selectorFor(el, counts) {
  /** @param {string} value @returns {string} */
  const escapeIdent = (value) =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replace(/[^\w-]/g, (c) => `\\${c}`);
  /** @param {string} value @returns {string} */
  const quoted = (value) => `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
  const memo = counts instanceof Map ? counts : null;
  /** @param {string} selector @returns {boolean} */
  const unique = (selector) => {
    const known = memo ? memo.get(selector) : undefined;
    if (known !== undefined) return known === 1;
    let n = 0;
    try {
      n = document.querySelectorAll(selector).length;
    } catch {
      n = 0;
    }
    if (memo) memo.set(selector, n);
    return n === 1;
  };
  /** @param {Element} node @returns {string | null} */
  const anchor = (node) => {
    const id = node.getAttribute('id');
    if (id) {
      const s = `#${escapeIdent(id)}`;
      if (unique(s)) return s;
    }
    for (const name of ['data-feature', 'data-testid']) {
      const value = node.getAttribute(name);
      if (value) {
        const s = `[${name}=${quoted(value)}]`;
        if (unique(s)) return s;
      }
    }
    return null;
  };
  if (!el || el.nodeType !== 1) return '';
  /** @type {string[]} */
  const parts = [];
  /** @type {Element | null} */
  let node = el;
  while (node) {
    const found = anchor(node);
    if (found) {
      parts.unshift(found);
      break;
    }
    const tag = node.localName;
    /** @type {Element | null} */
    const parent = node.parentElement;
    if (!parent || tag === 'html') {
      parts.unshift(tag);
      break;
    }
    if (tag === 'body' && parent.localName === 'html') {
      parts.unshift('body');
      break;
    }
    let index = 0;
    let count = 0;
    for (const sibling of Array.from(parent.children)) {
      if (sibling.localName === tag) {
        count += 1;
        if (sibling === node) index = count;
      }
    }
    parts.unshift(count > 1 ? `${tag}:nth-of-type(${index})` : tag);
    node = parent;
  }
  for (let k = 1; k < parts.length && k <= 4; k += 1) {
    const candidate = parts.slice(-k).join(' > ');
    if (unique(candidate)) return candidate;
  }
  return parts.join(' > ');
};

/**
 * Every element under `opts.root` (default body), in document order: selector, tag, ARIA role (explicit or
 * implicit), box in document coordinates, visibility (rendered, not visibility:hidden, no zero opacity on it or an
 * ancestor, larger than 1x1 px), text (innerText, so CSS text-transform applies; for an invisible element whose
 * innerText is empty, as under visibility:hidden, its textContent; whitespace collapsed, cut at `textMax`), the whitelisted
 * computed styles, every data-* attribute, a few identifying attributes (`meta`), and the index of the nearest
 * collected ancestor (`parent`, -1 for the root) with its `depth`. Script, style and head elements are skipped, and
 * SVG descendants unless `svgChildren`. At most `max` elements (default 10000).
 * @param {CollectElementsOptions} [opts]
 * @returns {ElementInfo[]}
 */
export const collectElements = function collectElements(opts) {
  /**
   * @param {Element} el
   * @param {Map<string, number> | void} [counts]
   * @returns {string}
   */
  function selectorFor(el, counts) {
    /** @param {string} value @returns {string} */
    const escapeIdent = (value) =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/[^\w-]/g, (c) => `\\${c}`);
    /** @param {string} value @returns {string} */
    const quoted = (value) => `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
    const memo = counts instanceof Map ? counts : null;
    /** @param {string} selector @returns {boolean} */
    const unique = (selector) => {
      const known = memo ? memo.get(selector) : undefined;
      if (known !== undefined) return known === 1;
      let n = 0;
      try {
        n = document.querySelectorAll(selector).length;
      } catch {
        n = 0;
      }
      if (memo) memo.set(selector, n);
      return n === 1;
    };
    /** @param {Element} node @returns {string | null} */
    const anchor = (node) => {
      const id = node.getAttribute('id');
      if (id) {
        const s = `#${escapeIdent(id)}`;
        if (unique(s)) return s;
      }
      for (const name of ['data-feature', 'data-testid']) {
        const value = node.getAttribute(name);
        if (value) {
          const s = `[${name}=${quoted(value)}]`;
          if (unique(s)) return s;
        }
      }
      return null;
    };
    if (!el || el.nodeType !== 1) return '';
    /** @type {string[]} */
    const parts = [];
    /** @type {Element | null} */
    let node = el;
    while (node) {
      const found = anchor(node);
      if (found) {
        parts.unshift(found);
        break;
      }
      const tag = node.localName;
      /** @type {Element | null} */
      const parent = node.parentElement;
      if (!parent || tag === 'html') {
        parts.unshift(tag);
        break;
      }
      if (tag === 'body' && parent.localName === 'html') {
        parts.unshift('body');
        break;
      }
      let index = 0;
      let count = 0;
      for (const sibling of Array.from(parent.children)) {
        if (sibling.localName === tag) {
          count += 1;
          if (sibling === node) index = count;
        }
      }
      parts.unshift(count > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
    }
    for (let k = 1; k < parts.length && k <= 4; k += 1) {
      const candidate = parts.slice(-k).join(' > ');
      if (unique(candidate)) return candidate;
    }
    return parts.join(' > ');
  }

  const options = opts || {};
  const max = typeof options.max === 'number' && options.max > 0 ? options.max : 10000;
  const textMax = typeof options.textMax === 'number' && options.textMax >= 0 ? options.textMax : 160;
  const keys = [
    'display', 'position', 'visibility', 'opacity', 'color', 'backgroundColor', 'backgroundImage', 'backgroundClip',
    'webkitBackgroundClip', 'backdropFilter', 'filter', 'mixBlendMode', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'borderTopColor', 'borderRightColor', 'borderBottomColor',
    'borderLeftColor', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'letterSpacing', 'textTransform', 'lineHeight', 'textAlign', 'marginTop', 'marginBottom', 'paddingTop',
    'paddingRight', 'paddingBottom', 'paddingLeft', 'gap', 'transition', 'transitionProperty', 'transitionDuration',
    'transitionTimingFunction', 'animationName', 'transform', 'pointerEvents', 'zIndex', 'cursor',
    'gridTemplateColumns',
  ];
  const styleNames = keys.map((k) => [k, (k.startsWith('webkit') ? '-' : '') + k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)]);
  const skip = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'head', 'base']);
  /** @param {number} v */
  const round = (v) => Math.round(v * 100) / 100;

  /** @param {Element} el @returns {string} */
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit && explicit.trim()) return explicit.trim().split(/\s+/)[0];
    const tag = el.localName;
    const sectioning = 'article, aside, main, nav, section';
    switch (tag) {
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : '';
      case 'button':
        return 'button';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading';
      case 'nav':
        return 'navigation';
      case 'main':
        return 'main';
      case 'header':
        return el.parentElement && el.parentElement.closest(sectioning) ? '' : 'banner';
      case 'footer':
        return el.parentElement && el.parentElement.closest(sectioning) ? '' : 'contentinfo';
      case 'aside':
        return 'complementary';
      case 'form':
        return 'form';
      case 'section':
        return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
      case 'article':
        return 'article';
      case 'ul':
      case 'ol':
      case 'menu':
        return 'list';
      case 'li':
        return 'listitem';
      case 'img':
        return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'table':
        return 'table';
      case 'tr':
        return 'row';
      case 'td':
        return 'cell';
      case 'th':
        return 'columnheader';
      case 'dialog':
        return 'dialog';
      case 'progress':
        return 'progressbar';
      case 'meter':
        return 'meter';
      case 'hr':
        return 'separator';
      case 'select': {
        const select = /** @type {HTMLSelectElement} */ (el);
        return select.multiple || select.size > 1 ? 'listbox' : 'combobox';
      }
      case 'option':
        return 'option';
      case 'textarea':
        return 'textbox';
      case 'output':
        return 'status';
      case 'details':
      case 'fieldset':
        return 'group';
      case 'figure':
        return 'figure';
      case 'input': {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
        if (['email', 'tel', 'text', 'url'].includes(type)) return el.hasAttribute('list') ? 'combobox' : 'textbox';
        return '';
      }
      default:
        return '';
    }
  };

  /** @param {Element} el @param {DOMRect} rect @returns {boolean} */
  const isVisible = (el, rect) => {
    if (rect.width < 1 || rect.height < 1 || (rect.width <= 1 && rect.height <= 1)) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    }
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  };

  /** @param {Element} el @returns {Record<string, string>} */
  const metaOf = (el) => {
    /** @type {Record<string, string>} */
    const meta = {};
    const put = (/** @type {string} */ key, /** @type {string | null} */ value) => {
      if (value !== null && value !== '') meta[key] = value.length > 300 ? value.slice(0, 300) : value;
    };
    put('id', el.getAttribute('id'));
    put('class', el.getAttribute('class'));
    put('href', el.getAttribute('href'));
    put('src', el.getAttribute('src'));
    put('alt', el.getAttribute('alt'));
    put('ariaLabel', el.getAttribute('aria-label'));
    put('ariaHidden', el.getAttribute('aria-hidden'));
    put('type', el.getAttribute('type'));
    return meta;
  };

  const counts = new Map();
  const root = typeof options.root === 'string' && options.root ? document.querySelector(options.root) : document.body || document.documentElement;
  if (!root) return [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  /** @type {ElementInfo[]} */
  const out = [];
  /** @type {Map<Element, number>} */
  const indexOf = new Map();
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (out.length >= max) break;
    const tag = el.localName;
    if (skip.has(tag)) continue;
    if (options.svgChildren !== true && tag !== 'svg' && el.closest('svg')) continue;
    const rect = el.getBoundingClientRect();
    const visible = isVisible(el, rect);
    const rendered = el instanceof HTMLElement ? el.innerText : null;
    const raw = rendered !== null && (visible || rendered.trim() !== '') ? rendered : el.textContent || '';
    const collapsed = raw.replace(/\s+/g, ' ').trim();
    /** @type {Record<string, string>} */
    const styles = {};
    if (options.styles !== false) {
      const cs = getComputedStyle(el);
      for (const [key, css] of styleNames) styles[key] = cs.getPropertyValue(css);
    }
    /** @type {Record<string, string>} */
    const attrs = {};
    for (const attribute of Array.from(el.attributes)) {
      if (attribute.name.startsWith('data-')) attrs[attribute.name] = attribute.value;
    }
    let parent = -1;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const k = indexOf.get(p);
      if (k !== undefined) {
        parent = k;
        break;
      }
    }
    indexOf.set(el, out.length);
    out.push({
      sel: selectorFor(el, counts),
      tag,
      role: roleOf(el),
      box: { x: round(rect.left + scrollX), y: round(rect.top + scrollY), w: round(rect.width), h: round(rect.height) },
      visible,
      text: collapsed.length > textMax ? collapsed.slice(0, textMax) : collapsed,
      styles,
      attrs,
      meta: metaOf(el),
      parent,
      depth: parent === -1 ? 0 : out[parent].depth + 1,
    });
  }
  return out;
};

/**
 * Every piece of rendered text, attributed to the element that owns it: direct text nodes, CSS ::before/::after
 * string content, button-like input values, and placeholders of empty fields. For each: selector, the text
 * (whitespace collapsed), font size (px), family, weight, style, colour (as computed), the background behind it
 * (`bg`: ancestor background colours composited over the canvas, as rgb(); `bgImage`: the first gradient or image
 * met on the way, which makes `bg` approximate; positioned overlaps are not seen), box, whether it intersects the
 * viewport at the current scroll position (the first viewport right after load), the nearest
 * data-rec-role, visibility (the owner is rendered, visible and not transparent) and effective opacity. Text
 * inside script, style, template, noscript and title is skipped. At most `max` entries (default 20000).
 * @param {CollectTextOptions} [opts]
 * @returns {TextInfo[]}
 */
export const collectText = function collectText(opts) {
  /**
   * @param {Element} el
   * @param {Map<string, number> | void} [counts]
   * @returns {string}
   */
  function selectorFor(el, counts) {
    /** @param {string} value @returns {string} */
    const escapeIdent = (value) =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/[^\w-]/g, (c) => `\\${c}`);
    /** @param {string} value @returns {string} */
    const quoted = (value) => `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
    const memo = counts instanceof Map ? counts : null;
    /** @param {string} selector @returns {boolean} */
    const unique = (selector) => {
      const known = memo ? memo.get(selector) : undefined;
      if (known !== undefined) return known === 1;
      let n = 0;
      try {
        n = document.querySelectorAll(selector).length;
      } catch {
        n = 0;
      }
      if (memo) memo.set(selector, n);
      return n === 1;
    };
    /** @param {Element} node @returns {string | null} */
    const anchor = (node) => {
      const id = node.getAttribute('id');
      if (id) {
        const s = `#${escapeIdent(id)}`;
        if (unique(s)) return s;
      }
      for (const name of ['data-feature', 'data-testid']) {
        const value = node.getAttribute(name);
        if (value) {
          const s = `[${name}=${quoted(value)}]`;
          if (unique(s)) return s;
        }
      }
      return null;
    };
    if (!el || el.nodeType !== 1) return '';
    /** @type {string[]} */
    const parts = [];
    /** @type {Element | null} */
    let node = el;
    while (node) {
      const found = anchor(node);
      if (found) {
        parts.unshift(found);
        break;
      }
      const tag = node.localName;
      /** @type {Element | null} */
      const parent = node.parentElement;
      if (!parent || tag === 'html') {
        parts.unshift(tag);
        break;
      }
      if (tag === 'body' && parent.localName === 'html') {
        parts.unshift('body');
        break;
      }
      let index = 0;
      let count = 0;
      for (const sibling of Array.from(parent.children)) {
        if (sibling.localName === tag) {
          count += 1;
          if (sibling === node) index = count;
        }
      }
      parts.unshift(count > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
    }
    for (let k = 1; k < parts.length && k <= 4; k += 1) {
      const candidate = parts.slice(-k).join(' > ');
      if (unique(candidate)) return candidate;
    }
    return parts.join(' > ');
  }

  const options = opts || {};
  const max = typeof options.max === 'number' && options.max > 0 ? options.max : 20000;
  const counts = new Map();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  /** @param {number} v */
  const round = (v) => Math.round(v * 100) / 100;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true });
  /** @type {Map<string, [number, number, number, number]>} */
  const colorCache = new Map();
  /** @param {string} css @returns {[number, number, number, number]} */
  const rgba = (css) => {
    const cached = colorCache.get(css);
    if (cached) return cached;
    /** @type {[number, number, number, number]} */
    let value = [0, 0, 0, 0];
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css);
    if (m) {
      const alpha = m[4] === undefined ? 1 : m[5] === '%' ? Number(m[4]) / 100 : Number(m[4]);
      value = [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
    } else if (paint) {
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = 'rgba(0, 0, 0, 0)';
      paint.fillStyle = css;
      paint.fillRect(0, 0, 1, 1);
      const d = paint.getImageData(0, 0, 1, 1).data;
      value = [d[0], d[1], d[2], d[3] / 255];
    }
    colorCache.set(css, value);
    return value;
  };
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  const darkCanvas = /\bdark\b/.test(scheme) && (!/\blight\b/.test(scheme) || window.matchMedia('(prefers-color-scheme: dark)').matches);
  /** @type {[number, number, number]} */
  const canvasColor = darkCanvas ? [18, 18, 18] : [255, 255, 255];
  /** @type {Map<Element, {rgb: [number, number, number], image: string | null}>} */
  const backgrounds = new Map();
  /** @param {Element | null} el @returns {{rgb: [number, number, number], image: string | null}} */
  const backgroundOf = (el) => {
    if (!el) return { rgb: canvasColor, image: null };
    const cached = backgrounds.get(el);
    if (cached) return cached;
    const below = backgroundOf(el.parentElement);
    const cs = getComputedStyle(el);
    const own = rgba(cs.backgroundColor);
    const a = own[3];
    /** @type {[number, number, number]} */
    const rgb = a >= 1
      ? [own[0], own[1], own[2]]
      : a <= 0
        ? below.rgb
        : [own[0] * a + below.rgb[0] * (1 - a), own[1] * a + below.rgb[1] * (1 - a), own[2] * a + below.rgb[2] * (1 - a)];
    const ownImage = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 300) : null;
    const result = { rgb, image: ownImage || (a >= 1 ? null : below.image) };
    backgrounds.set(el, result);
    return result;
  };
  /** @type {Map<Element, number>} */
  const opacities = new Map();
  /** @param {Element | null} el @returns {number} */
  const opacityOf = (el) => {
    if (!el) return 1;
    const cached = opacities.get(el);
    if (cached !== undefined) return cached;
    const own = Number.parseFloat(getComputedStyle(el).opacity);
    const value = (Number.isFinite(own) ? own : 1) * opacityOf(el.parentElement);
    opacities.set(el, value);
    return value;
  };

  /** @type {TextInfo[]} */
  const out = [];
  /**
   * @param {Element} el @param {string} text @param {TextSource} source @param {CSSStyleDeclaration} [pseudo]
   */
  const add = (el, text, source, pseudo) => {
    if (out.length >= max) return;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const cs = pseudo || getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const opacity = opacityOf(el);
    const rendered = rect.width >= 1 && rect.height >= 1 && !(rect.width <= 1 && rect.height <= 1);
    const shown = typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : cs.display !== 'none' && cs.visibility !== 'hidden';
    const bg = backgroundOf(el);
    const recOwner = el.closest('[data-rec-role]');
    out.push({
      sel: selectorFor(el, counts),
      text: clean,
      fontSize: Number.parseFloat(cs.fontSize) || 0,
      fontFamily: cs.fontFamily,
      fontWeight: Number(cs.fontWeight) || 400,
      fontStyle: cs.fontStyle,
      color: cs.color,
      bg: `rgb(${Math.round(bg.rgb[0])}, ${Math.round(bg.rgb[1])}, ${Math.round(bg.rgb[2])})`,
      bgImage: bg.image,
      box: { x: round(rect.left + scrollX), y: round(rect.top + scrollY), w: round(rect.width), h: round(rect.height) },
      inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw && rendered,
      recRole: recOwner ? recOwner.getAttribute('data-rec-role') : null,
      tag: el.localName,
      source,
      visible: rendered && shown && opacity > 0 && (!pseudo || (pseudo.display !== 'none' && pseudo.visibility !== 'hidden')),
      opacity: round(opacity),
      textTransform: cs.textTransform,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
    });
  };

  const container = document.body || document.documentElement;
  /** @type {Map<Element, string[]>} */
  const owners = new Map();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue || '';
    if (!/\S/.test(value)) continue;
    const parent = n.parentElement;
    if (!parent || parent.closest('script, style, noscript, template, title, head')) continue;
    const list = owners.get(parent);
    if (list) list.push(value);
    else owners.set(parent, [value]);
  }
  /** @type {Array<{el: Element, text: string, source: TextSource, pseudo?: CSSStyleDeclaration}>} */
  const found = [];
  for (const [el, parts] of owners) found.push({ el, text: parts.join(' '), source: 'text' });
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (el.closest('script, style, noscript, template, head')) continue;
    for (const [which, source] of /** @type {const} */ ([['::before', 'before'], ['::after', 'after']])) {
      const pcs = getComputedStyle(el, which);
      const content = pcs.content;
      if (!content || content === 'none' || content === 'normal') continue;
      const strings = [...content.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
      const text = strings.join('');
      if (text.trim()) found.push({ el, text, source, pseudo: pcs });
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const type = el instanceof HTMLInputElement ? el.type : 'textarea';
      if (['button', 'submit', 'reset'].includes(type) && el.value) found.push({ el, text: el.value, source: 'value' });
      else if (!el.value && el.placeholder) found.push({ el, text: el.placeholder, source: 'placeholder', pseudo: getComputedStyle(el, '::placeholder') });
    }
  }
  /** @param {Element} a @param {Element} b */
  const order = (a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const rank = { before: 0, text: 1, value: 1, placeholder: 1, after: 2 };
  found.sort((x, y) => order(x.el, y.el) || rank[x.source] - rank[y.source]);
  for (const item of found) add(item.el, item.text, item.source, item.pseudo);
  return out;
};

/**
 * Every animation `document.getAnimations()` reports (CSS animations, CSS transitions in flight and Web
 * Animations; requestAnimationFrame loops are invisible to it): target selector, name (animation name, transitioned
 * property or animation id), type, timing in ms, easing (for CSS animations the keyframe timing function),
 * iterations ('infinite' for endless loops), animated properties, and the first `maxKeyframes` keyframes (default
 * 10) with their values.
 * @param {CollectAnimationsOptions} [opts]
 * @returns {AnimationInfo[]}
 */
export const collectAnimations = function collectAnimations(opts) {
  /**
   * @param {Element} el
   * @param {Map<string, number> | void} [counts]
   * @returns {string}
   */
  function selectorFor(el, counts) {
    /** @param {string} value @returns {string} */
    const escapeIdent = (value) =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/[^\w-]/g, (c) => `\\${c}`);
    /** @param {string} value @returns {string} */
    const quoted = (value) => `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
    const memo = counts instanceof Map ? counts : null;
    /** @param {string} selector @returns {boolean} */
    const unique = (selector) => {
      const known = memo ? memo.get(selector) : undefined;
      if (known !== undefined) return known === 1;
      let n = 0;
      try {
        n = document.querySelectorAll(selector).length;
      } catch {
        n = 0;
      }
      if (memo) memo.set(selector, n);
      return n === 1;
    };
    /** @param {Element} node @returns {string | null} */
    const anchor = (node) => {
      const id = node.getAttribute('id');
      if (id) {
        const s = `#${escapeIdent(id)}`;
        if (unique(s)) return s;
      }
      for (const name of ['data-feature', 'data-testid']) {
        const value = node.getAttribute(name);
        if (value) {
          const s = `[${name}=${quoted(value)}]`;
          if (unique(s)) return s;
        }
      }
      return null;
    };
    if (!el || el.nodeType !== 1) return '';
    /** @type {string[]} */
    const parts = [];
    /** @type {Element | null} */
    let node = el;
    while (node) {
      const found = anchor(node);
      if (found) {
        parts.unshift(found);
        break;
      }
      const tag = node.localName;
      /** @type {Element | null} */
      const parent = node.parentElement;
      if (!parent || tag === 'html') {
        parts.unshift(tag);
        break;
      }
      if (tag === 'body' && parent.localName === 'html') {
        parts.unshift('body');
        break;
      }
      let index = 0;
      let count = 0;
      for (const sibling of Array.from(parent.children)) {
        if (sibling.localName === tag) {
          count += 1;
          if (sibling === node) index = count;
        }
      }
      parts.unshift(count > 1 ? `${tag}:nth-of-type(${index})` : tag);
      node = parent;
    }
    for (let k = 1; k < parts.length && k <= 4; k += 1) {
      const candidate = parts.slice(-k).join(' > ');
      if (unique(candidate)) return candidate;
    }
    return parts.join(' > ');
  }

  const options = opts || {};
  const maxKeyframes = typeof options.maxKeyframes === 'number' && options.maxKeyframes >= 0 ? options.maxKeyframes : 10;
  const counts = new Map();
  const reserved = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  /** @type {AnimationInfo[]} */
  const out = [];
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    const timing = effect ? effect.getTiming() : {};
    const keyframeEffect = effect instanceof KeyframeEffect ? effect : null;
    const frames = keyframeEffect ? keyframeEffect.getKeyframes() : [];
    const target = keyframeEffect ? keyframeEffect.target : null;
    /** @type {AnimationInfo['type']} */
    let type = 'web-animation';
    let name = animation.id || '';
    if (typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation) {
      type = 'css-animation';
      name = animation.animationName;
    } else if (typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition) {
      type = 'css-transition';
      name = animation.transitionProperty;
    }
    const properties = new Set();
    for (const frame of frames) for (const key of Object.keys(frame)) if (!reserved.has(key)) properties.add(key);
    if (type === 'css-transition' && properties.size === 0 && name) properties.add(name);
    let easing = typeof timing.easing === 'string' ? timing.easing : 'linear';
    if (type === 'css-animation' && easing === 'linear' && frames.length > 0 && typeof frames[0].easing === 'string') {
      easing = frames[0].easing;
    }
    const iterations = timing.iterations === Infinity ? 'infinite' : typeof timing.iterations === 'number' ? timing.iterations : 1;
    out.push({
      sel: target ? selectorFor(target, counts) : null,
      name,
      type,
      duration: typeof timing.duration === 'number' ? timing.duration : 0,
      delay: typeof timing.delay === 'number' ? timing.delay : 0,
      endDelay: typeof timing.endDelay === 'number' ? timing.endDelay : 0,
      easing,
      iterations,
      direction: typeof timing.direction === 'string' ? timing.direction : 'normal',
      fill: typeof timing.fill === 'string' ? timing.fill : 'auto',
      playState: animation.playState,
      pseudo: keyframeEffect ? keyframeEffect.pseudoElement : null,
      properties: [...properties],
      keyframes: frames.slice(0, maxKeyframes).map((frame) => {
        /** @type {Record<string, string | number | null>} */
        const plain = {};
        for (const [key, value] of Object.entries(frame)) {
          if (key === 'computedOffset') continue;
          if (typeof value === 'number' || value === null) plain[key] = value;
          else plain[key] = String(value).slice(0, 300);
        }
        return plain;
      }),
    });
  }
  return out;
};
