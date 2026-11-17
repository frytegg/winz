import { chromium } from "playwright-core";
const out = "C:/Users/Utilisateur/AppData/Local/Temp/fe-hybrid";
const tag = process.argv[2] ?? "app";
const pages = [["alice/agent","alice_agent"],["alice/desks","alice_desks"],["bob/desks","bob_desks"],["bob/consents","bob_consents"],["alice/agreements","alice_agreements"]];
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); } catch { browser = await chromium.launch({ channel: "msedge" }); }
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
for (const [path, name] of pages) {
  await page.goto(`http://localhost:3000/${path}`, { waitUntil: "networkidle", timeout: 90000 }).catch(e=>console.error(path, e.message));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${tag}-${name}-desktop.png`, animations: "disabled", timeout: 90000 });
  if (name === "alice_desks") await page.screenshot({ path: `${out}/${tag}-${name}-full.png`, fullPage: true, animations: "disabled", timeout: 90000 });
  if (name === "alice_agent") {
    const t = await page.locator("h1").first().innerText().catch(()=>"?");
    console.log("h1 text:", JSON.stringify(t));
    const lbl = await page.locator("aside .mono-label").allInnerTexts().catch(()=>[]);
    console.log("aside labels:", lbl);
  }
}
await browser.close();
