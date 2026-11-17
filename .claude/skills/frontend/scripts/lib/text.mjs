// @ts-check

/**
 * @typedef {'js' | 'ts' | 'jsx' | 'tsx' | 'css' | 'scss' | 'less' | 'html' | 'vue' | 'svelte' | 'json'} SourceKind
 * @typedef {[number, number]} Range half-open [start, end) code-unit range
 */

const ALIASES = Object.freeze({ mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts', htm: 'html', sass: 'scss' });
const KINDS = new Set(['js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less', 'html', 'vue', 'svelte', 'json']);

/**
 * Replaces every comment with spaces, keeping line breaks, so the result has the same length, the same line
 * numbers and the same columns as the source. String, template and regular-expression literals are skipped, JSX
 * text is never mistaken for a comment (`<a>https://x</a>`, `<p>Don't</p>`), `{/* JSX comments *\/}` are removed,
 * and HTML, Vue and Svelte files have their `<script>` and `<style>` blocks stripped in their own language.
 * Kinds: js, ts, jsx, tsx, css, html, vue, svelte, plus scss and less (`//` line comments) and json (no comments).
 * @param {string} source
 * @param {string} kind
 * @returns {string}
 */
export function stripComments(source, kind) {
  return blankRanges(source, commentRanges(source, kind));
}

/**
 * The comment ranges stripComments blanks, in source order.
 * @param {string} source
 * @param {string} kind
 * @returns {Range[]}
 */
export function commentRanges(source, kind) {
  const k = normaliseKind(kind);
  const src = String(source);
  switch (k) {
    case 'js':
    case 'jsx':
      return new JsScanner(src, { jsx: true, ts: false }).run();
    case 'tsx':
      return new JsScanner(src, { jsx: true, ts: true }).run();
    case 'ts':
      return new JsScanner(src, { jsx: false, ts: true }).run();
    case 'css':
      return cssRanges(src, false);
    case 'scss':
    case 'less':
      return cssRanges(src, true);
    case 'html':
    case 'vue':
    case 'svelte':
      return htmlRanges(src);
    default:
      return [];
  }
}

/**
 * @param {string} kind
 * @returns {SourceKind}
 */
function normaliseKind(kind) {
  const lower = String(kind).toLowerCase();
  const k = Object.hasOwn(ALIASES, lower) ? ALIASES[/** @type {keyof typeof ALIASES} */ (lower)] : lower;
  if (!KINDS.has(k)) {
    throw new TypeError(`stripComments: unknown kind "${kind}"; use one of ${[...KINDS].join(', ')}`);
  }
  return /** @type {SourceKind} */ (k);
}

/**
 * @param {string} src
 * @param {Range[]} ranges
 * @returns {string}
 */
function blankRanges(src, ranges) {
  if (ranges.length === 0) return src;
  /** @type {string[]} */
  const parts = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last) continue;
    parts.push(src.slice(last, start), src.slice(start, end).replace(/[^\r\n]/g, ' '));
    last = end;
  }
  parts.push(src.slice(last));
  return parts.join('');
}

