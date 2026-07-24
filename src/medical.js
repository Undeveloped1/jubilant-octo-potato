import { CONFIG, LIMB_MAX_HP, LIMB_EFFECT_LABELS } from './config.js';
import { getDefaultDurability } from './inventory.js';

const STATUS_REMOVAL_MAP = {
  bandage: 'minor_bleed',
  hemostat: 'major_bleed',
  splint: 'break',
  trauma_kit: 'trauma',
};

const BREAKABLE_LIMBS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

/** Human-readable limb effect labels for inventory HUD. */
function limbEffectsToStatusString(effects) {
  if (!Array.isArray(effects) || effects.length === 0) return '';
  return effects.map(e => LIMB_EFFECT_LABELS[e] || e).join(', ');
}

function sumLimbHp(limbHp) {
  if (!limbHp) return 0;
  return Object.keys(limbHp).reduce((s, k) => s + (limbHp[k].hp || 0), 0);
}

function sumLimbMaxHp(limbHp) {
  if (!limbHp) return 0;
  return Object.keys(limbHp).reduce((s, k) => s + (limbHp[k].maxHp || 0), 0);
}

/** Ensure blood/infection fields exist on loaded/legacy saves. */
function ensureLimbVisStats(stats) {
  if (!stats) return stats;
  const maxB = (CONFIG.LIMB_VIS && CONFIG.LIMB_VIS.BLOOD_MAX) || 100;
  if (stats.maxBlood == null || stats.maxBlood <= 0) stats.maxBlood = maxB;
  if (stats.blood == null || stats.blood < 0) stats.blood = stats.maxBlood;
  if (stats.infection == null || stats.infection < 0) stats.infection = 0;
  if (stats.infection > 100) stats.infection = 100;
  return stats;
}

/** Clear infection on stats. Returns true if there was infection to clear. */
function cureInfectionOnStats(stats) {
  ensureLimbVisStats(stats);
  if ((stats.infection || 0) <= 0) return false;
  stats.infection = 0;
  return true;
}

function refreshHpTotals(stats) {
  stats.hp = sumLimbHp(stats.limbHp);
  stats.maxHp = sumLimbMaxHp(stats.limbHp);
}

function resolveDurability(item, fallbackDur) {
  const def = getDefaultDurability(item.itemId);
  const dur = item.durability != null ? item.durability : (def ? def.durability : fallbackDur);
  const maxD = item.maxDurability != null ? item.maxDurability : (def ? def.maxDurability : fallbackDur);
  return { dur, maxD };
}

/**
 * Apply a medical item to one limb. Mutates stats / item durability via hooks.putBack.
 * @returns {{ applied: boolean, consumed: boolean }}
 */
function applyMedicalItemToLimb({ stats, limbId, item, hooks = {} }) {
  const putBack = typeof hooks.putBack === 'function' ? hooks.putBack : () => {};
  const onHealSfx = typeof hooks.onHealSfx === 'function' ? hooks.onHealSfx : () => {};
  const onInfectionCleared = typeof hooks.onInfectionCleared === 'function' ? hooks.onInfectionCleared : () => {};
  const onArmPenaltyCheck = typeof hooks.onArmPenaltyCheck === 'function' ? hooks.onArmPenaltyCheck : () => {};
  const onRerender = typeof hooks.onRerender === 'function' ? hooks.onRerender : () => {};
  const clearBrokenArmRoll = typeof hooks.clearBrokenArmRoll === 'function' ? hooks.clearBrokenArmRoll : () => {};

  if (!stats || !stats.limbHp || !item || !limbId) {
    if (item) putBack(item);
    return { applied: false, consumed: false };
  }

  const limb = stats.limbHp[limbId];
  if (!limb) {
    putBack(item);
    return { applied: false, consumed: false };
  }

  const isHealItem = item.itemId === 'medkit';
  const hasTrauma = Array.isArray(limb.effects) && limb.effects.includes('trauma');

  if (isHealItem && hasTrauma) {
    putBack(item);
    return { applied: false, consumed: false };
  }

  if (isHealItem) {
    const maxH = limb.maxHp || LIMB_MAX_HP[limbId];
    let { dur, maxD } = resolveDurability(item, 10);
    if (Array.isArray(limb.effects)) {
      if (limb.effects.includes('major_bleed') && dur >= 50) {
        limb.effects.splice(limb.effects.indexOf('major_bleed'), 1);
        dur -= 50;
      }
      if (limb.effects.includes('minor_bleed') && dur >= 25) {
        limb.effects.splice(limb.effects.indexOf('minor_bleed'), 1);
        dur -= 25;
      }
    }
    const need = maxH - (limb.hp || 0);
    const healAmount = Math.min(need, dur);
    limb.hp = (limb.hp || 0) + healAmount;
    const newDur = dur - healAmount;
    refreshHpTotals(stats);
    if (newDur > 0) putBack({ ...item, durability: newDur, maxDurability: maxD });
    onHealSfx();
    onArmPenaltyCheck();
    onRerender();
    return { applied: true, consumed: newDur <= 0 };
  }

  if (item.itemId === 'antidote') {
    if (!cureInfectionOnStats(stats)) {
      putBack(item);
      return { applied: false, consumed: false };
    }
    onInfectionCleared();
    onHealSfx();
    onRerender();
    return { applied: true, consumed: true };
  }

  const effectToRemove = STATUS_REMOVAL_MAP[item.itemId];
  if (effectToRemove && Array.isArray(limb.effects) && limb.effects.includes(effectToRemove)) {
    const idx = limb.effects.indexOf(effectToRemove);
    limb.effects.splice(idx, 1);
    if (effectToRemove === 'break' && (limbId === 'leftArm' || limbId === 'rightArm')) {
      clearBrokenArmRoll(limbId);
    }
    const { dur, maxD } = resolveDurability(item, 2);
    const newDur = dur - 1;
    if (newDur > 0) putBack({ ...item, durability: newDur, maxDurability: maxD });
    onHealSfx();
    onArmPenaltyCheck();
    onRerender();
    return { applied: true, consumed: newDur <= 0 };
  }

  if (item.itemId === 'limb_breaker') {
    if (!BREAKABLE_LIMBS.includes(limbId)) {
      putBack(item);
      return { applied: false, consumed: false };
    }
    if (!Array.isArray(limb.effects)) limb.effects = [];
    if (!limb.effects.includes('break')) limb.effects.push('break');
    const { dur, maxD } = resolveDurability(item, 5);
    const newDur = dur - 1;
    if (newDur > 0) putBack({ ...item, durability: newDur, maxDurability: maxD });
    onArmPenaltyCheck();
    onRerender();
    return { applied: true, consumed: newDur <= 0 };
  }

  if (item.itemId === 'trauma_inflict') {
    if (!Array.isArray(limb.effects)) limb.effects = [];
    limb.hp = 0;
    if (!limb.effects.includes('trauma')) limb.effects.push('trauma');
    refreshHpTotals(stats);
    const { dur, maxD } = resolveDurability(item, 5);
    const newDur = dur - 1;
    if (newDur > 0) putBack({ ...item, durability: newDur, maxDurability: maxD });
    onArmPenaltyCheck();
    onRerender();
    return { applied: true, consumed: newDur <= 0 };
  }

  putBack(item);
  return { applied: false, consumed: false };
}

export {
  limbEffectsToStatusString,
  sumLimbHp,
  sumLimbMaxHp,
  ensureLimbVisStats,
  cureInfectionOnStats,
  applyMedicalItemToLimb,
};
