import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import {
  isPocketSlotEmpty,
  isMagazineItem,
  getMagazineCapacity,
  canPlace,
  tryAddItem,
  ensureGridItems,
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
