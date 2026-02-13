---
name: Backpack and stash grid
overview: Add a 12x12 grid backpack for in-run inventory (TAB) and a persistent stash at the hideout; consumables, stackables, weapons, and armor become grid items. At hideout, players move items between stash and backpack; backpack contents define what they take on the next run.
todos: []
isProject: false
---

# Backpack and stash grid system

## Goals

- **Backpack:** 12x12 grid during a run (TAB inventory). Each item occupies one or more grid cells. Starter size 12x12.
- **Stash:** Persistent storage at the hideout (same or larger grid). Items moved between stash and backpack when at hideout; backpack = loadout for next run.
- **Grid items:** Consumables, stackables (ammo, scrap, materials, grenades), weapons, and armor. Key/map can stay instant (flags) or be 1x1 grid items; recommend keeping them instant to avoid softlocks.

---

## Data model

### Item definition (CONFIG)

Add a single source of truth for grid items, e.g. `CONFIG.INVENTORY_ITEMS` or extend existing structures:

- `id` – matches loot ID / weapon key (e.g. `'meds'`, `'shotgun'`, `'helmet'`).
- `sizeW`, `sizeH` – grid footprint (default 1x1; weapons could be 2x1, armor 1x1).
- `stackMax` – max per stack (e.g. ammo 99, meds 5, grenades 3); 1 for non-stackable (weapons, armor).
- `category` – `'consumable'`, `'stackable'`, `'weapon'`, `'armor'`, `'key'` (for UI).
- Icon/label from existing CONFIG (MODS, WEAPONS, etc.) or a small lookup.

Items that stay **instant** (no grid): `key`, `map`, `plug` (hideout flag). Everything else that the player “carries” becomes a grid item with an entry in this config.

### Backpack (run state)

- **Location:** `playerStats.backpack` (or `playerStats.inventoryGrid`).
- **Shape:** 12x12 = 144 cells. Store as either:
  - **Option A:** 2D array `grid[row][col]` where each cell is `null` or `{ itemId, count?, instanceId? }`. Multi-cell items occupy a contiguous block; store a reference (e.g. `instanceId`) so all cells point to the same stack.
  - **Option B:** 1D list of “placed items” `[{ itemId, count, row, col, sizeW, sizeH }]` and derive occupied cells when rendering and when checking placement. Easier to persist and validate.

Recommend **Option B**: list of placed items. Occupancy is computed when placing and when checking “can I add this item?” (find first position where item fits).

### Stash (persistent)

- **Location:** `persistent.stash` – same structure as backpack (list of placed items in a 12x12 or e.g. 16x16 grid). Stash grid size can be fixed (e.g. 12x12) or larger than backpack to act as “warehouse.”
- **Persistence:** Already in persistent; save/load with existing `savePersistent` / `loadPersistent`.

### Equipped / quick-access (unchanged where possible)

- **Weapons:** Still `playerStats.hasShotgun`, etc., and `currentWeapon` / `magazines`. When a weapon is “in backpack,” it’s in the grid; when “equipped,” it’s in the weapon slot (and could be removed from grid or just marked equipped – recommend remove from grid when equipped so one source of truth).
- **Armor:** Same idea – `playerStats.armor` = equipped; if armor is in backpack it’s a grid item; when equipped, remove from grid and put in armor slot.
- **Consumables hotbar:** The 3 hotkey slots can reference items in the backpack (e.g. “slot 1 = backpack index 5”) or you can “assign” from backpack to hotbar (copy or move); simplest is hotbar = 3 reserved slots that pull from backpack by reference.

So: **equipped weapons and armor** = items that are no longer in the grid but in the existing weapon/armor slots. Picking up a weapon/armor first goes to backpack; player can then “equip” from backpack to weapon/armor slot (and optionally unequip back to backpack). This keeps one source of truth and avoids duplicating state.

---

## Pickup flow (in-level)

1. **Crate/skull pickup:** Instead of calling `applyLoot(id)` and immediately applying (e.g. +5 ammo), call a new `tryAddItemToBackpack(id, count?)` (or keep `applyLoot` but have it delegate to this for grid items).
2. **tryAddItemToBackpack:** Look up item in CONFIG (size, stackMax). If stackable, try to merge with existing stack in backpack; else find first empty region of size `sizeW x sizeH`. If no room, show “Backpack full” and either drop the pickup (crate stays / skull remains) or don’t grant the item.
3. **Non-grid items (key, map, plug):** Keep current behavior in `applyLoot` (set flags / hideout state).
4. **Weapons/armor:** Add to backpack as a 1x1 or 2x1 item. Optionally allow “auto-equip” if no weapon in slot and backpack has space (add then equip in one step) for smoother UX.

