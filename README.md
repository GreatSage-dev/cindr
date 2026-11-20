# cindr

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/CashVM%20Tests-38%2F38%20passing-brightgreen.svg)](tests/api.test.ts)
[![Zero-Conf Chaining](https://img.shields.io/badge/BCH%200--Conf-Active-orange.svg)](src/buildForgeTx.ts)

**Burn 5, 9, or 10 distinct Bitcoin Cash CashTokens in one transaction to mint a verifiable Trophy NFT on-chain.**

461 hackers registered for BCH BLAZE 2026 can collect TokenHunt badges, yet the organizers' own Forge button in `tokenhunt.js` still reads `"The trophy contract isn't connected yet."`

**cindr** ships the missing CashVM loop covenant (`contracts/BlazeForge.cash`), a 0-conf Demo Stamp dispenser (`contracts/StampDispenser.cash`), a drop-in `buildForgeTx(utxos, tier)` engine, a Node HTTP API (`src/server.ts`), an interactive landing page (`/`), and a Forge workspace (`/dashboard`).

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

## Web Surfaces & HTTP API

Running `npm start` compiles TypeScript and serves both web views and the REST API on `PORT` (default `3000`, configured via `.env` — see `.env.example`):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Studio overview with Three.js fiber-to-iris scene and live `/api/attack` verifier |
| `GET` | `/dashboard` | Interactive Forge workspace (Sandbox & custom wallets, slot viewer, receipts, Proofs, Registry) |
| `GET` | `/api/health` | Compiled covenant sizes (`redeemScriptBytes` & template bytes), opcodes, and CashVM status |
| `GET` | `/api/registry` | 15 TokenHunt badge slots and 3 trophy tier rules |
| `GET` | `/api/baton` | 0-Conf mempool tracker state for both covenants |
| `POST` | `/api/wallet/demo` | Creates an ephemeral local Sandbox wallet when `BCH_NETWORK=mock` |
| `GET` | `/api/wallet?address=...` | Inspects held Stamp slots, forged Trophy NFTs, and eligible tiers |
| `POST` | `/api/stamps/claim` | Dispenses 5 Demo Stamps in 1 transaction (0-conf) |
| `POST` | `/api/forge` | Burns stamps and mints trophy NFT (or unsigned `wcTransaction` payload) |
| `POST` | `/api/attack` | Runs live adversarial attack proving CashVM rejection |

All mutation endpoints support route-scoped `Idempotency-Key` replay and payload-mismatch checks.

---

## Verification Commands

See **[JUDGES.md](JUDGES.md)** for the 30-second verification walkthrough, drop-in `tokenhunt.js` integration, and protocol findings, and **[docs/kings-advicer-audit.md](docs/kings-advicer-audit.md)** for the contrastive hackathon audit.

```bash
npm install
npx tsc --noEmit       # Strict TypeScript type check
npm run build          # Compiles TypeScript into dist/
npm run verify         # 38/38 deterministic CashVM + HTTP API tests (exit 0)
npm run smoke          # Fast offline 0-conf claim -> forge -> attack sanity check
npm run check:words    # Plain-English linter enforcing zero buzzwords
npm run sync:tokenhunt # Live TokenHunt category audit against bchblaze.cash
npm run deploy:chipnet # Live BCH Chipnet pre-flight / genesis baton deployment
npm run evidence       # Generates machine-verified evidence/report.json
npm start              # Compiles and runs dist/src/server.js on port 3000
```
