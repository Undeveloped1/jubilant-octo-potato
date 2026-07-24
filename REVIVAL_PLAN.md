# Revival Plan — July 2026

Goal: turn the Feb 2026 prototype into the best knockoff-Tarkov zombie top-down web shooter — shareable, fast-loading, maintainable, and with its differentiator (the limb/med/mag simulation) made *visible and felt*.

Context: built Jan–Feb 2026 as a first-ever coding project. Tooling and AI asset workflows have improved dramatically since; this plan modernizes the project without a rewrite.

**Division of labor:** Phases 0, 2, 3, 4 are almost entirely agent-executable (Claude does the work, Paul reviews). Phases 1, 5, 6 need Paul's taste decisions (art direction, feel tuning) with the agent doing implementation.

---

## Phase 0 — Repo hygiene *(~1 hour, agent)*

- [x] Delete manual backup files: `game_backup_20250218.js`, `game_backup_pre_enemy_init.js`, `game_backup_pre_rerender_refactor_20250222.js`, `old-backup.js` (git history is the backup now — remote is wired to GitHub as of Jul 23, 2026, old main archived at `archive/pre-2026-02-24-main`)
- [x] Remove non-game files: `joe_system_prompt.txt`, `joe_system_prompt2.txt` (deleted — belonged to other projects)
- [x] Rename `game..html` → `index.html` (fixes typo; enables GitHub Pages auto-serve)
- [x] Add `.gitignore` (OS junk, editor scratch, future `node_modules/`, `dist/`)
- [x] Move scratch PNGs (`room_template_800x600_perimeter.png`, `sample_room_800x600.png`) out of repo root into `reference/` or delete
- [x] Commit + push

## Phase 1 — Art & asset pipeline *(the "world changed" phase; 1–2 sessions, Paul decides direction, agent implements)*

**Step 1: pick ONE art direction.** Current state mixes big AI-rendered sprites with procedural rectangles. Options, in rough order of recommendation:

1. **Curated free asset pack** (fastest to cohesive): Kenney (kenney.nl, CC0) or itch.io top-down shooter packs cover player/zombies/tiles/props/UI in one consistent style. Zero art skill needed, legally clean, looks "finished" immediately. ✅ **Chosen Jul 23, 2026** — Kenney Top-down Shooter wired in; see `ART_GUIDE.md`
2. **AI-generated pixel art, done right** (most custom): 2026 generators output transparent-background spritesheets with walk/attack frames at proper sizes (64–128px). Generate everything in one style prompt for consistency. Clean up in Aseprite (~$20) or LibreSprite (free).
3. **Hybrid**: asset pack for tiles/environment, AI-generate only hero characters and bosses in a matching palette.

**Step 2: crunch what exists regardless.** Current sprites are ~4–5MB each, RGB with **no alpha channel**, at 2048–2816px for characters drawn ~64px on screen. Total repo asset weight ~35MB.
- [x] Downscale all sprites to display size (≤256px)
- [x] Re-export with alpha (or key + re-export)
- [x] Pack into a spritesheet + JSON atlas (Phaser loads atlases natively) → `assets/sprites/sprites.png` + `sprites.json` (~345KB); crunch script at `tools/crunch_sprites.py`
- [x] Target: **all game assets under 1MB total** (Kenney install ~37KB under `assets/`; wired into `GameScene.preload`)

**Step 3: asset pipeline for the future.**
- [x] `assets/` folder structure (sprites, audio, tiles, ui)
- [x] Document the style recipe (palette, resolution, generator prompt if AI) in `ART_GUIDE.md` so every future asset matches

## Phase 2 — Ship a playable link *(~1 hour, agent)*

- [x] Enable GitHub Pages on `Undeveloped1/jubilant-octo-potato` (serve from `main`) — already on; `index.html` landed on `main` Jul 23, 2026
- [x] Verify the game runs from the Pages URL (CDN Phaser + relative paths) — https://undeveloped1.github.io/jubilant-octo-potato/ boots to main menu
- [ ] Hand the link to 3+ friends; watch at least one play without coaching — **Paul action**; sheet ready in `PLAYTEST.md`
- Playtest questions: Do they understand extraction? Do they find the inventory? Does the limb system register at all?

