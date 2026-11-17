// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRefs, citingFiles, countDashes, extractCitations, indexResearch, nonProseRanges } from '../../check-refs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '..', '..', 'check-refs.mjs');
const GOOD = path.resolve(HERE, '..', 'fixtures', 'check-refs', 'good');
const BAD = path.resolve(HERE, '..', 'fixtures', 'check-refs', 'bad');
const EM = String.fromCharCode(0x2014);

/**
 * @param {string[]} args
 * @returns {{status: number | null, stdout: string, stderr: string}}
 */
function cli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function ids(text) {
  return extractCitations(text, 'x.md').map((c) => (c.kind === 'section' ? `${c.id} ${c.section}` : c.id));
}

describe('extractCitations', () => {
  test('reads plain, compressed, wrapped and mixed bracket groups', () => {
    assert.deepEqual(ids('a [FD13-F03] b'), ['FD13-F03']);
    assert.deepEqual(ids('a [FD11-F02, F06, F08] b'), ['FD11-F02', 'FD11-F06', 'FD11-F08']);
    assert.deepEqual(ids('a [FD11,\nFD13-F09] b'), ['FD11', 'FD13-F09']);
    assert.deepEqual(ids('a [FD06; critic C4, research/_critic-round1.md] b'), ['FD06']);
    assert.deepEqual(ids('[FD21-F24, FD21-F13, FD21-F14]'), ['FD21-F24', 'FD21-F13', 'FD21-F14'], 'source order');
    assert.deepEqual(ids('[FD15, FD13-F23]'), ['FD15', 'FD13-F23']);
  });

  test('a dossier code followed by words is a section citation, commas included', () => {
    assert.deepEqual(ids('[FD19 Capture policy table]'), ['FD19 Capture policy table']);
    assert.deepEqual(ids('[FD13 What could not be found, and how it was searched]'), ['FD13 What could not be found, and how it was searched']);
    assert.deepEqual(ids('[FD10 Catalogue: the owner\'s 20 tells]'), ['FD10 Catalogue: the owner\'s 20 tells']);
  });

  test('ignores brackets without research, codes glued to other text, and blank-line spans', () => {
    assert.deepEqual(ids('[critic C11] [agreement with /execution, 2026-10-01, CONTRACTS.md] [x]'), []);
    assert.deepEqual(ids('[FD06-like text]'), []);
    assert.deepEqual(ids('[FD01\n\nFD02-F01]'), ['FD02-F01'], 'a blank line ends the group; the bare id still counts as prose');
  });

  test('bare finding ids in prose count; ranges and dossier mentions do not', () => {
    assert.deepEqual(ids('FD05-F21 and FD05-F25 suggest it; see FD18-FD21 and (FD21).'), ['FD05-F21', 'FD05-F25']);
  });

  test('inside code only complete ids count, and bracket syntax there is not a group', () => {
    const cites = extractCitations('`FD03-F01` and\n```json\n{"sources": ["FD10 T01", "FD14-F07"]}\n```\n', 'x.md');
    assert.deepEqual(cites.map((c) => [c.id, c.where, c.line]), [['FD03-F01', 'code', 1], ['FD14-F07', 'code', 3]]);
  });

  test('line numbers point at the citation, also inside a wrapped group', () => {
    const cites = extractCitations('one\ntwo [FD01-F01,\nFD02-F02]\n', 'x.md');
    assert.deepEqual(cites.map((c) => [c.id, c.line]), [['FD01-F01', 2], ['FD02-F02', 3]]);
  });
});

describe('nonProseRanges and countDashes', () => {
  test('code spans, fenced blocks, comments and URLs are not prose', () => {
    const text = `a ${EM} b \`c ${EM} d\`\n\`\`\`\n${EM}\n\`\`\`\n<!-- ${EM} -->\n[l](https://x.org/${EM}) https://y.org/${EM}\n`;
    const { code, other } = nonProseRanges(text);
    assert.equal(code.length, 2);
    assert.equal(other.length, 3);
    const d = countDashes(text, 'x.md');
    assert.equal(d.count, 1);
    assert.equal(d.inCode, 2);
    assert.deepEqual(d.lines, [1]);
  });

  test('an unclosed fence runs to the end of the file', () => {
    const d = countDashes(`ok ${EM}\n\`\`\`\n${EM} ${EM}\n`, 'x.md');
    assert.equal(d.count, 1);
    assert.equal(d.inCode, 2);
  });
});

