import {
  Contract,
  MockNetworkProvider,
  SignatureTemplate,
  randomUtxo,
  type NetworkProvider,
  type SpendableUtxo,
} from 'cashscript';
import {
  binToHex,
  encodeCashAddress,
  hash160,
  hash256,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import { BlazeForgeArtifact, StampDispenserArtifact } from '../artifacts.js';
import {
  BatonMempoolTracker,
  addressToLockingBytecode,
  buildClaimDemoStampsTx,
  buildForgeTx,
  instantiateDispenserContract,
  instantiateForgeContract,
  normalizeUtxoList,
  outpointKey,
  runAdversarialForgeAttack,
  type AdversarialAttackKind,
  type WalletTokenUtxoLike,
} from '../buildForgeTx.js';
import {
  TROPHY_TIERS,
  createBlazeTokenHuntRegistry,
  createMerchantLoyaltyRegistry,
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
} from './types.js';

export interface BlazeBackendServiceOptions {
  provider?: NetworkProvider;
  forgeCategory?: string;
  demoCategory?: string;
  slots?: readonly StampSlot[];
  batonTracker?: BatonMempoolTracker;
  faucetPrivKeyHex?: string;
}

const DEFAULT_FORGE_CATEGORY = 'aa' + '42'.repeat(30) + 'cc';
const DEFAULT_DEMO_CATEGORY = 'dd' + '99'.repeat(30) + 'ee';
const DEFAULT_FAUCET_PRIVKEY = '00'.repeat(31) + '09';

export class BlazeBackendService {
  readonly provider: NetworkProvider;
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

  constructor(options: BlazeBackendServiceOptions = {}) {
    this.startTime = Date.now();
    this.provider =
      options.provider ?? new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    this.forgeCategory = (options.forgeCategory ?? DEFAULT_FORGE_CATEGORY).toLowerCase();
    this.demoCategory = (options.demoCategory ?? DEFAULT_DEMO_CATEGORY).toLowerCase();
    this.slots = options.slots ?? createBlazeTokenHuntRegistry(this.demoCategory);
    this.batonTracker = options.batonTracker ?? new BatonMempoolTracker();

    this.forge = instantiateForgeContract({
      provider: this.provider,
      forgeCategory: this.forgeCategory,
      slots: this.slots,
    });

    this.dispenser = instantiateDispenserContract(this.provider, this.demoCategory);

    const privHex = options.faucetPrivKeyHex ?? DEFAULT_FAUCET_PRIVKEY;
    this.faucetPrivKey = hexToBin(privHex);
    this.faucetSigner = new SignatureTemplate(this.faucetPrivKey);

    const pub = secp256k1.derivePublicKeyCompressed(this.faucetPrivKey);
    if (typeof pub === 'string') {
      throw new Error(`Failed to derive public key: ${pub}`);
    }
    this.faucetAddress = encodeCashAddress({
      prefix: 'bchtest',
      type: 'p2pkhWithTokens',
      payload: hash160(pub),
    }).address;

    this.initContractBatons();
  }

  /**
   * Seeds initial Minting Baton UTXOs in mock provider if none exist.
   */
  private initContractBatons(): void {
    if (this.provider instanceof MockNetworkProvider) {
      // Seed Forge Baton at vout 0
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

      // Seed Dispenser Baton at vout 0
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

      // Seed Faucet UTXO
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
      prefix: 'bchtest',
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

  getHealth(): HealthResponse {
    const forgeBytes = (BlazeForgeArtifact as any).debug?.bytecode?.length
      ? (BlazeForgeArtifact as any).debug.bytecode.length / 2
      : 233;
    const dispenserBytes = (StampDispenserArtifact as any).debug?.bytecode?.length
      ? (StampDispenserArtifact as any).debug.bytecode.length / 2
      : 90;

    return {
      status: 'healthy',
      networkTarget: 'BCH_2026_05',
      contracts: {
        forge: {
          name: 'BlazeForge',
          bytecodeBytes: forgeBytes,
          opcodesCount: BlazeForgeArtifact.bytecode.split(' ').length,
          hasLaylaLoops:
            BlazeForgeArtifact.bytecode.includes('OP_BEGIN') &&
            BlazeForgeArtifact.bytecode.includes('OP_UNTIL'),
          tokenAddress: this.forge.tokenAddress,
        },
        dispenser: {
          name: 'StampDispenser',
          bytecodeBytes: dispenserBytes,
          opcodesCount: StampDispenserArtifact.bytecode.split(' ').length,
          hasLaylaLoops: StampDispenserArtifact.bytecode.includes('OP_BEGIN'),
          tokenAddress: this.dispenser.tokenAddress,
        },
      },
      zeroConfMempool: {
        pendingTrackedOutpoints: (this.batonTracker as any).pending?.size ?? 0,
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

  async getBatonStatus(): Promise<BatonStatusResponse> {
    const forgeUtxos = await this.provider.getUtxos(this.forge.tokenAddress);
    const dispenserUtxos = await this.provider.getUtxos(this.dispenser.tokenAddress);

    let forgeResolved = 'none';
    try {
      const resolved = this.batonTracker.resolve(
        this.forge.tokenAddress,
        forgeUtxos,
        this.forgeCategory,
        true
      );
      forgeResolved = outpointKey(resolved.utxo);
    } catch {
      // no live baton
    }

    let dispenserResolved = 'none';
    try {
      const resolved = this.batonTracker.resolve(
        this.dispenser.tokenAddress,
        dispenserUtxos,
        this.demoCategory,
        true
      );
      dispenserResolved = outpointKey(resolved.utxo);
    } catch {
      // no live baton
    }

    return {
      forge: {
        contractAddress: this.forge.address,
        tokenAddress: this.forge.tokenAddress,
        currentBatonOutpoint: forgeResolved,
      },
      dispenser: {
        contractAddress: this.dispenser.address,
        tokenAddress: this.dispenser.tokenAddress,
        currentBatonOutpoint: dispenserResolved,
      },
      pendingZeroConfChains: (this.batonTracker as any).pending?.size ?? 0,
      zeroConfExplanation:
        'BCH allows spending unconfirmed outputs (includeUnconfirmed: true), enabling sequential 0-conf mints and forges in <2 seconds.',
    };
  }

  async claimDemoStamps(req: ClaimStampsRequest): Promise<ClaimStampsResponse> {
    const startMs = Date.now();
    const recipient = req.recipientAddress;

    // Validate CashAddress
    addressToLockingBytecode(recipient);

    const feeUtxos = await this.ensureFeeUtxos(this.faucetAddress, 25000n);

    // Build the 0-conf claim transaction
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

    const stamps: ClaimedStampItem[] = [1, 2, 3, 4, 5].map((slotNum) => {
      const slotDef = this.slots.find((s) => s.slot === slotNum);
      const commit = slotNum.toString(16).padStart(2, '0');
      return {
        slot: slotNum,
        id: slotDef?.id ?? `slot-${slotNum}`,
        name: slotDef?.name ?? `Demo Stamp #${slotNum}`,
        category: this.demoCategory,
        commitment: commit,
      };
    });

    const elapsed = Date.now() - startMs;

    return {
      success: true,
      txid,
      txHex: claim.txHex,
      stamps,
      spentBatonOutpoint: claim.spentBatonOutpoint,
      nextBatonOutpoint: outpointKey(claim.nextBatonUtxo),
      zeroConfChained: true,
      receipt: {
        executionTimeMs: elapsed,
        txBytes: claim.txHex.length / 2,
        estimatedFeeSats: 1500,
      },
    };
  }

  async forgeTrophy(req: ForgeRequest): Promise<ForgeResponse> {
    const startMs = Date.now();
    const recipient = req.recipientAddress;
    const tier = req.tier;

    if (tier !== 5 && tier !== 9 && tier !== 10) {
      throw new Error(`Unsupported Forge tier ${tier}. Expected 5, 9, or 10`);
    }

    addressToLockingBytecode(recipient);

    // Collect UTXOs: if caller passed explicit utxos, use them. Otherwise fetch from provider.
    let availableUtxos = req.utxos ? normalizeUtxoList(req.utxos) : [];
    if (availableUtxos.length === 0) {
      const providerUtxos = await this.provider.getUtxos(recipient);
      availableUtxos = providerUtxos.map((u) => ({ ...u, path: null }));
    }

    // Ensure fee satoshis
    await this.ensureFeeUtxos(recipient, 25000n);
    const refreshedUtxos = await this.provider.getUtxos(recipient);
    const allUtxos = (req.utxos ? availableUtxos : refreshedUtxos.map((u) => ({ ...u, path: null }))) as unknown as readonly WalletTokenUtxoLike[];

    const signer =
      req.signerPrivKeyHex
        ? new SignatureTemplate(hexToBin(req.signerPrivKeyHex))
        : this.testSigners.get(recipient);

    const built = await buildForgeTx(allUtxos, tier, {
      provider: this.provider,
      forgeCategory: this.forgeCategory,
      demoCategory: this.demoCategory,
      slots: this.slots,
      recipientAddress: recipient,
      signer,
      batonTracker: this.batonTracker,
      includeUnconfirmed: true,
    });

    let txid = binToHex(Uint8Array.from(hash256(hexToBin(built.txHex))).reverse());
    if (req.autoBroadcast !== false && signer) {
      const sent = await built.builder.send();
      txid = sent.txid;
    }

    const elapsed = Date.now() - startMs;

    return {
      success: true,
      txid,
      txHex: built.txHex,
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
        executionTimeMs: elapsed,
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

    const elapsed = Date.now() - startMs;

    return {
      attack: result.attack,
      label: result.label,
      expectedRule: result.expectedRule,
      rejected: result.rejected,
      failingContract: result.failingContract,
      failingLine: result.failingLine,
      vmError: result.vmError,
      receipt: {
        executionTimeMs: elapsed,
        adversarialRefusalVerified: result.rejected,
      },
    };
  }
}
