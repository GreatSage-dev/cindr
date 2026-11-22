# cindr: CashTokens Burn-to-Mint Layla-Loop Covenant & 0-Conf Trophy Protocol

> **Live Web Application:** [https://usecindr.vercel.app](https://usecindr.vercel.app)  
> **Source Code:** [https://github.com/GreatSage-dev/cindr](https://github.com/GreatSage-dev/cindr)  
> **Network:** Bitcoin Cash Chipnet (May 2026 Layla Upgrade Activated, Block 342,177+)  
> **Test Verification:** 44/44 Deterministic & CashVM Invariant Tests Passing (`npm run verify`)

---

## 1. The Problem: What are you solving?

In decentralized applications and gamified on-chain experiences (such as Bitcoin Cash hunt games and token collector platforms like `tokenhunt.js`), players collect distributed tokens (stamps, badges, quest items) across various locations. However, turning these intermediate utility tokens into a high-tier verifiable trophy has historically run into three major friction points:

1. **The Missing Forge Primitive:** Platforms like `tokenhunt.js` shipped with an empty `buildForgeTx` stub (`// TODO: Implement CashTokens burning ceremony`). Without an on-chain covenant enforcing atomic burns, players had no cryptographic guarantee that their collected stamps were actually destroyed when minting a trophy.
2. **Unbounded Script Unrolling:** Pre-Layla CashScript required unrolling loops for burning multiple inputs. Verifying 5 to 10 distinct token inputs bloated script sizes by several kilobytes, risking standard transaction size and opcode limits.
3. **Mempool Concurrency Bottlenecks (0-Conf Lockouts):** Minting batons in standard stateful covenants require sequential block confirmations before another player can forge, causing multi-minute queues and transaction collisions during live events.

---

## 2. How It Works: A Concise Explanation of Our Approach

**cindr** solves this by implementing an atomic, 0-conf burn-to-mint protocol powered by the **May 2026 Layla `OP_BEGIN` / `OP_UNTIL` bounded loop upgrade**:

```
[Input 0: Forge Minting Baton NFT]  ──┐
[Input 1: Demo Stamp #1]              │
[Input 2: Demo Stamp #2]              ├──►  [CashVM Layla Bounded Loop]
[Input 3: Demo Stamp #3]              │     (283 bytes / OP_BEGIN...OP_UNTIL)
[Input 4: Demo Stamp #4]              │             │
[Input 5: Demo Stamp #5]              ┘             ▼
                                     ┌──────────────────────────────────────────────┐
                                     │ • Output 0: Transmuted Baton to Next In Line │
                                     │ • Output 1: Minted Medallion NFT to User     │
                                     │ • Output 2..N: Burned Stamps (No Re-emission)│
                                     └──────────────────────────────────────────────┘
```

1. **Layla-Loop Covenant Validation:** Instead of hundreds of lines of unrolled byte-checks, a compact 283-byte loop executes over all transaction inputs. It validates that every input contains a valid registered stamp category, enforces strictly ascending slot ordering (`slot > prevSlot`) to prevent duplicate stamp exploits, and verifies category registration without bytecode bloat.
2. **Atomic Burn-to-Mint:** The covenant cryptographically guarantees that the collected stamps are spent without creating corresponding token outputs, permanently removing them from circulation while minting a single non-fungible trophy with a deterministic commitment (e.g. `0x050a0b0c0d0e`).
3. **0-Conf Baton Chaining:** Instead of locking the minting baton behind block confirmations, `cindr` tracks the spent baton outpoint in the mempool. Consecutive users can immediately chain transactions against the parent's unconfirmed Output 0, enabling sub-second, frictionless multi-user forging.

---

## 3. Key Features: What Can Users Do With It?

- **1-Click 0-Conf Stamp Dispenser:** Collect up to 5 distinct demo stamp CashTokens in a single sub-second transaction from our on-chain dispenser contract.
- **Atomic Forging Ritual:** Burn collected stamps to forge a verified BLAZE Medallion (Tier 5) or BLAZE Trophy (Tier 9/10) NFT directly to your CashTokens address.
- **Zero-Block Waiting:** Chain multiple claims and mints back-to-back with instant 0-conf mempool updates.
- **Interactive 3D Baton Tracker:** A WebGL character visualization that visually reflects the real-time state, commitment, and movement of the on-chain minting baton.
- **Adversarial Security Simulator:** Live interactive attack harness in the dashboard that demonstrates CashVM's deterministic rejection of malicious transactions (duplicate stamps, missing stamps, fake categories, and baton theft).

---

## 4. Live On-Chain Chipnet Receipts

> **Why Chipnet?** The May 2026 Layla loop opcodes (`OP_BEGIN`, `OP_UNTIL`) are actively running and standard on **Bitcoin Cash Chipnet** ahead of the May 2026 Mainnet hard fork. Chipnet is the official, load-bearing environment for this contract.

All contracts are live and verified on Chipnet (Block 342,177):

| Asset / Contract | Identifier / CashAddress | On-Chain Receipt |
| :--- | :--- | :--- |
| **Forge Covenant Contract** | `bchtest:pdl7dd0fhhupw4dd3yhvve5m25yr48gmykp40yjmd63av4r2nswuq94fn2a5c` | Redeem Script: 815 bytes / 203 opcodes |
| **Stamp Dispenser Contract** | `bchtest:p06wr5p6h676qnw38x35z3qr2a28xr0g42l5ptxq7dp5m5d9gtxc2ygradd3t` | Redeem Script: 125 bytes / 60 opcodes |
| **Forge Genesis Baton Txid** | `f391b9418a379eb4ca66f187cf96470e5953abfc24b4e06a6792664704291815` | Category: `188e4725cf...` |
| **Dispenser Genesis Baton Txid** | `e039184fd3fdff49c6220a967f61eba4d789f3ee59a9e008797d9acbd6bfba9a` | Category: `2277df318b...` |
| **0-Conf Claim 5 Stamps Txid** | `bcaadb3546bd8e0a36d0dabe18fbf82a3d432cb1e3d1e441de8625cc00f0a039` | 5 CashTokens claimed 0-conf |
| **0-Conf Mint Medallion Txid** | `6e0897ecc279bb338b693a5a02e7234a5e85b6afbab2f830990b4ba970a4fc33` | Commitment: `0x050a0b0c0d0e` |

---

## 5. Security & Invariant Verification

`cindr` is backed by **44 deterministic CashVM unit, integration, and adversarial tests** (`npm run verify` passes with 0 failures):

1. **Under-Count Refusal:** Transactions presenting only 4 stamps for a Tier 5 forge are rejected by CashVM opcode validation.
2. **Duplicate-Slot Refusal:** Replaying the same stamp twice fails the monotonic `slot > prevSlot` loop check.
3. **Counterfeit Category Refusal:** Unregistered token categories are deterministically refused by the covenant.
4. **Anti-Burn Exfiltration Refusal:** Attempts to re-emit spent tokens in Output 2 or later outputs are blocked by strict output evaluation.
5. **Baton Theft Refusal:** Attempting to redirect the minting baton away from Output 0 invalidates the covenant covenant script.

---

## 6. Tech Stack

- **Smart Contracts:** CashScript v0.14.0, Bitcoin Cash CashVM (May 2026 Layla Chipnet activation)
- **Cryptography & Serialization:** `@bitauth/libauth` v3.0.0
- **Wallet Connection:** `@wizardconnect/dapp` v0.2.8 (with raw Uint8Array hex normalization)
- **Backend & API:** TypeScript, Node.js (with Vercel Serverless Function compatibility)
- **Frontend & 3D Visualization:** Vanilla ES Modules, Three.js v0.187.0 WebGL baton engine, Tailwind-inspired boutique design system
- **Testing & Tooling:** Vitest v5.1.1, Playwright (for automated browser testing and verification)
