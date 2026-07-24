import { CONFIG, getDefaultLimbHp } from './config.js';
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

function ensureInsuranceFields(persistent) {
    if (!persistent) return persistent;
    if (persistent.insuranceActive == null) persistent.insuranceActive = false;
    if (!Array.isArray(persistent.insuranceReturns)) persistent.insuranceReturns = [];
    return persistent;
}

const DEFAULT_STATS_BASE = { 
    hp: 190, maxHp: 190, stamina: 100, maxStamina: 100, scrap: 0,
    blood: 100,
    maxBlood: 100,
    infection: 0, // 0–100; fills after zombie bite; cleared on extraction
    credits: 0,
    materials: 0,
    grenades: 0,
    nextLevel: 1,  // Track which level to start on after extraction
    highestLevelUnlocked: 1,  // Track progression (1-7) for mission map
    consumables: [null, null, null],  // 3 slots for hotkeys 1, 2, 3
    hasFlashlight: false, hasShotgun: false, hasSMG: true, hasCrossbow: false, hasRifle: true, currentWeapon: 'rifle',
    // Magazine tracking - current rounds in each weapon's magazine
    magazines: {
        pistol: CONFIG.WEAPONS.PISTOL.MAG_SIZE,
        shotgun: CONFIG.WEAPONS.SHOTGUN.MAG_SIZE,
        smg: CONFIG.WEAPONS.SMG.MAG_SIZE,
        crossbow: CONFIG.WEAPONS.CROSSBOW.MAG_SIZE,
        rifle: CONFIG.WEAPONS.RIFLE.MAG_SIZE
    },
    armor: { head: null, body: null, ears: null, arms: null, feet: null, rig: null, nvg: null },
    rigGrid: null,
    weaponSlots: { primary: 'rifle', secondary: 'smg', sidearm: 'pistol', melee: null },
    // Per-slot attachment mods (each weapon instance can have different mods). Keys: primary, secondary, sidearm, melee. Value: { slotName: modId } or null.
    weaponSlotMods: { primary: null, secondary: null, sidearm: null, melee: null },
    // Equipped physical magazine in gun (pistol, smg, rifle only). Shape: { itemId, rounds, maxRounds } or null.
    equippedMagazines: { pistol: null, smg: null, rifle: null },
    hideout: { 
        restAreaLvl: 0, 
        generatorLvl: 0, 
        hasSparkPlug: false,
        tinkerBench: { crafting: null },
        gunBench: { level: 1, crafting: null },
        workbenchLvl: 0,  // Weapon damage upgrade
        repairStationLvl: 0  // Armor repair
    },
    // Backpack grid (run inventory); items: [{ placementId, itemId, count, row, col, sizeW, sizeH }]
    backpack: { gridW: 6, gridH: 9, items: [], _nextId: 1 },
    // Equipped backpack (data model for 1.5 UI). When set, backpack is the grid for this container.
    equippedBackpack: { itemId: 'backpack_default', placementId: 'equipped' },
    backpackInventories: {},  // keyed by 'equipped' or stash placementId; 'equipped' holds the active grid
    // Secure container: 2×3 grid, always equipped (like rig); contents persist to stash on death/exit (later).
    secureContainerGrid: { gridW: 2, gridH: 3, items: [], _nextId: 1 },
    // Med bag: 2×2 grid, medical-only; always equipped; same pattern as secure container.
    medBagGrid: { gridW: 2, gridH: 2, items: [], _nextId: 1 },
    // Pockets: [ pocket1[2], pocket2[2], pocket3[1], pocket4[1] ]. Pocket 1&2 = 2×1; 3&4 = 1×1 above.
    pockets: [[null, null], [null, null], [null], [null]]
};

