// Stub check module (render and a11y groups) for frontend-check tests: loads the target's first route with the
// shared browser and reports the page title, so the tests see the target and the browser really work.
import { runStub } from './_stub.mjs';

const ids = ['render.console', 'render.requests', 'render.fonts', 'render.images', 'render.overflow', 'render.clipping', 'render.cls', 'a11y.axe', 'a11y.contrast', 'a11y.targets'];
export const GATES = ids.map((id) => ({ id, title: `Stub ${id}`, ifDropped: `stub: ${id} would pass unchecked` }));

export async function run(ctx, selected) {
  let title = null;
  if (ctx.baseUrl && ctx.browser) {
    const context = await ctx.browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(new URL(ctx.routes[0].path, ctx.baseUrl).href);
      title = await page.title();
    } finally {
      await context.close();
    }
  }
  return runStub('qa', GATES, ctx, selected, { title });
}
