import { hexToBin } from '@bitauth/libauth';

export interface StampSlot {
  slot: number;
  id: string;
  name: string;
  /** Big-endian 64-char CashToken category hex string (RPC / explorer / tokenhunt.js order). */
  category: string;
  /** Single-byte NFT commitment rule (0..254), or null to match any commitment / FT >= 1. */
  commitmentRule: number | null;
  kind: 'official' | 'demo' | 'merchant';
}

export interface TokenHuntTierDef {
  id: 'medallion' | 'trophy' | 'trailblazer-trophy';
  min: 5 | 9 | 10;
  name: string;
}

export const TROPHY_TIERS: readonly TokenHuntTierDef[] = [
  { id: 'medallion', min: 5, name: 'BLAZE Medallion' },
  { id: 'trophy', min: 9, name: 'BLAZE Trophy' },
  { id: 'trailblazer-trophy', min: 10, name: 'Trailblazer Trophy' },
] as const;

/**
 * Official BCH BLAZE 2026 TokenHunt categories extracted from https://bchblaze.cash/tokenhunt/ (#rollcall-catalog).
 * Slots whose live genesis category was still "activation pending" on bchblaze.cash at launch time
 * use explicit deterministic staging placeholders until the organizers publish their genesis txids.
 */
export const OFFICIAL_TOKENHUNT_CATALOG: readonly Omit<StampSlot, 'slot' | 'kind'>[] = [
  {
    id: 'paytaca-pioneer',
    name: 'Paytaca Pioneer',
    category: 'f1a9bd066b904eccfb10dc271abf669932a815420408e6c1f97f2a8b88944c1d',
    commitmentRule: null,
  },
  {
    id: 'template-titan',
    name: 'Template Titan',
    category: '676b8d5cef572179e4633124eb0a873507b525c3053a7461518aafa90d076dd6',
    commitmentRule: null,
  },
  {
    id: 'selene-sorcerer',
    name: 'Selene Sorcerer',
    category: 'e2ca1f9374a0c299677654b9030076ab3d017c10beeb51f1d77edaf7c5a4baa0',
    commitmentRule: null,
  },
  {
    id: 'showcase-showoff',
    name: 'Showcase Showoff (Staging)',
    category: '0404040404040404040404040404040404040404040404040404040404040404',
    commitmentRule: null,
  },
  {
    id: 'consensus-contributor',
    name: 'Consensus Contributor',
    category: '9762dd430954296c4ff2cc0745399ed479250e13d91fb206a350376ed994013b',
    commitmentRule: null,
  },
  {
    id: 'hidden-6',
    name: 'Hidden #6 (Staging)',
    category: '0606060606060606060606060606060606060606060606060606060606060606',
    commitmentRule: null,
  },
  {
    id: 'paryon-procurer',
    name: 'Paryon Procurer (Staging)',
    category: '0707070707070707070707070707070707070707070707070707070707070707',
    commitmentRule: null,
  },
  {
    id: 'reward-revolutionary',
    name: 'Reward Revolutionary',
    category: '96a7af30d09d500469533eb7c6e1295257549ca22f4def3a390c56c4d132fbbd',
    commitmentRule: null,
  },
  {
    id: 'blaze-builder',
    name: 'BLAZE Builder (Staging)',
    category: '0909090909090909090909090909090909090909090909090909090909090909',
    commitmentRule: null,
  },
  {
    id: 'trailblazer',
    name: 'Trailblazer 2025',
    category: 'cc080d0bf27a2b6c8d006a0f1f0c1695b485ed75caff5264b90c68e63f232ff4',
    commitmentRule: null,
  },
];

/**
 * Converts a 64-char RPC/explorer CashToken category hex string into the 32-byte little-endian
 * byte sequence observed by CashVM OP_UTXOTOKENCATEGORY inside locking bytecode.
 */
export function categoryHexToVmBytes(categoryHex: string): Uint8Array {
  const clean = categoryHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Invalid CashToken category hex (expected 64 hex chars): ${categoryHex}`);
  }
  return Uint8Array.from(hexToBin(clean)).reverse();
}

/**
 * Encodes a slot registry into the compact 33-byte-per-slot format consumed by BlazeForge.cash:
 * [32-byte VM category][1-byte commitmentRule (0xff = wildcard, 0x00..0xfe = exact commitment)].
 */
export function encodeRegistryBytes(slots: readonly StampSlot[]): Uint8Array {
  const buf = new Uint8Array(slots.length * 33);
  for (let idx = 0; idx < slots.length; idx++) {
    const slot = slots[idx];
    if (slot.slot !== idx) {
      throw new Error(`Slots must be contiguous starting at 0; expected ${idx}, got ${slot.slot}`);
    }
    const vmCat = categoryHexToVmBytes(slot.category);
    buf.set(vmCat, idx * 33);
    const rule = slot.commitmentRule === null ? 0xff : slot.commitmentRule;
    if (rule < 0 || rule > 0xff) {
      throw new Error(`Invalid commitmentRule ${rule} at slot ${idx}`);
    }
    buf[idx * 33 + 32] = rule;
  }
  return buf;
}

/**
 * Creates a unified 15-slot Forge registry:
 *  - Slots 0..9: Official BCH BLAZE 2026 TokenHunt tokens (real categories + staging slots)
 *  - Slots 10..14: 5 Demo Stamp NFTs minted in 1 click by StampDispenser (commitments 0x01..0x05)
 */
export function createBlazeTokenHuntRegistry(
  demoCategoryHex: string,
  categoryOverrides: Partial<Record<string, string>> = {}
): StampSlot[] {
  const official: StampSlot[] = OFFICIAL_TOKENHUNT_CATALOG.map((item, idx) => ({
    slot: idx,
    id: item.id,
    name: item.name,
    category: categoryOverrides[item.id] ?? item.category,
    commitmentRule: item.commitmentRule,
    kind: 'official',
  }));

  const demo: StampSlot[] = [1, 2, 3, 4, 5].map((n, offset) => ({
    slot: official.length + offset,
    id: `demo-stamp-${n}`,
    name: `Demo Stamp #${n}`,
    category: demoCategoryHex,
    commitmentRule: n,
    kind: 'demo',
  }));

  return [...official, ...demo];
}

/**
 * Reusable Paytaca Merchant Punch-Card preset ("Burn N Coffee Stamps -> Mint 1 Free Reward NFT").
 */
export function createMerchantLoyaltyRegistry(
  merchantCategoryHex: string,
  stampCount = 5
): StampSlot[] {
  return Array.from({ length: stampCount }, (_, idx) => ({
    slot: idx,
    id: `merchant-stamp-${idx + 1}`,
    name: `Loyalty Stamp #${idx + 1}`,
    category: merchantCategoryHex,
    commitmentRule: idx + 1,
    kind: 'merchant' as const,
  }));
}
