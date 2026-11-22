// cindr Workspace Controller — Real API Integration, Session Wallets, Disclosures & Tab Choreography

const SESSION_STORAGE_KEY = 'blaze_forge_session_wallets_v1';

const numberFormatter = new Intl.NumberFormat(
  navigator.languages && navigator.languages.length ? navigator.languages : ['en-US']
);

function syncUrlParams(updates) {
  const url = new URL(window.location.href);
  const defaults = { tab: 'forge', tier: '5', filter: 'all' };
  for (const [key, val] of Object.entries(updates)) {
    if (!val || val === defaults[key]) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(val));
    }
  }
  window.history.replaceState(null, '', url.toString());
}

const ATTACK_PLAIN = {
  'under-count-4':
    'Blocked — the covenant requires 5, 9, or 10 distinct stamps; submitting 4 stamps fails immediately.',
  'duplicate-slot':
    'Blocked — slot indices must increase strictly (slot > prevSlot), rejecting duplicate Stamp #1.',
  'fake-category':
    'Blocked — every badge UTXO category must match its registered 32-byte TokenHunt slot ID.',
  'anti-burn-keep-stamps':
    'Blocked — Output 2 must carry 0 token categories (tokenCategory == 0x), proving spent stamps burn forever.',
  'steal-baton':
    'Blocked — Output 0 must return the Minting Baton NFT back to the cindr covenant locking bytecode.',
};

const TIER_META = {
  5: { name: 'cindr Medallion', need: 5 },
  9: { name: 'cindr Trophy', need: 9 },
  10: { name: 'cindr Apex Trophy', need: 10 },
};

const state = {
  health: null,
  registry: null,
  baton: null,
  wallets: [],
  activeAddress: '',
  walletOverview: null,
  selectedTier: 5,
  registryFilter: 'all',
  busy: false,
  lastActionKind: null,
  activityLog: [],
  attackAbort: null,
  lastAttackType: 'under-count-4',
  wcModule: null,
  wcStatus: 'idle',
  wcWalletName: null,
  wcPairingUri: null,
  wcAddress: null,
};

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function rehydrateWcTransaction(wcTx) {
  if (!wcTx) return null;
  const hydrateToken = (tok) => {
    if (!tok) return undefined;
    return {
      category: typeof tok.category === 'string' ? hexToBytes(tok.category) : tok.category,
      amount: BigInt(tok.amount ?? 0),
      ...(tok.nft
        ? {
            nft: {
              capability: tok.nft.capability,
              commitment:
                typeof tok.nft.commitment === 'string'
                  ? hexToBytes(tok.nft.commitment)
                  : tok.nft.commitment,
            },
          }
        : {}),
    };
  };
  return {
    ...wcTx,
    transaction: {
      ...wcTx.transaction,
      inputs: (wcTx.transaction?.inputs ?? []).map((inp) => ({
        ...inp,
        outpointTransactionHash:
          typeof inp.outpointTransactionHash === 'string'
            ? hexToBytes(inp.outpointTransactionHash)
            : inp.outpointTransactionHash,
        unlockingBytecode:
          typeof inp.unlockingBytecode === 'string'
            ? hexToBytes(inp.unlockingBytecode)
            : inp.unlockingBytecode,
      })),
      outputs: (wcTx.transaction?.outputs ?? []).map((out) => ({
        ...out,
        lockingBytecode:
          typeof out.lockingBytecode === 'string'
            ? hexToBytes(out.lockingBytecode)
            : out.lockingBytecode,
        valueSatoshis: BigInt(out.valueSatoshis ?? 0),
        ...(out.token ? { token: hydrateToken(out.token) } : {}),
      })),
    },
    sourceOutputs: (wcTx.sourceOutputs ?? []).map((src) => ({
      ...src,
      outpointTransactionHash:
        typeof src.outpointTransactionHash === 'string'
          ? hexToBytes(src.outpointTransactionHash)
          : src.outpointTransactionHash,
      unlockingBytecode:
        typeof src.unlockingBytecode === 'string'
          ? hexToBytes(src.unlockingBytecode)
          : src.unlockingBytecode,
      lockingBytecode:
        typeof src.lockingBytecode === 'string'
          ? hexToBytes(src.lockingBytecode)
          : src.lockingBytecode,
      valueSatoshis: BigInt(src.valueSatoshis ?? 0),
      ...(src.token ? { token: hydrateToken(src.token) } : {}),
    })),
  };
}

function shortAddr(addr) {
  if (!addr || addr.length <= 20) return addr || '—';
  return `${addr.slice(0, 12)}…${addr.slice(-6)}`;
}

function shortHex(hex, left = 10, right = 6) {
  if (!hex || hex.length <= left + right + 2) return hex || '—';
  return `${hex.slice(0, left)}…${hex.slice(-right)}`;
}

function createIdempotencyKey(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function copyText(text, btn) {
  if (!text || text === '—') return;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1400);
    }
  } catch {
    // Clipboard blocked; leave button label untouched
  }
}

function saveSessionWallets() {
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ wallets: state.wallets, activeAddress: state.activeAddress })
    );
  } catch {
    // Session storage disabled
  }
}

