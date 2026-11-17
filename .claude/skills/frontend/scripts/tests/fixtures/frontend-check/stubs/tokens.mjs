// Stub check module (tokens group) for frontend-check tests; declares only two of the contract's three gates, so
// tokens.leak must come back skipped as undeclared.
import { runStub } from './_stub.mjs';

export const GATES = [
  { id: 'tokens.valid', title: 'Stub tokens valid', ifDropped: 'stub: scattered values would pass' },
  { id: 'tokens.contrast', title: 'Stub token contrast', ifDropped: 'stub: low-contrast pairs would pass' },
  { id: 'tokens.extra', title: 'Stub module-only gate', ifDropped: 'stub: a module-only gate would never run' },
];

export async function run(ctx, selected) {
  return runStub('tokens', GATES, ctx, selected);
}
