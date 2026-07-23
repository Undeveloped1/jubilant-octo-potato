# Inventory & Weapons Overhaul — Piece-by-Piece Implementation

Each piece is **small**, **independently testable**, and **easy to revert** (single concern; optional backup before each piece). Implement in order; only proceed to the next piece after the current one is tested and stable.

**Progress:** Pieces 1.1–1.6 done. **1.6 Secure container:** 2×3 grid, SEC slot left of backpack, `ensureSecureContainerStats()` on load; drag/drop + R rotate; persist to stash on death/exit not yet in. **Layout:** Primary weapon at top (`primarySlotY = 85`); block (rig, pockets, backpack, secure) 8px below, `invGridY = 205` fixed; no INVENTORY title. Weapon slots disconnected: secondary at `secondarySlotYRef - 5`, sidearm 2×2 left of body (15px left of abdomen/crotch), melee 1×4 strip right of backpack (8px gap). Rig/pockets/backpack spacing unchanged. **Next:** Piece 1.7 (med bag).

---

## Revert strategy (every piece)

- **Before starting a piece:** Create a backup (e.g. `game_backup_pre_<piece>.js` or commit).
- **Revert:** Restore that backup or revert the commit. No mixed changes in one slice.
- **Test:** Run the game, follow the "Test" steps for that piece; confirm no regressions.

---

## Phase 1: Inventory page (in order)

### Piece 1.1 — Pockets: data only

**Scope:** Add `playerStats.pockets` (e.g. 4 slots: `[{ itemId, count } | null, ...]`). No UI behavior change yet.

**Changes:**

- In `game.js`: add `pockets: [null, null, null, null]` (or equivalent) to `DEFAULT_STATS` and any run-stats init (e.g. `getStartingStats`, Hideout CONTINUE migration).
- In `loadPersistent` / run load: ensure `pockets` exists and has length 4; default missing to `null`.
- Do **not** wire pockets to UI or drag/drop yet.

**Test:** New run and loaded save both have `playerStats.pockets` of length 4; no console errors; existing inventory/rig/backpack unchanged.

**Revert:** Remove `pockets` from DEFAULT_STATS and load paths only.

---

### Piece 1.2 — Pockets: UI and drag/drop

**Scope:** Make the four pocket boxes interactive: show contents, drag from pocket, drop onto pocket (and optionally backpack/rig).

**Changes:**

- In `renderInventoryPanel()`: build pocket **zones** (left/top/right/bottom) for each of the 4 slots; add to the same pointer/drag system used for backpack/rig.
- On drag start: if over a pocket slot with item, set `invDragging` with `fromPocket: true` and pocket index.
- On drop: if over pocket slot (empty or swap), place/swap item in `playerStats.pockets[i]`. Enforce 1x1 or small items only (e.g. by CONFIG or size).
- Draw pocket contents (icon or label) from `playerStats.pockets[i]`.

**Test:** Open inventory; drag item from backpack to pocket, pocket to backpack, pocket to pocket; close/reopen inventory and confirm state. No regression on rig/backpack drag.

**Revert:** Remove pocket zones and pocket handling from drag/drop; leave pockets as visual-only again (Piece 1.1 data can stay).

---

### Piece 1.3 — Rig persistence (bugfix)

**Scope:** Fix equipped rig and its contents not persisting on level transition/death.

**Changes:**

- Find where run state is passed to the next scene (e.g. on level complete, death, exit). Ensure `rigGrid` and `armor.rig` (and `rigInventories` for equipped rig, if stored there) are included in the payload and restored in the next scene’s init.
- If run state is saved to localStorage on transition, include rig + rig contents in that save and reload.

**Test:** Equip rig, put items in rig, complete level or die; reload into next level or hideout. Rig and contents should still be there.

**Revert:** Revert the persistence payload and restore logic only.

---

### Piece 1.4 — Backpack as equippable: data model