function loadSessionWallets() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.wallets) && parsed.wallets.length > 0 && parsed.activeAddress) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const dom = {
  networkChip: document.getElementById('topbar-network-chip'),
  statusDot: document.getElementById('topbar-status-dot'),
  networkLabel: document.getElementById('topbar-network-label'),

  walletWrap: document.getElementById('wallet-menu-wrap'),
  btnWalletMenu: document.getElementById('btn-wallet-menu'),
  walletTriggerLabel: document.getElementById('wallet-trigger-label'),
  walletPopover: document.getElementById('wallet-popover'),
  popoverModeBadge: document.getElementById('popover-mode-badge'),
  popoverFullAddr: document.getElementById('popover-full-address'),
  btnCopyAddr: document.getElementById('btn-copy-address'),
  btnNewSandbox: document.getElementById('btn-new-sandbox'),
  sandboxWalletError: document.getElementById('sandbox-wallet-error'),
  popoverWalletListWrap: document.getElementById('popover-wallet-list-wrap'),
  popoverWalletList: document.getElementById('popover-wallet-list'),
  formCustomAddress: document.getElementById('form-custom-address'),
  inputCustomAddress: document.getElementById('input-custom-address'),
  customAddressError: document.getElementById('custom-address-error'),
  popoverWcStateTag: document.getElementById('popover-wc-state-tag'),
  btnConnectLiveWallet: document.getElementById('btn-connect-live-wallet'),
  btnDisconnectLiveWallet: document.getElementById('btn-disconnect-live-wallet'),
  liveWalletStatusNote: document.getElementById('live-wallet-status-note'),

  wcModal: document.getElementById('wc-modal'),
  btnWcClose: document.getElementById('btn-wc-close'),
  wcQrStage: document.getElementById('wc-qr-stage'),
  wcQrCanvas: document.getElementById('wc-qr-canvas'),
  wcQrLoading: document.getElementById('wc-qr-loading'),
  btnWcOpenApp: document.getElementById('btn-wc-open-app'),
  btnWcCopyUri: document.getElementById('btn-wc-copy-uri'),
  wcStatusLine: document.getElementById('wc-status-line'),

  workspaceFinding: document.getElementById('workspace-finding'),
  btnHeaderPrimary: document.getElementById('btn-header-primary'),

  kpiStamps: document.getElementById('kpi-stamps'),
  kpiTrophies: document.getElementById('kpi-trophies'),
  kpiLatency: document.getElementById('kpi-latency'),

  tierButtons: document.querySelectorAll('.seg-btn'),
  tierHint: document.getElementById('tier-requirement-hint'),
  slotProgressPill: document.getElementById('slot-progress-pill'),
  stampSlotStrip: document.getElementById('stamp-slot-strip'),
  btnForgeAction: document.getElementById('btn-forge-action'),
  btnClaimAction: document.getElementById('btn-claim-action'),
  actionNote: document.getElementById('action-readiness-note'),
  utxoLabel: document.getElementById('utxo-disclosure-label'),
  utxoBody: document.getElementById('utxo-inspector-body'),

  receiptBadge: document.getElementById('dash-receipt-badge'),
  receiptEmpty: document.getElementById('dash-receipt-empty'),
  receiptError: document.getElementById('dash-receipt-error'),
  errorTitle: document.getElementById('dash-error-title'),
  errorMsg: document.getElementById('dash-error-msg'),
  btnReceiptRetry: document.getElementById('btn-receipt-retry'),
  receiptResult: document.getElementById('dash-receipt-result'),
  resultTitle: document.getElementById('dash-result-title'),
  resultMs: document.getElementById('dash-result-ms'),
  resultSummary: document.getElementById('dash-result-summary'),
  txidLabel: document.getElementById('dash-txid-label'),
  resultTxid: document.getElementById('dash-result-txid'),
  btnCopyTxid: document.getElementById('btn-copy-txid'),
  resultBytes: document.getElementById('dash-result-bytes'),
  resultZeroConf: document.getElementById('dash-result-zeroconf'),
  techSpentBaton: document.getElementById('tech-spent-baton'),
  techNextBaton: document.getElementById('tech-next-baton'),
  techCommitRow: document.getElementById('tech-commit-row'),
  techCommitment: document.getElementById('tech-commitment'),
  techHexLabel: document.getElementById('tech-hex-label'),
  techRawHex: document.getElementById('tech-raw-hex'),
  btnCopyHex: document.getElementById('btn-copy-hex'),

  heldTrophiesCount: document.getElementById('held-trophies-count'),
  heldTrophiesList: document.getElementById('held-trophies-list'),
  activityCount: document.getElementById('activity-count'),
  activityList: document.getElementById('activity-list'),

  tabButtons: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),

  attackButtons: document.querySelectorAll('.attack-row'),
  attackLabel: document.getElementById('dash-attack-label'),
  attackPill: document.getElementById('dash-attack-pill'),
  attackMs: document.getElementById('dash-attack-ms'),
  btnRetryAttack: document.getElementById('btn-retry-dash-attack'),
  attackPlain: document.getElementById('dash-attack-plain'),
  attackRule: document.getElementById('dash-attack-rule'),
  attackTrace: document.getElementById('dash-attack-trace'),

  btnRefreshNetwork: document.getElementById('btn-refresh-network'),
  covenantSpecsList: document.getElementById('covenant-specs-list'),
  batonPendingBadge: document.getElementById('baton-pending-badge'),
  batonStatusList: document.getElementById('baton-status-list'),
  filterPills: document.querySelectorAll('.filter-pill'),
  registryTableBody: document.getElementById('registry-table-body'),
};

// ---------------------------------------------------------------------------
// API Fetching Helpers
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  return body;
}

async function apiPost(path, payload, idemKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Rendering Functions
// ---------------------------------------------------------------------------
function renderWalletHeader() {
  const currentMeta = state.wallets.find((w) => w.address === state.activeAddress);
  const label = currentMeta?.label || 'Custom address';
  const mode = state.walletOverview?.mode || currentMeta?.mode || 'sandbox';

  if (dom.walletTriggerLabel) {
    const isNarrow = window.innerWidth <= 640;
    dom.walletTriggerLabel.textContent =
      isNarrow && state.activeAddress
        ? `${label} · …${state.activeAddress.slice(-4)}`
        : `${label} · ${shortAddr(state.activeAddress)}`;
  }
  if (dom.popoverModeBadge) {
    if (currentMeta?.mode === 'wizardconnect') {
      dom.popoverModeBadge.textContent = 'Live BCH wallet';
    } else {
      dom.popoverModeBadge.textContent = mode === 'sandbox' ? 'Sandbox signer' : 'External watch';
    }
  }
  if (dom.popoverWcStateTag) {
    const isWcConnected = state.wcStatus === 'connected';
    dom.popoverWcStateTag.textContent = isWcConnected
      ? state.wcWalletName || 'Connected'
      : 'WizardConnect';
    dom.popoverWcStateTag.classList.toggle('is-connected', isWcConnected);
  }
  if (dom.btnConnectLiveWallet && dom.btnDisconnectLiveWallet) {
    const isWcConnected = state.wcStatus === 'connected';
    dom.btnConnectLiveWallet.hidden = isWcConnected;
    dom.btnDisconnectLiveWallet.hidden = !isWcConnected;
  }
  if (dom.liveWalletStatusNote) {
    if (state.wcStatus === 'connected' && state.wcAddress) {
      dom.liveWalletStatusNote.textContent = `Connected to ${state.wcWalletName || 'BCH Wallet'} (${shortAddr(state.wcAddress)}). Forging prompts your wallet to sign.`;
    } else {
      dom.liveWalletStatusNote.textContent =
        'Pair Selene, Cauldron, or Paytaca over BCH WizardConnect relay for non-custodial signing.';
    }
  }
  if (dom.popoverFullAddr) {
    dom.popoverFullAddr.textContent = state.activeAddress || '—';
  }

  if (dom.popoverWalletListWrap && dom.popoverWalletList) {
    if (state.wallets.length === 0) {
      dom.popoverWalletListWrap.hidden = true;
    } else {
      dom.popoverWalletListWrap.hidden = false;
      dom.popoverWalletList.innerHTML = '';
      for (const w of state.wallets) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `session-wallet-item${w.address === state.activeAddress ? ' is-current' : ''}`;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = w.label;
        const addrSpan = document.createElement('span');
        addrSpan.className = 'session-wallet-addr';
        addrSpan.textContent = shortAddr(w.address);
        item.append(nameSpan, addrSpan);
        item.addEventListener('click', async () => {
          state.activeAddress = w.address;
          saveSessionWallets();
          closeWalletPopover();
          await refreshWalletOverview();
        });
        dom.popoverWalletList.appendChild(item);
      }
    }
  }
}

