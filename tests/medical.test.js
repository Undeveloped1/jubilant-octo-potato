import { describe, it, expect } from 'vitest';
import { getDefaultLimbHp } from '../src/config.js';
import {
  applyMedicalItemToLimb,
  cureInfectionOnStats,
  ensureLimbVisStats,
  sumLimbHp,
} from '../src/medical.js';

function makeStats(overrides = {}) {
  const limbHp = getDefaultLimbHp();
  const stats = {
    limbHp,
    hp: sumLimbHp(limbHp),
    maxHp: sumLimbHp(limbHp),
    infection: 0,
    ...overrides,
  };
  ensureLimbVisStats(stats);
  return stats;
}

describe('cureInfectionOnStats', () => {
  it('clears infection and returns true', () => {
    const stats = makeStats({ infection: 40 });
    expect(cureInfectionOnStats(stats)).toBe(true);
    expect(stats.infection).toBe(0);
  });

  it('returns false when not infected', () => {
    const stats = makeStats({ infection: 0 });
    expect(cureInfectionOnStats(stats)).toBe(false);
  });
});

describe('applyMedicalItemToLimb', () => {
  it('heals with medkit and returns leftover durability via putBack', () => {
    const stats = makeStats();
    stats.limbHp.chest.hp = 20;
    const putBacks = [];
    const result = applyMedicalItemToLimb({
      stats,
      limbId: 'chest',
      item: { itemId: 'medkit', durability: 120, maxDurability: 120 },
      hooks: { putBack: (item) => putBacks.push(item) },
    });
    expect(result.applied).toBe(true);
    expect(stats.limbHp.chest.hp).toBe(50);
    expect(putBacks).toHaveLength(1);
    expect(putBacks[0].durability).toBe(90);
  });

  it('blocks medkit on traumatized limb', () => {
    const stats = makeStats();
    stats.limbHp.chest.hp = 0;
    stats.limbHp.chest.effects = ['trauma'];
    const putBacks = [];
    const result = applyMedicalItemToLimb({
      stats,
      limbId: 'chest',
      item: { itemId: 'medkit', durability: 120, maxDurability: 120 },
      hooks: { putBack: (item) => putBacks.push(item) },
    });
    expect(result.applied).toBe(false);
    expect(putBacks).toHaveLength(1);
    expect(putBacks[0].itemId).toBe('medkit');
  });

  it('antidote cures infection; no-op puts item back when not infected', () => {
    const infected = makeStats({ infection: 55 });
    const cleared = [];
    const ok = applyMedicalItemToLimb({
      stats: infected,
      limbId: 'chest',
      item: { itemId: 'antidote' },
      hooks: {
        putBack: () => {},
        onInfectionCleared: () => cleared.push(true),
      },
    });
    expect(ok.applied).toBe(true);
    expect(infected.infection).toBe(0);
    expect(cleared).toHaveLength(1);

    const clean = makeStats({ infection: 0 });
    const putBacks = [];
    const noop = applyMedicalItemToLimb({
      stats: clean,
      limbId: 'chest',
      item: { itemId: 'antidote' },
      hooks: { putBack: (item) => putBacks.push(item) },
    });
    expect(noop.applied).toBe(false);
    expect(putBacks).toHaveLength(1);
  });

  it('bandage removes minor_bleed and spends 1 durability', () => {
    const stats = makeStats();
    stats.limbHp.leftArm.effects = ['minor_bleed'];
    const putBacks = [];
    const result = applyMedicalItemToLimb({
      stats,
      limbId: 'leftArm',
      item: { itemId: 'bandage', durability: 2, maxDurability: 2 },
      hooks: { putBack: (item) => putBacks.push(item) },
    });
    expect(result.applied).toBe(true);
    expect(stats.limbHp.leftArm.effects).not.toContain('minor_bleed');
    expect(putBacks[0].durability).toBe(1);
  });
});
