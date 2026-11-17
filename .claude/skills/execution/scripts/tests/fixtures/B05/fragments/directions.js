/*
 * Fake feDirections for lane B05's harness tests (not /frontend's). No import, no Date.now, no Math.random.
 * input.behaviour as in the fake critique.js.
 */
async function feDirections(api, input) {
  const keys = Object.keys(api).sort().join(',');
  api.log(input.task + ' fake feDirections api=' + keys);
  const designer = input.agents && input.agents.designer ? input.agents.designer : {model: 'opus', effort: 'high'};
  const out = await api.agent('Draw two directions.', {
    label: input.task + ' fragment designer', phase: 'Frontend', agentType: designer.agentType,
    model: designer.model, effort: designer.effort
  });
  const ok = input.behaviour === 'ok' && out !== null;
  return {fragment: 'feDirections', task: input.task, ok, api_keys: keys};
}