function renderForgeWorkspace() {
  const overview = state.walletOverview;
  const stamps = overview?.stamps ?? [];
  const trophies = overview?.trophies ?? [];
  const tierDef = TIER_META[state.selectedTier];
  const distinctCount = new Set(stamps.map((s) => s.slot)).size;
  const canForgeSelected = distinctCount >= tierDef.need;
  const isMock = state.health?.networkMode === 'mock';
  const isExternal = overview?.mode === 'external';

  // Top KPI Strip
  if (dom.kpiStamps) {
    dom.kpiStamps.textContent = overview ? `${distinctCount} / ${tierDef.need}` : '—';
  }
  if (dom.kpiTrophies) {
    dom.kpiTrophies.textContent = overview ? String(trophies.length) : '—';
  }
  if (dom.kpiLatency) {
    dom.kpiLatency.textContent = '0 blocks';
  }

  // Workspace One-line Finding & Single Primary Header Action
  if (dom.workspaceFinding && dom.btnHeaderPrimary) {
    dom.btnHeaderPrimary.classList.toggle('is-busy', state.busy);
    dom.btnHeaderPrimary.setAttribute('aria-busy', String(state.busy));
    if (!overview) {
      dom.workspaceFinding.textContent = 'Connect or create a sandbox wallet to begin.';
      dom.btnHeaderPrimary.disabled = true;
      dom.btnHeaderPrimary.textContent = 'Loading…';
    } else if (canForgeSelected) {
      dom.workspaceFinding.textContent = `${distinctCount} distinct stamps held — ready to burn ${tierDef.need} and mint your ${tierDef.name} in 0 blocks.`;
      dom.btnHeaderPrimary.disabled = state.busy;
      dom.btnHeaderPrimary.textContent =
        state.busy && state.lastActionKind === 'forge'
          ? 'Minting…'
          : isExternal
          ? `Build unsigned ${tierDef.name}`
          : `Mint ${tierDef.name}`;
      dom.btnHeaderPrimary.dataset.action = 'forge';
    } else if (distinctCount >= 5) {
      const missing = tierDef.need - distinctCount;
      dom.workspaceFinding.textContent = `${distinctCount} stamps held (ready for 5-stamp Medallion; need ${missing} more for ${tierDef.name}).`;
      dom.btnHeaderPrimary.disabled = state.busy;
      dom.btnHeaderPrimary.textContent =
        state.busy && state.lastActionKind === 'forge'
          ? 'Minting…'
          : 'Mint cindr Medallion (5)';
      dom.btnHeaderPrimary.dataset.action = 'forge-5';
    } else if (isMock) {
      dom.workspaceFinding.textContent = `${distinctCount} stamps in this wallet — claim 5 free Demo Stamps in 1 transaction to unlock minting.`;
      dom.btnHeaderPrimary.disabled = state.busy;
      dom.btnHeaderPrimary.textContent =
        state.busy && state.lastActionKind === 'claim' ? 'Claiming…' : 'Claim 5 demo stamps';
      dom.btnHeaderPrimary.dataset.action = 'claim';
    } else {
      dom.workspaceFinding.textContent = `${distinctCount} stamps held — collect ${5 - distinctCount} more official TokenHunt badges or claim Demo Stamps.`;
      dom.btnHeaderPrimary.disabled = state.busy;
      dom.btnHeaderPrimary.textContent =
        state.busy && state.lastActionKind === 'claim' ? 'Claiming…' : 'Claim 5 demo stamps';
      dom.btnHeaderPrimary.dataset.action = 'claim';
    }
  }

  // Tier Header & Progress Pill
  if (dom.tierHint) {
    dom.tierHint.textContent =
      state.selectedTier === 5
        ? 'Accepts any 5 distinct official badges or 5 1-click Demo Stamps (slots 10–14).'
        : state.selectedTier === 9
        ? 'Requires 9 distinct registered stamps verified together inside the cindr covenant.'
        : 'Requires 10 distinct registered stamps verified under CashVM OpCost limits.';
  }
  if (dom.slotProgressPill) {
    const heldForTier = Math.min(distinctCount, tierDef.need);
    dom.slotProgressPill.textContent = `${heldForTier} / ${tierDef.need} held`;
    dom.slotProgressPill.classList.toggle('is-ready', canForgeSelected);
  }

  // Visual Stamp Slot Strip
  if (dom.stampSlotStrip) {
    dom.stampSlotStrip.innerHTML = '';
    const allSlots = state.registry?.slots ?? [];
    let displaySlots = [];
    if (state.selectedTier === 5) {
      const heldFive = stamps.slice(0, 5);
      const demoDefaults = allSlots.filter((s) => s.kind === 'demo').slice(0, 5);
      displaySlots = Array.from({ length: 5 }, (_, idx) => {
        const held = heldFive[idx];
        const fallbackDef = demoDefaults[idx] ?? allSlots[10 + idx];
        return {
          slotNum: held?.slot ?? fallbackDef?.slot ?? 10 + idx,
          name: held?.name ?? fallbackDef?.name ?? `Demo #${idx + 1}`,
          held: Boolean(held),
        };
      });
    } else {
      displaySlots = Array.from({ length: tierDef.need }, (_, idx) => {
        const slotDef = allSlots[idx];
        const held = stamps.find((s) => s.slot === (slotDef?.slot ?? idx));
        return {
          slotNum: slotDef?.slot ?? idx,
          name: held?.name ?? slotDef?.name ?? `Slot ${idx}`,
          held: Boolean(held),
        };
      });
    }

    for (const item of displaySlots) {
      const tile = document.createElement('div');
      tile.className = `slot-tile${item.held ? ' is-held' : ''}`;
      const top = document.createElement('div');
      top.className = 'slot-tile-top';
      const idxSpan = document.createElement('span');
      idxSpan.textContent = `#${item.slotNum}`;
      const markSpan = document.createElement('span');
      markSpan.textContent = item.held ? 'Held' : 'Empty';
      top.append(idxSpan, markSpan);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'slot-tile-name';
      labelSpan.textContent = item.name.replace(/^Demo Stamp /i, 'Demo ');
      labelSpan.title = item.name;

      tile.append(top, labelSpan);
      dom.stampSlotStrip.appendChild(tile);
    }
  }

  // Action Controls
  if (dom.btnForgeAction && dom.btnClaimAction && dom.actionNote) {
    const forgeBusy = state.busy && state.lastActionKind === 'forge';
    const claimBusy = state.busy && state.lastActionKind === 'claim';
    dom.btnForgeAction.disabled = state.busy || !canForgeSelected;
    dom.btnForgeAction.classList.toggle('is-busy', forgeBusy);
    dom.btnForgeAction.setAttribute('aria-busy', String(forgeBusy));
    dom.btnForgeAction.textContent = forgeBusy
      ? 'Minting…'
      : isExternal
      ? `Build unsigned ${tierDef.name}`
      : `Mint ${tierDef.name}`;
    dom.btnClaimAction.disabled = state.busy || !overview;
    dom.btnClaimAction.classList.toggle('is-busy', claimBusy);
    dom.btnClaimAction.setAttribute('aria-busy', String(claimBusy));
    dom.btnClaimAction.textContent = claimBusy ? 'Claiming…' : 'Claim 5 demo stamps';
    if (!canForgeSelected) {
      const missing = tierDef.need - distinctCount;
      dom.actionNote.textContent = `Mint disabled: hold ${missing} more distinct ${missing === 1 ? 'stamp' : 'stamps'} to unlock ${tierDef.name}.`;
    } else if (isExternal) {
      dom.actionNote.textContent =
        'External address mode: builds a ready-to-sign WalletConnect payload without touching private keys.';
    } else {
      dom.actionNote.textContent =
        'Ready: runs 1 0-conf transaction burning held stamps and returning the contract baton.';
    }
  }

  // Collapsible UTXO Disclosure
  if (dom.utxoLabel && dom.utxoBody) {
    const utxoCount = overview?.utxoCount ?? 0;
    const bch = overview ? numberFormatter.format(overview.bchSatoshis) : '0';
    dom.utxoLabel.textContent = `Inspect stamp & fee UTXOs (${stamps.length} stamps · ${bch} BCH sats · ${utxoCount} total)`;

    dom.utxoBody.innerHTML = '';
    if (stamps.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-inline';
      p.textContent = 'No registered Stamp UTXOs held by this address right now.';
      dom.utxoBody.appendChild(p);
    } else {
      const list = document.createElement('div');
      list.className = 'ruled-list';
      for (const st of stamps) {
        const row = document.createElement('div');
        row.className = 'ruled-row';
        const top = document.createElement('div');
        top.className = 'ruled-row-top';
        const nameEl = document.createElement('span');
        nameEl.className = 'ruled-row-title';
        nameEl.textContent = `Slot ${st.slot} · ${st.name}`;
        const satEl = document.createElement('span');
        satEl.className = 'muted-meta num';
        satEl.textContent = `${st.satoshis} sats`;
        top.append(nameEl, satEl);

        const meta = document.createElement('div');
        meta.className = 'ruled-row-meta';
        meta.textContent = `Outpoint: ${shortHex(st.txid, 8, 6)}:${st.vout} · Commit: 0x${st.commitment || '00'}`;
        row.append(top, meta);
        list.appendChild(row);
      }
      dom.utxoBody.appendChild(list);
    }
  }

  // Held Trophies Panel
  if (dom.heldTrophiesCount && dom.heldTrophiesList) {
    dom.heldTrophiesCount.textContent = `${trophies.length} ${trophies.length === 1 ? 'NFT' : 'NFTs'}`;
    dom.heldTrophiesList.innerHTML = '';
    if (trophies.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-inline';
      p.textContent = 'No Trophy NFTs minted to this address yet.';
      dom.heldTrophiesList.appendChild(p);
    } else {
      const list = document.createElement('div');
      list.className = 'ruled-list';
      for (const tr of trophies) {
        const row = document.createElement('div');
        row.className = 'ruled-row';
        const top = document.createElement('div');
        top.className = 'ruled-row-top';
        const title = document.createElement('span');
        title.className = 'ruled-row-title';
        title.textContent = `${tr.tierName} (Tier ${tr.tier})`;
        const pill = document.createElement('span');
        pill.className = 'kind-chip is-demo';
        pill.textContent = `${tr.burnedSlots.length} stamps sealed`;
        top.append(title, pill);

        const meta = document.createElement('div');
        meta.className = 'ruled-row-meta';
        meta.textContent = `Commitment: 0x${tr.commitmentHex} · Slots [${tr.burnedSlots.join(', ')}]`;
        row.append(top, meta);
        list.appendChild(row);
      }
      dom.heldTrophiesList.appendChild(list);
    }
  }
}