const EXPRESSION_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield',
  'await',
]);
const IDENTIFIER = /[\p{ID_Start}$_][\p{ID_Continue}$]*/uy;
const NUMBER = /(?:0[xXoObB][0-9a-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y;
const JSX_NAME = /[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*/y;
const JSX_ATTRIBUTE = /[A-Za-z_$][\w$-]*(?::[A-Za-z_$][\w$-]*)?/y;
const TS_GENERIC = /<\s*(?:const\s+)?[A-Za-z_$][\w$]*\s*(?:,|extends\b)/y;

/**
 * A JavaScript / TypeScript / JSX lexer that only knows enough to find comments: it tracks whether an expression
 * may start (regex literal and JSX element versus division and less-than), nests template substitutions and JSX
 * expression containers, and parses a JSX element speculatively, backtracking when it does not close (a TSX
 * type such as `type F = <T>(x: T) => T` is then read as code again).
 */
class JsScanner {
  /**
   * @param {string} src
   * @param {{jsx: boolean, ts: boolean}} options
   */
  constructor(src, { jsx, ts }) {
    this.src = src;
    this.n = src.length;
    this.jsx = jsx;
    this.ts = ts;
    /** @type {Range[]} */
    this.ranges = [];
  }

  /** @returns {Range[]} */
  run() {
    let start = 0;
    if (this.src.startsWith('#!')) {
      start = this.src.indexOf('\n');
      if (start < 0) return [];
    }
    this.scanCode(start, false);
    return this.ranges;
  }

  /**
   * Scans code until the end of input, or, with `stopAtBrace`, until the `}` that closes the current expression
   * container or template substitution.
   * @param {number} start
   * @param {boolean} stopAtBrace
   * @returns {number} the index after that `}`, the input length at top level, or -1 when input ends first
   */
  scanCode(start, stopAtBrace) {
    const { src, n } = this;
    let i = start;
    let depth = 0;
    let expressionStart = true;
    let afterDot = false;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (isSpace(c)) {
        i += 1;
        continue;
      }
      if (c === 47) {
        const d = src.charCodeAt(i + 1);
        if (d === 47) {
          i = this.lineComment(i);
          continue;
        }
        if (d === 42) {
          i = this.blockComment(i);
          continue;
        }
        if (expressionStart) {
          const end = this.scanRegex(i);
          if (end > 0) {
            i = end;
            expressionStart = false;
            afterDot = false;
            continue;
          }
        }
        i += 1;
        expressionStart = true;
        afterDot = false;
        continue;
      }
      if (c === 39 || c === 34) {
        i = this.scanString(i);
        expressionStart = false;
        afterDot = false;
        continue;
      }
      if (c === 96) {
        const end = this.scanTemplate(i + 1);
        if (end < 0) return stopAtBrace ? -1 : n;
        i = end;
        expressionStart = false;
        afterDot = false;
        continue;
      }
      if (c === 123) {
        depth += 1;
        i += 1;
        expressionStart = true;
        afterDot = false;
        continue;
      }
      if (c === 125) {
        if (depth === 0 && stopAtBrace) return i + 1;
        if (depth > 0) depth -= 1;
        i += 1;
        expressionStart = true;
        afterDot = false;
        continue;
      }
      if (c === 60 && this.jsx && expressionStart && this.looksLikeJsx(i)) {
        const mark = this.ranges.length;
        const end = this.scanJsx(i);
        if (end > 0) {
          i = end;
          expressionStart = false;
          afterDot = false;
          continue;
        }
        this.ranges.length = mark;
      }
      if (isIdentifierStart(c)) {
        IDENTIFIER.lastIndex = i;
        const m = IDENTIFIER.exec(src);
        if (m) {
          i += m[0].length;
          expressionStart = !afterDot && EXPRESSION_KEYWORDS.has(m[0]);
          afterDot = false;
          continue;
        }
      }
      if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(src);
        i += m ? m[0].length : 1;
        expressionStart = false;
        afterDot = false;
        continue;
      }
      if (c === 46) {
        if (src.startsWith('...', i)) {
          i += 3;
          expressionStart = true;
          afterDot = false;
        } else {
          i += 1;
          expressionStart = false;
          afterDot = true;
        }
        continue;
      }
      if (c === 63 && src.charCodeAt(i + 1) === 46 && !isDigit(src.charCodeAt(i + 2))) {
        i += 2;
        expressionStart = false;
        afterDot = true;
        continue;
      }
      if (c === 41 || c === 93) {
        i += 1;
        expressionStart = false;
        afterDot = false;
        continue;
      }
      if ((c === 43 || c === 45) && src.charCodeAt(i + 1) === c) {
        i += 2;
        expressionStart = false;
        afterDot = false;
        continue;
      }
      i += 1;
      expressionStart = true;
      afterDot = false;
    }
    return stopAtBrace ? -1 : n;
  }

  /**
   * @param {number} i index of the opening quote
   * @returns {number} index after the closing quote; an unterminated string ends at the line break
   */
  scanString(i) {
    const { src, n } = this;
    const quote = src.charCodeAt(i);
    let j = i + 1;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 92) {
        j += src.charCodeAt(j + 1) === 13 && src.charCodeAt(j + 2) === 10 ? 3 : 2;
        continue;
      }
      if (c === quote) return j + 1;
      if (c === 10 || c === 13) return j;
      j += 1;
    }
    return n;
  }

  /**
   * @param {number} i index after the opening backtick
   * @returns {number} index after the closing backtick, or -1 at end of input
   */
  scanTemplate(i) {
    const { src, n } = this;
    let j = i;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 92) {
        j += 2;
        continue;
      }
      if (c === 96) return j + 1;
      if (c === 36 && src.charCodeAt(j + 1) === 123) {
        const end = this.scanCode(j + 2, true);
        if (end < 0) return -1;
        j = end;
        continue;
      }
      j += 1;
    }
    return -1;
  }

  /**
   * @param {number} i index of the opening slash
   * @returns {number} index after the flags, or -1 when no closing slash comes before the line break
   */
  scanRegex(i) {
    const { src, n } = this;
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 10 || c === 13) return -1;
      if (c === 92) {
        const d = src.charCodeAt(j + 1);
        if (d === 10 || d === 13) return -1;
        j += 2;
        continue;
      }
      if (inClass) {
        if (c === 93) inClass = false;
      } else if (c === 91) {
        inClass = true;
      } else if (c === 47) {
        j += 1;
        while (j < n && isIdentifierPart(src.charCodeAt(j))) j += 1;
        return j;
      }
      j += 1;
    }
    return -1;
  }

  /** @param {number} i @returns {number} */
  lineComment(i) {
    const { src, n } = this;
    let j = i + 2;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 10 || c === 13) break;
      j += 1;
    }
    this.ranges.push([i, j]);
    return j;
  }

  /** @param {number} i @returns {number} */
  blockComment(i) {
    const close = this.src.indexOf('*/', i + 2);
    const end = close < 0 ? this.n : close + 2;
    this.ranges.push([i, end]);
    return end;
  }

  /**
   * @param {number} i index of `<` in an expression position
   * @returns {boolean}
   */
  looksLikeJsx(i) {
    const next = this.src.charCodeAt(i + 1);
    const opens = next === 62 || isAsciiLetter(next) || next === 95 || next === 36;
    if (!opens) return false;
    TS_GENERIC.lastIndex = i;
    return !TS_GENERIC.test(this.src);
  }

  /**
   * Skips whitespace and comments inside a JSX tag (comments there are JavaScript comments).
   * @param {number} i
   * @returns {number}
   */
  skipTagSpace(i) {
    const { src, n } = this;
    let j = i;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (isSpace(c)) {
        j += 1;
      } else if (c === 47 && src.charCodeAt(j + 1) === 47) {
        j = this.lineComment(j);
      } else if (c === 47 && src.charCodeAt(j + 1) === 42) {
        j = this.blockComment(j);
      } else {
        break;
      }
    }
    return j;
  }

  /**
   * Skips a TSX type-argument list on an element name (`<Select<Option> ...>`).
   * @param {number} i index of `<`
   * @returns {number} index after the matching `>`, or -1
   */
  skipTypeArguments(i) {
    const { src, n } = this;
    let depth = 0;
    for (let j = i; j < n; j += 1) {
      const c = src.charCodeAt(j);
      if (c === 60) depth += 1;
      else if (c === 62 && src.charCodeAt(j - 1) !== 61) {
        depth -= 1;
        if (depth === 0) return j + 1;
      } else if (c === 39 || c === 34) j = this.scanString(j) - 1;
      else if (c === 10 && depth > 0 && j - i > 400) return -1;
    }
    return -1;
  }

  /**
   * Parses one JSX element (or fragment) speculatively. Text children are literal: no comments, quotes or regexes
   * there. Returns -1, leaving the caller to backtrack, when the element does not close properly.
   * @param {number} start index of `<`
   * @returns {number}
   */
  scanJsx(start) {
    const { src, n } = this;
    let i = this.skipTagSpace(start + 1);
    let name = '';
    if (src.charCodeAt(i) === 62) {
      i += 1;
    } else {
      JSX_NAME.lastIndex = i;
      const m = JSX_NAME.exec(src);
      if (!m) return -1;
      name = m[0];
      i += name.length;
      if (this.ts && src.charCodeAt(this.skipTagSpace(i)) === 60) {
        i = this.skipTypeArguments(this.skipTagSpace(i));
        if (i < 0) return -1;
      }
      for (;;) {
        i = this.skipTagSpace(i);
        if (i >= n) return -1;
        const c = src.charCodeAt(i);
        if (c === 47) return src.charCodeAt(i + 1) === 62 ? i + 2 : -1;
        if (c === 62) {
          i += 1;
          break;
        }
        if (c === 123) {
          const end = this.scanCode(i + 1, true);
          if (end < 0) return -1;
          i = end;
          continue;
        }
        JSX_ATTRIBUTE.lastIndex = i;
        const attribute = JSX_ATTRIBUTE.exec(src);
        if (!attribute) return -1;
        i = this.skipTagSpace(i + attribute[0].length);
        if (src.charCodeAt(i) !== 61) continue;
        i = this.skipTagSpace(i + 1);
        const v = src.charCodeAt(i);
        if (v === 34 || v === 39) {
          const close = src.indexOf(src[i], i + 1);
          if (close < 0) return -1;
          i = close + 1;
        } else if (v === 123) {
          const end = this.scanCode(i + 1, true);
          if (end < 0) return -1;
          i = end;
        } else if (v === 60) {
          const end = this.scanJsx(i);
          if (end < 0) return -1;
          i = end;
        } else {
          return -1;
        }
      }
    }
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 60) {
        if (src.charCodeAt(i + 1) === 47) {
          let j = this.skipTagSpace(i + 2);
          let closeName = '';
          if (src.charCodeAt(j) !== 62) {
            JSX_NAME.lastIndex = j;
            const m = JSX_NAME.exec(src);
            if (!m) return -1;
            closeName = m[0];
            j = this.skipTagSpace(j + closeName.length);
          }
          if (src.charCodeAt(j) !== 62 || closeName !== name) return -1;
          return j + 1;
        }
        const end = this.scanJsx(i);
        if (end < 0) return -1;
        i = end;
        continue;
      }
      if (c === 123) {
        const end = this.scanCode(i + 1, true);
        if (end < 0) return -1;
        i = end;
        continue;
      }
      i += 1;
    }
    return -1;
  }
}

