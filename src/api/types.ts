import type {
  AdversarialAttackKind,
  AdversarialAttackResult,
  BuiltForgeTx,
  WalletTokenUtxoLike,
} from '../buildForgeTx.js';
import type { StampSlot, TokenHuntTierDef, TROPHY_TIERS } from '../registry.js';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthContractInfo {
  name: string;
  bytecodeBytes: number;
  opcodesCount: number;
  hasLaylaLoops: boolean;
  tokenAddress: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  networkTarget: string;
  contracts: {
    forge: HealthContractInfo;
    dispenser: HealthContractInfo;
  };
  zeroConfMempool: {
    pendingTrackedOutpoints: number;
    explanation: string;
  };
  uptimeSeconds: number;
  timestamp: string;
}

export interface RegistryResponse {
  forgeCategory: string;
  demoCategory: string;
  slots: readonly StampSlot[];
  tiers: typeof TROPHY_TIERS;
  presetCategories: {
    tokenhunt: string[];
    paytacaLoyalty: string[];
  };
}

export interface BatonStatusResponse {
  forge: {
    contractAddress: string;
    tokenAddress: string;
    currentBatonOutpoint: string;
  };
  dispenser: {
    contractAddress: string;
    tokenAddress: string;
    currentBatonOutpoint: string;
  };
  pendingZeroConfChains: number;
  zeroConfExplanation: string;
}

export interface ClaimStampsRequest {
  recipientAddress: string;
  autoBroadcast?: boolean;
  signerPrivKeyHex?: string;
}

export interface ClaimedStampItem {
  slot: number;
  id: string;
  name: string;
  category: string;
  commitment: string;
}

export interface ClaimStampsResponse {
  success: boolean;
  txid: string;
  txHex: string;
  stamps: ClaimedStampItem[];
  spentBatonOutpoint: string;
  nextBatonOutpoint: string;
  zeroConfChained: boolean;
  receipt: {
    executionTimeMs: number;
    txBytes: number;
    estimatedFeeSats: number;
  };
}

export interface ForgeRequest {
  tier: 5 | 9 | 10;
  recipientAddress: string;
  autoBroadcast?: boolean;
  signerPrivKeyHex?: string;
  utxos?: WalletTokenUtxoLike[];
}

export interface ForgeResponse {
  success: boolean;
  txid: string;
  txHex: string;
  trophy: {
    tier: 5 | 9 | 10;
    tierName: string;
    category: string;
    commitmentHex: string;
    burnedStampCount: number;
  };
  summary: BuiltForgeTx['summary'];
  spentBatonOutpoint: string;
  nextBatonOutpoint: string;
  zeroConfChained: boolean;
  receipt: {
    executionTimeMs: number;
    txBytes: number;
  };
}

export interface AttackRequest {
  attackType: AdversarialAttackKind;
}

export interface AttackResponse {
  attack: AdversarialAttackKind;
  label: string;
  expectedRule: string;
  rejected: boolean;
  failingContract?: string;
  failingLine?: number;
  vmError: string;
  receipt: {
    executionTimeMs: number;
    adversarialRefusalVerified: boolean;
  };
}
