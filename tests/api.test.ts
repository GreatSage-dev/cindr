import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockNetworkProvider, type NetworkProvider } from 'cashscript';
import { encodeCashAddress, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import { BlazeForgeArtifact, StampDispenserArtifact } from '../src/artifacts.js';
import { BlazeBackendService } from '../src/api/service.js';
import { IdempotencyStore } from '../src/api/idempotency.js';
import { loadAppConfig } from '../src/config.js';
import { createBlazeTokenHuntRegistry } from '../src/registry.js';
import { startServer, type BlazeServerInstance } from '../src/server.js';
import type {
  AttackResponse,
  BatonStatusResponse,
  ClaimStampsResponse,
  ForgeResponse,
  HealthResponse,
  RegistryResponse,
  WalletDemoResponse,
  WalletOverviewResponse,
} from '../src/api/types.js';

describe('cindr HTTP Backend API & Interface Verification Suite', () => {
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
    expect(body.networkMode).toBe('mock');
    expect(body.networkTarget).toBe('BCH_2026_05');

    // BlazeForge contract verification
    expect(body.contracts.forge.name).toBe('cindr');
    expect(body.contracts.forge.bytecodeBytes).toBeGreaterThan(200);
    expect(body.contracts.forge.opcodesCount).toBe(
      BlazeForgeArtifact.bytecode.split(/\s+/).filter(Boolean).length
    );
    expect(body.contracts.forge.redeemScriptBytes).toBeGreaterThan(700);
    expect(body.contracts.forge.redeemOpcodesCount).toBeGreaterThan(150);
    expect(body.contracts.forge.hasLaylaLoops).toBe(true);
    expect(body.contracts.forge.tokenAddress).toMatch(/^bchtest:/);

    // StampDispenser contract verification
    expect(body.contracts.dispenser.name).toBe('StampDispenser');
    expect(body.contracts.dispenser.bytecodeBytes).toBeGreaterThan(80);
    expect(body.contracts.dispenser.opcodesCount).toBe(
      StampDispenserArtifact.bytecode.split(/\s+/).filter(Boolean).length
    );
    expect(body.contracts.dispenser.redeemScriptBytes).toBeGreaterThan(100);
    expect(body.contracts.dispenser.redeemOpcodesCount).toBeGreaterThan(50);
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
    expect(body.tiers[0]).toEqual({ id: 'medallion', min: 5, name: 'cindr Medallion' });
    expect(body.tiers[1]).toEqual({ id: 'trophy', min: 9, name: 'cindr Trophy' });
    expect(body.tiers[2]).toEqual({ id: 'trailblazer-trophy', min: 10, name: 'cindr Apex Trophy' });
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
    expect(body.stamps.map((s) => s.slot)).toEqual([10, 11, 12, 13, 14]);
    expect(body.stamps.map((s) => s.id)).toEqual([
      'demo-stamp-1',
      'demo-stamp-2',
      'demo-stamp-3',
      'demo-stamp-4',
      'demo-stamp-5',
    ]);
    expect(body.stamps.map((s) => s.commitment)).toEqual(['01', '02', '03', '04', '05']);
    // First claim spends the seeded dispenser baton; Test 6 verifies chained claim zeroConfChained: true.
    expect(body.zeroConfChained).toBe(false);
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
    expect(body.trophy.tierName).toBe('cindr Medallion');
    expect(body.trophy.burnedStampCount).toBe(5);
    expect(body.trophy.commitmentHex).toBe('050a0b0c0d0e');
    // First Forge transaction uses the seeded contract baton; Test 6 verifies chained Forge zeroConfChained: true.
    expect(body.zeroConfChained).toBe(false);
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
    expect(claimBody.zeroConfChained).toBe(true);

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

  it('16. Static Landing Page & Three.js Vendor Assets serve cleanly', async () => {
    const htmlRes = await fetch(`${baseUrl}/`);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get('Content-Type')).toContain('text/html');
    const htmlBody = await htmlRes.text();
    expect(htmlBody).toContain('cindr');
    expect(htmlBody).toContain('iris-canvas');

    const cssRes = await fetch(`${baseUrl}/styles.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('Content-Type')).toContain('text/css');

    const jsRes = await fetch(`${baseUrl}/app.js`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('Content-Type')).toContain('application/javascript');

    const threeRes = await fetch(`${baseUrl}/vendor/three.module.js`);
    expect(threeRes.status).toBe(200);
    expect(threeRes.headers.get('Content-Type')).toContain('application/javascript');

    const threeCoreRes = await fetch(`${baseUrl}/vendor/three.core.js`);
    expect(threeCoreRes.status).toBe(200);
    expect(threeCoreRes.headers.get('Content-Type')).toContain('application/javascript');
  });

  it('17. /dashboard Workspace Assets & HEAD / Serve with Security Headers', async () => {
    const headRoot = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    expect(headRoot.status).toBe(200);
    expect(headRoot.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headRoot.headers.get('X-Frame-Options')).toBe('DENY');

    const dashHtml = await fetch(`${baseUrl}/dashboard`);
    expect(dashHtml.status).toBe(200);
    expect(dashHtml.headers.get('Content-Type')).toContain('text/html');
    expect(dashHtml.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    const body = await dashHtml.text();
    expect(body).toContain('cindr workspace');

    const dashCss = await fetch(`${baseUrl}/dashboard.css`);
    expect(dashCss.status).toBe(200);
    expect(dashCss.headers.get('Content-Type')).toContain('text/css');

    const dashJs = await fetch(`${baseUrl}/dashboard.js`);
    expect(dashJs.status).toBe(200);
    expect(dashJs.headers.get('Content-Type')).toContain('application/javascript');
  });

  it('18. Sandbox Wallet Lifecycle: POST /api/wallet/demo -> claim -> forge -> GET /api/wallet (no HTTP privkeys)', async () => {
    const createRes = await fetch(`${baseUrl}/api/wallet/demo`, { method: 'POST' });
    expect(createRes.status).toBe(201);
    const wallet = (await createRes.json()) as WalletDemoResponse;
    expect(wallet.mode).toBe('sandbox');
    expect(wallet.address).toMatch(/^bchtest:/);

    const emptyView = (await (
      await fetch(`${baseUrl}/api/wallet?address=${encodeURIComponent(wallet.address)}`)
    ).json()) as WalletOverviewResponse;
    expect(emptyView.mode).toBe('sandbox');
    expect(emptyView.stamps).toHaveLength(0);
    expect(emptyView.eligibleTiers).toEqual([]);

    const claimRes = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: wallet.address }),
    });
    expect(claimRes.status).toBe(200);

    const readyView = (await (
      await fetch(`${baseUrl}/api/wallet?address=${encodeURIComponent(wallet.address)}`)
    ).json()) as WalletOverviewResponse;
    expect(readyView.stamps).toHaveLength(5);
    expect(readyView.eligibleTiers).toEqual([5]);

    const forgeRes = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 5, recipientAddress: wallet.address }),
    });
    expect(forgeRes.status).toBe(200);
    const forgeBody = (await forgeRes.json()) as ForgeResponse;
    expect(forgeBody.broadcasted).toBe(true);
    expect(forgeBody.trophy.tierName).toBe('cindr Medallion');

    const afterView = (await (
      await fetch(`${baseUrl}/api/wallet?address=${encodeURIComponent(wallet.address)}`)
    ).json()) as WalletOverviewResponse;
    expect(afterView.stamps).toHaveLength(0);
    expect(afterView.trophies).toHaveLength(1);
    expect(afterView.trophies[0].commitmentHex).toBe('050a0b0c0d0e');
  });

  it('19. POST /api/forge merges feeUtxos when caller passes explicit dust-only req.utxos', async () => {
    const priv = hexToBin('00'.repeat(31) + '0a');
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') throw new Error(pub);
    const addr = encodeCashAddress({
      prefix: 'bchtest',
      type: 'p2pkhWithTokens',
      payload: hash160(pub),
    }).address;

    const claimRes = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: addr }),
    });
    expect(claimRes.status).toBe(200);

    const overview = (await (
      await fetch(`${baseUrl}/api/wallet?address=${encodeURIComponent(addr)}`)
    ).json()) as WalletOverviewResponse;

    const explicitDustStamps = overview.stamps.map((s) => ({
      txid: s.txid,
      vout: s.vout,
      satoshis: s.satoshis,
      address: addr,
      category: s.category,
      amount: 0,
      capability: 'none' as const,
      commitment: s.commitment,
    }));

    const forgeRes = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 5,
        recipientAddress: addr,
        signerPrivKeyHex: '00'.repeat(31) + '0a',
        utxos: explicitDustStamps,
      }),
    });
    expect(forgeRes.status).toBe(200);
    const forgeBody = (await forgeRes.json()) as ForgeResponse;
    expect(forgeBody.success).toBe(true);
    expect(forgeBody.trophy.burnedStampCount).toBe(5);
  });

  it('20. POST /api/forge returns HTTP 422 INSUFFICIENT_STAMPS instead of 500 on empty wallet', async () => {
    const emptyWallet = (await (
      await fetch(`${baseUrl}/api/wallet/demo`, { method: 'POST' })
    ).json()) as WalletDemoResponse;

    const res = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 5, recipientAddress: emptyWallet.address }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('INSUFFICIENT_STAMPS');
  });

  it('21. Idempotency-Key scopes per endpoint and rejects same-route reuse across endpoints cleanly', async () => {
    const sharedKey = `scoped-${Date.now()}`;
    const wallet = (await (
      await fetch(`${baseUrl}/api/wallet/demo`, { method: 'POST' })
    ).json()) as WalletDemoResponse;

    const claimRes = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey },
      body: JSON.stringify({ recipientAddress: wallet.address }),
    });
    expect(claimRes.status).toBe(200);

    // Same key used on /api/forge must not collide with /api/stamps/claim
    const forgeRes = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey },
      body: JSON.stringify({ tier: 5, recipientAddress: wallet.address }),
    });
    expect(forgeRes.status).toBe(200);
  });

  it('22. Oversized JSON request (> 256KB) fails cleanly with HTTP 413 PAYLOAD_TOO_LARGE', async () => {
    const hugeBody = JSON.stringify({
      recipientAddress: testUserAddress,
      filler: 'x'.repeat(270 * 1024),
    });

    const res = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugeBody,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('23. IdempotencyStore enforces bounded maxEntries without leaking memory', () => {
    const store = new IdempotencyStore(60_000, 3);
    store.claim('POST:/api/a:1', 'h1');
    store.claim('POST:/api/a:2', 'h2');
    store.claim('POST:/api/a:3', 'h3');
    store.claim('POST:/api/a:4', 'h4');
    expect(store.size()).toBe(3);
    expect(store.claim('POST:/api/a:1', 'h1').status).toBe('claimed');
  });

  it('24. Live network mode rejects signerPrivKeyHex over HTTP with PrivateKeyRejectedError', async () => {
    const stubLiveProvider = {
      network: 'chipnet',
      getUtxos: async () => [],
      getBlockHeight: async () => 1,
      getRawTransaction: async () => '',
      sendRawTransaction: async () => '',
    } as unknown as NetworkProvider;

    const liveService = new BlazeBackendService({
      provider: stubLiveProvider,
      networkMode: 'chipnet',
    });

    await expect(
      liveService.forgeTrophy({
        tier: 5,
        recipientAddress: testUserAddress,
        signerPrivKeyHex: '00'.repeat(31) + '05',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRIVATE_KEY_NOT_ALLOWED',
    });

    const mockCheck = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    expect(mockCheck).toBeDefined();
  });

  it('25. WizardConnect vendor ESM bundle & chunks serve with CSP relay headers', async () => {
    const wcRes = await fetch(`${baseUrl}/vendor/wizardconnect.js`);
    expect(wcRes.status).toBe(200);
    expect(wcRes.headers.get('Content-Type')).toContain('application/javascript');
    expect(wcRes.headers.get('Content-Security-Policy')).toContain('wss://relay.riften.net:443');
    expect(wcRes.headers.get('Content-Security-Policy')).toContain("'wasm-unsafe-eval'");
    const wcText = await wcRes.text();
    expect(wcText).toContain('chunk-KXQ2PETI.js');

    const chunkRes = await fetch(`${baseUrl}/vendor/chunk-KXQ2PETI.js`);
    expect(chunkRes.status).toBe(200);
  });

  it('26. Unsigned WizardConnect POST /api/forge serializes Uint8Array fields as hex and normalizes bitcoincash:/q-addresses', async () => {
    const priv = hexToBin('00'.repeat(31) + '0b');
    const pub = secp256k1.derivePublicKeyCompressed(priv);
    if (typeof pub === 'string') throw new Error(pub);
    const mainnetStyleAddr = encodeCashAddress({
      prefix: 'bitcoincash',
      type: 'p2pkh',
      payload: hash160(pub),
    }).address;

    const claimRes = await fetch(`${baseUrl}/api/stamps/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientAddress: mainnetStyleAddr }),
    });
    expect(claimRes.status).toBe(200);

    const forgeRes = await fetch(`${baseUrl}/api/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 5,
        recipientAddress: mainnetStyleAddr,
        autoBroadcast: false,
      }),
    });
    expect(forgeRes.status).toBe(200);
    const forgeBody = (await forgeRes.json()) as ForgeResponse;
    expect(forgeBody.broadcasted).toBe(false);
    expect(forgeBody.wcTransaction).toBeDefined();
    expect(Array.isArray(forgeBody.inputPaths)).toBe(true);
    const firstLocking = forgeBody.wcTransaction?.transaction.outputs[0]?.lockingBytecode;
    expect(typeof firstLocking).toBe('string');
    expect(firstLocking).toMatch(/^[0-9a-f]+$/);
  });

  it('27. TOKENHUNT_OVERRIDES_JSON promotes newly activated staging TokenHunt slots to live', () => {
    const activatedCat = '44'.repeat(32);
    const cfg = loadAppConfig({
      TOKENHUNT_OVERRIDES_JSON: JSON.stringify({ 'showcase-showoff': activatedCat }),
    });
    expect(cfg.tokenHuntOverrides['showcase-showoff']).toBe(activatedCat);

    const slots = createBlazeTokenHuntRegistry('dd' + '99'.repeat(30) + 'ee', cfg.tokenHuntOverrides);
    const showcaseSlot = slots.find((s) => s.id === 'showcase-showoff');
    expect(showcaseSlot?.category).toBe(activatedCat);
    expect(showcaseSlot?.activationStatus).toBe('live');
    expect(showcaseSlot?.name).toBe('Showcase Showoff');
  });

  it('28. Vercel static asset parity & security headers', () => {
    const publicDir = path.join(process.cwd(), 'public');
    for (const relPath of [
      'vendor/three.module.js',
      'vendor/three.core.js',
      'tokens.css',
      'favicon.svg',
    ]) {
      expect(existsSync(path.join(publicDir, relPath))).toBe(true);
    }

    for (const htmlFile of ['index.html', 'dashboard.html']) {
      const html = readFileSync(path.join(publicDir, htmlFile), 'utf8');
      const assetRefs = Array.from(
        html.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js|svg))"/g),
        (m) => m[1]
      );
      expect(assetRefs.length).toBeGreaterThan(0);
      for (const ref of assetRefs) {
        expect(existsSync(path.join(publicDir, ref.slice(1)))).toBe(true);
      }
    }

    for (const jsFile of ['app.js', 'dashboard.js']) {
      const js = readFileSync(path.join(publicDir, jsFile), 'utf8');
      const vendorRefs = Array.from(js.matchAll(/['"](\/vendor\/[^'"]+)['"]/g), (m) => m[1]);
      for (const ref of vendorRefs) {
        expect(existsSync(path.join(publicDir, ref.slice(1)))).toBe(true);
      }
    }

    const vercelConfig = JSON.parse(
      readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
    ) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const rootRule = vercelConfig.headers.find((r) => r.source === '/(.*)');
    const dashboardRule = vercelConfig.headers.find((r) => r.source === '/dashboard(.*)');
    expect(rootRule).toBeDefined();
    expect(dashboardRule).toBeDefined();

    const rootHeaders = new Map(rootRule!.headers.map((h) => [h.key, h.value]));
    expect(rootHeaders.get('X-Content-Type-Options')).toBe('nosniff');
    expect(rootHeaders.get('X-Frame-Options')).toBe('DENY');
    expect(rootHeaders.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(rootHeaders.get('Content-Security-Policy')).not.toContain("'wasm-unsafe-eval'");

    const dashHeaders = new Map(dashboardRule!.headers.map((h) => [h.key, h.value]));
    expect(dashHeaders.get('Content-Security-Policy')).toContain("'wasm-unsafe-eval'");
  });

  it('29. BatonMempoolTracker does not poison pendingCount on failed broadcast', async () => {
    const provider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    const service = new BlazeBackendService({ provider, networkMode: 'mock' });
    const wallet = await service.createDemoWallet();

    provider.sendRawTransaction = async () => {
      throw new Error('Simulated broadcast failure');
    };

    await expect(
      service.claimDemoStamps({ recipientAddress: wallet.address })
    ).rejects.toThrow('Simulated broadcast failure');
    expect(service.batonTracker.pendingCount()).toBe(0);

    const provider2 = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    const service2 = new BlazeBackendService({ provider: provider2, networkMode: 'mock' });
    const wallet2 = await service2.createDemoWallet();
    await service2.claimDemoStamps({ recipientAddress: wallet2.address });
    service2.batonTracker.clear();

    provider2.sendRawTransaction = async () => {
      throw new Error('Simulated forge broadcast failure');
    };

    await expect(
      service2.forgeTrophy({ tier: 5, recipientAddress: wallet2.address })
    ).rejects.toThrow('Simulated forge broadcast failure');
    expect(service2.batonTracker.pendingCount()).toBe(0);
  });

  it('30. GET /api/wallet returns 503 on provider failure vs 422 on invalid address, and testSigners enforces FIFO cap', async () => {
    const cappedService = new BlazeBackendService({
      networkMode: 'mock',
      maxSandboxSigners: 2,
    });
    await cappedService.createDemoWallet();
    await cappedService.createDemoWallet();
    await cappedService.createDemoWallet();
    expect(cappedService.sandboxSignerCount()).toBe(2);

    const failingProvider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    const tmpServer = await startServer(0, { provider: failingProvider, networkMode: 'mock' });
    failingProvider.getUtxos = async () => {
      throw new Error('Electrum offline');
    };

    try {
      const badRes = await fetch(
        `http://localhost:${tmpServer.port}/api/wallet?address=not-a-valid-address`
      );
      expect(badRes.status).toBe(422);
      const badBody = (await badRes.json()) as { error: { code: string } };
      expect(badBody.error.code).toBe('INVALID_ADDRESS');

      const offlineRes = await fetch(
        `http://localhost:${tmpServer.port}/api/wallet?address=${encodeURIComponent(testUserAddress)}`
      );
      expect(offlineRes.status).toBe(503);
      const offlineBody = (await offlineRes.json()) as { error: { code: string } };
      expect(offlineBody.error.code).toBe('PROVIDER_UNAVAILABLE');
    } finally {
      await tmpServer.close();
    }
  });

  it('31. Styled HTML 404 card & split CSP headers', async () => {
    const landingRes = await fetch(`${baseUrl}/`);
    expect(landingRes.status).toBe(200);
    const landingCsp = landingRes.headers.get('content-security-policy') ?? '';
    expect(landingCsp).toContain("script-src 'self'");
    expect(landingCsp).not.toContain("'wasm-unsafe-eval'");

    const dashRes = await fetch(`${baseUrl}/dashboard`);
    expect(dashRes.status).toBe(200);
    const dashCsp = dashRes.headers.get('content-security-policy') ?? '';
    expect(dashCsp).toContain("'wasm-unsafe-eval'");
    expect(dashCsp).toContain('wss://relay.riften.net:443');

    const notFoundRes = await fetch(`${baseUrl}/does-not-exist-check`, {
      headers: { Accept: 'text/html' },
    });
    expect(notFoundRes.status).toBe(404);
    const html = await notFoundRes.text();
    expect(html).toContain('<title>Page not found — cindr</title>');
    expect(html).toContain('/tokens.css');
    expect(html).toContain('/dashboard.css');
    expect(html).toContain('notfound-card');

    const dashboardCss = readFileSync(
      path.join(process.cwd(), 'public', 'dashboard.css'),
      'utf8'
    );
    expect(dashboardCss).toContain('.notfound-card');
    expect(dashboardCss).toContain('.notfound-body');
  });

  it('32. GET /api/baton returns 503 on provider failure and route aliases (/wallet, /wallet/demo) respond cleanly', async () => {
    const failingProvider = new MockNetworkProvider({ vmTarget: 'BCH_2026_05' });
    const tmpServer = await startServer(0, { provider: failingProvider, networkMode: 'mock' });
    failingProvider.getUtxos = async () => {
      throw new Error('Electrum connection reset');
    };

    try {
      const batonRes = await fetch(`http://localhost:${tmpServer.port}/api/baton`);
      expect(batonRes.status).toBe(503);
      const batonBody = (await batonRes.json()) as { error: { code: string } };
      expect(batonBody.error.code).toBe('PROVIDER_UNAVAILABLE');
    } finally {
      await tmpServer.close();
    }

    // Verify route alias without /api/ prefix
    const walletAliasRes = await fetch(`${baseUrl}/wallet?address=${encodeURIComponent(testUserAddress)}`);
    expect(walletAliasRes.status).toBe(200);

    const demoAliasRes = await fetch(`${baseUrl}/wallet/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(demoAliasRes.status).toBe(201);
  });
});
