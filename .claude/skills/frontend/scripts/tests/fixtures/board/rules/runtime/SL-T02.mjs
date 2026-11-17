// @ts-check
// Fixture detector for board.mjs tests: fires on elements marked data-tell="badge".

/**
 * @param {{cache: {elements: () => Promise<Array<{sel: string, visible: boolean, attrs: Record<string, string>}>>}}} ctx
 * @returns {Promise<Array<{selector: string, value: string, detail: string}>>}
 */
export async function detect(ctx) {
  const elements = await ctx.cache.elements();
  return elements.filter((e) => e.visible && e.attrs['data-tell'] === 'badge').map((e) => ({ selector: e.sel, value: 'badge', detail: 'badge above the headline' }));
}
