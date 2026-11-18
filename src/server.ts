import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { IdempotencyStore } from './api/idempotency.js';
import { handleRequest, type RouteContext } from './api/routes.js';
import { BlazeBackendService, type BlazeBackendServiceOptions } from './api/service.js';

export interface BlazeServerOptions extends BlazeBackendServiceOptions {
  idempotencyTtlMs?: number;
}

export interface BlazeServerInstance {
  server: Server;
  context: RouteContext;
  port: number;
  close: () => Promise<void>;
}

export function createBlazeContext(options: BlazeServerOptions = {}): RouteContext {
  const service = new BlazeBackendService(options);
  const idempotencyStore = new IdempotencyStore(options.idempotencyTtlMs);
  return { service, idempotencyStore };
}

export function createBlazeServer(options: BlazeServerOptions = {}): Server {
  const ctx = createBlazeContext(options);
  return createServer(async (req, res) => {
    try {
      await handleRequest(req, res, ctx);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: err?.message ?? 'An unexpected server error occurred',
            },
          })
        );
      }
    }
  });
}

export async function startServer(
  port: number = Number(process.env.PORT) || 3000,
  options: BlazeServerOptions = {}
): Promise<BlazeServerInstance> {
  const ctx = createBlazeContext(options);
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, ctx);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: err?.message ?? 'An unexpected server error occurred',
            },
          })
        );
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.once('error', reject);
  });

  const boundAddress = server.address();
  const actualPort =
    typeof boundAddress === 'object' && boundAddress !== null
      ? boundAddress.port
      : port;

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return {
    server,
    context: ctx,
    port: actualPort,
    close,
  };
}

// Standalone execution check
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') ===
    process.argv[1].replace(/\\/g, '/');

if (isMain || process.env.START_SERVER === 'true') {
  const port = Number(process.env.PORT) || 3000;
  startServer(port).then((instance) => {
    console.log(`BLAZE Forge HTTP Backend running on http://localhost:${instance.port}`);
    console.log(`- Health Check: http://localhost:${instance.port}/api/health`);
    console.log(`- TokenHunt Registry: http://localhost:${instance.port}/api/registry`);
    console.log(`- Baton Status: http://localhost:${instance.port}/api/baton`);

    const shutdown = async () => {
      console.log('Shutting down server...');
      await instance.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((err) => {
    console.error('Failed to start BLAZE Forge server:', err);
    process.exit(1);
  });
}
