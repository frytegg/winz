// Fixture detector: interacts only on a fresh page, never on the shared one.
export async function detect(ctx) {
  const page = await ctx.freshPage();
  await page.hover('button');
  globalThis.__feFreshPage = page;
  return [{ selector: 'button', value: page.url(), detail: 'fresh=' + (page !== ctx.page), viewport: 'custom-viewport' }];
}
