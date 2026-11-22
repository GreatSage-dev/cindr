import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadAppConfig } from './config.js';
import { IdempotencyStore } from './api/idempotency.js';
import {
  createIpRateLimiter,
  handleRequest,
  sendError,
  type RouteContext,
} from './api/routes.js';
import { BlazeBackendService, type BlazeBackendServiceOptions } from './api/service.js';

export interface BlazeServerOptions extends BlazeBackendServiceOptions {
  idempotencyTtlMs?: number;
  allowedOrigin?: string;
  rateLimitMaxPerMin?: number;
}

export interface BlazeServerInstance {
  server: Server;
  context: RouteContext;
  port: number;
  close: () => Promise<void>;
}

export function createBlazeContext(options: BlazeServerOptions = {}): RouteContext {
  const config = loadAppConfig();
  const service = new BlazeBackendService(options);
  const idempotencyStore = new IdempotencyStore(options.idempotencyTtlMs);
  const effectiveRateLimit =
    options.rateLimitMaxPerMin ?? (process.env.VITEST ? undefined : config.rateLimitMaxPerMin);

  return {
    service,
    idempotencyStore,
    allowedOrigin: options.allowedOrigin ?? config.allowedOrigin,
    rateLimiter: effectiveRateLimit ? createIpRateLimiter(effectiveRateLimit) : undefined,
  };
}

export async function handleBlazeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const startedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  try {
    await handleRequest(req, res, ctx);
  } catch (err: unknown) {
    if (!process.env.VITEST) {
      console.error(
        JSON.stringify({
          level: 'error',
          requestId,
          method: req.method,
          url: req.url,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
    if (!res.headersSent) {
      try {
        sendError(
          res,
          500,
          'INTERNAL_SERVER_ERROR',
          'An unexpected server error occurred',
          undefined,
          ctx
        );
      } catch {
        // Ignore socket write failures on aborted requests
      }
    }
  } finally {
    if (!process.env.VITEST && req.url?.startsWith('/api/')) {
      console.log(
        JSON.stringify({
          level: 'info',
          requestId,
          method: req.method,
          url: req.url,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        })
      );
    }
  }
}

function createHttpServer(ctx: RouteContext): Server {
  return createServer((req, res) => {
    void handleBlazeHttpRequest(req, res, ctx);
  });
}

export function createBlazeServer(options: BlazeServerOptions = {}): Server {
  const ctx = createBlazeContext(options);
  return createHttpServer(ctx);
}

export async function startServer(
  port?: number,
  options: BlazeServerOptions = {}
): Promise<BlazeServerInstance> {
  const config = loadAppConfig();
  const listenPort = port ?? config.port;
  const ctx = createBlazeContext(options);
  const server = createHttpServer(ctx);

  await new Promise<void>((resolve, reject) => {
    server.listen(listenPort, () => resolve());
    server.once('error', reject);
  });

  const boundAddress = server.address();
  const actualPort =
    typeof boundAddress === 'object' && boundAddress !== null ? boundAddress.port : listenPort;

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

let defaultServerlessContext: RouteContext | undefined;

function getDefaultServerlessContext(): RouteContext {
  if (!defaultServerlessContext) {
    try {
      defaultServerlessContext = createBlazeContext();
    } catch (err) {
      if (process.env.VERCEL) {
        console.warn(
          '[cindr] Serverless config fallback to mock mode:',
          err instanceof Error ? err.message : String(err)
        );
        defaultServerlessContext = createBlazeContext({ networkMode: 'mock' });
      } else {
        throw err;
      }
    }
  }
  return defaultServerlessContext;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleBlazeHttpRequest(req, res, getDefaultServerlessContext());
}

const isMain =
  !process.env.VERCEL &&
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');

if (isMain || process.env.START_SERVER === 'true') {
  const config = loadAppConfig();
  startServer(config.port)
    .then((instance) => {
      console.log(
        `cindr HTTP Backend running on http://localhost:${instance.port} [${config.bchNetwork}]`
      );
      console.log(`- Landing Page: http://localhost:${instance.port}/`);
      console.log(`- Forge Workspace: http://localhost:${instance.port}/dashboard`);
      console.log(`- Health Check: http://localhost:${instance.port}/api/health`);

      const shutdown = async () => {
        console.log('Shutting down server...');
        await instance.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start cindr server:', err);
      process.exit(1);
    });
}
