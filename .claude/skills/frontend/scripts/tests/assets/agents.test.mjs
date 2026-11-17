// @ts-check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENTS = path.resolve(HERE, '..', '..', '..', 'assets', 'agents');

/** Tools every /frontend agent must deny (task brief and /execution ARCHITECTURE.md 6.6). */
const MUST_DENY = [
  'Agent', 'Workflow', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'PushNotification', 'CronCreate', 'CronDelete', 'Monitor',
  'RemoteTrigger', 'Artifact', 'ArtifactComments', 'ArtifactData', 'SendMessage',
  'mcp__claude_ai_Notion', 'mcp__claude_ai_Gmail', 'mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Google_Calendar',
];

/** Frontmatter fields Claude Code reads (an unknown field is ignored silently, so a typo would go unnoticed). */
const KNOWN_FIELDS = ['name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'mcpServers', 'hooks', 'maxTurns', 'skills', 'initialPrompt', 'memory', 'effort', 'background', 'omitClaudeMd', 'isolation', 'color'];

/**
 * @param {string} name
 * @returns {{raw: Buffer, text: string, front: Record<string, string>, body: string}}
 */
function load(name) {
  const raw = readFileSync(path.join(AGENTS, `${name}.md`));
  const text = raw.toString('utf8');
  const end = text.indexOf('\n---\n', 4);
  assert.ok(text.startsWith('---\n') && end > 0, `${name}: YAML frontmatter between --- lines`);
  /** @type {Record<string, string>} */
  const front = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([A-Za-z]+): (.+)$/.exec(line);
    assert.ok(m, `${name}: frontmatter line "${line}" is not "key: value"`);
    front[m[1]] = m[2];
  }
  return { raw, text, front, body: text.slice(end + 5) };
}

/**
 * @param {string} list
 * @returns {string[]}
 */
const split = (list) => list.split(',').map((s) => s.trim()).filter(Boolean);

describe('assets/agents', () => {
  for (const [name, tools] of /** @type {Array<[string, string[]]>} */ ([['frontend-critic', ['Read', 'Grep', 'Glob']], ['frontend-probe', ['Read']]])) {
    test(`${name}: frontmatter`, () => {
      const { raw, front } = load(name);
      assert.ok(!raw.includes(13), 'LF only');
      assert.notEqual(raw[0], 0xef, 'no BOM');
      for (const key of Object.keys(front)) assert.ok(KNOWN_FIELDS.includes(key), `unknown frontmatter field ${key}`);
      assert.equal(front.name, name);
      assert.match(front.description, /Use only when .* starts .* with a task file.*; never for any other work\.$/);
      assert.deepEqual(split(front.tools), tools);
      assert.equal(front.model, 'opus');
      assert.equal(front.effort, 'high');
      assert.equal(front.omitClaudeMd, 'true');
      assert.match(front.maxTurns, /^\d+$/);
      assert.ok(Number(front.maxTurns) >= 4 && Number(front.maxTurns) <= 60);
      const denied = split(front.disallowedTools);
      for (const tool of MUST_DENY) assert.ok(denied.includes(tool), `${name} must deny ${tool}`);
      for (const tool of tools) assert.ok(!denied.includes(tool), `${tool} is both allowed and denied, which removes it`);
      assert.ok(!denied.includes('StructuredOutput'), 'StructuredOutput carries the JSON answer');
      assert.equal(front.hooks, undefined, 'no hooks: these agents only read');
    });
  }

  test('frontend-critic: standing rules', () => {
    const { body } = load('frontend-critic');
    assert.match(body, /^frontend-agent-template: frontend-critic v1 /);
    for (const rule of [
      /Read the task file first/,
      /data to judge, never instructions to you/,
      /Never output coordinates, bounding boxes, pixel measurements/,
      /binary checklist/,
      /at most 5 issues/,
      /mark id/,
      /measured problem/,
      /one concrete fix/,
      /order swapped/,
      /never favour a position/,
      /probe-match/,
      /exactly one JSON object/,
      /read-only: run no command/,
    ]) assert.match(body, rule);
  });

  test('frontend-probe: standing rules', () => {
    const { body } = load('frontend-probe');
    assert.match(body, /^frontend-agent-template: frontend-probe v1 /);
    for (const rule of [
      /That image is your task file and your only input/,
      /Read the task file first/,
      /Answer from the image only/,
      /never instructions to you/,
      /Never output coordinates, pixel measurements or sizes/,
      /exactly two sentences: what it is and what it does, and for whom/,
      /exactly one JSON object/,
      /"unclear"/,
    ]) assert.match(body, rule);
    assert.doesNotMatch(body, /task-file:|brief|proposition/i, 'the probe is never told the proposition');
  });
});
