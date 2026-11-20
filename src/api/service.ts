import { randomBytes } from 'node:crypto';
import {
  Contract,
  ElectrumNetworkProvider,
  MockNetworkProvider,
  SignatureTemplate,
  randomUtxo,
  type NetworkProvider,
  type SpendableUtxo,
} from 'cashscript';
import type { Artifact } from '@cashscript/utils';
import {
  binToHex,
  encodeCashAddress,
  hash160,
  hash256,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import { BlazeForgeArtifact, StampDispenserArtifact } from '../artifacts.js';
import { loadAppConfig, type BchNetworkMode } from '../config.js';
import {
  BatonMempoolTracker,
  ForgeValidationError,
  addressToLockingBytecode,
  buildClaimDemoStampsTx,
  buildForgeTx,
  instantiateDispenserContract,
  instantiateForgeContract,
  normalizeUtxoList,
  outpointKey,
  runAdversarialForgeAttack,
  toTokenAwareNetworkAddress,
  type WalletTokenUtxoLike,
} from '../buildForgeTx.js';
import {
  TROPHY_TIERS,
  createBlazeTokenHuntRegistry,
  type StampSlot,
} from '../registry.js';
import type {
  AttackRequest,
  AttackResponse,
  BatonStatusResponse,
  ClaimStampsRequest,
  ClaimStampsResponse,
  ClaimedStampItem,
  ForgeRequest,
  ForgeResponse,
  HealthResponse,
  RegistryResponse,
  WalletDemoResponse,
  WalletOverviewResponse,
  WalletStampItem,
  WalletTrophyItem,
} from './types.js';

export class PrivateKeyRejectedError extends Error {
  readonly statusCode = 400;
  readonly code = 'PRIVATE_KEY_NOT_ALLOWED';

  constructor(
    message = 'signerPrivKeyHex over HTTP is only permitted in mock or explicit local-signing test mode; sign transactions client-side via wcTransaction.'
  ) {
    super(message);
    this.name = 'PrivateKeyRejectedError';
  }
}

export interface BlazeBackendServiceOptions {
  provider?: NetworkProvider;
  networkMode?: BchNetworkMode;
  forgeCategory?: string;
  demoCategory?: string;
  slots?: readonly StampSlot[];
  batonTracker?: BatonMempoolTracker;
  faucetPrivKeyHex?: string;
  allowUnsafeLocalSigning?: boolean;
}

function getTemplateBytecodeBytes(artifact: Artifact): number {
  const hex = artifact.debug?.bytecode;
  if (typeof hex === 'string' && hex.length > 0) {
    return Math.floor(hex.length / 2);
  }
  return artifact.bytecode.split(/\s+/).filter(Boolean).length;
}

function getArtifactOpcodeCount(artifact: Artifact): number {
  return artifact.bytecode.split(/\s+/).filter(Boolean).length;
}

export class BlazeBackendService {
  readonly provider: NetworkProvider;
  readonly networkMode: BchNetworkMode;
  readonly isMockMode: boolean;
  readonly allowUnsafeLocalSigning: boolean;
  readonly forgeCategory: string;
  readonly demoCategory: string;
  readonly slots: readonly StampSlot[];
  readonly batonTracker: BatonMempoolTracker;
  readonly forge: Contract;
  readonly dispenser: Contract;

  private readonly faucetPrivKey: Uint8Array;
  private readonly faucetSigner: SignatureTemplate;
  private readonly faucetAddress: string;
  private readonly testSigners = new Map<string, SignatureTemplate>();
  private readonly startTime: number;
  private sandboxWalletCount = 0;

  constructor(options: BlazeBackendServiceOptions = {}) {
    const config = loadAppConfig();
    this.startTime = Date.now();
    this.networkMode = options.networkMode ?? config.bchNetwork;

    if (options.provider) {
      this.provider = options.provider;
    } else if (this.networkMode === 'mock') {
      this.provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    } else {
      this.provider = new ElectrumNetworkProvider(this.networkMode);
    }

    this.isMockMode = this.provider instanceof MockNetworkProvider;
    this.allowUnsafeLocalSigning =
      options.allowUnsafeLocalSigning ?? config.allowUnsafeLocalSigning;

    this.forgeCategory = (options.forgeCategory ?? config.forgeCategory).toLowerCase();
    this.demoCategory = (options.demoCategory ?? config.demoCategory).toLowerCase();
    this.slots =
      options.slots ??
      createBlazeTokenHuntRegistry(this.demoCategory, config.tokenHuntOverrides);
    this.batonTracker = options.batonTracker ?? new BatonMempoolTracker();

    this.forge = instantiateForgeContract({
      provider: this.provider,
      forgeCategory: this.forgeCategory,
      slots: this.slots,
    });

    this.dispenser = instantiateDispenserContract(this.provider, this.demoCategory);

    const privHex = (options.faucetPrivKeyHex ?? config.faucetPrivKeyHex).toLowerCase();
    this.faucetPrivKey = hexToBin(privHex);
    this.faucetSigner = new SignatureTemplate(this.faucetPrivKey);

    const pub = secp256k1.derivePublicKeyCompressed(this.faucetPrivKey);
    if (typeof pub === 'string') {
      throw new Error(`Failed to derive public key: ${pub}`);
    }
    const addrPrefix = this.networkMode === 'mainnet' ? 'bitcoincash' : 'bchtest';
    this.faucetAddress = encodeCashAddress({
      prefix: addrPrefix,
      type: 'p2pkhWithTokens',
      payload: hash160(pub),
    }).address;

    this.initContractBatons();
  }

  private addressPrefix(): 'bitcoincash' | 'bchtest' {
    return this.networkMode === 'mainnet' ? 'bitcoincash' : 'bchtest';
  }

  /**
   * Seeds initial Minting Baton UTXOs in mock provider if running locally in sandbox mode.
   */
  private initContractBatons(): void {
    if (this.provider instanceof MockNetworkProvider) {
      this.provider.addUtxo(
        this.forge.tokenAddress,
        randomUtxo({
          vout: 0,
          satoshis: 1000n,
          token: {
            category: this.forgeCategory,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
          },
        })
      );

      this.provider.addUtxo(
        this.dispenser.tokenAddress,
        randomUtxo({
          vout: 0,
          satoshis: 1000n,
          token: {
            category: this.demoCategory,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' },
          },
        })
      );

      this.provider.addUtxo(
        this.faucetAddress,
        randomUtxo({
          satoshis: 1_000_000n,
        })
      );
    }
  }

  registerTestSigner(address: string, signer: SignatureTemplate): void {
    this.testSigners.set(address, signer);
  }

  registerTestPrivKey(privKeyHex: string): string {
    const priv = hexToBin(privKeyHex);
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') throw new Error(pub);
    const addr = encodeCashAddress({
      prefix: this.addressPrefix(),
      type: 'p2pkhWithTokens',
      payload: hash160(pub),
    }).address;
    this.testSigners.set(addr, new SignatureTemplate(priv));
    return addr;
  }

  async ensureFeeUtxos(address: string, requiredSats: bigint = 25000n): Promise<SpendableUtxo[]> {
    const existing = await this.provider.getUtxos(address);
    const pureBch = existing.filter((u) => !u.token && u.satoshis >= 1500n);
    const total = pureBch.reduce((sum, u) => sum + u.satoshis, 0n);

    if (total >= requiredSats) {
      return pureBch;
    }

    if (this.provider instanceof MockNetworkProvider) {
      const needed = requiredSats - total + 20000n;
      const funded = this.provider.addUtxo(
        address,
        randomUtxo({
          satoshis: needed > 50000n ? needed : 50000n,
        })
      );
      return [...pureBch, funded];
    }

    return pureBch;
  }

  /**
   * Provisions an ephemeral sandbox wallet inside MockNetworkProvider so UI users
   * can test 1-click claiming, forging, and 0-conf multi-user baton handoffs
   * without sending private keys over HTTP.
   */
  async createDemoWallet(): Promise<WalletDemoResponse> {
    if (!this.isMockMode) {
      throw new ForgeValidationError(
        'SANDBOX_WALLET_UNAVAILABLE',
        'Demo sandbox wallets are only available when BCH_NETWORK=mock. Connect or enter your own CashAddress instead.'
      );
    }

    let priv = randomBytes(32);
    let pub = secp256k1.derivePublicKeyCompressed(priv);
    while (typeof pub === 'string') {
      priv = randomBytes(32);
      pub = secp256k1.derivePublicKeyCompressed(priv);
    }

    const address = encodeCashAddress({
      prefix: this.addressPrefix(),
      type: 'p2pkhWithTokens',
      payload: hash160(pub),
    }).address;

    this.testSigners.set(address, new SignatureTemplate(priv));
    const funded = (this.provider as MockNetworkProvider).addUtxo(
      address,
      randomUtxo({ satoshis: 50_000n })
    );

    this.sandboxWalletCount += 1;
    return {
      address,
      label: `Sandbox #${this.sandboxWalletCount}`,
      mode: 'sandbox',
      bchSatoshis: Number(funded.satoshis),
    };
  }

  /**
   * Inspects live UTXOs for any CashAddress, classifying held registered Stamp slots,
   * previously forged Trophy NFTs, pure BCH balance, and eligible tiers.
   */
  async getWalletOverview(address: string): Promise<WalletOverviewResponse> {
    const normalizedAddr = toTokenAwareNetworkAddress(address, this.addressPrefix());
    const utxos = await this.provider.getUtxos(normalizedAddr);

    let bchSatoshis = 0n;
    const stamps: WalletStampItem[] = [];
    const trophies: WalletTrophyItem[] = [];
    const distinctSlots = new Set<number>();

    for (const u of utxos) {
      if (!u.token) {
        bchSatoshis += u.satoshis;
        continue;
      }

      const cat = u.token.category.toLowerCase();
      if (cat === this.forgeCategory && u.token.nft?.capability === 'none') {
        const commitmentHex = (u.token.nft.commitment ?? '').toLowerCase();
        const bytes = hexToBin(commitmentHex);
        const tier = bytes.length > 0 ? bytes[0] : 0;
        const burnedSlots = Array.from(bytes.slice(1));
        const tierDef = TROPHY_TIERS.find((t) => t.min === tier);
        trophies.push({
          tier,
          tierName: tierDef?.name ?? `Tier ${tier} Trophy`,
          category: cat,
          commitmentHex,
          burnedSlots,
          txid: u.txid,
          vout: u.vout,
          satoshis: Number(u.satoshis),
        });
        continue;
      }

      const commitHex = u.token.nft?.commitment?.toLowerCase() ?? '';
      const matchedSlot = this.slots.find((slot) => {
        if (slot.category.toLowerCase() !== cat) return false;
        if (slot.commitmentRule === null) {
          return u.token!.amount >= 1n || Boolean(u.token!.nft);
        }
        const expectedCommit = slot.commitmentRule.toString(16).padStart(2, '0');
        return Boolean(u.token!.nft && commitHex === expectedCommit);
      });

      if (matchedSlot) {
        distinctSlots.add(matchedSlot.slot);
        stamps.push({
          slot: matchedSlot.slot,
          id: matchedSlot.id,
          name: matchedSlot.name,
          kind: matchedSlot.kind,
          category: cat,
          commitment: commitHex,
          txid: u.txid,
          vout: u.vout,
          satoshis: Number(u.satoshis),
        });
      }
    }

    stamps.sort((a, b) => a.slot - b.slot);
    const eligibleTiers = TROPHY_TIERS
      .filter((t) => distinctSlots.size >= t.min)
      .map((t) => t.min);

    return {
      address: normalizedAddr,
      mode: this.testSigners.has(normalizedAddr) ? 'sandbox' : 'external',
      bchSatoshis: Number(bchSatoshis),
      utxoCount: utxos.length,
      stamps,
      trophies,
      eligibleTiers,
    };
  }

  getHealth(): HealthResponse {
    return {
      status: 'healthy',
      networkMode: this.networkMode,
      networkTarget: 'BCH_2026_05',
      contracts: {
        forge: {
          name: 'BlazeForge',
          bytecodeBytes: getTemplateBytecodeBytes(BlazeForgeArtifact),
          opcodesCount: getArtifactOpcodeCount(BlazeForgeArtifact),
          redeemScriptBytes: this.forge.bytesize,
          redeemOpcodesCount: this.forge.opcount,
          hasLaylaLoops:
            BlazeForgeArtifact.bytecode.includes('OP_BEGIN') &&
            BlazeForgeArtifact.bytecode.includes('OP_UNTIL'),
          tokenAddress: this.forge.tokenAddress,
        },
        dispenser: {
          name: 'StampDispenser',
          bytecodeBytes: getTemplateBytecodeBytes(StampDispenserArtifact),
          opcodesCount: getArtifactOpcodeCount(StampDispenserArtifact),
          redeemScriptBytes: this.dispenser.bytesize,
          redeemOpcodesCount: this.dispenser.opcount,
          hasLaylaLoops: StampDispenserArtifact.bytecode.includes('OP_BEGIN'),
          tokenAddress: this.dispenser.tokenAddress,
        },
      },
      zeroConfMempool: {
        pendingTrackedOutpoints: this.batonTracker.pendingCount(),
        explanation:
          'Powered by BCH 0-Conf Covenant Chaining: spent baton outputs chain directly in mempool without waiting 10 minutes for block confirmation.',
      },
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  getRegistry(): RegistryResponse {
    return {
      forgeCategory: this.forgeCategory,
      demoCategory: this.demoCategory,
      slots: this.slots,
      tiers: TROPHY_TIERS,
      presetCategories: {
        tokenhunt: this.slots.map((s) => s.category),
        paytacaLoyalty: [this.demoCategory],
      },
    };
  }

  private resolveSafeBatonOutpoint(
    tokenAddress: string,
    utxos: readonly SpendableUtxo[],
    category: string
  ): string {
    try {
      const resolved = this.batonTracker.resolve(tokenAddress, utxos, category, true);
      return outpointKey(resolved.utxo);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('No Minting Baton UTXO found')) {
        return 'none';
      }
      throw err;
    }
  }

  async getBatonStatus(): Promise<BatonStatusResponse> {
    const [forgeUtxos, dispenserUtxos] = await Promise.all([
      this.provider.getUtxos(this.forge.tokenAddress),
      this.provider.getUtxos(this.dispenser.tokenAddress),
    ]);

    return {
      forge: {
        contractAddress: this.forge.address,
        tokenAddress: this.forge.tokenAddress,
        currentBatonOutpoint: this.resolveSafeBatonOutpoint(
          this.forge.tokenAddress,
          forgeUtxos,
          this.forgeCategory
        ),
      },
      dispenser: {
        contractAddress: this.dispenser.address,
        tokenAddress: this.dispenser.tokenAddress,
        currentBatonOutpoint: this.resolveSafeBatonOutpoint(
          this.dispenser.tokenAddress,
          dispenserUtxos,
          this.demoCategory
        ),
      },
      pendingZeroConfChains: this.batonTracker.pendingCount(),
      zeroConfExplanation:
        'BCH allows spending unconfirmed outputs (includeUnconfirmed: true), enabling sequential 0-conf mints and forges in <2 seconds.',
    };
  }

  async claimDemoStamps(req: ClaimStampsRequest): Promise<ClaimStampsResponse> {
    const startMs = Date.now();
    const recipient = toTokenAwareNetworkAddress(req.recipientAddress, this.addressPrefix());

    const feeUtxos = await this.ensureFeeUtxos(this.faucetAddress, 25000n);

    const claim = await buildClaimDemoStampsTx({
      provider: this.provider,
      forgeCategory: this.forgeCategory,
      demoCategory: this.demoCategory,
      slots: this.slots,
      recipientAddress: recipient,
      feeUtxos,
      signer: this.faucetSigner,
      batonTracker: this.batonTracker,
      includeUnconfirmed: true,
    });

    let txid = binToHex(Uint8Array.from(hash256(hexToBin(claim.txHex))).reverse());
    if (req.autoBroadcast !== false) {
      const sent = await claim.builder.send();
      txid = sent.txid;
    }

    const demoSlots = this.slots.filter((s) => s.kind === 'demo');
    const stamps: ClaimedStampItem[] = [1, 2, 3, 4, 5].map((commitNum, idx) => {
      const slotDef =
        demoSlots.find((s) => s.commitmentRule === commitNum) ?? demoSlots[idx];
      const commit = commitNum.toString(16).padStart(2, '0');
      return {
        slot: slotDef?.slot ?? 10 + idx,
        id: slotDef?.id ?? `demo-stamp-${commitNum}`,
        name: slotDef?.name ?? `Demo Stamp #${commitNum}`,
        category: this.demoCategory,
        commitment: commit,
      };
    });

    return {
      success: true,
      txid,
      txHex: claim.txHex,
      stamps,
      spentBatonOutpoint: claim.spentBatonOutpoint,
      nextBatonOutpoint: outpointKey(claim.nextBatonUtxo),
      zeroConfChained: true,
      receipt: {
        executionTimeMs: Date.now() - startMs,
        txBytes: claim.txHex.length / 2,
        estimatedFeeSats: Number(claim.estimatedFeeSats),
      },
    };
  }

  async forgeTrophy(req: ForgeRequest): Promise<ForgeResponse> {
    const startMs = Date.now();
    const recipient = req.recipientAddress;
    const tier = req.tier;

    if (tier !== 5 && tier !== 9 && tier !== 10) {
      throw new ForgeValidationError(
        'INVALID_TIER',
        `Unsupported Forge tier ${tier}. Expected 5, 9, or 10`
      );
    }

    if (req.signerPrivKeyHex && !this.isMockMode && !this.allowUnsafeLocalSigning) {
      throw new PrivateKeyRejectedError();
    }

    const normalizedRecipient = toTokenAwareNetworkAddress(recipient, this.addressPrefix());

    const feeUtxos = await this.ensureFeeUtxos(normalizedRecipient, 25000n);
    const stampInputs: WalletTokenUtxoLike[] =
      req.utxos && req.utxos.length > 0
        ? normalizeUtxoList(req.utxos)
        : (await this.provider.getUtxos(normalizedRecipient)).map((u) => ({ ...u, path: null }));

    const signer = req.signerPrivKeyHex
      ? new SignatureTemplate(hexToBin(req.signerPrivKeyHex))
      : this.testSigners.get(normalizedRecipient);

    const built = await buildForgeTx(stampInputs, tier, {
      provider: this.provider,
      forgeCategory: this.forgeCategory,
      demoCategory: this.demoCategory,
      slots: this.slots,
      recipientAddress: normalizedRecipient,
      feeUtxos,
      signer,
      batonTracker: this.batonTracker,
      includeUnconfirmed: true,
    });

    let broadcasted = false;
    let txid = binToHex(Uint8Array.from(hash256(hexToBin(built.txHex))).reverse());
    if (req.autoBroadcast !== false && signer) {
      const sent = await built.builder.send();
      txid = sent.txid;
      broadcasted = true;
    }

    return {
      success: true,
      broadcasted,
      txid,
      txHex: built.txHex,
      ...(broadcasted
        ? {}
        : {
            wcTransaction: built.wcTransaction,
            inputPaths: built.inputPaths,
          }),
      trophy: {
        tier,
        tierName: built.summary.tierName,
        category: this.forgeCategory,
        commitmentHex: built.summary.trophyCommitmentHex,
        burnedStampCount: built.summary.burnedSlots.length,
      },
      summary: built.summary,
      spentBatonOutpoint: built.spentBatonOutpoint,
      nextBatonOutpoint: outpointKey(built.nextBatonUtxo),
      zeroConfChained: built.summary.zeroConfChained,
      receipt: {
        executionTimeMs: Date.now() - startMs,
        txBytes: Number(built.summary.txBytes),
      },
    };
  }

  async runAttack(req: AttackRequest): Promise<AttackResponse> {
    const startMs = Date.now();
    const result = await runAdversarialForgeAttack(req.attackType, {
      forgeCategory: this.forgeCategory,
      demoCategory: this.demoCategory,
      slots: this.slots,
    });

    return {
      attack: result.attack,
      label: result.label,
      expectedRule: result.expectedRule,
      rejected: result.rejected,
      failingContract: result.failingContract,
      failingLine: result.failingLine,
      vmError: result.vmError,
      receipt: {
        executionTimeMs: Date.now() - startMs,
        adversarialRefusalVerified: result.rejected,
      },
    };
  }
}
