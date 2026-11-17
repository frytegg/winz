/*
 * Fake feCritique for lane B05's harness tests (not /frontend's). Its header names the forbidden tokens in a
 * comment, as /frontend's real fragment does: no import or export, no Date.now, no Math.random, no new Date().
 * input.behaviour: "ok" (one critic call, receipt ok), "null" (the critic dies), "notok" (receipt not ok),
 * "throw" (the critic call throws inside api.agent, which the wave script's tracked api turns into null).
 */
async function feCritique(api, input) {
  const keys = Object.keys(api).sort().join(',');
  api.log(input.task + ' fake feCritique api=' + keys + ' cwd=' + input.cwd);
  const critic = input.agents && input.agents.critic ? input.agents.critic : {model: 'opus', effort: 'high'};
  const out = await api.agent('Critique the first view. Return {issues}.', {
    label: input.task + ' fragment critic', phase: 'Frontend', agentType: critic.agentType,
    model: critic.model, effort: critic.effort
  });
  const ok = input.behaviour === 'ok' && out !== null;
  return {fragment: 'feCritique', task: input.task, ok, api_keys: keys, stop_reason: ok ? 'accepted' : 'rejected'};
}
