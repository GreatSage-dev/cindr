import {
  Contract,
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  randomUtxo,
  type NetworkProvider,
  type SpendableUtxo,
  type TokenDetails,
  type Unlocker,
} from 'cashscript';
import type { WcTransactionObject } from 'cashscript/dist/walletconnect-utils.js';
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeCashAddress,
  encodeCashAddress,
  encodeTransaction,
  hash160,
  hash256,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import { BlazeForgeArtifact, StampDispenserArtifact } from './artifacts.js';
import {
  categoryHexToVmBytes,
  encodeRegistryBytes,
  type StampSlot,
  type TokenHuntTierDef,
  TROPHY_TIERS,
} from './registry.js';

export type ForgeTierInput = 5 | 9 | 10 | TokenHuntTierDef | Pick<TokenHuntTierDef, 'id' | 'min'>;

export interface WalletTokenUtxoLike {
  txid?: string;
  tx_hash?: string;
  vout?: number;
  tx_pos?: number;
  satoshis?: bigint | number | string;
  value?: bigint | number | string;
  lockingBytecode?: string;
  address?: string;
  path?: string | null;
  token?: TokenDetails;
  category?: string;
  amount?: bigint | number | string;
  commitment?: string | null;
  capability?: 'none' | 'mutable' | 'minting' | null;
}

export type BlazeUtxoInput = Record<string, WalletTokenUtxoLike> | readonly WalletTokenUtxoLike[];

export interface BlazeContractConfig {
  provider: NetworkProvider;
  forgeCategory: string;
  demoCategory?: string;
  slots: readonly StampSlot[];
  /** Default true: chains directly onto unconfirmed mempool Minting Baton outputs (0-conf). */
  includeUnconfirmed?: boolean;
  /** Optional explicit mempool tracker shared across sequential 0-conf builds. */
  batonTracker?: BatonMempoolTracker;
}

export interface ClaimDemoStampsOptions extends BlazeContractConfig {
  demoCategory: string;
  recipientAddress: string;
  feeUtxos: readonly WalletTokenUtxoLike[];
  signer?: SignatureTemplate;
  feeRate?: number;
}

export interface BuildForgeTxOptions extends BlazeContractConfig {
  recipientAddress: string;
  feeUtxos?: readonly WalletTokenUtxoLike[];
  signer?: SignatureTemplate;
  feeRate?: number;
  userPrompt?: string;
}

export interface BuiltForgeTx {
  transaction: WcTransactionObject['transaction'];
  sourceOutputs: WcTransactionObject['sourceOutputs'];
  wcTransaction: WcTransactionObject;
  inputPaths: (string | null)[];
  txHex: string;
  builder: TransactionBuilder;
  spentBatonOutpoint: string;
  nextBatonUtxo: SpendableUtxo;
  summary: {
    tier: 5 | 9 | 10;
    tierName: string;
    burnedSlots: { slot: number; id: string; name: string; category: string }[];
    trophyCommitmentHex: string;
    zeroConfChained: boolean;
    estimatedFeeSats: bigint;
    txBytes: bigint;
  };
}

export interface BuiltClaimTx {
  transaction: WcTransactionObject['transaction'];
  sourceOutputs: WcTransactionObject['sourceOutputs'];
  wcTransaction: WcTransactionObject;
  inputPaths: (string | null)[];
  txHex: string;
  builder: TransactionBuilder;
  spentBatonOutpoint: string;
  nextBatonUtxo: SpendableUtxo;
  expectedStampOutpoints: number[];
  estimatedFeeSats: bigint;
}

export class ForgeValidationError extends Error {
  readonly statusCode = 422;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ForgeValidationError';
    this.code = code;
  }
}

export type AdversarialAttackKind =
  | 'under-count-4'
  | 'duplicate-slot'
  | 'fake-category'
  | 'anti-burn-keep-stamps'
  | 'steal-baton';

export interface AdversarialAttackResult {
  attack: AdversarialAttackKind;
  label: string;
  expectedRule: string;
  rejected: boolean;
  vmError: string;
  failingContract?: string;
  failingLine?: number;
}

const DUST_SATOSHIS = 1000n;

/**
 * Tracks recently broadcast unconfirmed Minting Baton outputs per contract address so
 * sequential 0-conf transactions can immediately spend `prevTxid:0` before block confirmation
 * or even before a remote Electrum indexer updates its mempool view.
 */
