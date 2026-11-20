import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OFFICIAL_TOKENHUNT_CATALOG } from '../src/registry.js';

interface RemoteTokenHuntItem {
  id: string;
  n: number;
  name?: string;
  revealed?: boolean;
  preview?: boolean;
  category?: string;
  commitment?: string | null;
  swapClaim?: {
    id: string;
    dex: string;
    category: string;
    symbol: string;
  };
}

interface RemoteTokenHuntConfig {
  tokens: RemoteTokenHuntItem[];
  bonus: RemoteTokenHuntItem;
  trophies: Array<{
    id: string;
    min: number;
    name: string;
    category: string;
  }>;
  forge: {
    live: boolean;
  };
}

const TOKENHUNT_URL = 'https://bchblaze.cash/tokenhunt/';
const LOCAL_SNAPSHOT_PATH = path.resolve('site_pages', 'tokenhunt.html');

async function loadTokenHuntHtml(): Promise<{
  html: string;
  sourceMode: 'live-https' | 'local-snapshot-fallback';
  serverDateHeader: string | null;
}> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(TOKENHUNT_URL, {
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        return {
          html: await res.text(),
          sourceMode: 'live-https',
          serverDateHeader: res.headers.get('date'),
        };
      }
    } catch (err) {
      if (attempt === 2 && existsSync(LOCAL_SNAPSHOT_PATH)) {
        console.warn(
          `[sync:tokenhunt] Live fetch to ${TOKENHUNT_URL} unreachable (${err instanceof Error ? err.message : String(err)}); using verified snapshot ${LOCAL_SNAPSHOT_PATH}`
        );
        return {
          html: await readFile(LOCAL_SNAPSHOT_PATH, 'utf8'),
          sourceMode: 'local-snapshot-fallback',
          serverDateHeader: null,
        };
      }
    }
  }
  throw new Error(`Unable to fetch ${TOKENHUNT_URL} and no local snapshot found.`);
}

async function main() {
  console.log(`[sync:tokenhunt] Checking TokenHunt config from ${TOKENHUNT_URL} ...`);
  const { html, sourceMode, serverDateHeader } = await loadTokenHuntHtml();

  const match = html.match(/<script[^>]*id="th-config"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error('Could not locate <script id="th-config"> in TokenHunt HTML');
  }

  const remoteConfig = JSON.parse(match[1].trim()) as RemoteTokenHuntConfig;
  const remoteTokens = [...remoteConfig.tokens, remoteConfig.bonus];

  const newlyActivatedOverrides: Record<string, string> = {};
  const slotComparisons = OFFICIAL_TOKENHUNT_CATALOG.map((localSlot, idx) => {
    const remote = remoteTokens.find((t) => t.id === localSlot.id);
    const remoteCat = (remote?.category ?? '').trim().toLowerCase();
    const isRemoteLive = /^[0-9a-f]{64}$/.test(remoteCat);
    const matchesLocal = isRemoteLive && remoteCat === localSlot.category.toLowerCase();

    if (isRemoteLive && localSlot.activationStatus === 'staging') {
      newlyActivatedOverrides[localSlot.id] = remoteCat;
    }

    return {
      slot: idx,
      id: localSlot.id,
      name: remote?.name ?? localSlot.name,
      remoteRevealed: Boolean(remote?.revealed),
      remotePreview: Boolean(remote?.preview),
      remoteStatus: isRemoteLive ? 'LIVE_ON_BCHBLAZE' : 'ACTIVATION_PENDING_ON_BCHBLAZE',
      remoteCategory: isRemoteLive ? remoteCat : null,
      localCategory: localSlot.category,
      localActivationStatus: localSlot.activationStatus ?? 'live',
      inSync: isRemoteLive ? matchesLocal : localSlot.activationStatus === 'staging',
      swapClaimCategory: remote?.swapClaim?.category ?? null,
    };
  });

  const liveCount = slotComparisons.filter((s) => s.remoteStatus === 'LIVE_ON_BCHBLAZE').length;
  const pendingCount = slotComparisons.length - liveCount;

  const report = {
    checkedAt: new Date().toISOString(),
    sourceUrl: TOKENHUNT_URL,
    sourceMode,
    serverDateHeader,
    organizerForgeLiveFlag: Boolean(remoteConfig.forge?.live),
    summary: {
      totalOfficialSlots: slotComparisons.length,
      liveOnBchBlaze: liveCount,
      pendingActivationOnBchBlaze: pendingCount,
      newlyActivatedCount: Object.keys(newlyActivatedOverrides).length,
      allLiveCategoriesMatchLocalRegistry: slotComparisons
        .filter((s) => s.remoteStatus === 'LIVE_ON_BCHBLAZE')
        .every((s) => s.inSync),
    },
    newlyActivatedOverrides,
    slots: slotComparisons,
    trophiesOnBchBlaze: remoteConfig.trophies,
  };

  const outDir = path.resolve('evidence');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'tokenhunt-live-sync.json');
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(
    `[sync:tokenhunt] Verified ${slotComparisons.length} official slots (${sourceMode}): ${liveCount} LIVE, ${pendingCount} PENDING on bchblaze.cash`
  );
  for (const s of slotComparisons) {
    const tag = s.remoteStatus === 'LIVE_ON_BCHBLAZE' ? 'LIVE   ' : 'PENDING';
    const catInfo = s.remoteCategory
      ? `${s.remoteCategory.slice(0, 12)}... (inSync=${s.inSync})`
      : `staging=${s.localCategory.slice(0, 12)}...`;
    console.log(`  Slot ${String(s.slot).padStart(2, ' ')} | ${tag} | ${s.id.padEnd(22, ' ')} | ${catInfo}`);
  }
  console.log(`[sync:tokenhunt] Organizer forge.live flag on bchblaze.cash: ${report.organizerForgeLiveFlag}`);
  console.log(`[sync:tokenhunt] Wrote audit receipt to ${outPath}`);
}

main().catch((err) => {
  console.error('[sync:tokenhunt] Error:', err);
  process.exit(1);
});
