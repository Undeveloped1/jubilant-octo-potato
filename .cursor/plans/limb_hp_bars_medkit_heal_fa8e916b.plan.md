---
name: Limb HP Bars Medkit Heal
overview: Add per-limb HP (head 30, arms 15 each, legs 20 each, chest 50, abdomen 25, crotch 15), draw health bars and optional status in the Health view, and allow dragging the medkit onto a limb bar to heal that limb and consume medkit durability.
todos: []
isProject: false
---

# Limb HP, Health Bars, and Medkit Drag-to-Heal

## Goal

In the **Health** body view: each limb has its own HP and a health bar; each can show a status effect; the player can **drag the medkit** (or other medical items) from the backpack **onto a limb's health bar** to heal that limb (consuming medkit durability). Limb max HP: head 30, left arm 15, right arm 15, chest 50, abdomen 25, crotch 15, left leg 20, right leg 20 (total 190).

## Current state

- Player has single [game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) `playerStats.hp` / `playerStats.maxHp` (e.g. 10/10 or 20/20 from DEFAULT_STATS). Damage applied at ~11702 (`this.playerStats.hp -= damage`); death at `hp <= 0`.
- Medkit: [CONFIG.LOOT.INVENTORY_ITEMS](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) medkit 1x2, category `'medical'`, durability 120/120.
- Health view in [renderInventoryPanel](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) (~8979–9125): draws skeleton only; `armorSlotZones = []` so no body drop targets. Drag/drop uses `itemZones` (backpack), `weaponSlotZones`, `armorSlotZones`, and `emptyCellZones` in `onPointerUp`.

## 1. Data model: per-limb HP and status

- Add a **limb HP** structure on run stats, e.g. `playerStats.limbHp`:
  - Keys: `head`, `leftArm`, `rightArm`, `chest`, `abdomen`, `crotch`, `leftLeg`, `rightLeg`.
  - Each: `{ hp, maxHp, status?: string }` with your specified max values (head 30, arms 15 each, chest 50, abdomen 25, crotch 15, legs 20 each).
- Add to [DEFAULT_STATS](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js) (~1026) a `limbHp` object with all limbs at full (hp = maxHp), and optional `status: ''` or omit.
- **Migration**: wherever run stats are loaded (e.g. start run from DEFAULT_STATS, or load save at ~7353), if `stats.limbHp` is missing, initialize it with full HP for each limb and, if desired, set `stats.hp`/`stats.maxHp` to the sum of limb hp (190) so total HP and death stay consistent. Existing saves without limbHp get this init once.

## 2. Keep global HP in sync (optional but recommended)

- Either:
  - **Option A**: Treat limb HP as source of truth: `playerStats.hp` = sum of `limbHp[].hp`, `playerStats.maxHp` = 190. When any limb is healed/damaged, recompute `hp` (and use existing death check `hp <= 0`). When applying damage (e.g. at ~11702), reduce one or more limbs (e.g. pick a limb or distribute) then set `playerStats.hp` = sum(limb hp).
  - **Option B**: Keep current global hp for combat/death; limb HP is separate and only used in Health view and for medkit healing. Total display in Health view can show "Sum of limbs" or keep showing global.
- Plan recommends **Option A** so one pool of HP and death/thresholds stay simple.

## 3. Health view UI: limb list, bars, status

- In [renderInventoryPanel](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js), inside the `else` branch that draws the skeleton (Health view), **after** the skeleton:
  - Define a small **layout** for 8 rows (or 2 columns): one entry per limb (head, leftArm, rightArm, chest, abdomen, crotch, leftLeg, rightLeg). Reuse existing layout vars (bodyCenterX, bodyAreaTop, bodyWidth, etc.) so bars sit to the right of the skeleton or below it within the body area.
  - For each limb: draw **label** (e.g. "HEAD"), **health bar** (background rect + fill rect by hp/maxHp, green/orange/red by %), **text** "current/max" (e.g. "30/30"), and optional **status** text (e.g. "—" or empty; later bleeding/fracture).
  - Store **hit zones** for each limb (left, right, top, bottom) for the bar or the whole row so drop detection works.

## 4. Limb drop zones and medkit drop logic

- When `invBodyView === 'health'`, build a **limbZones** array: one zone per limb with `{ id: 'head' | 'leftArm' | ... , left, right, top, bottom }` matching the bar/row positions.
- In **onPointerUp** (and any other place that handles drop targets), after existing weapon/armor/empty-cell checks:
  - If `invBodyView === 'health'` and we have a drag with a **medical item** (e.g. `drag.placementId` and item from backpack with `itemId === 'medkit'` or CONFIG category `'medical'`), and the pointer is over a **limb zone**:
    - **Heal**: add HP to that limb (e.g. 1 medkit durability = 1 HP to that limb, or a fixed amount like 5 HP per use; cap limb at maxHp).
    - **Consume**: decrement medkit durability (or remove item if 0); if durability becomes 0, remove the medkit from backpack.
    - Update `playerStats.hp` if using Option A (sum of limb hp).
    - Call `rerender()` to refresh bars and total.
    - Play a short heal SFX if available.

## 5. Helper: is medical item

- Add a small helper (e.g. in game.js near CONFIG or near inventory helpers): `function isMedicalItem(itemId) { const cfg = getInventoryItemConfig(itemId); return cfg && cfg.category === 'medical'; }` and use it when deciding if a dragged item can be dropped on a limb zone.

## Files and locations

- [game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js):
  - DEFAULT_STATS: add `limbHp` with 8 limbs at full.
  - Run init / load: if `stats.limbHp` missing, init from full limb template; optionally set hp/maxHp from sum(limbHp).
  - `renderInventoryPanel()`: in Health view branch, after skeleton, add 8 limb labels + bars + status + limbZones; pass limbZones into closure so onPointerUp can use them.
  - `onPointerUp` (and pointer handling): when invBodyView === 'health' and drag is medical and over a limb zone, apply heal and consume durability; rerender.
  - Player damage (e.g. ~11702): optionally reduce a limb (or distribute) and set `playerStats.hp` = sum(limbHp) so damage flows into limbs.
  - Helper: `isMedicalItem(itemId)` (or inline category check) used for limb drop.

## Result

- Health view shows 8 limbs with current/max HP bars and optional status.
- Dragging medkit (or other medical item) from backpack onto a limb bar heals that limb and uses medkit durability.
- Global HP can reflect sum of limb HP so death and existing UI stay consistent.

