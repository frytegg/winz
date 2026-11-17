import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2];
const base = 'http://localhost:3000';
const routes = ['/', '/demo', '/alice', '/alice/agent', '/alice/onboarding', '/alice/desks', '/bob/consents', '/bob/agreements', '/bob/access', '/chloe/compliance'];
const b = await chromium.launch();
const res = {};
for (const [vpName, vp, dpr] of [['desktop', {width: 1440, height: 900}, 1], ['mobile', {width: 390, height: 844}, 2]]) {
  const ctx = await b.newContext({viewport: vp, deviceScaleFactor: dpr, isMobile: vpName === 'mobile', hasTouch: vpName === 'mobile', reducedMotion: 'reduce'});
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  for (const r of (vpName === 'desktop' ? routes : ['/', '/demo', '/alice/agent', '/bob/consents'])) {
    const resp = await page.goto(base + r, {waitUntil: 'load', timeout: 60000}).catch(e => null);
    await page.waitForTimeout(1500);
    const name = (r === '/' ? 'landing' : r.slice(1).replace(/\//g, '_')) + '-' + vpName;
    await page.screenshot({path: `${out}/${name}.png`, animations: 'disabled'});
    const jpg = await page.screenshot({type: 'jpeg', quality: 70, animations: 'disabled'});
    const m = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const secs = [...document.querySelectorAll('main > section, main > div > section, main section[id]')].length;
      return {status: 0, h1: h1 ? h1.innerText.replace(/\s+/g, ' ').trim() : null, scrollHeight: document.documentElement.scrollHeight, sections: secs, title: document.title};
    });
    res[name] = {...m, http: resp ? resp.status() : null, screens: +(m.scrollHeight / vp.height).toFixed(1), firstViewJpegKiB: +(jpg.length / 1024).toFixed(1)};
  }
  res['console_errors_' + vpName] = errors.slice(0, 10);
  await ctx.close();
}
await b.close();
fs.writeFileSync(`${out}/baseline.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
