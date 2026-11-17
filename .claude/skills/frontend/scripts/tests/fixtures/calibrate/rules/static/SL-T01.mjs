// Fixture static detector: files whose comment-stripped code mentions tell-gradient.
export function detect(ctx) {
  return ctx.files
    .filter((f) => f.code.includes('tell-gradient'))
    .map((f) => ({ file: f.path, line: 1, excerpt: 'tell-gradient', value: 'tell-gradient', detail: f.kind }));
}