**This is the highest-information item in the whole plan.** Everything after it should be re-prioritized based on what playtesters actually stumble on.

## Phase 3 — Codebase modernization *(a weekend, incremental, agent; no rewrite)*

Current: single 18,900-line `game.js` (GameScene ~7,200 lines, HideoutScene ~4,700, 95 global helper functions). It works; it's just at its ceiling.

- [x] Add Vite (dev server + build; Phaser via npm) — `npm run dev` / `npm run build`; Pages Action `.github/workflows/pages.yml` (set Pages source to GitHub Actions)
- [x] Peel off modules in risk order — **data first, scenes last**:
  1. `src/config.js` — CONFIG + all tables (limb weights, outcome tables, loot pools, magazines, trader grids)
  2. `src/inventory.js` — the pure helper functions (mag/grid/pocket/stash logic). They're already well-factored; they just live in the wrong file
  3. `src/persistence.js` — save/load/settings
  4. `src/audio.js` — SoundManager
  5. Scenes one at a time, only when touching them anyway
- [x] Add Vitest; write tests for `inventory.js` as it's extracted. Bug history is dominated by inventory edge cases (mag placement priority, pocket `_spansFrom`, stash drops) — exactly what unit tests prevent recurring
- [x] Each extraction is one commit; game must boot after every commit

**Phase 3 result (Jul 24):** Module-level win only. `game.js` is still ~16.8k lines (HideoutScene ~5k, GameScene ~10k). Data/helpers peeled; scenes and inventory UI boundaries are still wrong — see Phase 8.

## Phase 4 — Save durability *(one evening, agent)*

- [ ] Add `version` field to the persistent save schema
- [ ] Migration ladder on load (`if (save.version < N) upgrade`) — `migrateToPhysicalMagazines` becomes migration #1 formally
- [ ] Corrupt-save guard: try/catch on load → offer export of raw blob instead of silent reset
- [ ] Keep export/import buttons; test a round-trip

## Phase 5 — Game-feel (juice) pass *(1–2 sessions, Paul tunes, agent implements)*

Content is sufficient (7 levels, 7 enemy types, full meta). What separates "prototype" from "game people share":
- [x] Screen shake scaled to weapon caliber; hitstop frames on kill (`CONFIG.JUICE`, `applyFireJuice`, `doHitstop`)
- [x] Enemy flinch/knockback on hit; corpse persistence (`becomeCorpse`, ~3.5s linger)
- [x] Tracers, shell casings, muzzle smoke (`ParticlePool` helpers)
- [x] Damage-direction indicator (already existed); low-blood heartbeat audio + desaturation (vignette + ColorMatrix + `sfx.heartbeat`)
- [x] Weapon-swap and reload sound weight (`sfx.weaponSwap`, mag-out / mag-in+rack on reload)

## Phase 6 — Make the limb sim VISIBLE (the differentiator) *(1–2 sessions)*

The depth exists but is invisible outside the combat log. Make it felt:
- [x] Blacked leg → limp (speed penalty already existed; added limp bob + limp footstep SFX)
- [x] Broken arm → weapon sway / slower reload animation cue (`ARM_SWAY_*`, "SLOW RELOAD...")
- [x] Bleeding → blood-droplet trail on the floor behind the player
- [x] Blood bar + infection system from DESIGN.md brainstorm (bite → ~90s infection vs extraction clear; blood drains on bleed ticks)
- [x] On-hit limb flash on the HUD body figure so hits teach the system passively (top-right silhouette)

## Phase 7 — Retention loop polish *(after playtest feedback)*

- [x] Insurance mechanic (pay scrap; mid-raid loot returns after ~3m if not scavenged) — Facilities INSURANCE card (Jul 2026)
- [x] Death recap screen: cause, limb, source, mid-raid loot (+ click/Space skip) (Jul 2026)
- [x] Run timer + extraction pressure surfaced in HUD (Jul 2026) — LV / clock / FIND KEY|EXIT|BEACON

### Infection treatment (DESIGN.md — shipped Jul 2026, not a numbered phase)

- [x] Antidote item (loot / trader consumable / limb-drop medical)
- [x] Hideout Med Bay (cure + blood refill for scrap)
- [ ] Super-infection / hero station (deferred to a later sprint)

## Phase 8 — Simplify at four altitudes *(post–Phase 3 review, Jul 24 2026)*

