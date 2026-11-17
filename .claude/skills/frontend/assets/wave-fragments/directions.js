/*
 * feDirections: /frontend's direction stage (FE-03) as a wave fragment, after ARCHITECTURE.md P2.
 *
 * Plain JavaScript that /execution's wave emitter (or /frontend's own workflow in mode B) inlines into a Workflow
 * script: no import or export, no Date.now, no Math.random, no new Date. A workflow script cannot run Node, so every
 * command runs inside an agent() call that returns the command's JSON (assets/schemas/fragment-commands.schema.json).
 *
 * api   = {agent, parallel, pipeline, log}          the Workflow hooks
 * input = {
 *   task: "T007",                                    task id, used in labels
 *   cwd: "<absolute working directory>",             where every command runs
 *   skill: "C:/Users/Utilisateur/.claude/skills/frontend",
 *   profile: "<absolute profile.json>",  state: "<absolute state dir>",
 *   mode: "full" | "small",                          full draws 3 directions, small 2 (input.count overrides, 1-3)
 *   references: "on" | "off",                        off: no pattern ledger, so no customer anchor
 *   anchors: ["customer-a", "domain", ...],          optional; default by references (see ANCHOR_POOLS)
 *   generic_brief: "a dashboard for ...",            optional; otherwise a runner derives it from brief.json
 *   max_attempts: 2,                                 draws per direction (one redraw after a failed screen)
 *   commands: {render, screen, board},               optional overrides; placeholder {id}
 *   agents: {designer, generic, runner}              agent() options per role: {agentType, model, effort};
 *                                                    generic (the similar-prompt plan) defaults to a plain
 *                                                    workflow agent, so no implementer brief colours it
 * }
 * Returns the receipt of assets/schemas/directions-receipt.schema.json:
 *   {fragment, version, task, ok, mode, references, count, generic: {sentence, ok, dir},
 *    directions: [{id, anchor, name, attempts, rendered, screened, findings, files}], board: {ok, path}, error}
 *
 * Each direction lives in <state>/directions/<A|B|C>/ (tokens.json, notes.md, hero.html, hero-desktop.png,
 * hero-mobile.png), anchored in a different source, and is screened by board.mjs: the checker on the hero comp, the
 * similar-prompt test against a token plan drawn from a generic brief (<state>/similar-prompt/, kept out of
 * directions/ so that folder holds only the A, B and C directions the gates count), and the ledger of
 * past directions. A direction that fails is redrawn with the findings, up to max_attempts draws. The model never
 * ranks the directions: the owner picks at H1 (FD17-F06, F16; references/03-directions.md DR-12).
 */
