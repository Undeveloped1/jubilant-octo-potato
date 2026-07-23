---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Stash on CHARACTER only — STASH tab removed

**Goal:** The only stash UI in the game is the CHARACTER screen. Move all stash logic from the STASH tab into the CHARACTER tab (player window + stash section + move buttons). Remove the STASH tab entirely. There is no other instance where we use a stash UI — just this one main screen.

---

## Current state (brief)

- **CHARACTER tab:** Dark backdrop + player window (inventory panel: body + rig/pockets/backpack/secure/med/weapons). No stash. No move buttons.
- **STASH tab (to be removed):** `renderStashTab()` — stash grid (16 cols) + backpack grid (6×9), tooltip, **ALL→** / **→ STASH** / **→ PACK**, drag between grids, "selected item" state, `stashCleanup` for listeners. All of this logic moves into the CHARACTER flow.
- **Footer (all tabs):** Main Menu, Settings, Mission Map at y=565.
- **Data:** Stash lives in `this.persistent.stash`; used elsewhere only for data (e.g. generator build, trader sell list, quests) — no other stash *UI*.

---

## 1. One screen: CHARACTER = loadout + stash (STASH tab goes away)

**Decision:** STASH tab is removed. The main hideout screen for gear and storage is the CHARACTER tab only. It will show:

- Player window (existing: body, rig, pockets, backpack, secure, med, weapons).
- Stash section: stash grid + move buttons (ALL→, → STASH, → PACK) + tooltip + selected-item behavior — all logic taken from `renderStashTab()`.
- Backpack exists only in the player window (no duplicate backpack grid on this screen).

**Layout:** Stash to the right of the player window. Player window left; stash grid right (e.g. 8–12 cols visible, scroll if needed). Move buttons below stash or in a bar between player window and stash.

**Implementation outline:**

1. **Layout**
  - In CHARACTER tab: keep current player window position/size (or shrink slightly if needed).
  - Reserve a "stash strip" to the right of the player window (from `invPanelLeft + invPanelW + margin` to right edge, or fixed width).
  - Stash grid: same cell size / draw logic as current `renderStashTab()` (e.g. `drawGrid(stashX, stashY, stash, 'STASH', cols)`). Either 16 cols with horizontal scroll or fewer cols (e.g. 8) with scroll.
2. **Data**
  - `this.persistent.stash` (unchanged). No new state.
3. **Where to draw**
  - When `tabId === 'character'`: after backdrop and `renderInventoryPanel()`, call a helper (e.g. `renderCharacterTabStash()`) that draws the stash grid and move UI, pushes everything into `this._invContent`.
4. **Drag & drop**
  - Move logic from `renderStashTab()`: pointer down/move/up; hit-test stash vs backpack zones; move items between `persistent.stash` and `stats.backpack`. Same behavior as current STASH tab.
5. **Remove STASH tab**
  - Remove the STASH tab from the tab bar (tabs become: CHARACTER, FACILITIES, TRADER, EXTRAS).
  - Delete or gut `renderStashTab()` once all logic lives in the CHARACTER stash section. Remove `case 'stash'` from `showTab()` and any `stashCleanup` used only by the old STASH tab (cleanup for CHARACTER stash goes through `_invContent` when leaving CHARACTER).

---

## 2. Move buttons and footer on CHARACTER tab

- **Move buttons:** ALL→, → STASH, → PACK live on the CHARACTER tab with the stash section (e.g. below stash grid or in a toolbar). Same behavior as current STASH tab: "selected item" + move one or move all. Track selection in e.g. `this._stashSelected`; clear when switching tabs or on move. Add to `_invContent`.
- **Footer:** Main Menu, Settings, Mission Map — ensure depth > 300 (e.g. 400) in `renderFooter()` so they stay on top and clickable over the CHARACTER backdrop.

---

## 3. Implementation order

1. **Footer depth** — Set depth on footer elements to e.g. 400 so they’re above CHARACTER backdrop/panel.
2. **Stash on CHARACTER** — Add stash section (e.g. `renderCharacterTabStash()`): layout stash area right of player window; draw stash grid; add to `_invContent`.
3. **Drag between stash and backpack** — Port pointer handlers from `renderStashTab()` so items can be dragged/cursor-selected and moved between `persistent.stash` and `stats.backpack`.
4. **Move buttons on CHARACTER** — Add ALL→, → STASH, → PACK; wire to same move logic as current STASH tab; track selected item for → STASH / → PACK.
5. **Remove STASH tab** — Remove stash from tab bar (4 tabs: CHARACTER, FACILITIES, TRADER, EXTRAS). Remove `case 'stash'` and `renderStashTab()` (or gut it after logic is migrated). Cleanup when leaving CHARACTER via `_invContent` and clear `_stashSelected`.

---

## 4. Files / entry points

- **game.js**
  - HideoutScene: `showTab()`, `create()` (CHARACTER branch). Add stash section + move buttons when building CHARACTER tab.
  - New: helper for stash + move buttons on CHARACTER (e.g. `renderCharacterTabStash()`), containing logic migrated from `renderStashTab()`.
  - `renderStashTab()`: migrate all logic into CHARACTER flow, then remove the method and the STASH tab.
  - `renderFooter()`: set depth for footer elements.
  - `renderTabs()`: remove stash from tabs array; update `updateTabStyles()` tab list to 4 tabs.

---

## 5. Open decisions

- Stash grid on CHARACTER: **fixed width (e.g. 8 cols) with scroll**, or **full 16 cols** and shrink player window?
- "Selected item" for → STASH / → PACK: same as current STASH tab (click to select, then button) or also support "last dragged" as implicit selection?

