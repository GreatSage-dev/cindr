import { describe, expect, it } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo } from 'cashscript';
import { cashAddressToLockingBytecode, encodeCashAddress, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import {
  BatonMempoolTracker,
  buildClaimDemoStampsTx,
  buildForgeTx,
  instantiateDispenserContract,
  instantiateForgeContract,
  runAdversarialForgeAttack,
} from '../src/buildForgeTx.js';
import { createBlazeTokenHuntRegistry, createMerchantLoyaltyRegistry } from '../src/registry.js';

const FORGE_CATEGORY = 'aa' + '42'.repeat(30) + 'cc';
const DEMO_CATEGORY = 'dd' + '99'.repeat(30) + 'ee';

function makeTestWallet(seedHexByte: string) {
  const priv = hexToBin('00'.repeat(31) + seedHexByte);
  const signer = new SignatureTemplate(priv);
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(pub);
  const payload = hash160(pub);
  const tokenAddress = encodeCashAddress({
    prefix: 'bchtest',
    type: 'p2pkhWithTokens',
    payload,
  }).address;
  const lock = cashAddressToLockingBytecode(tokenAddress);
  if (typeof lock === 'string') throw new Error(lock);
  return { signer, tokenAddress, lockingBytecode: lock.bytecode };
}

function setupWorld(slots = createBlazeTokenHuntRegistry(DEMO_CATEGORY)) {
  const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
  const tracker = new BatonMempoolTracker();
  const forge = instantiateForgeContract({ provider, forgeCategory: FORGE_CATEGORY, slots });
  const dispenser = instantiateDispenserContract(provider, DEMO_CATEGORY);

  const forgeBaton = provider.addUtxo(
    forge.tokenAddress,
    randomUtxo({
      satoshis: 1000n,
      token: { category: FORGE_CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    })
  );
  const dispBaton = provider.addUtxo(
    dispenser.tokenAddress,
    randomUtxo({
      satoshis: 1000n,
      token: { category: DEMO_CATEGORY, amount: 0n, nft: { capability: 'minting', commitment: '' } },
    })
  );

  return { provider, tracker, forge, dispenser, forgeBaton, dispBaton, slots };
}

describe('BLAZE Forge / StampForge — CashVM Deterministic & Adversarial Suite', () => {
  it('1. Button #1: Claim 5 Demo Stamps in 1 tx succeeds and preserves Dispenser baton', async () => {
    const { provider, tracker, dispenser, slots } = setupWorld();
    const judge = makeTestWallet('01');
    const feeUtxo = provider.addUtxo(judge.tokenAddress, randomUtxo({ satoshis: 25000n }));

    const built = await buildClaimDemoStampsTx({
      provider,
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots,
      recipientAddress: judge.tokenAddress,
      feeUtxos: [feeUtxo],
      signer: judge.signer,
      batonTracker: tracker,
    });

    const txDetails = await built.builder.send();
    expect(txDetails.txid).toMatch(/^[0-9a-f]{64}$/);

    const judgeUtxos = await provider.getUtxos(judge.tokenAddress);
    const stamps = judgeUtxos.filter((u) => u.token?.category === DEMO_CATEGORY);
    expect(stamps).toHaveLength(5);
    expect(stamps.map((s) => s.token?.nft?.commitment).sort()).toEqual(['01', '02', '03', '04', '05']);

    const dispUtxos = await dispenser.getUtxos();
    expect(dispUtxos).toHaveLength(1);
    expect(dispUtxos[0].token?.nft?.capability).toBe('minting');
  });

  it('2. Button #3: 0-Conf Claim -> Medallion Forge (tier=5) + tokenhunt.js map shape', async () => {
    const { provider, tracker, forge, slots } = setupWorld();
    const judge = makeTestWallet('02');
    const feeUtxo = provider.addUtxo(judge.tokenAddress, randomUtxo({ satoshis: 25000n }));

    // Step A: Claim 5 Demo Stamps (0-conf)
    const claim = await buildClaimDemoStampsTx({
      provider,
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots,
      recipientAddress: judge.tokenAddress,
      feeUtxos: [feeUtxo],
      signer: judge.signer,
      batonTracker: tracker,
    });
    await claim.builder.send();

    // Step B: Immediately convert utxos into the exact Record<string, utxo> map shape used by tokenhunt.js
    const judgeUtxos = await provider.getUtxos(judge.tokenAddress);
    const utxoMap: Record<string, any> = {};
    for (const u of judgeUtxos) {
      if (u.token?.category === DEMO_CATEGORY && u.token.nft?.commitment) {
        const idx = parseInt(u.token.nft.commitment, 16);
        utxoMap[`demo-stamp-${idx}`] = u;
      }
    }

    const forged = await buildForgeTx(
      utxoMap,
      { id: 'medallion', min: 5 },
      {
        provider,
        forgeCategory: FORGE_CATEGORY,
        demoCategory: DEMO_CATEGORY,
        slots,
        recipientAddress: judge.tokenAddress,
        signer: judge.signer,
        batonTracker: tracker,
      }
    );

    const forgeDetails = await forged.builder.send();
    expect(forgeDetails.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(forged.summary.tier).toBe(5);
    expect(forged.summary.burnedSlots.map((s) => s.slot)).toEqual([10, 11, 12, 13, 14]);
    expect(forged.summary.trophyCommitmentHex).toBe('050a0b0c0d0e');

    // Verify all 5 stamps were burned and only the Medallion NFT + BCH change remain
    const afterUtxos = await provider.getUtxos(judge.tokenAddress);
    expect(afterUtxos.filter((u) => u.token?.category === DEMO_CATEGORY)).toHaveLength(0);
    const trophies = afterUtxos.filter((u) => u.token?.category === FORGE_CATEGORY);
    expect(trophies).toHaveLength(1);
    expect(trophies[0].token?.nft?.capability).toBe('none');
    expect(trophies[0].token?.nft?.commitment).toBe('050a0b0c0d0e');

    const forgeBatonAfter = await forge.getUtxos();
    expect(forgeBatonAfter).toHaveLength(1);
    expect(forgeBatonAfter[0].token?.nft?.capability).toBe('minting');
  });

  it('3. Tier 9 (BLAZE Trophy): Burns 9 official TokenHunt tokens and mints BLAZE Trophy NFT', async () => {
    const { provider, tracker, slots } = setupWorld();
    const hunter = makeTestWallet('03');

    // Give hunter official TokenHunt tokens slots 0..8 (mixing fungible tokens & NFTs)
    const tokenUtxos = slots.slice(0, 9).map((s, idx) =>
      provider.addUtxo(
        hunter.tokenAddress,
        randomUtxo({
          satoshis: 1500n,
          token:
            idx % 2 === 0
              ? { category: s.category, amount: 1n }
              : { category: s.category, amount: 0n, nft: { capability: 'none', commitment: '01' } },
        })
      )
    );

    const forged = await buildForgeTx(tokenUtxos, 9, {
      provider,
      forgeCategory: FORGE_CATEGORY,
      slots,
      recipientAddress: hunter.tokenAddress,
      signer: hunter.signer,
      batonTracker: tracker,
    });

    const tx = await forged.builder.send();
    expect(tx.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(forged.summary.tierName).toBe('BLAZE Trophy');
    expect(forged.summary.trophyCommitmentHex).toBe('09000102030405060708');

    const after = await provider.getUtxos(hunter.tokenAddress);
    const trophy = after.find((u) => u.token?.category === FORGE_CATEGORY);
    expect(trophy?.token?.nft?.commitment).toBe('09000102030405060708');
    expect(after.filter((u) => u.token && u.token.category !== FORGE_CATEGORY)).toHaveLength(0);
  });

  it('4. Tier 10 (Trailblazer Trophy): Burns 9 TokenHunt tokens + Trailblazer 2025 under CashVM budget', async () => {
    const { provider, tracker, slots } = setupWorld();
    const veteran = makeTestWallet('04');

    const tokenUtxos = slots.slice(0, 10).map((s) =>
      provider.addUtxo(
        veteran.tokenAddress,
        randomUtxo({
          satoshis: 1500n,
          token: { category: s.category, amount: 1n },
        })
      )
    );

    const forged = await buildForgeTx(tokenUtxos, { id: 'trailblazer-trophy', min: 10 }, {
      provider,
      forgeCategory: FORGE_CATEGORY,
      slots,
      recipientAddress: veteran.tokenAddress,
      signer: veteran.signer,
      batonTracker: tracker,
    });

    const usage = forged.builder.getVmResourceUsage();
    expect(usage[0].operationCost).toBeLessThan(usage[0].maximumOperationCost);

    const tx = await forged.builder.send();
    expect(tx.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(forged.summary.trophyCommitmentHex).toBe('0a00010203040506070809');
  });

  it('5. 0-Conf Back-to-Back Baton Chaining: Two different users forge back-to-back with 0 block waits', async () => {
    const { provider, tracker, forge, slots } = setupWorld();
    const userA = makeTestWallet('05');
    const userB = makeTestWallet('06');

    const feeA = provider.addUtxo(userA.tokenAddress, randomUtxo({ satoshis: 25000n }));
    const feeB = provider.addUtxo(userB.tokenAddress, randomUtxo({ satoshis: 25000n }));

    // User A claims & forges
    const claimA = await buildClaimDemoStampsTx({
      provider,
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots,
      recipientAddress: userA.tokenAddress,
      feeUtxos: [feeA],
      signer: userA.signer,
      batonTracker: tracker,
    });
    await claimA.builder.send();

    const stampsA = (await provider.getUtxos(userA.tokenAddress)).filter(
      (u) => u.token?.category === DEMO_CATEGORY
    );
    const forgeA = await buildForgeTx(stampsA, 5, {
      provider,
      forgeCategory: FORGE_CATEGORY,
      slots,
      recipientAddress: userA.tokenAddress,
      signer: userA.signer,
      batonTracker: tracker,
    });
    const txA = await forgeA.builder.send();

    // User B immediately claims from unconfirmed Dispenser baton AND forges from unconfirmed Forge baton
    const claimB = await buildClaimDemoStampsTx({
      provider,
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots,
      recipientAddress: userB.tokenAddress,
      feeUtxos: [feeB],
      signer: userB.signer,
      batonTracker: tracker,
    });
    expect(claimB.spentBatonOutpoint).toBe(`${claimA.nextBatonUtxo.txid}:0`);
    await claimB.builder.send();

    const stampsB = (await provider.getUtxos(userB.tokenAddress)).filter(
      (u) => u.token?.category === DEMO_CATEGORY
    );
    const forgeB = await buildForgeTx(stampsB, 5, {
      provider,
      forgeCategory: FORGE_CATEGORY,
      slots,
      recipientAddress: userB.tokenAddress,
      signer: userB.signer,
      batonTracker: tracker,
    });
    expect(forgeB.spentBatonOutpoint).toBe(`${txA.txid}:0`);
    expect(forgeB.summary.zeroConfChained).toBe(true);

    const txB = await forgeB.builder.send();
    expect(txB.txid).toMatch(/^[0-9a-f]{64}$/);
    expect((await forge.getUtxos())[0].txid).toBe(txB.txid);
  }, 15000);

  it('6. Button #2 Adversarial Attack 1: Only 4 Stamps rejected by CashVM', async () => {
    const res = await runAdversarialForgeAttack('under-count-4', {
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots: createBlazeTokenHuntRegistry(DEMO_CATEGORY),
    });
    expect(res.rejected).toBe(true);
    expect(res.failingContract).toBe('BlazeForge.cash');
    expect(res.vmError).toContain('tier == 5 || tier == 9 || tier == 10');
  });

  it('7. Adversarial Attack 2: Duplicate copies of Stamp #1 rejected by CashVM (slot > prevSlot)', async () => {
    const res = await runAdversarialForgeAttack('duplicate-slot', {
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots: createBlazeTokenHuntRegistry(DEMO_CATEGORY),
    });
    expect(res.rejected).toBe(true);
    expect(res.failingContract).toBe('BlazeForge.cash');
    expect(res.vmError).toContain('slot > prevSlot');
  });

  it('8. Adversarial Attack 3: Unregistered Fake Token Category rejected by CashVM', async () => {
    const res = await runAdversarialForgeAttack('fake-category', {
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots: createBlazeTokenHuntRegistry(DEMO_CATEGORY),
    });
    expect(res.rejected).toBe(true);
    expect(res.failingContract).toBe('BlazeForge.cash');
    expect(res.vmError).toContain('actualCat == expectedCat');
  });

  it('9. Adversarial Attack 4: Anti-Burn Keep-Stamps Cheat in Output 2 rejected by CashVM', async () => {
    const res = await runAdversarialForgeAttack('anti-burn-keep-stamps', {
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots: createBlazeTokenHuntRegistry(DEMO_CATEGORY),
    });
    expect(res.rejected).toBe(true);
    expect(res.failingContract).toBe('BlazeForge.cash');
    expect(res.vmError).toContain('tx.outputs[2].tokenCategory == 0x');
  });

  it('10. Adversarial Attack 5: Steal Forge Minting Baton in Output 0 rejected by CashVM', async () => {
    const res = await runAdversarialForgeAttack('steal-baton', {
      forgeCategory: FORGE_CATEGORY,
      demoCategory: DEMO_CATEGORY,
      slots: createBlazeTokenHuntRegistry(DEMO_CATEGORY),
    });
    expect(res.rejected).toBe(true);
    expect(res.failingContract).toBe('BlazeForge.cash');
    expect(res.vmError).toContain('tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode');
  });

  it('11. WizardConnect placeholder signing & Merchant Punch-Card preset compatibility', async () => {
    const coffeeCat = '77'.repeat(32);
    const merchantSlots = createMerchantLoyaltyRegistry(coffeeCat, 5);
    const { provider, tracker } = setupWorld(merchantSlots);
    const customer = makeTestWallet('08');

    const coffeeStamps = merchantSlots.map((s, idx) =>
      provider.addUtxo(
        customer.tokenAddress,
        randomUtxo({
          satoshis: 1500n,
          token: { category: coffeeCat, amount: 0n, nft: { capability: 'none', commitment: `0${idx + 1}` } },
        })
      )
    ).map((u, idx) => ({ ...u, path: `m/44'/145'/0'/0/${idx}` }));

    // Call without `signer` -> builds unsigned WizardConnect WcTransactionObject + inputPaths
    const wcBuilt = await buildForgeTx(coffeeStamps, 5, {
      provider,
      forgeCategory: FORGE_CATEGORY,
      slots: merchantSlots,
      recipientAddress: customer.tokenAddress,
      batonTracker: tracker,
    });

    expect(wcBuilt.transaction.inputs).toHaveLength(6);
    expect(wcBuilt.sourceOutputs).toHaveLength(6);
    expect(wcBuilt.inputPaths).toEqual([
      null,
      "m/44'/145'/0'/0/0",
      "m/44'/145'/0'/0/1",
      "m/44'/145'/0'/0/2",
      "m/44'/145'/0'/0/3",
      "m/44'/145'/0'/0/4",
    ]);
    expect(wcBuilt.wcTransaction.broadcast).toBe(true);
  });
});
