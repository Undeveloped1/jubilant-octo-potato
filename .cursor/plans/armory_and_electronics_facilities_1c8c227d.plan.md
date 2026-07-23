---
name: Armory and Electronics Facilities
overview: Add an Electronics facility (NVG craft moved there), redesign the Armory with weapon/armor/mod scrapping and leveled ammo/grenade production with timers, and introduce a 5-tier armory upgrade tree with config-driven recipes and timers.
todos: []
isProject: false
---

# Armory and Electronics Facilities Plan

## Current state

- **Facilities tab** ([game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) ~5096–5160): Row 1 = Rest Area, Generator, **Armory**. Row 2 = Workbench, Repair Station. Each facility is a card built by `createFacilityCard`, `createArmoryFacilityCard`, etc.
- **Armory** ([game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) ~5196–5280): Holds NVG craft (3 scrap, timer 90s via `CONFIG.TIMINGS.NVG_CRAFT`) and an **ammo press** button that instantly converts 1 scrap → 4 generic `ammo` (no timer). State: `stats.hideout.armory = { crafting: null, hasNVG: false }`.
- **NVG** is referenced in game scene for toggle ([game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) ~16343, 18273): `this.playerStats.hideout.armory.hasNVG`.
- **Ammo types**: Stash uses `ammo_9mm`, `ammo_45`, `ammo_shells`, `ammo_556`; generic `ammo` exists in CONFIG and is used by current ammo press and some legacy paths.

---

## 1. Electronics module (new facility)

- **Add** a new facility card **Electronics** in the Facilities tab (e.g. Row 2, replacing or shifting layout so you have Rest Area, Generator, Armory on row 1; Workbench, Repair Station, **Electronics** on row 2, or similar).
- **Implement** `createElectronicsFacilityCard(x, y, w, h)` modeled on the current Armory card:
  - Same NVG craft: cost 3 scrap, same timer (`CONFIG.TIMINGS.NVG_CRAFT`), same “CRAFT NVG” / “CRAFTING…” / “CLAIM NVG” / “EQUIPPED” flow.
  - Card title e.g. “ELECTRONICS”, description and timer text for NVG only.
- **Data model**: Add `stats.hideout.electronics = { crafting: null, hasNVG: false }`. Move NVG ownership and crafting from armory to electronics:
  - **Remove** from `stats.hideout.armory`: `hasNVG` and any `crafting` that is for NVG.
  - **All reads/writes** of `armory.hasNVG` and `armory.crafting` (when `item === 'nvg'`) switch to `electronics.hasNVG` and `electronics.crafting`.
- **References to update**: Hideout scene `createArmoryFacilityCard` (strip NVG UI and logic), `update()` timer text (either remove armory NVG timer or point to electronics), `createArmoryCard` (if still used elsewhere), and **game scene** checks for NVG (e.g. ~16343, 18273) from `armory.hasNVG` to `electronics.hasNVG`.
- **Persistence**: Ensure default hideout and any save migration set `electronics: { crafting: null, hasNVG: false }` and, if loading old saves, set `electronics.hasNVG = armory.hasNVG` and clear `armory.crafting` when it was NVG so nothing is lost.

---

## 2. Armory: scrapping and “GO” + timer

- **Scrap input slot**: One slot on the Armory card that accepts a single item (weapon, armor, mod, ammo, or grenade, depending on armory level). Implement as a small “drop zone” (rectangle + hit test) when Facilities tab is active; reuse existing hideout/stash drag patterns (e.g. from character tab stash drag) so the user can drag from stash into this slot. Store in state, e.g. `stats.hideout.armory.scrapSlot = { itemId, count, ... }` or `null` when empty.
- **“GO” button**: When slot has an item and no job is running, clicking “GO”:
  - Consumes the item from the slot (remove from slot; if item came from stash, remove from stash).
  - Determines scrap yield (see table below) and starts a **scrap job** with a **timer** (e.g. 60s for level 1).
  - On timer finish: add that much scrap to `persistent.scrap` (or a small “output” state that user must click to collect, as you prefer; plan assumes “produce X scrap to pickup” so either add to persistent.scrap after timer or add to “armory.outputScrap” and a “PICKUP” step).
- **Scrap yield table** (config-driven): e.g. in `CONFIG.HIDEOUT.ARMORY_SCRAP_YIELD` or similar:
  - Weapons: pistol, shotgun, smg, crossbow, rifle → e.g. 3–8 scrap each (tune as you like).
  - Armor: helmet, headset, vest → e.g. 2–5 each.
  - Mods: extended_mag, suppressor, laser_sight, damage_barrel, rapid_fire → e.g. 1–3 each.
  - Bullets: ammo_9mm, ammo_45, ammo_shells, ammo_556 → 1 scrap per unit (or per stack; you said “scrap bullets (1:1)” at level 5).
  - Grenades: grenade → e.g. 2–4 scrap each.
- **State shape** (example): `armory: { level: 1, scrapSlot: null, job: null }` where `job = { type: 'scrap', finishTime, outputScrap }`. When `Date.now() >= finishTime`, show “PICKUP” and on click add `outputScrap` to `persistent.scrap`, clear `job`, update UI.

---

## 3. Armory: ammo (and later grenade) production with timer

- **Remove** the current instant “AMMO PRESS (1 SCRAP = 4 AMMO)” behavior from the Armory card.
- **Replace** with leveled ammo crafting:
  - **Level 1**: 1 scrap → 4× `ammo_9mm`, 60s timer.
  - **Level 2**: 1 scrap → 3× `ammo_shells`, 60s timer.
  - **Level 3**: 1 scrap → 4× `ammo_45`, 60s timer.
  - **Level 4** (your “lvl 5”): 1 scrap → 5× `ammo_556`, 120s timer.
  - **Level 5** (your “lvl 6”): 1 scrap → 1× `grenade`, 180s timer.
