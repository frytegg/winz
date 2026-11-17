import { chromium } from 'playwright-core';
const out = 'C:/Users/Utilisateur/AppData/Local/Temp/fe-hybrid';
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1903,height:900}});
const errs = []; p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
await p.goto('http://localhost:3000/', {waitUntil:'load', timeout: 90000}); await p.waitForTimeout(2000);
for (const [sel, name] of [['#intro-title','intro'], ['.lp-flow-step','story'], ['#demo-title','demo']]) {
  await p.evaluate(s => { const el = document.querySelector(s); const sec = el.closest('section'); window.scrollTo(0, sec.getBoundingClientRect().top + scrollY - 20); }, sel);
  await p.waitForTimeout(1800);
  await p.screenshot({path: `${out}/fix-${name}.png`});
}
const m = await p.evaluate(() => { const ol = document.querySelector('ol .lp-flow-step').closest('ol'); const r = ol.getBoundingClientRect(); const d = ol.parentElement.firstElementChild.querySelector('[class*="w-[min(112px"]') || ol.parentElement.firstElementChild; const rd = d.getBoundingClientRect(); return {cards:[Math.round(r.left), Math.round(r.right)], device:[Math.round(rd.left), Math.round(rd.right)], vw: innerWidth}; });
console.log(JSON.stringify(m), errs.slice(0,5));
await b.close();
