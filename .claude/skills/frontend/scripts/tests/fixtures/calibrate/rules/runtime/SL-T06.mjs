// Fixture runtime detector: fires when Wayback chrome survived or a blocked script ran on the shared page.
export async function detect(ctx) {
  const leaks = await ctx.page.evaluate(leakProbe);
  return leaks.map((what) => ({ selector: 'body', value: what, detail: `leak: ${what}` }));
}

function leakProbe() {
  const found = [];
  if (document.querySelector('[id^="wm-"], #donato')) found.push('toolbar element');
  if (document.querySelector('.leaked')) found.push('script from another origin ran');
  if (document.querySelector('link[href*="archive.org/_static/"]')) found.push('playback stylesheet');
  if ((document.body.innerText || '').includes('Wayback')) found.push('toolbar text');
  return found;
}
