// Tests for scripts/quicknode-record.mjs. Run with: node --test scripts/quicknode-record.test.mjs
// Each case starts the real recorder on a free local port and a throwaway directory, posts to it
// over HTTP, and reads what it wrote.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { FIXTURE_FORMAT, sign, startRecorder } from "./quicknode-record.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "quicknode-record.mjs");
const TOKEN = "qn-record-test-token-not-a-secret";
const sandboxes = [];
const servers = [];
after(() => {
  for (const server of servers) server.close();
  for (const directory of sandboxes) rmSync(directory, { recursive: true, force: true });
});

const BLOCK_SECONDS = 1_763_467_200;
const RECEIVED = new Date((BLOCK_SECONDS + 2) * 1000 + 345);
const DELIVERY = JSON.stringify({
  data: [
    [
      {
        address: "0x81d2d4050e617184b2b832c30be68f8811b37d2c",
        topics: [`0x${"11".repeat(32)}`],
        data: "0x",
        blockNumber: "0x455c2b6",
        blockTimestamp: `0x${BLOCK_SECONDS.toString(16)}`,
        transactionHash: `0x${"22".repeat(32)}`,
        logIndex: "0x0",
        removed: false,
      },
    ],
  ],
  metadata: { network: "arc-testnet", dataset: "logs", batch_start_range: 72729270 },
});

async function recorder() {
  const out = mkdtempSync(join(tmpdir(), "qn-record-"));
  sandboxes.push(out);
  const lines = [];
  const server = await startRecorder({
    port: 0,
    host: "127.0.0.1",
    out,
    token: TOKEN,
    print: (line) => lines.push(line),
    now: () => RECEIVED,
  });
  servers.push(server);
  const url = `http://127.0.0.1:${server.address().port.toString()}/webhook`;
  return { out, lines, url };
}

function signedHeaders(body, { token = TOKEN, gzip = false } = {}) {
  const nonce = "a1b2c3";
  const timestamp = Math.floor(RECEIVED.getTime() / 1000).toString();
  return {
    "content-type": "application/json",
    "x-qn-nonce": nonce,
    "x-qn-timestamp": timestamp,
    "x-qn-signature": sign(token, nonce, timestamp, Buffer.from(body)),
    ...(gzip ? { "content-encoding": "gzip" } : {}),
  };
}

describe("quicknode:record", () => {
  test("writes a verified delivery as a fixture without the token, with the block's delay", async () => {
    const { out, lines, url } = await recorder();
    const headers = signedHeaders(DELIVERY);
    const response = await fetch(url, { method: "POST", headers, body: DELIVERY });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });

    const files = readdirSync(out);
    assert.equal(files.length, 1);
    assert.match(files[0], /^delivery-.*-72729270-72729270\.json$/);
    const text = readFileSync(join(out, files[0]), "utf8");
    assert.ok(!text.includes(TOKEN), "the token is never written");
    const fixture = JSON.parse(text);
    assert.equal(fixture.format, FIXTURE_FORMAT);
    assert.equal(fixture.receivedAt, RECEIVED.toISOString());
    assert.equal(Buffer.from(fixture.body, "base64").toString("utf8"), DELIVERY);
    assert.equal(fixture.signedOver, "uncompressed");
    assert.equal(fixture.network, "arc-testnet");
    for (const name of ["x-qn-nonce", "x-qn-timestamp", "x-qn-signature", "content-type"]) {
      assert.equal(fixture.headers[name], headers[name]);
    }
    assert.deepEqual(fixture.blocks, [
      { block: "72729270", time: new Date(BLOCK_SECONDS * 1000).toISOString(), delayMs: 2345 },
    ]);
    const printed = lines.join("\n");
    assert.match(printed, /block 72729270 at .*: received 2345 ms later/);
    assert.ok(!printed.includes(TOKEN) && !printed.includes(headers["x-qn-signature"]));
  });

  test("keeps a gzip body as it came, verified over the inflated JSON", async () => {
    const { out, url } = await recorder();
    const body = gzipSync(Buffer.from(DELIVERY));
    const response = await fetch(url, {
      method: "POST",
      headers: signedHeaders(DELIVERY, { gzip: true }),
      body,
    });
    assert.equal(response.status, 200);
    const [file] = readdirSync(out);
    const fixture = JSON.parse(readFileSync(join(out, file), "utf8"));
    assert.deepEqual(Buffer.from(fixture.body, "base64"), body);
    assert.equal(fixture.headers["content-encoding"], "gzip");
  });

  test("answers 401 and writes nothing for a wrong or missing signature", async () => {
    const { out, lines, url } = await recorder();
    const wrong = await fetch(url, {
      method: "POST",
      headers: signedHeaders(DELIVERY, { token: "another-token" }),
      body: DELIVERY,
    });
    assert.equal(wrong.status, 401);
    const missing = await fetch(url, { method: "POST", body: DELIVERY });
    assert.equal(missing.status, 401);
    assert.deepEqual(readdirSync(out), []);
    assert.match(lines.join("\n"), /not verified, nothing written/);
  });

  test("refuses to start without the token, a port or a directory, without printing a secret", () => {
    const run = spawnSync(process.execPath, [script, "--port", "0"], {
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--out <dir> is required/);
    assert.match(run.stderr, /QUICKNODE_STREAMS_TOKEN is not set/);
  });
});
