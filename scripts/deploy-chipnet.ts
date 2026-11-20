import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  type SpendableUtxo,
} from 'cashscript';
import {
  binToHex,
  encodeCashAddress,
  hash160,
  hexToBin,
  secp256k1,
} from '@bitauth/libauth';
import {
  BatonMempoolTracker,
  addressToLockingBytecode,
  buildClaimDemoStampsTx,
  buildForgeTx,
  instantiateDispenserContract,
  instantiateForgeContract,
} from '../src/buildForgeTx.js';
import { createBlazeTokenHuntRegistry } from '../src/registry.js';

const LOCAL_KEY_FILE = path.resolve('.chipnet-deployer.json');
const EVIDENCE_FILE = path.resolve('evidence', 'chipnet-deployment.json');
const MIN_DEPLOY_SATS = 12_000n;

interface DeployerKeyStore {
  createdAt: string;
  network: 'chipnet';
  privKeyHex: string;
  cashAddress: string;
  tokenAddress: string;
}

function deriveDeployerFromPrivHex(privKeyHex: string): DeployerKeyStore {
  const clean = privKeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('Invalid deployer private key hex (expected 64 hex chars)');
  }
  const priv = hexToBin(clean);
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') {
    throw new Error(`Failed to derive compressed public key: ${pub}`);
  }
  const pkh = hash160(pub);
  const cashAddress = encodeCashAddress({
    prefix: 'bchtest',
    type: 'p2pkh',
    payload: pkh,
  }).address;
  const tokenAddress = encodeCashAddress({
    prefix: 'bchtest',
    type: 'p2pkhWithTokens',
    payload: pkh,
  }).address;
  return {
    createdAt: new Date().toISOString(),
    network: 'chipnet',
    privKeyHex: clean,
    cashAddress,
    tokenAddress,
  };
}

