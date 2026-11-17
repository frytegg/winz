// Stub check module (brief group) for frontend-check tests.
import { runStub } from './_stub.mjs';

export const GATES = [{ id: 'brief.complete', title: 'Stub brief complete', ifDropped: 'stub: an untraceable brief would pass' }];

export async function run(ctx, selected) {
  return runStub('brief', GATES, ctx, selected);
}
