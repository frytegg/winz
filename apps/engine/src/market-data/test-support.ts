/** Helpers shared by the market-data tests. Not imported by production code. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pino, { type Logger } from "pino";

import type { FetchLike, FetchResponseLike } from "./gemini-rest-client";
import type { Clock, Sleep } from "./rate-limiter";
import { eventsResponseSchema, type RawEvent } from "./schemas";

/**
 * Real Gemini responses recorded on 17 Nov 2026, cut down to a few events. The only edit
 * inside an event is the removal of each contract's `description` (rich text, ~900 bytes,
 * unused), to keep the folder small. `*.hand-edited.json` files are altered on purpose.
 *
 * Recorded on 19 Nov 2026 from api.gemini.com, same edits, plus: a game's nested `events` keep
 * only its full-game spread and total (`-S`, `-T`), and a cut listing's `pagination.total` is
 * the number of events kept, except where said:
 * - `events-active-ncaaf-ark-tex` (07:14 UTC, `status=active&category=Sports&search=
 *   NCAAF-2611212030-ARK-TEX&limit=50`, 15 events, kept: `-M`, `-S`, `-T`): Saturday's game with
 *   a two-sided moneyline book (Texas 0.91 / 0.92, Arkansas 0.08 / 0.09);
 * - `events-active-sports-cap` (07:09 UTC, `status=active&category=Sports&limit=1`): one event and
 *   the real `pagination.total` of 1003, the listing's cap;
 * - `events-recently-settled-19nov` (07:13 UTC, `recently-settled?category=Sports&limit=50`,
 *   total 280): six events of the first page, each with its `resolvedAt`;
 * - `event-settled-nba-uta-lal` (07:13 UTC, `events/NBA-2611190300-UTA-LAL-M`): one settled game
 *   as its own page serves it, its spread and total markets nested with their `resolutionSide`.
 */
export type FixtureName =
  | "events-active-sports"
  | "events-recently-settled"
  | "events-recently-settled.invalid-hand-edited"
  | "events-active-ncaaf-ark-tex"
  | "events-active-sports-cap"
  | "events-recently-settled-19nov"
  | "event-settled-nba-uta-lal"
  | "book-with-depth"
  | "book-empty";

export function fixtureText(name: FixtureName): string {
  return readFileSync(
    fileURLToPath(new URL(`./__fixtures__/${name}.json`, import.meta.url)),
    "utf8",
  );
}

/** A fresh, mutable copy of a fixture, for tests that break it on purpose. */
export function fixtureJson(name: FixtureName): unknown {
  return JSON.parse(fixtureText(name));
}

export function fixtureEvents(name: FixtureName): RawEvent[] {
  return eventsResponseSchema.parse(fixtureJson(name)).data;
}

export const silentLogger: Logger = pino({ level: "silent" });

export interface FakeTime {
  now: Clock;
  /** Resolves at once and moves the clock forward, so backoff and limiter waits cost nothing. */
  sleep: Sleep;
  /** Every duration passed to `sleep`, in order. */
  sleeps: number[];
  advance(ms: number): void;
}

export function fakeTime(startMs = 1_800_000_000_000): FakeTime {
  let current = startMs;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: (ms) => {
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    },
    sleeps,
    advance: (ms) => {
      current += ms;
    },
  };
}

export interface FakeResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { status, body: JSON.stringify(body) };
}

export interface FakeFetch {
  fetch: FetchLike;
  /** Every URL requested, in order. */
  urls: string[];
  /** Headers of every request, in order. */
  headers: Record<string, string>[];
}

/**
 * A `fetch` that never touches the network. `respond` gets the URL and the 0-based call
 * index and returns a response, or throws to simulate a network failure.
 */
export function fakeFetch(respond: (url: string, call: number) => FakeResponse): FakeFetch {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetch: FetchLike = (url, init) => {
    const call = urls.length;
    urls.push(url);
    headers.push(init.headers);
    let response: FakeResponse;
    try {
      response = respond(url, call);
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const result: FetchResponseLike = {
      status: response.status,
      headers: { get: (name) => response.headers?.[name.toLowerCase()] ?? null },
      text: () => Promise.resolve(response.body),
    };
    return Promise.resolve(result);
  };
  return { fetch, urls, headers };
}
