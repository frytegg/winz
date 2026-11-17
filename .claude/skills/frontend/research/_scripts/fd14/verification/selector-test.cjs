const { chromium } = require('C:/Users/Utilisateur/Documents/Coding/CodingChallenge/node_modules/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const css = `html{font-family:ui-sans-serif,system-ui,sans-serif}
:where(:not(:has([class*=" text-"]), :not(:has([class^="text-"])))) body { font-family: Inter, -apple-system, sans-serif; }
:where(:not(:has([class*=" text-"]), :not(:has([class^="text-"])))) h1 { font-size: 11px; }`;
const pages = {
  withSpacedTextClass: `<style>${css}</style><h1 class="text-7xl md:text-9xl">A</h1><p class="text-xl md:text-2xl text-muted-foreground">b</p>`,
  onlyLeadingTextClass: `<style>${css}</style><h1 class="text-7xl">A</h1>`,
  noTextClass: `<style>${css}</style><h1 class="big">A</h1>`,
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [k, html] of Object.entries(pages)) {
    await p.setContent(html);
    const r = await p.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, h1: getComputedStyle(document.querySelector('h1')).fontSize }));
    console.log(k, JSON.stringify(r));
  }
  console.log('chromium', b.version());
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
