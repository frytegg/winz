// Stub check module (coverage group) for frontend-check tests: echoes the --features ids it received.
import { runStub } from './_stub.mjs';

const ids = ['coverage.features', 'coverage.metrics', 'coverage.hero', 'coverage.nevershow', 'coverage.placeholders'];
export const GATES = ids.map((id) => ({ id, title: `Stub ${id}`, ifDropped: `stub: ${id} would pass unchecked` }));

export async function run(ctx, selected) {
  return runStub('coverage', GATES, ctx, selected, { features: ctx.args.features ?? null, featureIds: ctx.args.featureIds });
}
