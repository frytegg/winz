// Fixture detector: reports every file whose comment-stripped code mentions linear-gradient.
const NEWLINE = String.fromCharCode(10);

export function detect(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    const at = f.code.indexOf('linear-gradient');
    if (at < 0) continue;
    findings.push({
      rule: 'WRONG-ID',
      file: f.path,
      line: f.code.slice(0, at).split(NEWLINE).length,
      excerpt: 'x'.repeat(200),
      value: 'linear-gradient',
      detail: `${f.kind} via ${ctx.rule.id}`,
    });
  }
  return findings;
}
