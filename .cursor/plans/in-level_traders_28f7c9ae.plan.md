---
name: In-Level Traders
overview: Add optional in-level traders (safehouse NPCs) that spawn in one random non-start, non-exit room per level. Player interacts with F near the trader to open a buy/sell modal; same currencies and logic as Hideout trader, with a smaller stock subset.
todos: []
isProject: false
---

# In-Level Traders (Safehouse NPCs)

## Goal

Add **in-level traders** that can appear in one random room per level. Player approaches and presses **F** to open a buy/sell shop modal. Same run currencies (scrap, credits, materials) and Haggler discount; stock is a subset of the Hideout trader for a "quick stop" feel.

---

## Design Decisions


| Decision       | Choice                                                                                 | Rationale                                        |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Spawn rate     | One trader per level, ~20–25% chance (like risk room)                                  | Avoid clutter; optional find                     |
| Eligible rooms | Non-start, non-exit, non-boss chunk                                                    | Start/exit are special; boss levels stay focused |
| Stock          | Subset of Hideout (ammo, med kit, grenade, consumables; no mods in-level)              | Quick resupply, not full shop                    |
| Sell           | Same as Hideout (armor, consumables, mods)                                             | Reuse economy                                    |
| Interaction    | F key when within `CONFIG.DISTANCES.INTERACT` (60px)                                   | Matches crates/doors                             |
| Visual         | Placeholder: rectangle + "TRADER" text (or reuse door/crate sprite with distinct tint) | No new art required                              |


**Eligible rooms per level** (non-start, non-exit; trader can spawn in at most one):


| Level | Grid | Total rooms | Eligible (middle)         |
| ----- | ---- | ----------- | ------------------------- |
| 1–3   | 2×2  | 4           | 2                         |
| 4     | 3×2  | 6           | 4                         |
| 5     | 2×1  | 2           | **0** (start + exit only) |
| 6     | 3×2  | 6           | 4                         |
| 7     | 2×1  | 2           | **0** (start + exit only) |


So levels 5 and 7 never get an in-level trader; all others can (subject to spawn chance).

---

## Files to Change

- **[game.html](game.html)** — all implementation (CONFIG, room generation, setupRoom, interact check, in-level trader modal).

---

## Implementation Plan

### 1. CONFIG

- **CONFIG.TRADER**
  - Add `IN_LEVEL_SPAWN_CHANCE: 0.25` (or 0.2).
  - Add `IN_LEVEL_STOCK`: array of item IDs or items from `HIDEOUT_STOCK` (e.g. ammo_bundle, med_kit, grenade, adrenaline, armor_patch only — no mods).
- **CONFIG.DISTANCES** (optional): Add `TRADER: 60` for clarity, or reuse `INTERACT: 60`.

### 2. Room generation (`generateRoomGrid`)

- After the risk-room assignment block (~6898–6912):
  - Consider only rooms where `!room.isStart && !room.isExit && !room.chunk.isBossRoom`.
  - With probability `CONFIG.TRADER.IN_LEVEL_SPAWN_CHANCE`, pick one random eligible room and set `room.hasTrader = true`.
  - Ensure each room object has `hasTrader: false` by default when pushed (same pattern as `hasRiskRoom`).

### 3. setupRoom

- At the start of `setupRoom`, clear any existing in-level trader:
  - If `this.traderNPC` (sprite/graphic) exists, destroy it and set to `null`.
- After building doors/exit/risk door:
  - If `roomData.hasTrader`:
    - Create a visible "trader" at a fixed position (e.g. center of room `400, 300` or offset so it doesn’t overlap exit/risk door). Use a Phaser graphic (e.g. rectangle) + text "TRADER" or a sprite with a distinct tint.
    - Store in `this.traderNPC` and set a property (e.g. `this.traderNPC.isTrader = true`) so the interact check can identify it.
    - No physics body needed; interaction will be distance-based from player.

### 4. Interact order (F key)

- In the F-key handler (~8158), add **checkTrader** before **tryInteract**:
  - After `checkDoor()` and before `tryInteract()`:
    - If `this.traderNPC` exists and distance from player to `this.traderNPC` is &lt; `CONFIG.DISTANCES.INTERACT` (60), call `this.openInLevelTrader()` and return.
- So order: `checkDebris` → `checkSwitch` → `checkDoor` → **checkTrader** → `tryInteract`.

### 5. In-level trader modal (GameScene)

