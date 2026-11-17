// @ts-check
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DRAFT_2020_12, SchemaRegistry, formatErrors } from './json-schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..', '..');
const SCHEMAS = path.join(SKILL, 'assets', 'schemas');
const TEMPLATES = path.join(SKILL, 'assets', 'templates');
const FIXTURES = path.join(HERE, '..', 'fixtures', 'assets', 'schemas');

/** The schemas the task requires (scripts/CONTRACTS.md sections 4 to 6). */
const REQUIRED = ['brief', 'profile-frontend', 'gate-output', 'registry', 'tokens', 'pattern-ledger', 'provenance', 'waivers', 'never-show', 'feature-catalogue', 'routes'];

/**
 * @param {string} file
 * @returns {any}
 */
function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} name */
const id = (name) => `urn:frontend:schema:${name}:1`;

/** @type {SchemaRegistry | null} */
let cached = null;
function registry() {
  if (cached) return cached;
  const reg = new SchemaRegistry();
  for (const file of readdirSync(SCHEMAS)) if (file.endsWith('.schema.json')) reg.add(loadJson(path.join(SCHEMAS, file)));
  cached = reg;
  return reg;
}

/**
 * @param {unknown} value
 * @returns {any}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const outputs = loadJson(path.join(FIXTURES, 'agent-outputs.json'));
const gateOutput = loadJson(path.join(FIXTURES, 'gate-output.json'));

/** Valid data per schema reference: every template and example JSON, and one fixture for the rest. */
const POSITIVE = [
  ['brief', id('brief'), loadJson(path.join(FIXTURES, 'brief.json'))],
  ['profile example', id('profile-frontend'), loadJson(path.join(TEMPLATES, 'profile-frontend.example.json'))],
  ['profile example, resolved shape', `${id('profile-frontend')}#/$defs/resolved`, loadJson(path.join(TEMPLATES, 'profile-frontend.example.json'))],
  ['minimal profile block', id('profile-frontend'), {judged_surface: 'site', stack: 'static-html', hosting: 'local'}],
  ['gate output', id('gate-output'), gateOutput],
  ['bare gate report', `${id('gate-output')}#/$defs/gateReport`, {ok: gateOutput.ok, counts: gateOutput.counts, gates: gateOutput.gates}],
  ['rule registry', id('registry'), loadJson(path.join(SKILL, 'scripts', 'rules', 'registry.json'))],
  ['tokens', id('tokens'), loadJson(path.join(FIXTURES, 'tokens.json'))],
  ['pattern ledger', id('pattern-ledger'), loadJson(path.join(FIXTURES, 'pattern-ledger.json'))],
  ['provenance template', id('provenance'), loadJson(path.join(TEMPLATES, 'provenance.json'))],
  ['waivers template', id('waivers'), loadJson(path.join(TEMPLATES, 'waivers.json'))],
  ['never-show template', id('never-show'), loadJson(path.join(TEMPLATES, 'never-show.json'))],
  ['feature catalogue template', id('feature-catalogue'), loadJson(path.join(TEMPLATES, 'feature-catalogue.json'))],
  ['routes template', id('routes'), loadJson(path.join(TEMPLATES, 'routes.json'))],
  ['choices template', id('choices'), loadJson(path.join(TEMPLATES, 'choices.json'))],
  ['task templates', id('task-templates'), loadJson(path.join(SKILL, 'assets', 'task-templates', 'frontend.json'))],
  ['sponsor allowlist', id('sponsor-allowlist'), loadJson(path.join(SKILL, 'assets', 'sponsor-allowlist.json'))],
  ['critic critique', id('critic-output'), outputs.critique],
  ['critic pairwise', id('critic-output'), outputs.pairwise],
  ['critic probe-match', id('critic-output'), outputs.probeMatch],
  ['probe output', id('probe-output'), outputs.probe],
  ['measure command output', `${id('fragment-commands')}#/$defs/measure`, outputs.measure],
];

/**
 * @typedef {{name: string, ref: string, base: unknown, mutate: (d: any) => unknown, expect: string}} Negative
 */