const DEFAULT_PERSISTENT = {
    // Lifetime stats
    totalKills: 0,
    totalDeaths: 0,
    runsCompleted: 0,
    runsStarted: 0,
    totalShotsFired: 0,
    totalShotsHit: 0,
    totalScrapCollected: 0,
    totalCreditsEarned: 0,
    totalMaterialsCollected: 0,
    totalGrenadeKills: 0,
    bossesKilled: 0,
    meleeKills: 0,
    itemsSold: 0,
    itemsBought: 0,
    // Current run stats (reset each run)
    runKills: 0,
    runShotsFired: 0,
    runShotsHit: 0,
    runDamageTaken: 0,
    runGrenadeKills: 0,
    runMeleeKills: 0,
    bossHitWithGun: false, // For melee master achievement
    // Achievements unlocked
    achievements: [],
    // Class system
    totalHPHealed: 0,               // For Medic class unlock
    unlockedClasses: ['survivor'],  // Classes available to play
    selectedClass: 'survivor',      // Current class selection
    // Permanent upgrades system
    unlockedUpgrades: [],           // Permanently unlocked upgrades
    equippedSkin: null,             // null = default green
    equippedMuzzle: null,           // null = default yellow/orange
    highestLevelUnlocked: 1,        // Mirror from stats for upgrade tracking
    bestLevelTimes: {},             // Future: { 1: ms, 2: ms, ... }
    
    // Skill Tree system
    skillPoints: 0,                 // Spendable skill points
    totalSkillPoints: 0,            // Lifetime skill points earned (for stats)
    unlockedSkills: [],             // Array of skill IDs player has purchased
    secondWindUsed: false,          // Tracks if Second Wind was used this run
    
    // Challenge System
    activeDailies: [],              // 3 active daily challenges with progress { id, progress }
    activeWeeklies: [],             // 5 active weekly challenges with progress { id, progress }
    completedPermanents: [],        // IDs of completed permanent challenges
    dailyResetTime: 0,              // Unix timestamp for next daily reset
    weeklyResetTime: 0,             // Unix timestamp for next weekly reset
    // Weekly tracking stats (reset each week)
    weeklyKills: 0,
    weeklyExtractions: 0,
    weeklyBossKills: 0,
    weeklyScrap: 0,
    weeklyUniqueLevels: [],         // Array of level numbers extracted from this week
    // Lifetime stats for permanent challenges
    crossbowKills: 0,
    perfectLevels: 0,               // Levels completed with 0 damage
    // Run-specific tracking (extended)
    runScrapCollected: 0,
    runLevelStartTime: 0,           // For speed run tracking
    runWeaponUsed: null,            // For pistol-only challenge
    
    // Weapon Mods System
    modInventory: [],              // Array of mod IDs owned (stored permanently)
    level7Completed: false,        // Show checkmark on Cemetery in mission select
    // Stash grid (persistent storage at hideout); same item shape as backpack
    stash: { gridW: 12, gridH: 16, items: [], _nextId: 1 },
    // Currencies stored at hideout (not carried into raid)
    scrap: 0,
    credits: 0,
    materials: 0,
    // Quests: accepted (active) and completed
    activeQuests: [],
    completedQuests: [],
    // Insurance: mid-raid loot may return to stash after death (Phase 7)
    insuranceActive: false,
    insuranceReturns: [] // [{ itemId, count, ..., readyAt }]
};

const PERSISTENT_KEY = 'zombie_persistent_v17';

// Default settings
const DEFAULT_SETTINGS = {
    masterVolume: 0.3,
    sfxVolume: 1.0,
    musicVolume: 0.5,
    screenShake: true,
    hitIndicators: true
};

// =============================================================================
// SETTINGS MANAGER
// =============================================================================
function loadSettings() {
    const saved = localStorage.getItem(CONFIG.SETTINGS_KEY);
    if (saved) {
        return { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ...JSON.parse(saved) };
    }
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings(settings) {
    localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(settings));
}

