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

1. **Curated free asset pack** (fastest to cohesive): Kenney (kenney.nl, CC0) or itch.io top-down shooter packs cover player/zombies/tiles/props/UI in one consistent style. Zero art skill needed, legally clean, looks "finished" immediately.
2. **AI-generated pixel art, done right** (most custom): 2026 generators output transparent-background spritesheets with walk/attack frames at proper sizes (64–128px). Generate everything in one style prompt for consistency. Clean up in Aseprite (~$20) or LibreSprite (free).
3. **Hybrid**: asset pack for tiles/environment, AI-generate only hero characters and bosses in a matching palette.

**Step 2: crunch what exists regardless.** Current sprites are ~4–5MB each, RGB with **no alpha channel**, at 2048–2816px for characters drawn ~64px on screen. Total repo asset weight ~35MB.
- [x] Downscale all sprites to display size (≤256px)
- [x] Re-export with alpha (or key + re-export)
- [x] Pack into a spritesheet + JSON atlas (Phaser loads atlases natively) → `assets/sprites/sprites.png` + `sprites.json` (~345KB); crunch script at `tools/crunch_sprites.py`
- [x] Target: **all game assets under 1MB total** (runtime atlas ~345KB; root giants removed — game still uses procedural textures until Step 1 art direction is picked and atlas is wired)

**Step 3: asset pipeline for the future.**
- [x] `assets/` folder structure (sprites, audio, tiles, ui)
- [ ] Document the style recipe (palette, resolution, generator prompt if AI) in `ART_GUIDE.md` so every future asset matches *(blocked on Step 1 art direction)*

## Phase 2 — Ship a playable link *(~1 hour, agent)*

- [ ] Enable GitHub Pages on `Undeveloped1/jubilant-octo-potato` (serve from `main`)
- [ ] Verify the game runs from the Pages URL (CDN Phaser + relative paths)
- [ ] Hand the link to 3+ friends; watch at least one play without coaching
- Playtest questions: Do they understand extraction? Do they find the inventory? Does the limb system register at all?

**This is the highest-information item in the whole plan.** Everything after it should be re-prioritized based on what playtesters actually stumble on.

## Phase 3 — Codebase modernization *(a weekend, incremental, agent; no rewrite)*

Current: single 18,900-line `game.js` (GameScene ~7,200 lines, HideoutScene ~4,700, 95 global helper functions). It works; it's just at its ceiling.

- [ ] Add Vite (dev server + build; also fixes CDN dependency by bundling Phaser via npm)
- [ ] Peel off modules in risk order — **data first, scenes last**:
  1. `src/config.js` — CONFIG + all tables (limb weights, outcome tables, loot pools, magazines, trader grids)
  2. `src/inventory.js` — the pure helper functions (mag/grid/pocket/stash logic). They're already well-factored; they just live in the wrong file
  3. `src/persistence.js` — save/load/settings
  4. `src/audio.js` — SoundManager
  5. Scenes one at a time, only when touching them anyway
- [ ] Add Vitest; write tests for `inventory.js` as it's extracted. Bug history is dominated by inventory edge cases (mag placement priority, pocket `_spansFrom`, stash drops) — exactly what unit tests prevent recurring
- [ ] Each extraction is one commit; game must boot after every commit

## Phase 4 — Save durability *(one evening, agent)*

- [ ] Add `version` field to the persistent save schema
- [ ] Migration ladder on load (`if (save.version < N) upgrade`) — `migrateToPhysicalMagazines` becomes migration #1 formally
- [ ] Corrupt-save guard: try/catch on load → offer export of raw blob instead of silent reset
- [ ] Keep export/import buttons; test a round-trip

## Phase 5 — Game-feel (juice) pass *(1–2 sessions, Paul tunes, agent implements)*

Content is sufficient (7 levels, 7 enemy types, full meta). What separates "prototype" from "game people share":
- [ ] Screen shake scaled to weapon caliber; hitstop frames on kill
- [ ] Enemy flinch/knockback on hit; corpse persistence
- [ ] Tracers, shell casings, muzzle smoke
- [ ] Damage-direction indicator; low-blood heartbeat audio + desaturation
- [ ] Weapon-swap and reload sound weight (mag-out, mag-in, rack — already have procedural SFX base)

## Phase 6 — Make the limb sim VISIBLE (the differentiator) *(1–2 sessions)*

The depth exists but is invisible outside the combat log. Make it felt:
- [ ] Blacked leg → limp (speed penalty already exists? make it *animated/audible*)
- [ ] Broken arm → weapon sway / slower reload animation cue
- [ ] Bleeding → blood-droplet trail on the floor behind the player
- [ ] Blood bar + infection system from DESIGN.md brainstorm (bite → infection timer vs extraction = core Tarkov-style tension; lore already written)
- [ ] On-hit limb flash on the HUD body figure so hits teach the system passively

## Phase 7 — Retention loop polish *(after playtest feedback)*

- [ ] Insurance mechanic (pay scrap; gear lost on death returns after N minutes if "not scavenged") — cheap to build, creates push-your-luck
- [ ] Death recap screen: what killed you, which limb, what you lost (Tarkov's post-raid screen is a retention feature)
- [ ] Run timer + extraction pressure surfaced in HUD

---

## Explicitly NOT doing

- No engine change, no rewrite, no TypeScript migration (revisit only if Phase 3 goes smoothly and appetite exists)
- No new meta-progression systems (classes/skills/challenges are done enough)
- No multiplayer
- No new levels/enemies until the feel + visibility passes land

## Order of attack

**0 → 1(step 2 crunch) → 2 → playtest → re-rank the rest.** Phases 3–4 can interleave anytime (agent work, low risk). Phases 5–6 after playtest data says which matters more.

*Created Jul 23, 2026 — from project review after GitHub remote setup. Companion docs: ROADMAP.md (historical), HANDOVER.md (session state), DESIGN.md (design brainstorms).*
