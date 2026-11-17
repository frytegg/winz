import { chromium } from 'playwright-core';
const out = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({viewport: {width: 1440, height: 900}});
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.goto('http://localhost:3000/', {waitUntil: 'load', timeout: 60000});
await page.waitForTimeout(2000);
await page.screenshot({path: out + '/landing-1.png'});
const h = await page.evaluate(() => document.documentElement.scrollHeight);
for (let i = 1; i < 6; i++) { await page.evaluate(y => window.scrollTo(0, y), i * 900); await page.waitForTimeout(400); await page.screenshot({path: out + `/landing-${i + 1}.png`}); }
await page.goto('http://localhost:3000/demo', {waitUntil: 'load', timeout: 60000}); await page.waitForTimeout(2000);
await page.screenshot({path: out + '/demo.png'});
const fonts = await page.evaluate(() => [...document.fonts].map(f => f.family + ':' + f.status).slice(0, 6));
console.log(JSON.stringify({scrollHeight: h, errs: errs.slice(0, 8), fonts}));
await b.close();
