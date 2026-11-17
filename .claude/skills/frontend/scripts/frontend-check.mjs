// @ts-check
/**
 * frontend-check: the proof command of /frontend (scripts/CONTRACTS.md section 4). It selects gates by group or id,
 * builds one CheckContext (profile, state folder, design folder, routes, target URL, one browser), runs each check
 * module's `run(ctx, selected)`, aggregates the results into the gate report, writes `<state>/gates/<UTC>.json` (or,
 * with --out, only `<out>/frontend-check.json`: the state folder is then read, never written) and exits 0 if and
 * only if every requested gate is `ok`. A module that does not exist yet reports its gates as
 * skipped ("module missing"), which exits 1 like any skipped gate. It never builds: `--serve` serves a built folder,
 * `--url` targets a running app, and `--start "<cmd>" --url <url>` starts a server, waits until the URL answers and
 * kills the whole process tree on exit, errors included.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { launch } from './lib/browser.mjs';
import { EnvError, FrontendError, UsageError, exitCodeOf, exitWith } from './lib/errors.mjs';
import { toPosix } from './lib/fsutil.mjs';
import { designDir, gitExcludeFile, stateDir, statePath } from './lib/paths.mjs';
import { loadProfile } from './lib/profile.mjs';
import { GATE_ID, aggregate, gate, utcStamp, writeReport } from './lib/report.mjs';
import { loadRoutes } from './lib/routes.mjs';
import { serveStatic } from './lib/serve.mjs';

/**
 * @typedef {import('./lib/profile.mjs').Profile} Profile
 * @typedef {import('./lib/profile.mjs').Viewport} Viewport
 * @typedef {import('./lib/routes.mjs').Route} Route
 * @typedef {import('./lib/report.mjs').GateMeta} GateMeta
 * @typedef {import('./lib/report.mjs').GateResult} GateResult
 * @typedef {import('./lib/report.mjs').GateReport} GateReport
 * @typedef {import('./lib/report.mjs').Evidence} Evidence
 * @typedef {import('playwright-core').Browser} Browser
 *
 * @typedef {{gates?: string, phase?: string, features?: string, root?: string, profile?: string, state?: string,
 *   serve?: string, url?: string, start?: string, 'start-timeout'?: string, out?: string, json?: boolean,
 *   'allow-skip'?: string, network?: boolean, master?: string, deck?: string, workspace?: string,
 *   gateIds: string[], featureIds: string[] | null, allowSkip: string[], outDir: string}} CheckArgs
 *   The flags as a module CLI parses them with lib/args (comma lists stay comma-separated strings), plus
 *   `gateIds` (the selected gates), `featureIds` (--features split, or null), `allowSkip` and `outDir` (where large
 *   outputs go: --out, or `<state>/gates/<UTC>/`). `network`, `master`, `deck` and `workspace` are module inputs
 *   frontend-check only passes through (ip, motion and recording read --network; recording reads --master and
 *   --deck; brief reads --workspace).
 * @typedef {{root: string, profile: Profile, state: string, design: string, routes: Route[], baseUrl: string | null,
 *   browser: Browser | null, viewports: Viewport[], args: CheckArgs, log: (message: string) => void}} CheckContext
 *   What every check module's `run(ctx, selected)` receives. `baseUrl` is null when no target flag was given;
 *   `browser` is null when only file gates (brief, refs, tokens) are selected.
 * @typedef {{GATES: GateMeta[], run: (ctx: CheckContext, selected: string[]) => Promise<unknown> | unknown}} CheckModule
 * @typedef {{group: string, module: string, gates: GateMeta[]}} GroupSpec
 * @typedef {{state: 'loaded', module: CheckModule, file: string} | {state: 'missing', file: string} |
 *   {state: 'broken', file: string, error: unknown}} ModuleLoad
 * @typedef {{meta: GateMeta, group: string, module: string, declared: boolean}} CatalogueEntry
 * @typedef {{pid: number | undefined, stop: () => Promise<void>, stopSync: () => void, output: () => string}} StartedServer
 *   `stop()` kills the tree and rejects with an EnvError naming every pid that survived; `stopSync()` (exit and signal
 *   handlers) logs them instead.
 */

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} id
 * @param {string} title
 * @param {string} ifDropped
 * @returns {GateMeta}
 */
const g = (id, title, ifDropped) => Object.freeze({ id, title, ifDropped });

/**
 * The gate groups of CONTRACTS section 4, their modules, and the gate ids the contract names. The titles and
 * if-dropped sentences here only describe a gate whose module is missing or cannot load; a loaded module's `GATES`
 * export is the authority.
 * @type {ReadonlyArray<GroupSpec>}
 */