**Scope:** Introduce “equipped backpack” and backpack inner grids keyed by container, without changing behavior yet.

**Changes:**

- Add CONFIG entries for backpack item(s) (e.g. `backpack_default` 6x9). Add to VALID_IDS, INVENTORY_ITEMS.
- Add `playerStats.equippedBackpack` (e.g. `null` or `{ itemId, placementId }`) and `playerStats.backpackInventories` (keyed by `'equipped'` or by placementId when in stash). When `equippedBackpack` is set, `playerStats.backpack` is the grid for that backpack (either reference into `backpackInventories['equipped']` or keep `backpack` as the active grid and sync size from equipped item).
- Default: on new run, “equip” default backpack so `playerStats.backpack` remains 6x9 and behavior unchanged. Migration: existing saves get default backpack equipped and current `backpack` contents moved into `backpackInventories['equipped']`.

**Test:** New run and loaded save: backpack still 6x9, all loot and drag/drop work as before. No UI change yet.

**Revert:** Remove `equippedBackpack`, `backpackInventories`, and CONFIG backpack item; restore single `backpack` grid only.

---

### Piece 1.5 — Backpack as equippable: UI and equip/unequip

**Scope:** Add a backpack slot to the inventory UI; allow equipping a backpack from stash/ground and unequipping to stash/ground (with contents).

**Changes:**

- In `renderInventoryPanel()`: add a “BACKPACK” slot (e.g. near rig). Draw equipped backpack icon/label.
- Drag backpack item from stash/backpack onto slot → equip (set `equippedBackpack`, set `playerStats.backpack` to that container’s grid, resize grid to item’s size).
- Drag from backpack slot to stash/ground → unequip (contents must move to stash or another container, or forbid if not in hideout). When unequipping, store grid in `backpackInventories[placementId]`.
- If no backpack equipped, loot that would go to backpack: either go to pockets only or show “no backpack” message (define one behavior).

**Test:** Equip/unequip backpack; put items in backpack; unequip and confirm contents in stash; re-equip and see same contents. In-run: loot still fills backpack when equipped.

**Revert:** Remove backpack slot from UI and equip/unequip logic; keep Piece 1.4 data model so reverting is just UI + flow.

---

### Piece 1.6 — Secure container: data and one slot

**Scope:** Add secure container as an equippable slot; contents persisted to stash on death/run end.

**Changes:**

- CONFIG: new item e.g. `secure_container` (2x2 or 4x4 inner grid). New slot: `playerStats.equippedSecureContainer` and `playerStats.secureContainerInventories` (keyed like rig).
- On run end (death, extract, exit): copy `secureContainerInventories` (or equipped secure grid) into persistent stash (or “recovered” area). Implement in the same place where run state is cleared or passed.
- UI: one “Secure” slot in inventory; equip/unequip from stash/ground; open container (double-click or button) to show inner grid; drag in/out like rig.

**Test:** Equip secure container, put items in, die or extract; items appear in hideout stash. Equip/unequip and drag in/out work.

**Revert:** Remove secure container CONFIG, slot, inventories, and persistence block only.

---

### Piece 1.7 — Med bag: data and one slot

**Scope:** Add med bag as equippable slot; medical-only contents; persisted on death like secure container.

**Changes:**

- CONFIG: new item `med_bag` with inner grid (e.g. 2x2). New slot: `playerStats.equippedMedBag`, `playerStats.medBagInventories`.
- Restrict inner grid to medical items only (reuse `isMedicalItem` or category check in `tryAddItem`/place logic for med bag).
- On run end: copy med bag contents to persistent stash (or medical stash).
- UI: “Med bag” slot; equip/unequip; open and drag medical items only in/out.

**Test:** Equip med bag, add only medical items; add non-medical and confirm it’s rejected. Die/extract; medical items in stash. Re-equip and use items in-run.

**Revert:** Remove med bag CONFIG, slot, inventories, and persistence only.

