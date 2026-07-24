/**
 * One-shot script: extract Phase 3 modules from src/game.js and patch imports.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const gamePath = path.join(root, 'src', 'game.js');
const lines = fs.readFileSync(gamePath, 'utf8').split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function exportNamed(block, names) {
  return `${block}\n\nexport {\n  ${names.join(',\n  ')}\n};\n`;
}

// --- config.js ---
const configBody = [
  slice(2, 1156),
  slice(1158, 1201),
  slice(1242, 1242),
  `function getDefaultLimbHp() {
    const o = {};
    for (const k of Object.keys(LIMB_MAX_HP)) {
        o[k] = { hp: LIMB_MAX_HP[k], maxHp: LIMB_MAX_HP[k], status: '', effects: [] };
    }
    return o;
}`,
].join('\n');

const configExports = [
  'CONFIG', 'LIMB_MAX_HP', 'LIMB_TARGET_WEIGHT', 'MELEE_TARGET_ZONES', 'MELEE_ZONE_WEIGHTS',
  'MELEE_LIMB_POOLS', 'MELEE_STANCE_BY_ENEMY', 'RANGED_CLOSE_MAX', 'RANGED_MEDIUM_MAX',
  'RANGED_LIMB_BANDS', 'MAJOR_BLEED_PROPAGATION', 'LIMB_EFFECT_LABELS', 'LIMB_OUTCOME_TABLE',
  'ESCALATION_PCT_PER_HIT', 'ESCALATION_CAP_PCT', 'ESCALATION_TIMEOUT_MS', 'ESCALATION_EFFECT_TOTAL',
  'ENEMY_OUTCOME_MODIFIERS', 'LIMB_DISPLAY_NAMES', 'getDefaultLimbHp',
];

fs.writeFileSync(
  path.join(root, 'src', 'config.js'),
  `// Extracted from game.js — CONFIG and limb/damage tables\n${exportNamed(configBody, configExports)}`
);

// --- inventory.js ---
const isPocketSlotEmptyFn = `/** True if pocket slot is empty (cells with _spansFrom are occupied). */
function isPocketSlotEmpty(pockets, pi, si) {
    const s = pockets[pi] && pockets[pi][si];
    if (!s) return true;
    if (s._spansFrom !== undefined) return false;
    return !s.itemId;
}`;

let findFirstEmptySlotBlock = slice(2301, 2364);
findFirstEmptySlotBlock = findFirstEmptySlotBlock.replace(
  /    const isPocketSlotEmpty = \(pi, si\) => \{\n        const s = pockets\[pi\] && pockets\[pi\]\[si\];\n        if \(!s\) return true;\n        if \(s\._spansFrom !== undefined\) return false;\n        return !s\.itemId;\n    \};\n/,
  ''
);
findFirstEmptySlotBlock = findFirstEmptySlotBlock.replace(/isPocketSlotEmpty\(pi, si\)/g, 'isPocketSlotEmpty(pockets, pi, si)');

const inventoryBlocks = [
  slice(2162, 2185),
  slice(2188, 2231),
  slice(2234, 2287),
  slice(2290, 2299),
  findFirstEmptySlotBlock,
  slice(2367, 2446),
  slice(2448, 2510),
  slice(2512, 2602),
  slice(2661, 2787),
  slice(2789, 3074),
  isPocketSlotEmptyFn,
];

const defaultArmor = `{ head: null, body: null, ears: null, arms: null, feet: null, rig: null, nvg: null }`;
const defaultBackpackShape = `{ gridW: 6, gridH: 9 }`;

let inventoryBody = inventoryBlocks.join('\n\n');
inventoryBody = inventoryBody.replace(
  'const b = DEFAULT_STATS.backpack;',
  'const b = DEFAULT_BACKPACK_SHAPE;'
).replace(
  'stats.armor = Object.assign({}, DEFAULT_STATS.armor);',
  'stats.armor = Object.assign({}, DEFAULT_ARMOR);'
);

const inventoryFnNames = [
  'isModItem', 'modFitsSlot', 'getWeaponSlotNames', 'getAmmoIdForWeapon',
  'isMagazineItem', 'getRandomMagRoundsForLootedWeapon', 'getMagazineWeapon', 'getMagazineCapacity',
  'getMagazineAmmoId', 'isAmmoItemId', 'getMagazineRoundsLabel', 'unloadMagazineToStack',
  'getEquippedMag', 'setEquippedMag', 'findFirstEmptySlotForMag', 'findFirstMagInRigOrPockets',
  'removeMagFromRigOrPocket', 'placeMagInRigPocketBackpackOrGround', 'countItemInPockets',
  'getReserveAmmoCount', 'removeItemFromPockets', 'removeReserveAmmo',
  'createDefaultEquippedModsForWeapon', 'getEquippedModsForWeapon', 'ensureEquippedModsShape',
  'getModsForWeaponInSlot', 'extraFromPlacement', 'getModsForWeaponItem', 'ensurePlacementMods',
  'POCKET_LAYOUT', 'POCKET_SLOT_INDEX_TO_POCKET', 'getDefaultPockets', 'ensurePockets',
  'sanitizePockets', 'ensureRigStats', 'ensureSecureContainerStats', 'ensureMedBagStats',
  'ensureBackpackStats', 'getDefaultBackpack', 'ensureGridItems', 'getInventoryItemConfig',
  'isMedicalItem', 'getDefaultDurability', 'getOccupiedSet', 'canPlace', 'findSpace',
  'findSpaceTryRotated', 'nextPlacementId', 'placeItem', 'removeItem', 'moveItemInGrid',
  'countItemInGrid', 'removeItemFromGrid', 'tryAddItemAmmoBoxOnly', 'tryAddItem',
  'isPocketSlotEmpty',
];

fs.writeFileSync(
  path.join(root, 'src', 'inventory.js'),
  `import Phaser from 'phaser';
