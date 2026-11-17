// Fixture static detector (static-only rule): files whose code mentions figma-make.
export function detect(ctx) {
  return ctx.files
    .filter((f) => f.code.includes('figma-make'))
    .map((f) => ({ file: f.path, line: 1, excerpt: 'figma-make', value: 'figma-make', detail: f.kind }));
}
