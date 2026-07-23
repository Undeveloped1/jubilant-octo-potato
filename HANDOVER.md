# Handover — Current State & Next Sprint

**For agents:** If a task requires a lot of thinking (multi-step design, edge cases, or non-trivial logic), **switch to planning** first—e.g. create or use a plan in `.cursor/plans/` and get alignment before making large code changes.

**Last updated:** Feb 24, 2025. **Magazines & inventory:** ~99% complete; right-click mag menu and stash ammo→mag reload fixed Feb 24 — **tested and working.** **Flashlight:** Will be a tutorial option (body light or permanent upgrade); deferred until tutorial work. **Session work (Feb 2025):** Mag placement priority fix (rig→pockets→backpack→ground), level 1 key guaranteed, guns spawn with loaded mags. **Completed:** Limb/damage system, both-arms-broken, med system, rig/armor UX. **Feb 22 session:** Health merged into gear (single body view), med drop from containers onto limbs fixed, ghost/stuck-drag fix, body layout tweaks — see **"Session work (Feb 22, 2025)"** below. **Feb 24 session:** Right-click mag menu (Unload/Load mag) and unload destination + stash ammo→mag — see **"Session work (Feb 24, 2025)"** below.

---

## Session work (Feb 24, 2025)

**Right-click magazine menu (Unload mag / Load mag)**  
- **Fix:** Menu now uses **live stats** at click time (`this._invStats != null ? this._invStats : (this.stats || this.playerStats)`) and **direct button handlers** (Unload/Load rectangles have their own `pointerdown`), so Unload and Load actually run and persist. Overlay click still closes the menu.
- **Unload destination:** Ammo now goes **where the mag is**, not always to stash at hideout. `isStashContext` is set from `magRef.fromStash === true` only when the mag is in stash; when the mag is in backpack/rig/pocket or weapon slot, ammo goes to that same container or player inventory.
- **Load mag:** Works from stash, rig, pockets; mag goes to the gun and the previous gun mag goes to rig (or backpack/pocket/stash). No change needed here.

**Drag ammo onto mag in stash**  
- **Fix:** Stash drop handler now treats **stash mags** as valid targets when dragging ammo from stash. Added `magTarget.container === 'stash'`: resolve mag from `persistent.stash.items`, add rounds (capped by room), consume ammo from the dragged stack, save persistent and rerender. Backpack/rig/pocket ammo→mag was already working; stash→stash mag was missing and is now implemented.

**Key code (game.js)**  
- Mag menu: `showMagContextMenu` (~12261–12330): `runUnload` / `runLoad` use live stats; `unloadMagazineToStack(..., magRef.fromStash === true)`; Unload/Load buttons get `on('pointerdown', runUnload)` / `runLoad`.
- Unload destination: `unloadMagazineToStack` (~2038–2090): `isStashContext` only true when mag is in stash; otherwise destGrid is backpack/rig/pocket from magRef.
- Stash ammo→mag: stash pointerup block for ammo (~6848–6925): added `magTarget.container === 'stash'` branch; `itemZones.find(... isMagazineItem && getMagazineAmmoId(...) === drag.itemId)` for stash mag under cursor.

**Testing:** Confirmed working (Feb 24): Unload (ammo goes to same container as mag), Load mag (stash/rig/pockets → gun), drag ammo onto mag in stash.

---

## Session work (Feb 22, 2025)

**Health tab merged into gear (plan implemented)**  
- Limb HP bars, labels (HEAD, L ARM, etc.), cur/max numbers, and effect status are now drawn on the **gear** body figure; no separate health view.
- Gear/Health toggle buttons and the health-only (skeleton) view were removed. Single unified body section.
- `armorSlotZones` is always set; `invBodyView` / bodyView branching simplified so only the unified view is used.
- **Med drop on limbs:** Dropping meds from backpack, rig, med bag, or pockets onto a limb now works. Previously the limb med-drop logic lived only inside the `fromAttachmentBox` block; an **early limb block** was added in pointerup (before the block that clears the drag) so container drags (backpack/rig/med bag/pockets) can drop meds on limbs. Both the early block and the existing block inside `fromAttachmentBox` call the same heal/status logic.

**Ghost / stuck-drag fix**  
- **Ghost cleared at start of pointerup:** When there is an active drag, `destroyGhost()` is called at the very start of the pointerup handler (right after reading `drag`). That way the drag preview never stays on screen regardless of which drop path is taken.
- **Character-tab lag:** When healing a limb in the hideout character tab, the full character-tab rerender is deferred to the next frame (`rerenderOrDefer()` → `this.time.delayedCall(0, rerender)`) so the drop feels responsive and the heavy redraw doesn’t block.

