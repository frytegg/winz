// @ts-check
/**
 * Regenerates the font files of the tokens fixtures (run: node tests/tokens/fixture-fonts.mjs). The faces are
 * boxes drawn by tests/tokens/helpers.mjs, so they carry no third-party design.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES, makeFont, toWoff2 } from './helpers.mjs';

const fonts = path.join(FIXTURES, 'good', 'design', 'fonts');
mkdirSync(fonts, { recursive: true });
writeFileSync(path.join(fonts, 'FixtureSans-Regular.woff2'), toWoff2(makeFont({ family: 'Fixture Sans', tnum: true })));
writeFileSync(path.join(fonts, 'FixtureMono-Regular.woff2'), toWoff2(makeFont({ family: 'Fixture Mono', monospace: true })));
process.stdout.write(`wrote ${fonts}\n`);
