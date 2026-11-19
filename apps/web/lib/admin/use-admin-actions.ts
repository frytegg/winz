"use client";

import type { DemoBookRequest, DemoResultRequest, DemoSaleRequest } from "@winz/shared";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { isApiError } from "@/lib/api/client";
import { copy } from "@/lib/copy";

import { followSale, forceResult, readCheckoutStatus, replaySale, resetDemo, setBook } from "./api";
import type { SaleOutcome } from "./api";
import { bpsToPercentText, microToContracts } from "./book";
import {
  isBusy,
  journalReducer,
  newEntry,
  type AdminAction,
  type JournalEntry,
  type JournalEvent,
} from "./journal";

const T = copy.admin;

export interface AdminActions {
  entries: JournalEntry[];
  busy: Record<AdminAction, boolean>;
  sendBook: (request: DemoBookRequest) => void;
  sendResult: (request: DemoResultRequest) => void;
  sendSale: (request: DemoSaleRequest) => void;
  sendReset: () => void;
}

/** The words for a refusal or a missing answer. The key is never part of them. */
export function failureMessage(
  action: AdminAction,
  error: unknown,
): { message: string; uncertain: boolean } {
  if (isApiError(error) && error.status === 401) {
    return { message: T.errors.keyRejected, uncertain: false };
  }
  const text = isApiError(error) ? error.message : copy.common.genericError;
  // No answer at all, or a server error: for a sale, the write may have gone through.
  const unknownOutcome = isApiError(error) && (error.status === 0 || error.status >= 500);
  const uncertain = action === "sale" && unknownOutcome;
  return { message: uncertain ? `${text}${T.sale.mayExist}` : text, uncertain };
}

export function describeSaleOutcome(
  outcome: SaleOutcome,
  paymentIntentId: string,
): Partial<JournalEntry> {
  switch (outcome.kind) {
    case "ticketed":
      return { status: "done", message: T.sale.ticketed, ticketToken: outcome.ticketToken };
    case "cancelled_paused":
      return { status: "error", message: outcome.message ?? T.sale.cancelledPaused };
    case "failed":
      return { status: "error", message: outcome.message ?? T.sale.failed };
    case "timeout":
      return { status: "error", message: T.sale.timeout(paymentIntentId), uncertain: true };
    case "lost":
      return { status: "error", message: T.sale.lost(outcome.message), uncertain: true };
  }
}

/**
 * Sends the four demo actions and keeps their log. A line of the log changes from `sending` to
 * `done` only when the server's answer has arrived and passed its schema, so a success is never
 * shown before the server says so. A button locks while its action has no final answer: a second
 * tap of "Replay the sale" would be a second sale.
 */
export function useAdminActions(): AdminActions {
  const [entries, dispatch] = useReducer(
    (state: JournalEntry[], event: JournalEvent) => journalReducer(state, event),
    [],
  );
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const nextId = useRef(1);
  const controller = useRef<AbortController | null>(null);
  // Strict mode mounts, unmounts and mounts again: the controller is made on each mount.
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    controller.current = new AbortController();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const patch = useCallback((id: number, change: Partial<JournalEntry>): void => {
    if (mounted.current) dispatch({ type: "patch", id, patch: change });
  }, []);

  /** Starts a line, or returns `null` when this action is already waiting for its answer. */
  const begin = useCallback((action: AdminAction, summary: string): number | null => {
    if (isBusy(entriesRef.current, action)) return null;
    const id = nextId.current;
    nextId.current += 1;
    const entry = newEntry(id, action, summary, new Date());
    // The ref is read by the next tap before React renders: keep it current for the lock.
    entriesRef.current = journalReducer(entriesRef.current, { type: "start", entry });
    dispatch({ type: "start", entry });
    return id;
  }, []);

  const sendBook = useCallback(
    (request: DemoBookRequest): void => {
      const bid = bpsToPercentText(request.bidBps);
      const ask = bpsToPercentText(request.askBps);
      const depth = microToContracts(request.depth);
      const id = begin(
        "book",
        `${request.instrumentSymbol}: bid ${bid} · ask ${ask} · ${depth} contracts`,
      );
      if (id === null) return;
      setBook(request, controller.current?.signal).then(
        () => patch(id, { status: "done", message: T.drive.saved(bid, ask, depth) }),
        (error: unknown) => {
          const failure = failureMessage("book", error);
          patch(id, { status: "error", message: failure.message });
        },
      );
    },
    [begin, patch],
  );

  const sendResult = useCallback(
    (request: DemoResultRequest): void => {
      const outcome = T.result.options[request.outcome];
      const id = begin("result", `${request.instrumentSymbol}: ${outcome}`);
      if (id === null) return;
      forceResult(request, controller.current?.signal).then(
        () => patch(id, { status: "done", message: T.result.saved(outcome) }),
        (error: unknown) => {
          patch(id, { status: "error", message: failureMessage("result", error).message });
        },
      );
    },
    [begin, patch],
  );

  const sendReset = useCallback((): void => {
    const id = begin("reset", T.resetPanel.title);
    if (id === null) return;
    resetDemo(controller.current?.signal).then(
      () => patch(id, { status: "done", message: T.resetPanel.saved }),
      (error: unknown) => {
        patch(id, { status: "error", message: failureMessage("reset", error).message });
      },
    );
  }, [begin, patch]);

  const sendSale = useCallback(
    (request: DemoSaleRequest): void => {
      const id = begin("sale", `${request.slug} × ${request.qty.toString()} for ${request.email}`);
      if (id === null) return;
      const signal = controller.current?.signal;
      void (async (): Promise<void> => {
        try {
          const answer = await replaySale(request, signal);
          const paymentId = answer.paymentIntentId;
          if (answer.ticketToken !== null) {
            patch(id, {
              status: "done",
              message: T.sale.ticketed,
              paymentIntentId: paymentId,
              ticketToken: answer.ticketToken,
            });
            return;
          }
          if (paymentId === null) {
            // The route always names the payment of a sale; without it there is nothing to follow.
            patch(id, {
              status: "error",
              message: T.sale.lost(copy.common.genericError),
              uncertain: true,
            });
            return;
          }
          patch(id, {
            status: "following",
            message: T.sale.following(paymentId),
            paymentIntentId: paymentId,
          });
          if (signal === undefined) return;
          const outcome = await followSale(paymentId, { signal, read: readCheckoutStatus });
          if (outcome !== null)
            patch(id, { ...describeSaleOutcome(outcome, paymentId), paymentIntentId: paymentId });
        } catch (error: unknown) {
          if (signal?.aborted === true) return;
          const failure = failureMessage("sale", error);
          patch(id, { status: "error", message: failure.message, uncertain: failure.uncertain });
        }
      })();
    },
    [begin, patch],
  );

  const busy: Record<AdminAction, boolean> = {
    book: isBusy(entries, "book"),
    result: isBusy(entries, "result"),
    sale: isBusy(entries, "sale"),
    reset: isBusy(entries, "reset"),
  };
  return { entries, busy, sendBook, sendResult, sendSale, sendReset };
}
