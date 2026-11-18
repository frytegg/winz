#!/usr/bin/env node
// Records real QuickNode Streams deliveries as fixture files (task S-04, docs/quicknode.md).
//
//   QUICKNODE_STREAMS_TOKEN=… pnpm quicknode:record --port 8787 --out apps/engine/fixtures/quicknode
//
// Listens for POSTs, verifies each delivery's signature with the stream's security token read
// from the environment (x-qn-nonce + x-qn-timestamp + the uncompressed body, HMAC-SHA256, hex),
// writes every verified delivery to <out> as one JSON file (format in
// apps/engine/fixtures/quicknode/README.md) WITHOUT the token, prints the delay between each
// block's time and the reception, and answers 200. A delivery whose signature does not verify is
// answered 401 and not written. Plain Node, no dependency. Never prints the token or a signature.
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

/** Same limit as the route (apps/web/lib/server/quicknode-webhook.ts). */
export const MAX_DELIVERY_BYTES = 4 * 1024 * 1024;
export const FIXTURE_FORMAT = "winz.quicknode-delivery.v1";

/** Headers kept in a fixture: what verifies it, how it is encoded, and the stream's metadata. */
const KEPT_HEADERS = /^(x-qn-|stream-|batch-|content-type$|content-encoding$|user-agent$)/;

export function sign(token, nonce, timestamp, payload) {
  return createHmac("sha256", token)
    .update(nonce, "utf8")
    .update(timestamp, "utf8")
    .update(payload)
    .digest("hex");
}

function matches(token, nonce, timestamp, payload, signature) {
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(sign(token, nonce, timestamp, payload), "hex"),
    Buffer.from(signature, "hex"),
  );
}

/** The uncompressed payload: gzip bodies are inflated (QuickNode signs the uncompressed JSON). */
export function inflate(raw, contentEncoding) {
  const gzipped = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  if (
    !String(contentEncoding ?? "")
      .toLowerCase()
      .includes("gzip") ||
    !gzipped
  )
    return raw;
  return gunzipSync(raw, { maxOutputLength: MAX_DELIVERY_BYTES });
}

/**
 * Whether the headers' signature is the token's over the payload. The compressed bytes are tried
 * too, in case QuickNode ever signs what it sends; the fixture says which one matched.
 */
export function verify(token, headers, raw, payload) {
  const nonce = headers["x-qn-nonce"];
  const timestamp = headers["x-qn-timestamp"];
  const signature = headers["x-qn-signature"];
  if (typeof nonce !== "string" || typeof timestamp !== "string" || typeof signature !== "string") {
    return null;
  }
  if (matches(token, nonce, timestamp, payload, signature)) return "uncompressed";
  if (payload !== raw && matches(token, nonce, timestamp, raw, signature)) return "compressed";
  return null;
}

