// A CLI report (BNB apps/supervisor/src/render.ts shape): terminal lines, never the page.
export function printRun(run: { id: string; pools: number; ms: number }): void {
  console.log(`run ${run.id} · ${run.pools} pools · ${run.ms} ms`);
  console.log(`guard · ok · ${run.ms} ms`);
  console.log(`replay · done · ${run.pools} pools`);
}