const brief = POSITIVE[0][2];
const profile = POSITIVE[1][2];
const registryJson = POSITIVE[6][2];
const tokens = POSITIVE[7][2];
const ledger = POSITIVE[8][2];
const provenance = POSITIVE[9][2];
const waivers = POSITIVE[10][2];
const neverShow = POSITIVE[11][2];
const catalogue = POSITIVE[12][2];
const routes = POSITIVE[13][2];
const choices = POSITIVE[14][2];
const templates = POSITIVE[15][2];
const allowlist = POSITIVE[16][2];

/**
 * A replacement function that returns its argument (so `mutate` can be written as one expression).
 * @template T
 * @param {T} d
 * @param {(d: T) => void} fn
 * @returns {T}
 */
function edit(d, fn) {
  fn(d);
  return d;
}

/** The choices template with the v1.1 review-canvas fields (Q-F11) on H1 and H2. @returns {any} */
function choicesCanvas() {
  const d = JSON.parse(JSON.stringify(choices));
  for (const key of ['H1', 'H2']) {
    Object.assign(d[key], { canvas_url: 'https://claude.ai/artifact/0f3c-review', type_release: '1790818940-93cf', published_at: '2026-10-06T06:10:00Z' });
  }
  return d;
}

/** The choices template with H1 answered "none of these" and its reason (DR-12). @returns {any} */
function choicesNone() {
  const d = JSON.parse(JSON.stringify(choices));
  Object.assign(d.H1, { pick: 'none', reason: 'all three read as generic fintech dashboards' });
  return d;
}

/** A waivers file whose only entry is a v1.1 owner waiver for coverage.features. @returns {any} */
function featureWaiver() {
  return {
    waivers: [{
      rule: 'coverage.features', scope: 'FR-012, FR-014', reason: 'CLI-only rows: the owner kept them off the judged page',
      evidence: '.execution/decisions.md#D-07', approved_by: 'owner', date: '2026-10-06',
    }],
  };
}

