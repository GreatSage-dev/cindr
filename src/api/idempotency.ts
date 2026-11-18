import { createHash } from 'node:crypto';

export type IdempotencyState = 'in_progress' | 'succeeded';

export interface IdempotencyRecord {
  key: string;
  state: IdempotencyState;
  requestHash: string;
  statusCode?: number;
  responseBody?: unknown;
  createdAt: number;
}

export type ClaimResult =
  | { status: 'claimed' }
  | { status: 'in_progress' }
  | { status: 'payload_mismatch' }
  | { status: 'cached'; statusCode: number; responseBody: unknown };

export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  static hashPayload(payload: unknown): string {
    const serialized =
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload ?? {}, (_, v) => (typeof v === 'bigint' ? Number(v) : v));
    return createHash('sha256').update(serialized).digest('hex');
  }

  claim(key: string, requestHash: string): ClaimResult {
    this.cleanupExpired();
    const existing = this.records.get(key);

    if (existing) {
      if (existing.state === 'in_progress') {
        return { status: 'in_progress' };
      }

      if (existing.requestHash !== requestHash) {
        return { status: 'payload_mismatch' };
      }

      return {
        status: 'cached',
        statusCode: existing.statusCode ?? 200,
        responseBody: existing.responseBody,
      };
    }

    this.records.set(key, {
      key,
      state: 'in_progress',
      requestHash,
      createdAt: Date.now(),
    });

    return { status: 'claimed' };
  }

  complete(key: string, statusCode: number, responseBody: unknown): void {
    const existing = this.records.get(key);
    if (existing) {
      existing.state = 'succeeded';
      existing.statusCode = statusCode;
      existing.responseBody = responseBody;
    }
  }

  release(key: string): void {
    this.records.delete(key);
  }

  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.records.entries()) {
      if (now - v.createdAt > this.ttlMs) {
        this.records.delete(k);
      }
    }
  }
}