**Body figure and limb layout**  
- **Body slot labels removed** from the figure: EARS, CHEST, ABDOMEN, CROTCH, LEGS, and the L/R labels above the feet. Item/durability text (e.g. EMPTY, EQ) and the **limb health bar labels** (HEAD, L ARM, CHEST, etc.) are kept.
- **Limb section vertical offsets** (health bar + label + numbers + status): head +15px, arms −50px, chest −35px, abdomen −15px, crotch −8px; legs unchanged.
- Head was briefly given a special layout (bar only, no 30/30); that was reverted so head matches the other limbs again.

**Key code (game.js)**  
- Limb drawing and `limbZones`: in the body section after the feet (~11270–11315); `limbPositions` and the forEach that draws bar, label, numbers, status and pushes to `limbZones`.
- Early limb med-drop: pointerup block “Limb med drop: handle when dragging from backpack/rig/pockets…” (~12550–12632); uses `rerenderOrDefer()` and then `destroyGhost()` / `invDragging = null` before return.
- Ghost clear: first line of drop handling in pointerup: `destroyGhost()` right after `const drag = this.invDragging;`.
- `rerenderOrDefer`: defined next to `rerender`; when hideout + character tab, calls `this.time.delayedCall(0, rerender)` instead of `rerender()` so the full character-tab redraw runs next frame.

---

## Magazines: stash ↔ weapon & labels

**Context:** Magazines (mag_pistol, mag_smg, mag_rifle) have rounds/maxRounds. They can live in stash, backpack, rig, pockets, or equipped in a weapon’s mag slot (pistol/smg/rifle). All of the following was implemented so behavior is **CONFIG-driven**: add a new mag to `CONFIG.MAGAZINES` (weapon, capacity, ammoId) and it gets labels and movement everywhere.

**Movement**  
- **Weapon → stash:** Drag mag from weapon attachment box (mag slot) → drop on stash. One step; no need to put in backpack first. Implemented in inv panel pointer-up: `inStashBounds && drag.fromAttachmentBox && isMagazineItem(drag.itemId)` → `setEquippedMag(stats, drag.weaponId, null)` + `addItemToStash(magItem, { container: 'weaponMag', weaponId })`.  
- **Stash → weapon mag slot:** Drag mag from stash → drop on the weapon’s **mag slot** (small box under the weapon, not the weapon slot). Implemented in stash pointer-up: `_hideoutContainerBounds.attachmentMagSlotZones` (mag slots only); when drop hits a zone and `getMagazineWeapon(drag.itemId) === z.weaponId`, call `equipStashMagToWeaponSlot(drag.placementId, overMagSlot.weaponId)`. That removes mag from stash and calls `setEquippedMag(this.stats, weaponId, { itemId, rounds, maxRounds })`.  
- **Stash ↔ backpack/rig/pockets:** Existing container logic; mags keep rounds via `stashExtra()` (rounds/maxRounds) and `addStashItemToContainer` / `addItemToStash`.  
- **Ammo onto mag:** Dragging ammo (from stash or from panel) onto a mag in backpack/rig/pocket fills the mag and consumes ammo (stash pointer-up for stash ammo; inv panel pointer-up for panel ammo). Both paths persist and rerender.

**Labels (same everywhere)**  
- **Helper:** `getMagazineRoundsLabel(p)` (in game.js near other mag helpers). Returns `" rounds/max"` for magazines (e.g. `" 5/17"`) or `""`. Uses `p.rounds ?? 0` and `p.maxRounds ?? getMagazineCapacity(p.itemId)` so no `undefined`.  
- **Usage:** Stash grid, character backpack grid, rig grid, and pockets all use `(lbl + count if >1 else lbl) + getMagazineRoundsLabel(p)` so stash label matches character inventory. Weapon slot ammo line and attachment box mag label use safe fallbacks (`equippedMag.rounds ?? 0`, etc.).  
- **Persistence:** Moving a mag to stash uses `stashExtra(item)` which now includes rounds/maxRounds for mags (and any item with those fields), so mags in stash have correct data and the label shows it.

**Weapon attachment view (known limitation)**  
- The magazine in a weapon is only shown in the attachment view when the gun is **equipped** (in a weapon slot). If the weapon is in a backpack or in the stash, the attachment view does not show the mag—it’s a display limitation, not a data loss; mag state is still stored if the game tracks it for unequipped weapons.

