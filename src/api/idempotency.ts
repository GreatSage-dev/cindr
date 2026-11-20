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
  private readonly maxEntries: number;
  private lastCleanupAt = 0;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000, maxEntries: number = 1000) {
    this.ttlMs = ttlMs;
    this.maxEntries = Math.max(1, maxEntries);
  }

  static scopeKey(method: string, canonicalPath: string, key: string): string {
    return `${method.toUpperCase()}:${canonicalPath}:${key}`;
  }

  static hashPayload(payload: unknown): string {
    const serialized =
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload ?? {}, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    return createHash('sha256').update(serialized).digest('hex');
  }

  claim(key: string, requestHash: string): ClaimResult {
    const now = Date.now();
    if (now - this.lastCleanupAt >= 60_000 || this.records.size >= this.maxEntries) {
      this.cleanupExpired(now);
    }

    const existing = this.records.get(key);
    if (existing) {
      if (now - existing.createdAt > this.ttlMs) {
        this.records.delete(key);
      } else {
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
    }

    while (this.records.size >= this.maxEntries) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey === undefined) break;
      this.records.delete(oldestKey);
    }

    this.records.set(key, {
      key,
      state: 'in_progress',
      requestHash,
      createdAt: now,
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

  private cleanupExpired(now: number): void {
    this.lastCleanupAt = now;
    for (const [k, v] of this.records.entries()) {
      if (now - v.createdAt > this.ttlMs) {
        this.records.delete(k);
      }
    }
  }
}
