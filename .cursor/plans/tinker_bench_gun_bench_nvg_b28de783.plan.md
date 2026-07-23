---
name: Tinker Bench Gun Bench NVG
overview: "Add Tinker Bench (electronic crafting: NVG as equippable item), make NVG an inventory/stash item in a real NVG slot, rename Armory to Gun Bench with Level 1 (9mm craft) and Level 2 (shells craft + upgrade for scrap)."
todos: []
isProject: false
---

# Tinker Bench, Gun Bench, and Equippable NVG

## Scope (your spec only)

- **Tinker Bench**: New facility for electronic crafting/repairs. Crafts NVG as an **item** (not a permanent upgrade).
- **NVG item**: New equippable for the NVG slot; not lootable; same in-game function (press N); can be in inventory or stash.
- **Armory → Gun Bench**: Rename; remove current NVG and ammo press. Add one craft button at level 1.
- **Gun Bench Level 1**: Craft 9mm — 4 rounds for 1 scrap, 90s.
- **Gun Bench Level 2**: Upgrade for scrap; adds second button — craft shells: 3 for 1 scrap, 90s.

---

## 1. Data and CONFIG

**New item (not lootable)**  

- In [game.js](game.js) `CONFIG.LOOT.INVENTORY_ITEMS`: add `nvg: { id: 'nvg', sizeW: 1, sizeH: 1, stackMax: 1, category: 'weapon' or new 'nvg', label: 'NVG', icon: 'NV' }`.
- Do **not** add `nvg` to `VALID_IDS` loot/level pools so it is never looted; only add to `VALID_IDS` (or equivalent) if needed for stash/inventory logic.
- Ensure stash and character panel can hold and display the item (same as other 1x1 items).

**Hideout state**  

- **Tinker Bench**: `stats.hideout.tinkerBench = { crafting: null }`. On finish, crafting produces one `nvg` **item** (e.g. into stash or a “Claim” that adds to stash). Reuse same timer pattern as current armory NVG (e.g. `CONFIG.TIMINGS.NVG_CRAFT` 90s). Cost: e.g. 3 scrap (keep current cost unless you change it).
- **Gun Bench**: Replace `armory` with `gunBench` (or keep key `armory` and rename only in UI). State: `level: 1 | 2`, `crafting: null | { itemId, count, finishTime }`. Level 1: one job type (9mm); level 2: two job types (9mm + shells). Add `CONFIG.HIDEOUT.GUN_BENCH` (or under existing HIDEOUT): level 2 upgrade cost (scrap), `CRAFT_9MM: { scrap: 1, itemId: 'ammo_9mm', count: 4, timeMs: 90000 }`, `CRAFT_SHELLS: { scrap: 1, itemId: 'ammo_shells', count: 3, timeMs: 90000 }`.

**NVG slot (equippable)**  

- Add `stats.armor.nvg = null | { itemId: 'nvg', ... }` (or a single equipped reference, e.g. `stats.equippedNvg: null | placementId` and item lives in stash/backpack). Simplest: treat like ears/head — `stats.armor.nvg` holds the equipped item (or null). Then in-game NVG toggle uses “is NVG equipped?” (e.g. `stats.armor.nvg` or item in NVG slot) instead of `stats.hideout.armory.hasNVG`.

**Migration**  

- Old saves: if `armory.hasNVG === true`, grant one `nvg` item into stash (or equip to new NVG slot) so no one loses NVG. Clear `armory.hasNVG` and `armory.crafting` (or remove armory when renaming to gunBench).

---

## 2. Tinker Bench facility card

- In [game.js](game.js) `renderFacilitiesTab()` (~5096): add a new card, e.g. Row 2 third slot or new row: **Tinker Bench**.
- `createTinkerBenchFacilityCard(x, y, w, h)`:
  - Title: "TINKER BENCH" (or "ELECTRONICS" if you prefer; you said Tinker Bench).
  - Single craft: **NVG** — cost 3 scrap, 90s timer (reuse `CONFIG.TIMINGS.NVG_CRAFT`).
  - On completion: **Claim** adds one `nvg` item to `persistent.stash` (e.g. `tryAddItem(this.persistent.stash, 'nvg', 1)`), then clear `tinkerBench.crafting`.
  - No “permanent upgrade” — no `hasNVG`; everything is item-based.
- Default state: `hideout.tinkerBench = { crafting: null }`. Timer logic in scene `update()` (same pattern as current armory timer).

---

## 3. NVG as equippable item (slot + in-game)

**Character panel (hideout)**  

- **NVG slot zone**: The NVG box is already drawn at `bodyCenterX`, `nvgY` (~11062–11064). Add an entry to `armorSlotZones` for `id: 'nvg'` with bounds derived from that position (same `accBoxW`/`accBoxH` as ears). Expose `nvgSlot` in `_hideoutContainerBounds` (same way as `bodySlot`, `earsSlot`).
- **Drag to NVG slot**: On stash/panel pointerup, if drop hits `nvgSlot` and `drag.itemId === 'nvg'`, equip to NVG slot (set `stats.armor.nvg = { itemId: 'nvg', ... }` or store reference), remove from stash/backpack.
- **Drag from NVG slot**: NVG slot must be a draggable source (like head/body/ears). On pointerdown, if `stats.armor.nvg`, start drag; on drop to stash/backpack/container, remove from slot and add to target.
- **Display**: Draw NVG slot content like ears — show "NVG" or "EMPTY" (and optional durability if you add it later) using `stats.armor.nvg`.

