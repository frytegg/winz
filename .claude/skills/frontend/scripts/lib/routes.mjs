// @ts-check
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from './errors.mjs';
import { readText } from './fsutil.mjs';
import { designDir } from './paths.mjs';

/**
 * @typedef {{path: string, name: string, first: boolean, features: string[], states: string[]}} Route
 */

/** The route list used when `<design>/routes.json` does not exist. */
export const DEFAULT_ROUTES = Object.freeze([Object.freeze({ path: '/', name: 'home', first: true, features: [], states: [] })]);

/**
 * Reads `<design>/routes.json` (`[{path, name, first?, features, states?}]`, section 6.2) and validates it: paths
 * start with '/', paths and names are unique, at most one route is `first` (the first route is marked first when
 * none is), features and states are string arrays. Without the file, returns the single home route.
 * @param {string} root
 * @param {{paths?: {design?: string}}} profile
 * @returns {Route[]}
 */
export function loadRoutes(root, profile) {
  const file = path.join(designDir(root, profile), 'routes.json');
  if (!existsSync(file)) return DEFAULT_ROUTES.map((r) => ({ ...r, features: [], states: [] }));
  const where = file.replace(/\\/g, '/');
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`${where} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix the file`, { cause: err });
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new UsageError(`${where} must be a non-empty array of {path, name, first?, features, states?}`);
  }
  /** @type {string[]} */
  const problems = [];
  /** @type {Route[]} */
  const routes = [];
  const paths = new Set();
  const names = new Set();
  raw.forEach((item, i) => {
    const at = `routes[${i}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problems.push(`${at} must be an object`);
      return;
    }
    const r = /** @type {Record<string, unknown>} */ (item);
    if (typeof r.path !== 'string' || !r.path.startsWith('/')) problems.push(`${at}.path must be a string starting with "/"`);
    if (typeof r.name !== 'string' || r.name.trim() === '') problems.push(`${at}.name must be a non-empty string`);
    if (r.first !== undefined && typeof r.first !== 'boolean') problems.push(`${at}.first must be true or false`);
    const features = stringList(r.features, `${at}.features`, problems);
    const states = stringList(r.states, `${at}.states`, problems);
    const routePath = typeof r.path === 'string' ? r.path : '';
    const name = typeof r.name === 'string' ? r.name : '';
    if (routePath && paths.has(routePath)) problems.push(`${at}.path "${routePath}" is listed twice`);
    if (name && names.has(name)) problems.push(`${at}.name "${name}" is used twice`);
    paths.add(routePath);
    names.add(name);
    routes.push({ path: routePath, name, first: r.first === true, features, states });
  });
  const firsts = routes.filter((r) => r.first);
  if (firsts.length > 1) problems.push(`only one route may be first (found ${firsts.map((r) => r.path).join(', ')})`);
  if (problems.length > 0) throw new UsageError(`${where}: ${problems.join('; ')}; fix the routes file`);
  if (firsts.length === 0) routes[0].first = true;
  return routes;
}

/**
 * @param {unknown} value
 * @param {string} at
 * @param {string[]} problems
 * @returns {string[]}
 */
function stringList(value, at, problems) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
    problems.push(`${at} must be an array of non-empty strings`);
    return [];
  }
  return [...value];
}

/**
 * The URL of a route under `base`: the route path is appended to the base path (a base such as
 * `https://user.github.io/repo/` keeps its `/repo` prefix), the route's own query and hash are kept, and
 * `record=1` is appended to the query (`?record=1` or `&record=1`) when `profile.record_mode` is on.
 * @param {string} base
 * @param {{path: string}} route
 * @param {{record_mode?: boolean}} profile
 * @returns {string}
 */
export function routeUrl(base, route, profile) {
  let url;
  try {
    url = new URL(base);
  } catch (err) {
    throw new UsageError(`base URL ${JSON.stringify(base)} is not a valid absolute URL; pass --url http://host:port`, { cause: err });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`base URL ${JSON.stringify(base)} must start with http:// or https://; pass --url http://host:port`);
  }
  const target = new URL(route.path, 'http://route.invalid');
  url.pathname = url.pathname.replace(/\/+$/, '') + target.pathname;
  let search = url.search;
  if (target.search) search = search ? `${search}&${target.search.slice(1)}` : target.search;
  if (profile?.record_mode && !/[?&]record=1(?:&|$)/.test(search)) search = search ? `${search}&record=1` : '?record=1';
  url.search = search;
  if (target.hash) url.hash = target.hash;
  return url.toString();
}
