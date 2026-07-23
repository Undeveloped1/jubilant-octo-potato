---
name: Inventory and weapons overhaul
overview: Phased plan to finish the inventory page (pockets, equippable backpack, secure container, med bag), reorganize UI (weapons under inventory, grenade/key sections), enforce weapon-on-person pool and equip/drop/store, add in-game attachment boxes on weapon outlines, and implement per-weapon ammo types with magazines/loose ammo.
todos: []
isProject: false
---

# Inventory and Weapons Overhaul

## Current state (reference)

- **Inventory panel:** [game.js](game.js) `renderInventoryPanel()` (~line 9280+). Layout: left = body (armor slots, gear/health view), right = POCKETS (4 boxes, UI only – no data or drag), rig (if equipped), BACKPACK (6x9 grid), weapon slots at bottom (primary/secondary/sidearm/melee at ~line 9992), stats box.
- **Data:** Run state uses `playerStats.backpack` (single 6x9 grid), `playerStats.rigGrid` (4x2 when rig equipped), `playerStats.weaponSlots`, `playerStats.armor` (head, body, ears, arms, feet, rig). Pockets have no `playerStats.pockets` – only drawn. Rig contents: `rigInventories['backpack_'+placementId]` or `rigGrid` when equipped.
- **Containers:** `ammo_box` (2x2, 6x6 inner, ammo only), `rig` (4x4, 4x2 inner); `getOrCreateAmmoBoxInventory`, `getOrCreateRigInventory` in [game.js](game.js) ~2039–2063.
- **Weapon mods:** `persistent.modInventory` (owned mod IDs), `stats.equippedMods[weapon][slot]` (2 slots per weapon); Hideout has mod equip UI; in-run inventory has weapon slot labels but no attachment boxes on weapon outlines.
- **Ammo:** Single `ammo` item type; `magazines[weapon]` = current mag count; reserve = `countItemInGrid(backpack, 'ammo')`. No per-weapon ammo types or magazine items yet.
- **Known issue (HANDOVER):** Equipped rig and its contents are not persisted on level transition/death – fix when touching rig/save flow.

---

## Phase 1: Finish inventory page (pockets, equippable backpack, secure container, med bag)

### 1.1 Pockets (functional)

- **Data:** Add `playerStats.pockets` (e.g. array of 4 slots: `[null, null, null, null]` or `[{ itemId, count }, ...]`). Match DEFAULT_STATS / getStartingStats / loadPersistent and run migration.
- **UI:** Pockets already drawn at `pocketY`, `pocketXs` (4 rectangles). Add pocket zones to the drag/drop system in `renderInventoryPanel`: hit-test, drag from pocket, drop onto pocket (and backpack/rig/ground). Restrict pocket slots to 1x1 small items (or by CONFIG).
- **Logic:** Pickup/loot can fill pockets first (optional) or only backpack/rig; allow move between pockets and backpack/rig via drag. Ensure `ensureGridItems`-style init for any pocket array.

### 1.2 Backpack as equippable item

- **Model:** Backpack becomes an equippable “container” like rig. Options:
  - **Option A:** Add `armor.backpack` (or a dedicated `equippedBackpack`). Backpack items in CONFIG (e.g. `backpack_small` 6x9, `backpack_large` 8x10). When equipped, `playerStats.backpack` is the inner grid of that equipped item (keyed by placementId or “equipped”).
  - **Option B:** Keep `playerStats.backpack` as the main grid but add an equippable “backpack” slot; the equipped item defines size (gridW/gridH) and the grid is still `playerStats.backpack` (resize on equip/unequip).
- **Data:** Store backpack inner grid in `playerStats.backpackInventories` (like rigInventories) when backpack is in stash; when equipped, use `playerStats.backpack` as the active grid and size from equipped item. DEFAULT_STATS and run start: give a default backpack (e.g. 6x9) equipped.
- **UI:** Backpack “slot” on body or next to rig (e.g. “BACKPACK” with icon/size). Drag backpack item from stash/ground onto slot to equip; drag from slot to stash/ground to unequip (contents must go to stash or another container). Resize backpack grid when switching.
- **Loot/applyLoot:** Continue to add to `playerStats.backpack` when backpack equipped; if no backpack equipped, add to pockets or drop (define fallback).

### 1.3 Secure container (equippable, persisted on death)

- **New slot:** e.g. `armor.secureContainer` or `playerStats.secureContainer` (equipped container item). New item type(s) in CONFIG (e.g. `secure_container_2x2` with 2x2 or 4x4 inner grid).
- **Inner grid:** Reuse same pattern as rig/ammo_box: `playerStats.secureContainerInventories` (or one grid when equipped). When equipped, one active grid; when in stash, keyed by placementId.
- **Death/level end:** On run end (death, extract, exit), copy secure container contents to persistent stash (or a dedicated “recovered” stash). HANDOVER: ensure run state is saved/restored on transition; add explicit “persist secure container to stash” in the same path.

### 1.4 Med bag (equippable, medical-only, persisted on death)

- **New slot:** e.g. `armor.medBag` or `playerStats.medBag`. New item type `med_bag` (or variants) in CONFIG with inner grid (e.g. 2x2 or 3x2).
- **Restriction:** Only medical category items can be placed (reuse `isMedicalItem` or CONFIG category). `tryAddItem`-style check when adding to med bag grid.
- **Persistence:** Same as secure container – on death/run end, contents go to persistent stash (or medical stash).

