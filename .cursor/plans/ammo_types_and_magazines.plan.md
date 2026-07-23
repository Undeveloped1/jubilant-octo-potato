---
name: ""
overview: ""
todos: []
isProject: false
---

# Ammo Types and Magazines — Implementation Plan

**Goal:** Replace the single generic `ammo` with per-weapon ammo types; introduce physical magazines for pistol/SMG/rifle; shotgun uses shells from pocket/rig only; crossbow uses bolts (no magazine; quiver later). Magazines and ammo are lootable from bandits and crates; magazines can have random round counts.

**Current state:** One `ammo` type; `playerStats.magazines[weapon]` = round count in “mag”; reload takes from `countItemInGrid(backpack, 'ammo')` and fills mag. No magazine items; no per-weapon ammo types.

---

## Ammo types (canonical)


| Weapon   | Ammo ID       | Display name | UI color (hex) | Notes   |
| -------- | ------------- | ------------ | -------------- | ------- |
| crossbow | `ammo_bolts`  | Bolts        | Silver         | #c0c0c0 |
| shotgun  | `ammo_shells` | Shells       | Green          | #00aa00 |
| pistol   | `ammo_9mm`    | 9mm          | Copper         | #b87333 |
| smg      | `ammo_45`     | .45 cal      | Brass          | #cd9b1d |
| rifle    | `ammo_556`    | 5.56         | Purple         | #8800aa |


Each weapon **only** consumes its own ammo type. No mixing.

---

## Magazine items (canonical)


| Weapon (no mag) | Magazine ID  | Size | Capacity | UI color           |
| --------------- | ------------ | ---- | -------- | ------------------ |
| —               | —            | —    | —        | —                  |
| pistol          | `mag_pistol` | 1×1  | 17       | Light grey #b0b0b0 |
| smg             | `mag_smg`    | 1×2  | 30       | Dark grey #505050  |
| rifle           | `mag_rifle`  | 1×2  | 30       | Tan #c4a574        |


- **Crossbow:** No magazine. Bolt is consumed per shot; extras stored in **quiver** (replaces melee slot) — *quiver to be implemented later; document in HANDOVER.*
- **Shotgun:** No magazine item. Consumes **shells** from **pocket or rig only**; ammo in backpack is **not** used for shotgun.

---

## Special rules summary

1. **Pistol / SMG / Rifle:** Fire from **equipped magazine** in weapon’s magazine slot. Reload = fill current mag from reserve ammo (matching type in backpack), or **swap mag** (drag another mag onto slot; empty/partial mag goes to backpack). Magazines are 1×1 or 1×2 grid items with `rounds` / `maxRounds` (or equivalent).
2. **Shotgun:** Reserve = shells in **pocket + rig only**. Reload fills tube from that reserve. Backpack shells not used. (Optional: allow moving shells from backpack into pocket/rig to “feed” shotgun.)
3. **Crossbow:** One bolt per shot; no magazine. Bolt from body (loot) or from **quiver** when implemented. Until quiver exists: treat as single round in “chamber” and/or temporary bolt count; document quiver as next step.

---

## Phased implementation

### Phase A: Data model — ammo types and CONFIG

**Scope:** Introduce the five ammo types in CONFIG; no gameplay change yet. Reserve the single `ammo` for migration.

- **CONFIG:**
  - Add `CONFIG.AMMO_TYPES` or equivalent: map weapon → `{ ammoId, label, color }` (e.g. `pistol → { ammoId: 'ammo_9mm', label: '9mm', color: '#b87333' }`).
  - Add each ammo type to `CONFIG.LOOT.VALID_IDS` and `CONFIG.LOOT.INVENTORY_ITEMS`: `ammo_bolts`, `ammo_shells`, `ammo_9mm`, `ammo_45`, `ammo_556` (size 1×1, stackMax e.g. 99, category stackable, label, icon, color).
