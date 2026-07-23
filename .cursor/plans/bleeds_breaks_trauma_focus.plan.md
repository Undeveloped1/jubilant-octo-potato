---
name: ""
overview: ""
todos: []
isProject: false
---

# Bleeds, Breaks, Trauma – Statuses and Clearing Only

## Scope for this phase

- **In scope:** Limb status model (minor_bleed, major_bleed, break, trauma), the four medical items, **giving** trauma when a limb reaches 0 HP, **clearing** each status with the right item (drag-to-limb), and UI display of statuses.
- **Out of scope for now:** How minor_bleed, major_bleed, or break *come to be* in gameplay (e.g. applied on damage). That is the next phase. Trauma is the only status we "give" automatically: when a limb's HP is reduced to 0.

---

## 1. Limb effects data model

- In [game.js](game.js), each limb is currently `{ hp, maxHp, status }` (`getDefaultLimbHp()` ~1027).
- Add `effects: []` to each limb, holding: `'minor_bleed'`, `'major_bleed'`, `'break'`, `'trauma'`.
- Migration: where limb data is ensured (~7379), default `effects = []` on each limb if missing.
- Health view status line (~9191): derive display from `effects` (e.g. "Minor bleed", "Major bleed", "Break", "Trauma", joined by ", "); if empty, show "—".

## 2. Giving trauma only

- In the player damage block (~11808–11820), after reducing a limb's `hp` to 0, add `'trauma'` to that limb's `effects` if not already present.
- No other automatic "giving" of statuses in this phase (bleeds/break added in a later "how they come to be" pass).

## 3. Block healing when trauma

- In the health-view drop handler (~9399–9426): when using a medkit (or any HP heal) on a limb, if the limb has `'trauma'` in `effects`, do not heal; return the item to the backpack (and optionally show feedback).

## 4. New items

- **CONFIG.LOOT.VALID_IDS:** add `bandage`, `hemostat`, `splint`, `trauma_kit`.
- **CONFIG.LOOT.INVENTORY_ITEMS:**
  - **bandage** – 1x1, medical, 2 uses, red (e.g. `#cc2222`), label "Bandage", icon e.g. "Bd".
  - **hemostat** – 1x1, medical, 2 uses, red, "Hemostat", "Hs".
  - **splint** – 1x1, medical, 2 uses, red, "Splint", "Sp".
  - **trauma_kit** – 2x2, medical, 4 uses, orange (e.g. `#ff8800`), "Trauma Kit", "TK".
- Durability: in `placeItem` and all durability-default branches, support these four with 2/2 or 4/4 (or a small `getDefaultDurability(itemId)` helper).
- applyLoot: add cases that call `tryAddItem(backpack, id, 1, extra)` with the correct durability extra for each.
- Backpack (and any item) draw: use item config `color` for text fill so red/orange show correctly.

## 5. Clearing statuses (drag-to-limb)

In the same health-view drop handler:

- **Medkit:** existing heal logic, but skip if limb has `'trauma'`.
- **Bandage / Hemostat / Splint / Trauma kit:**
  - Map: bandage → `'minor_bleed'`, hemostat → `'major_bleed'`, splint → `'break'`, trauma_kit → `'trauma'`.
  - If the limb has the matching effect, remove one instance from `effects`, decrement item durability. If durability becomes 0, do not re-add item; else re-add with new durability.
  - If limb does not have the effect, do not consume the item (put it back).
  - Sound + rerender.

## 6. Loot tables (optional for this phase)

- Adding the new ids to `LEVEL_POOLS` can be done in this pass so the items can appear in the world, or left for the next phase if you prefer to test only via dev/stash.

---

## Summary


| Status      | Given in this phase    | Cleared by |
| ----------- | ---------------------- | ---------- |
| trauma      | When limb HP goes to 0 | Trauma kit |
| minor_bleed | No (next phase)        | Bandage    |
| major_bleed | No (next phase)        | Hemostat   |
| break       | No (next phase)        | Splint     |


Implementation order: (1) limb `effects` + migration + display, (2) trauma on limb 0 HP + block medkit when trauma, (3) four items + durability + applyLoot, (4) drag-to-limb clear logic + item colors.