describe('indexResearch', () => {
  test('finds level-3 finding headings, verdicts, dropped findings, misleveled ids and duplicates', () => {
    const index = indexResearch(path.join(BAD, 'research'));
    assert.equal(index.findings.get('FD01-F01')?.verdict, 'VERIFIED');
    assert.equal(index.findings.get('FD01-F02')?.dropped, true, 'verdict DROPPED');
    assert.equal(index.findings.get('FD01-F03')?.dropped, true, 'listed under Dropped at verification');
    assert.equal(index.findings.has('FD01-F04'), false);
    assert.equal(index.misleveled.get('FD01-F04')?.level, 4);
    assert.deepEqual(index.duplicates.map((d) => d.id), ['FD01-F01']);
    assert.deepEqual(index.dossiers.get('FD01'), ['research/evidence-beta.md', 'research/tool-alpha.md']);
  });

  test('ignores headings inside code blocks', () => {
    const index = indexResearch(path.join(GOOD, 'research'));
    assert.equal(index.findings.has('FD01-F99'), false);
    assert.equal(index.findings.get('FD02-F10')?.verdict, 'DOWNGRADED');
    assert.equal(index.findings.get('FD02-F10')?.dropped, false);
  });
});

describe('checkRefs', () => {
  test('passing fixture: every citation resolves, sections included', () => {
    const report = checkRefs({ root: GOOD, strict: true });
    assert.equal(report.ok, true, JSON.stringify(report.problems));
    assert.deepEqual(report.files, ['references/01-rules.md', 'SKILL.md', 'ARCHITECTURE.md', 'scripts/rules/registry.json']);
    assert.equal(report.counts.missing + report.counts.dropped + report.counts.missingDossiers + report.counts.unresolvedSections, 0);
    assert.equal(report.counts.sections, 3, 'registry rows such as "FD02 T01" count as dossier citations, not sections');
    assert.equal(report.counts.dossiers, 5);
    assert.ok(report.counts.findings >= 12);
    const skill = report.emDashes.files.find((f) => f.file === 'SKILL.md');
    assert.deepEqual([skill?.count, skill?.inCode], [1, 3], 'one em dash in prose; the span and the block hold three');
    assert.equal(report.emDashes.total, 1);
  });

  test('failing fixture: missing, dropped, misleveled and unknown dossiers are problems; sections are warnings', () => {
    const report = checkRefs({ root: BAD });
    assert.equal(report.ok, false);
    const got = report.problems.map((p) => `${p.problem} ${p.id} ${p.file}:${p.line}`).sort();
    assert.deepEqual(got, [
      'dropped FD01-F02 references/01-rules.md:5',
      'dropped FD01-F03 references/01-rules.md:5',
      'missing FD01-F04 references/01-rules.md:6',
      'missing FD01-F09 references/01-rules.md:4',
      'missing FD01-F77 scripts/rules/registry.json:5',
      'missing FD02-F05 references/01-rules.md:9',
      'missing FD03-F01 references/01-rules.md:10',
      'missing FD07-F01 references/01-rules.md:7',
      'missing-dossier FD08 references/01-rules.md:7',
      'missing-dossier FD09 scripts/rules/registry.json:5',
    ]);
    assert.equal(report.problems.find((p) => p.id === 'FD01-F77')?.raw, 'SL-T02: FD01-F77');
    assert.match(report.problems.find((p) => p.id === 'FD01-F04')?.hint ?? '', /level-4 heading/);
    assert.match(report.problems.find((p) => p.id === 'FD07-F01')?.hint ?? '', /no dossier FD07/);
    assert.deepEqual(report.warnings.map((w) => `${w.problem} ${w.section}`), ['unresolved-section Library choices']);
    assert.equal(report.duplicates.length, 1);
    assert.equal(report.emDashes.total, 3);
  });

  test('--strict turns an unresolved section into a problem', () => {
    const report = checkRefs({ root: BAD, strict: true });
    assert.ok(report.problems.some((p) => p.problem === 'unresolved-section'));
    assert.equal(report.warnings.length, 0);
  });
});

describe('check-refs CLI', () => {
  test('exit 0 on the passing fixture, JSON on stdout only with --json', () => {
    const r = cli(['--root', GOOD, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, true);
    assert.match(r.stderr, /check-refs: ok/);
    assert.equal(cli(['--root', GOOD]).stdout, '');
  });

  test('exit 1 on the failing fixture, each problem on stderr with file:line', () => {
    const r = cli(['--root', BAD]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /references\/01-rules\.md:4: missing FD01-F09/);
    assert.match(r.stderr, /references\/01-rules\.md:5: dropped FD01-F02/);
  });

  test('exit 2 without a research folder or with a bad flag', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'fe-refs-'));
    try {
      assert.equal(cli(['--root', empty]).status, 2);
      assert.equal(cli(['--bogus']).status, 2);
      assert.equal(cli(['--help']).status, 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('citingFiles', () => {
  test('covers the references, SKILL.md, ARCHITECTURE.md, CONTRACTS.md and the asset templates and agents', () => {
    const files = citingFiles(path.resolve(HERE, '..', '..', '..'));
    for (const f of ['SKILL.md', 'ARCHITECTURE.md', 'scripts/CONTRACTS.md', 'assets/agents/frontend-critic.md', 'assets/templates/brief.md', 'assets/task-templates/frontend.json']) {
      assert.ok(files.includes(f), `${f} is checked`);
    }
    assert.ok(files.some((f) => f.startsWith('references/')));
  });
});