async function feDirections(api, input) {
  const RUN_SCHEMA = {
    type: 'object',
    required: ['exit_code', 'json', 'stderr_tail'],
    additionalProperties: false,
    properties: {
      exit_code: {type: 'integer', description: "The command's real exit code."},
      json: {type: ['object', 'null'], description: 'stdout parsed as JSON, or null when stdout is not one JSON object.'},
      stderr_tail: {type: 'string', description: 'Last lines of stderr, at most 2,000 characters.'}
    }
  };
  const DRAW_SCHEMA = {
    type: 'object',
    required: ['direction', 'name', 'files', 'rationale', 'trade_off'],
    additionalProperties: false,
    properties: {
      direction: {type: 'string'},
      name: {type: 'string', minLength: 1},
      files: {type: 'array', items: {type: 'string'}},
      rationale: {type: 'string'},
      trade_off: {type: 'string'}
    }
  };
  const GENERIC_SCHEMA = {
    type: 'object',
    required: ['generic_brief'],
    additionalProperties: false,
    properties: {generic_brief: {type: 'string', minLength: 1}}
  };
  const GENERIC_PLAN_SCHEMA = {
    type: 'object',
    required: ['files'],
    additionalProperties: false,
    properties: {files: {type: 'array', items: {type: 'string'}}}
  };
  const ANCHOR_POOLS = {
    on: ['customer-a', 'domain', 'customer-b', 'utilitarian'],
    off: ['domain', 'utilitarian', 'category']
  };
  const ANCHOR_TEXT = {
    'customer-a': 'the conventions of one customer in the pattern ledger: its measured relationships (type-scale ratio, spacing rhythm, radius family, density, how amounts and addresses are shown), never its expression',
    'customer-b': 'the conventions of a second customer in the pattern ledger, unrelated to the first: its measured relationships only, never its expression',
    domain: "the protocol's own domain: the objects its users handle (amounts, addresses, queues, settlements, proofs) and how that domain is conventionally shown, from the pattern ledger's domain conventions when they exist",
    utilitarian: 'a deliberately utilitarian register: dense, neutral, data first, one accent, nothing decorative',
    category: "the conventions of the sponsor customers' category as the brief names it, from words only (no capture exists)"
  };

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  function text(value, fallback) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }
  function int(value, fallback, min, max) {
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  function agentOptions(role, extra) {
    const out = {};
    if (isObject(role)) {
      for (const key of ['agentType', 'model', 'effort']) {
        if (typeof role[key] === 'string' && role[key].length > 0) out[key] = role[key];
      }
    }
    for (const key of Object.keys(extra)) out[key] = extra[key];
    return out;
  }
  function asJson(value) {
    if (isObject(value)) return value;
    if (typeof value !== 'string') return null;
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(value.slice(start, end + 1));
      return isObject(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }
  function tail(value) {
    const s = typeof value === 'string' ? value : '';
    return s.length > 400 ? s.slice(s.length - 400) : s;
  }

  const raw = isObject(input) ? input : {};
  const mode = raw.mode === 'small' ? 'small' : 'full';
  const references = raw.references === 'off' ? 'off' : 'on';
  const skill = text(raw.skill, 'C:/Users/Utilisateur/.claude/skills/frontend');
  const state = text(raw.state, '');
  const profile = text(raw.profile, '');
  const cwd = text(raw.cwd, '');
  const task = text(raw.task, 'FE-03');
  const count = int(raw.count, mode === 'small' ? 2 : 3, 1, 3);
  const pool = ANCHOR_POOLS[references];
  const wanted = Array.isArray(raw.anchors) ? raw.anchors.filter((a) => pool.indexOf(a) !== -1) : [];
  const anchors = wanted.concat(pool.filter((a) => wanted.indexOf(a) === -1)).slice(0, count);
  const ids = ['A', 'B', 'C'].slice(0, anchors.length);
  const maxAttempts = int(raw.max_attempts, 2, 1, 3);
  const agents = isObject(raw.agents) ? raw.agents : {};
  const designer = isObject(agents.designer) ? agents.designer : {};
  const generic = isObject(agents.generic) ? agents.generic : {};
  const runner = isObject(agents.runner) ? agents.runner : {model: 'sonnet', effort: 'low'};
  const genericDir = state + '/similar-prompt';
  const commands = {
    render: 'node "' + skill + '/scripts/board.mjs" render --direction {id} --state "' + state + '" --profile "' + profile + '" --json',
    screen: 'node "' + skill + '/scripts/board.mjs" screen --direction {id} --generic "' + genericDir + '" --state "' + state +
      '" --profile "' + profile + '" --json',
    board: 'node "' + skill + '/scripts/board.mjs" board --state "' + state + '" --profile "' + profile + '" --json'
  };
  if (isObject(raw.commands)) {
    for (const key of Object.keys(commands)) if (typeof raw.commands[key] === 'string') commands[key] = raw.commands[key];
  }
  const log = typeof api.log === 'function' ? api.log : function () {};
  const phase = task + ' directions';
  const receipt = {
    fragment: 'feDirections',
    version: 1,
    task,
    ok: false,
    mode,
    references,
    count: ids.length,
    generic: {sentence: '', ok: false, dir: genericDir},
    directions: [],
    board: null,
    error: null
  };

  async function run(command, purpose, label) {
    const prompt = [
      'You run one command for the /frontend skill (' + purpose + ') and report its result. Do nothing else.',
      'Run this exactly once with the Bash tool, as one line, with the maximum timeout (600000 ms):',
      'cd "' + cwd + '" && ' + command,
      'Do not edit, fix, retry or split the command, do not change any file yourself, and never open a .env file.',
      'Return exit_code (the real exit code), json (stdout parsed as one JSON object, or null when stdout is not one JSON object) and stderr_tail (the last lines of stderr, at most 2000 characters).'
    ].join('\n');
    return asJson(await api.agent(prompt, agentOptions(runner, {label: task + ' ' + label, phase, schema: RUN_SCHEMA})));
  }

  async function genericSentence() {
    if (typeof raw.generic_brief === 'string' && raw.generic_brief.length > 0) return raw.generic_brief;
    const prompt = [
      'Read ' + state + '/brief.json and nothing else.',
      'Write one sentence of at most 25 words that says only what kind of product this is and what surface is built',
      "(for example 'a landing page and dashboard for a liquid staking protocol'): no product or project name, no sponsor,",
      'no customer, no number, no claim and nothing from the research. Return it as generic_brief.'
    ].join('\n');
    const res = asJson(await api.agent(prompt, agentOptions(runner, {label: task + ' generic brief', phase, schema: GENERIC_SCHEMA})));
    return res && typeof res.generic_brief === 'string' ? res.generic_brief : '';
  }

  async function genericPlan(sentence) {
    const prompt = [
      'Draw a design token plan for this brief and for nothing else: "' + sentence + '"',
      'Write ' + genericDir + '/tokens.json in the shape of ' + skill + '/assets/schemas/tokens.schema.json: 4-6 named colours with',
      'roles, type roles, radius, spacing and motion tokens, each with its usage. Read no other file of the project, its',
      'brief, its research or its other directions: this plan must show what the brief alone produces. Return files.'
    ].join('\n');
    const res = asJson(await api.agent(prompt, agentOptions(generic, {label: task + ' generic plan', phase, schema: GENERIC_PLAN_SCHEMA})));
    return Boolean(res && Array.isArray(res.files) && res.files.length > 0);
  }

  function drawPrompt(id, anchor, findings) {
    const dir = state + '/directions/' + id;
    const lines = [
      'You draw direction ' + id + ' for this project with the /frontend skill (task ' + task + ').',
      'It is anchored in ' + ANCHOR_TEXT[anchor] + '.',
      'Read first: ' + state + '/brief.md' + (references === 'on' ? ', ' + state + '/pattern-ledger.md' : '') + ', ' +
        skill + '/references/03-directions.md, ' + skill + '/references/05-tokens.md, ' + skill + '/references/14-copy.md and ' +
        skill + '/references/15-ip-provenance.md.',
      'Write under ' + dir + '/:',
      '- tokens.json in the shape of ' + skill + '/assets/schemas/tokens.schema.json: 4-6 named colours with roles, type roles in open-licensed faces only, radius and spacing, a motion budget, every token with its usage, and meta.direction set to "' + id + ' <name>";',
      '- notes.md from ' + skill + '/assets/templates/direction.md: the name, the concrete reference the direction rests on (never a list of adjectives), its one signature element, the rationale, the trade-off and what it does not borrow;',
      "- hero.html: one self-contained hero comp that uses only these tokens, with the brief's real copy (brief.hero.h1 and brief.hero.sentence) and the product itself visible; no request to another origin, no font from a CDN, no image you did not make.",
      "Never carry a customer's pixels, logo, copy, imagery, licensed fonts, exact brand hexes or section sequence.",
      'Other agents draw the other directions at the same time: make this one different by its anchor, not by shading one look.'
    ];
    if (findings.length > 0) {
      lines.push('Your previous version failed screening. Change what these findings name and keep the anchor:');
      for (const f of findings) lines.push('- ' + f);
    }
    lines.push('Return direction ("' + id + '"), name, files (the paths you wrote), rationale and trade_off.');
    return lines.join('\n');
  }

  async function draw(id, anchor, findings, attempt) {
    const res = asJson(await api.agent(drawPrompt(id, anchor, findings),
      agentOptions(designer, {label: task + ' direction ' + id + ' draw ' + attempt, phase, schema: DRAW_SCHEMA})));
    return res && typeof res.name === 'string' ? res : null;
  }

  function screenFindings(json) {
    const out = [];
    if (!isObject(json)) return out;
    if (Array.isArray(json.findings)) {
      for (const f of json.findings) if (isObject(f)) out.push(String(f.check) + ': ' + String(f.detail));
    }
    if (Array.isArray(json.identical_to_generic) && json.identical_to_generic.length > 0) {
      out.push('similar-prompt test: tokens identical to the generic plan: ' + json.identical_to_generic.join(', '));
    }
    if (Array.isArray(json.near_duplicate_of) && json.near_duplicate_of.length > 0) {
      out.push('near-duplicate of a past direction: ' + json.near_duplicate_of.join(', '));
    }
    return out;
  }

  async function direction(id, anchor, genericReady) {
    const dir = state + '/directions/' + id;
    const record = {id, anchor, name: '', attempts: 0, rendered: false, screened: false, findings: [],
      files: {tokens: dir + '/tokens.json', notes: dir + '/notes.md', hero: dir + '/hero.html'}};
    let findings = [];
    while (record.attempts < maxAttempts) {
      record.attempts += 1;
      const drawn = await draw(id, anchor, findings, record.attempts);
      if (!drawn) {
        findings = ['the designer returned nothing for draw ' + record.attempts];
        continue;
      }
      record.name = drawn.name;
      const rendered = await run(commands.render.split('{id}').join(id), 'render direction ' + id, 'render ' + id + ' ' + record.attempts);
      const r = rendered ? rendered.json : null;
      if (!rendered || rendered.exit_code !== 0 || !isObject(r) || typeof r.hero_desktop !== 'string' || typeof r.hero_mobile !== 'string') {
        record.rendered = false;
        findings = ['render failed: ' + (rendered ? 'exit ' + rendered.exit_code + ' ' + tail(rendered.stderr_tail) : 'no result')];
        continue;
      }
      record.rendered = true;
      record.files.hero_desktop = r.hero_desktop;
      record.files.hero_mobile = r.hero_mobile;
      if (!(await genericReady)) {
        findings = ['the generic plan for the similar-prompt test is missing, so the direction cannot be screened'];
        break;
      }
      const screened = await run(commands.screen.split('{id}').join(id), 'screen direction ' + id, 'screen ' + id + ' ' + record.attempts);
      const s = screened ? screened.json : null;
      if (screened && screened.exit_code === 0 && isObject(s) && s.ok === true) {
        record.screened = true;
        findings = screenFindings(s);
        break;
      }
      record.screened = false;
      findings = screened && isObject(s) ? screenFindings(s) : ['screen failed: ' + (screened ? 'exit ' + screened.exit_code + ' ' + tail(screened.stderr_tail) : 'no result')];
      if (findings.length === 0) findings = ['screen reported a failure without findings'];
    }
    record.findings = findings;
    log(task + ' direction ' + id + ' (' + anchor + '): ' + (record.screened ? 'screened' : 'not screened') + ' after ' + record.attempts + ' draw(s)');
    return record;
  }

  async function main() {
    const missing = ['cwd', 'state', 'profile'].filter((key) => !(typeof raw[key] === 'string' && raw[key].length > 0));
    if (missing.length > 0) {
      receipt.error = 'input is missing ' + missing.join(', ');
      return;
    }
    const sentence = await genericSentence();
    receipt.generic.sentence = sentence;
    const genericReady = (sentence ? genericPlan(sentence) : Promise.resolve(false)).catch((err) => {
      log(task + ' generic plan failed: ' + (err && err.message ? err.message : String(err)));
      return false;
    });
    const records = await api.pipeline(ids, (prev, id, index) => direction(id, anchors[index], genericReady));
    receipt.generic.ok = await genericReady;
    receipt.directions = ids.map((id, i) => records[i] || {id, anchor: anchors[i], name: '', attempts: 0, rendered: false,
      screened: false, findings: ['the direction stage failed'], files: {}});
    if (receipt.directions.some((d) => d.rendered)) {
      const res = await run(commands.board, 'write the direction board for H1', 'board');
      const b = res ? res.json : null;
      receipt.board = {ok: Boolean(res && res.exit_code === 0 && isObject(b) && b.ok === true),
        path: isObject(b) && typeof b.path === 'string' ? b.path : ''};
    }
  }

  try {
    await main();
  } catch (err) {
    receipt.error = 'unexpected error: ' + (err && err.message ? err.message : String(err));
  }
  receipt.ok = receipt.error === null && receipt.generic.ok === true && receipt.directions.length > 0 &&
    receipt.directions.every((d) => d.rendered && d.screened) && receipt.board !== null && receipt.board.ok === true;
  log(task + ' directions: ok=' + receipt.ok + ', ' + receipt.directions.filter((d) => d.screened).length + ' of ' + receipt.count + ' screened');
  return receipt;
}