/** @type {Negative[]} */
const NEGATIVE = [
  // brief.json (6.4)
  {name: 'brief without hero', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => delete x.hero), expect: 'missing required property "hero"'},
  {name: 'brief hero without its source', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.hero.source = ''; }), expect: 'must have at least 1 characters'},
  {name: 'brief customer URL without its source', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.customers[0].url_source = ''; }), expect: 'must have at least 1 characters'},
  {name: 'brief feature with an unknown status', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.features[0].status = 'beta'; }), expect: 'must be one of'},
  {name: 'brief feature without a source', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.features[0].source = ''; }), expect: 'must have at least 1 characters'},
  {name: 'brief missing entry with an unknown action', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.missing[0].action = 'ask'; }), expect: 'must be one of'},
  {name: 'brief never-show date not in UTC', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.never_show[0].until_utc = '2026-10-11T12:00:00+02:00'; }), expect: 'must match exactly one schema of oneOf'},
  {name: 'brief with an unknown key', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.tagline = 'x'; }), expect: 'unexpected property "tagline"'},
  {name: 'brief judge path beats without a source', ref: id('brief'), base: brief, mutate: (d) => edit(d, (x) => { x.judge_path.source = ''; }), expect: 'must have at least 1 characters'},
  // profile block (6.1)
  {name: 'profile with an unknown mode', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.mode = 'medium'; }), expect: 'must be one of'},
  {name: 'profile without stack', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => delete x.stack), expect: 'missing required property "stack"'},
  {name: 'profile with no viewport', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.viewports = []; }), expect: 'must have at least 1 items'},
  {name: 'profile viewport with an unknown key', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.viewports[0].scale = 2; }), expect: 'unexpected property "scale"'},
  {name: 'profile video embedded as ppt', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.format.video.embed = 'ppt'; }), expect: 'must match exactly one schema of oneOf'},
  {name: 'profile with a relative claims ledger', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.paths.claims_ledger = 'claims.md'; }), expect: 'must match'},
  {name: 'profile with an absolute design folder', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.paths.design = 'C:/repo/design'; }), expect: 'must match'},
  {name: 'profile with too many rounds', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.critique.rounds_max = 11; }), expect: 'must be <= 10'},
  {name: 'profile sponsor id in capitals', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.sponsors = ['Cardano']; }), expect: 'must match'},
  {name: 'profile sponsor_allowlist entry without sponsor', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.sponsor_allowlist = [{display_name: 'Cardano'}]; }), expect: 'must match at least one schema of anyOf'},
  {name: 'profile reference URL without scheme', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.references[0].url = 'aave.com'; }), expect: 'must be a valid uri'},
  {name: 'profile prework date that is not a date', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.prework_designs.until_utc = 'tomorrow'; }), expect: 'must match exactly one schema of oneOf'},
  {name: 'profile firstview band without max_kib', ref: id('profile-frontend'), base: edit(JSON.parse(JSON.stringify(profile)), (x) => { x.firstview = {complexity: {min_kib: 40, max_kib: 120, calibrated: true, source: 'calibration'}}; }), mutate: (d) => edit(d, (x) => { delete x.firstview.complexity.max_kib; }), expect: 'missing required property "max_kib"'},
  {name: 'profile with an unknown key', ref: id('profile-frontend'), base: profile, mutate: (d) => edit(d, (x) => { x.theme = 'dark'; }), expect: 'unexpected property "theme"'},
  {name: 'resolved profile without mode', ref: `${id('profile-frontend')}#/$defs/resolved`, base: profile, mutate: (d) => edit(d, (x) => delete x.mode), expect: 'missing required property "mode"'},
  // gate output (4)
  {name: 'gate output ok while a gate fails', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.ok = true; }), expect: 'must not match'},
  {name: 'gate output ok with no gate', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.ok = true; x.gates = []; x.counts = {ok: 0, fail: 0, skipped: 0}; }), expect: 'must have at least 1 items'},
  {name: 'gate with an unknown state', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.gates[0].state = 'passed'; }), expect: 'must be one of'},
  {name: 'gate id in capitals', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.gates[0].id = 'Render.Console'; }), expect: 'must match'},
  {name: 'gate without ifDropped', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => delete x.gates[0].ifDropped), expect: 'missing required property "ifDropped"'},
  {name: 'gate output of another version', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.version = '2'; }), expect: 'must equal'},
  {name: 'gate output time without zone', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.at = '2026-10-01 10:00'; }), expect: 'must be a valid date-time'},
  {name: 'gate output negative count', ref: id('gate-output'), base: gateOutput, mutate: (d) => edit(d, (x) => { x.counts.skipped = -1; }), expect: 'must be >= 0'},
  // registry (5)
  {name: 'rule with no detector layer', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].static = false; x.rules[0].runtime = false; }), expect: 'must match at least one schema of anyOf'},
  {name: 'owner tell without its number', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].tell = null; }), expect: 'expected integer, got null'},
  {name: 'missing tell with a tell number', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[20].tell = 3; }), expect: 'expected null, got integer'},
  {name: 'rule with an unknown tier', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].tier = 'tier3'; }), expect: 'must be one of'},
  {name: 'rule id without family letter', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].id = 'SL-01'; }), expect: 'must match'},
  {name: 'rule without sources', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].sources = []; }), expect: 'must have at least 1 items'},
  {name: 'negative calibration count', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].calibration.positives.fired = -1; }), expect: 'must be >= 0'},
  {name: 'rule with an unknown key', ref: id('registry'), base: registryJson, mutate: (d) => edit(d, (x) => { x.rules[0].severity = 'high'; }), expect: 'unexpected property "severity"'},
  // tokens (6.2)
  {name: 'token name in capitals', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => { x.color.tokens[0].name = 'Ground'; }), expect: 'must match'},
  {name: 'token with an empty usage', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => { x.color.tokens[0].usage = ''; }), expect: 'must have at least 1 characters'},
  {name: 'colour token with no theme value', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => { x.color.tokens[0].value = {}; }), expect: 'must have at least 1 properties'},
  {name: 'font without its licence file', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => delete x.type.fonts[0].licenseFile), expect: 'missing required property "licenseFile"'},
  {name: 'font file outside the repository', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => { x.type.fonts[0].file = '../fonts/a.woff2'; }), expect: 'must match'},
  {name: 'motion token without usage', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => delete x.motion.tokens[0].usage), expect: 'missing required property "usage"'},
  {name: 'tokens without shadow', ref: id('tokens'), base: tokens, mutate: (d) => edit(d, (x) => delete x.shadow), expect: 'missing required property "shadow"'},
  // pattern ledger (6.5)
  {name: 'convention drawn from one reference', ref: id('pattern-ledger'), base: ledger, mutate: (d) => edit(d, (x) => { x.patterns[0].from = ['R1']; }), expect: 'must have at least 2 items'},
  {name: 'reference purged as text', ref: id('pattern-ledger'), base: ledger, mutate: (d) => edit(d, (x) => { x.references[0].purged = 'yes'; }), expect: 'expected boolean, got string'},
  {name: 'reference URL over ftp', ref: id('pattern-ledger'), base: ledger, mutate: (d) => edit(d, (x) => { x.references[0].url = 'ftp://aave.com/'; }), expect: 'must match'},
  {name: 'pattern of an unknown kind', ref: id('pattern-ledger'), base: ledger, mutate: (d) => edit(d, (x) => { x.patterns[0].kind = 'opinion'; }), expect: 'must be one of'},
  // provenance (6.2)
  {name: 'font asset without licence file', ref: id('provenance'), base: provenance, mutate: (d) => edit(d, (x) => delete x.assets[1].licenseFile), expect: 'missing required property "licenseFile"'},
  {name: 'asset path from the root', ref: id('provenance'), base: provenance, mutate: (d) => edit(d, (x) => { x.assets[0].path = '/brand/mark.svg'; }), expect: 'must match'},
  {name: 'asset path with a backslash', ref: id('provenance'), base: provenance, mutate: (d) => edit(d, (x) => { x.assets[0].path = 'brand\\mark.svg'; }), expect: 'must match'},
  {name: 'asset with an unknown ai value', ref: id('provenance'), base: provenance, mutate: (d) => edit(d, (x) => { x.assets[0].ai = 'yes'; }), expect: 'must be one of'},
  {name: 'asset of an unknown kind', ref: id('provenance'), base: provenance, mutate: (d) => edit(d, (x) => { x.assets[0].kind = 'audio'; }), expect: 'must be one of'},
  // waivers (5, 6.2)
  {name: 'waiver with empty evidence', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => { x.waivers[0].evidence = ''; }), expect: 'must match at least one schema of anyOf'},
  {name: 'waiver with an empty evidence list', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => { x.waivers[0].evidence = []; }), expect: 'must match at least one schema of anyOf'},
  {name: 'waiver with a blank reason', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => { x.waivers[0].reason = '   '; }), expect: 'must match'},
  {name: 'waiver approved by a model', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => { x.waivers[0].approved_by = 'model'; }), expect: 'must be one of'},
  {name: 'waiver for an unknown rule id', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => { x.waivers[0].rule = 'T01'; }), expect: 'must match'},
  {name: 'category entry without a reason', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => delete x.category[0].reason), expect: 'missing required property "reason"'},
  {name: 'waiver dated in local format', ref: id('waivers'), base: waivers, mutate: (d) => edit(d, (x) => { x.waivers[0].date = '06/10/2026'; }), expect: 'must match'},
  // never-show (6.1b)
  {name: 'embargo without an end date', ref: id('never-show'), base: neverShow, mutate: (d) => edit(d, (x) => { x.entries[0].until_utc = null; }), expect: 'expected string, got null'},
  {name: 'regex entry that does not compile', ref: id('never-show'), base: neverShow, mutate: (d) => edit(d, (x) => { x.entries[2].pattern = '(unclosed'; }), expect: 'must be a valid regex'},
  {name: 'entry of an unknown class', ref: id('never-show'), base: neverShow, mutate: (d) => edit(d, (x) => { x.entries[0].class = 'secret'; }), expect: 'must be one of'},
  {name: 'entry of an unknown scope', ref: id('never-show'), base: neverShow, mutate: (d) => edit(d, (x) => { x.entries[0].scope = 'all'; }), expect: 'must be one of'},
  {name: 'never-show of another version', ref: id('never-show'), base: neverShow, mutate: (d) => edit(d, (x) => { x.version = 2; }), expect: 'must equal'},
  {name: 'entry without case_sensitive', ref: id('never-show'), base: neverShow, mutate: (d) => edit(d, (x) => delete x.entries[0].case_sensitive), expect: 'missing required property "case_sensitive"'},
  // feature catalogue (6.1b)
  {name: 'feature id with one digit', ref: id('feature-catalogue'), base: catalogue, mutate: (d) => edit(d, (x) => { x[0].id = 'FR-1'; }), expect: 'must match'},
  {name: 'feature priority P0', ref: id('feature-catalogue'), base: catalogue, mutate: (d) => edit(d, (x) => { x[0].priority = 'P0'; }), expect: 'must be one of'},
  {name: 'empty feature catalogue', ref: id('feature-catalogue'), base: catalogue, mutate: () => [], expect: 'must have at least 1 items'},
  {name: 'feature with an unknown expected status', ref: id('feature-catalogue'), base: catalogue, mutate: (d) => edit(d, (x) => { x[0].status_expected = 'beta'; }), expect: 'must be one of'},
  // routes (6.2)
  {name: 'two first routes', ref: id('routes'), base: routes, mutate: (d) => edit(d, (x) => { x[1].first = true; }), expect: 'must contain at most 1 matching item(s)'},
  {name: 'route path without a slash', ref: id('routes'), base: routes, mutate: (d) => edit(d, (x) => { x[1].path = 'queue'; }), expect: 'must match'},
  {name: 'route listing a feature twice', ref: id('routes'), base: routes, mutate: (d) => edit(d, (x) => { x[0].features = ['FR-001', 'FR-001']; }), expect: 'are equal'},
  {name: 'route without features', ref: id('routes'), base: routes, mutate: (d) => edit(d, (x) => delete x[2].features), expect: 'missing required property "features"'},
  {name: 'no route', ref: id('routes'), base: routes, mutate: () => [], expect: 'must have at least 1 items'},
  // choices (6.3)
  {name: 'H1 pick outside A-C', ref: id('choices'), base: choices, mutate: (d) => edit(d, (x) => { x.H1.pick = 'D'; }), expect: 'must match'},
  {name: 'H3 refused without changes', ref: id('choices'), base: choices, mutate: (d) => edit(d, (x) => { x.H3.signed_off = false; }), expect: 'must have at least 1 items'},
  {name: 'H3 signed off with changes', ref: id('choices'), base: choices, mutate: (d) => edit(d, (x) => { x.H3.changes = ['fix the hero']; }), expect: 'must have at most 0 items'},
  {name: 'answer taken from a canvas comment', ref: id('choices'), base: choices, mutate: (d) => edit(d, (x) => { x.H1.channel = 'canvas-comment'; }), expect: 'must be one of'},
  {name: 'answer time not in UTC', ref: id('choices'), base: choices, mutate: (d) => edit(d, (x) => { x.H2.answered_at = '2026-10-06T08:05:00+02:00'; }), expect: 'must match'},
  {name: 'H1 none without a reason', ref: id('choices'), base: choicesNone(), mutate: (d) => edit(d, (x) => { delete x.H1.reason; }), expect: 'missing required property "reason"'},
  {name: 'H1 none with a blank reason', ref: id('choices'), base: choicesNone(), mutate: (d) => edit(d, (x) => { x.H1.reason = '  '; }), expect: 'must match'},
  // choices v1.1 (Q-F11): the review canvas of H1 and H2; the base itself must validate with the new fields
  {name: 'canvas_url not https', ref: id('choices'), base: choicesCanvas(), mutate: (d) => edit(d, (x) => { x.H1.canvas_url = 'http://claude.ai/artifact/x'; }), expect: 'must match'},
  {name: 'canvas published_at not in UTC', ref: id('choices'), base: choicesCanvas(), mutate: (d) => edit(d, (x) => { x.H2.published_at = '2026-10-06T08:00:00+02:00'; }), expect: 'must match'},
  {name: 'empty type_release', ref: id('choices'), base: choicesCanvas(), mutate: (d) => edit(d, (x) => { x.H1.type_release = ''; }), expect: 'must'},
  {name: 'canvas fields on H3', ref: id('choices'), base: choicesCanvas(), mutate: (d) => edit(d, (x) => { x.H3.canvas_url = 'https://claude.ai/artifact/x'; }), expect: 'unexpected property "canvas_url"'},
  // waivers v1.1: an owner waiver keeping catalogue rows off the page (coverage.features)
  {name: 'coverage.features waiver approved by research', ref: id('waivers'), base: featureWaiver(), mutate: (d) => edit(d, (x) => { x.waivers[0].approved_by = 'research'; }), expect: 'must'},
  {name: 'coverage.features waiver scope not FR ids', ref: id('waivers'), base: featureWaiver(), mutate: (d) => edit(d, (x) => { x.waivers[0].scope = '/route .card'; }), expect: 'must match'},
  {name: 'coverage.features waiver with an evidence list', ref: id('waivers'), base: featureWaiver(), mutate: (d) => edit(d, (x) => { x.waivers[0].evidence = ['a', 'b']; }), expect: 'expected string, got array'},
  {name: 'waiver naming another gate id', ref: id('waivers'), base: featureWaiver(), mutate: (d) => edit(d, (x) => { x.waivers[0].rule = 'coverage.hero'; }), expect: 'must'},
  // task templates
  {name: 'manual template with a model', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[1].model = 'opus'; }), expect: 'must equal null'},
  {name: 'fragment template without its fragment', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[3].fragment = null; }), expect: 'expected object, got null'},
  {name: 'brief ref outside references', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[0].brief_refs = ['C:/Users/Utilisateur/.claude/skills/frontend/SKILL.md']; }), expect: 'must match'},
  {name: 'unknown resource', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[2].resources = ['gpu']; }), expect: 'must match'},
  {name: 'conditional dependency written as text', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[3].depends = ['FE-02 or FE-00']; }), expect: 'must match at least one schema of anyOf'},
  {name: 'proof of an unknown type', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[0].proof.type = 'tx'; }), expect: 'must be one of'},
  {name: 'template with an unknown key', ref: id('task-templates'), base: templates, mutate: (d) => edit(d, (x) => { x.templates[0].priority = 'P1'; }), expect: 'unexpected property "priority"'},
  // sponsor allowlist (FD21)
  {name: 'logo hash that is not SHA-256', ref: id('sponsor-allowlist'), base: allowlist, mutate: (d) => edit(d, (x) => { x.sponsor_allowlist[0].logo_sources[0].sha256 = 'abc'; }), expect: 'must match'},
  {name: 'unknown logo default', ref: id('sponsor-allowlist'), base: allowlist, mutate: (d) => edit(d, (x) => { x.sponsor_allowlist[0].logo_default = 'logo_ok'; }), expect: 'must be one of'},
  {name: 'forbidden phrase that does not compile', ref: id('sponsor-allowlist'), base: allowlist, mutate: (d) => edit(d, (x) => { x.sponsor_allowlist[0].forbidden_phrases[0].regex = '(unclosed'; }), expect: 'must be a valid regex'},
  {name: 'forbidden phrase with an unknown flag', ref: id('sponsor-allowlist'), base: allowlist, mutate: (d) => edit(d, (x) => { x.sponsor_allowlist[0].forbidden_phrases[0].flags = 'z'; }), expect: 'must match'},
  {name: 'entry without its access date', ref: id('sponsor-allowlist'), base: allowlist, mutate: (d) => edit(d, (x) => delete x.sponsor_allowlist[0].accessed), expect: 'missing required property "accessed"'},
  // agent outputs and command outputs
  {name: 'critique with six issues', ref: id('critic-output'), base: outputs.critique, mutate: (d) => edit(d, (x) => { x.issues = Array.from({length: 6}, () => x.issues[0]); }), expect: 'must match exactly one schema of oneOf'},
  {name: 'pairwise preferring a third version', ref: id('critic-output'), base: outputs.pairwise, mutate: (d) => edit(d, (x) => { x.preferred = 'C'; }), expect: 'must match exactly one schema of oneOf'},
  {name: 'probe answer without unclear', ref: id('probe-output'), base: outputs.probe, mutate: (d) => edit(d, (x) => delete x.unclear), expect: 'missing required property "unclear"'},
  {name: 'probe answer with coordinates field', ref: id('probe-output'), base: outputs.probe, mutate: (d) => edit(d, (x) => { x.box = [0, 0, 10, 10]; }), expect: 'unexpected property "box"'},
  {name: 'measure with a symbolic sha', ref: `${id('fragment-commands')}#/$defs/measure`, base: outputs.measure, mutate: (d) => edit(d, (x) => { x.sha = 'HEAD'; }), expect: 'must match'},
  {name: 'measure without first views', ref: `${id('fragment-commands')}#/$defs/measure`, base: outputs.measure, mutate: (d) => edit(d, (x) => { x.first_view = {}; }), expect: 'must have at least 1 properties'},
];

