/** A lease setting that cannot work (renewal not well under the ttl, a malformed holder id...). */
export class LeaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaseConfigError";
  }
}

/** The engine was given the lease but its services could not start (`startEngine` threw). */
export class LeaderStartError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LeaderStartError";
  }
}

/** `run()` called twice on one `EngineLeader`. */
export class LeaderStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaderStateError";
  }
}