export const GROUPS = Object.freeze([
  { group: 'brief', module: 'brief.mjs', gates: [
    g('brief.complete', 'brief.json complete, every field sourced', 'a field could carry text nobody can trace, and a gap would be guessed instead of asked'),
  ] },
  { group: 'refs', module: 'extract.mjs', gates: [
    g('refs.ledger', 'Each pattern drawn from two unrelated references, nothing borrowed', 'one company\'s page could become the template, the accumulation a Paris court held parasitic'),
    g('refs.receipts', 'Every reference captured through the gate and purged with a receipt', 'a capture taken past robots.txt or a bot wall, or never deleted, would pass'),
  ] },
  { group: 'directions', module: 'board.mjs', gates: [
    g('directions.present', 'Two or three complete directions from different sources', 'the owner would choose between shades of one look'),
    g('directions.screened', 'Each direction passes the tells checker and the similar-prompt test', 'the model\'s default palette and fonts could reach the owner as a real option'),
  ] },
  { group: 'brand', module: 'brand-check.mjs', gates: [
    g('brand.candidates', 'Three to five brand candidates rendered and linted', 'the owner could pick a mark that blurs at 16 px or repeats a crypto cliche'),
    g('brand.favicons', 'Favicon set complete and correctly declared', 'the tab, the home screen or the search result would show a missing, clipped or wrong icon'),
    g('brand.templates', 'No framework template favicon', 'a framework favicon would ship, the cheapest sign the brand step was skipped'),
    g('brand.icon-dark', 'icon.svg keeps its dark-mode rule', 'the favicon could vanish on a dark tab strip'),
    g('brand.og', 'OG image 1200x630 with its meta tags', 'a shared link would show a cropped, empty or stale card'),
    g('brand.drift', 'Inlined copies of the mark equal brand/', 'an inlined copy of the mark could drift from brand/ unnoticed'),
  ] },
  { group: 'tokens', module: 'tokens.mjs', gates: [
    g('tokens.valid', 'tokens.json valid, every token with a usage', 'colours, type and motion values could scatter across components with no single source'),
    g('tokens.contrast', 'Token pairs meet WCAG 2 contrast', 'a pair such as muted text on a muted fill would fail on every page that uses it'),
    g('tokens.leak', 'No default theme or arbitrary values leak', 'indigo, soft grey shadows and the 150 ms default ease could leak back in'),
  ] },
  { group: 'render', module: 'qa.mjs', gates: [
    g('render.console', 'No console errors on any route', 'a page that throws in front of the jury would pass'),
    g('render.requests', 'No failed or 4xx first-party requests', 'a 404 asset or API call would pass, since requestfailed ignores HTTP errors'),
    g('render.fonts', 'Fonts render in the intended families', 'a fallback font could render in place of the chosen face, unseen'),
    g('render.images', 'No broken images', 'a broken image would pass'),
    g('render.overflow', 'No horizontal overflow at 320 and 375 CSS px', 'the page could scroll sideways on a phone'),
    g('render.clipping', 'No clipped or overlapping text', 'a clipped heading or a tagline cut at the fold would pass'),
    g('render.cls', 'Layout shift at most 0.1', 'late fonts or lazy images could move the page under the judge'),
  ] },
  { group: 'a11y', module: 'qa.mjs', gates: [
    g('a11y.axe', 'axe WCAG 2.2 AA without violations', 'an unlabelled control or a missing lang would ship, and /harden may never look'),
    g('a11y.contrast', 'Incomplete contrast resolved from rendered pixels', 'text over a gradient, glass or grain would pass unmeasured'),
    g('a11y.targets', 'Targets at least 24x24 CSS px', 'controls under 24 px would pass'),
  ] },
  { group: 'coverage', module: 'coverage.mjs', gates: [
    g('coverage.features', 'Every feature visible with its status and proof', 'a feature the spec promises could be missing while every test is green'),
    g('coverage.metrics', 'Every figure carries a ledger id or a source', 'an invented or unverified number could reach the jury'),
    g('coverage.hero', 'Hero equals the brief\'s two sentences', 'the hero could drift from the two sentences the README, the form and the video repeat'),
    g('coverage.nevershow', 'No never-show text rendered', 'an embargoed or undisclosed item could render on the public page'),
    g('coverage.placeholders', 'No TODO, lorem or placeholder names rendered', 'a TODO or placeholder could sit on a page a judge reads'),
  ] },
  { group: 'firstview', module: 'firstview.mjs', gates: [
    g('firstview.contract', 'First viewport says what it is, does and fixes', 'a judge could leave the first screen without knowing what it is, does and fixes'),
    g('firstview.complexity', 'First-viewport complexity within the category band', 'a cluttered first screen would pass'),
  ] },
  { group: 'tells', module: 'slop-check.mjs', gates: [
    g('tells.tier1', 'No confirmed tier-1 tell', 'a calibrated AI tell that stays silent on human sites would ship'),
    g('tells.tier2', 'Every tier-2 tell waived with a reason', 'a tell allowed only for a stated reason would ship without one'),
    g('tells.score', 'Weighted tell score within the limit', 'several weak tells together would pass because none alone is tier 1'),
  ] },
  { group: 'ip', module: 'ip-check.mjs', gates: [
    g('ip.fonts', 'Every font licensed, no RFN-breaking subset', 'a font with no licence, an RFN-breaking subset or a sponsor\'s commercial face would ship'),
    g('ip.hotlinks', 'No Google Fonts hotlinks', 'visitors\' IPs would go to a font CDN, and a venue without wifi would lose the fonts'),
    g('ip.logos', 'Third-party logos only from allowed official files', 'a logo whose owner requires permission would ship without it'),
    g('ip.provenance', 'Every asset has provenance', 'an asset of unknown source, licence or AI status would ship'),
    g('ip.concept-label', 'Concept frames naming a company carry the label', 'a frame naming a company could read as its endorsement'),
    g('ip.copy-overlap', 'No long word runs shared with customer copy', 'a customer\'s headline or microcopy could be reused verbatim'),
    g('ip.sponsor-marks', 'Sponsor marks used as their rules allow', 'a sponsor mark could be altered, animated, locked up, misnamed or shown without its notice'),
  ] },
  { group: 'motion', module: 'motion-check.mjs', gates: [
    g('motion.reduced', 'Reduced motion keeps content visible and still', 'the page could move for a viewer who asked it not to, which axe never checks'),
    g('motion.hidden-at-rest', 'No content hidden at rest', 'the headline or a proof could wait for a scroll that a judge, a screenshot or a recording never triggers'),
    g('motion.inventory', 'Animations within their role budgets', 'default 150 ms transition-all, ease-in entrances or scale(0) pops would pass'),
  ] },
  { group: 'recording', module: 'recording-check.mjs', gates: [
    g('recording.g01', 'Readable text legible in the 720p copy', 'body text could blur away in the 720p copy'),
    g('recording.g02', 'Reading text comfortable in the 720p copy', 'reading text could sit where OCR starts missing words'),
    g('recording.g03', 'Key text legible in the 540p copy', 'the claim could be unreadable in a half-size slide pane'),
    g('recording.g04', 'Light weights and red on dark one size up', 'thin or red-on-dark text could lose a step of legibility'),
    g('recording.g05', 'Text contrast sampled from pixels', 'text could pass in CSS and fail on the frame the judge sees'),
    g('recording.g06', 'Projector contrast', 'dark-UI text could wash out on a projector'),
    g('recording.g07', 'No banding after encoding', 'a dark gradient could band after encoding'),
    g('recording.g08', 'No grain overlay in record mode', 'grain would be erased by the encoder and cost bytes'),
    g('recording.g09', 'Structural hairlines survive 720p', 'structural hairlines could vanish at 720p'),
    g('recording.g10', 'Dark surfaces stay distinct', 'near-black surfaces could crush into one black'),
    g('recording.g11', 'No hover-only content', 'content a recording cannot hover would never appear'),
    g('recording.g12', 'No blink, loops frozen, states held', 'a blink or loop could flicker or hide a state on video'),
    g('recording.g13', 'Every data region labelled with its source and time', 'a recorded figure could not be told from a mock-up'),
    g('recording.g14', 'Layout holds at 125% and 150% zoom', 'the layout could break at the stage laptop\'s 125% or 150% zoom'),
    g('recording.g15', 'Ledger device steps mirrored in the page', 'a judge could not see what the device asks'),
    g('recording.g16', 'Deck embeds the video as a playable file', 'the embedded video could arrive as a still picture'),
  ] },
]);

/** Groups whose gates read files only: no browser is launched when nothing else is selected. */
export const FILE_ONLY_GROUPS = Object.freeze(['brief', 'refs', 'tokens']);

/**
 * The phases --phase accepts. `build` is the build-complete set of full mode; `full` is its alias, so a task
 * template can pass `--phase {mode}`; `small` is small mode's essential set (CONTRACTS section 4).
 */
export const PHASES = Object.freeze(['build', 'full', 'small']);

/** Small mode's essential gate groups: one static page, no brand files, tokens or motion budget gated. */
export const SMALL_GROUPS = Object.freeze(['render', 'a11y', 'coverage', 'firstview', 'tells', 'ip']);