**Key code locations (game.js)**  
- Mag helpers: `isMagazineItem`, `getMagazineCapacity`, `getMagazineWeapon`, `getMagazineAmmoId`, `getMagazineRoundsLabel`, `getEquippedMag`, `setEquippedMag` (around 1987–2016).  
- Stash mag → weapon: `equipStashMagToWeaponSlot` (after `equipStashItemToWeaponSlot`); stash pointer-up checks `b.attachmentMagSlotZones` before weapon slots.  
- Weapon mag → stash: inv panel pointer-up, block `inStashBounds && drag.fromAttachmentBox && isMagazineItem(drag.itemId)`.  
- Bounds: `_hideoutContainerBounds.attachmentMagSlotZones` is set in `renderInventoryPanel` from `attachmentBoxZones` (filter: mag slots only, with weaponId).  
- Cleanup: `equipStashMagToWeaponSlot = null` in the same cleanup that clears other stash callbacks.

**Adding new magazines:** Add entry to `CONFIG.MAGAZINES` (weapon, capacity, ammoId) and to any spawn/loot lists. No extra per-item code needed for labels or stash/weapon movement.

---

## Testing: Character tab stash & body ↔ stash

**Context:** Hideout → CHARACTER tab. Stash on the left; inventory (body, BAG, RIG, SEC, MED, pockets, backpack grid) on the right. All of the following should work without routing through another container.

**Containers ↔ stash (drag to stash or from stash)**  
1. **To stash:** Drag any item from backpack grid, rig grid, secure container grid, med bag grid, or a pocket → drop on stash area. Item (and ammo_box/rig inner contents if applicable) moves to stash.  
2. **From stash:** Drag a stash item → drop on backpack grid, rig grid, secure container grid, med bag grid, or pocket area. Item moves into that container. Med bag accepts medical items only.

**Body slots ↔ stash**  
3. **Body → stash:** Drag from a body slot (head, body, ears, RIG, or BAG) → drop on stash. Helmet/headset, vest, headset, rig (with contents), or backpack (with contents) moves to stash; slot is cleared or reset to empty default.  
4. **Stash → body:** Drag from stash a helmet/headset, vest, headset, rig, or backpack → drop on the matching slot (head, body, ears, RIG, or BAG). Item equips; if the slot had something, the displaced item goes to backpack (armor) or is replaced (rig/backpack).  
5. **Body view:** Stash → head/body/ears/RIG only works when the body view is **gear** (not health), since those slots are only visible in gear view.

**Smoke tests**  
6. Click elsewhere on the inventory side (e.g. gear/health toggle, empty cell): stash and resource line should **not** disappear; they stay visible.  
7. Stash hover: Hover over a stash or backpack-list item; tooltip should appear **near the cursor** (above it), not fixed at the bottom.

**Drop anywhere & equip square**  
8. **Container grid or square:** Dragging an item (from any container or from attachment box) and dropping anywhere inside a container’s **grid** or on its **equip square** (BAG, RIG, SEC, MED) places the item in the first fit in that container (no need to hit a specific cell).  
9. **Stash → pocket:** Dropping from stash onto the pocket area places into the **pocket under the cursor**, not always pocket 1.  
10. **Backpack → BAG square:** Dragging a backpack from stash onto the BAG square equips it. If a backpack is already equipped, it is moved to stash (with contents) first, then the new one equips. If stash has no 4×4 space, the new backpack is put back in stash (no loss).  
11. **Items into other backpacks:** Dropping an item (from panel or from stash) onto a **backpack item** in the main backpack grid places it inside that backpack’s inner grid (nested). Stash exposes `backpackItemZones` in hideout bounds so stash drops can target the correct nested backpack.

**Debug: Inject (testing)**  
12. **Inject** button (stash button row, Character tab): Click → prompt for Item ID (e.g. `backpack_default`, `rig`, `medkit`, `secure_container_default`, `med_bag_default`) and Count → adds that item to stash. **`injectIntoStash(itemId, count)`** on the scene does the same (e.g. from console). Container types get an empty inner grid. Cleared on stash/panel cleanup.

**Regression:** Container drag within the panel (backpack ↔ rig ↔ pockets ↔ secure ↔ med bag), weapon slots, and Delete-to-drop behavior are unchanged.

---

## Med system: merge health into gear

**Status:** **Done (Feb 22, 2025).** See **"Session work (Feb 22, 2025)"** above for what was implemented.

**Scope (completed):**
1. Move health bars from the health screen to their relative locations on the gear screen (e.g. limb HP bars near each limb on the body figure).
2. Test the merged layout; ensure all health info and med flows work.
3. Remove the health and gear tabs; make the gear tab the only option (single unified tab).
4. Resize the panel/layout accordingly for the single-tab view.

**Goal:** One unified inventory/gear view with health integrated—no separate skeleton health screen.

---

## Session work (Feb 2025)

