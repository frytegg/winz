import { createPublicClient, custom, parseAbi, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { explicitLogRange, withExplicitToBlock } from "./log-range";

const ESCROW: Address = "0x81d2d4050E617184b2B832c30BE68f8811b37D2c";

describe("withExplicitToBlock", () => {
  it("writes toBlock latest into a filter that names none", () => {
    const args = { method: "eth_getLogs", params: [{ address: ESCROW, fromBlock: "0x10" }] };
    expect(withExplicitToBlock(args)).toEqual({
      method: "eth_getLogs",
      params: [{ address: ESCROW, fromBlock: "0x10", toBlock: "latest" }],
    });
    // The caller's arguments are left as they were.
    expect(args.params[0]).toEqual({ address: ESCROW, fromBlock: "0x10" });
  });

  it("treats a null or undefined toBlock as missing", () => {
    for (const toBlock of [null, undefined]) {
      const out = withExplicitToBlock({
        method: "eth_getLogs",
        params: [{ fromBlock: "0x10", toBlock }],
      });
      expect(out.params).toEqual([{ fromBlock: "0x10", toBlock: "latest" }]);
    }
  });

  it("keeps the topics and every other field of the filter", () => {
    const filter = { address: ESCROW, topics: [["0xaa"], null, "0xbb"], fromBlock: "0x1" };
    const out = withExplicitToBlock({ method: "eth_getLogs", params: [filter] });
    expect(out.params).toEqual([{ ...filter, toBlock: "latest" }]);
  });

  it("leaves a filter that names its toBlock as it is", () => {
    for (const toBlock of ["0x20", "latest", "finalized"]) {
      const args = { method: "eth_getLogs", params: [{ fromBlock: "0x10", toBlock }] };
      expect(withExplicitToBlock(args)).toBe(args);
    }
  });

  it("leaves a filter by block hash as it is: it has no range", () => {
    const args = { method: "eth_getLogs", params: [{ blockHash: `0x${"11".repeat(32)}` }] };
    expect(withExplicitToBlock(args)).toBe(args);
  });

  it("leaves every other request, and a malformed one, as it is", () => {
    const others = [
      { method: "eth_blockNumber" },
      { method: "eth_call", params: [{ to: ESCROW, data: "0x" }, "latest"] },
      { method: "eth_newFilter", params: [{ fromBlock: "0x10" }] },
      { method: "eth_getLogs" },
      { method: "eth_getLogs", params: [] },
      { method: "eth_getLogs", params: ["not a filter"] },
      { method: "eth_getLogs", params: { fromBlock: "0x10" } },
    ];
    for (const args of others) expect(withExplicitToBlock(args)).toBe(args);
  });
});

describe("explicitLogRange", () => {
  /** A node that records what it is asked and answers no log, block 100. */
  function recordingClient(): {
    client: ReturnType<typeof createPublicClient>;
    seen: { method: string; params: unknown }[];
  } {
    const seen: { method: string; params: unknown }[] = [];
    const provider = {
      request: ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
        seen.push({ method, params });
        if (method === "eth_getLogs") return Promise.resolve([]);
        if (method === "eth_blockNumber") return Promise.resolve("0x64");
        return Promise.reject(new Error(`unexpected ${method}`));
      },
    };
    const client = createPublicClient({
      transport: explicitLogRange(custom(provider, { retryCount: 0 })),
    });
    return { client, seen };
  }

  const abi = parseAbi([
    "event HedgeCharged(uint256 indexed ticketId, uint64 indexed id, uint128 amount)",
  ]);

  it("gives an open-ended getLogs of viem its toBlock", async () => {
    const { client, seen } = recordingClient();
    await client.getLogs({ address: ESCROW, fromBlock: 16n });
    expect(seen).toEqual([
      {
        method: "eth_getLogs",
        params: [{ address: ESCROW, fromBlock: "0x10", toBlock: "latest", topics: [] }],
      },
    ]);
  });

  it("gives an open-ended getContractEvents its toBlock and keeps its topics", async () => {
    const { client, seen } = recordingClient();
    await client.getContractEvents({
      address: ESCROW,
      abi,
      eventName: "HedgeCharged",
      args: { id: 3n },
      fromBlock: 16n,
    });
    expect(seen).toHaveLength(1);
    const filter = (seen[0]?.params as Record<string, unknown>[])[0];
    expect(filter?.toBlock).toBe("latest");
    expect(filter?.fromBlock).toBe("0x10");
    expect(Array.isArray(filter?.topics)).toBe(true);
    expect((filter?.topics as unknown[]).length).toBe(3);
  });

  it("leaves a bounded getLogs and every other request untouched", async () => {
    const { client, seen } = recordingClient();
    await client.getLogs({ address: ESCROW, fromBlock: 16n, toBlock: 32n });
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(100n);
    expect(seen).toEqual([
      {
        method: "eth_getLogs",
        params: [{ address: ESCROW, fromBlock: "0x10", toBlock: "0x20", topics: [] }],
      },
      { method: "eth_blockNumber", params: undefined },
    ]);
  });

  it("keeps the transport's own configuration", () => {
    const inner = custom(
      { request: (): Promise<unknown> => Promise.resolve(null) },
      { retryCount: 7, retryDelay: 123, name: "probe" },
    );
    const plain = inner({});
    const wrapped = explicitLogRange(inner)({});
    expect(wrapped.config).toEqual({ ...plain.config, request: wrapped.config.request });
    expect(wrapped.config.retryCount).toBe(7);
    expect(wrapped.config.name).toBe("probe");
    expect(wrapped.value).toEqual(plain.value);
  });
});
