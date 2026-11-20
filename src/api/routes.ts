import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binToHex } from '@bitauth/libauth';
import {
  ForgeValidationError,
  addressToLockingBytecode,
  type AdversarialAttackKind,
} from '../buildForgeTx.js';
import { IdempotencyStore } from './idempotency.js';
import { BlazeBackendService, PrivateKeyRejectedError } from './service.js';
import type {
  AttackRequest,
  ClaimStampsRequest,
  ForgeRequest,
} from './types.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = [
  path.resolve(MODULE_DIR, '..', '..'),
  path.resolve(MODULE_DIR, '..', '..', '..'),
  process.cwd(),
].find((candidate) => existsSync(path.join(candidate, 'package.json'))) ?? process.cwd();

const STATIC_ASSET_MAP: Record<string, { filePath: string; contentType: string }> = {
  '/': {
    filePath: path.join(PROJECT_ROOT, 'public', 'index.html'),
    contentType: 'text/html; charset=utf-8',
  },
  '/index.html': {
    filePath: path.join(PROJECT_ROOT, 'public', 'index.html'),
    contentType: 'text/html; charset=utf-8',
  },
  '/styles.css': {
    filePath: path.join(PROJECT_ROOT, 'public', 'styles.css'),
    contentType: 'text/css; charset=utf-8',
  },
  '/app.js': {
    filePath: path.join(PROJECT_ROOT, 'public', 'app.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/dashboard': {
    filePath: path.join(PROJECT_ROOT, 'public', 'dashboard.html'),
    contentType: 'text/html; charset=utf-8',
  },
  '/dashboard.html': {
    filePath: path.join(PROJECT_ROOT, 'public', 'dashboard.html'),
    contentType: 'text/html; charset=utf-8',
  },
  '/dashboard.css': {
    filePath: path.join(PROJECT_ROOT, 'public', 'dashboard.css'),
    contentType: 'text/css; charset=utf-8',
  },
  '/dashboard.js': {
    filePath: path.join(PROJECT_ROOT, 'public', 'dashboard.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/vendor/three.module.js': {
    filePath: path.join(PROJECT_ROOT, 'node_modules', 'three', 'build', 'three.module.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/vendor/three.core.js': {
    filePath: path.join(PROJECT_ROOT, 'node_modules', 'three', 'build', 'three.core.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/vendor/wizardconnect.js': {
    filePath: path.join(PROJECT_ROOT, 'public', 'vendor', 'wizardconnect.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/vendor/chunk-KXQ2PETI.js': {
    filePath: path.join(PROJECT_ROOT, 'public', 'vendor', 'chunk-KXQ2PETI.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/vendor/chunk-XM7N7ROQ.js': {
    filePath: path.join(PROJECT_ROOT, 'public', 'vendor', 'chunk-XM7N7ROQ.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/vendor/chunk-SQE76S5B.js': {
    filePath: path.join(PROJECT_ROOT, 'public', 'vendor', 'chunk-SQE76S5B.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
};

const MAX_JSON_BODY_BYTES = 256 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' wss://relay.riften.net:443 wss://relay.cauldron.quest:443 wss://bch.imaginary.cash:50004 wss://electrum.imaginary.cash:50004 wss://fulcrum.pat.mn:50004 wss://chipnet.imaginary.cash:50004; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
};

export class PayloadTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = 'PAYLOAD_TOO_LARGE';

  constructor(maxBytes: number) {
    super(`JSON body exceeds maximum allowed size of ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

export class MalformedJsonError extends Error {
  readonly statusCode = 400;
  readonly code = 'BAD_REQUEST';

  constructor() {
    super('Malformed JSON payload');
    this.name = 'MalformedJsonError';
  }
}

export interface RateLimiter {
  check(ip: string): boolean;
}

export function createIpRateLimiter(maxPerWindow: number, windowMs: number = 60_000): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    check(ip: string): boolean {
      const now = Date.now();
      const existing = buckets.get(ip);
      if (!existing || now >= existing.resetAt) {
        if (buckets.size > 5000) {
          for (const [k, v] of buckets.entries()) {
            if (now >= v.resetAt) buckets.delete(k);
          }
        }
        buckets.set(ip, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (existing.count >= maxPerWindow) {
        return false;
      }
      existing.count += 1;
      return true;
    },
  };
}

export interface RouteContext {
  service: BlazeBackendService;
  idempotencyStore: IdempotencyStore;
  allowedOrigin?: string;
  rateLimiter?: RateLimiter;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function corsHeaders(ctx: RouteContext): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ctx.allowedOrigin ?? '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization',
  };
}

async function tryServeStatic(
  res: ServerResponse,
  pathname: string,
  headOnly: boolean
): Promise<boolean> {
  const entry = STATIC_ASSET_MAP[pathname];
  if (!entry || !existsSync(entry.filePath)) {
    return false;
  }

  const content = await readFile(entry.filePath);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': entry.contentType,
    'Content-Length': content.byteLength,
    'Cache-Control': pathname.startsWith('/vendor/')
      ? 'public, max-age=86400'
      : 'no-cache, must-revalidate',
  });
  res.end(headOnly ? undefined : content);
  return true;
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  ctx?: RouteContext,
  headOnly: boolean = false
): void {
  const body = JSON.stringify(data, (_, v) => {
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Uint8Array) return binToHex(v);
    return v;
  });
  const originHeaders = ctx
    ? corsHeaders(ctx)
    : {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization',
      };
  res.writeHead(statusCode, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...originHeaders,
  });
  res.end(headOnly ? undefined : body);
}

export function sendError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
  ctx?: RouteContext
): void {
  sendJson(
    res,
    statusCode,
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    ctx
  );
}

export async function parseJsonBody<T = unknown>(
  req: IncomingMessage,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        req.pause();
        fail(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new MalformedJsonError());
      }
    });

    req.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

function sendBodyParseError(res: ServerResponse, err: unknown, ctx: RouteContext): void {
  if (err instanceof PayloadTooLargeError) {
    sendError(res, 413, err.code, err.message, { maxBytes: MAX_JSON_BODY_BYTES }, ctx);
    return;
  }
  sendError(res, 400, 'BAD_REQUEST', getErrorMessage(err), undefined, ctx);
}

const VALID_ATTACKS = new Set<AdversarialAttackKind>([
  'under-count-4',
  'duplicate-slot',
  'fake-category',
  'anti-burn-keep-stamps',
  'steal-baton',
]);

function renderNotFoundHtml(pathname: string): string {
  const safePath = pathname.replace(/[<>&"']/g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found — BLAZE Forge</title>
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body class="notfound-body">
  <main class="notfound-card">
    <p class="eyebrow-tag">HTTP 404</p>
    <h1>Page not found</h1>
    <p class="muted-copy">No page exists at <code>${safePath}</code>.</p>
    <div class="notfound-actions">
      <a href="/dashboard" class="btn-primary">Open Forge workspace</a>
      <a href="/" class="btn-secondary">Back to overview</a>
    </div>
  </main>
</body>
</html>`;
}

function enforcePostRateLimit(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): boolean {
  if (!ctx.rateLimiter) return true;
  const ip = req.socket?.remoteAddress ?? 'unknown';
  if (!ctx.rateLimiter.check(ip)) {
    sendError(
      res,
      429,
      'RATE_LIMIT_EXCEEDED',
      'Too many requests. Wait a moment before retrying.',
      undefined,
      ctx
    );
    return false;
  }
  return true;
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const method = req.method?.toUpperCase() ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  const isReadMethod = method === 'GET' || method === 'HEAD';
  const headOnly = method === 'HEAD';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(ctx),
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (isReadMethod && (pathname === '/api/health' || pathname === '/health')) {
    const health = ctx.service.getHealth();
    sendJson(res, 200, health, ctx, headOnly);
    return;
  }

  if (isReadMethod && (pathname === '/api/registry' || pathname === '/registry')) {
    const registry = ctx.service.getRegistry();
    sendJson(res, 200, registry, ctx, headOnly);
    return;
  }

  if (isReadMethod && (pathname === '/api/baton' || pathname === '/baton')) {
    const baton = await ctx.service.getBatonStatus();
    sendJson(res, 200, baton, ctx, headOnly);
    return;
  }

  if (isReadMethod && pathname === '/api/wallet') {
    const address = url.searchParams.get('address')?.trim();
    if (!address) {
      sendError(res, 422, 'VALIDATION_ERROR', 'Missing address query parameter', { field: 'address' }, ctx);
      return;
    }
    try {
      const overview = await ctx.service.getWalletOverview(address);
      sendJson(res, 200, overview, ctx, headOnly);
      return;
    } catch (err: unknown) {
      sendError(
        res,
        422,
        'INVALID_ADDRESS',
        `address is not a valid CashAddress: ${getErrorMessage(err)}`,
        { field: 'address' },
        ctx
      );
      return;
    }
  }

  if (isReadMethod) {
    const served = await tryServeStatic(res, pathname, headOnly);
    if (served) return;
  }

  if (method === 'POST' && pathname === '/api/wallet/demo') {
    if (!enforcePostRateLimit(req, res, ctx)) return;
    try {
      const wallet = await ctx.service.createDemoWallet();
      sendJson(res, 201, wallet, ctx);
      return;
    } catch (err: unknown) {
      if (err instanceof ForgeValidationError) {
        sendError(res, err.statusCode, err.code, err.message, undefined, ctx);
        return;
      }
      sendError(res, 500, 'WALLET_CREATION_FAILED', 'Unable to create sandbox wallet', undefined, ctx);
      return;
    }
  }

  if (
    method === 'POST' &&
    (pathname === '/api/stamps/claim' ||
      pathname === '/api/claim-stamps' ||
      pathname === '/claim-stamps')
  ) {
    if (!enforcePostRateLimit(req, res, ctx)) return;

    let body: ClaimStampsRequest;
    try {
      body = await parseJsonBody<ClaimStampsRequest>(req);
    } catch (err: unknown) {
      sendBodyParseError(res, err, ctx);
      return;
    }

    if (!body || typeof body.recipientAddress !== 'string' || !body.recipientAddress.trim()) {
      sendError(
        res,
        422,
        'VALIDATION_ERROR',
        'Missing or invalid recipientAddress in request body',
        { field: 'recipientAddress' },
        ctx
      );
      return;
    }

    try {
      addressToLockingBytecode(body.recipientAddress);
    } catch (err: unknown) {
      sendError(
        res,
        422,
        'INVALID_ADDRESS',
        `recipientAddress is not a valid CashAddress: ${getErrorMessage(err)}`,
        { field: 'recipientAddress' },
        ctx
      );
      return;
    }

    const rawIdemKey = req.headers['idempotency-key'] as string | undefined;
    const scopedIdemKey = rawIdemKey
      ? IdempotencyStore.scopeKey('POST', '/api/stamps/claim', rawIdemKey)
      : undefined;

    if (scopedIdemKey) {
      const { signerPrivKeyHex: _omitKey, ...safeHashableBody } = body;
      const hash = IdempotencyStore.hashPayload(safeHashableBody);
      const claim = ctx.idempotencyStore.claim(scopedIdemKey, hash);
      if (claim.status === 'in_progress') {
        sendError(res, 409, 'CONFLICT', 'A request with this Idempotency-Key is currently in progress', undefined, ctx);
        return;
      }
      if (claim.status === 'payload_mismatch') {
        sendError(res, 422, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key reused with a different payload', undefined, ctx);
        return;
      }
      if (claim.status === 'cached') {
        sendJson(res, claim.statusCode, claim.responseBody, ctx);
        return;
      }
    }

    try {
      const result = await ctx.service.claimDemoStamps(body);
      if (scopedIdemKey) {
        ctx.idempotencyStore.complete(scopedIdemKey, 200, result);
      }
      sendJson(res, 200, result, ctx);
      return;
    } catch (err: unknown) {
      if (scopedIdemKey) {
        ctx.idempotencyStore.release(scopedIdemKey);
      }
      if (!process.env.VITEST) {
        console.error('[api] /api/stamps/claim failure:', err);
      }
      sendError(
        res,
        500,
        'CLAIM_FAILED',
        'Unable to dispense Demo Stamps from StampDispenser covenant right now.',
        undefined,
        ctx
      );
      return;
    }
  }

  if (method === 'POST' && (pathname === '/api/forge' || pathname === '/forge')) {
    if (!enforcePostRateLimit(req, res, ctx)) return;

    let body: ForgeRequest;
    try {
      body = await parseJsonBody<ForgeRequest>(req);
    } catch (err: unknown) {
      sendBodyParseError(res, err, ctx);
      return;
    }

    if (!body || typeof body.recipientAddress !== 'string' || !body.recipientAddress.trim()) {
      sendError(
        res,
        422,
        'VALIDATION_ERROR',
        'Missing or invalid recipientAddress in request body',
        { field: 'recipientAddress' },
        ctx
      );
      return;
    }

    try {
      addressToLockingBytecode(body.recipientAddress);
    } catch (err: unknown) {
      sendError(
        res,
        422,
        'INVALID_ADDRESS',
        `recipientAddress is not a valid CashAddress: ${getErrorMessage(err)}`,
        { field: 'recipientAddress' },
        ctx
      );
      return;
    }

    if (body.tier !== 5 && body.tier !== 9 && body.tier !== 10) {
      sendError(
        res,
        422,
        'INVALID_TIER',
        `Invalid tier "${body.tier}". Must be 5 (BLAZE Medallion), 9 (BLAZE Trophy), or 10 (Trailblazer Trophy)`,
        { supportedTiers: [5, 9, 10] },
        ctx
      );
      return;
    }

    const rawIdemKey = req.headers['idempotency-key'] as string | undefined;
    const scopedIdemKey = rawIdemKey
      ? IdempotencyStore.scopeKey('POST', '/api/forge', rawIdemKey)
      : undefined;

    if (scopedIdemKey) {
      const { signerPrivKeyHex: _omitKey, ...safeHashableBody } = body;
      const hash = IdempotencyStore.hashPayload(safeHashableBody);
      const claim = ctx.idempotencyStore.claim(scopedIdemKey, hash);
      if (claim.status === 'in_progress') {
        sendError(res, 409, 'CONFLICT', 'A request with this Idempotency-Key is currently in progress', undefined, ctx);
        return;
      }
      if (claim.status === 'payload_mismatch') {
        sendError(res, 422, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key reused with a different payload', undefined, ctx);
        return;
      }
      if (claim.status === 'cached') {
        sendJson(res, claim.statusCode, claim.responseBody, ctx);
        return;
      }
    }

    try {
      const result = await ctx.service.forgeTrophy(body);
      if (scopedIdemKey) {
        ctx.idempotencyStore.complete(scopedIdemKey, 200, result);
      }
      sendJson(res, 200, result, ctx);
      return;
    } catch (err: unknown) {
      if (scopedIdemKey) {
        ctx.idempotencyStore.release(scopedIdemKey);
      }
      if (err instanceof PrivateKeyRejectedError) {
        sendError(res, err.statusCode, err.code, err.message, undefined, ctx);
        return;
      }
      if (err instanceof ForgeValidationError) {
        sendError(res, err.statusCode, err.code, err.message, undefined, ctx);
        return;
      }
      if (!process.env.VITEST) {
        console.error('[api] /api/forge failure:', err);
      }
      sendError(
        res,
        500,
        'FORGE_FAILED',
        'Unable to construct or broadcast the forge transaction.',
        undefined,
        ctx
      );
      return;
    }
  }

  if (method === 'POST' && (pathname === '/api/attack' || pathname === '/attack')) {
    if (!enforcePostRateLimit(req, res, ctx)) return;

    let body: AttackRequest;
    try {
      body = await parseJsonBody<AttackRequest>(req);
    } catch (err: unknown) {
      sendBodyParseError(res, err, ctx);
      return;
    }

    if (!body || !body.attackType || !VALID_ATTACKS.has(body.attackType)) {
      sendError(
        res,
        422,
        'INVALID_ATTACK_TYPE',
        `Invalid attackType "${body?.attackType}". Must be one of: ${Array.from(VALID_ATTACKS).join(', ')}`,
        { allowed: Array.from(VALID_ATTACKS) },
        ctx
      );
      return;
    }

    try {
      const result = await ctx.service.runAttack(body);
      sendJson(res, 200, result, ctx);
      return;
    } catch (err: unknown) {
      if (!process.env.VITEST) {
        console.error('[api] /api/attack failure:', err);
      }
      sendError(
        res,
        500,
        'ATTACK_EXECUTION_ERROR',
        'Unable to execute adversarial CashVM proof.',
        undefined,
        ctx
      );
      return;
    }
  }

  const acceptHeader = req.headers.accept ?? '';
  if (isReadMethod && !pathname.startsWith('/api/') && acceptHeader.includes('text/html')) {
    const html = renderNotFoundHtml(pathname);
    res.writeHead(404, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
    });
    res.end(headOnly ? undefined : html);
    return;
  }

  sendError(res, 404, 'NOT_FOUND', `Route ${method} ${pathname} not found`, undefined, ctx);
}
