// @ts-check
import { lineOf } from '../../lib/text.mjs';

/**
 * @typedef {import('../load.mjs').StaticContext} StaticContext
 * @typedef {import('../load.mjs').SourceFile} SourceFile
 * @typedef {import('../load.mjs').StaticFinding} StaticFinding
 */

const RULE = 'SL-G03';
/** Default strings the Cardano Foundation button and Mesh's dialog print (FD18-F05, Deliverable F). */
const DEFAULT_STRINGS = [
  { re: /\bAwesome DApp\b/gi, what: "the Cardano Foundation connect button's default dAppName 'Awesome DApp'" },
  { re: /awesome-dapp-url\.tld/gi, what: "the Cardano Foundation connect button's default dAppUrl" },
  { re: /(?<![\w-])mesh-dark(?![\w-])/g, what: "Mesh's default dark dialog class" },
  { re: /\bPowered by\b[\s\S]{0,160}?\bMesh SDK\b/gi, what: "Mesh's 'Powered by Mesh SDK' footer" },
];
const KIT_IMPORT = /\bfrom\s+["'](@meshsdk\/react|@cardano-foundation\/cardano-connect-with-wallet(?:-core)?|@rainbow-me\/rainbowkit|connectkit|@reown\/appkit[\w/-]*|@web3modal\/[\w/-]+|@privy-io\/react-auth|@dynamic-labs\/[\w/-]+)["']/;
const CONNECT_FLOW = /\b(?:connectWallet|useWallet|useConnect|useAccount|onConnectError|signTx|signMessage|signTransaction|getNetworkId|getUtxos|walletconnect)\b|\bwindow\.cardano\b|\bethereum\.request\b|\.enable\(\s*(?:\{|\))/i;
const ALERT = /(?<![\w$.])(?:window\.)?alert\s*\(/g;
const POWERED_BY = /\bPowered by\b/g;
const CARDANO_WALLET = /<CardanoWallet\b/g;
const CONNECT_BUTTON = /<ConnectWalletButton\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*?)\/?>/g;
/** Each prebuilt kit, the element or call that mounts it, and what counts as theming it from tokens (FD16-F25, FD18-F05). */
const KITS = [
  { name: 'RainbowKit', mount: /<RainbowKitProvider\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)>/g, themed: (/** @type {string} */ attrs, /** @type {string} */ all) => /\btheme\s*=\s*\{(?!\s*(?:darkTheme|lightTheme|midnightTheme)\(\s*\)\s*\})/.test(attrs) || /\bmerge\(\s*(?:darkTheme|lightTheme|midnightTheme)\(/.test(all) },
  { name: 'ConnectKit', mount: /<ConnectKitProvider\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)>/g, themed: (/** @type {string} */ attrs, /** @type {string} */ all) => /\bcustomTheme\s*=/.test(attrs) || /--ck-[\w-]+\s*:/.test(all) },
  { name: 'Reown AppKit', mount: /\bcreateAppKit\(\s*(\{[\s\S]*?\})\s*\)/g, themed: (/** @type {string} */ attrs, /** @type {string} */ all) => /\bthemeVariables\s*:/.test(attrs) || /--(?:apkt|w3m)-[\w-]+\s*:/.test(all) },
  { name: 'Privy', mount: /<PrivyProvider\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)>/g, themed: (/** @type {string} */ attrs, /** @type {string} */ all) => /\bappearance\s*:/.test(attrs) || /\bappearance\s*:/.test(all) || /--privy-[\w-]+\s*:/.test(all) },
  { name: 'Dynamic', mount: /<DynamicContextProvider\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)>/g, themed: (/** @type {string} */ _attrs, /** @type {string} */ all) => /--dynamic-[\w-]+\s*:/.test(all) },
];

