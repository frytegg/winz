import { chromium } from 'playwright-core';
const out = 'C:/Users/Utilisateur/AppData/Local/Temp/fe-art';
const b = await chromium.launch();
for (const w of [1903, 1440]) {
  const p = await b.newPage({viewport:{width:w,height:900}});
  await p.goto('http://localhost:3000/', {waitUntil:'load', timeout: 90000}); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = document.querySelector('#intro-title').closest('section'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 10); });
  await p.waitForTimeout(2200);
  await p.screenshot({path: `${out}/intro-${w}.png`});
  const m = await p.evaluate(() => { const f = document.querySelector('#intro-title').closest('section').querySelector('figure'); const r = f.getBoundingClientRect(); const col = f.parentElement.getBoundingClientRect(); return {fig:[Math.round(r.left), Math.round(r.right)], col:[Math.round(col.left), Math.round(col.right)]}; });
  console.log(w, JSON.stringify(m));
  await p.close();
}
await b.close();