/**
 * CSS comments, skipping strings and unquoted `url(...)`; `lineComments` adds SCSS / Less `//` comments.
 * @param {string} src
 * @param {boolean} lineComments
 * @returns {Range[]}
 */
function cssRanges(src, lineComments) {
  /** @type {Range[]} */
  const ranges = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 47 && src.charCodeAt(i + 1) === 42) {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      ranges.push([i, end]);
      i = end;
      continue;
    }
    if (lineComments && c === 47 && src.charCodeAt(i + 1) === 47) {
      let j = i + 2;
      while (j < n && src.charCodeAt(j) !== 10 && src.charCodeAt(j) !== 13) j += 1;
      ranges.push([i, j]);
      i = j;
      continue;
    }
    if (c === 34 || c === 39) {
      i = cssStringEnd(src, i);
      continue;
    }
    if ((c === 117 || c === 85) && src.slice(i, i + 4).toLowerCase() === 'url(' && !isIdentifierPart(src.charCodeAt(i - 1))) {
      let j = i + 4;
      while (j < n && isSpace(src.charCodeAt(j))) j += 1;
      const q = src.charCodeAt(j);
      if (q === 34 || q === 39) {
        i = j;
        continue;
      }
      const close = src.indexOf(')', j);
      i = close < 0 ? n : close + 1;
      continue;
    }
    i += 1;
  }
  return ranges;
}

