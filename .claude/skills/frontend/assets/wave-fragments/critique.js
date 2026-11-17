/*
 * feCritique: /frontend's critique stage (FE-20) as a wave fragment, after ARCHITECTURE.md section 6.
 *
 * Plain JavaScript that /execution's wave emitter (or /frontend's own workflow in mode B) inlines into a Workflow
 * script: no import or export, no Date.now, no Math.random, no new Date. A workflow script cannot run Node, so every
 * command runs inside an agent() call that returns the command's JSON (assets/schemas/fragment-commands.schema.json).
 *
 * api   = {agent, parallel, pipeline, log}          the Workflow hooks
 * input = {
 *   task: "T042",                                    task id, used in labels and pass ids
 *   cwd: "<absolute lane checkout>",                 where every command runs
 *   skill: "C:/Users/Utilisateur/.claude/skills/frontend",
 *   profile: "<absolute profile.json>",  state: "<absolute state dir>",  ui_root: "app",
 *   mode: "full" | "small",                          small: measure runs the --phase small gate set
 *   critique: {rounds_max: 3, critics: 3, probes: 5},   profile.frontend.critique; small mode caps rounds at 1
 *   build: 'pnpm -C "app" build && ',                prefix of every measure, '' when nothing is built
 *   target: '--serve "app/dist"',                    how frontend-check reaches the build
 *   probe_viewports: ["desktop", "mobile"],          first views the blind probes read
 *   min_probe_match: 4,                              probes that must restate the proposition, per viewport
 *   max_issues: 5, max_rejected: 2, max_attempts_per_issue: 3,   consecutive rejections; a fix and 2 retries
 *   commands: {measure, restore, ui_copy},           optional overrides; placeholders {round} {label} {sha}
 *   agents: {implementer, runner, critic, probe},    agent() options per role: {agentType, model, effort}
 *   receipt_path: "<state>/critique/receipt.json"
 * }
 * Returns the receipt (assets/schemas/critique-receipt.schema.json) and writes it to receipt_path:
 *   {fragment, version, task, ok, mode, rounds_max, rounds_run, stop_reason, error, baseline, best,
 *    rounds: [{round, critics_asked, critics_returned, issues, dropped, candidate, pairwise, verdict, reasons,
 *              restored}], probes, ui_copy, receipt_path, checksum}
 *
 * Rules (ARCHITECTURE.md 6, FD17 Layer 2, references/12-critique.md): three fresh critics per round; an issue is kept
 * only if two critics raise it or a deterministic check confirms it on the same mark, at most five per round, each
 * with a mark id, the measured problem and a concrete fix; an issue gets a first fix and at most two retries. A
 * candidate replaces the best-so-far only when no gate regresses, no deterministic sub-score drops and it wins the
 * pairwise comparison in both orders; otherwise the tree goes back to the best-so-far. At most rounds_max rounds, and
 * the run stops after two consecutive rejected candidates. Five blind probes per viewport read the first view; at
 * least min_probe_match of them must restate the brief's proposition on every probed viewport.
 * Agents: commands run in default workflow agents (agents.runner, Bash-capable); fixes in agents.implementer;
 * critics and probes in the read-only frontend-critic and frontend-probe definitions (scripts/install-agents.mjs).
 */