const HELP = `Usage: node frontend-check.mjs [--gates <list> | --phase build|small] [--features <ids>] [--root <repo>]
         [--profile <abs path>] [--state <dir>] [--serve <dir> | --url <url> | --start "<cmd>" --url <url>]
         [--start-timeout <s>] [--out <dir>] [--json] [--allow-skip <id>] [--network] [--master <file>]
         [--deck <file>] [--workspace <dir>]

Runs the /frontend gates (scripts/CONTRACTS.md section 4) and writes the gate report to <state>/gates/<UTC>.json,
or only to <out>/frontend-check.json when --out is given (the state folder is then read, never written).

Selection:
  --gates <list>      comma-separated group names, gate ids or <group>.*, for example render,coverage,brand.candidates;
                      "all" selects every gate. Groups: ${GROUPS.map((s) => s.group).join(', ')}.
                      There is no colon syntax: use --features for coverage.features.
  --phase build       full mode's build-complete set: every group except refs and directions, brand without
                      brand.candidates, plus recording when the profile has a video format (the default when
                      neither flag is given); --phase full is the same set, so a template can pass --phase {mode}
  --phase small       small mode's essential set: ${SMALL_GROUPS.join(', ')}
  --features <ids>    comma-separated requirement ids (FR-003,FR-007) that restrict coverage.features
  --allow-skip <id>   accept a skipped gate (an id or a group); never in a task proof

Target (one of; none for file-only gates such as brief, refs, directions, brand.candidates, tokens):
  --serve <dir>       serve a built folder on 127.0.0.1 (frontend-check never builds)
  --url <url>         a running app
  --start "<cmd>"     start a server with --url, wait until the URL answers, kill its process tree on exit
  --start-timeout <s> seconds to wait for the URL after --start (default 60)

Context:
  --root <repo>       product repository root (default: the working directory)
  --profile <path>    an /execution profile.json (its frontend block) or a bare frontend block; default: found
                      under <root>/.execution or <root>/.frontend, else the defaults
  --state <dir>       state folder (default: <root>/.execution/frontend in mode A, <root>/.frontend in mode B)
  --out <dir>         write the report (frontend-check.json) and every large output here and nothing into the
                      state folder (default: report <state>/gates/<UTC>.json, outputs <state>/gates/<UTC>/)
  --json              print the gate report on stdout
  -h, --help          this text

Module inputs (passed to the modules in ctx.args, never read by frontend-check itself):
  --network           let the page's external requests through (ip, motion, recording); offline otherwise
  --master <file>     the recorded master video, for recording.g10
  --deck <file>       the presentation file, for recording.g16
  --workspace <dir>   the workspace the brief is discovered from, for brief.complete

Exit codes: 0 every requested gate is ok; 1 a gate failed or a requested gate was skipped; 2 usage error (bad
flag, missing input file, invalid profile); 3 environment error (no browser, broken module, port in use, the
started server never answered).`;

const OPTIONS = /** @type {const} */ ({
  gates: { type: 'string', multiple: true },
  phase: { type: 'string' },
  features: { type: 'string', multiple: true },
  root: { type: 'string' },
  profile: { type: 'string' },
  state: { type: 'string' },
  serve: { type: 'string' },
  url: { type: 'string' },
  start: { type: 'string' },
  'start-timeout': { type: 'string' },
  out: { type: 'string' },
  json: { type: 'boolean' },
  'allow-skip': { type: 'string', multiple: true },
  network: { type: 'boolean' },
  master: { type: 'string' },
  deck: { type: 'string' },
  workspace: { type: 'string' },
});

/**
 * @typedef {{gates?: string[], phase?: string, features?: string[], root?: string, profile?: string, state?: string,
 *   serve?: string, url?: string, start?: string, 'start-timeout'?: string, out?: string, json?: boolean,
 *   'allow-skip'?: string[], network?: boolean, master?: string, deck?: string, workspace?: string}} CliValues
 */