---

## Phase 2: UI reorg (in order)

### Piece 2.1 — Move weapon slots under inventory block

**Scope:** Relayout only: move primary/secondary/sidearm/melee slots so they sit clearly below the main inventory (pockets, rig, backpack).

**Changes:**

- In `renderInventoryPanel()`, adjust `weaponRowY` / `weaponRow2Y` (and any related positions) so the weapon row is below the backpack grid and any new slots. Ensure weapon slot zones and labels move with them.

**Test:** Open inventory; weapon slots are below backpack; drag to/from weapon slots still works; no overlap or clipping.

**Revert:** Restore previous `weaponRowY`/`weaponRow2Y` values.

---

### Piece 2.2 — Grenade section

**Scope:** Dedicated grenade area (e.g. 3 slots or one row for MAX_CARRY); display and optional drag to/from backpack.

**Changes:**

- Add a “GRENADES” section (e.g. row of cells or icons). Show `playerStats.grenades` count; optionally allow drag from backpack (grenade item) to fill slots and from slots to backpack. If keeping single count, section is display-only and maybe “fill” from backpack on pickup.

**Test:** Grenades show in new section; count matches; if drag is implemented, moving grenades to/from backpack updates count and section.

**Revert:** Remove grenade section UI and any new drag logic; restore previous grenade display (e.g. in stats box only).

---

### Piece 2.3 — Key item section

**Scope:** Dedicated area for key, map, plug, molotov (hasKey, hasMap, hasSparkPlug, hasMolotov).

**Changes:**

- Add “Key items” or “Keys” section with icons/labels for key, map, plug, molotov; read state from `playerStats` / `hasKey` etc. Optional: allow drop to stash/ground in hideout.

**Test:** Key items appear when obtained; state correct after level change. No regression on door/key logic.

**Revert:** Remove key item section only.

---

## Phase 3: Weapon pool and equip/drop/store

### Piece 3.1 — Limit usable weapons to slots only

**Scope:** Enforce that only weapons in the four weapon slots are usable in-mission (firing, reload, melee).

**Changes:**

- Where `currentWeapon` is used or where “hasWeapon” is checked for firing, ensure the source is `weaponSlots.primary/secondary/sidearm/melee` only. Remove or derive any `hasRifle`/`hasSMG` usage for combat so that only slot contents matter.
- Ensure switching weapon only allows selecting from the four slots.

**Test:** Put a weapon only in backpack (not in a slot); confirm it cannot be selected or fired. Put it in a slot; confirm it can. No regression when all weapons are in slots.

**Revert:** Restore previous “hasWeapon”/currentWeapon logic that could use backpack.

---

### Piece 3.2 — Drop weapon to ground / store in stash

**Scope:** Explicit drop to ground from weapon slot; in Hideout, store from slot to stash.

**Changes:**

- When dragging from a weapon slot: on drop over “ground” or Delete key, remove weapon from slot and spawn dropped item in world (or add to scene’s dropped items). In Hideout, drop over stash → remove from slot and add to stash.

**Test:** In-run: unequip to backpack still works; new: drop from slot to ground, pick up again. In Hideout: drag from weapon slot to stash and confirm it stores.

**Revert:** Remove drop-to-ground and stash-from-slot handling only.

---

## Phase 4: Attachment boxes on weapon outlines

### Piece 4.1 — Weapon outline UI with attachment slots

**Scope:** Draw weapon outlines (e.g. for primary, secondary, sidearm) with two attachment boxes each; no drag yet.

**Changes:**

- In inventory (or gear view), add a small “weapon” area per equipped weapon with two boxes (matching `equippedMods[weapon][0]` and `[1]`). Display current mod name/icon in each box. No interaction yet.

**Test:** Open inventory; see weapon outlines and attachment boxes; current mods show correctly. No regression.

**Revert:** Remove the new weapon outline and attachment box graphics only.