async function feCritique(api, input) {
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
  const CRITIQUE_SCHEMA = {
    type: 'object',
    required: ['pass_id', 'kind', 'checklist', 'issues'],
    additionalProperties: false,
    properties: {
      pass_id: {type: 'string', minLength: 1},
      kind: {const: 'critique'},
      checklist: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'answer'],
          additionalProperties: false,
          properties: {
            id: {type: 'string', minLength: 1},
            answer: {enum: ['yes', 'no', 'n/a']},
            mark: {type: 'string', minLength: 1}
          }
        }
      },
      issues: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          required: ['mark', 'category', 'problem', 'fix'],
          additionalProperties: false,
          properties: {
            mark: {type: 'string', minLength: 1},
            item: {type: 'string'},
            category: {enum: ['first-view', 'feature-proof', 'hierarchy', 'layout', 'typography', 'contrast', 'copy', 'states', 'motion', 'brand', 'other']},
            problem: {type: 'string', minLength: 1},
            fix: {type: 'string', minLength: 1},
            source: {type: 'string'}
          }
        }
      }
    }
  };
  const PAIRWISE_SCHEMA = {
    type: 'object',
    required: ['pass_id', 'kind', 'checklist', 'preferred', 'reason'],
    additionalProperties: false,
    properties: {
      pass_id: {type: 'string', minLength: 1},
      kind: {const: 'pairwise'},
      checklist: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'a', 'b'],
          additionalProperties: false,
          properties: {
            id: {type: 'string', minLength: 1},
            a: {enum: ['yes', 'no', 'n/a']},
            b: {enum: ['yes', 'no', 'n/a']}
          }
        }
      },
      preferred: {enum: ['A', 'B', 'tie']},
      reason: {type: 'string', minLength: 1}
    }
  };
  const PROBE_MATCH_SCHEMA = {
    type: 'object',
    required: ['pass_id', 'kind', 'matches'],
    additionalProperties: false,
    properties: {
      pass_id: {type: 'string', minLength: 1},
      kind: {const: 'probe-match'},
      matches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['probe', 'restates', 'reason'],
          additionalProperties: false,
          properties: {
            probe: {type: 'string', minLength: 1},
            restates: {type: 'boolean'},
            what: {type: 'boolean'},
            does: {type: 'boolean'},
            for_whom: {type: 'boolean'},
            reason: {type: 'string'}
          }
        }
      }
    }
  };
  const PROBE_SCHEMA = {
    type: 'object',
    required: ['pass_id', 'answer', 'what', 'does', 'for_whom', 'unclear'],
    additionalProperties: false,
    properties: {
      pass_id: {type: 'string', minLength: 1},
      answer: {type: 'string', minLength: 1, description: 'Exactly two sentences.'},
      what: {type: 'string', description: 'What it is, in a few words.'},
      does: {type: 'string', description: 'What it does.'},
      for_whom: {type: 'string', description: 'Who it is for.'},
      unclear: {type: 'boolean', description: 'true when the image does not let the reader tell.'}
    }
  };
  const FIX_SCHEMA = {
    type: 'object',
    required: ['sha', 'files', 'summary', 'unresolved'],
    additionalProperties: false,
    properties: {
      sha: {type: 'string', description: 'git rev-parse HEAD after your commit, or the unchanged HEAD.'},
      files: {type: 'array', items: {type: 'string'}},
      summary: {type: 'string'},
      unresolved: {type: 'array', items: {type: 'string'}}
    }
  };
  const WRITE_SCHEMA = {
    type: 'object',
    required: ['written', 'path'],
    additionalProperties: false,
    properties: {written: {type: 'boolean'}, path: {type: 'string'}}
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
  function settings(raw) {
    const critique = isObject(raw.critique) ? raw.critique : {};
    const mode = raw.mode === 'small' ? 'small' : 'full';
    const roundsWanted = int(critique.rounds_max, 3, 0, 10);
    const skill = text(raw.skill, 'C:/Users/Utilisateur/.claude/skills/frontend');
    const state = text(raw.state, '');
    const profile = text(raw.profile, '');
    const uiRoot = text(raw.ui_root, '.');
    const build = typeof raw.build === 'string' ? raw.build : 'pnpm -C "' + uiRoot + '" build && ';
    const target = text(raw.target, '--serve "' + uiRoot + '/dist"');
    const agents = isObject(raw.agents) ? raw.agents : {};
    const critics = int(critique.critics, 3, 1, 9);
    const probes = int(critique.probes, 5, 1, 15);
    // Small mode measures against the gates its proof runs (frontend-check --phase small), not the full build set.
    const measureGates = mode === 'small' ? ' --gates render,a11y,coverage,firstview,tells,ip' : '';
    const commands = {
      measure: build + 'node "' + skill + '/scripts/critique.mjs" measure --round {round} --label {label} --profile "' +
        profile + '" --state "' + state + '" --root . ' + target + measureGates + ' --json',
      restore: 'git revert --no-edit {sha}..HEAD',
      ui_copy: build + 'node "' + skill + '/scripts/critique.mjs" ui-copy --out "' + state + '/ui-copy.md" --profile "' +
        profile + '" --state "' + state + '" --root . ' + target + ' --json'
    };
    if (isObject(raw.commands)) {
      for (const key of Object.keys(commands)) {
        if (typeof raw.commands[key] === 'string') commands[key] = raw.commands[key];
        if (raw.commands[key] === null) commands[key] = '';
      }
    }
    const viewports = Array.isArray(raw.probe_viewports) && raw.probe_viewports.length > 0
      ? raw.probe_viewports.filter((v) => typeof v === 'string' && v.length > 0)
      : ['desktop', 'mobile'];
    return {
      task: text(raw.task, 'FE-20'),
      cwd: text(raw.cwd, ''),
      skill,
      state,
      profile,
      uiRoot,
      build,
      mode,
      roundsMax: mode === 'small' ? Math.min(1, roundsWanted) : roundsWanted,
      critics,
      probes,
      minMatch: int(raw.min_probe_match, Math.min(4, probes), 1, probes),
      probeViewports: viewports,
      maxIssues: int(raw.max_issues, 5, 1, 5),
      maxRejected: int(raw.max_rejected, 2, 1, 10),
      maxAttempts: int(raw.max_attempts_per_issue, 3, 1, 5),
      commands,
      receiptPath: text(raw.receipt_path, state ? state + '/critique/receipt.json' : ''),
      agents: {
        implementer: isObject(agents.implementer) ? agents.implementer : {},
        runner: isObject(agents.runner) ? agents.runner : {model: 'sonnet', effort: 'low'},
        critic: isObject(agents.critic) ? agents.critic : {agentType: 'frontend-critic'},
        probe: isObject(agents.probe) ? agents.probe : {agentType: 'frontend-probe'}
      }
    };
  }

  const cfg = settings(isObject(input) ? input : {});
  const log = typeof api.log === 'function' ? api.log : function () {};
  const phase = cfg.task + ' critique';
  const receipt = {
    fragment: 'feCritique',
    version: 1,
    task: cfg.task,
    ok: false,
    mode: cfg.mode,
    rounds_max: cfg.roundsMax,
    rounds_run: 0,
    stop_reason: 'round-cap',
    error: null,
    baseline: null,
    best: null,
    rounds: [],
    probes: null,
    ui_copy: null,
    receipt_path: cfg.receiptPath,
    checksum: ''
  };

  function fill(template, values) {
    let out = template;
    for (const key of Object.keys(values)) out = out.split('{' + key + '}').join(String(values[key]));
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
  function fnv1a32(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function fail(message) {
    if (receipt.error === null) receipt.error = message;
    receipt.stop_reason = 'error';
    log(cfg.task + ' critique stopped: ' + message);
  }

  async function run(command, purpose, label) {
    const prompt = [
      'You run one command for the /frontend skill (' + purpose + ') and report its result. Do nothing else.',
      'Run this exactly once with the Bash tool, as one line, with the maximum timeout (600000 ms):',
      'cd "' + cfg.cwd + '" && ' + command,
      'Do not edit, fix, retry or split the command, do not change any file yourself, and never open a .env file.',
      'Return exit_code (the real exit code), json (stdout parsed as one JSON object, or null when stdout is not one JSON object) and stderr_tail (the last lines of stderr, at most 2000 characters).'
    ].join('\n');
    return asJson(await api.agent(prompt, agentOptions(cfg.agents.runner, {label: cfg.task + ' ' + label, phase, schema: RUN_SCHEMA})));
  }

  function isMeasure(m) {
    return isObject(m) && typeof m.sha === 'string' && typeof m.ui_tree === 'string' && isObject(m.gates) &&
      typeof m.gates.ok === 'boolean' && isObject(m.gates.counts) && Array.isArray(m.gates.failing) &&
      isObject(m.scores) && Array.isArray(m.deterministic) && typeof m.task_file === 'string' &&
      Array.isArray(m.tiles) && isObject(m.first_view) && typeof m.proposition === 'string';
  }
  function snapshot(m) {
    const scores = {};
    for (const key of Object.keys(m.scores)) {
      if (typeof m.scores[key] === 'number') scores[key] = m.scores[key];
    }
    const counts = m.gates.counts;
    return {
      round: m.round,
      sha: m.sha,
      ui_tree: m.ui_tree,
      gates: {
        ok: m.gates.ok,
        counts: {ok: counts.ok | 0, fail: counts.fail | 0, skipped: counts.skipped | 0},
        failing: m.gates.failing.filter((id) => typeof id === 'string')
      },
      scores
    };
  }

  async function measure(round, label) {
    const res = await run(fill(cfg.commands.measure, {round, label}), 'measure round ' + round + ' (' + label + ')', 'measure ' + round + ' ' + label);
    const m = res ? res.json : null;
    if (!isMeasure(m)) {
      const why = res ? 'exit ' + res.exit_code + ' ' + tail(res.stderr_tail) : 'the agent returned nothing';
      return {error: 'measure of round ' + round + ' (' + label + ') failed: ' + why};
    }
    m.round = round;
    return {m};
  }

  function issueKey(issue) {
    return issue.mark + '|' + (typeof issue.item === 'string' && issue.item.length > 0 ? issue.item : issue.category);
  }
  function validIssue(issue) {
    return isObject(issue) && typeof issue.mark === 'string' && issue.mark.length > 0 && typeof issue.problem === 'string' &&
      issue.problem.length > 0 && typeof issue.fix === 'string' && issue.fix.length > 0 && typeof issue.category === 'string';
  }
  function consolidate(results, deterministic, attempts) {
    const confirmedMarks = {};
    for (const d of deterministic) if (isObject(d) && typeof d.mark === 'string') confirmedMarks[d.mark] = true;
    const entries = [];
    const byKey = {};
    results.forEach((result, critic) => {
      const seen = {};
      const issues = Array.isArray(result.issues) ? result.issues.slice(0, cfg.maxIssues) : [];
      for (const issue of issues) {
        if (!validIssue(issue)) continue;
        const key = issueKey(issue);
        if (seen[key]) continue;
        seen[key] = true;
        let entry = byKey[key];
        if (!entry) {
          entry = {key, mark: issue.mark, category: issue.category, item: typeof issue.item === 'string' ? issue.item : '',
            problem: issue.problem, fix: issue.fix, voters: {}, order: entries.length};
          byKey[key] = entry;
          entries.push(entry);
        }
        entry.voters[critic] = true;
      }
    });
    const kept = [];
    for (const entry of entries) {
      const votes = Object.keys(entry.voters).length;
      const confirmed = confirmedMarks[entry.mark] === true;
      const tried = attempts[entry.key] || 0;
      if ((votes >= 2 || confirmed) && tried < cfg.maxAttempts) kept.push({entry, votes, confirmed});
    }
    kept.sort((a, b) => (Number(b.confirmed) - Number(a.confirmed)) || (b.votes - a.votes) || (a.entry.order - b.entry.order));
    const top = kept.slice(0, cfg.maxIssues).map((k) => ({
      key: k.entry.key,
      mark: k.entry.mark,
      category: k.entry.category,
      item: k.entry.item,
      problem: k.entry.problem,
      fix: k.entry.fix,
      votes: k.votes,
      confirmed: k.confirmed
    }));
    return {issues: top, dropped: entries.length - top.length};
  }

  async function runCritics(best, round, probes, history) {
    const lines = [];
    if (best.gates.failing.length > 0) lines.push('Gates failing on this version: ' + best.gates.failing.join(', ') + '.');
    if (probes && probes.pass === false) {
      lines.push('Blind readers of the first view did not restate the proposition "' + best.proposition + '". Their answers:');
      for (const v of probes.viewports) {
        for (const a of v.answers) lines.push('- ' + v.viewport + ' ' + a.probe + ': ' + a.answer);
      }
    }
    if (history.length > 0) {
      lines.push('Already tried and rejected (propose a different change, or a different issue):');
      for (const h of history) lines.push('- ' + h.key + ': ' + h.fix + ' (rejected: ' + h.reasons.join('; ') + ')');
    }
    const thunks = [];
    for (let i = 1; i <= cfg.critics; i += 1) {
      const passId = cfg.task + '-r' + round + '-c' + i;
      const prompt = ['pass-id: ' + passId, 'kind: critique', 'task-file: ' + best.task_file,
        'Round ' + round + ' of at most ' + cfg.roundsMax + '.'].concat(lines).join('\n');
      thunks.push(() => api.agent(prompt, agentOptions(cfg.agents.critic, {label: cfg.task + ' critic ' + i + ' round ' + round, phase, schema: CRITIQUE_SCHEMA})));
    }
    const results = await api.parallel(thunks);
    return results.map(asJson).filter((r) => r !== null && r.kind === 'critique' && Array.isArray(r.issues));
  }

  async function implement(best, issues, round, history) {
    const lines = [
      'You fix at most five measured issues on the judged UI of this project: /frontend critique round ' + round + ' of task ' + cfg.task + '.',
      'Working directory: ' + cfg.cwd + '. Change files under ' + cfg.uiRoot + '/ only.',
      'Read first: ' + best.task_file + ' (the marks: selector, text and source of each mark id), then ' + cfg.skill +
        '/references/06-build.md, ' + cfg.skill + '/references/05-tokens.md, ' + cfg.skill + '/references/08-motion.md and ' +
        cfg.skill + '/references/14-copy.md.',
      'Issues:'
    ];
    issues.forEach((issue, i) => {
      lines.push((i + 1) + '. [' + issue.mark + ', ' + (issue.item || issue.category) + '] problem: ' + issue.problem + ' fix: ' + issue.fix);
    });
    const tried = history.filter((h) => issues.some((issue) => issue.key === h.key));
    for (const h of tried) lines.push('A previous fix for ' + h.key + ' was rejected (' + h.reasons.join('; ') + '): make a different change.');
    lines.push(
      'Rules: express every fix in the project\'s tokens (CSS custom properties from the tokens file), never a new hard-coded colour, size or font;',
      'add no dependency and no asset file; add no gradient, glow, glass card, eyebrow label, scroll-triggered entrance or hover fade;',
      'keep every data-feature, data-status, data-metric, data-ledger, data-source, data-as-of, data-proof, data-hero, data-surface and data-rec-role marker;',
      'never edit tests, fixtures, waivers, the checker, the proof or the tokens file; report an issue that needs any of them as unresolved.',
      'Run the build (' + (cfg.build ? cfg.build.replace(/ && $/, '') : 'nothing to build') + ') and fix any build error you caused.',
      'Commit your changes under your own commit rules.',
      'Return sha (git rev-parse HEAD after your commit, or the unchanged HEAD when you changed nothing), files (the paths you changed), summary and unresolved (issues you could not fix, and why).'
    );
    return asJson(await api.agent(lines.join('\n'), agentOptions(cfg.agents.implementer, {label: cfg.task + ' fix round ' + round, phase, schema: FIX_SCHEMA})));
  }

  async function pairwise(a, b, passId) {
    const prompt = [
      'pass-id: ' + passId,
      'kind: pairwise',
      'task-file: ' + a.task_file,
      'The task file gives the checklist. Version A tiles: ' + a.tiles.map((t) => t.path).join(', '),
      'Version B tiles: ' + b.tiles.map((t) => t.path).join(', '),
      'Judge every checklist item for A and for B, then say which version is better as a whole: A, B or tie.'
    ].join('\n');
    const res = asJson(await api.agent(prompt, agentOptions(cfg.agents.critic, {label: passId, phase, schema: PAIRWISE_SCHEMA})));
    return res && (res.preferred === 'A' || res.preferred === 'B' || res.preferred === 'tie') ? res.preferred : null;
  }

  async function decide(best, cand, round) {
    const reasons = [];
    const regressions = cand.gates.failing.filter((id) => best.gates.failing.indexOf(id) === -1);
    if (regressions.length > 0) reasons.push('gate regression: ' + regressions.join(', '));
    for (const key of Object.keys(best.scores)) {
      const before = best.scores[key];
      const after = cand.scores[key];
      if (typeof before !== 'number') continue;
      if (typeof after !== 'number') reasons.push('score ' + key + ' missing');
      else if (after < before) reasons.push('score ' + key + ' dropped from ' + before + ' to ' + after);
    }
    if (reasons.length > 0) return {accepted: false, reasons, pairwise: null};
    const verdicts = await api.parallel([
      () => pairwise(best, cand, cfg.task + '-r' + round + '-pAB'),
      () => pairwise(cand, best, cfg.task + '-r' + round + '-pBA')
    ]);
    const ab = verdicts[0] || null;
    const ba = verdicts[1] || null;
    const consistent = (ab === 'B' && ba === 'A') || (ab === 'A' && ba === 'B') || (ab === 'tie' && ba === 'tie');
    if (!consistent) log(cfg.task + ' round ' + round + ': pairwise verdicts disagree across orders (' + ab + ', ' + ba + ')');
    if (!(ab === 'B' && ba === 'A')) {
      reasons.push('pairwise: the candidate was not preferred in both orders (best as A: ' + ab + '; candidate as A: ' + ba + ')');
    }
    return {accepted: reasons.length === 0, reasons, pairwise: {ab, ba, consistent}};
  }

  async function probeViewport(viewport, image, round, proposition) {
    const thunks = [];
    for (let i = 1; i <= cfg.probes; i += 1) {
      const passId = cfg.task + '-r' + round + '-' + viewport + '-p' + i;
      thunks.push(() => api.agent('pass-id: ' + passId + '\nimage: ' + image,
        agentOptions(cfg.agents.probe, {label: passId, phase, schema: PROBE_SCHEMA})));
    }
    const raw = await api.parallel(thunks);
    const answers = [];
    raw.forEach((r, i) => {
      const a = asJson(r);
      if (a && typeof a.answer === 'string' && a.answer.length > 0) answers.push({probe: 'p' + (i + 1), answer: a.answer, restates: false});
    });
    if (answers.length > 0) {
      const passId = cfg.task + '-r' + round + '-' + viewport + '-match';
      const prompt = ['pass-id: ' + passId, 'kind: probe-match', 'proposition: ' + proposition,
        'Answers of blind readers who saw only the first screen at ' + viewport + ' size:']
        .concat(answers.map((a) => a.probe + ': ' + a.answer))
        .concat(['For each answer, say whether it restates the proposition: the same kind of product, the same action and the same user.'])
        .join('\n');
      const judged = asJson(await api.agent(prompt, agentOptions(cfg.agents.critic, {label: passId, phase, schema: PROBE_MATCH_SCHEMA})));
      const verdicts = {};
      if (judged && Array.isArray(judged.matches)) {
        for (const m of judged.matches) if (isObject(m) && typeof m.probe === 'string') verdicts[m.probe] = m.restates === true;
      }
      for (const a of answers) a.restates = verdicts[a.probe] === true;
    }
    const matched = answers.filter((a) => a.restates).length;
    return {viewport, matched, total: cfg.probes, answers};
  }

  async function runProbes(m) {
    const viewports = cfg.probeViewports.filter((v) => typeof m.first_view[v] === 'string' && m.first_view[v].length > 0);
    const missing = cfg.probeViewports.filter((v) => viewports.indexOf(v) === -1);
    if (missing.length > 0) log(cfg.task + ': no first-view image for ' + missing.join(', ') + '; those viewports count as failed probes');
    const results = await api.parallel(viewports.map((v) => () => probeViewport(v, m.first_view[v], m.round, m.proposition)));
    const perViewport = cfg.probeViewports.map((v) => {
      const found = results.filter((r) => r && r.viewport === v)[0];
      return found || {viewport: v, matched: 0, total: cfg.probes, answers: []};
    });
    return {
      pass: perViewport.every((v) => v.matched >= cfg.minMatch),
      min_match: cfg.minMatch,
      of: cfg.probes,
      measured_on: m.round,
      viewports: perViewport
    };
  }

  async function restore(best, cand, round) {
    if (cand.sha === best.sha) return {to: best.sha, ok: true};
    const res = await run(fill(cfg.commands.restore, {sha: best.sha}), 'restore the best-so-far after a rejected candidate', 'restore ' + round);
    return {to: best.sha, ok: Boolean(res && res.exit_code === 0)};
  }

  async function writeReceipt() {
    const body = JSON.stringify(receipt, null, 2);
    const prompt = [
      'Write one file for the /frontend skill exactly as given, then stop.',
      'Path: ' + receipt.receipt_path,
      'Create the parent folder if it is missing. Use the Write tool with the content between the two marker lines, byte for byte, plus one final newline; do not reformat, reorder, translate or fix anything.',
      '----- BEGIN RECEIPT -----',
      body,
      '----- END RECEIPT -----',
      'Return written (true once the file holds exactly that content) and path.'
    ].join('\n');
    const res = asJson(await api.agent(prompt, agentOptions(cfg.agents.runner, {label: cfg.task + ' write receipt', phase, schema: WRITE_SCHEMA})));
    return Boolean(res && res.written === true);
  }

  function seal() {
    receipt.ok = receipt.error === null && receipt.best !== null && receipt.best.gates.ok === true &&
      receipt.probes !== null && receipt.probes.pass === true;
    const unsealed = {};
    for (const key of Object.keys(receipt)) if (key !== 'checksum') unsealed[key] = receipt[key];
    receipt.checksum = 'fnv1a32:' + fnv1a32(JSON.stringify(unsealed));
  }

  async function finish() {
    seal();
    if (receipt.receipt_path) {
      const written = await writeReceipt();
      if (!written) {
        fail('the receipt could not be written to ' + receipt.receipt_path);
        seal();
      }
    }
    log(cfg.task + ' critique: ok=' + receipt.ok + ', rounds ' + receipt.rounds_run + '/' + receipt.rounds_max + ', stop ' + receipt.stop_reason);
    return receipt;
  }

  async function critiqueRounds() {
    const base = await measure(0, 'baseline');
    if (base.error) {
      fail(base.error);
      return;
    }
    let best = base.m;
    receipt.baseline = snapshot(best);
    receipt.best = snapshot(best);
    let probes = await runProbes(best);
    receipt.probes = probes;
    let rejected = 0;
    const attempts = {};
    const history = [];

    for (let round = 1; round <= cfg.roundsMax; round += 1) {
      receipt.rounds_run = round;
      const entry = {round, critics_asked: cfg.critics, critics_returned: 0, issues: [], dropped: 0, candidate: null,
        pairwise: null, verdict: 'no-issue', reasons: [], restored: null};
      receipt.rounds.push(entry);

      const results = await runCritics(best, round, probes, history);
      entry.critics_returned = results.length;
      const picked = consolidate(results, best.deterministic, attempts);
      entry.issues = picked.issues;
      entry.dropped = picked.dropped;
      if (picked.issues.length === 0) {
        receipt.stop_reason = 'no-issue-kept';
        log(cfg.task + ' round ' + round + ': no issue kept (' + results.length + ' of ' + cfg.critics + ' critics returned)');
        break;
      }
      for (const issue of picked.issues) attempts[issue.key] = (attempts[issue.key] || 0) + 1;

      const fix = await implement(best, picked.issues, round, history);
      const cand = await measure(round, 'candidate');
      if (cand.error) {
        entry.verdict = 'error';
        entry.reasons.push(cand.error);
        fail(cand.error);
        return;
      }
      entry.candidate = snapshot(cand.m);
      if (fix && Array.isArray(fix.files) && fix.files.length > 0 && cand.m.sha === best.sha) {
        const why = 'the fix of round ' + round + ' changed files but made no commit; the uncommitted changes under ' +
          cfg.uiRoot + ' are left for review';
        entry.verdict = 'error';
        entry.reasons.push(why);
        fail(why);
        return;
      }

      const verdict = await decide(best, cand.m, round);
      entry.pairwise = verdict.pairwise;
      entry.reasons = verdict.reasons;
      if (verdict.accepted) {
        entry.verdict = 'accepted';
        best = cand.m;
        receipt.best = snapshot(best);
        rejected = 0;
        probes = await runProbes(best);
        receipt.probes = probes;
        log(cfg.task + ' round ' + round + ': candidate accepted');
      } else {
        entry.verdict = 'rejected';
        rejected += 1;
        for (const issue of picked.issues) history.push({key: issue.key, fix: issue.fix, reasons: verdict.reasons});
        entry.restored = await restore(best, cand.m, round);
        log(cfg.task + ' round ' + round + ': candidate rejected (' + verdict.reasons.join('; ') + ')');
        if (!entry.restored.ok) {
          fail('restoring the best-so-far ' + best.sha + ' failed after round ' + round + '; the tree holds the rejected candidate');
          return;
        }
      }
      if (rejected >= cfg.maxRejected) {
        receipt.stop_reason = 'rejected-limit';
        break;
      }
      if (round === cfg.roundsMax) receipt.stop_reason = 'round-cap';
    }

    if (cfg.commands.ui_copy) {
      const copy = await run(cfg.commands.ui_copy, 'export the rendered UI copy for /prose', 'ui copy');
      receipt.ui_copy = {ok: Boolean(copy && copy.exit_code === 0), path: cfg.state + '/ui-copy.md'};
    }
  }

  const given = isObject(input) ? input : {};
  const missingInput = ['cwd', 'state', 'profile'].filter((key) => !(typeof given[key] === 'string' && given[key].length > 0));
  if (missingInput.length > 0) {
    fail('input is missing ' + missingInput.join(', '));
    return finish();
  }
  try {
    await critiqueRounds();
  } catch (err) {
    fail('unexpected error: ' + (err && err.message ? err.message : String(err)));
  }
  return finish();
}
