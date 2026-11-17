import { chromium } from 'playwright-core';
const b = await chromium.launch();
for (const w of [1903, 1440]) {
  const p = await b.newPage({viewport:{width:w,height:900}});
  await p.goto('http://localhost:3000/', {waitUntil:'load', timeout: 90000}); await p.waitForTimeout(1500);
  const m = await p.evaluate(() => {
    const ol = document.querySelector('ol .lp-flow-step')?.closest('ol');
    const sec = ol?.closest('section');
    const grid = ol?.parentElement;
    const r = el => { const x = el.getBoundingClientRect(); return [Math.round(x.left), Math.round(x.right), Math.round(x.width)]; };
    const art = document.querySelector('.lp-flow-step');
    const dev = grid?.firstElementChild;
    return { section: sec && r(sec), grid: grid && r(grid), deviceCol: dev && r(dev), ol: ol && r(ol), card: art && r(art), vw: innerWidth };
  });
  console.log(w, JSON.stringify(m));
  await p.close();
}
await b.close();
