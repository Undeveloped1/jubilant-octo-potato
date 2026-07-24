import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import {
  isPocketSlotEmpty,
  isMagazineItem,
  getMagazineCapacity,
  canPlace,
  tryAddItem,
  ensureGridItems,
  getDefaultPockets,
  getDefaultBackpack,
  placeMagInRigPocketBackpackOrGround,
  findFirstEmptySlotForMag,
  findFirstMagInRigOrPockets,
} from '../src/inventory.js';

describe('isPocketSlotEmpty', () => {
  it('returns true for null slot', () => {
    const pockets = [[null, null]];
    expect(isPocketSlotEmpty(pockets, 0, 0)).toBe(true);
  });

  it('returns false when slot has _spansFrom (second cell of 2x1)', () => {
    const pockets = [[{ itemId: 'mag_pistol', sizeW: 2, sizeH: 1 }, { _spansFrom: 0 }]];
    expect(isPocketSlotEmpty(pockets, 0, 1)).toBe(false);
  });

  it('returns false when slot has itemId', () => {
    const pockets = [[{ itemId: 'bandage' }]];
    expect(isPocketSlotEmpty(pockets, 0, 0)).toBe(false);
  });
});

describe('isMagazineItem', () => {
  it('returns true for mag_pistol', () => {
    expect(isMagazineItem('mag_pistol')).toBe(true);
  });

  it('returns false for medkit', () => {
    expect(isMagazineItem('medkit')).toBe(false);
  });
});

describe('getMagazineCapacity', () => {
  it('returns CONFIG capacity for mag_pistol', () => {
    expect(getMagazineCapacity('mag_pistol')).toBe(CONFIG.MAGAZINES.mag_pistol.capacity);
  });
});

describe('canPlace / tryAddItem', () => {
  it('canPlace allows 1x1 on empty grid', () => {
    const grid = { gridW: 4, gridH: 4, items: [] };
    expect(canPlace(grid, 0, 0, 1, 1, null)).toBe(true);
  });

  it('tryAddItem places 1x1 item into empty grid', () => {
    const grid = { gridW: 4, gridH: 4, items: [], _nextId: 1 };
    ensureGridItems(grid);
    const ok = tryAddItem(grid, 'bandage', 1);
    expect(ok).toBe(true);
    expect(grid.items).toHaveLength(1);
    expect(grid.items[0].itemId).toBe('bandage');
    expect(grid.items[0].sizeW).toBe(1);
    expect(grid.items[0].sizeH).toBe(1);
  });
});

describe('placeMagInRigPocketBackpackOrGround', () => {
  it('stows pistol mag into empty null pocket slots (no ground drop)', () => {
    const stats = {
      armor: { rig: null },
      pockets: getDefaultPockets(),
      backpack: getDefaultBackpack(),
    };
    const dropped = [];
    const scene = {
      droppedInventoryItems: { add: (spr) => dropped.push(spr) },
      textures: { exists: () => true },
      add: { image: () => ({ setDepth() { return this; }, setData() { return this; } }) },
      player: { x: 0, y: 0 },
    };
    const dest = findFirstEmptySlotForMag(stats, 1, 1);
    expect(dest).toEqual({ container: 'pocket', pocketIndex: 0, slotIndex: 0 });

    placeMagInRigPocketBackpackOrGround(scene, stats, {
      itemId: 'mag_pistol',
      rounds: 7,
      maxRounds: CONFIG.MAGAZINES.mag_pistol.capacity,
    });

    expect(dropped).toHaveLength(0);
    expect(stats.pockets[0][0]).toMatchObject({ itemId: 'mag_pistol', rounds: 7 });
    // Reload path only looks at rig/pockets — pocket mag must be findable
    const found = findFirstMagInRigOrPockets(stats, 'pistol');
    expect(found).toMatchObject({ container: 'pocket', itemId: 'mag_pistol', rounds: 7 });
  });

  it('findFirstEmptySlotForMag prefers rig 4×2 when rig equipped (shotgun 2×1 fits)', () => {
    const stats = {
      armor: { rig: { itemId: 'rig' } },
      rigGrid: { gridW: 4, gridH: 2, items: [], _nextId: 1 },
      pockets: getDefaultPockets(),
      backpack: getDefaultBackpack(),
    };
    const dest = findFirstEmptySlotForMag(stats, 2, 1);
    expect(dest).toMatchObject({ container: 'rig', row: 0, col: 0 });
  });
});
