// Fake detectors for the slop-check tests. They fire on explicit fixture markers only, never on real patterns:
// static `fx-<tag>` (or `fx-<tag>@<repo path>`, which reports that path as the finding's asset) in comment-stripped
// code, and runtime elements whose data-fx lists the tag (data-asset is passed through as the finding's asset).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MARKER = /fx-([a-z0-9]+)(?:@([\w./-]+))?/g;

/**
 * @param {string} tag
 * @param {{assetFiles?: string[]}} [options] repository files to read as well (as a detector that opens assets would)
 */
export function staticMarker(tag, { assetFiles = [] } = {}) {
  return function detect(ctx) {
    const findings = [];
    for (const file of ctx.files) {
      file.code.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(MARKER)) {
          if (m[1] !== tag) continue;
          const finding = { file: file.path, line: i + 1, excerpt: line.trim(), value: m[0], detail: 'fixture marker' };
          if (m[2]) finding.asset = m[2];
          findings.push(finding);
        }
      });
    }
    for (const rel of assetFiles) {
      const abs = path.join(ctx.root, rel);
      if (existsSync(abs) && readFileSync(abs, 'utf8').includes(`fx-${tag}`)) {
        findings.push({ file: rel, line: 1, excerpt: '', value: `fx-${tag}`, detail: 'fixture marker in an asset file' });
      }
    }
    return findings;
  };
}

/**
 * @param {string} tag
 */
export function runtimeMarker(tag) {
  return async function detect(ctx) {
    return ctx.page.evaluate((t) => Array.from(document.querySelectorAll('[data-fx]'))
      .filter((el) => (el.getAttribute('data-fx') || '').split(' ').includes(t))
      .map((el) => {
        const finding = { selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), value: el.textContent.trim(), detail: 'fixture marker' };
        const asset = el.getAttribute('data-asset');
        if (asset) finding.asset = asset;
        return finding;
      }), tag);
  };
}
