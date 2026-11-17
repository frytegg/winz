// @ts-check
/**
 * Installs the /frontend skill's two read-only agent definitions, frontend-critic and frontend-probe, from
 * assets/agents/ into the user's Claude Code agents folder (~/.claude/agents/), where /execution's wave scripts and
 * /frontend's own workflows find them through agent({agentType}). The installed file is a byte-for-byte copy of the
 * template, so --check is a plain comparison; a different file already there is never overwritten without --force,
 * and --force keeps the previous file as <name>.md.bak.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli, isMainModule } from './lib/args.mjs';
import { CheckError, EnvError, UsageError, exitWith } from './lib/errors.mjs';

/** The agent definitions this skill ships, by name (file <name>.md in assets/agents/). */
export const AGENTS = Object.freeze(['frontend-critic', 'frontend-probe']);

/** Folder of the agent templates shipped with the skill. */
export const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'agents');

const HELP = `Usage: node install-agents.mjs [--check | --dry-run] [--force] [--home <dir> | --agents-dir <dir>] [--json]

Copies the /frontend agent templates (frontend-critic, frontend-probe) from assets/agents/ into the Claude Code
agents folder, byte for byte.

Options:
  --check            compare only: exit 0 when both agents are installed and identical to their templates
  --dry-run          print what an install would do, write nothing
  --force            replace an installed file that differs from its template (the old file is kept as .md.bak)
  --home <dir>       use <dir>/.claude/agents instead of the user's home (tests, a second account)
  --agents-dir <dir> install into <dir> directly
  --json             print the machine report on stdout
  -h, --help         this text

The agents folder is, in order: --agents-dir, <--home>/.claude/agents, $CLAUDE_CONFIG_DIR/agents,
~/.claude/agents. Claude Code reads new agent files within seconds, but a session started before the folder existed
needs a restart; start a new session after the first install.

Exit codes: 0 done (or --check: up to date); 1 an installed file differs and --force was not given, or --check found
a missing or different file; 2 usage error; 3 environment error (template missing, folder not writable).`;

/**
 * @typedef {'missing' | 'same' | 'different'} AgentStatus
 * @typedef {'installed' | 'updated' | 'unchanged' | 'refused' | 'would-install' | 'would-update' | 'missing' | 'different'} AgentAction
 * @typedef {{name: string, template: string, dest: string, status: AgentStatus, action: AgentAction,
 *   templateSha256: string, installedSha256: string | null, backup: string | null}} AgentResult
 * @typedef {{ok: boolean, mode: 'install' | 'check' | 'dry-run', force: boolean, agentsDir: string,
 *   templateDir: string, results: AgentResult[], restartNeeded: boolean}} InstallReport
 */

/**
 * The agents folder, by precedence: an explicit folder, a home folder, CLAUDE_CONFIG_DIR, the user's home.
 * @param {{agentsDir?: string, home?: string, env?: NodeJS.ProcessEnv}} [where]
 * @returns {string}
 */
export function resolveAgentsDir({ agentsDir, home, env = process.env } = {}) {
  if (agentsDir) return path.resolve(agentsDir);
  if (home) return path.resolve(home, '.claude', 'agents');
  if (env.CLAUDE_CONFIG_DIR) return path.resolve(env.CLAUDE_CONFIG_DIR, 'agents');
  return path.resolve(os.homedir(), '.claude', 'agents');
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Reads a template and checks that it is an agent definition named after its file.
 * @param {string} templateDir
 * @param {string} name
 * @returns {{file: string, bytes: Buffer}}
 */
function readTemplate(templateDir, name) {
  const file = path.join(templateDir, `${name}.md`);
  if (!existsSync(file)) {
    throw new EnvError(`agent template ${toPosix(file)} is missing; restore the skill's assets/agents folder`);
  }
  const bytes = readFileSync(file);
  const text = bytes.toString('utf8');
  if (!text.startsWith('---\n') || !new RegExp(`^name: ${name}$`, 'm').test(text.split('\n---\n')[0])) {
    throw new EnvError(`agent template ${toPosix(file)} has no frontmatter naming ${name}; restore it from the skill`);
  }
  return { file, bytes };
}

/**
 * Compares every template with the installed file, without writing.
 * @param {{templateDir?: string, agentsDir: string}} where
 * @returns {Array<{name: string, template: string, dest: string, bytes: Buffer, installed: Buffer | null, status: AgentStatus}>}
 */
export function compareAgents({ templateDir = TEMPLATE_DIR, agentsDir }) {
  return AGENTS.map((name) => {
    const { file, bytes } = readTemplate(templateDir, name);
    const dest = path.join(agentsDir, `${name}.md`);
    let installed = null;
    if (existsSync(dest)) {
      try {
        installed = readFileSync(dest);
      } catch (err) {
        throw new EnvError(`cannot read ${toPosix(dest)} (${err instanceof Error ? err.message : String(err)}); check its permissions`, { cause: err });
      }
    }
    /** @type {AgentStatus} */
    const status = installed === null ? 'missing' : installed.equals(bytes) ? 'same' : 'different';
    return { name, template: file, dest, bytes, installed, status };
  });
}

/**
 * Writes a file through a temporary sibling and a rename, so a reader never sees half a definition.
 * @param {string} dest
 * @param {Buffer} bytes
 */
function writeAtomic(dest, bytes) {
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new EnvError(`cannot write ${toPosix(dest)} (${err instanceof Error ? err.message : String(err)}); check the folder's permissions`, { cause: err });
  }
}