function quantity(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * Block number and time of every block the payload carries a time for: a log's
 * `blockTimestamp`, or a `block_with_receipts` block's `timestamp`. Walks any shape.
 */
export function blockTimes(payload) {
  const times = new Map();
  const visit = (node, depth) => {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const number = quantity(node.blockNumber ?? node.number);
    const timestamp = quantity(node.blockTimestamp ?? node.timestamp);
    if (number !== null && timestamp !== null) times.set(number, timestamp);
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(payload, 0);
  return [...times.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([block, seconds]) => ({
      block: block.toString(),
      time: new Date(Number(seconds) * 1000),
    }));
}

/** The fixture file of one verified delivery. Never holds the token. */
export function fixtureOf({ receivedAt, method, path, headers, raw, payload, signedOver }) {
  const kept = Object.fromEntries(
    Object.entries(headers)
      .filter(([name, value]) => KEPT_HEADERS.test(name) && typeof value === "string")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  let parsed = null;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    // Recorded as it came; the replay test will say it is not JSON.
  }
  const blocks = parsed === null ? [] : blockTimes(parsed);
  const metadata =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed.metadata
      : null;
  return {
    format: FIXTURE_FORMAT,
    receivedAt: receivedAt.toISOString(),
    method,
    path,
    headers: kept,
    signatureVerified: true,
    signedOver,
    bodyEncoding: "base64",
    body: raw.toString("base64"),
    bodyBytes: raw.length,
    inflatedBytes: payload.length,
    network: metadata?.network ?? kept["stream-network"] ?? null,
    blocks: blocks.map(({ block, time }) => ({
      block,
      time: time.toISOString(),
      delayMs: receivedAt.getTime() - time.getTime(),
    })),
  };
}

function fileName(fixture) {
  const stamp = fixture.receivedAt.replace(/[:.]/g, "-");
  const range =
    fixture.blocks.length === 0
      ? "no-block-time"
      : `${fixture.blocks[0].block}-${fixture.blocks[fixture.blocks.length - 1].block}`;
  return `delivery-${stamp}-${range}.json`;
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_DELIVERY_BYTES) {
        reject(new Error("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function answer(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/**
 * Starts the recorder. Resolves with the server once it listens; `onRecorded(fixture, file)` is
 * called after each file is written. `print` receives each line meant for the operator.
 */
export function startRecorder({
  port,
  host,
  out,
  token,
  print,
  onRecorded,
  now = () => new Date(),
}) {
  mkdirSync(out, { recursive: true });
  const server = createServer((request, response) => {
    const receivedAt = now();
    if (request.method !== "POST") {
      answer(response, 405, { error: "POST only" });
      return;
    }
    readBody(request).then(
      (raw) => {
        let payload;
        try {
          payload = inflate(raw, request.headers["content-encoding"]);
        } catch {
          print(
            `${receivedAt.toISOString()} refused: body is not valid gzip or too large once inflated`,
          );
          answer(response, 400, { error: "invalid body" });
          return;
        }
        const signedOver = verify(token, request.headers, raw, payload);
        if (signedOver === null) {
          print(
            `${receivedAt.toISOString()} refused: signature missing or not verified, nothing written`,
          );
          answer(response, 401, { error: "invalid signature" });
          return;
        }
        const fixture = fixtureOf({
          receivedAt,
          method: request.method,
          path: request.url ?? "/",
          headers: request.headers,
          raw,
          payload,
          signedOver,
        });
        const file = join(out, fileName(fixture));
        writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
        print(
          `${receivedAt.toISOString()} delivery verified (signed over the ${signedOver} body), ` +
            `${raw.length.toString()} bytes, network ${String(fixture.network)}, written to ${file}`,
        );
        if (fixture.blocks.length === 0) {
          print("  no block time in the payload: the delay cannot be measured from it");
        }
        for (const block of fixture.blocks) {
          print(
            `  block ${block.block} at ${block.time}: received ${block.delayMs.toString()} ms later`,
          );
        }
        answer(response, 200, { received: true });
        onRecorded?.(fixture, file);
      },
      () => {
        print(
          `${receivedAt.toISOString()} refused: body larger than ${MAX_DELIVERY_BYTES.toString()} bytes`,
        );
        answer(response, 413, { error: "too large" });
      },
    );
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveServer(server));
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: "string" },
      out: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      once: { type: "boolean", default: false },
    },
  });
  const port = Number(values.port);
  const problems = [];
  if (values.port === undefined || !Number.isInteger(port) || port < 0 || port > 65_535) {
    problems.push("--port <n> is required (0 to 65535)");
  }
  if (values.out === undefined || values.out === "") problems.push("--out <dir> is required");
  const token = (process.env.QUICKNODE_STREAMS_TOKEN ?? "").trim();
  if (token === "")
    problems.push("QUICKNODE_STREAMS_TOKEN is not set (the stream's security token)");
  if (problems.length > 0) {
    console.error(
      `quicknode:record: ${problems.join("; ")}\n` +
        "usage: QUICKNODE_STREAMS_TOKEN=… pnpm quicknode:record --port <n> --out <dir> [--host 127.0.0.1] [--once]",
    );
    process.exitCode = 2;
    return;
  }
  const out = resolve(values.out);
  const server = await startRecorder({
    port,
    host: values.host,
    out,
    token,
    print: (line) => console.log(line),
    onRecorded: () => {
      if (values.once) server.close();
    },
  });
  const address = server.address();
  console.log(
    `quicknode:record listening on http://${values.host}:${String(address.port)}, writing to ${out}` +
      (values.once ? " (stops after the first verified delivery)" : " (Ctrl-C to stop)"),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      `quicknode:record failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
