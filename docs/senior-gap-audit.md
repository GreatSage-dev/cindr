# Senior gap audit: cindr (Re-audit v2)

2026-11-20 · Stage assumed: Hackathon MVP / Vercel-deployed demo (`BCH_NETWORK=mock` default; Chipnet deployer awaiting faucet funding per `evidence/chipnet-deployment.json`; no mainnet user funds yet) · Read fully: `contracts/BlazeForge.cash`, `contracts/StampDispenser.cash`, `src/config.ts`, `src/server.ts`, `src/registry.ts`, `src/buildForgeTx.ts`, `src/api/types.ts`, `src/api/idempotency.ts`, `src/api/routes.ts`, `src/api/service.ts`, `api/index.ts`, `api/[...slug].ts`, `vercel.json`, `.github/workflows/ci.yml`, `.env.example`, `.gitignore`, `README.md`, `package.json`, `docs/DESIGN_DIRECTION.md`, `docs/senior-gap-audit.md` (v1), `evidence/chipnet-deployment.json`, `public/favicon.svg`, `public/index.html`, `public/styles.css`, `public/app.js`, `public/dashboard.html`, `public/dashboard.css`, `public/dashboard.js` · Checks run: `npx tsc --noEmit`, `npm run build`, `npm run verify` (`38/38` tests passed across `tests/api.test.ts` and `tests/forge.test.ts`), `npm run smoke` (`SMOKE PASS`), `npm run check:words` (`179/300` pre-technical words, `0` banned buzzwords), `npm audit --omit=dev` (`0` vulnerabilities), `npm audit` (`2` critical + `1` moderate devDependency advisories), `git log --oneline`, `git ls-files`, static hygiene & CSS token/contrast scans, and live browser checks across `/` and `/dashboard` at desktop (`1440×900`) and phone (`390×844`).

> This is a gap-finding self-check, not an assurance audit. Closing these gaps brings the app close to what a senior engineer and designer would build; it doesn't certify that it is secure, production-ready or well designed.

---

## Verdict

**Senior Engineer:** Core protocol, test, and server-hygiene quality jumped sharply since v1 (`2026-11-19`): both `.cash` covenants now lock `this.activeInputIndex == 0` and empty baton commitments (`0x`), every TypeScript catch/cast uses `unknown` with zero `any` or `@ts-ignore`, runtime config validates at startup, CI runs automatically, and `38/38` real `BCH_2026_05` CashVM and HTTP API tests pass with zero production dependency vulnerabilities. However, adding Vercel deployment (`vercel.json`, `api/*.ts`) introduced a **Critical** live break: `vercel.json` serves static assets strictly from `public/`, which lacks `three.module.js` and `three.core.js` — causing `/vendor/three.module.js` to `404` in production and crash all `/` JavaScript (even `/api/attack`), while ephemeral serverless instances cannot share in-memory `testSigners` or 0-conf baton tracking across requests. Under `senior-gap-audit` scoring rules, that open Critical production defect caps the overall Engineering score at **5/10** right now (**7/10** on local single-process Node).

**Senior Product Designer:** The Concept 2 (`Loop Latch`) brand mark and Algolia-inspired redesign turned a broken static teaser into a coherent, calm two-surface product (**7/10**, up from **5/10** in v1): strictly 1 filled `#003DFF` primary button per view, 90–95% neutral chrome, open-ground underline tabs, a flat `1px`-ruled KPI ledger strip, working 0-conf claim-and-forge flows with live receipts on `/dashboard`, accessible `#wc-modal` keyboard trapping, URL query param sync, and zero horizontal overflow on desktop (`1440×900`) or phone (`390×844`). Remaining gaps sit in design-system consistency and polish: duplicate `:root` token names across `styles.css` and `dashboard.css`, `14` distinct font sizes per file alongside `10` corner radii in `dashboard.css`, `11` dead `:root` tokens, a `3.09:1` WCAG AA contrast miss on footer colophon metadata, unstyled `404` HTML with an old `BLAZE Forge` title, and no initial loading skeletons before `/api/wallet/demo` resolves.

**Engineering: 5/10** *(capped by open Critical Vercel asset break; 7/10 on local single-process Node)* · **Design: 7/10**

| Engineering area | Score | One-line reason |
|---|---|---|
| Security and access control | 7 | Server-side private-key gating, `activeInputIndex`/empty-baton locks, `256KB` `413` caps, CSP/security headers added; Vercel CDN static routes omit headers and mock rate limiter trusts raw `socket.remoteAddress`. |
| Data model and integrity | 6 | All 3 v1 data bugs closed cleanly, yet `finalizeBuiltBatonTx()` still writes unconfirmed batons to `BatonMempoolTracker` before `builder.send()` confirms broadcast, and `testSigners` / `sandboxWalletCount` live in unbounded RAM. |
| Architecture and boundaries | 6 | Strong pure covenant core, env module (`src/config.ts`), and single HTTP handler; held back by duplicated `api/*.ts` entrypoints, `7` undocumented route aliases, and monolith files (`860`–`1,618` lines). |
| Error handling and resilience | 6 | Typed `ForgeValidationError`/`PayloadTooLargeError`/`PrivateKeyRejectedError` and safe `500` responses in place; `GET /api/wallet` maps network timeouts to `422 INVALID_ADDRESS`, `api/*.ts` lacks top-level `try/catch`, and `dashboard.js` has `9` bare `catch {}` blocks. |
| Testing and verification | 8 | `38/38` real `BCH_2026_05` CashVM + API integration checks, `tsc --noEmit`, `smoke`, and `check:words` pass in CI; zero automated DOM/Playwright tests verify UI scripts or Vercel bundle completeness (`three.module.js`). |
| Code hygiene and consistency | 6 | Zero `any`, `@ts-ignore`, or committed secrets and clean `.gitignore`; weakened by `public/dashboard.js` (`1,618` lines) + `src/buildForgeTx.ts` (`860` lines), zero ESLint/Prettier config, and stale `BLAZE Forge` branding in 404 HTML. |
| Performance | 7 | Explicit `Map` caps (`1,000` idempotency, `5,000` rate limit), rAF-batched scroll reads, `#btn-toggle-motion`, and off-screen GPU sleep; `POST /api/attack` still initializes a fresh mock provider per call without caching. |
| Operations and delivery | 5 | GitHub Actions CI + JSON logs exist now, but Vercel deployment misses `/vendor/three.module.js` (`404` on `/`), relies on volatile per-Lambda RAM for 0-conf batons/wallets, and sets no security headers on static HTML. |
| Dependencies and configuration | 7 | Strict startup env validator (`.env.example` matches `src/config.ts`), compiled `dist/src/server.js`, and `0` prod vulnerabilities; `npm audit` reports `2` critical + `1` moderate dev advisories in `vitest@3.x` / `tinypool`. |
| Docs and developer experience | 8 | Clear `README.md`, `JUDGES.md`, accurate `/api/health` byte metrics, `.env.example`, and CI commands; `package-lock.json` is tracked (`npm ci`) and setup works out of the box locally. |
| Product and scope judgement | 8 | Single cohesive Burn-to-Mint + Adversarial Refusal workflow finished end-to-end across `/` and `/dashboard` without placeholder sections (`4` organizer badge slots cleanly tagged `staging`). |

