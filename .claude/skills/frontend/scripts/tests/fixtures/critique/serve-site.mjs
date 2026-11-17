// @ts-check
// Fixture server for the --start tests: serves the folder in argv[2] on 127.0.0.1 at the port in argv[3] until killed.
import { serveStatic } from '../../../lib/serve.mjs';

const [dir, port] = process.argv.slice(2);
const server = await serveStatic(dir, { port: Number(port) });
process.stdout.write(`serving ${server.url}\n`);
