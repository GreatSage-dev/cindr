# King's Advicer — Contrastive Idea & Framing Audit for cindr

**Evaluated Target:** **cindr** (`BlazeForge.cash` + `StampDispenser.cash` + `buildForgeTx.ts` + `/dashboard`)  
**Hackathon Arena:** **BCH BLAZE 2026** (`https://bchblaze.cash/`)  
**Knowledge Graph Baseline:** `1,005` External Global Winners (`C1`–`C11`) + `159` Peer Builds (`5` Champions vs. `84` Smart-Losers)

---

## 1. Phase 0: Track Selection & Bounty Board Arbitrage (`site_pages/bounties.html`)

We ran `query-brain.mjs --tracks` against the official BCH BLAZE 2026 main track and all 6 sponsor bounties listed on `https://bchblaze.cash/bounties/`:

| Track / Bounty | Prize Pool | Crowding Signal | King's Advicer Verdict |
| :--- | :--- | :---: | :--- |
| **BCH BLAZE 2026 Main Track** *(CashTokens & May 2026 Layla Upgrade)* | **Grand Prize Pool + `blaze-builder` NFT** | `HIGH_EV_SNIPER` | **PRIMARY TARGET (LOCKED).** `bchblaze.cash/tokenhunt/` literally has `forge.live: false` and a `// TODO: wire up once the trophy minting contract exists. Outline: const { transaction, sourceOutputs, inputPaths } = buildForgeTx(utxos, tier)` comment in `js/tokenhunt.js`. Building the exact May 2026 Layla `OP_BEGIN`/`OP_UNTIL` loop covenant and `buildForgeTx` engine that the hackathon organizers' own site is missing is a textbook **`B3` Ecosystem Missing-Piece Unblocker + `B2` Day-Zero Primitive Proof**. |
| **Build with XO / Migrate to XO** *(General Protocols)* | `0.3 BCH × 10` / `1 BCH × 5` | `HIGH_CROWD_BAIT` | **DO NOT DILUTE.** Flagged `HIGH_CROWD_BAIT` by `query-brain.mjs`, requires migrating to `@xo-cash/engine` invitation templates, and mandates a 500-word non-AI personal essay (explicitly rejecting AI-assisted text). |
| **Best SolidCash Application** *(mainnet_pat)* | `3.5 BCH` | `HIGH_EV_SNIPER` | **DIFFERENT COMPILER STACK.** Requires EVM Solidity compiled via `solidcash`/`solidhat` rather than native CashScript `0.14.0` `.cash` covenants. |
| **FoldingCash Pull Reward Claims** *(FoldingCash)* | `26M FLDCH` | `HIGH_EV_SNIPER` | **SEPARATE SINGLE-PURPOSE SPEC.** Dedicated Merkle-tree pull-claim contract for Folding@home daily stats. |
| **Stablecoin Bridge** *(BCH BLAZE / ParyonUSD)* | `$750 PUSD` | `HIGH_EV_SNIPER` | **BORROW THE WALLET RAIL ONLY.** While cross-chain stablecoin bridging is a separate product, the bounty spec explicitly notes: *"On the BCH side, WizardConnect is highly recommended."* We integrated real **WizardConnect (`@wizardconnect/dapp`)** into `/dashboard` AND mapped the `PUSD` (`2469acc5...`) Cauldron swap category into our TokenHunt registry (`paryon-procurer`). |
| **Paytaca Decentralized Identity** *(Paytaca)* | `$500 PUSD` | `HIGH_EV_SNIPER` | **KEEP ORTHOGONAL.** Avoiding Frankenstein bounty-farming (`>4` unrelated specs bolted together); instead we ship a dedicated **Paytaca Merchant Loyalty Punch-Card** registry preset (`createMerchantLoyaltyRegistry`) demonstrating how any Paytaca merchant can reuse `BlazeForge.cash` after TokenHunt ends. |

### The 3-Layer Atomic Stack Locked for cindr:
- **Layer 1 (Ingress & Non-Custodial Signing):** **WizardConnect (`@wizardconnect/dapp`)** live QR pairing relay (`wss://relay.riften.net:443`) + 1-Click Sandbox mode (`POST /api/wallet/demo`).
- **Layer 2 (Core Day-Zero Compute):** **May 2026 Layla `OP_BEGIN` / `OP_UNTIL` Loop Covenant** (`BlazeForge.cash` — `815` B P2SH32, `283` B raw template) + `StampDispenser.cash` (`125` B P2SH32).
- **Layer 3 (0-Conf Settlement & Burn Rail):** **0-Conf Mempool Baton Chaining (`BatonMempoolTracker`)** + consensus-enforced `OP_RETURN`/token-free output burn (`tx.outputs[2].tokenCategory == 0x`).

---

## 2. Dual Contrastive Scores (Never Averaged)

