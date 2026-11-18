import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCashAddress, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import { startServer, type BlazeServerInstance } from '../src/server.js';
import type {
  AttackResponse,
  BatonStatusResponse,
  ClaimStampsResponse,
  ForgeResponse,
  HealthResponse,
  RegistryResponse,
} from '../src/api/types.js';

describe('BLAZE Forge HTTP Backend API & Interface Verification Suite', () => {
  let instance: BlazeServerInstance;
  let baseUrl: string;
  let testUserAddress: string;

  beforeAll(async () => {
    // Start on port 0 to get an ephemeral OS-assigned free port
    instance = await startServer(0);
    baseUrl = `http://localhost:${instance.port}`;

    const priv = hexToBin('00'.repeat(31) + '05');
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') throw new Error(pub);
    testUserAddress = encodeCashAddress({
      prefix: 'bchtest',
      type: 'p2pkhWithTokens',
      payload: hash160(pub),
    }).address;
  });

  afterAll(async () => {
    if (instance) {
      await instance.close();
    }
  });

  it('1. GET /api/health: Returns 200 with contract opcodes, bytecode sizes, and Layla loop verification', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe('healthy');
    expect(body.networkTarget).toBe('BCH_2026_05');

    // BlazeForge contract verification
    expect(body.contracts.forge.name).toBe('BlazeForge');
    expect(body.contracts.forge.bytecodeBytes).toBe(276);
    expect(body.contracts.forge.opcodesCount).toBe(266);
    expect(body.contracts.forge.hasLaylaLoops).toBe(true);
    expect(body.contracts.forge.tokenAddress).toMatch(/^bchtest:/);

    // StampDispenser contract verification
    expect(body.contracts.dispenser.name).toBe('StampDispenser');
    expect(body.contracts.dispenser.bytecodeBytes).toBe(85);
    expect(body.contracts.dispenser.opcodesCount).toBe(81);
    expect(body.contracts.dispenser.hasLaylaLoops).toBe(true);
    expect(body.contracts.dispenser.tokenAddress).toMatch(/^bchtest:/);

    expect(body.zeroConfMempool.explanation).toContain('0-Conf');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('2. GET /api/registry: Returns 15-slot registry and official TokenHunt tier definitions', async () => {
    const res = await fetch(`${baseUrl}/api/registry`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as RegistryResponse;
    expect(body.slots.length).toBe(15);
    expect(body.slots[0].id).toBe('paytaca-pioneer');
    expect(body.slots[10].id).toBe('demo-stamp-1');
    expect(body.slots[14].id).toBe('demo-stamp-5');

    expect(body.tiers).toHaveLength(3);
    expect(body.tiers[0]).toEqual({ id: 'medallion', min: 5, name: 'BLAZE Medallion' });
    expect(body.tiers[1]).toEqual({ id: 'trophy', min: 9, name: 'BLAZE Trophy' });
    expect(body.tiers[2]).toEqual({ id: 'trailblazer-trophy', min: 10, name: 'Trailblazer Trophy' });
  });

  it('3. GET /api/baton: Returns 0-conf mempool baton tracking state', async () => {
    const res = await fetch(`${baseUrl}/api/baton`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as BatonStatusResponse;
    expect(body.forge.currentBatonOutpoint).toMatch(/^[0-9a-f]{64}:0$/);
    expect(body.dispenser.currentBatonOutpoint).toMatch(/^[0-9a-f]{64}:0$/);
    expect(body.zeroConfExplanation).toContain('includeUnconfirmed: true');
  });

  it('4. POST /api/stamps/claim (Button #1): Claims 5 distinct Demo Stamps 0-conf', async () => {
    const res = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: testUserAddress }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaimStampsResponse;
    expect(body.success).toBe(true);
    expect(body.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(body.stamps).toHaveLength(5);
    expect(body.stamps.map((s) => s.commitment)).toEqual(['01', '02', '03', '04', '05']);
    expect(body.zeroConfChained).toBe(true);
    expect(body.nextBatonOutpoint).toBe(`${body.txid}:0`);
  });

  it('5. POST /api/forge (Button #3): Burns 5 claimed stamps to forge BLAZE Medallion NFT', async () => {
    const res = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 5,
        recipientAddress: testUserAddress,
        signerPrivKeyHex: '00'.repeat(31) + '05',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ForgeResponse;
    expect(body.success).toBe(true);
    expect(body.trophy.tier).toBe(5);
    expect(body.trophy.tierName).toBe('BLAZE Medallion');
    expect(body.trophy.burnedStampCount).toBe(5);
    expect(body.trophy.commitmentHex).toBe('050a0b0c0d0e');
    expect(body.zeroConfChained).toBe(true);
    expect(body.nextBatonOutpoint).toBe(`${body.txid}:0`);
  });

  it('6. 0-Conf Chaining: Consecutive back-to-back claim & forge with zero block confirmations', async () => {
    const priv2 = hexToBin('00'.repeat(31) + '06');
    const pub2 = secp256k1.derivePublicKeyCompressed(priv2);
    if (typeof pub2 === 'string') throw new Error(pub2);
    const user2Address = encodeCashAddress({
      prefix: 'bchtest',
      type: 'p2pkhWithTokens',
      payload: hash160(pub2),
    }).address;

    // Immediately claim 5 stamps for User 2 (chains directly onto User 1's unconfirmed baton)
    const claimRes = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: user2Address }),
    });
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as ClaimStampsResponse;
    expect(claimBody.success).toBe(true);

    // Immediately forge for User 2 (chains directly onto User 1's unconfirmed forge baton)
    const forgeRes = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 5,
        recipientAddress: user2Address,
        signerPrivKeyHex: '00'.repeat(31) + '06',
      }),
    });
    expect(forgeRes.status).toBe(200);
    const forgeBody = (await forgeRes.json()) as ForgeResponse;
    expect(forgeBody.success).toBe(true);
    expect(forgeBody.trophy.burnedStampCount).toBe(5);
    expect(forgeBody.zeroConfChained).toBe(true);
  });

  it('7. POST /api/attack (Button #2 Adversarial): CashVM rejects under-count-4 attack on-chain', async () => {
    const res = await fetch(`${baseUrl}/api/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType: 'under-count-4' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttackResponse;
    expect(body.attack).toBe('under-count-4');
    expect(body.rejected).toBe(true);
    expect(body.expectedRule).toBe('require(tier == 5 || tier == 9 || tier == 10)');
    expect(body.vmError).toContain('Require statement failed');
    expect(body.receipt.adversarialRefusalVerified).toBe(true);
  });

  it('8. POST /api/attack: CashVM rejects duplicate-slot attack on-chain (slot > prevSlot)', async () => {
    const res = await fetch(`${baseUrl}/api/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType: 'duplicate-slot' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttackResponse;
    expect(body.attack).toBe('duplicate-slot');
    expect(body.rejected).toBe(true);
    expect(body.expectedRule).toBe('require(slot > prevSlot)');
    expect(body.vmError).toContain('Require statement failed');
  });

  it('9. POST /api/attack: CashVM rejects fake-category attack on-chain', async () => {
    const res = await fetch(`${baseUrl}/api/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType: 'fake-category' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttackResponse;
    expect(body.attack).toBe('fake-category');
    expect(body.rejected).toBe(true);
    expect(body.expectedRule).toBe('require(actualCat == expectedCat)');
  });

  it('10. POST /api/attack: CashVM rejects anti-burn cheat in output 2 on-chain', async () => {
    const res = await fetch(`${baseUrl}/api/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType: 'anti-burn-keep-stamps' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttackResponse;
    expect(body.attack).toBe('anti-burn-keep-stamps');
    expect(body.rejected).toBe(true);
    expect(body.expectedRule).toBe('require(tx.outputs[2].tokenCategory == 0x)');
  });

  it('11. POST /api/attack: CashVM rejects baton hijack attack on-chain', async () => {
    const res = await fetch(`${baseUrl}/api/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType: 'steal-baton' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttackResponse;
    expect(body.attack).toBe('steal-baton');
    expect(body.rejected).toBe(true);
    expect(body.expectedRule).toBe(
      'require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode)'
    );
  });

  it('12. Idempotency-Key: Duplicate request with same key replays cached response', async () => {
    const idemKey = `claim-${Date.now()}`;
    const payload = { recipientAddress: testUserAddress };

    const first = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
  });

  it('13. Idempotency-Key: Key reuse with different payload fails with 422 IDEMPOTENCY_PAYLOAD_MISMATCH', async () => {
    const idemKey = `mismatch-${Date.now()}`;

    await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({ recipientAddress: testUserAddress }),
    });

    const priv3 = hexToBin('00'.repeat(31) + '07');
    const pub3 = secp256k1.derivePublicKeyCompressed(priv3);
    if (typeof pub3 === 'string') throw new Error(pub3);
    const user3Address = encodeCashAddress({
      prefix: 'bchtest',
      type: 'p2pkhWithTokens',
      payload: hash160(pub3),
    }).address;

    const mismatch = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idemKey,
      },
      body: JSON.stringify({ recipientAddress: user3Address }),
    });

    expect(mismatch.status).toBe(422);
    const body = await mismatch.json();
    expect(body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('14. Boundary Validation: Rejects invalid address, invalid tier, and invalid attack type', async () => {
    // Invalid CashAddress
    const badAddr = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: 'not-a-valid-bch-address' }),
    });
    expect(badAddr.status).toBe(422);
    const badAddrBody = await badAddr.json();
    expect(badAddrBody.error.code).toBe('INVALID_ADDRESS');

    // Invalid tier
    const badTier = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: testUserAddress, tier: 7 }),
    });
    expect(badTier.status).toBe(422);
    const badTierBody = await badTier.json();
    expect(badTierBody.error.code).toBe('INVALID_TIER');

    // Invalid attack type
    const badAttack = await fetch(`${baseUrl}/api/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType: 'non-existent-attack' }),
    });
    expect(badAttack.status).toBe(422);
    const badAttackBody = await badAttack.json();
    expect(badAttackBody.error.code).toBe('INVALID_ATTACK_TYPE');
  });

  it('15. 404 Route Not Found and OPTIONS CORS Preflight', async () => {
    // 404
    const notFound = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(notFound.status).toBe(404);
    const notFoundBody = await notFound.json();
    expect(notFoundBody.error.code).toBe('NOT_FOUND');

    // OPTIONS preflight
    const preflight = await fetch(`${baseUrl}/api/forge`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