import { CONFIG } from './config.js';

const DEFAULT_ARMOR = ${defaultArmor};
const DEFAULT_BACKPACK_SHAPE = ${defaultBackpackShape};

${inventoryBody}

export {
  ${inventoryFnNames.join(',\n  ')}
};
`
);

// --- persistence.js ---
let defaultStatsBlock = slice(1402, 1457);
defaultStatsBlock = defaultStatsBlock.replace(
  /    limbHp: getDefaultLimbHp\(\),\n/,
  ''
).replace(
  /    \/\/ Equipped weapon mods[\s\S]*?    \}\)\(\),\n/,
  ''
);

const persistenceBody = [
  slice(1395, 1400),
  defaultStatsBlock,
  slice(1460, 1564),
  slice(2042, 2145),
  slice(2605, 2659),
  slice(3076, 3096),
].join('\n\n');

fs.writeFileSync(
  path.join(root, 'src', 'persistence.js'),
  `import { CONFIG, getDefaultLimbHp } from './config.js';
import {
  tryAddItem,
  ensureGridItems,
  ensurePlacementMods,
  createDefaultEquippedModsForWeapon,
  getEquippedModsForWeapon,
  setEquippedMag,
  getMagazineCapacity,
  ensureEquippedModsShape,
} from './inventory.js';

function buildDefaultEquippedMods() {
    const weapons = ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'];
    const o = {};
    weapons.forEach(w => { o[w] = createDefaultEquippedModsForWeapon(w); });
    return o;
}

${persistenceBody.replace('const DEFAULT_STATS = {', 'const DEFAULT_STATS_BASE = {')}

export const DEFAULT_STATS = (() => {
    const s = JSON.parse(JSON.stringify(DEFAULT_STATS_BASE));
    s.limbHp = getDefaultLimbHp();
    s.equippedMods = buildDefaultEquippedMods();
    return s;
})();

export {
  DEFAULT_PERSISTENT,
  PERSISTENT_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  loadPersistent,
  savePersistent,
  ensureInsuranceFields,
  migrateToPhysicalMagazines,
  ensureEquippedMagazines,
  ensureWeaponSlotModsShape,
  resetPersistent,
  resetRunStats,
};
`
);

// --- audio.js ---
fs.writeFileSync(
  path.join(root, 'src', 'audio.js'),
  `import { loadSettings, saveSettings } from './persistence.js';

${slice(1569, 2037)}

export { SoundManager, sfx };
`
);

// --- patch game.js: remove extracted ranges (reverse order, no overlaps) ---
const removeRanges = [
  [2162, 3096],
  [2042, 2145],
  [1569, 2037],
  [1395, 1564],
  [1243, 1245],
  [1242, 1242],
  [1158, 1201],
  [2, 1156],
];

let newLines = [...lines];
for (const [start, end] of removeRanges) {
  newLines.splice(start - 1, end - start + 1);
}

const importBlock = `import {
  CONFIG,
  LIMB_MAX_HP,
  LIMB_TARGET_WEIGHT,
  MELEE_TARGET_ZONES,
  MELEE_ZONE_WEIGHTS,
  MELEE_LIMB_POOLS,
  MELEE_STANCE_BY_ENEMY,
  RANGED_CLOSE_MAX,
  RANGED_MEDIUM_MAX,
  RANGED_LIMB_BANDS,
  MAJOR_BLEED_PROPAGATION,
  LIMB_EFFECT_LABELS,
  LIMB_OUTCOME_TABLE,
  ESCALATION_PCT_PER_HIT,
  ESCALATION_CAP_PCT,
  ESCALATION_TIMEOUT_MS,
  ESCALATION_EFFECT_TOTAL,
  ENEMY_OUTCOME_MODIFIERS,
  LIMB_DISPLAY_NAMES,
  getDefaultLimbHp,
} from './config.js';
import {
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
  removeItemFromGrid,
  tryAddItemAmmoBoxOnly,
  tryAddItem,
  isPocketSlotEmpty,
} from './inventory.js';
import {
  DEFAULT_STATS,
  DEFAULT_PERSISTENT,
  PERSISTENT_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  loadPersistent,
  savePersistent,
  ensureInsuranceFields,
  migrateToPhysicalMagazines,
  ensureEquippedMagazines,
  ensureWeaponSlotModsShape,
  resetPersistent,
  resetRunStats,
} from './persistence.js';
import { sfx } from './audio.js';
`;

// Remove leading blank lines and prepend imports
while (newLines.length && newLines[0].trim() === '') newLines.shift();
newLines.unshift(importBlock.trim(), '');

fs.writeFileSync(gamePath, newLines.join('\n'));
console.log('Phase 3 peel complete: config, inventory, persistence, audio + game.js patched');