**Mag placement priority (rig → pockets → backpack → ground)**  
When reloading or swapping mags, the magazine coming out of the gun was sometimes dropped on the ground even when pockets or backpack had space. Fixed by:
- Ensuring `ensureRigStats`, `ensureBackpackStats`, and `ensurePockets` run at the start of `findFirstEmptySlotForMag`
- Correcting `isPocketSlotEmpty`: slots with `_spansFrom` (second cell of a 2×1 item) are **not** empty and must not be overwritten
- Hardening backpack logic: ensure `gridW`/`gridH`, validate `items` is an array before searching
- Removing `excludeSlot` when swapping mags (the source slot is vacated, so it can be used)
- Tracking `placeItem` success; if placement fails, mag is dropped instead of vanishing

**Level 1 keycard guarantee**  
Levels in `LEVELS_NEEDING_KEY` (1, 3, 4, 6) can fail to spawn a key when loot is shuffled and the key lands beyond the crate count. Fixed in `spawnLevelEntities`: after shuffling, if the key index is ≥ `cratePos.length`, swap it with a random item in the first N crate positions so a key always spawns.

**Guns spawn with loaded magazines**  
SMG and Rifle looted from crates/bodies now start with an equipped magazine. Ammo is rolled as: 15% full, 50% less than half, 35% more than half. Implemented via `getRandomMagRoundsForLootedWeapon` and `setEquippedMag` in `applyLoot` when handling `LOOT_WEAPON_ACTIONS` for magazine weapons.

**Pistol mag spawn rate**  
Unchanged; `LEVEL_POOLS` were not modified.

**Code locations**  
- Mag placement: `findFirstEmptySlotForMag`, `placeMagInRigPocketBackpackOrGround`, `isPocketSlotEmpty` (game.js ~2032–2165)
- Key guarantee: `spawnLevelEntities` after `Phaser.Utils.Array.Shuffle(loot)` (~15873)
- Looted weapon mags: `applyLoot` weapon-action block, `getRandomMagRoundsForLootedWeapon` (~17993, ~1992)

---

## Completed (status refresh)

- **Limb/damage system** — Tested; functions as designed. Single limb per hit, melee stance, outcome roll, ranged bands, escalation, enemy modifiers. Combat log toggle.
- **Both-arms-broken** — Works and confirmed (door delay, 1 damage per shot/grenade/loot, recovery flow).
- **Med system** — Works. Merge task above is the next step, not a replacement.
- **Rig/armor UX** — Complete. Unequip to empty backpack cell only; no changes needed.

---

## Longer-term: three pillars (from milestone plan)

1. **Graphics overhauls**
   - Pixel-art background per chunk with colliders; level design tool for quicker level implementation/cycling.
   - Sprites for all enemy types (walker, leaper, bandit, spitter, etc.).

2. **Tarkov-style inventory**
   - Equip: primary, secondary, sidearm, melee; armor, helmet, rig, backpack.
   - Pockets + backpack + rig as moveable containers; organize and drop items; stash as main storage.
   - Same model in Hideout gear screen and in-run inventory.

3. **Enemies & hideout NPCs**
   - Level-specific enemy variants (e.g. police walker, military/DEVGRU-style).
   - Rescueable NPCs; bring them to hideout; they do tasks or can go on runs.

See the milestone plan for phases and file references.

---

## Trader Sell reference (stash & backpack)

- **Config:** `CONFIG.TRADER.SELL_GRID` — itemId → `{ credits: n }` or `{ materials: n }`.
- **Sell list:** `renderTraderItems()` Sell branch builds list from `stash.items` and `stats.backpack.items` for any item in `SELL_GRID`; type `'grid'`, with `grid`, `placementId`, `itemId`, `count`, `name`, `value`, `currency`.
- **Selling:** `sellItem(item)` for `item.type === 'grid'`: `removeItem(item.grid, item.placementId)`, add to persistent credits/materials, save, sfx.
- **Display:** Grid items use distinct color; currency icon 💰 or ⚙️ by `item.currency`.

---

*All game logic in `game.js`. Use this handover + the milestone plan to continue feature-by-feature. Older session notes are in **`HANDOVER_LOG.md`**.*

**If continuing in a new session:** Right-click mag menu (Unload/Load, stash ammo→mag) tested and working (Feb 24). Health is merged into gear (Feb 22). Next priorities are per the milestone plan (graphics, inventory polish, enemies). For mag/inventory reference, search `game.js` for `showMagContextMenu`, `unloadMagazineToStack`, `getMagazineRoundsLabel`, `equipStashMagToWeaponSlot`, and `attachmentMagSlotZones`. For limb/med reference, search for `limbZones`, `rerenderOrDefer`, and the early limb med-drop block in pointerup.

---

## AI collaboration

- Clarification and planning guidelines for working with the user are in **`.cursor/rules/collaboration.mdc`** (clarify before building, ask when stuck or when the user is frustrated, plan multi-step work, treat references as spec).