/**
 * @param {string} src
 * @param {number} i index of the opening quote
 * @returns {number}
 */
function cssStringEnd(src, i) {
  const quote = src.charCodeAt(i);
  let j = i + 1;
  while (j < src.length) {
    const c = src.charCodeAt(j);
    if (c === 92) {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === 10 || c === 13) return j;
    j += 1;
  }
  return src.length;
}

const HTML_TAG = /<(\/?)([A-Za-z][\w:-]*)/y;
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

/**
 * HTML comments, plus the comments of `<script>` and `<style>` blocks in their own language (`type` and `lang`
 * decide: lang="ts" is TypeScript, lang="scss" has line comments, JSON and template script types are left alone).
 * Serves html, vue and svelte files.
 * @param {string} src
 * @returns {Range[]}
 */
function htmlRanges(src) {
  /** @type {Range[]} */
  const ranges = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt + 4);
      const end = close < 0 ? n : close + 3;
      ranges.push([lt, end]);
      i = end;
      continue;
    }
    const next = src.charCodeAt(lt + 1);
    if (next === 33 || next === 63) {
      const gt = src.indexOf('>', lt);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    HTML_TAG.lastIndex = lt;
    const m = HTML_TAG.exec(src);
    if (!m) {
      i = lt + 1;
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    let j = lt + m[0].length;
    const attributesStart = j;
    while (j < n && src.charCodeAt(j) !== 62) {
      const c = src.charCodeAt(j);
      if (c === 34 || c === 39) {
        const close = src.indexOf(src[j], j + 1);
        j = close < 0 ? n : close + 1;
      } else {
        j += 1;
      }
    }
    const attributes = src.slice(attributesStart, j);
    i = Math.min(n, j + 1);
    if (closing || attributes.trimEnd().endsWith('/') || !RAW_TEXT.has(name)) continue;
    const closeTag = new RegExp(`</${name}[\\s>/]`, 'ig');
    closeTag.lastIndex = i;
    const found = closeTag.exec(src);
    const rawEnd = found ? found.index : n;
    const inner = src.slice(i, rawEnd);
    const kind = name === 'script' ? scriptKind(attributes) : name === 'style' ? styleKind(attributes) : null;
    if (kind) {
      for (const [a, b] of commentRanges(inner, kind)) ranges.push([a + i, b + i]);
    }
    i = rawEnd;
  }
  return ranges;
}