function renderActivityLog() {
  if (!dom.activityCount || !dom.activityList) return;
  const count = state.activityLog.length;
  dom.activityCount.textContent = `${count} ${count === 1 ? 'transaction' : 'transactions'}`;
  dom.activityList.innerHTML = '';

  if (count === 0) {
    const p = document.createElement('p');
    p.className = 'empty-inline';
    p.textContent = 'Actions you run in this session appear here with expandable outpoints.';
    dom.activityList.appendChild(p);
    return;
  }

  const list = document.createElement('div');
  list.className = 'ruled-list';
  for (const entry of state.activityLog) {
    const row = document.createElement('div');
    row.className = 'ruled-row';

    const top = document.createElement('div');
    top.className = 'ruled-row-top';
    const title = document.createElement('span');
    title.className = 'ruled-row-title';
    title.textContent = entry.title;
    const timing = document.createElement('span');
    timing.className = 'muted-meta num';
    timing.textContent = `${entry.bytes} bytes · ${entry.ms}ms`;
    top.append(title, timing);

    const meta = document.createElement('div');
    meta.className = 'ruled-row-meta';
    meta.textContent = `${entry.walletLabel} · tx ${shortHex(entry.txid, 8, 6)} · 0-conf baton chained`;

    row.append(top, meta);
    list.appendChild(row);
  }
  dom.activityList.appendChild(list);
}

function showReceiptSuccess(payload) {
  dom.receiptEmpty.hidden = true;
  dom.receiptError.hidden = true;
  dom.receiptResult.hidden = false;
  dom.techCommitRow.hidden = !payload.commitmentHex;

  dom.receiptBadge.className = `receipt-badge ${payload.unsigned ? 'is-unsigned' : 'is-success'}`;
  dom.receiptBadge.textContent = payload.badgeText;
  dom.resultTitle.textContent = payload.title;
  dom.resultMs.textContent = `${payload.ms}ms`;
  dom.resultSummary.textContent = payload.summary;
  dom.txidLabel.textContent = payload.unsigned ? 'Unsigned Tx Hash' : 'Transaction ID';
  dom.resultTxid.textContent = payload.txid || '—';
  dom.resultBytes.textContent = `${numberFormatter.format(payload.bytes)} bytes`;
  dom.resultZeroConf.textContent = payload.zeroConf ? 'Chained in mempool' : 'Confirmed base';

  dom.techSpentBaton.textContent = payload.spentBatonOutpoint || '—';
  dom.techNextBaton.textContent = payload.nextBatonOutpoint || '—';
  dom.techCommitment.textContent = payload.commitmentHex ? `0x${payload.commitmentHex}` : '—';
  dom.techHexLabel.textContent = payload.unsigned ? 'wcTransaction JSON' : 'Raw txHex';
  dom.techRawHex.textContent = payload.rawPayload || '—';
}

function showReceiptError(title, message) {
  dom.receiptEmpty.hidden = true;
  dom.receiptResult.hidden = true;
  dom.receiptError.hidden = false;
  dom.receiptBadge.className = 'receipt-badge is-error';
  dom.receiptBadge.textContent = 'Error';
  dom.errorTitle.textContent = title;
  dom.errorMsg.textContent = message;
}

