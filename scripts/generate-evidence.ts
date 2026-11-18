import { mkdirSync, writeFileSync } from 'node:fs';
import { MockNetworkProvider, SignatureTemplate, randomUtxo } from 'cashscript';
import { encodeCashAddress, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import { BlazeForgeArtifact, StampDispenserArtifact } from '../src/artifacts.js';
import {
  BatonMempoolTracker,
  buildClaimDemoStampsTx,
  buildForgeTx,
  instantiateDispenserContract,
  instantiateForgeContract,
  runAdversarialForgeAttack,
  type AdversarialAttackKind,
} from '../src/buildForgeTx.js';
import { createBlazeTokenHuntRegistry } from '../src/registry.js';

const FORGE_CAT = 'aa' + '42'.repeat(30) + 'cc';
const DEMO_CAT = 'dd' + '99'.repeat(30) + 'ee';

function makeWallet(byteHex: string) {
  const priv = hexToBin('00'.repeat(31) + byteHex);
  const signer = new SignatureTemplate(priv);
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(pub);
  const address = encodeCashAddress({
    prefix: 'bchtest',
    type: 'p2pkhWithTokens',
    payload: hash160(pub),
  }).address;
  return { signer, address };
}

async function main() {
  const startedAt = new Date().toISOString();
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const tracker = new BatonMempoolTracker();
  const slots = createBlazeTokenHuntRegistry(DEMO_CAT);

  const forge = instantiateForgeContract({ provider, forgeCategory: FORGE_CAT, slots });
  const dispenser = instantiateDispenserContract(provider, DEMO_CAT);

  provider.addUtxo(
    forge.tokenAddress,
    randomUtxo({ satoshis: 1000n, token: { category: FORGE_CAT, amount: 0n, nft: { capability: 'minting', commitment: '' } } })
  );
  provider.addUtxo(
    dispenser.tokenAddress,
    randomUtxo({ satoshis: 1000n, token: { category: DEMO_CAT, amount: 0n, nft: { capability: 'minting', commitment: '' } } })
  );

  // 1. Run Button #1 -> Button #3 (5-Stamp Medallion)
  const w1 = makeWallet('11');
  const fee1 = provider.addUtxo(w1.address, randomUtxo({ satoshis: 30000n }));
  const claimBuilt = await buildClaimDemoStampsTx({
    provider,
    forgeCategory: FORGE_CAT,
    demoCategory: DEMO_CAT,
    slots,
    recipientAddress: w1.address,
    feeUtxos: [fee1],
    signer: w1.signer,
    batonTracker: tracker,
  });
  const claimUsage = claimBuilt.builder.getVmResourceUsage();
  const claimTx = await claimBuilt.builder.send();

  const stamps1 = (await provider.getUtxos(w1.address)).filter((u) => u.token?.category === DEMO_CAT);
  const forge5Built = await buildForgeTx(stamps1, 5, {
    provider,
    forgeCategory: FORGE_CAT,
    slots,
    recipientAddress: w1.address,
    signer: w1.signer,
    batonTracker: tracker,
  });
  const forge5Usage = forge5Built.builder.getVmResourceUsage();
  const forge5Tx = await forge5Built.builder.send();

  // 2. Run Tier 9 (BLAZE Trophy) & Tier 10 (Trailblazer Trophy) chained onto the SAME unconfirmed baton!
  const w2 = makeWallet('12');
  const stamps9 = slots.slice(0, 9).map((s) =>
    provider.addUtxo(w2.address, randomUtxo({ satoshis: 1500n, token: { category: s.category, amount: 1n } }))
  );
  const forge9Built = await buildForgeTx(stamps9, 9, {
    provider,
    forgeCategory: FORGE_CAT,
    slots,
    recipientAddress: w2.address,
    signer: w2.signer,
    batonTracker: tracker,
  });
  const forge9Usage = forge9Built.builder.getVmResourceUsage();
  const forge9Tx = await forge9Built.builder.send();

  const w3 = makeWallet('13');
  const stamps10 = slots.slice(0, 10).map((s) =>
    provider.addUtxo(w3.address, randomUtxo({ satoshis: 1500n, token: { category: s.category, amount: 1n } }))
  );
  const forge10Built = await buildForgeTx(stamps10, 10, {
    provider,
    forgeCategory: FORGE_CAT,
    slots,
    recipientAddress: w3.address,
    signer: w3.signer,
    batonTracker: tracker,
  });
  const forge10Usage = forge10Built.builder.getVmResourceUsage();
  const forge10Tx = await forge10Built.builder.send();

  // 3. Run all 5 adversarial CashVM attack vectors
  const attacks: AdversarialAttackKind[] = [
    'under-count-4',
    'duplicate-slot',
    'fake-category',
    'anti-burn-keep-stamps',
    'steal-baton',
  ];
  const adversarialResults = [];
  for (const kind of attacks) {
    adversarialResults.push(
      await runAdversarialForgeAttack(kind, {
        forgeCategory: FORGE_CAT,
        demoCategory: DEMO_CAT,
        slots,
      })
    );
  }

  const report = {
    generatedAt: startedAt,
    vmTarget: 'BCH_2026_05',
    contracts: {
      BlazeForge: {
        addressType: 'p2sh32',
        bytesize: forge.bytesize,
        opcount: forge.opcount,
        usesLaylaLoops:
          BlazeForgeArtifact.bytecode.includes('OP_BEGIN') &&
          BlazeForgeArtifact.bytecode.includes('OP_UNTIL'),
      },
      StampDispenser: {
        addressType: 'p2sh32',
        bytesize: dispenser.bytesize,
        opcount: dispenser.opcount,
        usesLaylaLoops:
          StampDispenserArtifact.bytecode.includes('OP_BEGIN') &&
          StampDispenserArtifact.bytecode.includes('OP_UNTIL'),
      },
    },
    runs: [
      {
        action: 'Button #1: StampDispenser.claim5 (5 Demo Stamps)',
        txid: claimTx.txid,
        txBytes: claimBuilt.txHex.length / 2,
        covenantOpCost: claimUsage[0].operationCost,
        maxOpCost: claimUsage[0].maximumOperationCost,
      },
      {
        action: 'Button #3: BlazeForge.forge Tier 5 (0-Conf Chained Medallion)',
        txid: forge5Tx.txid,
        txBytes: Number(forge5Built.summary.txBytes),
        feeSats: Number(forge5Built.summary.estimatedFeeSats),
        zeroConfChained: forge5Built.summary.zeroConfChained,
        covenantOpCost: forge5Usage[0].operationCost,
        maxOpCost: forge5Usage[0].maximumOperationCost,
      },
      {
        action: 'BlazeForge.forge Tier 9 (BLAZE Trophy, 0-Conf Chained)',
        txid: forge9Tx.txid,
        txBytes: Number(forge9Built.summary.txBytes),
        feeSats: Number(forge9Built.summary.estimatedFeeSats),
        zeroConfChained: forge9Built.summary.zeroConfChained,
        covenantOpCost: forge9Usage[0].operationCost,
        maxOpCost: forge9Usage[0].maximumOperationCost,
      },
      {
        action: 'BlazeForge.forge Tier 10 (Trailblazer Trophy, 0-Conf Chained)',
        txid: forge10Tx.txid,
        txBytes: Number(forge10Built.summary.txBytes),
        feeSats: Number(forge10Built.summary.estimatedFeeSats),
        zeroConfChained: forge10Built.summary.zeroConfChained,
        covenantOpCost: forge10Usage[0].operationCost,
        maxOpCost: forge10Usage[0].maximumOperationCost,
      },
    ],
    adversarialRejections: adversarialResults,
    summary: {
      totalAdversarialAttacks: adversarialResults.length,
      attacksRejected: adversarialResults.filter((r) => r.rejected).length,
      allRejected: adversarialResults.every((r) => r.rejected),
    },
  };

  mkdirSync('evidence', { recursive: true });
  writeFileSync('evidence/report.json', JSON.stringify(report, null, 2));
  console.log('Generated evidence/report.json');
  console.log(
    `Verified ${report.runs.length}/4 positive CashVM runs + ${report.summary.attacksRejected}/${report.summary.totalAdversarialAttacks} adversarial rejections.`
  );
  if (!report.summary.allRejected) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('EVIDENCE FAIL:', err);
  process.exit(1);
});