/**
 * @param {string} attributes
 * @param {string} name
 * @returns {string | null}
 */
function attributeValue(attributes, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attributes);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim().toLowerCase() : null;
}

/**
 * @param {string} attributes
 * @returns {SourceKind | null}
 */
function scriptKind(attributes) {
  const lang = attributeValue(attributes, 'lang');
  if (lang === 'ts' || lang === 'typescript') return 'ts';
  if (lang === 'tsx') return 'tsx';
  if (lang === 'jsx') return 'jsx';
  const type = attributeValue(attributes, 'type');
  if (type === null || type === '' || type === 'module' || /(?:java|ecma)script$/.test(type)) return 'js';
  if (type === 'text/babel' || type === 'text/jsx') return 'jsx';
  if (type === 'text/typescript' || type === 'application/typescript') return 'ts';
  return null;
}

/**
 * @param {string} attributes
 * @returns {SourceKind}
 */
function styleKind(attributes) {
  const lang = attributeValue(attributes, 'lang');
  if (lang === 'scss' || lang === 'sass' || lang === 'stylus' || lang === 'styl') return 'scss';
  if (lang === 'less') return 'less';
  return 'css';
}

/** @param {number} c @returns {boolean} */
function isSpace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 || c === 0xa0 || c === 0xfeff ||
    c === 0x2028 || c === 0x2029 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000;
}

/** @param {number} c @returns {boolean} */
function isDigit(c) {
  return c >= 48 && c <= 57;
}