function renderNetworkAndRegistry() {
  if (state.health && dom.covenantSpecsList) {
    dom.covenantSpecsList.innerHTML = '';
    const contracts = [state.health.contracts.forge, state.health.contracts.dispenser];
    for (const c of contracts) {
      const row = document.createElement('div');
      row.className = 'spec-row';

      const head = document.createElement('div');
      head.className = 'spec-head';
      const nameEl = document.createElement('span');
      nameEl.className = 'spec-name';
      nameEl.textContent = `${c.name}.cash`;
      const statEl = document.createElement('span');
      statEl.className = 'spec-stats num';
      statEl.textContent = `${c.redeemScriptBytes}B P2SH32 (${c.redeemOpcodesCount} ops) · ${c.bytecodeBytes}B template`;
      head.append(nameEl, statEl);

      const copyRow = document.createElement('div');
      copyRow.className = 'joined-copy-row';
      const code = document.createElement('code');
      code.className = 'joined-code';
      code.textContent = c.tokenAddress;
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'joined-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyText(c.tokenAddress, copyBtn));
      copyRow.append(code, copyBtn);

      row.append(head, copyRow);
      dom.covenantSpecsList.appendChild(row);
    }
  }

  if (state.baton && dom.batonStatusList && dom.batonPendingBadge) {
    dom.batonPendingBadge.textContent = `${state.baton.pendingZeroConfChains} unconfirmed`;
    dom.batonStatusList.innerHTML = '';
    const items = [
      { label: 'cindr minting baton', value: state.baton.forge.currentBatonOutpoint },
      { label: 'StampDispenser faucet baton', value: state.baton.dispenser.currentBatonOutpoint },
    ];
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'spec-row';
      const head = document.createElement('div');
      head.className = 'spec-head';
      const nameEl = document.createElement('span');
      nameEl.className = 'spec-name';
      nameEl.textContent = item.label;
      head.appendChild(nameEl);

      const copyRow = document.createElement('div');
      copyRow.className = 'joined-copy-row';
      const code = document.createElement('code');
      code.className = 'joined-code';
      code.textContent = item.value;
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'joined-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyText(item.value, copyBtn));
      copyRow.append(code, copyBtn);

      row.append(head, copyRow);
      dom.batonStatusList.appendChild(row);
    }
  }

  if (state.registry && dom.registryTableBody) {
    const filtered = state.registry.slots.filter((s) =>
      state.registryFilter === 'all' ? true : s.kind === state.registryFilter
    );
    dom.registryTableBody.innerHTML = '';
    for (const slot of filtered) {
      const tr = document.createElement('tr');

      const tdSlot = document.createElement('td');
      tdSlot.className = 'num-col';
      tdSlot.textContent = String(slot.slot);

      const tdName = document.createElement('td');
      tdName.textContent = slot.name;
      if (slot.kind === 'official' && slot.activationStatus) {
        const tag = document.createElement('span');
        tag.className =
          slot.activationStatus === 'live' ? 'status-tag-live' : 'status-tag-staging';
        tag.textContent = slot.activationStatus === 'live' ? 'Live' : 'Staging';
        tdName.appendChild(tag);
      }

      const tdKind = document.createElement('td');
      const kindSpan = document.createElement('span');
      kindSpan.className = `kind-chip${slot.kind === 'demo' ? ' is-demo' : ''}`;
      kindSpan.textContent = slot.kind;
      tdKind.appendChild(kindSpan);

      const tdRule = document.createElement('td');
      const ruleCode = document.createElement('code');
      ruleCode.textContent =
        slot.commitmentRule === null
          ? 'Any NFT or FT >= 1'
          : `NFT commitment 0x${slot.commitmentRule.toString(16).padStart(2, '0')}`;
      tdRule.appendChild(ruleCode);

      const tdCat = document.createElement('td');
      const catWrap = document.createElement('div');
      catWrap.className = 'cat-cell';
      const catSpan = document.createElement('span');
      catSpan.className = 'cat-hex';
      catSpan.textContent = shortHex(slot.category, 10, 6);
      catSpan.title = slot.category;
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-secondary btn-xs';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyText(slot.category, copyBtn));
      catWrap.append(catSpan, copyBtn);
      tdCat.appendChild(catWrap);

      tr.append(tdSlot, tdName, tdKind, tdRule, tdCat);
      dom.registryTableBody.appendChild(tr);
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function refreshWalletOverview() {
  if (!state.activeAddress) return;
  try {
    state.walletOverview = await apiGet(
      `/api/wallet?address=${encodeURIComponent(state.activeAddress)}`
    );
  } catch (err) {
    state.walletOverview = null;
    if (dom.workspaceFinding) {
      dom.workspaceFinding.textContent =
        err instanceof Error ? err.message : 'Unable to load wallet UTXOs.';
    }
  }
  renderWalletHeader();
  renderForgeWorkspace();
}

async function refreshNetworkTelemetry() {
  try {
    const [health, baton, registry] = await Promise.all([
      apiGet('/api/health'),
      apiGet('/api/baton'),
      state.registry ? Promise.resolve(state.registry) : apiGet('/api/registry'),
    ]);
    state.health = health;
    state.baton = baton;
    state.registry = registry;

    if (dom.statusDot && dom.networkLabel) {
      dom.statusDot.className = 'status-dot is-online';
      dom.networkLabel.textContent = `${health.networkMode.toUpperCase()} · ${health.networkTarget}`;
    }
  } catch {
    if (dom.statusDot && dom.networkLabel) {
      dom.statusDot.className = 'status-dot is-offline';
      dom.networkLabel.textContent = 'Backend unreachable';
    }
  }
  renderForgeWorkspace();
  renderNetworkAndRegistry();
}

async function runClaimStamps() {
  if (state.busy || !state.activeAddress) return;
  state.busy = true;
  state.lastActionKind = 'claim';
  renderForgeWorkspace();

  const currentLabel =
    state.wallets.find((w) => w.address === state.activeAddress)?.label ||
    shortAddr(state.activeAddress);

  try {
    const res = await apiPost(
      '/api/stamps/claim',
      { recipientAddress: state.activeAddress },
      createIdempotencyKey('claim')
    );

    showReceiptSuccess({
      badgeText: '5 stamps claimed',
      title: 'StampDispenser.claim5 confirmed (0-conf)',
      ms: res.receipt.executionTimeMs,
      summary: `Dispensed slots [${res.stamps.map((s) => s.slot).join(', ')}] in a single transaction (${res.receipt.estimatedFeeSats} sats fee).`,
      txid: res.txid,
      bytes: res.receipt.txBytes,
      zeroConf: res.zeroConfChained,
      spentBatonOutpoint: res.spentBatonOutpoint,
      nextBatonOutpoint: res.nextBatonOutpoint,
      rawPayload: res.txHex,
      unsigned: false,
    });

    state.activityLog.unshift({
      title: 'Claim 5 Demo Stamps (slots 10–14)',
      walletLabel: currentLabel,
      txid: res.txid,
      bytes: res.receipt.txBytes,
      ms: res.receipt.executionTimeMs,
    });
    renderActivityLog();
    await Promise.all([refreshWalletOverview(), refreshNetworkTelemetry()]);
  } catch (err) {
    showReceiptError(
      'Demo stamp claim failed',
      err instanceof Error ? err.message : 'Unable to claim Demo Stamps.'
    );
  } finally {
    state.busy = false;
    renderForgeWorkspace();
  }
}

async function runForge(overrideTier) {
  if (state.busy || !state.activeAddress) return;
  const tier = overrideTier || state.selectedTier;
  state.busy = true;
  state.lastActionKind = 'forge';
  renderForgeWorkspace();

  const currentMeta = state.wallets.find((w) => w.address === state.activeAddress);
  const currentLabel = currentMeta?.label || shortAddr(state.activeAddress);
  const isExternal = state.walletOverview?.mode === 'external';
  const isLiveWcWallet =
    currentMeta?.mode === 'wizardconnect' &&
    state.wcStatus === 'connected' &&
    Boolean(state.wcModule);

  try {
    const res = await apiPost(
      '/api/forge',
      {
        recipientAddress: state.activeAddress,
        tier,
        autoBroadcast: !isExternal,
      },
      createIdempotencyKey(`forge-${tier}`)
    );

    const burnedList = res.summary.burnedSlots.map((s) => s.slot).join(', ');
    let finalTxid = res.txid;
    let finalRawPayload = res.wcTransaction
      ? JSON.stringify(res.wcTransaction, null, 2)
      : res.txHex;
    let finalBroadcasted = Boolean(res.broadcasted);
    let badgeText = res.broadcasted ? 'Minted in 0 blocks' : 'Unsigned wcTransaction';
    let titleText = res.broadcasted
      ? `${res.trophy.tierName} minted`
      : `${res.trophy.tierName} payload ready to sign`;

    if (!res.broadcasted && isLiveWcWallet && res.wcTransaction) {
      if (dom.receiptBadge) {
        dom.receiptBadge.textContent = 'Awaiting wallet signature…';
        dom.receiptBadge.className = 'receipt-badge is-unsigned';
      }
      const mgr = state.wcModule.manager();
      if (mgr && typeof mgr.signTransaction === 'function') {
        const hydrated = rehydrateWcTransaction(res.wcTransaction);
        const signed = await mgr.signTransaction({
          transaction: hydrated,
          inputPaths: res.inputPaths || [],
        });
        if (signed?.transactionHash) {
          finalTxid =
            typeof signed.transactionHash === 'string'
              ? signed.transactionHash
              : Array.from(signed.transactionHash)
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('');
        }
        if (signed?.transactionHex) {
          finalRawPayload = signed.transactionHex;
        }
        finalBroadcasted = true;
        badgeText = 'Signed & Minted (Live Wallet)';
        titleText = `${res.trophy.tierName} signed by ${state.wcWalletName || 'BCH Wallet'}`;
      }
    }

    showReceiptSuccess({
      badgeText,
      title: titleText,
      ms: res.receipt.executionTimeMs,
      summary: `Verified & burned ${res.trophy.burnedStampCount} slots [${burnedList}] (${res.summary.estimatedFeeSats} sats fee).`,
      txid: finalTxid,
      bytes: res.receipt.txBytes,
      zeroConf: res.zeroConfChained,
      spentBatonOutpoint: res.spentBatonOutpoint,
      nextBatonOutpoint: res.nextBatonOutpoint,
      commitmentHex: res.trophy.commitmentHex,
      rawPayload: finalRawPayload,
      unsigned: !finalBroadcasted,
    });

    state.activityLog.unshift({
      title: `Mint ${res.trophy.tierName} (Tier ${tier})`,
      walletLabel: currentLabel,
      txid: finalTxid,
      bytes: res.receipt.txBytes,
      ms: res.receipt.executionTimeMs,
    });
    renderActivityLog();
    await Promise.all([refreshWalletOverview(), refreshNetworkTelemetry()]);
  } catch (err) {
    showReceiptError(
      'Trophy mint failed',
      err instanceof Error ? err.message : 'Unable to mint Trophy.'
    );
  } finally {
    state.busy = false;
    renderForgeWorkspace();
  }
}

async function createAndSelectSandboxWallet() {
  const created = await apiPost('/api/wallet/demo', {});
  state.wallets.unshift({
    address: created.address,
    label: created.label,
    mode: created.mode,
  });
  state.activeAddress = created.address;
  saveSessionWallets();
  await refreshWalletOverview();
}

// ---------------------------------------------------------------------------
// Live BCH Wallet Pairing (WizardConnect Relay + QR Modal)
// ---------------------------------------------------------------------------
async function ensureWcModule() {
  if (!state.wcModule) {
    state.wcModule = await import('./vendor/wizardconnect.js');
  }
  return state.wcModule;
}

function setWcStatus(message, kind = 'normal') {
  if (!dom.wcStatusLine) return;
  dom.wcStatusLine.textContent = message;
  dom.wcStatusLine.classList.toggle('is-error', kind === 'error');
  dom.wcStatusLine.classList.toggle('is-connected', kind === 'connected');
}

let lastFocusedBeforeModal = null;

function openWcModal(preserveExisting = false) {
  if (!dom.wcModal) return;
  if (dom.wcModal.hidden && document.activeElement instanceof HTMLElement) {
    lastFocusedBeforeModal = document.activeElement;
  }
  if (!preserveExisting) {
    state.wcPairingUri = null;
    dom.wcQrStage?.classList.remove('is-ready');
    if (dom.btnWcOpenApp) {
      dom.btnWcOpenApp.href = '#';
      dom.btnWcOpenApp.setAttribute('aria-disabled', 'true');
    }
    if (dom.btnWcCopyUri) {
      dom.btnWcCopyUri.disabled = true;
    }
    setWcStatus('Starting secure relay on wss://relay.riften.net…');
  }
  dom.wcModal.hidden = false;
  dom.btnWcClose?.focus();
}

function closeWcModal(cancelIfConnecting = true) {
  if (!dom.wcModal) return;
  const wasOpen = !dom.wcModal.hidden;
  dom.wcModal.hidden = true;
  if (wasOpen) {
    state.wcModalDismissed = true;
  }
  if (cancelIfConnecting && state.wcStatus === 'connecting' && state.wcModule) {
    state.wcModule.disconnect().catch(() => {});
    state.wcStatus = 'idle';
    renderWalletHeader();
  }
  if (wasOpen) {
    const restoreTarget = lastFocusedBeforeModal;
    lastFocusedBeforeModal = null;
    if (
      restoreTarget &&
      restoreTarget.isConnected &&
      !(dom.walletPopover?.hidden && dom.walletPopover.contains(restoreTarget))
    ) {
      restoreTarget.focus();
    } else {
      dom.btnWalletMenu?.focus();
    }
  }
}

async function handleWcConnected(info) {
  state.wcStatus = 'connected';
  state.wcWalletName = info?.walletName || 'BCH Wallet';
  const wc = await ensureWcModule();
  const derived = wc.addresses ? wc.addresses() : [];
  const rawTokenAddr = derived.length > 0 ? derived[0].tokenAddress : null;

  if (rawTokenAddr) {
    try {
      const overview = await apiGet(`/api/wallet?address=${encodeURIComponent(rawTokenAddr)}`);
      state.wcAddress = overview.address;
      const existing = state.wallets.find((w) => w.address === overview.address);
      if (existing) {
        existing.label = state.wcWalletName;
        existing.mode = 'wizardconnect';
      } else {
        state.wallets.unshift({
          address: overview.address,
          label: state.wcWalletName,
          mode: 'wizardconnect',
        });
      }
      state.activeAddress = overview.address;
      state.walletOverview = overview;
      saveSessionWallets();
    } catch {
      state.wcAddress = rawTokenAddr;
    }
  }

  setWcStatus(`Connected to ${state.wcWalletName}`, 'connected');
  renderWalletHeader();
  renderForgeWorkspace();
  if (dom.wcModal && !dom.wcModal.hidden) {
    setTimeout(() => closeWcModal(false), 450);
  }
}

function createWcCallbacks() {
  return {
    onState(status, info = {}) {
      if (status === 'disconnected') {
        state.wcStatus = 'idle';
        state.wcWalletName = null;
        state.wcAddress = null;
        if (info?.message && !state.wcModalDismissed) {
          setWcStatus(info.message, 'error');
        }
        renderWalletHeader();
        return;
      }
      if (status === 'connected') {
        state.wcModalDismissed = false;
        handleWcConnected(info);
        return;
      }
      state.wcStatus = status;
      if (info?.walletName) state.wcWalletName = info.walletName;
      renderWalletHeader();
    },
    onUri({ uri, qrUri }) {
      if (state.wcModalDismissed) return;
      state.wcPairingUri = uri;
      if (state.wcModule && dom.wcQrCanvas) {
        try {
          state.wcModule.drawQR(dom.wcQrCanvas, qrUri, 232);
        } catch {
          // Ignore QR render failures on unmounted canvas
        }
      }
      dom.wcQrStage?.classList.add('is-ready');
      if (dom.btnWcOpenApp) {
        dom.btnWcOpenApp.href = uri;
        dom.btnWcOpenApp.setAttribute('aria-disabled', 'false');
      }
      if (dom.btnWcCopyUri) {
        dom.btnWcCopyUri.disabled = false;
      }
      setWcStatus('Waiting for your wallet — scan QR code or copy pairing link.');
    },
  };
}

async function startLiveWalletConnect() {
  closeWalletPopover();
  state.wcModalDismissed = false;
  if (state.wcStatus === 'connected') {
    openWcModal(true);
    setWcStatus(`Connected to ${state.wcWalletName || 'BCH Wallet'}`, 'connected');
    return;
  }
  openWcModal(false);
  try {
    const wc = await ensureWcModule();
    state.wcStatus = 'connecting';
    wc.start(createWcCallbacks(), null);
  } catch (err) {
    state.wcStatus = 'idle';
    setWcStatus(
      err instanceof Error
        ? `Could not start WizardConnect relay: ${err.message}`
        : 'Could not start WizardConnect relay.',
      'error'
    );
  }
}

let disconnectConfirmTimer = 0;

function resetDisconnectConfirmState() {
  clearTimeout(disconnectConfirmTimer);
  disconnectConfirmTimer = 0;
  if (dom.btnDisconnectLiveWallet) {
    delete dom.btnDisconnectLiveWallet.dataset.confirming;
    dom.btnDisconnectLiveWallet.textContent = 'Disconnect live wallet';
  }
}

async function disconnectLiveWallet(requireConfirm = false) {
  if (requireConfirm && dom.btnDisconnectLiveWallet && !dom.btnDisconnectLiveWallet.dataset.confirming) {
    dom.btnDisconnectLiveWallet.dataset.confirming = 'true';
    dom.btnDisconnectLiveWallet.textContent = 'Confirm disconnect?';
    clearTimeout(disconnectConfirmTimer);
    disconnectConfirmTimer = window.setTimeout(resetDisconnectConfirmState, 4000);
    return;
  }
  resetDisconnectConfirmState();
  try {
    if (state.wcModule) {
      await state.wcModule.disconnect();
    }
  } catch {
    // Ignore relay close errors
  }
  state.wcStatus = 'idle';
  state.wcWalletName = null;
  state.wcAddress = null;
  renderWalletHeader();
}

async function restoreStoredWcSessionIfPresent() {
  try {
    const raw = localStorage.getItem('blaze-wizardconnect');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.walletPublicKey) return;
    const wc = await ensureWcModule();
    const stored = wc.storedSession ? wc.storedSession() : null;
    if (stored && stored.walletPublicKey) {
      state.wcWalletName = stored.walletName || null;
      wc.start(createWcCallbacks(), stored);
    }
  } catch {
    // Ignore stale session
  }
}

// ---------------------------------------------------------------------------
// Proofs Tab Execution (with AbortController race protection)
// ---------------------------------------------------------------------------
async function executeDashboardAttack(attackType, triggerBtn) {
  state.lastAttackType = attackType;
  if (state.attackAbort) state.attackAbort.abort();
  const controller = new AbortController();
  state.attackAbort = controller;

  dom.attackButtons.forEach((btn) => {
    const active = btn === triggerBtn;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (dom.btnRetryAttack) dom.btnRetryAttack.hidden = true;
  if (dom.attackMs) dom.attackMs.textContent = 'Running CashVM…';

  try {
    const res = await fetch('/api/attack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackType }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `HTTP ${res.status}`);
    }
    if (controller !== state.attackAbort) return;

    if (dom.attackLabel) dom.attackLabel.textContent = data.label;
    if (dom.attackPill) {
      dom.attackPill.textContent = data.failingLine
        ? `Rejected at line ${data.failingLine}`
        : 'Rejected on-chain';
    }
    if (dom.attackMs) {
      dom.attackMs.textContent = `Verified on BCH_2026_05 in ${data.receipt?.executionTimeMs ?? 0}ms`;
    }
    if (dom.attackPlain) {
      dom.attackPlain.textContent = ATTACK_PLAIN[attackType] || 'Blocked by CashVM.';
    }
    if (dom.attackRule) dom.attackRule.textContent = data.expectedRule;
    if (dom.attackTrace) dom.attackTrace.textContent = data.vmError;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    if (dom.attackPill) dom.attackPill.textContent = 'Error';
    if (dom.attackMs) dom.attackMs.textContent = 'Request failed';
    if (dom.btnRetryAttack) dom.btnRetryAttack.hidden = false;
    if (dom.attackPlain) {
      dom.attackPlain.textContent = 'Could not reach CashVM endpoint — check the server and retry.';
    }
    if (dom.attackRule) dom.attackRule.textContent = '—';
    if (dom.attackTrace) {
      dom.attackTrace.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Wallet Dropdown & Tab Wiring
// ---------------------------------------------------------------------------
function closeWalletPopover() {
  if (!dom.walletPopover || !dom.btnWalletMenu) return;
  dom.walletPopover.hidden = true;
  dom.btnWalletMenu.setAttribute('aria-expanded', 'false');
}

function openWalletPopover() {
  if (!dom.walletPopover || !dom.btnWalletMenu) return;
  dom.walletPopover.hidden = false;
  dom.btnWalletMenu.setAttribute('aria-expanded', 'true');
}

function switchTab(tabKey, updateUrl = true) {
  dom.tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tabKey;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  });

  dom.tabPanels.forEach((panel) => {
    panel.hidden = panel.id !== `panel-${tabKey}`;
  });

  if (updateUrl) {
    syncUrlParams({ tab: tabKey });
  }

  if (tabKey === 'proofs' && dom.attackMs?.textContent === 'Click an attack to execute live') {
    const firstAttackBtn = dom.attackButtons[0];
    if (firstAttackBtn) executeDashboardAttack('under-count-4', firstAttackBtn);
  }

  if (tabKey === 'network') {
    refreshNetworkTelemetry();
  }
}

function wireEvents() {
  // Wallet dropdown
  dom.btnWalletMenu?.addEventListener('click', () => {
    if (dom.walletPopover.hidden) openWalletPopover();
    else closeWalletPopover();
  });

  document.addEventListener('click', (e) => {
    if (dom.walletWrap && !dom.walletWrap.contains(e.target)) {
      closeWalletPopover();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dom.wcModal && !dom.wcModal.hidden) {
        closeWcModal();
        return;
      }
      if (!dom.walletPopover?.hidden) {
        closeWalletPopover();
        dom.btnWalletMenu?.focus();
      }
      return;
    }

    if (e.key === 'Tab' && dom.wcModal && !dom.wcModal.hidden) {
      const focusables = Array.from(
        dom.wcModal.querySelectorAll(
          'button:not(:disabled), a[href]:not([aria-disabled="true"]), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dom.wcModal.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  dom.btnConnectLiveWallet?.addEventListener('click', () => {
    closeWalletPopover();
    startLiveWalletConnect();
  });
  dom.btnDisconnectLiveWallet?.addEventListener('click', () => disconnectLiveWallet(true));
  dom.btnWcClose?.addEventListener('click', () => closeWcModal());
  dom.wcModal?.addEventListener('click', (e) => {
    if (e.target === dom.wcModal) closeWcModal();
  });
  dom.btnWcCopyUri?.addEventListener('click', () =>
    copyText(state.wcPairingUri, dom.btnWcCopyUri)
  );

  dom.btnCopyAddr?.addEventListener('click', () => copyText(state.activeAddress, dom.btnCopyAddr));
  dom.btnCopyTxid?.addEventListener('click', () =>
    copyText(dom.resultTxid?.textContent, dom.btnCopyTxid)
  );
  dom.btnCopyHex?.addEventListener('click', () =>
    copyText(dom.techRawHex?.textContent, dom.btnCopyHex)
  );

  dom.btnNewSandbox?.addEventListener('click', async () => {
    dom.btnNewSandbox.disabled = true;
    if (dom.sandboxWalletError) dom.sandboxWalletError.hidden = true;
    try {
      await createAndSelectSandboxWallet();
      closeWalletPopover();
    } catch (err) {
      if (dom.sandboxWalletError) {
        dom.sandboxWalletError.textContent =
          err instanceof Error ? err.message : 'Unable to create sandbox wallet.';
        dom.sandboxWalletError.hidden = false;
      }
    } finally {
      dom.btnNewSandbox.disabled = false;
    }
  });

  dom.inputCustomAddress?.addEventListener('input', () => {
    dom.inputCustomAddress?.removeAttribute('aria-invalid');
    if (dom.customAddressError) dom.customAddressError.hidden = true;
  });

  dom.formCustomAddress?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = dom.inputCustomAddress?.value.trim() || '';
    if (!raw) {
      dom.customAddressError.textContent = 'Enter a bchtest: or bitcoincash: address.';
      dom.customAddressError.hidden = false;
      dom.inputCustomAddress?.setAttribute('aria-invalid', 'true');
      dom.inputCustomAddress?.focus();
      return;
    }
    const submitBtn = dom.formCustomAddress.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('is-busy');
    }
    try {
      const overview = await apiGet(`/api/wallet?address=${encodeURIComponent(raw)}`);
      dom.customAddressError.hidden = true;
      dom.inputCustomAddress?.removeAttribute('aria-invalid');
      if (!state.wallets.some((w) => w.address === overview.address)) {
        state.wallets.unshift({
          address: overview.address,
          label: 'Custom wallet',
          mode: overview.mode,
        });
      }
      state.activeAddress = overview.address;
      state.walletOverview = overview;
      saveSessionWallets();
      renderWalletHeader();
      renderForgeWorkspace();
      closeWalletPopover();
    } catch (err) {
      dom.customAddressError.textContent =
        err instanceof Error ? err.message : 'Invalid CashAddress.';
      dom.customAddressError.hidden = false;
      dom.inputCustomAddress?.setAttribute('aria-invalid', 'true');
      dom.inputCustomAddress?.focus();
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-busy');
      }
    }
  });

  // Tabs & keyboard arrow navigation
  const tabsArr = Array.from(dom.tabButtons);
  tabsArr.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) switchTab(btn.dataset.tab);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const nextIdx =
        e.key === 'ArrowRight'
          ? (idx + 1) % tabsArr.length
          : (idx - 1 + tabsArr.length) % tabsArr.length;
      const targetBtn = tabsArr[nextIdx];
      targetBtn.focus();
      if (targetBtn.dataset.tab) switchTab(targetBtn.dataset.tab);
    });
  });

  // Tier switcher
  dom.tierButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedTier = Number(btn.dataset.tier);
      dom.tierButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      syncUrlParams({ tier: String(state.selectedTier) });
      renderForgeWorkspace();
    });
  });

  // Primary Actions
  dom.btnClaimAction?.addEventListener('click', () => runClaimStamps());
  dom.btnForgeAction?.addEventListener('click', () => runForge());
  dom.btnHeaderPrimary?.addEventListener('click', () => {
    const action = dom.btnHeaderPrimary.dataset.action;
    if (action === 'claim') runClaimStamps();
    else if (action === 'forge-5') runForge(5);
    else runForge();
  });
  dom.btnReceiptRetry?.addEventListener('click', () => {
    if (state.lastActionKind === 'claim') runClaimStamps();
    else runForge();
  });

  // Proofs tab
  dom.attackButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const atk = btn.dataset.attack;
      if (atk) executeDashboardAttack(atk, btn);
    });
  });
  dom.btnRetryAttack?.addEventListener('click', () => {
    const targetBtn = Array.from(dom.attackButtons).find(
      (b) => b.dataset.attack === state.lastAttackType
    );
    executeDashboardAttack(state.lastAttackType, targetBtn ?? dom.attackButtons[0]);
  });

  // Network & Registry tab
  dom.btnRefreshNetwork?.addEventListener('click', () => refreshNetworkTelemetry());
  window.addEventListener('resize', renderWalletHeader);
  dom.filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      state.registryFilter = pill.dataset.filter || 'all';
      dom.filterPills.forEach((p) => {
        const active = p === pill;
        p.classList.toggle('is-active', active);
        p.setAttribute('aria-pressed', String(active));
      });
      syncUrlParams({ filter: state.registryFilter });
      renderNetworkAndRegistry();
    });
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
  const params = new URLSearchParams(window.location.search);
  const urlTier = params.get('tier');
  if (urlTier === '5' || urlTier === '9' || urlTier === '10') {
    state.selectedTier = Number(urlTier);
    dom.tierButtons.forEach((b) => {
      const active = b.dataset.tier === urlTier;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }
  const urlFilter = params.get('filter');
  if (urlFilter === 'all' || urlFilter === 'official' || urlFilter === 'demo') {
    state.registryFilter = urlFilter;
    dom.filterPills.forEach((p) => {
      const active = p.dataset.filter === urlFilter;
      p.classList.toggle('is-active', active);
      p.setAttribute('aria-pressed', String(active));
    });
  }

  wireEvents();
  await refreshNetworkTelemetry();
  restoreStoredWcSessionIfPresent();

  const urlTab = params.get('tab');
  if (urlTab === 'forge' || urlTab === 'proofs' || urlTab === 'network') {
    switchTab(urlTab, false);
  }

  const saved = loadSessionWallets();
  if (saved) {
    state.wallets = saved.wallets;
    state.activeAddress = saved.activeAddress;
    await refreshWalletOverview();
    if (state.walletOverview && state.health?.networkMode === 'mock') {
      // Check if server restarted in-memory mock state cleanly; if Sandbox lost signers, provision fresh one
      const currentSaved = state.wallets.find((w) => w.address === state.activeAddress);
      if (currentSaved?.mode === 'sandbox' && state.walletOverview.mode === 'external') {
        try {
          state.wallets = [];
          await createAndSelectSandboxWallet();
        } catch {
          // Non-fatal fallback
        }
      }
      return;
    }
  }

  if (state.health?.networkMode === 'mock') {
    try {
      await createAndSelectSandboxWallet();
    } catch {
      renderWalletHeader();
      renderForgeWorkspace();
    }
  } else {
    renderWalletHeader();
    renderForgeWorkspace();
  }
}

init();