### Score 1: Idea & Condition Fit (`C2` Day-Zero Primitive Launch + `C7` Adversarial Arena) — **`9.1 / 10`**
- **Why it wins the room (`J1` Core Protocol Engineers & `B2`/`B3` Organizers):**
  1. **Undeniable Present-Day Bleed:** Rather than inventing a hypothetical 2028 problem, BLAZE Forge solves an active missing piece on the hackathon's own live site (`https://bchblaze.cash/tokenhunt/` where `forge.live` is `false` and `forgeTrophy()` is an unimplemented `TODO`).
  2. **Strictly Load-Bearing May 2026 Layla Primitive:** Without `OP_BEGIN` / `OP_UNTIL` loops, verifying variable-tier (`5`, `9`, or `10`) strictly ascending badge categories against a 15-slot registry requires either massive unrolled script duplication or a custodial server.
  3. **Reusable Beyond the Hackathon (`Door A` Horizontal Wedge):** By parameterizing the 33-byte-per-slot `registry` constructor argument, the exact same 815-byte covenant powers **Paytaca Merchant Punch Cards** (*"Burn 5 Coffee Stamps $\to$ Mint 1 Free Coffee NFT in 0 blocks"*).

### Score 2: Framing & Judge Conversion (`F4` Dilemma + `F7` Refusal + `F5` 10s Dare) — **`9.4 / 10`** *(Upgraded from `8.5 / 10`)*
- **What made it strong:**
  - Passes `scripts/frame-lint.mjs` (`128 words`, `0` banned buzzwords) and `scripts/plain-words-check.mjs` (`183/300` pre-technical words).
  - Enforces the **50/50 Throttle Law**: Tab 1 (`/dashboard` **Forge**) runs the full-throttle 0-conf green path (`Claim 5 demo stamps` $\to$ `Forge BLAZE Medallion` $\to$ switch wallet $\to$ 0-conf baton handoff), while Tab 2 (**Proofs & attacks**) runs the 5 live CashVM consensus refusals (`lines 19, 26, 45, 58, 81`).
- **What we upgraded to reach `9.4 / 10`:**
  1. Added root **[JUDGES.md](file:///c:/Users/HP%20LAPTOP/Documents/blaze/JUDGES.md)** (`habit_judges_md_30s`) with a 30-second verification checklist, the exact `bchblaze.cash/js/tokenhunt.js` drop-in snippet, a Protocol/CashVM Findings log (`habit_upstream_bug_report`), and a Radical Honesty table (`habit_radical_honesty`).
  2. Added live **WizardConnect (`@wizardconnect/dapp`)** QR pairing in `/dashboard` right alongside 1-click Sandbox mode so judges can test both zero-setup sandbox forging AND real BCH wallet pairing.
  3. Added live **`npm run sync:tokenhunt`** (`scripts/sync-tokenhunt.ts`) and **`npm run deploy:chipnet`** (`scripts/deploy-chipnet.ts`) with deterministic JSON receipts in `evidence/`.

---

## 3. Smart-Loser Trap Audit (`trap_*` Diagnostic)

| Smart-Loser Trap ID | Empirical Penalty | Status in BLAZE Forge | Proof / Mitigation |
| :--- | :---: | :---: | :--- |
| **`trap_layer2_crowd_collision`** *(Building the Hour-1 generic wrapper 30 teams build)* | `-80%` win rate | **CLEARED** | Avoided generic chat/dashboard wrappers and crowded XO template wrappers; built a surgical 283-byte template loop covenant that drops directly into `bchblaze.cash/js/tokenhunt.js`. |
| **`trap_sponsor_cosmetic`** *(Decorative SDK usage that can be removed without breaking)* | `0%` sponsor conversion | **CLEARED** | Removing May 2026 `OP_BEGIN`/`OP_UNTIL` or CashTokens minting batons immediately breaks `BlazeForge.cash` compilation and on-chain verification. |
| **`trap_pure_brake_fatigue`** *(Showing only red `BLOCKED` screens with no 10x green velocity)* | `0-for-12` in peer corpus | **CLEARED (50/50 Throttle)** | `/dashboard` opens directly on the **Forge** accelerator tab (1-click 0-conf claim + 0-conf medallion mint + multi-wallet baton chaining), paired 50/50 with the **Proofs & attacks** tab (5 live CashVM refusals). |
| **`trap_silent_catch_mock`** *(Silent `catch {}` or fake hardcoded txids)* | Instant `J1` disqualification | **CLEARED** | Zero mock txids on live nets; `scripts/deploy-chipnet.ts` queries real Chipnet Electrum (`height 338,921+`) and writes honest pre-flight / broadcast receipts to `evidence/chipnet-deployment.json`. |
| **`trap_WALL_OF_TEXT_README`** *(Burying the 30-second trigger under prose)* | Lost judge attention at 45s | **CLEARED** | Root `JUDGES.md` puts the 4-Line Birth Frame, 5-command verification block, and 3-click `/dashboard` walkthrough at the very top. |
