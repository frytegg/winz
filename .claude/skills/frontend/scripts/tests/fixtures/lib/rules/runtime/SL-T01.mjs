// Fixture detector: elements with a gradient background; proves the collector cache is shared.
export async function detect(ctx) {
  const first = await ctx.cache.elements();
  const second = await ctx.cache.elements();
  const text = await ctx.cache.text();
  const animations = await ctx.cache.animations();
  return first
    .filter((e) => e.styles.backgroundImage.includes('gradient'))
    .map((e) => ({ selector: e.sel, value: e.text, detail: 'memoised=' + (first === second) + ' texts=' + text.length + ' animations=' + animations.length }));
}