/**
 * Splits comma-separated flag values (repeated flags accumulate), trims, drops empty items, keeps the first of
 * duplicates.
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
export function splitList(value) {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  /** @type {string[]} */
  const out = [];
  for (const item of list.flatMap((v) => String(v).split(','))) {
    const t = item.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Which groups a selection names, before any module is loaded: group names, the group of each gate id, every
 * group for "all", the build-phase groups for --phase build.
 * @param {{gates: string[], phase: string | null}} spec
 * @param {Profile} profile
 * @returns {string[]}
 */
export function groupsNamed(spec, profile) {
  const known = GROUPS.map((s) => s.group);
  const out = new Set();
  for (const token of spec.gates) {
    rejectColon(token);
    if (token === 'all') known.forEach((k) => out.add(k));
    else out.add(token.includes('.') ? token.slice(0, token.indexOf('.')) : token);
  }
  phaseGroups(spec.phase, profile).forEach((k) => out.add(k));
  return known.filter((k) => out.has(k));
}

/**
 * The groups a phase selects (none for no phase). build (alias full): every group but refs and directions, recording
 * only with a video format; brand.candidates is left out by selectGates. small: SMALL_GROUPS.
 * @param {string | null} phase
 * @param {Profile} profile
 * @returns {string[]}
 */
export function phaseGroups(phase, profile) {
  if (phase === 'small') return [...SMALL_GROUPS];
  if (phase !== 'build' && phase !== 'full') return [];
  return GROUPS.map((s) => s.group).filter((k) => !['refs', 'directions'].includes(k) && (k !== 'recording' || Boolean(profile.format?.video)));
}

/**
 * @param {string} token
 */
function rejectColon(token) {
  if (token.includes(':')) {
    const [group, rest] = token.split(':', 2);
    throw new UsageError(
      `--gates ${token}: there is no colon syntax; use --gates ${group}` + (rest ? ` --features ${rest}` : '') + ' (CONTRACTS section 4)',
    );
  }
}

/**
 * The catalogue of the given groups: a loaded module's own GATES for its group (in its order), then any contract
 * gate id the module does not declare (reported as skipped when selected). Groups whose module is missing or broken
 * use the contract list.
 * @param {string[]} groups
 * @param {Map<string, ModuleLoad>} loads by module file name
 * @returns {CatalogueEntry[]}
 */
export function catalogue(groups, loads) {
  /** @type {CatalogueEntry[]} */
  const out = [];
  for (const spec of GROUPS) {
    if (!groups.includes(spec.group)) continue;
    const load = loads.get(spec.module);
    const own = load?.state === 'loaded'
      ? load.module.GATES.filter((m) => m.id.startsWith(`${spec.group}.`))
      : [];
    const seen = new Set();
    for (const meta of own) {
      if (seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push({ meta, group: spec.group, module: spec.module, declared: true });
    }
    for (const meta of spec.gates) {
      if (seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push({ meta, group: spec.group, module: spec.module, declared: load?.state !== 'loaded' });
    }
  }
  return out;
}

/**
 * The selected catalogue entries, in catalogue order. `--gates` tokens are group names, gate ids, `<group>.*` or
 * `all`; a phase adds its set (phaseGroups). An unknown token or a colon is a UsageError.
 * @param {{gates: string[], phase: string | null}} spec
 * @param {CatalogueEntry[]} entries
 * @param {Profile} profile
 * @returns {CatalogueEntry[]}
 */
export function selectGates(spec, entries, profile) {
  const ids = new Set();
  const groups = [...new Set(GROUPS.map((s) => s.group))];
  for (const raw of spec.gates) {
    rejectColon(raw);
    const token = raw.endsWith('.*') ? raw.slice(0, -2) : raw;
    if (token === 'all') {
      entries.forEach((e) => ids.add(e.meta.id));
    } else if (groups.includes(token)) {
      entries.filter((e) => e.group === token).forEach((e) => ids.add(e.meta.id));
    } else if (entries.some((e) => e.meta.id === token)) {
      ids.add(token);
    } else {
      const hint = GATE_ID.test(token) && groups.includes(token.split('.')[0])
        ? `group ${token.split('.')[0]} has ${entries.filter((e) => e.group === token.split('.')[0]).map((e) => e.meta.id).join(', ')}`
        : `groups: ${groups.join(', ')}`;
      throw new UsageError(`--gates: unknown gate or group "${raw}" (${hint})`);
    }
  }
  const phase = phaseGroups(spec.phase, profile);
  entries.filter((e) => phase.includes(e.group) && e.meta.id !== 'brand.candidates').forEach((e) => ids.add(e.meta.id));
  return entries.filter((e) => ids.has(e.meta.id));
}

/**
 * Imports the check modules of the given groups from `dir`. A file that does not exist is 'missing'; a file that
 * fails to import or lacks `GATES` (an array of {id, title, ifDropped}) or `run()` is 'broken'.
 * @param {string[]} groups
 * @param {string} dir
 * @returns {Promise<Map<string, ModuleLoad>>}
 */
export async function loadModules(groups, dir) {
  /** @type {Map<string, ModuleLoad>} */
  const loads = new Map();
  for (const spec of GROUPS) {
    if (!groups.includes(spec.group) || loads.has(spec.module)) continue;
    const file = path.join(dir, spec.module);
    if (!existsSync(file)) {
      loads.set(spec.module, { state: 'missing', file: toPosix(file) });
      continue;
    }
    try {
      /** @type {Record<string, unknown>} */
      const mod = await import(pathToFileURL(file).href);
      loads.set(spec.module, { state: 'loaded', module: checkModuleShape(mod, spec.module), file: toPosix(file) });
    } catch (err) {
      loads.set(spec.module, { state: 'broken', file: toPosix(file), error: err });
    }
  }
  return loads;
}

/**
 * @param {Record<string, unknown>} mod
 * @param {string} name
 * @returns {CheckModule}
 */
function checkModuleShape(mod, name) {
  if (typeof mod.run !== 'function') throw new TypeError(`${name} exports no run(ctx, selected) function`);
  if (!Array.isArray(mod.GATES)) throw new TypeError(`${name} exports no GATES array`);
  /** @type {GateMeta[]} */
  const metas = [];
  for (const [i, m] of mod.GATES.entries()) {
    const ok = m && typeof m === 'object' && typeof m.id === 'string' && GATE_ID.test(m.id) &&
      typeof m.title === 'string' && m.title.trim() !== '' && typeof m.ifDropped === 'string' && m.ifDropped.trim() !== '';
    if (!ok) throw new TypeError(`${name} GATES[${i}] must be {id: "group.name", title, ifDropped} (got ${JSON.stringify(m)})`);
    metas.push(Object.freeze({ id: m.id, title: m.title, ifDropped: m.ifDropped }));
  }
  return { GATES: metas, run: /** @type {CheckModule['run']} */ (mod.run) };
}

/**
 * Turns what a module's run() returned into one GateResult per requested id. Unrequested ids are dropped (and
 * logged); a malformed or repeated result fails its gate, since a gate that cannot say what it found never passes.
 * Evidence keeps its keys; a non-scalar `value` is serialised and a bad `line` removed, so the report always matches
 * the gate-output schema.
 * @param {unknown} raw
 * @param {CatalogueEntry[]} wanted
 * @param {string} moduleName
 * @param {(message: string) => void} log
 * @returns {Map<string, GateResult>}
 */
export function normaliseResults(raw, wanted, moduleName, log) {
  if (!Array.isArray(raw)) throw new TypeError(`${moduleName} run() returned ${raw === null ? 'null' : typeof raw}, not an array of gate results`);
  const byId = new Map(wanted.map((e) => [e.meta.id, e.meta]));
  /** @type {Map<string, GateResult>} */
  const out = new Map();
  const repeated = new Set();
  for (const item of raw) {
    const id = item && typeof item === 'object' && typeof item.id === 'string' ? item.id : null;
    if (id === null) {
      log(`${moduleName}: ignored a result that is not a gate result: ${JSON.stringify(item)?.slice(0, 120)}`);
      continue;
    }
    const meta = byId.get(id);
    if (!meta) {
      log(`${moduleName}: ignored ${id}, which was not requested`);
      continue;
    }
    if (out.has(id)) {
      repeated.add(id);
      continue;
    }
    const title = typeof item.title === 'string' && item.title.trim() ? item.title : meta.title;
    const ifDropped = typeof item.ifDropped === 'string' && item.ifDropped.trim() ? item.ifDropped : meta.ifDropped;
    const builder = gate({ id, title, ifDropped });
    const detail = typeof item.detail === 'string' ? item.detail : String(item.detail ?? '');
    if (item.state === 'ok') out.set(id, item.advisory === true ? builder.advise(detail, cleanEvidence(item.evidence)) : builder.ok(detail, cleanEvidence(item.evidence)));
    else if (item.state === 'fail') out.set(id, builder.fail(detail, cleanEvidence(item.evidence)));
    else if (item.state === 'skipped') out.set(id, builder.skip(detail || 'skipped by the module without a reason'));
    else out.set(id, builder.fail(`${moduleName} returned an invalid state ${JSON.stringify(item.state)} for this gate`));
  }
  for (const id of repeated) {
    const meta = /** @type {GateMeta} */ (byId.get(id));
    out.set(id, gate(meta).fail(`${moduleName} reported this gate more than once; a gate yields one result`));
  }
  return out;
}

/**
 * @param {unknown} evidence
 * @returns {Evidence[]}
 */
function cleanEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter((e) => e !== null && typeof e === 'object' && !Array.isArray(e))
    .map((e) => {
      const copy = { ...e };
      if ('value' in copy && copy.value !== null && !['string', 'number', 'boolean'].includes(typeof copy.value)) {
        copy.value = JSON.stringify(copy.value) ?? String(copy.value);
      }
      if ('line' in copy && !(Number.isInteger(copy.line) && copy.line >= 0)) delete copy.line;
      for (const key of ['route', 'viewport', 'selector', 'file', 'rule']) {
        if (key in copy && typeof copy[key] !== 'string') copy[key] = String(copy[key]);
      }
      return copy;
    });
}

/**
 * Whether `url` answers an HTTP request (any status) within `timeoutMs`.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, error: string}>}
 */
export function probeUrl(url, timeoutMs) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    let settled = false;
    /** @param {{ok: boolean, error: string}} v */
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const req = client.get(url, { timeout: timeoutMs, headers: { 'cache-control': 'no-store' } }, (res) => {
        res.resume();
        done({ ok: true, error: '' });
      });
      req.on('timeout', () => {
        req.destroy();
        done({ ok: false, error: `no answer within ${timeoutMs} ms` });
      });
      req.on('error', (err) => done({ ok: false, error: err instanceof Error ? (/** @type {NodeJS.ErrnoException} */ (err).code ?? err.message) : String(err) }));
    } catch (err) {
      done({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * @typedef {{pid: number, ppid: number, startedMs: number | null}} ProcessInfo
 * @typedef {{tree: number[], survivors: number[], listed: boolean, problems: string[]}} KillResult
 */

/**
 * Every process on the machine with its parent and start time (ms since the epoch, or null when the system does
 * not say), or null when the listing itself fails. Windows reads Win32_Process through PowerShell (wmic is gone from
 * current Windows); elsewhere `ps`.
 * @returns {ProcessInfo[] | null}
 */
export function listProcessesSync() {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = 'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1} {2}" -f $_.ProcessId, $_.ParentProcessId, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) }';
    const r = spawnSync(existsSync(powershell) ? powershell : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) return null;
    return parseProcessLines(r.stdout, (t) => (t > 0 ? t / 10000 - 11644473600000 : null));
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.status !== 0) return null;
  return parseProcessLines(r.stdout, () => null);
}

/**
 * @param {string} text lines of "pid ppid [start]"
 * @param {(raw: number) => number | null} toMs
 * @returns {ProcessInfo[]}
 */
function parseProcessLines(text, toMs) {
  /** @type {ProcessInfo[]} */
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const [pid, ppid, start] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0) continue;
    out.push({ pid, ppid, startedMs: Number.isFinite(start) ? toMs(start) : null });
  }
  return out;
}

/**
 * The processes descending from `root`, parents before children. A child counts only when it started no earlier
 * than its parent (a second of tolerance), so a pid the system reused for an unrelated older process is never
 * taken for a child. Windows does not re-parent orphans, so the grandchildren of a shell that already exited are
 * still found through its pid. `rootStartedMs` stands in for the root's start time when the root is gone.
 * @param {number} root
 * @param {readonly ProcessInfo[]} processes
 * @param {number | null} [rootStartedMs]
 * @returns {number[]}
 */
export function descendantsOf(root, processes, rootStartedMs = null) {
  /** @type {Map<number, ProcessInfo[]>} */
  const children = new Map();
  for (const proc of processes) {
    if (proc.pid === proc.ppid) continue;
    const list = children.get(proc.ppid) ?? [];
    list.push(proc);
    children.set(proc.ppid, list);
  }
  const started = new Map(processes.map((x) => [x.pid, x.startedMs]));
  /** @type {number[]} */
  const out = [];
  const seen = new Set([root]);
  /** @type {Array<{pid: number, startedMs: number | null}>} */
  const queue = [{ pid: root, startedMs: started.get(root) ?? rootStartedMs }];
  while (queue.length > 0) {
    const parent = /** @type {{pid: number, startedMs: number | null}} */ (queue.shift());
    for (const child of children.get(parent.pid) ?? []) {
      if (seen.has(child.pid)) continue;
      if (parent.startedMs !== null && child.startedMs !== null && child.startedMs < parent.startedMs - 1000) continue;
      seen.add(child.pid);
      out.push(child.pid);
      queue.push({ pid: child.pid, startedMs: child.startedMs });
    }
  }
  return out;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * Blocks the thread for `ms` (the 'exit' handler cannot await).
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Kills a process and every process it started, and with 'KILL' checks that they are gone. The tree is listed
 * first (listProcessesSync, descendantsOf), so children that outlive a shell that exited first are killed too.
 * Windows: `taskkill /T /F` on the root, then `taskkill /F` on every listed process still running; elsewhere the
 * process group the detached child leads, then each listed process. Synchronous, so it also runs from an 'exit'
 * handler. 'TERM' only asks (POSIX) and returns no survivors; 'KILL' polls up to `waitMs`, tries once more, and
 * returns the pids still running. Every failed kill command is reported in `problems`, never dropped.
 * @param {number} pid
 * @param {'TERM' | 'KILL'} [strength]
 * @param {{startedMs?: number | null, waitMs?: number}} [options]
 * @returns {KillResult}
 */
export function killTreeSync(pid, strength = 'KILL', { startedMs = null, waitMs = 5000 } = {}) {
  /** @type {string[]} */
  const problems = [];
  const processes = listProcessesSync();
  if (processes === null) problems.push('the process list could not be read, so only the root and its live tree were targeted');
  const tree = [pid, ...(processes ? descendantsOf(pid, processes, startedMs) : [])];
  const signal = strength === 'TERM' ? 'SIGTERM' : 'SIGKILL';
  if (process.platform === 'win32') {
    if (strength === 'TERM') return { tree, survivors: [], listed: processes !== null, problems };
    taskkill(['/PID', String(pid), '/T', '/F'], tree, problems);
    const rest = tree.filter(isAlive);
    if (rest.length > 0) taskkill(rest.flatMap((x) => ['/PID', String(x)]).concat('/F'), rest, problems);
  } else {
    for (const target of [-pid, ...tree]) {
      try {
        process.kill(target, signal);
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ESRCH') problems.push(`kill ${target} ${signal}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (strength === 'TERM') return { tree, survivors: [], listed: processes !== null, problems };
  }
  const deadline = Date.now() + waitMs;
  let survivors = tree.filter(isAlive);
  while (survivors.length > 0 && Date.now() < deadline) {
    sleepSync(100);
    survivors = survivors.filter(isAlive);
  }
  if (survivors.length > 0) {
    if (process.platform === 'win32') taskkill(survivors.flatMap((x) => ['/PID', String(x)]).concat('/F'), survivors, problems);
    else {
      for (const x of survivors) {
        try {
          process.kill(x, 'SIGKILL');
        } catch {
          // gone between the poll and the kill
        }
      }
    }
    const retryEnd = Date.now() + 2000;
    while (survivors.length > 0 && Date.now() < retryEnd) {
      sleepSync(100);
      survivors = survivors.filter(isAlive);
    }
  }
  return { tree, survivors, listed: processes !== null, problems };
}

/**
 * Runs taskkill.exe with a timeout and records a failure, unless every process it targeted is gone anyway (taskkill
 * also fails for a process that exited on its own).
 * @param {string[]} args
 * @param {number[]} targets
 * @param {string[]} problems
 */
function taskkill(args, targets, problems) {
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
  const r = spawnSync(existsSync(exe) ? exe : 'taskkill', args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (r.error) {
    problems.push(`taskkill ${args.join(' ')}: ${r.error.message}`);
    return;
  }
  if (r.status !== 0 && targets.some(isAlive)) {
    problems.push(`taskkill ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(0, 3).join(' | ')}`);
  }
}

/**
 * Starts `command` through the shell, waits until `url` answers, and returns a handle whose stop() kills the whole
 * process tree. Refuses to start when something already answers at `url` (a stale server would be checked instead
 * of the new one). The command's output never reaches stdout; its last lines are kept for error messages.
 * `onSpawn` receives the handle as soon as the process exists, so a caller interrupted during the wait can still kill
 * the tree.
 * @param {string} command
 * @param {string} url
 * @param {{timeoutMs?: number, cwd?: string, log?: (message: string) => void,
 *   onSpawn?: (handle: StartedServer) => void}} [options]
 * @returns {Promise<StartedServer>}
 */
export async function startServer(command, url, { timeoutMs = 60000, cwd = process.cwd(), log = () => {}, onSpawn } = {}) {
  const before = await probeUrl(url, 1000);
  if (before.ok) {
    throw new EnvError(`${url} already answers before --start ran, so another server holds the port; stop it or start on a free port`);
  }
  const child = spawn(command, {
    shell: true,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  /** @type {string[]} */
  const tail = [];
  /** @param {Buffer} chunk */
  const keep = (chunk) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue;
      tail.push(line.slice(0, 300));
      if (tail.length > 30) tail.shift();
    }
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  /** @type {{code: number | null, signal: string | null} | null} */
  let exited = null;
  /** @type {unknown} */
  let spawnError = null;
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exited = { code, signal };
      resolve(undefined);
    });
    child.once('error', (err) => {
      spawnError = err;
      resolve(undefined);
    });
  });
  let stopped = false;
  const pid = child.pid;
  const spawnedAt = Date.now() - 1000;
  /** @param {KillResult} result */
  const report = (result) => {
    for (const problem of result.problems) log(`frontend-check: stopping --start: ${problem}`);
    if (result.survivors.length === 0) return null;
    return `the --start process tree survived the kill: pid ${result.survivors.join(', ')} still running (tree ${result.tree.join(', ')}); ` +
      `stop ${result.survivors.length === 1 ? 'it' : 'them'} by hand (${process.platform === 'win32' ? 'taskkill /F /PID <pid>' : 'kill -9 <pid>'}) before the next run`;
  };
  const stopSync = () => {
    if (stopped) return;
    stopped = true;
    if (pid !== undefined) {
      const survived = report(killTreeSync(pid, 'KILL', { startedMs: spawnedAt }));
      if (survived) log(`frontend-check: ${survived}`);
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    /** @type {string | null} */
    let survived = null;
    if (pid !== undefined) {
      if (process.platform !== 'win32') {
        report(killTreeSync(pid, 'TERM', { startedMs: spawnedAt }));
        await settleWithin(exitPromise, 3000);
      }
      survived = report(killTreeSync(pid, 'KILL', { startedMs: spawnedAt }));
    }
    await settleWithin(exitPromise, 5000);
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (survived) throw new EnvError(survived);
  };
  const output = () => tail.join('\n');
  /** @type {StartedServer} */
  const handle = { pid, stop, stopSync, output };
  onSpawn?.(handle);
  log(`frontend-check: started "${command}" (pid ${pid ?? 'unknown'}); waiting for ${url}`);
  const deadline = Date.now() + timeoutMs;
  let last = '';
  try {
    for (;;) {
      if (spawnError) throw new EnvError(`--start could not run "${command}": ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`);
      if (exited) {
        const how = /** @type {{code: number | null, signal: string | null}} */ (exited);
        throw new EnvError(
          `--start "${command}" exited (${how.signal ? `signal ${how.signal}` : `code ${how.code}`}) before ${url} answered; ` +
            `fix the command${tail.length ? `; its last output: ${tail.slice(-5).join(' | ')}` : ''}`,
        );
      }
      const probe = await probeUrl(url, Math.min(2000, Math.max(200, deadline - Date.now())));
      if (probe.ok) break;
      last = probe.error;
      if (Date.now() >= deadline) {
        throw new EnvError(
          `${url} did not answer within ${Math.round(timeoutMs / 1000)} s after --start "${command}" (last error: ${last}); ` +
            `check the port in the command and --url, or raise --start-timeout${tail.length ? `; last output: ${tail.slice(-5).join(' | ')}` : ''}`,
        );
      }
      await delay(200);
    }
  } catch (err) {
    try {
      await stop();
    } catch (stopErr) {
      log(`frontend-check: ${stopErr instanceof Error ? stopErr.message : String(stopErr)}`);
    }
    throw err;
  }
  log(`frontend-check: ${url} answers`);
  return handle;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for `promise` at most `ms`, then clears its timer, so a settled wait never holds the process open.
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function settleWithin(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {{gates: string[], phase: string | null, features: string[] | null, allowSkip: string[], root: string,
 *   profile: string | null, state: string | null, serve: string | null, url: string | null, start: string | null,
 *   startTimeoutMs: number, out: string | null, json: boolean, network: boolean, master: string | null,
 *   deck: string | null, workspace: string | null}} Flags
 */

/**
 * `ctx.args`: the flags that were given, shaped as a module CLI parsing the same flags with lib/args sees them
 * (comma lists as one comma-separated string, paths absolute with forward slashes), plus the normalised extras.
 * @param {Flags} flags
 * @param {string[]} gateIds
 * @param {string} outDir
 * @returns {CheckArgs}
 */
export function checkArgs(flags, gateIds, outDir) {
  /** @type {CheckArgs} */
  const args = { gateIds, featureIds: flags.features, allowSkip: flags.allowSkip, outDir, json: flags.json, root: toPosix(flags.root) };
  if (flags.gates.length > 0) args.gates = flags.gates.join(',');
  if (flags.phase) args.phase = flags.phase;
  if (flags.features) args.features = flags.features.join(',');
  if (flags.profile) args.profile = toPosix(flags.profile);
  if (flags.state) args.state = toPosix(flags.state);
  if (flags.serve) args.serve = toPosix(flags.serve);
  if (flags.url) args.url = flags.url;
  if (flags.start) args.start = flags.start;
  if (flags.start) args['start-timeout'] = String(flags.startTimeoutMs / 1000);
  if (flags.out) args.out = toPosix(flags.out);
  if (flags.allowSkip.length > 0) args['allow-skip'] = flags.allowSkip.join(',');
  if (flags.network) args.network = true;
  if (flags.master) args.master = toPosix(flags.master);
  if (flags.deck) args.deck = toPosix(flags.deck);
  if (flags.workspace) args.workspace = toPosix(flags.workspace);
  return args;
}

/**
 * Checks the flag combinations and returns the normalised request. Throws UsageError on any problem.
 * @param {CliValues} values
 * @returns {Flags}
 */
export function normaliseFlags(values) {
  const gates = splitList(values.gates);
  const phase = values.phase ?? null;
  if (phase !== null && !PHASES.includes(phase)) {
    throw new UsageError(`--phase ${phase}: the phases are build (alias full) and small`);
  }
  if (values.serve !== undefined && values.url !== undefined) throw new UsageError('--serve and --url do not combine; pass one target');
  if (values.serve !== undefined && values.start !== undefined) throw new UsageError('--start needs --url, not --serve');
  if (values.start !== undefined && values.url === undefined) throw new UsageError('--start needs --url http://127.0.0.1:<port> (the URL the started server answers on)');
  if (values.start !== undefined && values.start.trim() === '') throw new UsageError('--start needs a command');
  for (const key of /** @type {const} */ (['serve', 'root', 'profile', 'state', 'out', 'master', 'deck', 'workspace'])) {
    if (values[key] === '') throw new UsageError(`--${key} needs a path`);
  }
  let url = null;
  if (values.url !== undefined) {
    try {
      const parsed = new URL(values.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('not http');
      url = parsed.toString();
    } catch {
      throw new UsageError(`--url ${JSON.stringify(values.url)} is not an http(s) URL; pass for example http://127.0.0.1:4173`);
    }
  }
  let startTimeoutMs = 60000;
  if (values['start-timeout'] !== undefined) {
    const s = Number(values['start-timeout']);
    if (!Number.isFinite(s) || s <= 0 || s > 3600) throw new UsageError(`--start-timeout ${values['start-timeout']}: give seconds between 1 and 3600`);
    if (values.start === undefined) throw new UsageError('--start-timeout only applies with --start');
    startTimeoutMs = Math.round(s * 1000);
  }
  const featureList = values.features === undefined ? null : splitList(values.features);
  if (featureList !== null) {
    if (featureList.length === 0) throw new UsageError('--features needs requirement ids, for example FR-003,FR-007');
    const bad = featureList.filter((f) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f));
    if (bad.length > 0) throw new UsageError(`--features: ${bad.map((b) => JSON.stringify(b)).join(', ')} is not a requirement id such as FR-003`);
  }
  return {
    gates,
    phase: phase === 'full' ? 'build' : phase ?? (gates.length === 0 ? 'build' : null),
    features: featureList,
    allowSkip: splitList(values['allow-skip']),
    root: path.resolve(values.root ?? process.cwd()),
    profile: values.profile ? path.resolve(values.profile) : null,
    state: values.state ? path.resolve(values.state) : null,
    serve: values.serve ? path.resolve(values.serve) : null,
    url,
    start: values.start ?? null,
    startTimeoutMs,
    out: values.out ? path.resolve(values.out) : null,
    json: Boolean(values.json),
    network: values.network === true,
    master: values.master ? path.resolve(values.master) : null,
    deck: values.deck ? path.resolve(values.deck) : null,
    workspace: values.workspace ? path.resolve(values.workspace) : null,
  };
}

/**
 * @typedef {{report: GateReport, exitCode: number, reportPath: string}} CheckOutcome
 * @typedef {{modulesDir?: string, now?: Date, log?: (message: string) => void}} CheckDeps
 */

/**
 * Runs a whole check from parsed flag values: selection, context, modules, report. Usage and environment problems
 * found before any module ran are thrown (exit 2 or 3); what a module throws is recorded on its gates (fail) and
 * raises the exit code to the error's own (2 for a usage error such as a malformed input file, 3 for an environment
 * error or an unexpected exception). Every server, browser and started process is closed before it returns.
 * @param {CliValues} values
 * @param {CheckDeps} [deps]
 * @returns {Promise<CheckOutcome>}
 */
export async function runChecks(values, { modulesDir = SCRIPTS_DIR, now = new Date(), log = stderrLog } = {}) {
  const flags = normaliseFlags(values);
  if (!isDirectory(flags.root)) throw new UsageError(`--root ${toPosix(flags.root)} is not an existing folder; pass the repository root`);
  const profile = loadProfile(flags.profile ?? undefined, { root: flags.root });
  if (flags.phase === 'build' && flags.gates.length === 0 && values.phase === undefined) {
    log('frontend-check: no --gates or --phase given; running --phase build');
  }
  const groups = groupsNamed(flags, profile);
  const loads = await loadModules(groups, modulesDir);
  const entries = catalogue(groups, loads);
  const selected = selectGates(flags, entries, profile);
  if (selected.length === 0) throw new UsageError('no gate selected; pass --gates <groups or ids> or --phase build');
  const selectedIds = new Set(selected.map((e) => e.meta.id));
  const selectedGroupNames = new Set(selected.map((e) => e.group));
  for (const a of flags.allowSkip) {
    if (!selectedIds.has(a) && !selectedGroupNames.has(a)) throw new UsageError(`--allow-skip ${a}: not a gate id or group of this run`);
  }
  if (flags.features && !selected.some((e) => e.meta.id === 'coverage.features')) {
    log('frontend-check: --features only restricts coverage.features, which is not selected');
  }
  // Q-F14: with --out the state folder is only read (statePath creates and excludes nothing); every write goes to --out.
  const stateOverride = flags.state ?? modeBStateOutsideRepo(flags.root, profile);
  const state = flags.out ? statePath(flags.root, profile, stateOverride) : stateDir(flags.root, profile, stateOverride);
  const stamp = utcStamp(now);
  const outDir = toPosix(flags.out ?? path.join(state, 'gates', stamp));
  const routes = loadRoutes(flags.root, profile);
  const design = designDir(flags.root, profile);
  const selectedGroups = [...new Set(selected.map((e) => e.group))];

  /** @type {StartedServer | null} */
  let started = null;
  /** @type {{url: string, close: () => Promise<void>} | null} */
  let served = null;
  /** @type {Browser | null} */
  let browser = null;
  const killStarted = () => started?.stopSync();
  /** @type {CheckOutcome | null} */
  let outcome = null;
  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    killStarted();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('exit', killStarted);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    /** @type {string | null} */
    let baseUrl = null;
    if (flags.serve) {
      served = await serveStatic(flags.serve);
      baseUrl = served.url;
      log(`frontend-check: serving ${toPosix(flags.serve)} at ${baseUrl}`);
    } else if (flags.start && flags.url) {
      started = await startServer(flags.start, flags.url, {
        timeoutMs: flags.startTimeoutMs,
        log,
        onSpawn: (handle) => {
          started = handle;
        },
      });
      baseUrl = flags.url;
    } else if (flags.url) {
      baseUrl = flags.url;
    }
    if (baseUrl === null && selectedGroups.some((k) => !['brief', 'refs', 'directions', 'brand', 'tokens'].includes(k))) {
      log('frontend-check: no target (--serve, --url or --start): gates that render pages will report skipped');
    }
    if (selectedGroups.some((k) => !FILE_ONLY_GROUPS.includes(k))) browser = await launch();
    const args = checkArgs(flags, selected.map((e) => e.meta.id), outDir);
    /** @type {CheckContext} */
    const ctx = {
      root: toPosix(flags.root),
      profile,
      state,
      design,
      routes,
      baseUrl,
      browser,
      viewports: profile.viewports,
      args,
      log,
    };
    log(`frontend-check: ${selected.length} gate${selected.length === 1 ? '' : 's'} in ${selectedGroups.join(', ')}`);
    const { results, severity } = await runModules(ctx, selected, loads, log);
    const report = aggregate(results, {
      allowSkip: flags.allowSkip,
      requested: selected.map((e) => e.meta),
      tool: 'frontend-check',
      at: now,
      target: { root: toPosix(flags.root), url: baseUrl, routes: routes.length, viewports: profile.viewports.map((v) => v.name) },
    });
    const reportPath = flags.out ? writeReport(report, flags.out, 'frontend-check') : writeUnique(report, path.join(state, 'gates'), stamp);
    const exitCode = severity > 1 ? severity : report.ok ? 0 : 1;
    outcome = { report, exitCode, reportPath };
    return outcome;
  } finally {
    process.off('exit', killStarted);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    const closing = [];
    if (browser) closing.push(browser.close());
    if (served) closing.push(served.close());
    if (started) closing.push(started.stop());
    const settled = await Promise.allSettled(closing);
    for (const s of settled) if (s.status === 'rejected') log(`frontend-check: cleanup failed: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
    // A started server that outlives the run is an environment error (exit 3) even when every gate passed.
    if (outcome && settled.some((s) => s.status === 'rejected' && s.reason instanceof EnvError)) outcome.exitCode = Math.max(outcome.exitCode, 3);
  }
}

/**
 * Runs each module once with its selected ids, in catalogue order. Missing modules skip their gates, broken ones
 * and ones whose run() throws fail them; the returned severity is the highest exit code those errors call for.
 * @param {CheckContext} ctx
 * @param {CatalogueEntry[]} selected
 * @param {Map<string, ModuleLoad>} loads
 * @param {(message: string) => void} log
 * @returns {Promise<{results: GateResult[], severity: number}>}
 */
async function runModules(ctx, selected, loads, log) {
  /** @type {Map<string, GateResult>} */
  const byId = new Map();
  let severity = 0;
  const modules = [...new Set(selected.map((e) => e.module))];
  for (const name of modules) {
    const mine = selected.filter((e) => e.module === name);
    const load = loads.get(name);
    if (!load || load.state === 'missing') {
      const where = `scripts/${name}`;
      for (const e of mine) byId.set(e.meta.id, gate(e.meta).skip(`module missing: ${where} does not exist yet`));
      log(`frontend-check: ${name} missing; ${mine.length} gate${mine.length === 1 ? '' : 's'} skipped`);
      continue;
    }
    if (load.state === 'broken') {
      const why = describeError(load.error);
      for (const e of mine) byId.set(e.meta.id, gate(e.meta).fail(`module ${name} cannot load: ${why}`));
      severity = Math.max(severity, 3);
      log(`frontend-check: ${name} cannot load: ${why}`);
      continue;
    }
    const declared = mine.filter((e) => e.declared);
    for (const e of mine.filter((x) => !x.declared)) {
      byId.set(e.meta.id, gate(e.meta).skip(`${name} does not declare this gate in its GATES export`));
    }
    if (declared.length === 0) continue;
    const started = Date.now();
    try {
      log(`frontend-check: ${name} running ${declared.map((e) => e.meta.id).join(', ')}`);
      const raw = await load.module.run(ctx, declared.map((e) => e.meta.id));
      for (const [id, result] of normaliseResults(raw, declared, name, log)) byId.set(id, result);
      log(`frontend-check: ${name} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      const why = describeError(err);
      for (const e of declared) byId.set(e.meta.id, gate(e.meta).fail(`module ${name} stopped with an error: ${why}`));
      severity = Math.max(severity, err instanceof FrontendError ? exitCodeOf(err) : 3);
      log(`frontend-check: ${name} stopped with an error: ${why}`);
    }
  }
  const results = selected.map((e) => byId.get(e.meta.id) ?? gate(e.meta).skip(`${e.module} returned no result for this gate`));
  return { results, severity: severity > 1 ? severity : 0 };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function describeError(err) {
  if (err instanceof FrontendError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * The mode-B state folder `<root>/.frontend`, passed to stateDir as an override when the root is an existing folder
 * outside any git work tree, where there is nothing to exclude it from. Null otherwise (stateDir then excludes it in
 * the repository's info/exclude). lib/paths.mjs applies the same repository test, so this only states the intent.
 * @param {string} root
 * @param {Pick<Profile, 'run_mode'>} profile
 * @returns {string | null}
 */
export function modeBStateOutsideRepo(root, profile) {
  if (profile.run_mode !== 'B' || !isDirectory(root) || insideGitWorkTree(root)) return null;
  return path.join(root, '.frontend');
}

/**
 * Whether `dir` is inside a git work tree, by git's own discovery (lib/paths.mjs gitExcludeFile): a `.git` folder or
 * file counts only when it leads to a real git dir, so a stray `.git/info/` in a home folder does not.
 * @param {string} dir
 * @returns {boolean}
 */
export function insideGitWorkTree(dir) {
  return gitExcludeFile(dir) !== null;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Writes `<dir>/<stamp>.json`, or `<stamp>-2.json` and so on when a report of the same second exists.
 * @param {GateReport} report
 * @param {string} dir
 * @param {string} stamp
 * @returns {string}
 */
function writeUnique(report, dir, stamp) {
  let name = stamp;
  for (let n = 2; existsSync(path.join(dir, `${name}.json`)); n += 1) name = `${stamp}-${n}`;
  return writeReport(report, dir, name);
}

/**
 * @param {string} message
 */
function stderrLog(message) {
  process.stderr.write(`${message}\n`);
}

/**
 * Human summary lines (stderr).
 * @param {CheckOutcome} outcome
 * @returns {string[]}
 */
export function summaryLines(outcome) {
  const { report } = outcome;
  const width = Math.max(...report.gates.map((x) => x.id.length), 10);
  const label = { ok: 'ok  ', fail: 'FAIL', skipped: 'skip' };
  const lines = report.gates.map((x) => `  ${x.advisory ? 'adv ' : label[x.state]}  ${x.id.padEnd(width)}  ${x.detail}`);
  const c = report.counts;
  const advisory = c.advisory ? `, ${c.advisory} of them advisory` : '';
  lines.push(
    `frontend-check: ${report.ok ? 'ok' : 'FAIL'} (${c.ok} ok${advisory}, ${c.fail} fail, ${c.skipped} skipped); report ${outcome.reportPath}`,
  );
  return lines;
}

/**
 * The CLI: parses argv, runs, prints the summary to stderr and, with --json, the report to stdout. Returns the exit
 * code; usage and environment errors found before any module ran are thrown.
 * @param {string[]} argv
 * @param {CheckDeps} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const { values, positionals } = parseCli(argv, { help: HELP, options: OPTIONS, allowPositionals: false });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  const outcome = await runChecks(/** @type {CliValues} */ (values), deps);
  for (const line of summaryLines(outcome)) process.stderr.write(`${line}\n`);
  if (values.json) process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
  return outcome.exitCode;
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => exitWith(err),
  );
}
