---
name: Unload magazines U key
overview: "Add magazine unload: U key unloads the selected magazine (chosen by right-click/long-press or while dragging) and puts its rounds into an ammo stack. Destination is stash when in hideout/stash context, or the same in-run container logic when in game."
todos: []
isProject: false
---

# Unload Magazines (U Key + Right-Click / Drag)

## Goal

- **Trigger 1:** While **dragging** a magazine (any source: stash, backpack, rig, pockets, attachment box), pressing **U** unloads that magazine (rounds → ammo stack) and keeps the mag in place with 0 rounds.
- **Trigger 2:** **Right-click** (or long-press right-click) on a magazine **without** dragging selects it; pressing **U** then unloads that selected magazine.
- **Only magazines:** Unload is allowed only when the selected/dragged item is a magazine (`isMagazineItem(itemId)` — `mag_pistol`, `mag_smg`, `mag_rifle`; future mags in `CONFIG.MAGAZINES` are included).
- **Destination:** In **stash context** (hideout, stash drag or stash-selected mag): add ammo to `persistent.stash`. **In-run** (backpack/rig/pockets/attachment): add ammo using the same container as the mag (backpack → backpack, rig → rig); if mag is in **pocket**, add ammo to **backpack** (or rig if no backpack), since pockets are slot-based and ammo stacks use grid `tryAddItem`.

---

## Current behaviour (reference)

- Magazines: `CONFIG.MAGAZINES` defines `mag_pistol`, `mag_smg`, `mag_rifle` with `capacity` and `ammoId` ([game.js](game.js) ~~110–112). Placements have `rounds`, `maxRounds`; helpers: `getMagazineAmmoId`, `getMagazineCapacity`, `isMagazineItem` (~~1992–2035).
- Inventory drag: `invDragging` / `stashDragging` hold current drag; DELETE key is handled during drag ([game.js](game.js) ~14454–14481). R key rotates during drag. No right-click or pointer-button checks today.
- Grid/pocket source: `getDragSourceGrid(d)`, `removeFromContainerSource(d)`, `putBackInContainerSource(d, item)` ([game.js](game.js) ~12056–12125). Stash uses `this.persistent.stash` and `stashDragging`.

---

## 1. Core unload logic (shared)

Add a **helper** (e.g. `unloadMagazineToStack(sceneOrStats, magRef, isStashContext)`) used by both U-during-drag and U-on-selection:

- **Input:** `magRef` = object describing the mag: `{ container, placementId?, pocketIndex?, slotIndex?, itemId, rounds?, maxRounds? }` and either `grid` (the grid the mag lives in) or enough to resolve it (e.g. `stats`, `persistent`).
- **Steps:**
  1. Resolve the **placement** (grid item or pocket slot) and read `rounds = placement.rounds ?? 0`. If `rounds <= 0`, return (nothing to unload).
  2. `ammoId = getMagazineAmmoId(itemId)`; if no `ammoId`, return.
  3. **Destination:** If `isStashContext`: `destGrid = persistent.stash`. Else: if container is backpack → `stats.backpack`; rig → `stats.rigGrid`; pocket (or attachment mag) → `stats.backpack` (fallback rig if backpack full).
  4. `tryAddItem(destGrid, ammoId, rounds)`.
  5. Set placement `rounds = 0` in place (mutate the object in `grid.items` or in `stats.pockets[pocketIndex][slotIndex]`). Ensure `maxRounds` stays so the mag still shows `0/max`.
  6. Return success/failure for feedback (e.g. sfx, rerender).

**Edge cases:** Attachment-box mag (weapon slot): resolve from `stats.equippedMagazines[weaponId]`; unload updates that object and puts ammo in backpack (in-run). Stash drag: no `stats.backpack`; use stash only.

---

## 2. U key during drag

- **Where:** Same keyboard listener setup as DELETE and R ([game.js](game.js) ~14454–14496). Add a **U** key (e.g. `Phaser.Input.Keyboard.KeyCodes.U`), bound when inventory/stash UI is active.
- **When U is pressed:**
  - If **stashDragging** and `isMagazineItem(stashDragging.itemId)`: resolve mag from `persistent.stash` by `placementId`, get `rounds`, then unload to `persistent.stash`; set mag `rounds = 0`; clear drag and rerender.
  - Else if **invDragging** and `isMagazineItem(invDragging.itemId)`: resolve source (backpack, rig, pocket, attachment box) from existing drag state. Call unload helper with `isStashContext = this._invIsHideout` (hideout = stash context). Don’t remove the mag from the grid; only set `rounds = 0`. Rerender; optionally keep drag in place so user can keep moving the now-empty mag.