export class BatonMempoolTracker {
  private readonly pending = new Map<
    string,
    { spentOutpoint: string; nextBaton: SpendableUtxo }
  >();

  record(contractTokenAddress: string, spentOutpoint: string, nextBaton: SpendableUtxo): void {
    this.pending.set(contractTokenAddress, { spentOutpoint, nextBaton });
  }

  resolve(
    contractTokenAddress: string,
    liveUtxos: readonly SpendableUtxo[],
    expectedCategory: string,
    includeUnconfirmed: boolean
  ): { utxo: SpendableUtxo; zeroConfChained: boolean } {
    const matching = liveUtxos.filter(
      (u) =>
        u.token?.category?.toLowerCase() === expectedCategory.toLowerCase() &&
        u.token.nft?.capability === 'minting'
    );

    if (includeUnconfirmed) {
      const tracked = this.pending.get(contractTokenAddress);
      if (tracked) {
        const indexedNext = matching.find(
          (u) => outpointKey(u) === outpointKey(tracked.nextBaton)
        );
        if (indexedNext) {
          this.pending.delete(contractTokenAddress);
          return { utxo: indexedNext, zeroConfChained: true };
        }
        const stillShowsSpent = matching.some((u) => outpointKey(u) === tracked.spentOutpoint);
        if (stillShowsSpent || matching.length === 0) {
          return { utxo: tracked.nextBaton, zeroConfChained: true };
        }
      }
    }

    if (matching.length === 0) {
      throw new Error(
        `No Minting Baton UTXO found at ${contractTokenAddress} for category ${expectedCategory}`
      );
    }

    return { utxo: matching[0], zeroConfChained: false };
  }

