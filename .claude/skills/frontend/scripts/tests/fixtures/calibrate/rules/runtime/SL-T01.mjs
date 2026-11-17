// Fixture runtime detector: elements with the class tell-gradient.
export async function detect(ctx) {
  const n = await ctx.page.evaluate(() => document.querySelectorAll('.tell-gradient').length);
  return n > 0 ? [{ selector: '.tell-gradient', value: n, detail: `${n} element(s)` }] : [];
}
