// Fixture runtime detector: elements with the class tell-badge.
export async function detect(ctx) {
  const n = await ctx.page.evaluate(() => document.querySelectorAll('.tell-badge').length);
  return n > 0 ? [{ selector: '.tell-badge', value: n, detail: `${n} badge(s)` }] : [];
}
