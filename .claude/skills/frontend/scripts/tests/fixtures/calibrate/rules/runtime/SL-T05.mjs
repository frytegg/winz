// Fixture runtime detector: throws on a page with .boom, fires on .tell-five.
export async function detect(ctx) {
  const { boom, five } = await ctx.page.evaluate(() => ({
    boom: document.querySelectorAll('.boom').length,
    five: document.querySelectorAll('.tell-five').length,
  }));
  if (boom > 0) throw new RangeError('fixture boom');
  return five > 0 ? [{ selector: '.tell-five', value: five, detail: 'five' }] : [];
}
