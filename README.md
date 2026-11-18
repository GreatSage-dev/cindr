# BLAZE Forge / StampForge

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/CashVM%20Tests-26%2F26%20passing-brightgreen.svg)](tests/api.test.ts)
[![Zero-Conf Chaining](https://img.shields.io/badge/BCH%200--Conf-Active-orange.svg)](src/buildForgeTx.ts)

**Burn 5, 9, or 10 distinct Bitcoin Cash CashTokens in one transaction to mint a verifiable Trophy NFT on-chain.**

461 hackers registered for BCH BLAZE 2026 can collect TokenHunt badges, yet the organizers' own Forge button in `tokenhunt.js` still reads `"The trophy contract isn't connected yet."`

**BLAZE Forge** ships the missing CashVM loop covenant (`contracts/BlazeForge.cash`), a 0-conf Demo Stamp dispenser (`contracts/StampDispenser.cash`), a drop-in `buildForgeTx(utxos, tier)` engine, and an HTTP REST backend service (`src/server.ts`) for wallets and web clients.

---

## Why It Matters

1. **Solves Real Unfinished Code:** Matches the exact `buildForgeTx(utxos, tier)` stub and `#rollcall-catalog` schema inside `bchblaze.cash`.
2. **Powered by BCH 0-Conf Covenant Chaining:** Spend unconfirmed Minting Baton outputs (`includeUnconfirmed: true`) back-to-back in under 2 seconds instead of waiting 10 minutes per block.
3. **May 2026 Loop Opcodes (`OP_BEGIN` / `OP_UNTIL`):** Checks strictly ascending token slots and enforces consensus burns inside CashVM so nobody can forge with 4 stamps, duplicate stamps, or kept change.

---

## Architecture & Flow

```
  [Button 1: Claim 5 Demo Stamps]     [Button 2: Fake Forge (4 Stamps)]     [Button 3: Burn & Forge Trophy]
                |                                   |                                      |
                v                                   v                                      v
       POST /api/stamps/claim               POST /api/attack                       POST /api/forge
                |                                   |                                      |
                v                                   v                                      v
       StampDispenser.cash                 BlazeForge.cash (CashVM)               BlazeForge.cash (CashVM)
    Mints 5 distinct Demo NFTs          Rejects count < 5 / duplicates         Burns 5/9/10 Stamps on-chain
    Preserves 0-Conf Baton [0]          Exposes real VM failure line           Mints Trophy NFT + 0-Conf Baton
```

---

## HTTP REST Endpoints

The backend runs on port 3000 (`npm start`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Covenant opcodes, bytecode sizes, and CashVM status |
| `GET` | `/api/registry` | 15 TokenHunt badge slots and 3 trophy tier rules |
| `GET` | `/api/baton` | 0-Conf mempool tracker state for both covenants |
| `POST` | `/api/stamps/claim` | Button #1: Dispenses 5 demo stamps in 1 transaction (0-conf) |
| `POST` | `/api/forge` | Button #3: Burns stamps and mints trophy NFT (0-conf) |
| `POST` | `/api/attack` | Button #2: Runs adversarial attack proving CashVM rejection |

All mutation endpoints support the `Idempotency-Key` header with automatic duplicate replay and payload conflict guards.

---

## Verification Commands

```bash
npm install
npm run verify       # 26/26 deterministic CashVM + API tests (exit 0)
npm run smoke        # Fast offline 0-conf claim -> forge -> attack sanity check
npm run check:words  # Plain-English linter enforcing zero buzzwords
npm run evidence     # Generates machine-verified evidence/report.json
npm start            # Starts the HTTP API backend on port 3000
```