function loadPersistent() {
    let saved = localStorage.getItem(PERSISTENT_KEY);
    
    // Migration: Check for old v16 data if v17 doesn't exist
    if (!saved) {
        const oldSaved = localStorage.getItem('zombie_persistent_v16');
        if (oldSaved) {
            saved = oldSaved;
            // Migrate to new key
            localStorage.setItem(PERSISTENT_KEY, saved);
            console.log('Migrated persistent data from v16 to v17');
        }
    }
    
    if (saved) {
        const data = JSON.parse(saved);
        // Merge with defaults to handle new fields (including class system)
        const merged = { ...JSON.parse(JSON.stringify(DEFAULT_PERSISTENT)), ...data };
        // Ensure class fields are properly initialized
        if (!merged.unlockedClasses || !Array.isArray(merged.unlockedClasses)) {
            merged.unlockedClasses = ['survivor'];
        }
        if (!merged.selectedClass) {
            merged.selectedClass = 'survivor';
        }
        if (merged.totalHPHealed === undefined) {
            merged.totalHPHealed = 0;
        }
        // Ensure upgrade fields are properly initialized
        if (!merged.unlockedUpgrades || !Array.isArray(merged.unlockedUpgrades)) {
            merged.unlockedUpgrades = [];
        }
        if (merged.highestLevelUnlocked === undefined) {
            merged.highestLevelUnlocked = 1;
        }
        // Ensure skill tree fields are properly initialized
        if (merged.skillPoints === undefined) {
            merged.skillPoints = 0;
        }
        if (merged.totalSkillPoints === undefined) {
            merged.totalSkillPoints = 0;
        }
        if (!merged.unlockedSkills || !Array.isArray(merged.unlockedSkills)) {
            merged.unlockedSkills = [];
        }
        if (merged.secondWindUsed === undefined) {
            merged.secondWindUsed = false;
        }
        // Ensure challenge fields are properly initialized
        if (!merged.activeDailies || !Array.isArray(merged.activeDailies)) {
            merged.activeDailies = [];
        }
        if (!merged.activeWeeklies || !Array.isArray(merged.activeWeeklies)) {
            merged.activeWeeklies = [];
        }
        if (!merged.completedPermanents || !Array.isArray(merged.completedPermanents)) {
            merged.completedPermanents = [];
        }
        if (!merged.weeklyUniqueLevels || !Array.isArray(merged.weeklyUniqueLevels)) {
            merged.weeklyUniqueLevels = [];
        }
        if (merged.dailyResetTime === undefined) merged.dailyResetTime = 0;
        if (merged.weeklyResetTime === undefined) merged.weeklyResetTime = 0;
        if (merged.weeklyKills === undefined) merged.weeklyKills = 0;
        if (merged.weeklyExtractions === undefined) merged.weeklyExtractions = 0;
        if (merged.weeklyBossKills === undefined) merged.weeklyBossKills = 0;
        if (merged.weeklyScrap === undefined) merged.weeklyScrap = 0;
        if (merged.crossbowKills === undefined) merged.crossbowKills = 0;
        if (merged.perfectLevels === undefined) merged.perfectLevels = 0;
        if (merged.runScrapCollected === undefined) merged.runScrapCollected = 0;
        // Ensure weapon mods fields are properly initialized
        if (!merged.modInventory || !Array.isArray(merged.modInventory)) {
            merged.modInventory = [];
        }
        if (!merged.stash) merged.stash = { gridW: 12, gridH: 16, items: [], _nextId: 1 };
        ensureGridItems(merged.stash);
        ensurePlacementMods(merged.stash);
        const nonGridStash = (CONFIG.LOOT && CONFIG.LOOT.NON_GRID_ITEM_IDS) || [];
        merged.stash.items = merged.stash.items.filter(p => !nonGridStash.includes(p.itemId));
        if (!merged.ammoBoxInventories || typeof merged.ammoBoxInventories !== 'object') merged.ammoBoxInventories = {};
        if (!merged.rigInventories || typeof merged.rigInventories !== 'object') merged.rigInventories = {};
        (merged.stash.items || []).forEach(p => {
            if (p.itemId === 'ammo_box') { p.sizeW = 2; p.sizeH = 2; }
            if (p.itemId === 'rig') { p.sizeW = 3; p.sizeH = 2; }
            if (p.itemId === 'backpack_default') { p.sizeW = 5; p.sizeH = 8; }
        });
        if (!(merged.stash.items || []).some(p => p.itemId === 'ammo_box')) tryAddItem(merged.stash, 'ammo_box', 1);
        if (!(merged.stash.items || []).some(p => p.itemId === 'rig')) tryAddItem(merged.stash, 'rig', 1);
        if (merged.stash.gridW == null) merged.stash.gridW = 12;
        if (merged.stash.gridH == null) merged.stash.gridH = 16;
        if (merged.scrap === undefined) merged.scrap = 0;
        if (merged.credits === undefined) merged.credits = 0;
        if (merged.materials === undefined) merged.materials = 0;
        if (!merged.activeQuests || !Array.isArray(merged.activeQuests)) merged.activeQuests = [];
        if (!merged.completedQuests || !Array.isArray(merged.completedQuests)) merged.completedQuests = [];
        if (!merged.questTurnInProgress || typeof merged.questTurnInProgress !== 'object') merged.questTurnInProgress = {};
        return merged;
    }
    return JSON.parse(JSON.stringify(DEFAULT_PERSISTENT));
}