- If the dragged item is not a magazine, U does nothing.

---

## 3. Right-click / long-press to “select” a magazine

- **Pointer events:** Use Phaser’s pointer: `pointer.button === 2` for right-click. Ensure `onPointerDown` / `onPointerUp` receive the pointer so we can branch on `button === 2`.
- **Right-click down on a magazine:**
  - Hit-test: same zones as current drag (stash item zones, `backpackItemZonesAll`, `rigItemZones`, pocket zones, attachment mag slots). If the hit is a magazine, set a **selection** state, e.g. `this.invSelectedMag = { container, placementId, pocketIndex, slotIndex, itemId, rounds, maxRounds, fromStash?: true }` (and stash equivalent if needed, e.g. `this.stashSelectedMag`).
  - Do **not** start a left-drag when `button === 2`; ignore left-drag path for right-click.
- **Long-press (optional):** If you want “long-press right-click” as the only way to select (instead of instant right-click), start a timer (e.g. 400–500 ms) on right pointerdown on a mag; set selection only when the timer fires; cancel on right pointerup. For “click and hold right click” we can do either: (A) select on right-click down immediately, or (B) select only after hold 400 ms. Plan assumes (A) for simplicity; (B) is a small change (add timer, clear on pointerup).
- **U key when not dragging:** If `invSelectedMag` or `stashSelectedMag` is set, run the same unload logic as above for that mag (resolve placement, add ammo to stash or in-run container, set `rounds = 0`), then clear the selection and rerender.
- **Clear selection:** On right-click pointerup, or when starting a left-drag, or when clicking elsewhere, clear `invSelectedMag` / `stashSelectedMag` so U doesn’t unload an old selection.

---

## 4. Destination rules (summary)


| Mag source          | Context | Ammo destination                           |
| ------------------- | ------- | ------------------------------------------ |
| Stash               | Hideout | `persistent.stash`                         |
| Backpack            | In-run  | `stats.backpack`                           |
| Rig                 | In-run  | `stats.rigGrid`                            |
| Pocket              | In-run  | `stats.backpack` (or rig if backpack full) |
| Attachment (weapon) | In-run  | `stats.backpack` (or rig)                  |


Stash context is when the inventory UI is hideout (CHARACTER tab with stash). In-run is when the panel is open during a run (no stash, or stash not the source).

---

## 5. Implementation order (small steps)

1. **Unload helper**
  Add `unloadMagazineToStack(stats, persistent, magRef, isStashContext)` (or pass scene and derive stats/persistent). Implement resolve placement → read rounds → tryAddItem(destGrid, ammoId, rounds) → set placement.rounds = 0. Handle stash, backpack, rig, pocket, and attachment mag (equippedMagazines). No UI yet.
2. **U key + drag**
  Add U key binding next to DELETE/R; when `invDragging` or `stashDragging` is a magazine, call the unload helper with the right context, then rerender. Keep or clear drag as you prefer (e.g. keep drag so mag can still be dropped).
3. **Right-click selection**
  In `onPointerDown`, if `pointer.button === 2`, hit-test magazine zones; if hit, set `invSelectedMag` or `stashSelectedMag` and skip starting left-drag. In `onPointerUp`, if `button === 2`, clear selection. Ensure left-drag logic never runs for `button === 2`.
4. **U key when selected**
  In U key handler, if no drag but `invSelectedMag` or `stashSelectedMag` is set, call unload helper for that mag and clear selection.
5. **Polish**
  Optional: long-press timer for right-click; optional sfx for unload; ensure attachment-box mag unload updates `equippedMagazines` and UI.

---

## 6. Files and key locations

- **All in [game.js](game.js):**
  - Mag helpers: ~1992–2035 (`isMagazineItem`, `getMagazineAmmoId`, etc.).
  - Unload helper: add near other mag/ammo helpers (~2015 or after `getMagazineRoundsLabel`).
  - Inventory listeners: pointerdown/pointerup (~12400–12610 for down, ~12612+ for up); keyboard DEL/R ~14454–14496. Add U key and right-click handling there.
  - Stash drag: `stashDragging` and stash pointer handling (separate from inv); U must handle both `invDragging` and `stashDragging`, and any stash-side “selected mag” state.
  - Attachment mag: `stats.equippedMagazines[weaponId]`; unload from weapon slot means set that mag’s `rounds = 0` and put ammo in backpack/rig (in-run only).

---

## 7. Future magazines

Any new magazine added to `CONFIG.MAGAZINES` (weapon, capacity, ammoId) will be a magazine for unload (via `isMagazineItem`). No extra per-mag code needed.