/* A broken fake fragment: it draws a random number in code (lane B05 refusal test). */
async function feCritique(api, input) {
  const pick = Math.random();
  return {fragment: 'feCritique', task: input.task, ok: pick > 2};
}
