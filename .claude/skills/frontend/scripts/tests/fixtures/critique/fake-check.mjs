// @ts-check
// Stand-in for frontend-check.mjs in the critique tests: prints the gate report named by FAKE_GATE_REPORT, with the
// arguments it received recorded under target.args, and exits 0 when the report is ok, 1 otherwise. FAKE_GATE_EXIT
// forces another exit code (a crashed or misused checker).
import { readFileSync } from 'node:fs';

const file = process.env.FAKE_GATE_REPORT;
if (!file) {
  process.stderr.write('fake-check: FAKE_GATE_REPORT is not set\n');
  process.exit(3);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
report.target = { ...(report.target ?? {}), args: process.argv.slice(2) };
if (process.env.FAKE_GATE_EXIT) {
  process.stderr.write('fake-check: forced failure\n');
  process.exit(Number(process.env.FAKE_GATE_EXIT));
}
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.ok ? 0 : 1);
