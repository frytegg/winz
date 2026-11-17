import {
  BaseError,
  createPublicClient,
  encodeErrorResult,
  http,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { winzEscrowAbi } from "@winz/shared";

import { startAnvil, type AnvilInstance } from "../testing/anvil";
import {
  classifyBroadcastError,
  classifySimulationError,
  decodeRevertData,
  describeError,
  isReceiptNotFound,
} from "./decode-error";
import { receiptOf, REVERTING_CALL_DATA, sendDirect, testContractInitCode } from "./test-support";

const solidityError = [{ type: "error", name: "Error", inputs: [{ type: "string" }] }] as const;
const solidityPanic = [{ type: "error", name: "Panic", inputs: [{ type: "uint256" }] }] as const;

/** An error shaped like the ones viem raises: nested causes, the node's words in `details`. */
function rpcError(
  node: { code: number; message: string; data?: unknown },
  outerName: string,
): Error {
  const inner = Object.assign(new Error(node.message), node);
  const request = Object.assign(
    new Error("RPC Request failed.\n\nURL: https://rpc.example/token-SECRET"),
    {
      name: "RpcRequestError",
      shortMessage: "RPC Request failed.",
      details: node.message,
      code: node.code,
      data: node.data,
      cause: inner,
    },
  );
  return Object.assign(new Error(`${outerName}\n\nURL: https://rpc.example/token-SECRET`), {
    name: outerName,
    shortMessage: "Something failed.",
    details: node.message,
    cause: request,
  });
}

describe("decodeRevertData", () => {
  it("names every custom error of winzEscrowAbi", () => {
    const names = winzEscrowAbi.filter((item) => item.type === "error").map((item) => item.name);
    expect(names.length).toBeGreaterThan(20);
    for (const errorName of names) {
      expect(decodeRevertData(encodeErrorResult({ abi: winzEscrowAbi, errorName }))).toBe(
        errorName,
      );
    }
  });

  it("returns the reason string of Error(string)", () => {
    const data = encodeErrorResult({ abi: solidityError, errorName: "Error", args: ["no funds"] });
    expect(decodeRevertData(data)).toBe("no funds");
  });

  it("formats a panic with its code", () => {
    const data = encodeErrorResult({ abi: solidityPanic, errorName: "Panic", args: [0x11n] });
    expect(decodeRevertData(data)).toBe("Panic(0x11)");
  });

  it("returns unknown data untouched", () => {
    expect(decodeRevertData("0xdeadbeef")).toBe("0xdeadbeef");
    expect(decodeRevertData("0xdeadbeef00000000")).toBe("0xdeadbeef00000000");
  });
});

describe("classifySimulationError", () => {
  it("decodes the custom error carried by a revert", () => {
    const data = encodeErrorResult({ abi: winzEscrowAbi, errorName: "QuoteExpired" });
    const verdict = classifySimulationError(
      rpcError(
        { code: 3, message: "execution reverted: custom error", data },
        "CallExecutionError",
      ),
    );
    expect(verdict).toEqual({ kind: "revert", reason: "QuoteExpired", data });
  });

  it("reads revert data nested one level deeper, as some nodes send it", () => {
    const data = encodeErrorResult({ abi: winzEscrowAbi, errorName: "BudgetExceeded" });
    const verdict = classifySimulationError(
      rpcError(
        { code: -32000, message: "execution reverted", data: { data } },
        "CallExecutionError",
      ),
    );
    expect(verdict).toMatchObject({ kind: "revert", reason: "BudgetExceeded" });
  });

  it("keeps the raw reason when there is no data", () => {
    expect(
      classifySimulationError(
        rpcError(
          { code: 3, message: "execution reverted: ERC20: transfer amount exceeds balance" },
          "X",
        ),
      ),
    ).toEqual({ kind: "revert", reason: "ERC20: transfer amount exceeds balance" });
    expect(
      classifySimulationError(rpcError({ code: 3, message: "execution reverted" }, "X")),
    ).toEqual({
      kind: "revert",
      reason: "execution reverted",
    });
  });

  it("keeps the raw data when the selector is not in the ABI", () => {
    const verdict = classifySimulationError(
      rpcError({ code: 3, message: "execution reverted", data: "0x12345678" }, "X"),
    );
    expect(verdict).toEqual({ kind: "revert", reason: "0x12345678", data: "0x12345678" });
  });

  it("reports a signer that cannot pay as a revert named InsufficientFunds", () => {
    const verdict = classifySimulationError(
      rpcError({ code: -32003, message: "Insufficient funds for gas * price + value" }, "X"),
    );
    expect(verdict).toEqual({ kind: "revert", reason: "InsufficientFunds" });
  });

  it.each([
    [
      "a network failure",
      Object.assign(new Error("HTTP request failed."), {
        name: "HttpRequestError",
        shortMessage: "HTTP request failed.",
        details: "fetch failed",
      }),
    ],
    [
      "a rate limit",
      rpcError({ code: -32005, message: "rate limit exceeded" }, "LimitExceededRpcError"),
    ],
    [
      "a timeout",
      Object.assign(new Error("The request took too long to respond."), { name: "TimeoutError" }),
    ],
    [
      "an internal node error",
      rpcError({ code: -32603, message: "internal error" }, "InternalRpcError"),
    ],
    ["a thrown string", "boom"],
    ["nothing at all", undefined],
  ])("treats %s as transient", (_label, error) => {
    expect(classifySimulationError(error).kind).toBe("transient");
  });
});

describe("classifyBroadcastError", () => {
  it.each([
    "nonce too low",
    "Nonce too low: next nonce 5, tx nonce 3",
    "already known",
    "transaction already imported",
    "Known transaction",
    "ALREADY_EXISTS: already known",
  ])("treats '%s' as already broadcast", (message) => {
    expect(
      classifyBroadcastError(rpcError({ code: -32003, message }, "TransactionRejectedRpcError")),
    ).toBe("already-broadcast");
  });

  it("recognises a refused replacement", () => {
    expect(
      classifyBroadcastError(
        rpcError({ code: -32000, message: "replacement transaction underpriced" }, "X"),
      ),
    ).toBe("underpriced");
  });

  it.each([
    "insufficient funds for gas * price + value",
    "fetch failed",
    "internal error",
    "nonce too high",
  ])("does not mistake '%s' for a broadcast that worked", (message) => {
    expect(classifyBroadcastError(rpcError({ code: -32000, message }, "X"))).toBe("other");
  });

  it("only reads the node's words, not the request viem echoes in its message", () => {
    // viem prints the request body in `message`; a call whose data spells a pattern must not match.
    const misleading = Object.assign(
      new Error('RPC Request failed.\n\nRequest body: {"params":["nonce too low"]}'),
      { name: "RpcRequestError", shortMessage: "RPC Request failed.", details: "fetch failed" },
    );
    expect(classifyBroadcastError(misleading)).toBe("other");
  });
});

describe("describeError", () => {
  it("says what the node said, without the RPC URL or its token", () => {
    const text = describeError(
      rpcError({ code: -32005, message: "rate limit exceeded" }, "LimitExceededRpcError"),
    );
    expect(text).toBe("LimitExceededRpcError: rate limit exceeded");
    expect(text).not.toContain("SECRET");
  });

  it("scrubs a URL even when the node's own words contain one", () => {
    const text = describeError(
      new Error("connect failed for https://rpc.example/v1/SECRET-TOKEN now"),
    );
    expect(text).toBe("connect failed for <url> now");
  });

  it("handles plain errors, strings and nothing", () => {
    expect(describeError(new TypeError("bad input"))).toBe("TypeError: bad input");
    expect(describeError("boom")).toBe("boom");
    expect(describeError(undefined)).toBe("unknown error");
  });

  it("truncates a very long message", () => {
    expect(describeError(new Error("x".repeat(5_000))).length).toBeLessThanOrEqual(301);
  });
});

describe("against a real node", () => {
  let anvil: AnvilInstance;

  beforeAll(async () => {
    anvil = await startAnvil();
  });
  afterAll(async () => {
    await anvil.stop();
  });

  it("classifies what anvil actually answers", async () => {
    const client = createPublicClient({ transport: http(anvil.rpcUrl) });
    const [deployer, other] = anvil.accounts;
    if (!deployer || !other) throw new Error("missing accounts");

    const deployHash = await sendDirect(client, deployer, anvil.chainId, {
      nonce: 0,
      data: testContractInitCode(),
    });
    const contract = (await receiptOf(client, deployHash)).contractAddress;
    if (!contract) throw new Error("not deployed");

    // A revert with a custom error of the ABI.
    const reverted = await client
      .call({ account: deployer.address, to: contract, data: REVERTING_CALL_DATA })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(reverted).toBeInstanceOf(BaseError);
    expect(classifySimulationError(reverted)).toMatchObject({
      kind: "revert",
      reason: "SalesArePaused",
    });
    const estimate = await client
      .estimateGas({ account: deployer.address, to: contract, data: REVERTING_CALL_DATA })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(classifySimulationError(estimate)).toMatchObject({
      kind: "revert",
      reason: "SalesArePaused",
    });
    // Positive control: the same contract accepts another call.
    await expect(
      client.call({ account: deployer.address, to: contract, data: "0x" }),
    ).resolves.toBeDefined();

    // More value than the signer owns.
    const broke = await client
      .call({ account: deployer.address, to: other.address, value: 10n ** 30n })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(classifySimulationError(broke)).toEqual({ kind: "revert", reason: "InsufficientFunds" });

    // The same bytes sent again once mined: nonce too low.
    const raw = await deployer.signTransaction({
      type: "eip1559",
      chainId: anvil.chainId,
      nonce: 1,
      gas: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: other.address,
    });
    await receiptOf(client, await client.sendRawTransaction({ serializedTransaction: raw }));
    const again = await client.sendRawTransaction({ serializedTransaction: raw }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(classifyBroadcastError(again)).toBe("already-broadcast");

    // The same bytes sent twice while pending: already imported.
    await anvil.rpc("evm_setAutomine", [false]);
    const pendingRaw = await deployer.signTransaction({
      type: "eip1559",
      chainId: anvil.chainId,
      nonce: 2,
      gas: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: other.address,
    });
    await client.sendRawTransaction({ serializedTransaction: pendingRaw });
    const pendingAgain = await client
      .sendRawTransaction({ serializedTransaction: pendingRaw })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(classifyBroadcastError(pendingAgain)).toBe("already-broadcast");

    // No receipt yet.
    const missing = await client.getTransactionReceipt({ hash: keccak256(pendingRaw) }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isReceiptNotFound(missing)).toBe(true);
    expect(isReceiptNotFound(again)).toBe(false);

    // A node that is not there.
    const dead = createPublicClient({ transport: http("http://127.0.0.1:1", { retryCount: 0 }) });
    const unreachable = await dead.getChainId().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(classifySimulationError(unreachable).kind).toBe("transient");
    expect(classifyBroadcastError(unreachable)).toBe("other");
    expect(describeError(unreachable)).not.toMatch(/127\.0\.0\.1/);
  });

  it("uses a selector that really is the ABI's", () => {
    const selector: Hex = keccak256(toHex("SalesArePaused()")).slice(0, 10) as Hex;
    expect(decodeRevertData(selector)).toBe("SalesArePaused");
  });
});
