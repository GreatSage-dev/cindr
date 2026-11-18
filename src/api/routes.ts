import type { IncomingMessage, ServerResponse } from 'node:http';
import { addressToLockingBytecode, type AdversarialAttackKind } from '../buildForgeTx.js';
import { IdempotencyStore } from './idempotency.js';
import { BlazeBackendService } from './service.js';
import type {
  AttackRequest,
  ClaimStampsRequest,
  ForgeRequest,
} from './types.js';

export interface RouteContext {
  service: BlazeBackendService;
  idempotencyStore: IdempotencyStore;
}

export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? Number(v) : v));
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization',
  });
  res.end(body);
}

export function sendError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): void {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  });
}

export async function parseJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch (err) {
        reject(new Error('Malformed JSON payload'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

const VALID_ATTACKS = new Set<AdversarialAttackKind>([
  'under-count-4',
  'duplicate-slot',
  'fake-category',
  'anti-burn-keep-stamps',
  'steal-baton',
]);

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext
): Promise<void> {
  const method = req.method?.toUpperCase();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  // GET /api/health
  if (method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    const health = ctx.service.getHealth();
    sendJson(res, 200, health);
    return;
  }

  // GET /api/registry
  if (method === 'GET' && (pathname === '/api/registry' || pathname === '/registry')) {
    const registry = ctx.service.getRegistry();
    sendJson(res, 200, registry);
    return;
  }

  // GET /api/baton
  if (method === 'GET' && (pathname === '/api/baton' || pathname === '/baton')) {
    const baton = await ctx.service.getBatonStatus();
    sendJson(res, 200, baton);
    return;
  }

  // POST /api/stamps/claim or /api/claim-stamps
  if (
    method === 'POST' &&
    (pathname === '/api/stamps/claim' ||
      pathname === '/api/claim-stamps' ||
      pathname === '/claim-stamps')
  ) {
    let body: ClaimStampsRequest;
    try {
      body = await parseJsonBody<ClaimStampsRequest>(req);
    } catch (err: any) {
      sendError(res, 400, 'BAD_REQUEST', err.message);
      return;
    }

    if (!body || typeof body.recipientAddress !== 'string' || !body.recipientAddress.trim()) {
      sendError(
        res,
        422,
        'VALIDATION_ERROR',
        'Missing or invalid recipientAddress in request body',
        { field: 'recipientAddress' }
      );
      return;
    }

    try {
      addressToLockingBytecode(body.recipientAddress);
    } catch (err: any) {
      sendError(
        res,
        422,
        'INVALID_ADDRESS',
        `recipientAddress is not a valid CashAddress: ${err.message}`,
        { field: 'recipientAddress' }
      );
      return;
    }

    // Idempotency check
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      const hash = IdempotencyStore.hashPayload(body);
      const claim = ctx.idempotencyStore.claim(idempotencyKey, hash);
      if (claim.status === 'in_progress') {
        sendError(
          res,
          409,
          'CONFLICT',
          'A request with this Idempotency-Key is currently in progress'
        );
        return;
      }
      if (claim.status === 'payload_mismatch') {
        sendError(
          res,
          422,
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'Idempotency key reused with a different payload'
        );
        return;
      }
      if (claim.status === 'cached') {
        sendJson(res, claim.statusCode, claim.responseBody);
        return;
      }
    }

    try {
      const result = await ctx.service.claimDemoStamps(body);
      if (idempotencyKey) {
        ctx.idempotencyStore.complete(idempotencyKey, 200, result);
      }
      sendJson(res, 200, result);
      return;
    } catch (err: any) {
      if (idempotencyKey) {
        ctx.idempotencyStore.release(idempotencyKey);
      }
      sendError(res, 500, 'CLAIM_FAILED', err.message);
      return;
    }
  }

  // POST /api/forge
  if (method === 'POST' && (pathname === '/api/forge' || pathname === '/forge')) {
    let body: ForgeRequest;
    try {
      body = await parseJsonBody<ForgeRequest>(req);
    } catch (err: any) {
      sendError(res, 400, 'BAD_REQUEST', err.message);
      return;
    }

    if (!body || typeof body.recipientAddress !== 'string' || !body.recipientAddress.trim()) {
      sendError(
        res,
        422,
        'VALIDATION_ERROR',
        'Missing or invalid recipientAddress in request body',
        { field: 'recipientAddress' }
      );
      return;
    }

    try {
      addressToLockingBytecode(body.recipientAddress);
    } catch (err: any) {
      sendError(
        res,
        422,
        'INVALID_ADDRESS',
        `recipientAddress is not a valid CashAddress: ${err.message}`,
        { field: 'recipientAddress' }
      );
      return;
    }

    if (body.tier !== 5 && body.tier !== 9 && body.tier !== 10) {
      sendError(
        res,
        422,
        'INVALID_TIER',
        `Invalid tier "${body.tier}". Must be 5 (Bronze), 9 (Silver), or 10 (Gold)`,
        { supportedTiers: [5, 9, 10] }
      );
      return;
    }

    // Idempotency check
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      const hash = IdempotencyStore.hashPayload(body);
      const claim = ctx.idempotencyStore.claim(idempotencyKey, hash);
      if (claim.status === 'in_progress') {
        sendError(
          res,
          409,
          'CONFLICT',
          'A request with this Idempotency-Key is currently in progress'
        );
        return;
      }
      if (claim.status === 'payload_mismatch') {
        sendError(
          res,
          422,
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'Idempotency key reused with a different payload'
        );
        return;
      }
      if (claim.status === 'cached') {
        sendJson(res, claim.statusCode, claim.responseBody);
        return;
      }
    }

    try {
      const result = await ctx.service.forgeTrophy(body);
      if (idempotencyKey) {
        ctx.idempotencyStore.complete(idempotencyKey, 200, result);
      }
      sendJson(res, 200, result);
      return;
    } catch (err: any) {
      if (idempotencyKey) {
        ctx.idempotencyStore.release(idempotencyKey);
      }
      const isValidationError = err.message.includes('Insufficient') || err.message.includes('No matching');
      sendError(res, isValidationError ? 422 : 500, isValidationError ? 'FORGE_VALIDATION_ERROR' : 'FORGE_FAILED', err.message);
      return;
    }
  }

  // POST /api/attack
  if (method === 'POST' && (pathname === '/api/attack' || pathname === '/attack')) {
    let body: AttackRequest;
    try {
      body = await parseJsonBody<AttackRequest>(req);
    } catch (err: any) {
      sendError(res, 400, 'BAD_REQUEST', err.message);
      return;
    }

    if (!body || !body.attackType || !VALID_ATTACKS.has(body.attackType)) {
      sendError(
        res,
        422,
        'INVALID_ATTACK_TYPE',
        `Invalid attackType "${body?.attackType}". Must be one of: ${Array.from(VALID_ATTACKS).join(', ')}`,
        { allowed: Array.from(VALID_ATTACKS) }
      );
      return;
    }

    try {
      const result = await ctx.service.runAttack(body);
      sendJson(res, 200, result);
      return;
    } catch (err: any) {
      sendError(res, 500, 'ATTACK_EXECUTION_ERROR', err.message);
      return;
    }
  }

  // Not Found
  sendError(res, 404, 'NOT_FOUND', `Route ${method} ${pathname} not found`);
}