describe('assets/schemas', () => {
  test('every required schema exists, is draft 2020-12 and is named after its file', () => {
    const files = readdirSync(SCHEMAS).filter((f) => f.endsWith('.schema.json'));
    for (const name of REQUIRED) assert.ok(files.includes(`${name}.schema.json`), `missing assets/schemas/${name}.schema.json`);
    for (const file of files) {
      const schema = loadJson(path.join(SCHEMAS, file));
      const name = file.replace(/\.schema\.json$/, '');
      assert.equal(schema.$schema, DRAFT_2020_12, `${file}: $schema`);
      assert.equal(schema.$id, id(name), `${file}: $id`);
      assert.equal(typeof schema.title, 'string', `${file}: title`);
      assert.ok(typeof schema.description === 'string' && schema.description.length > 40, `${file}: description`);
    }
  });

  test('schemas use only supported keywords, compiling patterns and resolvable references', () => {
    const errors = registry().lint();
    assert.deepEqual(errors, [], formatErrors(errors));
  });

  test('schema files are LF-only UTF-8 without BOM', () => {
    for (const file of readdirSync(SCHEMAS)) {
      const bytes = readFileSync(path.join(SCHEMAS, file));
      assert.ok(!bytes.includes(13), `${file} contains CR`);
      assert.notEqual(bytes[0], 0xef, `${file} starts with a BOM`);
    }
  });

  for (const [name, ref, data] of POSITIVE) {
    test(`valid: ${name}`, () => {
      const errors = registry().validate(String(ref), data);
      assert.deepEqual(errors, [], formatErrors(errors));
    });
  }

  for (const neg of NEGATIVE) {
    test(`invalid: ${neg.name}`, () => {
      const data = neg.mutate(clone(neg.base));
      const errors = registry().validate(neg.ref, data);
      assert.ok(errors.length > 0, `${neg.name}: expected a validation error`);
      const text = formatErrors(errors);
      assert.ok(text.includes(neg.expect), `${neg.name}: expected an error containing ${JSON.stringify(neg.expect)}, got:\n${text}`);
    });
  }

  test('every negative case starts from data that validates', () => {
    for (const neg of NEGATIVE) {
      const errors = registry().validate(neg.ref, neg.base);
      assert.deepEqual(errors, [], `${neg.name}: its base is already invalid:\n${formatErrors(errors)}`);
    }
  });
});
