# Handover: Trader Sell Tab — Stash & Backpack Items

**Chat scope:** Trader Sell tab now sells weapons, armor, and attachments from **stash** and **backpack** (not only equipped armor, consumables, and mod inventory).

---

## 1. Config: `CONFIG.TRADER.SELL_GRID`

**File:** `game.js` (same block as other `CONFIG.TRADER` keys)

- **Purpose:** Maps `itemId` → sell price (per unit). Each entry is either `{ credits: n }` or `{ materials: n }`.
- **Included items:**
  - **Weapons:** shotgun 25, smg 35, crossbow 40, rifle 45 (credits).
  - **Armor:** helmet 10, vest 12 (credits).
  - **Mods/attachments:** extended_mag 7, suppressor 10, laser_sight 12, damage_barrel 15, rapid_fire 12 (materials).

Any stash or backpack placement whose `itemId` is in `SELL_GRID` appears in the Sell list and can be sold for the configured currency.

---

## 2. Sell List: Building `type: 'grid'` Sell Items

**File:** `game.js`  
**Location:** Inside `renderTraderItems()`, in the **Sell** branch (the `else` that builds sell items), after the blocks for equipped armor, consumables, and `modInventory`.

- Iterates `this.persistent.stash` and `this.stats.backpack` (their `.items` arrays).
- For each placement:
  - If `CONFIG.TRADER.SELL_GRID[p.itemId]` exists, pushes a sell item with:
    - `type: 'grid'`
    - `grid` (stash or backpack reference), `placementId`, `itemId`, `count`
    - `name`: item label + count (if > 1) + `" [Stash]"` or `" [Backpack]"`
    - `value`: per-unit price × count
    - `currency`: `'credits'` or `'materials'` (from whether the price has `credits` or `materials`)

Sell list now includes: equipped armor, consumables, mod inventory (unchanged) **plus** all matching stash/backpack items from `SELL_GRID`.

---

## 3. `sellItem(item)` — Handling `type: 'grid'`

**File:** `game.js`  
**Function:** `sellItem(item)`

- **Existing branches:** `'armor'`, `'consumable'`, `'mod'` (unchanged).
- **New branch:** `item.type === 'grid'`
  1. `removeItem(item.grid, item.placementId)` to remove that stack from stash or backpack.
  2. If removal fails → `return false` (no currency change, no save, no sfx).
  3. Otherwise: `this.persistent[item.currency] += item.value` (credits or materials).
  4. Then same as other types: `itemsSold++`, `sfx.sell()`, `savePersistent()`, `localStorage.setItem(CONFIG.SAVE_KEY, ...)`, `return true`.

`removeItem` is the existing grid helper in `game.js` (takes `grid`, `placementId`; returns removed item or null).

---

## 4. Sell Row Display for Grid Items

**File:** `game.js`  
**Location:** Same `renderTraderItems()` Sell branch, inside the `sellItems.forEach` that draws each row.

- **Name color:** Grid items use a distinct color (e.g. `#aaccff`); mods keep `#cc88ff`; others `#fff`.
- **Currency icon:**  
  - Mods → ⚙️ (materials).  
  - Grid items → ⚙️ if `item.currency === 'materials'`, else 💰 (credits).  
  - All other sell types → 💰.  
  Logic: `(item.type === 'mod' || (item.type === 'grid' && item.currency === 'materials')) ? '⚙️' : '💰'`.

So stash/backpack items selling for materials show the materials icon; those selling for credits show the credits icon.

---

## 5. Quick Reference

| What | Where |
|------|--------|
| Sell prices for stash/backpack items | `CONFIG.TRADER.SELL_GRID` |
| Building sell list (incl. stash/backpack) | `renderTraderItems()` — Sell branch, loop over `stash` and `backpack` |
| Executing a grid sell | `sellItem()` — branch `item.type === 'grid'` |
| Grid helper used | `removeItem(grid, placementId)` (existing) |
| Currency icon for grid | Same `forEach` as other sell rows; use `item.currency` for grid |

---

## 6. Testing Checklist

- [ ] Stash/backpack weapons (shotgun, smg, crossbow, rifle) appear in Sell tab with correct credit value.
- [ ] Stash/backpack armor (helmet, vest) appear with correct credit value.
- [ ] Stash/backpack mods (e.g. extended_mag, suppressor) appear with materials icon and value.
- [ ] Selling a stash item removes it from stash and adds credits/materials; save persists.
- [ ] Selling a backpack item removes it from backpack and adds credits/materials; save persists.
- [ ] Currency display at top of trader updates after selling grid items.
- [ ] Sell list re-renders after a grid sell (no duplicate rows or stale data).

---

*Document created for handover to a new chat. All changes are in `game.js`.*