- **Migration:** Keep existing `ammo` in CONFIG for now; later piece can map legacy `ammo` to a default (e.g. 9mm) or split by context.
- **Test:** Config loads; no crashes; new IDs in VALID_IDS/INVENTORY_ITEMS.
- **Revert:** Remove AMMO_TYPES and new ammo entries only.

**Deliverable:** One source of truth for “weapon → ammo type” and “ammo type → display/color.”

---

### Phase B: Data model — magazine items and equipped mags

**Scope:** Magazine as grid item; weapon slot can hold one magazine (by reference). No UI drag yet.

- **CONFIG:**
  - `INVENTORY_ITEMS`: `mag_pistol` (1×1, capacity 17, weapon pistol, color #b0b0b0), `mag_smg` (1×2, 30, smg, #505050), `mag_rifle` (1×2, 30, rifle, #c4a574). Category e.g. `weapon` or `magazine`.
  - Add to VALID_IDS: `mag_pistol`, `mag_smg`, `mag_rifle`.
- **Data:** Magazine placement in grid has `rounds` and `maxRounds` (or store in placement extra). When equipping, we need to know which placement is “in the weapon”; use e.g. `playerStats.equippedMagazines[weapon] = { placementId, itemId, rounds, maxRounds }` or reference into backpack/rig by placementId.
- **Compatibility:** Existing `weaponSlotMods` / magazine slot: magazine **slot** on weapon can hold either a mod (extended_mag) or the **equipped magazine**; decide: magazine slot = mag item only, and extended_mag mod still increases capacity of the mag when applied. So: magazine slot = one mag item; mods that affect mag size apply to that mag’s effective capacity when equipped.
- **Test:** Can add mag items to backpack (e.g. via console or test loadout); structure supports `equippedMagazines[weapon]` or equivalent.
- **Revert:** Remove mag item defs and equipped mag refs.

**Deliverable:** Magazines exist as items; code knows “current mag in gun” per weapon (pistol, smg, rifle).

---

### Phase C: Consumption — weapon uses correct ammo type

**Scope:** Firing and reserve checks use the correct ammo type per weapon. No magazines yet for consumption (still use `playerStats.magazines[weapon]` if you want minimal change), but reserve ammo is per type.

- **Reserve:** For each weapon, reserve = count of that weapon’s ammo ID in backpack (and for shotgun, pocket + rig only — see Phase D). Helpers: `getReserveAmmo(stats, weapon)`, `getAmmoIdForWeapon(weapon)` from CONFIG.
- **Firing:** Unchanged for “where” rounds come from (still mag count) until Phase E. Only change: any UI or “no ammo” message uses correct ammo type label.
- **Reload (current behavior):** Reload currently takes from backpack `ammo`. Change to: take from reserve for **current weapon** only (`ammo_9mm` for pistol, etc.). Consume from backpack (and for shotgun, from pocket/rig only). If reserve is 0, show “No 9mm” / “No shells” etc.
- **Test:** With only one ammo type in backpack (e.g. 9mm), pistol can reload; rifle cannot. Each weapon only consumes its ammo type from reserve.
- **Revert:** Restore single `ammo` for reserve and reload.

**Deliverable:** Per-weapon ammo type drives reserve and reload; firing still uses existing mag count (to be replaced by equipped mag in Phase E).

---

### Phase D: Shotgun — shells from pocket/rig only

**Scope:** Shotgun reserve = shells in pocket + rig only. Backpack shells not used for shotgun.

- **Reserve for shotgun:** `getReserveAmmo(stats, 'shotgun')` = `countItemInGrid(rig, 'ammo_shells') + countInPockets(stats, 'ammo_shells')`. No backpack.
- **Reload shotgun:** Take shells from pocket/rig only; remove from those containers. Reload time and tube fill logic unchanged.
- **Loot:** When adding `ammo_shells` to player, prefer pocket/rig if shotgun is in use (optional); or always add to backpack and player must move to pocket/rig to use for shotgun (simpler).
- **Test:** Shotgun only reloads from pocket/rig; backpack shells do not decrease when reloading shotgun.
- **Revert:** Shotgun reserve again includes backpack.

**Deliverable:** Shotgun behavior matches spec (pocket/rig only).

---

### Phase E: Magazine slot UI and swap — equip mag, fire from mag

**Scope:** Weapon’s magazine slot (on outline) accepts magazine items. Firing drains the **equipped magazine**; when empty, player swaps mag or reloads from reserve into that mag.

- **UI:** Magazine slot on weapon outline (already have attachment boxes for magazine slot). This slot accepts **magazine items** (mag_pistol, mag_smg, mag_rifle) only. Drag mag from backpack/rig onto slot → equip; if slot had a mag, swap (old mag to backpack with its current round count). Drag from slot → unequip mag to backpack/rig.
- **Firing:** Decrement `equippedMagazines[weapon].rounds` (or equivalent). When 0, weapon is “empty” until swap or reload.
- **Reload (mag weapons):** “Reload” action = take rounds from reserve (matching ammo type in backpack) and add to **equipped magazine** up to its capacity (or extended_mag adjusted capacity). If no mag equipped, “No magazine” or “Equip magazine.”
- **Extended mag mod:** When equipped on weapon, magazine slot’s effective capacity = base mag capacity × (1 + mag_size). Apply when filling mag or when displaying capacity.
- **Test:** Equip mag, fire until empty, swap mag from backpack, fire again; reload fills equipped mag from reserve; save/load preserves mag in slot and round count.
- **Revert:** Remove mag slot interaction; firing and reload again use simple `magazines[weapon]` count and reserve from backpack.

**Deliverable:** Physical magazines in slot; fire from mag; swap and reload from reserve into mag.

---

### Phase F: Crossbow — bolts (no magazine; quiver later)

**Scope:** Crossbow uses `ammo_bolts`. No magazine; one bolt per shot. Reserve = bolts in backpack (and later, quiver when implemented). For now, no “quiver” slot; just reserve in backpack.

- **Consumption:** On crossbow fire, consume 1 bolt from reserve. Reserve = `countItemInGrid(backpack, 'ammo_bolts')`. If 0, cannot fire. No “magazine” for crossbow; no reload action that fills a mag — either “load bolt” (consume 1 from reserve) or fire consumes directly from reserve (one shot = one bolt from backpack).
- **Loot:** Bolts lootable; add `ammo_bolts` to LEVEL_POOLS, BANDIT/CRATE loot tables. Bodies killed with crossbow could drop 0–1 bolt (optional).
- **Document:** In HANDOVER (or this plan), add “Quiver: replaces melee slot; stores bolts; crossbow draws from quiver. Implement after ammo/magazines.”
- **Test:** Crossbow only fires if `ammo_bolts` in backpack; each shot removes 1 bolt.
- **Revert:** Crossbow uses generic ammo or previous behavior.

**Deliverable:** Crossbow uses bolts from backpack; quiver explicitly deferred and documented.

---

### Phase G: Loot — ammo types and magazines in tables

**Scope:** Each ammo type and magazine type is lootable from bandits and crates; magazines have random round counts.

- **Ammo types in loot:**
  - Add `ammo_bolts`, `ammo_shells`, `ammo_9mm`, `ammo_45`, `ammo_556` to:
    - `CONFIG.LOOT.LEVEL_POOLS` (by level, as appropriate),
    - `CONFIG.LOOT` enemy/container tables (e.g. BANDIT, WALKER, SPITTER, LEAPER, EXPLODER, CRATE),
    - Any applyLoot switch cases so pickup adds to backpack (or pocket/rig for shells if desired).
  - Ensure VALID_IDS and INVENTORY_ITEMS already include these (Phase A).
- **Magazines in loot:**
  - Add `mag_pistol`, `mag_smg`, `mag_rifle` to bandit and crate loot tables.
  - When generating a magazine drop: create placement with **random rounds** (e.g. 1 to maxRounds, or 30–100% of max). Store `rounds` and `maxRounds` on the placement or in the item extra.
- **applyLoot:** Handle new IDs: add to grid (backpack/rig/pocket as appropriate); for mags, create with random rounds. No new “instant” effects; all grid items.
- **Test:** Kill bandits / open crates; receive correct ammo types and magazines; mags have varying round counts; pickup and stack/place work.
- **Revert:** Remove new IDs from loot tables and applyLoot; keep CONFIG entries if desired.

**Deliverable:** Full loot integration for all ammo types and magazines; bandits/crates drop mags with random ammo.

---

### Phase H: Legacy migration and cleanup

**Scope:** Migrate existing saves/runs that use single `ammo` to the new ammo types; remove or deprecate generic `ammo`.

- **Migration:** On load, if backpack/stash contain `ammo` (old ID): convert to a default ammo type (e.g. `ammo_9mm`) or split by ratio (e.g. 1/5 each type). Document choice. Ensure `playerStats.magazines` and any equipped mags still valid.
- **start_ammo / gifts:** Change to give e.g. 20× `ammo_9mm` or a mix; update any other “give ammo” to use specific type.
- **Remove:** Drop `ammo` from VALID_IDS and INVENTORY_ITEMS (or keep for backward compat and never drop); ensure no code path creates generic `ammo` for weapons.
- **Test:** Old save loads; ammo appears as new types; new run has no generic `ammo`; all weapons feed from correct type/mag.
- **Revert:** Restore `ammo` and migration path.

**Deliverable:** No generic ammo in active use; clean per-weapon ammo and mag flow.

---

## Order and dependencies

```text
A (ammo types CONFIG) → C (consumption by type)
B (mag items + equipped mags) → E (mag slot UI + fire from mag)
C → D (shotgun pocket/rig only)
C → E (reload from reserve into mag)
E → G (loot mags + random rounds)
A + C → F (crossbow bolts)
A + B → G (loot ammo types + mags)
G → H (migration + cleanup)
```

**Suggested order:** A → B → C → D → E → F → G → H. (F can move earlier if crossbow-only playtest is desired before mag UI.)

---

## Quiver (future — document only)

- **Quiver:** Equippable in **melee slot** (replaces melee for that slot). Stores bolts (e.g. capacity 12–20). Crossbow draws from quiver when equipped; if no quiver, draw from backpack `ammo_bolts`.
- **Bolt from body:** When killing an enemy with crossbow, optionally drop 0–1 bolt on body (lootable).
- Add to HANDOVER under “Remaining workload” or “Later” so quiver and “bolt from body” are implemented in a follow-up.

---

## Summary table


| Phase | What                                                                      | Test                                      |
| ----- | ------------------------------------------------------------------------- | ----------------------------------------- |
| A     | Ammo types in CONFIG; weapon → ammoId; INVENTORY_ITEMS + VALID_IDS        | Config loads; IDs valid                   |
| B     | Magazine items (mag_pistol, mag_smg, mag_rifle); equippedMagazines data   | Mag in backpack; structure supports equip |
| C     | Reserve and reload use correct ammo type per weapon                       | Pistol uses 9mm only; rifle 5.56 only     |
| D     | Shotgun reserve = pocket + rig only                                       | Shotgun doesn’t use backpack shells       |
| E     | Mag slot UI; equip/swap mag; fire from mag; reload fills mag from reserve | Swap mag; fire; reload from reserve       |
| F     | Crossbow uses ammo_bolts from backpack; no mag; quiver doc’d              | Crossbow consumes bolts only              |
| G     | Loot: all ammo types + mags from bandits/crates; mags random rounds       | Drops and pickup work                     |
| H     | Migrate legacy `ammo`; remove generic ammo from flow                      | Old save works; no generic ammo           |


Implement one phase at a time; test and optionally backup before the next.