| Design and UX area | Score | One-line reason |
|---|---|---|
| Hierarchy and layout | 8 | Clear focal points on both views, strictly `1` `#003DFF` filled CTA per view, open-ground underline tabs, flat ruled ledger strip, and clean disclosure panels replacing v1 box soup. |
| Typography | 6 | Strong `Sora`/`Inter`/`JetBrains Mono` hierarchy with balanced headings and `tabular-nums`, held back by `14` distinct `font-size` values in both stylesheets and small `0.7rem`–`0.72rem` labels. |
| Colour, contrast and theming | 7 | Restrained 90–95% neutral chrome with WCAG AA+ core ink (`13.91:1` primary, `6.61:1` muted, `6.75:1` white-on-blue); `.footer-colophon` fails AA (`3.09:1`) and CSS declares `8` distinct raw hex + `22` `rgba()` values outside `:root`. |
| Component consistency | 6 | Unified Concept 2 lockup (`public/favicon.svg`) and `cubic-bezier(0.23, 1, 0.32, 1)` motion; undermined by split `:root` token systems across `styles.css`/`dashboard.css`, `11` dead `:root` tokens, and `10` distinct `border-radius` values on `/dashboard`. |
| Navigation and information architecture | 8 | `/` and `/dashboard` link cleanly both ways, 3 tabs organize all workflows with synced `?tab=`/`?tier=`/`?filter=` URL state, and `<= 640px` swaps smoothly to mark-only navigation. |
| Core flows and feedback | 8 | Full claim (`0-conf`), forge, copy txid/hex, adversarial exploit verification, and WalletConnect pairing flows complete in-context with timing, `.is-busy` spinners, and explicit `AbortController` handling. |
| Forms and input | 7 | `#input-custom-address` has explicit label, `name`, `aria-describedby`, `aria-invalid`, and error focus; Safari/mobile iOS zooms `< 16px` (`0.8125rem`) inputs without `input[font-size: 1rem]` on narrow screens. |
| States: loading, empty, error, success | 7 | Dedicated empty, error-with-retry, unsigned, loading-spinner, and success states everywhere; initial page load renders `—` dashes without skeleton placeholders and custom-wallet errors share the single error element with sandbox errors. |
| Accessibility | 8 | Native `<button class="tier-receipt-btn">` toggles work under reduced motion, skip links, `#wc-modal` `Tab` focus trap + close restore, `role="img"` canvas labels, and `>= 44px` mobile hit targets; automated `axe` scan not yet run. |
| Responsive and mobile | 8 | Clean `390×844` renders on both views (`0px` horizontal shift, single-row underline `.tab-bar`, `44×44` mark anchor, non-clipping `<pre>` and `64`-char txids). |
| Copy and microcopy | 8 | Clear plain English (`179/300` pre-tech words, `0` buzzwords), accurate button verbs, and verified fixture labels; `renderNotFoundHtml()` still titles itself `BLAZE Forge` and links missing `.notfound-*` CSS classes. |

---

## Previous audit (`2026-11-19`) re-check

