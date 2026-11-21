# cindr

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/CashVM%20Tests-44%2F44%20passing-brightgreen.svg)](tests/api.test.ts)
[![Zero-Conf Chaining](https://img.shields.io/badge/BCH%200--Conf-Active-orange.svg)](src/buildForgeTx.ts)

`cindr` burns 5, 9, or 10 distinct Bitcoin Cash CashTokens in a single transaction and mints a permanent Trophy NFT on-chain.

Most badge apps either check tokens inside browser JavaScript (which anyone can bypass) or lock minting behind one UTXO that waits 10 minutes between blocks. `cindr` enforces the badge count, ascending slot uniqueness, and token burn directly inside a May 2026 CashVM loop (`OP_BEGIN` and `OP_UNTIL`), then passes the Minting Baton forward at output `0` (`includeUnconfirmed: true`) so back-to-back mints settle in under two seconds.

The repository includes the compiled CashScript covenants, a zero-confirmation Demo Stamp dispenser for empty wallets, a drop-in `buildForgeTx(utxos, tier)` builder matching the `tokenhunt.js` stub, an HTTP API (`src/server.ts`), an interactive landing page (`/`), and the `/dashboard` workspace.

## Architecture

```
  [1. Claim 5 Demo Stamps]          [2. Invalid 4-Stamp Mint]           [3. Burn & Mint (cindr)]
             |                                  |                                   |
             v                                  v                                   v
   POST /api/stamps/claim               POST /api/attack                    POST /api/cindr
             |                                  |                                   |
             v                                  v                                   v
    StampDispenser.cash                Compiled cindr Loop                 Compiled cindr Loop
   Mints 5 demo stamp NFTs           Rejects count < 5 / dupes            Burns 5/9/10 badges
   Preserves baton at vout 0         Returns real CashVM line             Mints trophy + vout 0 baton
```

## Endpoints

Running `npm start` compiles TypeScript into `dist/` and serves both pages plus the REST API on `PORT` (default `3000`, configured via `.env` from `.env.example`):

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/` | Interactive overview with Three.js fiber scene and live `/api/attack` runner |
| `GET` | `/dashboard` | cindr workspace for Sandbox and WizardConnect wallets, receipts, proofs, and registry |
| `GET` | `/api/health` | Compiled contract bytecode sizes, opcode counts, and CashVM target status |
| `GET` | `/api/registry` | All 15 registered stamp slots and 3 trophy tier rules |
| `GET` | `/api/baton` | Live 0-conf mempool tracker outpoints for both contracts |
| `POST` | `/api/wallet/demo` | Creates an ephemeral local Sandbox wallet when `BCH_NETWORK=mock` |
| `GET` | `/api/wallet?address=...` | Lists held stamps, minted cindr trophies, and eligible tiers |
| `POST` | `/api/stamps/claim` | Dispenses 5 Demo Stamps in one 0-conf transaction |
| `POST` | `/api/cindr` | Burns stamps and mints a trophy NFT, or returns an unsigned `wcTransaction` payload (alias `/api/forge`) |
| `POST` | `/api/attack` | Runs an adversarial transaction against CashVM to show the rejected covenant line |

All `POST` routes support route-scoped `Idempotency-Key` replay and payload-mismatch checks. When deployed on serverless hosts with `BCH_NETWORK=mock`, ephemeral sandbox wallets and 0-conf baton state stay in memory per server instance.

## Commands

See [JUDGES.md](JUDGES.md) for the 30-second verification steps and protocol notes, and [docs/kings-advicer-audit.md](docs/kings-advicer-audit.md) for the project audit.

```bash
npm install
npx tsc --noEmit       # TypeScript type check
npm run build          # Syncs Three.js vendor files and compiles TypeScript to dist/
npm run lint:js        # Syntax checks client and tooling scripts
npm run verify         # 44 deterministic CashVM and HTTP API tests (exit 0)
npm run smoke          # Offline 0-conf claim -> cindr mint -> attack sanity check
npm run check:words    # Plain-English word count and buzzword check
npm run sync:tokenhunt # Compares local slots against bchblaze.cash
npm run deploy:chipnet # Live BCH Chipnet pre-flight and genesis baton deploy
npm run evidence       # Writes machine-verified evidence/report.json
npm start              # Compiles and runs dist/src/server.js on port 3000
```
