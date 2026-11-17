// Fixture runtime detector that no fixture page triggers.
export async function detect(ctx) {
  const n = await ctx.page.evaluate(() => document.querySelectorAll('.tell-never').length);
  return n > 0 ? [{ selector: '.tell-never', value: n, detail: 'never' }] : [];
}