/** @param {number} c @returns {boolean} */
function isAsciiLetter(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/** @param {number} c @returns {boolean} */
function isIdentifierStart(c) {
  return isAsciiLetter(c) || c === 36 || c === 95 || c > 127;
}

/** @param {number} c @returns {boolean} */
function isIdentifierPart(c) {
  return isIdentifierStart(c) || isDigit(c);
}

/** @type {{source: string, starts: number[]} | null} */
let lineCache = null;

/**
 * 1-based line number of a code-unit index (an index past the end counts as the last line).
 * @param {string} source
 * @param {number} index
 * @returns {number}
 */
export function lineOf(source, index) {
  if (!lineCache || lineCache.source !== source) {
    /** @type {number[]} */
    const starts = [0];
    for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
    lineCache = { source, starts };
  }
  const { starts } = lineCache;
  const target = Math.max(0, Math.min(index, source.length));
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const WORD_SEGMENTER = new Intl.Segmenter('en', { granularity: 'word' });
const EM_DASH = String.fromCharCode(0x2014);

/**
 * Unicode word count (Intl.Segmenter word boundaries, word-like segments only), the denominator of every
 * per-1,000-words rate. A fixed locale keeps counts identical across machines.
 * @param {string} text
 * @returns {number}
 */
export function wordCount(text) {
  let count = 0;
  for (const segment of WORD_SEGMENTER.segment(String(text ?? ''))) if (segment.isWordLike) count += 1;
  return count;
}

/**
 * Em dashes (U+2014 only; en dashes and hyphens do not count) per 1,000 words. `per1000` is 0 when there are no
 * words, so a rate threshold never fires on empty text; callers set their own minimum word count.
 * @param {string} text
 * @returns {{count: number, words: number, per1000: number}}
 */
export function emDashRate(text) {
  const s = String(text ?? '');
  const count = s.split(EM_DASH).length - 1;
  const words = wordCount(s);
  return { count, words, per1000: words > 0 ? (count * 1000) / words : 0 };
}

/**
 * NFKC, every run of whitespace collapsed to one space, trimmed.
 * @param {string} s
 * @returns {string}
 */
export function normaliseText(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * The case folding of never-show matching agreed with /execution (Q-F9, CONTRACTS 6.1b): NFKC, then toLowerCase(),
 * never a full casefold, so both skills fold a text the same way (Python: `unicodedata.normalize('NFKC', s).lower()`).
 * Applied to both the text and the pattern of a literal entry whose case_sensitive is false, and to the text a
 * case-insensitive regex entry is tested on (which also gets the `i` flag).
 * @param {string} s
 * @returns {string}
 */
export function foldNeverShow(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase();
}

/** A quantifier in braces, {n}, {n,} or {n,m}, at the start of the string. */
const BRACE_QUANTIFIER = /^\{\d+(?:,\d*)?\}/;

/**
 * Why a never-show regex entry falls outside the subset JavaScript and Python `re` read the same way (Q-F9, agreed
 * with /execution on 2026-10-01), or null when it is inside it. Refused: named groups and named backreferences,
 * lookbehind, numbered backreferences, inline flag groups such as `(?i)`, atomic groups, possessive quantifiers,
 * comment and conditional groups, `\A \Z \z`, Unicode property escapes, and the JavaScript-only `\c` escapes and
 * `[]`/`[^]` classes. Accepted: character classes, quantifiers (greedy and lazy), alternation, capturing and
 * non-capturing groups, lookahead, the anchors `^ $ \b \B`, `\d \w \s` and their negations, and plain escapes. The
 * scan is escape- and class-aware; compiling the pattern is a separate check.
 * @param {string} pattern
 * @returns {string | null}
 */
export function neverShowRegexProblem(pattern) {
  const src = String(pattern);
  let inClass = false;
  let afterQuantifier = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1] ?? '';
      if (n === '') return 'it ends with a lone backslash';
      if (!inClass && /[1-9]/.test(n)) return `it uses a backreference (\\${n})`;
      if (/[A-Za-z]/.test(n)) {
        if (n === 'k' && src[i + 2] === '<') return 'it uses a named backreference (\\k<name>)';
        if (n === 'A' || n === 'Z' || n === 'z') return `it uses \\${n}, an anchor only Python reads`;
        if ((n === 'p' || n === 'P') && src[i + 2] === '{') return 'it uses a Unicode property escape (\\p{...})';
        if (n === 'c') return 'it uses a control escape (\\c), which Python does not read';
        if (n === 'x' && !/^[0-9A-Fa-f]{2}$/.test(src.slice(i + 2, i + 4))) return 'it uses \\x without two hex digits';
        if (n === 'u' && !/^[0-9A-Fa-f]{4}$/.test(src.slice(i + 2, i + 6))) return 'it uses \\u without four hex digits';
        if (!/[dDwWsSbBtnvfrxu]/.test(n)) return `it uses \\${n}, an escape the two engines read differently`;
      }
      i += 1;
      afterQuantifier = false;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      const first = src[i + 1] === '^' ? i + 2 : i + 1;
      if (src[first] === ']') return 'it has a class that starts with ] ([] or [^]), which the two engines read differently';
      inClass = true;
      i = first - 1;
      afterQuantifier = false;
      continue;
    }
    if (c === '(') {
      afterQuantifier = false;
      if (src[i + 1] !== '?') continue;
      const rest = src.slice(i + 2);
      if (rest.startsWith(':') || rest.startsWith('=') || rest.startsWith('!')) {
        i += 2;
        continue;
      }
      if (rest.startsWith('<=') || rest.startsWith('<!')) return 'it uses a lookbehind ((?<= or (?<!)';
      if (rest.startsWith('<') || rest.startsWith('P')) return 'it uses a named group';
      if (rest.startsWith('>')) return 'it uses an atomic group ((?>...))';
      if (rest.startsWith('#')) return 'it uses a comment group ((?#...))';
      if (rest.startsWith('(')) return 'it uses a conditional group ((?(...)...))';
      return 'it uses an inline flag group such as (?i); set case_sensitive instead';
    }
    if (c === '*' || c === '+' || c === '?') {
      if (afterQuantifier && c === '+') return 'it uses a possessive quantifier (*+, ++, ?+ or {n}+)';
      afterQuantifier = !(afterQuantifier && c === '?');
      continue;
    }
    if (c === '{') {
      const m = BRACE_QUANTIFIER.exec(src.slice(i));
      if (m) {
        if (afterQuantifier) return 'it repeats a quantifier';
        i += m[0].length - 1;
        afterQuantifier = true;
        continue;
      }
    }
    afterQuantifier = false;
  }
  return null;
}