function savePersistent(data) {
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(data));
}

function migrateToPhysicalMagazines(stats) {
    if (!stats || stats._magazinesMigrated) return;
    stats._magazinesMigrated = true;
    ensureEquippedMagazines(stats);
    ensureWeaponSlotModsShape(stats);
    const slotIds = ['primary', 'secondary', 'sidearm'];
    const magWeapons = ['pistol', 'smg', 'rifle'];
    const magItemByWeapon = { pistol: 'mag_pistol', smg: 'mag_smg', rifle: 'mag_rifle' };
    slotIds.forEach(slotId => {
        const weaponId = stats.weaponSlots && stats.weaponSlots[slotId];
        if (!weaponId || !magWeapons.includes(weaponId)) return;
        const magItemId = magItemByWeapon[weaponId];
        const capacity = getMagazineCapacity(magItemId);
        const currentRounds = (stats.magazines && stats.magazines[weaponId] != null)
            ? Math.min(Math.max(0, stats.magazines[weaponId]), capacity) : 0;
        setEquippedMag(stats, weaponId, { itemId: magItemId, rounds: currentRounds, maxRounds: capacity });
        const mods = stats.weaponSlotMods && stats.weaponSlotMods[slotId];
        if (mods && typeof mods === 'object') {
            if (mods.magazine === 'extended_mag') mods.magazine = null;
            if (mods.magazine_mod === 'extended_mag') mods.magazine_mod = null;
        }
    });
    stats._magazinesMigrated = true;
}

/** Ensures stats.equippedMagazines exists (pistol, smg, rifle = null or { itemId, rounds, maxRounds }). */
function ensureEquippedMagazines(stats) {
    if (!stats) return;
    if (!stats.equippedMagazines || typeof stats.equippedMagazines !== 'object')
        stats.equippedMagazines = { pistol: null, smg: null, rifle: null };
    ['pistol', 'smg', 'rifle'].forEach(w => {
        if (!stats.equippedMagazines[w] || typeof stats.equippedMagazines[w] !== 'object') stats.equippedMagazines[w] = null;
    });
    migrateToPhysicalMagazines(stats);
}

/** Ensures stats.weaponSlotMods exists and has object per slot that has a weapon. Migrates from equippedMods if slot mods missing. */
function ensureWeaponSlotModsShape(stats) {
    if (!stats) return;
    ensureEquippedMagazines(stats);
    if (!stats.weaponSlotMods || typeof stats.weaponSlotMods !== 'object')
        stats.weaponSlotMods = { primary: null, secondary: null, sidearm: null, melee: null };
    const slotIds = ['primary', 'secondary', 'sidearm', 'melee'];
    ensureEquippedModsShape(stats);
    slotIds.forEach(slotId => {
        const weaponId = stats.weaponSlots && stats.weaponSlots[slotId];
        if (!weaponId) {
            stats.weaponSlotMods[slotId] = null;
            return;
        }
        let m = stats.weaponSlotMods[slotId];
        if (!m || typeof m !== 'object')
            stats.weaponSlotMods[slotId] = getEquippedModsForWeapon(stats, weaponId);
    });
}

function resetPersistent() {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_PERSISTENT));
    localStorage.setItem(PERSISTENT_KEY, JSON.stringify(fresh));
    return fresh;
}

function resetRunStats(persistent) {
    persistent.runKills = 0;
    persistent.runShotsFired = 0;
    persistent.runShotsHit = 0;
    persistent.runDamageTaken = 0;
    persistent.runGrenadeKills = 0;
    persistent.runMeleeKills = 0;
    persistent.bossHitWithGun = false;
    persistent.secondWindUsed = false; // Reset Second Wind skill for new run
    // Challenge tracking resets
    persistent.runScrapCollected = 0;
    persistent.runLevelStartTime = Date.now();
    persistent.runWeaponUsed = null;
    return persistent;
}

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
