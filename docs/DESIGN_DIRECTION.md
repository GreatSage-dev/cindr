# cindr Design Direction (`UI_CRAFT_WORKFLOW` Phase 1)

- **Physical-World Metaphor:** **Assay Die & Perforated Proof Slip** — loose metal tokens punched cleanly into one die slot, smelted into a permanent numbered medallion, paired with a flat ink-on-paper verification ledger.
- **Named Reference & Recipe:** **Algolia Product Overview (`algolia.com` & Nicolas Meuzard Dribbble `#14001647`)**
  - **Tokens:** Open neutral frost ground `#F7F7FA`, elevated flat surface `#FFFFFF`, primary slate ink `#23263B`, muted ink `#52567A`, single subtle divider rule `#E4E6F0`, single Xenon Blue accent `#003DFF` strictly `< 3%` of viewport (`90–95%` neutral chrome).
  - **Type Triad:** `Sora` (headings, `-0.03em`, `text-wrap: balance`), `Inter` (UI/body), `JetBrains Mono` (`tabular-nums` for slots, opcodes, txids).
  - **Button Physics (`emil-design-eng`):** Explicit CSS transitions (zero `transition: all`), `cubic-bezier(0.23, 1, 0.32, 1)`, `transform: scale(0.97)` on `:active`.
  - **What We Take:** Cool slate-neutral precision, generous vertical breathing room (`40–64px` between blocks, `8–12px` inside), calm developer typography, clean `1px` row rules instead of nested boxes.
  - **What We Leave Behind:** Multi-level nested bordered boxes ("box soup"), saturated `#003DFF` floods across tiles/fibers/nav pills, uppercase tracked eyebrow labels, glowing borders, and competing primary buttons.
- **Strict Button Hierarchy Contract:**
  - **1 Filled Primary Button per View (No Icons Inside):** Only the contextual single primary CTA (`Open Forge Workspace` on `/`, `#btn-header-primary` on `/dashboard` — `#btn-forge-action` uses quiet outline/subtle styling when `#btn-header-primary` holds focus, or vice versa so never 2 filled buttons compete).
  - **Secondary Actions:** Neutral outline buttons.
  - **Destructive Actions:** Outline rose/red buttons.
- **Single Visual Driver for Phase 3:** **`unslop`** (9 passes in strict order: *spacing $\to$ color $\to$ icons $\to$ copy $\to$ type $\to$ layout $\to$ details $\to$ visuals $\to$ motion*) + **`emil-design-eng`** tactile polish + `mobile-native` / `web-design-guidelines` hygiene.
