# cindr Design System (`DESIGN.md`)

Extracted and synthesized from **Nicolas Meuzard's "Product Overview — Algolia.com" (Dribbble `#14001647`)** and the live **`algolia.com` Xenon Design System**, governed by `kings-court-core` (`design-taste-frontend`, `unslop`, `emil-design-eng`, and `frontend-ui-engineering`).

---

## 1. Visual Character & Design Principles

- **Character:** Crisp, architectural, cool-slate developer infrastructure. Light frosted alabaster sections paired with deep midnight Xenon terminals.
- **UI-First Storytelling:** Every conceptual step is anchored by a miniature live UI artifact (token slot schematic, code window, byte-layout pill, or CashVM terminal) rather than abstract decoration.
- **Quiet Chrome:** Navigation, borders, and surfaces stay cool and understated (`1px` periwinkle hairlines, zero neon glow spam). Color is concentrated in primary Xenon Blue CTAs (`#003DFF`), Nebula Indigo accents (`#5468FF`), and semantic status verification indicators.
- **4px Spatial Rhythm:** All gaps, padding, radii, and grid rhythms sit strictly on multiples of `4px` (`8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `80px`).

---

## 2. Color Tokens

### Surface & Background Scale
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--xenon-950` | `#07091E` | Deep midnight navy canvas (footer & terminal backdrop) |
| `--xenon-900` | `#0B0E29` / `#000033` | Algolia Xenon dark bands & interactive proof console |
| `--xenon-850` | `#151438` | Telemetry strip & elevated dark code container |
| `--slate-900` | `#23263B` | Primary dark ink on light surfaces & dark header bar |
| `--slate-800` | `#30314B` | Deep slate secondary surface (Dribbble dark contrast) |
| `--slate-700` | `#36395A` | Body copy ink on light surfaces |
| `--slate-600` | `#484C7A` | Secondary captions & subtitles on light surfaces |
| `--slate-500` | `#676B94` | Muted metadata & hairline labels |
| `--frost-100` | `#F5F5FA` | Primary light studio ground (`algolia.com` `.bg-grey-100`) |
| `--frost-150` | `#F1F0F7` | Soft lavender-frost ground (`Dribbble #14001647`) |
| `--xenon-100` | `#F2F4FF` | Tinted ice highlight surface (`algolia.com` `.bg-xenon-100`) |
| `--xenon-200` | `#BBD1FF` | Soft periwinkle border & pill wash |
| `--surface-white` | `#FFFFFF` | Elevated modular card surface |
| `--border-light` | `#E2E5F3` | Crisp periwinkle structural hairline |
| `--border-dark` | `rgba(187, 209, 255, 0.14)` | Dark-surface subtle card hairline |

### Brand & Semantic Accents
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--xenon-600` | `#003DFF` | Primary Algolia Xenon Blue CTA & active tab/pill highlight |
| `--nebula-500` | `#5468FF` | Hover state, focus border, code keyword highlight |
| `--xenon-400` | `#457AFF` | Bright interactive highlight on dark backgrounds |
| `--accent-cyan` | `#00C6FF` | Telemetry numerals & CashVM opcode highlights |
| `--status-emerald` | `#10B981` | Validated CashVM pass / Live slot badge |
| `--status-rose` | `#F43F5E` | CashVM consensus refusal / blocked state |
| `--status-amber` | `#F59E0B` | Pending / Staging slot badge |

---

## 3. Typography Scale

| Role | Family | Weight & Tracking | Notes |
| :--- | :--- | :--- | :--- |
| Display / Headings | `'Sora', 'Plus Jakarta Sans', sans-serif` | `600`–`700`, `-0.03em` tracking | Confident editorial SaaS clarity |
| Body / UI | `'Inter', 'Plus Jakarta Sans', sans-serif` | `400`–`600`, `1.55`–`1.65` line-height | Scannable across both light and dark sections |
| Code / Hex / Numbers | `'JetBrains Mono', monospace` | `400`–`600`, `tabular-nums`, `font-variant-ligatures: none` | Used for hashes, opcodes, byte counts, and txids |
| Editorial Italic Accent | `'Instrument Serif', Georgia, serif` | `italic 400` | Preserved for the hero transition word (`into` / `with`) |

---

## 4. Component Patterns & Motion

- **Modular Cards:** `16px` border radius (`--radius-card`), `1px solid var(--border-light)` border, layered indigo ambient elevation (`0 18px 44px -12px rgba(35, 38, 59, 0.08)`). Hover lifts `-2px` over `220ms cubic-bezier(0.22, 1, 0.36, 1)`.
- **Buttons:** Tactile `8px`–`10px` radius (or `999px` hero action pill). Primary uses `--xenon-600` (`#003DFF`) transitioning to `--nebula-500` (`#5468FF`), with `:active { transform: scale(0.98); }` press feedback.
- **Code & API Inspector Windows:** Styled after Algolia's interactive widgets (`#0B0E29` / `#151438` shell, 3 window status dots, endpoint pill, line-numbered monospace output).
- **Disclosures (`<details>`):** Bulky UTXO tables, raw `txHex` blobs, and CashVM traces stay tucked inside bordered `<details class="disclosure">` rows on `/dashboard` so default viewport density stays calm and uncrowded.