---

## UI

### In-game TAB inventory ([game..html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game..html) ~7552)

- **Replace or extend** `createInventoryUI` / `updateInventoryUI`:
  - Left or top: **12x12 grid** of cells (e.g. 24px per cell = 288px total; scale to fit 600x400 panel). Each cell is a Phaser rectangle/graphics; draw borders and fill with item icon/count if occupied.
  - Right or bottom: Keep **weapon line** (current weapon, mag, mods), **armor slots** (head/body/arms/feet), and a short **stats line** (HP, ammo reserve, grenades if you still show totals). These reflect “equipped” state; items in grid are “in backpack.”
  - **Interaction:** Click/drag to move items in grid; click item then click empty space to move; optional “Use” / “Equip” on click (context menu or double-click). Equipping weapon/armor moves it from grid to equipped slot (and frees grid space).
- **Hotbar:** The 3 consumable slots can be 3 fixed cells at bottom of grid or separate; assigning a consumable from grid to hotbar links that slot to the stack (use from stack when hotkey pressed).

### Hideout: Stash tab

- **New tab** “INVENTORY” or “STASH” next to FACILITIES / CHARACTER / SHOP in [renderTabs](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game..html) (~3656).
- **Layout:** Two grids side by side (or top/bottom): **Stash** (persistent) and **Backpack** (what you’ll take next run). Same 12x12 (or stash 16x16) cell rendering.
- **Transfer:** Drag or click “Move” to move items between stash and backpack. On “Deploy” / start run, `playerStats.backpack` is whatever is in the backpack panel; stash stays in `persistent.stash`.
- **Initial run:** If no backpack data, start with empty 12x12 or with starter items (e.g. pistol ammo, 1 meds) placed in grid based on difficulty/upgrades.

---

## Implementation order

1. **CONFIG and item list** – Add `CONFIG.INVENTORY_ITEMS` (or similar) with id, sizeW, sizeH, stackMax, category for all grid items (weapons, armor, meds, ammo, grenade, scrap, materials, mods, consumables). Keep key/map/plug out of this (instant only).
2. **Backpack data structure** – Add `playerStats.backpack = { gridW: 12, gridH: 12, items: [] }` and `persistent.stash = { gridW: 12, gridH: 16, items: [] }`. Helper functions: `placeItem(grid, itemId, count, row, col)`, `removeItem(grid, placementId)`, `findSpace(grid, sizeW, sizeH)`, `tryAddItem(grid, itemId, count)`.
3. **Pickup integration** – In `applyLoot`, for grid items call `tryAddItemToBackpack`; if false, show “Backpack full.” For key/map/plug keep current behavior.
4. **In-game TAB UI** – Replace/extend inventory panel with 12x12 grid renderer; show item icons/counts; implement click-to-select and place/move; “Equip” from grid to weapon/armor slots (and unequip back to grid).
5. **Stash tab at hideout** – New tab; render stash and backpack grids; transfer logic; ensure on “Start run” the game loads `playerStats.backpack` from the backpack panel (and optionally apply equipped weapons/armor from grid or keep equipped in separate slots from last run).
6. **Run start** – When starting a run, initialize `playerStats.backpack` from hideout’s “backpack” copy; spawn starter items into backpack if any (from upgrades); equip weapons/armor from backpack or from default loadout logic.

---

## Edge cases

- **Weapon/armor already equipped:** Picking up same type can go to backpack as second copy (if allowed) or reject. Recommend: allow multiple in backpack; only one per weapon/armor slot when equipped.
- **Stack splitting:** For “assign to hotbar” or move half stack, add `splitStack(grid, placementId, count)` and place new stack in another cell.
- **Save/load:** Backpack and stash are part of `playerStats` and `persistent`; ensure migration for existing saves (default empty backpack/stash).
- **Backpack upgrades:** Later you can add “backpack size +2” (e.g. 14x12) via CONFIG or hideout upgrade; same logic, larger `gridW`/`gridH`.

This gives you a clear path to a 12x12 backpack, stash at hideout, and move-between-runs flow while keeping key/map instant and weapons/armor as grid items that can be equipped into existing slots.