**In-game (Game scene)**  

- Replace all `this.playerStats.hideout.armory.hasNVG` with “NVG equipped” check, e.g. `hasEquippedNvg(this.playerStats)` where `hasEquippedNvg(stats) => stats.armor && stats.armor.nvg` (or equivalent).
- References: [game.js](game.js) ~16342–16356 (toggle), ~18273 (lighting/visibility). No other logic change for NVG behavior (same green overlay, same key).

---

## 4. Armory → Gun Bench (rename + new behavior)

- **Rename**: All UI and comments: "ARMORY" → "Gun Bench". Optionally rename state key `armory` → `gunBench` (with migration for old saves).
- **Remove** from current Armory card:
  - NVG craft and `hasNVG` (moved to Tinker Bench and to item).
  - Instant "AMMO PRESS (1 SCRAP = 4 AMMO)" (replace with timed 9mm at level 1).
- **Gun Bench card** (`createGunBenchFacilityCard` or renamed `createArmoryFacilityCard`):
  - **Level 1**: Show level; one button: **Craft 9mm** — 1 scrap → 4× `ammo_9mm`, 90s. Start job `gunBench.crafting = { itemId: 'ammo_9mm', count: 4, finishTime: Date.now() + 90000 }`. When time reached, show "Claim"; on click, `tryAddItem(this.persistent.stash, 'ammo_9mm', 4)`, clear `crafting`, update UI.
  - **Level 2**: Upgrade button (cost from CONFIG, scrap). After upgrade, same 9mm button plus second button: **Craft Shells** — 1 scrap → 3× `ammo_shells`, 90s. Same job/claim pattern.
- **Timer**: In scene `update()`, drive Gun Bench timer (and Tinker Bench timer); refresh card labels (e.g. "CRAFTING...", "CLAIM 9MM", "CLAIM SHELLS").
- **State**: `gunBench: { level: 1, crafting: null }` (or `level: 2`). One job at a time (either 9mm or shells). Default for new saves: level 1. Migration: if old `armory` existed, set `gunBench.level = 1`, `gunBench.crafting = null`, and handle `armory.hasNVG` as above.

---

## 5. Implementation order (concise)

1. **CONFIG**: Add `nvg` to `INVENTORY_ITEMS` and any list needed for stash; add `GUN_BENCH` (or under HIDEOUT) level cost + 9mm/shells recipes (scrap, itemId, count, timeMs). Keep `TIMINGS.NVG_CRAFT` for Tinker Bench.
2. **Default state + migration**: `hideout.tinkerBench`, `hideout.gunBench` (or keep `armory` key with new semantics); `stats.armor.nvg`; migrate old `armory.hasNVG` → one `nvg` item or equipped.
3. **Tinker Bench card**: New facility + timer; craft NVG → claim adds `nvg` to stash.
4. **NVG slot**: Add `nvg` to `armorSlotZones` and `_hideoutContainerBounds.nvgSlot`; equip/drag-from logic for `itemId === 'nvg'`; panel display for `stats.armor.nvg`.
5. **Game scene**: Replace `hideout.armory.hasNVG` with “equipped NVG” (e.g. `stats.armor.nvg`).
6. **Gun Bench card**: Rename Armory → Gun Bench; remove NVG and instant ammo; add level 1 (9mm craft 90s), level 2 (upgrade + shells craft 90s); single active job; timer in `update()`.

---

## 6. Files and key locations

- **All logic**: [game.js](game.js).
- **Facilities**: `renderFacilitiesTab` ~5096; `createArmoryFacilityCard` ~5196 (rename/rewrite to Gun Bench); new `createTinkerBenchFacilityCard`; `update()` timer ~9130 (armory → add tinkerBench + gunBench).
- **CONFIG**: ~256 (TIMINGS), ~312 (INVENTORY_ITEMS), ~384 (HIDEOUT).
- **Default stats**: ~1261 (hideout), ~1254 (armor); add `armor.nvg`, `hideout.tinkerBench`, `hideout.gunBench` (or keep armory key).
- **Inventory panel**: `armorSlotZones` ~~11341 (add `nvg` zone); bounds ~11823 (add `nvgSlot`); pointerup stash/panel drop handling for nvg slot (~~6526–6532 style for body/ears); drag-from-slot for NVG (same pattern as head/body/ears).
- **Game scene**: NVG check ~16342, ~18273.

This keeps the previous plan only as context (layout, CONFIG patterns, zone/bounds usage) and implements only: Tinker Bench, NVG as item in NVG slot, Gun Bench with two levels and two crafts as specified.