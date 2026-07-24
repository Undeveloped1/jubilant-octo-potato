import { CONFIG } from './config.js';

const DEFAULT_ARMOR = { head: null, body: null, ears: null, arms: null, feet: null, rig: null, nvg: null };
const DEFAULT_BACKPACK_SHAPE = { gridW: 6, gridH: 9 };

function between(min, max) {
    if (max < min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** True if itemId is a weapon mod (in CONFIG.MODS). */
function isModItem(itemId) {
    return !!(CONFIG.MODS && Object.values(CONFIG.MODS).some(m => m.id === itemId));
}
/** True if mod can go in slotName on weaponId (slotType + compatible). extra_modifier is a wildcard: any compatible mod fits. Magazine slot accepts only physical mags (isMagazineItem), not mods. */
function modFitsSlot(modId, slotName, weaponId) {
    if (slotName === 'magazine' || slotName === 'magazine_mod') return false;
    const mod = CONFIG.MODS && Object.values(CONFIG.MODS).find(m => m.id === modId);
    if (!mod) return false;
    if (slotName === 'extra_modifier')
        return Array.isArray(mod.compatible) && mod.compatible.includes(weaponId);
    const slotMatch = mod.slotType === slotName || (slotName === 'magazine_mod' && mod.slotType === 'magazine');
    if (!slotMatch) return false;
    return Array.isArray(mod.compatible) && mod.compatible.includes(weaponId);
}
/** Returns array of slot names for a weapon (e.g. rifle -> ['flashlight_laser','muzzle','grip',...]). */
function getWeaponSlotNames(weapon) {
    return (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[weapon]) ? CONFIG.WEAPON_SLOTS[weapon] : [];
}
/** Returns ammo type id for a weapon (e.g. pistol -> 'ammo_9mm'). Used for reserve and reload. */
function getAmmoIdForWeapon(weapon) {
    const t = CONFIG.AMMO_TYPES && CONFIG.AMMO_TYPES[weapon];
    return t ? t.ammoId : null;
}

function isMagazineItem(itemId) {
    return !!(CONFIG.MAGAZINES && CONFIG.MAGAZINES[itemId]);
}
/** Random rounds for a magazine when looting a magazine-using weapon. 15% full, 50% less than half, 35% more than half. */
function getRandomMagRoundsForLootedWeapon(capacity) {
    if (!capacity || capacity <= 0) return 0;
    const r = Math.random();
    const half = Math.floor(capacity / 2);
    if (r < 0.15) return capacity;
    if (r < 0.65) return between(0, Math.max(0, half - 1));
    return between(half, capacity);
}

/** Weapon this mag fits (e.g. mag_pistol -> 'pistol'). */
function getMagazineWeapon(itemId) {
    const m = CONFIG.MAGAZINES && CONFIG.MAGAZINES[itemId];
    return m ? m.weapon : null;
}
/** Max rounds for this mag type. */
function getMagazineCapacity(itemId) {
    const m = CONFIG.MAGAZINES && CONFIG.MAGAZINES[itemId];
    return m ? m.capacity : 0;
}
/** Ammo type id for filling this mag (e.g. mag_pistol -> 'ammo_9mm'). */
function getMagazineAmmoId(itemId) {
    const m = CONFIG.MAGAZINES && CONFIG.MAGAZINES[itemId];
    return m ? m.ammoId : null;
}
/** True if itemId is an ammo type that can go in the ammo box (ammo, ammo_9mm, ammo_45, ammo_556, ammo_shells, ammo_bolts). Driven by CONFIG. */
function isAmmoItemId(itemId) {
    if (!itemId) return false;
    if (itemId === 'ammo') return true;
    if (CONFIG.AMMO_TYPES) {
        for (const k of Object.keys(CONFIG.AMMO_TYPES)) {
            if (CONFIG.AMMO_TYPES[k].ammoId === itemId) return true;
        }
    }
    return !!(CONFIG.LOOT && CONFIG.LOOT.ITEMS && CONFIG.LOOT.ITEMS[itemId] && itemId.startsWith('ammo_'));
}
/** Label suffix for magazines: " rounds/max" or "". Use for stash, backpack, rig, pockets so all UIs match. p: { itemId, rounds?, maxRounds? }. */
function getMagazineRoundsLabel(p) {
    if (!p || !isMagazineItem(p.itemId)) return '';
    return ' ' + (p.rounds ?? 0) + '/' + (p.maxRounds ?? getMagazineCapacity(p.itemId));
}

function unloadMagazineToStack(stats, persistent, magRef, isStashContext) {
    if (!magRef || !magRef.itemId || !isMagazineItem(magRef.itemId)) return false;
    const ammoId = getMagazineAmmoId(magRef.itemId);
    if (!ammoId) return false;
    let rounds = 0;
    let placement = null;
    let grid = null;
    if (magRef.fromAttachmentBox && magRef.weaponId && stats && stats.equippedMagazines) {
        const em = stats.equippedMagazines[magRef.weaponId];
        if (!em || em.itemId !== magRef.itemId) return false;
        rounds = em.rounds ?? 0;
        placement = em;
    } else if (magRef.fromStash && persistent && persistent.stash && magRef.placementId != null) {
        ensureGridItems(persistent.stash);
        placement = (persistent.stash.items || []).find(p => p.placementId === magRef.placementId);
        if (!placement || placement.itemId !== magRef.itemId) return false;
        rounds = placement.rounds ?? 0;
    } else if (magRef.container === 'backpack' && stats && stats.backpack && magRef.placementId != null) {
        ensureGridItems(stats.backpack);
        placement = (stats.backpack.items || []).find(p => p.placementId === magRef.placementId);
        if (!placement || placement.itemId !== magRef.itemId) return false;
        rounds = placement.rounds ?? 0;
    } else if ((magRef.fromRig || magRef.container === 'rig') && stats && stats.rigGrid && magRef.placementId != null) {
        placement = (stats.rigGrid.items || []).find(p => p.placementId === magRef.placementId);
        if (!placement || placement.itemId !== magRef.itemId) return false;
        rounds = placement.rounds ?? 0;
    } else if ((magRef.fromPocket || magRef.container === 'pocket') && stats && stats.pockets && magRef.pocketIndex != null && magRef.slotIndex != null) {
        ensurePockets(stats);
        const row = stats.pockets[magRef.pocketIndex];
        placement = row && row[magRef.slotIndex];
        if (!placement || placement._spansFrom !== undefined || placement.itemId !== magRef.itemId) return false;
        rounds = placement.rounds ?? 0;
    }
    if (rounds <= 0) return false;
    let destGrid = null;
    if (isStashContext && persistent && persistent.stash) {
        destGrid = persistent.stash;
    } else if (stats) {
        if (magRef.container === 'backpack' || magRef.fromAttachmentBox) {
            destGrid = stats.backpack || (stats.armor && stats.armor.rig && stats.rigGrid ? stats.rigGrid : null);
        } else if (magRef.fromRig || magRef.container === 'rig') {
            destGrid = stats.rigGrid || null;
        } else if (magRef.fromPocket || magRef.container === 'pocket') {
            destGrid = stats.backpack || (stats.armor && stats.armor.rig && stats.rigGrid ? stats.rigGrid : null);
        }
    }
    if (!destGrid) return false;
    const added = tryAddItem(destGrid, ammoId, rounds);
    if (added) {
        placement.rounds = 0;
        if (placement.maxRounds == null) placement.maxRounds = getMagazineCapacity(magRef.itemId);
    }
    return added;
}

function getEquippedMag(stats, weapon) {
    if (!stats || !stats.equippedMagazines) return null;
    return stats.equippedMagazines[weapon] || null;
}
/** Set equipped mag for weapon (null to clear). */
function setEquippedMag(stats, weapon, magState) {
    if (!stats) return;
    if (!stats.equippedMagazines) stats.equippedMagazines = { pistol: null, smg: null, rifle: null };
    stats.equippedMagazines[weapon] = magState ? { itemId: magState.itemId, rounds: magState.rounds, maxRounds: magState.maxRounds } : null;
}

function findFirstEmptySlotForMag(stats, sizeW, sizeH, excludeSlot) {
    if (!stats) return null;
    ensureRigStats(stats);
    ensureBackpackStats(stats);
    ensurePockets(stats);
    const exclude = excludeSlot || null;
    if (stats.armor && stats.armor.rig && stats.rigGrid && Array.isArray(stats.rigGrid.items)) {
        let pos;
        if (exclude && exclude.container === 'rig' && exclude.row != null && exclude.col != null) {
            ensureGridItems(stats.rigGrid);
            const exW = exclude.sizeW || 1, exH = exclude.sizeH || 1;
            const dummy = { placementId: '_exclude_', row: exclude.row, col: exclude.col, sizeW: exW, sizeH: exH };
            stats.rigGrid.items.push(dummy);
            pos = findSpaceTryRotated(stats.rigGrid, sizeW, sizeH);
            stats.rigGrid.items.pop();
        } else {
            pos = findSpaceTryRotated(stats.rigGrid, sizeW, sizeH);
        }
        if (pos) return { container: 'rig', row: pos.row, col: pos.col, rotated: pos.rotated };
    }
    const pockets = stats.pockets || [];
    const isExcludedPocket = (pi, si) => exclude && exclude.container === 'pocket' && exclude.pocketIndex === pi && exclude.slotIndex === si;
    if (sizeW === 1 && sizeH === 1) {
        for (let pi = 0; pi < pockets.length; pi++) {
            const row = pockets[pi] || [];
            for (let si = 0; si < (row || []).length; si++) {
                if (isExcludedPocket(pi, si)) continue;
                if (isPocketSlotEmpty(pockets, pi, si)) return { container: 'pocket', pocketIndex: pi, slotIndex: si };
            }
        }
    }
    if ((sizeW === 2 && sizeH === 1) || (sizeW === 1 && sizeH === 2)) {
        for (let pi = 0; pi <= 1; pi++) {
            if (exclude && exclude.container === 'pocket' && exclude.pocketIndex === pi) continue;
            if (pockets[pi] && pockets[pi].length >= 2 && isPocketSlotEmpty(pi, 0) && isPocketSlotEmpty(pi, 1))
                return { container: 'pocket', pocketIndex: pi, slotIndex: 0, rotated: sizeW === 1 && sizeH === 2 };
        }
    }
    if (stats.backpack) {
        ensureGridItems(stats.backpack);
        if (stats.backpack.gridW == null) stats.backpack.gridW = 6;
        if (stats.backpack.gridH == null) stats.backpack.gridH = 9;
        if (Array.isArray(stats.backpack.items)) {
            let pos;
            if (exclude && exclude.container === 'backpack' && exclude.row != null && exclude.col != null) {
                const exW = exclude.sizeW || 1, exH = exclude.sizeH || 1;
                const dummy = { placementId: '_exclude_', row: exclude.row, col: exclude.col, sizeW: exW, sizeH: exH };
                stats.backpack.items.push(dummy);
                pos = findSpaceTryRotated(stats.backpack, sizeW, sizeH);
                stats.backpack.items.pop();
            } else {
                pos = findSpaceTryRotated(stats.backpack, sizeW, sizeH);
            }
            if (pos) return { container: 'backpack', row: pos.row, col: pos.col, rotated: pos.rotated };
        }
    }
    return null;
}

function findFirstMagInRigOrPockets(stats, weapon) {
    if (!stats) return null;
    const magItemId = weapon === 'pistol' ? 'mag_pistol' : weapon === 'smg' ? 'mag_smg' : weapon === 'rifle' ? 'mag_rifle' : null;
    if (!magItemId) return null;
    if (stats.armor && stats.armor.rig && stats.rigGrid && stats.rigGrid.items) {
        const p = stats.rigGrid.items.find(i => i.itemId === magItemId);
        if (p) return { container: 'rig', placementId: p.placementId, itemId: p.itemId, rounds: p.rounds ?? 0, maxRounds: p.maxRounds ?? getMagazineCapacity(p.itemId) };
    }
    ensurePockets(stats);
    for (let pi = 0; pi < (stats.pockets || []).length; pi++) {
        const row = stats.pockets[pi] || [];
        for (let si = 0; si < (row || []).length; si++) {
            const s = row[si];
            if (s && s.itemId === magItemId && s._spansFrom === undefined)
                return { container: 'pocket', pocketIndex: pi, slotIndex: si, itemId: s.itemId, rounds: s.rounds ?? 0, maxRounds: s.maxRounds ?? getMagazineCapacity(s.itemId) };
        }
    }
    return null;
}

/** Remove a mag from rig or pocket (by ref from findFirstMagInRigOrPockets). Mutates stats. */
function removeMagFromRigOrPocket(stats, ref) {
    if (ref.container === 'rig' && stats.rigGrid && stats.rigGrid.items)
        return removeItem(stats.rigGrid, ref.placementId);
    if (ref.container === 'pocket' && stats.pockets && stats.pockets[ref.pocketIndex])
        return (stats.pockets[ref.pocketIndex][ref.slotIndex] = null) || ref;
    return null;
}

/** Place a mag (equippedMag state) into first free rig/pocket/backpack, then optional persistentStash (hideout), then drop to ground. Uses scene for drop sprite. */
function placeMagInRigPocketBackpackOrGround(scene, stats, magState, persistentStash) {
    if (!magState || !magState.itemId) return;
    const cfg = getInventoryItemConfig(magState.itemId);
    const sizeW = (cfg && cfg.sizeW) || 1, sizeH = (cfg && cfg.sizeH) || 1;
    const magExtra = { rounds: magState.rounds ?? 0, maxRounds: magState.maxRounds ?? getMagazineCapacity(magState.itemId) };
    const dest = findFirstEmptySlotForMag(stats, sizeW, sizeH);
    let placed = false;
    if (dest) {
        const placeW = dest.rotated ? sizeH : sizeW, placeH = dest.rotated ? sizeW : sizeH;
        if (dest.container === 'rig' && stats.rigGrid)
            placed = !!placeItem(stats.rigGrid, magState.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
        else if (dest.container === 'backpack' && stats.backpack)
            placed = !!placeItem(stats.backpack, magState.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
        else if (dest.container === 'pocket') {
            ensurePockets(stats);
            if (placeW === 1 && placeH === 1) {
                const slot = stats.pockets[dest.pocketIndex] && stats.pockets[dest.pocketIndex][dest.slotIndex];
                if (slot && !slot.itemId) {
                    stats.pockets[dest.pocketIndex][dest.slotIndex] = { itemId: magState.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds };
                    placed = true;
                }
            } else if (placeW === 2 && placeH === 1 && dest.slotIndex === 0) {
                stats.pockets[dest.pocketIndex][0] = { itemId: magState.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds, sizeW: 2, sizeH: 1 };
                stats.pockets[dest.pocketIndex][1] = { _spansFrom: 0 };
                placed = true;
            }
        }
    }
    if (!placed && persistentStash) {
        const pos = findSpace(persistentStash, sizeW, sizeH);
        if (pos) {
            const extra = { rounds: magExtra.rounds, maxRounds: magExtra.maxRounds };
            placed = !!placeItem(persistentStash, magState.itemId, 1, pos.row, pos.col, extra, (sizeW !== 1 || sizeH !== 1) ? { sizeW, sizeH } : undefined);
        }
    }
    if (!placed && scene && scene.droppedInventoryItems) {
        if (!scene.textures.exists('pickup_dropped')) {
            const g = scene.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0x8B4513, 1);
            g.fillCircle(8, 8, 8);
            g.generateTexture('pickup_dropped', 16, 16);
        }
        const ppx = scene.player ? scene.player.x : 400;
        const ppy = scene.player ? scene.player.y : 300;
        const dropType = { itemId: magState.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds };
        const spr = scene.add.image(ppx, ppy - 10, 'pickup_dropped').setDepth(5);
        scene.droppedInventoryItems.add(spr);
        spr.setData('type', dropType);
    }
}

/** Count itemId in pockets (all pocket slots). */
function countItemInPockets(stats, itemId) {
    if (!stats || !stats.pockets) return 0;
    let n = 0;
    (stats.pockets || []).forEach(row => {
        (row || []).forEach(slot => {
            if (slot && slot.itemId === itemId && slot._spansFrom === undefined) n += (slot.count || 1);
        });
    });
    return n;
}

/** Reserve ammo for reload: shotgun = pocket + rig only; others = backpack + rig + pockets. Uses per-weapon ammo type. */
function getReserveAmmoCount(stats, weapon) {
    const ammoId = getAmmoIdForWeapon(weapon);
    if (!ammoId) return 0;
    const inPockets = countItemInPockets(stats, ammoId);
    const inRig = (stats.armor && stats.armor.rig && stats.rigGrid && stats.rigGrid.items) ? countItemInGrid(stats.rigGrid, ammoId) : 0;
    if (weapon === 'shotgun') return inPockets + inRig;
    const inBackpack = (stats.backpack && stats.backpack.items) ? countItemInGrid(stats.backpack, ammoId) : 0;
    return inBackpack + inRig + inPockets;
}

/** Remove up to count of itemId from pockets. Returns number actually removed. */
function removeItemFromPockets(stats, itemId, count) {
    if (!stats || !stats.pockets || count <= 0) return 0;
    ensurePockets(stats);
    let left = count;
    (stats.pockets || []).forEach(row => {
        if (left <= 0) return;
        for (let si = 0; si < (row || []).length && left > 0; si++) {
            const slot = row[si];
            if (!slot || slot._spansFrom !== undefined || slot.itemId !== itemId) continue;
            const take = Math.min(left, slot.count || 1);
            left -= take;
            if (take >= (slot.count || 1)) {
                row[si] = null;
                if (slot.sizeW === 2 && slot.sizeH === 1 && row[si + 1] && row[si + 1]._spansFrom === si) row[si + 1] = null;
            } else {
                slot.count = (slot.count || 1) - take;
            }
        }
    });
    return count - left;
}

/** Remove up to count of weapon's ammo from reserve (shotgun: pocket then rig; others: backpack then rig then pockets). Returns number actually removed. */
function removeReserveAmmo(stats, weapon, count) {
    const ammoId = getAmmoIdForWeapon(weapon);
    if (!ammoId || count <= 0) return 0;
    let left = count;
    if (weapon === 'shotgun') {
        const fromPockets = removeItemFromPockets(stats, ammoId, left);
        left -= fromPockets;
        if (left > 0 && stats.armor && stats.armor.rig && stats.rigGrid)
            left -= removeItemFromGrid(stats.rigGrid, ammoId, left);
        return count - left;
    }
    if (stats.backpack && stats.backpack.items) left -= removeItemFromGrid(stats.backpack, ammoId, left);
    if (left > 0 && stats.armor && stats.armor.rig && stats.rigGrid) left -= removeItemFromGrid(stats.rigGrid, ammoId, left);
    if (left > 0) left -= removeItemFromPockets(stats, ammoId, left);
    return count - left;
}

/** Returns default equippedMods object for one weapon: { slotName: null, ... }. */
function createDefaultEquippedModsForWeapon(weapon) {
    const slots = getWeaponSlotNames(weapon);
    const o = {};
    slots.forEach(s => { o[s] = null; });
    return o;
}
/** Returns equipped mods for a weapon as object { slotName: modId }. Normalizes legacy array [null,null] to object. */
function getEquippedModsForWeapon(stats, weapon) {
    if (!stats || !stats.equippedMods) return createDefaultEquippedModsForWeapon(weapon);
    const raw = stats.equippedMods[weapon];
    const slotNames = getWeaponSlotNames(weapon);
    if (!raw) return createDefaultEquippedModsForWeapon(weapon);
    if (Array.isArray(raw)) {
        const o = createDefaultEquippedModsForWeapon(weapon);
        raw.forEach((modId, i) => { if (slotNames[i] != null && modId) o[slotNames[i]] = modId; });
        return o;
    }
    const o = createDefaultEquippedModsForWeapon(weapon);
    slotNames.forEach(s => { if (raw[s] != null) o[s] = raw[s]; });
    return o;
}
/** Ensures stats.equippedMods uses object-by-slot-name shape per weapon. Migrates legacy [null,null]. */
function ensureEquippedModsShape(stats) {
    if (!stats) return;
    if (!stats.equippedMods || typeof stats.equippedMods !== 'object') {
        stats.equippedMods = {};
    }
    const weapons = ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'];
    weapons.forEach(weapon => {
        const raw = stats.equippedMods[weapon];
        const slotNames = getWeaponSlotNames(weapon);
        if (Array.isArray(raw)) {
            const o = createDefaultEquippedModsForWeapon(weapon);
            raw.forEach((modId, i) => { if (slotNames[i] != null && modId) o[slotNames[i]] = modId; });
            stats.equippedMods[weapon] = o;
        } else if (!raw || typeof raw !== 'object') {
            stats.equippedMods[weapon] = createDefaultEquippedModsForWeapon(weapon);
        } else {
            const o = createDefaultEquippedModsForWeapon(weapon);
            slotNames.forEach(s => { if (raw[s] != null) o[s] = raw[s]; });
            stats.equippedMods[weapon] = o;
        }
    });
}

/** Mods for the weapon currently in a slot. Uses per-slot mods (weaponSlotMods) so each instance can differ. */
function getModsForWeaponInSlot(stats, slotId) {
    if (!stats) return null;
    const weaponId = stats.weaponSlots && stats.weaponSlots[slotId];
    if (!weaponId) return null;
    const slotMods = stats.weaponSlotMods && stats.weaponSlotMods[slotId];
    if (slotMods && typeof slotMods === 'object') {
        const def = createDefaultEquippedModsForWeapon(weaponId);
        const out = {};
        getWeaponSlotNames(weaponId).forEach(s => { out[s] = slotMods[s] != null ? slotMods[s] : def[s]; });
        return out;
    }
    return getEquippedModsForWeapon(stats, weaponId);
}

/** Build extra (durability, mods) for placeItem/tryAddItem from a placement so mods and durability persist across moves. */
function extraFromPlacement(p) {
    if (!p) return undefined;
    const o = {};
    if (p.durability != null || p.maxDurability != null) { o.durability = p.durability; o.maxDurability = p.maxDurability; }
    if (p.mods && typeof p.mods === 'object') o.mods = p.mods;
    return Object.keys(o).length ? o : undefined;
}

/** Mods for a weapon grid item (backpack/rig/stash). Items can have .mods for per-instance attachments. */
function getModsForWeaponItem(item) {
    if (!item || !item.itemId) return null;
    if (item.mods && typeof item.mods === 'object') {
        const def = createDefaultEquippedModsForWeapon(item.itemId);
        const out = {};
        getWeaponSlotNames(item.itemId).forEach(s => { out[s] = item.mods[s] != null ? item.mods[s] : def[s]; });
        return out;
    }
    return createDefaultEquippedModsForWeapon(item.itemId);
}

/** Ensures weapon placements in a grid have .mods (for old saves). Default mods per weapon type. */
function ensurePlacementMods(grid) {
    if (!grid || !grid.items || !CONFIG.WEAPON_SLOTS) return;
    grid.items.forEach(p => {
        if (!p.itemId || !CONFIG.WEAPON_SLOTS[p.itemId]) return;
        if (p.mods && typeof p.mods === 'object') return;
        p.mods = createDefaultEquippedModsForWeapon(p.itemId);
    });
}

// ========== Pockets ==========
/** Layout: Pocket 1 & 2 = 2 wide × 1 high (below); Pocket 3 & 4 = 1 slot each, centered above 1 & 2. Each pocket is a separate entity; no item may span two pockets. */
const POCKET_LAYOUT = [
    { w: 2, h: 1 },  // pocket 1: two slots across, one high
    { w: 2, h: 1 },  // pocket 2: same, to the right of pocket 1
    { w: 1, h: 1 },  // pocket 3: single slot centered above pocket 1 (back pocket)
    { w: 1, h: 1 }   // pocket 4: single slot centered above pocket 2
];
/** Global slot index (0-5) -> pocket index. Used to enforce same-pocket when drawing 2x1. */
const POCKET_SLOT_INDEX_TO_POCKET = [0, 0, 1, 1, 2, 3];
/** Returns default pockets: [ pocket1[2], pocket2[2], pocket3[1], pocket4[1] ]. Each slot is null or { itemId, count, ... }. */
function getDefaultPockets() {
    return [
        [null, null],
        [null, null],
        [null],
        [null]
    ];
}
/** Ensures stats.pockets exists and has correct shape (4 pockets with 2,2,1,1 slots). Use after load. */
function ensurePockets(stats) {
    if (!stats.pockets || !Array.isArray(stats.pockets)) {
        stats.pockets = getDefaultPockets();
        return;
    }
    const want = [2, 2, 1, 1];
    while (stats.pockets.length < 4) stats.pockets.push([null]);
    for (let i = 0; i < 4; i++) {
        if (!Array.isArray(stats.pockets[i])) stats.pockets[i] = [];
        while (stats.pockets[i].length < want[i]) stats.pockets[i].push(null);
        if (stats.pockets[i].length > want[i]) stats.pockets[i] = stats.pockets[i].slice(0, want[i]);
    }
}

/** Clears ghost/stale pocket slots: zero-count stackables, and _spansFrom slots whose owner is no longer 2x1. Call before drawing pockets. */
function sanitizePockets(stats) {
    if (!stats || !stats.pockets) return;
    for (let pi = 0; pi < stats.pockets.length; pi++) {
        const row = stats.pockets[pi];
        if (!Array.isArray(row)) continue;
        for (let si = 0; si < row.length; si++) {
            const slot = row[si];
            if (!slot) continue;
            if (slot._spansFrom !== undefined) {
                const owner = row[slot._spansFrom];
                if (!owner || !owner.itemId || owner.sizeW !== 2 || owner.sizeH !== 1) row[si] = null;
                continue;
            }
            if (slot.itemId) {
                const cfg = getInventoryItemConfig(slot.itemId);
                const stackable = cfg && (cfg.category === 'stackable' || (cfg.stackMax && cfg.stackMax > 1));
                const count = slot.count == null ? 1 : slot.count;
                if (count <= 0 || (stackable && !(count > 0))) row[si] = null;
            }
        }
    }
}

/** Ensures rig-related fields exist and are valid on run stats. Call after load so equipped rig and contents persist across level transition/death. */
function ensureRigStats(stats) {
    if (!stats) return;
    if (!stats.armor || typeof stats.armor !== 'object') stats.armor = Object.assign({}, DEFAULT_ARMOR);
    if (!stats.rigInventories || typeof stats.rigInventories !== 'object') stats.rigInventories = {};
    if (stats.armor && stats.armor.rig) {
        if (!stats.rigGrid || typeof stats.rigGrid !== 'object') {
            stats.rigGrid = { gridW: 4, gridH: 2, items: [], _nextId: 1 };
        }
        if (stats.rigGrid.gridW === undefined) stats.rigGrid.gridW = 4;
        if (stats.rigGrid.gridH === undefined) stats.rigGrid.gridH = 2;
        ensureGridItems(stats.rigGrid);
    }
}

/** Ensures secure container grid exists on run stats (2×3). Call after ensureGridItems. */
function ensureSecureContainerStats(stats) {
    if (!stats) return;
    if (!stats.secureContainerGrid || typeof stats.secureContainerGrid !== 'object') {
        stats.secureContainerGrid = { gridW: 2, gridH: 3, items: [], _nextId: 1 };
    }
    if (stats.secureContainerGrid.gridW === undefined) stats.secureContainerGrid.gridW = 2;
    if (stats.secureContainerGrid.gridH === undefined) stats.secureContainerGrid.gridH = 3;
    ensureGridItems(stats.secureContainerGrid);
}

/** Ensures med bag grid exists on run stats (2×2, medical-only). Call after ensureGridItems. */
function ensureMedBagStats(stats) {
    if (!stats) return;
    if (!stats.medBagGrid || typeof stats.medBagGrid !== 'object') {
        stats.medBagGrid = { gridW: 2, gridH: 2, items: [], _nextId: 1 };
    }
    if (stats.medBagGrid.gridW === undefined) stats.medBagGrid.gridW = 2;
    if (stats.medBagGrid.gridH === undefined) stats.medBagGrid.gridH = 2;
    ensureGridItems(stats.medBagGrid);
}

/** Ensures equipped backpack and backpackInventories exist; migrates old saves to default equipped backpack. Call after backpack/ensureGridItems so backpack is the active grid. */
function ensureBackpackStats(stats) {
    if (!stats) return;
    if (!stats.backpackInventories || typeof stats.backpackInventories !== 'object') stats.backpackInventories = {};
    if (!stats.equippedBackpack || typeof stats.equippedBackpack !== 'object') {
        stats.equippedBackpack = { itemId: 'backpack_default', placementId: 'equipped' };
    }
    if (stats.equippedBackpack && stats.equippedBackpack.placementId === 'equipped') {
        if (!stats.backpackInventories['equipped']) {
            stats.backpackInventories['equipped'] = stats.backpack && Array.isArray(stats.backpack.items)
                ? stats.backpack
                : getDefaultBackpack();
        }
        ensureGridItems(stats.backpackInventories['equipped']);
        stats.backpack = stats.backpackInventories['equipped'];
    } else {
        if (!stats.backpack || typeof stats.backpack !== 'object') stats.backpack = getDefaultBackpack();
        ensureGridItems(stats.backpack);
    }
}

// ========== Backpack / Stash grid helpers (Option B: list of placed items) ==========
/** Returns a fresh default backpack (same shape as DEFAULT_STATS.backpack). Use when creating or normalizing backpack. */
function getDefaultBackpack() {
    const b = DEFAULT_BACKPACK_SHAPE;
    return { gridW: b.gridW, gridH: b.gridH, items: [], _nextId: 1 };
}
/** Ensures grid.items is an array. Call after getting or creating any grid (backpack, stash, rig, ammo box inner). */
function ensureGridItems(grid) {
    if (!grid) return;
    if (!Array.isArray(grid.items)) grid.items = [];
}

function getInventoryItemConfig(id) {
    return (CONFIG.LOOT && CONFIG.LOOT.INVENTORY_ITEMS && CONFIG.LOOT.INVENTORY_ITEMS[id]) || null;
}

function isMedicalItem(itemId) {
    const cfg = getInventoryItemConfig(itemId);
    return cfg && cfg.category === 'medical';
}

function getDefaultDurability(itemId) {
    const map = { vest: 50, medkit: 120, bandage: 2, hemostat: 2, splint: 2, trauma_kit: 4, limb_breaker: 5, trauma_inflict: 5, helmet: 30, headset: 30 };
    const d = map[itemId];
    return d != null ? { durability: d, maxDurability: d } : null;
}

function getOccupiedSet(grid, excludePlacementId) {
    const set = new Set();
    (grid.items || []).forEach(p => {
        if (excludePlacementId && p.placementId === excludePlacementId) return;
        for (let r = 0; r < (p.sizeH || 1); r++)
            for (let c = 0; c < (p.sizeW || 1); c++)
                set.add(`${p.row + r},${p.col + c}`);
    });
    return set;
}

function canPlace(grid, row, col, sizeW, sizeH, excludePlacementId) {
    const w = grid.gridW || 12, h = grid.gridH || 12;
    if (row < 0 || col < 0 || row + sizeH > h || col + sizeW > w) return false;
    const occupied = getOccupiedSet(grid, excludePlacementId);
    for (let r = 0; r < sizeH; r++)
        for (let c = 0; c < sizeW; c++)
            if (occupied.has(`${row + r},${col + c}`)) return false;
    return true;
}

function findSpace(grid, sizeW, sizeH) {
    const h = grid.gridH || 12, w = grid.gridW || 12;
    for (let row = 0; row <= h - sizeH; row++)
        for (let col = 0; col <= w - sizeW; col++)
            if (canPlace(grid, row, col, sizeW, sizeH, null)) return { row, col };
    return null;
}

/** Find space in grid trying default size then rotated (swap w/h). Returns { row, col, rotated: true|false } or null. */
function findSpaceTryRotated(grid, sizeW, sizeH) {
    const pos = findSpace(grid, sizeW, sizeH);
    if (pos) return { row: pos.row, col: pos.col, rotated: false };
    if (sizeW === sizeH) return null;
    const pos2 = findSpace(grid, sizeH, sizeW);
    if (pos2) return { row: pos2.row, col: pos2.col, rotated: true };
    return null;
}

function nextPlacementId(grid) {
    const n = (grid._nextId != null ? grid._nextId : 1);
    grid._nextId = n + 1;
    return 'inv_' + n + '_' + Date.now();
}

function placeItem(grid, itemId, count, row, col, extra, sizeOverride) {
    const cfg = getInventoryItemConfig(itemId);
    if (!cfg) return null;
    const sizeW = sizeOverride ? sizeOverride.sizeW : (cfg.sizeW || 1);
    const sizeH = sizeOverride ? sizeOverride.sizeH : (cfg.sizeH || 1);
    if (!canPlace(grid, row, col, sizeW, sizeH, null)) return null;
    ensureGridItems(grid);
    const placementId = nextPlacementId(grid);
    const maxStack = Math.min(count, cfg.stackMax || 1);
    const placement = { placementId, itemId, count: maxStack, row, col, sizeW, sizeH };
    const defDur = getDefaultDurability(itemId);
    if (defDur && (extra?.durability != null || extra?.maxDurability != null || itemId === 'medkit' || itemId === 'bandage' || itemId === 'hemostat' || itemId === 'splint' || itemId === 'trauma_kit' || itemId === 'limb_breaker' || itemId === 'trauma_inflict' || itemId === 'helmet' || itemId === 'headset' || itemId === 'vest')) {
        placement.durability = extra?.durability != null ? extra.durability : defDur.durability;
        placement.maxDurability = extra?.maxDurability != null ? extra.maxDurability : defDur.maxDurability;
    }
    if (extra && extra.mods && typeof extra.mods === 'object')
        placement.mods = JSON.parse(JSON.stringify(extra.mods));
    const magDef = CONFIG.MAGAZINES && CONFIG.MAGAZINES[itemId];
    if (magDef) {
        placement.rounds = extra && extra.rounds != null ? Math.min(extra.rounds, magDef.capacity) : 0;
        placement.maxRounds = extra && extra.maxRounds != null ? extra.maxRounds : magDef.capacity;
    }
    grid.items.push(placement);
    return placementId;
}

function removeItem(grid, placementId) {
    if (!grid.items) return null;
    const idx = grid.items.findIndex(p => p.placementId === placementId);
    if (idx < 0) return null;
    const removed = grid.items.splice(idx, 1)[0];
    return removed;
}

function moveItemInGrid(grid, placementId, toRow, toCol) {
    const item = removeItem(grid, placementId);
    if (!item) return false;
    const sizeW = item.sizeW || 1, sizeH = item.sizeH || 1;
    if (!canPlace(grid, toRow, toCol, sizeW, sizeH, null)) {
        grid.items.push(item);
        return false;
    }
    item.row = toRow;
    item.col = toCol;
    grid.items.push(item);
    return true;
}

function countItemInGrid(grid, itemId) {
    if (!grid || !grid.items) return 0;
    return (grid.items || []).reduce((n, p) => n + (p.itemId === itemId ? (p.count || 1) : 0), 0);
}

/** Count grenades in pockets only (usable = pocket + rig). */
function countGrenadesInPockets(stats) {
    if (!stats || !stats.pockets) return 0;
    let n = 0;
    (stats.pockets || []).forEach(row => {
        (row || []).forEach(slot => {
            if (slot && slot.itemId === 'grenade' && slot._spansFrom === undefined) n += (slot.count || 1);
        });
    });
    return n;
}

/** Usable grenades = only in pocket or rig (not backpack, med bag, secure). */
function getUsableGrenadeCount(stats) {
    if (!stats) return 0;
    let n = countGrenadesInPockets(stats);
    if (stats.armor && stats.armor.rig && stats.rigGrid && stats.rigGrid.items)
        n += countItemInGrid(stats.rigGrid, 'grenade');
    return n;
}

/** True if player has at least one door key in backpack, pockets, or rig. */
function hasDoorKey(stats) {
    if (!stats) return false;
    let n = 0;
    if (stats.backpack && stats.backpack.items)
        n += countItemInGrid(stats.backpack, 'key');
    if (stats.pockets) {
        (stats.pockets || []).forEach(row => {
            (row || []).forEach(slot => {
                if (slot && slot.itemId === 'key' && slot._spansFrom === undefined) n += (slot.count || 1);
            });
        });
    }
    if (stats.armor && stats.armor.rig && stats.rigGrid)
        n += countItemInGrid(stats.rigGrid, 'key');
    return n > 0;
}

/** True if player has NVG equipped in the NVG slot (equippable item). */
function hasEquippedNvg(stats) {
    return !!(stats && stats.armor && stats.armor.nvg);
}

/** Remove one grenade from pocket or rig (pockets first). Returns true if removed. */
function removeOneGrenadeFromPocketOrRig(stats) {
    if (!stats) return false;
    ensurePockets(stats);
    const pockets = stats.pockets;
    for (let pi = 0; pi < (pockets || []).length; pi++) {
        const row = pockets[pi] || [];
        for (let si = 0; si < row.length; si++) {
            const slot = row[si];
            if (!slot || slot._spansFrom !== undefined) continue;
            if (slot.itemId === 'grenade') {
                if ((slot.count || 1) > 1) {
                    slot.count = (slot.count || 1) - 1;
                } else {
                    row[si] = null;
                    if (slot.sizeW === 2 && slot.sizeH === 1 && row[si + 1] && row[si + 1]._spansFrom === si)
                        row[si + 1] = null;
                }
                return true;
            }
        }
    }
    if (stats.armor && stats.armor.rig && stats.rigGrid)
        return removeItemFromGrid(stats.rigGrid, 'grenade', 1) === 1;
    return false;
}

function countItemInGrids(stashGrid, backpackGrid, itemId) {
    let n = 0;
    [stashGrid, backpackGrid].forEach(grid => {
        if (!grid || !grid.items) return;
        grid.items.forEach(p => { if (p.itemId === itemId) n += (p.count || 1); });
    });
    return n;
}

/** Remove up to `count` of itemId from a single grid. Returns number actually removed. */
function removeItemFromGrid(grid, itemId, count) {
    if (!grid || !grid.items || count <= 0) return 0;
    let left = count;
    for (let i = grid.items.length - 1; i >= 0 && left > 0; i--) {
        const p = grid.items[i];
        if (p.itemId !== itemId) continue;
        const take = Math.min(left, p.count || 1);
        left -= take;
        if (take >= (p.count || 1)) {
            grid.items.splice(i, 1);
        } else {
            p.count = (p.count || 1) - take;
        }
    }
    return count - left;
}

function removeItemFromGrids(stashGrid, backpackGrid, itemId, count) {
    let left = count;
    [stashGrid, backpackGrid].forEach(grid => {
        if (!grid || !grid.items || left <= 0) return;
        for (let i = grid.items.length - 1; i >= 0 && left > 0; i--) {
            const p = grid.items[i];
            if (p.itemId !== itemId) continue;
            const take = Math.min(left, p.count || 1);
            left -= take;
            if (take >= (p.count || 1)) {
                grid.items.splice(i, 1);
            } else {
                p.count = (p.count || 1) - take;
            }
        }
    });
    return left === 0;
}

/** Get or create inner inventory for an ammo box. inventoryMap = persistent.ammoBoxInventories or stats.ammoBoxInventories, key = 'stash_'+placementId or 'backpack_'+placementId. */
function getOrCreateAmmoBoxInventory(inventoryMap, key) {
    const inner = CONFIG.LOOT && CONFIG.LOOT.AMMO_BOX_INNER;
    const w = inner?.gridW || 6, h = inner?.gridH || 6;
    if (!inventoryMap[key]) {
        inventoryMap[key] = { gridW: w, gridH: h, items: [], _nextId: 1 };
    } else {
        inventoryMap[key].gridW = w;
        inventoryMap[key].gridH = h;
    }
    return inventoryMap[key];
}

/** Get or create inner inventory for a rig. 4 columns x 2 rows, key = 'stash_'+placementId or 'backpack_'+placementId. */
function getOrCreateRigInventory(inventoryMap, key) {
    const gridW = 4, gridH = 2;
    if (!inventoryMap[key]) {
        inventoryMap[key] = { gridW, gridH, items: [], _nextId: 1 };
    } else {
        inventoryMap[key].gridW = gridW;
        inventoryMap[key].gridH = gridH;
    }
    return inventoryMap[key];
}

/** Only allow ammo types in ammo box inner grid (9mm, .45, 5.56, shells, bolts, legacy ammo). */
function tryAddItemAmmoBoxOnly(grid, itemId, count) {
    if (!isAmmoItemId(itemId)) return false;
    return tryAddItem(grid, itemId, count);
}

function tryAddItem(grid, itemId, count, extra) {
    const nonGrid = (CONFIG.LOOT && CONFIG.LOOT.NON_GRID_ITEM_IDS) || [];
    if (nonGrid.includes(itemId)) return false;
    const cfg = getInventoryItemConfig(itemId);
    if (!cfg) return false;
    const sizeW = cfg.sizeW || 1, sizeH = cfg.sizeH || 1;
    const stackMax = cfg.stackMax || 1;
    const toAdd = Math.min(count, 999);
    if (toAdd <= 0) return true;
    if (stackMax > 1) {
        const existing = (grid.items || []).find(p => p.itemId === itemId && (p.count || 0) < stackMax);
        if (existing) {
            const room = stackMax - (existing.count || 0);
            const add = Math.min(toAdd, room);
            existing.count = (existing.count || 0) + add;
            return add >= toAdd ? true : tryAddItem(grid, itemId, toAdd - add);
        }
    }
    const pos = findSpaceTryRotated(grid, sizeW, sizeH);
    if (!pos) return false;
    const placeCount = Math.min(toAdd, stackMax);
    const placeW = pos.rotated ? sizeH : sizeW, placeH = pos.rotated ? sizeW : sizeH;
    placeItem(grid, itemId, placeCount, pos.row, pos.col, extra, (placeW !== sizeW || placeH !== sizeH) ? { sizeW: placeW, sizeH: placeH } : undefined);
    return placeCount >= toAdd ? true : tryAddItem(grid, itemId, toAdd - placeCount, extra);
}

/** True if pocket slot is empty (cells with _spansFrom are occupied). */
function isPocketSlotEmpty(pockets, pi, si) {
    const s = pockets[pi] && pockets[pi][si];
    if (!s) return true;
    if (s._spansFrom !== undefined) return false;
    return !s.itemId;
}

export {
  isModItem,
  modFitsSlot,
  getWeaponSlotNames,
  getAmmoIdForWeapon,
  isMagazineItem,
  getRandomMagRoundsForLootedWeapon,
  getMagazineWeapon,
  getMagazineCapacity,
  getMagazineAmmoId,
  isAmmoItemId,
  getMagazineRoundsLabel,
  unloadMagazineToStack,
  getEquippedMag,
  setEquippedMag,
  findFirstEmptySlotForMag,
  findFirstMagInRigOrPockets,
  removeMagFromRigOrPocket,
  placeMagInRigPocketBackpackOrGround,
  countItemInPockets,
  getReserveAmmoCount,
  removeItemFromPockets,
  removeReserveAmmo,
  createDefaultEquippedModsForWeapon,
  getEquippedModsForWeapon,
  ensureEquippedModsShape,
  getModsForWeaponInSlot,
  extraFromPlacement,
  getModsForWeaponItem,
  ensurePlacementMods,
  POCKET_LAYOUT,
  POCKET_SLOT_INDEX_TO_POCKET,
  getDefaultPockets,
  ensurePockets,
  sanitizePockets,
  ensureRigStats,
  ensureSecureContainerStats,
  ensureMedBagStats,
  ensureBackpackStats,
  getDefaultBackpack,
  ensureGridItems,
  getInventoryItemConfig,
  isMedicalItem,
  getDefaultDurability,
  getOccupiedSet,
  canPlace,
  findSpace,
  findSpaceTryRotated,
  nextPlacementId,
  placeItem,
  removeItem,
  moveItemInGrid,
  countItemInGrid,
  countGrenadesInPockets,
  getUsableGrenadeCount,
  hasDoorKey,
  hasEquippedNvg,
  removeOneGrenadeFromPocketOrRig,
  countItemInGrids,
  removeItemFromGrid,
  removeItemFromGrids,
  getOrCreateAmmoBoxInventory,
  getOrCreateRigInventory,
  tryAddItemAmmoBoxOnly,
  tryAddItem,
  isPocketSlotEmpty
};
