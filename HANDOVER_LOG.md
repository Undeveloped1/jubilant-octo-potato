# Handover log — completed session notes

Historical session notes moved from HANDOVER.md. Newest at bottom.

---

## This chat: Status refresh — completed items & med merge task

**Status updates:**
- **Magazines & inventory:** ~99% complete; any remaining open pieces can be finished later.
- **Flashlight:** Will be a tutorial option (body light or permanent upgrade); deferred until tutorial work.
- **Limb/damage system:** Marked complete — tested, functions as designed.
- **Both-arms-broken:** Marked complete — works and confirmed.
- **Med system:** Works; next task is merge (not replacement).
- **Rig/armor UX:** Marked complete.

**New task (Med system: merge health into gear):**
1. Move health bars from health screen to relative locations on gear screen (limb HP near body figure).
2. Test merged layout; ensure health info and med flows work.
3. Remove health and gear tabs; single gear tab only.
4. Resize panel for single-tab view.

**Goal:** One unified inventory/gear view with health integrated—no separate skeleton health screen. See HANDOVER.md **"Med system: merge health into gear"** section.

---

## This chat: Character tab stash ↔ inventory (full parity)

**Scope of work:**

- **Stash UI on CHARACTER only:** Stash lives only on the CHARACTER tab; STASH tab removed. Footer/tab bar stay on top; stash grid 14×24 (19 visible rows, scroll); resource line (Scrap/Credits/Mat) in stash area; header no longer shows HP/ammo there.
- **All containers ↔ stash:** Any item in backpack, rig, secure container, med bag, or pockets can be dragged onto the stash area to move to stash; any stash item can be dragged onto any of those container zones to move into them. Ammo_box and rig inner inventories migrate correctly. Med bag still accepts medical items only when receiving from stash.
- **All body slots ↔ stash:**  
  - **To stash:** Dragging from head, body, ears, RIG slot, or BAG slot and dropping on stash moves that equipped item (and, for rig/BAG, its contents) to stash. Scene methods: `addEquippedRigToStash`, `addEquippedBackpackToStash`, `addEquippedArmorToStash(slotId)` for head/body/ears.  
  - **From stash:** Dropping a stash helmet/headset on head slot, vest on body, headset on ears, rig on RIG slot, or backpack on BAG slot equips from stash. `equipStashItemToSlot(slotId, stashPlacementId)` handles all five; displaced armor goes to backpack.  
  - Panel sets `_hideoutContainerBounds` with zones for backpack, rig, secure, medBag, pockets and for **equip slots** (backpackSlot, rigSlot, headSlot, bodySlot, earsSlot) so stash can detect drop target.
- **Stash no longer disappears:** Panel rerender (e.g. gear/health toggle or drag-drop) was clearing `_invContent` without redrawing stash. HideoutScene `renderInventoryPanel()` override now calls `renderCharacterTabStash()` and `updateResourceText()` after the base panel when on CHARACTER tab in hideout, so stash stays visible.
- **Stash hover tooltip:** Tooltip position is now cursor-relative (above the pointer) instead of fixed below the buttons.

**Files:** `game.js` — HideoutScene (renderCharacterTabStash, showTab, cleanup, addItemToStash, addEquippedRigToStash, addEquippedBackpackToStash, addEquippedArmorToStash, equipStashItemToSlot, addStashItemToContainer); GameScene.renderInventoryPanel (_hideoutContainerBounds, stash-drop handling for container drag and for fromSlot/fromBackpackSlot); stash onPointerUp (drop onto container zones and equip slots).

**Testing:** See HANDOVER.md section **"Testing: Character tab stash & body ↔ stash"**.

---

## Earlier session (inventory & weapons)