- **openInLevelTrader()**
  - Set a flag so gameplay is paused (e.g. `this.traderOpen = true` or `this.isPaused = true`), same way inventory or other modals work.
  - Build a modal similar to Hideout’s trader: dark overlay, panel, title "TRADER", currency line (scrap, credits, materials from `this.playerStats`).
  - **Buy tab**: List only `CONFIG.TRADER.IN_LEVEL_STOCK`. Each row: name, cost (with Haggler discount if `this.persistent.unlockedSkills` includes `haggler`), BUY button. On BUY: deduct from `this.playerStats`, apply item (ammo, heal, grenade, consumable) — **no mods** in-level if you restrict stock that way; if you include mods, add to `this.persistent.modInventory`.
  - **Sell tab**: Same sellables as Hideout (armor, consumables, mods) using `this.playerStats` and `this.persistent`; add credits/materials to `this.playerStats`.
  - **Close button**: Destroy all modal elements, clear `this.traderOpen` / unpause, optionally refresh HUD (e.g. stat text).
- Reuse **logic** from HideoutScene’s `purchaseItem` / `sellItem` where possible. Options:
  - **A)** Extract shared helpers (e.g. `applyPurchase(stats, persistent, item)`, `applySell(stats, persistent, item)`) and call from both Hideout and GameScene.
  - **B)** Implement small GameScene-specific versions that operate on `this.playerStats` and `this.persistent` (duplicate logic but no refactor of Hideout).

Recommendation: **B** for minimal change; refactor to A later if desired.

### 6. Edge cases

- **No room grid (legacy single-room)**: If `this.roomGrid` is null, skip trader spawn and `checkTrader` (traderNPC will never exist).
- **Levels with only 2 rooms (5 and 7)**: Level 5 (Hospital) and Level 7 (Cemetery) are 2×1 grids: one start room, one exit room. There are **no** non-start, non-exit rooms, so `eligibleRooms` is empty and **no trader ever spawns** on those levels. No code change needed—the existing filter naturally gives zero eligible rooms. Other levels have at least 2 eligible rooms (1–3: 4 rooms total → 2 eligible; 4 and 6: 6 rooms → 4 eligible).
- **Boss levels (5, 7)**: Because they only have 2 rooms, traders already never appear there. If you later add more rooms to boss levels, you could explicitly exclude levels 5 and 7 from trader spawn so the boss run stays focused; for now it’s redundant.
- **Transition**: When transitioning rooms, `setupRoom` clears and recreates room content; destroying `this.traderNPC` at the start of `setupRoom` ensures the previous trader is removed and the new room’s trader (if any) is created in the same function.

### 7. Optional polish

- **SFX**: Reuse `sfx.purchase()`, `sfx.sell()`, `sfx.menuOpen()`, `sfx.menuClose()` when opening/closing and on buy/sell.
- **HUD**: After closing the in-level trader, refresh any on-screen stat text (e.g. credits/scrap/materials) so the player sees updated values.

---

## Data / Config Summary

- **CONFIG.TRADER**: `IN_LEVEL_SPAWN_CHANCE`, `IN_LEVEL_STOCK`.
- **Room**: `hasTrader: true` on at most one eligible room per level.
- **GameScene**: `this.traderNPC`, `this.traderOpen` (or use existing pause flag).

---

## Testing

1. Start a run and visit multiple levels; verify at most one trader room per level and only in non-start, non-exit rooms.
2. Approach trader, press F; modal opens, game paused.
3. Buy ammo/med/grenade/consumable; credits/scrap decrease, inventory updates.
4. Sell armor/consumable/mod; credits/materials increase.
5. Close modal; game resumes, HUD shows correct currencies.
6. Leave room and re-enter; trader still there (same room). Enter another room; no trader there unless that room was chosen as trader room.
7. Boss levels: confirm intended behavior (trader allowed in non-boss room vs. no trader on 5/7).

---

## ROADMAP / PROJECT_GUIDE

- In [ROADMAP.md](ROADMAP.md): Move "In-level traders (safehouse NPCs)" from deferred to a small "Milestone 10" or "Post-v0.6" section and mark complete after implementation.
- In [PROJECT_GUIDE.md](PROJECT_GUIDE.md): Under CONFIG.TRADER or a new subsection, document `IN_LEVEL_SPAWN_CHANCE` and `IN_LEVEL_STOCK` and that in-level traders use the same run stats and F to interact.