/**
 * Installs, checks or dry-runs the agent definitions. Pure apart from the files it reads and, in install mode,
 * writes; the CLI maps the report to an exit code.
 * @param {{mode?: 'install' | 'check' | 'dry-run', force?: boolean, templateDir?: string, agentsDir: string}} options
 * @returns {InstallReport}
 */
export function installAgents({ mode = 'install', force = false, templateDir = TEMPLATE_DIR, agentsDir }) {
  const compared = compareAgents({ templateDir, agentsDir });
  /** @type {AgentResult[]} */
  const results = [];
  let restartNeeded = false;
  if (mode === 'install' && compared.some((c) => c.status === 'missing' || (c.status === 'different' && force))) {
    const existed = existsSync(agentsDir);
    try {
      mkdirSync(agentsDir, { recursive: true });
    } catch (err) {
      throw new EnvError(`cannot create ${toPosix(agentsDir)} (${err instanceof Error ? err.message : String(err)}); create it or pass --agents-dir`, { cause: err });
    }
    if (!existed) restartNeeded = true;
  }
  for (const c of compared) {
    /** @type {AgentAction} */
    let action;
    let backup = null;
    if (mode === 'check') {
      action = c.status === 'same' ? 'unchanged' : c.status;
    } else if (c.status === 'same') {
      action = 'unchanged';
    } else if (c.status === 'missing') {
      action = mode === 'dry-run' ? 'would-install' : 'installed';
      if (mode === 'install') writeAtomic(c.dest, c.bytes);
    } else if (!force) {
      action = 'refused';
    } else if (mode === 'dry-run') {
      action = 'would-update';
    } else {
      backup = `${c.dest}.bak`;
      writeAtomic(backup, /** @type {Buffer} */ (c.installed));
      writeAtomic(c.dest, c.bytes);
      action = 'updated';
    }
    results.push({
      name: c.name,
      template: toPosix(c.template),
      dest: toPosix(c.dest),
      status: c.status,
      action,
      templateSha256: sha256(c.bytes),
      installedSha256: c.installed === null ? null : sha256(c.installed),
      backup: backup === null ? null : toPosix(backup),
    });
  }
  const ok = mode === 'check'
    ? results.every((r) => r.status === 'same')
    : results.every((r) => r.action !== 'refused');
  return { ok, mode, force, agentsDir: toPosix(agentsDir), templateDir: toPosix(templateDir), results, restartNeeded };
}

/**
 * One human line per agent, for stderr.
 * @param {InstallReport} report
 * @returns {string[]}
 */
export function describe(report) {
  /** @type {Record<AgentAction, string>} */
  const words = {
    installed: 'installed',
    updated: 'updated (previous file kept as .md.bak)',
    unchanged: 'up to date',
    refused: 'differs from its template; not replaced (run with --force to replace it, keeping a .md.bak)',
    'would-install': 'would be installed',
    'would-update': 'would be replaced (previous file kept as .md.bak)',
    missing: 'not installed',
    different: 'differs from its template',
  };
  const lines = report.results.map((r) => `${r.name}: ${words[r.action]} (${r.dest})`);
  if (report.results.some((r) => r.action === 'installed' || r.action === 'updated')) {
    lines.push(
      report.restartNeeded
        ? `created ${report.agentsDir}: start a new Claude Code session so it loads the agents`
        : 'Claude Code picks the new definitions up within seconds; a session started before this folder existed needs a restart',
    );
  }
  return lines;
}

/**
 * The CLI: prints one line per agent on stderr and, with --json, the report on stdout. Throws CheckError (exit 1)
 * when --check finds a missing or different file or an install was refused, UsageError (exit 2) on bad flags and
 * EnvError (exit 3) when a template is missing or the folder cannot be written.
 * @param {readonly string[]} argv
 * @returns {number} the exit code when nothing was thrown (0)
 */
export function main(argv) {
  const { values, positionals } = parseCli(argv, {
    help: HELP,
    allowPositionals: false,
    options: {
      check: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      home: { type: 'string' },
      'agents-dir': { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length > 0) throw new UsageError(`unexpected argument ${positionals[0]}; run with --help for usage`);
  if (values.check && values['dry-run']) throw new UsageError('--check and --dry-run do not combine; pick one');
  if (values.check && values.force) throw new UsageError('--check never writes, so --force has no meaning with it');
  if (values.home !== undefined && values['agents-dir'] !== undefined) {
    throw new UsageError('--home and --agents-dir do not combine; pick one');
  }
  if (values.home === '' || values['agents-dir'] === '') throw new UsageError('--home and --agents-dir need a folder path');
  const mode = values.check ? 'check' : values['dry-run'] ? 'dry-run' : 'install';
  const agentsDir = resolveAgentsDir({ agentsDir: values['agents-dir'], home: values.home });
  const report = installAgents({ mode, force: Boolean(values.force), agentsDir });
  for (const line of describe(report)) process.stderr.write(`${line}\n`);
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    throw mode === 'check'
      ? new CheckError(`agents not up to date in ${report.agentsDir}; run node install-agents.mjs (with --force for a file that differs)`)
      : new CheckError(`an installed agent differs from its template in ${report.agentsDir}; review it, then run with --force to replace it`);
  }
  return 0;
}

/**
 * True when this file is the script node was started with.
 * @returns {boolean}
 */
function isMain() {
  return isMainModule(import.meta.url);
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    exitWith(err);
  }
}