async function loadOrCreateDeployer(): Promise<DeployerKeyStore> {
  const envKey = process.env.FAUCET_PRIVKEY_HEX?.trim();
  if (envKey && /^[0-9a-f]{64}$/i.test(envKey)) {
    return deriveDeployerFromPrivHex(envKey);
  }
  if (existsSync(LOCAL_KEY_FILE)) {
    const raw = JSON.parse(await readFile(LOCAL_KEY_FILE, 'utf8')) as DeployerKeyStore;
    if (raw?.privKeyHex && /^[0-9a-f]{64}$/i.test(raw.privKeyHex)) {
      return deriveDeployerFromPrivHex(raw.privKeyHex);
    }
  }
  let priv = randomBytes(32);
  let pub = secp256k1.derivePublicKeyCompressed(priv);
  while (typeof pub === 'string') {
    priv = randomBytes(32);
    pub = secp256k1.derivePublicKeyCompressed(priv);
  }
  const store = deriveDeployerFromPrivHex(binToHex(priv));
  await writeFile(LOCAL_KEY_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');
  return store;
}

/**
 * Ensures we have a pure-BCH UTXO positioned at `vout === 0` so spending it can serve
 * as a CashTokens genesis transaction (where the new token category equals the spent vout-0 txid).
 */
async function ensureVoutZeroGenesisInput(
  provider: ElectrumNetworkProvider,
  deployer: DeployerKeyStore,
  signer: SignatureTemplate,
  utxos: SpendableUtxo[],
  excludeTxids: Set<string>
): Promise<{ genesisInput: SpendableUtxo; remainingBchUtxos: SpendableUtxo[] }> {
  const pureBch = utxos.filter((u) => !u.token && !excludeTxids.has(`${u.txid}:${u.vout}`));
  const existingVout0 = pureBch.find((u) => u.vout === 0 && u.satoshis >= 3000n);
  if (existingVout0) {
    return {
      genesisInput: existingVout0,
      remainingBchUtxos: pureBch.filter(
        (u) => !(u.txid === existingVout0.txid && u.vout === existingVout0.vout)
      ),
    };
  }

  const totalSats = pureBch.reduce((s, u) => s + u.satoshis, 0n);
  if (totalSats < 4500n) {
    throw new Error(`Insufficient tBCH (${totalSats} sats) to prepare a vout=0 genesis input.`);
  }

  const prepBuilder = new TransactionBuilder({ provider });
  for (const u of pureBch) {
    prepBuilder.addInput(u, signer.unlockP2PKH());
  }
  const vout0Sats = 2500n;
  prepBuilder.addOutput({
    to: deployer.cashAddress,
    amount: vout0Sats,
  });
  prepBuilder.addBchChangeOutputIfNeeded({
    to: deployer.cashAddress,
    feeRate: 1.5,
  });

  const sentPrep = await prepBuilder.send();
  const genesisInput: SpendableUtxo = {
    txid: sentPrep.txid,
    vout: 0,
    satoshis: vout0Sats,
    lockingBytecode: binToHex(addressToLockingBytecode(deployer.cashAddress)),
  };
  const refreshed = (await provider.getUtxos(deployer.cashAddress)).filter(
    (u) => !u.token && !(u.txid === sentPrep.txid && u.vout === 0)
  );
  return { genesisInput, remainingBchUtxos: refreshed };
}

async function main() {
  await mkdir(path.dirname(EVIDENCE_FILE), { recursive: true });
  const deployer = await loadOrCreateDeployer();
  const signer = new SignatureTemplate(hexToBin(deployer.privKeyHex));
  const provider = new ElectrumNetworkProvider('chipnet');

  console.log('[deploy:chipnet] Connecting to BCH Chipnet Electrum network...');
  const blockHeight = await provider.getBlockHeight();
  const utxos = await provider.getUtxos(deployer.cashAddress);
  const pureBchUtxos = utxos.filter((u) => !u.token);
  const bchBalanceSats = pureBchUtxos.reduce((s, u) => s + u.satoshis, 0n);

  console.log(`[deploy:chipnet] Live Chipnet Block Height : ${blockHeight}`);
  console.log(`[deploy:chipnet] Deployer CashAddress      : ${deployer.cashAddress}`);
  console.log(`[deploy:chipnet] Deployer TokenAddress     : ${deployer.tokenAddress}`);
  console.log(`[deploy:chipnet] Current Chipnet Balance   : ${bchBalanceSats} sats (${utxos.length} UTXOs)`);

  if (bchBalanceSats < MIN_DEPLOY_SATS) {
    const previewDemoCat = 'dd' + '99'.repeat(30) + 'ee';
    const previewForgeCat = 'aa' + '42'.repeat(30) + 'cc';
    const previewSlots = createBlazeTokenHuntRegistry(previewDemoCat);
    const previewForge = instantiateForgeContract({
      provider,
      forgeCategory: previewForgeCat,
      slots: previewSlots,
    });
    const previewDispenser = instantiateDispenserContract(provider, previewDemoCat);

    const preflightReport = {
      status: 'awaiting_faucet_funding',
      checkedAt: new Date().toISOString(),
      network: 'chipnet',
      chipnetBlockHeight: blockHeight,
      deployer: {
        cashAddress: deployer.cashAddress,
        tokenAddress: deployer.tokenAddress,
        currentBalanceSats: Number(bchBalanceSats),
        minimumRequiredSats: Number(MIN_DEPLOY_SATS),
        keyStoredLocallyIn: '.chipnet-deployer.json',
      },
      compiledContracts: {
        blazeForge: {
          redeemScriptBytes: previewForge.bytesize,
          redeemOpcodesCount: previewForge.opcount,
        },
        stampDispenser: {
          redeemScriptBytes: previewDispenser.bytesize,
          redeemOpcodesCount: previewDispenser.opcount,
        },
      },
      faucets: [
        'https://tbch.googol.cash/',
        'https://chipnet.bch.ninja/',
      ],
      nextStepCommand: 'npm run deploy:chipnet',
    };

    await writeFile(EVIDENCE_FILE, JSON.stringify(preflightReport, null, 2) + '\n', 'utf8');
    console.log('\n[deploy:chipnet] PRE-FLIGHT READY (Awaiting Chipnet tBCH Faucet Funding)');
    console.log(`  1. Send >= ${MIN_DEPLOY_SATS} tBCH sats to: ${deployer.cashAddress}`);
    console.log('     Faucets: https://tbch.googol.cash/ or https://chipnet.bch.ninja/');
    console.log('  2. Re-run: npm run deploy:chipnet');
    console.log(`  3. Pre-flight receipt written to: ${EVIDENCE_FILE}`);
    process.exit(0);
  }

  // Step 1: Mint Genesis Baton for StampDispenser (`DEMO_CATEGORY`)
  console.log('\n[deploy:chipnet] Step 1/4: Minting StampDispenser Genesis Baton NFT on Chipnet...');
  const usedOutpoints = new Set<string>();
  const { genesisInput: demoGenInput, remainingBchUtxos: afterDemoPrep } =
    await ensureVoutZeroGenesisInput(provider, deployer, signer, pureBchUtxos, usedOutpoints);
  usedOutpoints.add(`${demoGenInput.txid}:${demoGenInput.vout}`);

  const demoCategory = demoGenInput.txid.toLowerCase();
  const dispenser = instantiateDispenserContract(provider, demoCategory);

  const demoGenBuilder = new TransactionBuilder({ provider });
  demoGenBuilder.addInput(demoGenInput, signer.unlockP2PKH());
  if (demoGenInput.satoshis < 2500n && afterDemoPrep.length > 0) {
    demoGenBuilder.addInput(afterDemoPrep[0], signer.unlockP2PKH());
  }
  demoGenBuilder.addOutput({
    to: dispenser.tokenAddress,
    amount: 1000n,
    token: {
      category: demoCategory,
      amount: 0n,
      nft: { capability: 'minting', commitment: '' },
    },
  });
  demoGenBuilder.addBchChangeOutputIfNeeded({
    to: deployer.cashAddress,
    feeRate: 1.5,
  });
  const demoGenTx = await demoGenBuilder.send();
  console.log(`  -> StampDispenser Genesis Txid : ${demoGenTx.txid}`);
  console.log(`  -> DEMO_CATEGORY               : ${demoCategory}`);

  // Step 2: Mint Genesis Baton for BlazeForge (`FORGE_CATEGORY`)
  console.log('\n[deploy:chipnet] Step 2/4: Minting BlazeForge Genesis Baton NFT on Chipnet...');
  const currentUtxos2 = await provider.getUtxos(deployer.cashAddress);
  const { genesisInput: forgeGenInput, remainingBchUtxos: afterForgePrep } =
    await ensureVoutZeroGenesisInput(provider, deployer, signer, currentUtxos2, usedOutpoints);
  usedOutpoints.add(`${forgeGenInput.txid}:${forgeGenInput.vout}`);

  const forgeCategory = forgeGenInput.txid.toLowerCase();
  const slots = createBlazeTokenHuntRegistry(demoCategory);
  const forge = instantiateForgeContract({
    provider,
    forgeCategory,
    slots,
  });

  const forgeGenBuilder = new TransactionBuilder({ provider });
  forgeGenBuilder.addInput(forgeGenInput, signer.unlockP2PKH());
  if (forgeGenInput.satoshis < 2500n && afterForgePrep.length > 0) {
    forgeGenBuilder.addInput(afterForgePrep[0], signer.unlockP2PKH());
  }
  forgeGenBuilder.addOutput({
    to: forge.tokenAddress,
    amount: 1000n,
    token: {
      category: forgeCategory,
      amount: 0n,
      nft: { capability: 'minting', commitment: '' },
    },
  });
  forgeGenBuilder.addBchChangeOutputIfNeeded({
    to: deployer.cashAddress,
    feeRate: 1.5,
  });
  const forgeGenTx = await forgeGenBuilder.send();
  console.log(`  -> BlazeForge Genesis Txid     : ${forgeGenTx.txid}`);
  console.log(`  -> FORGE_CATEGORY              : ${forgeCategory}`);

  // Step 3: 0-Conf Live Claim of 5 Demo Stamp NFTs on Chipnet
  console.log('\n[deploy:chipnet] Step 3/4: Executing 0-Conf StampDispenser.claim5 on Chipnet...');
  const tracker = new BatonMempoolTracker();
  const feeUtxosForClaim = (await provider.getUtxos(deployer.cashAddress)).filter((u) => !u.token);
  const claimBuilt = await buildClaimDemoStampsTx({
    provider,
    forgeCategory,
    demoCategory,
    slots,
    recipientAddress: deployer.tokenAddress,
    feeUtxos: feeUtxosForClaim,
    signer,
    batonTracker: tracker,
    includeUnconfirmed: true,
  });
  const claimSent = await claimBuilt.builder.send();
  console.log(`  -> 0-Conf Claim5 Txid          : ${claimSent.txid}`);

  // Step 4: 0-Conf Live Forge of Tier-5 BLAZE Medallion NFT on Chipnet
  console.log('\n[deploy:chipnet] Step 4/4: Executing 0-Conf BlazeForge.forge (Tier 5) on Chipnet...');
  const liveAfterClaim = await provider.getUtxos(deployer.tokenAddress);
  const feeUtxosForForge = (await provider.getUtxos(deployer.cashAddress)).filter((u) => !u.token);
  const forgeBuilt = await buildForgeTx(liveAfterClaim, 5, {
    provider,
    forgeCategory,
    demoCategory,
    slots,
    recipientAddress: deployer.tokenAddress,
    feeUtxos: feeUtxosForForge,
    signer,
    batonTracker: tracker,
    includeUnconfirmed: true,
  });
  const forgeSent = await forgeBuilt.builder.send();
  console.log(`  -> 0-Conf Forge Tier 5 Txid    : ${forgeSent.txid}`);

  const deployedReport = {
    status: 'deployed_and_verified_on_chipnet',
    deployedAt: new Date().toISOString(),
    network: 'chipnet',
    chipnetBlockHeight: blockHeight,
    deployer: {
      cashAddress: deployer.cashAddress,
      tokenAddress: deployer.tokenAddress,
    },
    categories: {
      forgeCategory,
      demoCategory,
    },
    contracts: {
      blazeForge: {
        address: forge.address,
        tokenAddress: forge.tokenAddress,
        redeemScriptBytes: forge.bytesize,
        redeemOpcodesCount: forge.opcount,
        genesisBatonTxid: forgeGenTx.txid,
      },
      stampDispenser: {
        address: dispenser.address,
        tokenAddress: dispenser.tokenAddress,
        redeemScriptBytes: dispenser.bytesize,
        redeemOpcodesCount: dispenser.opcount,
        genesisBatonTxid: demoGenTx.txid,
      },
    },
    zeroConfVerificationTxs: {
      claim5DemoStampsTxid: claimSent.txid,
      forgeTier5MedallionTxid: forgeSent.txid,
      trophyCommitmentHex: forgeBuilt.summary.trophyCommitmentHex,
    },
    envConfig: {
      BCH_NETWORK: 'chipnet',
      FORGE_CATEGORY: forgeCategory,
      DEMO_CATEGORY: demoCategory,
    },
  };

  await writeFile(EVIDENCE_FILE, JSON.stringify(deployedReport, null, 2) + '\n', 'utf8');
  console.log(`\n[deploy:chipnet] Deployment complete! Receipt written to ${EVIDENCE_FILE}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[deploy:chipnet] Error:', err);
  process.exit(1);
});