/**
 * Prebuilt wallet-connect defaults a jury would see (FD18-F05; FD16-F24/F25): the Cardano Foundation button's
 * 'Awesome DApp' name, placeholder URL and alert() error handler, Mesh's dialog with its mesh-dark class and
 * "Powered by Mesh SDK" footer, alert() in any connect flow, and a prebuilt kit mounted on its default theme. FD18's
 * caveat applies: alert( and "Powered by" also occur in unrelated code, so they count only in files that import a
 * wallet kit or run a connect flow.
 * @param {StaticContext} ctx
 * @returns {StaticFinding[]}
 */
export function detect(ctx) {
  const all = ctx.files.map((f) => f.code).join('\n');
  /** @type {StaticFinding[]} */
  const findings = [];
  for (const file of ctx.files) {
    if (file.kind === 'json') continue;
    const code = file.code;
    for (const { re, what } of DEFAULT_STRINGS) {
      for (const m of code.matchAll(re)) {
        const value = m[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
        findings.push(finding(file, m.index ?? 0, value, `${what}; build the connect dialog from the project's own primitives`));
      }
    }
    const kit = KIT_IMPORT.exec(code);
    const connectFlow = kit !== null || CONNECT_FLOW.test(code);
    if (connectFlow && file.kind !== 'css') {
      for (const m of code.matchAll(ALERT)) findings.push(finding(file, m.index ?? 0, 'alert(', 'alert() in a wallet connect or transaction flow: show the failure in the page, in words, with what to do'));
    }
    if (kit && !/\bMesh SDK\b/.test(code)) {
      for (const m of code.matchAll(POWERED_BY)) findings.push(finding(file, m.index ?? 0, m[0], `"Powered by" in a file that mounts ${kit[1]}: remove kit branding from the judged surface`));
    }
    if (/@meshsdk\/react/.test(code)) {
      for (const m of code.matchAll(CARDANO_WALLET)) findings.push(finding(file, m.index ?? 0, '<CardanoWallet>', "Mesh's CardanoWallet dialog prints 'Powered by Mesh SDK', always carries mesh-dark and closes before connect resolves; build the dialog on CIP-30 and Mesh's state"));
    }
    for (const m of code.matchAll(CONNECT_BUTTON)) {
      const attrs = m[1];
      const missing = [];
      if (!/\bonConnectError\s*=/.test(attrs)) missing.push('onConnectError (defaults to alert())');
      if (!/\bdAppName\s*=/.test(attrs) && !/\bpeerConnectEnabled\s*=\s*\{\s*false\s*\}/.test(attrs)) missing.push("dAppName (defaults to 'Awesome DApp')");
      if (missing.length > 0) findings.push(finding(file, m.index ?? 0, missing, `Cardano Foundation ConnectWalletButton left on its defaults: ${missing.join(', ')}`));
    }
    for (const k of KITS) {
      for (const m of code.matchAll(k.mount)) {
        if (!k.themed(m[1] ?? '', all)) findings.push(finding(file, m.index ?? 0, k.name, `${k.name} mounted on its default theme; theme every token from the project's tokens, or build the dialog on the chain's hooks`));
      }
    }
  }
  return dedupe(findings);
}

/**
 * @param {StaticFinding[]} findings
 * @returns {StaticFinding[]}
 */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${JSON.stringify(f.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {SourceFile} file
 * @param {number} index
 * @param {unknown} value
 * @param {string} detail
 * @returns {StaticFinding}
 */
function finding(file, index, value, detail) {
  return { rule: RULE, layer: 'static', file: file.path, line: lineOf(file.text, index), excerpt: excerpt(file.text, index), value, detail };
}

/**
 * The source line at `index`, trimmed, cut to a 120-character window around the match.
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function excerpt(text, index) {
  const start = index > 0 ? text.lastIndexOf('\n', index - 1) + 1 : 0;
  const stop = text.indexOf('\n', index);
  const end = stop < 0 ? text.length : stop;
  const line = text.slice(start, end).trim();
  if (line.length <= 120) return line;
  const from = Math.max(start, Math.min(index - 40, end - 120));
  return text.slice(from, from + 120).trim();
}
