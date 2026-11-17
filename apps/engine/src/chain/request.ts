import { isAddress, type Address, type Hex } from "viem";

import { InvalidTxRequestError, UnserializableValueError } from "./errors";
import { toJsonValue } from "./events";
import type { NewChainTx } from "./store";
import {
  SENDER_STATE_KEY,
  SIGNER_NAMES,
  type JsonObject,
  type SignerName,
  type TxRequest,
} from "./types";

/** `chain_txs.value` is a Postgres `bigint`. */
export const MAX_TX_VALUE_WEI = 2n ** 63n - 1n;

const CALL_DATA_PATTERN = /^0x([0-9a-fA-F]{2})*$/;

function isSignerName(value: unknown): value is SignerName {
  return typeof value === "string" && (SIGNER_NAMES as readonly string[]).includes(value);
}

/**
 * Checks a request and puts it in the form `chain_txs` stores: lowercase address and call data,
 * JSON payload with bigints as decimal strings. Throws `InvalidTxRequestError` instead of
 * letting a row that can never be sent into the queue.
 */
export function normalizeTxRequest(request: TxRequest): NewChainTx {
  if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.trim() === "") {
    throw new InvalidTxRequestError("idempotencyKey is empty");
  }
  if (!isSignerName(request.signer)) {
    throw new InvalidTxRequestError(`unknown signer '${String(request.signer)}'`);
  }
  if (typeof request.kind !== "string" || request.kind.trim() === "") {
    throw new InvalidTxRequestError("kind is empty");
  }
  if (typeof request.to !== "string" || !isAddress(request.to, { strict: false })) {
    throw new InvalidTxRequestError(`'to' is not an address: ${String(request.to)}`);
  }
  if (typeof request.data !== "string" || !CALL_DATA_PATTERN.test(request.data)) {
    throw new InvalidTxRequestError("'data' is not 0x-prefixed hex with whole bytes");
  }
  const value = request.value ?? 0n;
  if (typeof value !== "bigint" || value < 0n || value > MAX_TX_VALUE_WEI) {
    throw new InvalidTxRequestError(
      `'value' must be a bigint between 0 and ${MAX_TX_VALUE_WEI.toString()}`,
    );
  }

  const rawPayload = request.payload ?? {};
  if (typeof rawPayload !== "object" || rawPayload === null || Array.isArray(rawPayload)) {
    throw new InvalidTxRequestError("'payload' must be an object");
  }
  if (SENDER_STATE_KEY in rawPayload) {
    throw new InvalidTxRequestError(`payload key '${SENDER_STATE_KEY}' is reserved for the sender`);
  }
  let payload: JsonObject;
  try {
    payload = toJsonValue(rawPayload, "payload") as JsonObject;
  } catch (error: unknown) {
    if (error instanceof UnserializableValueError) {
      throw new InvalidTxRequestError(error.message);
    }
    throw error;
  }

  return {
    idempotencyKey: request.idempotencyKey,
    signer: request.signer,
    kind: request.kind,
    to: request.to.toLowerCase() as Address,
    data: request.data.toLowerCase() as Hex,
    value,
    payload,
  };
}
