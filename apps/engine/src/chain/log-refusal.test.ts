import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createArcClients, LOG_REFUSAL_WARN_EVERY_MS, warnOnLogRefusals } from "./clients";
import { FakeRpcNode } from "./fake-rpc-node";
import { capturingLogger } from "./ingest-test-support";
import { classifyRpcRefusal } from "./rpc-errors";

const ESCROW = "0x81d2d4050E617184b2B832c30BE68f8811b37D2c";
/** The path of a QuickNode URL is its access token: it must never reach a log. */
const TOKEN_PATH = "/secret-token-0123456789abcdef/";
/**
 * QuickNode's refusal of an `eth_getLogs` over its plan's block range: code -32602, as its
 * support article says; the wording follows its documentation ("limited to a 5 blocks range" on
 * the Free plan). Not a recorded answer: no request was sent to QuickNode for this test.
 */
const QUICKNODE_REFUSAL = { code: -32602, message: "eth_getLogs is limited to a 5 blocks range" };
/** Keys of no account anyone uses: the clients need two, the test signs nothing. */
const RELAYER_KEY = `0x${"11".repeat(32)}`;
const ORACLE_KEY = `0x${"22".repeat(32)}`;

/** A node that answers its chain id and refuses every `eth_getLogs` like QuickNode's Free plan. */
async function refusingNode(): Promise<{ url: string; server: Server; getLogs: () => number }> {
  let getLogs = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const call = JSON.parse(body) as { id: number; method: string };
      const answer =
        call.method === "eth_getLogs"
          ? ((getLogs += 1), { jsonrpc: "2.0", id: call.id, error: QUICKNODE_REFUSAL })
          : { jsonrpc: "2.0", id: call.id, result: "0x4cef52" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port.toString()}${TOKEN_PATH}`,
    server,
    getLogs: () => getLogs,
  };
}

describe("a primary node that refuses eth_getLogs while the fallback serves them", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it("is reported at WARN, naming the node by variable and host, never its path", async () => {
    const primary = await refusingNode();
    closers.push(() => new Promise((resolve) => primary.server.close(() => resolve())));
    const fallback = new FakeRpcNode({ head: 500n, chainId: 5_042_002 });
    const fallbackUrl = await fallback.listen();
    closers.push(() => fallback.close());
    const { logger, entries } = capturingLogger();
    const clients = createArcClients(
      {
        ARC_CHAIN_ID: 5_042_002,
        ARC_RPC_URL: primary.url,
        ARC_RPC_FALLBACK_URL: fallbackUrl,
        ARC_RELAYER_PRIVATE_KEY: RELAYER_KEY,
        ARC_ORACLE_PRIVATE_KEY: ORACLE_KEY,
      },
      { retryCount: 0, logger },
    );
    closers.push(() => Promise.resolve(clients.limiter?.close()));

    for (let poll = 0; poll < 3; poll += 1) {
      await clients.publicClient.getLogs({ address: ESCROW, fromBlock: 480n, toBlock: 490n });
    }
    // The logs were served, by the fallback.
    expect(primary.getLogs()).toBe(3);
    expect(fallback.callsOf("eth_getLogs")).toHaveLength(3);

    const warnings = entries.filter(
      (entry) => entry.level === 40 && String(entry.msg).includes("eth_getLogs"),
    );
    // Once, not once per poll.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      node: "ARC_RPC_URL",
      host: new URL(primary.url).host,
      servedBy: "ARC_RPC_FALLBACK_URL",
      refusal: "too-large",
    });
    expect(String(warnings[0]?.msg)).toContain("ARC_RPC_FALLBACK_URL serves the escrow's logs");
    expect(JSON.stringify(entries)).not.toContain("secret-token");
  });

  it("stays quiet while the primary serves the logs (positive control)", async () => {
    const primary = new FakeRpcNode({ head: 500n, chainId: 5_042_002 });
    const primaryUrl = await primary.listen();
    closers.push(() => primary.close());
    const fallback = new FakeRpcNode({ head: 500n, chainId: 5_042_002 });
    const fallbackUrl = await fallback.listen();
    closers.push(() => fallback.close());
    const { logger, entries } = capturingLogger();
    const clients = createArcClients(
      {
        ARC_CHAIN_ID: 5_042_002,
        ARC_RPC_URL: primaryUrl,
        ARC_RPC_FALLBACK_URL: fallbackUrl,
        ARC_RELAYER_PRIVATE_KEY: RELAYER_KEY,
        ARC_ORACLE_PRIVATE_KEY: ORACLE_KEY,
      },
      { retryCount: 0, logger },
    );
    closers.push(() => Promise.resolve(clients.limiter?.close()));
    await clients.publicClient.getLogs({ address: ESCROW, fromBlock: 480n, toBlock: 490n });
    expect(fallback.callsOf("eth_getLogs")).toHaveLength(0);
    expect(entries.filter((entry) => Number(entry.level) >= 40)).toEqual([]);
  });

  it("warns again after LOG_REFUSAL_WARN_EVERY_MS, with the count of refusals since", async () => {
    const { logger, entries } = capturingLogger();
    let clock = 0;
    const failing = warnOnLogRefusals(
      (() => ({
        config: {
          key: "x",
          name: "x",
          request: () => Promise.reject(new Error("x")),
          retryCount: 0,
          type: "x",
        },
        request: () => Promise.reject(Object.assign(new Error("refused"), QUICKNODE_REFUSAL)),
        value: undefined,
      })) as unknown as Parameters<typeof warnOnLogRefusals>[0],
      {
        variable: "ARC_RPC_URL",
        url: "https://node.test/t/",
        next: { variable: "ARC_RPC_FALLBACK_URL", url: "https://rpc.test" },
      },
      logger,
      () => clock,
    );
    const { request } = failing({});
    const getLogs = (): Promise<unknown> =>
      (request as (args: { method: string }) => Promise<unknown>)({ method: "eth_getLogs" }).catch(
        () => undefined,
      );
    await getLogs();
    clock += LOG_REFUSAL_WARN_EVERY_MS - 1;
    await getLogs();
    await getLogs();
    clock += 1;
    await getLogs();
    await (request as (args: { method: string }) => Promise<unknown>)({ method: "eth_call" }).catch(
      () => undefined,
    );
    expect(entries.filter((entry) => entry.level === 40).map((entry) => entry.refusals)).toEqual([
      1, 3,
    ]);
  });

  it("reads QuickNode's 'blocks range' wording as a size refusal", () => {
    expect(classifyRpcRefusal(Object.assign(new Error("x"), QUICKNODE_REFUSAL))).toBe("too-large");
    expect(
      classifyRpcRefusal({
        code: -32602,
        message: "eth_getLogs is limited to a 10,000 blocks range",
      }),
    ).toBe("too-large");
  });
});
