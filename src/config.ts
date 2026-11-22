export type BchNetworkMode = 'mock' | 'chipnet' | 'mainnet';

export interface AppConfig {
  port: number;
  bchNetwork: BchNetworkMode;
  allowedOrigin: string;
  forgeCategory: string;
  demoCategory: string;
  faucetPrivKeyHex: string;
  rateLimitMaxPerMin: number;
  allowUnsafeLocalSigning: boolean;
  tokenHuntOverrides: Partial<Record<string, string>>;
}

export const DEFAULT_LOCAL_FORGE_CATEGORY = 'aa' + '42'.repeat(30) + 'cc';
export const DEFAULT_LOCAL_DEMO_CATEGORY = 'dd' + '99'.repeat(30) + 'ee';
const DEFAULT_LOCAL_MOCK_FAUCET_KEY = '00'.repeat(31) + '09';

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim());
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${name}="${raw}": expected a positive integer`);
  }
  return n;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid PORT="${raw}": expected an integer between 0 and 65535`);
  }
  return n;
}

function parseNetworkMode(raw: string | undefined): BchNetworkMode {
  const normalized = (raw ?? 'mock').trim().toLowerCase();
  if (normalized === 'mock' || normalized === 'chipnet' || normalized === 'mainnet') {
    return normalized;
  }
  throw new Error(
    `Invalid BCH_NETWORK="${raw}": expected "mock", "chipnet", or "mainnet"`
  );
}

/**
 * Loads and validates runtime environment configuration, failing fast on bad values
 * and requiring an explicit faucet private key whenever running against live networks.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let bchNetwork = parseNetworkMode(env.BCH_NETWORK);
  const port = parsePort(env.PORT, 3000);
  const allowedOrigin = (env.ALLOWED_ORIGIN ?? '*').trim() || '*';

  const forgeCategory = (env.FORGE_CATEGORY ?? DEFAULT_LOCAL_FORGE_CATEGORY).trim().toLowerCase();
  if (!isHex64(forgeCategory)) {
    throw new Error('Invalid FORGE_CATEGORY: expected a 64-character hex string');
  }

  const demoCategory = (env.DEMO_CATEGORY ?? DEFAULT_LOCAL_DEMO_CATEGORY).trim().toLowerCase();
  if (!isHex64(demoCategory)) {
    throw new Error('Invalid DEMO_CATEGORY: expected a 64-character hex string');
  }

  const rawFaucetKey = env.FAUCET_PRIVKEY_HEX?.trim();
  if (!rawFaucetKey && bchNetwork !== 'mock') {
    if (env.VERCEL) {
      console.warn(
        `[cindr] FAUCET_PRIVKEY_HEX not provided in Vercel env; falling back to mock mode from "${bchNetwork}".`
      );
      bchNetwork = 'mock';
    } else {
      throw new Error(
        `FAUCET_PRIVKEY_HEX is required when BCH_NETWORK="${bchNetwork}". Set it in your environment before starting.`
      );
    }
  }
  const faucetPrivKeyHex = (rawFaucetKey || DEFAULT_LOCAL_MOCK_FAUCET_KEY).toLowerCase();
  if (!isHex64(faucetPrivKeyHex)) {
    throw new Error('Invalid FAUCET_PRIVKEY_HEX: expected a 64-character hex private key');
  }

  const rateLimitMaxPerMin = parsePositiveInt(
    env.RATE_LIMIT_MAX_PER_MIN,
    120,
    'RATE_LIMIT_MAX_PER_MIN'
  );
  const allowUnsafeLocalSigning = env.ALLOW_UNSAFE_LOCAL_SIGNING === 'true';

  const tokenHuntOverrides: Partial<Record<string, string>> = {};
  const rawOverrides = env.TOKENHUNT_OVERRIDES_JSON?.trim();
  if (rawOverrides) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOverrides);
    } catch {
      throw new Error('Invalid TOKENHUNT_OVERRIDES_JSON: expected valid JSON object');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid TOKENHUNT_OVERRIDES_JSON: expected a JSON map of { slotId: categoryHex }');
    }
    for (const [slotId, catHex] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof catHex !== 'string' || !isHex64(catHex)) {
        throw new Error(
          `Invalid category override for "${slotId}" in TOKENHUNT_OVERRIDES_JSON: expected 64-char hex string`
        );
      }
      tokenHuntOverrides[slotId.trim()] = catHex.trim().toLowerCase();
    }
  }

  return {
    port,
    bchNetwork,
    allowedOrigin,
    forgeCategory,
    demoCategory,
    faucetPrivKeyHex,
    rateLimitMaxPerMin,
    allowUnsafeLocalSigning,
    tokenHuntOverrides,
  };
}