### 1.5 Rig persistence fix

- While touching run state: fix rig + rig contents not persisting on level transition (HANDOVER). Ensure `rigGrid` and `armor.rig` (and rig contents) are in the payload passed to next scene and restored.

---

## Phase 2: UI reorg – weapons under inventory, grenade section, key item section

- **Layout:** In `renderInventoryPanel()`, group “inventory” as one block (pockets, rig, backpack, secure, med bag). Move weapon slots (primary/secondary/sidearm/melee) **below** this block so they are clearly “under” the inventory section (adjust `weaponRowY` / `weaponRow2Y` and any vertical offsets).
- **Grenade section:** Dedicated area for grenades (e.g. 3 slots or one row of cells matching CONFIG.GRENADE.MAX_CARRY). Show count; allow drag from backpack to grenade slots and back. Use grenade slots as “equipped” grenades for throw (optional: or keep single count and this is just visual).
- **Key item section:** Dedicated area for key, map, plug, molotov (hasKey, hasMap, hasSparkPlug, hasMolotov). Read-only display or allow move to stash/backpack when in hideout. In-run: show state; optionally allow drop to ground.

---

## Phase 3: Primary/secondary weapon – equip, drop, store, limit pool

- **Equip / drop / store (already partly there):** Keep drag from backpack to primary/secondary/sidearm; unequip to backpack; add explicit “drop to ground” when dragging from weapon slot (Delete or drop zone). In Hideout, “store” = move from weapon slot to stash (reuse stash drag logic).
- **Limit pool to on-person:** Enforce that only weapons in the four weapon slots (primary, secondary, sidearm, melee) are usable in-mission. `currentWeapon` must be one of the four; firing/reload uses only those. Weapons in backpack/pockets are not usable until equipped to a slot. Update any code that checks “hasRifle” etc. to derive from `weaponSlots` instead of separate flags if desired (or keep flags in sync when equipping).
- **Validation:** When equipping a weapon to a slot, validate type (primary/secondary = long gun, sidearm = pistol). Ensure ammo display and magazine state stay correct when swapping weapons.

---

## Phase 4: Attachment boxes on weapon outlines (in-run)

- **Weapon outlines:** In inventory (or dedicated weapon tab), draw one outline per equipped weapon (primary, secondary, sidearm) with attachment slots (2 per weapon, matching `equippedMods`). Reuse CONFIG.MODS and compatibility rules.
- **Drag/drop:** Mods from `persistent.modInventory` (or from backpack if mods are grid items) can be dragged onto attachment boxes; swap, unequip to mod inventory/backpack, drop to ground. In-run: only allow if UI is open (inventory open). Apply `stats.equippedMods[weapon][slot]` and existing weapon mod effect logic (mag size, damage, etc.).
- **Persistence:** `equippedMods` is already in run state; ensure it’s saved/restored with level transition and stash.

---

## Phase 5: Ammo types and magazines / loose ammo

- **Ammo types:** Introduce per-weapon ammo (e.g. `ammo_pistol`, `ammo_rifle`, `ammo_shotgun`, `ammo_smg`, `ammo_crossbow`). CONFIG: add AMMO_TYPES or derive from WEAPONS; update LOOT and applyLoot; reserve count per type.
- **Magazines vs loose:** Either (A) magazine items (e.g. “rifle_mag_30”) that hold rounds and go in a mag slot, or (B) loose ammo in inventory that is consumed on reload (current behavior but per type). Shotgun: shells (loose or mag). Bolt action (later): same pattern.
- **Reload logic:** Consume from correct ammo type in backpack/pockets/rig when reloading; update `magazines[weapon]` and reserve counts. If using magazine items, reload = swap mag and deduct from loaded mag.
- **Bolt action rifle:** Add later as new weapon; use same ammo/mag pattern.

---

## Implementation order and files


| Phase | Main files                                                                                                                                                      | Dependencies                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1     | [game.js](game.js): CONFIG (new items, slots), DEFAULT_STATS, loadPersistent/savePersistent, renderInventoryPanel, drag/drop, applyLoot, run state save/restore | Rig persistence fix in 1.5 unblocks clean run transitions |
| 2     | [game.js](game.js): renderInventoryPanel layout (weaponRowY, grenade section, key item section)                                                                 | Phase 1 done so layout has all slots                      |
| 3     | [game.js](game.js): weapon slot drop/store, currentWeapon and “usable” weapon derivation from weaponSlots only                                                  | Phase 2 layout                                            |
| 4     | [game.js](game.js): weapon outline UI, attachment zones, mod drag/drop in-run, equippedMods read/write                                                          | Phase 3                                                   |
| 5     | [game.js](game.js): CONFIG ammo types, magazines/reserve per type, reload and applyLoot                                                                         | Phase 4 optional                                          |


---

## Risks and notes

- **Phase 1 is largest:** Pockets + equippable backpack + two new container types + persistence. Break into 1.1 (pockets), 1.2 (backpack), 1.3–1.4 (containers), 1.5 (rig + secure/med persist).
- **Save format:** Adding `pockets`, `backpackInventories`, `secureContainerInventories`, `medBagInventories`, and optional `equippedBackpack`/`secureContainer`/`medBag` requires migration in loadPersistent and DEFAULT_STATS.
- **Backpack size change:** When swapping equipped backpack, decide whether to truncate/migrate existing items or forbid swap if current backpack has items that don’t fit the new size.