| v1 "Fix first" item | Status | Evidence observed in v2 |
|---|---|---|
| 1. Broken `/dashboard` primary CTA & nav link (`404` dead end) | **Closed** | `/dashboard` (`public/dashboard.html`, `public/dashboard.js`) is implemented, served cleanly by `src/api/routes.ts:44-59` and `vercel.json:6-9`, and completes Claim -> Forge -> Proofs -> Registry end-to-end. |
| 2. Three API correctness bugs (`claimDemoStamps` slot map, `forgeTrophy` explicit UTXO fees, `422` insufficient stamps) | **Closed** | `claimDemoStamps` filters `kind === 'demo'` slots `10..14` (`src/api/service.ts:490-502`); `forgeTrophy` passes `feeUtxos` cleanly alongside `req.utxos` (`src/api/service.ts:538-555`, `src/buildForgeTx.ts:588-597`); `ForgeValidationError` returns `422` (`src/api/routes.ts:606-609`), verified by tests 19 & 21 in `tests/api.test.ts`. *(Minor bug remains in `claim` vs `forge` pre-broadcast baton recording — see Fix First #3.)* |
| 3. Raw private keys over HTTP, env-driven provider config, contract `activeInputIndex` & empty commitment guards | **Closed** | `PrivateKeyRejectedError` blocks HTTP private keys outside mock/explicit flag (`src/api/service.ts:532-534`); `src/config.ts` validates env vars (`.env.example`); both `contracts/BlazeForge.cash:22,29` and `contracts/StampDispenser.cash:10,15` enforce `activeInputIndex == 0` and `nftCommitment == 0x`. |
| 4. Hero WCAG AA contrast & `375×812` mobile rod-over-text overlap | **Closed** | Primary/muted hero inks reach `6.61:1`–`13.91:1`, `mobile` layout offsets `rootGroup` (`public/app.js:876`) and reduces canvas opacity with light text scrims ([v2-mobile-landing.png](./senior-gap-audit/v2-mobile-landing.png)). |
| 5. `prefers-reduced-motion` sticker bug, `/api/attack` race condition, & mobile receipt visibility | **Closed** | Native `<button class="tier-receipt-btn">` binds independently of `REDUCED_MOTION` (`public/app.js:1132-1152`), `executeAttack` uses `AbortController` + retry button + `scrollIntoView` (`public/app.js:1251-1325`). |
| 6. HTTP hardening, CI pipeline, idempotency bounds/namespace, & repo clutter cleanup | **Partly closed** | `IdempotencyStore` now namespaces keys and caps at `1,000` (`src/api/idempotency.ts`), `parseJsonBody` enforces `256KB` bytes with `413` (`src/api/routes.ts:90,262-292`), `.github/workflows/ci.yml` runs all checks, `.gitignore` excludes local research dirs (`git ls-files` clean). **Still open:** `vercel.json` lacks static security headers, rate limiter reads un-proxied `req.socket.remoteAddress`, `7` route aliases remain, `api/index.ts` is duplicated verbatim by `api/[...slug].ts`, and `vite`/`npm` audit dev alerts remain. |

---

## Fix first

Ordered by user impact and deployment risk across Engineering and Design.

1. **[Engineering] Missing `public/vendor/three.module.js` and `three.core.js` crashes `/` JavaScript in Vercel deployments** — **Critical** · Effort: **S**
   - *What's wrong:* `vercel.json:3` sets `"outputDirectory": "public"`, so Vercel serves `/vendor/*` directly from `public/vendor/`. However, `public/vendor/` contains only `wizardconnect.js` and 3 chunk files — `three.module.js` and `three.core.js` are missing from `public/vendor/`. Local tests passed only because Node's `STATIC_ASSET_MAP` (`src/api/routes.ts:60-67`) maps those URLs into `node_modules/three/build/` (`tests/api.test.ts:394-400`).
   - *Why a senior cares:* On Vercel, `public/app.js:1` (`import * as THREE from '/vendor/three.module.js'`) hits a `404` on `/vendor/three.module.js`, aborting the entire ES module before execution — breaking both the 3D hero scene **and** `#tiers` toggles and `#proofs` live attack verification (`POST /api/attack`).
   - *Evidence:* Directory listing of `public/vendor/` (`chunk-KXQ2PETI.js`, `chunk-SQE76S5B.js`, `chunk-XM7N7ROQ.js`, `wizardconnect.js` — no Three.js files); `vercel.json:3`; `public/app.js:1`; `src/api/routes.ts:60-67`.
   - *Fix:* Copy `node_modules/three/build/three.module.js` and `node_modules/three/build/three.core.js` into `public/vendor/` (or vendor them via a build step / `vercel` buildCommand), and point `STATIC_ASSET_MAP` in `src/api/routes.ts` to `public/vendor/` so Node and Vercel serve identical files.

2. **[Engineering] Ephemeral serverless state breaks multi-step sandbox & 0-conf flows on Vercel; unguarded/duplicated `api/*.ts` entrypoints** — **High** · Effort: **M**
   - *What's wrong:* `BlazeBackendService` stores sandbox keypairs (`testSigners`), sandbox counters, `IdempotencyStore` receipts, `rateLimiter` buckets, and `BatonMempoolTracker` unconfirmed batons exclusively in process RAM (`src/api/service.ts:108-135`). On Vercel serverless functions (`api/index.ts` and an exact duplicate `api/[...slug].ts`), separate requests or cold starts hit different containers with empty `testSigners` maps, causing a `/dashboard` user's newly minted Sandbox wallet from `POST /api/wallet/demo` to lose its signer on the next `POST /api/forge` request. Neither `api/index.ts` nor `api/[...slug].ts` wraps `handleRequest()` in top-level error handling like `createHttpServer` (`src/server.ts:48-68`).
   - *Why a senior cares:* A core user journey (`create sandbox wallet -> claim stamps -> forge trophy -> idempotent retry`) randomly fails across warm serverless instances, and unhandled rejections terminate serverless invocations with opaque Vercel `502` pages instead of structured JSON.
   - *Evidence:* `api/index.ts:1-9`, `api/[...slug].ts:1-9` (verbatim duplicates); `src/server.ts:43-84`; `src/api/service.ts:108-135,272,546,562`.
   - *Fix:* Consolidate `api/index.ts` + `api/[...slug].ts` around one shared Vercel adapter with `try/catch` safe `500` logging, keep mock serverless runs deterministic (or move shared ephemeral state/batons into Redis/KV when deployed multi-instance), and clearly label serverless mock persistence limits in docs.

3. **[Engineering] `BatonMempoolTracker` records spent batons before `builder.send()` confirms broadcast** — **High** · Effort: **S**
   - *What's wrong:* Both `buildClaimDemoStampsTx` (`src/buildForgeTx.ts:499-508`) and `buildForgeTx` (`:627-637`) call `finalizeBuiltBatonTx()`, which immediately calls `tracker.record(contractTokenAddress, spentOutpoint, nextBatonUtxo)` **before** `claim.builder.send()` or `built.builder.send()` is invoked in `src/api/service.ts:486,563`.
   - *Why a senior cares:* If the Electrum broadcast fails or rejects in `builder.send()`, the in-memory baton tracker still overwrites the live baton outpoint with a nonexistent `txid:0`, breaking every subsequent user's claim or forge until the server restarts.
   - *Evidence:* `src/buildForgeTx.ts:383-389,499-508,627-637` vs `src/api/service.ts:485-488,562-566`.
   - *Fix:* Return `recordPendingBaton: () => void` (or call `batonTracker.record(...)` explicitly only *after* `builder.send()` resolves without error).

4. **[Engineering] `vercel.json` serves HTML/JS without security headers; rate limiter reads un-proxied `socket.remoteAddress`** — **High** · Effort: **S**
   - *What's wrong:* `SECURITY_HEADERS` (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) is attached inside Node's `tryServeStatic` (`src/api/routes.ts:92-98,179-186`), which Vercel's CDN bypasses for `/`, `/dashboard`, and `/public/*` because `vercel.json` defines no `"headers"` array. Additionally, `enforcePostRateLimit` (`src/api/routes.ts:331`) keys strictly by `req.socket?.remoteAddress`, so behind Vercel or Nginx every user shares the single proxy IP (`120` req/min bucket).
   - *Why a senior cares:* Production HTML pages ship without clickjacking (`X-Frame-Options` / `frame-ancestors`) or CSP protections, while a single user or automated check can trigger HTTP `429` for all visitors behind a reverse proxy.
   - *Evidence:* `vercel.json:1-17` vs `src/api/routes.ts:92-98,179-186,331`.
   - *Fix:* Mirror the security headers in `vercel.json`'s `"headers"` rule for all routes (`/(.*)`), and read trusted forwarded IP headers (e.g., `x-real-ip` / `x-vercel-forwarded-for` behind a trusted proxy flag) before falling back to `req.socket.remoteAddress`.

5. **[Engineering] `GET /api/wallet` reports backend timeouts as `422 INVALID_ADDRESS`, and `testSigners` Map grows unbounded** — **Medium** · Effort: **S**
   - *What's wrong:* `GET /api/wallet?address=...` wraps `ctx.service.getWalletOverview(address)` in a single `try/catch` (`src/api/routes.ts:390-404`) that returns `422 INVALID_ADDRESS` for *any* thrown error — including Electrum connection timeouts inside `this.provider.getUtxos()`. Meanwhile, `this.testSigners` (`src/api/service.ts:108,272`) appends an entry on every `POST /api/wallet/demo` without a maximum cap or eviction.
   - *Why a senior cares:* Temporary indexer/Electrum outages look like invalid user wallet addresses (`422` instead of `503`), and repeated `/api/wallet/demo` calls leak memory until process OOM.
   - *Evidence:* `src/api/routes.ts:390-404`; `src/api/service.ts:108,272`.
   - *Fix:* Validate `toTokenAwareNetworkAddress(address)` separately before calling `this.provider.getUtxos(...)` so address errors return `422` and provider failures return `503`, and cap `testSigners` (evicting oldest sandbox signers, e.g., at `1,000` entries).

6. **[Design + Engineering] Split CSS token systems (`14` font sizes, `10` radii, `11` unused tokens), `3.09:1` footer contrast failure, and unstyled `404` HTML** — **Medium** · Effort: **M**
   - *What's wrong:* `public/styles.css` and `public/dashboard.css` declare two incompatible `:root` token vocabularies (`--frost-100`/`--slate-600` vs `--ground`/`--muted`), each declaring `14` distinct `font-size` values, up to `10` corner radii (`styles.css`: `6`; `dashboard.css`: `10`), `11` dead unused tokens, and `22` `rgba()` / `8` raw hex overrides outside `:root`. On `/` desktop/phone, `.footer-colophon` renders `#666a8a` on `#1d1f30` (**`3.09:1`**, failing WCAG AA `4.5:1`). Meanwhile, `renderNotFoundHtml()` (`src/api/routes.ts:305-327`) outputs `<title>... BLAZE Forge</title>` and classes `.notfound-body`, `.notfound-card`, `.muted-copy`, `.notfound-actions` that do not exist anywhere in `public/dashboard.css`.
   - *Why a senior cares:* Splitting tokens across two stylesheets guarantees visual drift as screens evolve, low-contrast footer text fails basic accessibility audits, and any mistyped URL renders broken unstyled markup with the old product name.
   - *Evidence:* Static CSS audit (`14` font sizes, `10` radii, `11` unused tokens); WCAG contrast calculation (`#666a8a` on `#1d1f30` = `3.09:1`); `src/api/routes.ts:305-327`; [v2-desktop-landing.png](./senior-gap-audit/v2-desktop-landing.png).
   - *Fix:* Extract a shared `public/tokens.css` (6-step type scale, 3 radii, 0 dead tokens), lighten `.footer-colophon` to `#a7adc6` (`>= 6.5:1`), update `renderNotFoundHtml` to `cindr` and add `.notfound-*` styling to `dashboard.css`.

7. **[Engineering] Add ESLint/Prettier, frontend browser smoke tests in CI, and address `vitest` critical dev advisories** — **Medium** · Effort: **M**
   - *What's wrong:* `.github/workflows/ci.yml` verifies `tsc`, `build`, `verify`, `smoke`, and `check:words`, but there is no linter or formatter check, zero automated DOM/browser tests exercising `public/app.js` or `public/dashboard.js` flows, and `npm audit` flags `2` critical (`tinypool <=2.1.1`) + `1` moderate (`@vitest/mocker <=4.1.11`) advisories in dev dependency `vitest@3.x` (`npm audit --omit=dev` has `0`).
   - *Why a senior cares:* Manual browser verification caught 6 real UI bugs in v2 (occluded button clicks, `606px` mobile txid overflow, clipped tab text) — automating a basic Playwright DOM smoke test in CI prevents those regressions cleanly before deploy.
   - *Evidence:* `package.json`, `.github/workflows/ci.yml`, `tests/api.test.ts:378-425`, `npm audit` output.
   - *Fix:* Add a minimal ESLint/Prettier config, upgrade `vitest` when ready for v5 or scope workspace test exposure, and add a fast headless smoke check verifying `/vendor/*` imports and `/` + `/dashboard` desktop/phone overflow `0`.

---

## Engineering findings

### 1. Security and access control

- **Static Vercel routes omit `SECURITY_HEADERS` (`CSP`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`)** · **High** · Tell?: No · Effort: **S**
  - *Finding:* Only Node's `tryServeStatic` (`src/api/routes.ts:179-186`) sets `SECURITY_HEADERS`. Vercel serves `public/` via CDN directly without invoking Node, and `vercel.json` specifies no `"headers"`.
  - *Evidence:* `vercel.json:1-17` vs `src/api/routes.ts:92-98,179-186`.
  - *Fix:* Add matching `"headers"` rules inside `vercel.json` covering `/`, `/dashboard`, and `/(.*)`.

- **Rate limiter keys strictly on `req.socket?.remoteAddress`, ignoring reverse-proxy client IP headers** · **Medium** · Tell?: No · Effort: **S**
  - *Finding:* `enforcePostRateLimit` (`src/api/routes.ts:331`) ignores forwarded IP headers (`x-vercel-forwarded-for`, `x-real-ip`), so any deployment behind a reverse proxy pools all users into one `120` req/min bucket.
  - *Evidence:* `src/api/routes.ts:329-344`.
  - *Fix:* Parse the single right-most proxy-set `x-real-ip` / `x-vercel-forwarded-for` header when `VERCEL` or `TRUST_PROXY=true` is enabled.

- **CSP allows `'wasm-unsafe-eval'` globally across both HTML views; default `ALLOWED_ORIGIN=*`** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* `SECURITY_HEADERS['Content-Security-Policy']` (`src/api/routes.ts:97`) enables `'wasm-unsafe-eval'` even on `/` (which only runs Three.js JS without libauth/WalletConnect Wasm), and `.env.example:8` defaults `ALLOWED_ORIGIN=*`.
  - *Evidence:* `src/api/routes.ts:97,162`; `.env.example:8`.
  - *Fix:* Restrict `'wasm-unsafe-eval'` to `/dashboard` if Wasm requires it, and set a specific origin in `.env` on live deployments.

### 2. Data model and integrity

- **Pre-broadcast `batonTracker.record()` corrupts tracked 0-conf state when `builder.send()` fails** · **High** · Tell?: No · Effort: **S**
  - *Finding:* `finalizeBuiltBatonTx()` (`src/buildForgeTx.ts:383-389`) updates `tracker.record(...)` before `claim.builder.send()` or `built.builder.send()` executes in `src/api/service.ts:486,563`. A network timeout or mempool conflict leaves the tracker pointing at an unbroadcasted `txid:0`.
  - *Evidence:* `src/buildForgeTx.ts:383-389,499-508,627-637`; `src/api/service.ts:485-488,562-566`.
  - *Fix:* Record `nextBatonUtxo` in `batonTracker` only inside the success branch immediately after `.send()` resolves.

- **Ephemeral in-memory `testSigners`, `sandboxWalletCount`, and `batonTracker` break across Vercel serverless containers** · **High** · Tell?: No · Effort: **M**
  - *Finding:* Process-local Maps (`src/api/service.ts:108-110,134`) and `IdempotencyStore` reset on cold start and diverge across warm serverless replicas handling `/api/wallet/demo`, `/api/stamps/claim`, and `/api/forge`. Meanwhile, `testSigners` has no size cap in long-lived Node servers.
  - *Evidence:* `src/api/service.ts:108-135,272-284`.
  - *Fix:* Cap `testSigners` (e.g., FIFO `1,000` entries) for single-node runs and back multi-instance Vercel state with KV/Redis (or deploy Node statefully on a single-instance host).

- **Staging TokenHunt placeholders (`0404...`, `0606...`, `0707...`, `0909...`) still await organizer activation** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Four slots in `OFFICIAL_TOKENHUNT_CATALOG` (`src/registry.ts:57-99`) remain deterministic staging placeholders (`activationStatus: 'staging'`), reversible at startup via `TOKENHUNT_OVERRIDES_JSON`.
  - *Evidence:* `src/registry.ts:57-99`, `src/config.ts:88-108`, `evidence/tokenhunt-live-sync.json`.
  - *Fix:* Populate `TOKENHUNT_OVERRIDES_JSON` via `npm run sync:tokenhunt` before launching with live organizer badges; no change needed for mock/demo mode.

### 3. Architecture and boundaries

- **Verbatim duplicated Vercel entrypoint files (`api/index.ts` and `api/[...slug].ts`) & 7 undocumented route aliases** · **Medium** · Tell?: Yes (Prompt drift) · Effort: **S**
  - *Finding:* `api/index.ts` (`lines 1-9`) and `api/[...slug].ts` (`lines 1-9`) are byte-for-byte identical, and `src/api/routes.ts` still supports 7 legacy unprefixed/alias endpoints (`/health`, `/registry`, `/baton`, `/api/claim-stamps`, `/claim-stamps`, `/forge`, `/attack` at `lines 366-378,430-432,519,625`) not listed in `README.md:43-55`.
  - *Evidence:* `api/index.ts:1-9`, `api/[...slug].ts:1-9`, `src/api/routes.ts:366-625`.
  - *Fix:* Share a single helper exported to `api/*.ts` and deprecate/remove duplicate unprefixed route aliases if external callers don't depend on them.

- **Monolithic frontend/backend files (`dashboard.js` 1,618L, `app.js` 1,348L, `buildForgeTx.ts` 860L, `routes.ts` 682L)** · **Medium** · Tell?: Yes (Giant files) · Effort: **M**
  - *Finding:* Everything from Three.js GLSL shaders to fetch handlers lives in `public/app.js` (`1,348` lines); every workspace state, WizardConnect pairing, DOM builder, and API call lives in `public/dashboard.js` (`1,618` lines); `src/buildForgeTx.ts` spans `860` lines.
  - *Evidence:* Verified file line counts (`public/dashboard.js: 1,618`, `public/dashboard.css: 1,595`, `public/styles.css: 1,547`, `public/app.js: 1,348`, `src/buildForgeTx.ts: 860`, `src/api/routes.ts: 682`).
  - *Fix:* Split cleanly along cohesive seams (`iris-scene.js` vs `landing-proofs.js`; `wallet-session.js` vs `wizardconnect.js` vs `workspace-ui.js`; `batonTracker.ts` vs `adversarial.ts`).

### 4. Error handling and resilience

- **`GET /api/wallet` misclassifies Electrum/provider errors as `422 INVALID_ADDRESS`** · **Medium** · Tell?: No · Effort: **S**
  - *Finding:* Wrapping `ctx.service.getWalletOverview(address)` in one generic `catch` (`src/api/routes.ts:394-404`) turns any transient `this.provider.getUtxos()` failure into `422 INVALID_ADDRESS`.
  - *Evidence:* `src/api/routes.ts:390-404` vs `src/api/service.ts:292-293`.
  - *Fix:* Parse/validate the CashAddress cleanly before invoking `getUtxos` so network errors propagate as `503 SERVICE_UNAVAILABLE`.

- **No top-level `try/catch` in Vercel `api/*.ts` handlers & `9` bare `catch {}` blocks in `public/dashboard.js`** · **Medium** · Tell?: Yes (Swallowed errors) · Effort: **S**
  - *Finding:* `api/index.ts:7-9` and `api/[...slug].ts:7-9` await `handleRequest()` directly without the safe `try/catch` JSON fallback used in `src/server.ts:46-69`. On the client, `public/dashboard.js` contains `9` bare `catch {}` blocks (`lines 164, 175, 188, 861, 1124, 1223, 1244, 1596, 1607`) — mostly intentional storage/clipboard/disconnect guards, though `861` (`executeDashboardAttack` scroll? or network JSON parse) and `1244` (`restoreStoredWcSessionIfPresent`) fail silently without console/status telemetry.
  - *Evidence:* `api/index.ts:7-9`, `public/dashboard.js` grep (`9` empty `catch {}` blocks).
  - *Fix:* Share `createSafeRequestHandler(ctx)` across Node and Vercel handlers; review `public/dashboard.js` `catch {}` blocks so session-restore or clipboard denials log/surface gracefully when relevant.

### 5. Testing and verification

- **Zero automated browser/DOM tests checking `/` and `/dashboard` scripts or Vercel CDN vendor packaging** · **Medium** · Tell?: No · Effort: **M**
  - *Finding:* All `38/38` automated tests (`tests/api.test.ts` 27, `tests/forge.test.ts` 11) hit contracts and Node HTTP routes cleanly. None execute `public/app.js` or `public/dashboard.js` in a DOM/browser environment — explaining why `/vendor/three.module.js` missing from `public/vendor/` and `#tiers` mouse-click occlusion slipped past CI until manual browser review.
  - *Evidence:* `tests/api.test.ts:378-425` (checks Node's `node_modules` proxy at `/vendor/three.module.js`, not `public/vendor/` on disk).
  - *Fix:* Add a fast headless browser test in CI checking console errors `=== 0`, scroll width `<= innerWidth`, `#tiers` click toggles, and disk presence in `public/` matching every `<script>`/`import` URL.

### 6. Code hygiene and consistency

- **Clean `tsc --noEmit`, `0` `any`/`@ts-ignore`, yet `dashboard.js` uses `innerHTML = ''` resets and lacks lint/format tooling** · **Low** · Tell?: Yes (No formatter/linter) · Effort: **S**
  - *Finding:* Static scan confirmed `0` `any`, `0` `@ts-ignore`, `0` `TODO`/`FIXME`, and clean TypeScript compilation across `src/`, `api/`, and `scripts/`. However, no ESLint or Prettier config exists (`package.json`), `public/app.js:1082,1092` injects HTML templates (`HERO_STATES[].headline` — static constants, safe today), and `renderNotFoundHtml` (`src/api/routes.ts:312`) retains an old `"BLAZE Forge"` `<title>`.
  - *Evidence:* Static grep across `src/`, `api/`, `scripts/`, `public/*.js`; `package.json:7-32`; `src/api/routes.ts:312`.
  - *Fix:* Add ESLint + Prettier scripts to CI and update `renderNotFoundHtml` title to `cindr`.

### 7. Performance

- **`POST /api/attack` constructs a fresh `MockNetworkProvider` + contract on every request; `requestAnimationFrame` vs static HTML** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* `runAdversarialForgeAttack()` (`src/buildForgeTx.ts:677-683`) initializes a full provider, instantiates `BlazeForge`, derives keys, and runs CashVM per call (`~300–1,600ms` observed in tests and live browser). Note positive frontend improvements: scroll reads batch inside `requestAnimationFrame`, Three.js pauses off-screen or via `#btn-toggle-motion`, and `IdempotencyStore` / `RateLimiter` both cap memory cleanly.
  - *Evidence:* `src/buildForgeTx.ts:677-683`; live browser Turn 1 timing (`verified in 1609ms` for `duplicate-slot`).
  - *Fix:* Memoize/cache deterministic mock attack receipts or rate-limit `/api/attack` aggressively per IP if traffic grows.

### 8. Operations and delivery

- **Missing `public/vendor/three.*.js` breaks Vercel landing page JS; local `.chipnet-deployer.json` awaits faucet funding** · **Critical** · Tell?: No · Effort: **S**
  - *Finding:* Directly linked to Fix First #1: `npm start` locally passes because `src/api/routes.ts:60-67` resolves Three.js from `node_modules`, whereas `vercel.json` serves static files strictly from `public/`, leaving `/vendor/three.module.js` `404` on Vercel. Separately, `evidence/chipnet-deployment.json` accurately records the Chipnet deployer has `0` tBCH sats (`awaiting_faucet_funding`), and no telemetry/error reporter (Sentry/Vercel Drain) is configured.
  - *Evidence:* `public/vendor/` listing (`4` WizardConnect files only); `vercel.json:3`; `evidence/chipnet-deployment.json:1-12`.
  - *Fix:* Vendor Three.js directly into `public/vendor/`, add static headers in `vercel.json`, and run `npm run deploy:chipnet` once faucet tBCH arrives if demonstrating live Chipnet transactions.

### 9. Dependencies and configuration

- **Production dependencies report `0` CVEs; `vitest@3.x` carries `2` critical + `1` moderate dev advisories** · **Medium** · Tell?: No · Effort: **S**
  - *Finding:* `npm audit --omit=dev` cleanly passes with `0` vulnerabilities across all `41` production packages. Full `npm audit` flags `tinypool <=2.1.1` (critical RCE/prototype pollution) and `@vitest/mocker <=4.1.11` (moderate path traversal) pulled in via dev-only `vitest@^3.0.0`, upgradeable only via major bump to `vitest@5.1.1`.
  - *Evidence:* `npm audit --omit=dev` (`found 0 vulnerabilities`); `npm audit` (`3 vulnerabilities (1 moderate, 2 critical)`).
  - *Fix:* Schedule upgrading `vitest` past v3 (`vitest@5.x`) cleanly in CI and re-run `npm run verify`.

### 10. Docs and developer experience

- **Docs are accurate (`38/38` test badge, `.env.example`, `README.md`, `JUDGES.md`, `DESIGN.md`); `DESIGN.md` vs `docs/DESIGN_DIRECTION.md` slightly overlap** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* `README.md` accurately lists all routes, `38/38` test counts, build/start steps, and `179/300` pre-tech words (`plain-words-check PASS`). Minor cleanup: both `DESIGN.md` and `docs/DESIGN_DIRECTION.md` describe the UI direction, and `package.json` `"start"` compiles only on `npm start` (`prestart`), whereas `vite`/static vendor needs explicit build syncing for Vercel.
  - *Evidence:* `README.md:1-75`; `DESIGN.md`; `docs/DESIGN_DIRECTION.md`; `.env.example:1-24`.
  - *Fix:* Add a short `npm run sync:vendor` / `build:public` step in `package.json` `build` and keep one canonical design doc reference.

### 11. Product and scope judgement

- **Core workflow is cohesive and complete (`4` organizer badge slots cleanly tagged `staging`)** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Both `/` (interactive refusal playground + covenant overview) and `/dashboard` (Claim 5 Demo Stamps -> Forge NFT in 0 blocks -> inspect hex/batons -> Proofs -> Registry) deliver crisp real CashVM execution with zero fake "coming soon" pages or dead buttons.
  - *Evidence:* Live browser verification on `http://localhost:3000/` and `http://localhost:3000/dashboard` (`v2-desktop-landing.png`, `v2-desktop-dashboard.png`).
  - *Fix:* Fix Vercel `/vendor/three.module.js` and serverless state handling so the hosted deploy matches local behavior cleanly.

---

## Design and UX findings

### 1. Hierarchy and layout

- **Clean Algolia visual hierarchy, 1 primary `#003DFF` CTA per view, and progressive disclosures (`<= 2` levels)** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Both `/` and `/dashboard` now separate open neutral frost `#F7F7FA` ground from flat `#FFFFFF` panels cleanly: only `Open Forge Workspace` (`/`) and `#btn-header-primary` (`/dashboard`) carry `#003DFF` fill, tabs use open-ground underlines, KPIs share one horizontal `1px`-ruled strip, and bulky UTXO/hex/stack traces sit cleanly inside `<details>` disclosures ([v2-desktop-landing.png](./senior-gap-audit/v2-desktop-landing.png), [v2-desktop-dashboard.png](./senior-gap-audit/v2-desktop-dashboard.png)). One minor alignment quirk on `/` mobile (`390×844`): the top-right `Workspace` nav pill wraps onto its own 3rd header row below the 4 section links ([v2-mobile-landing.png](./senior-gap-audit/v2-mobile-landing.png)).
  - *Evidence:* [v2-desktop-landing.png](./senior-gap-audit/v2-desktop-landing.png), [v2-mobile-landing.png](./senior-gap-audit/v2-mobile-landing.png), [v2-desktop-dashboard.png](./senior-gap-audit/v2-desktop-dashboard.png).
  - *Fix:* Put `.hero-nav-link-emphasis` (`Workspace`) on the top row right next to the brand mark at `<= 768px` (or tighten mobile header wrapping cleanly).

### 2. Typography

- **14 distinct `font-size` values per stylesheet with tiny `0.7rem`–`0.72rem` labels** · **Medium** · Tell?: Yes (Random values) · Effort: **S**
  - *Finding:* Static CSS scan counted `14` distinct `font-size` declarations in `public/styles.css` and `14` in `public/dashboard.css` (mixing `0.7rem`, `0.72rem`, `0.75rem`, `0.78rem`, `0.8125rem`, `0.875rem`, `0.9375rem`, `1rem`, `1.125rem`, `1.2rem`, `1.25rem`, `1.35rem`, `1.5rem`, `2.15rem`, plus `clamp()` headings). Weights are clean (`400`–`700` on `/`; `500`, `600`, `700` on `/dashboard`) and `.num` / `.num-col` consistently enforce `tabular-nums`.
  - *Evidence:* CSS metric scan on `public/styles.css` (`14` sizes) and `public/dashboard.css` (`14` sizes); `public/dashboard.css:760,1277,1299` (`0.72rem`, `0.7rem`).
  - *Fix:* Consolidate onto a 6–7 token scale (`0.75rem` minimum legible caption/mono size -> display heading) in a shared `tokens.css`.

### 3. Colour, contrast and theming

- **`.footer-colophon` fails WCAG AA contrast (`3.09:1`), plus `8` raw hex and `22` `rgba()` values outside `:root`** · **Medium** · Tell?: No · Effort: **S**
  - *Finding:* Core light/dark contrast improved dramatically vs v1 (`#23263b` on `#f7f7fa` = `13.91:1`; `#52567a` = `6.61:1`; `#666a8a` on `#f7f7fa` = `4.92:1`; `#ffffff` on `#003dff` = `6.75:1`; `#d1d5e5` on `#1d1f30` = `11.12:1`). However, `.footer-colophon` (`public/styles.css:1412`) applies `--slate-500` (`#666a8a`) onto dark `--xenon-900` (`#1d1f30`), scoring **`3.09:1`** (below `4.5:1` for `0.75rem` body text). CSS outside `:root` also contains `8` distinct raw hex literals (`#ffffff`, `#10b981`, `#f43f5e`, `#fda4af`, `#a7f3d0`, `#e2e8f0`, `#f8fafc`, `#cbd5e1`) and `22` `rgba(...)` literals across both files.
  - *Evidence:* WCAG luminance check (`#666a8a` vs `#1d1f30` = `3.09:1`); CSS hex/rgba scan on `public/styles.css` & `public/dashboard.css`.
  - *Fix:* Change `.footer-colophon` text color to `--xenon-200` (`#d1d5e5` -> `11.12:1`) or `#a7adc6`, and tokenize the repeated dark status/slate hex colors into `:root`.

### 4. Component consistency

- **Separate `:root` token files (`styles.css` vs `dashboard.css`), `10` radii values in `dashboard.css`, and `11` dead `:root` tokens** · **Medium** · Tell?: Yes (Dead tokens / split styling) · Effort: **M**
  - *Finding:* `styles.css` declares `48` tokens (naming ground `--frost-100`, border `--border-light`, slate `--slate-600`) while `dashboard.css` re-declares `38` overlapping tokens with completely different names (`--ground`, `--border`, `--muted`). Both files retain `11` unused `:root` variables (`9` in `styles.css`, `2` in `dashboard.css`), and `dashboard.css` mixes `4` radius tokens (`--radius-control` `8px`, `--radius-panel` `12px`, `--radius-card` `14px`, `--radius-pill` `999px`) alongside raw `6px`, `8px`, `10px`, `12px`, `14px`, `50%` literals (`10` distinct radius expressions). Also note `--xenon-900` is `#1d1f30`, while `public/app.js` Three.js tips and CTA `#003DFF` stay consistent.
  - *Evidence:* Unused token scan (`styles.css`: `9` unused; `dashboard.css`: `2` unused); radius scan (`dashboard.css`: `10` values; `styles.css`: `6` values).
  - *Fix:* Unify shared design variables into `public/tokens.css`, delete all `11` unused tokens, and replace raw `10px`/`6px` radius literals with tokens.

### 5. Navigation and information architecture

- **Clean cross-navigation, synced URL query state (`?tab=`, `?tier=`, `?filter=`), and mark-only `<= 640px` swap** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Both pages link smoothly (`Workspace` pill on `/`, `Overview` link + logo on `/dashboard`), browser Back/Forward/Reload preserves active workspace tab/tier/filter via URLSearchParams (`public/dashboard.js:7-17,1542-1575`), and `<= 640px` cleanly shows Concept 2 `Loop Latch` without wrapping `.tab-bar`.
  - *Evidence:* [v2-desktop-dashboard.png](./senior-gap-audit/v2-desktop-dashboard.png), [v2-mobile-dashboard.png](./senior-gap-audit/v2-mobile-dashboard.png), `public/dashboard.js:7-17`.
  - *Fix:* No structural nav issues remaining.

### 6. Core flows and feedback

- **End-to-end 0-conf claim, forge, attack verification, and WizardConnect relay modal work cleanly** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Claiming 5 Demo Stamps, forging a BLAZE Medallion in 0 blocks, inspecting raw hex/baton outpoints, testing live CashVM exploits, copying addresses/txids (`Copied` feedback), and pairing external wallets all give crisp visual and aria-live feedback. One external vendor console timeout (`"[wizardconnect/dapp] Key exchange timed out"`) fired ~35s after closing `#wc-modal` during testing.
  - *Evidence:* Browser verification Turns 1 & 3 (claim `37ad399b...`, forge `1a0d1f49...`, `Trophies minted = 2`, `.tier-receipt-btn` open/close).
  - *Fix:* Ensure WalletConnect relay cleanup suppresses post-close timeout error noise when user intentionally closes `#wc-modal`.

### 7. Forms and input

- **Custom CashAddress form (`13px` input size) triggers mobile zoom & shares error slot with sandbox button** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* `.text-input` (`#input-custom-address`) sets proper `<label>`, `name`, `aria-describedby`, `aria-invalid`, and auto-focuses on validation errors (`public/dashboard.js:1441-1473`). However, `.text-input` uses `font-size: 0.8125rem` (`13px`), which causes iOS Safari auto-zoom on tap unless `>= 16px` (`1rem`) on narrow viewports, and clicking `Create fresh sandbox wallet` on error writes into `#custom-address-error` (`:1428`) below the custom address input rather than next to the sandbox button.
  - *Evidence:* `public/dashboard.css:407`; `public/dashboard.js:1428,1441-1473`.
  - *Fix:* Bump `.text-input` to `1rem` at `@media (max-width: 640px)` and separate sandbox creation errors from `#custom-address-error`.

### 8. States: loading, empty, error, success

- **Rich post-load states; initial boot shows `—` / `Loading…` dashes without layout skeletons** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Action `.is-busy` spinners, `.receipt-empty` instructions, `.receipt-error` with `#btn-receipt-retry`, `.is-unsigned` WizardConnect payload state, and `Minted in 0 blocks` success banners are all built cleanly. On cold page load before `/api/wallet/demo` resolves, metrics flash `—` and CTA disables to `Loading…` rather than matching skeleton bars.
  - *Evidence:* `public/dashboard.html:132-134,184-194`; `public/dashboard.js:422-425`.
  - *Fix:* Optionally render subtle fixed-width placeholder bars matching KPI digit height until `walletOverview` resolves.

### 9. Accessibility

- **Keyboard-trapped modal, native buttons, contrast AA cores, and `44px` mobile hit targets** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Replaced v1's `<article role="button">` cards with native `.tier-receipt-btn` toggles (`public/app.js:1132-1152`), added skip links, visible `:focus-visible` outlines, `#wc-modal` `Tab` focus trapping + popover auto-close + focus return to `#btn-wallet-menu`, `role="img"` on `#wc-qr-canvas`, `aria-live="polite"` regions, and `>= 44px` mobile touch targets across `.brand-lockup` (`44×44`), `.tab-btn`, and primary/secondary actions. Two gaps left: `#tab-btn-forge`..`#tab-btn-network` on `390×844` pack closely (`10px` gap, full text legible without clipping) and automated `axe` / screen-reader testing wasn't run.
  - *Evidence:* Browser Polish Pass 1, 3, & 4 (`44×44` `.brand-lockup`, `#btn-wallet-menu:focus` restore, `0` skipped interactive targets).
  - *Fix:* Run `@axe-core/playwright` against `/` and `/dashboard` in CI.

### 10. Responsive and mobile

- **`390×844` renders cleanly with `0px` horizontal overflow; minor spacing polish on hero mobile nav** · **Low** · Tell?: No · Effort: **S**
  - *Finding:* Both [v2-mobile-landing.png](./senior-gap-audit/v2-mobile-landing.png) and [v2-mobile-dashboard.png](./senior-gap-audit/v2-mobile-dashboard.png) fit strictly within `390px` (`width = 375` inside 15px scrollbar, `0px` wheel shift), `<pre>` blocks scroll locally with `overscroll-behavior: contain`, `64`-char `txid`s truncate inside cards, `#tiers` cards reveal & toggle cleanly on touch, and `/dashboard` tabs stay on a single underline baseline (`Network & Registry` `right: 335.38 <= 359`).
  - *Evidence:* [v2-mobile-landing.png](./senior-gap-audit/v2-mobile-landing.png), [v2-mobile-dashboard.png](./senior-gap-audit/v2-mobile-dashboard.png), Browser Re-Verify Pass 2 & Pass 4 measurements.
  - *Fix:* Keep monitoring `320px` mini viewports where single-row `.tab-bar` scrolls horizontally (`overflow-x: auto` already enabled).

### 11. Copy and microcopy

- **Clear plain English (`179/300` words, `0` buzzwords); `404` page retains stale `BLAZE Forge` title & broken CSS classes** · **Low** · Tell?: Yes (Residue) · Effort: **S**
  - *Finding:* `public/index.html` and `public/dashboard.html` consistently use plain English, consistent `0`/`1`/`5` numerals, non-breaking units, curly apostrophes, proper ellipses (`…`), and explicit action labels (`Claim 5 demo stamps`, `Forge BLAZE Medallion`). Meanwhile, `renderNotFoundHtml()` (`src/api/routes.ts:305-327`) outputs `<title>Page not found — BLAZE Forge</title>` and unstyled `.notfound-*` classes alongside an unbuilt `.btn-primary` vs overview button.
  - *Evidence:* `npm run check:words` (`179/300`, `0` buzzwords); `src/api/routes.ts:305-327`; CSS scan showing `0` `.notfound-*` selectors in `public/dashboard.css`.
  - *Fix:* Update `renderNotFoundHtml` branding to `cindr` and add clean styles for `.notfound-body` / `.notfound-card` in `public/dashboard.css`.

---

## What reads as AI-generated

### Code tells (weighted by risk)

- **Carries active risk — Incomplete deployment split (`vercel.json` vs `src/api/routes.ts`):** Shipping `vercel.json` pointing static roots to `public/` without copying Three.js from `node_modules` into `public/vendor/`, combined with duplicate serverless files (`api/index.ts` verbatim duplicate of `api/[...slug].ts`) and missing Vercel `"headers"` mirrors.
- **Carries active risk — Pre-broadcast state mutation (`BatonMempoolTracker`):** Recording next unconfirmed batons inside `finalizeBuiltBatonTx()` before `builder.send()` succeeds, plus unbounded `testSigners` growth in `BlazeBackendService`.
- **Carries subtle risk — Silent storage/telemetry catches (`9` bare `catch {}` in `public/dashboard.js`):** Benign on `clipboard`/`sessionStorage`, noisy or opaque on WalletConnect restore/disconnect.
- **Perception tell — Giant monolithic scripts (`1,618` / `1,348` / `860` lines) & stale `BLAZE Forge` `404` template (`src/api/routes.ts:305-327`):** Remaining artifacts of iterative prompt-by-prompt expansion without module decomposition.

### Design tells

- **Split token vocabularies across two stylesheets:** `styles.css` (`48` `:root` vars) vs `dashboard.css` (`38` `:root` vars) naming the same Frost/Slate/Xenon palette differently (`--frost-100` vs `--ground`, `--border-light` vs `--border`), leaving `11` unused `:root` vars across the two files.
- **Typography & radius proliferation:** `14` distinct `font-size` values per stylesheet (`20` in v1 -> `14` now, still ~2x a tight `6–7` token scale), `10` corner-radius rules in `dashboard.css`, and `8` distinct raw hex + `22` `rgba()` literals outside `:root`.

---

## Already at senior level

- **Real on-chain covenant invariants (`contracts/BlazeForge.cash`, `contracts/StampDispenser.cash`):** Enforces `this.activeInputIndex == 0`, empty baton commitment (`0x`), strictly ascending slot uniqueness (`slot > prevSlot`) inside Layla `OP_BEGIN` / `OP_UNTIL` loops, registry category verification, and consensus Output 2 token burn (`tokenCategory == 0x`).
- **Deterministic real CashVM & HTTP API suite (`38/38` passing):** Real `libauth` `BCH_2026_05` verification proves all 5 exploits fail on-chain at exact contract lines, tests explicit-UTXO fee merging, `422` validation codes, route-scoped idempotency, raw private-key rejection outside mock mode, unsigned `wcTransaction` serialization, and passes `npm audit --omit=dev` with `0` production CVEs.
- **Environment validation & CI pipeline (`src/config.ts`, `.env.example`, `.github/workflows/ci.yml`):** Fails fast on malformed hex/ports/JSON overrides, refuses missing `FAUCET_PRIVKEY_HEX` on non-mock networks, cleanly ignores `.chipnet-deployer.json` and local research dumps in `.gitignore`, and gates PRs/pushes on `tsc`, `build`, `verify`, `smoke`, and `check:words`.
- **Visual restraint, Concept 2 identity, & interactive browser craft (`/` & `/dashboard`):** Strictly `1` `#003DFF` primary CTA per view, crisp Concept 2 (`Loop Latch`) SVG lockup with `<= 640px` `44×44` mark-only swap ([public/favicon.svg](file:///c:/Users/HP%20LAPTOP/Documents/blaze/public/favicon.svg)), open-ground underline tabs, flat ruled metrics, native semantic `<button>` receipt triggers, keyboard focus-trapped modals with focus restore, URL state sync, and `0px` mobile horizontal overflow verified across live desktop (`1440×900`) and phone (`390×844`) captures ([v2-desktop-landing.png](./senior-gap-audit/v2-desktop-landing.png), [v2-mobile-landing.png](./senior-gap-audit/v2-mobile-landing.png), [v2-desktop-dashboard.png](./senior-gap-audit/v2-desktop-dashboard.png), [v2-mobile-dashboard.png](./senior-gap-audit/v2-mobile-dashboard.png)).

---

## Not checked

- **Live Vercel URL HTTP behavior & asset responses:** Audited from `vercel.json`, `api/*.ts`, and `public/vendor/` on disk without making live network calls to `*.vercel.app` (where `/vendor/three.module.js` `404` will manifest directly).
- **Live Bitcoin Cash Chipnet or Mainnet broadcast:** `evidence/chipnet-deployment.json` shows `0` tBCH sats at deployer `bchtest:qpxk7hkhr5l0zsv8sakdgauqhmc8sts3g5yxp4hvrj`; real Electrum/Fulcrum 0-conf relay, mempool fee spikes, and WizardConnect mobile wallet signing (`Selene` / `Cauldron` / `Paytaca`) remain untested against live nodes.
- **Screen-reader (`NVDA`/`VoiceOver`) & automated `@axe-core/playwright` audits:** Keyboard navigation, focus trapping, ARIA roles, contrast math, and mobile screenshots were verified directly; an automated `axe-core` scan and screen-reader pass were not executed.
- **Concurrent load / single-baton UTXO contention:** Sequential 0-conf user chaining is tested (`tests/forge.test.ts` #5, `tests/api.test.ts` #6), not parallel concurrent HTTP requests racing for the single shared contract baton UTXO.

---

## Re-audit when

1. `three.module.js` and `three.core.js` are bundled into `public/vendor/` and verified `HTTP 200` on the live Vercel URL alongside `vercel.json` security headers.
2. `BatonMempoolTracker.record()` moves post-`builder.send()`, `GET /api/wallet` separates `422` validation from `503` provider errors, `testSigners` is capped, and Vercel serverless persistence strategy is decided.
3. CSS tokens are unified into `public/tokens.css`, `.footer-colophon` meets WCAG AA (`>= 4.5:1`), `renderNotFoundHtml()` matches `cindr` styling, and a Playwright browser smoke check runs in CI.
