// Fixture runtime detector on a fresh page: fires on .tell-fresh (the fresh page loaded the same URL) and on any
// Wayback chrome or blocked script found there (fresh pages must follow the same network rules and stripping).
export async function detect(ctx) {
  const page = await ctx.freshPage();
  const result = await page.evaluate(() => ({
    fresh: document.querySelectorAll('.tell-fresh').length,
    toolbar: Boolean(document.querySelector('[id^="wm-"], #donato')),
    leaked: Boolean(document.querySelector('.leaked')),
    text: (document.body.innerText || '').includes('Wayback'),
  }));
  const out = [];
  if (result.fresh > 0) out.push({ selector: '.tell-fresh', value: result.fresh, detail: 'fresh page' });
  if (result.toolbar || result.leaked || result.text) out.push({ selector: 'body', value: JSON.stringify(result), detail: 'leak on the fresh page' });
  return out;
}
