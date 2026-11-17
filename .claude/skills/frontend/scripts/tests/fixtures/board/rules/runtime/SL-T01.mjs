// @ts-check
// Fixture detector for board.mjs tests: fires on every visible element painted with a linear gradient.

/**
 * @param {{cache: {elements: () => Promise<Array<{sel: string, visible: boolean, styles: Record<string, string>}>>}}} ctx
 * @returns {Promise<Array<{selector: string, value: string, detail: string}>>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  return elements
    .filter((e) => e.visible && /linear-gradient/.test(e.styles.backgroundImage ?? ''))
    .map((e) => ({ selector: e.sel, value: (e.styles.backgroundImage ?? '').slice(0, 80), detail: 'gradient ground' }));
}
