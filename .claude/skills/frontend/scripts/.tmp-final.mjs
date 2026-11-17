import { chromium } from 'playwright-core';
const out = 'C:/Users/Utilisateur/AppData/Local/Temp/fe-art';
const b = await chromium.launch();
for (const [theme, w] of [['light', 1440], ['dark', 1440], ['dark', 1903]]) {
  const ctx = await b.newContext({viewport: {width: w, height: 900}, colorScheme: theme});
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/', {waitUntil: 'load', timeout: 90000}); await p.waitForTimeout(1500);
  await p.evaluate(t => { localStorage.setItem('theme', t); document.documentElement.classList.toggle('dark', t === 'dark'); document.documentElement.style.colorScheme = t; }, theme);
  await p.waitForTimeout(500);
  await p.screenshot({path: `${out}/final-${theme}-${w}-top.png`});
  for (const [sel, name] of [['#intro-title', 'intro'], ['.lp-flow-step', 'story']]) {
    await p.evaluate(s => { const sec = document.querySelector(s).closest('section'); window.scrollTo(0, sec.getBoundingClientRect().top + scrollY - 10); }, sel);
    await p.waitForTimeout(2000);
    await p.screenshot({path: `${out}/final-${theme}-${w}-${name}.png`});
  }
  await ctx.close();
}
await b.close(); console.log('ok');
