import { describe, expect, it } from "vitest";

import { landingCopy } from "./copy";

describe("landingCopy.meta", () => {
  it("is the title and the description the owner decided, word for word", () => {
    expect(landingCopy.meta.title).toBe("Winz · Refunded if the team wins");
    expect(landingCopy.meta.description).toBe(
      "Fans pay in one tap and get refunded if their team wins. The merchant's risk is hedged. Built for UBC 2026.",
    );
  });

  it("fits what a tab and a search result show", () => {
    expect(landingCopy.meta.title.length).toBeLessThanOrEqual(60);
    expect(landingCopy.meta.description.length).toBeLessThanOrEqual(160);
  });
});

describe("landingCopy.heroTitle", () => {
  it("reads as the H1 of COPY.md once the three runs are put together", () => {
    const { before, highlight, firstLineEnd, second } = landingCopy.heroTitle;
    expect(`${before}${highlight}${firstLineEnd} ${second}`).toBe("Get payback if your team wins.");
    expect(highlight).toBe("payback");
  });
});

describe("landingCopy.demoTitle", () => {
  it("reads as the H2 of COPY.md, with a promo as the lime run", () => {
    const { before, highlight, second } = landingCopy.demoTitle;
    expect(`${before}${highlight} ${second}`).toBe("Watch a promo go live and settle.");
    expect(highlight).toBe("a promo");
  });
});

describe("landingCopy.demo", () => {
  it("has the words of COPY.md section 4", () => {
    expect(landingCopy.demo.eyebrow).toBe("Demo");
    expect(landingCopy.demo.cta).toBe("Try the live demo");
    expect(landingCopy.demo.play).toBe("Play the Winz demo video");
    expect(landingCopy.demo.soon).toBe("Demo video coming soon.");
  });
});

describe("landingCopy.features", () => {
  it("has the six cards of COPY.md section 6, in order", () => {
    expect(landingCopy.features.items.map((item) => item.title)).toEqual([
      "One-tap payment",
      "A ticket that stays live",
      "Share by scan",
      "Set a budget",
      "Transparent hedge desk",
      "Payments that behave",
    ]);
    expect(landingCopy.features.items.map((item) => item.icon)).toEqual([
      "icon-01",
      "icon-02",
      "icon-03",
      "icon-04",
      "icon-05",
      "icon-06",
    ]);
  });

  it("has the header of COPY.md", () => {
    expect(landingCopy.features.eyebrow).toBe("Features");
    expect(landingCopy.features.title).toBe("Designed to be adopted.");
    expect(landingCopy.features.subtitle).toBe(
      "Everything a promo needs. Nothing a fan has to learn.",
    );
  });
});

describe("landingCopy.process", () => {
  it("has the header and the six steps of COPY.md section 5, in order, with its two corrections", () => {
    expect(landingCopy.process.eyebrow).toBe("Live demo");
    expect(landingCopy.process.title).toBe("Test it in three minutes.");
    expect(landingCopy.process.steps.map((step) => step.title)).toEqual([
      "Onboarding",
      "Create your first promo",
      "Fund it by card",
      "Share it",
      "Buy as a fan",
      "Team wins, refund lands",
    ]);
    expect(landingCopy.process.steps[0]?.body).toBe(
      "Open the live demo and create a promo. Use any e-mail: a login code is sent to it.",
    );
    expect(landingCopy.process.scene.onboarding.subtitle).toBe(
      "No password. We'll email you a 6-digit code.",
    );
  });

  it("holds no marker that a visitor would read as unfinished", () => {
    const text = JSON.stringify(landingCopy.process);
    expect(text).not.toMatch(/TODO|FIXME|lorem/i);
  });
});

describe("landingCopy.cta", () => {
  it("has the words of COPY.md section 7", () => {
    expect(landingCopy.cta.title).toBe("Refunded if the team wins.");
    expect(landingCopy.cta.button).toBe("View the code");
    expect(landingCopy.cta.illustrationAlt).toBe(
      "The Winz app: picking a game, the opening screen and a live promo with its QR code.",
    );
  });
});

describe("landingCopy.footer", () => {
  it("has the statement, the app block and the three columns of COPY.md section 8", () => {
    const { footer } = landingCopy;
    expect(`${footer.statement.first} ${footer.statement.second}`).toBe(
      "Every promo is a bet. Winz hedges it.",
    );
    expect(footer.app.title).toBe("Get the app");
    expect(footer.app.body).toBe("Winz is a web app. Add it to your home screen.");
    expect(footer.app.button).toBe("Add to Home Screen");
    expect(footer.winz.links.map((link) => link.label)).toEqual([
      "How it works",
      "Demo video",
      "Features",
      "Live demo",
    ]);
    expect([footer.project.github, footer.project.devpost, footer.project.video]).toEqual([
      "GitHub",
      "Devpost",
      "Demo video",
    ]);
    expect(footer.builtAt.items).toEqual(["UBC 2026", "Consumer app track", "Austin, Texas"]);
  });

  it("points its Winz column at the same anchors as the navigation", () => {
    expect(landingCopy.footer.winz.links.map((link) => link.href)).toEqual(
      landingCopy.nav.links.map((link) => link.href),
    );
  });

  it("has the two legal lines", () => {
    expect(landingCopy.footer.legal.copyright).toBe("© 2026 Winz");
    expect(landingCopy.footer.legal.note).toBe(
      "Hackathon prototype on test networks. No real funds, no real bets.",
    );
  });
});

