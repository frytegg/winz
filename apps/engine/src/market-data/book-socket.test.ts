import { createHash } from "node:crypto";
import http from "node:http";
import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  ProxyTunnelError,
  wsBookSocketFactory,
  type BookSocket,
  type BookSocketHandlers,
} from "./book-socket";

// Everything here runs on loopback servers: no network.

interface Recorded {
  handlers: BookSocketHandlers;
  opens: number;
  messages: string[];
  heartbeats: number;
  closes: { code: number; reason: string }[];
  errors: unknown[];
}

function recordHandlers(): Recorded {
  const recorded: Recorded = {
    opens: 0,
    messages: [],
    heartbeats: 0,
    closes: [],
    errors: [],
    handlers: {
      onOpen: () => {
        recorded.opens += 1;
      },
      onMessage: (text) => {
        recorded.messages.push(text);
      },
      onHeartbeat: () => {
        recorded.heartbeats += 1;
      },
      onClose: (code, reason) => {
        recorded.closes.push({ code, reason });
      },
      onError: (error) => {
        recorded.errors.push(error);
      },
    },
  };
  return recorded;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function trackSockets(server: http.Server | net.Server): Set<net.Socket> {
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket: net.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return sockets;
}

function closeServer(server: http.Server, sockets: Set<net.Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

interface EchoServer {
  url: string;
  port: number;
  /** Server side of each accepted connection, in order. */
  peers: WebSocket[];
  received: string[];
}

/** A local ws server that records what it receives. */
async function startWsServer(): Promise<EchoServer> {
  const server = http.createServer();
  const sockets = trackSockets(server);
  const wss = new WebSocketServer({ server });
  const result: EchoServer = { url: "", port: 0, peers: [], received: [] };
  wss.on("connection", (peer: WebSocket) => {
    result.peers.push(peer);
    peer.on("message", (data: RawData) => {
      result.received.push(String(data));
    });
  });
  result.port = await listen(server);
  result.url = `ws://127.0.0.1:${result.port.toString()}`;
  cleanups.push(async () => {
    for (const peer of wss.clients) peer.terminate();
    wss.close();
    await closeServer(server, sockets);
  });
  return result;
}

interface ConnectProxy {
  url: string;
  /** Authority of every CONNECT request seen. */
  connects: string[];
}

/** A local HTTP CONNECT proxy: tunnels, refuses with a status, or holds the answer back. */
async function startProxy(behaviour: {
  refuseWith?: number;
  delayMs?: number;
}): Promise<ConnectProxy> {
  const server = http.createServer();
  const sockets = trackSockets(server);
  const upstreams = new Set<net.Socket>();
  const result: ConnectProxy = { url: "", connects: [] };
  server.on("connect", (request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    result.connects.push(request.url ?? "");
    sockets.add(client);
    if (behaviour.refuseWith !== undefined) {
      client.end(`HTTP/1.1 ${behaviour.refuseWith.toString()} Refused\r\n\r\n`);
      return;
    }
    const [host, port] = (request.url ?? "").split(":");
    const tunnel = (): void => {
      const upstream = net.connect(Number(port), host ?? "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstreams.add(upstream);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      upstream.once("close", () => upstreams.delete(upstream));
    };
    if (behaviour.delayMs === undefined) tunnel();
    else setTimeout(tunnel, behaviour.delayMs);
  });
  const port = await listen(server);
  result.url = `http://127.0.0.1:${port.toString()}`;
  cleanups.push(async () => {
    for (const upstream of upstreams) upstream.destroy();
    await closeServer(server, sockets);
  });
  return result;
}

/** A server that completes the WebSocket handshake and then ignores everything, close frames included. */
async function startDeafServer(): Promise<string> {
  const server = http.createServer();
  const sockets = trackSockets(server);
  server.on("upgrade", (request: http.IncomingMessage, socket: net.Socket) => {
    const key = String(request.headers["sec-websocket-key"]);
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on("data", () => undefined);
    socket.on("error", () => undefined);
  });
  const port = await listen(server);
  cleanups.push(async () => {
    await closeServer(server, sockets);
  });
  return `ws://127.0.0.1:${port.toString()}`;
}

function openSocket(
  recorded: Recorded,
  options: Parameters<typeof wsBookSocketFactory>[0],
): BookSocket {
  const socket = wsBookSocketFactory({ handshakeTimeoutMs: 2_000, ...options })(recorded.handlers);
  cleanups.push(async () => {
    socket.close();
    await vi.waitFor(() => {
      expect(recorded.closes.length).toBeGreaterThan(0);
    });
  });
  return socket;
}

describe("wsBookSocketFactory", () => {
  it("connects directly: open, text frames both ways, server pings as heartbeats, one close", async () => {
    const server = await startWsServer();
    const recorded = recordHandlers();
    const socket = openSocket(recorded, { url: server.url });
    await vi.waitFor(() => {
      expect(recorded.opens).toBe(1);
    });
    socket.send('{"method":"subscribe"}');
    const peer = server.peers[0];
    peer?.send('{"lastUpdateId":1}');
    peer?.ping();
    await vi.waitFor(() => {
      expect(recorded.messages).toEqual(['{"lastUpdateId":1}']);
      expect(recorded.heartbeats).toBe(1);
      expect(server.received).toEqual(['{"method":"subscribe"}']);
    });
    socket.close();
    await vi.waitFor(() => {
      expect(recorded.closes).toEqual([{ code: 1000, reason: "" }]);
    });
    expect(recorded.errors).toEqual([]);
  });

  it("reports a binary frame as an error and delivers no message", async () => {
    const server = await startWsServer();
    const recorded = recordHandlers();
    openSocket(recorded, { url: server.url });
    await vi.waitFor(() => {
      expect(recorded.opens).toBe(1);
    });
    server.peers[0]?.send(Buffer.from([1, 2, 3]), { binary: true });
    await vi.waitFor(() => {
      expect(recorded.errors).toHaveLength(1);
    });
    expect(recorded.messages).toEqual([]);
  });

  it("tunnels through an HTTP CONNECT proxy", async () => {
    const server = await startWsServer();
    const proxy = await startProxy({});
    const recorded = recordHandlers();
    const socket = openSocket(recorded, { url: server.url, proxyUrl: proxy.url });
    await vi.waitFor(() => {
      expect(recorded.opens).toBe(1);
    });
    expect(proxy.connects).toEqual([`127.0.0.1:${server.port.toString()}`]);
    server.peers[0]?.send("hello");
    socket.send("world");
    await vi.waitFor(() => {
      expect(recorded.messages).toEqual(["hello"]);
      expect(server.received).toEqual(["world"]);
    });
  });

  it("reports a refused CONNECT as a ProxyTunnelError and closes once with 1006", async () => {
    const proxy = await startProxy({ refuseWith: 403 });
    const recorded = recordHandlers();
    openSocket(recorded, { url: "ws://127.0.0.1:9", proxyUrl: proxy.url });
    await vi.waitFor(() => {
      expect(recorded.closes).toHaveLength(1);
    });
    expect(recorded.closes[0]?.code).toBe(1006);
    expect(recorded.closes[0]?.reason).toContain("HTTP 403");
    expect(recorded.errors).toHaveLength(1);
    expect(recorded.errors[0]).toBeInstanceOf(ProxyTunnelError);
    expect(recorded.opens).toBe(0);
  });

  it("closed before the proxy tunnel opens: one close, never an open", async () => {
    const server = await startWsServer();
    const proxy = await startProxy({ delayMs: 100 });
    const recorded = recordHandlers();
    const socket = openSocket(recorded, { url: server.url, proxyUrl: proxy.url });
    socket.close();
    await vi.waitFor(() => {
      expect(recorded.closes).toEqual([{ code: 1000, reason: "closed before open" }]);
    });
    // Give the tunnel time to complete: nothing more is reported.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(recorded.closes).toHaveLength(1);
    expect(recorded.opens).toBe(0);
    expect(server.peers).toHaveLength(0);
  });

  it("closed before a direct handshake completes: one close, never an open", async () => {
    const server = await startWsServer();
    const recorded = recordHandlers();
    const socket = openSocket(recorded, { url: server.url });
    socket.close();
    await vi.waitFor(() => {
      expect(recorded.closes).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(recorded.closes).toHaveLength(1);
    expect(recorded.opens).toBe(0);
  });

  it("terminates a peer that never answers the close frame within about 2 s", async () => {
    const url = await startDeafServer();
    const recorded = recordHandlers();
    const socket = openSocket(recorded, { url });
    await vi.waitFor(() => {
      expect(recorded.opens).toBe(1);
    });
    const closedAtMs = Date.now();
    socket.close();
    await vi.waitFor(
      () => {
        expect(recorded.closes).toHaveLength(1);
      },
      { timeout: 4_000 },
    );
    const elapsedMs = Date.now() - closedAtMs;
    expect(elapsedMs).toBeGreaterThanOrEqual(1_900);
    expect(elapsedMs).toBeLessThan(3_500);
    expect(recorded.closes[0]?.code).toBe(1006);
  }, 10_000);
});
