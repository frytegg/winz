import { chromium } from 'playwright-core';
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1100,height:400}});
await p.goto('http://localhost:3000/landing/tile-global.webp');
await p.setContent(`<body style="margin:0;display:flex;gap:20px;background:#f5f7fc;padding:20px">${['tile-global','tile-personal','memory-hero'].map(f=>`<figure style="margin:0;text-align:center;font:12px sans-serif"><img src="http://localhost:3000/landing/${f}.webp" style="height:320px"><figcaption>${f}</figcaption></figure>`).join('')}</body>`);
await p.waitForTimeout(1500); await p.screenshot({path: 'C:/Users/Utilisateur/AppData/Local/Temp/fe-imgs/sheet.png'}); await b.close();