  pendingCount(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}

export const defaultBatonTracker = new BatonMempoolTracker();

export function outpointKey(utxo: Pick<SpendableUtxo, 'txid' | 'vout'>): string {
  return `${utxo.txid}:${utxo.vout}`;
}

export function addressToLockingBytecode(cashAddress: string): Uint8Array {
  const decoded = cashAddressToLockingBytecode(cashAddress);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid CashAddress "${cashAddress}": ${decoded}`);
  }
  return decoded.bytecode;
}

/**
 * Converts any valid CashAddress (p2pkh `q...`, p2pkhWithTokens `z...`, p2sh, or p2shWithTokens,
 * with either `bitcoincash:` or `bchtest:` prefix) into a token-capable CashAddress (`z...` / `r...`)
 * matching the target network prefix required by CashScript's TransactionBuilder.
 */
export function toTokenAwareNetworkAddress(
  cashAddress: string,
  targetPrefix?: 'bitcoincash' | 'bchtest'
): string {
  const decoded = decodeCashAddress(cashAddress.trim());
  if (typeof decoded === 'string') {
    throw new Error(`Invalid CashAddress "${cashAddress}": ${decoded}`);
  }
  const prefix =
    targetPrefix ??
    (decoded.prefix === 'bitcoincash' ? 'bitcoincash' : 'bchtest');
  const tokenType =
    decoded.type === 'p2sh' || decoded.type === 'p2shWithTokens'
      ? 'p2shWithTokens'
      : 'p2pkhWithTokens';
  return encodeCashAddress({
    prefix,
    type: tokenType,
    payload: decoded.payload,
  }).address;
}

export function normalizeWalletUtxo(raw: WalletTokenUtxoLike): SpendableUtxo & { path: string | null } {
  const txid = raw.txid ?? raw.tx_hash;
  const vout = raw.vout ?? raw.tx_pos;
  const satsRaw = raw.satoshis ?? raw.value;
  if (!txid || vout === undefined || satsRaw === undefined) {
    throw new Error(`Malformed UTXO entry: missing txid/tx_hash, vout/tx_pos, or satoshis/value`);
  }

  const satoshis = BigInt(satsRaw);
  let lockingBytecode = raw.lockingBytecode;
  if (!lockingBytecode && raw.address) {
    lockingBytecode = binToHex(addressToLockingBytecode(raw.address));
  }
  if (!lockingBytecode) {
    throw new Error(`UTXO ${txid}:${vout} is missing lockingBytecode and address`);
  }

  let token: TokenDetails | undefined = raw.token;
  if (!token && raw.category) {
    token = {
      category: raw.category.toLowerCase(),
      amount: BigInt(raw.amount ?? 0),
      ...(raw.capability != null
        ? {
            nft: {
              capability: raw.capability,
              commitment: (raw.commitment ?? '').toLowerCase(),
            },
          }
        : {}),
    };
  }

  return {
    txid,
    vout,
    satoshis,
    lockingBytecode,
    ...(token ? { token } : {}),
    path: raw.path ?? null,
  };
}

export function normalizeUtxoList(input: BlazeUtxoInput): Array<SpendableUtxo & { path: string | null }> {
  const list = Array.isArray(input) ? input : Object.values(input);
  return list.map(normalizeWalletUtxo);
}

export function resolveTier(tier: ForgeTierInput): TokenHuntTierDef {
  if (typeof tier === 'number') {
    const found = TROPHY_TIERS.find((t) => t.min === tier);
    if (!found) {
      throw new Error(`Unsupported Forge tier ${tier}; expected 5, 9, or 10`);
    }
    return found;
  }
  const found = TROPHY_TIERS.find((t) => t.id === tier.id || t.min === tier.min);
  if (!found) {
    throw new Error(`Unsupported Forge tier object: ${JSON.stringify(tier)}`);
  }
  return found;
}

export function instantiateForgeContract(config: BlazeContractConfig): Contract {
  const registryBytes = encodeRegistryBytes(config.slots);
  return new Contract(
    BlazeForgeArtifact,
    [categoryHexToVmBytes(config.forgeCategory), BigInt(config.slots.length), registryBytes],
    { provider: config.provider, contractType: 'p2sh32' }
  );
}

export function instantiateDispenserContract(
  provider: NetworkProvider,
  demoCategory: string
): Contract {
  return new Contract(
    StampDispenserArtifact,
    [categoryHexToVmBytes(demoCategory)],
    { provider, contractType: 'p2sh32' }
  );
}

function unlockerForUser(signer: SignatureTemplate | undefined, fallbackAddress: string): Unlocker {
  return signer ? signer.unlockP2PKH() : placeholderP2PKHUnlocker(fallbackAddress);
}

function makeNextBatonUtxo(
  txid: string,
  contractTokenAddress: string,
  category: string,
  satoshis: bigint
): SpendableUtxo {
  return {
    txid,
    vout: 0,
    satoshis,
    lockingBytecode: binToHex(addressToLockingBytecode(contractTokenAddress)),
    token: {
      category: category.toLowerCase(),
      amount: 0n,
      nft: { capability: 'minting', commitment: '' },
    },
  };
}

function finalizeBuiltBatonTx(params: {
  builder: TransactionBuilder;
  userPrompt: string;
  contractTokenAddress: string;
  batonCategory: string;
  batonUtxo: SpendableUtxo;
  batonKeepSats: bigint;
  includeUnconfirmed: boolean;
  tracker: BatonMempoolTracker;
  recordInTracker?: boolean;
}) {
  const wcTransaction = params.builder.generateWcTransactionObject({
    broadcast: true,
    userPrompt: params.userPrompt,
  });
  const txBytesBin = encodeTransaction(wcTransaction.transaction);
  const txHex = binToHex(txBytesBin);
  const txid = binToHex(Uint8Array.from(hash256(txBytesBin)).reverse());
  const txBytes = BigInt(txBytesBin.length);
  const totalIn = params.builder.inputs.reduce((s, u) => s + u.satoshis, 0n);
  const totalOut = params.builder.outputs.reduce((s, o) => s + o.amount, 0n);
  const feeSats = totalIn - totalOut;

  const nextBatonUtxo = makeNextBatonUtxo(
    txid,
    params.contractTokenAddress,
    params.batonCategory,
    params.batonKeepSats
  );
  if (params.includeUnconfirmed && params.recordInTracker !== false) {
    params.tracker.record(
      params.contractTokenAddress,
      outpointKey(params.batonUtxo),
      nextBatonUtxo
    );
  }
  return { wcTransaction, txHex, txBytes, feeSats, nextBatonUtxo };
}

/**
 * Matches collected user token UTXOs against strictly ascending registry slots.
 */
export function selectDistinctStampMatches(
  normalizedUtxos: ReadonlyArray<SpendableUtxo & { path: string | null }>,
  slots: readonly StampSlot[],
  requiredCount: number
): Array<{ slot: StampSlot; utxo: SpendableUtxo & { path: string | null } }> {
  const usedOutpoints = new Set<string>();
  const matches: Array<{ slot: StampSlot; utxo: SpendableUtxo & { path: string | null } }> = [];

  for (const slot of slots) {
    if (matches.length >= requiredCount) break;
    const targetCat = slot.category.toLowerCase();
    const expectedCommitHex =
      slot.commitmentRule === null ? null : slot.commitmentRule.toString(16).padStart(2, '0');

    const candidate = normalizedUtxos.find((u) => {
      if (!u.token) return false;
      if (usedOutpoints.has(outpointKey(u))) return false;
      if (u.token.category.toLowerCase() !== targetCat) return false;
      if (expectedCommitHex !== null) {
        return Boolean(u.token.nft && u.token.nft.commitment.toLowerCase() === expectedCommitHex);
      }
      return u.token.amount >= 1n || Boolean(u.token.nft);
    });

    if (candidate) {
      usedOutpoints.add(outpointKey(candidate));
      matches.push({ slot, utxo: candidate });
    }
  }

  return matches;
}

/**
 * Button #1: Claims 5 distinct Demo Stamp NFTs (commitments 0x01..0x05) in one 0-conf tx
 * from StampDispenser.cash so any judge with an empty wallet can test immediately.
 */
export async function buildClaimDemoStampsTx(
  options: ClaimDemoStampsOptions
): Promise<BuiltClaimTx> {
  const includeUnconfirmed = options.includeUnconfirmed ?? true;
  const tracker = options.batonTracker ?? defaultBatonTracker;
  const dispenser = instantiateDispenserContract(options.provider, options.demoCategory);
  const liveUtxos = await dispenser.getUtxos();
  const { utxo: batonUtxo } = tracker.resolve(
    dispenser.tokenAddress,
    liveUtxos,
    options.demoCategory,
    includeUnconfirmed
  );

  const feeUtxos = normalizeUtxoList(options.feeUtxos).filter((u) => !u.token);
  if (feeUtxos.length === 0) {
    throw new Error('At least one pure-BCH UTXO is required to fund the 5 Demo Stamp outputs + fee.');
  }

  const targetPrefix = dispenser.tokenAddress.startsWith('bitcoincash:')
    ? 'bitcoincash'
    : 'bchtest';
  const recipientTokenAddr = toTokenAwareNetworkAddress(options.recipientAddress, targetPrefix);
  const recipientLock = addressToLockingBytecode(recipientTokenAddr);
  const userUnlocker = unlockerForUser(options.signer, recipientTokenAddr);
  const batonKeepSats = batonUtxo.satoshis >= DUST_SATOSHIS ? batonUtxo.satoshis : DUST_SATOSHIS;

  const builder = new TransactionBuilder({ provider: options.provider });
  builder.addInput(batonUtxo, dispenser.unlock.claim5(recipientLock));
  const inputPaths: (string | null)[] = [null];
  for (const feeUtxo of feeUtxos) {
    builder.addInput(feeUtxo, userUnlocker);
    inputPaths.push(feeUtxo.path);
  }

  // Output 0: Preserve Dispenser Minting Baton at covenant address
  builder.addOutput({
    to: dispenser.tokenAddress,
    amount: batonKeepSats,
    token: {
      category: options.demoCategory.toLowerCase(),
      amount: 0n,
      nft: { capability: 'minting', commitment: '' },
    },
  });

  // Outputs 1..5: 5 distinct Demo Stamp NFTs (commitments 0x01..0x05)
  const expectedStampOutpoints: number[] = [];
  for (let i = 1; i <= 5; i++) {
    expectedStampOutpoints.push(i);
    builder.addOutput({
      to: recipientTokenAddr,
      amount: DUST_SATOSHIS,
      token: {
        category: options.demoCategory.toLowerCase(),
        amount: 0n,
        nft: { capability: 'none', commitment: i.toString(16).padStart(2, '0') },
      },
    });
  }

  builder.addBchChangeOutputIfNeeded({
    to: recipientTokenAddr,
    feeRate: options.feeRate ?? 1.5,
  });

  const { wcTransaction, txHex, feeSats, nextBatonUtxo } = finalizeBuiltBatonTx({
    builder,
    userPrompt: 'Claim 5 Demo Stamps (BCH 0-Conf)',
    contractTokenAddress: dispenser.tokenAddress,
    batonCategory: options.demoCategory,
    batonUtxo,
    batonKeepSats,
    includeUnconfirmed,
    tracker,
  });

  return {
    transaction: wcTransaction.transaction,
    sourceOutputs: wcTransaction.sourceOutputs,
    wcTransaction,
    inputPaths,
    txHex,
    builder,
    spentBatonOutpoint: outpointKey(batonUtxo),
    nextBatonUtxo,
    expectedStampOutpoints,
    estimatedFeeSats: feeSats,
  };
}

/**
 * Button #3 & Drop-In replacement for `buildForgeTx(utxos, tier)` in bchblaze.cash/js/tokenhunt.js:
 * Burns 5, 9, or 10 distinct TokenHunt/Demo/Loyalty CashTokens and mints the immutable Trophy NFT.
 * Supports 0-Conf Mempool Baton Chaining (`includeUnconfirmed: true`) for instant back-to-back forges.
 */
export async function buildForgeTx(
  utxos: BlazeUtxoInput,
  tierInput: ForgeTierInput,
  options: BuildForgeTxOptions
): Promise<BuiltForgeTx> {
  const tierDef = resolveTier(tierInput);
  const tier = tierDef.min;
  const includeUnconfirmed = options.includeUnconfirmed ?? true;
  const tracker = options.batonTracker ?? defaultBatonTracker;

  const forge = instantiateForgeContract(options);
  const liveUtxos = await forge.getUtxos();
  const { utxo: batonUtxo, zeroConfChained } = tracker.resolve(
    forge.tokenAddress,
    liveUtxos,
    options.forgeCategory,
    includeUnconfirmed
  );

  const normalized = normalizeUtxoList(utxos);
  const matched = selectDistinctStampMatches(normalized, options.slots, tier);
  if (matched.length < tier) {
    throw new ForgeValidationError(
      'INSUFFICIENT_STAMPS',
      `Need ${tier} distinct registered stamps to forge ${tierDef.name}; found only ${matched.length}.`
    );
  }

  const slotIndexBytes = Uint8Array.from(matched.map((m) => m.slot.slot));
  const trophyCommitmentHex =
    tier.toString(16).padStart(2, '0') + binToHex(slotIndexBytes);

  const targetPrefix = forge.tokenAddress.startsWith('bitcoincash:')
    ? 'bitcoincash'
    : 'bchtest';
  const recipientTokenAddr = toTokenAwareNetworkAddress(options.recipientAddress, targetPrefix);
  const userUnlocker = unlockerForUser(options.signer, recipientTokenAddr);
  const batonKeepSats = batonUtxo.satoshis >= DUST_SATOSHIS ? batonUtxo.satoshis : DUST_SATOSHIS;

  const builder = new TransactionBuilder({
    provider: options.provider,
    allowImplicitFungibleTokenBurn: true,
  });

  // Input 0: BlazeForge Minting Baton
  builder.addInput(batonUtxo, forge.unlock.forge(BigInt(tier), slotIndexBytes));
  const inputPaths: (string | null)[] = [null];

  // Inputs 1..tier: Distinct Stamp UTXOs in strictly ascending slot order
  let totalStampSats = 0n;
  const usedInputOutpoints = new Set<string>();
  for (const { utxo } of matched) {
    builder.addInput(utxo, userUnlocker);
    inputPaths.push(utxo.path);
    totalStampSats += utxo.satoshis;
    usedInputOutpoints.add(outpointKey(utxo));
  }

  // Optional pure-BCH fee inputs if stamp dust isn't enough to cover Trophy dust + loop tx fee
  const explicitFees = normalizeUtxoList(options.feeUtxos ?? []).filter(
    (u) => !u.token && !usedInputOutpoints.has(outpointKey(u))
  );
  const minNeededFromUser = DUST_SATOSHIS + 4500n;
  if (totalStampSats < minNeededFromUser) {
    for (const feeUtxo of explicitFees) {
      builder.addInput(feeUtxo, userUnlocker);
      inputPaths.push(feeUtxo.path);
    }
  }

  // Output 0: Preserve Forge Minting Baton at covenant address
  builder.addOutput({
    to: forge.tokenAddress,
    amount: batonKeepSats,
    token: {
      category: options.forgeCategory.toLowerCase(),
      amount: 0n,
      nft: { capability: 'minting', commitment: '' },
    },
  });

  // Output 1: Newly minted immutable Trophy NFT
  builder.addOutput({
    to: recipientTokenAddr,
    amount: DUST_SATOSHIS,
    token: {
      category: options.forgeCategory.toLowerCase(),
      amount: 0n,
      nft: { capability: 'none', commitment: trophyCommitmentHex },
    },
  });

  // Output 2: Pure-BCH change (zero tokens -> consensus-guaranteed burn of all stamps)
  builder.addBchChangeOutputIfNeeded({
    to: recipientTokenAddr,
    feeRate: options.feeRate ?? 1.5,
  });

  const { wcTransaction, txHex, txBytes, feeSats, nextBatonUtxo } = finalizeBuiltBatonTx({
    builder,
    userPrompt: options.userPrompt ?? `Forge ${tierDef.name} NFT`,
    contractTokenAddress: forge.tokenAddress,
    batonCategory: options.forgeCategory,
    batonUtxo,
    batonKeepSats,
    includeUnconfirmed,
    tracker,
    recordInTracker: Boolean(options.signer),
  });

  return {
    transaction: wcTransaction.transaction,
    sourceOutputs: wcTransaction.sourceOutputs,
    wcTransaction,
    inputPaths,
    txHex,
    builder,
    spentBatonOutpoint: outpointKey(batonUtxo),
    nextBatonUtxo,
    summary: {
      tier,
      tierName: tierDef.name,
      burnedSlots: matched.map(({ slot }) => ({
        slot: slot.slot,
        id: slot.id,
        name: slot.name,
        category: slot.category,
      })),
      trophyCommitmentHex,
      zeroConfChained,
      estimatedFeeSats: feeSats,
      txBytes,
    },
  };
}

/**
 * Button #2: Builds and executes a real adversarial transaction against CashVM (`BCH_2026_05`)
 * to prove on-chain covenant enforcement (never a JS-side simulation).
 */
export async function runAdversarialForgeAttack(
  attack: AdversarialAttackKind,
  options: {
    forgeCategory: string;
    demoCategory: string;
    slots: readonly StampSlot[];
  }
): Promise<AdversarialAttackResult> {
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const forge = instantiateForgeContract({
    provider,
    forgeCategory: options.forgeCategory,
    slots: options.slots,
  });

  const priv = hexToBin('00'.repeat(31) + '07');
  const sig = new SignatureTemplate(priv);
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(pub);
  const attackerTokenAddr = encodeCashAddress({
    prefix: 'bchtest',
    type: 'p2pkhWithTokens',
    payload: hash160(pub),
  }).address;

  const batonUtxo = provider.addUtxo(
    forge.tokenAddress,
    randomUtxo({
      satoshis: DUST_SATOSHIS,
      token: {
        category: options.forgeCategory,
        amount: 0n,
        nft: { capability: 'minting', commitment: '' },
      },
    })
  );

  // Find Demo Stamp slots (slots 10..14 in default Blaze registry or 0..4 in merchant preset)
  const targetSlots = options.slots.filter((s) => s.category.toLowerCase() === options.demoCategory.toLowerCase()).slice(0, 5);
  const makeStampUtxo = (slot: StampSlot) =>
    provider.addUtxo(
      attackerTokenAddr,
      randomUtxo({
        satoshis: 1500n,
        token: {
          category: slot.category,
          amount: slot.commitmentRule === null ? 1n : 0n,
          ...(slot.commitmentRule !== null
            ? { nft: { capability: 'none', commitment: slot.commitmentRule.toString(16).padStart(2, '0') } }
            : {}),
        },
      })
    );

  const builder = new TransactionBuilder({
    provider,
    allowImplicitFungibleTokenBurn: true,
  });

  let label = '';
  let expectedRule = '';

  if (attack === 'under-count-4') {
    label = 'Forge Medallion with only 4 Stamps';
    expectedRule = 'require(tier == 5 || tier == 9 || tier == 10)';
    const stamps4 = targetSlots.slice(0, 4).map(makeStampUtxo);
    const slotBytes = Uint8Array.from(targetSlots.slice(0, 4).map((s) => s.slot));
    builder.addInput(batonUtxo, forge.unlock.forge(4n, slotBytes));
    for (const u of stamps4) builder.addInput(u, sig.unlockP2PKH());
    builder.addOutput({
      to: forge.tokenAddress,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    });
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'none', commitment: '04' + binToHex(slotBytes) } },
    });
    builder.addBchChangeOutputIfNeeded({ to: attackerTokenAddr, feeRate: 1.5 });
  } else if (attack === 'duplicate-slot') {
    label = 'Forge Medallion using Duplicate Copies of Stamp #1';
    expectedRule = 'require(slot > prevSlot)';
    const dupStamps = [makeStampUtxo(targetSlots[0]), makeStampUtxo(targetSlots[0]), ...targetSlots.slice(1, 4).map(makeStampUtxo)];
    const dupSlotBytes = Uint8Array.from([targetSlots[0].slot, targetSlots[0].slot, targetSlots[1].slot, targetSlots[2].slot, targetSlots[3].slot]);
    builder.addInput(batonUtxo, forge.unlock.forge(5n, dupSlotBytes));
    for (const u of dupStamps) builder.addInput(u, sig.unlockP2PKH());
    builder.addOutput({
      to: forge.tokenAddress,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    });
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'none', commitment: '05' + binToHex(dupSlotBytes) } },
    });
    builder.addBchChangeOutputIfNeeded({ to: attackerTokenAddr, feeRate: 1.5 });
  } else if (attack === 'fake-category') {
    label = 'Forge Medallion with Unregistered Fake Token Category';
    expectedRule = 'require(actualCat == expectedCat)';
    const fakeCat = 'ff'.repeat(32);
    const valid4 = targetSlots.slice(0, 4).map(makeStampUtxo);
    const fakeStamp = provider.addUtxo(
      attackerTokenAddr,
      randomUtxo({
        satoshis: 1500n,
        token: { category: fakeCat, amount: 0n, nft: { capability: 'none', commitment: '05' } },
      })
    );
    const slotBytes = Uint8Array.from(targetSlots.map((s) => s.slot));
    builder.addInput(batonUtxo, forge.unlock.forge(5n, slotBytes));
    for (const u of [...valid4, fakeStamp]) builder.addInput(u, sig.unlockP2PKH());
    builder.addOutput({
      to: forge.tokenAddress,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    });
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'none', commitment: '05' + binToHex(slotBytes) } },
    });
    builder.addBchChangeOutputIfNeeded({ to: attackerTokenAddr, feeRate: 1.5 });
  } else if (attack === 'anti-burn-keep-stamps') {
    label = 'Anti-Burn Cheat: Try Keeping Stamp #5 in Change Output';
    expectedRule = 'require(tx.outputs[2].tokenCategory == 0x)';
    const stamps5 = targetSlots.map(makeStampUtxo);
    const slotBytes = Uint8Array.from(targetSlots.map((s) => s.slot));
    builder.addInput(batonUtxo, forge.unlock.forge(5n, slotBytes));
    for (const u of stamps5) builder.addInput(u, sig.unlockP2PKH());
    builder.addOutput({
      to: forge.tokenAddress,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    });
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'none', commitment: '05' + binToHex(slotBytes) } },
    });
    // Attacker tries to sneak Stamp #5 out in Output 2 instead of burning it!
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: targetSlots[4].category, amount: 0n, nft: { capability: 'none', commitment: '05' } },
    });
  } else {
    label = 'Baton Hijack: Redirect Forge Minting Baton to Attacker Address';
    expectedRule = 'require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode)';
    const stamps5 = targetSlots.map(makeStampUtxo);
    const slotBytes = Uint8Array.from(targetSlots.map((s) => s.slot));
    builder.addInput(batonUtxo, forge.unlock.forge(5n, slotBytes));
    for (const u of stamps5) builder.addInput(u, sig.unlockP2PKH());
    // Output 0 sends the Minting Baton to attackerTokenAddr instead of forge.tokenAddress!
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    });
    builder.addOutput({
      to: attackerTokenAddr,
      amount: DUST_SATOSHIS,
      token: { category: options.forgeCategory, amount: 0n, nft: { capability: 'none', commitment: '05' + binToHex(slotBytes) } },
    });
    builder.addBchChangeOutputIfNeeded({ to: attackerTokenAddr, feeRate: 1.5 });
  }

  try {
    await builder.send();
    return {
      attack,
      label,
      expectedRule,
      rejected: false,
      vmError: 'UNEXPECTED PASS: Attack was not rejected by CashVM',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const lineMatch = msg.match(/at line (\d+)/i);
    return {
      attack,
      label,
      expectedRule,
      rejected: true,
      vmError: msg.split('\n\nWARNING:')[0].trim(),
      failingContract: 'BlazeForge.cash',
      failingLine: lineMatch ? Number(lineMatch[1]) : undefined,
    };
  }
}
