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
} from '../src/buildForgeTx.js';
import { createBlazeTokenHuntRegistry } from '../src/registry.js';

const FORGE_CAT = 'aa' + '42'.repeat(30) + 'cc';
const DEMO_CAT = 'dd' + '99'.repeat(30) + 'ee';

async function main() {
  if (!BlazeForgeArtifact.bytecode.includes('OP_BEGIN') || !BlazeForgeArtifact.bytecode.includes('OP_UNTIL')) {
    throw new Error('BlazeForge artifact missing Layla OP_BEGIN/OP_UNTIL loop opcodes');
  }
  if (!StampDispenserArtifact.bytecode.includes('OP_BEGIN')) {
    throw new Error('StampDispenser artifact missing Layla OP_BEGIN loop opcode');
  }

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

  const priv = hexToBin('00'.repeat(31) + '09');
  const signer = new SignatureTemplate(priv);
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(pub);
  const userAddr = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkhWithTokens', payload: hash160(pub) }).address;
  const feeUtxo = provider.addUtxo(userAddr, randomUtxo({ satoshis: 25000n }));

  // Button 1
  const claim = await buildClaimDemoStampsTx({
    provider,
    forgeCategory: FORGE_CAT,
    demoCategory: DEMO_CAT,
    slots,
    recipientAddress: userAddr,
    feeUtxos: [feeUtxo],
    signer,
    batonTracker: tracker,
  });
  const claimTx = await claim.builder.send();

  // Button 3 (0-Conf Chained)
  const stamps = (await provider.getUtxos(userAddr)).filter((u) => u.token?.category === DEMO_CAT);
  const forged = await buildForgeTx(stamps, 5, {
    provider,
    forgeCategory: FORGE_CAT,
    slots,
    recipientAddress: userAddr,
    signer,
    batonTracker: tracker,
  });
  const forgeTx = await forged.builder.send();

  // Button 2 (Adversarial 4-stamp rejection)
  const attack = await runAdversarialForgeAttack('under-count-4', {
    forgeCategory: FORGE_CAT,
    demoCategory: DEMO_CAT,
    slots,
  });
  if (!attack.rejected) {
    throw new Error('Smoke check failed: 4-stamp attack was not rejected!');
  }

  console.log(`SMOKE PASS:`);
  console.log(`  [Button 1] Claimed 5 Demo Stamps (0-conf txid: ${claimTx.txid.slice(0, 16)}...)`);
  console.log(`  [Button 2] 4-Stamp Attack Rejected by CashVM: ${attack.expectedRule}`);
  console.log(`  [Button 3] Forged BLAZE Medallion (txid: ${forgeTx.txid.slice(0, 16)}..., fee: ${forged.summary.estimatedFeeSats} sats)`);
}

main().catch((err) => {
  console.error('SMOKE FAIL:', err);
  process.exit(1);
});