describe("landingCopy.install", () => {
  const { install } = landingCopy;

  it("has the words of COPY.md section 9", () => {
    expect(install.title).toBe("Get Winz on your phone");
    expect(install.subtitle).toBe("It's a web app. No store, no download.");
    expect(install.addToHome).toBe("Add to Home Screen");
    expect(install.accepted).toBe("Winz is on your home screen. Open it from there.");
    expect(install.androidMenu).toBe(
      "Open the browser menu (⋮), then choose Add to Home screen or Install app.",
    );
    expect(install.iosSteps).toEqual([
      "Tap Share",
      "Choose Add to Home Screen",
      "Open Winz from your home screen",
    ]);
    expect(install.inApp).toBe("Open this page in Safari (or Chrome) to install Winz.");
    expect(install.copyLink).toBe("Copy link");
    expect(install.linkCopied).toBe("Link copied");
    expect(install.desktop).toBe("Scan with your phone to open Winz.");
    expect(install.openInBrowser).toBe("Open in browser instead");
    expect(install.bestOnPhone).toBe("Best on your phone");
  });

  it("says nothing a visitor has to know about wallets, chains or stores to install", () => {
    const words = JSON.stringify(install).toLowerCase();
    for (const forbidden of ["wallet", "crypto", "usdc", "token", "blockchain"]) {
      expect(words).not.toContain(forbidden);
    }
  });
});

describe("landingCopy.example", () => {
  const { example } = landingCopy;

  it("is the demo video's: Buzzball’s shop, a $12.00 smash burger, 100% back if Texas wins", () => {
    expect(example.merchant).toBe("Buzzball’s shop");
    expect(example.item).toBe("Smash burger");
    expect(example.price).toBe("$12.00");
    expect(example.promise).toBe("100% back if Texas wins!");
    // 100% back: the refund is the whole price.
    expect(example.refund).toBe(`+${example.price}`);
  });

  it("is Arkansas at Texas, Saturday November 21, 2:30 PM, with the app's names and chances", () => {
    expect(example.home).toEqual({ name: "Texas", abbreviation: "TEX", chance: 91 });
    expect(example.away).toEqual({ name: "Arkansas", abbreviation: "ARK", chance: 9 });
    expect(example.home.chance + example.away.chance).toBe(100);
    expect(example.kickoff).toEqual({ time: "2:30", meridiem: "PM", date: "Nov 21" });
    expect(example.scoreLive).toEqual({ home: 17, away: 17 });
    expect(example.scoreFinal).toEqual({ home: 31, away: 17 });
    // Texas wins: the promise is kept.
    expect(example.scoreFinal.home).toBeGreaterThan(example.scoreFinal.away);
  });

  it("links to the production host, with the slug the engine builds from the shop and the condition", () => {
    // `campaignSlugBase("Buzzball’s shop", "Texas wins")` in apps/engine/src/jobs/handlers/slug.ts.
    expect(example.link).toBe("winz-nu.vercel.app/c/buzzballs-shop-texas-wins");
    expect(example.link.split("/c/")[1]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("types an e-mail of 18 characters, the steps of process.css's typing", () => {
    expect(example.email).toBe("alex@buzzballs.com");
    expect(example.email).toHaveLength(18);
  });

  it("is the example both How it works and the Process section tell", () => {
    const { how, process } = landingCopy;
    expect(how.scene.promise).toBe(example.promise);
    expect(how.scene.merchant).toBe(example.merchant);
    expect(how.scene.amount).toBe(example.refund);
    expect(how.merchantScene.link).toBe(example.link);
    expect(process.scene.fan.promise).toBe(example.promise);
    expect(process.scene.fan.merchant).toBe(example.merchant);
    expect(process.scene.fan.amount).toBe(example.price);
    expect(process.scene.fan.refund).toBe(example.refund);
    expect(process.scene.onboarding.email).toBe(example.email);
    expect([process.scene.pick.home, process.scene.pick.away]).toEqual(["Texas", "Arkansas"]);
  });

  it("is the one example of the whole landing copy", () => {
    expect(JSON.stringify(landingCopy)).not.toMatch(
      /pittsburgh|philadelphia|joe[’']?s|pizza|\bPIT\b|\bPHI\b|\$20\.00|Nov 22|November 22/i,
    );
  });
});