- **Flow**: User spends 1 scrap and clicks “CRAFT 9MM” (or equivalent label per level). Start a job, e.g. `armory.job = { type: 'ammo', itemId: 'ammo_9mm', count: 4, finishTime: Date.now() + 60000 }`. When timer completes, show “PICKUP” (or “CLAIM”); on click, `tryAddItem(this.persistent.stash, 'ammo_9mm', 4)` (and similar for other ammo/grenade), clear `job`, update UI.
- **Config**: Add e.g. `CONFIG.HIDEOUT.ARMORY_LEVELS` (or `ARMORY_CRAFT`) as an array of levels, each with `{ level, scrapRecipe: { input: 1, outputItemId, outputCount }, timerMs }`, and optionally `scrapItemTypes: ['weapon']` for what the scrap slot accepts at that level. Same timers: 60s, 60s, 60s, 120s, 180s.

---

## 4. Armory upgrade tree (levels 1–5)

- **Levels**: 1 → 2 → 3 → 4 → 5. Unlock via scrap (and optionally other currencies) as with Rest Area / Workbench. Store `stats.hideout.armory.level` (1–5). Level 0 = not built; level 1 = scrap weapons + craft 9mm; etc.
- **Unlock costs**: Define in CONFIG (e.g. `ARMORY_LEVEL_COST: [0, 0, 20, 40, 60, 80]` so level 1 is free when armory is “built”, then 20 scrap for level 2, etc.). First level can be “built” with an initial scrap cost if you want.
- **Per-level behavior** (summary):


| Level | Scrap slot accepts      | Scrap → output (timer)     | Ammo/Craft (timer)          |
| ----- | ----------------------- | -------------------------- | --------------------------- |
| 1     | Weapons                 | Weapon → X scrap (60s)     | 1 scrap → 4× 9mm (60s)      |
| 2     | Weapons, Armor          | Armor → X scrap (60s)      | 1 scrap → 3× shells (60s)   |
| 3     | Weapons, Armor, Mods    | Mod → X scrap (60s)        | 1 scrap → 4× .45 (60s)      |
| 4     | + Bullets (ammo stacks) | Bullets → 1:1 scrap (120s) | 1 scrap → 5× 5.56 (120s)    |
| 5     | + Grenades              | Grenade → X scrap (180s)   | 1 scrap → 1× grenade (180s) |


- **UI**: Armory card shows current level, scrap input slot, “GO” (scrap) and “CRAFT [AMMO/GRENADE]” (and timer / “PICKUP”) as appropriate. Optionally show “UPGRADE (Y SCRAP)” to advance to next level when not maxed.

---

## 5. Implementation order and files

1. **CONFIG** ([game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) ~256, ~384): Add `TIMINGS.NVG_CRAFT` (unchanged). Add `HIDEOUT.ELECTRONICS` (or keep NVG under existing TIMINGS). Add `HIDEOUT.ARMORY_LEVELS` (array of level configs: scrap accept types, scrap yield map, craft recipe, timerMs). Add `HIDEOUT.ARMORY_SCRAP_YIELD` (itemId → scrap amount). Add `HIDEOUT.ARMORY_LEVEL_COST` for upgrade costs.
2. **Default state and migration**: In default `stats.hideout`, add `electronics: { crafting: null, hasNVG: false }`, add `armory.level` (1), change `armory` to `{ level: 1, scrapSlot: null, job: null }` (and remove `hasNVG`/`crafting` from armory after migration). One-time migration: if `armory.hasNVG` exists, set `electronics.hasNVG = armory.hasNVG`; if `armory.crafting?.item === 'nvg'`, move to `electronics.crafting`.
3. **Electronics card**: Add `createElectronicsFacilityCard()` with NVG-only UI and timer; in `renderFacilitiesTab()` add the Electronics card (row 2, third slot or new row).
4. **Armory card**: Remove all NVG UI and logic; add scrap slot (draw rect, store bounds; on stash drag-end in Facilities, if over slot and item allowed for current level, put in `armory.scrapSlot` and remove from stash). Add “GO” (scrap job + timer), “CRAFT [X]” (ammo/grenade job + timer), and “PICKUP” when job done. Add level display and “UPGRADE” when applicable. In scene `update()`, drive armory (and electronics) timers and refresh card text.
5. **Game scene**: Replace `hideout.armory.hasNVG` with `hideout.electronics.hasNVG` everywhere (~16343, 18273).
6. **Legacy ammo press**: Remove the old instant `tryAddItem(..., 'ammo', 4)` path; replace with the leveled 9mm craft (1 scrap → 4 ammo_9mm, 60s) at armory level 1. If any code still uses generic `ammo`, consider leaving a fallback or migrating those to `ammo_9mm` where appropriate.

---

## 6. Open decisions (to confirm)

- **Scrap slot source**: Drag from stash only, or also from backpack when in hideout? (Recommend: stash only for simplicity.)
- **“X scrap to pickup”**: Add scrap directly to `persistent.scrap` when timer ends, or add to `armory.outputScrap` and require a “PICKUP” click? (You said “produce X scrap to pickup”, so a PICKUP step is assumed in the plan.)
- **Level 4 numbering**: You wrote “lvl 5” and “lvl 6” for the last two tiers; plan uses levels 1–5 for the tree. Confirm if you want 6 levels with level 4 being a separate unlock (e.g. cosmetic or future feature) or strictly 5 levels.

This keeps Electronics and Armory clearly separated, makes the armory level-driven and config-driven, and preserves existing NVG behavior under Electronics with the same cost and timer.