---

### Piece 4.2 — Attach/detach mods in-run via drag

**Scope:** Drag mod from mod inventory (or backpack) onto attachment box; drag from box to unequip. Update `equippedMods` and existing mod effect logic.

**Changes:**

- Add attachment box zones to pointer/drag logic. On drop onto box: if item is a mod and compatible, set `equippedMods[weapon][slot]`, remove from mod inventory (or backpack). On drag from box: clear slot, add mod back to mod inventory or backpack.
- Reuse existing weapon mod effect code (mag size, damage, etc.) so effects apply immediately.

**Test:** Equip/unequip mods via new UI; fire weapon and confirm mod effects (e.g. mag size). Save/load run and confirm mods persist.

**Revert:** Remove drag/drop for attachment boxes only; keep outline display (Piece 4.1) or revert that too.

---

## Phase 5: Ammo types and magazines (later)

### Piece 5.1 — Per-weapon ammo types (data + CONFIG)

**Scope:** Introduce ammo types (e.g. ammo_pistol, ammo_rifle, ammo_shotgun, ammo_smg, ammo_crossbow); reserve count per type; no magazine items yet.

**Changes:**

- CONFIG: AMMO_TYPES or per-weapon ammo id; update LOOT/VALID_IDS and applyLoot to handle each type. Replace single `ammo` reserve with per-type reserves (e.g. `playerStats.ammoReserve: { pistol: 0, rifle: 0, ... }` or keep `countItemInGrid(..., 'ammo_rifle')` etc.).
- Reload: consume from correct ammo type for current weapon.

**Test:** Pick up rifle ammo and pistol ammo; fire and reload; only correct type is consumed. No regression for existing “ammo” if migrated.

**Revert:** Remove ammo type CONFIG and reserve logic; restore single ammo type.

---

### Piece 5.2 — Magazines or loose ammo (optional)

**Scope:** Either magazine items (swap mag) or loose ammo stacks consumed on reload. Shotgun/bolt action (later) follow same pattern.

**Changes:** Define in a later plan slice (e.g. magazine item vs loose; UI for mag slot). Defer until 5.1 is stable.

---

## Summary table

| Piece | Name                         | Test focus                    | Revert focus              |
|-------|------------------------------|-------------------------------|---------------------------|
| 1.1   | Pockets data                 | pockets array exists, no break| Remove pockets from init  |
| 1.2   | Pockets UI + drag            | Drag pocket ↔ backpack        | Remove pocket zones only   |
| 1.3   | Rig persistence              | Rig survives level/death      | Revert persistence payload|
| 1.4   | Backpack equippable (data)   | Backpack still works same     | Remove backpack model     |
| 1.5   | Backpack equip/unequip UI    | Equip/unequip + contents      | Remove slot + flow        |
| 1.6   | Secure container             | Equip, fill, persist on death | Remove slot + persist     |
| 1.7   | Med bag                      | Medical-only, persist         | Remove slot + persist     |
| 2.1   | Weapon slots under inv       | Layout only                   | Restore Y positions       |
| 2.2   | Grenade section              | Display/drag grenades         | Remove section            |
| 2.3   | Key item section             | Display key/map/plug/molotov   | Remove section            |
| 3.1   | Weapon pool = slots only     | Only slotted weapons usable   | Restore hasWeapon logic   |
| 3.2   | Drop/store from weapon slot  | Drop to ground, stash         | Remove drop/store paths   |
| 4.1   | Weapon outline + mod boxes   | Visual only                   | Remove graphics           |
| 4.2   | Mod drag on outlines         | Equip/unequip mods in-run     | Remove mod drag           |
| 5.1   | Ammo types                   | Per-weapon ammo consume       | Restore single ammo       |
| 5.2   | Magazines (later)            | TBD                           | TBD                       |

Implement in order; after each piece, run its test and optionally backup before the next. This keeps each change small and reversible.
