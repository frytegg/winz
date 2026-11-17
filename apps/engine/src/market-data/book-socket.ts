import { readFileSync } from "node:fs";
import http from "node:http";
import type { Socket, createConnection as netCreateConnection } from "node:net";
import tls from "node:tls";

import WebSocket from "ws";

import { describeError } from "./errors";

/** Gemini public market-data WebSocket (no key). */
export const GEMINI_WS_URL = "wss://ws.gemini.com";

/** What the transport receives from a socket. Frames are delivered as text. */
export interface BookSocketHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** A ping or pong frame: proof the connection is alive, with no data. */
  onHeartbeat(): void;
  onClose(code: number, reason: string): void;
  onError(error: unknown): void;
}

/** The part of a WebSocket the transport uses. `onClose` is called exactly once per socket. */
export interface BookSocket {
  send(text: string): void;
  /** Closes the connection; `onClose` follows. */
  close(): void;
}

export type BookSocketFactory = (handlers: BookSocketHandlers) => BookSocket;

export interface WsBookSocketOptions {
  url?: string;
  /**
   * An HTTP proxy that tunnels with CONNECT, e.g. "http://127.0.0.1:3128". Unset on a host with
   * direct egress (Railway); set where outbound traffic must go through a proxy.
   */
  proxyUrl?: string;
  /** Extra CA bundle (PEM file) for a TLS-intercepting proxy. */
  caFile?: string;
  /** Opening handshake timeout. */
  handshakeTimeoutMs?: number;
}

/** Raised when the CONNECT tunnel through the proxy cannot be opened. */
export class ProxyTunnelError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProxyTunnelError";
  }
}

/** A `BookSocketFactory` on the `ws` package, optionally through a CONNECT proxy. */
export function wsBookSocketFactory(options: WsBookSocketOptions = {}): BookSocketFactory {
  const url = new URL(options.url ?? GEMINI_WS_URL);
  const ca = options.caFile === undefined ? undefined : readFileSync(options.caFile);
  const handshakeTimeout = options.handshakeTimeoutMs ?? 10_000;
  return (handlers) => new WsBookSocket(url, handlers, options.proxyUrl, ca, handshakeTimeout);
}

class WsBookSocket implements BookSocket {
  private socket: WebSocket | null = null;
  private closedByCaller = false;
  private closeReported = false;

  constructor(
    private readonly url: URL,
    private readonly handlers: BookSocketHandlers,
    proxyUrl: string | undefined,
    private readonly ca: Buffer | undefined,
    private readonly handshakeTimeout: number,
  ) {
    if (proxyUrl === undefined) {
      this.attach(new WebSocket(url, { handshakeTimeout, ...(ca ? { ca } : {}) }));
      return;
    }
    openTunnel(new URL(proxyUrl), url, handshakeTimeout)
      .then((raw) => {
        if (this.closedByCaller) {
          raw.destroy();
          this.reportClose(1000, "closed before open");
          return;
        }
        // wss (Gemini) runs TLS inside the tunnel; plain ws (a local test server) uses it as is.
        const stream =
          url.protocol === "ws:"
            ? raw
            : tls.connect({
                socket: raw,
                servername: url.hostname,
                ...(ca ? { ca } : {}),
              });
        // ws types `createConnection` as net.createConnection; any function returning a Duplex works.
        const createConnection = (() => stream) as unknown as typeof netCreateConnection;
        this.attach(new WebSocket(url, { handshakeTimeout, createConnection }));
      })
      .catch((error: unknown) => {
        this.handlers.onError(error);
        this.reportClose(1006, describeError(error));
      });
  }

  send(text: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(text);
  }

  close(): void {
    this.closedByCaller = true;
    const socket = this.socket;
    if (socket === null) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000);
      // A peer that never answers the close frame must not keep the socket alive.
      setTimeout(() => {
        socket.terminate();
      }, 2_000).unref();
    } else {
      socket.terminate();
    }
  }

  private attach(socket: WebSocket): void {
    this.socket = socket;
    socket.on("open", () => {
      this.handlers.onOpen();
    });
    socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        this.handlers.onError(new Error("binary frame received, ignored"));
        return;
      }
      this.handlers.onMessage(rawDataToString(data));
    });
    // `ws` answers server pings by itself; both directions count as liveness.
    socket.on("ping", () => {
      this.handlers.onHeartbeat();
    });
    socket.on("pong", () => {
      this.handlers.onHeartbeat();
    });
    socket.on("error", (error: Error) => {
      this.handlers.onError(error);
    });
    socket.on("close", (code: number, reason: Buffer) => {
      this.reportClose(code, reason.toString("utf8"));
    });
  }

  private reportClose(code: number, reason: string): void {
    if (this.closeReported) return;
    this.closeReported = true;
    this.handlers.onClose(code, reason);
  }
}

function rawDataToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

/** Opens a raw TCP tunnel to `target` through an HTTP CONNECT proxy. */
function openTunnel(proxy: URL, target: URL, timeoutMs: number): Promise<Socket> {
  const port = target.port !== "" ? target.port : target.protocol === "ws:" ? "80" : "443";
  const authority = `${target.hostname}:${port}`;
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.hostname,
      port: proxy.port === "" ? 80 : Number(proxy.port),
      method: "CONNECT",
      path: authority,
      headers: { host: authority },
      timeout: timeoutMs,
    });
    request.once("connect", (response: http.IncomingMessage, socket: Socket) => {
      if (response.statusCode === 200) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(
        new ProxyTunnelError(
          `proxy refused CONNECT ${authority}: HTTP ${String(response.statusCode)}`,
        ),
      );
    });
    request.once("timeout", () => {
      request.destroy(new ProxyTunnelError(`proxy CONNECT ${authority} timed out`));
    });
    request.once("error", (error: Error) => {
      reject(
        error instanceof ProxyTunnelError
          ? error
          : new ProxyTunnelError(`proxy CONNECT ${authority} failed`, { cause: error }),
      );
    });
    request.end();
  });
}