Goal: make the *software* better, not just prettier. Review the codebase at four altitudes; prefer fixing wrong abstractions over renaming inside god functions.

**Status after Phase 3**

| Altitude | Status |
|----------|--------|
| Line | Barely touched — duplication remains |
| Function | Barely touched — inventory still a mega-closure |
| Module | Partial win — config / inventory / persistence / audio peeled |
| Architecture | Still wrong — god file + prototype-shared inventory + leaky persistence |

### Architecture *(highest leverage — do first)*

The inventory system is not “one module used two places.” Hideout piggybacks on raid UI via `GameScene.prototype.renderInventoryPanel.call(this)` + `_invIsHideout`, then adds a second ~1.3k-line stash layer. Persistence is half-extracted (`persistence.js` exists but run saves still hit `localStorage` directly ~80+ times in `game.js`).

- [x] Extract **shared inventory UI + medical apply** used by both GameScene and HideoutScene — kill `_invIsHideout` / prototype piggyback (`src/invUi.js`, `src/invUiContext.js`, `src/medical.js`; Jul 24 2026)
- [ ] Route **all** save I/O through `persistence.js` (no raw `localStorage.setItem(CONFIG.SAVE_KEY, …)` in scenes)
- [ ] Split HideoutScene / GameScene into feature-sized modules only *after* the two items above (otherwise you just move the god object)

```
Better shape:  Raid / Hub scenes → shared InvUI → inventory domain (already in inventory.js)
```

### Module *(continue peeling, after architecture fixes)*

- [ ] Limb combat / outcome helpers out of `game.js` into something like `src/combat.js` (or keep with config if tiny)
- [ ] Challenges / achievements / upgrades out of free functions in `game.js`
- [ ] Enemy / Bullet / pools into `src/entities.js` (or similar) when touching combat anyway
- [ ] Hideout feature slices (trader, facilities, mission map, skills) as separate modules once inventory boundary is clean

### Function

- [ ] Collapse `renderInventoryPanel` mega-closure into named handlers (after shared InvUI extract)
- [x] Reduce `_invIsHideout` / drag-source branching; one code path per action (`invUiContext` mode + callbacks; Jul 24 2026)
- [ ] Deduplicate settings / export / god-mode between MainMenuScene and HideoutScene

### Line

- [x] Merge duplicate limb med-drop blocks into one helper (`src/medical.js` `applyMedicalItemToLimb`; Jul 24 2026)
- [ ] Remove duplicated save-field migration patches (Hideout create / GameScene create / `persistence.loadPersistent`)
- [ ] Delete obvious dead code when found during the above — no drive-by rewrites

**Rules for Phase 8:** no rewrite, no TypeScript, no engine change; each slice boots; prefer architecture fixes over cosmetic cleanup inside the 4k-line inventory panel.

---

## Sprint status — Jul 24, 2026

**Shipped:** Phases 0–3 (tech + Vite peels), 5–7, infection treatment.  
**Open (Paul):** playtest handoff (`PLAYTEST.md`); set Pages source to **GitHub Actions**.  
**Next agent work (pick):** Phase 8 architecture #2 (all save I/O through `persistence.js`) and/or Phase 4 (save versioning — pairs with #2).  
**Parked:** super-infection / hero station.

---

## Explicitly NOT doing

- No engine change, no rewrite, no TypeScript migration (revisit only if appetite exists after Phase 8)
- No new meta-progression systems (classes/skills/challenges are done enough)
- No multiplayer
- No new levels/enemies until the feel + visibility passes land
- No “prettify only” refactors that leave `_invIsHideout` / dual inventory UI in place

## Order of attack

**0 → 1 → 2 → playtest → re-rank.**  
**Maintainability track:** Phase 3 (done) → **Phase 8 architecture first** (shared InvUI + persistence) → Phase 4 save ladder (pairs well with persistence authority) → module/function/line cleanup.  
Phases 5–7 content/juice already shipped; don’t block playtest on Phase 8.

*Created Jul 23, 2026 — from project review after GitHub remote setup. Phase 8 added Jul 24, 2026 from four-altitude simplify review. Companion docs: ROADMAP.md (historical), HANDOVER.md (session state), DESIGN.md (design brainstorms).*