- **Armor durability:** Preserved when moving in backpack, dropping to ground (Delete), swapping with equipped slot, or looting dropped item. Grid placements store `durability`/`maxDurability` for helmet/vest; `placeItem(..., extra)` and `tryAddItem(..., extra)`; applyLoot and drop flows pass durability.
- **Inventory UI:** Stats box (HP, ammo, grenades, scrap, weapon, flashlight, NVG) is separate and always visible at x=520. Hover tooltip is its own small box (above backpack) when hovering items; shows item name + armor durability for helmet/vest. Fixed duplicate `statsText` declaration (right-side stats use `statsBoxText`).
- **Weapon slots (in-run inventory):** Four slots — PRIMARY, SECONDARY, SIDEARM, MELEE — same style as HEAD/ARMS/BODY/FEET. Data: `weaponSlots: { primary, secondary, sidearm, melee }` in run stats (migrated in Hideout + GameScene). Drag from backpack onto primary/secondary (long guns) or sidearm (pistol); drag from slot to empty cell to unequip (sidearm cannot be unequipped to backpack). Click/drop on same slot = equip that weapon. Delete key does nothing when dragging from weapon slot.
- **Default loadout:** `DEFAULT_STATS` has rifle in primary, SMG in secondary, pistol in sidearm; `hasRifle`/`hasSMG` true; `currentWeapon` `'rifle'`. No rifle/SMG in backpack by default (they're in slots).
- **Inventory panel size:** 700×500 (was 600×400). Body figure now includes abdomen, crotch, legs, two feet.

---

## Previous session (room persistence & body layout)

- **Room persistence:** When you leave a room through a door (or enter the risk room), that room's state is saved. When you re-enter, the same enemies (count, type, positions, HP), crates, skulls, and **dropped items** are restored — no respawns. Saved per room: `enemyState` (type, x, y, hp, maxHp, originX, originY), `crateState`, `skullState`, `droppedItemsState`. `restoreEnemiesFromState()`, `restoreCratesFromState()`, `restoreSkullsFromState()`, and dropped-item restore; `spawnEnemy()` returns the enemy for HP restore.
- **Enemy wander in other rooms:** While you're in one room, enemies in *other* rooms drift within a radius so the world feels like it carries on. Timer every 350ms calls `tickOtherRoomsEnemyWander()`: for each room that isn't current, each saved enemy's x/y is nudged by ±14px and clamped to 80px from `originX`/`originY`. Constants: `GameScene.ROOM_WANDER_RADIUS = 80`, `GameScene.ROOM_WANDER_STEP = 14`.
- **Body figure (earlier):** ABDOMEN, CROTCH triangle, then legs and feet as above. No backward-compat for old saves — only current format is supported.

---

## Earlier session (inventory body figure — legs & feet)

- **Body figure legs:** Two leg trapezoids in `game.js` (in `renderInventoryPanel()`), drawn with graphics (moveTo/lineTo). Named variables for triangle and leg points: `triTopLeftX`, `triTopRightX`, `triTopY`, `triBottomTipX`, `triBottomTipY`; `leftLegOuterTopX/Y`, `leftLegInnerTopX/Y`, `leftLegOuterBottomX/Y`, `leftLegInnerBottomX/Y` (same for right). Leg–triangle padding: `legTrianglePad` (7), `legOuterTopDrop` (4), `legTopEdgeScale` (0.9), `legShiftTowardTip` (2), `legInnerTopPad` (2). Outer edge slightly off vertical: `legOuterEdgeSlope` (5). Bottom: `legInnerBottomInset` (30). Debug labels were removed (were TTL, TTR, TBT, LOT, LIT, LIB, LOB, ROT, RIT, RIB, ROB).
- **Feet:** Two shoe-shaped trapezoids (wider at sole via `footSoleOutset`), sized by leg bottom (LIB–LOB, RIB–ROB), 5px below legs (`footPad`). Single logical "feet" armor slot; L/R labels and EQ/— on both. Search for `leftFootG`, `rightFootG`, `footPad`, `footY`, `leftFootCenterX/Y`, `rightFootCenterX/Y`.

---

## Recent session (inventory body, headset, medkit, HP)

- **Body section:** Body scaled (BODY_GROW_H 1.25, BODY_GROW_V 1.25), offset (bodyOffsetX 50, bodyOffsetY 20). Outline around body area; BODY label centered above NVG with 10px gap; NVG at helmet-label position (5px pad); EARS box 5px left, 15px lower; NVG/EARS boxes use accBoxW × accBoxH (elongated, half height). Helmet label removed; helmet slot content centered in semicircle; hit zone/labels use helmetSlotY (semicircle stays at helmetY).
- **Headset:** New item; can equip on **head** or **EARS** box (drag to EARS). When equipped (head or ears): no alpha ring; **sound radius** = 2× leaper SOUND_RADIUS (360px). Enemies inside that radius get a **blue outline** (headsetSoundOutlines, depth 92) so you "hear" them through the dark. CONFIG: headset in VALID_IDS, INVENTORY_ITEMS (size 2×1, category armor); armor.ears slot; DEFAULT_STATS.armor.ears; lighting checks armor.head.itemId === 'headset' or armor.ears.itemId === 'headset'.
- **Medkit:** New item **medkit** (1×2, category **medical**), 120/120 usage. CONFIG.LOOT: VALID_IDS, INVENTORY_ITEMS (label Medkit, icon MK); placeItem/tryAddItem/tooltips/drop/giveItem use durability 120 for medkit. applyLoot case 'medkit' adds to backpack with 120/120. Level 2 loot pool includes medkit. One-time gift: givenMedkitGift adds one medkit to backpack on CONTINUE.
- **HP below body:** Large bold "HP: current/max" below body outline (bodyAreaBottom + 84). Color by % of max: green ≥50%, orange 35–49%, red <35%. Fill uses string hex (#00ff00, #ff8800, #ff0000) so colors render; fontStyle: 'bold'.
- **Darkness:** Darkness rectangle alpha 0.96 for testing. Light circle uses base radius only; headset no longer draws the 0.85 alpha ring.

---

## Backup & revert

- A backup of the codebase exists so you can revert if new features break something. Restore from that backup if needed before continuing.

---

## Previous session: Both arms broken (limb/arm feature)

- **Definitions (game.js):**
  - **Both arms broken** = both arms have the **Break** effect (`effects` includes `'break'`). Not 0 HP.
  - **Arms blacked** = arms at 0 HP (limbs take damage from hits until blacked; `hitPlayer` distributes to random limbs including `leftArm`/`rightArm`).

- **`hasNoGoodArms()`** (game.js): `limbHasBreak(limbHp, 'leftArm') && limbHasBreak(limbHp, 'rightArm')`. Used for door delay, 1-damage penalties, flashlight 30%, weapon list, recovery cost.

- **When both arms broken:**
  - **Weapons:** Can use any weapon (shotgun, etc.); **1 damage per shot** via `applyArmPenaltyDamage()` (bypasses armor). Same for grenade (1 damage + "Pulling pin..." delay) and loot (crate/body/dropped: 1 damage at start).
  - **Doors:** 1.5 s delay + "Trying the handle...". `checkDoor()` sets `doorPending`; **top of `update()`** completes it after 1500 ms (transitionToRoom / enterRiskRoom / exitRiskRoom / nextLevel).
  - **Flashlight:** Range 30% of normal (`CONFIG.PLAYER.FLASHLIGHT_RANGE * 0.3`).
  - **Leaper pin recovery:** Always allowed. **2 damage per broken arm** (4 when both), `bypassArmor: true`, then break free.

- **One arm broken (unchanged):** Two-handed forced to sidearm; reload/melee/grenade/search slower or delayed; no 1-damage-per-use penalty.

- **Test flag:** GameScene init has `APPLY_BOTH_ARMS_BROKEN` (default false). When true (with `APPLY_TEST_LIMB_STATUSES`), adds `'break'` to both arms so "both arms broken" is testable without in-play break damage.

- **Testing:** `TESTING.md` has step-by-step checks and optional console helpers (add/remove break, zero arm HP). Finish verifying door delay and 1-damage in play; then consider this feature done and start a new chat if needed.

---

## Recent session: Ammo types, loot pools, shotgun/pocket+rig reload

- **Ammo types (Phase A):** CONFIG.AMMO_TYPES (crossbow→ammo_bolts, shotgun→ammo_shells, pistol→ammo_9mm, smg→ammo_45, rifle→ammo_556) with label and color. getAmmoIdForWeapon(weapon). All five in VALID_IDS and INVENTORY_ITEMS (1×1, stackMax 99). Loot: LEVEL_POOLS and ENEMY_DROPS use typed ammo; RISK_ROOM.BONUS_LOOT; applyLoot count + display for ammo_* (sfx.lootAmmo, "+5 Shells" etc.).
- **Reserve & reload:** getReserveAmmoCount(stats, weapon) — shotgun = pocket + rig only; pistol/smg/rifle/crossbow = backpack + rig + pockets. removeReserveAmmo(stats, weapon, count): shotgun takes from pockets then rig; others from backpack then rig then pockets. countItemInPockets(stats, itemId), removeItemFromPockets(stats, itemId, count).
- **startReload:** Uses getReserveAmmoCount and removeReserveAmmo; "NO SHELLS!" / "NO 9MM!" etc. from CONFIG.AMMO_TYPES. UI (inventory panel, HUD, level-transition stats) shows reserve via getReserveAmmoCount for current weapon.
- **Magazines (done):** Phase B+ implemented: mag items, equip/swap on weapon, fill mag (drag ammo), R reload from rig/pocket, firing from mag, HUD, ground drop, trader. Migration = one mag per slotted weapon. **TESTING_FEEDBACK follow-ups complete;** flashlight design deferred.

---

## Recent session: Med bag, pockets, grenades, key & plug

- **Med bag:** 2×2, MED slot + grid; positioned from pistol/sidearm slot: `pistolBagLeftX`, `medBagGapLeftOfPistol = 60`, `medBagOffsetX`, `medBagOffsetY` (e.g. -35, 160). Medical-only for drops into med bag; R rotate and Delete drop like secure container.
- **Pockets:** Fully detached; `pocketBlockLeftX = 250`. Offsets: `pocket1OffsetRight`, `pocket2OffsetRight`, `pocket3OffsetRight`, `pocket4OffsetRight`; pocket 4 gap = pocket 3→1 gap (derived). No backpack/rig reference for pocket positions.
- **Grenades:** Stack removed; grenades are 1×1 items (CONFIG `stackMax: 1`). Usable count = pocket + rig only (`getUsableGrenadeCount`). Throw uses `removeOneGrenadeFromPocketOrRig`. Loot/trader/start_grenade add as items; legacy `stats.grenades` migrated to backpack items on load.
- **Key:** INVENTORY_ITEMS.key (1×1, yellow `#ffd700`, "Door Key"). Loot adds to backpack/rig; doors use `hasDoorKey(this.playerStats)` (count in backpack + pockets + rig). HUD key icon uses same.
- **Spark plug:** INVENTORY_ITEMS.plug (1×1, "Spark Plug"); rare crate item in LEVEL_POOLS 2–6. Loot adds to backpack/rig. Generator: build with 10 scrap + (hasSparkPlug or plug in stash); consumes one from stash or clears hasSparkPlug.
- **Flashlight:** Note for Phase 4 — implement as weapon attachment, not standalone.

---


## Rig & inventory (current)

- **Unified container drag (in-run):** Backpack, rig, pockets, **secure container**, and **med bag** are one system. Any item in any of these can be dragged and dropped into any other (including med bag for **medical-only** items). Helpers: `isContainerDrag(drag)`, `removeFromContainerSource(drag)`, `putBackInContainerSource(drag, item)`, `getEffectiveDragSize(drag)` (for rotation). Drag can have `fromMedBag` / `container: 'medBag'`. Drop order: re-equip rig, then pocket zones, then backpack empty cells, then rig empty cells, then secure/med bag empty cells. Equipment slots (head/body/ears/rig, weapon slots) are separate.
- **Pockets:** `playerStats.pockets` = `[ pocket1[2], pocket2[2], pocket3[1], pocket4[1] ]` (2+2+1+1). **Fully detached** from backpack/rig: single anchor `pocketBlockLeftX = 250`; `pocketGapInner = 10`; per-pocket offsets: `pocket1OffsetRight`, `pocket2OffsetRight`, `pocket3OffsetRight`, `pocket4OffsetRight` (pocket 4 gap matched to 3→1 gap). Pocket slot size **20px**. Full drag/drop: to/from backpack, rig, other pockets; **Delete** drops to ground. **2×1 items** (e.g. rifle) fit in pocket 1 or 2; `POCKET_LAYOUT`, `pocketFitsSize`, `_spansFrom`. Row Y from `rigGridBottomY + pocketBackpackGap` (10px below rig). Tooltip on hover.
- **Rig (in-run):** Equippable in armor slot; **rig slot box 25px** (`rigSlotSize`). 4×2 grid first column aligned with backpack (`rigGridX = invGridX`). **Double-click** rig slot or rig in backpack opens rig window (pending drag so first click doesn't start drag). Drop rig from backpack onto rig slot to re-equip. Drag backpack/rig ↔ rig grid; Delete drops from rig to ground. Rig/pockets/backpack/secure block is 8px below primary weapon slot; `invGridY = 205` (fixed) so changing `primarySlotY` doesn't move the block.
- **Secure container (in-run):** 2×3 grid; slot "SEC" same size as BAG, left of backpack. Always equipped; drag/drop like rig; R to rotate. `secureContainerGrid`, `ensureSecureContainerStats()`. Persist to stash on death/exit not yet implemented.
- **Med bag (in-run):** 2×2 grid, **medical-only**; slot "MED" same size as rig/BAG. Positioned **60px left of pistol/sidearm slot** (`pistolBagLeftX`, `medBagGapLeftOfPistol`), with `medBagOffsetX` / `medBagOffsetY` for fine-tuning. Always equipped; drag/drop like secure container; only medical items can be placed in med bag. `medBagGrid`, `ensureMedBagStats()` on all run-stats load paths. Persist to stash on death/exit not yet implemented.
- **Item rotation:** While dragging from backpack or rig, press **R** to rotate item 90° (swap width/height). Ghost resizes; drop uses rotated size. `placeItem(..., extra, sizeOverride)` supports `{ sizeW, sizeH }`. Pockets: 2×1 allowed in pocket 1 & 2 only (no rotation in pockets).
- **Armor slot → backpack:** Helmet/vest/headset unequip to backpack only when drop is on an **empty backpack cell** (`emptyZone`). Do not relax this in the `fromSlot` block without tests.
- **Data:** Run state uses `this.playerStats` in Game scene, `this.stats` in Hideout. Drag can have `fromPocket`, `container: 'backpack'|'rig'`, `fromRig`, `fromSlot`, `placementId`, `rotated`; use container helpers above for any container target.

**Rig persistence:** Equipped rig and contents are persisted via `ensureRigStats()` on all run-stats load paths (getStartingStats, MainMenu CONTINUE, Hideout init, GameScene init); rig + contents survive level transition and death.

---

## Remaining workload (inventory/weapons)

**Plan:** `.cursor/plans/inventory_weapons_piece_by_piece.plan.md` — each piece is small, testable, and revertable.

**Done (inventory/weapons & items):**  
- Pieces 1.1–1.6: pockets (2+2+1+1, detached layout), unified container drag (backpack ↔ rig ↔ pockets ↔ secure ↔ med bag), rig re-equip, item rotation (R), double-click rig, pockets 2×1, rig persistence, backpack equippable (BAG 6×9), secure container (2×3 left of backpack), dropped items per room, weapon slots disconnected.  
- **Piece 1.7 — Med bag:** 2×2 grid, medical-only; MED slot 60px left of pistol slot (+ offsets); `medBagGrid`, `ensureMedBagStats()`; drag/drop + R rotate; persist to stash not yet implemented.  
- **Grenades:** One per cell (no stack); **usable only from pocket or rig**. `getUsableGrenadeCount(stats)`, `removeOneGrenadeFromPocketOrRig(stats)`; throw consumes from pocket/rig; loot/trader add grenade as item to backpack; migration from legacy `stats.grenades` to items. CONFIG grenade `stackMax: 1`.  
- **Door key:** Grid item (1×1, yellow `#ffd700`), stored in backpack when found. **`hasDoorKey(stats)`** = key in backpack/pockets/rig; all door checks use it. Key in INVENTORY_ITEMS; loot adds to backpack/rig.  
- **Spark plug:** Grid item (1×1, rare in crates); no longer key item. Loot adds to backpack/rig. **Generator (Hideout):** build with 10 scrap + (hasSparkPlug OR one plug in stash); consumes hasSparkPlug or removes one plug from stash. Plug in LEVEL_POOLS (levels 2–6) for lower-chance crate drops.  
- **Flashlight:** To become **weapon attachment** in Phase 4 (not implemented yet).

**Next (in order):**

1. **Phase 2 — UI reorg (remaining)**  
   Grenade section (2.2); key item section (2.3).

2. **Phase 3 — Weapon pool**  
   Limit usable weapons to weapon slots only (3.1); drop/store from weapon slot to ground and stash (3.2).

3. **Phase 4 — Attachment boxes**  
   Weapon outlines with attachment slots (4.1); drag mods onto/off weapon outlines (4.2). **Flashlight:** treat as weapon attachment when implementing.

4. **Phase 5 — Ammo types & magazines (done)**  
   Plan: `.cursor/plans/ammo_types_and_magazines.plan.md`. **Done:** Phase A + B+ (mag items, R reload, HUD, ground drop, trader, migration). **TESTING_FEEDBACK follow-ups done:** drag-mag onto weapon, rig→pockets (reload + pickup), hover/tooltip ammo, rounds on weapon slot, "empty click" feedback, mags in loot (bandits + crates; bosses excluded). **Deferred:** Flashlight per-weapon or body light (§3) — design workups first.

5. **Later — Quiver (crossbow)**  
   Quiver = equippable in **melee slot**; stores bolts; crossbow draws from quiver (or backpack if no quiver). Bolt from body (loot 0–1 bolt when killing with crossbow). Implement after ammo/magazines.

Start with **Phase 2**; use the plan's Test and Revert steps for each piece.

---

## Recent session: Magazine follow-ups & mag loot

- **TESTING_FEEDBACK done:** Drag-mag onto weapon fixed; rig→pockets for R reload and pickup-from-ground; hover/tooltip ammo (storage + mag slot); rounds on weapon slot (lower-right, 11px); "empty click... empty" when dry; duplicate hover widget removed (single larger tooltip); mag tooltip position/clipping fixed. **Mags in loot:** Bandits (ENEMY_DROPS.BANDIT) and crates (LEVEL_POOLS 1–6); bosses excluded. applyLoot gives mags random rounds (0–capacity). Crate pools: mag_pistol in 1–3, mag_smg in 2–3; 4–6 already had mags. **Flashlight:** §3 deferred; design workups before implementation.

---

## Recent session: In-run inventory UI reorg

- **Panel:** No "INVENTORY" title; 700×500 panel unchanged.
- **Primary weapon slot:** At top of panel; `primarySlotY = 85` (change this const to move only the primary slot). Full width (rig left edge to backpack+15), H 42. Not linked to secondary/sidearm/melee or block.
- **Block (rig, pockets, backpack, secure container):** Positioned 8px below primary; `invGridY = 205` (fixed) so block does not move when `primarySlotY` changes. Same relative spacing: rig → pockets → backpack; secure container slot + 2×3 grid left of backpack (centered, grid 8px left).
- **Secondary:** Y = `secondarySlotYRef - 5` (433→428). Same width as primary. Independent.
- **Sidearm:** 2×2 box (40×40), 15px **left** of body (abdomen/crotch): `bodyLeftX = bodyCenterX - bodySlotW/2`, then `sidearmCenterX = bodyLeftX - 15 - sidearmBoxSize/2`. Independent.
- **Melee:** 1×4 strip along right of backpack (8px gap), one equippable slot, no internal cells. Independent.
- **Vest/helmet/ears equip:** Fixed so dropping from any container (backpack, rig, pockets, secure) onto head/body/ears slot equips correctly (handling added inside `isContainerDrag` block).
- **Code ref:** Layout and hit zones in `game.js` → `renderInventoryPanel()`; primarySlotY / invGridY / weapon slot positions ~9994–10074 and ~10234–10256; bodyCenterX ~9482; drag/drop in same file (container helpers, weapon slot handling).

---

## Recent session: Limb/damage system — Phases 1–6 implemented

- **Phase 1 (Bedrock):** Single limb per hit when `damageSource` is set; `LIMB_TARGET_WEIGHT` and `pickOneLimbByWeight`; bullet, acid, melee, explosion call sites pass `damageSource` (and melee pass `meleeAttacker` / `enemyType`).
- **Phase 2 (Melee stance):** `MELEE_LIMB_POOLS` (upright / onAllFours), `MELEE_STANCE_BY_ENEMY`; melee uses stance-based pools; sticky zone (upper 60% / middle 30% / lower 10%) per attacker.
- **Phase 3 (Outcome roll):** Base outcome table and `rollOutcome`; one roll per hit (damage_only / minor_bleed / major_bleed / break / black); effects applied to chosen limb. **Combat log** (damage, limb, outcome, ARMOR) bottom-left of screen; toggle with **backtick (`)**; all damage paths log.
- **Phase 4 (Ranged bands):** `RANGED_CLOSE_MAX` (100), `RANGED_MEDIUM_MAX` (250), `RANGED_LIMB_BANDS`; bullet/acid use distance to pick limb (close = head/chest/arms, medium = torso, far = legs).
- **Phase 5 (Escalation):** `limbEffectHitCount` Map keyed by melee attacker; +5% effect outcomes per hit (cap 25%); 15 s timeout; cleanup when enemy inactive.
- **Phase 6 (Enemy modifiers):** `ENEMY_OUTCOME_MODIFIERS` (leaper +break, spitter +black, exploder +majorBleed, boss +black/+break); applied after escalation; acid treated as spitter.
- **Extra:** Zombies/bandits after 2 armor blocks bypass armor every other hit and target arms (zombies) or arms+legs (bandits). Enemy melee hit cooldown 700 ms so armor doesn't drain per frame. Vest 50 / helmet 30 durability.
- **Docs:** DESIGN.md has an "Implementation status" subsection; HANDOVER and plan are the source of truth for what's in and what to test.

---

## Current state (brief)

- **Trader Sell:** Sells from stash and backpack (weapons, armor, mods) via `CONFIG.TRADER.SELL_GRID`; `sellItem()` handles `type: 'grid'`; see "Trader Sell reference" below.
- **Hideout:** GEAR tab with weapon/armor slots, pockets, backpack, stash; draggable items; ammo box (2x2 in stash/backpack, 6x6 interior, double-click to open/close).
- **In-run inventory:** 700×500 panel, no title; body figure (helmet, neck, chest, arms, abdomen, crotch, legs, feet L/R). **Weapon slots (disconnected):** primary at top (`primarySlotY = 85`), full width; secondary below; sidearm 2×2 left of body; melee 1×4 strip right of backpack (8px gap). **Block** (8px below primary, `invGridY = 205`): rig 25px + 4×2, **pockets (detached**, `pocketBlockLeftX = 250`), BAG 6×9, SEC 2×3 left of backpack, **MED 2×2** (med bag, 60px left of pistol + offsets). Armor slots (head/body/ears/rig). Stats: HP, ammo, **GREN (pocket+rig)**, scrap; hover tooltip; armor durability. Key in backpack (yellow cell); doors use `hasDoorKey(stats)`. Helmet/vest/ears equip from any container; unequip to backpack only on **empty backpack cell**.
- **Room system:** Multi-room levels with doors; room state (enemies, crates, skulls) persists when leaving and re-entering; enemies in other rooms wander within 80px of their origin so the world feels alive.
- **Ammo:** Mag-capable weapons (pistol, SMG, rifle) use **magazines** (equippedMagazines, fill mag, mag slot, R reload from rig/pocket); HUD shows rounds/max. Mags in loot (bandits + crates; random rounds). Reserve/ammo box for other ammo. Rest in stash. Ammo box uses same drag/drop and movement logic as stash/backpack; open ammo box blocks clicks behind it. **`TESTING_FEEDBACK.md`** follow-ups complete; flashlight design deferred.
- **Quests:** Turn-in UI with amount selector and "All" button; progress (e.g. cigarettes turned in) is additive, not overwritten.
- **Levels:** Room chunks (800x600), wall colliders, optional PNG background; level design tool and templates (e.g. 800x600 landscape) exist or are in progress.
- **Enemies:** Placeholder/generated graphics when `CONFIG.SUSPEND_ENEMY_GRAPHICS` is true; otherwise PNG sprites. Level-specific variants (e.g. police walker) and rescueable NPCs are planned.

---

## Approach for next work

- **Pace:** One feature at a time.
- **Testing:** Test each change before moving on. Step-by-step checks for limb/arm behavior, doors, and core flows are in **`TESTING.md`**. **`TESTING_FEEDBACK.md`** magazine follow-ups are complete; flashlight §3 deferred for design. For limb/damage, use the **testing strategy per phase** in **`.cursor/plans/limb_effects_phased_implementation_bf516cf0.plan.md`** (Phases 1–6).
- **Plans:** Limb/damage plan is **implemented**; use it for test checklist and tuning. Graphics/inventory milestone: `.cursor/plans/graphics_inventory_enemies_milestone_52b83ca6.plan.md`.

**Next session (planned):**

1. **Inventory/weapons**  
   See **"Remaining workload"** above. **Phase 2** next (grenade section 2.2, key item section 2.3), then Phase 3–4. Plan: `.cursor/plans/inventory_weapons_piece_by_piece.plan.md`.

2. **Flashlight (design first)**  
   Per-weapon vs body light; design workups before implementation. See **`TESTING_FEEDBACK.md`** §3.

3. **Limb/damage testing and tuning**  
   Play-test: single limb per hit, melee stance, outcome roll and combat log, ranged bands, escalation, enemy modifiers. Tune constants if needed; use TESTING.md and limb plan.

4. **Optional: both-arms-broken verification**  
   Door delay, 1 damage per shot/grenade/loot; use TESTING.md.

5. **Med system**  
   Skeleton silhouette when dragging med item to body or double-click.

6. **Rig / armor UX (fragile)**  
   Container drag is unified; do not relax "empty backpack cell" for helmet/vest unequip without a clear spec and tests.
