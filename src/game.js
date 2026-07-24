import {
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
import {
  sumLimbHp,
  sumLimbMaxHp,
  ensureLimbVisStats,
  cureInfectionOnStats,
} from './medical.js';
import { renderInventoryPanel as renderSharedInventoryPanel } from './invUi.js';
import {
  createRaidInvCtx,
  createHideoutInvCtx,
  ensureInvCtx,
} from './invUiContext.js';

/** URL smoke tests: ?smoke=magPickup boots straight into a raid ready to validate mag stow. */
function getSmokeTestFromUrl() {
    try {
        return new URLSearchParams(window.location.search).get('smoke');
    } catch (e) {
        return null;
    }
}

/** Apply per-enemy modifiers to outcome table. mods = { breakBonus, blackBonus, minorBleedBonus, majorBleedBonus }. */
function outcomeTableWithEnemyModifiers(table, enemyType) {
    const mods = enemyType && ENEMY_OUTCOME_MODIFIERS[enemyType];
    if (!mods) return table;
    let shift = 0;
    const out = { ...table };
    if (mods.minorBleedBonus) { out.minor_bleed = (out.minor_bleed || 0) + mods.minorBleedBonus; shift += mods.minorBleedBonus; }
    if (mods.majorBleedBonus) { out.major_bleed = (out.major_bleed || 0) + mods.majorBleedBonus; shift += mods.majorBleedBonus; }
    if (mods.breakBonus) { out.break = (out.break || 0) + mods.breakBonus; shift += mods.breakBonus; }
    if (mods.blackBonus) { out.black = (out.black || 0) + mods.blackBonus; shift += mods.blackBonus; }
    if (shift > 0) out.damage_only = Math.max(0, (out.damage_only != null ? out.damage_only : 82) - shift);
    return out;
}
/** Build outcome table with escalation: shift shiftPct from damage_only into effects (proportional). */
function outcomeTableWithEscalation(baseTable, hitCount) {
    const shiftPct = Math.min(hitCount * ESCALATION_PCT_PER_HIT, ESCALATION_CAP_PCT);
    if (shiftPct <= 0) return baseTable;
    const d = baseTable.damage_only != null ? baseTable.damage_only : 82;
    const out = { ...baseTable };
    out.damage_only = Math.max(0, d - shiftPct);
    const ratio = shiftPct / ESCALATION_EFFECT_TOTAL;
    if (out.minor_bleed != null) out.minor_bleed = out.minor_bleed + 10 * ratio;
    if (out.major_bleed != null) out.major_bleed = out.major_bleed + 5 * ratio;
    if (out.break != null) out.break = out.break + 2.5 * ratio;
    if (out.black != null) out.black = out.black + 0.5 * ratio;
    return out;
}
/** Roll one outcome from the table. table = { outcomeId: cumulativePercent, ... }. Returns outcome id string. */
function rollOutcome(table) {
    const entries = Object.entries(table);
    let total = 0;
    for (const [, pct] of entries) total += pct;
    let r = Math.random() * total;
    for (const [outcome, pct] of entries) {
        r -= pct;
        if (r <= 0) return outcome;
    }
    return entries[0][0];
}
/** Human-readable limb name for damage log */
/** Pick one limb id by size-weighted random. limbIds = array of limb ids, or null/undefined = all limbs from LIMB_MAX_HP. */
function pickOneLimbByWeight(limbIds) {
    const ids = limbIds && limbIds.length > 0 ? limbIds : Object.keys(LIMB_MAX_HP);
    let total = 0;
    for (const id of ids) {
        const w = LIMB_TARGET_WEIGHT[id];
        if (w != null && w > 0) total += w;
    }
    if (total <= 0) return ids[Math.floor(Math.random() * ids.length)];
    let r = Math.random() * total;
    for (const id of ids) {
        const w = LIMB_TARGET_WEIGHT[id];
        if (w != null && w > 0) {
            r -= w;
            if (r <= 0) return id;
        }
    }
    return ids[ids.length - 1];
}
function limbHasBreak(limbHp, limbId) {
    return limbHp && limbHp[limbId] && Array.isArray(limbHp[limbId].effects) && limbHp[limbId].effects.includes('break');
}

function limbHasBleedEffect(limbHp, effectId) {
    if (!limbHp) return false;
    return Object.keys(limbHp).some(id => {
        const e = limbHp[id] && limbHp[id].effects;
        return Array.isArray(e) && e.includes(effectId);
    });
}

function hasAnyBleed(limbHp) {
    return limbHasBleedEffect(limbHp, 'minor_bleed') || limbHasBleedEffect(limbHp, 'major_bleed');
}

/** Flatten carried grid/pocket/consumable items into snapshot rows for diffs. */
function collectCarriedItemSnapshots(stats) {
    const rows = [];
    if (!stats) return rows;
    const pushPlacement = (p) => {
        if (!p || !p.itemId) return;
        rows.push({
            itemId: p.itemId,
            count: p.count || 1,
            durability: p.durability,
            maxDurability: p.maxDurability,
            rounds: p.rounds,
            maxRounds: p.maxRounds
        });
    };
    const addGrid = (grid) => {
        (grid && grid.items ? grid.items : []).forEach(pushPlacement);
    };
    addGrid(stats.backpack);
    addGrid(stats.rigGrid);
    addGrid(stats.medBagGrid);
    addGrid(stats.secureContainerGrid);
    if (Array.isArray(stats.pockets)) {
        stats.pockets.forEach(pocket => {
            (pocket || []).forEach(cell => {
                if (!cell || !cell.itemId || cell._spansFrom) return;
                pushPlacement(cell);
            });
        });
    }
    (stats.consumables || []).forEach(id => {
        if (id) rows.push({ itemId: id, count: 1, fromConsumable: true });
    });
    return rows;
}

function itemSnapshotKey(row) {
    if (!row) return '';
    return [
        row.itemId,
        row.durability != null ? row.durability : '',
        row.maxDurability != null ? row.maxDurability : '',
        row.rounds != null ? row.rounds : '',
        row.maxRounds != null ? row.maxRounds : '',
        row.fromConsumable ? 'c' : 'g'
    ].join('|');
}

/** Mid-raid loot lost on death (present in current, not in checkpoint baseline). */
function diffLostItemSnapshots(currentStats, baselineStats) {
    const baseCounts = Object.create(null);
    collectCarriedItemSnapshots(baselineStats).forEach(row => {
        const k = itemSnapshotKey(row);
        baseCounts[k] = (baseCounts[k] || 0) + (row.count || 1);
    });
    const lost = [];
    collectCarriedItemSnapshots(currentStats).forEach(row => {
        const k = itemSnapshotKey(row);
        let n = row.count || 1;
        const covered = baseCounts[k] || 0;
        if (covered >= n) {
            baseCounts[k] = covered - n;
            return;
        }
        if (covered > 0) {
            n -= covered;
            baseCounts[k] = 0;
        }
        if (n > 0) lost.push({ ...row, count: n });
    });
    return lost;
}

/** Labels for death-recap UI. */
function diffLostItemLabels(currentStats, baselineStats) {
    return diffLostItemSnapshots(currentStats, baselineStats).map(row => {
        const cfg = getInventoryItemConfig(row.itemId);
        const cons = CONFIG.CONSUMABLES && CONFIG.CONSUMABLES[row.itemId];
        const label = (cfg && cfg.label) || (cons && cons.name) || row.itemId;
        return (row.count || 1) > 1 ? `${label} x${row.count}` : label;
    });
}


// =============================================================================
// AUDIO MANAGER (PROCEDURAL SOUNDS WITH VOLUME CONTROL)
// =============================================================================

// =============================================================================
// PERSISTENT STATS & ACHIEVEMENTS MANAGER
// =============================================================================

/** Pick one mod ID weighted by CONFIG.MODS.rarity (common > uncommon > rare). */
function pickModByRarity() {
    const weights = (CONFIG.LOOT && CONFIG.LOOT.MOD_RARITY_WEIGHTS) ? CONFIG.LOOT.MOD_RARITY_WEIGHTS : { common: 60, uncommon: 30, rare: 10 };
    const mods = Object.values(CONFIG.MODS || {});
    const weighted = [];
    mods.forEach(m => {
        const w = weights[m.rarity] || 10;
        for (let i = 0; i < w; i++) weighted.push(m.id);
    });
    if (weighted.length === 0 && CONFIG.RISK_ROOM && CONFIG.RISK_ROOM.GUARANTEED_DROPS && CONFIG.RISK_ROOM.GUARANTEED_DROPS.length > 0)
        return CONFIG.RISK_ROOM.GUARANTEED_DROPS[Math.floor(Math.random() * CONFIG.RISK_ROOM.GUARANTEED_DROPS.length)];
    return weighted.length > 0 ? weighted[Math.floor(Math.random() * weighted.length)] : 'extended_mag';
}

// ========== Weapon attachment slots (plan: weapon_attachments_and_magazines) ==========

// =============================================================================
// CHALLENGE SYSTEM - Daily/Weekly rotation and tracking
// =============================================================================

// Get next daily reset time (midnight UTC)
function getNextDailyReset() {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return tomorrow.getTime();
}

// Get next weekly reset time (Monday midnight UTC)
function getNextWeeklyReset() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 0, 0, 0));
    return nextMonday.getTime();
}

// Check if challenges need to reset and rotate them
function checkChallengeReset(persistent) {
    const now = Date.now();
    let changed = false;
    
    // Check daily reset
    if (now >= persistent.dailyResetTime) {
        // Reset daily challenges
        persistent.activeDailies = selectChallenges(CONFIG.CHALLENGES.DAILY, 3);
        persistent.dailyResetTime = getNextDailyReset();
        changed = true;
    }
    
    // Check weekly reset
    if (now >= persistent.weeklyResetTime) {
        // Reset weekly challenges and weekly tracking stats
        persistent.activeWeeklies = selectChallenges(CONFIG.CHALLENGES.WEEKLY, 5);
        persistent.weeklyResetTime = getNextWeeklyReset();
        persistent.weeklyKills = 0;
        persistent.weeklyExtractions = 0;
        persistent.weeklyBossKills = 0;
        persistent.weeklyScrap = 0;
        persistent.weeklyUniqueLevels = [];
        changed = true;
    }
    
    return changed;
}

// Randomly select N challenges from a pool
function selectChallenges(pool, count) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(c => ({ id: c.id, progress: 0 }));
}

// Update challenge progress based on a stat change
function updateChallengeProgress(persistent, stat, value) {
    // Update daily challenges
    persistent.activeDailies.forEach(challenge => {
        const config = CONFIG.CHALLENGES.DAILY.find(c => c.id === challenge.id);
        if (config && config.stat === stat) {
            challenge.progress = Math.min(value, config.target);
        }
    });
    
    // Update weekly challenges
    persistent.activeWeeklies.forEach(challenge => {
        const config = CONFIG.CHALLENGES.WEEKLY.find(c => c.id === challenge.id);
        if (config && config.stat === stat) {
            challenge.progress = Math.min(value, config.target);
        }
    });
}

// Check if a challenge is completed and award rewards
function checkChallengeCompletion(persistent) {
    const completed = [];
    
    // Check daily challenges
    persistent.activeDailies.forEach((challenge, index) => {
        const config = CONFIG.CHALLENGES.DAILY.find(c => c.id === challenge.id);
        if (config && challenge.progress >= config.target && !challenge.claimed) {
            // Award skill points
            persistent.skillPoints = (persistent.skillPoints || 0) + config.reward;
            persistent.totalSkillPoints = (persistent.totalSkillPoints || 0) + config.reward;
            challenge.claimed = true;
            completed.push({ ...config, type: 'daily' });
        }
    });
    
    // Check weekly challenges
    persistent.activeWeeklies.forEach((challenge, index) => {
        const config = CONFIG.CHALLENGES.WEEKLY.find(c => c.id === challenge.id);
        if (config && challenge.progress >= config.target && !challenge.claimed) {
            // Award skill points
            persistent.skillPoints = (persistent.skillPoints || 0) + config.reward;
            persistent.totalSkillPoints = (persistent.totalSkillPoints || 0) + config.reward;
            challenge.claimed = true;
            completed.push({ ...config, type: 'weekly' });
        }
    });
    
    // Check permanent challenges
    CONFIG.CHALLENGES.PERMANENT.forEach(config => {
        if (persistent.completedPermanents?.includes(config.id)) return;
        
        const currentValue = persistent[config.stat] || 0;
        if (currentValue >= config.target) {
            // Award cosmetic reward
            if (config.reward.type === 'skin') {
                // Add to unlocked upgrades for cosmetics
                if (!persistent.unlockedUpgrades) persistent.unlockedUpgrades = [];
                if (!persistent.unlockedUpgrades.includes(config.reward.id)) {
                    persistent.unlockedUpgrades.push(config.reward.id);
                    // Also add to CONFIG.UPGRADES dynamically if not exists
                    if (!CONFIG.UPGRADES[config.reward.id.toUpperCase()]) {
                        CONFIG.UPGRADES[config.reward.id.toUpperCase()] = {
                            id: config.reward.id, name: config.name + ' Skin', 
                            desc: 'Earned from challenge', category: 'skin',
                            icon: '🏆', tint: config.reward.tint,
                            requirement: { stat: 'never', value: 999999 } // Already unlocked
                        };
                    }
                }
            } else if (config.reward.type === 'muzzle') {
                if (!persistent.unlockedUpgrades) persistent.unlockedUpgrades = [];
                if (!persistent.unlockedUpgrades.includes(config.reward.id)) {
                    persistent.unlockedUpgrades.push(config.reward.id);
                    if (!CONFIG.UPGRADES[config.reward.id.toUpperCase()]) {
                        CONFIG.UPGRADES[config.reward.id.toUpperCase()] = {
                            id: config.reward.id, name: config.name + ' Flash',
                            desc: 'Earned from challenge', category: 'muzzle',
                            icon: '🏆', color: config.reward.color,
                            requirement: { stat: 'never', value: 999999 }
                        };
                    }
                }
            }
            
            if (!persistent.completedPermanents) persistent.completedPermanents = [];
            persistent.completedPermanents.push(config.id);
            completed.push({ ...config, type: 'permanent' });
        }
    });
    
    return completed;
}

// Format time remaining for display
function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Now';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return `${days}d ${remHours}h`;
    }
    return `${hours}h ${minutes}m`;
}

// Check and unlock permanent upgrades based on persistent stats
function checkUpgrades(persistent) {
    const newUpgrades = [];
    if (!persistent.unlockedUpgrades) persistent.unlockedUpgrades = [];
    
    Object.values(CONFIG.UPGRADES).forEach(upgrade => {
        if (persistent.unlockedUpgrades.includes(upgrade.id)) return;
        
        const req = upgrade.requirement;
        const currentValue = persistent[req.stat] || 0;
        
        if (currentValue >= req.value) {
            persistent.unlockedUpgrades.push(upgrade.id);
            newUpgrades.push(upgrade);
        }
    });
    
    return newUpgrades;
}

// Generate starting stats with permanent upgrades applied
function getStartingStats(persistent) {
    const stats = JSON.parse(JSON.stringify(DEFAULT_STATS));
    ensureLimbVisStats(stats);
    
if (!stats.backpack || !Array.isArray(stats.backpack.items)) {
        stats.backpack = getDefaultBackpack();
    }
    ensureGridItems(stats.backpack);
    ensurePockets(stats);
    ensureBackpackStats(stats);
    ensureSecureContainerStats(stats);
    ensureMedBagStats(stats);
    // Migrate legacy grenade stack to items (one per cell in backpack)
    if (stats.grenades > 0) {
        for (let i = 0; i < stats.grenades; i++) tryAddItem(stats.backpack, 'grenade', 1);
        stats.grenades = 0;
    }

    if (!persistent.unlockedUpgrades) return stats;
    
    // Apply starting gear upgrades (legacy flags for gameplay)
    if (persistent.unlockedUpgrades.includes('start_shotgun')) {
        stats.hasShotgun = true;
        tryAddItem(stats.backpack, 'shotgun', 1);
    }
    if (persistent.unlockedUpgrades.includes('start_grenade')) {
        tryAddItem(stats.backpack, 'grenade', 1);
    }
    if (persistent.unlockedUpgrades.includes('start_flashlight')) {
        tryAddItem(stats.backpack, 'flashlight', 1);
    }
    if (persistent.unlockedUpgrades.includes('start_ammo')) {
        tryAddItem(stats.backpack, 'ammo', 20);
    }
    // Migrate legacy flat ammo into backpack (ammo is only in weapon mag + backpack now)
    if (stats.ammo > 0) {
        tryAddItem(stats.backpack, 'ammo', stats.ammo);
        stats.ammo = 0;
    }
    
    // Apply stat boosts (HP)
    if (persistent.unlockedUpgrades.includes('hp_boost_1')) {
        stats.hp += 1; stats.maxHp += 1;
        if (stats.limbHp && stats.limbHp.chest) { stats.limbHp.chest.hp += 1; stats.limbHp.chest.maxHp += 1; }
    }
    if (persistent.unlockedUpgrades.includes('hp_boost_2')) {
        stats.hp += 2; stats.maxHp += 2;
        if (stats.limbHp && stats.limbHp.chest) { stats.limbHp.chest.hp += 2; stats.limbHp.chest.maxHp += 2; }
    }
    
    return stats;
}

function checkAchievements(persistent, context = {}) {
    const newAchievements = [];
    const a = CONFIG.ACHIEVEMENTS;
    
    // First Blood - kill first enemy
    if (!persistent.achievements.includes(a.FIRST_BLOOD.id) && persistent.totalKills >= 1) {
        persistent.achievements.push(a.FIRST_BLOOD.id);
        newAchievements.push(a.FIRST_BLOOD);
    }
    
    // Exterminator - kill 50 enemies
    if (!persistent.achievements.includes(a.EXTERMINATOR.id) && persistent.totalKills >= 50) {
        persistent.achievements.push(a.EXTERMINATOR.id);
        newAchievements.push(a.EXTERMINATOR);
    }
    
    // Sharpshooter - 50% accuracy in a run (min 20 shots)
    if (!persistent.achievements.includes(a.SHARPSHOOTER.id) && persistent.runShotsFired >= 20) {
        const accuracy = persistent.runShotsHit / persistent.runShotsFired;
        if (accuracy >= 0.5) {
            persistent.achievements.push(a.SHARPSHOOTER.id);
            newAchievements.push(a.SHARPSHOOTER);
        }
    }
    
    // Melee Master - kill boss with melee only (no gun hits on boss)
    if (!persistent.achievements.includes(a.MELEE_MASTER.id) && context.bossKilledMelee) {
        persistent.achievements.push(a.MELEE_MASTER.id);
        newAchievements.push(a.MELEE_MASTER);
    }
    
    // Survivor - complete first extraction
    if (!persistent.achievements.includes(a.SURVIVOR.id) && persistent.runsCompleted >= 1) {
        persistent.achievements.push(a.SURVIVOR.id);
        newAchievements.push(a.SURVIVOR);
    }
    
    // Veteran - complete 5 extractions
    if (!persistent.achievements.includes(a.VETERAN.id) && persistent.runsCompleted >= 5) {
        persistent.achievements.push(a.VETERAN.id);
        newAchievements.push(a.VETERAN);
    }
    
    // Grenadier - kill 3+ enemies with one grenade
    if (!persistent.achievements.includes(a.GRENADIER.id) && context.grenadeMultiKill >= 3) {
        persistent.achievements.push(a.GRENADIER.id);
        newAchievements.push(a.GRENADIER);
    }
    
    // Untouchable - complete level without damage
    if (!persistent.achievements.includes(a.UNTOUCHABLE.id) && context.levelCompletedNoDamage) {
        persistent.achievements.push(a.UNTOUCHABLE.id);
        newAchievements.push(a.UNTOUCHABLE);
    }
    
    // Scavenger - collect 100 scrap total
    if (!persistent.achievements.includes(a.SCAVENGER.id) && persistent.totalScrapCollected >= 100) {
        persistent.achievements.push(a.SCAVENGER.id);
        newAchievements.push(a.SCAVENGER);
    }
    
    // Fully Loaded - own all weapons
    if (!persistent.achievements.includes(a.FULLY_LOADED.id) && context.hasAllWeapons) {
        persistent.achievements.push(a.FULLY_LOADED.id);
        newAchievements.push(a.FULLY_LOADED);
    }
    
    // === CLASS UNLOCK ACHIEVEMENTS ===
    
    // Scout Unlock - Complete any level without being hit
    if (!persistent.achievements.includes(a.SCOUT_UNLOCK.id) && context.levelCompletedNoDamage) {
        persistent.achievements.push(a.SCOUT_UNLOCK.id);
        if (!persistent.unlockedClasses) persistent.unlockedClasses = ['survivor'];
        if (!persistent.unlockedClasses.includes('scout')) persistent.unlockedClasses.push('scout');
        newAchievements.push(a.SCOUT_UNLOCK);
    }
    
    // Medic Unlock - Heal 50 total HP across all runs
    if (!persistent.achievements.includes(a.MEDIC_UNLOCK.id) && persistent.totalHPHealed >= 50) {
        persistent.achievements.push(a.MEDIC_UNLOCK.id);
        if (!persistent.unlockedClasses) persistent.unlockedClasses = ['survivor'];
        if (!persistent.unlockedClasses.includes('medic')) persistent.unlockedClasses.push('medic');
        newAchievements.push(a.MEDIC_UNLOCK);
    }
    
    // Scavenger Unlock - Collect 500 total scrap
    if (!persistent.achievements.includes(a.SCAVENGER_UNLOCK.id) && persistent.totalScrapCollected >= 500) {
        persistent.achievements.push(a.SCAVENGER_UNLOCK.id);
        if (!persistent.unlockedClasses) persistent.unlockedClasses = ['survivor'];
        if (!persistent.unlockedClasses.includes('scavenger')) persistent.unlockedClasses.push('scavenger');
        newAchievements.push(a.SCAVENGER_UNLOCK);
    }
    
    return newAchievements;
}

// =============================================================================
// FLOATING TEXT POOL - Reuses text objects for performance
// =============================================================================
class FloatingTextPool {
    constructor(scene, poolSize = 20) {
        this.scene = scene;
        this.pool = [];
        for (let i = 0; i < poolSize; i++) {
            const text = scene.add.text(0, 0, '', {
                font: '16px Arial',
                stroke: '#000',
                strokeThickness: 3
            }).setOrigin(0.5).setDepth(101).setVisible(false);
            this.pool.push({ text, active: false });
        }
    }

    spawn(x, y, msg, color) {
        let item = this.pool.find(p => !p.active);
        if (!item) {
            const text = this.scene.add.text(x, y, msg, {
                font: '16px Arial',
                stroke: '#000',
                strokeThickness: 3
            }).setTint(color).setOrigin(0.5).setDepth(101);
            this.scene.tweens.add({
                targets: text,
                y: y - 50,
                alpha: 0,
                duration: 1500,
                onComplete: () => text.destroy()
            });
            return;
        }

        item.active = true;
        item.text.setPosition(x, y).setText(msg).setTint(color).setAlpha(1).setVisible(true);
        
        this.scene.tweens.add({
            targets: item.text,
            y: y - 50,
            alpha: 0,
            duration: 1500,
            onComplete: () => {
                item.text.setVisible(false);
                item.active = false;
            }
        });
    }
}

// =============================================================================
// PARTICLE POOL - For muzzle flashes and effects
// =============================================================================
class ParticlePool {
    constructor(scene, poolSize = 30) {
        this.scene = scene;
        this.pool = [];
        for (let i = 0; i < poolSize; i++) {
            const particle = scene.add.circle(0, 0, 8, 0xffff00)
                .setDepth(50).setVisible(false).setAlpha(0);
            this.pool.push({ particle, active: false });
        }
    }

    spawnMuzzleFlash(x, y, angle, size = 1, color = null) {
        // Spawn 3-5 particles for a flash effect
        const count = 3 + Math.floor(Math.random() * 3);
        // Use custom color or default yellow/orange
        const primaryColor = color || 0xffff00;
        const secondaryColor = color ? this.darkenColor(color) : 0xffaa00;
        
        for (let i = 0; i < count; i++) {
            let item = this.pool.find(p => !p.active);
            if (!item) continue;

            item.active = true;
            const spread = (Math.random() - 0.5) * 0.5;
            const dist = 20 + Math.random() * 15 * size;
            const px = x + Math.cos(angle + spread) * dist;
            const py = y + Math.sin(angle + spread) * dist;
            
            item.particle.setPosition(px, py)
                .setRadius(4 + Math.random() * 6 * size)
                .setFillStyle(Math.random() > 0.5 ? primaryColor : secondaryColor)
                .setVisible(true)
                .setAlpha(1);

            this.scene.tweens.add({
                targets: item.particle,
                alpha: 0,
                scaleX: 0.1,
                scaleY: 0.1,
                duration: 80 + Math.random() * 40,
                onComplete: () => {
                    item.particle.setVisible(false).setScale(1);
                    item.active = false;
                }
            });
        }
    }
    
    // Helper to darken a color for secondary flash
    darkenColor(color) {
        const r = ((color >> 16) & 0xff) * 0.7;
        const g = ((color >> 8) & 0xff) * 0.7;
        const b = (color & 0xff) * 0.7;
        return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
    }

    /** Brief tracer streak from muzzle along aim angle. */
    spawnTracer(x, y, angle, length = 34, color = 0xfff0a0) {
        const tipX = x + Math.cos(angle) * 18;
        const tipY = y + Math.sin(angle) * 18;
        const line = this.scene.add.rectangle(tipX, tipY, length, 1.5, color)
            .setDepth(48).setRotation(angle).setOrigin(0, 0.5).setAlpha(0.95);
        this.scene.tweens.add({
            targets: line,
            x: tipX + Math.cos(angle) * (length * 2.2),
            y: tipY + Math.sin(angle) * (length * 2.2),
            alpha: 0,
            duration: 55,
            onComplete: () => line.destroy()
        });
    }

    /** Ejected brass arc. */
    spawnShellCasing(x, y, angle) {
        const eject = angle - Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        const casing = this.scene.add.rectangle(x, y, 4, 2, 0xd4a017)
            .setDepth(40).setRotation(angle).setAlpha(1);
        const dist = 22 + Math.random() * 22;
        this.scene.tweens.add({
            targets: casing,
            x: x + Math.cos(eject) * dist,
            y: y + Math.sin(eject) * dist + 12,
            rotation: casing.rotation + 1.5 + Math.random() * 2,
            alpha: 0,
            duration: 320 + Math.random() * 80,
            ease: 'Quad.easeOut',
            onComplete: () => casing.destroy()
        });
    }

    /** Soft grey muzzle smoke puffs. */
    spawnMuzzleSmoke(x, y, angle) {
        for (let i = 0; i < 2; i++) {
            const smoke = this.scene.add.circle(
                x + Math.cos(angle) * 14,
                y + Math.sin(angle) * 14,
                3 + Math.random() * 4,
                0x999999,
                0.4
            ).setDepth(47);
            this.scene.tweens.add({
                targets: smoke,
                x: smoke.x + Math.cos(angle) * (8 + Math.random() * 16),
                y: smoke.y + Math.sin(angle) * (8 + Math.random() * 16) - 10,
                alpha: 0,
                scale: 1.8,
                duration: 180 + Math.random() * 120,
                onComplete: () => smoke.destroy()
            });
        }
    }
}

// =============================================================================
// HIT DIRECTION INDICATOR POOL
// =============================================================================
class HitIndicatorPool {
    constructor(scene, poolSize = 8) {
        this.scene = scene;
        this.pool = [];
        this.settings = loadSettings();
        
        for (let i = 0; i < poolSize; i++) {
            // Create arrow-shaped indicator
            const graphics = scene.add.graphics().setDepth(104).setVisible(false);
            this.pool.push({ graphics, active: false });
        }
    }
    
    // Show hit indicator from a specific direction (in radians)
    showHit(fromX, fromY, playerX, playerY) {
        if (!this.settings.hitIndicators) return;
        
        let item = this.pool.find(p => !p.active);
        if (!item) return;
        
        item.active = true;
        const g = item.graphics;
        g.clear();
        g.setVisible(true);
        g.setAlpha(0.8);
        
        // Calculate angle from player to damage source
        const angle = Phaser.Math.Angle.Between(playerX, playerY, fromX, fromY);
        
        // Draw directional indicator (arrow pointing toward damage source)
        const dist = CONFIG.UI.HIT_INDICATOR_DISTANCE;
        const size = CONFIG.UI.HIT_INDICATOR_SIZE;
        
        // Center of screen
        const cx = 400;
        const cy = 300;
        
        // Position the indicator on the edge of the screen based on angle
        const indicatorX = cx + Math.cos(angle) * dist * 2;
        const indicatorY = cy + Math.sin(angle) * dist * 2;
        
        // Draw red arrow/chevron pointing inward
        g.lineStyle(4, 0xff0000, 1);
        g.fillStyle(0xff0000, 0.6);
        
        // Arrow shape pointing toward center
        const tipX = indicatorX - Math.cos(angle) * size * 0.5;
        const tipY = indicatorY - Math.sin(angle) * size * 0.5;
        
        const leftX = indicatorX + Math.cos(angle + Math.PI * 0.7) * size * 0.4;
        const leftY = indicatorY + Math.sin(angle + Math.PI * 0.7) * size * 0.4;
        
        const rightX = indicatorX + Math.cos(angle - Math.PI * 0.7) * size * 0.4;
        const rightY = indicatorY + Math.sin(angle - Math.PI * 0.7) * size * 0.4;
        
        g.beginPath();
        g.moveTo(tipX, tipY);
        g.lineTo(leftX, leftY);
        g.lineTo(indicatorX, indicatorY);
        g.lineTo(rightX, rightY);
        g.closePath();
        g.fillPath();
        g.strokePath();
        
        // Fade out
        this.scene.tweens.add({
            targets: g,
            alpha: 0,
            duration: CONFIG.UI.HIT_INDICATOR_DURATION,
            onComplete: () => {
                g.setVisible(false);
                g.clear();
                item.active = false;
            }
        });
    }
    
    reloadSettings() {
        this.settings = loadSettings();
    }
}

// =============================================================================
// MAIN MENU SCENE
// =============================================================================
class MainMenuScene extends Phaser.Scene {
    constructor() { super('MainMenuScene'); }
    
    create() {
        // One-click smoke: /?smoke=magPickup → empty room, pistol loaded, spare mag on floor
        if (getSmokeTestFromUrl() === 'magPickup') {
            const persistent = loadPersistent();
            const stats = getStartingStats(persistent);
            ensureEquippedMagazines(stats);
            this.scene.start('GameScene', { level: 1, stats, smoke: 'magPickup' });
            return;
        }

        this.input.on('pointerdown', () => sfx.resume());

        // Clean dark background
        this.add.rectangle(400, 300, 800, 600, 0x0a0a0a);
        this.add.grid(400, 300, 800, 600, 64, 64, 0x151515).setAlpha(0.3);
        
        // Title
        this.add.text(400, 150, "ZOMBIE", { fontSize: '72px', fill: '#00ff00', fontStyle: 'bold' }).setOrigin(0.5);
        this.add.text(400, 220, "EXTRACTION", { fontSize: '48px', fill: '#008800' }).setOrigin(0.5);

        // Main buttons - centered
        this.createButton(400, 320, "NEW GAME", 0x880000, () => {
            if (confirm("Start a new game? This resets everything: classes, skills, challenges, upgrades, mods, and run progress.")) {
                localStorage.removeItem(CONFIG.SAVE_KEY);
                const persistent = resetPersistent();
                if (checkChallengeReset(persistent)) savePersistent(persistent);
                const stats = getStartingStats(persistent);
                sfx.levelStart();
                this.scene.start('HideoutScene', { stats: stats });
            }
        });

        this.createButton(400, 390, "CONTINUE", 0x004488, () => {
            let saved = localStorage.getItem(CONFIG.SAVE_KEY);
            if (!saved) {
                const oldSaved = localStorage.getItem('zombie_save_v16');
                if (oldSaved) {
                    saved = oldSaved;
                    localStorage.setItem(CONFIG.SAVE_KEY, saved);
                }
            }
            if (saved) {
                try {
                    let stats = JSON.parse(saved);
                    if (stats.hp === undefined || stats.hideout === undefined) {
                        throw new Error("Invalid save data");
                    }
                    // Migration for old saves
                    if (!stats.magazines) {
                        stats.magazines = {
                            pistol: CONFIG.WEAPONS.PISTOL.MAG_SIZE,
                            shotgun: CONFIG.WEAPONS.SHOTGUN.MAG_SIZE,
                            smg: CONFIG.WEAPONS.SMG.MAG_SIZE,
                            crossbow: CONFIG.WEAPONS.CROSSBOW.MAG_SIZE,
                            rifle: CONFIG.WEAPONS.RIFLE.MAG_SIZE
                        };
                    }
                    if (stats.magazines.crossbow === undefined) stats.magazines.crossbow = CONFIG.WEAPONS.CROSSBOW.MAG_SIZE;
                    if (stats.magazines.rifle === undefined) stats.magazines.rifle = CONFIG.WEAPONS.RIFLE.MAG_SIZE;
                    if (stats.hasCrossbow === undefined) stats.hasCrossbow = false;
                    if (stats.hasRifle === undefined) stats.hasRifle = false;
                    if (!stats.currentWeapon) stats.currentWeapon = 'pistol';
                    if (stats.nextLevel === undefined) stats.nextLevel = 1;
                    if (stats.highestLevelUnlocked === undefined) stats.highestLevelUnlocked = stats.nextLevel || 1;
                    if (!stats.consumables || !Array.isArray(stats.consumables)) stats.consumables = [null, null, null];
                    while (stats.consumables.length < 3) stats.consumables.push(null);
                    if (!stats.equippedMods) stats.equippedMods = {};
                    ensureEquippedModsShape(stats);
                    ensureWeaponSlotModsShape(stats);
                    if (!stats.backpack) stats.backpack = getDefaultBackpack();
                    ensureGridItems(stats.backpack);
                    ensurePockets(stats);
                    ensureRigStats(stats);
                    ensureBackpackStats(stats);
                    ensureSecureContainerStats(stats);
                    ensureMedBagStats(stats);
                    if (stats.ammo > 0) { tryAddItem(stats.backpack, 'ammo', stats.ammo); stats.ammo = 0; }
                    const nonGrid = (CONFIG.LOOT && CONFIG.LOOT.NON_GRID_ITEM_IDS) || [];
                    stats.backpack.items = stats.backpack.items.filter(p => !nonGrid.includes(p.itemId));
                    // One-time: add headset to existing save
                    const persistent = loadPersistent();
                    if (!persistent.givenHeadsetGift) {
                        tryAddItem(stats.backpack, 'headset', 1);
                        persistent.givenHeadsetGift = true;
                        savePersistent(persistent);
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stats));
                    }
                    // One-time: add medkit to existing save
                    if (!persistent.givenMedkitGift) {
                        tryAddItem(stats.backpack, 'medkit', 1, { durability: 120, maxDurability: 120 });
                        persistent.givenMedkitGift = true;
                        savePersistent(persistent);
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stats));
                    }
                    sfx.menuOpen();
                    this.scene.start('HideoutScene', { stats });
                } catch (e) {
                    sfx.error();
                    alert("Save data corrupted. Please start a new game.");
                    localStorage.removeItem(CONFIG.SAVE_KEY);
                }
            } else {
                sfx.error();
                alert("No save found! Start a New Run first.");
            }
        });

        // Bottom icon bar
        const iconY = 550;
        const iconSize = 40;
        
        // Settings cog (left)
        const settingsBtn = this.add.rectangle(50, iconY, iconSize, iconSize, 0x333333).setInteractive();
        this.add.text(50, iconY, "⚙️", { fontSize: '24px' }).setOrigin(0.5);
        settingsBtn.on('pointerdown', () => { sfx.menuOpen(); this.showSettingsMenu(); });
        settingsBtn.on('pointerover', () => settingsBtn.setFillStyle(0x444444));
        settingsBtn.on('pointerout', () => settingsBtn.setFillStyle(0x333333));
        
        // Export icon
        const exportBtn = this.add.rectangle(720, iconY, iconSize, iconSize, 0x333333).setInteractive();
        this.add.text(720, iconY, "📤", { fontSize: '20px' }).setOrigin(0.5);
        exportBtn.on('pointerdown', () => this.exportSave());
        exportBtn.on('pointerover', () => exportBtn.setFillStyle(0x444444));
        exportBtn.on('pointerout', () => exportBtn.setFillStyle(0x333333));
        
        // Import icon
        const importBtn = this.add.rectangle(770, iconY, iconSize, iconSize, 0x333333).setInteractive();
        this.add.text(770, iconY, "📥", { fontSize: '20px' }).setOrigin(0.5);
        importBtn.on('pointerdown', () => this.importSave());
        importBtn.on('pointerover', () => importBtn.setFillStyle(0x444444));
        importBtn.on('pointerout', () => importBtn.setFillStyle(0x333333));
        
        // Tooltips
        this.add.text(50, iconY + 28, "Settings", { fontSize: '10px', fill: '#666' }).setOrigin(0.5);
        this.add.text(720, iconY + 28, "Export", { fontSize: '10px', fill: '#666' }).setOrigin(0.5);
        this.add.text(770, iconY + 28, "Import", { fontSize: '10px', fill: '#666' }).setOrigin(0.5);
    }
    
    exportSave() {
        const runSaved = localStorage.getItem(CONFIG.SAVE_KEY);
        const persistentSaved = localStorage.getItem(PERSISTENT_KEY);
        if (!runSaved && !persistentSaved) { sfx.error(); alert("No save data to export."); return; }
        const payload = {
            version: 2,
            run: runSaved ? JSON.parse(runSaved) : null,
            persistent: persistentSaved ? JSON.parse(persistentSaved) : null
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zombie_save_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        sfx.success();
    }
    
    importSave() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    if (json.version === 2 && (json.run != null || json.persistent != null)) {
                        if (json.run != null) localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(json.run));
                        if (json.persistent != null) localStorage.setItem(PERSISTENT_KEY, JSON.stringify(json.persistent));
                        sfx.success();
                        alert("Save imported successfully! Run and progress (skills, upgrades, classes, challenges, mods) restored.");
                    } else if (json.hp !== undefined && json.hideout !== undefined) {
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(json));
                        sfx.success();
                        alert("Save imported (run only). Progress like skills/upgrades were not in this file.");
                    } else {
                        sfx.error();
                        alert("Invalid save file format.");
                    }
                } catch (err) {
                    sfx.error();
                    alert("Error reading file.");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    showSettingsMenu() {
        const settings = loadSettings();
        const elements = [];
        
        // Overlay background (taller to fit controls)
        const overlay = this.add.rectangle(400, 300, 550, 520, 0x111111, 0.98).setDepth(500);
        elements.push(overlay);
        
        const title = this.add.text(400, 65, "SETTINGS", { fontSize: '28px', fill: '#fff' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // Controls section
        const controlsLabel = this.add.text(400, 100, "CONTROLS", { fontSize: '12px', fill: '#888' }).setOrigin(0.5).setDepth(501);
        elements.push(controlsLabel);
        
        const controlsBg = this.add.rectangle(400, 155, 500, 80, 0x1a1a1a).setDepth(501);
        elements.push(controlsBg);
        
        const controlsText = this.add.text(400, 155, 
            "WASD: Move  |  Mouse: Aim/Fire  |  SPACE: Dodge  |  R: Reload\n" +
            "G: Grenade  |  TAB: Inventory  |  N: NVG  |  F: Interact\n" +
            "Q: Switch Weapon  |  E: Melee  |  1/2/3: Consumables", 
            { fontSize: '11px', fill: '#aaa', align: 'center', lineSpacing: 6 }
        ).setOrigin(0.5).setDepth(502);
        elements.push(controlsText);
        
        // Master Volume Slider
        const masterLabel = this.add.text(170, 205, "MASTER VOLUME", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(masterLabel);
        
        const masterSliderBg = this.add.rectangle(400, 230, 280, 16, 0x333333).setDepth(501);
        elements.push(masterSliderBg);
        
        const masterSliderFill = this.add.rectangle(260, 230, settings.masterVolume * 280, 12, 0x00ff00).setOrigin(0, 0.5).setDepth(502);
        elements.push(masterSliderFill);
        
        const masterPercent = this.add.text(550, 230, `${Math.round(settings.masterVolume * 100)}%`, { fontSize: '11px', fill: '#fff' }).setOrigin(0, 0.5).setDepth(501);
        elements.push(masterPercent);
        
        masterSliderBg.setInteractive();
        masterSliderBg.on('pointerdown', (pointer) => {
            const relX = (pointer.x - 260) / 280;
            const newVol = Phaser.Math.Clamp(relX, 0, 1);
            settings.masterVolume = newVol;
            sfx.setMasterVolume(newVol);
            masterSliderFill.width = newVol * 280;
            masterPercent.setText(`${Math.round(newVol * 100)}%`);
            sfx.click();
        });
        
        // SFX Volume Slider
        const sfxLabel = this.add.text(170, 255, "SFX VOLUME", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(sfxLabel);
        
        const sfxSliderBg = this.add.rectangle(400, 280, 280, 16, 0x333333).setDepth(501);
        elements.push(sfxSliderBg);
        
        const sfxSliderFill = this.add.rectangle(260, 280, settings.sfxVolume * 280, 12, 0x00aaff).setOrigin(0, 0.5).setDepth(502);
        elements.push(sfxSliderFill);
        
        const sfxPercent = this.add.text(550, 280, `${Math.round(settings.sfxVolume * 100)}%`, { fontSize: '11px', fill: '#fff' }).setOrigin(0, 0.5).setDepth(501);
        elements.push(sfxPercent);
        
        sfxSliderBg.setInteractive();
        sfxSliderBg.on('pointerdown', (pointer) => {
            const relX = (pointer.x - 260) / 280;
            const newVol = Phaser.Math.Clamp(relX, 0, 1);
            settings.sfxVolume = newVol;
            sfx.setSfxVolume(newVol);
            sfxSliderFill.width = newVol * 280;
            sfxPercent.setText(`${Math.round(newVol * 100)}%`);
            sfx.click();
        });
        
        // Screen Shake Toggle
        const shakeLabel = this.add.text(170, 315, "SCREEN SHAKE", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(shakeLabel);
        
        const shakeToggle = this.add.rectangle(510, 315, 65, 24, settings.screenShake ? 0x00ff00 : 0x444444).setDepth(501).setInteractive();
        elements.push(shakeToggle);
        
        const shakeText = this.add.text(510, 315, settings.screenShake ? "ON" : "OFF", { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(shakeText);
        
        shakeToggle.on('pointerdown', () => {
            settings.screenShake = !settings.screenShake;
            shakeToggle.setFillStyle(settings.screenShake ? 0x00ff00 : 0x444444);
            shakeText.setText(settings.screenShake ? "ON" : "OFF");
            saveSettings(settings);
            sfx.click();
        });
        
        // Hit Indicators Toggle
        const hitToggle = this.add.rectangle(510, 350, 65, 24, settings.hitIndicators ? 0x00ff00 : 0x444444).setDepth(501).setInteractive();
        elements.push(hitToggle);
        
        const hitText = this.add.text(510, 350, settings.hitIndicators ? "ON" : "OFF", { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(hitText);
        
        hitToggle.on('pointerdown', () => {
            settings.hitIndicators = !settings.hitIndicators;
            hitToggle.setFillStyle(settings.hitIndicators ? 0x00ff00 : 0x444444);
            hitText.setText(settings.hitIndicators ? "ON" : "OFF");
            saveSettings(settings);
            sfx.click();
        });
        
        // Separator
        const sep = this.add.rectangle(400, 390, 450, 1, 0x444444).setDepth(501);
        elements.push(sep);
        
        // Cheat Code button (developer/debug)
        const cheatBtn = this.add.text(400, 420, "[ ENTER CHEAT CODE ]", { fontSize: '12px', fill: '#555' }).setOrigin(0.5).setDepth(501).setInteractive();
        elements.push(cheatBtn);
        
        cheatBtn.on('pointerdown', () => {
            const code = prompt("ENTER CHEAT CODE:");
            if (code === 'god mode') {
                elements.forEach(e => e.destroy());
                this.activateGodMode();
            }
        });
        cheatBtn.on('pointerover', () => cheatBtn.setFill('#888'));
        cheatBtn.on('pointerout', () => cheatBtn.setFill('#555'));
        
        // Close button
        const closeBtn = this.add.text(400, 510, "[ CLOSE ]", { fontSize: '16px', fill: '#ff4444' }).setOrigin(0.5).setDepth(501).setInteractive();
        elements.push(closeBtn);
        
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
        });
    }

    createButton(x, y, text, color, callback) {
        let btn = this.add.rectangle(x, y, 300, 50, color).setInteractive();
        this.add.text(x, y, text, { fontSize: '22px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btn.on('pointerdown', () => { sfx.click(); callback(); });
        btn.on('pointerover', () => btn.setAlpha(0.8));
        btn.on('pointerout', () => btn.setAlpha(1));
    }

    activateGodMode() {
        const godStats = {
            hp: 20, maxHp: 20, stamina: 100, maxStamina: 100, ammo: 999, scrap: 999,
            credits: 999, materials: 999,
            grenades: 0,
            nextLevel: 1,
            highestLevelUnlocked: 7,  // All levels unlocked in god mode (grenades = items in pocket/rig)
            consumables: ['adrenaline', 'armor_patch', 'adrenaline'],  // Full consumables
            hasFlashlight: true, hasShotgun: true, hasSMG: true, hasCrossbow: true, hasRifle: true, currentWeapon: 'shotgun',
            magazines: {
                pistol: CONFIG.WEAPONS.PISTOL.MAG_SIZE,
                shotgun: CONFIG.WEAPONS.SHOTGUN.MAG_SIZE,
                smg: CONFIG.WEAPONS.SMG.MAG_SIZE,
                crossbow: CONFIG.WEAPONS.CROSSBOW.MAG_SIZE,
                rifle: CONFIG.WEAPONS.RIFLE.MAG_SIZE
            },
            armor: {
                head: { name: 'GOD HELM', durability: 100, maxDurability: 100 },
                body: { name: 'GOD VEST', durability: 100, maxDurability: 100 },
                arms: { name: 'GOD ARMS', durability: 100, maxDurability: 100 },
                feet: { name: 'GOD BOOTS', durability: 100, maxDurability: 100 }
            },
            hideout: {
                restAreaLvl: 2, generatorLvl: 1, hasSparkPlug: true,
                armory: { crafting: null, hasNVG: true },
                workbenchLvl: 1, repairStationLvl: 1
            }
        };
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(godStats));
        alert("GOD MODE ACTIVATED");
        this.scene.start('HideoutScene', { stats: godStats });
    }
}

// =============================================================================
// BULLET CLASS
// =============================================================================
class Bullet extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) { 
        super(scene, x, y, 'bullet'); 
    }
    
    fire(x, y, targetX, targetY, spreadAngle = 0, isEnemy = false) {
        this.body.reset(x, y);
        this.body.enable = true; 
        this.setActive(true);
        this.setVisible(true);
        this.hasHit = false;
        this.isEnemyBullet = isEnemy; 
        this.setTint(isEnemy ? 0xff0000 : 0xffff00);
        
        // Reset pooled bullet properties
        this.hitEnemies = new Set();
        this.isPiercing = false;
        this.pierceCount = 0;
        this.crossbowDamage = 0;
        this.rifleDamage = 0;
        
        if (isEnemy) sfx.shootPistol();

        let baseAngle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
        let finalAngle = baseAngle + Phaser.Math.DegToRad(spreadAngle);
        this.scene.physics.velocityFromRotation(finalAngle, CONFIG.WEAPONS.BULLET_SPEED, this.body.velocity);
        this.setRotation(finalAngle);
    }
    
    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        if (this.y < -50 || this.y > 650 || this.x < -50 || this.x > 850) {
            this.setActive(false);
            this.setVisible(false);
            this.body.enable = false;
        }
    }
}

// =============================================================================
// ENEMY INIT / UPDATE REGISTRY (50% refactor: spitter + exploder; rest stay inline)
// =============================================================================
const ENEMY_INIT = {
    spitter(enemy, cfg) {
        enemy.lastSpit = 0;
        enemy.setTint(0xb8ffb8); // soft green — keep Kenney art readable
    },
    exploder(enemy, cfg) {
        enemy.setTint(0xffaa66);
        enemy.setScale(1.2);
        enemy.scene.tweens.add({
            targets: enemy,
            scaleX: 1.3,
            scaleY: 1.3,
            duration: 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }
};

const ENEMY_UPDATE = {
    spitter(enemy, time, delta) {
        const cfg = enemy.config;
        const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, enemy.target.x, enemy.target.y);
        if (dist < cfg.SPIT_RANGE) {
            enemy.setVelocity(0);
            if (time - enemy.lastSpit > cfg.SPIT_COOLDOWN) {
                enemy.scene.spawnAcidSpit(enemy.x, enemy.y, enemy.target.x, enemy.target.y);
                enemy.lastSpit = time;
                sfx.spit();
                enemy.setTint(0xffff00);
                enemy.scene.time.delayedCall(100, () => { if (enemy.active) enemy.setTint(0xb8ffb8); });
            }
        } else {
            enemy.scene.physics.moveToObject(enemy, enemy.target, enemy.speed);
        }
    },
    exploder(enemy, time, delta) {
        enemy.scene.physics.moveToObject(enemy, enemy.target, enemy.speed);
        if (!enemy.lastWarning || time - enemy.lastWarning > 1000) {
            sfx.exploderWarning();
            enemy.lastWarning = time;
        }
    }
};

// =============================================================================
// ENEMY CLASS
// =============================================================================
class Enemy extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, target, type) {
        const cfg = CONFIG.ENEMIES[type.toUpperCase()] || CONFIG.ENEMIES.WALKER;
        super(scene, x, y, cfg.TEXTURE);
        
        scene.add.existing(this);
        scene.physics.add.existing(this);
        // Kenney top-down frames are ~33–52×43; keep a compact hitbox
        this.setSize(26, 26).setOffset(Math.max(0, (this.width - 26) / 2), Math.max(0, (this.height - 26) / 2));
        
        this.target = target;
        this.enemyType = type;
        this.config = cfg;
        this.canTakeDamage = true;
        this.healthBar = scene.add.graphics().setDepth(100).setVisible(false);
        this.lastFired = 0;
        this.isInvulnerable = false;

        this.hp = cfg.HP;
        this.maxHp = cfg.HP;
        this.speed = cfg.SPEED;
        this.damage = cfg.DAMAGE;

        if (ENEMY_INIT[type]) {
            ENEMY_INIT[type](this, cfg);
        } else if (type === 'boss') {
            this.setScale(cfg.SCALE);
            this.setTint(0xff8888);
        } else if (type === 'leaper') {
            this.state = 'IDLE';
            this.leaperFacingAngle = Math.random() * Math.PI * 2;
            this.leaperWanderDirection = this.leaperFacingAngle;
            this.leaperWanderChangeTime = 0;
            this.lastHeardX = this.x;
            this.lastHeardY = this.y;
            this.lastHeardTime = 0;
            this.leapTimer = 0;
            this.gunshotAlertEndTime = 0;
            this.gunshotTargetX = 0;
            this.gunshotTargetY = 0;
            this.alertExclamation = null;
            this.footstepAlertCount = 0;
            this.setTexture('leaper_idle_0'); // Use individual frame texture
            this.setScale(1);
            this.play('leaper_idle'); // Idle until they hear a sound
        } else if (type === 'bandit') {
            this.ammo = cfg.AMMO;
            this.lastFired = 0;
            const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            this.banditState = 'PATROL';
            this.patrolDirection = dirs[Phaser.Math.Between(0, 3)];
            this.gunshotAlertEndTime = 0;
            this.gunshotTargetX = 0;
            this.gunshotTargetY = 0;
            this.lastKnownPlayerX = this.x;
            this.lastKnownPlayerY = this.y;
            this.searchEndTime = 0;
            this.alertExclamation = null;
            this.searchWanderTargetX = null;
            this.searchWanderTargetY = null;
            this.searchWanderTimer = 0;
            this.wallStuckTimer = 0;
            this.goAroundEndTime = 0;
            this.goAroundAngle = 0;
            this.goAroundSide = 1;
            this.lastCloseAggroRollTime = 0;
            this.closeAggroRollCount = 0;
            this.footstepAlertCount = 0;
            this.damageAggro = false;
            this.banditFacingAngle = this.patrolDirection;
            this.lastMeleeHitTime = 0;
        } else if (type === 'necromancer') {
            this.setTint(0xcc88ff); // Soft purple — keep Kenney art readable
            this.setScale(1.35);
            this.phase = 'SUMMON'; // SUMMON, VULNERABLE, ATTACK
            this.phaseTimer = 0;
            this.lastTeleport = 0;
            this.summonedMinions = [];
            this.isInvulnerable = true; // Starts invulnerable
        } else if (type === 'walker') {
            const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            this.walkerState = 'PATROL';
            this.patrolDirection = dirs[Phaser.Math.Between(0, 3)];
            this.gunshotAlertEndTime = 0;
            this.gunshotTargetX = 0;
            this.gunshotTargetY = 0;
            this.lastKnownPlayerX = this.x;
            this.lastKnownPlayerY = this.y;
            this.searchEndTime = 0;
            this.stuckTurnOffset = 0;
            this.stuckTimer = 0;
            this.alertExclamation = null;
            this.searchWanderTargetX = null;
            this.searchWanderTargetY = null;
            this.searchWanderTimer = 0;
            this.wallStuckTimer = 0;
            this.goAroundEndTime = 0;
            this.goAroundAngle = 0;
            this.goAroundSide = 1;
            this.lastCloseAggroRollTime = 0;
            this.closeAggroRollCount = 0;
            this.footstepAlertCount = 0;
            this.damageAggro = false;
            this.walkerFacingAngle = this.patrolDirection;
            this.lastMeleeHitTime = 0;
        }
    }
    
    takeDamage(amount, killSource = 'gun', fromX = null, fromY = null) {
        if (!this.active || this.isCorpse || !this.canTakeDamage || this.isInvulnerable) return;
        
        this.lastDamageSource = killSource; // Track what damaged us
        if (this.enemyType === 'walker') {
            this.damageAggro = true;
            this.walkerState = 'HUNT';
        }
        if (this.enemyType === 'leaper') {
            this.damageAggro = true;
            if (this.state !== 'COOLDOWN') {
                this.state = 'CHASE';
                if (fromX != null && fromY != null) {
                    this.lastHeardX = fromX;
                    this.lastHeardY = fromY;
                    this.lastHeardTime = this.scene.time.now;
                }
            }
        }
        if (this.enemyType === 'bandit') {
            this.damageAggro = true;
            this.banditState = 'HUNT';
        }
        this.hp -= amount;
        sfx.enemyHit();
        this.setTint(0xffffff);
        this.scene.time.delayedCall(50, () => {
            if (this.active && !this.isCorpse) this.clearTint();
        });
        this.updateHealthBar();

        // Flinch / knockback on surviving hit
        if (this.hp > 0 && this.body && fromX != null && fromY != null) {
            const ang = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y);
            const push = (CONFIG.JUICE.FLINCH_SPEED || 90) * (0.55 + Math.min(amount, 3) * 0.2);
            this.scene.physics.velocityFromRotation(ang, push, this.body.velocity);
            if (this.enemyType !== 'boss' && this.enemyType !== 'necromancer') {
                const sx = this.scaleX, sy = this.scaleY;
                this.scene.tweens.add({
                    targets: this,
                    scaleX: sx * 1.12,
                    scaleY: sy * 0.88,
                    duration: 45,
                    yoyo: true,
                    onComplete: () => { if (this.active && !this.isCorpse) this.setScale(sx, sy); }
                });
            }
        }
        
        if (this.enemyType === 'boss' || this.enemyType === 'necromancer') {
            this.scene.updateBossBar(this.hp, this.maxHp);
            this.canTakeDamage = false;
            this.isInvulnerable = true;
            this.flashTween = this.scene.tweens.add({
                targets: this,
                alpha: 0.5,
                duration: 100,
                yoyo: true,
                repeat: 4,
                onComplete: () => {
                    if (this.active && !this.isCorpse) {
                        this.setAlpha(1);
                        this.canTakeDamage = true;
                        this.isInvulnerable = false;
                    }
                }
            });
        }
        
        if (this.hp <= 0) {
            // Check for melee-only boss kill achievement
            const bossKilledMelee = this.enemyType === 'boss' && !this.scene.persistent.bossHitWithGun;
            
            // Play death sound
            sfx.enemyDeath();
            if (this.scene.doHitstop) this.scene.doHitstop(CONFIG.JUICE.HITSTOP_MS);
            
            // Exploder explosion on death
            if (this.enemyType === 'exploder') {
                this.scene.exploderExplosion(this.x, this.y);
            }
            
            // Necromancer special death
            if (this.enemyType === 'necromancer') {
                sfx.necroDeath();
                this.scene.showFloatingText(this.x, this.y, "VANQUISHED!", 0x8800ff);
                // Kill any remaining minions
                this.summonedMinions.forEach(m => {
                    if (m.active) m.takeDamage(100);
                });
            }
            
            if (this.enemyType === 'boss' && this.scene.currentLevel === 5) {
                this.scene.spawnSwitch(this.x, this.y);
            }
            
            // Necromancer on level 7 spawns switch
            if (this.enemyType === 'necromancer' && this.scene.currentLevel === 7) {
                this.scene.spawnSwitch(this.x, this.y);
            }
            
            this.scene.spawnLootSkull(this.x, this.y, this.enemyType, this.lastDamageSource);
            
            // Check melee master achievement for boss
            if (bossKilledMelee && this.lastDamageSource === 'melee') {
                const newAchievements = checkAchievements(this.scene.persistent, { bossKilledMelee: true });
                newAchievements.forEach(a => {
                    sfx.achievement();
                    this.scene.showFloatingText(400, 200, `${a.icon} ${a.name}!`, 0xffd700);
                });
                savePersistent(this.scene.persistent);
            }

            // Become a lingering corpse (feel + readability)
            this.becomeCorpse();
        }
    }

    becomeCorpse() {
        if (this.isCorpse) return;
        this.isCorpse = true;
        this.canTakeDamage = false;
        this.isInvulnerable = true;
        if (this.body) {
            this.body.enable = false;
            this.body.stop();
        }
        if (this.healthBar) {
            this.healthBar.setVisible(false);
            this.healthBar.destroy();
            this.healthBar = null;
        }
        if (this.alertExclamation) {
            this.alertExclamation.destroy();
            this.alertExclamation = null;
        }
        this.scene.tweens.killTweensOf(this);
        this.setTint(0x555555);
        this.setAlpha(0.9);
        // Inactive so countActive()/clear checks ignore corpses; still drawn
        this.setActive(false);
        this.setVisible(true);

        if (this.enemyType === 'leaper' && this.anims) {
            try { this.play('leaper_death'); } catch (e) { /* anim may be missing */ }
        }

        const linger = CONFIG.JUICE.CORPSE_LINGER_MS || 3500;
        const fade = CONFIG.JUICE.CORPSE_FADE_MS || 450;
        this.scene.time.delayedCall(linger, () => {
            if (!this.isCorpse || !this.scene) return;
            this.scene.tweens.add({
                targets: this,
                alpha: 0,
                duration: fade,
                onComplete: () => { if (this.scene) this.destroy(); }
            });
        });
    }
    
    updateHealthBar() {
        if (this.hp <= 0) { this.healthBar.setVisible(false); return; }
        this.healthBar.setVisible(true);
        this.healthBar.clear();
        const w = 40, h = 6, x = -w / 2, y = -40;
        this.healthBar.fillStyle(0xff0000);
        this.healthBar.fillRect(x, y, w, h);
        this.healthBar.fillStyle(0x00ff00);
        this.healthBar.fillRect(x, y, w * (this.hp / this.maxHp), h);
    }
    
    knockBack(multiplier = 1) {
        let speed = (this.enemyType === 'leaper') ? CONFIG.ENEMIES.LEAPER.KNOCKBACK_SPEED : CONFIG.ENEMIES.KNOCKBACK_SPEED;
        if (multiplier > 1) speed *= multiplier;
        if (this.enemyType === 'leaper') {
            this.state = 'COOLDOWN';
            const lcfg = CONFIG.ENEMIES.LEAPER;
            const cooldownMs = (multiplier > 1 && lcfg.PLAYER_BREAKFREE_COOLDOWN_MS != null)
                ? lcfg.PLAYER_BREAKFREE_COOLDOWN_MS
                : lcfg.COOLDOWN_TIME;
            const stunMs = (multiplier > 1 && lcfg.PLAYER_BREAKFREE_STUN_MS != null) ? lcfg.PLAYER_BREAKFREE_STUN_MS : 0;
            this.stunEndTime = stunMs > 0 ? this.scene.time.now + stunMs : null;
            this.leapTimer = Math.max(0, cooldownMs - stunMs);
        }
        const angle = Phaser.Math.Angle.Between(this.target.x, this.target.y, this.x, this.y);
        this.scene.physics.velocityFromRotation(angle, speed, this.body.velocity);
    }
    
    update(time, delta) {
        if (!this.active || this.isCorpse || !this.body) return;
        if (this.healthBar) {
            this.healthBar.setPosition(this.x, this.y);
            this.healthBar.setVisible(this.hp > 0 && this.revealedByFlashlight === true);
        }

        const cfg = this.config;

        if (ENEMY_UPDATE[this.enemyType]) {
            ENEMY_UPDATE[this.enemyType](this, time, delta);
            return;
        }

        if (this.enemyType === 'bandit') {
            if (this.pinnedByLeaper) {
                if (!this.pinnedByLeaper.active) this.pinnedByLeaper = null;
                else this.setVelocity(0); // Fully immobilized while pinned (same as player)
                return;
            }
            this.target = this.scene.getTargetForBandit(this);
            const bcfg = CONFIG.ENEMIES.BANDIT;
            const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
            const angleToPlayer = Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y);
            const getFacingAngle = () => {
                if (this.banditState === 'HUNT' || this.banditState === 'SEARCH') return (this.banditFacingAngle != null ? this.banditFacingAngle : this.patrolDirection);
                if (this.banditState === 'GUNSHOT_ALERT') return Phaser.Math.Angle.Between(this.x, this.y, this.gunshotTargetX, this.gunshotTargetY);
                return this.patrolDirection;
            };
            const canSeePlayer = () => {
                if (distToPlayer > bcfg.PERCEPTION_RADIUS) return false;
                let angleDiff = angleToPlayer - getFacingAngle();
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                if (Math.abs(angleDiff) > bcfg.VISION_ANGLE) return false;
                return this.scene.hasLineOfSight(this.x, this.y, this.target.x, this.target.y);
            };

            if (distToPlayer <= (bcfg.CLOSE_AGGRO_RADIUS || 100)) {
                const intervalMs = bcfg.CLOSE_AGGRO_ROLL_INTERVAL_MS || 2000;
                if (this.lastCloseAggroRollTime === 0) this.lastCloseAggroRollTime = time;
                if (time - this.lastCloseAggroRollTime >= intervalMs) {
                    this.lastCloseAggroRollTime = time;
                    const firstChance = bcfg.CLOSE_AGGRO_CHANCE_FIRST != null ? bcfg.CLOSE_AGGRO_CHANCE_FIRST : 0.8;
                    const floorChance = bcfg.CLOSE_AGGRO_CHANCE_FLOOR != null ? bcfg.CLOSE_AGGRO_CHANCE_FLOOR : 0.5;
                    const decay = bcfg.CLOSE_AGGRO_CHANCE_DECAY != null ? bcfg.CLOSE_AGGRO_CHANCE_DECAY : 0.05;
                    const chance = Math.max(floorChance, firstChance - this.closeAggroRollCount * decay);
                    if (Math.random() < chance) {
                        this.banditState = 'HUNT';
                        this.lastKnownPlayerX = this.target.x;
                        this.lastKnownPlayerY = this.target.y;
                        this.goAroundEndTime = 0;
                        this.wallStuckTimer = 0;
                    }
                    this.closeAggroRollCount++;
                }
            } else {
                this.lastCloseAggroRollTime = 0;
                this.closeAggroRollCount = 0;
            }
            if (distToPlayer > (bcfg.SOUND_RADIUS || 200)) this.footstepAlertCount = 0;
            if (this.banditState === 'PATROL' || this.banditState === 'GUNSHOT_ALERT' || this.banditState === 'SEARCH') {
                if (canSeePlayer()) {
                    this.banditState = 'HUNT';
                    this.lastKnownPlayerX = this.target.x;
                    this.lastKnownPlayerY = this.target.y;
                    this.goAroundEndTime = 0;
                    this.wallStuckTimer = 0;
                } else if (this.target !== this.scene.player && this.target.enemyType && ['walker', 'leaper'].includes(this.target.enemyType) && distToPlayer <= cfg.FIRE_RANGE) {
                    this.banditState = 'HUNT';
                    this.lastKnownPlayerX = this.target.x;
                    this.lastKnownPlayerY = this.target.y;
                    this.goAroundEndTime = 0;
                    this.wallStuckTimer = 0;
                }
            }

            if (this.banditState === 'GUNSHOT_ALERT') {
                if (!this.alertExclamation) {
                    this.alertExclamation = this.scene.add.text(this.x, this.y - 35, '!', { fontSize: '28px', fill: '#ff0000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(100);
                }
                this.alertExclamation.setPosition(this.x, this.y - 35);
                this.alertExclamation.setVisible(this.revealedByFlashlight === true);
            } else if (this.alertExclamation) {
                this.alertExclamation.setVisible(false);
            }

            if (this.banditState === 'PATROL') {
                this.banditFacingAngle = this.patrolDirection;
                const vx = Math.cos(this.patrolDirection) * (bcfg.PATROL_SPEED || 35);
                const vy = Math.sin(this.patrolDirection) * (bcfg.PATROL_SPEED || 35);
                this.body.setVelocity(vx, vy);
            } else if (this.banditState === 'GUNSHOT_ALERT') {
                const huntSpeed = cfg.SPEED * (bcfg.HUNT_SPEED_MULTIPLIER || 1.2);
                if (time >= this.gunshotAlertEndTime) {
                    if (this.damageAggro) {
                        this.banditState = 'SEARCH';
                        this.searchEndTime = time + bcfg.SEARCH_DURATION;
                        this.searchWanderTargetX = null;
                        this.searchWanderTargetY = null;
                        this.searchWanderTimer = 0;
                    } else {
                        this.banditState = 'PATROL';
                        this.angle = 0;
                    }
                    this.goAroundEndTime = 0;
                } else {
                    this.scene.physics.moveTo(this, this.gunshotTargetX, this.gunshotTargetY, huntSpeed);
                }
            } else if (this.banditState === 'HUNT') {
                this.lastKnownPlayerX = this.target.x;
                this.lastKnownPlayerY = this.target.y;
                let faceDiff = angleToPlayer - this.banditFacingAngle;
                while (faceDiff > Math.PI) faceDiff -= 2 * Math.PI;
                while (faceDiff < -Math.PI) faceDiff += 2 * Math.PI;
                this.banditFacingAngle += faceDiff * 0.12;
                this.angle = this.banditFacingAngle * (180 / Math.PI);
                const huntSpeed = cfg.SPEED * (bcfg.HUNT_SPEED_MULTIPLIER || 1.2);
                if (bcfg.CAN_SHOOT !== false && canSeePlayer() && distToPlayer < cfg.FIRE_RANGE && this.ammo > 0) {
                    this.setVelocity(0);
                    if (time - this.lastFired > cfg.FIRE_RATE) {
                        const b = this.scene.bullets.get(this.x, this.y);
                        if (b) {
                            b.fire(this.x, this.y, this.target.x, this.target.y, Phaser.Math.Between(-cfg.SPREAD, cfg.SPREAD), true);
                            this.ammo--;
                            this.lastFired = time;
                            const spawnGraceMs = 5000;
                            const inSpawnGrace = this.spawnTime != null && (time - this.spawnTime) < spawnGraceMs;
                            this.scene.onUnsuppressedGunshot(this.x, this.y, inSpawnGrace ? { leapersOnly: true } : {});
                        }
                    }
                } else if (this.ammo > 0) {
                    this.scene.physics.moveToObject(this, this.target, huntSpeed);
                } else {
                    this.scene.physics.moveToObject(this, this.target, cfg.MELEE_SPEED);
                }
                if (!canSeePlayer() || distToPlayer > bcfg.PERCEPTION_RADIUS) {
                    this.banditState = 'SEARCH';
                    this.searchEndTime = time + bcfg.SEARCH_DURATION;
                    this.searchWanderTargetX = null;
                    this.searchWanderTargetY = null;
                    this.searchWanderTimer = 0;
                    this.goAroundEndTime = 0;
                }
            } else if (this.banditState === 'SEARCH') {
                const angleToLastKnown = Phaser.Math.Angle.Between(this.x, this.y, this.lastKnownPlayerX, this.lastKnownPlayerY);
                let faceDiff = angleToLastKnown - this.banditFacingAngle;
                while (faceDiff > Math.PI) faceDiff -= 2 * Math.PI;
                while (faceDiff < -Math.PI) faceDiff += 2 * Math.PI;
                this.banditFacingAngle += faceDiff * 0.12;
                this.angle = this.banditFacingAngle * (180 / Math.PI);
                const toLast = Phaser.Math.Distance.Between(this.x, this.y, this.lastKnownPlayerX, this.lastKnownPlayerY);
                const destX = toLast <= bcfg.SEARCH_RADIUS && this.searchWanderTargetX !== null ? this.searchWanderTargetX : this.lastKnownPlayerX;
                const destY = toLast <= bcfg.SEARCH_RADIUS && this.searchWanderTargetY !== null ? this.searchWanderTargetY : this.lastKnownPlayerY;
                if (toLast <= bcfg.SEARCH_RADIUS) {
                    this.searchWanderTimer += delta;
                    if (this.searchWanderTimer >= 600 || (this.searchWanderTargetX === null)) {
                        this.searchWanderTimer = 0;
                        const angle = Math.random() * 2 * Math.PI;
                        this.searchWanderTargetX = this.lastKnownPlayerX + Math.cos(angle) * bcfg.SEARCH_RADIUS * 0.8;
                        this.searchWanderTargetY = this.lastKnownPlayerY + Math.sin(angle) * bcfg.SEARCH_RADIUS * 0.8;
                    }
                    if (this.searchWanderTargetX !== null) {
                        this.scene.physics.moveTo(this, this.searchWanderTargetX, this.searchWanderTargetY, cfg.SPEED * 0.7);
                    }
                } else {
                    this.scene.physics.moveTo(this, this.lastKnownPlayerX, this.lastKnownPlayerY, cfg.SPEED);
                }
                if (time >= this.searchEndTime) {
                    if (this.damageAggro) {
                        this.searchEndTime = time + bcfg.SEARCH_DURATION;
                    } else {
                        this.banditState = 'PATROL';
                        this.angle = 0;
                        const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
                        this.patrolDirection = dirs[Phaser.Math.Between(0, 3)];
                        this.goAroundEndTime = 0;
                    }
                }
                if (canSeePlayer()) {
                    this.banditState = 'HUNT';
                    this.lastKnownPlayerX = this.target.x;
                    this.lastKnownPlayerY = this.target.y;
                }
            }
            return;
        }

        if (this.enemyType === 'boss') {
            this.scene.physics.moveToObject(this, this.target, this.speed);
        } else if (this.enemyType === 'walker') {
            const wcfg = CONFIG.ENEMIES.WALKER;
            // Necromancer minions: stay within leash distance of the boss
            if (this.necromancerMaster && this.necromancerMaster.active) {
                const distToMaster = Phaser.Math.Distance.Between(this.x, this.y, this.necromancerMaster.x, this.necromancerMaster.y);
                const leash = this.maxDistanceFromMaster != null ? this.maxDistanceFromMaster : 220;
                if (distToMaster > leash) {
                    this.scene.physics.moveToObject(this, this.necromancerMaster, this.speed || wcfg.SPEED);
                    return;
                }
            }
            this.target = this.scene.getTargetForWalker(this);
            const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
            const angleToPlayer = Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y);
            const getFacingAngle = () => {
                if (this.walkerState === 'HUNT' || this.walkerState === 'SEARCH') return (this.walkerFacingAngle != null ? this.walkerFacingAngle : this.patrolDirection);
                if (this.walkerState === 'GUNSHOT_ALERT') return Phaser.Math.Angle.Between(this.x, this.y, this.gunshotTargetX, this.gunshotTargetY);
                return this.patrolDirection;
            };
            const canSeePlayer = () => {
                if (distToPlayer > wcfg.PERCEPTION_RADIUS) return false;
                let angleDiff = angleToPlayer - getFacingAngle();
                while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                if (Math.abs(angleDiff) > wcfg.VISION_ANGLE) return false;
                return this.scene.hasLineOfSight(this.x, this.y, this.target.x, this.target.y);
            };

            if (distToPlayer <= (wcfg.CLOSE_AGGRO_RADIUS || 80)) {
                const intervalMs = wcfg.CLOSE_AGGRO_ROLL_INTERVAL_MS || 2000;
                if (this.lastCloseAggroRollTime === 0) this.lastCloseAggroRollTime = time;
                if (time - this.lastCloseAggroRollTime >= intervalMs) {
                    this.lastCloseAggroRollTime = time;
                    const firstChance = wcfg.CLOSE_AGGRO_CHANCE_FIRST != null ? wcfg.CLOSE_AGGRO_CHANCE_FIRST : 0.8;
                    const floorChance = wcfg.CLOSE_AGGRO_CHANCE_FLOOR != null ? wcfg.CLOSE_AGGRO_CHANCE_FLOOR : 0.5;
                    const decay = wcfg.CLOSE_AGGRO_CHANCE_DECAY != null ? wcfg.CLOSE_AGGRO_CHANCE_DECAY : 0.05;
                    const chance = Math.max(floorChance, firstChance - this.closeAggroRollCount * decay);
                    if (Math.random() < chance) {
                        this.walkerState = 'HUNT';
                        this.lastKnownPlayerX = this.target.x;
                        this.lastKnownPlayerY = this.target.y;
                        this.goAroundEndTime = 0;
                        this.wallStuckTimer = 0;
                    }
                    this.closeAggroRollCount++;
                }
            } else {
                this.lastCloseAggroRollTime = 0;
                this.closeAggroRollCount = 0;
            }
            if (distToPlayer > (wcfg.SOUND_RADIUS || 180)) this.footstepAlertCount = 0;
            if (this.walkerState === 'PATROL' || this.walkerState === 'GUNSHOT_ALERT' || this.walkerState === 'SEARCH') {
                if (canSeePlayer()) {
                    this.walkerState = 'HUNT';
                    this.lastKnownPlayerX = this.target.x;
                    this.lastKnownPlayerY = this.target.y;
                    this.goAroundEndTime = 0;
                    this.wallStuckTimer = 0;
                }
            }

            if (this.walkerState === 'GUNSHOT_ALERT') {
                if (!this.alertExclamation) {
                    this.alertExclamation = this.scene.add.text(this.x, this.y - 35, '!', { fontSize: '28px', fill: '#ff0000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(100);
                }
                this.alertExclamation.setPosition(this.x, this.y - 35);
                this.alertExclamation.setVisible(this.revealedByFlashlight === true);
            } else if (this.alertExclamation) {
                this.alertExclamation.setVisible(false);
            }

            if (this.walkerState === 'PATROL') {
                this.walkerFacingAngle = this.patrolDirection;
                const speed = Math.sqrt(this.body.velocity.x * this.body.velocity.x + this.body.velocity.y * this.body.velocity.y);
                if (time < this.goAroundEndTime) {
                    const vx = Math.cos(this.goAroundAngle) * wcfg.PATROL_SPEED;
                    const vy = Math.sin(this.goAroundAngle) * wcfg.PATROL_SPEED;
                    this.body.setVelocity(vx, vy);
                } else {
                    const vx = Math.cos(this.patrolDirection) * wcfg.PATROL_SPEED;
                    const vy = Math.sin(this.patrolDirection) * wcfg.PATROL_SPEED;
                    this.body.setVelocity(vx, vy);
                    if (speed < 5) {
                        this.wallStuckTimer += delta;
                        if (this.wallStuckTimer >= (wcfg.GO_AROUND_STUCK_TIME_MS || 350)) {
                            this.goAroundEndTime = time + (wcfg.GO_AROUND_DURATION_MS || 700) * (wcfg.GO_AROUND_DISTANCE_MULTIPLIER || 1.15);
                            this.goAroundAngle = this.patrolDirection + this.goAroundSide * (Math.PI / 2);
                            this.goAroundSide *= -1;
                            this.wallStuckTimer = 0;
                        }
                    } else {
                        this.wallStuckTimer = 0;
                    }
                }
            } else if (this.walkerState === 'GUNSHOT_ALERT') {
                const huntSpeed = wcfg.SPEED * (wcfg.HUNT_SPEED_MULTIPLIER || 1.3);
                if (time >= this.gunshotAlertEndTime) {
                    if (this.damageAggro) {
                        this.walkerState = 'SEARCH';
                        this.searchEndTime = time + wcfg.SEARCH_DURATION;
                        this.searchWanderTargetX = null;
                        this.searchWanderTargetY = null;
                        this.searchWanderTimer = 0;
                    } else {
                        this.walkerState = 'PATROL';
                        this.angle = 0;
                    }
                    this.stuckTimer = 0;
                    this.wallStuckTimer = 0;
                    this.goAroundEndTime = 0;
                } else {
                    const angleToGunshot = Phaser.Math.Angle.Between(this.x, this.y, this.gunshotTargetX, this.gunshotTargetY);
                    const speed = Math.sqrt(this.body.velocity.x * this.body.velocity.x + this.body.velocity.y * this.body.velocity.y);
                    if (time < this.goAroundEndTime) {
                        const vx = Math.cos(this.goAroundAngle) * huntSpeed;
                        const vy = Math.sin(this.goAroundAngle) * huntSpeed;
                        this.body.setVelocity(vx, vy);
                    } else {
                        this.scene.physics.moveTo(this, this.gunshotTargetX, this.gunshotTargetY, huntSpeed);
                        if (speed < 5) {
                            this.wallStuckTimer += delta;
                            if (this.wallStuckTimer >= (wcfg.GO_AROUND_STUCK_TIME_MS || 350)) {
                                this.goAroundEndTime = time + (wcfg.GO_AROUND_DURATION_MS || 700) * (wcfg.GO_AROUND_DISTANCE_MULTIPLIER || 1.15);
                                this.goAroundAngle = angleToGunshot + this.goAroundSide * (Math.PI / 2);
                                this.goAroundSide *= -1;
                                this.wallStuckTimer = 0;
                            }
                        } else {
                            this.wallStuckTimer = 0;
                        }
                    }
                }
            } else if (this.walkerState === 'HUNT') {
                const huntSpeed = wcfg.SPEED * (wcfg.HUNT_SPEED_MULTIPLIER || 1.3);
                this.lastKnownPlayerX = this.target.x;
                this.lastKnownPlayerY = this.target.y;
                const angleToPlayer = Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y);
                let faceDiff = angleToPlayer - this.walkerFacingAngle;
                while (faceDiff > Math.PI) faceDiff -= 2 * Math.PI;
                while (faceDiff < -Math.PI) faceDiff += 2 * Math.PI;
                this.walkerFacingAngle += faceDiff * 0.12;
                this.angle = this.walkerFacingAngle * (180 / Math.PI);
                const speed = Math.sqrt(this.body.velocity.x * this.body.velocity.x + this.body.velocity.y * this.body.velocity.y);
                if (time < this.goAroundEndTime) {
                    const vx = Math.cos(this.goAroundAngle) * huntSpeed;
                    const vy = Math.sin(this.goAroundAngle) * huntSpeed;
                    this.body.setVelocity(vx, vy);
                    if (canSeePlayer() && this.scene.hasLineOfSight(this.x, this.y, this.target.x, this.target.y)) {
                        this.goAroundEndTime = 0;
                    }
                } else {
                    this.scene.physics.moveToObject(this, this.target, huntSpeed);
                    if (speed < 5) {
                        this.wallStuckTimer += delta;
                        if (this.wallStuckTimer >= (wcfg.GO_AROUND_STUCK_TIME_MS || 350)) {
                            this.goAroundEndTime = time + (wcfg.GO_AROUND_DURATION_MS || 700) * (wcfg.GO_AROUND_DISTANCE_MULTIPLIER || 1.15);
                            this.goAroundAngle = angleToPlayer + this.goAroundSide * (Math.PI / 2);
                            this.goAroundSide *= -1;
                            this.wallStuckTimer = 0;
                        }
                    } else {
                        this.wallStuckTimer = 0;
                    }
                }
                if (!canSeePlayer() || distToPlayer > wcfg.PERCEPTION_RADIUS) {
                    this.walkerState = 'SEARCH';
                    this.searchEndTime = time + wcfg.SEARCH_DURATION;
                    this.searchWanderTargetX = null;
                    this.searchWanderTargetY = null;
                    this.searchWanderTimer = 0;
                    this.goAroundEndTime = 0;
                }
            } else if (this.walkerState === 'SEARCH') {
                const angleToLastKnown = Phaser.Math.Angle.Between(this.x, this.y, this.lastKnownPlayerX, this.lastKnownPlayerY);
                let faceDiff = angleToLastKnown - this.walkerFacingAngle;
                while (faceDiff > Math.PI) faceDiff -= 2 * Math.PI;
                while (faceDiff < -Math.PI) faceDiff += 2 * Math.PI;
                this.walkerFacingAngle += faceDiff * 0.12;
                this.angle = this.walkerFacingAngle * (180 / Math.PI);
                const speed = Math.sqrt(this.body.velocity.x * this.body.velocity.x + this.body.velocity.y * this.body.velocity.y);
                const toLast = Phaser.Math.Distance.Between(this.x, this.y, this.lastKnownPlayerX, this.lastKnownPlayerY);
                const destX = toLast <= wcfg.SEARCH_RADIUS && this.searchWanderTargetX !== null ? this.searchWanderTargetX : this.lastKnownPlayerX;
                const destY = toLast <= wcfg.SEARCH_RADIUS && this.searchWanderTargetY !== null ? this.searchWanderTargetY : this.lastKnownPlayerY;
                const angleToDest = Phaser.Math.Angle.Between(this.x, this.y, destX, destY);
                if (time < this.goAroundEndTime) {
                    const moveSpeed = toLast <= wcfg.SEARCH_RADIUS ? wcfg.SPEED * 0.7 : wcfg.SPEED;
                    const vx = Math.cos(this.goAroundAngle) * moveSpeed;
                    const vy = Math.sin(this.goAroundAngle) * moveSpeed;
                    this.body.setVelocity(vx, vy);
                } else {
                    if (toLast <= wcfg.SEARCH_RADIUS) {
                        this.searchWanderTimer += delta;
                        if (this.searchWanderTimer >= 600 || (this.searchWanderTargetX === null)) {
                            this.searchWanderTimer = 0;
                            const angle = Math.random() * 2 * Math.PI;
                            this.searchWanderTargetX = this.lastKnownPlayerX + Math.cos(angle) * wcfg.SEARCH_RADIUS * 0.8;
                            this.searchWanderTargetY = this.lastKnownPlayerY + Math.sin(angle) * wcfg.SEARCH_RADIUS * 0.8;
                        }
                        if (this.searchWanderTargetX !== null) {
                            this.scene.physics.moveTo(this, this.searchWanderTargetX, this.searchWanderTargetY, wcfg.SPEED * 0.7);
                        }
                    } else {
                        this.scene.physics.moveTo(this, this.lastKnownPlayerX, this.lastKnownPlayerY, wcfg.SPEED);
                    }
                    if (speed < 5) {
                        this.wallStuckTimer += delta;
                        if (this.wallStuckTimer >= (wcfg.GO_AROUND_STUCK_TIME_MS || 350)) {
                            this.goAroundEndTime = time + (wcfg.GO_AROUND_DURATION_MS || 700) * (wcfg.GO_AROUND_DISTANCE_MULTIPLIER || 1.15);
                            this.goAroundAngle = angleToDest + this.goAroundSide * (Math.PI / 2);
                            this.goAroundSide *= -1;
                            this.wallStuckTimer = 0;
                        }
                    } else {
                        this.wallStuckTimer = 0;
                    }
                }
                if (time >= this.searchEndTime) {
                    if (this.damageAggro) {
                        this.searchEndTime = time + wcfg.SEARCH_DURATION;
                    } else {
                        this.walkerState = 'PATROL';
                        this.angle = 0;
                        const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
                        this.patrolDirection = dirs[Phaser.Math.Between(0, 3)];
                        this.stuckTimer = 0;
                        this.goAroundEndTime = 0;
                    }
                }
            }
            return;
        } else if (this.enemyType === 'leaper') {
            if (this.stunEndTime != null) {
                if (time < this.stunEndTime) {
                    this.setVelocity(0);
                    this.setTint(0x8888ff);
                    return;
                }
                this.stunEndTime = null;
                this.clearTint();
            }
            this.target = this.scene.getTargetForWalker(this);
            const dist = this.target ? Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y) : 0;
            switch (this.state) {
                case 'IDLE': {
                    const leapRadius = cfg.LEAP_TRIGGER_RADIUS != null ? cfg.LEAP_TRIGGER_RADIUS : 180;
                    const huntRadius = leapRadius * 3;
                    if (this.target && this.target !== this.scene.player && this.target.active && this.target.enemyType === 'bandit' && dist <= huntRadius) {
                        this.state = 'CHASE';
                        this.lastHeardX = this.target.x;
                        this.lastHeardY = this.target.y;
                        this.lastHeardTime = time;
                        break;
                    }
                    const patrolSpeed = cfg.PATROL_SPEED != null ? cfg.PATROL_SPEED : 55;
                    const wanderChangeMs = cfg.WANDER_CHANGE_MS != null ? cfg.WANDER_CHANGE_MS : 2500;
                    if (this.leaperWanderChangeTime === 0) this.leaperWanderChangeTime = time;
                    if (time - this.leaperWanderChangeTime >= wanderChangeMs) {
                        this.leaperWanderDirection = Math.random() * Math.PI * 2;
                        this.leaperWanderChangeTime = time;
                    }
                    this.leaperFacingAngle = this.leaperWanderDirection;
                    this.scene.physics.velocityFromRotation(this.leaperWanderDirection, patrolSpeed, this.body.velocity);
                    this.setFlipX(this.body.velocity.x < 0);
                    if (this.anims.currentAnim?.key !== 'leaper_crawl') this.play('leaper_crawl');
                    break;
                }
                case 'GUNSHOT_ALERT': {
                    if (time >= this.gunshotAlertEndTime) {
                        this.state = 'CHASE';
                        this.lastHeardX = this.gunshotTargetX;
                        this.lastHeardY = this.gunshotTargetY;
                        this.lastHeardTime = time;
                        break;
                    }
                    if (this.anims.currentAnim?.key !== 'leaper_crawl') this.play('leaper_crawl');
                    this.scene.physics.moveTo(this, this.gunshotTargetX, this.gunshotTargetY, cfg.SPEED);
                    this.setFlipX(this.body.velocity.x < 0);
                    const leapRadius = cfg.LEAP_TRIGGER_RADIUS != null ? cfg.LEAP_TRIGGER_RADIUS : 180;
                    if (dist < leapRadius) {
                        this.state = 'PREPARE';
                        this.setVelocity(0);
                        this.leapTimer = cfg.PREPARE_TIME;
                        this.play('leaper_attack');
                    }
                    break;
                }
                case 'CHASE': {
                    const loseMs = cfg.LOSE_PLAYER_MS != null ? cfg.LOSE_PLAYER_MS : 3000;
                    const chasingBandit = this.target && this.target !== this.scene.player && this.target.enemyType === 'bandit';
                    if (!chasingBandit && time - this.lastHeardTime > loseMs) {
                        this.state = 'IDLE';
                        this.leaperWanderDirection = Math.atan2(this.body.velocity.y, this.body.velocity.x);
                        this.leaperWanderChangeTime = time;
                        break;
                    }
                    if (this.anims.currentAnim?.key !== 'leaper_crawl') this.play('leaper_crawl');
                    const dest = (chasingBandit && this.target && this.target.active) ? this.target : { x: this.lastHeardX, y: this.lastHeardY };
                    this.scene.physics.moveToObject(this, dest, cfg.SPEED);
                    this.setFlipX(this.body.velocity.x < 0);
                    const leapRadius = cfg.LEAP_TRIGGER_RADIUS != null ? cfg.LEAP_TRIGGER_RADIUS : 180;
                    if (dist < leapRadius) {
                        this.state = 'PREPARE';
                        this.setVelocity(0);
                        this.leapTimer = cfg.PREPARE_TIME;
                        this.play('leaper_attack');
                    }
                    break;
                }
                case 'PREPARE':
                    this.leapTimer -= delta;
                    if (this.leapTimer <= 0) {
                        this.state = 'LEAP';
                        this.scene.physics.moveToObject(this, this.target, cfg.LEAP_SPEED);
                        this.leapTimer = cfg.LEAP_DURATION;
                        // sfx.leaperLeap(); // off for now
                    }
                    break;
                case 'LEAP': {
                    const banditHitRadius = (cfg.BANDIT_PIN_HIT_RADIUS != null) ? cfg.BANDIT_PIN_HIT_RADIUS : 55;
                    let hitBandit = null;
                    this.scene.enemies.getChildren().forEach(b => {
                        if (!b.active || b.enemyType !== 'bandit' || b === this) return;
                        if (b.pinnedByLeaper) return;
                        const d = Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y);
                        if (d < banditHitRadius) {
                            if (!hitBandit || d < Phaser.Math.Distance.Between(this.x, this.y, hitBandit.x, hitBandit.y)) hitBandit = b;
                        }
                    });
                    if (hitBandit) {
                        // Same as player: immobilize bandit and land on them (always pin, no knockback)
                        this.state = 'PINNING';
                        this.pinnedTarget = hitBandit;
                        this.pinHitCount = 0;
                        this.lastPinDamageTime = time;
                        hitBandit.pinnedByLeaper = this;
                        this.setVelocity(0);
                        hitBandit.setVelocity(0);
                        const pct = cfg.PIN_DAMAGE_FIRST_PCT != null ? cfg.PIN_DAMAGE_FIRST_PCT : 0.1;
                        const dmg = Math.max(1, Math.ceil(hitBandit.maxHp * pct)) * 2; // Double damage to bandits
                        hitBandit.takeDamage(dmg, 'melee', this.x, this.y);
                        this.pinHitCount = 1;
                        break;
                    }
                    if (this.target && this.target.active) {
                        this.scene.physics.moveToObject(this, this.target, cfg.LEAP_SPEED);
                        if (dist > 30) this.setFlipX(this.body.velocity.x < 0);
                    }
                    this.leapTimer -= delta;
                    if (this.leapTimer <= 0) {
                        this.state = 'COOLDOWN';
                        this.setVelocity(0);
                        this.leapTimer = cfg.COOLDOWN_TIME;
                        this.play('leaper_idle'); // Idle/breathing after leap
                    }
                    break;
                }
                case 'PINNING':
                    if (this.pinnedTarget && this.pinnedTarget.active) {
                        this.setPosition(this.pinnedTarget.x, this.pinnedTarget.y);
                        this.setVelocity(0);
                        this.pinnedTarget.setVelocity(0);
                    } else {
                        if (this.pinnedTarget && this.pinnedTarget.pinnedByLeaper === this) this.pinnedTarget.pinnedByLeaper = null;
                        this.pinnedTarget = null;
                        this.state = 'COOLDOWN';
                        this.leapTimer = cfg.COOLDOWN_TIME;
                    }
                    break;
                case 'COOLDOWN':
                    this.leapTimer -= delta;
                    if (this.leapTimer <= 0) {
                        this.state = 'CHASE';
                        this.play('leaper_crawl'); // Back to crawling
                    }
                    break;
            }
            if (this.state === 'CHASE' || this.state === 'GUNSHOT_ALERT') {
                if (!this.alertExclamation) {
                    this.alertExclamation = this.scene.add.text(this.x, this.y - 35, '!', { fontSize: '28px', fill: '#ff0000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(100);
                }
                this.alertExclamation.setPosition(this.x, this.y - 35);
                this.alertExclamation.setVisible(this.revealedByFlashlight === true);
            } else if (this.alertExclamation) {
                this.alertExclamation.setVisible(false);
            }
        } else if (this.enemyType === 'necromancer') {
            // Necromancer boss phases
            this.updateNecromancerAI(time, delta);
        }
    }
    
    updateNecromancerAI(time, delta) {
        const cfg = CONFIG.ENEMIES.NECROMANCER;
        
        switch (this.phase) {
            case 'SUMMON':
                this.setVelocity(0);
                if (!this.hasSummoned) {
                    this.hasSummoned = true;
                    // Summon minions
                    for (let i = 0; i < cfg.SUMMON_COUNT; i++) {
                        const angle = (i / cfg.SUMMON_COUNT) * Math.PI * 2;
                        const spawnX = this.x + Math.cos(angle) * 100;
                        const spawnY = this.y + Math.sin(angle) * 100;
                        const minion = new Enemy(this.scene, spawnX, spawnY, this.target, 'walker');
                        minion.necromancerMaster = this;
                        minion.maxDistanceFromMaster = cfg.MINION_LEASH_RADIUS != null ? cfg.MINION_LEASH_RADIUS : 220;
                        this.scene.enemies.add(minion);
                        this.summonedMinions.push(minion);
                        // Summon visual effect
                        this.scene.showFloatingText(spawnX, spawnY, "RISE!", 0x8800ff);
                    }
                    sfx.necroSummon();
                    this.isInvulnerable = true;
                    this.setTint(0xcc88ff);
                }
                // Check if all minions are dead
                this.summonedMinions = this.summonedMinions.filter(m => m.active);
                if (this.summonedMinions.length === 0) {
                    this.phase = 'VULNERABLE';
                    this.phaseTimer = cfg.VULNERABLE_TIME;
                    this.isInvulnerable = false;
                    this.setTint(0xff00ff); // Bright purple when vulnerable
                    sfx.necroVulnerable();
                    this.scene.showFloatingText(this.x, this.y - 40, "VULNERABLE!", 0xff00ff);
                }
                break;
                
            case 'VULNERABLE':
                this.phaseTimer -= delta;
                // Attack while vulnerable
                if (time - this.lastFired > 1500) {
                    this.fireNecroProjectile();
                    this.lastFired = time;
                }
                // Teleport periodically
                if (time - this.lastTeleport > cfg.TELEPORT_COOLDOWN) {
                    this.teleport();
                    this.lastTeleport = time;
                }
                if (this.phaseTimer <= 0) {
                    this.phase = 'SUMMON';
                    this.hasSummoned = false;
                    this.isInvulnerable = true;
                    this.setTint(0xcc88ff);
                }
                break;
        }
    }
    
    fireNecroProjectile() {
        const cfg = CONFIG.ENEMIES.NECROMANCER;
        const angle = Phaser.Math.Angle.Between(this.x, this.y, this.target.x, this.target.y);
        // Create acid-like projectile
        this.scene.spawnNecroProjectile(this.x, this.y, this.target.x, this.target.y);
        sfx.necroProjectile();
    }
    
    teleport() {
        // Teleport to random position in arena
        const newX = Phaser.Math.Between(150, 650);
        const newY = Phaser.Math.Between(100, 300);
        
        // Teleport effect
        this.scene.tweens.add({
            targets: this,
            alpha: 0,
            duration: 200,
            onComplete: () => {
                this.setPosition(newX, newY);
                this.scene.tweens.add({
                    targets: this,
                    alpha: 1,
                    duration: 200
                });
            }
        });
        sfx.necroTeleport();
    }
    
    destroy(fromScene) {
        if (this.healthBar) this.healthBar.destroy();
        if (this.flashTween) this.flashTween.stop();
        if ((this.enemyType === 'walker' || this.enemyType === 'leaper') && this.alertExclamation) {
            this.alertExclamation.destroy();
            this.alertExclamation = null;
        }
        super.destroy(fromScene);
    }
}

// =============================================================================
// HIDEOUT SCENE
// =============================================================================
class HideoutScene extends Phaser.Scene {
    constructor() { super('HideoutScene'); }
    
    create(data) {
        // Clean up any lingering references from previous scene
        this.mapNodes = null;
        this.mapElements = null;
        this.mapInfoText = null;
        this.mapStatusText = null;
        this.selectedLevel = null;
        
        this.stats = data.stats;
        if (!this.stats.ammoBoxInventories) this.stats.ammoBoxInventories = {};
        // Remove non-grid items from backpack; normalize ammo_box to 2x2
        if (this.stats.backpack && Array.isArray(this.stats.backpack.items)) {
            if (this.stats.ammo > 0) { tryAddItem(this.stats.backpack, 'ammo', this.stats.ammo); this.stats.ammo = 0; }
            this.stats.backpack.items.forEach(p => {
                if (p.itemId === 'ammo_box') { p.sizeW = 2; p.sizeH = 2; }
                if (p.itemId === 'rig') { p.sizeW = 3; p.sizeH = 2; }
                if (p.itemId === 'backpack_default') { p.sizeW = 5; p.sizeH = 8; }
            });
            const nonGrid = (CONFIG.LOOT && CONFIG.LOOT.NON_GRID_ITEM_IDS) || [];
            this.stats.backpack.items = this.stats.backpack.items.filter(p => !nonGrid.includes(p.itemId));
        }
        // Ensure magazines exist
        if (!this.stats.magazines) {
            this.stats.magazines = {
                pistol: CONFIG.WEAPONS.PISTOL.MAG_SIZE,
                shotgun: CONFIG.WEAPONS.SHOTGUN.MAG_SIZE,
                smg: CONFIG.WEAPONS.SMG.MAG_SIZE,
                crossbow: CONFIG.WEAPONS.CROSSBOW.MAG_SIZE,
                rifle: CONFIG.WEAPONS.RIFLE.MAG_SIZE
            };
        }
        // Ensure new weapon magazines exist
        if (this.stats.magazines.crossbow === undefined) this.stats.magazines.crossbow = CONFIG.WEAPONS.CROSSBOW.MAG_SIZE;
        if (this.stats.magazines.rifle === undefined) this.stats.magazines.rifle = CONFIG.WEAPONS.RIFLE.MAG_SIZE;
        // Ensure new weapon flags exist
        if (this.stats.hasCrossbow === undefined) this.stats.hasCrossbow = false;
        if (this.stats.hasRifle === undefined) this.stats.hasRifle = false;
        // Ensure grenades exist for old saves; migrate legacy stack to items
        if (this.stats.grenades === undefined) this.stats.grenades = 0;
        if (this.stats.grenades > 0) {
            for (let i = 0; i < this.stats.grenades; i++) tryAddItem(this.stats.backpack, 'grenade', 1);
            this.stats.grenades = 0;
        }
        // Ensure new hideout fields exist
        if (this.stats.hideout.workbenchLvl === undefined) {
            this.stats.hideout.workbenchLvl = 0;
        }
        if (this.stats.hideout.repairStationLvl === undefined) {
            this.stats.hideout.repairStationLvl = 0;
        }
        // Migrate armory → tinkerBench + gunBench; NVG → equippable item
        if (this.stats.hideout.tinkerBench === undefined) {
            this.stats.hideout.tinkerBench = { crafting: null };
        }
        if (this.stats.hideout.gunBench === undefined) {
            this.stats.hideout.gunBench = { level: 1, crafting: null };
        }
        if (this.stats.hideout.armory) {
            const armory = this.stats.hideout.armory;
            if (armory.hasNVG) this.stats._migrateGrantNvg = true;
            if (armory.crafting && armory.crafting.item === 'nvg') {
                this.stats.hideout.tinkerBench.crafting = { item: 'nvg', finishTime: armory.crafting.finishTime };
            }
            delete this.stats.hideout.armory;
        }
        if (this.stats.armor.nvg === undefined) {
            this.stats.armor.nvg = null;
        }
        // Ensure new currency fields exist
        if (this.stats.credits === undefined) {
            this.stats.credits = 0;
        }
        if (this.stats.materials === undefined) {
            this.stats.materials = 0;
        }
        // Ensure consumables is a valid array
        if (!this.stats.consumables || !Array.isArray(this.stats.consumables)) {
            this.stats.consumables = [null, null, null];
        }
        while (this.stats.consumables.length < 3) {
            this.stats.consumables.push(null);
        }
        // Ensure nextLevel exists for old saves
        if (this.stats.nextLevel === undefined) {
            this.stats.nextLevel = 1;
        }
        // Ensure highestLevelUnlocked exists (default to nextLevel for old saves)
        if (this.stats.highestLevelUnlocked === undefined) {
            this.stats.highestLevelUnlocked = this.stats.nextLevel || 1;
        }
        if (!this.stats.equippedMods) this.stats.equippedMods = {};
        ensureEquippedModsShape(this.stats);
        ensureWeaponSlotModsShape(this.stats);
        if (!this.stats.weaponSlots) this.stats.weaponSlots = { primary: null, secondary: null, sidearm: 'pistol', melee: null };
        ensurePockets(this.stats);
        ensureRigStats(this.stats);
        if (this.stats.rigGrid) ensurePlacementMods(this.stats.rigGrid);
        // Ensure backpack exists (for next run loadout)
        if (!this.stats.backpack) this.stats.backpack = getDefaultBackpack();
        ensureGridItems(this.stats.backpack);
        ensurePlacementMods(this.stats.backpack);
        ensureBackpackStats(this.stats);
        ensureSecureContainerStats(this.stats);
        ensureMedBagStats(this.stats);

        // Load persistent stats
        this.persistent = loadPersistent();
        if (this.stats._migrateGrantNvg && this.persistent.stash) {
            tryAddItem(this.persistent.stash, 'nvg', 1);
            delete this.stats._migrateGrantNvg;
        }
        // Deposit any run loot (scrap/credits/materials) into hideout stash; you don't carry these into raid
        this.persistent.scrap = (this.persistent.scrap || 0) + (this.stats.scrap || 0);
        this.persistent.credits = (this.persistent.credits || 0) + (this.stats.credits || 0);
        this.persistent.materials = (this.persistent.materials || 0) + (this.stats.materials || 0);
        this.stats.scrap = 0;
        this.stats.credits = 0;
        this.stats.materials = 0;
        savePersistent(this.persistent);
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
        
        // Check and rotate challenges on hideout load
        if (checkChallengeReset(this.persistent)) {
            savePersistent(this.persistent);
        }

        // Initialize tab content array for cleanup
        this.tabContent = [];
        this.currentTab = (data && data.tab) || 'character';  // default = loadout (inventory + stash)
        this.hideoutInvBodyView = 'gear';  // for CHARACTER tab body section
        
        // Render persistent UI elements
        this.renderBackground();
        this.renderHeader();
        this.renderTabs();
        this.renderFooter();
        
        // Show default or requested tab. CHARACTER = draw inventory panel in-place with opaque backdrop + stash section.
        if (this.currentTab === 'character') {
            this._invStats = this.stats;
            this._invContent = [];
            this._invBodyView = 'gear';
            createHideoutInvCtx(this);
            this.invGhostRect = null;
            this.invListeners = null;
            this.invDragging = null;
            const backdrop = this.add.rectangle(400, 300, 800, 600, 0x0d0d0d, 1).setDepth(290);
            this._invContent.push(backdrop);
            this.renderInventoryPanel();
        } else {
            this.showTab(this.currentTab);
        }
        if (data && data.openMissionMap) this.time.delayedCall(50, () => { if (this.showMissionMap) this.showMissionMap(); });
        if (data && data.openSettings) this.time.delayedCall(50, () => { if (this.showSettingsMenu) this.showSettingsMenu(); });
    }
    
    renderBackground() {
        this.add.rectangle(400, 300, 800, 600, 0x1a1a1a);
        this.add.grid(400, 300, 800, 600, 32, 32, 0x222222).setAlpha(0.3);
    }
    
    _getHeaderTitleForTab(tabId) {
        const titles = { character: 'Loadout', facilities: 'The Hideout', shop: 'Trader', extras: 'Extras' };
        return titles[tabId] || 'The Hideout';
    }

    renderHeader() {
        const HEADER_DEPTH = 350;
        const title = this._getHeaderTitleForTab(this.currentTab);
        this._headerTitleText = this.add.text(35, 15, title, { fontSize: '32px', fill: '#00ff00', fontStyle: 'bold' }).setDepth(HEADER_DEPTH);
        
        // Separator line (HP / Ammo / resources moved to CHARACTER tab stash area)
        this.add.rectangle(400, 55, 760, 2, 0x444444).setDepth(HEADER_DEPTH);
    }
    
    updateResourceText() {
        if (this._stashResourceText && this._stashResourceText.active) {
            this._stashResourceText.setText(
                `SCRAP: ${this.persistent.scrap || 0}  |  CREDITS: ${this.persistent.credits || 0}  |  MAT: ${this.persistent.materials || 0}`
            );
        }
    }
    
    renderTabs() {
        const tabY = 32;
        const tabWidth = 120;
        const tabHeight = 35;
        const spacing = 10;
        const TAB_BAR_DEPTH = 350;
        const labelRight = 20 + 260;
        const firstTabCenterX = labelRight + spacing + tabWidth / 2 - 20;
        const tabs = [
            { id: 'character', label: 'CHARACTER', x: firstTabCenterX },
            { id: 'facilities', label: 'FACILITIES', x: firstTabCenterX + tabWidth + spacing },
            { id: 'shop', label: 'TRADER', x: firstTabCenterX + (tabWidth + spacing) * 2 },
            { id: 'extras', label: 'EXTRAS', x: firstTabCenterX + (tabWidth + spacing) * 3 }
        ];
        
        this.tabButtons = {};
        this.tabTexts = {};
        
        tabs.forEach(tab => {
            const isActive = this.currentTab === tab.id;
            const btn = this.add.rectangle(tab.x, tabY, tabWidth, tabHeight, isActive ? 0x555555 : 0x333333)
                .setStrokeStyle(1, 0x666666)
                .setInteractive()
                .setDepth(TAB_BAR_DEPTH);
            const txt = this.add.text(tab.x, tabY, tab.label, { 
                fontSize: '14px', 
                fill: isActive ? '#fff' : '#888',
                fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(TAB_BAR_DEPTH + 1);
            
            btn.on('pointerdown', () => {
                sfx.click();
                this.showTab(tab.id);
            });
            btn.on('pointerover', () => {
                if (this.currentTab !== tab.id) btn.setFillStyle(0x444444);
            });
            btn.on('pointerout', () => {
                if (this.currentTab !== tab.id) btn.setFillStyle(0x333333);
            });
            
            this.tabButtons[tab.id] = btn;
            this.tabTexts[tab.id] = txt;
        });
    }
    
    updateTabStyles() {
        const tabs = ['character', 'facilities', 'shop', 'extras'];
        tabs.forEach(tabId => {
            const isActive = this.currentTab === tabId;
            if (this.tabButtons[tabId]) {
                this.tabButtons[tabId].setFillStyle(isActive ? 0x555555 : 0x333333);
            }
            if (this.tabTexts[tabId]) {
                this.tabTexts[tabId].setFill(isActive ? '#fff' : '#888');
            }
        });
    }
    
    renderFooter() {
        const footerY = 565;
        const FOOTER_DEPTH = 400;
        
        // Separator line above footer
        this.add.rectangle(400, 520, 760, 2, 0x444444).setDepth(FOOTER_DEPTH);
        
        // Main Menu button (left)
        const menuBtn = this.add.rectangle(80, footerY, 130, 40, 0x444444).setInteractive().setDepth(FOOTER_DEPTH);
        this.add.text(80, footerY, "MAIN MENU", { fontSize: '13px', fill: '#fff' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
        menuBtn.on('pointerdown', () => { sfx.menuClose(); this.scene.start('MainMenuScene'); });
        menuBtn.on('pointerover', () => menuBtn.setFillStyle(0x555555));
        menuBtn.on('pointerout', () => menuBtn.setFillStyle(0x444444));
        
        // Settings cog icon
        const settingsBtn = this.add.rectangle(170, footerY, 40, 40, 0x444444).setInteractive().setDepth(FOOTER_DEPTH);
        this.add.text(170, footerY, "⚙️", { fontSize: '20px' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
        settingsBtn.on('pointerdown', () => { sfx.menuOpen(); this.showSettingsMenu(); });
        settingsBtn.on('pointerover', () => settingsBtn.setFillStyle(0x555555));
        settingsBtn.on('pointerout', () => settingsBtn.setFillStyle(0x444444));
        
        // Mission Map button (right, prominent)
        const missionBtn = this.add.rectangle(580, footerY, 320, 50, 0x00aa44).setInteractive().setDepth(FOOTER_DEPTH);
        this.add.text(580, footerY, "MISSION MAP", { fontSize: '26px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
        missionBtn.on('pointerdown', () => { sfx.menuOpen(); this.showMissionMap(); });
        missionBtn.on('pointerover', () => missionBtn.setFillStyle(0x00cc55));
        missionBtn.on('pointerout', () => missionBtn.setFillStyle(0x00aa44));
    }
    
    /** Schedules a deferred rerender of the CHARACTER tab (stash + inventory). Safe to call even if tab is not active. */
    scheduleRerenderCharacterTab() {
        if (this._rerenderCharacterTab) this.time.delayedCall(0, () => { if (this._rerenderCharacterTab) this._rerenderCharacterTab(); });
    }

    /** Shared InvUI panel + CHARACTER stash layer (no GameScene.prototype piggyback). */
    renderInventoryPanel() {
        const ctx = this._invCtx || createHideoutInvCtx(this);
        renderSharedInventoryPanel(this, ctx);
        if (ctx.isHideout() && this.currentTab === 'character') {
            this.renderCharacterTabStash();
            this.updateResourceText();
        }
    }
    
    showTab(tabId) {
        const wasCharacter = this.currentTab === 'character';
        this.currentTab = tabId;
        if (this._headerTitleText) this._headerTitleText.setText(this._getHeaderTitleForTab(tabId));
        this.updateTabStyles();
        // CHARACTER tab: draw inventory panel in-place with opaque backdrop (nothing behind it)
        if (tabId === 'character') {
            // Clean up any previous panel
            if (this._invContent && this._invContent.length) {
                this._invContent.forEach(e => e.destroy());
                this._invContent = [];
            }
            if (this.invListeners) {
                this.input.off('pointermove', this.invListeners.move);
                this.input.off('pointerdown', this.invListeners.down);
                this.input.off('pointerup', this.invListeners.up);
                if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
                if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
                if (this.invListeners.uKey) this.invListeners.uKey.off('down', this.invListeners.uKeyCallback);
                this.invListeners = null;
            }
            if (this.invGhostRect) { this.invGhostRect.destroy(); this.invGhostRect = null; }
            if (this.invGhostText) { this.invGhostText.destroy(); this.invGhostText = null; }
            this.invDragging = null;
            this._invStats = this.stats;
            this._invContent = [];
            this._invBodyView = this._invBodyView || 'gear';
            createHideoutInvCtx(this);
            // Opaque backdrop so nothing shows behind the player window on this tab (depth 290, panel is 300)
            const backdrop = this.add.rectangle(400, 300, 800, 600, 0x0d0d0d, 1).setDepth(290);
            this._invContent.push(backdrop);
            this.renderInventoryPanel();
            return;
        }
        // Leaving CHARACTER: destroy panel, ghost, stash UI, and listeners so other tab is fully visible
        if (wasCharacter) {
            if (this._invContent && this._invContent.length) {
                this._invContent.forEach(e => e.destroy());
                this._invContent = [];
            }
            if (this.invListeners) {
                this.input.off('pointermove', this.invListeners.move);
                this.input.off('pointerdown', this.invListeners.down);
                this.input.off('pointerup', this.invListeners.up);
                if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
                if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
                if (this.invListeners.uKey) this.invListeners.uKey.off('down', this.invListeners.uKeyCallback);
                this.invListeners = null;
            }
            if (this.invGhostRect) { this.invGhostRect.destroy(); this.invGhostRect = null; }
            if (this.invGhostText) { this.invGhostText.destroy(); this.invGhostText = null; }
            this.invDragging = null;
            this._stashSelected = null;
            this.stashDragging = null;
            this.lastBackpackListWeaponClick = null;
            this.lastStashGridWeaponClick = null;
            this._hideoutStashBounds = null;
            this._hideoutContainerBounds = null;
            this.addItemToStash = null;
            this.addStashItemToContainer = null;
            this.addStashItemToNestedBackpack = null;
            this.addEquippedRigToStash = null;
            this.addEquippedBackpackToStash = null;
            this.addEquippedArmorToStash = null;
            this.addEquippedSecureContainerToStash = null;
            this.addEquippedMedBagToStash = null;
            this.equipStashItemToSlot = null;
            this.equipStashItemToWeaponSlot = null;
            this.equipStashMagToWeaponSlot = null;
            this.equipStashModToWeaponSlot = null;
            this.injectIntoStash = null;
            this._rerenderCharacterTab = null;
            if (this.stashCleanup) { this.stashCleanup(); this.stashCleanup = null; }
        }
        if (this.stashCleanup) { this.stashCleanup(); this.stashCleanup = null; }
        this.tabContent.forEach(el => el.destroy());
        this.tabContent = [];
        
        switch(tabId) {
            case 'facilities':
                this.renderFacilitiesTab();
                break;
            case 'shop':
                this.renderShopTab();
                break;
            case 'extras':
                this.renderExtrasTab();
                break;
        }
    }
    
    renderFacilitiesTab() {
        const startY = 115;
        const cardWidth = 230;
        const cardHeight = 140;
        const cardSpacing = 15;
        const startX = 25;
        
        // Row 1: REST AREA, GENERATOR, GUN BENCH
        this.createFacilityCard(startX, startY, cardWidth, cardHeight, "REST AREA", '#ffff00',
            () => `LVL: ${this.stats.hideout.restAreaLvl}\n${this.getRestEffect()}`,
            () => {
                const cost = (this.stats.hideout.restAreaLvl + 1) * 5;
                if ((this.persistent.scrap || 0) >= cost) {
                    this.persistent.scrap = (this.persistent.scrap || 0) - cost;
                    this.stats.hideout.restAreaLvl++;
                    if (this.stats.hideout.restAreaLvl > 0) this.stats.hp = this.stats.maxHp;
                    if (this.stats.hideout.restAreaLvl > 1) this.stats.maxHp += 2;
                    this.updateResourceText();
                    savePersistent(this.persistent);
                    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                    return true;
                }
                return false;
            },
            () => `UPGRADE (${(this.stats.hideout.restAreaLvl + 1) * 5} SCRAP)`
        );
        
        this.createFacilityCard(startX + cardWidth + cardSpacing, startY, cardWidth, cardHeight, "GENERATOR", '#00ff00',
            () => {
                if (this.stats.hideout.generatorLvl === 0) return "Offline\nNeed: Spark Plug + 10 Scrap";
                return "Online\nAuto-Flashlight";
            },
            () => {
                if (this.stats.hideout.generatorLvl === 0) {
                    const stash = this.persistent.stash;
                    const hasPlug = this.stats.hideout.hasSparkPlug || (stash && countItemInGrid(stash, 'plug') > 0);
                    if ((this.persistent.scrap || 0) >= 10 && hasPlug) {
                        this.persistent.scrap = (this.persistent.scrap || 0) - 10;
                        this.stats.hideout.generatorLvl = 1;
                        if (this.stats.hideout.hasSparkPlug) {
                            this.stats.hideout.hasSparkPlug = false;
                        } else if (stash) {
                            removeItemFromGrid(stash, 'plug', 1);
                        }
                        if (stash) {
                            ensureGridItems(stash);
                            tryAddItem(stash, 'flashlight', 1);
                        }
                        this.updateResourceText();
                        savePersistent(this.persistent);
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                        return true;
                    }
                }
                return false;
            },
            () => this.stats.hideout.generatorLvl === 0 ? "BUILD" : "MAX LEVEL"
        );
        
        this.createGunBenchFacilityCard(startX + (cardWidth + cardSpacing) * 2, startY, cardWidth, cardHeight);
        
        // Row 2: WORKBENCH, REPAIR STATION, TINKER BENCH
        const row2Y = startY + cardHeight + cardSpacing;
        this.createWorkbenchFacilityCard(startX, row2Y, cardWidth, cardHeight);
        this.createRepairFacilityCard(startX + cardWidth + cardSpacing, row2Y, cardWidth, cardHeight);
        this.createTinkerBenchFacilityCard(startX + (cardWidth + cardSpacing) * 2, row2Y, cardWidth, cardHeight);

        // Row 3: MED BAY + INSURANCE
        const row3Y = row2Y + cardHeight + cardSpacing;
        this.createMedBayFacilityCard(startX, row3Y, cardWidth, cardHeight);
        this.createInsuranceFacilityCard(startX + cardWidth + cardSpacing, row3Y, cardWidth, cardHeight);
    }

    createMedBayFacilityCard(x, y, w, h) {
        const card = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);

        const titleText = this.add.text(x + 10, y + 10, "MED BAY", { fontSize: '16px', fill: '#66ff88', fontStyle: 'bold' });
        this.tabContent.push(titleText);

        const cost = (CONFIG.HIDEOUT && CONFIG.HIDEOUT.MED_BAY_COST) || 8;
        const getDescAndBtn = () => {
            ensureLimbVisStats(this.stats);
            const inf = this.stats.infection || 0;
            const blood = Math.floor(this.stats.blood || 0);
            const maxB = this.stats.maxBlood || 100;
            const needsCure = inf > 0;
            const needsBlood = blood < maxB;
            if (!needsCure && !needsBlood) {
                return { desc: "Healthy\nBlood full", btn: "NO TREATMENT NEEDED" };
            }
            const lines = [];
            if (needsCure) lines.push(`Infected ${Math.floor(inf)}%`);
            if (needsBlood) lines.push(`Blood ${blood}/${maxB}`);
            lines.push("Cure + full transfusion");
            return { desc: lines.join('\n'), btn: `TREAT (${cost} SCRAP)` };
        };

        const { desc, btn: btnStr } = getDescAndBtn();
        const descText = this.add.text(x + 10, y + 35, desc, { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);

        const btn = this.add.rectangle(x + w / 2, y + h - 25, w - 20, 30, 0x444444).setInteractive();
        this.tabContent.push(btn);
        const btnText = this.add.text(x + w / 2, y + h - 25, btnStr, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(btnText);

        btn.on('pointerdown', () => {
            ensureLimbVisStats(this.stats);
            const needsCure = (this.stats.infection || 0) > 0;
            const needsBlood = (this.stats.blood || 0) < (this.stats.maxBlood || 100);
            if (!needsCure && !needsBlood) {
                sfx.error();
                return;
            }
            if ((this.persistent.scrap || 0) < cost) {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
                return;
            }
            this.persistent.scrap = (this.persistent.scrap || 0) - cost;
            cureInfectionOnStats(this.stats);
            this.stats.blood = this.stats.maxBlood;
            this.updateResourceText();
            savePersistent(this.persistent);
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            sfx.success();
            this.cameras.main.flash(100, 100, 255, 140);
            const next = getDescAndBtn();
            descText.setText(next.desc);
            btnText.setText(next.btn);
        });
        btn.on('pointerover', () => btn.setFillStyle(0x555555));
        btn.on('pointerout', () => btn.setFillStyle(0x444444));
    }

    createInsuranceFacilityCard(x, y, w, h) {
        const card = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);
        const titleText = this.add.text(x + 10, y + 10, "INSURANCE", { fontSize: '16px', fill: '#ffd700', fontStyle: 'bold' });
        this.tabContent.push(titleText);

        ensureInsuranceFields(this.persistent);
        const cost = (CONFIG.HIDEOUT && CONFIG.HIDEOUT.INSURANCE_COST) || 12;

        const getDescAndBtn = () => {
            ensureInsuranceFields(this.persistent);
            const now = Date.now();
            const pending = this.persistent.insuranceReturns || [];
            const ready = pending.filter(r => (r.readyAt || 0) <= now);
            const waiting = pending.filter(r => (r.readyAt || 0) > now);
            if (ready.length > 0) {
                return { desc: `${ready.length} package(s) ready\nClaim to stash`, btn: `CLAIM (${ready.length})` };
            }
            if (waiting.length > 0) {
                const soonest = waiting.reduce((a, b) => ((a.readyAt || 0) < (b.readyAt || 0) ? a : b));
                const mins = Math.max(1, Math.ceil(((soonest.readyAt || now) - now) / 60000));
                return { desc: `${waiting.length} in transit\n~${mins}m remaining`, btn: "WAITING..." };
            }
            if (this.persistent.insuranceActive) {
                return { desc: "ACTIVE this run\nLoot may return on death", btn: "INSURED" };
            }
            return { desc: "Cover mid-raid loot\nReturns after death (risky)", btn: `BUY (${cost} SCRAP)` };
        };

        const { desc, btn: btnStr } = getDescAndBtn();
        const descText = this.add.text(x + 10, y + 35, desc, { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);
        const btn = this.add.rectangle(x + w / 2, y + h - 25, w - 20, 30, 0x444444).setInteractive();
        this.tabContent.push(btn);
        const btnText = this.add.text(x + w / 2, y + h - 25, btnStr, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(btnText);

        btn.on('pointerdown', () => {
            ensureInsuranceFields(this.persistent);
            const now = Date.now();
            const pending = this.persistent.insuranceReturns || [];
            const ready = pending.filter(r => (r.readyAt || 0) <= now);

            if (ready.length > 0) {
                if (!this.persistent.stash) this.persistent.stash = getDefaultBackpack();
                ensureGridItems(this.persistent.stash);
                let claimed = 0;
                const stillWaiting = pending.filter(r => (r.readyAt || 0) > now);
                ready.forEach(row => {
                    const extra = {};
                    if (row.durability != null) extra.durability = row.durability;
                    if (row.maxDurability != null) extra.maxDurability = row.maxDurability;
                    if (row.rounds != null) extra.rounds = row.rounds;
                    if (row.maxRounds != null) extra.maxRounds = row.maxRounds;
                    const extraArg = Object.keys(extra).length ? extra : undefined;
                    if (row.fromConsumable) {
                        // Consumables return as stash grid items when possible
                        if (tryAddItem(this.persistent.stash, row.itemId, row.count || 1, extraArg)) claimed++;
                        else stillWaiting.push(row);
                    } else if (tryAddItem(this.persistent.stash, row.itemId, row.count || 1, extraArg)) {
                        claimed++;
                    } else {
                        stillWaiting.push(row);
                    }
                });
                this.persistent.insuranceReturns = stillWaiting;
                savePersistent(this.persistent);
                if (claimed > 0) {
                    sfx.success();
                    this.cameras.main.flash(100, 255, 215, 0);
                } else {
                    sfx.error();
                }
                const next = getDescAndBtn();
                descText.setText(next.desc);
                btnText.setText(next.btn);
                return;
            }

            if (pending.some(r => (r.readyAt || 0) > now)) {
                sfx.error();
                return;
            }
            if (this.persistent.insuranceActive) {
                sfx.error();
                return;
            }
            if ((this.persistent.scrap || 0) < cost) {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
                return;
            }
            this.persistent.scrap = (this.persistent.scrap || 0) - cost;
            this.persistent.insuranceActive = true;
            this.updateResourceText();
            savePersistent(this.persistent);
            sfx.success();
            this.cameras.main.flash(100, 255, 215, 0);
            const next = getDescAndBtn();
            descText.setText(next.desc);
            btnText.setText(next.btn);
        });
        btn.on('pointerover', () => btn.setFillStyle(0x555555));
        btn.on('pointerout', () => btn.setFillStyle(0x444444));
    }
    
    createFacilityCard(x, y, w, h, title, titleColor, descFn, actionFn, costFn) {
        const card = this.add.rectangle(x + w/2, y + h/2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);
        
        const titleText = this.add.text(x + 10, y + 10, title, { fontSize: '16px', fill: titleColor, fontStyle: 'bold' });
        this.tabContent.push(titleText);
        
        const descText = this.add.text(x + 10, y + 35, descFn(), { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);
        
        const btn = this.add.rectangle(x + w/2, y + h - 25, w - 20, 30, 0x444444).setInteractive();
        this.tabContent.push(btn);
        
        const btnText = this.add.text(x + w/2, y + h - 25, costFn(), { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(btnText);
        
        btn.on('pointerdown', () => {
            if (actionFn()) {
                sfx.success();
                descText.setText(descFn());
                btnText.setText(costFn());
                this.cameras.main.flash(100, 0, 255, 0);
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
                btn.setFillStyle(0x660000);
                this.time.delayedCall(200, () => btn.setFillStyle(0x444444));
            }
        });
        btn.on('pointerover', () => btn.setFillStyle(0x555555));
        btn.on('pointerout', () => btn.setFillStyle(0x444444));
    }
    
    createGunBenchFacilityCard(x, y, w, h) {
        const card = this.add.rectangle(x + w/2, y + h/2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);
        
        const titleText = this.add.text(x + 10, y + 10, "GUN BENCH", { fontSize: '16px', fill: '#ff00ff', fontStyle: 'bold' });
        this.tabContent.push(titleText);
        
        const gunBench = this.stats.hideout.gunBench;
        const level = gunBench.level || 1;
        let descStr = `LVL ${level}\nCraft ammo (1 scrap, 90s)`;
        const descText = this.add.text(x + 10, y + 35, descStr, { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);
        
        this.gunBenchTimerText = this.add.text(x + 10, y + 62, "", { fontSize: '12px', fill: '#00ff00' });
        this.tabContent.push(this.gunBenchTimerText);
        
        const cfg9 = CONFIG.HIDEOUT.GUN_BENCH_CRAFT_9MM;
        const cfgShells = CONFIG.HIDEOUT.GUN_BENCH_CRAFT_SHELLS;
        
        const updateGunBenchUI = () => {
            const job = this.stats.hideout.gunBench.crafting;
            if (job && Date.now() >= job.finishTime) {
                this.gunBenchTimerText.setText("COMPLETE!");
            } else if (job) {
                const sec = Math.ceil((job.finishTime - Date.now()) / 1000);
                this.gunBenchTimerText.setText(`CRAFTING: ${Math.floor(sec/60)}:${(sec%60).toString().padStart(2,'0')}`);
            } else {
                this.gunBenchTimerText.setText("");
            }
        };
        
        const craftBtnY = level === 2 ? y + h - 52 : y + h - 38;
        const craftBtn = this.add.rectangle(x + w/2, craftBtnY, w - 20, 24, 0x335533).setInteractive();
        this.tabContent.push(craftBtn);
        const craftBtnText = this.add.text(x + w/2, craftBtnY, "CRAFT 9MM (1 SCRAP)", { fontSize: '10px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(craftBtnText);
        
        craftBtn.on('pointerdown', () => {
            const gb = this.stats.hideout.gunBench;
            if (gb.crafting) {
                if (Date.now() >= gb.crafting.finishTime) {
                    sfx.lootAmmo();
                    tryAddItem(this.persistent.stash, gb.crafting.itemId, gb.crafting.count);
                    gb.crafting = null;
                    updateGunBenchUI();
                    savePersistent(this.persistent);
                    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                    this.cameras.main.flash(100, 0, 255, 0);
                }
                return;
            }
            if ((this.persistent.scrap || 0) < cfg9.scrap) { sfx.error(); return; }
            this.persistent.scrap = (this.persistent.scrap || 0) - cfg9.scrap;
            gb.crafting = { itemId: cfg9.itemId, count: cfg9.count, finishTime: Date.now() + cfg9.timeMs };
            this.updateResourceText();
            updateGunBenchUI();
            savePersistent(this.persistent);
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            sfx.success();
        });
        craftBtn.on('pointerover', () => craftBtn.setFillStyle(0x447744));
        craftBtn.on('pointerout', () => craftBtn.setFillStyle(0x335533));
        
        let shellsBtn, shellsBtnText, upgradeBtn, upgradeBtnText;
        if (level === 1) {
            const cost = CONFIG.HIDEOUT.GUN_BENCH_LEVEL2_COST;
            upgradeBtn = this.add.rectangle(x + w/2, y + h - 22, w - 20, 22, 0x444444).setInteractive();
            this.tabContent.push(upgradeBtn);
            upgradeBtnText = this.add.text(x + w/2, y + h - 22, `UPGRADE (${cost} SCRAP)`, { fontSize: '10px', fill: '#fff' }).setOrigin(0.5);
            this.tabContent.push(upgradeBtnText);
            upgradeBtn.on('pointerdown', () => {
                if ((this.persistent.scrap || 0) >= cost) {
                    this.persistent.scrap = (this.persistent.scrap || 0) - cost;
                    this.stats.hideout.gunBench.level = 2;
                    this.updateResourceText();
                    descText.setText("LVL 2\nCraft 9mm or shells (1 scrap, 90s)");
                    upgradeBtn.destroy();
                    upgradeBtnText.destroy();
                    const row2Y = y;
                    shellsBtn = this.add.rectangle(x + w/2, row2Y + h - 22, w - 20, 22, 0x335533).setInteractive();
                    this.tabContent.push(shellsBtn);
                    shellsBtnText = this.add.text(x + w/2, row2Y + h - 22, "CRAFT SHELLS (1 SCRAP)", { fontSize: '10px', fill: '#fff' }).setOrigin(0.5);
                    this.tabContent.push(shellsBtnText);
                    shellsBtn.on('pointerdown', () => {
                        const gb2 = this.stats.hideout.gunBench;
                        if (gb2.crafting) {
                            if (Date.now() >= gb2.crafting.finishTime) {
                                sfx.lootAmmo();
                                tryAddItem(this.persistent.stash, gb2.crafting.itemId, gb2.crafting.count);
                                gb2.crafting = null;
                                updateGunBenchUI();
                                savePersistent(this.persistent);
                                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                                this.cameras.main.flash(100, 0, 255, 0);
                            }
                            return;
                        }
                        if ((this.persistent.scrap || 0) < cfgShells.scrap) { sfx.error(); return; }
                        this.persistent.scrap = (this.persistent.scrap || 0) - cfgShells.scrap;
                        gb2.crafting = { itemId: cfgShells.itemId, count: cfgShells.count, finishTime: Date.now() + cfgShells.timeMs };
                        this.updateResourceText();
                        updateGunBenchUI();
                        savePersistent(this.persistent);
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                        sfx.success();
                    });
                    shellsBtn.on('pointerover', () => shellsBtn.setFillStyle(0x447744));
                    shellsBtn.on('pointerout', () => shellsBtn.setFillStyle(0x335533));
                    savePersistent(this.persistent);
                    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                    sfx.success();
                } else { sfx.error(); }
            });
            upgradeBtn.on('pointerover', () => upgradeBtn.setFillStyle(0x555555));
            upgradeBtn.on('pointerout', () => upgradeBtn.setFillStyle(0x444444));
        } else {
            shellsBtn = this.add.rectangle(x + w/2, y + h - 22, w - 20, 22, 0x335533).setInteractive();
            this.tabContent.push(shellsBtn);
            shellsBtnText = this.add.text(x + w/2, y + h - 22, "CRAFT SHELLS (1 SCRAP)", { fontSize: '10px', fill: '#fff' }).setOrigin(0.5);
            this.tabContent.push(shellsBtnText);
            shellsBtn.on('pointerdown', () => {
                const gb2 = this.stats.hideout.gunBench;
                if (gb2.crafting) {
                    if (Date.now() >= gb2.crafting.finishTime) {
                        sfx.lootAmmo();
                        tryAddItem(this.persistent.stash, gb2.crafting.itemId, gb2.crafting.count);
                        gb2.crafting = null;
                        updateGunBenchUI();
                        savePersistent(this.persistent);
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                        this.cameras.main.flash(100, 0, 255, 0);
                    }
                    return;
                }
                if ((this.persistent.scrap || 0) < cfgShells.scrap) { sfx.error(); return; }
                this.persistent.scrap = (this.persistent.scrap || 0) - cfgShells.scrap;
                gb2.crafting = { itemId: cfgShells.itemId, count: cfgShells.count, finishTime: Date.now() + cfgShells.timeMs };
                this.updateResourceText();
                updateGunBenchUI();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                sfx.success();
            });
            shellsBtn.on('pointerover', () => shellsBtn.setFillStyle(0x447744));
            shellsBtn.on('pointerout', () => shellsBtn.setFillStyle(0x335533));
        }
    }
    
    createTinkerBenchFacilityCard(x, y, w, h) {
        const card = this.add.rectangle(x + w/2, y + h/2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);
        
        const titleText = this.add.text(x + 10, y + 10, "TINKER BENCH", { fontSize: '16px', fill: '#00ccff', fontStyle: 'bold' });
        this.tabContent.push(titleText);
        
        const tinker = this.stats.hideout.tinkerBench;
        let descStr, btnStr;
        if (tinker.crafting) {
            if (Date.now() >= tinker.crafting.finishTime) {
                descStr = "NVG ready\nClick to claim";
                btnStr = "CLAIM NVG";
            } else {
                descStr = "Fabricating NVG...";
                btnStr = "CRAFTING...";
            }
        } else {
            descStr = "Craft NVG (item)\nCost: 3 Scrap, 90s";
            btnStr = "CRAFT NVG (3 SCRAP)";
        }
        
        const descText = this.add.text(x + 10, y + 35, descStr, { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);
        
        this.tinkerBenchTimerText = this.add.text(x + 10, y + 70, "", { fontSize: '12px', fill: '#00ff00' });
        this.tabContent.push(this.tinkerBenchTimerText);
        
        const btn = this.add.rectangle(x + w/2, y + h - 38, w - 20, 28, 0x444444).setInteractive();
        this.tinkerBenchClaimBtn = btn;
        this.tabContent.push(btn);
        this.tinkerBenchBtnText = this.add.text(x + w/2, y + h - 38, btnStr, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(this.tinkerBenchBtnText);
        
        btn.on('pointerdown', () => {
            const tb = this.stats.hideout.tinkerBench;
            if (tb.crafting && Date.now() >= tb.crafting.finishTime) {
                sfx.lootWeapon();
                if (this.persistent.stash) tryAddItem(this.persistent.stash, 'nvg', 1);
                tb.crafting = null;
                descText.setText("Craft NVG (item)\nCost: 3 Scrap, 90s");
                this.tinkerBenchBtnText.setText("CRAFT NVG (3 SCRAP)");
                this.tinkerBenchTimerText.setText("");
                btn.setInteractive();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                this.cameras.main.flash(100, 0, 255, 0);
                return;
            }
            if (tb.crafting) return;
            if ((this.persistent.scrap || 0) >= 3) {
                sfx.success();
                this.persistent.scrap = (this.persistent.scrap || 0) - 3;
                tb.crafting = { item: 'nvg', finishTime: Date.now() + CONFIG.TIMINGS.NVG_CRAFT };
                this.updateResourceText();
                descText.setText("Fabricating NVG...");
                this.tinkerBenchBtnText.setText("CRAFTING...");
                btn.disableInteractive();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
            }
        });
        btn.on('pointerover', () => btn.setFillStyle(0x555555));
        btn.on('pointerout', () => btn.setFillStyle(0x444444));
    }
    
    createWorkbenchFacilityCard(x, y, w, h) {
        const card = this.add.rectangle(x + w/2, y + h/2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);
        
        const titleText = this.add.text(x + 10, y + 10, "WORKBENCH", { fontSize: '16px', fill: '#ff8800', fontStyle: 'bold' });
        this.tabContent.push(titleText);
        
        let descStr, btnStr;
        if (this.stats.hideout.workbenchLvl === 0) {
            descStr = `Upgrade weapons\n+${CONFIG.HIDEOUT.WORKBENCH_DAMAGE_BONUS * 100}% damage`;
            btnStr = `BUILD (${CONFIG.HIDEOUT.WORKBENCH_COST} SCRAP)`;
        } else {
            descStr = `ACTIVE\n+${CONFIG.HIDEOUT.WORKBENCH_DAMAGE_BONUS * 100}% weapon damage`;
            btnStr = "UPGRADED";
        }
        
        const descText = this.add.text(x + 10, y + 35, descStr, { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);
        
        const btn = this.add.rectangle(x + w/2, y + h - 25, w - 20, 30, 0x444444).setInteractive();
        this.tabContent.push(btn);
        
        const btnText = this.add.text(x + w/2, y + h - 25, btnStr, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(btnText);
        
        btn.on('pointerdown', () => {
            if (this.stats.hideout.workbenchLvl === 0 && (this.persistent.scrap || 0) >= CONFIG.HIDEOUT.WORKBENCH_COST) {
                sfx.success();
                this.persistent.scrap = (this.persistent.scrap || 0) - CONFIG.HIDEOUT.WORKBENCH_COST;
                this.stats.hideout.workbenchLvl = 1;
                this.updateResourceText();
                savePersistent(this.persistent);
                descText.setText(`ACTIVE\n+${CONFIG.HIDEOUT.WORKBENCH_DAMAGE_BONUS * 100}% weapon damage`);
                btnText.setText("UPGRADED");
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                this.cameras.main.flash(100, 255, 136, 0);
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
            }
        });
        btn.on('pointerover', () => btn.setFillStyle(0x555555));
        btn.on('pointerout', () => btn.setFillStyle(0x444444));
    }
    
    createRepairFacilityCard(x, y, w, h) {
        const card = this.add.rectangle(x + w/2, y + h/2, w, h, 0x2a2a2a).setStrokeStyle(2, 0x444444);
        this.tabContent.push(card);
        
        const titleText = this.add.text(x + 10, y + 10, "REPAIR STATION", { fontSize: '16px', fill: '#00aaff', fontStyle: 'bold' });
        this.tabContent.push(titleText);
        
        const getDescAndBtn = () => {
            if (this.stats.hideout.repairStationLvl === 0) {
                return { desc: "Repair damaged armor", btn: `BUILD (${CONFIG.HIDEOUT.REPAIR_STATION_COST} SCRAP)` };
            }
            // Check if any armor needs repair
            const slots = ['head', 'body', 'arms', 'feet'];
            let needsRepair = false;
            for (const slot of slots) {
                const armor = this.stats.armor[slot];
                if (armor && armor.durability < armor.maxDurability) {
                    needsRepair = true;
                    break;
                }
            }
            return { 
                desc: needsRepair ? "Some armor damaged" : "All armor at full durability", 
                btn: needsRepair ? "REPAIR ARMOR" : "NO REPAIRS NEEDED" 
            };
        };
        
        const { desc, btn: btnStr } = getDescAndBtn();
        
        const descText = this.add.text(x + 10, y + 35, desc, { fontSize: '13px', fill: '#aaa', lineSpacing: 4 });
        this.tabContent.push(descText);
        
        const btn = this.add.rectangle(x + w/2, y + h - 25, w - 20, 30, 0x444444).setInteractive();
        this.tabContent.push(btn);
        
        const btnText = this.add.text(x + w/2, y + h - 25, btnStr, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        this.tabContent.push(btnText);
        
        btn.on('pointerdown', () => {
            if (this.stats.hideout.repairStationLvl === 0 && (this.persistent.scrap || 0) >= CONFIG.HIDEOUT.REPAIR_STATION_COST) {
                sfx.success();
                this.persistent.scrap = (this.persistent.scrap || 0) - CONFIG.HIDEOUT.REPAIR_STATION_COST;
                this.stats.hideout.repairStationLvl = 1;
                this.updateResourceText();
                savePersistent(this.persistent);
                const { desc: newDesc, btn: newBtn } = getDescAndBtn();
                descText.setText(newDesc);
                btnText.setText(newBtn);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                this.cameras.main.flash(100, 0, 170, 255);
            } else if (this.stats.hideout.repairStationLvl > 0) {
                this.repairArmor();
                const { desc: newDesc, btn: newBtn } = getDescAndBtn();
                descText.setText(newDesc);
                btnText.setText(newBtn);
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
            }
        });
        btn.on('pointerover', () => btn.setFillStyle(0x555555));
        btn.on('pointerout', () => btn.setFillStyle(0x444444));
    }
    
    renderExtrasTab() {
        const startY = 115;
        const btnWidth = 230;
        const btnHeight = 60;
        const spacing = 15;
        const startX = 25;
        
        // Row 1: CLASS, SKILLS, UPGRADES
        this.createCharacterButton(startX, startY, btnWidth, btnHeight, "CLASS", '#00aaaa',
            () => {
                const classConfig = CONFIG.CLASSES[this.persistent.selectedClass.toUpperCase()] || CONFIG.CLASSES.SURVIVOR;
                return classConfig.name;
            },
            () => { sfx.menuOpen(); this.showClassModal(); }
        );
        
        const skillPts = this.persistent.skillPoints || 0;
        this.createCharacterButton(startX + btnWidth + spacing, startY, btnWidth, btnHeight, 
            `SKILLS${skillPts > 0 ? ' (' + skillPts + ')' : ''}`, '#8844aa',
            () => `${Object.values(this.persistent.skills || {}).filter(v => v > 0).length} unlocked`,
            () => { sfx.menuOpen(); this.showSkillsPanel(); }
        );
        
        this.createCharacterButton(startX + (btnWidth + spacing) * 2, startY, btnWidth, btnHeight, "UPGRADES", '#886600',
            () => `${this.persistent.permanentUpgrades?.length || 0} purchased`,
            () => { sfx.menuOpen(); this.showUpgradesPanel(); }
        );
        
        // Row 2: STATS, CHALLENGES (Mods panel removed — outfit weapons in-run via attachment boxes)
        const row2Y = startY + btnHeight + spacing;
        this.createCharacterButton(startX, row2Y, btnWidth, btnHeight, "STATS", '#444488',
            () => `Runs: ${this.persistent.totalRuns || 0}`,
            () => { sfx.menuOpen(); this.showStatsPanel(); }
        );
        
        const unclaimed = this.countUnclaimedChallenges();
        this.createCharacterButton(startX + btnWidth + spacing, row2Y, btnWidth, btnHeight, 
            `CHALLENGES${unclaimed > 0 ? ' (' + unclaimed + ')' : ''}`, '#448844',
            () => unclaimed > 0 ? `${unclaimed} rewards ready!` : 'Daily & Weekly tasks',
            () => { sfx.menuOpen(); this.showChallengesPanel(); }
        );
    }
    
    createCharacterButton(x, y, w, h, title, color, subtitleFn, onClick) {
        const btn = this.add.rectangle(x + w/2, y + h/2, w, h, 0x2a2a2a)
            .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(color).color)
            .setInteractive();
        this.tabContent.push(btn);
        
        const titleText = this.add.text(x + w/2, y + h/2 - 10, title, { 
            fontSize: '16px', fill: color, fontStyle: 'bold' 
        }).setOrigin(0.5);
        this.tabContent.push(titleText);
        
        const subtitle = this.add.text(x + w/2, y + h/2 + 12, subtitleFn(), { 
            fontSize: '12px', fill: '#888' 
        }).setOrigin(0.5);
        this.tabContent.push(subtitle);
        
        btn.on('pointerdown', onClick);
        btn.on('pointerover', () => btn.setFillStyle(0x3a3a3a));
        btn.on('pointerout', () => btn.setFillStyle(0x2a2a2a));
    }
    
    renderShopTab() {
        const centerX = 400;
        const centerY = 280;
        
        // Large trader button
        const traderBtn = this.add.rectangle(centerX, centerY, 400, 120, 0x3a3a0a)
            .setStrokeStyle(3, 0xffd700)
            .setInteractive();
        this.tabContent.push(traderBtn);
        
        const traderIcon = this.add.text(centerX, centerY - 20, "SHOP", { 
            fontSize: '32px', fill: '#ffd700', fontStyle: 'bold' 
        }).setOrigin(0.5);
        this.tabContent.push(traderIcon);
        
        const traderDesc = this.add.text(centerX, centerY + 20, "Buy weapons, armor, and consumables\nSell items for credits", { 
            fontSize: '14px', fill: '#ccc', align: 'center' 
        }).setOrigin(0.5);
        this.tabContent.push(traderDesc);
        
        traderBtn.on('pointerdown', () => { sfx.menuOpen(); this.showTraderModal(); });
        traderBtn.on('pointerover', () => traderBtn.setFillStyle(0x4a4a1a));
        traderBtn.on('pointerout', () => traderBtn.setFillStyle(0x3a3a0a));
        
        // Quests box below shop - opens shop modal on Quests tab
        const questsBoxY = centerY + 100;
        const questsBox = this.add.rectangle(centerX, questsBoxY, 400, 56, 0x2a3a2a)
            .setStrokeStyle(2, 0x558855)
            .setInteractive();
        this.tabContent.push(questsBox);
        const questsBoxTitle = this.add.text(centerX, questsBoxY - 8, "QUESTS", { fontSize: '18px', fill: '#88cc88', fontStyle: 'bold' }).setOrigin(0.5);
        this.tabContent.push(questsBoxTitle);
        const questsBoxDesc = this.add.text(centerX, questsBoxY + 12, "Turn in items for rewards", { fontSize: '12px', fill: '#888' }).setOrigin(0.5);
        this.tabContent.push(questsBoxDesc);
        questsBox.on('pointerdown', () => { sfx.menuOpen(); this.showTraderModal('quests'); });
        questsBox.on('pointerover', () => questsBox.setFillStyle(0x334433));
        questsBox.on('pointerout', () => questsBox.setFillStyle(0x2a3a2a));
    }
    
    /** Stash section on CHARACTER tab only: stash grid (right of player window) + move buttons + backpack list for selection. */
    renderCharacterTabStash() {
        if (!this.persistent.stash) this.persistent.stash = { gridW: 14, gridH: 24, items: [], _nextId: 1 };
        if (!this.stats.backpack) this.stats.backpack = getDefaultBackpack();
        const stash = this.persistent.stash;
        const backpack = this.stats.backpack;
        stash.gridW = 14;
        stash.gridH = 54;
        backpack.gridW = 6;
        backpack.gridH = 9;
        ensureGridItems(stash);
        ensureGridItems(backpack);
        ensurePlacementMods(stash);
        ensurePlacementMods(backpack);
        
        const needsStashRepack = (stash.items || []).some(p => (p.itemId === 'rig' && (p.sizeW === 4 || p.sizeH === 4)) || (p.itemId === 'backpack_default' && (p.sizeW === 4 || p.sizeH === 4)));
        if (needsStashRepack && stash.items && stash.items.length > 0) {
            const stashExtraFor = (item) => {
                const o = {};
                if (item.durability != null || item.maxDurability != null) { o.durability = item.durability; o.maxDurability = item.maxDurability; }
                if (item.mods && typeof item.mods === 'object') o.mods = item.mods;
                return Object.keys(o).length ? o : undefined;
            };
            const itemsCopy = stash.items.map(p => {
                const cfg = getInventoryItemConfig(p.itemId);
                const sizeW = (cfg && cfg.sizeW) != null ? cfg.sizeW : (p.sizeW || 1);
                const sizeH = (cfg && cfg.sizeH) != null ? cfg.sizeH : (p.sizeH || 1);
                return { ...p, sizeW, sizeH, oldPlacementId: p.placementId };
            });
            itemsCopy.sort((a, b) => (b.sizeW * b.sizeH) - (a.sizeW * a.sizeH));
            stash.items = [];
            const pers = this.persistent;
            itemsCopy.forEach(it => {
                const pos = findSpace(stash, it.sizeW, it.sizeH);
                if (!pos) return;
                const extra = stashExtraFor(it);
                const magExtra = (it.rounds != null || it.maxRounds != null) ? { rounds: it.rounds ?? 0, maxRounds: it.maxRounds ?? getMagazineCapacity(it.itemId) } : undefined;
                const fullExtra = magExtra ? Object.assign({}, extra, magExtra) : extra;
                const newPlacementId = placeItem(stash, it.itemId, it.count || 1, pos.row, pos.col, fullExtra, (it.sizeW !== 1 || it.sizeH !== 1) ? { sizeW: it.sizeW, sizeH: it.sizeH } : undefined);
                if (newPlacementId == null) return;
                if (it.itemId === 'backpack_default' && it.oldPlacementId && pers.backpackInventories && pers.backpackInventories['stash_' + it.oldPlacementId]) {
                    pers.backpackInventories['stash_' + newPlacementId] = pers.backpackInventories['stash_' + it.oldPlacementId];
                    delete pers.backpackInventories['stash_' + it.oldPlacementId];
                }
                if (it.itemId === 'rig' && it.oldPlacementId && pers.rigInventories && pers.rigInventories['stash_' + it.oldPlacementId]) {
                    pers.rigInventories['stash_' + newPlacementId] = pers.rigInventories['stash_' + it.oldPlacementId];
                    delete pers.rigInventories['stash_' + it.oldPlacementId];
                }
                if (it.itemId === 'ammo_box' && it.oldPlacementId && pers.ammoBoxInventories && pers.ammoBoxInventories['stash_' + it.oldPlacementId]) {
                    pers.ammoBoxInventories['stash_' + newPlacementId] = pers.ammoBoxInventories['stash_' + it.oldPlacementId];
                    delete pers.ammoBoxInventories['stash_' + it.oldPlacementId];
                }
            });
            savePersistent(this.persistent);
        }
        
        if (this.stashCleanup) { this.stashCleanup(); this.stashCleanup = null; }
        this._stashSelected = this._stashSelected || null;
        if (this._stashScrollOffset === undefined) this._stashScrollOffset = 0;
        
        const STASH_DEPTH = 295;
        const cellSize = 18;
        const gap = 1;
        const step = cellSize + gap;
        const invPanelLeft = 22;
        const invPanelW = 479;
        const stashMargin = 14;
        const stashCols = 14;
        const totalStashRows = stash.gridH || 54;
        const visibleStashRows = 21;
        const scrollOffset = Math.max(0, Math.min(this._stashScrollOffset, totalStashRows - visibleStashRows));
        this._stashScrollOffset = scrollOffset;
        
        const stashX = invPanelLeft + invPanelW + stashMargin;
        const invPanelTop = 65;
        const stashY = invPanelTop;
        
        const content = this._invContent;
        const itemZones = [];
        const backpackItemZones = [];
        
        function addItemZone(x0, y0, visRow, p, isStash) {
            const cfg = getInventoryItemConfig(p.itemId);
            const sw = (cfg && cfg.sizeW) != null ? cfg.sizeW : (p.sizeW || 1);
            const sh = (cfg && cfg.sizeH) != null ? cfg.sizeH : (p.sizeH || 1);
            const hw = sw * step;
            const hh = sh * step;
            const cx = x0 + p.col * step + hw / 2;
            const cy = y0 + visRow * step + hh / 2;
            const zone = {
                left: cx - hw / 2, right: cx + hw / 2, top: cy - hh / 2, bottom: cy + hh / 2,
                placementId: p.placementId, fromStash: isStash, itemId: p.itemId, count: p.count || 1,
                sizeW: sw, sizeH: sh, row: p.row, col: p.col
            };
            if (p.durability != null) zone.durability = p.durability;
            if (p.maxDurability != null) zone.maxDurability = p.maxDurability;
            itemZones.push(zone);
        }
        
        const stashExtra = (item) => {
            const o = {};
            if (item.durability != null || item.maxDurability != null) { o.durability = item.durability; o.maxDurability = item.maxDurability; }
            if (item.mods && typeof item.mods === 'object') o.mods = item.mods;
            if (item.rounds != null || item.maxRounds != null || (item.itemId && isMagazineItem(item.itemId)))
                { o.rounds = item.rounds ?? 0; o.maxRounds = item.maxRounds ?? getMagazineCapacity(item.itemId); }
            return Object.keys(o).length ? o : undefined;
        };
        
        // Resource line just under stash (Scrap | Credits | Mat)
        const stashGridBottomY = stashY + visibleStashRows * step;
        this._stashResourceText = this.add.text(stashX + (stashCols * step) / 2, stashGridBottomY - 2 * step + 77, `SCRAP: ${this.persistent.scrap || 0}  |  CREDITS: ${this.persistent.credits || 0}  |  MAT: ${this.persistent.materials || 0}`, { fontSize: '11px', fill: '#ffaa00', fontStyle: 'bold' }).setOrigin(0.5).setDepth(STASH_DEPTH);
        content.push(this._stashResourceText);
        
        const occupied = new Set();
        (stash.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const sw = (cfg && cfg.sizeW) != null ? cfg.sizeW : (p.sizeW || 1);
            const sh = (cfg && cfg.sizeH) != null ? cfg.sizeH : (p.sizeH || 1);
            for (let r = 0; r < sh; r++)
                for (let c = 0; c < sw; c++) occupied.add(`${p.row + r},${p.col + c}`);
        });
        
        const stashViewportContainer = this.add.container(0, 0).setDepth(STASH_DEPTH);
        for (let visRow = 0; visRow < visibleStashRows; visRow++) {
            const row = scrollOffset + visRow;
            for (let col = 0; col < stashCols; col++) {
                const x = stashX + col * step;
                const y = stashY + visRow * step;
                const isOcc = occupied.has(`${row},${col}`);
                const r = this.add.rectangle(x + cellSize / 2, y + cellSize / 2, cellSize, cellSize, isOcc ? 0x334433 : 0x222222).setStrokeStyle(1, 0x444444).setDepth(STASH_DEPTH);
                stashViewportContainer.add(r);
            }
        }
        const stashItemFallbackColor = (itemId) => {
            if (itemId === 'ammo_box') return 0xcc6600;
            if (itemId === 'rig') return 0x888888;
            if (itemId === 'backpack_default') return 0x556655;
            if (itemId === 'secure_container_default') return 0x446644;
            if (itemId === 'med_bag_default') return 0x446644;
            return 0x555555;
        };
        (stash.items || []).forEach(p => {
            if (p.col >= stashCols || p.row >= totalStashRows) return;
            const visRow = p.row - scrollOffset;
            if (visRow < 0 || visRow >= visibleStashRows) return;
            const cfg = getInventoryItemConfig(p.itemId);
            const iw = (cfg && cfg.sizeW) != null ? cfg.sizeW : (p.sizeW || 1);
            const ih = (cfg && cfg.sizeH) != null ? cfg.sizeH : (p.sizeH || 1);
            const bw = iw * step, bh = ih * step;
            const cx = stashX + p.col * step + bw / 2, cy = stashY + visRow * step + bh / 2;
            const cellColor = (cfg && cfg.color) ? parseInt(cfg.color.slice(1), 16) : stashItemFallbackColor(p.itemId);
            const fillColor = (cfg && cfg.color) ? cfg.color : '#e0e0e0';
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId === 'ammo_box' ? 'AMMO' : (p.itemId === 'rig' ? 'RIG' : (p.itemId === 'backpack_default' ? 'Bp' : (p.itemId || '?').slice(0, 2).toUpperCase())));
            const roundsPart = getMagazineRoundsLabel(p);
            const basePart = p.count > 1 ? lbl + p.count : lbl;
            stashViewportContainer.add(this.add.rectangle(cx, cy, bw, bh, cellColor).setStrokeStyle(2, 0x888888).setDepth(STASH_DEPTH));
            stashViewportContainer.add(this.add.text(cx, cy, basePart + roundsPart, { fontSize: '8px', fill: fillColor, fontStyle: 'bold' }).setOrigin(0.5).setDepth(STASH_DEPTH));
            addItemZone(stashX, stashY, visRow, p, true);
        });
        
        // Empty cell zones: exact step×step hit areas for visible rows only (no extra padding). Used for 1:1 drop targeting.
        const emptyCellZones = [];
        for (let visRow = 0; visRow < visibleStashRows; visRow++) {
            const row = scrollOffset + visRow;
            for (let col = 0; col < stashCols; col++) {
                if (!occupied.has(`${row},${col}`)) {
                    emptyCellZones.push({
                        left: stashX + col * step, right: stashX + (col + 1) * step,
                        top: stashY + visRow * step, bottom: stashY + (visRow + 1) * step,
                        grid: stash, row, col, fromStash: true
                    });
                }
            }
        }
        
        const stashViewportBounds = { left: stashX, right: stashX + stashCols * step, top: stashY, bottom: stashGridBottomY };
        const stashGridBounds = { left: stashX, right: stashX + stashCols * step, top: stashY, bottom: stashY + totalStashRows * step };
        // Stash view cutoff: grid + items live in a container; a GeometryMask clips to the visible viewport rect so content outside is not drawn.
        const stashViewportMask = this.add.graphics();
        stashViewportMask.setVisible(false);
        stashViewportMask.fillStyle(0xffffff, 1);
        stashViewportMask.fillRect(stashX, stashY, stashCols * step, visibleStashRows * step);
        stashViewportContainer.setMask(stashViewportMask.createGeometryMask());
        content.push(stashViewportContainer);
        content.push(stashViewportMask);
        const invGridX = 335;
        const invGridY = 220;
        const panelStep = 21;
        const backpackBounds = { left: invGridX, right: invGridX + 6 * panelStep, top: invGridY, bottom: invGridY + 9 * panelStep };
        
        const btnBarY = stashGridBottomY - 2 * step + 54;
        const btnW = 110;
        const btnH = 26;
        const btnMoveAll = { left: stashX, right: stashX + btnW, top: btnBarY - btnH / 2, bottom: btnBarY + btnH / 2 };
        
        const moveAllBtn = this.add.rectangle(stashX + btnW / 2, btnBarY, btnW, btnH, 0x334422).setDepth(STASH_DEPTH).setInteractive();
        const moveAllTxt = this.add.text(stashX + btnW / 2, btnBarY, 'Empty Backpack', { fontSize: '10px', fill: '#ccc' }).setOrigin(0.5).setDepth(STASH_DEPTH + 1);
        content.push(moveAllBtn, moveAllTxt);
        
        const hintY = btnBarY + 28;
        
        const tooltipBg = this.add.rectangle(stashX + (stashCols * step) / 2, hintY + 28, 200, 32, 0x1a1a1a, 0.98).setStrokeStyle(2, 0x888888).setVisible(false).setDepth(STASH_DEPTH + 10);
        const tooltipText = this.add.text(stashX + (stashCols * step) / 2, hintY + 28, '', { fontSize: '12px', fill: '#eee' }).setOrigin(0.5).setVisible(false).setDepth(STASH_DEPTH + 11);
        content.push(tooltipBg, tooltipText);
        
        this.ammoBoxWindowOpen = null;
        this.rigWindowOpen = null;
        let lastAmmoBoxClick = null;
        let lastRigClick = null;
        let lastBackpackStashClick = null;
        let pendingStashContainerDrag = null;
        let ghostRect = null;
        let ghostText = null;
        
        const inZone = (px, py, z) => px >= z.left && px <= z.right && py >= z.top && py <= z.bottom;
        const getWorld = (ptr) => {
            if (ptr.worldX != null) return { x: ptr.worldX, y: ptr.worldY };
            const p = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            return { x: p.x, y: p.y };
        };
        
        const rerenderCharacterTab = () => {
            if (this.stashCleanup) this.stashCleanup();
            this.stashCleanup = null;
            if (this.invListeners) {
                this.input.off('pointermove', this.invListeners.move);
                this.input.off('pointerdown', this.invListeners.down);
                this.input.off('pointerup', this.invListeners.up);
                if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
                if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
                if (this.invListeners.uKey) this.invListeners.uKey.off('down', this.invListeners.uKeyCallback);
                this.invListeners = null;
            }
            if (this._invContent && this._invContent.length) {
                this._invContent.forEach(e => e.destroy());
                this._invContent = [];
            }
            createHideoutInvCtx(this);
            const backdrop = this.add.rectangle(400, 300, 800, 600, 0x0d0d0d, 1).setDepth(290);
            this._invContent.push(backdrop);
            this.renderInventoryPanel();
        };
        
        if (totalStashRows > visibleStashRows) {
            const scrollBtnH = 24;
            const scrollUpY = stashY + visibleStashRows * step / 2 - scrollBtnH - 2;
            const scrollDownY = stashY + visibleStashRows * step / 2 + 2;
            const scrollBtnX = stashX + stashCols * step + 12;
            const scrollUpBtn = this.add.rectangle(scrollBtnX, scrollUpY, 20, scrollBtnH, 0x444444).setDepth(STASH_DEPTH).setInteractive();
            const scrollUpTxt = this.add.text(scrollBtnX, scrollUpY, '▲', { fontSize: '12px', fill: '#ccc' }).setOrigin(0.5).setDepth(STASH_DEPTH + 1);
            const scrollDownBtn = this.add.rectangle(scrollBtnX, scrollDownY, 20, scrollBtnH, 0x444444).setDepth(STASH_DEPTH).setInteractive();
            const scrollDownTxt = this.add.text(scrollBtnX, scrollDownY, '▼', { fontSize: '12px', fill: '#ccc' }).setOrigin(0.5).setDepth(STASH_DEPTH + 1);
            content.push(scrollUpBtn, scrollUpTxt, scrollDownBtn, scrollDownTxt);
            scrollUpBtn.on('pointerdown', () => { this._stashScrollOffset = 0; rerenderCharacterTab(); });
            scrollDownBtn.on('pointerdown', () => { this._stashScrollOffset = Math.max(0, totalStashRows - visibleStashRows); rerenderCharacterTab(); });
        }
        
        this._hideoutStashBounds = stashViewportBounds;
        this._rerenderCharacterTab = rerenderCharacterTab;
        /** Add an item (already removed from panel container) to stash. sourceInfo: { container: 'backpack'|'rig'|'secureContainer'|'medBag'|'pocket', placementId }. */
        this.addItemToStash = (item, sourceInfo) => {
            if (!item) return;
            const srcKey = sourceInfo && sourceInfo.placementId != null ? (sourceInfo.container + '_' + sourceInfo.placementId) : null;
            let added = false;
            if (item.itemId === 'ammo_box' && srcKey) {
                const srcInvMap = this.stats.ammoBoxInventories;
                const pos = findSpace(this.persistent.stash, item.sizeW || 1, item.sizeH || 1);
                if (pos) {
                    const newPlacementId = placeItem(this.persistent.stash, item.itemId, item.count || 1, pos.row, pos.col, stashExtra(item));
                    if (newPlacementId != null) {
                        if (!this.persistent.ammoBoxInventories) this.persistent.ammoBoxInventories = {};
                        const destKey = 'stash_' + newPlacementId;
                        if (srcInvMap && srcInvMap[srcKey]) {
                            this.persistent.ammoBoxInventories[destKey] = srcInvMap[srcKey];
                            delete srcInvMap[srcKey];
                        }
                        added = true;
                    }
                }
            } else if (item.itemId === 'rig' && srcKey) {
                const srcInvMap = this.stats.rigInventories;
                const pos = findSpace(this.persistent.stash, item.sizeW || 1, item.sizeH || 1);
                if (pos) {
                    const newPlacementId = placeItem(this.persistent.stash, item.itemId, item.count || 1, pos.row, pos.col, stashExtra(item));
                    if (newPlacementId != null) {
                        if (!this.persistent.rigInventories) this.persistent.rigInventories = {};
                        const destKey = 'stash_' + newPlacementId;
                        if (srcInvMap && srcInvMap[srcKey]) {
                            this.persistent.rigInventories[destKey] = srcInvMap[srcKey];
                            delete srcInvMap[srcKey];
                        }
                        added = true;
                    }
                }
            }
            if (!added && tryAddItem(this.persistent.stash, item.itemId, item.count, stashExtra(item))) added = true;
            if (added) {
                sfx.click();
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                savePersistent(this.persistent);
                this.scheduleRerenderCharacterTab();
            }
            return added;
        };
        /** Move equipped rig (and its grid) to stash. Call when user drops rig slot onto stash. */
        this.addEquippedRigToStash = () => {
            const stats = this._invStats != null ? this._invStats : this.stats;
            if (!stats || !stats.armor || !stats.armor.rig) return;
            const pos = findSpace(this.persistent.stash, 3, 2);
            if (!pos) return;
            const newPlacementId = placeItem(this.persistent.stash, 'rig', 1, pos.row, pos.col, undefined, { sizeW: 3, sizeH: 2 });
            if (newPlacementId == null) return;
            if (!this.persistent.rigInventories) this.persistent.rigInventories = {};
            this.persistent.rigInventories['stash_' + newPlacementId] = stats.rigGrid ? JSON.parse(JSON.stringify(stats.rigGrid)) : getOrCreateRigInventory(this.persistent.rigInventories, 'stash_' + newPlacementId);
            stats.armor.rig = null;
            stats.rigGrid = null;
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Move equipped armor (head/body/ears/nvg) to stash. slotId: 'head'|'body'|'ears'|'nvg'. */
        this.addEquippedArmorToStash = (slotId) => {
            const ARMOR_SLOT_ITEM = { head: 'helmet', body: 'vest', ears: 'headset', rig: 'rig', nvg: 'nvg' };
            const armor = this.stats.armor && this.stats.armor[slotId];
            if (!armor) return;
            const itemId = (slotId === 'head' && armor.itemId) ? armor.itemId : (slotId === 'ears' && armor.itemId) ? armor.itemId : (slotId === 'nvg' && armor.itemId) ? armor.itemId : (ARMOR_SLOT_ITEM[slotId] || armor.itemId);
            const extra = (armor.durability != null || armor.maxDurability != null) ? { durability: armor.durability, maxDurability: armor.maxDurability } : undefined;
            if (tryAddItem(this.persistent.stash, itemId, 1, extra)) {
                this.stats.armor[slotId] = null;
                sfx.click();
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                savePersistent(this.persistent);
                this.scheduleRerenderCharacterTab();
            }
        };
        /** Move equipped backpack (and its grid) to stash. Call when user drops backpack slot onto stash. */
        this.addEquippedBackpackToStash = () => {
            if (!this.stats.equippedBackpack || this.stats.equippedBackpack.placementId !== 'equipped') return;
            const pos = findSpace(this.persistent.stash, 5, 8);
            if (!pos) return;
            const newPlacementId = placeItem(this.persistent.stash, 'backpack_default', 1, pos.row, pos.col, undefined, { sizeW: 5, sizeH: 8 });
            if (newPlacementId == null) return;
            if (!this.persistent.backpackInventories) this.persistent.backpackInventories = {};
            const gridCopy = this.stats.backpackInventories && this.stats.backpackInventories['equipped'] ? JSON.parse(JSON.stringify(this.stats.backpackInventories['equipped'])) : getDefaultBackpack();
            ensureGridItems(gridCopy);
            this.persistent.backpackInventories['stash_' + newPlacementId] = gridCopy;
            this.stats.equippedBackpack = null;
            this.stats.backpack = getDefaultBackpack();
            ensureGridItems(this.stats.backpack);
            this.stats.backpack.gridW = 6;
            this.stats.backpack.gridH = 9;
            if (!this.stats.backpackInventories) this.stats.backpackInventories = {};
            this.stats.backpackInventories['equipped'] = this.stats.backpack;
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Move equipped secure container (and its grid) to stash. */
        this.addEquippedSecureContainerToStash = () => {
            if (!this.stats.secureContainerGrid || !Array.isArray(this.stats.secureContainerGrid.items)) return;
            const pos = findSpace(this.persistent.stash, 1, 1);
            if (!pos) return;
            const newPlacementId = placeItem(this.persistent.stash, 'secure_container_default', 1, pos.row, pos.col);
            if (newPlacementId == null) return;
            if (!this.persistent.secureContainerInventories) this.persistent.secureContainerInventories = {};
            this.persistent.secureContainerInventories['stash_' + newPlacementId] = JSON.parse(JSON.stringify(this.stats.secureContainerGrid));
            ensureGridItems(this.persistent.secureContainerInventories['stash_' + newPlacementId]);
            this.stats.secureContainerGrid = null;
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Move equipped med bag (and its grid) to stash. */
        this.addEquippedMedBagToStash = () => {
            if (!this.stats.medBagGrid || !Array.isArray(this.stats.medBagGrid.items)) return;
            const pos = findSpace(this.persistent.stash, 1, 1);
            if (!pos) return;
            const newPlacementId = placeItem(this.persistent.stash, 'med_bag_default', 1, pos.row, pos.col);
            if (newPlacementId == null) return;
            if (!this.persistent.medBagInventories) this.persistent.medBagInventories = {};
            this.persistent.medBagInventories['stash_' + newPlacementId] = JSON.parse(JSON.stringify(this.stats.medBagGrid));
            ensureGridItems(this.persistent.medBagInventories['stash_' + newPlacementId]);
            this.stats.medBagGrid = null;
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Testing: inject any item into stash. itemId e.g. 'backpack_default', 'rig', 'medkit', 'secure_container_default', 'med_bag_default'. Returns true if placed. */
        this.injectIntoStash = (itemId, count) => {
            if (!itemId || !this.persistent.stash) return false;
            const c = count == null ? 1 : Math.max(1, Math.floor(count));
            const cfg = getInventoryItemConfig(itemId);
            const sizeW = (cfg && cfg.sizeW) || 1;
            const sizeH = (cfg && cfg.sizeH) || 1;
            const pos = findSpace(this.persistent.stash, sizeW, sizeH);
            if (!pos) return false;
            const newPlacementId = placeItem(this.persistent.stash, itemId, c, pos.row, pos.col, undefined, (sizeW !== 1 || sizeH !== 1) ? { sizeW, sizeH } : undefined);
            if (newPlacementId == null) return false;
            if (itemId === 'backpack_default') {
                if (!this.persistent.backpackInventories) this.persistent.backpackInventories = {};
                this.persistent.backpackInventories['stash_' + newPlacementId] = getDefaultBackpack();
                ensureGridItems(this.persistent.backpackInventories['stash_' + newPlacementId]);
            } else if (itemId === 'rig') {
                if (!this.persistent.rigInventories) this.persistent.rigInventories = {};
                this.persistent.rigInventories['stash_' + newPlacementId] = { gridW: 4, gridH: 2, items: [], _nextId: 1 };
                ensureGridItems(this.persistent.rigInventories['stash_' + newPlacementId]);
            } else if (itemId === 'secure_container_default') {
                if (!this.persistent.secureContainerInventories) this.persistent.secureContainerInventories = {};
                this.persistent.secureContainerInventories['stash_' + newPlacementId] = { gridW: 2, gridH: 3, items: [], _nextId: 1 };
                ensureGridItems(this.persistent.secureContainerInventories['stash_' + newPlacementId]);
            } else if (itemId === 'med_bag_default') {
                if (!this.persistent.medBagInventories) this.persistent.medBagInventories = {};
                this.persistent.medBagInventories['stash_' + newPlacementId] = { gridW: 2, gridH: 2, items: [], _nextId: 1 };
                ensureGridItems(this.persistent.medBagInventories['stash_' + newPlacementId]);
            }
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
            return true;
        };
        /** Equip a stash backpack or rig onto the body slot. slotId: 'backpack'|'rig'. */
        this.equipStashItemToSlot = (slotId, stashPlacementId) => {
            const st = this.persistent.stash;
            const item = removeItem(st, stashPlacementId);
            if (!item) return;
            if (slotId === 'backpack' && item.itemId === 'backpack_default') {
                const hadEquipped = this.stats.equippedBackpack && this.stats.equippedBackpack.placementId === 'equipped';
                if (hadEquipped) {
                    const oldPos = findSpace(this.persistent.stash, 5, 8);
                    if (!oldPos) {
                        st.items.push(item);
                        return;
                    }
                    const oldPlacementId = placeItem(this.persistent.stash, 'backpack_default', 1, oldPos.row, oldPos.col, undefined, { sizeW: 5, sizeH: 8 });
                    if (oldPlacementId == null) {
                        st.items.push(item);
                        return;
                    }
                    if (!this.persistent.backpackInventories) this.persistent.backpackInventories = {};
                    const oldGrid = this.stats.backpackInventories && this.stats.backpackInventories['equipped'] ? JSON.parse(JSON.stringify(this.stats.backpackInventories['equipped'])) : getDefaultBackpack();
                    ensureGridItems(oldGrid);
                    this.persistent.backpackInventories['stash_' + oldPlacementId] = oldGrid;
                }
                this.stats.equippedBackpack = { itemId: 'backpack_default', placementId: 'equipped' };
                if (!this.stats.backpackInventories) this.stats.backpackInventories = {};
                const srcKey = 'stash_' + stashPlacementId;
                if (this.persistent.backpackInventories && this.persistent.backpackInventories[srcKey]) {
                    this.stats.backpackInventories['equipped'] = JSON.parse(JSON.stringify(this.persistent.backpackInventories[srcKey]));
                    ensureGridItems(this.stats.backpackInventories['equipped']);
                    delete this.persistent.backpackInventories[srcKey];
                } else {
                    this.stats.backpackInventories['equipped'] = getDefaultBackpack();
                    ensureGridItems(this.stats.backpackInventories['equipped']);
                }
                this.stats.backpack = this.stats.backpackInventories['equipped'];
                this.stats.backpack.gridW = 6;
                this.stats.backpack.gridH = 9;
            } else if (slotId === 'rig' && item.itemId === 'rig') {
                this.stats.armor.rig = { name: 'Rig', itemId: 'rig' };
                ensureRigStats(this.stats);
                const srcKey = 'stash_' + stashPlacementId;
                if (this.persistent.rigInventories && this.persistent.rigInventories[srcKey]) {
                    this.stats.rigGrid = JSON.parse(JSON.stringify(this.persistent.rigInventories[srcKey]));
                    ensureGridItems(this.stats.rigGrid);
                    delete this.persistent.rigInventories[srcKey];
                }
            } else if ((slotId === 'head' && (item.itemId === 'helmet' || item.itemId === 'headset')) || (slotId === 'body' && item.itemId === 'vest') || (slotId === 'ears' && item.itemId === 'headset')) {
                if (!this.stats.armor) this.stats.armor = {};
                const armorDefDur = getDefaultDurability(item.itemId);
                const d = item.durability != null ? item.durability : (armorDefDur ? armorDefDur.durability : 3);
                const m = item.maxDurability != null ? item.maxDurability : (armorDefDur ? armorDefDur.maxDurability : 3);
                const oldArmor = this.stats.armor[slotId];
                const ARMOR_SLOT_ITEM = { head: 'helmet', body: 'vest', ears: 'headset', rig: 'rig' };
                if (slotId === 'head') this.stats.armor.head = { name: item.itemId === 'headset' ? 'HEADSET' : 'HELMET', durability: d, maxDurability: m, itemId: item.itemId };
                else if (slotId === 'body') this.stats.armor.body = { name: 'VEST', durability: d, maxDurability: m };
                else if (slotId === 'ears') this.stats.armor.ears = { name: 'HEADSET', durability: d, maxDurability: m, itemId: 'headset' };
                if (oldArmor && this.stats.backpack) tryAddItem(this.stats.backpack, oldArmor.itemId || ARMOR_SLOT_ITEM[slotId], 1, { durability: oldArmor.durability, maxDurability: oldArmor.maxDurability });
            } else if (slotId === 'nvg' && item.itemId === 'nvg') {
                if (!this.stats.armor) this.stats.armor = {};
                const oldNvg = this.stats.armor.nvg;
                this.stats.armor.nvg = { itemId: 'nvg', name: 'NVG' };
                if (oldNvg && this.stats.backpack) tryAddItem(this.stats.backpack, 'nvg', 1);
            } else if (slotId === 'secureContainer' && item.itemId === 'secure_container_default') {
                const srcKey = 'stash_' + stashPlacementId;
                if (this.persistent.secureContainerInventories && this.persistent.secureContainerInventories[srcKey]) {
                    this.stats.secureContainerGrid = JSON.parse(JSON.stringify(this.persistent.secureContainerInventories[srcKey]));
                    ensureGridItems(this.stats.secureContainerGrid);
                    delete this.persistent.secureContainerInventories[srcKey];
                } else {
                    this.stats.secureContainerGrid = { gridW: 2, gridH: 3, items: [], _nextId: 1 };
                    ensureGridItems(this.stats.secureContainerGrid);
                }
            } else if (slotId === 'medBag' && item.itemId === 'med_bag_default') {
                const srcKey = 'stash_' + stashPlacementId;
                if (this.persistent.medBagInventories && this.persistent.medBagInventories[srcKey]) {
                    this.stats.medBagGrid = JSON.parse(JSON.stringify(this.persistent.medBagInventories[srcKey]));
                    ensureGridItems(this.stats.medBagGrid);
                    delete this.persistent.medBagInventories[srcKey];
                } else {
                    this.stats.medBagGrid = { gridW: 2, gridH: 2, items: [], _nextId: 1 };
                    ensureGridItems(this.stats.medBagGrid);
                }
            } else {
                st.items.push(item);
                return;
            }
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Equip a weapon from stash to a weapon slot. slotId: 'primary'|'secondary'|'sidearm'|'melee'. If slot is occupied, the current weapon is moved to stash. */
        this.equipStashItemToWeaponSlot = (stashPlacementId, slotId) => {
            const st = this.persistent.stash;
            const item = removeItem(st, stashPlacementId);
            if (!item) return;
            if (!CONFIG.WEAPON_SLOTS || !CONFIG.WEAPON_SLOTS[item.itemId]) {
                st.items.push(item);
                return;
            }
            const longGunIds = ['shotgun', 'smg', 'crossbow', 'rifle'];
            const canPrimary = longGunIds.includes(item.itemId);
            const canSidearm = item.itemId === 'pistol';
            const canMelee = longGunIds.includes(item.itemId) || item.itemId === 'pistol';
            const ok = ((slotId === 'primary' || slotId === 'secondary') && canPrimary) || (slotId === 'sidearm' && canSidearm) || (slotId === 'melee' && canMelee);
            if (!ok) {
                st.items.push(item);
                return;
            }
            if (!this.stats.weaponSlots) this.stats.weaponSlots = { primary: null, secondary: null, sidearm: 'pistol', melee: null };
            ensureWeaponSlotModsShape(this.stats);
            const wsm = this.stats.weaponSlotMods;
            const oldWeapon = this.stats.weaponSlots[slotId];
            if (oldWeapon && this.addItemToStash) {
                const oldMods = wsm[slotId];
                this.stats.weaponSlots[slotId] = null;
                wsm[slotId] = null;
                const oldItem = { itemId: oldWeapon, count: 1 };
                if (oldMods && typeof oldMods === 'object') oldItem.mods = oldMods;
                this.addItemToStash(oldItem, { container: 'weaponSlot', slotId });
            }
            this.stats.weaponSlots[slotId] = item.itemId;
            const modsForWeapon = getModsForWeaponItem(item);
            wsm[slotId] = (modsForWeapon && typeof modsForWeapon === 'object') ? JSON.parse(JSON.stringify(modsForWeapon)) : createDefaultEquippedModsForWeapon(item.itemId);
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Equip a mod from stash to a weapon attachment slot. zone: { slotId?, slotName, weaponId, type, source? }. Mod must fit slot (modFitsSlot). */
        this.equipStashModToWeaponSlot = (stashPlacementId, zone) => {
            const st = this.persistent.stash;
            const item = removeItem(st, stashPlacementId);
            if (!item || !isModItem(item.itemId) || !modFitsSlot(item.itemId, zone.slotName, zone.weaponId)) {
                if (item) st.items.push(item);
                return;
            }
            const modId = item.itemId;
            let displaced = null;
            if (zone.type === 'slot' && zone.slotId) {
                ensureWeaponSlotModsShape(this.stats);
                const wsm = this.stats.weaponSlotMods;
                if (wsm && wsm[zone.slotId] && wsm[zone.slotId][zone.slotName]) {
                    displaced = { itemId: wsm[zone.slotId][zone.slotName], count: 1 };
                }
                if (!wsm[zone.slotId]) wsm[zone.slotId] = createDefaultEquippedModsForWeapon(zone.weaponId);
                wsm[zone.slotId][zone.slotName] = modId;
            } else if (zone.type === 'outfit' && zone.source) {
                const src = zone.source;
                let weaponItem = null;
                if (src.type === 'backpack' && this.stats.backpack && this.stats.backpack.items) {
                    weaponItem = this.stats.backpack.items.find(p => p.placementId === src.placementId);
                } else if (src.type === 'rig' && this.stats.rigGrid && this.stats.rigGrid.items) {
                    weaponItem = this.stats.rigGrid.items.find(p => p.placementId === src.placementId);
                } else if (src.type === 'pocket' && this.stats.pockets) {
                    const s = this.stats.pockets[src.pocketIndex] && this.stats.pockets[src.pocketIndex][src.slotIndex];
                    weaponItem = s && s.itemId ? s : null;
                } else if (src.type === 'stash' && this.persistent && this.persistent.stash && this.persistent.stash.items) {
                    weaponItem = this.persistent.stash.items.find(p => p.placementId === src.placementId);
                }
                if (weaponItem) {
                    if (!weaponItem.mods || typeof weaponItem.mods !== 'object') weaponItem.mods = createDefaultEquippedModsForWeapon(zone.weaponId);
                    if (weaponItem.mods[zone.slotName]) displaced = { itemId: weaponItem.mods[zone.slotName], count: 1 };
                    weaponItem.mods[zone.slotName] = modId;
                } else {
                    st.items.push(item);
                    return;
                }
            } else {
                st.items.push(item);
                return;
            }
            if (displaced && this.addItemToStash) this.addItemToStash(displaced, { container: 'weaponMod', weaponId: zone.weaponId, slotName: zone.slotName });
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Equip a magazine from stash to a weapon's mag slot. weaponId: 'pistol'|'smg'|'rifle'. Mag must match weapon (getMagazineWeapon(magItemId) === weaponId). */
        this.equipStashMagToWeaponSlot = (stashPlacementId, weaponId) => {
            const st = this.persistent.stash;
            const item = removeItem(st, stashPlacementId);
            if (!item) return;
            if (!isMagazineItem(item.itemId) || getMagazineWeapon(item.itemId) !== weaponId) {
                if (item) st.items.push(item);
                return;
            }
            const rounds = item.rounds ?? 0;
            const maxRounds = item.maxRounds ?? getMagazineCapacity(item.itemId);
            setEquippedMag(this.stats, weaponId, { itemId: item.itemId, rounds, maxRounds });
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            savePersistent(this.persistent);
            this.scheduleRerenderCharacterTab();
        };
        /** Move a stash item into a panel container. containerId: 'backpack'|'rig'|'secure'|'medBag'|'pockets'. pocketTarget: optional { pocketIndex, slotIndex } when containerId === 'pockets' to prefer that pocket. */
        this.addStashItemToContainer = (stashPlacementId, containerId, pocketTarget) => {
            const st = this.persistent.stash;
            const item = removeItem(st, stashPlacementId);
            if (!item) return;
            const extra = stashExtra(item);
            const magExtra = (item.rounds != null || item.maxRounds != null) ? { rounds: item.rounds ?? 0, maxRounds: item.maxRounds ?? getMagazineCapacity(item.itemId) } : undefined;
            const fullExtra = magExtra ? Object.assign({}, extra, magExtra) : extra;
            const sizeW = item.sizeW || 1, sizeH = item.sizeH || 1;
            let added = false;
            if (containerId === 'backpack' && this.stats.backpack) {
                const pos = findSpace(this.stats.backpack, sizeW, sizeH);
                if (pos) {
                    const newPlacementId = placeItem(this.stats.backpack, item.itemId, item.count || 1, pos.row, pos.col, fullExtra, (sizeW !== 1 || sizeH !== 1) ? { sizeW, sizeH } : undefined);
                    if (newPlacementId != null) {
                        if (item.itemId === 'ammo_box') { if (!this.stats.ammoBoxInventories) this.stats.ammoBoxInventories = {}; migrateSubInv(this.persistent.ammoBoxInventories, this.stats.ammoBoxInventories, 'stash_' + stashPlacementId, 'backpack_' + newPlacementId); }
                        if (item.itemId === 'rig') { if (!this.stats.rigInventories) this.stats.rigInventories = {}; migrateSubInv(this.persistent.rigInventories, this.stats.rigInventories, 'stash_' + stashPlacementId, 'backpack_' + newPlacementId); }
                        added = true;
                    }
                }
                if (!added && tryAddItem(this.stats.backpack, item.itemId, item.count, fullExtra)) added = true;
            } else if (containerId === 'rig' && this.stats.rigGrid) {
                const pos = findSpace(this.stats.rigGrid, sizeW, sizeH);
                if (pos) {
                    const newPlacementId = placeItem(this.stats.rigGrid, item.itemId, item.count || 1, pos.row, pos.col, fullExtra, (sizeW !== 1 || sizeH !== 1) ? { sizeW, sizeH } : undefined);
                    if (newPlacementId != null) {
                        if (item.itemId === 'ammo_box') { if (!this.stats.ammoBoxInventories) this.stats.ammoBoxInventories = {}; migrateSubInv(this.persistent.ammoBoxInventories, this.stats.ammoBoxInventories, 'stash_' + stashPlacementId, 'rig_' + newPlacementId); }
                        if (item.itemId === 'rig') { if (!this.stats.rigInventories) this.stats.rigInventories = {}; migrateSubInv(this.persistent.rigInventories, this.stats.rigInventories, 'stash_' + stashPlacementId, 'rig_' + newPlacementId); }
                        added = true;
                    }
                }
                if (!added && tryAddItem(this.stats.rigGrid, item.itemId, item.count, fullExtra)) added = true;
            } else if (containerId === 'secure' && this.stats.secureContainerGrid) {
                const pos = findSpace(this.stats.secureContainerGrid, sizeW, sizeH);
                if (pos) {
                    const newPlacementId = placeItem(this.stats.secureContainerGrid, item.itemId, item.count || 1, pos.row, pos.col, fullExtra, (sizeW !== 1 || sizeH !== 1) ? { sizeW, sizeH } : undefined);
                    if (newPlacementId != null) {
                        if (item.itemId === 'ammo_box') { if (!this.stats.ammoBoxInventories) this.stats.ammoBoxInventories = {}; migrateSubInv(this.persistent.ammoBoxInventories, this.stats.ammoBoxInventories, 'stash_' + stashPlacementId, 'secureContainer_' + newPlacementId); }
                        if (item.itemId === 'rig') { if (!this.stats.rigInventories) this.stats.rigInventories = {}; migrateSubInv(this.persistent.rigInventories, this.stats.rigInventories, 'stash_' + stashPlacementId, 'secureContainer_' + newPlacementId); }
                        added = true;
                    }
                }
                if (!added && tryAddItem(this.stats.secureContainerGrid, item.itemId, item.count, fullExtra)) added = true;
            } else if (containerId === 'medBag' && this.stats.medBagGrid && isMedicalItem(item.itemId)) {
                const pos = findSpace(this.stats.medBagGrid, sizeW, sizeH);
                if (pos) {
                    const newPlacementId = placeItem(this.stats.medBagGrid, item.itemId, item.count || 1, pos.row, pos.col, fullExtra, (sizeW !== 1 || sizeH !== 1) ? { sizeW, sizeH } : undefined);
                    if (newPlacementId != null) {
                        if (item.itemId === 'ammo_box') { if (!this.stats.ammoBoxInventories) this.stats.ammoBoxInventories = {}; migrateSubInv(this.persistent.ammoBoxInventories, this.stats.ammoBoxInventories, 'stash_' + stashPlacementId, 'medBag_' + newPlacementId); }
                        if (item.itemId === 'rig') { if (!this.stats.rigInventories) this.stats.rigInventories = {}; migrateSubInv(this.persistent.rigInventories, this.stats.rigInventories, 'stash_' + stashPlacementId, 'medBag_' + newPlacementId); }
                        added = true;
                    }
                }
                if (!added && tryAddItem(this.stats.medBagGrid, item.itemId, item.count, fullExtra)) added = true;
            } else if (containerId === 'pockets') {
                ensurePockets(this.stats);
                const pockets = this.stats.pockets;
                const slotEmpty = (pI, sI) => { const s = pockets[pI] && pockets[pI][sI]; return !s || !s.itemId || s._spansFrom !== undefined; };
                const slotData = (w, h) => {
                    const d = { itemId: item.itemId, count: item.count || 1, rounds: item.rounds ?? 0, maxRounds: item.maxRounds ?? getMagazineCapacity(item.itemId) };
                    if (w === 2 && h === 1) { d.sizeW = 2; d.sizeH = 1; }
                    return d;
                };
                if (pocketTarget != null && pocketTarget.pocketIndex != null && pocketTarget.slotIndex != null) {
                    const pi = pocketTarget.pocketIndex, si = pocketTarget.slotIndex;
                    if (sizeW === 1 && sizeH === 1 && slotEmpty(pi, si)) {
                        pockets[pi][si] = slotData(1, 1);
                        added = true;
                    } else if (sizeW === 2 && sizeH === 1 && pi <= 1 && si === 0 && slotEmpty(pi, 0) && slotEmpty(pi, 1)) {
                        pockets[pi][0] = slotData(2, 1);
                        pockets[pi][1] = { _spansFrom: 0 };
                        added = true;
                    }
                }
                if (!added && sizeW === 1 && sizeH === 1) {
                    for (let pi = 0; pi < pockets.length && !added; pi++) {
                        const row = pockets[pi];
                        if (!Array.isArray(row)) continue;
                        for (let si = 0; si < row.length && !added; si++) {
                            if (slotEmpty(pi, si)) {
                                pockets[pi][si] = slotData(1, 1);
                                added = true;
                            }
                        }
                    }
                }
                if (!added && sizeW === 2 && sizeH === 1) {
                    for (let pi = 0; pi <= 1 && !added; pi++) {
                        if (slotEmpty(pi, 0) && slotEmpty(pi, 1)) {
                            pockets[pi][0] = slotData(2, 1);
                            pockets[pi][1] = { _spansFrom: 0 };
                            added = true;
                        }
                    }
                }
            }
            if (added) {
                sfx.click();
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                savePersistent(this.persistent);
                this.scheduleRerenderCharacterTab();
            } else {
                st.items.push(item);
            }
        };
        /** Move a stash item into a nested backpack (one that is an item in the main backpack grid). */
        this.addStashItemToNestedBackpack = (stashPlacementId, targetBackpackPlacementId) => {
            const st = this.persistent.stash;
            const item = removeItem(st, stashPlacementId);
            if (!item) return;
            if (!this.stats.backpackInventories) this.stats.backpackInventories = {};
            let innerGrid = this.stats.backpackInventories['backpack_' + targetBackpackPlacementId];
            if (!innerGrid || !Array.isArray(innerGrid.items)) {
                innerGrid = getDefaultBackpack();
                ensureGridItems(innerGrid);
                this.stats.backpackInventories['backpack_' + targetBackpackPlacementId] = innerGrid;
            }
            innerGrid.gridW = 6;
            innerGrid.gridH = 9;
            const extra = stashExtra(item);
            const magExtra = (item.rounds != null || item.maxRounds != null) ? { rounds: item.rounds ?? 0, maxRounds: item.maxRounds ?? getMagazineCapacity(item.itemId) } : undefined;
            const fullExtra = magExtra ? Object.assign({}, extra, magExtra) : extra;
            const sizeW = item.sizeW || 1, sizeH = item.sizeH || 1;
            let added = false;
            if (tryAddItem(innerGrid, item.itemId, item.count || 1, fullExtra)) added = true;
            if (!added) {
                const pos = findSpaceTryRotated(innerGrid, sizeW, sizeH);
                if (pos) {
                    const pw = pos.rotated ? sizeH : sizeW, ph = pos.rotated ? sizeW : sizeH;
                    const newPlacementId = placeItem(innerGrid, item.itemId, item.count || 1, pos.row, pos.col, fullExtra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                    if (newPlacementId != null) {
                        if (item.itemId === 'ammo_box') { if (!this.stats.ammoBoxInventories) this.stats.ammoBoxInventories = {}; migrateSubInv(this.persistent.ammoBoxInventories, this.stats.ammoBoxInventories, 'stash_' + stashPlacementId, 'backpack_' + newPlacementId); }
                        if (item.itemId === 'rig') { if (!this.stats.rigInventories) this.stats.rigInventories = {}; migrateSubInv(this.persistent.rigInventories, this.stats.rigInventories, 'stash_' + stashPlacementId, 'backpack_' + newPlacementId); }
                        added = true;
                    }
                }
            }
            if (added) {
                sfx.click();
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                savePersistent(this.persistent);
                this.scheduleRerenderCharacterTab();
            } else {
                st.items.push(item);
            }
        };
        function migrateSubInv(persistentMap, runMap, fromKey, toKey) {
            if (!runMap) return;
            if (persistentMap && persistentMap[fromKey]) {
                runMap[toKey] = persistentMap[fromKey];
                delete persistentMap[fromKey];
            }
        }
        
        const destroyGhost = () => {
            if (ghostRect) { ghostRect.destroy(); ghostRect = null; }
            if (ghostText) { ghostText.destroy(); ghostText = null; }
        };
        
        const onPointerMove = (ptr) => {
            if (this.ammoBoxWindowOpen || this.rigWindowOpen) return;
            const w = getWorld(ptr);
            const px = w.x, py = w.y;
            if (pendingStashContainerDrag && !this.stashDragging) {
                const dx = px - pendingStashContainerDrag.startX, dy = py - pendingStashContainerDrag.startY;
                if (dx * dx + dy * dy > 25) {
                    const p = pendingStashContainerDrag;
                    const overItem = itemZones.find(z => z.placementId === p.placementId && z.fromStash === p.fromStash);
                    const itemCenterX = overItem ? (overItem.left + overItem.right) / 2 : px;
                    const itemCenterY = overItem ? (overItem.top + overItem.bottom) / 2 : py;
                    const grabOffsetX = px - itemCenterX, grabOffsetY = py - itemCenterY;
                    sfx.click();
                    this._stashSelected = { placementId: p.placementId, fromStash: p.fromStash };
                    this.stashDragging = { placementId: p.placementId, fromStash: p.fromStash, itemId: p.itemId, count: p.count || 1, sizeW: p.sizeW || 1, sizeH: p.sizeH || 1, grabOffsetX, grabOffsetY };
                    const cfg = getInventoryItemConfig(p.itemId);
                    const name = (cfg && cfg.label) ? cfg.label : (p.itemId || '?').replace(/_/g, ' ');
                    const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
                    const gw = (p.sizeW || 1) * step, gh = (p.sizeH || 1) * step;
                    const ghostX = px - grabOffsetX, ghostY = py - grabOffsetY;
                    ghostRect = this.add.rectangle(ghostX, ghostY, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(STASH_DEPTH + 5);
                    ghostText = this.add.text(ghostX, ghostY, (p.count > 1 ? lbl + p.count : lbl), { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(STASH_DEPTH + 6);
                    content.push(ghostRect, ghostText);
                    pendingStashContainerDrag = null;
                }
            }
            if (this.stashDragging && ghostRect) {
                const dx = this.stashDragging.grabOffsetX != null ? this.stashDragging.grabOffsetX : 0;
                const dy = this.stashDragging.grabOffsetY != null ? this.stashDragging.grabOffsetY : 0;
                ghostRect.setPosition(px - dx, py - dy);
                ghostText.setPosition(px - dx, py - dy);
            }
            const over = itemZones.find(z => inZone(px, py, z)) || backpackItemZones.find(z => inZone(px, py, z));
            if (over) {
                const cfg = getInventoryItemConfig(over.itemId);
                const name = (cfg && cfg.label) ? cfg.label : (over.itemId || 'Unknown').replace(/_/g, ' ');
                let txt = over.count > 1 ? name + ' (×' + over.count + ')' : name;
                if (over.durability != null || over.maxDurability != null) {
                    const overDefDur = getDefaultDurability(over.itemId);
                    if (overDefDur) {
                        const d = over.durability != null ? over.durability : overDefDur.durability;
                        const m = over.maxDurability != null ? over.maxDurability : overDefDur.maxDurability;
                        txt += '  ' + d + '/' + m;
                    }
                }
                // Stash hover: zones don't carry rounds/maxRounds — look up placement so mag tooltip shows "X/Y rounds" (stash grid or backpack list).
                if (isMagazineItem(over.itemId)) {
                    let r = 0, max = getMagazineCapacity(over.itemId);
                    if (over.fromStash && stash && stash.items) {
                        const pl = stash.items.find(i => i.placementId === over.placementId);
                        if (pl) { r = pl.rounds ?? 0; max = pl.maxRounds ?? max; }
                    } else if (!over.fromStash && backpack && backpack.items) {
                        const pl = backpack.items.find(i => i.placementId === over.placementId);
                        if (pl) { r = pl.rounds ?? 0; max = pl.maxRounds ?? max; }
                    }
                    txt += '  ' + r + '/' + max + ' rounds';
                }
                tooltipText.setText(txt);
                const tooltipY = py - 28;
                tooltipBg.setPosition(px, tooltipY);
                tooltipText.setPosition(px, tooltipY);
                tooltipBg.setVisible(true);
                tooltipText.setVisible(true);
            } else {
                tooltipBg.setVisible(false);
                tooltipText.setVisible(false);
            }
        };
        
        const onPointerDown = (ptr) => {
            if (this.ammoBoxWindowOpen || this.rigWindowOpen) return;
            const w = getWorld(ptr);
            const px = w.x, py = w.y;
            const isRightClick = ptr.event && ptr.event.button === 2;
            const inStashViewport = px >= stashViewportBounds.left && px <= stashViewportBounds.right && py >= stashViewportBounds.top && py <= stashViewportBounds.bottom;
            const overItemStash = inStashViewport ? itemZones.find(z => inZone(px, py, z)) : null;
            if (isRightClick && overItemStash && isMagazineItem(overItemStash.itemId) && overItemStash.fromStash) {
                const weaponId = getMagazineWeapon(overItemStash.itemId);
                if (weaponId && this._showMagMenu) this._showMagMenu(px, py, { type: 'inventory_mag', dragRef: { fromStash: true, placementId: overItemStash.placementId, itemId: overItemStash.itemId }, weaponId });
                return;
            }
            const overBackpack = backpackItemZones.find(z => inZone(px, py, z));
            if (overBackpack) {
                const now = Date.now();
                if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overBackpack.itemId] && this.lastBackpackListWeaponClick && this.lastBackpackListWeaponClick.placementId === overBackpack.placementId && this.lastBackpackListWeaponClick.itemId === overBackpack.itemId && (now - this.lastBackpackListWeaponClick.time) < 450) {
                    this.invFocusedWeapon = overBackpack.itemId;
                    this.invFocusedWeaponSource = { type: 'backpack', placementId: overBackpack.placementId };
                    this.lastBackpackListWeaponClick = null;
                    sfx.menuOpen();
                    rerenderCharacterTab();
                    return;
                }
                if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overBackpack.itemId]) this.lastBackpackListWeaponClick = { placementId: overBackpack.placementId, itemId: overBackpack.itemId, time: now };
                else this.lastBackpackListWeaponClick = null;
                sfx.click();
                this._stashSelected = { placementId: overBackpack.placementId, fromStash: false };
                return;
            }
            const overItem = overItemStash;
            if (overItem) {
                if (overItem.itemId === 'ammo_box') {
                    const now = Date.now();
                    if (lastAmmoBoxClick && lastAmmoBoxClick.placementId === overItem.placementId && lastAmmoBoxClick.fromStash === overItem.fromStash && (now - lastAmmoBoxClick.time) < 450) {
                        lastAmmoBoxClick = null;
                        sfx.menuOpen();
                        this.showAmmoBoxWindow(overItem.placementId, overItem.fromStash, rerenderCharacterTab);
                        return;
                    }
                    lastAmmoBoxClick = { time: now, placementId: overItem.placementId, fromStash: overItem.fromStash };
                    lastRigClick = null;
                    pendingStashContainerDrag = { placementId: overItem.placementId, fromStash: overItem.fromStash, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1, startX: px, startY: py };
                    return;
                }
                if (overItem.itemId === 'rig') {
                    const now = Date.now();
                    if (lastRigClick && lastRigClick.placementId === overItem.placementId && lastRigClick.fromStash === overItem.fromStash && (now - lastRigClick.time) < 450) {
                        lastRigClick = null;
                        sfx.menuOpen();
                        this.showRigWindow(overItem.placementId, overItem.fromStash, rerenderCharacterTab);
                        return;
                    }
                    lastRigClick = { time: now, placementId: overItem.placementId, fromStash: overItem.fromStash };
                    lastAmmoBoxClick = null;
                    pendingStashContainerDrag = { placementId: overItem.placementId, fromStash: overItem.fromStash, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1, startX: px, startY: py };
                    return;
                }
                if (overItem.itemId === 'backpack_default') {
                    const now = Date.now();
                    if (lastBackpackStashClick && lastBackpackStashClick.placementId === overItem.placementId && lastBackpackStashClick.fromStash === overItem.fromStash && (now - lastBackpackStashClick.time) < 450) {
                        lastBackpackStashClick = null;
                        return;
                    }
                    lastBackpackStashClick = { time: now, placementId: overItem.placementId, fromStash: overItem.fromStash };
                    lastAmmoBoxClick = null;
                    lastRigClick = null;
                    pendingStashContainerDrag = { placementId: overItem.placementId, fromStash: overItem.fromStash, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1, startX: px, startY: py };
                    return;
                }
                if (overItem.fromStash && CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overItem.itemId]) {
                    const now = Date.now();
                    if (this.lastStashGridWeaponClick && this.lastStashGridWeaponClick.placementId === overItem.placementId && this.lastStashGridWeaponClick.itemId === overItem.itemId && (now - this.lastStashGridWeaponClick.time) < 450) {
                        this.invFocusedWeapon = overItem.itemId;
                        this.invFocusedWeaponSource = { type: 'stash', placementId: overItem.placementId };
                        this.lastStashGridWeaponClick = null;
                        sfx.menuOpen();
                        rerenderCharacterTab();
                        return;
                    }
                    this.lastStashGridWeaponClick = { placementId: overItem.placementId, itemId: overItem.itemId, time: now };
                }
                lastAmmoBoxClick = null;
                lastRigClick = null;
                sfx.click();
                this._stashSelected = { placementId: overItem.placementId, fromStash: overItem.fromStash };
                const itemCenterX = (overItem.left + overItem.right) / 2;
                const itemCenterY = (overItem.top + overItem.bottom) / 2;
                const grabOffsetX = px - itemCenterX;
                const grabOffsetY = py - itemCenterY;
                this.stashDragging = { placementId: overItem.placementId, fromStash: overItem.fromStash, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1, grabOffsetX, grabOffsetY };
                const cfg = getInventoryItemConfig(overItem.itemId);
                const name = (cfg && cfg.label) ? cfg.label : (overItem.itemId || '?').replace(/_/g, ' ');
                const lbl = (cfg && cfg.icon) ? cfg.icon : (overItem.itemId || '?').slice(0, 2).toUpperCase();
                const gw = (overItem.sizeW || 1) * step, gh = (overItem.sizeH || 1) * step;
                const ghostX = px - grabOffsetX, ghostY = py - grabOffsetY;
                ghostRect = this.add.rectangle(ghostX, ghostY, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(STASH_DEPTH + 5);
                ghostText = this.add.text(ghostX, ghostY, (overItem.count > 1 ? lbl + overItem.count : lbl), { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(STASH_DEPTH + 6);
                content.push(ghostRect, ghostText);
                return;
            }
            const emptyZone = emptyCellZones.find(z => inZone(px, py, z));
            if (emptyZone && this._stashSelected && this._stashSelected.fromStash) {
                const grid = this.persistent.stash;
                const item = (grid.items || []).find(p => p.placementId === this._stashSelected.placementId);
                if (item && canPlace(grid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, this._stashSelected.placementId)) {
                    if (moveItemInGrid(grid, this._stashSelected.placementId, emptyZone.row, emptyZone.col)) {
                        sfx.click();
                        savePersistent(this.persistent);
                        rerenderCharacterTab();
                    }
                }
                return;
            }
            if (inZone(px, py, btnMoveAll)) {
                const pack = this.stats.backpack;
                const list = (pack.items || []).slice();
                let moved = 0;
                list.forEach(p => {
                    const item = removeItem(pack, p.placementId);
                    if (!item) return;
                    let added = false;
                    if (item.itemId === 'ammo_box') {
                        const srcInvMap = this.stats.ammoBoxInventories;
                        const srcKey = 'backpack_' + p.placementId;
                        const pos = findSpace(this.persistent.stash, item.sizeW || 1, item.sizeH || 1);
                        if (pos) {
                            const newPlacementId = placeItem(this.persistent.stash, item.itemId, item.count || 1, pos.row, pos.col, stashExtra(item));
                            if (newPlacementId != null) {
                                if (!this.persistent.ammoBoxInventories) this.persistent.ammoBoxInventories = {};
                                const destKey = 'stash_' + newPlacementId;
                                if (srcInvMap && srcInvMap[srcKey]) {
                                    this.persistent.ammoBoxInventories[destKey] = srcInvMap[srcKey];
                                    delete srcInvMap[srcKey];
                                }
                                added = true;
                            }
                        }
                    } else if (item.itemId === 'rig') {
                        const srcInvMap = this.stats.rigInventories;
                        const srcKey = 'backpack_' + p.placementId;
                        const pos = findSpace(this.persistent.stash, item.sizeW || 1, item.sizeH || 1);
                        if (pos) {
                            const newPlacementId = placeItem(this.persistent.stash, item.itemId, item.count || 1, pos.row, pos.col, stashExtra(item));
                            if (newPlacementId != null) {
                                if (!this.persistent.rigInventories) this.persistent.rigInventories = {};
                                const destKey = 'stash_' + newPlacementId;
                                if (srcInvMap && srcInvMap[srcKey]) {
                                    this.persistent.rigInventories[destKey] = srcInvMap[srcKey];
                                    delete srcInvMap[srcKey];
                                }
                                added = true;
                            }
                        }
                    }
                    if (!added && tryAddItem(this.persistent.stash, item.itemId, item.count, stashExtra(item))) added = true;
                    if (added) moved++;
                    else pack.items.push(item);
                });
                if (moved > 0) {
                    sfx.click();
                    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                    savePersistent(this.persistent);
                    rerenderCharacterTab();
                }
                return;
            }
        };
        
        const onPointerUp = (ptr) => {
            if (this.ammoBoxWindowOpen || this.rigWindowOpen) return;
            if (ptr.event && ptr.event.button === 2) {
                this.invSelectedMag = null;
                this.stashSelectedMag = null;
                return;
            }
            if (!this.stashDragging) {
                pendingStashContainerDrag = null;
                return;
            }
            const w = getWorld(ptr);
            const px = w.x, py = w.y;
            const drag = this.stashDragging;
            const gx = drag.grabOffsetX != null ? drag.grabOffsetX : 0;
            const gy = drag.grabOffsetY != null ? drag.grabOffsetY : 0;
            const ghostCenterX = (ghostRect && drag.fromStash) ? ghostRect.x : (px - gx);
            const ghostCenterY = (ghostRect && drag.fromStash) ? ghostRect.y : (py - gy);
            destroyGhost();
            this.stashDragging = null;
            if (drag.fromStash && this._hideoutContainerBounds) {
                const b = this._hideoutContainerBounds;
                if (b.backpackSlot && px >= b.backpackSlot.left && px <= b.backpackSlot.right && py >= b.backpackSlot.top && py <= b.backpackSlot.bottom && drag.itemId === 'backpack_default' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('backpack', drag.placementId);
                    return;
                }
                if (b.rigSlot && px >= b.rigSlot.left && px <= b.rigSlot.right && py >= b.rigSlot.top && py <= b.rigSlot.bottom && drag.itemId === 'rig' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('rig', drag.placementId);
                    return;
                }
                if (b.headSlot && px >= b.headSlot.left && px <= b.headSlot.right && py >= b.headSlot.top && py <= b.headSlot.bottom && (drag.itemId === 'helmet' || drag.itemId === 'headset') && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('head', drag.placementId);
                    return;
                }
                if (b.bodySlot && px >= b.bodySlot.left && px <= b.bodySlot.right && py >= b.bodySlot.top && py <= b.bodySlot.bottom && drag.itemId === 'vest' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('body', drag.placementId);
                    return;
                }
                if (b.earsSlot && px >= b.earsSlot.left && px <= b.earsSlot.right && py >= b.earsSlot.top && py <= b.earsSlot.bottom && drag.itemId === 'headset' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('ears', drag.placementId);
                    return;
                }
                if (b.nvgSlot && px >= b.nvgSlot.left && px <= b.nvgSlot.right && py >= b.nvgSlot.top && py <= b.nvgSlot.bottom && drag.itemId === 'nvg' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('nvg', drag.placementId);
                    return;
                }
                if (b.secureSlot && px >= b.secureSlot.left && px <= b.secureSlot.right && py >= b.secureSlot.top && py <= b.secureSlot.bottom && drag.itemId === 'secure_container_default' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('secureContainer', drag.placementId);
                    return;
                }
                if (b.medBagSlot && px >= b.medBagSlot.left && px <= b.medBagSlot.right && py >= b.medBagSlot.top && py <= b.medBagSlot.bottom && drag.itemId === 'med_bag_default' && this.equipStashItemToSlot) {
                    this.equipStashItemToSlot('medBag', drag.placementId);
                    return;
                }
                if (drag.fromStash && isMagazineItem(drag.itemId) && b.attachmentMagSlotZones && b.attachmentMagSlotZones.length && this.equipStashMagToWeaponSlot) {
                    const dropX = ghostCenterX, dropY = ghostCenterY;
                    const inZoneStash = (x, y, z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
                    const overMagSlot = b.attachmentMagSlotZones.find(z => inZoneStash(dropX, dropY, z) && getMagazineWeapon(drag.itemId) === z.weaponId);
                    if (overMagSlot) {
                        this.equipStashMagToWeaponSlot(drag.placementId, overMagSlot.weaponId);
                        return;
                    }
                }
                if (drag.fromStash && isModItem(drag.itemId) && b.attachmentModSlotZones && b.attachmentModSlotZones.length && this.equipStashModToWeaponSlot) {
                    const dropX = ghostCenterX, dropY = ghostCenterY;
                    const inZoneStash = (x, y, z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
                    const overModSlot = b.attachmentModSlotZones.find(z => inZoneStash(dropX, dropY, z) && modFitsSlot(drag.itemId, z.slotName, z.weaponId));
                    if (overModSlot) {
                        this.equipStashModToWeaponSlot(drag.placementId, overModSlot);
                        return;
                    }
                }
                if (b.weaponSlots && b.weaponSlots.length && CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[drag.itemId] && this.equipStashItemToWeaponSlot) {
                    const overW = b.weaponSlots.find(z => px >= z.left && px <= z.right && py >= z.top && py <= z.bottom);
                    if (overW) {
                        const longGunIds = ['shotgun', 'smg', 'crossbow', 'rifle'];
                        const canPrimary = longGunIds.includes(drag.itemId);
                        const canSidearm = drag.itemId === 'pistol';
                        const canMelee = longGunIds.includes(drag.itemId) || drag.itemId === 'pistol';
                        const ok = ((overW.id === 'primary' || overW.id === 'secondary') && canPrimary) || (overW.id === 'sidearm' && canSidearm) || (overW.id === 'melee' && canMelee);
                        if (ok) {
                            this.equipStashItemToWeaponSlot(drag.placementId, overW.id);
                            return;
                        }
                    }
                }
                if (isAmmoItemId(drag.itemId)) {
                    const dropX = ghostCenterX, dropY = ghostCenterY;
                    const inZoneStash = (x, y, z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
                    const overStashAmmoBox = itemZones.find(z => inZoneStash(dropX, dropY, z) && z.itemId === 'ammo_box');
                    const overBackpackAmmoBox = b.backpackItemZonesAll && b.backpackItemZonesAll.find(z => inZoneStash(dropX, dropY, z) && z.itemId === 'ammo_box');
                    const overAmmoBox = overStashAmmoBox || overBackpackAmmoBox;
                    if (overAmmoBox) {
                        const fromStash = !!overStashAmmoBox;
                        const targetPlacementId = overAmmoBox.placementId;
                        const invMap = fromStash ? this.persistent.ammoBoxInventories : this.stats.ammoBoxInventories;
                        if (!invMap) (fromStash ? this.persistent : this.stats).ammoBoxInventories = {};
                        const innerGrid = getOrCreateAmmoBoxInventory(invMap, (fromStash ? 'stash_' : 'backpack_') + targetPlacementId);
                        ensureGridItems(innerGrid);
                        const item = removeItem(this.persistent.stash, drag.placementId);
                        if (item && tryAddItemAmmoBoxOnly(innerGrid, item.itemId, item.count || 1)) {
                            sfx.click();
                            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                            savePersistent(this.persistent);
                            this.scheduleRerenderCharacterTab();
                            return;
                        }
                        if (item) this.persistent.stash.items.push(item);
                    }
                }
                if ((drag.itemId === 'ammo_9mm' || drag.itemId === 'ammo_45' || drag.itemId === 'ammo_556') && (this.stats || (drag.fromStash && this.persistent && this.persistent.stash))) {
                    const dropX = ghostCenterX, dropY = ghostCenterY;
                    const inZoneStash = (x, y, z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
                    let magTarget = null;
                    if (b.backpackItemZonesAll && b.backpackItemZonesAll.length) {
                        const over = b.backpackItemZonesAll.find(z => inZoneStash(dropX, dropY, z) && isMagazineItem(z.itemId) && getMagazineAmmoId(z.itemId) === drag.itemId);
                        if (over) magTarget = { container: 'backpack', placementId: over.placementId, itemId: over.itemId };
                    }
                    if (!magTarget && b.rigItemZones && b.rigItemZones.length) {
                        const over = b.rigItemZones.find(z => inZoneStash(dropX, dropY, z) && isMagazineItem(z.itemId) && getMagazineAmmoId(z.itemId) === drag.itemId);
                        if (over) magTarget = { container: 'rig', placementId: over.placementId, itemId: over.itemId };
                    }
                    if (!magTarget && b.pocketZones && b.pocketZones.length && this.stats) {
                        const overPocket = b.pocketZones.find(z => inZoneStash(dropX, dropY, z));
                        if (overPocket) {
                            const slot = this.stats.pockets && this.stats.pockets[overPocket.pocketIndex] && this.stats.pockets[overPocket.pocketIndex][overPocket.slotIndex];
                            if (slot && slot.itemId && isMagazineItem(slot.itemId) && getMagazineAmmoId(slot.itemId) === drag.itemId)
                                magTarget = { container: 'pocket', pocketIndex: overPocket.pocketIndex, slotIndex: overPocket.slotIndex, itemId: slot.itemId };
                        }
                    }
                    if (!magTarget && drag.fromStash && itemZones.length) {
                        const overStashMag = itemZones.find(z => inZoneStash(dropX, dropY, z) && isMagazineItem(z.itemId) && getMagazineAmmoId(z.itemId) === drag.itemId);
                        if (overStashMag) magTarget = { container: 'stash', placementId: overStashMag.placementId, itemId: overStashMag.itemId };
                    }
                    if (magTarget) {
                        const stats = this.stats;
                        const backpack = stats && stats.backpack;
                        const rigGrid = stats && stats.armor && stats.armor.rig && stats.rigGrid;
                        let magRounds = 0, magMaxRounds = getMagazineCapacity(magTarget.itemId);
                        if (magTarget.container === 'backpack' && backpack && backpack.items) {
                            const p = backpack.items.find(i => i.placementId === magTarget.placementId);
                            if (p) { magRounds = p.rounds ?? 0; magMaxRounds = p.maxRounds ?? magMaxRounds; }
                        } else if (magTarget.container === 'rig' && rigGrid && rigGrid.items) {
                            const p = rigGrid.items.find(i => i.placementId === magTarget.placementId);
                            if (p) { magRounds = p.rounds ?? 0; magMaxRounds = p.maxRounds ?? magMaxRounds; }
                        } else if (magTarget.container === 'pocket' && stats) {
                            const s = stats.pockets && stats.pockets[magTarget.pocketIndex] && stats.pockets[magTarget.pocketIndex][magTarget.slotIndex];
                            if (s) { magRounds = s.rounds ?? 0; magMaxRounds = s.maxRounds ?? magMaxRounds; }
                        } else if (magTarget.container === 'stash' && this.persistent && this.persistent.stash && this.persistent.stash.items) {
                            const p = this.persistent.stash.items.find(i => i.placementId === magTarget.placementId);
                            if (p) { magRounds = p.rounds ?? 0; magMaxRounds = p.maxRounds ?? magMaxRounds; }
                        }
                        const room = magMaxRounds - magRounds;
                        const ammoCount = drag.count || 1;
                        const toAdd = Math.min(ammoCount, room);
                        if (toAdd > 0) {
                            if (magTarget.container === 'backpack' && backpack && backpack.items) {
                                const p = backpack.items.find(i => i.placementId === magTarget.placementId);
                                if (p) { p.rounds = (p.rounds ?? 0) + toAdd; p.maxRounds = p.maxRounds ?? magMaxRounds; }
                            } else if (magTarget.container === 'rig' && rigGrid && rigGrid.items) {
                                const p = rigGrid.items.find(i => i.placementId === magTarget.placementId);
                                if (p) { p.rounds = (p.rounds ?? 0) + toAdd; p.maxRounds = p.maxRounds ?? magMaxRounds; }
                            } else if (magTarget.container === 'pocket' && stats) {
                                ensurePockets(stats);
                                const s = stats.pockets[magTarget.pocketIndex] && stats.pockets[magTarget.pocketIndex][magTarget.slotIndex];
                                if (s) { s.rounds = (s.rounds ?? 0) + toAdd; s.maxRounds = s.maxRounds ?? magMaxRounds; }
                            } else if (magTarget.container === 'stash' && this.persistent && this.persistent.stash && this.persistent.stash.items) {
                                const p = this.persistent.stash.items.find(i => i.placementId === magTarget.placementId);
                                if (p) { p.rounds = (p.rounds ?? 0) + toAdd; p.maxRounds = p.maxRounds ?? magMaxRounds; }
                            }
                            const st = this.persistent.stash;
                            const placement = st && st.items && st.items.find(i => i.placementId === drag.placementId);
                            if (placement && (placement.count || 1) >= toAdd) {
                                placement.count = (placement.count || 1) - toAdd;
                                if ((placement.count || 0) <= 0) removeItem(st, drag.placementId);
                                sfx.click();
                                if (this.stats) localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                                if (this.persistent) savePersistent(this.persistent);
                                this.scheduleRerenderCharacterTab();
                                return;
                            }
                        }
                    }
                }
                if (this.addStashItemToContainer) {
                    const dropX = ghostCenterX, dropY = ghostCenterY;
                    const inZone = (x, y, z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
                    let containerId = null;
                    let pocketTarget = null;
                    if (b.backpackSlot && inZone(px, py, b.backpackSlot) && drag.itemId !== 'backpack_default') containerId = 'backpack';
                    else if (b.rigSlot && inZone(px, py, b.rigSlot) && drag.itemId !== 'rig') containerId = 'rig';
                    else if (b.secureSlot && inZone(px, py, b.secureSlot) && drag.itemId !== 'secure_container_default') containerId = 'secure';
                    else if (b.medBagSlot && inZone(px, py, b.medBagSlot) && drag.itemId !== 'med_bag_default') containerId = 'medBag';
                    else if (b.backpackItemZones && b.backpackItemZones.length) {
                        const overNested = b.backpackItemZones.find(z => inZone(dropX, dropY, z));
                        if (overNested && this.addStashItemToNestedBackpack) {
                            this.addStashItemToNestedBackpack(drag.placementId, overNested.placementId);
                            return;
                        }
                    }
                    if (!containerId && b.backpackEmptyZones && b.backpackEmptyZones.some(z => inZone(dropX, dropY, z))) containerId = 'backpack';
                    if (!containerId && b.rigEmptyZones && b.rigEmptyZones.some(z => inZone(dropX, dropY, z))) containerId = 'rig';
                    if (!containerId && b.secureContainerEmptyZones && b.secureContainerEmptyZones.some(z => inZone(dropX, dropY, z))) containerId = 'secure';
                    if (!containerId && b.medBagEmptyZones && b.medBagEmptyZones.some(z => inZone(dropX, dropY, z))) containerId = 'medBag';
                    if (!containerId && b.pocketZones && b.pocketZones.length) {
                        const overPocketZone = b.pocketZones.find(z => inZone(dropX, dropY, z));
                        if (overPocketZone) {
                            containerId = 'pockets';
                            pocketTarget = { pocketIndex: overPocketZone.pocketIndex, slotIndex: overPocketZone.slotIndex };
                        }
                    }
                    if (containerId) {
                        this.addStashItemToContainer(drag.placementId, containerId, pocketTarget);
                        return;
                    }
                }
            }
            // If we're in hideout and dropped from stash but didn't hit a valid container/slot, only reposition within stash when the drop was actually over the stash viewport. Otherwise leave the item in its original spot.
            if (drag.fromStash && this._hideoutContainerBounds) {
                const inStashViewport = ghostCenterX >= stashViewportBounds.left && ghostCenterX <= stashViewportBounds.right && ghostCenterY >= stashViewportBounds.top && ghostCenterY <= stashViewportBounds.bottom;
                if (!inStashViewport) {
                    rerenderCharacterTab();
                    return;
                }
            }
            // Stash drop: use the ghost's actual position (from scene) so placement matches exactly what was shown. Snap to nearest cell so "next to another item" lands correctly.
            let dropRow = null, dropCol = null;
            if (drag.fromStash) {
                const ghostTopLeftX = ghostCenterX - (drag.sizeW * step) / 2;
                const ghostTopLeftY = ghostCenterY - (drag.sizeH * step) / 2;
                const rawCol = Math.round((ghostTopLeftX - stashX) / step);
                const rawRow = scrollOffset + Math.round((ghostTopLeftY - stashY) / step);
                dropRow = Math.max(0, Math.min(rawRow, totalStashRows - drag.sizeH));
                dropCol = Math.max(0, Math.min(rawCol, stashCols - drag.sizeW));
            }
            if (dropRow != null && dropCol != null && drag.fromStash) {
                if (canPlace(stash, dropRow, dropCol, drag.sizeW, drag.sizeH, drag.placementId)) {
                    if (moveItemInGrid(stash, drag.placementId, dropRow, dropCol)) {
                        sfx.click();
                        savePersistent(this.persistent);
                        rerenderCharacterTab();
                    }
                }
            }
        };
        
        const onWheel = (pointer, gameObjects, deltaX, deltaY) => {
            const w = getWorld(pointer);
            const inStashColumn = w.x >= stashViewportBounds.left && w.x <= stashViewportBounds.right;
            const inStashViewport = inStashColumn && w.y >= stashViewportBounds.top && w.y <= stashViewportBounds.bottom;
            // Allow scroll when cursor is in stash area, or when dragging (item stays selected/dragged while scrolling)
            if (totalStashRows > visibleStashRows && (inStashViewport || inStashColumn || this.stashDragging || this.invDragging)) {
                if (deltaY > 0) this._stashScrollOffset = Math.min(totalStashRows - visibleStashRows, this._stashScrollOffset + 1);
                else if (deltaY < 0) this._stashScrollOffset = Math.max(0, this._stashScrollOffset - 1);
                rerenderCharacterTab();
            }
        };
        this.input.on('pointermove', onPointerMove);
        this.input.on('pointerdown', onPointerDown);
        this.input.on('pointerup', onPointerUp);
        this.input.on('wheel', onWheel);
        this._clearStashDrag = () => { destroyGhost(); this.stashDragging = null; };
        // Preserve drag state across scroll: if we rerendered due to scroll while dragging, recreate the ghost
        if (this.stashDragging && !ghostRect) {
            const ptr = this.input.activePointer;
            const w = getWorld(ptr);
            const gx = this.stashDragging.grabOffsetX != null ? this.stashDragging.grabOffsetX : 0;
            const gy = this.stashDragging.grabOffsetY != null ? this.stashDragging.grabOffsetY : 0;
            const ghostX = w.x - gx, ghostY = w.y - gy;
            const cfg = getInventoryItemConfig(this.stashDragging.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (this.stashDragging.itemId || '?').slice(0, 2).toUpperCase();
            const gw = (this.stashDragging.sizeW || 1) * step, gh = (this.stashDragging.sizeH || 1) * step;
            ghostRect = this.add.rectangle(ghostX, ghostY, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(STASH_DEPTH + 5);
            ghostText = this.add.text(ghostX, ghostY, (this.stashDragging.count > 1 ? lbl + this.stashDragging.count : lbl), { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(STASH_DEPTH + 6);
            content.push(ghostRect, ghostText);
        }
        this.stashCleanup = () => {
            this.input.off('pointermove', onPointerMove);
            this.input.off('pointerdown', onPointerDown);
            this.input.off('pointerup', onPointerUp);
            this.input.off('wheel', onWheel);
            destroyGhost();
            this._clearStashDrag = null;
            this.ammoBoxWindowOpen = null;
            this.rigWindowOpen = null;
        };
    }

    showAmmoBoxWindow(placementId, fromStash, onCloseCallback) {
        const AMMO_BOX_DEPTH = 300;
        const invMap = fromStash ? this.persistent.ammoBoxInventories : this.stats.ammoBoxInventories;
        if (!invMap) (fromStash ? this.persistent : this.stats).ammoBoxInventories = {};
        const innerGrid = getOrCreateAmmoBoxInventory(fromStash ? this.persistent.ammoBoxInventories : this.stats.ammoBoxInventories, (fromStash ? 'stash_' : 'backpack_') + placementId);
        ensureGridItems(innerGrid);
        const elements = [];
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.6).setDepth(AMMO_BOX_DEPTH).setInteractive();
        elements.push(overlay);
        const gridCols = innerGrid.gridW || 16, gridRows = innerGrid.gridH || 16;
        const cellSize = 20;
        const gap = 1;
        const step = cellSize + gap;
        const gridW = gridCols * step - gap, gridH = gridRows * step - gap;
        const panelW = gridW + 40, panelH = gridH + 50;
        const panelOrigin = { x: 400, y: 300 };
        const container = this.add.container(panelOrigin.x, panelOrigin.y);
        container.setDepth(AMMO_BOX_DEPTH + 1);
        elements.push(container);
        const panel = this.add.rectangle(0, 0, panelW, panelH, 0x2a2a2a).setStrokeStyle(3, 0xcc6600);
        container.add(panel);
        const title = this.add.text(0, -panelH/2 + 14, 'Ammo Box', { fontSize: '16px', fill: '#ffaa00', fontStyle: 'bold' }).setOrigin(0.5);
        container.add(title);
        const hint = this.add.text(0, -panelH/2 + 30, 'Drag items to stash or backpack to take them out.', { fontSize: '10px', fill: '#888' }).setOrigin(0.5);
        container.add(hint);
        const closeW = 24, closeH = 24;
        const closeX = panelW/2 - closeW/2 - 4, closeY = -panelH/2 + 14;
        const titleBarH = 36;
        const titleBar = this.add.rectangle(0, -panelH/2 + titleBarH/2, panelW - 8, titleBarH, 0x333322, 0.01).setInteractive();
        container.add(titleBar);
        const closeBtn = this.add.rectangle(closeX, closeY, closeW, closeH, 0xaa2222).setInteractive();
        const closeTxt = this.add.text(closeX, closeY, 'X', { fontSize: '14px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        container.add(closeBtn, closeTxt);
        const gridX0Local = -gridW/2, gridY0Local = -gridH/2 + 20;
        const occupied = new Set();
        (innerGrid.items || []).forEach(p => {
            for (let r = 0; r < (p.sizeH || 1); r++)
                for (let c = 0; c < (p.sizeW || 1); c++) occupied.add(`${p.row + r},${p.col + c}`);
        });
        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                const x = gridX0Local + col * step, y = gridY0Local + row * step;
                const isOcc = occupied.has(`${row},${col}`);
                const r = this.add.rectangle(x + cellSize/2, y + cellSize/2, cellSize, cellSize, isOcc ? 0x334433 : 0x222222).setStrokeStyle(1, 0x555555);
                container.add(r);
            }
        }
        const innerItemZones = [];
        (innerGrid.items || []).forEach(p => {
            const hw = (p.sizeW || 1) * step, hh = (p.sizeH || 1) * step;
            const cx = gridX0Local + p.col * step + hw/2, cy = gridY0Local + p.row * step + hh/2;
            innerItemZones.push({ leftL: cx - hw/2, rightL: cx + hw/2, topL: cy - hh/2, bottomL: cy + hh/2, placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: p.sizeW || 1, sizeH: p.sizeH || 1 });
        });
        const labelFontSize = '10px';
        (innerGrid.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const cx = gridX0Local + p.col * step + (p.sizeW || 1) * step / 2, cy = gridY0Local + p.row * step + (p.sizeH || 1) * step / 2;
            const txt = this.add.text(cx, cy, (p.count > 1 ? lbl + p.count : lbl), { fontSize: labelFontSize, fill: '#ccc' }).setOrigin(0.5);
            container.add(txt);
        });
        const innerEmptyZones = [];
        for (let row = 0; row < gridRows; row++)
            for (let col = 0; col < gridCols; col++)
                if (!occupied.has(`${row},${col}`))
                    innerEmptyZones.push({
                        leftL: gridX0Local + col * step, rightL: gridX0Local + (col + 1) * step,
                        topL: gridY0Local + row * step, bottomL: gridY0Local + (row + 1) * step,
                        row, col
                    });
        const inZone = (px, py, z) => {
            const lx = px - panelOrigin.x, ly = py - panelOrigin.y;
            return lx >= z.leftL && lx <= z.rightL && ly >= z.topL && ly <= z.bottomL;
        };
        let panelDragStart = null;
        const startPanelDrag = (wx, wy) => {
            panelDragStart = { x: wx, y: wy, ox: panelOrigin.x, oy: panelOrigin.y };
        };
        const updatePanelDrag = (wx, wy) => {
            if (!panelDragStart) return;
            panelOrigin.x = panelDragStart.ox + (wx - panelDragStart.x);
            panelOrigin.y = panelDragStart.oy + (wy - panelDragStart.y);
            container.setPosition(panelOrigin.x, panelOrigin.y);
        };
        const endPanelDrag = () => { panelDragStart = null; };
        const getWorld = (ptr) => {
            if (ptr.worldX != null) return { x: ptr.worldX, y: ptr.worldY };
            const p = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            return { x: p.x, y: p.y };
        };
        let innerSelected = null;
        let innerDragging = null;
        let innerGhostRect = null;
        let innerGhostText = null;
        let innerMoveHandler = null;
        let innerUpHandler = null;
        const destroyInnerGhost = () => {
            if (innerGhostRect) { innerGhostRect.destroy(); innerGhostRect = null; }
            if (innerGhostText) { innerGhostText.destroy(); innerGhostText = null; }
        };
        const redrawInner = () => {
            innerItemZones.length = 0;
            innerEmptyZones.length = 0;
            const occ2 = new Set();
            (innerGrid.items || []).forEach(p => {
                for (let r = 0; r < (p.sizeH || 1); r++)
                    for (let c = 0; c < (p.sizeW || 1); c++) occ2.add(`${p.row + r},${p.col + c}`);
            });
            (innerGrid.items || []).forEach(p => {
                const hw = (p.sizeW || 1) * step, hh = (p.sizeH || 1) * step;
                const cx = gridX0Local + p.col * step + hw/2, cy = gridY0Local + p.row * step + hh/2;
                innerItemZones.push({ leftL: cx - hw/2, rightL: cx + hw/2, topL: cy - hh/2, bottomL: cy + hh/2, placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: p.sizeW || 1, sizeH: p.sizeH || 1 });
            });
            for (let row = 0; row < gridRows; row++)
                for (let col = 0; col < gridCols; col++)
                    if (!occ2.has(`${row},${col}`))
                        innerEmptyZones.push({ leftL: gridX0Local + col * step, rightL: gridX0Local + (col + 1) * step, topL: gridY0Local + row * step, bottomL: gridY0Local + (row + 1) * step, row, col });
        };
        const closeWindow = () => {
            endPanelDrag();
            if (innerMoveHandler) { this.input.off('pointermove', innerMoveHandler); innerMoveHandler = null; }
            if (innerUpHandler) { this.input.off('pointerup', innerUpHandler); innerUpHandler = null; }
            if (panelDragMove) this.input.off('pointermove', panelDragMove);
            if (panelDragUp) this.input.off('pointerup', panelDragUp);
            destroyInnerGhost();
            innerDragging = null;
            innerSelected = null;
            elements.forEach(e => e.destroy());
            if (fromStash) savePersistent(this.persistent);
            else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            this.ammoBoxWindowOpen = null;
            if (onCloseCallback) onCloseCallback();
        };
        let panelDragMove = null, panelDragUp = null;
        closeBtn.on('pointerdown', (ptr) => { sfx.click(); closeWindow(); });
        titleBar.on('pointerdown', (ptr) => {
            const w = getWorld(ptr);
            startPanelDrag(w.x, w.y);
            panelDragMove = (p) => { const ww = getWorld(p); updatePanelDrag(ww.x, ww.y); };
            panelDragUp = () => { endPanelDrag(); if (panelDragMove) this.input.off('pointermove', panelDragMove); if (panelDragUp) this.input.off('pointerup', panelDragUp); panelDragMove = null; panelDragUp = null; };
            this.input.on('pointermove', panelDragMove);
            this.input.on('pointerup', panelDragUp);
        });
        overlay.on('pointerdown', (ptr) => {
            const w = getWorld(ptr);
            const px = w.x, py = w.y;
            const lx = px - panelOrigin.x, ly = py - panelOrigin.y;
            if (lx >= closeX - closeW/2 && lx <= closeX + closeW/2 && ly >= closeY - closeH/2 && ly <= closeY + closeH/2) return;
            const overItem = innerItemZones.find(z => inZone(px, py, z));
            if (overItem) {
                sfx.click();
                innerSelected = { placementId: overItem.placementId };
                innerDragging = { placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1 };
                const cfg = getInventoryItemConfig(overItem.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (overItem.itemId || '?').slice(0, 2).toUpperCase();
                const gw = (overItem.sizeW || 1) * step, gh = (overItem.sizeH || 1) * step;
                innerGhostRect = this.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(AMMO_BOX_DEPTH + 10);
                innerGhostText = this.add.text(px, py, (overItem.count > 1 ? lbl + overItem.count : lbl), { fontSize: labelFontSize, fill: '#ccc' }).setOrigin(0.5).setDepth(AMMO_BOX_DEPTH + 11);
                elements.push(innerGhostRect, innerGhostText);
                innerMoveHandler = (p) => {
                    const ww = getWorld(p);
                    if (innerGhostRect) { innerGhostRect.setPosition(ww.x, ww.y); innerGhostText.setPosition(ww.x, ww.y); }
                };
                innerUpHandler = (p) => {
                    const ww = getWorld(p);
                    const ex = ww.x, ey = ww.y;
                    const emptyZone = innerEmptyZones.find(z => inZone(ex, ey, z));
                    destroyInnerGhost();
                    if (innerMoveHandler) { this.input.off('pointermove', innerMoveHandler); innerMoveHandler = null; }
                    this.input.off('pointerup', innerUpHandler);
                    innerUpHandler = null;
                    const dragItem = innerDragging;
                    innerDragging = null;
                    const stashBounds = this._hideoutStashBounds || { left: 120, right: 120 + 12 * 19, top: 100, bottom: 100 + 16 * 19 };
                    const backpackBounds = (this._hideoutContainerBounds && this._hideoutContainerBounds.backpack) || { left: 420, right: 420 + 6 * 19, top: 100, bottom: 100 + 9 * 19 };
                    const inStash = stashBounds && ex >= stashBounds.left && ex <= stashBounds.right && ey >= stashBounds.top && ey <= stashBounds.bottom;
                    const inBackpack = backpackBounds && ex >= backpackBounds.left && ex <= backpackBounds.right && ey >= backpackBounds.top && ey <= backpackBounds.bottom;
                    if (innerSelected && (inStash || inBackpack)) {
                        const item = removeItem(innerGrid, innerSelected.placementId);
                        if (item) {
                            const targetGrid = inStash ? this.persistent.stash : this.stats.backpack;
                            if (targetGrid && tryAddItem(targetGrid, item.itemId, item.count, extraFromPlacement(item))) {
                                sfx.click();
                                if (fromStash) savePersistent(this.persistent);
                                else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                                innerSelected = null;
                                elements.forEach(e => e.destroy());
                                this.ammoBoxWindowOpen = null;
                                if (onCloseCallback) onCloseCallback();
                                this.showAmmoBoxWindow(placementId, fromStash, onCloseCallback);
                                return;
                            }
                            innerGrid.items.push(item);
                        }
                        innerSelected = null;
                    }
                    if (emptyZone && innerSelected) {
                        const item = (innerGrid.items || []).find(it => it.placementId === innerSelected.placementId);
                        if (item && canPlace(innerGrid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, innerSelected.placementId)) {
                            if (moveItemInGrid(innerGrid, innerSelected.placementId, emptyZone.row, emptyZone.col)) {
                                sfx.click();
                                if (fromStash) savePersistent(this.persistent);
                                else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                            }
                        }
                        innerSelected = null;
                    }
                    elements.forEach(e => e.destroy());
                    this.showAmmoBoxWindow(placementId, fromStash, onCloseCallback);
                };
                this.input.on('pointermove', innerMoveHandler);
                this.input.on('pointerup', innerUpHandler);
                return;
            }
            const emptyZone = innerEmptyZones.find(z => inZone(px, py, z));
            if (emptyZone && innerSelected && !innerDragging) {
                const item = (innerGrid.items || []).find(p => p.placementId === innerSelected.placementId);
                if (item && canPlace(innerGrid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, innerSelected.placementId)) {
                    if (moveItemInGrid(innerGrid, innerSelected.placementId, emptyZone.row, emptyZone.col)) {
                        sfx.click();
                        innerSelected = null;
                        if (fromStash) savePersistent(this.persistent);
                        else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                        elements.forEach(e => e.destroy());
                        this.showAmmoBoxWindow(placementId, fromStash, onCloseCallback);
                        return;
                    }
                }
                innerSelected = null;
            }
        });
        overlay.setDepth(AMMO_BOX_DEPTH);
        this.ammoBoxWindowOpen = { placementId, fromStash };
    }

    showRigWindow(placementId, fromStash, onCloseCallback) {
        const RIG_DEPTH = 300;
        const invMap = fromStash ? this.persistent.rigInventories : this.stats.rigInventories;
        if (!invMap) (fromStash ? this.persistent : this.stats).rigInventories = {};
        const innerGrid = getOrCreateRigInventory(fromStash ? this.persistent.rigInventories : this.stats.rigInventories, (fromStash ? 'stash_' : 'backpack_') + placementId);
        ensureGridItems(innerGrid);
        const gridCols = 4, gridRows = 2;
        const cellSize = 18, gap = 1, colGap = 5;
        const cellW = cellSize + gap;
        const cellH = cellSize + gap;
        const stepCol = cellW + colGap;
        const stepRow = cellH;
        const gridW = 4 * stepCol - colGap;
        const gridH = gridRows * stepRow;
        const elements = [];
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.6).setDepth(RIG_DEPTH).setInteractive();
        elements.push(overlay);
        const panelW = gridW + 40, panelH = gridH + 50;
        const panel = this.add.rectangle(400, 300, panelW, panelH, 0x2a2a2a).setStrokeStyle(3, 0x888888).setDepth(RIG_DEPTH + 1);
        elements.push(panel);
        const title = this.add.text(400, 300 - panelH/2 + 14, 'Rig', { fontSize: '16px', fill: '#ddd', fontStyle: 'bold' }).setOrigin(0.5).setDepth(RIG_DEPTH + 2);
        elements.push(title);
        const closeW = 24, closeH = 24;
        const closeX = 400 + panelW/2 - closeW/2 - 4, closeY = 300 - panelH/2 + 14;
        const closeBtn = this.add.rectangle(closeX, closeY, closeW, closeH, 0xaa2222).setDepth(RIG_DEPTH + 2).setInteractive();
        const closeTxt = this.add.text(closeX, closeY, 'X', { fontSize: '14px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(RIG_DEPTH + 3);
        elements.push(closeBtn, closeTxt);
        const gridX0 = 400 - gridW/2, gridY0 = 300 - gridH/2 + 20;
        const occupied = new Set();
        (innerGrid.items || []).forEach(p => {
            for (let r = 0; r < (p.sizeH || 1); r++)
                for (let c = 0; c < (p.sizeW || 1); c++) occupied.add(`${p.row + r},${p.col + c}`);
        });
        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                const x = gridX0 + col * stepCol, y = gridY0 + row * stepRow;
                const isOcc = occupied.has(`${row},${col}`);
                const r = this.add.rectangle(x + cellSize/2, y + cellSize/2, cellSize, cellSize, isOcc ? 0x445544 : 0x333333).setStrokeStyle(1, 0x555555).setDepth(RIG_DEPTH + 1);
                elements.push(r);
            }
        }
        const innerItemZones = [];
        (innerGrid.items || []).forEach(p => {
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const wPx = sw * cellW + (sw - 1) * colGap, hPx = sh * cellH;
            const cx = gridX0 + p.col * stepCol + wPx/2, cy = gridY0 + p.row * stepRow + hPx/2;
            innerItemZones.push({ left: cx - wPx/2, right: cx + wPx/2, top: cy - hPx/2, bottom: cy + hPx/2, placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: sw, sizeH: sh });
        });
        const labelFontSize = '10px';
        (innerGrid.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const wPx = sw * cellW + (sw - 1) * colGap, hPx = sh * cellH;
            const cx = gridX0 + p.col * stepCol + wPx/2, cy = gridY0 + p.row * stepRow + hPx/2;
            const txt = this.add.text(cx, cy, (p.count > 1 ? lbl + p.count : lbl), { fontSize: labelFontSize, fill: '#ccc' }).setOrigin(0.5).setDepth(RIG_DEPTH + 2);
            elements.push(txt);
        });
        const innerEmptyZones = [];
        for (let row = 0; row < gridRows; row++)
            for (let col = 0; col < gridCols; col++)
                if (!occupied.has(`${row},${col}`))
                    innerEmptyZones.push({
                        left: gridX0 + col * stepCol, right: gridX0 + col * stepCol + cellW,
                        top: gridY0 + row * stepRow, bottom: gridY0 + row * stepRow + cellH,
                        row, col
                    });
        const inZone = (px, py, z) => px >= z.left && px <= z.right && py >= z.top && py <= z.bottom;
        const getWorld = (ptr) => {
            if (ptr.worldX != null) return { x: ptr.worldX, y: ptr.worldY };
            const p = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            return { x: p.x, y: p.y };
        };
        let innerSelected = null;
        let innerDragging = null;
        let innerGhostRect = null;
        let innerGhostText = null;
        let innerMoveHandler = null;
        let innerUpHandler = null;
        const destroyInnerGhost = () => {
            if (innerGhostRect) { innerGhostRect.destroy(); innerGhostRect = null; }
            if (innerGhostText) { innerGhostText.destroy(); innerGhostText = null; }
        };
        const closeWindow = () => {
            if (innerMoveHandler) { this.input.off('pointermove', innerMoveHandler); innerMoveHandler = null; }
            if (innerUpHandler) { this.input.off('pointerup', innerUpHandler); innerUpHandler = null; }
            destroyInnerGhost();
            innerDragging = null;
            innerSelected = null;
            elements.forEach(e => e.destroy());
            if (fromStash) savePersistent(this.persistent);
            else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            this.rigWindowOpen = null;
            if (onCloseCallback) onCloseCallback();
        };
        closeBtn.on('pointerdown', () => { sfx.click(); closeWindow(); });
        overlay.on('pointerdown', (ptr) => {
            const w = getWorld(ptr);
            const px = w.x, py = w.y;
            if (px >= closeX - closeW/2 && px <= closeX + closeW/2 && py >= closeY - closeH/2 && py <= closeY + closeH/2) return;
            const overItem = innerItemZones.find(z => inZone(px, py, z));
            if (overItem) {
                sfx.click();
                innerSelected = { placementId: overItem.placementId };
                innerDragging = { placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1 };
                const cfg = getInventoryItemConfig(overItem.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (overItem.itemId || '?').slice(0, 2).toUpperCase();
                const gw = (overItem.sizeW || 1) * cellW + ((overItem.sizeW || 1) - 1) * colGap, gh = (overItem.sizeH || 1) * cellH;
                innerGhostRect = this.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(RIG_DEPTH + 10);
                innerGhostText = this.add.text(px, py, (overItem.count > 1 ? lbl + overItem.count : lbl), { fontSize: labelFontSize, fill: '#ccc' }).setOrigin(0.5).setDepth(RIG_DEPTH + 11);
                elements.push(innerGhostRect, innerGhostText);
                innerMoveHandler = (p) => {
                    const ww = getWorld(p);
                    if (innerGhostRect) { innerGhostRect.setPosition(ww.x, ww.y); innerGhostText.setPosition(ww.x, ww.y); }
                };
                innerUpHandler = (p) => {
                    const ww = getWorld(p);
                    const ex = ww.x, ey = ww.y;
                    const emptyZone = innerEmptyZones.find(z => inZone(ex, ey, z));
                    destroyInnerGhost();
                    if (innerMoveHandler) { this.input.off('pointermove', innerMoveHandler); innerMoveHandler = null; }
                    this.input.off('pointerup', innerUpHandler);
                    innerUpHandler = null;
                    const dragItem = innerDragging;
                    innerDragging = null;
                    const stashBounds = this._hideoutStashBounds || { left: 120, right: 120 + 12 * 19, top: 100, bottom: 100 + 16 * 19 };
                    const backpackBounds = (this._hideoutContainerBounds && this._hideoutContainerBounds.backpack) || { left: 420, right: 420 + 6 * 19, top: 100, bottom: 100 + 9 * 19 };
                    const inStash = stashBounds && ex >= stashBounds.left && ex <= stashBounds.right && ey >= stashBounds.top && ey <= stashBounds.bottom;
                    const inBackpack = backpackBounds && ex >= backpackBounds.left && ex <= backpackBounds.right && ey >= backpackBounds.top && ey <= backpackBounds.bottom;
                    if (innerSelected && (inStash || inBackpack)) {
                        const item = removeItem(innerGrid, innerSelected.placementId);
                        if (item) {
                            const targetGrid = inStash ? this.persistent.stash : this.stats.backpack;
                            if (targetGrid && tryAddItem(targetGrid, item.itemId, item.count, extraFromPlacement(item))) {
                                sfx.click();
                                if (fromStash) savePersistent(this.persistent);
                                else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                                innerSelected = null;
                                elements.forEach(e => e.destroy());
                                this.rigWindowOpen = null;
                                if (onCloseCallback) onCloseCallback();
                                return;
                            }
                            innerGrid.items.push(item);
                        }
                        innerSelected = null;
                    }
                    if (emptyZone && innerSelected) {
                        const item = (innerGrid.items || []).find(it => it.placementId === innerSelected.placementId);
                        if (item && canPlace(innerGrid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, innerSelected.placementId)) {
                            if (moveItemInGrid(innerGrid, innerSelected.placementId, emptyZone.row, emptyZone.col)) {
                                sfx.click();
                                if (fromStash) savePersistent(this.persistent);
                                else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                            }
                        }
                        innerSelected = null;
                    }
                    elements.forEach(e => e.destroy());
                    this.showRigWindow(placementId, fromStash, onCloseCallback);
                };
                this.input.on('pointermove', innerMoveHandler);
                this.input.on('pointerup', innerUpHandler);
                return;
            }
            const emptyZone = innerEmptyZones.find(z => inZone(px, py, z));
            if (emptyZone && innerSelected && !innerDragging) {
                const item = (innerGrid.items || []).find(p => p.placementId === innerSelected.placementId);
                if (item && canPlace(innerGrid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, innerSelected.placementId)) {
                    if (moveItemInGrid(innerGrid, innerSelected.placementId, emptyZone.row, emptyZone.col)) {
                        sfx.click();
                        innerSelected = null;
                        if (fromStash) savePersistent(this.persistent);
                        else localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                        elements.forEach(e => e.destroy());
                        this.showRigWindow(placementId, fromStash, onCloseCallback);
                        return;
                    }
                }
                innerSelected = null;
            }
        });
        overlay.setDepth(RIG_DEPTH);
        this.rigWindowOpen = { placementId, fromStash };
    }

    countUnclaimedChallenges() {
        let count = 0;
        // Count completed but unclaimed dailies
        this.persistent.activeDailies?.forEach(challenge => {
            const config = CONFIG.CHALLENGES.DAILY.find(c => c.id === challenge.id);
            if (config && challenge.progress >= config.target && !challenge.claimed) {
                count++;
            }
        });
        // Count completed but unclaimed weeklies
        this.persistent.activeWeeklies?.forEach(challenge => {
            const config = CONFIG.CHALLENGES.WEEKLY.find(c => c.id === challenge.id);
            if (config && challenge.progress >= config.target && !challenge.claimed) {
                count++;
            }
        });
        return count;
    }
    
    showSettingsMenu() {
        const settings = loadSettings();
        const elements = [];
        
        // Overlay background (taller to fit controls)
        const overlay = this.add.rectangle(400, 300, 550, 520, 0x111111, 0.98).setDepth(500);
        elements.push(overlay);
        
        const title = this.add.text(400, 65, "SETTINGS", { fontSize: '28px', fill: '#fff' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // Controls section
        const controlsLabel = this.add.text(400, 100, "CONTROLS", { fontSize: '12px', fill: '#888' }).setOrigin(0.5).setDepth(501);
        elements.push(controlsLabel);
        
        const controlsBg = this.add.rectangle(400, 155, 500, 80, 0x1a1a1a).setDepth(501);
        elements.push(controlsBg);
        
        const controlsText = this.add.text(400, 155, 
            "WASD: Move  |  Mouse: Aim/Fire  |  SPACE: Dodge  |  R: Reload\n" +
            "G: Grenade  |  TAB: Inventory  |  N: NVG  |  F: Interact\n" +
            "Q: Switch Weapon  |  E: Melee  |  1/2/3: Consumables", 
            { fontSize: '11px', fill: '#aaa', align: 'center', lineSpacing: 6 }
        ).setOrigin(0.5).setDepth(502);
        elements.push(controlsText);
        
        // Master Volume Slider
        const masterLabel = this.add.text(170, 205, "MASTER VOLUME", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(masterLabel);
        
        const masterSliderBg = this.add.rectangle(400, 230, 280, 16, 0x333333).setDepth(501);
        elements.push(masterSliderBg);
        
        const masterSliderFill = this.add.rectangle(260, 230, settings.masterVolume * 280, 12, 0x00ff00).setOrigin(0, 0.5).setDepth(502);
        elements.push(masterSliderFill);
        
        const masterPercent = this.add.text(550, 230, `${Math.round(settings.masterVolume * 100)}%`, { fontSize: '11px', fill: '#fff' }).setOrigin(0, 0.5).setDepth(501);
        elements.push(masterPercent);
        
        masterSliderBg.setInteractive();
        masterSliderBg.on('pointerdown', (pointer) => {
            const relX = (pointer.x - 260) / 280;
            const newVol = Phaser.Math.Clamp(relX, 0, 1);
            settings.masterVolume = newVol;
            sfx.setMasterVolume(newVol);
            masterSliderFill.width = newVol * 280;
            masterPercent.setText(`${Math.round(newVol * 100)}%`);
            sfx.click();
        });
        
        // SFX Volume Slider
        const sfxLabel = this.add.text(170, 255, "SFX VOLUME", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(sfxLabel);
        
        const sfxSliderBg = this.add.rectangle(400, 280, 280, 16, 0x333333).setDepth(501);
        elements.push(sfxSliderBg);
        
        const sfxSliderFill = this.add.rectangle(260, 280, settings.sfxVolume * 280, 12, 0x00aaff).setOrigin(0, 0.5).setDepth(502);
        elements.push(sfxSliderFill);
        
        const sfxPercent = this.add.text(550, 280, `${Math.round(settings.sfxVolume * 100)}%`, { fontSize: '11px', fill: '#fff' }).setOrigin(0, 0.5).setDepth(501);
        elements.push(sfxPercent);
        
        sfxSliderBg.setInteractive();
        sfxSliderBg.on('pointerdown', (pointer) => {
            const relX = (pointer.x - 260) / 280;
            const newVol = Phaser.Math.Clamp(relX, 0, 1);
            settings.sfxVolume = newVol;
            sfx.setSfxVolume(newVol);
            sfxSliderFill.width = newVol * 280;
            sfxPercent.setText(`${Math.round(newVol * 100)}%`);
            sfx.click();
        });
        
        // Screen Shake Toggle
        const shakeLabel = this.add.text(170, 315, "SCREEN SHAKE", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(shakeLabel);
        
        const shakeToggle = this.add.rectangle(510, 315, 65, 24, settings.screenShake ? 0x00ff00 : 0x444444).setDepth(501).setInteractive();
        elements.push(shakeToggle);
        
        const shakeText = this.add.text(510, 315, settings.screenShake ? "ON" : "OFF", { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(shakeText);
        
        shakeToggle.on('pointerdown', () => {
            settings.screenShake = !settings.screenShake;
            shakeToggle.setFillStyle(settings.screenShake ? 0x00ff00 : 0x444444);
            shakeText.setText(settings.screenShake ? "ON" : "OFF");
            saveSettings(settings);
            sfx.click();
        });
        
        // Hit Indicators Toggle
        const hitLabel = this.add.text(170, 350, "HIT INDICATORS", { fontSize: '13px', fill: '#aaa' }).setDepth(501);
        elements.push(hitLabel);
        
        const hitToggle = this.add.rectangle(510, 350, 65, 24, settings.hitIndicators ? 0x00ff00 : 0x444444).setDepth(501).setInteractive();
        elements.push(hitToggle);
        
        const hitText = this.add.text(510, 350, settings.hitIndicators ? "ON" : "OFF", { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(hitText);
        
        hitToggle.on('pointerdown', () => {
            settings.hitIndicators = !settings.hitIndicators;
            hitToggle.setFillStyle(settings.hitIndicators ? 0x00ff00 : 0x444444);
            hitText.setText(settings.hitIndicators ? "ON" : "OFF");
            saveSettings(settings);
            sfx.click();
        });
        
        // Separator
        const sep = this.add.rectangle(400, 390, 450, 1, 0x444444).setDepth(501);
        elements.push(sep);
        
        // Export/Import save
        const exportBtn = this.add.rectangle(300, 420, 150, 28, 0x335533).setDepth(501).setInteractive();
        const exportText = this.add.text(300, 420, "📤 EXPORT SAVE", { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(exportBtn, exportText);
        
        exportBtn.on('pointerdown', () => {
            const runSaved = localStorage.getItem(CONFIG.SAVE_KEY);
            const persistentSaved = localStorage.getItem(PERSISTENT_KEY);
            if (!runSaved && !persistentSaved) { sfx.error(); return; }
            const payload = { version: 2, run: runSaved ? JSON.parse(runSaved) : null, persistent: persistentSaved ? JSON.parse(persistentSaved) : null };
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `zombie_save_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            sfx.success();
        });
        exportBtn.on('pointerover', () => exportBtn.setFillStyle(0x447744));
        exportBtn.on('pointerout', () => exportBtn.setFillStyle(0x335533));
        
        const importBtn = this.add.rectangle(500, 420, 150, 28, 0x335533).setDepth(501).setInteractive();
        const importText = this.add.text(500, 420, "📥 IMPORT SAVE", { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(importBtn, importText);
        
        importBtn.on('pointerdown', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const json = JSON.parse(event.target.result);
                        if (json.version === 2 && (json.run != null || json.persistent != null)) {
                            if (json.run != null) localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(json.run));
                            if (json.persistent != null) localStorage.setItem(PERSISTENT_KEY, JSON.stringify(json.persistent));
                            sfx.success();
                            elements.forEach(e => e.destroy());
                            this.scene.restart();
                        } else if (json.hp !== undefined && json.hideout !== undefined) {
                            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(json));
                            sfx.success();
                            elements.forEach(e => e.destroy());
                            this.scene.restart();
                        } else {
                            sfx.error();
                        }
                    } catch (err) {
                        sfx.error();
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        });
        importBtn.on('pointerover', () => importBtn.setFillStyle(0x447744));
        importBtn.on('pointerout', () => importBtn.setFillStyle(0x335533));
        
        // Cheat Code button
        const cheatBtn = this.add.text(400, 460, "[ ENTER CHEAT CODE ]", { fontSize: '11px', fill: '#555' }).setOrigin(0.5).setDepth(501).setInteractive();
        elements.push(cheatBtn);
        
        cheatBtn.on('pointerdown', () => {
            const code = prompt("ENTER CHEAT CODE:");
            if (code === 'god mode') {
                elements.forEach(e => e.destroy());
                this.activateGodMode();
            }
        });
        cheatBtn.on('pointerover', () => cheatBtn.setFill('#888'));
        cheatBtn.on('pointerout', () => cheatBtn.setFill('#555'));
        
        // Close button
        const closeBtn = this.add.text(400, 510, "[ CLOSE ]", { fontSize: '14px', fill: '#ff4444' }).setOrigin(0.5).setDepth(501).setInteractive();
        elements.push(closeBtn);
        
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
        });
    }
    
    activateGodMode() {
        const godStats = {
            hp: 999, maxHp: 999, stamina: 100, maxStamina: 100, ammo: 999, scrap: 999,
            credits: 999, materials: 999,
            grenades: 0,
            nextLevel: 1, highestLevelUnlocked: 7,
            consumables: ['adrenaline', 'armor_patch', 'stim_pack'],
            hasFlashlight: true, hasShotgun: true, hasSMG: true, hasCrossbow: true, hasRifle: true,
            currentWeapon: 'rifle',
            magazines: {
                pistol: CONFIG.WEAPONS.PISTOL.MAG_SIZE,
                shotgun: CONFIG.WEAPONS.SHOTGUN.MAG_SIZE,
                smg: CONFIG.WEAPONS.SMG.MAG_SIZE,
                crossbow: CONFIG.WEAPONS.CROSSBOW.MAG_SIZE,
                rifle: CONFIG.WEAPONS.RIFLE.MAG_SIZE
            },
            armor: {
                head: { name: 'GOD HELM', durability: 999, maxDurability: 999 },
                body: { name: 'GOD VEST', durability: 999, maxDurability: 999 },
                arms: null, feet: null
            },
            hideout: {
                restAreaLvl: 99, generatorLvl: 1, hasSparkPlug: true,
                armory: { crafting: null, hasNVG: true },
                workbenchLvl: 1, repairStationLvl: 1
            },
            equippedMods: (() => {
                const o = {};
                ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'].forEach(w => { o[w] = createDefaultEquippedModsForWeapon(w); });
                return o;
            })()
        };
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(godStats));
        sfx.success();
        this.scene.restart({ stats: godStats });
    }
    
    createWorkbenchCard(x, y) {
        this.add.rectangle(x + 100, y + 60, 220, 130, 0x333333).setStrokeStyle(2, 0x555555);
        this.add.text(x + 10, y + 10, "WORKBENCH", { fontSize: '18px', fill: '#ff8800' });
        this.workbenchDesc = this.add.text(x + 10, y + 35, "", { fontSize: '12px', fill: '#aaa' });
        const btn = this.add.rectangle(x + 100, y + 100, 200, 25, 0x555555).setInteractive();
        this.workbenchBtnText = this.add.text(x + 100, y + 100, "", { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        
        this.updateWorkbenchUI();
        
        btn.on('pointerdown', () => {
            if (this.stats.hideout.workbenchLvl === 0 && (this.persistent.scrap || 0) >= CONFIG.HIDEOUT.WORKBENCH_COST) {
                sfx.success();
                this.persistent.scrap = (this.persistent.scrap || 0) - CONFIG.HIDEOUT.WORKBENCH_COST;
                this.stats.hideout.workbenchLvl = 1;
                this.updateStatText();
                this.updateWorkbenchUI();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                this.cameras.main.flash(100, 255, 136, 0);
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
            }
        });
    }
    
    updateWorkbenchUI() {
        if (this.stats.hideout.workbenchLvl === 0) {
            this.workbenchDesc.setText(`Upgrade weapons\n+${CONFIG.HIDEOUT.WORKBENCH_DAMAGE_BONUS * 100}% damage`);
            this.workbenchBtnText.setText(`BUILD (${CONFIG.HIDEOUT.WORKBENCH_COST} SCRAP)`);
        } else {
            this.workbenchDesc.setText(`ACTIVE\n+${CONFIG.HIDEOUT.WORKBENCH_DAMAGE_BONUS * 100}% weapon damage`);
            this.workbenchBtnText.setText("UPGRADED");
        }
    }
    
    createRepairStationCard(x, y) {
        this.add.rectangle(x + 100, y + 60, 220, 130, 0x333333).setStrokeStyle(2, 0x555555);
        this.add.text(x + 10, y + 10, "REPAIR STATION", { fontSize: '18px', fill: '#00aaff' });
        this.repairDesc = this.add.text(x + 10, y + 35, "", { fontSize: '12px', fill: '#aaa' });
        const btn = this.add.rectangle(x + 100, y + 100, 200, 25, 0x555555).setInteractive();
        this.repairBtnText = this.add.text(x + 100, y + 100, "", { fontSize: '12px', fill: '#fff' }).setOrigin(0.5);
        
        this.updateRepairUI();
        
        btn.on('pointerdown', () => {
            if (this.stats.hideout.repairStationLvl === 0 && (this.persistent.scrap || 0) >= CONFIG.HIDEOUT.REPAIR_STATION_COST) {
                // Build repair station
                sfx.success();
                this.persistent.scrap = (this.persistent.scrap || 0) - CONFIG.HIDEOUT.REPAIR_STATION_COST;
                this.stats.hideout.repairStationLvl = 1;
                this.updateStatText();
                this.updateRepairUI();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                this.cameras.main.flash(100, 0, 170, 255);
            } else if (this.stats.hideout.repairStationLvl > 0) {
                // Repair armor
                this.repairArmor();
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
            }
        });
    }
    
    repairArmor() {
        let repaired = false;
        const slots = ['head', 'body', 'arms', 'feet'];
        for (const slot of slots) {
            const armor = this.stats.armor[slot];
            if (armor && armor.durability < armor.maxDurability) {
                const needed = armor.maxDurability - armor.durability;
                const cost = needed * CONFIG.HIDEOUT.REPAIR_COST_PER_POINT;
                if ((this.persistent.scrap || 0) >= cost) {
                    this.persistent.scrap = (this.persistent.scrap || 0) - cost;
                    armor.durability = armor.maxDurability;
                    repaired = true;
                }
            }
        }
        if (repaired) {
            sfx.success();
            this.updateStatText();
            this.updateRepairUI();
            savePersistent(this.persistent);
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            this.cameras.main.flash(100, 0, 255, 0);
        } else {
            sfx.error();
            this.cameras.main.shake(100, 0.005);
        }
    }
    
    updateRepairUI() {
        if (this.stats.hideout.repairStationLvl === 0) {
            this.repairDesc.setText(`Repair damaged armor\n${CONFIG.HIDEOUT.REPAIR_COST_PER_POINT} scrap per point`);
            this.repairBtnText.setText(`BUILD (${CONFIG.HIDEOUT.REPAIR_STATION_COST} SCRAP)`);
        } else {
            // Calculate total repair cost
            let totalCost = 0;
            const slots = ['head', 'body', 'arms', 'feet'];
            for (const slot of slots) {
                const armor = this.stats.armor[slot];
                if (armor && armor.durability < armor.maxDurability) {
                    totalCost += (armor.maxDurability - armor.durability) * CONFIG.HIDEOUT.REPAIR_COST_PER_POINT;
                }
            }
            if (totalCost > 0) {
                this.repairDesc.setText(`Armor needs repair\nCost: ${totalCost} scrap`);
                this.repairBtnText.setText("REPAIR ALL");
            } else {
                this.repairDesc.setText("All armor at full\ndurability");
                this.repairBtnText.setText("NO REPAIRS NEEDED");
            }
        }
    }
    
    showMissionMap() {
        const elements = [];
        this.selectedLevel = this.stats.nextLevel || 1;
        
        // Level configuration
        const LEVELS = {
            1: { x: 150, y: 140, name: "Street", color: 0x2d5a27 },
            2: { x: 300, y: 100, name: "Apartment", color: 0x666666 },
            3: { x: 450, y: 140, name: "Rooftop", color: 0x334455 },
            4: { x: 180, y: 240, name: "Sewers", color: 0x2a3a2a },
            5: { x: 350, y: 220, name: "Hospital", color: 0xdddddd },
            6: { x: 450, y: 320, name: "Mall", color: 0x8B4513 },
            7: { x: 600, y: 360, name: "Cemetery", color: 0x1a1a1a }
        };
        
        // Road connections
        const ROADS = [[1,2], [2,3], [1,4], [4,5], [3,5], [5,6], [6,7]];
        
        // Dark overlay
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.9).setDepth(500);
        elements.push(overlay);
        
        // Title
        const title = this.add.text(400, 40, "MISSION SELECT", { 
            fontSize: '36px', fill: '#00ff00', fontStyle: 'bold' 
        }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // City grid background
        const mapBg = this.add.rectangle(400, 250, 700, 350, 0x111122).setDepth(501);
        elements.push(mapBg);
        
        // Grid lines
        const graphics = this.add.graphics().setDepth(502);
        graphics.lineStyle(1, 0x222233, 0.5);
        for (let x = 50; x <= 750; x += 40) {
            graphics.moveTo(x, 75);
            graphics.lineTo(x, 425);
        }
        for (let y = 75; y <= 425; y += 35) {
            graphics.moveTo(50, y);
            graphics.lineTo(750, y);
        }
        graphics.strokePath();
        elements.push(graphics);
        
        // Draw roads first (under nodes)
        const roadGraphics = this.add.graphics().setDepth(503);
        roadGraphics.lineStyle(4, 0x444444);
        ROADS.forEach(([from, to]) => {
            const fromLevel = LEVELS[from];
            const toLevel = LEVELS[to];
            roadGraphics.moveTo(fromLevel.x, fromLevel.y);
            roadGraphics.lineTo(toLevel.x, toLevel.y);
        });
        roadGraphics.strokePath();
        elements.push(roadGraphics);
        
        // Store node references for updates
        this.mapNodes = {};
        
        // Draw level nodes
        for (let i = 1; i <= 7; i++) {
            const level = LEVELS[i];
            const isUnlocked = i <= this.stats.highestLevelUnlocked;
            const isLevel7Completed = (i === 7 && (this.persistent && this.persistent.level7Completed));
            const isCleared = i < this.stats.highestLevelUnlocked || isLevel7Completed;
            const isSelected = i === this.selectedLevel;
            const isNext = i === this.stats.nextLevel;
            
            // Node background
            let nodeColor = 0x333333; // Locked
            if (isCleared) nodeColor = 0x006600; // Cleared
            if (isNext && !isCleared) nodeColor = 0xaa6600; // Current target
            if (isSelected) nodeColor = 0x0066aa; // Selected
            
            const node = this.add.circle(level.x, level.y, 28, nodeColor).setDepth(504);
            if (isUnlocked) {
                node.setInteractive({ useHandCursor: true });
                node.on('pointerover', () => {
                    if (this.selectedLevel !== i) node.setFillStyle(0x0088cc);
                });
                node.on('pointerout', () => {
                    this.updateMapNodeColor(i);
                });
                node.on('pointerdown', () => {
                    sfx.click();
                    this.selectedLevel = i;
                    this.updateMapSelection();
                });
            }
            
            // Level number
            const numText = this.add.text(level.x, level.y, `${i}`, { 
                fontSize: '20px', fill: isUnlocked ? '#ffffff' : '#555555', fontStyle: 'bold' 
            }).setOrigin(0.5).setDepth(505);
            
            // Status icon (checkmark for completed level 7)
            let icon = '';
            if (isLevel7Completed) icon = '✓';
            else if (!isUnlocked) icon = '🔒';
            else if (isCleared) icon = '✓';
            else if (isNext) icon = '→';
            
            const iconText = this.add.text(level.x + 20, level.y - 20, icon, { 
                fontSize: '14px' 
            }).setOrigin(0.5).setDepth(506);
            
            // Level name
            const nameText = this.add.text(level.x, level.y + 40, level.name, { 
                fontSize: '12px', fill: isUnlocked ? '#cccccc' : '#555555' 
            }).setOrigin(0.5).setDepth(505);
            
            this.mapNodes[i] = { node, numText, iconText, nameText };
            elements.push(node, numText, iconText, nameText);
        }
        
        // Selected level info panel
        const infoPanel = this.add.rectangle(400, 480, 400, 80, 0x222233).setDepth(501);
        elements.push(infoPanel);
        
        this.mapInfoText = this.add.text(400, 465, '', { 
            fontSize: '18px', fill: '#ffffff', align: 'center' 
        }).setOrigin(0.5).setDepth(502);
        elements.push(this.mapInfoText);
        
        this.mapStatusText = this.add.text(400, 490, '', { 
            fontSize: '14px', fill: '#888888', align: 'center' 
        }).setOrigin(0.5).setDepth(502);
        elements.push(this.mapStatusText);
        
        // Deploy button
        const deployBtn = this.add.rectangle(550, 540, 150, 45, 0x008800).setInteractive().setDepth(501);
        const deployTxt = this.add.text(550, 540, "DEPLOY", { 
            fontSize: '20px', fill: '#ffffff', fontStyle: 'bold' 
        }).setOrigin(0.5).setDepth(502);
        elements.push(deployBtn, deployTxt);
        
        deployBtn.on('pointerover', () => deployBtn.setFillStyle(0x00aa00));
        deployBtn.on('pointerout', () => deployBtn.setFillStyle(0x008800));
        deployBtn.on('pointerdown', () => {
            sfx.success();
            // Apply hideout bonuses before deploying
            if (this.stats.hideout.restAreaLvl > 0) {
                const heal = this.stats.hideout.restAreaLvl >= 2 ? this.stats.maxHp : Math.floor(this.stats.maxHp / 2);
                this.stats.hp = Math.min(this.stats.hp + heal, this.stats.maxHp);
            }
            if (this.stats.hideout.generatorLvl > 0 && this.stats.backpack) {
                ensureGridItems(this.stats.backpack);
                tryAddItem(this.stats.backpack, 'flashlight', 1);
            }
            // Refill magazines
            this.stats.magazines.pistol = CONFIG.WEAPONS.PISTOL.MAG_SIZE;
            this.stats.magazines.shotgun = CONFIG.WEAPONS.SHOTGUN.MAG_SIZE;
            this.stats.magazines.smg = CONFIG.WEAPONS.SMG.MAG_SIZE;
            this.stats.magazines.crossbow = CONFIG.WEAPONS.CROSSBOW.MAG_SIZE;
            this.stats.magazines.rifle = CONFIG.WEAPONS.RIFLE.MAG_SIZE;
            // Update nextLevel to selected level
            this.stats.nextLevel = this.selectedLevel;
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            
            this.cameras.main.fade(500, 0, 0, 0);
            this.time.delayedCall(500, () => { 
                this.scene.start('GameScene', { level: this.selectedLevel, stats: this.stats }); 
            });
        });
        
        // Close button
        const closeBtn = this.add.rectangle(250, 540, 150, 45, 0x444444).setInteractive().setDepth(501);
        const closeTxt = this.add.text(250, 540, "BACK", { 
            fontSize: '20px', fill: '#ffffff' 
        }).setOrigin(0.5).setDepth(502);
        elements.push(closeBtn, closeTxt);
        
        closeBtn.on('pointerover', () => closeBtn.setFillStyle(0x555555));
        closeBtn.on('pointerout', () => closeBtn.setFillStyle(0x444444));
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
        });
        
        // Store elements for cleanup
        this.mapElements = elements;
        
        // Initial selection update
        this.updateMapSelection();
    }
    
    updateMapNodeColor(levelNum) {
        if (!this.mapNodes || !this.mapNodes[levelNum] || !this.mapNodes[levelNum].node) return;
        if (!this.mapNodes[levelNum].node.active) return;
        
        const isUnlocked = levelNum <= this.stats.highestLevelUnlocked;
        const isLevel7Completed = (levelNum === 7 && (this.persistent && this.persistent.level7Completed));
        const isCleared = levelNum < this.stats.highestLevelUnlocked || isLevel7Completed;
        const isSelected = levelNum === this.selectedLevel;
        const isNext = levelNum === this.stats.nextLevel;
        
        let nodeColor = 0x333333; // Locked
        if (isCleared) nodeColor = 0x006600; // Cleared
        if (isNext && !isCleared) nodeColor = 0xaa6600; // Current target
        if (isSelected) nodeColor = 0x0066aa; // Selected
        
        this.mapNodes[levelNum].node.setFillStyle(nodeColor);
        // Update level 7 checkmark icon when selection changes
        if (levelNum === 7 && this.mapNodes[levelNum].iconText) {
            let icon = '';
            if (isLevel7Completed) icon = '✓';
            else if (!isUnlocked) icon = '🔒';
            else if (isCleared) icon = '✓';
            else if (isNext) icon = '→';
            this.mapNodes[levelNum].iconText.setText(icon);
        }
    }
    
    updateMapSelection() {
        // Guard against destroyed UI
        if (!this.mapInfoText || !this.mapStatusText) return;
        
        const LEVEL_NAMES = ['', 'Street', 'Apartment', 'Rooftop', 'Sewers', 'Hospital', 'Mall', 'Cemetery'];
        const LEVEL_DESC = [
            '',
            'Urban streets with scattered zombies',
            'Multi-floor building, find the key',
            'Night sky, collect molotov, burn debris',
            'Dark tunnels, need flashlight',
            'BOSS FIGHT - Heavy zombie',
            'Shopping center with breach waves',
            'FINAL BOSS - Necromancer awaits'
        ];
        
        // Update all node colors
        for (let i = 1; i <= 7; i++) {
            this.updateMapNodeColor(i);
        }
        
        // Update info panel
        const levelName = LEVEL_NAMES[this.selectedLevel] || '';
        const levelDesc = LEVEL_DESC[this.selectedLevel] || '';
        const isCleared = this.selectedLevel < this.stats.highestLevelUnlocked;
        
        if (this.mapInfoText.active) {
            this.mapInfoText.setText(`${this.selectedLevel}. ${levelName}`);
        }
        if (this.mapStatusText.active) {
            this.mapStatusText.setText(isCleared ? `CLEARED - ${levelDesc}` : levelDesc);
        }
    }
    
    showStatsPanel() {
        // Create overlay
        const overlay = this.add.rectangle(400, 300, 700, 500, 0x111111, 0.95).setDepth(500);
        const title = this.add.text(400, 80, "STATS & ACHIEVEMENTS", { fontSize: '28px', fill: '#ffd700' }).setOrigin(0.5).setDepth(501);
        
        const p = this.persistent;
        const accuracy = p.totalShotsFired > 0 ? Math.round((p.totalShotsHit / p.totalShotsFired) * 100) : 0;
        
        // Stats column
        const statsText = this.add.text(100, 120, 
            `LIFETIME STATS\n\n` +
            `Kills: ${p.totalKills}\n` +
            `Deaths: ${p.totalDeaths}\n` +
            `Extractions: ${p.runsCompleted}\n` +
            `Runs Started: ${p.runsStarted}\n` +
            `Accuracy: ${accuracy}%\n` +
            `(${p.totalShotsHit}/${p.totalShotsFired} shots)\n` +
            `Scrap Collected: ${p.totalScrapCollected}\n` +
            `Credits Earned: ${p.totalCreditsEarned || 0}\n` +
            `Materials Found: ${p.totalMaterialsCollected || 0}\n` +
            `Items Bought: ${p.itemsBought || 0}\n` +
            `Items Sold: ${p.itemsSold || 0}\n` +
            `Melee Kills: ${p.meleeKills}\n` +
            `Grenade Kills: ${p.totalGrenadeKills}\n` +
            `Bosses Killed: ${p.bossesKilled}`,
            { fontSize: '13px', fill: '#ccc', lineSpacing: 5 }
        ).setDepth(501);
        
        // Achievements column
        const achTitle = this.add.text(420, 120, "ACHIEVEMENTS", { fontSize: '16px', fill: '#ffd700' }).setDepth(501);
        let achY = 150;
        const allAchievements = Object.values(CONFIG.ACHIEVEMENTS);
        allAchievements.forEach(ach => {
            const unlocked = p.achievements.includes(ach.id);
            const color = unlocked ? '#00ff00' : '#555555';
            const icon = unlocked ? ach.icon : '🔒';
            this.add.text(420, achY, `${icon} ${ach.name}`, { fontSize: '14px', fill: color }).setDepth(501);
            this.add.text(440, achY + 16, ach.desc, { fontSize: '11px', fill: unlocked ? '#888' : '#444' }).setDepth(501);
            achY += 40;
        });
        
        // Close button
        const closeBtn = this.add.text(400, 530, "[ CLOSE ]", { fontSize: '18px', fill: '#ff4444' }).setOrigin(0.5).setDepth(501).setInteractive();
        const elements = [overlay, title, statsText, achTitle, closeBtn];
        
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
            // Destroy achievement texts too
            this.children.list.filter(c => c.depth === 501).forEach(c => c.destroy());
        });
    }
    
    showClassModal() {
        const elements = [];
        
        // Dark overlay
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.8).setDepth(499).setInteractive();
        elements.push(overlay);
        overlay.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
        });
        
        // Modal background
        const modalBg = this.add.rectangle(400, 300, 550, 450, 0x1a1a1a, 0.98).setDepth(500).setStrokeStyle(3, 0x00aaaa);
        elements.push(modalBg);
        
        // Title
        const title = this.add.text(400, 100, "SELECT CLASS", { fontSize: '32px', fill: '#00ffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // Current class display
        const currentConfig = CONFIG.CLASSES[this.persistent.selectedClass.toUpperCase()] || CONFIG.CLASSES.SURVIVOR;
        const currentText = this.add.text(400, 140, `Current: ${currentConfig.icon} ${currentConfig.name}`, { fontSize: '16px', fill: '#aaa' }).setOrigin(0.5).setDepth(501);
        elements.push(currentText);
        
        // Class cards - 2x2 grid
        const classes = Object.values(CONFIG.CLASSES);
        const startX = 220;
        const startY = 200;
        const cardWidth = 170;
        const cardHeight = 100;
        const gap = 20;
        
        classes.forEach((classConfig, index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const x = startX + col * (cardWidth + gap);
            const y = startY + row * (cardHeight + gap);
            
            const isUnlocked = this.persistent.unlockedClasses.includes(classConfig.id);
            const isSelected = this.persistent.selectedClass === classConfig.id;
            
            // Card background
            const cardColor = isSelected ? 0x006666 : (isUnlocked ? 0x333333 : 0x222222);
            const card = this.add.rectangle(x + cardWidth/2, y + cardHeight/2, cardWidth, cardHeight, cardColor).setDepth(501);
            if (isSelected) card.setStrokeStyle(3, 0x00ffff);
            else if (isUnlocked) card.setStrokeStyle(2, 0x555555);
            else card.setStrokeStyle(2, 0x333333);
            elements.push(card);
            
            // Class icon and name
            const iconText = this.add.text(x + 15, y + 10, classConfig.icon, { fontSize: '28px' }).setDepth(502);
            elements.push(iconText);
            
            const nameColor = isUnlocked ? '#fff' : '#666';
            const nameText = this.add.text(x + 55, y + 15, classConfig.name, { fontSize: '18px', fill: nameColor, fontStyle: 'bold' }).setDepth(502);
            elements.push(nameText);
            
            // Description or lock reason
            if (isUnlocked) {
                const descText = this.add.text(x + 10, y + 50, classConfig.desc, { fontSize: '11px', fill: '#aaa', wordWrap: { width: cardWidth - 20 } }).setDepth(502);
                elements.push(descText);
                
                // Make clickable to select
                card.setInteractive();
                card.on('pointerdown', () => {
                    if (this.persistent.selectedClass !== classConfig.id) {
                        this.persistent.selectedClass = classConfig.id;
                        savePersistent(this.persistent);
                        sfx.success();
                        // Refresh modal
                        elements.forEach(e => e.destroy());
                        this.showClassModal();
                    }
                });
                card.on('pointerover', () => {
                    if (!isSelected) card.setFillStyle(0x444444);
                });
                card.on('pointerout', () => {
                    if (!isSelected) card.setFillStyle(0x333333);
                });
            } else {
                // Show unlock requirement
                let unlockReq = "???";
                if (classConfig.id === 'scout') unlockReq = "🔒 Any level no damage";
                else if (classConfig.id === 'medic') unlockReq = "🔒 Heal 50 total HP";
                else if (classConfig.id === 'scavenger') unlockReq = "🔒 Collect 500 scrap";
                
                const lockText = this.add.text(x + 10, y + 50, unlockReq, { fontSize: '11px', fill: '#ff6666', wordWrap: { width: cardWidth - 20 } }).setDepth(502);
                elements.push(lockText);
            }
        });
        
        // Close button
        const closeBtn = this.add.text(400, 480, "[ CLOSE ]", { fontSize: '18px', fill: '#ff4444' }).setOrigin(0.5).setDepth(501).setInteractive();
        elements.push(closeBtn);
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
        });
    }
    
    showSkillsPanel() {
        const elements = [];
        
        // Reload persistent data
        this.persistent = loadPersistent();
        
        // Dark overlay
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85).setDepth(499);
        elements.push(overlay);
        
        // Modal background
        const modalBg = this.add.rectangle(400, 300, 720, 520, 0x1a1a1a, 0.98).setDepth(500).setStrokeStyle(3, 0x8844aa);
        elements.push(modalBg);
        
        // Title with skill points
        const title = this.add.text(400, 65, "SKILL TREE", { fontSize: '28px', fill: '#aa66ff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        const pointsText = this.add.text(400, 95, `Skill Points: ${this.persistent.skillPoints || 0}`, { fontSize: '16px', fill: '#ffff00' }).setOrigin(0.5).setDepth(501);
        elements.push(pointsText);
        
        // Branch headers
        const branches = [
            { id: 'survival', name: 'SURVIVAL', x: 170, color: 0xff4444 },
            { id: 'stealth', name: 'STEALTH', x: 400, color: 0x44ff44 },
            { id: 'utility', name: 'UTILITY', x: 630, color: 0x4488ff }
        ];
        
        branches.forEach(branch => {
            const header = this.add.text(branch.x, 125, branch.name, { 
                fontSize: '16px', fill: '#ffffff', fontStyle: 'bold' 
            }).setOrigin(0.5).setDepth(501);
            elements.push(header);
            
            // Branch divider line
            const line = this.add.rectangle(branch.x, 140, 180, 2, branch.color).setDepth(501);
            elements.push(line);
        });
        
        // Render skills for each branch
        const branchSkills = {
            survival: ['thick_skin', 'iron_will', 'second_wind', 'regeneration', 'last_stand'],
            stealth: ['light_feet', 'shadow_step', 'silent_killer', 'ambush', 'ghost'],
            utility: ['quick_hands', 'haggler', 'scrapper', 'swift_reload', 'pack_mule']
        };
        
        const startY = 160;
        const skillHeight = 70;
        
        Object.entries(branchSkills).forEach(([branchId, skillIds]) => {
            const branch = branches.find(b => b.id === branchId);
            
            skillIds.forEach((skillId, index) => {
                const skillConfig = Object.values(CONFIG.SKILLS).find(s => s.id === skillId);
                if (!skillConfig) return;
                
                const y = startY + index * skillHeight;
                const x = branch.x;
                
                const isUnlocked = this.persistent.unlockedSkills?.includes(skillId);
                const canAfford = (this.persistent.skillPoints || 0) >= skillConfig.cost;
                const hasPrereq = !skillConfig.requires || this.persistent.unlockedSkills?.includes(skillConfig.requires);
                const canPurchase = !isUnlocked && canAfford && hasPrereq;
                
                // Skill card background
                let cardColor = 0x222222; // Locked
                if (isUnlocked) cardColor = 0x226622; // Unlocked
                else if (canPurchase) cardColor = 0x333366; // Can purchase
                else if (!hasPrereq) cardColor = 0x1a1a1a; // Missing prereq
                
                const card = this.add.rectangle(x, y + 25, 170, 60, cardColor).setDepth(501);
                if (isUnlocked) card.setStrokeStyle(2, 0x44ff44);
                else if (canPurchase) card.setStrokeStyle(2, 0x6666ff);
                else card.setStrokeStyle(1, 0x444444);
                elements.push(card);
                
                // Skill name
                const nameColor = isUnlocked ? '#44ff44' : (canPurchase ? '#aaaaff' : '#888888');
                const nameText = this.add.text(x, y + 10, skillConfig.name, { 
                    fontSize: '13px', fill: nameColor, fontStyle: 'bold' 
                }).setOrigin(0.5).setDepth(502);
                elements.push(nameText);
                
                // Skill description
                const descText = this.add.text(x, y + 28, skillConfig.desc, { 
                    fontSize: '10px', fill: '#aaaaaa', wordWrap: { width: 160 }
                }).setOrigin(0.5).setDepth(502);
                elements.push(descText);
                
                // Cost or status
                let statusText;
                if (isUnlocked) {
                    statusText = this.add.text(x, y + 48, '✓ UNLOCKED', { 
                        fontSize: '10px', fill: '#44ff44' 
                    }).setOrigin(0.5).setDepth(502);
                } else if (!hasPrereq) {
                    const prereqSkill = Object.values(CONFIG.SKILLS).find(s => s.id === skillConfig.requires);
                    statusText = this.add.text(x, y + 48, `Requires: ${prereqSkill?.name || 'Unknown'}`, { 
                        fontSize: '10px', fill: '#ff6666' 
                    }).setOrigin(0.5).setDepth(502);
                } else {
                    statusText = this.add.text(x, y + 48, `Cost: ${skillConfig.cost} pts`, { 
                        fontSize: '10px', fill: canAfford ? '#ffff00' : '#ff6666' 
                    }).setOrigin(0.5).setDepth(502);
                }
                elements.push(statusText);
                
                // Make purchasable skills clickable
                if (canPurchase) {
                    card.setInteractive({ useHandCursor: true });
                    card.on('pointerover', () => card.setFillStyle(0x444488));
                    card.on('pointerout', () => card.setFillStyle(0x333366));
                    card.on('pointerdown', () => {
                        this.purchaseSkill(skillId);
                        sfx.success();
                        elements.forEach(e => e.destroy());
                        this.showSkillsPanel();
                    });
                }
                
                // Draw connection line to next skill (if has dependent)
                if (index < skillIds.length - 1) {
                    const nextSkillId = skillIds[index + 1];
                    const nextSkillConfig = Object.values(CONFIG.SKILLS).find(s => s.id === nextSkillId);
                    if (nextSkillConfig?.requires === skillId) {
                        const connLine = this.add.rectangle(x, y + 60, 2, 10, isUnlocked ? 0x44ff44 : 0x444444).setDepth(500);
                        elements.push(connLine);
                    }
                }
            });
        });
        
        // Close button
        const closeBtn = this.add.text(400, 540, "[ CLOSE ]", { 
            fontSize: '18px', fill: '#ff4444' 
        }).setOrigin(0.5).setDepth(510).setInteractive({ useHandCursor: true });
        elements.push(closeBtn);
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
            // Refresh the scene to update button labels with current values
            this.scene.restart({ stats: this.stats });
        });
        closeBtn.on('pointerover', () => closeBtn.setColor('#ff6666'));
        closeBtn.on('pointerout', () => closeBtn.setColor('#ff4444'));
    }
    
    purchaseSkill(skillId) {
        const skillConfig = Object.values(CONFIG.SKILLS).find(s => s.id === skillId);
        if (!skillConfig) return false;
        
        // Verify can purchase
        if (this.persistent.unlockedSkills?.includes(skillId)) return false;
        if ((this.persistent.skillPoints || 0) < skillConfig.cost) return false;
        if (skillConfig.requires && !this.persistent.unlockedSkills?.includes(skillConfig.requires)) return false;
        
        // Purchase the skill
        this.persistent.skillPoints -= skillConfig.cost;
        if (!this.persistent.unlockedSkills) this.persistent.unlockedSkills = [];
        this.persistent.unlockedSkills.push(skillId);
        
        savePersistent(this.persistent);
        return true;
    }
    
    showChallengesPanel() {
        const elements = [];
        
        // Reload and check challenges
        this.persistent = loadPersistent();
        checkChallengeReset(this.persistent);
        
        // Check for completed challenges
        const completedChallenges = checkChallengeCompletion(this.persistent);
        if (completedChallenges.length > 0) {
            completedChallenges.forEach(c => {
                sfx.achievement();
            });
            savePersistent(this.persistent);
        }
        
        // Dark overlay
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85).setDepth(499);
        elements.push(overlay);
        
        // Modal background
        const modalBg = this.add.rectangle(400, 300, 700, 530, 0x1a1a1a, 0.98).setDepth(500).setStrokeStyle(3, 0x448844);
        elements.push(modalBg);
        
        // Title
        const title = this.add.text(400, 60, "CHALLENGES", { fontSize: '28px', fill: '#66ff66', fontStyle: 'bold' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // Skill points display
        const pointsText = this.add.text(400, 90, `Skill Points: ${this.persistent.skillPoints || 0}`, { fontSize: '14px', fill: '#ffff00' }).setOrigin(0.5).setDepth(501);
        elements.push(pointsText);
        
        let yPos = 115;
        
        // === DAILY CHALLENGES ===
        const dailyResetTime = this.persistent.dailyResetTime - Date.now();
        const dailyHeader = this.add.text(80, yPos, `DAILY (Resets in ${formatTimeRemaining(dailyResetTime)})`, { fontSize: '14px', fill: '#ffaa00', fontStyle: 'bold' }).setDepth(501);
        elements.push(dailyHeader);
        yPos += 25;
        
        this.persistent.activeDailies?.forEach((challenge, index) => {
            const config = CONFIG.CHALLENGES.DAILY.find(c => c.id === challenge.id);
            if (!config) return;
            
            const isComplete = challenge.progress >= config.target;
            const isClaimed = challenge.claimed;
            
            // Challenge card
            const cardColor = isClaimed ? 0x224422 : (isComplete ? 0x336633 : 0x2a2a2a);
            const card = this.add.rectangle(400, yPos + 20, 620, 40, cardColor).setDepth(501);
            if (isComplete && !isClaimed) card.setStrokeStyle(2, 0x88ff88);
            elements.push(card);
            
            // Challenge name and desc
            const nameText = this.add.text(100, yPos + 12, config.name, { fontSize: '13px', fill: isClaimed ? '#666666' : '#ffffff', fontStyle: 'bold' }).setDepth(502);
            elements.push(nameText);
            
            const descText = this.add.text(100, yPos + 28, config.desc, { fontSize: '10px', fill: '#888888' }).setDepth(502);
            elements.push(descText);
            
            // Progress bar
            const progress = Math.min(challenge.progress / config.target, 1);
            const barBg = this.add.rectangle(550, yPos + 15, 120, 12, 0x333333).setDepth(502);
            elements.push(barBg);
            if (progress > 0) {
                const barFill = this.add.rectangle(490 + (progress * 60), yPos + 15, progress * 120, 10, isComplete ? 0x44ff44 : 0xffaa00).setDepth(503);
                elements.push(barFill);
            }
            
            // Progress text
            const progressText = this.add.text(550, yPos + 15, `${challenge.progress}/${config.target}`, { fontSize: '9px', fill: '#fff' }).setOrigin(0.5).setDepth(504);
            elements.push(progressText);
            
            // Reward/Status
            const rewardText = this.add.text(660, yPos + 20, isClaimed ? 'CLAIMED' : (isComplete ? 'CLAIM!' : `+${config.reward} pts`), { 
                fontSize: '11px', fill: isClaimed ? '#666666' : (isComplete ? '#88ff88' : '#ffff00')
            }).setOrigin(0.5).setDepth(502);
            elements.push(rewardText);
            
            // Make claimable challenges clickable
            if (isComplete && !isClaimed) {
                card.setInteractive({ useHandCursor: true });
                card.on('pointerdown', () => {
                    challenge.claimed = true;
                    this.persistent.skillPoints = (this.persistent.skillPoints || 0) + config.reward;
                    this.persistent.totalSkillPoints = (this.persistent.totalSkillPoints || 0) + config.reward;
                    savePersistent(this.persistent);
                    sfx.success();
                    elements.forEach(e => e.destroy());
                    this.showChallengesPanel();
                });
            }
            
            yPos += 45;
        });
        
        yPos += 10;
        
        // === WEEKLY CHALLENGES ===
        const weeklyResetTime = this.persistent.weeklyResetTime - Date.now();
        const weeklyHeader = this.add.text(80, yPos, `WEEKLY (Resets in ${formatTimeRemaining(weeklyResetTime)})`, { fontSize: '14px', fill: '#00aaff', fontStyle: 'bold' }).setDepth(501);
        elements.push(weeklyHeader);
        yPos += 25;
        
        this.persistent.activeWeeklies?.forEach((challenge, index) => {
            const config = CONFIG.CHALLENGES.WEEKLY.find(c => c.id === challenge.id);
            if (!config) return;
            
            const isComplete = challenge.progress >= config.target;
            const isClaimed = challenge.claimed;
            
            const cardColor = isClaimed ? 0x222244 : (isComplete ? 0x333366 : 0x2a2a2a);
            const card = this.add.rectangle(400, yPos + 20, 620, 40, cardColor).setDepth(501);
            if (isComplete && !isClaimed) card.setStrokeStyle(2, 0x88aaff);
            elements.push(card);
            
            const nameText = this.add.text(100, yPos + 12, config.name, { fontSize: '13px', fill: isClaimed ? '#666666' : '#ffffff', fontStyle: 'bold' }).setDepth(502);
            elements.push(nameText);
            
            const descText = this.add.text(100, yPos + 28, config.desc, { fontSize: '10px', fill: '#888888' }).setDepth(502);
            elements.push(descText);
            
            const progress = Math.min(challenge.progress / config.target, 1);
            const barBg = this.add.rectangle(550, yPos + 15, 120, 12, 0x333333).setDepth(502);
            elements.push(barBg);
            if (progress > 0) {
                const barFill = this.add.rectangle(490 + (progress * 60), yPos + 15, progress * 120, 10, isComplete ? 0x4488ff : 0xffaa00).setDepth(503);
                elements.push(barFill);
            }
            
            const progressText = this.add.text(550, yPos + 15, `${challenge.progress}/${config.target}`, { fontSize: '9px', fill: '#fff' }).setOrigin(0.5).setDepth(504);
            elements.push(progressText);
            
            const rewardText = this.add.text(660, yPos + 20, isClaimed ? 'CLAIMED' : (isComplete ? 'CLAIM!' : `+${config.reward} pts`), { 
                fontSize: '11px', fill: isClaimed ? '#666666' : (isComplete ? '#88aaff' : '#ffff00')
            }).setOrigin(0.5).setDepth(502);
            elements.push(rewardText);
            
            if (isComplete && !isClaimed) {
                card.setInteractive({ useHandCursor: true });
                card.on('pointerdown', () => {
                    challenge.claimed = true;
                    this.persistent.skillPoints = (this.persistent.skillPoints || 0) + config.reward;
                    this.persistent.totalSkillPoints = (this.persistent.totalSkillPoints || 0) + config.reward;
                    savePersistent(this.persistent);
                    sfx.success();
                    elements.forEach(e => e.destroy());
                    this.showChallengesPanel();
                });
            }
            
            yPos += 45;
        });
        
        // Close button
        const closeBtn = this.add.text(400, 550, "[ CLOSE ]", { fontSize: '18px', fill: '#ff4444' }).setOrigin(0.5).setDepth(510).setInteractive({ useHandCursor: true });
        elements.push(closeBtn);
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
            // Refresh the scene to update button labels with current values
            this.scene.restart({ stats: this.stats });
        });
        closeBtn.on('pointerover', () => closeBtn.setColor('#ff6666'));
        closeBtn.on('pointerout', () => closeBtn.setColor('#ff4444'));
    }
    
    showUpgradesPanel() {
        // Reload persistent data to get latest stats
        this.persistent = loadPersistent();
        
        // Check for newly unlocked upgrades before showing panel
        const newUpgrades = checkUpgrades(this.persistent);
        if (newUpgrades.length > 0) {
            savePersistent(this.persistent);
            // Show notification for newly unlocked upgrades
            newUpgrades.forEach(u => {
                this.showFloatingText(400, 250, `UNLOCKED: ${u.name}!`, '#88ff88');
            });
        }
        
        const elements = [];
        if (!this.upgradeTab) this.upgradeTab = 'gear'; // Current tab (preserve across refreshes)
        
        // Dark overlay - NOT interactive, just visual
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.8).setDepth(499);
        elements.push(overlay);
        
        // Modal background
        const modalBg = this.add.rectangle(400, 300, 650, 500, 0x1a1a1a, 0.98).setDepth(500).setStrokeStyle(3, 0xffaa00);
        elements.push(modalBg);
        
        // Title
        const title = this.add.text(400, 75, "PERMANENT UPGRADES", { fontSize: '28px', fill: '#ffaa00', fontStyle: 'bold' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // Tab buttons - positioned in a row
        const tabData = [
            { id: 'gear', label: 'GEAR' },
            { id: 'stats', label: 'STATS' },
            { id: 'skin', label: 'SKINS' },
            { id: 'muzzle', label: 'EFFECTS' }
        ];
        
        const tabStartX = 170;
        const tabSpacing = 130;
        const tabY = 115;
        
        tabData.forEach((tab, index) => {
            const tabX = tabStartX + index * tabSpacing;
            const isActive = this.upgradeTab === tab.id;
            
            // Tab button background
            const btn = this.add.rectangle(tabX, tabY, 110, 30, isActive ? 0xffaa00 : 0x444444).setDepth(510).setInteractive({ useHandCursor: true });
            elements.push(btn);
            
            // Tab label
            const label = this.add.text(tabX, tabY, tab.label, { 
                fontSize: '14px', 
                fill: isActive ? '#000' : '#fff',
                fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(511);
            elements.push(label);
            
            // Click handler
            btn.on('pointerdown', () => {
                this.upgradeTab = tab.id;
                sfx.click();
                elements.forEach(e => e.destroy());
                this.showUpgradesPanel();
            });
            
            // Hover effects for inactive tabs
            if (!isActive) {
                btn.on('pointerover', () => {
                    btn.setFillStyle(0x666666);
                    label.setColor('#ffaa00');
                });
                btn.on('pointerout', () => {
                    btn.setFillStyle(0x444444);
                    label.setColor('#fff');
                });
            }
        });
        
        // Render upgrade items for current tab
        this.renderUpgradeItems(elements, this.upgradeTab);
        
        // Close button
        const closeBtn = this.add.text(400, 530, "[ CLOSE ]", { 
            fontSize: '18px', 
            fill: '#ff4444' 
        }).setOrigin(0.5).setDepth(510).setInteractive({ useHandCursor: true });
        elements.push(closeBtn);
        closeBtn.on('pointerdown', () => {
            sfx.menuClose();
            elements.forEach(e => e.destroy());
        });
        closeBtn.on('pointerover', () => closeBtn.setColor('#ff6666'));
        closeBtn.on('pointerout', () => closeBtn.setColor('#ff4444'));
    }
    
    renderUpgradeItems(elements, category) {
        const upgrades = Object.values(CONFIG.UPGRADES).filter(u => u.category === category);
        const startY = 160;
        const itemHeight = 70;
        
        // Show message if no upgrades in this category
        if (upgrades.length === 0) {
            const noItems = this.add.text(400, 300, 'No upgrades in this category', { fontSize: '16px', fill: '#666' }).setOrigin(0.5).setDepth(502);
            elements.push(noItems);
            return;
        }
        
        upgrades.forEach((upgrade, index) => {
            const y = startY + index * itemHeight;
            const isUnlocked = this.persistent.unlockedUpgrades?.includes(upgrade.id);
            const isEquipped = (category === 'skin' && this.persistent.equippedSkin === upgrade.id) ||
                              (category === 'muzzle' && this.persistent.equippedMuzzle === upgrade.id);
            
            // Card background
            const cardColor = isEquipped ? 0x446644 : (isUnlocked ? 0x333333 : 0x222222);
            const card = this.add.rectangle(400, y + 25, 580, 60, cardColor).setDepth(501);
            if (isEquipped) card.setStrokeStyle(2, 0x88ff88);
            else if (isUnlocked) card.setStrokeStyle(1, 0x555555);
            elements.push(card);
            
            // Icon and name
            const icon = this.add.text(130, y + 10, upgrade.icon || '?', { fontSize: '24px' }).setDepth(502);
            elements.push(icon);
            
            const nameColor = isUnlocked ? '#fff' : '#888';
            const name = this.add.text(170, y + 10, upgrade.name, { fontSize: '18px', fill: nameColor, fontStyle: 'bold' }).setDepth(502);
            elements.push(name);
            
            // Description
            const desc = this.add.text(170, y + 35, upgrade.desc, { fontSize: '12px', fill: '#aaa' }).setDepth(502);
            elements.push(desc);
            
            if (isUnlocked) {
                // Show checkmark or equip button for cosmetics
                if (category === 'skin' || category === 'muzzle') {
                    if (isEquipped) {
                        const equipped = this.add.text(620, y + 25, '✓ EQUIPPED', { fontSize: '12px', fill: '#88ff88' }).setOrigin(0.5).setDepth(502);
                        elements.push(equipped);
                    } else {
                        const equipBtn = this.add.rectangle(620, y + 25, 80, 30, 0x446688).setDepth(515).setInteractive({ useHandCursor: true });
                        elements.push(equipBtn);
                        const equipText = this.add.text(620, y + 25, 'EQUIP', { fontSize: '12px', fill: '#fff' }).setOrigin(0.5).setDepth(516);
                        elements.push(equipText);
                        
                        equipBtn.on('pointerdown', () => {
                            if (category === 'skin') {
                                this.persistent.equippedSkin = upgrade.id;
                            } else if (category === 'muzzle') {
                                this.persistent.equippedMuzzle = upgrade.id;
                            }
                            savePersistent(this.persistent);
                            sfx.success();
                            elements.forEach(e => e.destroy());
                            this.showUpgradesPanel();
                        });
                        equipBtn.on('pointerover', () => equipBtn.setFillStyle(0x5577aa));
                        equipBtn.on('pointerout', () => equipBtn.setFillStyle(0x446688));
                    }
                } else {
                    // Non-cosmetic: just show checkmark
                    const check = this.add.text(620, y + 25, '✓ UNLOCKED', { fontSize: '12px', fill: '#88ff88' }).setOrigin(0.5).setDepth(502);
                    elements.push(check);
                }
            } else {
                // Show progress bar
                const req = upgrade.requirement;
                const current = this.persistent[req.stat] || 0;
                const progress = Math.min(current / req.value, 1);
                
                // Progress bar background
                const barBg = this.add.rectangle(540, y + 25, 150, 16, 0x222222).setDepth(502);
                elements.push(barBg);
                
                // Progress bar fill
                if (progress > 0) {
                    const barFill = this.add.rectangle(465 + (progress * 150) / 2, y + 25, progress * 150, 12, 0xffaa00).setDepth(503);
                    elements.push(barFill);
                }
                
                // Progress text
                const progressText = this.add.text(540, y + 25, `${current}/${req.value}`, { fontSize: '10px', fill: '#fff' }).setOrigin(0.5).setDepth(504);
                elements.push(progressText);
            }
        });
    }
    
    showTraderModal(initialTab) {
        const elements = [];
        this.traderTab = initialTab === 'quests' ? 'quests' : (initialTab === 'sell' ? 'sell' : 'buy');
        this.traderScrollOffset = 0; // Track scroll position for buy items
        this.traderSellScrollOffset = 0; // Track scroll position for sell items
        
        // Dark overlay - click to close
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.7).setDepth(499).setInteractive();
        elements.push(overlay);
        overlay.on('pointerdown', () => this.closeTraderModal(elements));
        
        // Modal background
        const modalBg = this.add.rectangle(400, 300, 600, 480, 0x1a1a1a, 0.98).setDepth(500).setStrokeStyle(3, 0xffd700);
        elements.push(modalBg);
        
        // Title
        const title = this.add.text(400, 85, "SHOP", { fontSize: '36px', fill: '#ffd700', fontStyle: 'bold' }).setOrigin(0.5).setDepth(501);
        elements.push(title);
        
        // Currency display (stored at hideout stash)
        const currencyText = this.add.text(400, 120, 
            `💰 Credits: ${this.persistent.credits || 0}  |  🔧 Scrap: ${this.persistent.scrap || 0}  |  ⚙️ Materials: ${this.persistent.materials || 0}`,
            { fontSize: '14px', fill: '#ccc' }
        ).setOrigin(0.5).setDepth(501);
        elements.push(currencyText);
        this.traderCurrencyText = currencyText;
        
        // Tab buttons (Buy, Quests, Sell)
        const buyTab = this.add.rectangle(280, 155, 100, 35, 0xffd700).setDepth(501).setInteractive();
        const buyTabText = this.add.text(280, 155, "BUY", { fontSize: '16px', fill: '#000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(502);
        elements.push(buyTab, buyTabText);
        
        const questsTab = this.add.rectangle(400, 155, 100, 35, 0x444444).setDepth(501).setInteractive();
        const questsTabText = this.add.text(400, 155, "QUESTS", { fontSize: '14px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(questsTab, questsTabText);
        
        const sellTab = this.add.rectangle(520, 155, 100, 35, 0x444444).setDepth(501).setInteractive();
        const sellTabText = this.add.text(520, 155, "SELL", { fontSize: '16px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
        elements.push(sellTab, sellTabText);
        
        // Content area (interactive for mouse wheel scrolling)
        const contentBg = this.add.rectangle(400, 350, 560, 280, 0x222222).setDepth(500).setInteractive();
        elements.push(contentBg);
        
        // Mouse wheel scrolling for trader
        contentBg.on('wheel', (pointer, deltaX, deltaY) => {
            const maxVisibleItems = 6;
            if (this.traderTab === 'buy') {
                const totalItems = CONFIG.TRADER.HIDEOUT_STOCK.length;
                const maxScroll = Math.max(0, totalItems - maxVisibleItems);
                
                if (deltaY > 0 && this.traderScrollOffset < maxScroll) {
                    this.traderScrollOffset++;
                    this.renderTraderItems(elements);
                } else if (deltaY < 0 && this.traderScrollOffset > 0) {
                    this.traderScrollOffset--;
                    this.renderTraderItems(elements);
                }
            } else if (this.traderTab === 'sell' && (this.traderSellItemCount || 0) > maxVisibleItems) {
                const totalItems = this.traderSellItemCount;
                const maxScroll = Math.max(0, totalItems - maxVisibleItems);
                
                if (deltaY > 0 && this.traderSellScrollOffset < maxScroll) {
                    this.traderSellScrollOffset++;
                    this.renderTraderItems(elements);
                } else if (deltaY < 0 && this.traderSellScrollOffset > 0) {
                    this.traderSellScrollOffset--;
                    this.renderTraderItems(elements);
                }
            }
        });
        
        // Store item elements reference for tab switching
        this.traderItemElements = [];
        
        const setTabStyle = (active) => {
            const isBuy = active === 'buy', isQuests = active === 'quests', isSell = active === 'sell';
            buyTab.setFillStyle(isBuy ? 0xffd700 : 0x444444);
            buyTabText.setColor(isBuy ? '#000' : '#fff');
            questsTab.setFillStyle(isQuests ? 0xffd700 : 0x444444);
            questsTabText.setColor(isQuests ? '#000' : '#fff');
            sellTab.setFillStyle(isSell ? 0xffd700 : 0x444444);
            sellTabText.setColor(isSell ? '#000' : '#fff');
        };
        buyTab.on('pointerdown', () => { sfx.click(); this.traderTab = 'buy'; setTabStyle('buy'); this.renderTraderItems(elements); });
        questsTab.on('pointerdown', () => { sfx.click(); this.traderTab = 'quests'; setTabStyle('quests'); this.renderTraderItems(elements); });
        sellTab.on('pointerdown', () => { sfx.click(); this.traderTab = 'sell'; setTabStyle('sell'); this.renderTraderItems(elements); });
        setTabStyle(this.traderTab); // Show correct tab when opened with initialTab (e.g. from Quests box)
        
        // Heal Up button (testing: restore all limbs to 100%, clear effects, free) — depth 510 so it stays above trader list
        const healUpBtn = this.add.rectangle(400, 475, 140, 32, 0xcc2222).setDepth(510).setInteractive({ useHandCursor: true });
        const healUpText = this.add.text(400, 475, "Heal Up", { fontSize: '16px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(511);
        elements.push(healUpBtn, healUpText);
        healUpBtn.on('pointerdown', () => {
            sfx.click();
            if (!this.stats.limbHp) this.stats.limbHp = getDefaultLimbHp();
            Object.keys(LIMB_MAX_HP).forEach(limbId => {
                const max = LIMB_MAX_HP[limbId];
                this.stats.limbHp[limbId] = { hp: max, maxHp: max, status: '', effects: [] };
            });
            this.stats.hp = sumLimbHp(this.stats.limbHp);
            this.stats.maxHp = sumLimbMaxHp(this.stats.limbHp);
        });
        healUpBtn.on('pointerover', () => healUpBtn.setFillStyle(0xee4444));
        healUpBtn.on('pointerout', () => healUpBtn.setFillStyle(0xcc2222));
        
        // Close button
        const closeBtn = this.add.text(400, 520, "[ CLOSE ]", { fontSize: '18px', fill: '#ff4444' }).setOrigin(0.5).setDepth(501).setInteractive();
        elements.push(closeBtn);
        closeBtn.on('pointerdown', () => this.closeTraderModal(elements));
        
        // Store elements reference
        this.traderElements = elements;
        
        // Render initial items
        this.renderTraderItems(elements);
    }
    
    renderTraderItems(elements) {
        // Clear previous item elements
        if (this.traderItemElements) {
            this.traderItemElements.forEach(e => e.destroy());
        }
        this.traderItemElements = [];
        
        const startY = 195;
        const itemHeight = 45;
        const maxVisibleItems = 6; // Show 6 items at a time
        
        if (this.traderTab === 'buy') {
            const allItems = CONFIG.TRADER.HIDEOUT_STOCK;
            const totalItems = allItems.length;
            const maxScroll = Math.max(0, totalItems - maxVisibleItems);
            
            // Clamp scroll offset
            if (this.traderScrollOffset === undefined) this.traderScrollOffset = 0;
            this.traderScrollOffset = Math.max(0, Math.min(this.traderScrollOffset, maxScroll));
            
            // Render visible items
            const visibleItems = allItems.slice(this.traderScrollOffset, this.traderScrollOffset + maxVisibleItems);
            visibleItems.forEach((item, i) => {
                const y = startY + i * itemHeight;
                
                // Item name
                const nameText = this.add.text(150, y, item.name, { fontSize: '16px', fill: '#fff' }).setDepth(501);
                this.traderItemElements.push(nameText);
                
                // Item description
                let desc = '';
                if (item.type === 'ammo') desc = `+${item.amount} ammo`;
                else if (item.type === 'heal') desc = `+${item.amount} HP`;
                else if (item.type === 'grenade') desc = `+${item.amount} grenade`;
                else if (item.type === 'consumable') desc = CONFIG.CONSUMABLES[item.id]?.icon || '';
                else if (item.type === 'mod') {
                    const modConfig = Object.values(CONFIG.MODS).find(m => m.id === item.id);
                    desc = modConfig ? modConfig.desc : 'Weapon mod';
                } else if (item.type === 'magazine') desc = 'Empty mag';
                
                const descText = this.add.text(300, y, desc, { fontSize: '12px', fill: '#888' }).setDepth(501);
                this.traderItemElements.push(descText);
                
                // Cost (with Haggler discount if applicable)
                const currIcon = CONFIG.CURRENCIES[item.currency.toUpperCase()].icon;
                const hasHaggler = this.persistent.unlockedSkills?.includes('haggler');
                const displayCost = hasHaggler ? Math.floor(item.cost * 0.85) : item.cost;
                const costColor = hasHaggler ? '#88ff88' : '#ffd700'; // Green if discounted
                const costText = this.add.text(480, y, `${displayCost} ${currIcon}`, { fontSize: '14px', fill: costColor }).setDepth(501);
                this.traderItemElements.push(costText);
                
                // Buy button (spend from hideout stash)
                const canAfford = (this.persistent[item.currency] || 0) >= displayCost;
                const buyBtn = this.add.rectangle(600, y + 8, 70, 28, canAfford ? 0x00aa00 : 0x444444).setDepth(501).setInteractive();
                const buyBtnText = this.add.text(600, y + 8, "BUY", { fontSize: '14px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
                this.traderItemElements.push(buyBtn, buyBtnText);
                
                if (canAfford) {
                    buyBtn.on('pointerdown', () => {
                        if (this.purchaseItem(item)) {
                            this.updateTraderCurrency();
                            this.renderTraderItems(elements);
                        }
                    });
                    buyBtn.on('pointerover', () => buyBtn.setAlpha(0.8));
                    buyBtn.on('pointerout', () => buyBtn.setAlpha(1));
                }
            });
            
            // Scroll buttons (only show if needed)
            if (totalItems > maxVisibleItems) {
                // Scroll up button
                const canScrollUp = this.traderScrollOffset > 0;
                const upBtn = this.add.text(640, 180, '▲', { fontSize: '20px', fill: canScrollUp ? '#ffd700' : '#444' })
                    .setDepth(503).setInteractive({ useHandCursor: canScrollUp });
                this.traderItemElements.push(upBtn);
                if (canScrollUp) {
                    upBtn.on('pointerdown', () => {
                        this.traderScrollOffset--;
                        sfx.click();
                        this.renderTraderItems(elements);
                    });
                }
                
                // Scroll down button
                const canScrollDown = this.traderScrollOffset < maxScroll;
                const downBtn = this.add.text(640, 460, '▼', { fontSize: '20px', fill: canScrollDown ? '#ffd700' : '#444' })
                    .setDepth(503).setInteractive({ useHandCursor: canScrollDown });
                this.traderItemElements.push(downBtn);
                if (canScrollDown) {
                    downBtn.on('pointerdown', () => {
                        this.traderScrollOffset++;
                        sfx.click();
                        this.renderTraderItems(elements);
                    });
                }
                
                // Scroll indicator
                const scrollText = this.add.text(640, 320, `${this.traderScrollOffset + 1}-${Math.min(this.traderScrollOffset + maxVisibleItems, totalItems)}/${totalItems}`, 
                    { fontSize: '10px', fill: '#666' }).setOrigin(0.5).setDepth(503);
                this.traderItemElements.push(scrollText);
            }
        } else if (this.traderTab === 'quests') {
            if (!this.persistent.stash) this.persistent.stash = { gridW: 12, gridH: 16, items: [], _nextId: 1 };
            if (!this.stats.backpack) this.stats.backpack = getDefaultBackpack();
            const stash = this.persistent.stash;
            const backpack = this.stats.backpack;
            ensureGridItems(stash);
            ensureGridItems(backpack);
            const active = this.persistent.activeQuests || [];
            const completed = this.persistent.completedQuests || [];
            const quests = CONFIG.TRADER_QUESTS || [];
            if (quests.length === 0) {
                const noQuests = this.add.text(400, 300, "No quests available", { fontSize: '16px', fill: '#666' }).setOrigin(0.5).setDepth(501);
                this.traderItemElements.push(noQuests);
            } else {
                quests.forEach((q, i) => {
                    const y = startY + i * (itemHeight + 8);
                    const done = completed.includes(q.id);
                    const accepted = active.includes(q.id);
                    const req = q.require || {};
                    const itemId = req.itemId || '';
                    const need = req.count || 0;
                    const have = countItemInGrids(stash, backpack, itemId);
                    const turnedIn = (this.persistent.questTurnInProgress || {})[q.id] || 0;
                    const cfg = getInventoryItemConfig(itemId);
                    const itemLabel = (cfg && cfg.label) ? cfg.label : itemId;
                    const nameText = this.add.text(120, y, q.name, { fontSize: '15px', fill: done ? '#666' : accepted ? '#ffaa00' : '#aaa', fontStyle: 'bold' }).setDepth(501);
                    this.traderItemElements.push(nameText);
                    const descText = this.add.text(120, y + 18, q.desc, { fontSize: '11px', fill: '#888' }).setDepth(501);
                    this.traderItemElements.push(descText);
                    if (done) {
                        const progText = this.add.text(400, y + 9, 'DONE', { fontSize: '13px', fill: '#666' }).setOrigin(0.5).setDepth(501);
                        this.traderItemElements.push(progText);
                    } else if (accepted) {
                        const progressStr = turnedIn > 0 ? `${itemLabel}: ${turnedIn}/${need} turned in · ${have} in stash` : `${itemLabel}: ${have}/${need}`;
                        const progText = this.add.text(400, y + 9, progressStr, { fontSize: '12px', fill: (turnedIn >= need || have >= need - turnedIn) ? '#0f0' : '#aaa' }).setOrigin(0.5).setDepth(501);
                        this.traderItemElements.push(progText);
                        const canTurnIn = have >= 1 && turnedIn < need;
                        if (canTurnIn) {
                            const turnInBtn = this.add.rectangle(580, y + 9, 80, 26, 0x228822).setDepth(501).setInteractive();
                            const turnInTxt = this.add.text(580, y + 9, "TURN IN", { fontSize: '12px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
                            this.traderItemElements.push(turnInBtn, turnInTxt);
                            turnInBtn.on('pointerdown', () => {
                                const maxTurnIn = Math.min(have, need - turnedIn);
                                if (maxTurnIn <= 0) return;
                                this.showQuestTurnInModal(q, itemLabel, have, turnedIn, need, maxTurnIn, elements);
                            });
                            turnInBtn.on('pointerover', () => turnInBtn.setFillStyle(0x33aa33));
                            turnInBtn.on('pointerout', () => turnInBtn.setFillStyle(0x228822));
                        }
                    } else {
                        const progText = this.add.text(400, y + 9, '—', { fontSize: '13px', fill: '#555' }).setOrigin(0.5).setDepth(501);
                        this.traderItemElements.push(progText);
                        const acceptBtn = this.add.rectangle(580, y + 9, 80, 26, 0x446644).setDepth(501).setInteractive();
                        const acceptTxt = this.add.text(580, y + 9, "ACCEPT", { fontSize: '12px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
                        this.traderItemElements.push(acceptBtn, acceptTxt);
                        acceptBtn.on('pointerdown', () => {
                            if (!this.persistent.activeQuests) this.persistent.activeQuests = [];
                            this.persistent.activeQuests.push(q.id);
                            savePersistent(this.persistent);
                            sfx.click();
                            this.renderTraderItems(elements);
                        });
                        acceptBtn.on('pointerover', () => acceptBtn.setFillStyle(0x558855));
                        acceptBtn.on('pointerout', () => acceptBtn.setFillStyle(0x446644));
                    }
                });
            }
        } else {
            // Render sell items
            let y = startY;
            const sellItems = [];
            
            // Add armor pieces that can be sold
            const armorSlots = ['head', 'body', 'arms', 'feet'];
            armorSlots.forEach(slot => {
                if (this.stats.armor[slot]) {
                    sellItems.push({
                        type: 'armor',
                        slot: slot,
                        name: this.stats.armor[slot].name,
                        value: Math.floor(20 * CONFIG.TRADER.SELL_RATE)
                    });
                }
            });
            
            // Add consumables that can be sold
            this.stats.consumables.forEach((cons, idx) => {
                if (cons) {
                    const config = CONFIG.CONSUMABLES[cons];
                    sellItems.push({
                        type: 'consumable',
                        slot: idx,
                        name: config.name,
                        value: Math.floor(25 * CONFIG.TRADER.SELL_RATE)
                    });
                }
            });
            
            // Add unequipped weapon mods that can be sold
            const modInventory = this.persistent.modInventory || [];
            const modCounts = {};
            modInventory.forEach(modId => {
                modCounts[modId] = (modCounts[modId] || 0) + 1;
            });
            
            Object.entries(modCounts).forEach(([modId, count]) => {
                const modConfig = Object.values(CONFIG.MODS).find(m => m.id === modId);
                if (modConfig) {
                    const baseCost = modConfig.cost?.amount || 15;
                    const sellValue = Math.floor(baseCost * 0.5);
                    sellItems.push({
                        type: 'mod',
                        modId: modId,
                        name: `${modConfig.name}${count > 1 ? ' (x' + count + ')' : ''}`,
                        displayName: modConfig.name,
                        value: sellValue,
                        count: count
                    });
                }
            });
            
            // Add weapons, armor, and attachments from stash and backpack
            const sellGrid = CONFIG.TRADER.SELL_GRID || {};
            [this.persistent.stash, this.stats.backpack].forEach((grid, idx) => {
                if (!grid || !grid.items) return;
                const source = idx === 0 ? 'Stash' : 'Backpack';
                grid.items.forEach(p => {
                    const price = sellGrid[p.itemId];
                    if (!price) return;
                    const cfg = getInventoryItemConfig(p.itemId);
                    const label = (cfg && cfg.label) ? cfg.label : p.itemId;
                    const count = p.count || 1;
                    const currency = price.credits != null ? 'credits' : 'materials';
                    const valueNum = (price.credits != null ? price.credits : price.materials) * count;
                    sellItems.push({
                        type: 'grid',
                        grid: grid,
                        placementId: p.placementId,
                        itemId: p.itemId,
                        count: count,
                        name: `${label}${count > 1 ? ' (x' + count + ')' : ''} [${source}]`,
                        value: valueNum,
                        currency: currency
                    });
                });
            });
            
            this.traderSellItemCount = sellItems.length;
            if (sellItems.length === 0) {
                const noItems = this.add.text(400, 300, "Nothing to sell", { fontSize: '18px', fill: '#666' }).setOrigin(0.5).setDepth(501);
                this.traderItemElements.push(noItems);
            } else {
                // Clamp scroll offset for sell list
                if (this.traderSellScrollOffset === undefined) this.traderSellScrollOffset = 0;
                const totalSellItems = sellItems.length;
                const maxSellScroll = Math.max(0, totalSellItems - maxVisibleItems);
                this.traderSellScrollOffset = Math.max(0, Math.min(this.traderSellScrollOffset, maxSellScroll));
                
                const visibleSellItems = sellItems.slice(this.traderSellScrollOffset, this.traderSellScrollOffset + maxVisibleItems);
                visibleSellItems.forEach((item, i) => {
                    const itemY = startY + i * itemHeight;
                    
                    const nameColor = (item.type === 'mod' || item.type === 'grid') ? (item.type === 'mod' ? '#cc88ff' : '#aaccff') : '#fff';
                    const nameText = this.add.text(150, itemY, item.name, { fontSize: '16px', fill: nameColor }).setDepth(501);
                    this.traderItemElements.push(nameText);
                    
                    const currencyIcon = (item.type === 'mod' || (item.type === 'grid' && item.currency === 'materials')) ? '⚙️' : '💰';
                    const valueText = this.add.text(450, itemY, `+${item.value} ${currencyIcon}`, { fontSize: '14px', fill: '#00ff00' }).setDepth(501);
                    this.traderItemElements.push(valueText);
                    
                    const sellBtn = this.add.rectangle(600, itemY + 8, 70, 28, 0xaa0000).setDepth(501).setInteractive();
                    const sellBtnText = this.add.text(600, itemY + 8, "SELL", { fontSize: '14px', fill: '#fff' }).setOrigin(0.5).setDepth(502);
                    this.traderItemElements.push(sellBtn, sellBtnText);
                    
                    sellBtn.on('pointerdown', () => {
                        this.sellItem(item);
                        this.updateTraderCurrency();
                        this.renderTraderItems(elements);
                    });
                    sellBtn.on('pointerover', () => sellBtn.setAlpha(0.8));
                    sellBtn.on('pointerout', () => sellBtn.setAlpha(1));
                });
                
                // Scroll buttons for sell list (only show if needed)
                if (totalSellItems > maxVisibleItems) {
                    const canScrollUp = this.traderSellScrollOffset > 0;
                    const upBtn = this.add.text(640, 180, '▲', { fontSize: '20px', fill: canScrollUp ? '#ffd700' : '#444' })
                        .setDepth(503).setInteractive({ useHandCursor: canScrollUp });
                    this.traderItemElements.push(upBtn);
                    if (canScrollUp) {
                        upBtn.on('pointerdown', () => {
                            this.traderSellScrollOffset--;
                            sfx.click();
                            this.renderTraderItems(elements);
                        });
                    }
                    
                    const canScrollDown = this.traderSellScrollOffset < maxSellScroll;
                    const downBtn = this.add.text(640, 460, '▼', { fontSize: '20px', fill: canScrollDown ? '#ffd700' : '#444' })
                        .setDepth(503).setInteractive({ useHandCursor: canScrollDown });
                    this.traderItemElements.push(downBtn);
                    if (canScrollDown) {
                        downBtn.on('pointerdown', () => {
                            this.traderSellScrollOffset++;
                            sfx.click();
                            this.renderTraderItems(elements);
                        });
                    }
                    
                    const scrollText = this.add.text(640, 320, `${this.traderSellScrollOffset + 1}-${Math.min(this.traderSellScrollOffset + maxVisibleItems, totalSellItems)}/${totalSellItems}`,
                        { fontSize: '10px', fill: '#666' }).setOrigin(0.5).setDepth(503);
                    this.traderItemElements.push(scrollText);
                }
            }
        }
    }
    
    updateTraderCurrency() {
        if (this.traderCurrencyText) {
            this.traderCurrencyText.setText(
                `💰 Credits: ${this.persistent.credits || 0}  |  🔧 Scrap: ${this.persistent.scrap || 0}  |  ⚙️ Materials: ${this.persistent.materials || 0}`
            );
        }
        this.updateResourceText();
    }
    
    showQuestTurnInModal(quest, itemLabel, have, turnedIn, need, maxTurnIn, elements) {
        const itemId = (quest.require || {}).itemId || '';
        if (!this.persistent.stash) this.persistent.stash = { gridW: 12, gridH: 16, items: [], _nextId: 1 };
        if (!this.stats.backpack) this.stats.backpack = getDefaultBackpack();
        ensureGridItems(this.persistent.stash);
        ensureGridItems(this.stats.backpack);
        const stash = this.persistent.stash;
        const backpack = this.stats.backpack;
        const DEPTH = 510;
        const modalEls = [];
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.7).setDepth(DEPTH).setInteractive();
        modalEls.push(overlay);
        const panel = this.add.rectangle(400, 300, 280, 140, 0x2a2a2a).setStrokeStyle(3, 0xffaa00).setDepth(DEPTH + 1);
        modalEls.push(panel);
        const title = this.add.text(400, 248, `Turn in ${itemLabel}`, { fontSize: '16px', fill: '#ffaa00', fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH + 2);
        modalEls.push(title);
        const sub = this.add.text(400, 268, `You have ${have}. Need ${need - turnedIn} more.`, { fontSize: '12px', fill: '#aaa' }).setOrigin(0.5).setDepth(DEPTH + 2);
        modalEls.push(sub);
        let amount = 1;
        const amountText = this.add.text(400, 295, '1', { fontSize: '20px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH + 2);
        modalEls.push(amountText);
        const minusBtn = this.add.text(340, 295, '  −  ', { fontSize: '18px', fill: '#ffaa00' }).setOrigin(0.5).setDepth(DEPTH + 2).setInteractive();
        const plusBtn = this.add.text(460, 295, '  +  ', { fontSize: '18px', fill: '#ffaa00' }).setOrigin(0.5).setDepth(DEPTH + 2).setInteractive();
        modalEls.push(minusBtn, plusBtn);
        const updateAmount = () => {
            amount = Math.max(1, Math.min(maxTurnIn, amount));
            amountText.setText(String(amount));
            confirmTxt.setText(`TURN IN (${amount})`);
        };
        minusBtn.on('pointerdown', () => { sfx.click(); amount--; updateAmount(); });
        plusBtn.on('pointerdown', () => { sfx.click(); amount++; updateAmount(); });
        const allBtn = this.add.rectangle(400, 318, 56, 24, 0x336622).setDepth(DEPTH + 2).setInteractive();
        const allTxt = this.add.text(400, 318, 'All', { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(DEPTH + 3);
        modalEls.push(allBtn, allTxt);
        const confirmBtn = this.add.rectangle(340, 330, 80, 28, 0x228822).setDepth(DEPTH + 2).setInteractive();
        const confirmTxt = this.add.text(340, 330, `TURN IN (${amount})`, { fontSize: '12px', fill: '#fff' }).setOrigin(0.5).setDepth(DEPTH + 3);
        modalEls.push(confirmBtn, confirmTxt);
        const cancelBtn = this.add.rectangle(440, 330, 70, 28, 0x444444).setDepth(DEPTH + 2).setInteractive();
        const cancelTxt = this.add.text(440, 330, 'Cancel', { fontSize: '12px', fill: '#fff' }).setOrigin(0.5).setDepth(DEPTH + 3);
        modalEls.push(cancelBtn, cancelTxt);
        const doClose = () => {
            modalEls.forEach(e => e.destroy());
            this.renderTraderItems(elements);
        };
        const doTurnIn = () => {
            amount = Math.max(1, Math.min(maxTurnIn, amount));
            if (!removeItemFromGrids(stash, backpack, itemId, amount)) return;
            if (!this.persistent.questTurnInProgress) this.persistent.questTurnInProgress = {};
            this.persistent.questTurnInProgress[quest.id] = (this.persistent.questTurnInProgress[quest.id] || 0) + amount;
            const newTurnedIn = this.persistent.questTurnInProgress[quest.id];
            if (newTurnedIn >= need) {
                const r = quest.reward || {};
                if (r.scrap) this.persistent.scrap = (this.persistent.scrap || 0) + r.scrap;
                if (r.credits) this.persistent.credits = (this.persistent.credits || 0) + r.credits;
                if (r.materials) this.persistent.materials = (this.persistent.materials || 0) + r.materials;
                if (!this.persistent.completedQuests) this.persistent.completedQuests = [];
                this.persistent.completedQuests.push(quest.id);
                const ax = (this.persistent.activeQuests || []).indexOf(quest.id);
                if (ax !== -1) this.persistent.activeQuests.splice(ax, 1);
                sfx.success();
            } else {
                sfx.click();
            }
            savePersistent(this.persistent);
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            this.updateTraderCurrency();
            doClose();
        };
        allBtn.on('pointerdown', () => { sfx.click(); amount = maxTurnIn; doTurnIn(); });
        allBtn.on('pointerover', () => allBtn.setFillStyle(0x448833));
        allBtn.on('pointerout', () => allBtn.setFillStyle(0x336622));
        confirmBtn.on('pointerdown', () => {
            amount = Math.max(1, Math.min(maxTurnIn, amount));
            doTurnIn();
        });
        confirmBtn.on('pointerover', () => confirmBtn.setFillStyle(0x33aa33));
        confirmBtn.on('pointerout', () => confirmBtn.setFillStyle(0x228822));
        cancelBtn.on('pointerdown', () => { sfx.click(); doClose(); });
        cancelBtn.on('pointerover', () => cancelBtn.setFillStyle(0x555555));
        cancelBtn.on('pointerout', () => cancelBtn.setFillStyle(0x444444));
    }

    closeTraderModal(elements) {
        sfx.menuClose();
        if (this.traderItemElements) {
            this.traderItemElements.forEach(e => e.destroy());
            this.traderItemElements = [];
        }
        elements.forEach(e => e.destroy());
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
    }
    
    purchaseItem(item) {
        const currency = item.currency;
        let cost = item.cost;
        
        // Apply Haggler skill discount (15%)
        if (this.persistent.unlockedSkills?.includes('haggler')) {
            cost = Math.floor(cost * 0.85);
        }
        
        // Check if player can afford (spend from hideout stash)
        if ((this.persistent[currency] || 0) < cost) {
            sfx.error();
            return false;
        }
        
        // For consumables, check if there's an empty slot
        if (item.type === 'consumable') {
            const emptySlot = this.stats.consumables.findIndex(c => c === null);
            if (emptySlot === -1) {
                sfx.error();
                // Show feedback somehow
                return false;
            }
        }
        
        // Grenades are items (no max carry check; add to stash)
        
        // Deduct cost from hideout stash
        this.persistent[currency] = (this.persistent[currency] || 0) - cost;
        this.persistent.itemsBought++;
        
        // Apply item effect
        switch (item.type) {
            case 'ammo':
                tryAddItem(this.persistent.stash, 'ammo', item.amount);
                break;
            case 'heal':
                const oldHp = this.stats.hp;
                this.stats.hp = Math.min(this.stats.hp + item.amount, this.stats.maxHp);
                const healedAmount = this.stats.hp - oldHp;
                if (healedAmount > 0) {
                    this.persistent.totalHPHealed = (this.persistent.totalHPHealed || 0) + healedAmount;
                    // Check medic unlock achievement
                    const medicAchievements = checkAchievements(this.persistent, {});
                    medicAchievements.forEach(a => {
                        sfx.achievement();
                    });
                }
                break;
            case 'grenade':
                tryAddItem(this.stats.backpack, 'grenade', item.amount || 1);
                break;
            case 'consumable':
                this.addConsumable(item.id);
                break;
            case 'mod':
                if (!this.persistent.modInventory) this.persistent.modInventory = [];
                this.persistent.modInventory.push(item.id);
                break;
            case 'magazine':
                if (!this.persistent.stash) this.persistent.stash = getDefaultBackpack();
                ensureGridItems(this.persistent.stash);
                tryAddItem(this.persistent.stash, item.id, 1, { rounds: 0, maxRounds: getMagazineCapacity(item.id) });
                break;
        }
        
        sfx.purchase();
        savePersistent(this.persistent);
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
        return true;
    }
    
    addConsumable(consumableId) {
        const emptySlot = this.stats.consumables.findIndex(c => c === null);
        if (emptySlot !== -1) {
            this.stats.consumables[emptySlot] = consumableId;
            return true;
        }
        return false;
    }
    
    sellItem(item) {
        if (item.type === 'armor') {
            this.stats.armor[item.slot] = null;
            this.persistent.credits = (this.persistent.credits || 0) + item.value;
        } else if (item.type === 'consumable') {
            this.stats.consumables[item.slot] = null;
            this.persistent.credits = (this.persistent.credits || 0) + item.value;
        } else if (item.type === 'mod') {
            const modIndex = this.persistent.modInventory.indexOf(item.modId);
            if (modIndex !== -1) {
                this.persistent.modInventory.splice(modIndex, 1);
                this.persistent.materials = (this.persistent.materials || 0) + item.value;
            }
        } else if (item.type === 'grid') {
            const removed = removeItem(item.grid, item.placementId);
            if (!removed) return false;
            this.persistent[item.currency] = (this.persistent[item.currency] || 0) + item.value;
        }
        
        this.persistent.itemsSold++;
        sfx.sell();
        savePersistent(this.persistent);
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
        return true;
    }

    update(time, delta) {
        const tb = this.stats.hideout.tinkerBench;
        if (this.tinkerBenchTimerText && tb && tb.crafting) {
            const remaining = tb.crafting.finishTime - Date.now();
            if (remaining > 0) {
                const seconds = Math.floor(remaining / 1000);
                this.tinkerBenchTimerText.setText(`CRAFTING: ${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}`);
                if (this.tinkerBenchBtnText) this.tinkerBenchBtnText.setText("WAIT...");
            } else {
                this.tinkerBenchTimerText.setText("COMPLETE!");
                if (this.tinkerBenchBtnText) this.tinkerBenchBtnText.setText("CLAIM NVG");
                if (this.tinkerBenchClaimBtn) this.tinkerBenchClaimBtn.setInteractive();
            }
        }
        const gb = this.stats.hideout.gunBench;
        if (this.gunBenchTimerText && gb && gb.crafting) {
            const remaining = gb.crafting.finishTime - Date.now();
            if (remaining > 0) {
                const seconds = Math.floor(remaining / 1000);
                this.gunBenchTimerText.setText(`CRAFTING: ${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}`);
            } else {
                this.gunBenchTimerText.setText("COMPLETE!");
            }
        }
    }

    createArmoryCard(x, y) {
        this.add.rectangle(x + 100, y + 75, 220, 160, 0x333333).setStrokeStyle(2, 0x555555);
        this.add.text(x + 10, y + 10, "GUN BENCH / TINKER", { fontSize: '18px', fill: '#ff00ff' });
        this.armoryDesc = this.add.text(x + 10, y + 40, "", { fontSize: '14px', fill: '#aaa' });
        this.armoryTimerText = this.add.text(x + 10, y + 80, "", { fontSize: '14px', fill: '#00ff00' });
        this.armoryBtn = this.add.rectangle(x + 100, y + 130, 200, 30, 0x555555).setInteractive();
        this.armoryBtnText = this.add.text(x + 100, y + 130, "", { fontSize: '14px', fill: '#fff' }).setOrigin(0.5);
        const ammoBtn = this.add.rectangle(x + 100, y + 165, 200, 20, 0x444444).setInteractive();
        this.add.text(x + 100, y + 165, "CRAFT 9MM (1 SCRAP)", { fontSize: '10px', fill: '#fff' }).setOrigin(0.5);

        this.updateArmoryUI();

        this.armoryBtn.on('pointerdown', () => {
            const tb = this.stats.hideout.tinkerBench;
            if (!tb) return;
            if (tb.crafting && Date.now() >= tb.crafting.finishTime) {
                sfx.lootWeapon();
                if (this.persistent.stash) tryAddItem(this.persistent.stash, 'nvg', 1);
                tb.crafting = null;
                this.updateArmoryUI();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                return;
            }
            if (tb.crafting) return;
            if ((this.persistent.scrap || 0) >= 3) {
                sfx.success();
                this.persistent.scrap = (this.persistent.scrap || 0) - 3;
                tb.crafting = { item: 'nvg', finishTime: Date.now() + CONFIG.TIMINGS.NVG_CRAFT };
                this.updateStatText();
                this.updateArmoryUI();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
            }
        });

        ammoBtn.on('pointerdown', () => {
            const gb = this.stats.hideout.gunBench;
            if (!gb || gb.crafting) return;
            const cfg = CONFIG.HIDEOUT.GUN_BENCH_CRAFT_9MM;
            if ((this.persistent.scrap || 0) >= cfg.scrap) {
                sfx.lootAmmo();
                this.persistent.scrap = (this.persistent.scrap || 0) - cfg.scrap;
                gb.crafting = { itemId: cfg.itemId, count: cfg.count, finishTime: Date.now() + cfg.timeMs };
                this.updateStatText();
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
                this.cameras.main.flash(100, 0, 255, 0);
            } else {
                sfx.error();
            }
        });
    }

    updateArmoryUI() {
        const tb = this.stats.hideout.tinkerBench;
        const gb = this.stats.hideout.gunBench;
        if (!this.armoryBtnText) return;
        if (tb && tb.crafting) {
            if (Date.now() >= tb.crafting.finishTime) {
                if (this.armoryDesc) this.armoryDesc.setText("NVG ready\nClick to claim");
                this.armoryBtnText.setText("CLAIM NVG");
            } else {
                if (this.armoryDesc) this.armoryDesc.setText("Fabricating NVG...");
                if (this.armoryBtn) this.armoryBtn.disableInteractive();
            }
            const rem = tb.crafting.finishTime - Date.now();
            if (this.armoryTimerText) this.armoryTimerText.setText(rem > 0 ? `NVG: ${Math.floor(rem/60000)}:${((rem/1000)%60).toFixed(0).padStart(2,'0')}` : "COMPLETE!");
        } else {
            if (this.armoryDesc) this.armoryDesc.setText("Craft NVG (item)\nCost: 3 Scrap, 90s");
            this.armoryBtnText.setText("CRAFT NVG (3 SCRAP)");
            if (this.armoryTimerText) this.armoryTimerText.setText("");
            if (this.armoryBtn) this.armoryBtn.setInteractive();
        }
        if (gb && gb.crafting && this.armoryTimerText) {
            const rem = gb.crafting.finishTime - Date.now();
            this.armoryTimerText.setText((this.armoryTimerText.text || '') + (rem > 0 ? ` | 9mm: ${Math.floor(rem/60000)}:${((rem/1000)%60).toFixed(0).padStart(2,'0')}` : " | 9mm COMPLETE"));
        }
    }

    getRestEffect() {
        if (this.stats.hideout.restAreaLvl === 0) return "Sleep on floor (No Heal)";
        if (this.stats.hideout.restAreaLvl === 1) return "Mattress (+50% HP)";
        return "Med Bay (+100% HP, +Max HP)";
    }

    updateStatText() {
        // Update the new resource header text
        this.updateResourceText();
    }

    createUpgradeCard(x, y, title, descFn, actionFn, costFn) {
        this.add.rectangle(x + 100, y + 75, 220, 160, 0x333333).setStrokeStyle(2, 0x555555);
        this.add.text(x + 10, y + 10, title, { fontSize: '20px', fill: '#ffff00' });
        const descText = this.add.text(x + 10, y + 40, descFn(), { fontSize: '14px', fill: '#aaa' });
        const btn = this.add.rectangle(x + 100, y + 130, 200, 30, 0x555555).setInteractive();
        const btnText = this.add.text(x + 100, y + 130, costFn(), { fontSize: '14px', fill: '#fff' }).setOrigin(0.5);
        btn.on('pointerdown', () => {
            if (actionFn()) {
                sfx.success();
                descText.setText(descFn());
                btnText.setText(costFn());
                this.cameras.main.flash(100, 0, 255, 0);
            } else {
                sfx.error();
                this.cameras.main.shake(100, 0.005);
                btn.setFillStyle(0xff0000);
                this.time.delayedCall(200, () => btn.setFillStyle(0x555555));
            }
        });
    }
    
    showFloatingText(x, y, msg, color) {
        // Simple floating text for HideoutScene
        const text = this.add.text(x, y, msg, { 
            fontSize: '16px', 
            fill: typeof color === 'string' ? color : '#' + color.toString(16).padStart(6, '0'),
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setDepth(600);
        
        this.tweens.add({
            targets: text,
            y: y - 30,
            alpha: 0,
            duration: 1500,
            ease: 'Power2',
            onComplete: () => text.destroy()
        });
    }
}

// =============================================================================
// GAME SCENE
// =============================================================================
class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }
    
    preload() {
        // Kenney Top-down Shooter (CC0) — characters, floors, wall, crate
        this.load.image('player', 'assets/sprites/player.png');
        this.load.image('zombie', 'assets/sprites/zombie.png');
        this.load.image('bandit', 'assets/sprites/bandit.png');
        this.load.image('spitter', 'assets/sprites/spitter.png');
        this.load.image('boss', 'assets/sprites/boss.png');
        this.load.image('necromancer', 'assets/sprites/necromancer.png');
        this.load.image('leaper_idle_0', 'assets/sprites/leaper_idle_0.png');
        this.load.image('leaper_idle_1', 'assets/sprites/leaper_idle_1.png');
        this.load.image('crate', 'assets/sprites/crate.png');
        this.load.image('wall', 'assets/tiles/wall.png');
        this.load.image('floor_grass', 'assets/tiles/floor_grass.png');
        this.load.image('floor_apt', 'assets/tiles/floor_apt.png');
        this.load.image('floor_roof', 'assets/tiles/floor_roof.png');
        this.load.image('floor_sewer', 'assets/tiles/floor_sewer.png');
        this.load.image('floor_hospital', 'assets/tiles/floor_hospital.png');

        // Small VFX / UI textures still generated (no Kenney equivalents needed)
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(0xffff00, 1); graphics.fillRect(0,0,8,8); graphics.generateTexture('bullet', 8,8);
        graphics.fillStyle(0x00ff00, 1); graphics.fillCircle(6,6,6); graphics.generateTexture('acid', 12,12);
        graphics.fillStyle(0x556B2F, 1); graphics.fillCircle(8,8,8); graphics.generateTexture('grenade', 16,16);
        graphics.fillStyle(0xFFD700, 1); graphics.fillRect(0,0,40,60); graphics.generateTexture('door', 40,60);
        graphics.fillStyle(0xffffff, 1); graphics.fillRect(0,0,40,40); graphics.generateTexture('slash', 40,40);
        graphics.clear(); graphics.fillStyle(0xff0000, 1); graphics.fillRect(0,0,20,20); graphics.generateTexture('pickup_hp', 20,20);
        graphics.clear(); graphics.fillStyle(0x0088ff, 1); graphics.fillRect(0,0,20,20); graphics.generateTexture('pickup_stamina', 20,20);
        graphics.clear(); graphics.fillStyle(0x333333, 1); graphics.fillRect(0,0,60,60); graphics.generateTexture('debris', 60,60);
        graphics.clear(); graphics.fillStyle(0x00ff00, 1); graphics.fillRect(0,0,30,30); graphics.generateTexture('switch', 30,30);

        // Skull art (loot marker)
        graphics.clear();
        graphics.lineStyle(2, 0x000000, 1);
        graphics.fillStyle(0xEAEAEA, 1);
        graphics.fillCircle(16, 14, 11); graphics.strokeCircle(16, 14, 11);
        graphics.fillRect(10, 20, 12, 8); graphics.strokeRect(10, 20, 12, 8);
        graphics.fillStyle(0x000000, 1);
        graphics.fillCircle(12, 14, 3.5); graphics.fillCircle(20, 14, 3.5);
        graphics.beginPath(); graphics.moveTo(16, 18); graphics.lineTo(14, 21); graphics.lineTo(18, 21); graphics.closePath(); graphics.fill();
        graphics.lineStyle(1, 0x000000);
        graphics.beginPath(); graphics.moveTo(13, 20); graphics.lineTo(13, 28); graphics.moveTo(16, 20); graphics.lineTo(16, 28); graphics.moveTo(19, 20); graphics.lineTo(19, 28); graphics.strokePath();
        graphics.generateTexture('skull', 32, 32);
        graphics.destroy();
    }
    
    create(data = {}) {
        // Inventory-only mode: loadout screen from Hideout (same inventory as in-raid; can add stash panel)
        if (data.inventoryOnly && data.stats) {
            this.playerStats = data.stats;
            this.inventoryOnlyMode = true;
            this.hideoutStash = data.stash || null;
            this.hideoutPersistent = data.persistent || null;
            ensureGridItems(this.playerStats.backpack);
            this.playerStats.backpack.gridW = 6;
            this.playerStats.backpack.gridH = 9;
            this.createInventoryUI();
            this.renderInventoryPanel();
            const FOOTER_DEPTH = 500;
            const footerY = 565;
            const goToHideout = (tab) => {
                if (this.invListeners) {
                    this.input.off('pointermove', this.invListeners.move);
                    this.input.off('pointerdown', this.invListeners.down);
                    this.input.off('pointerup', this.invListeners.up);
                    if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
                    if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
                    if (this.invListeners.uKey) this.invListeners.uKey.off('down', this.invListeners.uKeyCallback);
                    this.invListeners = null;
                }
                if (this.invContent && this.invContent.length) {
                    this.invContent.forEach(e => e.destroy());
                    this.invContent = [];
                }
                this.scene.start('HideoutScene', { stats: this.playerStats, tab: tab || 'facilities' });
            };
            this.add.rectangle(400, 520, 760, 2, 0x444444).setDepth(FOOTER_DEPTH);
            const menuBtn = this.add.rectangle(80, footerY, 130, 40, 0x444444).setInteractive().setDepth(FOOTER_DEPTH);
            this.add.text(80, footerY, 'MAIN MENU', { fontSize: '13px', fill: '#fff' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
            menuBtn.on('pointerdown', () => { sfx.menuClose(); this.scene.start('MainMenuScene'); });
            menuBtn.on('pointerover', () => menuBtn.setFillStyle(0x555555));
            menuBtn.on('pointerout', () => menuBtn.setFillStyle(0x444444));
            const settingsBtn = this.add.rectangle(170, footerY, 40, 40, 0x444444).setInteractive().setDepth(FOOTER_DEPTH);
            this.add.text(170, footerY, '\u2699', { fontSize: '20px' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
            settingsBtn.on('pointerdown', () => {
                if (this.invListeners) {
                    this.input.off('pointermove', this.invListeners.move);
                    this.input.off('pointerdown', this.invListeners.down);
                    this.input.off('pointerup', this.invListeners.up);
                    if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
                    if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
                    if (this.invListeners.uKey) this.invListeners.uKey.off('down', this.invListeners.uKeyCallback);
                    this.invListeners = null;
                }
                if (this.invContent && this.invContent.length) {
                    this.invContent.forEach(e => e.destroy());
                    this.invContent = [];
                }
                this.scene.start('HideoutScene', { stats: this.playerStats, tab: 'facilities', openSettings: true });
            });
            settingsBtn.on('pointerover', () => settingsBtn.setFillStyle(0x555555));
            settingsBtn.on('pointerout', () => settingsBtn.setFillStyle(0x444444));
            const stashBtn = this.add.rectangle(260, footerY, 100, 40, 0x444444).setInteractive().setDepth(FOOTER_DEPTH);
            this.add.text(260, footerY, 'STASH', { fontSize: '13px', fill: '#fff' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
            stashBtn.on('pointerdown', () => goToHideout('stash'));
            stashBtn.on('pointerover', () => stashBtn.setFillStyle(0x555555));
            stashBtn.on('pointerout', () => stashBtn.setFillStyle(0x444444));
            const backBtn = this.add.rectangle(380, footerY, 140, 40, 0x444444).setInteractive().setDepth(FOOTER_DEPTH);
            this.add.text(380, footerY, 'HIDEOUT', { fontSize: '13px', fill: '#fff' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
            backBtn.on('pointerdown', () => goToHideout('facilities'));
            backBtn.on('pointerover', () => backBtn.setFillStyle(0x555555));
            backBtn.on('pointerout', () => backBtn.setFillStyle(0x444444));
            const missionBtn = this.add.rectangle(580, footerY, 320, 50, 0x00aa44).setInteractive().setDepth(FOOTER_DEPTH);
            this.add.text(580, footerY, 'MISSION MAP', { fontSize: '26px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(FOOTER_DEPTH + 1);
            missionBtn.on('pointerdown', () => {
                if (this.invListeners) {
                    this.input.off('pointermove', this.invListeners.move);
                    this.input.off('pointerdown', this.invListeners.down);
                    this.input.off('pointerup', this.invListeners.up);
                    if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
                    if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
                    if (this.invListeners.uKey) this.invListeners.uKey.off('down', this.invListeners.uKeyCallback);
                    this.invListeners = null;
                }
                if (this.invContent && this.invContent.length) {
                    this.invContent.forEach(e => e.destroy());
                    this.invContent = [];
                }
                this.scene.start('HideoutScene', { stats: this.playerStats, tab: 'facilities', openMissionMap: true });
            });
            missionBtn.on('pointerover', () => missionBtn.setFillStyle(0x00cc55));
            missionBtn.on('pointerout', () => missionBtn.setFillStyle(0x00aa44));
            return;
        }
        
        // Create leaper animations from individual images (only if not already created)
        if (!this.anims.exists('leaper_idle')) {
            // Idle animation (using available frames)
            this.anims.create({
                key: 'leaper_idle',
                frames: [
                    { key: 'leaper_idle_0' },
                    { key: 'leaper_idle_1' }
                    // Add more frames here as they become available
                ],
                frameRate: 6,
                repeat: -1
            });
            
            // For now, use idle for all states until more frames are added
            // These will be updated once all frames are available
            this.anims.create({
                key: 'leaper_crawl',
                frames: [
                    { key: 'leaper_idle_0' },
                    { key: 'leaper_idle_1' }
                ],
                frameRate: 8,
                repeat: -1
            });
            this.anims.create({
                key: 'leaper_attack',
                frames: [
                    { key: 'leaper_idle_0' },
                    { key: 'leaper_idle_1' }
                ],
                frameRate: 10,
                repeat: 0
            });
            this.anims.create({
                key: 'leaper_death',
                frames: [
                    { key: 'leaper_idle_1' },
                    { key: 'leaper_idle_0' }
                ],
                frameRate: 4,
                repeat: 0
            });
        }
        
        // Clean up any lingering handlers from previous scene
        if (this.levelChoiceEnterHandler) {
            this.input.keyboard.off('keydown-ENTER', this.levelChoiceEnterHandler);
            this.levelChoiceEnterHandler = null;
        }
        if (this.levelChoiceEscHandler) {
            this.input.keyboard.off('keydown-ESC', this.levelChoiceEscHandler);
            this.levelChoiceEscHandler = null;
        }
        this.levelChoiceMade = false;
        this.consumableSlotTexts = null;
        
        this.currentLevel = data.level || 1;
        this.playerStats = data.stats ? JSON.parse(JSON.stringify(data.stats)) : JSON.parse(JSON.stringify(DEFAULT_STATS));
        if (!this.playerStats.limbHp) {
            this.playerStats.limbHp = getDefaultLimbHp();
            this.playerStats.hp = sumLimbHp(this.playerStats.limbHp);
            this.playerStats.maxHp = sumLimbMaxHp(this.playerStats.limbHp);
        }
        Object.keys(this.playerStats.limbHp).forEach(limbId => {
            if (!Array.isArray(this.playerStats.limbHp[limbId].effects)) this.playerStats.limbHp[limbId].effects = [];
        });
        ensureLimbVisStats(this.playerStats);
        this.lastBleedTick = { minor: {}, major: {} };
        this.limbHudFlash = null;
        this._lastBleedDrop = 0;
        this._limpPhase = 0;
        this._infectionWarned = (this.playerStats.infection || 0) > 0;
        // Test limb statuses: set to false when done testing trauma/bleed/break items
        const APPLY_TEST_LIMB_STATUSES = false;
        // Set true to test "both arms broken" (door delay, 1 damage per shot/grenade/loot, recovery damage). Broken = break status; arms black (0 HP) from damage separately.
        const APPLY_BOTH_ARMS_BROKEN = false;
        if (APPLY_TEST_LIMB_STATUSES && this.playerStats.limbHp) {
            this.playerStats.limbHp.abdomen.hp = 0;
            if (!this.playerStats.limbHp.abdomen.effects.includes('trauma')) this.playerStats.limbHp.abdomen.effects.push('trauma');
            if (!this.playerStats.limbHp.leftLeg.effects.includes('break')) this.playerStats.limbHp.leftLeg.effects.push('break');
            if (!this.playerStats.limbHp.rightLeg.effects.includes('minor_bleed')) this.playerStats.limbHp.rightLeg.effects.push('minor_bleed');
            if (!this.playerStats.limbHp.rightArm.effects.includes('major_bleed')) this.playerStats.limbHp.rightArm.effects.push('major_bleed');
            if (APPLY_BOTH_ARMS_BROKEN) {
                if (!this.playerStats.limbHp.leftArm.effects.includes('break')) this.playerStats.limbHp.leftArm.effects.push('break');
                if (!this.playerStats.limbHp.rightArm.effects.includes('break')) this.playerStats.limbHp.rightArm.effects.push('break');
            }
            this.playerStats.hp = sumLimbHp(this.playerStats.limbHp);
            this.playerStats.maxHp = sumLimbMaxHp(this.playerStats.limbHp);
            if (!this.playerStats.backpack) this.playerStats.backpack = getDefaultBackpack();
            const backpack = this.playerStats.backpack;
            ensureGridItems(backpack);
            tryAddItem(backpack, 'bandage', 1, { durability: 2, maxDurability: 2 });
            tryAddItem(backpack, 'hemostat', 1, { durability: 2, maxDurability: 2 });
            tryAddItem(backpack, 'splint', 1, { durability: 2, maxDurability: 2 });
            tryAddItem(backpack, 'trauma_kit', 1, { durability: 4, maxDurability: 4 });
            tryAddItem(backpack, 'limb_breaker', 1, { durability: 5, maxDurability: 5 });
            tryAddItem(backpack, 'trauma_inflict', 1, { durability: 5, maxDurability: 5 });
        }
        // Ensure magazines exist
        if (!this.playerStats.magazines) {
            this.playerStats.magazines = {
                pistol: CONFIG.WEAPONS.PISTOL.MAG_SIZE,
                shotgun: CONFIG.WEAPONS.SHOTGUN.MAG_SIZE,
                smg: CONFIG.WEAPONS.SMG.MAG_SIZE,
                crossbow: CONFIG.WEAPONS.CROSSBOW.MAG_SIZE,
                rifle: CONFIG.WEAPONS.RIFLE.MAG_SIZE
            };
        }
        // Ensure new weapon magazines exist
        if (this.playerStats.magazines.crossbow === undefined) this.playerStats.magazines.crossbow = CONFIG.WEAPONS.CROSSBOW.MAG_SIZE;
        if (this.playerStats.magazines.rifle === undefined) this.playerStats.magazines.rifle = CONFIG.WEAPONS.RIFLE.MAG_SIZE;
        // Ensure new weapon flags exist
        if (this.playerStats.hasCrossbow === undefined) this.playerStats.hasCrossbow = false;
        if (this.playerStats.hasRifle === undefined) this.playerStats.hasRifle = false;
        // Ensure grenades exist for old saves; migrate legacy stack to items
        if (this.playerStats.grenades === undefined) this.playerStats.grenades = 0;
        if (this.playerStats.grenades > 0) {
            for (let i = 0; i < this.playerStats.grenades; i++) tryAddItem(this.playerStats.backpack, 'grenade', 1);
            this.playerStats.grenades = 0;
        }
        // Ensure new currency fields exist
        if (this.playerStats.credits === undefined) {
            this.playerStats.credits = 0;
        }
        if (this.playerStats.materials === undefined) {
            this.playerStats.materials = 0;
        }
        // Ensure consumables is a valid array (handle null, undefined, or corrupted data)
        if (!this.playerStats.consumables || !Array.isArray(this.playerStats.consumables)) {
            this.playerStats.consumables = [null, null, null];
        }
        // Ensure consumables array has exactly 3 slots
        while (this.playerStats.consumables.length < 3) {
            this.playerStats.consumables.push(null);
        }
        if (!this.playerStats.equippedMods) this.playerStats.equippedMods = {};
        ensureEquippedModsShape(this.playerStats);
        ensureWeaponSlotModsShape(this.playerStats);
        if (!this.playerStats.weaponSlots) this.playerStats.weaponSlots = { primary: null, secondary: null, sidearm: 'pistol', melee: null };
        ensurePlacementMods(this.playerStats.backpack);
        if (this.playerStats.rigGrid) ensurePlacementMods(this.playerStats.rigGrid);
        ensurePockets(this.playerStats);
        ensureRigStats(this.playerStats);
        ensureBackpackStats(this.playerStats);
        ensureSecureContainerStats(this.playerStats);
        ensureMedBagStats(this.playerStats);
        // Ensure highestLevelUnlocked exists
        if (this.playerStats.highestLevelUnlocked === undefined) {
            this.playerStats.highestLevelUnlocked = this.playerStats.nextLevel || 1;
        }
        this.checkpointStats = JSON.parse(JSON.stringify(this.playerStats));

        // State flags
        this.hasKey = false;
        this.hasMolotov = false;
        this.isOpening = false;
        this.isPaused = false;
        this.isPinned = false;
        this.pinnedBy = null;
        this.isMeleeAttacking = false;
        this.debrisBurning = false;
        this.lastFired = 0;
        this.holdingFire = false; // full auto: SMG/rifle keep firing while button held
        this.limbEffectHitCount = new Map(); // Phase 5: source -> { count, lastHitTime } for escalation
        this.switchDropped = false;
        this.extractionTimer = 15;
        this.extractionActive = false;
        this.isInventoryOpen = false;
        this.nvgOn = false;
        this.baseSpeedMultiplier = 1; // Base speed (modified by class)
        this.speedMultiplier = 1; // For adrenaline consumable
        this.silentFootsteps = false; // Scout class passive
        
        // Persistent stats tracking
        this.persistent = loadPersistent();
        
        // Ensure challenges are initialized (in case player skipped Hideout)
        if (checkChallengeReset(this.persistent)) {
            savePersistent(this.persistent);
        }
        
        if (this.currentLevel === 1) {
            // New run - reset run stats and increment runs started
            this.persistent = resetRunStats(this.persistent);
            this.persistent.runsStarted++;
            this.levelDamageTaken = 0; // Track damage for untouchable achievement
        }
        this.levelDamageTaken = this.levelDamageTaken || 0;
        
        // Track level start time for speed run challenge
        this.levelStartTime = Date.now();
        
        // Apply class passives
        if (this.persistent.selectedClass === 'scout') {
            this.baseSpeedMultiplier = 1.2; // +20% movement speed
            this.speedMultiplier = this.baseSpeedMultiplier;
            this.silentFootsteps = true;
        } else if (this.persistent.selectedClass === 'medic') {
            // Medic: Regenerate 1 HP every 30 seconds
            this.medicRegenEvent = this.time.addEvent({
                delay: 30000,
                callback: () => {
                    if (this.playerStats.hp < this.playerStats.maxHp && this.player && this.player.active) {
                        this.playerStats.hp = Math.min(this.playerStats.hp + 1, this.playerStats.maxHp);
                        this.showFloatingText(this.player.x, this.player.y - 40, "+1 HP (Medic)", 0x00ff00);
                        sfx.heal();
                    }
                },
                loop: true
            });
        }
        
        // Apply permanent upgrades
        if (this.persistent.unlockedUpgrades?.includes('speed_boost')) {
            this.baseSpeedMultiplier *= 1.05; // +5% speed, stacks with Scout
            this.speedMultiplier = this.baseSpeedMultiplier;
        }
        this.permanentDamageBoost = this.persistent.unlockedUpgrades?.includes('damage_boost') ? 1.1 : 1.0;
        
        // Apply cosmetics - skin tint (will apply after player is created)
        this.equippedSkinTint = null;
        if (this.persistent.equippedSkin) {
            const skinUpgrade = Object.values(CONFIG.UPGRADES).find(u => u.id === this.persistent.equippedSkin);
            if (skinUpgrade?.tint) this.equippedSkinTint = skinUpgrade.tint;
        }
        
        // Apply cosmetics - muzzle flash color
        this.muzzleFlashColor = 0xffff00; // Default yellow
        if (this.persistent.equippedMuzzle) {
            const muzzleUpgrade = Object.values(CONFIG.UPGRADES).find(u => u.id === this.persistent.equippedMuzzle);
            if (muzzleUpgrade?.color) this.muzzleFlashColor = muzzleUpgrade.color;
        }
        
        // ===== APPLY SKILL EFFECTS =====
        // Calculate damage reduction from skills (Thick Skin + Iron Will)
        this.skillDamageReduction = 0;
        if (this.hasSkill('thick_skin')) this.skillDamageReduction += 0.1;
        if (this.hasSkill('iron_will')) this.skillDamageReduction += 0.2;
        
        // Last Stand: +50% damage when below 25% HP
        this.lastStandBonus = this.hasSkill('last_stand') ? 0.5 : 0;
        this.lastStandThreshold = 0.25;
        
        // Regeneration skill: Heal 1 HP every 60 seconds (stacks with Medic class)
        if (this.hasSkill('regeneration')) {
            this.skillRegenEvent = this.time.addEvent({
                delay: 60000,
                callback: () => {
                    if (this.playerStats.hp < this.playerStats.maxHp && this.player && this.player.active) {
                        this.playerStats.hp = Math.min(this.playerStats.hp + 1, this.playerStats.maxHp);
                        this.showFloatingText(this.player.x, this.player.y - 40, "+1 HP (Regen)", 0x88ff88);
                        sfx.lootHealth();
                    }
                },
                loop: true
            });
        }
        
        // Light Feet: Reduced footstep volume (handled in footstep calls)
        this.lightFeetVolume = this.hasSkill('light_feet') ? 0.3 : 1.0;
        
        // Ghost: Faster detection decay (handled in stealth mechanics)
        this.ghostDecayMultiplier = this.hasSkill('ghost') ? 2.0 : 1.0;
        
        // Shadow Step: Reduced enemy detection range
        this.shadowStepReduction = this.hasSkill('shadow_step') ? 0.25 : 0;
        
        // Swift Reload: -15% reload time
        this.swiftReloadBonus = this.hasSkill('swift_reload') ? 0.15 : 0;
        
        // Quick Hands: +25% interact speed
        this.quickHandsBonus = this.hasSkill('quick_hands') ? 0.25 : 0;
        
        // Scrapper: +25% scrap bonus
        this.scrapperBonus = this.hasSkill('scrapper') ? 0.25 : 0;
        
        // Pack Mule: +1 consumable slot (handled at stats level)
        if (this.hasSkill('pack_mule')) {
            // Ensure 4 consumable slots
            while (this.playerStats.consumables.length < 4) {
                this.playerStats.consumables.push(null);
            }
        }
        
        // Calculate weapon mod effects from per-slot mods (weaponSlotMods) so each weapon instance can have different attachments
        this.weaponModEffects = {};
        const weapons = ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'];
        weapons.forEach(weapon => {
            this.weaponModEffects[weapon] = {
                magSizeMultiplier: 1,
                damageMultiplier: 1,
                fireRateMultiplier: 1,
                spreadMultiplier: 1,
                isSilent: false,
                hasLaser: false
            };
        });
        let hasFlashlightFromSlot = false;
        ['primary', 'secondary', 'sidearm', 'melee'].forEach(slotId => {
            const weaponId = this.playerStats.weaponSlots && this.playerStats.weaponSlots[slotId];
            if (!weaponId) return;
            const modsObj = getModsForWeaponInSlot(this.playerStats, slotId);
            if (!modsObj) return;
            this.weaponModEffects[weaponId] = this.weaponModEffects[weaponId] || {
                magSizeMultiplier: 1,
                damageMultiplier: 1,
                fireRateMultiplier: 1,
                spreadMultiplier: 1,
                isSilent: false,
                hasLaser: false
            };
            Object.values(modsObj).forEach(modId => {
                if (!modId) return;
                const mod = Object.values(CONFIG.MODS).find(m => m.id === modId);
                if (!mod) return;
                if (modId === 'flashlight' || modId === 'laser_sight') hasFlashlightFromSlot = true; // flashlight = light only; laser_sight = combo
                const effect = mod.effect;
                switch (effect.type) {
                    case 'mag_size':
                        this.weaponModEffects[weaponId].magSizeMultiplier += effect.value;
                        break;
                    case 'suppressor':
                        this.weaponModEffects[weaponId].isSilent = true;
                        this.weaponModEffects[weaponId].damageMultiplier -= effect.damageReduction;
                        break;
                    case 'laser_sight':
                        this.weaponModEffects[weaponId].hasLaser = true;
                        break;
                    case 'damage_barrel':
                        this.weaponModEffects[weaponId].damageMultiplier += effect.damage;
                        this.weaponModEffects[weaponId].fireRateMultiplier += effect.fireRate; // negative
                        break;
                    case 'rapid_fire':
                        this.weaponModEffects[weaponId].fireRateMultiplier += effect.fireRate;
                        this.weaponModEffects[weaponId].spreadMultiplier += effect.spread;
                        break;
                    case 'flashlight':
                        // basic flashlight: light only (no laser)
                        break;
                }
            });
        });
        if (hasFlashlightFromSlot) this.playerStats.hasFlashlight = true;
        
        // Apply extended mag effect to initial magazine sizes
        weapons.forEach(weapon => {
            const magMod = this.weaponModEffects[weapon].magSizeMultiplier;
            if (magMod > 1) {
                const baseSize = CONFIG.WEAPONS[weapon.toUpperCase()].MAG_SIZE;
                const newSize = Math.floor(baseSize * magMod);
                // If magazine is full, extend it; otherwise keep current
                if (this.playerStats.magazines[weapon] === baseSize) {
                    this.playerStats.magazines[weapon] = newSize;
                }
            }
        });
        
        this.grenadeKillCount = 0; // For tracking multi-kills
        
        // Dodge roll state
        this.isDodging = false;
        this.dodgeCooldown = 0;
        this.lastDodgeTime = 0;

        // Crouch: toggle with C; no footstep noise, leapers don't target you
        this.isCrouching = false;
        
        // Reload state
        this.isReloading = false;
        this.reloadTimer = null;
        
        // Transition state - prevents updates during level change
        this.isTransitioning = false;
        
        // Track active timer events for cleanup
        this.activeTimerEvents = [];

        // Groups
        this.bullets = this.physics.add.group({ classType: Bullet, runChildUpdate: true, maxSize: 50 });
        this.acidProjectiles = this.physics.add.group({ runChildUpdate: true, maxSize: 20 });
        this.grenades = this.physics.add.group({ runChildUpdate: true, maxSize: 10 });
        this.enemies = this.add.group();
        this.pickups = this.physics.add.staticGroup();
        this.droppedInventoryItems = this.add.group();
        this.crates = this.physics.add.staticGroup();
        this.skulls = this.physics.add.staticGroup();
        this.walls = this.physics.add.staticGroup();
        this.debris = this.physics.add.staticGroup();
        this.switches = this.physics.add.staticGroup();

        // Floating text, particle, and hit indicator pools
        this.floatingText = new FloatingTextPool(this, 20);
        this.particles = new ParticlePool(this, 60);
        this.hitIndicators = new HitIndicatorPool(this, 8);
        this._hitstopActive = false;
        this._lastHeartbeat = 0;
        this._satFX = null;
        
        // Load settings
        this.gameSettings = loadSettings();

        // UI elements needed by spawnLevelEntities (must be created before)
        this.uiGraphics = this.add.graphics().setDepth(100);
        this.uiText = this.add.text(10, 65, '', { font: '16px Arial', fill: '#fff' }).setDepth(100);
        // Phase 7 — run timer + extraction pressure (top center)
        this.extractHudText = this.add.text(400, 6, '', {
            font: '15px Arial', fill: '#cccccc', fontStyle: 'bold'
        }).setOrigin(0.5, 0).setDepth(100).setScrollFactor(0);
        this.bossBar = this.add.graphics().setDepth(150).setVisible(false);
        
        // Laser sight graphics (for weapon mod)
        this.laserGraphics = this.add.graphics().setDepth(50);
        this.bossText = this.add.text(400, 25, "BOSS", { fontSize: '20px', fill: '#fff' }).setOrigin(0.5).setDepth(200).setVisible(false);

        // Initialize room system variables
        this.roomGrid = null;
        this.roomWalls = [];
        this.roomDoors = [];
        this.roomFloor = null;
        this.roomOverlay = null;
        this.riskDoor = null;
        this.riskDoorIcon = null;
        this.inRiskRoom = false;
        this.isTransitioningRoom = false; // Prevent transition re-entry
        this.keySpawned = false; // Reset key tracking for new level
        this.mapSpawned = false; // Reset map tracking for new level
        this.hasMap = false;     // Map pickup is per-level only
        
        // Generate procedural room grid
        this.roomGrid = this.generateRoomGrid(this.currentLevel);
        
        if (this.roomGrid) {
            // Create minimap
            this.createMinimap();
            
            // Setup first room
            const startRoom = this.roomGrid.rooms[this.roomGrid.startRoom];
            this.setupRoom(startRoom);
        } else {
            // Fallback to legacy single-room system
            this.setupMapForLevel(this.currentLevel);
        }
        
        this.player = this.physics.add.sprite(400, 550, 'player').setCollideWorldBounds(true).setDepth(10);
        // Kenney characters face +X; tighten body vs tall backpack art
        this.player.setSize(28, 28).setOffset(12, 8);
        // Apply equipped skin tint
        if (this.equippedSkinTint) {
            this.player.setTint(this.equippedSkinTint);
        }
        
        if (this.roomGrid) {
            // Spawn entities for first room
            const startRoom = this.roomGrid.rooms[this.roomGrid.startRoom];
            this.spawnRoomEntities(startRoom, false);
        } else {
            // Fallback to legacy spawning
            this.spawnLevelEntities(this.currentLevel);
        }

        // Over time, spawn enemies from edges so they wander in
        if (CONFIG.EDGE_SPAWN_ENABLED) {
            this.edgeSpawnTimer = this.time.addEvent({
                delay: CONFIG.EDGE_SPAWN_INTERVAL_MS,
                callback: this.spawnEdgeEnemy,
                callbackScope: this,
                loop: true
            });
        }
        // Drift enemy positions in other rooms so the world carries on while we're away
        if (this.roomGrid) {
            this.roomWanderTimer = this.time.addEvent({
                delay: 350,
                callback: this.tickOtherRoomsEnemyWander,
                callbackScope: this,
                loop: true
            });
        }

        // Colliders
        this.physics.add.collider(this.player, this.walls);
        this.physics.add.collider(this.player, this.crates);
        this.physics.add.collider(this.player, this.debris);
        this.physics.add.collider(this.enemies, this.walls);
        this.physics.add.collider(this.enemies, this.crates, null, (enemy, crate) => enemy.enemyType !== 'leaper');
        this.physics.add.collider(this.enemies, this.enemies);
        this.physics.add.collider(this.bullets, this.walls, (b) => { b.setActive(false); b.setVisible(false); b.body.enable = false; });
        this.physics.add.collider(this.bullets, this.crates, (b) => { b.setActive(false); b.setVisible(false); b.body.enable = false; });
        this.physics.add.collider(this.bullets, this.debris, (b) => { b.setActive(false); b.setVisible(false); b.body.enable = false; });

        // Overlaps
        this.physics.add.overlap(this.bullets, this.enemies, (obj1, obj2) => {
            const bullet = (obj1.texture.key === 'bullet') ? obj1 : obj2;
            const enemy = (obj1.texture.key === 'bullet') ? obj2 : obj1;
            if (bullet.active && enemy.active) {
                if (bullet.isEnemyBullet) {
                    if (enemy.enemyType === 'walker' || enemy.enemyType === 'leaper') {
                        const damage = CONFIG.ENEMIES.BANDIT.DAMAGE || 1;
                        if (typeof enemy.takeDamage === 'function') enemy.takeDamage(damage, 'gun', bullet.x, bullet.y);
                        bullet.hasHit = true;
                        bullet.setActive(false);
                        bullet.setVisible(false);
                        if (bullet.body) bullet.body.enable = false;
                    }
                    return;
                }
                
                // Track which enemies this bullet has hit (for piercing)
                if (!bullet.hitEnemies) bullet.hitEnemies = new Set();
                if (bullet.hitEnemies.has(enemy)) return; // Already hit this enemy
                bullet.hitEnemies.add(enemy);
                
                // Piercing bullets can hit multiple enemies but have a limit
                if (bullet.isPiercing) {
                    if (!bullet.pierceCount) bullet.pierceCount = 0;
                    bullet.pierceCount++;
                    if (bullet.pierceCount > (CONFIG.WEAPONS.MAX_PIERCE_ENEMIES || 2)) {
                        bullet.setActive(false);
                        bullet.setVisible(false);
                        bullet.body.enable = false;
                    }
                } else {
                    // Non-piercing bullets stop on first hit
                    bullet.hasHit = true;
                    bullet.setActive(false);
                    bullet.setVisible(false);
                    bullet.body.enable = false;
                }
                
                // Track hit stats
                this.persistent.runShotsHit++;
                this.persistent.totalShotsHit++;
                // Track if boss was hit with gun (for melee master achievement)
                if (enemy.enemyType === 'boss') {
                    this.persistent.bossHitWithGun = true;
                }
                
                // Calculate damage based on weapon type
                let damage = 1;
                let weaponSource = 'gun'; // Default
                if (bullet.crossbowDamage) {
                    damage = bullet.crossbowDamage; // Crossbow high damage
                    weaponSource = 'crossbow';
                } else if (bullet.rifleDamage) {
                    damage = bullet.rifleDamage; // Rifle medium damage
                    weaponSource = 'rifle';
                }
                
                // Apply weapon mod damage multiplier
                if (bullet.modDamageMultiplier && bullet.modDamageMultiplier !== 1) {
                    damage = Math.ceil(damage * bullet.modDamageMultiplier);
                }
                
                // Apply workbench damage bonus
                if (this.playerStats.hideout.workbenchLvl > 0) {
                    damage = Math.ceil(damage * (1 + CONFIG.HIDEOUT.WORKBENCH_DAMAGE_BONUS));
                }
                // Apply permanent damage boost upgrade
                if (this.permanentDamageBoost > 1) {
                    damage = Math.ceil(damage * this.permanentDamageBoost);
                }
                // Apply Last Stand skill (+50% damage when below 25% HP)
                if (this.lastStandBonus > 0 && this.playerStats.hp / this.playerStats.maxHp <= this.lastStandThreshold) {
                    damage = Math.ceil(damage * (1 + this.lastStandBonus));
                }
                if (typeof enemy.takeDamage === 'function') enemy.takeDamage(damage, weaponSource, this.player.x, this.player.y);
            }
        });

        this.physics.add.overlap(this.bullets, this.player, (player, bullet) => {
            if (bullet.active && !bullet.hasHit) {
                if (!bullet.isEnemyBullet) return;
                // Dodge roll grants invincibility
                if (this.isDodging) return;
                bullet.hasHit = true;
                const bx = bullet.x, by = bullet.y;
                const bulletDmg = (bullet.damage != null && bullet.damage > 0) ? bullet.damage : 1;
                bullet.setActive(false);
                bullet.setVisible(false);
                bullet.body.enable = false;
                this.hitPlayer(bulletDmg, bx, by, { damageSource: 'bullet' });
            }
        });

        // Acid projectile hits player
        this.physics.add.overlap(this.acidProjectiles, this.player, (player, acid) => {
            if (acid.active && !acid.hasHit) {
                if (this.isDodging) return;
                acid.hasHit = true;
                const ax = acid.x, ay = acid.y;
                acid.setActive(false);
                acid.setVisible(false);
                acid.body.enable = false;
                this.hitPlayer(CONFIG.ENEMIES.SPITTER.DAMAGE, ax, ay, { damageSource: 'acid' });
                this.showFloatingText(this.player.x, this.player.y - 30, "ACID!", 0x00ff00);
            }
        });

        // Acid hits walls
        this.physics.add.collider(this.acidProjectiles, this.walls, (acid) => { 
            acid.setActive(false); acid.setVisible(false); acid.body.enable = false; 
        });
        this.physics.add.collider(this.acidProjectiles, this.crates, (acid) => { 
            acid.setActive(false); acid.setVisible(false); acid.body.enable = false; 
        });

        this.physics.add.overlap(this.player, this.enemies, (p, e) => {
            if (!e.active) return;
            if (this.isDodging) return;
            if (e.enemyType === 'leaper' && e.state === 'LEAP') this.triggerKnockdown(e);
            else if (e.enemyType === 'bandit' && e.ammo > 0) return;
            else {
                const cooldown = CONFIG.PLAYER.ENEMY_MELEE_HIT_COOLDOWN_MS != null ? CONFIG.PLAYER.ENEMY_MELEE_HIT_COOLDOWN_MS : 700;
                const now = this.time.now;
                if ((e.lastHitPlayerTime || 0) + cooldown > now) return;
                e.lastHitPlayerTime = now;
                this.hitPlayer(e.damage, e.x, e.y, { damageSource: 'melee', enemyType: e.enemyType, meleeAttacker: e });
            }
        });

        // Only zombie vs human melee (walker-bandit); no zombie-on-zombie violence
        this.physics.add.overlap(this.enemies, this.enemies, (e1, e2) => {
            if (!e1.active || !e2.active) return;
            const time = this.time.now;
            const meleeCooldown = 800;
            const walkerVsBanditCooldown = 350;
            if (e1.enemyType === 'walker' && e2.enemyType === 'bandit') {
                if ((e1.lastMeleeHitTime || 0) + walkerVsBanditCooldown <= time) {
                    e2.takeDamage(e1.damage, 'melee', e1.x, e1.y);
                    e1.lastMeleeHitTime = time;
                }
            } else if (e1.enemyType === 'leaper' && e2.enemyType === 'bandit' && e1.state === 'LEAP') {
                // Same as player: leaper lands on bandit and immobilizes them (always pin)
                const cfg = CONFIG.ENEMIES.LEAPER;
                e1.state = 'PINNING';
                e1.pinnedTarget = e2;
                e1.pinHitCount = 0;
                e1.lastPinDamageTime = time;
                e2.pinnedByLeaper = e1;
                e1.setVelocity(0);
                e2.setVelocity(0);
                const pct = cfg.PIN_DAMAGE_FIRST_PCT != null ? cfg.PIN_DAMAGE_FIRST_PCT : 0.1;
                const dmg = Math.max(1, Math.ceil(e2.maxHp * pct)) * 2; // Leaper double damage to bandits
                e2.takeDamage(dmg, 'melee', e1.x, e1.y);
                e1.pinHitCount = 1;
            } else if (e2.enemyType === 'leaper' && e1.enemyType === 'bandit' && e2.state === 'LEAP') {
                const cfg = CONFIG.ENEMIES.LEAPER;
                e2.state = 'PINNING';
                e2.pinnedTarget = e1;
                e2.pinHitCount = 0;
                e2.lastPinDamageTime = time;
                e1.pinnedByLeaper = e2;
                e2.setVelocity(0);
                e1.setVelocity(0);
                const pct = cfg.PIN_DAMAGE_FIRST_PCT != null ? cfg.PIN_DAMAGE_FIRST_PCT : 0.1;
                const dmg = Math.max(1, Math.ceil(e1.maxHp * pct)) * 2; // Leaper double damage to bandits
                e1.takeDamage(dmg, 'melee', e2.x, e2.y);
                e2.pinHitCount = 1;
            } else if (e1.enemyType === 'bandit' && e2.enemyType === 'walker') {
                if ((e1.lastMeleeHitTime || 0) + meleeCooldown <= time) {
                    const cfg = CONFIG.ENEMIES.BANDIT;
                    e2.takeDamage(cfg.DAMAGE || 1, 'melee', e1.x, e1.y);
                    e1.lastMeleeHitTime = time;
                }
                if ((e2.lastMeleeHitTime || 0) + walkerVsBanditCooldown <= time) {
                    e1.takeDamage(e2.damage, 'melee', e2.x, e2.y);
                    e2.lastMeleeHitTime = time;
                }
            } else if (e1.enemyType === 'bandit' && e2.enemyType === 'leaper') {
                if ((e1.lastMeleeHitTime || 0) + meleeCooldown <= time) {
                    const cfg = CONFIG.ENEMIES.BANDIT;
                    e2.takeDamage(cfg.DAMAGE || 1, 'melee', e1.x, e1.y);
                    e1.lastMeleeHitTime = time;
                }
            }
        });

        this.physics.add.overlap(this.player, this.pickups, (p, item) => {
            this.applyLoot(item.getData('type'));
            item.destroy();
            this.onPlayerSearchNoise(this.player.x, this.player.y);
        });

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D,SHIFT');
        this.keys = this.input.keyboard.addKeys({
            interact: Phaser.Input.Keyboard.KeyCodes.F,
            space: Phaser.Input.Keyboard.KeyCodes.SPACE,
            esc: Phaser.Input.Keyboard.KeyCodes.ESC,
            melee: Phaser.Input.Keyboard.KeyCodes.E,
            switch: Phaser.Input.Keyboard.KeyCodes.Q,
            inv: Phaser.Input.Keyboard.KeyCodes.I,
            tab: Phaser.Input.Keyboard.KeyCodes.TAB,
            nvg: Phaser.Input.Keyboard.KeyCodes.N,
            reload: Phaser.Input.Keyboard.KeyCodes.R,
            grenade: Phaser.Input.Keyboard.KeyCodes.G,
            consumable1: Phaser.Input.Keyboard.KeyCodes.ONE,
            consumable2: Phaser.Input.Keyboard.KeyCodes.TWO,
            consumable3: Phaser.Input.Keyboard.KeyCodes.THREE,
            laser: Phaser.Input.Keyboard.KeyCodes.L,
            flashlight: Phaser.Input.Keyboard.KeyCodes.T,
            crouch: Phaser.Input.Keyboard.KeyCodes.C,
            visionDebug: Phaser.Input.Keyboard.KeyCodes.V,
            damageLog: Phaser.Input.Keyboard.KeyCodes.BACKTICK
        });
        
        this.damageLog = [];
        this.damageLogVisible = true;
        this.damageLogBg = this.add.rectangle(515, 455, 235, 145, 0x000000, 0.5).setOrigin(0, 0).setDepth(149).setScrollFactor(0).setVisible(true);
        this.damageLogText = this.add.text(522, 592, '', { fontSize: '11px', fill: '#dddddd', align: 'left' }).setOrigin(0, 1).setDepth(150).setScrollFactor(0).setVisible(true);
        
        // Sensory overlay (vision cones, sound radii) - V toggles for testing
        this.showSensoryOverlay = true;
        
        // Laser sight toggle (default on)
        this.laserEnabled = true;
        this.flashlightOn = true;
        this.input.on('pointerdown', (p) => {
            this.fireBullet(p);
            if (this.playerStats.currentWeapon === 'smg' || this.playerStats.currentWeapon === 'rifle') this.holdingFire = true;
        });
        this.input.on('pointerup', () => { this.holdingFire = false; });
        
        // Mouse wheel for weapon switching
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
            if (this.isPaused || this.isInventoryOpen) return;
            if (deltaY > 0) this.switchWeapon(1);  // Scroll down = next weapon
            else if (deltaY < 0) this.switchWeapon(-1); // Scroll up = previous weapon
        });

        // Level text (UI elements like uiGraphics, bossBar already created above)
        this.levelText = this.add.text(400, 300, `LEVEL ${this.currentLevel}`, { fontSize: '64px', fill: '#fff' }).setOrigin(0.5).setDepth(200);
        this.tweens.add({ targets: this.levelText, alpha: 0, duration: 2000, delay: 1000 });
        
        // Play level start sound
        sfx.levelStart();

        this.createInventoryUI();
        this.pauseText = this.add.text(400, 300, 'PAUSED', { fontSize: '48px', fill: '#fff' }).setOrigin(0.5).setDepth(200).setVisible(false);

        // Lighting & NVG
        this.lightShape = this.make.graphics({ x: 0, y: 0, add: false });
        const mask = this.lightShape.createGeometryMask();
        mask.setInvertAlpha(true);
        this.darkness = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.96).setDepth(90);
        this.darkness.setMask(mask);
        this.headsetRingGraphics = this.add.graphics().setDepth(91).setVisible(false);  // ring at 0.85 when headset equipped
        this.headsetSoundOutlines = this.add.graphics().setDepth(92).setVisible(false);  // blue outlines for enemies in sound radius
        this.nvgLayer = this.add.rectangle(400, 300, 800, 600, 0x00ff00, 0.2).setDepth(95).setVisible(false);
        
        this.walkerVisionGraphics = this.add.graphics().setDepth(85).setVisible(true); // Testing: walker + bandit vision cones
        this.leaperVisionGraphics = this.add.graphics().setDepth(86).setVisible(true); // Testing: leaper sensory
        
        // Low HP Vignette - red edges when health is low
        this.vignetteGraphics = this.add.graphics().setDepth(105);
        
        // Scene shutdown cleanup
        this.events.on('shutdown', this.shutdown, this);

        // Dev: recreate mag-pickup test (empty room, mag on floor, pistol already loaded)
        window.setupMagPickupTest = () => this.setupMagPickupTest();
        if (data.smoke === 'magPickup') {
            this.time.delayedCall(50, () => this.setupMagPickupTest());
        }
    }

    /**
     * Mag-pickup smoke setup — also auto-run via /?smoke=magPickup
     * Clears the current room, ensures pistol has a mag equipped, drops a spare mag nearby.
     */
    setupMagPickupTest() {
        if (!this.player || !this.playerStats) {
            console.warn('setupMagPickupTest: start a raid first');
            return 'not in raid';
        }
        if (this.enemies) this.enemies.clear(true, true);
        if (this.crates) this.crates.clear(true, true);
        if (this.skulls) this.skulls.clear(true, true);
        if (this.pickups) this.pickups.clear(true, true);
        if (this.droppedInventoryItems) this.droppedInventoryItems.clear(true, true);
        if (this.edgeSpawnTimer) this.edgeSpawnTimer.paused = true;

        const stats = this.playerStats;
        ensurePockets(stats);
        ensureBackpackStats(stats);
        ensureRigStats(stats);
        // Remove spare pistol mags so the floor pickup is the only stow candidate
        (stats.pockets || []).forEach((row, pi) => {
            (row || []).forEach((slot, si) => {
                if (slot && slot.itemId === 'mag_pistol') stats.pockets[pi][si] = null;
            });
        });
        if (stats.backpack && Array.isArray(stats.backpack.items)) {
            stats.backpack.items = stats.backpack.items.filter(p => p.itemId !== 'mag_pistol');
        }
        if (stats.rigGrid && Array.isArray(stats.rigGrid.items)) {
            stats.rigGrid.items = stats.rigGrid.items.filter(p => p.itemId !== 'mag_pistol');
        }

        stats.currentWeapon = 'pistol';
        if (!stats.weaponSlots) stats.weaponSlots = { primary: null, secondary: null, sidearm: 'pistol', melee: null };
        stats.weaponSlots.sidearm = 'pistol';
        const cap = getMagazineCapacity('mag_pistol');
        setEquippedMag(stats, 'pistol', { itemId: 'mag_pistol', rounds: Math.min(10, cap), maxRounds: cap });

        if (!this.textures.exists('pickup_dropped')) {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0x8B4513, 1);
            g.fillCircle(8, 8, 8);
            g.generateTexture('pickup_dropped', 16, 16);
        }
        const spr = this.add.image(this.player.x + 48, this.player.y, 'pickup_dropped').setDepth(5);
        this.droppedInventoryItems.add(spr);
        spr.setData('type', { itemId: 'mag_pistol', count: 1, rounds: 5, maxRounds: cap });

        this.showFloatingText(this.player.x, this.player.y - 40, 'MAG TEST: F to pick up', 0x00ff00);
        console.log('setupMagPickupTest: room cleared, pistol loaded, spare mag on floor — press F to pick up');
        return 'ok';
    }
    
    shutdown() {
        if (window.setupMagPickupTest) delete window.setupMagPickupTest;
        // Clean up graphics objects to prevent errors during transition
        if (this.lightShape) {
            this.lightShape.destroy();
            this.lightShape = null;
        }
        if (this.headsetRingGraphics) {
            this.headsetRingGraphics.destroy();
            this.headsetRingGraphics = null;
        }
        if (this.headsetSoundOutlines) {
            this.headsetSoundOutlines.destroy();
            this.headsetSoundOutlines = null;
        }
        if (this.vignetteGraphics) {
            this.vignetteGraphics.destroy();
            this.vignetteGraphics = null;
        }
        if (this.walkerVisionGraphics) {
            this.walkerVisionGraphics.destroy();
            this.walkerVisionGraphics = null;
        }
        if (this.leaperVisionGraphics) {
            this.leaperVisionGraphics.destroy();
            this.leaperVisionGraphics = null;
        }
        if (this.uiGraphics) {
            this.uiGraphics.destroy();
            this.uiGraphics = null;
        }
        if (this.extractHudText) {
            this.extractHudText.destroy();
            this.extractHudText = null;
        }
        if (this._deathRecapKeyHandler && this.input && this.input.keyboard) {
            this.input.keyboard.off('keydown', this._deathRecapKeyHandler);
            this._deathRecapKeyHandler = null;
        }
        if (this.edgeSpawnTimer) { this.edgeSpawnTimer.destroy(); this.edgeSpawnTimer = null; }
        this.events.off('shutdown', this.shutdown, this);
    }

    formatRunClock(ms) {
        const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /** HUD status for extract pressure: beacon / key / exit / switch / final. */
    getExtractPressureStatus() {
        if (this.extractionActive) {
            const maxSec = Math.max(1, Math.round((CONFIG.TIMINGS.EXTRACTION || 15000) / 1000));
            const t = Math.max(0, this.extractionTimer || 0);
            return {
                kind: 'beacon',
                label: `BEACON ${t}s`,
                color: '#ff4444',
                progress: t / maxSec
            };
        }
        if (this.currentLevel === 7) {
            return { kind: 'final', label: 'FINAL — ACTIVATE EXTRACT', color: '#ffaa44', progress: null };
        }
        if (this.currentLevel === 5 && this.switchDropped) {
            return { kind: 'switch', label: 'HIT THE SWITCH', color: '#66ff88', progress: null };
        }
        const needsKey = this.currentLevel === 5
            || ((CONFIG.LOOT.LEVELS_NEEDING_KEY || []).includes(this.currentLevel));
        if (needsKey && !hasDoorKey(this.playerStats)) {
            return { kind: 'key', label: 'FIND KEY', color: '#ffcc44', progress: null };
        }
        let distLabel = '';
        if (this.door && this.door.active && this.player) {
            let showDist = true;
            if (this.roomGrid && this.roomGrid.rooms) {
                const currentRoom = this.roomGrid.rooms[this.roomGrid.currentRoom];
                showDist = !!(currentRoom && currentRoom.isExit);
            }
            if (showDist) {
                const d = Math.round(Phaser.Math.Distance.Between(this.player.x, this.player.y, this.door.x, this.door.y));
                distLabel = ` ${d}m`;
            }
        }
        return { kind: 'ready', label: `EXIT OPEN${distLabel}`, color: '#66ff88', progress: null };
    }

    // ==================== SKILL HELPER ====================
    hasSkill(skillId) {
        return this.persistent?.unlockedSkills?.includes(skillId) || false;
    }
    
    // Update challenge progress for daily/weekly challenges based on current run
    updateChallengeProgress() {
        if (!this.persistent.activeDailies) this.persistent.activeDailies = [];
        if (!this.persistent.activeWeeklies) this.persistent.activeWeeklies = [];
        
        // Update daily challenges based on run stats
        this.persistent.activeDailies.forEach(challenge => {
            const config = CONFIG.CHALLENGES.DAILY.find(c => c.id === challenge.id);
            if (!config || challenge.claimed) return;
            
            switch (config.stat) {
                case 'runMeleeKills':
                    challenge.progress = this.persistent.runMeleeKills || 0;
                    break;
                case 'runKills':
                    challenge.progress = this.persistent.runKills || 0;
                    break;
                case 'levelNoDamage':
                    if (this.levelDamageTaken === 0) challenge.progress = 1;
                    break;
                case 'highAccuracy':
                    if (this.persistent.runShotsFired >= 20) {
                        const acc = this.persistent.runShotsHit / this.persistent.runShotsFired;
                        if (acc >= 0.6) challenge.progress = 1;
                    }
                    break;
                case 'runGrenadeKills':
                    challenge.progress = this.persistent.runGrenadeKills || 0;
                    break;
                case 'runScrapCollected':
                    challenge.progress = this.persistent.runScrapCollected || 0;
                    break;
                case 'speedRun':
                    const levelTime = Date.now() - (this.levelStartTime || Date.now());
                    if (levelTime < 120000) challenge.progress = 1; // Under 2 minutes
                    break;
                case 'pistolOnly':
                    // Check if only pistol was used (no other weapons acquired/switched)
                    if (!this.playerStats.hasShotgun && !this.playerStats.hasSMG && 
                        !this.playerStats.hasCrossbow && !this.playerStats.hasRifle) {
                        challenge.progress = 1;
                    }
                    break;
            }
            // Cap progress at target
            challenge.progress = Math.min(challenge.progress, config.target);
        });
        
        // Update weekly challenges based on weekly stats
        this.persistent.activeWeeklies.forEach(challenge => {
            const config = CONFIG.CHALLENGES.WEEKLY.find(c => c.id === challenge.id);
            if (!config || challenge.claimed) return;
            
            switch (config.stat) {
                case 'weeklyKills':
                    challenge.progress = this.persistent.weeklyKills || 0;
                    break;
                case 'weeklyExtractions':
                    challenge.progress = this.persistent.weeklyExtractions || 0;
                    break;
                case 'weeklyBossKills':
                    challenge.progress = this.persistent.weeklyBossKills || 0;
                    break;
                case 'weeklyScrap':
                    challenge.progress = this.persistent.weeklyScrap || 0;
                    break;
                case 'weeklyUniqueLevels':
                    challenge.progress = (this.persistent.weeklyUniqueLevels || []).length;
                    break;
            }
            // Cap progress at target
            challenge.progress = Math.min(challenge.progress, config.target);
        });
    }
    
    // Calculate skill points earned from a run based on performance
    calculateRunSkillPoints() {
        let points = 1; // Base: 1 point per extraction
        
        // Bonus: +1 for no damage taken this level
        if (this.levelDamageTaken === 0) {
            points += 1;
        }
        
        // Bonus: +1 for boss killed this run (levels 5 and 7 have bosses)
        if (this.currentLevel === 5 || this.currentLevel === 7) {
            points += 1;
        }
        
        // Bonus: +1 for 50%+ accuracy (min 10 shots)
        if (this.persistent.runShotsFired >= 10) {
            const accuracy = this.persistent.runShotsHit / this.persistent.runShotsFired;
            if (accuracy >= 0.5) {
                points += 1;
            }
        }
        
        return points;
    }

    // ==================== DODGE ROLL ====================
    performDodgeRoll() {
        const now = this.time.now;
        const cfg = CONFIG.PLAYER;
        
        // Check cooldown and stamina
        if (now - this.lastDodgeTime < cfg.DODGE_COOLDOWN) return;
        if (this.playerStats.stamina < cfg.DODGE_STAMINA_COST) {
            this.showFloatingText(this.player.x, this.player.y - 40, "NO STAMINA!", 0xff0000);
            return;
        }
        if (this.isDodging || this.isPinned || this.isReloading) return;
        if (this.isCrouching) return; // Can't dodge while crouched
        const limbHp = this.playerStats.limbHp;
        const legBroken = (id) => limbHp && limbHp[id] && Array.isArray(limbHp[id].effects) && limbHp[id].effects.includes('break');
        if (legBroken('leftLeg') || legBroken('rightLeg')) return; // Can't roll on a broken leg

        // Get movement direction or face direction
        let vx = 0, vy = 0;
        if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
        else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
        else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;
        
        // If not moving, dodge toward mouse
        if (vx === 0 && vy === 0) {
            const angle = Phaser.Math.Angle.Between(
                this.player.x, this.player.y,
                this.input.activePointer.x, this.input.activePointer.y
            );
            vx = Math.cos(angle);
            vy = Math.sin(angle);
        } else {
            // Normalize
            const len = Math.sqrt(vx * vx + vy * vy);
            vx /= len;
            vy /= len;
        }
        
        // Consume stamina
        this.playerStats.stamina -= cfg.DODGE_STAMINA_COST;
        this.isDodging = true;
        this.lastDodgeTime = now;
        
        // Visual feedback
        sfx.dodge();
        this.player.setAlpha(0.5);
        this.player.setTint(0x00ffff);
        
        // Apply velocity
        this.player.setVelocity(vx * cfg.DODGE_SPEED, vy * cfg.DODGE_SPEED);

        // Broken arm: half HP damage per roll, black after 2nd roll
        const limbHpArm = this.playerStats.limbHp;
        if (limbHpArm) {
            if (!this.brokenArmRollCount) this.brokenArmRollCount = {};
            ['leftArm', 'rightArm'].forEach(armId => {
                if (!limbHasBreak(limbHpArm, armId)) return;
                const arm = limbHpArm[armId];
                if (!arm || (arm.hp || 0) <= 0) return;
                const count = (this.brokenArmRollCount[armId] || 0) + 1;
                this.brokenArmRollCount[armId] = count;
                if (count >= 2) {
                    arm.hp = 0;
                    if (Array.isArray(arm.effects) && !arm.effects.includes('trauma')) arm.effects.push('trauma');
                    this.brokenArmRollCount[armId] = 0;
                } else {
                    const halfDmg = Math.floor((arm.hp || 0) / 2);
                    arm.hp = Math.max(0, (arm.hp || 0) - halfDmg);
                    if (arm.hp === 0 && Array.isArray(arm.effects) && !arm.effects.includes('trauma')) arm.effects.push('trauma');
                }
            });
            this.playerStats.hp = sumLimbHp(limbHpArm);
            this.playerStats.maxHp = sumLimbMaxHp(limbHpArm);
            this.ensureCurrentWeaponInSlots();
            if ((this.hasNoGoodArms() || this.hasOneArmBlacked()) && ['shotgun', 'smg', 'crossbow', 'rifle'].includes(this.playerStats.currentWeapon)) {
                const slotted = this.getSlottedWeaponList();
                this.playerStats.currentWeapon = slotted.includes('pistol') ? 'pistol' : (slotted[0] || this.playerStats.currentWeapon);
            }
        }

        // End dodge after duration
        this.time.delayedCall(cfg.DODGE_DURATION, () => {
            this.isDodging = false;
            this.player.setAlpha(1);
            this.player.clearTint();
        });
    }

    // ==================== RELOAD SYSTEM ====================
    startReload() {
        if (this.isReloading) return;
        if (this.hasBothArmsBlacked()) {
            this.showFloatingText(this.player.x, this.player.y - 40, "ARMS DESTROYED - CAN'T RELOAD", 0xff0000);
            return;
        }
        this.ensureCurrentWeaponInSlots();
        const slotted = this.getSlottedWeaponList();
        if (!slotted.length || !slotted.includes(this.playerStats.currentWeapon)) return;
        const weapon = this.playerStats.currentWeapon;
        const wpnConfig = CONFIG.WEAPONS[weapon.toUpperCase()];
        const magWeapons = ['pistol', 'smg', 'rifle'];

        if (magWeapons.includes(weapon)) {
            // Physical mag swap: rig/pocket only
            ensureEquippedMagazines(this.playerStats);
            const equipped = getEquippedMag(this.playerStats, weapon);
            const found = findFirstMagInRigOrPockets(this.playerStats, weapon);
            if (!found) {
                this.showFloatingText(this.player.x, this.player.y - 40, "NO MAG IN RIG/POCKET", 0xff0000);
                return;
            }
            this.isReloading = true;
            sfx.reload();
            let reloadTime = Math.floor((wpnConfig.RELOAD_TIME || 1000) * (1 - (this.swiftReloadBonus || 0)));
            const limbHpRel = this.playerStats.limbHp;
            const slowReload = (limbHpRel && (limbHasBreak(limbHpRel, 'leftArm') || limbHasBreak(limbHpRel, 'rightArm'))) || this.hasOneArmBlacked();
            if (limbHpRel && (limbHasBreak(limbHpRel, 'leftArm') || limbHasBreak(limbHpRel, 'rightArm'))) reloadTime += 600;
            if (this.hasOneArmBlacked()) reloadTime += 600;
            this.showFloatingText(this.player.x, this.player.y - 40, slowReload ? "SLOW RELOAD..." : "RELOADING...", slowReload ? 0xffaa00 : 0xffff00);
            this.reloadTimer = this.time.delayedCall(reloadTime, () => {
                if (equipped) placeMagInRigPocketBackpackOrGround(this, this.playerStats, equipped);
                setEquippedMag(this.playerStats, weapon, null);
                removeMagFromRigOrPocket(this.playerStats, found);
                setEquippedMag(this.playerStats, weapon, { itemId: found.itemId, rounds: found.rounds, maxRounds: found.maxRounds });
                this.isReloading = false;
                this.reloadTimer = null;
                sfx.reloadFinish();
                this.showFloatingText(this.player.x, this.player.y - 40, "RELOADED!", 0x00ff00);
                if (this.hasNoGoodArms()) this.applyBothArmsActionDamage();
            });
            return;
        }

        // Shotgun / crossbow: reserve ammo
        const currentMag = this.playerStats.magazines[weapon];
        const modEffects = this.weaponModEffects?.[weapon] || { magSizeMultiplier: 1 };
        const effectiveMagSize = Math.floor(wpnConfig.MAG_SIZE * modEffects.magSizeMultiplier);
        if (currentMag >= effectiveMagSize) {
            this.showFloatingText(this.player.x, this.player.y - 40, "MAG FULL", 0xffff00);
            return;
        }
        const reserveAmmo = getReserveAmmoCount(this.playerStats, weapon);
        if (reserveAmmo <= 0) {
            const ammoType = CONFIG.AMMO_TYPES && CONFIG.AMMO_TYPES[weapon];
            const label = ammoType ? ammoType.label.toUpperCase() : 'AMMO';
            this.showFloatingText(this.player.x, this.player.y - 40, `NO ${label}!`, 0xff0000);
            return;
        }
        this.isReloading = true;
        sfx.reload();
        let reloadTime = Math.floor(wpnConfig.RELOAD_TIME * (1 - (this.swiftReloadBonus || 0)));
        const limbHpRel = this.playerStats.limbHp;
        const slowReload = (limbHpRel && (limbHasBreak(limbHpRel, 'leftArm') || limbHasBreak(limbHpRel, 'rightArm'))) || this.hasOneArmBlacked();
        if (limbHpRel && (limbHasBreak(limbHpRel, 'leftArm') || limbHasBreak(limbHpRel, 'rightArm'))) reloadTime += 600;
        if (this.hasOneArmBlacked()) reloadTime += 600;
        this.showFloatingText(this.player.x, this.player.y - 40, slowReload ? "SLOW RELOAD..." : "RELOADING...", slowReload ? 0xffaa00 : 0xffff00);
        this.reloadTimer = this.time.delayedCall(reloadTime, () => {
            const needed = effectiveMagSize - this.playerStats.magazines[weapon];
            const toLoad = Math.min(needed, getReserveAmmoCount(this.playerStats, weapon));
            const removed = removeReserveAmmo(this.playerStats, weapon, toLoad);
            this.playerStats.magazines[weapon] += removed;
            this.isReloading = false;
            this.reloadTimer = null;
            sfx.reloadFinish();
            this.showFloatingText(this.player.x, this.player.y - 40, "RELOADED!", 0x00ff00);
            if (this.hasNoGoodArms()) this.applyBothArmsActionDamage();
        });
    }
    
    cancelReload() {
        if (this.reloadTimer) {
            this.reloadTimer.remove();
            this.reloadTimer = null;
        }
        this.isReloading = false;
    }

    // ==================== COMBAT JUICE ====================
    doHitstop(ms) {
        if (this._hitstopActive || !ms) return;
        this._hitstopActive = true;
        if (this.physics && this.physics.world) this.physics.world.pause();
        this.time.delayedCall(ms, () => {
            if (this.physics && this.physics.world) this.physics.world.resume();
            this._hitstopActive = false;
        });
    }

    /** Weapon fire feel: shake + tracer + casing + smoke (respects silent / settings). */
    applyFireJuice(weapon, angle, silent = false) {
        const shake = (CONFIG.JUICE.SHAKE && CONFIG.JUICE.SHAKE[weapon]) || CONFIG.JUICE.SHAKE.pistol;
        if (!silent && this.gameSettings.screenShake && shake) {
            this.cameras.main.shake(shake.duration, shake.intensity);
        }
        if (!this.particles) return;
        if (weapon === 'crossbow') {
            this.particles.spawnTracer(this.player.x, this.player.y, angle, 42, 0xc4a574);
            return;
        }
        if (silent) return;
        const tracerLen = weapon === 'rifle' ? 44 : (weapon === 'shotgun' ? 28 : 34);
        this.particles.spawnTracer(this.player.x, this.player.y, angle, tracerLen);
        this.particles.spawnShellCasing(this.player.x, this.player.y, angle);
        if (weapon === 'shotgun') this.particles.spawnShellCasing(this.player.x, this.player.y, angle);
        this.particles.spawnMuzzleSmoke(this.player.x, this.player.y, angle);
    }

    updateLowHpPostFX(hpPercent) {
        const cam = this.cameras && this.cameras.main;
        if (!cam || !cam.postFX) return;
        const threshold = CONFIG.PLAYER.LOW_HP_THRESHOLD;
        if (hpPercent > threshold) {
            if (this._satFX) {
                try { cam.postFX.remove(this._satFX); } catch (e) { /* ignore */ }
                this._satFX = null;
            }
            return;
        }
        if (!this._satFX) {
            try { this._satFX = cam.postFX.addColorMatrix(); } catch (e) { return; }
        }
        // 1 = full color; drop toward grey as HP falls
        const sat = Math.max(0.15, hpPercent / threshold);
        try { this._satFX.saturation(sat); } catch (e) { /* API variance */ }
    }

    // ==================== LOW HP VIGNETTE ====================
    drawVignette() {
        if (!this.vignetteGraphics) return;
        this.vignetteGraphics.clear();
        
        const hpPercent = this.playerStats.hp / this.playerStats.maxHp;
        this.updateLowHpPostFX(hpPercent);
        if (hpPercent > CONFIG.PLAYER.LOW_HP_THRESHOLD) return;
        
        // Intensity increases as HP decreases
        const intensity = 1 - (hpPercent / CONFIG.PLAYER.LOW_HP_THRESHOLD);
        const alpha = 0.3 + intensity * 0.4; // 0.3 to 0.7
        
        // Pulsing effect when very low
        let pulseAlpha = alpha;
        if (hpPercent < 0.15) {
            const pulse = Math.sin(this.time.now / 200) * 0.15;
            pulseAlpha = alpha + pulse;
            const beatEvery = CONFIG.JUICE.HEARTBEAT_INTERVAL_MS || 750;
            if (this.time.now - (this._lastHeartbeat || 0) > beatEvery) {
                this._lastHeartbeat = this.time.now;
                sfx.heartbeat();
            }
        }
        
        // Draw red gradient from edges
        const thickness = 60 + intensity * 40; // 60-100px thick
        
        // Top edge
        this.vignetteGraphics.fillGradientStyle(0xff0000, 0xff0000, 0xff0000, 0xff0000, pulseAlpha, pulseAlpha, 0, 0);
        this.vignetteGraphics.fillRect(0, 0, 800, thickness);
        
        // Bottom edge
        this.vignetteGraphics.fillGradientStyle(0xff0000, 0xff0000, 0xff0000, 0xff0000, 0, 0, pulseAlpha, pulseAlpha);
        this.vignetteGraphics.fillRect(0, 600 - thickness, 800, thickness);
        
        // Left edge
        this.vignetteGraphics.fillGradientStyle(0xff0000, 0xff0000, 0xff0000, 0xff0000, pulseAlpha, 0, 0, pulseAlpha);
        this.vignetteGraphics.fillRect(0, 0, thickness, 600);
        
        // Right edge
        this.vignetteGraphics.fillGradientStyle(0xff0000, 0xff0000, 0xff0000, 0xff0000, 0, pulseAlpha, pulseAlpha, 0);
        this.vignetteGraphics.fillRect(800 - thickness, 0, thickness, 600);
    }

    spawnLootSkull(x, y, enemyType, killSource = 'gun') {
        // Track kill stats
        this.persistent.runKills++;
        this.persistent.totalKills++;
        
        // Challenge tracking - weekly kills
        this.persistent.weeklyKills = (this.persistent.weeklyKills || 0) + 1;
        
        if (killSource === 'melee') {
            this.persistent.meleeKills++;
            this.persistent.runMeleeKills++;
        } else if (killSource === 'grenade') {
            this.persistent.totalGrenadeKills++;
            this.persistent.runGrenadeKills++;
        } else if (killSource === 'crossbow') {
            // Track crossbow kills for permanent challenge
            this.persistent.crossbowKills = (this.persistent.crossbowKills || 0) + 1;
        }
        
        if (enemyType === 'boss') {
            this.persistent.bossesKilled++;
            // Challenge tracking - weekly boss kills
            this.persistent.weeklyBossKills = (this.persistent.weeklyBossKills || 0) + 1;
        }
        
        // Check achievements after kill
        const newAchievements = checkAchievements(this.persistent, {
            hasAllWeapons: this.playerStats.hasShotgun && this.playerStats.hasSMG
        });
        newAchievements.forEach(a => {
            sfx.achievement();
            this.showFloatingText(400, 200, `${a.icon} ${a.name}!`, 0xffd700);
        });
        
        // NEW: Auto-collect currency based on enemy type
        const dropConfig = CONFIG.ENEMY_DROPS[enemyType.toUpperCase()];
        if (dropConfig) {
            let amount = Phaser.Math.Between(dropConfig.min, dropConfig.max);
            // Scavenger class: +50% loot drops
            if (this.persistent.selectedClass === 'scavenger') {
                amount = Math.floor(amount * 1.5);
            }
            const currency = dropConfig.currency;
            
            // Scrapper skill: +25% scrap bonus
            if (currency === 'scrap' && this.scrapperBonus > 0) {
                amount = Math.floor(amount * (1 + this.scrapperBonus));
            }
            
            // Add currency to player and track in persistent stats
            if (currency === 'scrap') {
                this.playerStats.scrap += amount;
                this.persistent.totalScrapCollected += amount;
                // Challenge tracking - run and weekly scrap
                this.persistent.runScrapCollected = (this.persistent.runScrapCollected || 0) + amount;
                this.persistent.weeklyScrap = (this.persistent.weeklyScrap || 0) + amount;
            } else if (currency === 'credits') {
                this.playerStats.credits += amount;
                this.persistent.totalCreditsEarned += amount;
            } else if (currency === 'materials') {
                this.playerStats.materials += amount;
                this.persistent.totalMaterialsCollected += amount;
            }
            
            // Show floating text for currency
            const currencyConfig = CONFIG.CURRENCIES[currency.toUpperCase()];
            this.showFloatingText(x, y - 20, `+${amount} ${currencyConfig.icon}`, currencyConfig.color);
            sfx.loot();
            
            // Spawn skull with random item (not currency) if items available
            if (dropConfig.items && dropConfig.items.length > 0) {
                const item = Phaser.Utils.Array.GetRandom(dropConfig.items);
                let s = this.skulls.create(x, y, 'skull').setScale(0.8);
                s.setData('lootID', item);
            }
        }
        
        savePersistent(this.persistent);
    }

    // ==================== ACID SPIT (Spitter Enemy) ====================
    spawnAcidSpit(fromX, fromY, toX, toY) {
        const acid = this.acidProjectiles.create(fromX, fromY, 'acid');
        if (!acid) return;
        
        acid.hasHit = false;
        acid.setDepth(15);
        
        const angle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
        this.physics.velocityFromRotation(angle, CONFIG.ENEMIES.SPITTER.SPIT_SPEED, acid.body.velocity);
        
        // Destroy after 3 seconds if not hit
        this.time.delayedCall(3000, () => {
            if (acid.active) {
                acid.setActive(false);
                acid.setVisible(false);
                acid.body.enable = false;
            }
        });
    }

    // ==================== GRENADE SYSTEM ====================
    throwGrenade() {
        if (getUsableGrenadeCount(this.playerStats) <= 0) {
            this.showFloatingText(this.player.x, this.player.y - 40, "NO GRENADES!", 0xff0000);
            return;
        }
        if (this.isDodging || this.isPinned || this.isReloading) return;
        if (this.hasOneArmBlacked() || this.hasBothArmsBlacked()) {
            this.showFloatingText(this.player.x, this.player.y - 40, "NEED TWO ARMS TO THROW", 0xff6600);
            return;
        }

        const limbHpGr = this.playerStats.limbHp;
        if (this.hasNoGoodArms()) {
            this.applyBothArmsActionDamage();
        }

        const oneArmBroken = limbHpGr && (limbHasBreak(limbHpGr, 'leftArm') || limbHasBreak(limbHpGr, 'rightArm'));
        if (oneArmBroken || this.hasNoGoodArms()) {
            if (!removeOneGrenadeFromPocketOrRig(this.playerStats)) return;
            this.showFloatingText(this.player.x, this.player.y - 40, "Pulling pin...", 0xffff00);
            this.time.delayedCall(1200, () => { this.doThrowGrenade(); });
            return;
        }

        if (!removeOneGrenadeFromPocketOrRig(this.playerStats)) return;
        this.doThrowGrenade();
    }

    doThrowGrenade() {
        sfx.grenadeThrow();
        const grenade = this.grenades.create(this.player.x, this.player.y, 'grenade');
        if (!grenade) return;

        grenade.setDepth(15);
        grenade.hasExploded = false;

        // Throw toward mouse
        const angle = Phaser.Math.Angle.Between(
            this.player.x, this.player.y,
            this.input.activePointer.x, this.input.activePointer.y
        );
        this.physics.velocityFromRotation(angle, CONFIG.GRENADE.THROW_SPEED, grenade.body.velocity);
        
        // Slow down over time (drag)
        grenade.body.setDrag(200, 200);

        // Explode after fuse time
        this.time.delayedCall(CONFIG.GRENADE.FUSE_TIME, () => {
            if (grenade.active && !grenade.hasExploded) {
                this.explodeGrenade(grenade.x, grenade.y);
                grenade.hasExploded = true;
                grenade.destroy();
            }
        });
    }
    
    // ==================== CONSUMABLE SYSTEM ====================
    useConsumable(slot) {
        if (this.isPaused || this.isInventoryOpen || this.isDodging || this.isPinned) return;
        
        // Defensive check for corrupted consumables array
        if (!this.playerStats.consumables || !Array.isArray(this.playerStats.consumables)) {
            this.playerStats.consumables = [null, null, null];
        }
        
        const consumable = this.playerStats.consumables[slot];
        if (!consumable) {
            this.showFloatingText(this.player.x, this.player.y - 40, `SLOT ${slot + 1} EMPTY`, 0xff0000);
            return;
        }
        
        const config = CONFIG.CONSUMABLES[consumable];
        if (!config) return;
        
        // Apply effect based on consumable type
        if (config.effect === 'speed') {
            // Adrenaline - speed boost
            this.speedMultiplier = config.multiplier;
            sfx.useConsumable();
            this.showFloatingText(this.player.x, this.player.y - 40, "ADRENALINE!", 0x00ff00);
            
            // Visual feedback - tint player
            this.player.setTint(0x00ff00);
            
            // End effect after duration
            this.time.delayedCall(config.duration, () => {
                this.speedMultiplier = this.baseSpeedMultiplier; // Return to base (class-modified) speed
                if (this.player.active) {
                    this.player.clearTint();
                    this.showFloatingText(this.player.x, this.player.y - 40, "Speed normal", 0xffffff);
                }
            });
        } else if (config.effect === 'repair') {
            // Armor Patch - instant armor repair
            let repaired = false;
            const slots = ['head', 'body', 'arms', 'feet'];
            for (const armorSlot of slots) {
                if (this.playerStats.armor[armorSlot]) {
                    const armor = this.playerStats.armor[armorSlot];
                    if (armor.durability < armor.maxDurability) {
                        armor.durability = Math.min(armor.durability + config.amount, armor.maxDurability);
                        repaired = true;
                    }
                }
            }
            
            if (repaired) {
                sfx.useConsumable();
                this.showFloatingText(this.player.x, this.player.y - 40, "ARMOR PATCHED!", 0x00aaff);
            } else {
                this.showFloatingText(this.player.x, this.player.y - 40, "No armor to repair!", 0xff0000);
                return; // Don't consume if nothing to repair
            }
        } else if (config.effect === 'cure_infection') {
            ensureLimbVisStats(this.playerStats);
            if ((this.playerStats.infection || 0) <= 0) {
                this.showFloatingText(this.player.x, this.player.y - 40, "NOT INFECTED", 0xffaa00);
                return;
            }
            this.clearInfection(true);
            sfx.useConsumable();
            this.showFloatingText(this.player.x, this.player.y - 40, "ANTIDOTE!", 0x66ff88);
        }
        
        // Remove consumable from slot
        this.playerStats.consumables[slot] = null;
    }

    explodeGrenade(x, y) {
        sfx.explosion();
        if (this.gameSettings.screenShake) this.cameras.main.shake(200, 0.02);

        // Visual explosion
        const explosion = this.add.circle(x, y, 10, 0xff4500, 1).setDepth(100);
        this.tweens.add({
            targets: explosion,
            radius: CONFIG.GRENADE.EXPLOSION_RADIUS,
            alpha: 0,
            duration: 300,
            onComplete: () => explosion.destroy()
        });

        // Spawn multiple flash particles
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const dist = 30 + Math.random() * 40;
            this.particles.spawnMuzzleFlash(
                x + Math.cos(angle) * dist,
                y + Math.sin(angle) * dist,
                angle, 1.5
            );
        }

        // Damage enemies in radius and track kills for achievement
        let grenadeKillsThisExplosion = 0;
        const enemiesInRange = [];
        
        // First pass: collect enemies and their HP
        this.enemies.getChildren().forEach(enemy => {
            if (!enemy.active) return;
            const dist = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
            if (dist < CONFIG.GRENADE.EXPLOSION_RADIUS) {
                const damageMult = 1 - (dist / CONFIG.GRENADE.EXPLOSION_RADIUS) * 0.5;
                let damage = Math.ceil(CONFIG.GRENADE.DAMAGE * damageMult);
                // Apply permanent damage boost
                if (this.permanentDamageBoost > 1) {
                    damage = Math.ceil(damage * this.permanentDamageBoost);
                }
                enemiesInRange.push({ enemy, damage, willDie: enemy.hp <= damage });
            }
        });
        
        // Count kills before applying damage
        grenadeKillsThisExplosion = enemiesInRange.filter(e => e.willDie).length;
        
        // Second pass: apply damage
        enemiesInRange.forEach(({ enemy, damage }) => {
            if (enemy.takeDamage) enemy.takeDamage(damage, 'grenade', x, y);
            
            // Knockback (only if enemy still alive and has body)
            if (enemy.active && enemy.body) {
                const knockAngle = Phaser.Math.Angle.Between(x, y, enemy.x, enemy.y);
                this.physics.velocityFromRotation(knockAngle, 300, enemy.body.velocity);
            }
        });
        
        // Check grenadier achievement (3+ kills with one grenade)
        if (grenadeKillsThisExplosion >= 3) {
            const newAchievements = checkAchievements(this.persistent, { grenadeMultiKill: grenadeKillsThisExplosion });
            newAchievements.forEach(a => {
                sfx.achievement();
                this.showFloatingText(400, 200, `${a.icon} ${a.name}!`, 0xffd700);
            });
            savePersistent(this.persistent);
        }

        this.showFloatingText(x, y, "BOOM!", 0xff4500);
    }
    
    exploderExplosion(x, y) {
        const cfg = CONFIG.ENEMIES.EXPLODER;
        sfx.exploderExplode();
        if (this.gameSettings.screenShake) this.cameras.main.shake(150, 0.015);

        // Visual explosion - orange
        const explosion = this.add.circle(x, y, 10, 0xff6600, 1).setDepth(100);
        this.tweens.add({
            targets: explosion,
            radius: cfg.EXPLOSION_RADIUS,
            alpha: 0,
            duration: 250,
            onComplete: () => explosion.destroy()
        });

        // Spawn flash particles
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const dist = 20 + Math.random() * 30;
            this.particles.spawnMuzzleFlash(
                x + Math.cos(angle) * dist,
                y + Math.sin(angle) * dist,
                angle, 1.2
            );
        }

        // Damage player if in range
        const playerDist = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y);
        if (playerDist < cfg.EXPLOSION_RADIUS) {
            this.hitPlayer(cfg.DAMAGE, x, y, { damageSource: 'explosion' });
        }

        // Damage other enemies in range (chain reactions!)
        this.enemies.getChildren().forEach(enemy => {
            if (!enemy.active) return;
            const dist = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
            if (dist < cfg.EXPLOSION_RADIUS && dist > 0) { // dist > 0 prevents self-damage
                const damageMult = 1 - (dist / cfg.EXPLOSION_RADIUS) * 0.5;
                const damage = Math.ceil(cfg.ENEMY_DAMAGE * damageMult);
                if (enemy.takeDamage) enemy.takeDamage(damage, 'explosion', x, y);
                
                // Knockback
                if (enemy.active && enemy.body) {
                    const knockAngle = Phaser.Math.Angle.Between(x, y, enemy.x, enemy.y);
                    this.physics.velocityFromRotation(knockAngle, 200, enemy.body.velocity);
                }
            }
        });

        this.showFloatingText(x, y, "KABOOM!", 0xff6600);
    }
    
    spawnNecroProjectile(fromX, fromY, toX, toY) {
        const cfg = CONFIG.ENEMIES.NECROMANCER;
        // Create a slow-moving projectile
        const proj = this.acidProjectiles.get(fromX, fromY);
        if (proj) {
            proj.body.reset(fromX, fromY);
            proj.body.enable = true;
            proj.setActive(true);
            proj.setVisible(true);
            proj.hasHit = false;
            proj.setTint(0x8800ff); // Purple for necro
            proj.setScale(1.5);
            
            const angle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
            this.physics.velocityFromRotation(angle, cfg.PROJECTILE_SPEED, proj.body.velocity);
            proj.setRotation(angle);
        }
    }

    createInventoryUI() {
        this.invContent = [];
        this.invListeners = null;
        this.invDragging = null;
        if (this.invBodyView !== 'gear') this.invBodyView = 'gear';
        createRaidInvCtx(this);
    }

    renderInventoryPanel() {
        const ctx = this._invCtx || ensureInvCtx(this);
        renderSharedInventoryPanel(this, ctx);
    }

    /** Show "Are you sure?" dialog for deleting a dragged item. onConfirm: () => void to perform delete; rerender: () => void after close. */
    _showInvDeleteConfirm(dragCopy, onConfirm, rerender) {
        if (this._invDeleteConfirmEls && this._invDeleteConfirmEls.length) return;
        const DEPTH = 5000;
        const bg = this.add.rectangle(400, 300, 320, 140, 0x1a1a1a, 0.95).setStrokeStyle(3, 0x663333).setDepth(DEPTH);
        const msg = this.add.text(400, 268, 'Are you sure you want to delete this item?', { fontSize: '14px', fill: '#e0e0e0' }).setOrigin(0.5).setDepth(DEPTH + 1);
        const yesBtn = this.add.rectangle(340, 318, 70, 32, 0x228822).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
        const yesTxt = this.add.text(340, 318, 'Yes', { fontSize: '14px', fill: '#fff' }).setOrigin(0.5).setDepth(DEPTH + 2);
        const noBtn = this.add.rectangle(460, 318, 70, 32, 0x444444).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true });
        const noTxt = this.add.text(460, 318, 'No', { fontSize: '14px', fill: '#fff' }).setOrigin(0.5).setDepth(DEPTH + 2);
        this._invDeleteConfirmEls = [bg, msg, yesBtn, yesTxt, noBtn, noTxt];
        const close = () => {
            if (this._invDeleteConfirmEls) {
                this._invDeleteConfirmEls.forEach(e => e.destroy());
                this._invDeleteConfirmEls = null;
            }
            if (typeof rerender === 'function') rerender();
        };
        yesBtn.on('pointerdown', () => { sfx.click(); if (typeof onConfirm === 'function') onConfirm(); close(); });
        yesBtn.on('pointerover', () => yesBtn.setFillStyle(0x33aa33));
        yesBtn.on('pointerout', () => yesBtn.setFillStyle(0x228822));
        noBtn.on('pointerdown', () => { sfx.click(); close(); });
        noBtn.on('pointerover', () => noBtn.setFillStyle(0x555555));
        noBtn.on('pointerout', () => noBtn.setFillStyle(0x444444));
    }

    /** Recalculate weaponModEffects and hasFlashlight from weaponSlotMods (e.g. after equip/unequip in inventory). */
    recalcWeaponModEffectsFromSlots() {
        const weapons = ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'];
        weapons.forEach(weapon => {
            this.weaponModEffects[weapon] = {
                magSizeMultiplier: 1,
                damageMultiplier: 1,
                fireRateMultiplier: 1,
                spreadMultiplier: 1,
                isSilent: false,
                hasLaser: false
            };
        });
        let hasFlashlightFromSlot = false;
        ['primary', 'secondary', 'sidearm', 'melee'].forEach(slotId => {
            const weaponId = this.playerStats.weaponSlots && this.playerStats.weaponSlots[slotId];
            if (!weaponId) return;
            const modsObj = getModsForWeaponInSlot(this.playerStats, slotId);
            if (!modsObj) return;
            this.weaponModEffects[weaponId] = this.weaponModEffects[weaponId] || {
                magSizeMultiplier: 1,
                damageMultiplier: 1,
                fireRateMultiplier: 1,
                spreadMultiplier: 1,
                isSilent: false,
                hasLaser: false
            };
            Object.values(modsObj).forEach(modId => {
                if (!modId) return;
                const mod = Object.values(CONFIG.MODS).find(m => m.id === modId);
                if (!mod) return;
                if (modId === 'flashlight' || modId === 'laser_sight') hasFlashlightFromSlot = true; // flashlight = light only; laser_sight = combo
                const effect = mod.effect;
                switch (effect.type) {
                    case 'mag_size':
                        this.weaponModEffects[weaponId].magSizeMultiplier += effect.value;
                        break;
                    case 'suppressor':
                        this.weaponModEffects[weaponId].isSilent = true;
                        this.weaponModEffects[weaponId].damageMultiplier -= effect.damageReduction;
                        break;
                    case 'laser_sight':
                        this.weaponModEffects[weaponId].hasLaser = true;
                        break;
                    case 'damage_barrel':
                        this.weaponModEffects[weaponId].damageMultiplier += effect.damage;
                        this.weaponModEffects[weaponId].fireRateMultiplier += effect.fireRate;
                        break;
                    case 'rapid_fire':
                        this.weaponModEffects[weaponId].fireRateMultiplier += effect.fireRate;
                        this.weaponModEffects[weaponId].spreadMultiplier += effect.spread;
                        break;
                    case 'flashlight':
                        // basic flashlight: light only (no laser)
                        break;
                }
            });
        });
        this.playerStats.hasFlashlight = hasFlashlightFromSlot;
    }

    closeInventoryPanel() {
        this.recalcWeaponModEffectsFromSlots();
        this.invFocusedWeapon = null;
        this.invFocusedWeaponSource = null;
        if (this._invDeleteConfirmEls) {
            this._invDeleteConfirmEls.forEach(e => e.destroy());
            this._invDeleteConfirmEls = null;
        }
        if (this.invGhostRect) { this.invGhostRect.destroy(); this.invGhostRect = null; }
        if (this.invGhostText) { this.invGhostText.destroy(); this.invGhostText = null; }
        if (this.invListeners) {
            this.input.off('pointermove', this.invListeners.move);
            this.input.off('pointerdown', this.invListeners.down);
            this.input.off('pointerup', this.invListeners.up);
            if (this.invListeners.delKey) this.invListeners.delKey.off('down', this.invListeners.delKeyCallback);
            if (this.invListeners.rKey) this.invListeners.rKey.off('down', this.invListeners.rKeyCallback);
            this.invListeners = null;
        }
        if (this.invContent && this.invContent.length) {
            this.invContent.forEach(e => e.destroy());
            this.invContent = [];
        }
        this.invDragging = null;
    }

    showRigWindowInGame(source) {
        if (this.rigWindowOpenInGame) return;
        const stats = this._invStats != null ? this._invStats : (this.stats || this.playerStats);
        if (!stats) return;
        ensureRigStats(stats);
        if (!stats.backpack) stats.backpack = getDefaultBackpack();
        const backpack = stats.backpack;
        ensureGridItems(backpack);
        const isEquipped = source === 'equipped';
        let innerGrid;
        if (isEquipped) {
            if (!stats.rigGrid) stats.rigGrid = { gridW: 4, gridH: 2, items: [], _nextId: 1 };
            innerGrid = stats.rigGrid;
        } else {
            if (!stats.rigInventories) stats.rigInventories = {};
            innerGrid = getOrCreateRigInventory(stats.rigInventories, 'backpack_' + source.placementId);
        }
        ensureGridItems(innerGrid);
        const RIG_DEPTH = 350;
        const gridCols = 4, gridRows = 2;
        const cellSize = 18, gap = 1, colGap = 5;
        const cellW = cellSize + gap, cellH = cellSize + gap;
        const stepCol = cellW + colGap, stepRow = cellH;
        const gridW = 4 * stepCol - colGap, gridH = gridRows * stepRow;
        const elements = [];
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.6).setDepth(RIG_DEPTH).setInteractive();
        elements.push(overlay);
        const panelW = gridW + 40, panelH = gridH + 50;
        const panel = this.add.rectangle(400, 300, panelW, panelH, 0x2a2a2a).setStrokeStyle(3, 0x888888).setDepth(RIG_DEPTH + 1);
        elements.push(panel);
        const title = this.add.text(400, 300 - panelH/2 + 14, 'Rig', { fontSize: '16px', fill: '#ddd', fontStyle: 'bold' }).setOrigin(0.5).setDepth(RIG_DEPTH + 2);
        elements.push(title);
        const closeW = 24, closeH = 24;
        const closeX = 400 + panelW/2 - closeW/2 - 4, closeY = 300 - panelH/2 + 14;
        const closeBtn = this.add.rectangle(closeX, closeY, closeW, closeH, 0xaa2222).setDepth(RIG_DEPTH + 2).setInteractive();
        const closeTxt = this.add.text(closeX, closeY, 'X', { fontSize: '14px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(RIG_DEPTH + 3);
        elements.push(closeBtn, closeTxt);
        const gridX0 = 400 - gridW/2, gridY0 = 300 - gridH/2 + 20;
        const occupied = new Set();
        (innerGrid.items || []).forEach(p => {
            for (let r = 0; r < (p.sizeH || 1); r++)
                for (let c = 0; c < (p.sizeW || 1); c++) occupied.add(`${p.row + r},${p.col + c}`);
        });
        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                const x = gridX0 + col * stepCol, y = gridY0 + row * stepRow;
                const isOcc = occupied.has(`${row},${col}`);
                const r = this.add.rectangle(x + cellSize/2, y + cellSize/2, cellSize, cellSize, isOcc ? 0x445544 : 0x333333).setStrokeStyle(1, 0x555555).setDepth(RIG_DEPTH + 1);
                elements.push(r);
            }
        }
        const innerItemZones = [];
        (innerGrid.items || []).forEach(p => {
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const wPx = sw * cellW + (sw - 1) * colGap, hPx = sh * cellH;
            const cx = gridX0 + p.col * stepCol + wPx/2, cy = gridY0 + p.row * stepRow + hPx/2;
            innerItemZones.push({ left: cx - wPx/2, right: cx + wPx/2, top: cy - hPx/2, bottom: cy + hPx/2, placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: sw, sizeH: sh });
        });
        const labelFontSize = '10px';
        (innerGrid.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const wPx = sw * cellW + (sw - 1) * colGap, hPx = sh * cellH;
            const cx = gridX0 + p.col * stepCol + wPx/2, cy = gridY0 + p.row * stepRow + hPx/2;
            const txt = this.add.text(cx, cy, (p.count > 1 ? lbl + p.count : lbl), { fontSize: labelFontSize, fill: '#ccc' }).setOrigin(0.5).setDepth(RIG_DEPTH + 2);
            elements.push(txt);
        });
        const innerEmptyZones = [];
        for (let row = 0; row < gridRows; row++)
            for (let col = 0; col < gridCols; col++)
                if (!occupied.has(`${row},${col}`))
                    innerEmptyZones.push({
                        left: gridX0 + col * stepCol, right: gridX0 + col * stepCol + cellW,
                        top: gridY0 + row * stepRow, bottom: gridY0 + row * stepRow + cellH,
                        row, col
                    });
        const inZone = (px, py, z) => px >= z.left && px <= z.right && py >= z.top && py <= z.bottom;
        const getWorld = (ptr) => {
            if (ptr.worldX != null) return { x: ptr.worldX, y: ptr.worldY };
            const p = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
            return { x: p.x, y: p.y };
        };
        const backpackBounds = { left: 318, right: 432, top: 210, bottom: 381 };
        let innerSelected = null;
        let innerDragging = null;
        let innerGhostRect = null;
        let innerGhostText = null;
        let innerMoveHandler = null;
        let innerUpHandler = null;
        const destroyInnerGhost = () => {
            if (innerGhostRect) { innerGhostRect.destroy(); innerGhostRect = null; }
            if (innerGhostText) { innerGhostText.destroy(); innerGhostText = null; }
        };
        const closeWindow = () => {
            if (innerMoveHandler) { this.input.off('pointermove', innerMoveHandler); innerMoveHandler = null; }
            if (innerUpHandler) { this.input.off('pointerup', innerUpHandler); innerUpHandler = null; }
            destroyInnerGhost();
            elements.forEach(e => e.destroy());
            this.rigWindowOpenInGame = null;
            const statsToSave = this._invStats != null ? this._invStats : (this.stats || this.playerStats);
            if (statsToSave) localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(statsToSave));
            this.renderInventoryPanel();
        };
        closeBtn.on('pointerdown', () => { sfx.click(); closeWindow(); });
        overlay.on('pointerdown', (ptr) => {
            const w = getWorld(ptr);
            const px = w.x, py = w.y;
            if (px >= closeX - closeW/2 && px <= closeX + closeW/2 && py >= closeY - closeH/2 && py <= closeY + closeH/2) return;
            const overItem = innerItemZones.find(z => inZone(px, py, z));
            if (overItem) {
                sfx.click();
                innerSelected = { placementId: overItem.placementId };
                innerDragging = { placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count || 1, sizeW: overItem.sizeW || 1, sizeH: overItem.sizeH || 1 };
                const cfg = getInventoryItemConfig(overItem.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (overItem.itemId || '?').slice(0, 2).toUpperCase();
                const gw = (overItem.sizeW || 1) * cellW + ((overItem.sizeW || 1) - 1) * colGap, gh = (overItem.sizeH || 1) * cellH;
                innerGhostRect = this.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(RIG_DEPTH + 10);
                innerGhostText = this.add.text(px, py, (overItem.count > 1 ? lbl + overItem.count : lbl), { fontSize: labelFontSize, fill: '#ccc' }).setOrigin(0.5).setDepth(RIG_DEPTH + 11);
                elements.push(innerGhostRect, innerGhostText);
                innerMoveHandler = (p) => {
                    const ww = getWorld(p);
                    if (innerGhostRect) { innerGhostRect.setPosition(ww.x, ww.y); innerGhostText.setPosition(ww.x, ww.y); }
                };
                innerUpHandler = (p) => {
                    const ww = getWorld(p);
                    const ex = ww.x, ey = ww.y;
                    destroyInnerGhost();
                    if (innerMoveHandler) { this.input.off('pointermove', innerMoveHandler); innerMoveHandler = null; }
                    this.input.off('pointerup', innerUpHandler);
                    innerUpHandler = null;
                    const dragItem = innerDragging;
                    innerDragging = null;
                    const inBackpack = ex >= backpackBounds.left && ex <= backpackBounds.right && ey >= backpackBounds.top && ey <= backpackBounds.bottom;
                    if (innerSelected && inBackpack) {
                        const item = removeItem(innerGrid, innerSelected.placementId);
                        if (item && tryAddItem(backpack, item.itemId, item.count)) {
                            sfx.click();
                            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stats));
                            closeWindow();
                            return;
                        }
                        if (item) innerGrid.items.push(item);
                    }
                    innerSelected = null;
                    const emptyZone = innerEmptyZones.find(z => inZone(ex, ey, z));
                    if (emptyZone && innerSelected) {
                        const item = (innerGrid.items || []).find(it => it.placementId === innerSelected.placementId);
                        if (item && canPlace(innerGrid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, innerSelected.placementId)) {
                            if (moveItemInGrid(innerGrid, innerSelected.placementId, emptyZone.row, emptyZone.col)) {
                                sfx.click();
                                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stats));
                            }
                        }
                        innerSelected = null;
                    }
                    elements.forEach(e => e.destroy());
                    this.rigWindowOpenInGame = null;
                    this.showRigWindowInGame(source);
                };
                this.input.on('pointermove', innerMoveHandler);
                this.input.on('pointerup', innerUpHandler);
                return;
            }
            const emptyZone = innerEmptyZones.find(z => inZone(px, py, z));
            if (emptyZone && innerSelected && !innerDragging) {
                const item = (innerGrid.items || []).find(p => p.placementId === innerSelected.placementId);
                if (item && canPlace(innerGrid, emptyZone.row, emptyZone.col, item.sizeW || 1, item.sizeH || 1, innerSelected.placementId)) {
                    if (moveItemInGrid(innerGrid, innerSelected.placementId, emptyZone.row, emptyZone.col)) {
                        sfx.click();
                        innerSelected = null;
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(stats));
                        elements.forEach(e => e.destroy());
                        this.rigWindowOpenInGame = null;
                        this.showRigWindowInGame(source);
                        return;
                    }
                }
                innerSelected = null;
            }
        });
        this.rigWindowOpenInGame = source;
    }

    dropInventoryItem(drag) {
        const backpack = this.playerStats.backpack;
        const rigGrid = this.playerStats.armor && this.playerStats.armor.rig && this.playerStats.rigGrid;
        const secureContainerGrid = this.playerStats.secureContainerGrid;
        const sourceGrid = (drag.container === 'rig' || drag.fromRig) ? rigGrid : (drag.fromSecureContainer || drag.container === 'secureContainer') ? secureContainerGrid : (drag.fromMedBag || drag.container === 'medBag') ? medBagGrid : backpack;
        if (!sourceGrid || !sourceGrid.items) return;
        const removed = removeItem(sourceGrid, drag.placementId);
        if (!removed) return;
        const itemId = removed.itemId;
        const count = removed.count || 1;
        const type = { itemId, count };
        const dropDefDur = getDefaultDurability(itemId);
        if (dropDefDur && (removed.durability != null || removed.maxDurability != null)) {
            type.durability = removed.durability != null ? removed.durability : dropDefDur.durability;
            type.maxDurability = removed.maxDurability != null ? removed.maxDurability : dropDefDur.maxDurability;
        }
        if (itemId === 'ammo_box' && drag.container === 'backpack') {
            const invMap = this.playerStats.ammoBoxInventories || this.stats.ammoBoxInventories;
            if (invMap) {
                const key = 'backpack_' + drag.placementId;
                if (invMap[key]) {
                    type.innerGrid = JSON.parse(JSON.stringify(invMap[key]));
                    delete invMap[key];
                }
            }
        } else if (itemId === 'rig' && drag.container === 'backpack') {
            const rigInvMap = this.playerStats.rigInventories || this.stats.rigInventories;
            if (rigInvMap) {
                const key = 'backpack_' + drag.placementId;
                if (rigInvMap[key]) {
                    type.innerGrid = JSON.parse(JSON.stringify(rigInvMap[key]));
                    delete rigInvMap[key];
                }
            }
        }
        if (!this.textures.exists('pickup_item')) {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0x4488ff, 1);
            g.fillRect(0, 0, 20, 20);
            g.generateTexture('pickup_item', 20, 20);
        }
        const px = this.player ? this.player.x : 400;
        const py = this.player ? this.player.y : 300;
        const spr = this.add.image(px, py - 20, 'pickup_item').setDepth(5);
        this.pickups.add(spr);
        spr.setData('type', type);
        sfx.loot();
        this.renderInventoryPanel();
    }

    toggleInventory() {
        this.isInventoryOpen = !this.isInventoryOpen;
        if (this.isInventoryOpen) {
            sfx.menuOpen();
            this.physics.pause();
            this.isPaused = true;
            this.cameras.main.setScroll(0, 0);
            createRaidInvCtx(this);
            this.renderInventoryPanel();
        } else {
            this.closeInventoryPanel();
            sfx.menuClose();
            this.physics.resume();
            this.isPaused = false;
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            sfx.menuOpen();
            this.physics.pause();
            this.pauseText.setVisible(true);
        } else {
            sfx.menuClose();
            this.physics.resume();
            this.pauseText.setVisible(false);
        }
    }

    // =============================================================================
    // ROGUELIKE ROOM SYSTEM
    // =============================================================================
    
    generateRoomGrid(level) {
        const gridConfig = CONFIG.LEVEL_GRIDS[level];
        if (!gridConfig) {
            console.warn(`No grid config for level ${level}, using fallback`);
            return null;
        }
        
        const { cols, rows, theme } = gridConfig;
        const chunks = CONFIG.ROOM_CHUNKS[theme];
        if (!chunks || chunks.length === 0) {
            console.warn(`No room chunks for theme ${theme}, using fallback`);
            return null;
        }
        
        // Create grid structure
        const grid = {
            cols,
            rows,
            theme,
            rooms: [],
            startRoom: 0,
            exitRoom: (cols * rows) - 1,
            currentRoom: 0
        };
        
        // Generate rooms
        const totalRooms = cols * rows;
        for (let i = 0; i < totalRooms; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            
            // Pick a random chunk for this room
            let selectedChunk;
            
            // Boss levels use specific boss room for exit
            const isBossLevel = (level === 5 || level === 7);
            
            if (i === grid.exitRoom && isBossLevel) {
                // Exit room on boss level = boss room
                selectedChunk = chunks.find(c => c.isBossRoom) || chunks[Math.floor(Math.random() * chunks.length)];
            } else {
                // Filter chunks by door compatibility for non-edge rooms
                // Also exclude boss rooms from non-exit rooms on boss levels
                const validChunks = chunks.filter(chunk => {
                    // Exclude boss rooms from non-exit rooms on boss levels
                    if (isBossLevel && chunk.isBossRoom) return false;
                    // Check if chunk can connect to adjacent rooms
                    if (col > 0 && !chunk.doorPositions.west) return false;
                    if (col < cols - 1 && !chunk.doorPositions.east) return false;
                    if (row > 0 && !chunk.doorPositions.north) return false;
                    if (row < rows - 1 && !chunk.doorPositions.south) return false;
                    return true;
                });
                
                // Fallback: non-boss chunks only for boss levels
                const fallbackChunks = isBossLevel 
                    ? chunks.filter(c => !c.isBossRoom) 
                    : chunks;
                
                selectedChunk = validChunks.length > 0 
                    ? validChunks[Math.floor(Math.random() * validChunks.length)]
                    : fallbackChunks[Math.floor(Math.random() * fallbackChunks.length)];
            }
            
            // Determine connections to adjacent rooms
            const connections = {
                north: row > 0 ? i - cols : null,
                south: row < rows - 1 ? i + cols : null,
                east: col < cols - 1 ? i + 1 : null,
                west: col > 0 ? i - 1 : null
            };
            
            grid.rooms.push({
                index: i,
                row,
                col,
                chunk: JSON.parse(JSON.stringify(selectedChunk)), // Deep copy
                connections,
                cleared: false,
                visited: false,
                hasRiskRoom: false, // Will be assigned below (only 1 per level)
                riskRoomCleared: false,
                isStart: i === grid.startRoom,
                isExit: i === grid.exitRoom
            });
        }
        
        // Assign exactly ONE risk room per level (25% chance to have one at all)
        if (Math.random() < CONFIG.RISK_ROOM.SPAWN_CHANCE) {
            // Find eligible rooms (not start, not exit, not boss)
            const eligibleRooms = grid.rooms.filter(room => 
                !room.isStart && 
                !room.isExit && 
                !room.chunk.isBossRoom
            );
            
            if (eligibleRooms.length > 0) {
                // Pick one random eligible room
                const riskRoom = eligibleRooms[Math.floor(Math.random() * eligibleRooms.length)];
                riskRoom.hasRiskRoom = true;
            }
        }
        
        // Mark start room as visited
        grid.rooms[grid.startRoom].visited = true;
        
        return grid;
    }
    
    setupRoom(roomData) {
        // Clear existing room elements (walls, floor)
        if (this.roomFloor) this.roomFloor.destroy();
        if (this.roomOverlay) this.roomOverlay.destroy();
        if (this.roomWalls) {
            this.roomWalls.forEach(w => w.destroy());
        }
        this.roomWalls = [];
        if (this.roomDoors) {
            this.roomDoors.forEach(d => d.destroy());
        }
        this.roomDoors = [];
        if (this.riskDoor) {
            this.riskDoor.destroy();
            this.riskDoor = null;
        }
        if (this.riskDoorIcon) {
            this.riskDoorIcon.destroy();
            this.riskDoorIcon = null;
        }
        if (this.exitLabel) {
            this.exitLabel.destroy();
            this.exitLabel = null;
        }
        if (this.door) {
            this.door.destroy();
            this.door = null;
        }
        
        const chunk = roomData.chunk;
        
        // Create floor
        this.roomFloor = this.add.tileSprite(400, 300, 800, 600, chunk.floor).setDepth(0);
        
        // Create floor overlay if specified (for dark levels like cemetery)
        if (chunk.floorOverlay) {
            this.roomOverlay = this.add.rectangle(400, 300, 800, 600, chunk.floorOverlay.color, chunk.floorOverlay.alpha).setDepth(0);
        }
        
        // Create church visual if specified
        if (chunk.churchVisual) {
            this.add.rectangle(400, 100, 400, 150, 0x222222, 0.5).setDepth(1);
            this.add.text(400, 50, "CHURCH", { fontSize: '18px', fill: '#555' }).setOrigin(0.5).setDepth(2);
        }
        
        // Create walls from chunk template
        chunk.walls.forEach(wallDef => {
            const wall = this.walls.create(wallDef.x, wallDef.y, 'wall');
            wall.setScale(wallDef.scaleX || 1, wallDef.scaleY || 1).refreshBody();
            if (wallDef.tint) wall.setTint(wallDef.tint);
            this.roomWalls.push(wall);
        });
        
        // Create doors to adjacent rooms
        const doorPositions = {
            north: { x: 400, y: 30, angle: 0 },
            south: { x: 400, y: 570, angle: 0 },
            east: { x: 770, y: 300, angle: 90 },
            west: { x: 30, y: 300, angle: 90 }
        };
        
        Object.entries(roomData.connections).forEach(([direction, targetRoom]) => {
            if (targetRoom !== null) {
                const pos = doorPositions[direction];
                const door = this.physics.add.staticSprite(pos.x, pos.y, 'door');
                door.setAngle(pos.angle);
                door.setTint(0x888888); // Gray for room transition doors
                door.doorDirection = direction;
                door.targetRoom = targetRoom;
                door.isRoomDoor = true;
                this.roomDoors.push(door);
            }
        });
        
        // Exit room has the level exit door
        if (roomData.isExit) {
            // For boss levels, door appears after boss defeat
            if (this.currentLevel === 5 || this.currentLevel === 7) {
                // Don't create exit door yet - it spawns after boss
                this.door = this.physics.add.staticSprite(-100, -100, 'door');
            } else {
                // Find a wall side that doesn't have a room door
                // Room doors are placed based on connections, so find a null connection
                const exitPositions = {
                    north: { x: 400, y: 80, labelY: 40, angle: 0 },
                    south: { x: 400, y: 520, labelY: 560, angle: 0 },
                    east: { x: 720, y: 300, labelX: 720, labelY: 250, angle: 90 },
                    west: { x: 80, y: 300, labelX: 80, labelY: 250, angle: 90 }
                };
                
                // Priority order: north, east, west, south (prefer top/sides over bottom)
                const priorities = ['north', 'east', 'west', 'south'];
                let exitDir = null;
                for (const dir of priorities) {
                    if (roomData.connections[dir] === null) {
                        exitDir = dir;
                        break;
                    }
                }
                
                // Fallback to center if somehow all sides have connections
                if (!exitDir) {
                    exitDir = 'north';
                }
                
                const exitPos = exitPositions[exitDir];
                this.door = this.physics.add.staticSprite(exitPos.x, exitPos.y, 'door');
                this.door.setTint(0xFFD700); // Gold for level exit
                this.door.setScale(1.5); // Larger to stand out
                this.door.setDepth(15);
                if (exitPos.angle) this.door.setAngle(exitPos.angle);
                
                // Add EXIT label near door
                const labelX = exitPos.labelX || exitPos.x;
                const labelY = exitPos.labelY || exitPos.y - 45;
                this.exitLabel = this.add.text(labelX, labelY, '🚪 EXIT', { 
                    fontSize: '20px', 
                    fill: '#FFD700',
                    stroke: '#000',
                    strokeThickness: 3
                }).setOrigin(0.5).setDepth(100);
            }
        } else {
            // Create invisible door placeholder
            this.door = this.physics.add.staticSprite(-100, -100, 'door');
        }
        
        // Create risk room door if this room has one
        if (roomData.hasRiskRoom && !roomData.riskRoomCleared) {
            // Find a wall position to place the risk door
            const riskDoorX = 750;
            const riskDoorY = 500;
            this.riskDoor = this.physics.add.staticSprite(riskDoorX, riskDoorY, 'door');
            this.riskDoor.setTint(0xff0000); // Red tint for danger
            this.riskDoor.setScale(0.8);
            this.riskDoor.isRiskDoor = true;
            
            // Add danger indicator
            this.riskDoorIcon = this.add.text(riskDoorX, riskDoorY - 40, '⚠️', { fontSize: '24px' }).setOrigin(0.5).setDepth(100);
            
            // Pulsing animation
            this.tweens.add({
                targets: this.riskDoor,
                alpha: { from: 1, to: 0.5 },
                duration: 500,
                yoyo: true,
                repeat: -1
            });
        }
        
        // Update minimap
        this.updateMinimap();
    }

    /** Create a crate with consistent depth/visibility so it always renders above floor. */
    createCrateAt(x, y, lootID) {
        const crate = this.crates.create(x, y, 'crate').setScale(1).refreshBody().setData('lootID', lootID);
        crate.setDepth(10).setVisible(true);
        return crate;
    }

    /** Restore unlooted crates from room's saved state (e.g. after re-entering or exiting risk room). */
    restoreCratesFromState(room) {
        if (!room || !room.crateState || room.crateState.length === 0) return;
        // Only restore when group is empty so we never stack crates (e.g. after transition cleared them)
        if (this.crates.countActive() > 0) return;
        room.crateState.forEach(s => {
            this.createCrateAt(s.x, s.y, s.lootID);
        });
        // Clear so we don't re-apply the same state; it will be repopulated when we leave the room
        room.crateState = [];
    }

    /** Create a lootable body (skull) at position with given lootID. */
    createSkullAt(x, y, lootID) {
        const s = this.skulls.create(x, y, 'skull').setScale(0.8);
        s.setData('lootID', lootID);
        return s;
    }

    /** Restore unlooted bodies from room's saved state (e.g. after re-entering or exiting risk room). */
    restoreSkullsFromState(room) {
        if (!room || !room.skullState || room.skullState.length === 0) return;
        if (this.skulls.countActive() > 0) return;
        room.skullState.forEach(s => {
            this.createSkullAt(s.x, s.y, s.lootID);
        });
        room.skullState = [];
    }

    /** Restore dropped inventory items from room's saved state (persist until player leaves the level). */
    restoreDroppedItemsFromState(room) {
        if (!room || !room.droppedItemsState || room.droppedItemsState.length === 0) return;
        if (!this.textures.exists('pickup_dropped')) {
            const g = this.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0x8B4513, 1);
            g.fillCircle(8, 8, 8);
            g.generateTexture('pickup_dropped', 16, 16);
        }
        room.droppedItemsState.forEach(d => {
            const spr = this.add.image(d.x, d.y, 'pickup_dropped').setDepth(5);
            this.droppedInventoryItems.add(spr);
            spr.setData('type', d.type);
        });
        room.droppedItemsState = [];
    }

    /** Restore enemies from room's saved state (re-entering room: same count, positions, HP). */
    restoreEnemiesFromState(room) {
        if (!room || !room.enemyState || room.enemyState.length === 0) return;
        room.enemyState.forEach(s => {
            const e = this.spawnEnemy(s.type, s.x, s.y);
            if (e && s.hp != null) {
                e.hp = Math.max(0, s.hp);
                if (s.maxHp != null) e.maxHp = s.maxHp;
            }
        });
    }

    /** Wander radius (px) and step (px per tick) for enemies in rooms we're not in. */
    static ROOM_WANDER_RADIUS = 80;
    static ROOM_WANDER_STEP = 14;

    /** Tick enemy positions in other rooms so the world feels like it carried on. */
    tickOtherRoomsEnemyWander() {
        if (!this.roomGrid || this.isTransitioningRoom || this.inRiskRoom) return;
        const currentIdx = this.roomGrid.currentRoom;
        const R = GameScene.ROOM_WANDER_RADIUS;
        const step = GameScene.ROOM_WANDER_STEP;
        this.roomGrid.rooms.forEach((room, idx) => {
            if (idx === currentIdx || !room.enemyState || room.enemyState.length === 0) return;
            room.enemyState.forEach(s => {
                const ox = s.originX;
                const oy = s.originY;
                s.x = s.x + Phaser.Math.Between(-step, step);
                s.y = s.y + Phaser.Math.Between(-step, step);
                const dx = s.x - ox, dy = s.y - oy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > R && dist > 0) {
                    s.x = ox + (dx / dist) * R;
                    s.y = oy + (dy / dist) * R;
                }
            });
        });
    }

    spawnRoomEntities(roomData, isRiskRoom = false, skipCrates = false) {
        const chunk = roomData.chunk;
        const level = this.currentLevel;
        
        // Determine enemy types based on level (walker always included so they spawn with leapers etc.)
        const levelEnemyTypes = {
            1: ['walker', 'walker', 'leaper', 'bandit', 'leaper'],
            2: ['walker', 'walker', 'bandit', 'leaper', 'leaper'],
            3: ['walker', 'walker', 'leaper', 'spitter', 'bandit'],
            4: ['walker', 'walker', 'spitter', 'leaper', 'leaper'],
            5: ['walker', 'spitter', 'leaper', 'boss'],
            6: ['walker', 'walker', 'exploder', 'leaper', 'bandit', 'spitter'],
            7: ['walker', 'leaper', 'necromancer']
        };
        const ZOMBIE_TYPES = ['walker', 'leaper', 'spitter', 'exploder'];
        
        // Determine loot pool from CONFIG (single source of truth)
        const levelLootPools = CONFIG.LOOT.LEVEL_POOLS || {};
        let enemyTypes = levelEnemyTypes[level] || ['leaper'];
        if (CONFIG.WALKER_AI_TEST_MODE) enemyTypes = ['walker', 'leaper', 'bandit'];
        let lootPool = [...(levelLootPools[level] || ['ammo', 'scrap'])];
        
        // Risk room modifications
        let enemyMultiplier = 1;
        let lootMultiplier = 1;
        if (isRiskRoom) {
            enemyMultiplier = CONFIG.RISK_ROOM.ENEMY_MULTIPLIER;
            lootMultiplier = CONFIG.RISK_ROOM.LOOT_MULTIPLIER;
            // Add guaranteed mod drop (rarity-weighted)
            lootPool.push(pickModByRarity());
            // Add one bonus item from risk-only pool
            const bonusPool = CONFIG.RISK_ROOM.BONUS_LOOT;
            if (bonusPool && bonusPool.length > 0) {
                lootPool.push(bonusPool[Math.floor(Math.random() * bonusPool.length)]);
            }
            // Upgrade enemy types
            enemyTypes = enemyTypes.map(type => CONFIG.RISK_ROOM.ENEMY_UPGRADES[type] || type);
            if (CONFIG.WALKER_AI_TEST_MODE) enemyTypes = ['walker', 'leaper', 'bandit'];
        }
        
        // Spawn enemies at spawn points (predefined count per level)
        const minDist = CONFIG.SPAWN_MIN_DISTANCE != null ? CONFIG.SPAWN_MIN_DISTANCE : 80;
        const spawnPoints = [...chunk.spawnPoints];
        const baseEnemyCount = CONFIG.ENEMIES_PER_LEVEL[level] != null ? CONFIG.ENEMIES_PER_LEVEL[level] : 10;
        while (spawnPoints.length < baseEnemyCount) {
            const src = spawnPoints[spawnPoints.length % chunk.spawnPoints.length];
            for (let attempt = 0; attempt < 30; attempt++) {
                const offset = 50 + Math.min(attempt * 8, 80);
                const nx = Phaser.Math.Clamp(src.x + Phaser.Math.Between(-offset, offset), 80, 720);
                const ny = Phaser.Math.Clamp(src.y + Phaser.Math.Between(-offset, offset), 80, 520);
                const tooClose = spawnPoints.some(p => Phaser.Math.Distance.Between(nx, ny, p.x, p.y) < minDist);
                if (!tooClose) { spawnPoints.push({ x: nx, y: ny }); break; }
                if (attempt === 29) spawnPoints.push({ x: nx, y: ny });
            }
        }
        
        let enemyCount = Math.floor(Math.min(baseEnemyCount, spawnPoints.length) * enemyMultiplier);
        
        // Boss rooms have special spawning
        if (chunk.isBossRoom) {
            if (level === 5) {
                this.spawnEnemy('boss', 400, 150);
                this.bossBar.setVisible(true);
                this.bossText.setVisible(true);
                this.bossText.setText("PATIENT ZERO");
                this.updateBossBar(CONFIG.ENEMIES.BOSS.HP, CONFIG.ENEMIES.BOSS.HP);
                this.time.delayedCall(500, () => sfx.bossRoar());
                // Support enemies
                enemyCount = 2;
                enemyTypes = ['spitter', 'leaper'];
            } else if (level === 7) {
                this.spawnEnemy('necromancer', 400, 80);
                this.bossBar.setVisible(true);
                this.bossText.setVisible(true);
                this.bossText.setText("THE NECROMANCER");
                this.updateBossBar(CONFIG.ENEMIES.NECROMANCER.HP, CONFIG.ENEMIES.NECROMANCER.HP);
                this.time.delayedCall(500, () => sfx.necroSummon());
                
                // Initialize stealth for cemetery
                this.isStealthLevel = true;
                this.detectionMeter = 0;
                this.maxDetection = 100;
                this.detectionRate = 20;
                this.detectionDecay = 10;
                this.stealthAlerted = false;
                this.detectionBar = this.add.graphics().setDepth(150);
                this.detectionText = this.add.text(400, 40, "STEALTH", { fontSize: '16px', fill: '#fff' }).setOrigin(0.5).setDepth(150);
                
                // Patrol enemies
                this.patrolEnemies = [];
                enemyCount = 0; // No random spawns, use patrols
            }
        }
        
        // Build spawn list: configurable % zombies / bandits (WALKERS_ONLY_SPAWN = only walker type)
        let zombiePool = (levelEnemyTypes[level] || ['leaper']).filter(t => ZOMBIE_TYPES.includes(t));
        if (CONFIG.WALKERS_ONLY_SPAWN) zombiePool = ['leaper'];
        if (zombiePool.length > 0 && !zombiePool.includes('walker')) zombiePool.push('walker');
        const hasBandit = (levelEnemyTypes[level] || []).includes('bandit');
        const banditPct = (CONFIG.BANDIT_PCT != null ? CONFIG.BANDIT_PCT : 30) / 100;
        const banditsOnly = banditPct >= 1;
        const banditCount = banditsOnly ? enemyCount : (hasBandit ? Math.round(enemyCount * banditPct) : 0);
        const zombieCount = enemyCount - banditCount;
        const spawnList = [];
        for (let i = 0; i < zombieCount && zombiePool.length > 0; i++) {
            spawnList.push(zombiePool[Math.floor(Math.random() * zombiePool.length)]);
        }
        for (let i = 0; i < banditCount; i++) spawnList.push('bandit');
        Phaser.Utils.Array.Shuffle(spawnList);
        
        const usedIndices = [];
        for (let i = 0; i < spawnList.length; i++) {
            const enemyType = spawnList[i];
            if (enemyType === 'boss' || enemyType === 'necromancer') continue;
            let bestIdx = -1;
            if (usedIndices.length === 0) {
                bestIdx = Math.floor(Math.random() * spawnPoints.length);
            } else {
                let bestMinDist = -1;
                for (let j = 0; j < spawnPoints.length; j++) {
                    if (usedIndices.includes(j)) continue;
                    const p = spawnPoints[j];
                    let minD = Infinity;
                    for (const k of usedIndices) {
                        const d = Phaser.Math.Distance.Between(p.x, p.y, spawnPoints[k].x, spawnPoints[k].y);
                        if (d < minD) minD = d;
                    }
                    if (minD > bestMinDist) { bestMinDist = minD; bestIdx = j; }
                }
                if (bestIdx < 0) bestIdx = usedIndices[usedIndices.length - 1];
            }
            if (bestIdx >= 0) {
                usedIndices.push(bestIdx);
                const pos = spawnPoints[bestIdx];
                this.spawnEnemy(enemyType, pos.x, pos.y);
            }
        }
        
        // Spawn loot crates - filter out positions near doors (skip if restoring from saved state)
        if (!skipCrates) {
        const doorZones = [
            { x: 400, y: 30 },   // North door
            { x: 400, y: 570 },  // South door
            { x: 770, y: 300 },  // East door
            { x: 30, y: 300 },   // West door
            { x: 400, y: 100 },  // Exit door position
            { x: 750, y: 500 }   // Risk door position
        ];
        const doorClearance = 50; // Minimum distance from doors
        
        let crateSlots = chunk.crateSlots.filter(slot => {
            return !doorZones.some(door => 
                Math.abs(slot.x - door.x) < doorClearance && 
                Math.abs(slot.y - door.y) < doorClearance
            );
        });
        
        // Fallback: if all/most slots filtered out, use original slots sorted by distance (essential items must spawn)
        if (crateSlots.length < 2 && chunk.crateSlots.length > 0) {
            // Sort by distance from nearest door (furthest first) - don't shuffle these
            crateSlots = [...chunk.crateSlots].sort((a, b) => {
                const distA = Math.min(...doorZones.map(d => 
                    Math.sqrt(Math.pow(a.x - d.x, 2) + Math.pow(a.y - d.y, 2))));
                const distB = Math.min(...doorZones.map(d => 
                    Math.sqrt(Math.pow(b.x - d.x, 2) + Math.pow(b.y - d.y, 2))));
                return distB - distA; // Furthest first
            });
        } else {
            Phaser.Utils.Array.Shuffle(crateSlots);
        }
        
        // Essential items tracking (from CONFIG)
        const levelsNeedingKey = CONFIG.LOOT.LEVELS_NEEDING_KEY || [1, 3, 4, 6];
        const needsKey = levelsNeedingKey.includes(level);
        
        // Track spawning at grid level
        if (this.keySpawned === undefined) this.keySpawned = false;
        if (this.mapSpawned === undefined) this.mapSpawned = false;
        
        // Determine what essential items to spawn in this room
        let essentialItems = [];
        
        // Map spawns in START room (so player gets it early)
        if (!this.mapSpawned && roomData.isStart && lootPool.includes('map')) {
            essentialItems.push('map');
            this.mapSpawned = true;
        }
        
        // Key spawns in START room on key levels so it's always findable (no risk of it being in an unvisited room)
        if (needsKey && !this.keySpawned && roomData.isStart && lootPool.includes('key')) {
            essentialItems.push('key');
            this.keySpawned = true;
        }
        
        // Build the final loot list for this room
        let roomLoot = [...essentialItems]; // Essential items first
        
        // Add other items (excluding already-spawned essentials)
        let filteredPool = lootPool.filter(item => {
            if (item === 'map' && this.mapSpawned) return false;
            if (item === 'key' && this.keySpawned) return false;
            return true;
        });
        Phaser.Utils.Array.Shuffle(filteredPool);
        roomLoot = roomLoot.concat(filteredPool);
        
        // Calculate crate count - ensure essential items ALWAYS spawn
        let crateCount = Math.floor(Math.min(crateSlots.length, roomLoot.length) * lootMultiplier);
        crateCount = Math.min(crateCount, crateSlots.length); // Can't exceed slots
        crateCount = Math.max(crateCount, Math.min(essentialItems.length, crateSlots.length)); // Must spawn essentials
        
        for (let i = 0; i < crateCount; i++) {
            const pos = crateSlots[i];
            const lootID = roomLoot[i % roomLoot.length];
            this.createCrateAt(pos.x, pos.y, lootID);
        }
        
        // Emergency fallback: if essential items couldn't spawn due to no crate slots, spawn them directly
        if (crateSlots.length === 0 && essentialItems.length > 0) {
            const fallbackPositions = [
                { x: 200, y: 300 }, { x: 600, y: 300 }, { x: 400, y: 400 }
            ];
            for (let i = 0; i < Math.min(essentialItems.length, fallbackPositions.length); i++) {
                const pos = fallbackPositions[i];
                this.createCrateAt(pos.x, pos.y, essentialItems[i]);
            }
        }
        }
    }
    
    transitionToRoom(targetRoomIndex) {
        if (targetRoomIndex === null || targetRoomIndex === undefined) return;
        if (!this.roomGrid || !this.roomGrid.rooms[targetRoomIndex]) return;
        if (this.isTransitioningRoom) return; // Prevent re-entry during transition
        
        this.isTransitioningRoom = true;
        
        const currentRoom = this.roomGrid.rooms[this.roomGrid.currentRoom];
        const targetRoom = this.roomGrid.rooms[targetRoomIndex];
        
        // Mark current room as cleared if all room-spawned enemies are dead (ignore edge-spawned so they don't force "clear twice")
        const roomEnemyCount = this.enemies.getChildren().filter(e => e.active && !e.edgeSpawned).length;
        if (roomEnemyCount === 0) {
            currentRoom.cleared = true;
        }
        
        // Save current room state (including unlooted crates and bodies so they persist when re-entering)
        currentRoom.enemiesRemaining = this.enemies.countActive();
        const crateList = this.crates.getChildren()
            .filter(c => c.active && c.visible)
            .map(c => ({ x: c.x, y: c.y, lootID: c.getData('lootID') }));
        const seen = new Set();
        currentRoom.crateState = crateList.filter(s => {
            const key = `${s.x}|${s.y}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const skullList = this.skulls.getChildren()
            .filter(s => s.active && s.visible)
            .map(s => ({ x: s.x, y: s.y, lootID: s.getData('lootID') }));
        const seenSkull = new Set();
        currentRoom.skullState = skullList.filter(s => {
            const key = `${s.x}|${s.y}`;
            if (seenSkull.has(key)) return false;
            seenSkull.add(key);
            return true;
        });
        const droppedList = this.droppedInventoryItems.getChildren()
            .filter(d => d.active && d.visible)
            .map(d => ({ x: d.x, y: d.y, type: d.getData('type') }));
        currentRoom.droppedItemsState = droppedList;
        // Save room enemy state so re-entering keeps same enemies/positions/HP (origin = wander center when away)
        currentRoom.enemyState = this.enemies.getChildren()
            .filter(e => e.active && !e.edgeSpawned)
            .map(e => ({ type: e.enemyType, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, originX: e.x, originY: e.y }));
        
        // Play transition sound
        sfx.doorOpen();
        
        // Fade transition
        this.cameras.main.fadeOut(200, 0, 0, 0);
        
        this.time.delayedCall(200, () => {
            // Clear current room
            this.enemies.clear(true, true);
            this.bullets.clear(true, true);
            this.crates.getChildren().forEach(c => c.destroy());
            this.skulls.clear(true, true);
            this.droppedInventoryItems.clear(true, true);
            
            // Update current room index
            this.roomGrid.currentRoom = targetRoomIndex;
            targetRoom.visited = true;
            
            // Setup new room
            this.setupRoom(targetRoom);
            
            // Restore crates, bodies, and dropped items from saved state if we have it (re-entering room)
            const hasSavedCrates = targetRoom.crateState && targetRoom.crateState.length > 0;
            if (hasSavedCrates) this.restoreCratesFromState(targetRoom);
            if (targetRoom.skullState && targetRoom.skullState.length > 0) this.restoreSkullsFromState(targetRoom);
            if (targetRoom.droppedItemsState && targetRoom.droppedItemsState.length > 0) this.restoreDroppedItemsFromState(targetRoom);
            const hasSavedEnemies = targetRoom.enemyState && targetRoom.enemyState.length > 0;
            if (hasSavedEnemies) {
                this.restoreEnemiesFromState(targetRoom);
            } else if (!targetRoom.cleared) {
                this.spawnRoomEntities(targetRoom, false, hasSavedCrates);
            }
            
            // Position player near the door they entered from
            // entryPositions: where to spawn based on which side the entry door is on
            const entryPositions = {
                north: { x: 400, y: 80 },   // Door on north, spawn near north
                south: { x: 400, y: 520 },  // Door on south, spawn near south
                east: { x: 720, y: 300 },   // Door on east, spawn near east
                west: { x: 80, y: 300 }     // Door on west, spawn near west
            };
            
            // Determine which direction we entered from (which side has the door back)
            // If currentRoom went EAST to reach targetRoom, then targetRoom's WEST door leads back
            let entryDoorSide = null;
            Object.entries(currentRoom.connections).forEach(([dir, roomIdx]) => {
                if (roomIdx === targetRoomIndex) {
                    // We exited currentRoom going this direction
                    // So we entered targetRoom from the opposite side
                    const opposites = { north: 'south', south: 'north', east: 'west', west: 'east' };
                    entryDoorSide = opposites[dir];
                }
            });
            
            if (entryDoorSide && entryPositions[entryDoorSide]) {
                this.player.setPosition(entryPositions[entryDoorSide].x, entryPositions[entryDoorSide].y);
            } else {
                this.player.setPosition(400, 500);
            }
            
            // Fade back in and reset transition flag
            this.cameras.main.fadeIn(200, 0, 0, 0);
            this.isTransitioningRoom = false;
        });
    }
    
    enterRiskRoom() {
        if (!this.roomGrid) return;
        if (this.isTransitioningRoom) return; // Prevent re-entry during transition
        
        const currentRoom = this.roomGrid.rooms[this.roomGrid.currentRoom];
        if (!currentRoom.hasRiskRoom || currentRoom.riskRoomCleared) return;
        
        this.isTransitioningRoom = true;
        sfx.doorOpen();
        this.showFloatingText(400, 300, "ENTERING RISK ROOM!", 0xff0000);
        
        // Fade transition
        this.cameras.main.fadeOut(200, 0, 0, 0);
        
        this.time.delayedCall(200, () => {
            // Save main room crate and body state so we can restore when exiting risk room
            const crateList = this.crates.getChildren()
                .filter(c => c.active && c.visible)
                .map(c => ({ x: c.x, y: c.y, lootID: c.getData('lootID') }));
            const seen = new Set();
            currentRoom.crateState = crateList.filter(s => {
                const key = `${s.x}|${s.y}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const skullList = this.skulls.getChildren()
                .filter(s => s.active && s.visible)
                .map(s => ({ x: s.x, y: s.y, lootID: s.getData('lootID') }));
            const seenSkull = new Set();
            currentRoom.skullState = skullList.filter(s => {
                const key = `${s.x}|${s.y}`;
                if (seenSkull.has(key)) return false;
                seenSkull.add(key);
                return true;
            });
            currentRoom.droppedItemsState = this.droppedInventoryItems.getChildren()
                .filter(d => d.active && d.visible)
                .map(d => ({ x: d.x, y: d.y, type: d.getData('type') }));
            currentRoom.enemyState = this.enemies.getChildren()
                .filter(e => e.active && !e.edgeSpawned)
                .map(e => ({ type: e.enemyType, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, originX: e.x, originY: e.y }));
            // Clear current room elements completely
            this.enemies.clear(true, true);
            this.bullets.clear(true, true);
            this.crates.getChildren().forEach(c => c.destroy());
            this.skulls.clear(true, true);
            this.droppedInventoryItems.clear(true, true);
            
            // Clear room-specific elements (but DON'T call setupRoom)
            if (this.roomFloor) this.roomFloor.destroy();
            if (this.roomOverlay) this.roomOverlay.destroy();
            if (this.roomWalls) this.roomWalls.forEach(w => w.destroy());
            this.roomWalls = [];
            if (this.roomDoors) this.roomDoors.forEach(d => d.destroy());
            this.roomDoors = []; // NO ROOM DOORS in risk room
            if (this.riskDoor) { this.riskDoor.destroy(); this.riskDoor = null; }
            if (this.riskDoorIcon) { this.riskDoorIcon.destroy(); this.riskDoorIcon = null; }
            if (this.exitLabel) { this.exitLabel.destroy(); this.exitLabel = null; }
            if (this.door) { this.door.destroy(); this.door = null; }
            
            // Hide minimap in risk room
            if (this.minimapGraphics) this.minimapGraphics.clear();
            
            // Create isolated risk room - simple arena with walls around edges
            this.roomFloor = this.add.tileSprite(400, 300, 800, 600, 'floor_sewer').setDepth(0);
            this.roomOverlay = this.add.rectangle(400, 300, 800, 600, 0x330000, 0.3).setDepth(0); // Red tint
            
            // Edge walls to contain the arena (no escape except exit door)
            const wallPositions = [
                { x: 400, y: 20, sx: 25, sy: 1 },   // Top wall
                { x: 400, y: 580, sx: 25, sy: 1 },  // Bottom wall (gap for exit)
                { x: 20, y: 300, sx: 1, sy: 18 },   // Left wall
                { x: 780, y: 300, sx: 1, sy: 18 },  // Right wall
                // Some cover in the arena
                { x: 200, y: 200, sx: 2, sy: 2 },
                { x: 600, y: 200, sx: 2, sy: 2 },
                { x: 400, y: 350, sx: 2, sy: 2 }
            ];
            wallPositions.forEach(wp => {
                const wall = this.walls.create(wp.x, wp.y, 'wall');
                wall.setScale(wp.sx, wp.sy).refreshBody();
                wall.setTint(0x442222);
                this.roomWalls.push(wall);
            });
            
            // Mark that we're in risk room mode
            this.inRiskRoom = true;
            
            // Invisible main door placeholder
            this.door = this.physics.add.staticSprite(-100, -100, 'door');
            
            // Create ONLY exit door at bottom center
            this.riskRoomExitDoor = this.physics.add.staticSprite(400, 560, 'door');
            this.riskRoomExitDoor.setTint(0x00ff00); // Green for exit
            this.riskRoomExitDoor.setScale(1.2);
            this.riskRoomExitDoor.setDepth(15);
            
            // Exit door label
            this.riskRoomExitLabel = this.add.text(400, 520, '🚪 EXIT (clear enemies first)', { 
                fontSize: '16px', 
                fill: '#00ff00',
                stroke: '#000',
                strokeThickness: 2
            }).setOrigin(0.5).setDepth(200);
            
            // Show risk room indicator
            this.riskRoomText = this.add.text(400, 50, "⚠️ DANGER ZONE ⚠️", { 
                fontSize: '28px', 
                fill: '#ff0000',
                stroke: '#000',
                strokeThickness: 4
            }).setOrigin(0.5).setDepth(200);
            
            // Spawn harder enemies and better loot
            this.spawnRiskRoomEntities();
            
            // Position player at top (away from exit)
            this.player.setPosition(400, 150);
            
            // Fade back in and reset transition flag
            this.cameras.main.fadeIn(200, 0, 0, 0);
            this.isTransitioningRoom = false;
        });
    }
    
    spawnRiskRoomEntities() {
        const level = this.currentLevel;
        const ZOMBIE_TYPES = ['walker', 'leaper', 'spitter', 'exploder'];
        const riskEnemyCounts = CONFIG.RISK_ROOM.ENEMIES_PER_LEVEL || { 1: 8, 2: 9, 3: 10, 4: 10, 5: 10, 6: 10, 7: 10 };
        const enemyCount = riskEnemyCounts[level] != null ? riskEnemyCounts[level] : 10;
        const banditPct = (CONFIG.BANDIT_PCT != null ? CONFIG.BANDIT_PCT : 30) / 100;
        const banditsOnly = banditPct >= 1;
        
        const riskEnemyTypes = {
            1: ['walker', 'leaper', 'bandit'],
            2: ['walker', 'bandit', 'leaper', 'spitter'],
            3: ['walker', 'spitter', 'bandit', 'leaper'],
            4: ['walker', 'exploder', 'spitter', 'bandit'],
            5: ['walker', 'spitter', 'bandit', 'exploder'],
            6: ['walker', 'exploder', 'bandit', 'spitter'],
            7: ['walker', 'exploder', 'bandit', 'spitter']
        };
        
        const enemyTypes = riskEnemyTypes[level] || ['bandit', 'leaper'];
        let zombiePool = enemyTypes.filter(t => ZOMBIE_TYPES.includes(t));
        if (CONFIG.WALKERS_ONLY_SPAWN) zombiePool = ['leaper'];
        if (zombiePool.length > 0 && !zombiePool.includes('walker')) zombiePool.push('walker');
        const hasBandit = enemyTypes.includes('bandit');
        const banditCount = banditsOnly ? enemyCount : (hasBandit ? Math.round(enemyCount * banditPct) : 0);
        const zombieCount = enemyCount - banditCount;
        
        const spawnPoints = [
            { x: 150, y: 300 }, { x: 650, y: 300 },
            { x: 300, y: 150 }, { x: 500, y: 150 },
            { x: 300, y: 450 }, { x: 500, y: 450 },
            { x: 400, y: 200 }, { x: 400, y: 400 },
            { x: 200, y: 300 }, { x: 600, y: 300 }
        ];
        
        const spawnList = [];
        for (let i = 0; i < zombieCount && zombiePool.length > 0; i++) {
            spawnList.push(zombiePool[Math.floor(Math.random() * zombiePool.length)]);
        }
        for (let i = 0; i < banditCount; i++) spawnList.push('bandit');
        Phaser.Utils.Array.Shuffle(spawnList);
        
        const usedIndices = [];
        for (let i = 0; i < spawnList.length; i++) {
            let bestIdx = -1;
            if (usedIndices.length === 0) {
                bestIdx = Math.floor(Math.random() * spawnPoints.length);
            } else {
                let bestMinDist = -1;
                for (let j = 0; j < spawnPoints.length; j++) {
                    if (usedIndices.includes(j)) continue;
                    const p = spawnPoints[j];
                    let minD = Infinity;
                    for (const k of usedIndices) {
                        const d = Phaser.Math.Distance.Between(p.x, p.y, spawnPoints[k].x, spawnPoints[k].y);
                        if (d < minD) minD = d;
                    }
                    if (minD > bestMinDist) { bestMinDist = minD; bestIdx = j; }
                }
                if (bestIdx < 0) bestIdx = usedIndices[usedIndices.length - 1];
            }
            if (bestIdx >= 0) {
                usedIndices.push(bestIdx);
                const pos = spawnPoints[bestIdx];
                this.spawnEnemy(spawnList[i], pos.x, pos.y);
            }
        }
        
        // Spawn guaranteed good loot (mod is rarity-weighted, plus one from bonus pool)
        const bonusPool = CONFIG.RISK_ROOM.BONUS_LOOT;
        const bonusItem = (bonusPool && bonusPool.length > 0) ? bonusPool[Math.floor(Math.random() * bonusPool.length)] : 'scrap';
        const riskLoot = [
            pickModByRarity(),
            bonusItem,
            'ammo', 'ammo', 'meds', 'grenade', 'scrap'
        ];
        
        const cratePositions = [
            { x: 100, y: 100 }, { x: 700, y: 100 },
            { x: 100, y: 500 }, { x: 700, y: 500 },
            { x: 400, y: 250 }
        ];
        
        cratePositions.forEach((pos, i) => {
            if (i < riskLoot.length) {
                this.createCrateAt(pos.x, pos.y, riskLoot[i]);
            }
        });
    }
    
    exitRiskRoom() {
        if (!this.roomGrid || !this.inRiskRoom) return;
        if (this.isTransitioningRoom) return; // Prevent re-entry during transition
        
        this.isTransitioningRoom = true;
        
        const currentRoom = this.roomGrid.rooms[this.roomGrid.currentRoom];
        currentRoom.riskRoomCleared = true;
        this.inRiskRoom = false;
        
        sfx.doorOpen();
        this.showFloatingText(400, 300, "RISK ROOM CLEARED!", 0x00ff00);
        
        // Fade transition back to main room
        this.cameras.main.fadeOut(200, 0, 0, 0);
        
        this.time.delayedCall(200, () => {
            // Clear risk room entities
            this.enemies.clear(true, true);
            this.bullets.clear(true, true);
            this.crates.getChildren().forEach(c => c.destroy());
            this.skulls.clear(true, true);
            this.droppedInventoryItems.clear(true, true);
            
            // Remove risk room UI elements
            if (this.riskRoomText) { this.riskRoomText.destroy(); this.riskRoomText = null; }
            if (this.riskRoomExitDoor) { this.riskRoomExitDoor.destroy(); this.riskRoomExitDoor = null; }
            if (this.riskRoomExitLabel) { this.riskRoomExitLabel.destroy(); this.riskRoomExitLabel = null; }
            
            // Clear risk room walls and floor
            if (this.roomFloor) this.roomFloor.destroy();
            if (this.roomOverlay) this.roomOverlay.destroy();
            if (this.roomWalls) this.roomWalls.forEach(w => w.destroy());
            this.roomWalls = [];
            if (this.door) { this.door.destroy(); this.door = null; }
            
            // Restore the original room (risk room was cleared, so no risk door will appear)
            this.setupRoom(currentRoom);
            // Restore unlooted crates, bodies, and dropped items so sprites and collision are back
            this.restoreCratesFromState(currentRoom);
            this.restoreSkullsFromState(currentRoom);
            this.restoreDroppedItemsFromState(currentRoom);
            if (currentRoom.enemyState && currentRoom.enemyState.length > 0)
                this.restoreEnemiesFromState(currentRoom);
            
            // Position player near where risk door was
            this.player.setPosition(700, 450);
            
            // Restore minimap
            this.updateMinimap();
            
            // Fade back in and reset transition flag
            this.cameras.main.fadeIn(200, 0, 0, 0);
            this.isTransitioningRoom = false;
        });
    }
    
    createMinimap() {
        // Create minimap container in bottom-right corner (hidden until map pickup found)
        this.minimapGraphics = this.add.graphics().setDepth(200).setScrollFactor(0);
        this.minimapX = 795;  // Far right edge
        this.minimapY = 595;  // Far bottom edge
        this.minimapRoomSize = 18;  // Slightly smaller rooms
        this.minimapPadding = 2;
        this.hasMap = false;  // Map starts hidden, need pickup to enable
    }
    
    updateMinimap() {
        if (!this.minimapGraphics || !this.roomGrid) return;
        
        this.minimapGraphics.clear();
        
        // Only draw if player has picked up the map and NOT in risk room
        if (!this.hasMap || this.inRiskRoom) return;
        
        const { cols, rows, rooms, currentRoom } = this.roomGrid;
        
        // Background - 50% less opacity (0.35 instead of 0.7)
        const mapWidth = cols * (this.minimapRoomSize + this.minimapPadding) + this.minimapPadding;
        const mapHeight = rows * (this.minimapRoomSize + this.minimapPadding) + this.minimapPadding;
        this.minimapGraphics.fillStyle(0x000000, 0.35);
        this.minimapGraphics.fillRect(this.minimapX - mapWidth - 10, this.minimapY - mapHeight - 10, mapWidth + 20, mapHeight + 20);
        
        // Draw rooms
        rooms.forEach((room, idx) => {
            const x = this.minimapX - mapWidth + this.minimapPadding + room.col * (this.minimapRoomSize + this.minimapPadding);
            const y = this.minimapY - mapHeight + this.minimapPadding + room.row * (this.minimapRoomSize + this.minimapPadding);
            
            // Room color based on state (slightly transparent)
            let color = 0x333333; // Unvisited
            if (room.visited && !room.cleared) color = 0x666666; // Visited but not cleared
            if (room.cleared) color = 0x00aa00; // Cleared
            if (room.isExit) color = room.cleared ? 0x00ff00 : 0xffff00; // Exit
            if (idx === currentRoom) color = 0x00aaff; // Current room
            
            this.minimapGraphics.fillStyle(color, 0.7);
            this.minimapGraphics.fillRect(x, y, this.minimapRoomSize, this.minimapRoomSize);
            
            // Risk room indicator
            if (room.hasRiskRoom && !room.riskRoomCleared) {
                this.minimapGraphics.fillStyle(0xff0000, 0.8);
                this.minimapGraphics.fillCircle(x + this.minimapRoomSize - 4, y + 4, 3);
            }
            
            // Draw connections
            this.minimapGraphics.lineStyle(2, 0x888888, 0.5);
            if (room.connections.east !== null) {
                this.minimapGraphics.moveTo(x + this.minimapRoomSize, y + this.minimapRoomSize / 2);
                this.minimapGraphics.lineTo(x + this.minimapRoomSize + this.minimapPadding, y + this.minimapRoomSize / 2);
                this.minimapGraphics.strokePath();
            }
            if (room.connections.south !== null) {
                this.minimapGraphics.moveTo(x + this.minimapRoomSize / 2, y + this.minimapRoomSize);
                this.minimapGraphics.lineTo(x + this.minimapRoomSize / 2, y + this.minimapRoomSize + this.minimapPadding);
                this.minimapGraphics.strokePath();
            }
        });
    }

    setupMapForLevel(level) {
        if (level === 1) {
            this.add.tileSprite(400, 300, 800, 600, 'floor_grass');
            this.door = this.physics.add.staticSprite(400, 50, 'door');
            this.walls.create(200, 200, 'wall').setScale(1, 4).refreshBody();
            this.walls.create(600, 200, 'wall').setScale(1, 4).refreshBody();
        } else if (level === 2) {
            this.add.tileSprite(400, 300, 800, 600, 'floor_apt');
            this.door = this.physics.add.staticSprite(400, 50, 'door').setTint(0x0000ff);
            this.debrisBlock = this.debris.create(400, 100, 'debris');
            this.walls.create(250, 300, 'wall').setScale(1, 15).refreshBody();
            this.walls.create(550, 300, 'wall').setScale(1, 15).refreshBody();
        } else if (level === 3) {
            this.add.tileSprite(400, 300, 800, 600, 'floor_roof');
            this.door = this.physics.add.staticSprite(400, 50, 'door').setTint(0x00ff00);
        } else if (level === 4) {
            // SEWERS - Dark, tight corridors with toxic spitters
            this.add.tileSprite(400, 300, 800, 600, 'floor_sewer');
            this.door = this.physics.add.staticSprite(750, 300, 'door').setTint(0x00ffff);
            // Sewer pipe walls - narrow corridor maze
            this.walls.create(200, 150, 'wall').setScale(6, 1).refreshBody();
            this.walls.create(600, 150, 'wall').setScale(3, 1).refreshBody();
            this.walls.create(100, 300, 'wall').setScale(1, 4).refreshBody();
            this.walls.create(400, 300, 'wall').setScale(1, 6).refreshBody();
            this.walls.create(200, 450, 'wall').setScale(6, 1).refreshBody();
            this.walls.create(550, 450, 'wall').setScale(4, 1).refreshBody();
            // Water hazard visual (dark area)
            this.add.rectangle(300, 380, 150, 80, 0x003300, 0.5).setDepth(1);
        } else if (level === 5) {
            // HOSPITAL - Open areas, mini boss
            this.add.tileSprite(400, 300, 800, 600, 'floor_hospital');
            this.door = this.physics.add.staticSprite(400, 50, 'door').setTint(0xff00ff);
            // Hospital layout - rooms and corridors
            this.walls.create(150, 200, 'wall').setScale(1, 8).refreshBody();
            this.walls.create(650, 200, 'wall').setScale(1, 8).refreshBody();
            this.walls.create(300, 100, 'wall').setScale(4, 1).refreshBody();
            this.walls.create(500, 100, 'wall').setScale(4, 1).refreshBody();
            this.walls.create(400, 350, 'wall').setScale(8, 1).refreshBody();
        } else if (level === 6) {
            // MALL - Multi-floor combat with balcony enemies
            this.add.tileSprite(400, 300, 800, 600, 'floor_apt'); // Reuse apartment floor for mall
            this.door = this.physics.add.staticSprite(400, 50, 'door').setTint(0xffff00);
            
            // Mall structure - ground floor with upper balcony
            // Ground floor stores (left and right)
            this.walls.create(100, 450, 'wall').setScale(3, 4).refreshBody();
            this.walls.create(700, 450, 'wall').setScale(3, 4).refreshBody();
            
            // Upper floor balcony walls
            this.walls.create(100, 150, 'wall').setScale(4, 1).refreshBody();
            this.walls.create(700, 150, 'wall').setScale(4, 1).refreshBody();
            
            // Central escalator area (narrow paths)
            this.walls.create(300, 250, 'wall').setScale(1, 3).refreshBody();
            this.walls.create(500, 250, 'wall').setScale(1, 3).refreshBody();
            
            // Cover objects (benches, planters)
            this.crates.create(200, 350, 'crate').setScale(0.5).refreshBody().setTint(0x8B4513).setDepth(10).setVisible(true); // Bench
            this.crates.create(600, 350, 'crate').setScale(0.5).refreshBody().setTint(0x8B4513).setDepth(10).setVisible(true); // Bench
            this.crates.create(400, 500, 'crate').setScale(0.5).refreshBody().setTint(0x228B22).setDepth(10).setVisible(true); // Planter
            
            // Visual: Balcony indicator
            this.add.rectangle(400, 100, 600, 80, 0x333333, 0.3).setDepth(1);
            this.add.text(400, 100, "UPPER FLOOR", { fontSize: '14px', fill: '#666' }).setOrigin(0.5).setDepth(2);
        } else if (level === 7) {
            // CEMETERY - Stealth graveyard leading to church boss arena
            this.add.tileSprite(400, 300, 800, 600, 'floor_grass'); // Dark grass
            this.add.rectangle(400, 300, 800, 600, 0x001100, 0.5).setDepth(0); // Dark overlay
            this.door = this.physics.add.staticSprite(-100, -100, 'door'); // No door - boss extraction level
            
            // Graveyard tombstones (cover for stealth)
            const tombPositions = [
                {x: 150, y: 450}, {x: 250, y: 400}, {x: 350, y: 480},
                {x: 450, y: 420}, {x: 550, y: 460}, {x: 650, y: 400},
                {x: 200, y: 300}, {x: 400, y: 320}, {x: 600, y: 280}
            ];
            tombPositions.forEach(pos => {
                const tomb = this.walls.create(pos.x, pos.y, 'wall');
                tomb.setScale(0.5, 1).refreshBody();
                tomb.setTint(0x555555); // Gray tombstone
            });
            
            // Church entrance walls
            this.walls.create(200, 100, 'wall').setScale(4, 1).refreshBody();
            this.walls.create(600, 100, 'wall').setScale(4, 1).refreshBody();
            this.walls.create(100, 150, 'wall').setScale(1, 3).refreshBody();
            this.walls.create(700, 150, 'wall').setScale(1, 3).refreshBody();
            
            // Church interior visual
            this.add.rectangle(400, 100, 400, 150, 0x222222, 0.5).setDepth(1);
            this.add.text(400, 50, "CHURCH", { fontSize: '18px', fill: '#555' }).setOrigin(0.5).setDepth(2);
            
            // Moonlight patches (detection zones - visual only, stealth handles mechanics)
            this.add.circle(300, 380, 40, 0xffffcc, 0.1).setDepth(1);
            this.add.circle(500, 350, 50, 0xffffcc, 0.1).setDepth(1);
        }
    }

    spawnLevelEntities(level) {
        const levelPools = CONFIG.LOOT.LEVEL_POOLS || {};
        let loot = [...(levelPools[level] || ['ammo', 'scrap'])];
        let cratePos = [];
        if (level === 1) {
            cratePos = [{x:100,y:100}, {x:700,y:500}, {x:50,y:300}, {x:750,y:300}, {x:400,y:400}, {x:200,y:50}, {x:600,y:50}, {x:400,y:500}];
            this.spawnEnemy('walker', 400, 350);
            this.spawnEnemy('walker', 300, 250);
            this.spawnEnemy('leaper', 100, 300);
            this.spawnEnemy('bandit', 700, 300);
            this.spawnEnemy('leaper', 200, 200);
        } else if (level === 2) {
            cratePos = [{x:100,y:100}, {x:100,y:500}, {x:700,y:100}, {x:700,y:500}, {x:400,y:300}, {x:50,y:250}, {x:750,y:250}, {x:200,y:550}, {x:400,y:550}, {x:600,y:400}];
            this.spawnEnemy('walker', 400, 300);
            this.spawnEnemy('walker', 250, 400);
            this.spawnEnemy('bandit', 100, 100);
            this.spawnEnemy('bandit', 700, 100);
            this.spawnEnemy('leaper', 400, 450);
            this.spawnEnemy('leaper', 400, 150);
        } else if (level === 3) {
            cratePos = [{x:100,y:100}, {x:700,y:100}, {x:100,y:500}, {x:700,y:500}, {x:400,y:300}, {x:50,y:300}, {x:750,y:300}];
            this.spawnEnemy('walker', 350, 200);
            this.spawnEnemy('walker', 450, 400);
            this.spawnEnemy('leaper', 400, 100);
            this.spawnEnemy('leaper', 200, 300);
            this.spawnEnemy('spitter', 600, 300);
            this.spawnEnemy('bandit', 100, 500);
            this.spawnEnemy('bandit', 700, 500);
        } else if (level === 4) {
            // SEWERS - Spitter-heavy with tight corridors
            cratePos = [{x:50,y:80}, {x:700,y:80}, {x:50,y:520}, {x:700,y:520}, {x:250,y:220}, {x:550,y:220}, {x:250,y:380}, {x:650,y:380}, {x:500,y:550}, {x:150,y:550}];
            // Spitters in the sewers
            this.spawnEnemy('spitter', 300, 250);
            this.spawnEnemy('spitter', 500, 250);
            this.spawnEnemy('spitter', 200, 500);
            // Walkers and leapers
            this.spawnEnemy('walker', 200, 350);
            this.spawnEnemy('walker', 500, 350);
            this.spawnEnemy('leaper', 100, 200);
            this.spawnEnemy('leaper', 650, 500);
            this.spawnEnemy('leaper', 400, 200);
        } else if (level === 5) {
            // HOSPITAL - Boss fight
            cratePos = [{x:100,y:450}, {x:700,y:450}, {x:100,y:550}, {x:700,y:550}, {x:300,y:550}, {x:500,y:550}, {x:250,y:250}, {x:550,y:250}];
            // Hospital Boss
            this.spawnEnemy('boss', 400, 150);
            this.bossBar.setVisible(true);
            this.bossText.setVisible(true);
            this.bossText.setText("PATIENT ZERO");
            this.updateBossBar(CONFIG.ENEMIES.BOSS.HP, CONFIG.ENEMIES.BOSS.HP);
            // Boss entrance roar
            this.time.delayedCall(500, () => sfx.bossRoar());
            // Support enemies
            this.spawnEnemy('spitter', 200, 200);
            this.spawnEnemy('spitter', 600, 200);
            this.spawnEnemy('leaper', 100, 400);
            this.spawnEnemy('leaper', 700, 400);
        } else if (level === 6) {
            // MALL - Multi-floor combat with exploders
            cratePos = [
                {x:100,y:550}, {x:700,y:550}, {x:100,y:350}, {x:700,y:350},
                {x:250,y:150}, {x:550,y:150}, {x:400,y:450}, {x:150,y:200},
                {x:650,y:200}, {x:400,y:250}
            ];
            
            // Ground floor enemies
            this.spawnEnemy('walker', 400, 450);
            this.spawnEnemy('exploder', 150, 400);
            this.spawnEnemy('exploder', 650, 400);
            this.spawnEnemy('leaper', 300, 500);
            this.spawnEnemy('leaper', 500, 500);
            
            // Upper floor bandits (shooting down)
            this.spawnEnemy('bandit', 200, 100);
            this.spawnEnemy('bandit', 600, 100);
            
            // Spitters in strategic positions
            this.spawnEnemy('spitter', 400, 200);
            
            // Store spawn waves (delayed)
            this.time.delayedCall(5000, () => {
                if (this.currentLevel === 6) {
                    this.showFloatingText(100, 400, "STORE BREACH!", 0xff0000);
                    this.spawnEnemy('exploder', 80, 450);
                    this.spawnEnemy('leaper', 80, 480);
                }
            });
            this.time.delayedCall(10000, () => {
                if (this.currentLevel === 6) {
                    this.showFloatingText(700, 400, "STORE BREACH!", 0xff0000);
                    this.spawnEnemy('exploder', 720, 450);
                    this.spawnEnemy('leaper', 720, 480);
                }
            });
        } else if (level === 7) {
            // CEMETERY - Stealth section + Necromancer boss
            cratePos = [
                {x:100,y:550}, {x:700,y:550}, {x:200,y:350}, {x:600,y:350},
                {x:150,y:250}, {x:650,y:250}, {x:400,y:400}, {x:300,y:500},
                {x:500,y:500}
            ];
            
            // Initialize stealth system for this level
            this.isStealthLevel = true;
            this.detectionMeter = 0;
            this.maxDetection = 100;
            this.detectionRate = 20; // Per second when spotted
            this.detectionDecay = 10; // Per second when hidden
            this.stealthAlerted = false;
            
            // Create detection UI
            this.detectionBar = this.add.graphics().setDepth(150);
            this.detectionText = this.add.text(400, 40, "STEALTH", { fontSize: '16px', fill: '#fff' }).setOrigin(0.5).setDepth(150);
            
            // Graveyard patrol enemies (stealth section)
            this.patrolEnemies = [];
            this.spawnEnemy('leaper', 200, 400);
            this.spawnEnemy('leaper', 500, 350);
            this.spawnEnemy('leaper', 350, 450);
            
            // Necromancer boss in church area
            this.spawnEnemy('necromancer', 400, 80);
            this.bossBar.setVisible(true);
            this.bossText.setVisible(true);
            this.bossText.setText("THE NECROMANCER");
            this.updateBossBar(CONFIG.ENEMIES.NECROMANCER.HP, CONFIG.ENEMIES.NECROMANCER.HP);
            // Boss entrance
            this.time.delayedCall(500, () => sfx.necroSummon());
        }
        Phaser.Utils.Array.Shuffle(loot);
        const levelsNeedingKey = CONFIG.LOOT.LEVELS_NEEDING_KEY || [1, 3, 4, 6];
        if (levelsNeedingKey.includes(level) && loot.includes('key') && cratePos.length > 0) {
            const keyIdx = loot.indexOf('key');
            if (keyIdx >= cratePos.length) {
                const swapIdx = Phaser.Math.Between(0, cratePos.length - 1);
                [loot[swapIdx], loot[keyIdx]] = [loot[keyIdx], loot[swapIdx]];
            }
        }
        cratePos.forEach((p, i) => {
            if (i < loot.length) this.createCrateAt(p.x, p.y, loot[i]);
        });
    }

    hasLineOfSight(fromX, fromY, toX, toY) {
        if (!this.walls || !this.walls.getChildren) return true;
        const line = new Phaser.Geom.Line(fromX, fromY, toX, toY);
        const rect = new Phaser.Geom.Rectangle();
        for (const wall of this.walls.getChildren()) {
            if (!wall.body) continue;
            rect.setPosition(wall.body.x, wall.body.y);
            rect.setSize(wall.body.width, wall.body.height);
            if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) return false;
        }
        return true;
    }

    onUnsuppressedGunshot(shotX, shotY, options = {}) {
        const time = this.time.now;
        const leapersOnly = options.leapersOnly === true;
        this.enemies.getChildren().forEach(e => {
            if (!e.active) return;
            if (e.enemyType === 'walker') {
                if (leapersOnly) return;
                const wcfg = CONFIG.ENEMIES.WALKER;
                if (Phaser.Math.Distance.Between(e.x, e.y, shotX, shotY) > wcfg.HEARING_RADIUS) return;
                e.walkerState = 'GUNSHOT_ALERT';
                e.gunshotAlertEndTime = time + wcfg.GUNSHOT_ALERT_DURATION;
                e.gunshotTargetX = shotX;
                e.gunshotTargetY = shotY;
            } else if (e.enemyType === 'bandit') {
                if (leapersOnly) return;
                const bcfg = CONFIG.ENEMIES.BANDIT;
                if (Phaser.Math.Distance.Between(e.x, e.y, shotX, shotY) > bcfg.HEARING_RADIUS) return;
                e.banditState = 'GUNSHOT_ALERT';
                e.gunshotAlertEndTime = time + bcfg.GUNSHOT_ALERT_DURATION;
                e.gunshotTargetX = shotX;
                e.gunshotTargetY = shotY;
            } else if (e.enemyType === 'leaper') {
                const lcfg = CONFIG.ENEMIES.LEAPER;
                if (Phaser.Math.Distance.Between(e.x, e.y, shotX, shotY) > lcfg.HEARING_RADIUS) return;
                e.state = 'GUNSHOT_ALERT';
                e.gunshotAlertEndTime = time + (lcfg.GUNSHOT_ALERT_DURATION != null ? lcfg.GUNSHOT_ALERT_DURATION : 3000);
                e.gunshotTargetX = shotX;
                e.gunshotTargetY = shotY;
            }
        });
    }

    onPlayerFootstep(playerX, playerY) {
        const time = this.time.now;
        this.enemies.getChildren().forEach(e => {
            if (!e.active) return;
            if (e.enemyType === 'walker') {
                const wcfg = CONFIG.ENEMIES.WALKER;
                const soundRadius = wcfg.SOUND_RADIUS || 180;
                if (Phaser.Math.Distance.Between(e.x, e.y, playerX, playerY) > soundRadius) return;
                e.footstepAlertCount = (e.footstepAlertCount || 0) + 1;
                if (e.footstepAlertCount >= 4) {
                    e.walkerState = 'GUNSHOT_ALERT';
                    e.gunshotAlertEndTime = time + wcfg.GUNSHOT_ALERT_DURATION;
                    e.gunshotTargetX = playerX;
                    e.gunshotTargetY = playerY;
                    e.footstepAlertCount = 0;
                }
            } else if (e.enemyType === 'bandit') {
                const bcfg = CONFIG.ENEMIES.BANDIT;
                const soundRadius = bcfg.SOUND_RADIUS || 200;
                if (Phaser.Math.Distance.Between(e.x, e.y, playerX, playerY) > soundRadius) return;
                e.footstepAlertCount = (e.footstepAlertCount || 0) + 1;
                if (e.footstepAlertCount >= 4) {
                    e.banditState = 'GUNSHOT_ALERT';
                    e.gunshotAlertEndTime = time + bcfg.GUNSHOT_ALERT_DURATION;
                    e.gunshotTargetX = playerX;
                    e.gunshotTargetY = playerY;
                    e.footstepAlertCount = 0;
                }
            } else if (e.enemyType === 'leaper') {
                const lcfg = CONFIG.ENEMIES.LEAPER;
                const soundRadius = lcfg.SOUND_RADIUS || 180;
                if (Phaser.Math.Distance.Between(e.x, e.y, playerX, playerY) > soundRadius) return;
                e.state = 'CHASE';
                e.lastHeardX = playerX;
                e.lastHeardY = playerY;
                e.lastHeardTime = time;
            }
        });
    }

    onPlayerSearchNoise(x, y) {
        const time = this.time.now;
        this.enemies.getChildren().forEach(e => {
            if (!e.active) return;
            if (e.enemyType === 'walker') {
                const wcfg = CONFIG.ENEMIES.WALKER;
                const soundRadius = wcfg.SOUND_RADIUS || 180;
                if (Phaser.Math.Distance.Between(e.x, e.y, x, y) > soundRadius) return;
                e.walkerState = 'GUNSHOT_ALERT';
                e.gunshotAlertEndTime = time + wcfg.GUNSHOT_ALERT_DURATION;
                e.gunshotTargetX = x;
                e.gunshotTargetY = y;
            } else if (e.enemyType === 'bandit') {
                const bcfg = CONFIG.ENEMIES.BANDIT;
                const soundRadius = bcfg.SOUND_RADIUS || 200;
                if (Phaser.Math.Distance.Between(e.x, e.y, x, y) > soundRadius) return;
                e.banditState = 'GUNSHOT_ALERT';
                e.gunshotAlertEndTime = time + bcfg.GUNSHOT_ALERT_DURATION;
                e.gunshotTargetX = x;
                e.gunshotTargetY = y;
            } else if (e.enemyType === 'leaper') {
                const lcfg = CONFIG.ENEMIES.LEAPER;
                const soundRadius = lcfg.SOUND_RADIUS || 180;
                if (Phaser.Math.Distance.Between(e.x, e.y, x, y) > soundRadius) return;
                e.state = 'CHASE';
                e.lastHeardX = x;
                e.lastHeardY = y;
                e.lastHeardTime = time;
            }
        });
    }

    getTargetForWalker(walker) {
        const humanTypes = ['bandit'];
        const now = this.time.now;
        // When player is crouching, leapers/walkers don't "see" them (only bandits as targets)
        const candidates = this.isCrouching ? [] : [this.player];
        this.enemies.getChildren().forEach(e => {
            if (!e.active || !humanTypes.includes(e.enemyType)) return;
            // Include spawn-grace bandits so leapers target them instead of player when you spawn one
            candidates.push(e);
        });
        let best = null;
        let bestDist = Infinity;
        candidates.forEach(c => {
            const d = Phaser.Math.Distance.Between(walker.x, walker.y, c.x, c.y);
            if (d < bestDist) { bestDist = d; best = c; }
        });
        return best || this.player;
    }

    getTargetForBandit(bandit) {
        const zombieTypes = ['walker', 'leaper'];
        const candidates = [this.player];
        this.enemies.getChildren().forEach(e => {
            if (e.active && e !== bandit && zombieTypes.includes(e.enemyType)) candidates.push(e);
        });
        let best = null;
        let bestDist = Infinity;
        candidates.forEach(c => {
            const d = Phaser.Math.Distance.Between(bandit.x, bandit.y, c.x, c.y);
            if (d < bestDist) { bestDist = d; best = c; }
        });
        return best || this.player;
    }

    spawnEnemy(type, x, y, fromButton = false, edgeSpawned = false) {
        if (CONFIG.WALKER_AI_TEST_MODE && !['walker', 'leaper', 'bandit', 'boss', 'necromancer'].includes(type)) type = ['walker', 'leaper', 'bandit'][Math.floor(Math.random() * 3)];
        const enemy = new Enemy(this, x, y, this.player, type);
        if (fromButton) enemy.spawnTime = this.time.now;
        if (edgeSpawned) enemy.edgeSpawned = true;
        this.enemies.add(enemy);
        return enemy;
    }

    /** Spawn one enemy from a random edge so they wander in over time. */
    spawnEdgeEnemy() {
        if (!CONFIG.EDGE_SPAWN_ENABLED || !this.player || !this.player.active) return;
        if (this.isPaused || this.inRiskRoom || this.isTransitioningRoom || this.isTransitioning) return;
        const level = this.currentLevel;
        const ZOMBIE_TYPES = ['walker', 'leaper', 'spitter', 'exploder'];
        const levelEnemyTypes = {
            1: ['walker', 'leaper'], 2: ['walker', 'leaper'], 3: ['walker', 'leaper', 'spitter'],
            4: ['walker', 'leaper', 'spitter'], 5: ['leaper', 'spitter'], 6: ['walker', 'leaper', 'spitter', 'exploder'], 7: ['leaper']
        };
        let pool = (levelEnemyTypes[level] || ['walker', 'leaper']).filter(t => ZOMBIE_TYPES.includes(t));
        if (pool.length === 0) pool = ['walker', 'leaper'];
        const type = pool[Math.floor(Math.random() * pool.length)];
        const side = Math.floor(Math.random() * 4);
        let x, y;
        if (side === 0) { x = 15; y = 80 + Math.random() * 440; }
        else if (side === 1) { x = 785; y = 80 + Math.random() * 440; }
        else if (side === 2) { y = 15; x = 80 + Math.random() * 640; }
        else { y = 585; x = 80 + Math.random() * 640; }
        this.spawnEnemy(type, x, y, false, true);
    }

    spawnPatrolEnemy(type, x, y, waypoints) {
        const enemy = new Enemy(this, x, y, this.player, type);
        enemy.isPatrol = true;
        enemy.waypoints = waypoints;
        enemy.currentWaypoint = 0;
        enemy.patrolSpeed = 30; // Slower patrol speed
        enemy.visionRange = 150;
        enemy.visionAngle = Math.PI / 3; // 60 degree cone
        this.enemies.add(enemy);
        if (!this.patrolEnemies) this.patrolEnemies = [];
        this.patrolEnemies.push(enemy);
        return enemy;
    }
    
    updatePatrolEnemies(time, delta) {
        if (!this.patrolEnemies) return;
        
        this.patrolEnemies.forEach(enemy => {
            if (!enemy.active) return;
            if (enemy.enemyType === 'walker') {
                if (this.stealthAlerted && enemy.walkerState) enemy.walkerState = 'HUNT';
                return;
            }
            if (enemy.enemyType === 'leaper') {
                if (this.stealthAlerted) enemy.state = 'CHASE';
                return;
            }
            if (!enemy.isPatrol) return;
            if (this.stealthAlerted) {
                enemy.isPatrol = false;
                return;
            }
            const wp = enemy.waypoints[enemy.currentWaypoint];
            const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, wp.x, wp.y);
            if (dist < 10) {
                enemy.currentWaypoint = (enemy.currentWaypoint + 1) % enemy.waypoints.length;
            } else {
                this.physics.moveToObject(enemy, wp, enemy.patrolSpeed);
            }
        });
    }
    
    updateStealthMechanics(time, delta) {
        let isDetected = false;
        
        // Check if any patrol enemy can see the player
        if (this.patrolEnemies) {
            this.patrolEnemies.forEach(enemy => {
                if (!enemy.active) return;
                
                const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                // Shadow Step skill: -25% enemy detection range
                const effectiveVisionRange = enemy.visionRange * (1 - (this.shadowStepReduction || 0));
                if (dist > effectiveVisionRange) return;
                
                // Check vision cone
                const angleToPlayer = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
                const enemyFacing = Math.atan2(enemy.body.velocity.y, enemy.body.velocity.x);
                let angleDiff = Math.abs(angleToPlayer - enemyFacing);
                if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
                
                if (angleDiff < enemy.visionAngle) {
                    // Player is in vision cone - check line of sight (simplified)
                    isDetected = true;
                }
            });
        }
        
        // Update detection meter
        const deltaSeconds = delta / 1000;
        if (isDetected) {
            this.detectionMeter += this.detectionRate * deltaSeconds;
            // Play ping sound periodically
            if (Math.floor(this.detectionMeter / 25) !== Math.floor((this.detectionMeter - this.detectionRate * deltaSeconds) / 25)) {
                sfx.detectionPing();
            }
        } else {
            // Ghost skill: Faster detection decay (multiplier)
            const decayRate = this.detectionDecay * (this.ghostDecayMultiplier || 1);
            this.detectionMeter -= decayRate * deltaSeconds;
        }
        this.detectionMeter = Phaser.Math.Clamp(this.detectionMeter, 0, this.maxDetection);
        
        // Update detection UI
        if (this.detectionBar) {
            this.detectionBar.clear();
            // Background
            this.detectionBar.fillStyle(0x333333);
            this.detectionBar.fillRect(300, 55, 200, 15);
            // Fill based on detection
            const fillColor = this.detectionMeter < 50 ? 0x00ff00 : (this.detectionMeter < 80 ? 0xffff00 : 0xff0000);
            this.detectionBar.fillStyle(fillColor);
            this.detectionBar.fillRect(300, 55, 200 * (this.detectionMeter / this.maxDetection), 15);
            // Border
            this.detectionBar.lineStyle(2, 0xffffff);
            this.detectionBar.strokeRect(300, 55, 200, 15);
        }
        
        // Check for full detection
        if (this.detectionMeter >= this.maxDetection && !this.stealthAlerted) {
            this.triggerStealthAlert();
        }
    }
    
    triggerStealthAlert() {
        this.stealthAlerted = true;
        sfx.detectionMax();
        this.showFloatingText(400, 200, "DETECTED!", 0xff0000);
        
        // Update detection text
        if (this.detectionText) {
            this.detectionText.setText("ALERTED!");
            this.detectionText.setColor('#ff0000');
        }
        
        if (this.patrolEnemies) {
            this.patrolEnemies.forEach(enemy => {
                if (enemy.active) {
                    if (enemy.enemyType === 'walker' && enemy.walkerState) enemy.walkerState = 'HUNT';
                    else enemy.isPatrol = false;
                }
            });
        }
        
        // Spawn reinforcement horde
        this.showFloatingText(400, 300, "HORDE INCOMING!", 0xff0000);
        this.time.delayedCall(500, () => {
            this.spawnEnemy('leaper', 100, 500);
            this.spawnEnemy('leaper', 700, 500);
            this.spawnEnemy('leaper', 200, 550);
            this.spawnEnemy('leaper', 600, 550);
            this.spawnEnemy('leaper', 400, 580);
        });
    }
    
    // Check if player is in shadow (behind tombstone/cover)
    isPlayerInShadow() {
        // Simplified: player is "in shadow" if near a wall/tombstone
        let inShadow = false;
        this.walls.getChildren().forEach(wall => {
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, wall.x, wall.y);
            if (dist < 50) inShadow = true;
        });
        return inShadow;
    }

    spawnSwitch(x, y) {
        this.switches.create(x, y, 'switch');
        this.showFloatingText(x, y, "BOSS DEAD! HIT THE SWITCH!", 0x00ff00);
        this.switchDropped = true;
        this.bossBar.setVisible(false);
        this.bossText.setVisible(false);
    }

    activateExtraction() {
        if (this.extractionActive) return;
        this.extractionActive = true;
        sfx.extractionStart();
        this.tweens.add({ targets: this.darkness, alpha: 0.2, duration: 500, yoyo: true, repeat: -1 });
        this.showFloatingText(400, 300, "BEACON ONLINE! SURVIVE 15s!", 0xff0000);
        this.spawnEnemy('bandit', 100, 100);
        this.spawnEnemy('bandit', 700, 100);
        this.spawnEnemy('leaper', 400, 500);
        this.spawnEnemy('leaper', 100, 500);
        this.extractionTimerEvent = this.time.addEvent({
            delay: 1000,
            callback: () => {
                this.extractionTimer--;
                sfx.extractionTick();
                if (this.extractionTimer <= 0) this.winGame();
            },
            repeat: 14
        });
        this.activeTimerEvents.push(this.extractionTimerEvent);
    }

    cleanupTimerEvents() {
        this.activeTimerEvents.forEach(event => {
            if (event) this.time.removeEvent(event);
        });
        this.activeTimerEvents = [];
        if (this.extractionTimerEvent) {
            this.time.removeEvent(this.extractionTimerEvent);
            this.extractionTimerEvent = null;
        }
        this.cancelReload();
    }

    update(time, delta) {
        // Inventory-only mode (hideout CHARACTER tab): no game loop
        if (this.inventoryOnlyMode) return;
        // Skip all updates during level transitions
        if (this.isTransitioning) return;
        
        // Door delay (both arms broken): complete after 1.5s — run every frame so delay always applies
        if (this.doorPending && this.time.now - this.doorPending.start >= 1500) {
            const p = this.doorPending;
            this.doorPending = null;
            if (this.hasNoGoodArms()) this.applyBothArmsActionDamage();
            if (p.action === 'room') this.transitionToRoom(p.targetRoom);
            else if (p.action === 'risk') this.enterRiskRoom();
            else if (p.action === 'exitRisk') this.exitRiskRoom();
            else if (p.action === 'nextLevel') this.nextLevel();
            return;
        }
        
        // Input handling (works even when paused for menu/inventory)
        if (Phaser.Input.Keyboard.JustDown(this.keys.tab) || Phaser.Input.Keyboard.JustDown(this.keys.inv)) {
            this.toggleInventory();
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
            if (this.isInventoryOpen) this.toggleInventory();
            else this.togglePause();
        }

        if (Phaser.Input.Keyboard.JustDown(this.keys.nvg)) {
            if (hasEquippedNvg(this.playerStats)) {
                sfx.toggleNVG();
                this.nvgOn = !this.nvgOn;
                if (this.nvgOn) {
                    this.darkness.setVisible(false);
                    this.nvgLayer.setVisible(true);
                    this.cameras.main.setBackgroundColor(0x002200);
                } else {
                    this.darkness.setVisible(true);
                    this.nvgLayer.setVisible(false);
                    this.cameras.main.setBackgroundColor(0x000000);
                }
            } else {
                this.showFloatingText(this.player.x, this.player.y - 40, "NO NVG EQUIPPED", 0xffffff);
            }
        }

        // Laser sight toggle (L key)
        if (Phaser.Input.Keyboard.JustDown(this.keys.visionDebug)) {
            this.showSensoryOverlay = !this.showSensoryOverlay;
            if (this.walkerVisionGraphics) this.walkerVisionGraphics.setVisible(this.showSensoryOverlay);
            if (this.leaperVisionGraphics) this.leaperVisionGraphics.setVisible(this.showSensoryOverlay);
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.damageLog)) {
            this.damageLogVisible = !this.damageLogVisible;
            if (this.damageLogText) this.damageLogText.setVisible(this.damageLogVisible);
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.laser)) {
            this.laserEnabled = !this.laserEnabled;
            sfx.click();
            this.showFloatingText(this.player.x, this.player.y - 40, this.laserEnabled ? "LASER ON" : "LASER OFF", 0xff0000);
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.flashlight) && this.playerStats.hasFlashlight) {
            this.flashlightOn = !this.flashlightOn;
            sfx.click();
            this.showFloatingText(this.player.x, this.player.y - 40, this.flashlightOn ? "FLASHLIGHT ON" : "FLASHLIGHT OFF", 0xffffff);
        }

        if (this.isPaused) return;

        // Face aim direction (Kenney sprites face +X / right) + broken-arm sway
        if (this.player && this.player.active && !this.isInventoryOpen) {
            const aim = this.input.activePointer;
            let rot = Phaser.Math.Angle.Between(this.player.x, this.player.y, aim.worldX, aim.worldY);
            const limbHpAim = this.playerStats.limbHp;
            const armBroken = limbHpAim && (limbHasBreak(limbHpAim, 'leftArm') || limbHasBreak(limbHpAim, 'rightArm'));
            if (armBroken) {
                const amp = (CONFIG.LIMB_VIS && CONFIG.LIMB_VIS.ARM_SWAY_AMP) || 0.1;
                const hz = (CONFIG.LIMB_VIS && CONFIG.LIMB_VIS.ARM_SWAY_HZ) || 2.2;
                rot += Math.sin(time * 0.001 * hz * Math.PI * 2) * amp;
            }
            this.player.setRotation(rot);
        }

        // Full auto: while holding fire with SMG/rifle, keep firing at rate of fire
        if (this.holdingFire && (this.playerStats.currentWeapon === 'smg' || this.playerStats.currentWeapon === 'rifle')) {
            this.fireBullet(this.input.activePointer);
        }

        this.processBleedTick();
        this.processBloodAndInfection(time, delta);
        this.updateLimbVisFeel(time, delta);
        this.drawUI();
        this.drawVignette();
        this.drawLaserSight();
        this.enemies.getChildren().forEach(e => { e.revealedByFlashlight = false; });
        if (this.playerStats.hasFlashlight && this.flashlightOn) {
            const flashRange = this.hasNoGoodArms() ? CONFIG.PLAYER.FLASHLIGHT_RANGE * 0.4 : CONFIG.PLAYER.FLASHLIGHT_RANGE;
            const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.input.activePointer.x, this.input.activePointer.y);
            this.enemies.getChildren().forEach(e => {
                if (!e.active) return;
                const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
                if (dist > flashRange) return;
                if (!this.hasLineOfSight(this.player.x, this.player.y, e.x, e.y)) return;
                const angleToEnemy = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
                let diff = angleToEnemy - angle;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                if (Math.abs(diff) <= CONFIG.PLAYER.FLASHLIGHT_ANGLE) {
                    e.revealedByFlashlight = true;
                }
            });
        }
        this.enemies.getChildren().forEach(e => e.update(time, delta));

        // Walker vs bandit melee: apply by distance (overlap same-group can be unreliable when bodies push)
        const walkerVsBanditCooldown = 350;
        const walkerMeleeRange = 50;
        const bandits = this.enemies.getChildren().filter(e => e.active && !e.isCorpse && e.enemyType === 'bandit');
        this.enemies.getChildren().forEach(e => {
            if (!e.active || e.isCorpse || e.enemyType !== 'walker') return;
            for (const bandit of bandits) {
                if (!bandit.active) continue;
                const dist = Phaser.Math.Distance.Between(e.x, e.y, bandit.x, bandit.y);
                if (dist > walkerMeleeRange) continue;
                if ((e.lastMeleeHitTime || 0) + walkerVsBanditCooldown <= time) {
                    bandit.takeDamage(e.damage, 'melee', e.x, e.y);
                    e.lastMeleeHitTime = time;
                    break;
                }
            }
        });

        if (this.walkerVisionGraphics) {
            this.walkerVisionGraphics.clear();
            const wcfg = CONFIG.ENEMIES.WALKER;
            const bcfg = CONFIG.ENEMIES.BANDIT;
            this.enemies.getChildren().forEach(e => {
                if (!e.active) return;
                if (e.enemyType === 'walker' && e.walkerState) {
                    let facingAngle;
                    if (e.walkerState === 'HUNT') facingAngle = e.walkerFacingAngle != null ? e.walkerFacingAngle : Phaser.Math.Angle.Between(e.x, e.y, e.target.x, e.target.y);
                    else if (e.walkerState === 'GUNSHOT_ALERT') facingAngle = Phaser.Math.Angle.Between(e.x, e.y, e.gunshotTargetX, e.gunshotTargetY);
                    else if (e.walkerState === 'SEARCH') facingAngle = Phaser.Math.Angle.Between(e.x, e.y, e.lastKnownPlayerX, e.lastKnownPlayerY);
                    else facingAngle = e.patrolDirection;
                    const alpha = e.walkerState === 'HUNT' ? 0.35 : 0.25;
                    this.walkerVisionGraphics.fillStyle(0xff0000, alpha);
                    this.walkerVisionGraphics.slice(e.x, e.y, wcfg.PERCEPTION_RADIUS, facingAngle - wcfg.VISION_ANGLE, facingAngle + wcfg.VISION_ANGLE);
                    this.walkerVisionGraphics.fill();
                    this.walkerVisionGraphics.lineStyle(2, 0xff6600, 0.9);
                    this.walkerVisionGraphics.strokeCircle(e.x, e.y, wcfg.CLOSE_AGGRO_RADIUS || 80);
                    this.walkerVisionGraphics.lineStyle(2, 0x0088ff, 0.8);
                    this.walkerVisionGraphics.strokeCircle(e.x, e.y, wcfg.SOUND_RADIUS || 180);
                } else if (e.enemyType === 'bandit' && e.banditState) {
                    let facingAngle;
                    if (e.banditState === 'HUNT') facingAngle = e.banditFacingAngle != null ? e.banditFacingAngle : Phaser.Math.Angle.Between(e.x, e.y, e.target.x, e.target.y);
                    else if (e.banditState === 'GUNSHOT_ALERT') facingAngle = Phaser.Math.Angle.Between(e.x, e.y, e.gunshotTargetX, e.gunshotTargetY);
                    else if (e.banditState === 'SEARCH') facingAngle = Phaser.Math.Angle.Between(e.x, e.y, e.lastKnownPlayerX, e.lastKnownPlayerY);
                    else facingAngle = e.patrolDirection;
                    const alpha = e.banditState === 'HUNT' ? 0.3 : 0.2;
                    this.walkerVisionGraphics.fillStyle(0x0088ff, alpha);
                    this.walkerVisionGraphics.slice(e.x, e.y, bcfg.PERCEPTION_RADIUS, facingAngle - bcfg.VISION_ANGLE, facingAngle + bcfg.VISION_ANGLE);
                    this.walkerVisionGraphics.fill();
                    this.walkerVisionGraphics.lineStyle(2, 0xffaa00, 0.8);
                    this.walkerVisionGraphics.strokeCircle(e.x, e.y, bcfg.CLOSE_AGGRO_RADIUS || 100);
                    this.walkerVisionGraphics.lineStyle(2, 0x00aaff, 0.7);
                    this.walkerVisionGraphics.strokeCircle(e.x, e.y, bcfg.SOUND_RADIUS || 200);
                }
                // Leapers drawn on leaperVisionGraphics only (below)
            });
        }
        
        // Leaper perception visuals: blind, sound-only. Cone = direction only. Red = leap trigger. Double blue = hearing.
        if (this.leaperVisionGraphics) {
            this.leaperVisionGraphics.clear();
            const wcfg = CONFIG.ENEMIES.WALKER;
            const lcfg = CONFIG.ENEMIES.LEAPER;
            const soundR = lcfg.SOUND_RADIUS != null ? lcfg.SOUND_RADIUS : 180;
            const hearR = lcfg.HEARING_RADIUS != null ? lcfg.HEARING_RADIUS : 626;
            const leapR = lcfg.LEAP_TRIGGER_RADIUS != null ? lcfg.LEAP_TRIGGER_RADIUS : 180;
            this.enemies.getChildren().forEach(e => {
                if (!e.active || e.enemyType !== 'leaper') return;
                let facingAngle = e.leaperFacingAngle != null ? e.leaperFacingAngle : 0;
                if (e.state === 'GUNSHOT_ALERT' && e.gunshotTargetX != null) facingAngle = Phaser.Math.Angle.Between(e.x, e.y, e.gunshotTargetX, e.gunshotTargetY);
                else if (e.state === 'CHASE' && e.lastHeardX != null) facingAngle = Phaser.Math.Angle.Between(e.x, e.y, e.lastHeardX, e.lastHeardY);
                this.leaperVisionGraphics.fillStyle(0xff0000, 0.2);
                this.leaperVisionGraphics.slice(e.x, e.y, wcfg.PERCEPTION_RADIUS, facingAngle - wcfg.VISION_ANGLE, facingAngle + wcfg.VISION_ANGLE);
                this.leaperVisionGraphics.fill();
                this.leaperVisionGraphics.lineStyle(2, 0xff0000, 0.95);
                this.leaperVisionGraphics.strokeCircle(e.x, e.y, leapR);
                this.leaperVisionGraphics.lineStyle(2, 0x0088ff, 0.7);
                this.leaperVisionGraphics.strokeCircle(e.x, e.y, soundR);
                this.leaperVisionGraphics.lineStyle(2, 0x0088ff, 0.5);
                this.leaperVisionGraphics.strokeCircle(e.x, e.y, hearR);
            });
        }
        
        // Update stealth mechanics for Cemetery level
        if (this.isStealthLevel && !this.stealthAlerted) {
            this.updateStealthMechanics(time, delta);
        }
        
        // Update patrol enemies
        if (this.patrolEnemies) {
            this.updatePatrolEnemies(time, delta);
        }
        
        // Update risk room exit label when enemies cleared
        if (this.inRiskRoom && this.riskRoomExitLabel && this.enemies.countActive() === 0) {
            if (this.riskRoomExitLabel.text !== '🚪 EXIT READY!') {
                this.riskRoomExitLabel.setText('🚪 EXIT READY!');
                this.riskRoomExitLabel.setFill('#00ff00');
                this.showFloatingText(400, 300, "ROOM CLEARED! Exit when ready.", 0x00ff00);
            }
        }

        // Update lighting (with safety check for scene transitions)
        if (this.lightShape && this.lightShape.scene) {
            this.lightShape.clear();
            const armor = this.playerStats.armor || {};
            const headsetEquipped = (armor.head && armor.head.itemId === 'headset') || (armor.ears && armor.ears.itemId === 'headset');
            const baseRadius = CONFIG.PLAYER.LIGHT_RADIUS;
            this.lightShape.fillStyle(0xffffff, 1);
            this.lightShape.fillCircle(this.player.x, this.player.y, baseRadius);
            // Headset: sound-oriented — no alpha ring; blue outlines for enemies in sound radius (similar to leaper gunshot hearing, doubled so you see them before they jump)
            if (headsetEquipped) {
                const soundRadius = (CONFIG.ENEMIES.LEAPER && CONFIG.ENEMIES.LEAPER.SOUND_RADIUS) ? CONFIG.ENEMIES.LEAPER.SOUND_RADIUS * 2 : baseRadius * 4;  // 360 or 240
                this.headsetSoundOutlines.clear();
                this.headsetSoundOutlines.lineStyle(2, 0x0088ff, 1);
                this.enemies.getChildren().forEach(e => {
                    if (!e.active) return;
                    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
                    if (dist <= soundRadius) {
                        this.headsetSoundOutlines.strokeCircle(e.x, e.y, 18);
                    }
                });
                this.headsetSoundOutlines.setVisible(true);
            } else {
                if (this.headsetSoundOutlines) {
                    this.headsetSoundOutlines.clear();
                    this.headsetSoundOutlines.setVisible(false);
                }
            }
            if (this.playerStats.hasFlashlight && this.flashlightOn) {
                const flashRange = this.hasNoGoodArms() ? CONFIG.PLAYER.FLASHLIGHT_RANGE * 0.4 : CONFIG.PLAYER.FLASHLIGHT_RANGE;
                const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.input.activePointer.x, this.input.activePointer.y);
                this.lightShape.fillStyle(0xffffff);
                this.lightShape.slice(this.player.x, this.player.y, flashRange, angle - CONFIG.PLAYER.FLASHLIGHT_ANGLE, angle + CONFIG.PLAYER.FLASHLIGHT_ANGLE);
                this.lightShape.fill();
                this.enemies.getChildren().forEach(e => {
                    if (!e.active) return;
                    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
                    if (dist > flashRange) return;
                    if (!this.hasLineOfSight(this.player.x, this.player.y, e.x, e.y)) return;
                    const angleToEnemy = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
                    let diff = angleToEnemy - angle;
                    while (diff > Math.PI) diff -= 2 * Math.PI;
                    while (diff < -Math.PI) diff += 2 * Math.PI;
                    if (Math.abs(diff) > CONFIG.PLAYER.FLASHLIGHT_ANGLE) return;
                    if (e.enemyType === 'walker' && e.walkerState) {
                        e.walkerState = 'HUNT';
                        e.lastKnownPlayerX = this.player.x;
                        e.lastKnownPlayerY = this.player.y;
                        e.walkerFacingAngle = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y);
                        e.goAroundEndTime = 0;
                        e.wallStuckTimer = 0;
                    }
                });
            }
        }

        // Auto-recover if pinned enemy dies
        if (this.isPinned) {
            if (!this.pinnedBy || !this.pinnedBy.active) {
                this.recoverFromKnockdown();
            } else {
                this.pinnedBy.setPosition(this.player.x, this.player.y);
                if (Phaser.Input.Keyboard.JustDown(this.keys.space) && !this.hasBothArmsBlacked()) this.recoverFromKnockdown();
                else if (Phaser.Input.Keyboard.JustDown(this.keys.space) && this.hasBothArmsBlacked()) this.showFloatingText(this.player.x, this.player.y - 50, "ARMS DESTROYED - CAN'T BREAK FREE", 0xff0000);
                else {
                    const cfg = CONFIG.ENEMIES.LEAPER;
                    const interval = cfg.PIN_DAMAGE_INTERVAL_MS != null ? cfg.PIN_DAMAGE_INTERVAL_MS : 1000;
                    const now = this.time.now;
                    if (now - this.lastPinDamageTime >= interval) {
                        this.lastPinDamageTime = now;
                        const maxHp = this.playerStats.maxHp;
                        const pct = (this.pinHitCount || 0) < (cfg.PIN_DAMAGE_FIRST_HITS != null ? cfg.PIN_DAMAGE_FIRST_HITS : 3)
                            ? (cfg.PIN_DAMAGE_FIRST_PCT != null ? cfg.PIN_DAMAGE_FIRST_PCT : 0.1)
                            : (cfg.PIN_DAMAGE_AFTER_PCT != null ? cfg.PIN_DAMAGE_AFTER_PCT : 0.2);
                        const damage = Math.max(1, Math.ceil(maxHp * pct));
                        this.hitPlayer(damage, this.pinnedBy.x, this.pinnedBy.y, { fromPin: true });
                        this.pinHitCount = (this.pinHitCount || 0) + 1;
                    }
                }
            }
            return;
        }

        // Leaper pinning bandit: same DoT as player pin (tear into them)
        const cfgLeaper = CONFIG.ENEMIES.LEAPER;
        this.enemies.getChildren().forEach(e => {
            if (!e.active || e.enemyType !== 'leaper' || e.state !== 'PINNING' || !e.pinnedTarget) return;
            const bandit = e.pinnedTarget;
            if (!bandit.active || bandit.enemyType !== 'bandit') {
                if (bandit.pinnedByLeaper === e) bandit.pinnedByLeaper = null;
                e.pinnedTarget = null;
                e.state = 'COOLDOWN';
                e.leapTimer = cfgLeaper.COOLDOWN_TIME;
                return;
            }
            const interval = cfgLeaper.PIN_DAMAGE_INTERVAL_MS != null ? cfgLeaper.PIN_DAMAGE_INTERVAL_MS : 1000;
            const now = this.time.now;
            if (now - (e.lastPinDamageTime || 0) >= interval) {
                e.lastPinDamageTime = now;
                const pct = (e.pinHitCount || 0) < (cfgLeaper.PIN_DAMAGE_FIRST_HITS != null ? cfgLeaper.PIN_DAMAGE_FIRST_HITS : 3)
                    ? (cfgLeaper.PIN_DAMAGE_FIRST_PCT != null ? cfgLeaper.PIN_DAMAGE_FIRST_PCT : 0.1)
                    : (cfgLeaper.PIN_DAMAGE_AFTER_PCT != null ? cfgLeaper.PIN_DAMAGE_AFTER_PCT : 0.2);
                const damage = Math.max(1, Math.ceil(bandit.maxHp * pct)) * 2; // Leaper double damage to bandits
                bandit.takeDamage(damage, 'melee', e.x, e.y);
                e.pinHitCount = (e.pinHitCount || 0) + 1;
                if (bandit.hp <= 0 || !bandit.active) {
                    bandit.pinnedByLeaper = null;
                    e.pinnedTarget = null;
                    e.state = 'COOLDOWN';
                    e.leapTimer = cfgLeaper.COOLDOWN_TIME;
                }
            }
        });

        // Dodge roll (SPACE when not pinned)
        if (Phaser.Input.Keyboard.JustDown(this.keys.space) && !this.isDodging) {
            this.performDodgeRoll();
        }
        
        // Reload (R key)
        if (Phaser.Input.Keyboard.JustDown(this.keys.reload)) {
            this.startReload();
        }
        
        // Grenade (G key)
        if (Phaser.Input.Keyboard.JustDown(this.keys.grenade)) {
            this.throwGrenade();
        }
        
        // Consumables (1, 2, 3 keys)
        if (Phaser.Input.Keyboard.JustDown(this.keys.consumable1)) {
            this.useConsumable(0);
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.consumable2)) {
            this.useConsumable(1);
        }
        if (Phaser.Input.Keyboard.JustDown(this.keys.consumable3)) {
            this.useConsumable(2);
        }

        if (Phaser.Input.Keyboard.JustDown(this.keys.crouch)) {
            this.isCrouching = !this.isCrouching;
        }

        if (!this.isOpening && !this.debrisBurning && !this.isDodging) {
            this.player.setVelocity(0);
            const limbHp = this.playerStats.limbHp;
            const leftLegBlacked = limbHp && limbHp.leftLeg && (limbHp.leftLeg.hp || 0) === 0;
            const rightLegBlacked = limbHp && limbHp.rightLeg && (limbHp.rightLeg.hp || 0) === 0;
            const bothLegsBlacked = leftLegBlacked && rightLegBlacked;
            const oneLegBlacked = (leftLegBlacked && !rightLegBlacked) || (!leftLegBlacked && rightLegBlacked);
            const legBroken = (id) => limbHp && limbHp[id] && Array.isArray(limbHp[id].effects) && limbHp[id].effects.includes('break');
            const bothLegsBroken = legBroken('leftLeg') && legBroken('rightLeg');
            const oneLegBroken = legBroken('leftLeg') || legBroken('rightLeg');

            let speed = CONFIG.PLAYER.WALK_SPEED * this.speedMultiplier;

            if (this.isCrouching) {
                speed = CONFIG.PLAYER.CROUCH_SPEED * this.speedMultiplier;
            } else if ((this.cursors.shift.isDown || this.wasd.SHIFT.isDown) && this.playerStats.stamina > 0 && !oneLegBlacked && !bothLegsBlacked) {
                speed = CONFIG.PLAYER.SPRINT_SPEED * this.speedMultiplier;
                this.playerStats.stamina -= CONFIG.PLAYER.STAMINA_DRAIN;
            } else if (this.playerStats.stamina < this.playerStats.maxStamina) {
                this.playerStats.stamina += CONFIG.PLAYER.STAMINA_REGEN;
            }

            let vx = 0, vy = 0;
            if (!bothLegsBlacked) {
                if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -1;
                else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = 1;
                if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -1;
                else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = 1;
            }

            if (oneLegBlacked) {
                speed = CONFIG.PLAYER.WALK_SPEED * 0.2 * this.speedMultiplier;
            } else if (!this.isCrouching && oneLegBroken) {
                if (bothLegsBroken) speed *= 0.35;
                else speed *= 0.5;
            }

            const wasSprintBeforeBreak = !this.isCrouching && !oneLegBlacked && (this.cursors.shift.isDown || this.wasd.SHIFT.isDown) && this.playerStats.stamina > 0;

            if (vx !== 0 || vy !== 0) {
                const len = Math.sqrt(vx * vx + vy * vy);
                this.player.setVelocity((vx / len) * speed, (vy / len) * speed);
                if (!this.silentFootsteps && !this.isCrouching) {
                    const isRunning = wasSprintBeforeBreak && !oneLegBlacked;
                    const isLimping = oneLegBlacked || oneLegBroken;
                    const stepInterval = isLimping ? 420 : (250 / (isRunning ? 1.5 : 1));
                    if (this.time.now - (this.lastPlayerFootstepTime || 0) >= stepInterval) {
                        this.lastPlayerFootstepTime = this.time.now;
                        if (isLimping) sfx.limpFootstep();
                        else sfx.footstep(this.time.now, isRunning);
                        this.onPlayerFootstep(this.player.x, this.player.y);
                        const damagePerStepWalk = 1, damagePerStepSprint = 3;
                        if (limbHp) {
                            // Break damage only to broken leg(s); no black-limb spread to rest of body
                            ['leftLeg', 'rightLeg'].forEach(legId => {
                                if (!legBroken(legId)) return;
                                const leg = limbHp[legId];
                                if (!leg || (leg.hp || 0) <= 0) return;
                                const dmg = isRunning ? damagePerStepSprint : damagePerStepWalk;
                                leg.hp = Math.max(0, (leg.hp || 0) - dmg);
                                if (leg.hp === 0 && Array.isArray(leg.effects) && !leg.effects.includes('trauma')) leg.effects.push('trauma');
                            });
                            this.playerStats.hp = sumLimbHp(limbHp);
                            this.playerStats.maxHp = sumLimbMaxHp(limbHp);
                        }
                    }
                }
            }

            if (Phaser.Input.Keyboard.JustDown(this.keys.melee)) this.meleeAttack();
            if (Phaser.Input.Keyboard.JustDown(this.keys.switch)) this.switchWeapon();
            if (Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
                if (this.currentLevel === 2 && this.checkDebris()) return;
                if ((this.currentLevel === 5 || this.currentLevel === 7) && this.checkSwitch()) return;
                if (this.checkDoor()) return;
                this.tryInteract();
            }
        } else if (!this.isDodging) {
            this.player.setVelocity(0);
            if (this.openTimerEvent) {
                const p = this.openTimerEvent.getProgress();
                this.uiGraphics.fillStyle(this.debrisBurning ? 0xff4500 : 0xffff00, 1);
                this.uiGraphics.fillRect(this.player.x - 20, this.player.y - 30, 40 * p, 6);
            }
        }
    }

    switchWeapon(direction = 1) {
        this.cancelReload(); // Cancel reload when switching
        
        const bothArmsBroken = this.hasNoGoodArms();
        const oneArmBlacked = this.hasOneArmBlacked();
        // Only weapons in slots are usable. Both arms broken / one arm blacked = pistol only (if in sidearm).
        const slotted = this.getSlottedWeaponList();
        const weapons = (bothArmsBroken || oneArmBlacked)
            ? (slotted.includes('pistol') ? ['pistol'] : [])
            : slotted;
        
        if (weapons.length <= 1) return;
        
        const currentIdx = weapons.indexOf(this.playerStats.currentWeapon);
        let nextIdx = currentIdx + direction;
        if (nextIdx < 0) nextIdx = weapons.length - 1;
        if (nextIdx >= weapons.length) nextIdx = 0;
        this.playerStats.currentWeapon = weapons[nextIdx];
        
        this.showFloatingText(this.player.x, this.player.y - 40, this.playerStats.currentWeapon.toUpperCase(), 0xffffff);
        sfx.weaponSwap();
    }

    meleeAttack() {
        if (this.isMeleeAttacking) return;
        if (this.hasBothArmsBlacked()) {
            this.showFloatingText(this.player.x, this.player.y - 40, "ARMS DESTROYED - CAN'T MELEE", 0xff0000);
            return;
        }
        this.isMeleeAttacking = true;
        this.cancelReload();
        sfx.melee();

        const slash = this.add.sprite(this.player.x, this.player.y, 'slash').setTint(0xffffff).setDepth(20);
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.input.activePointer.x, this.input.activePointer.y);
        slash.setRotation(angle);
        const vec = this.physics.velocityFromRotation(angle, 40);
        slash.setPosition(this.player.x + vec.x, this.player.y + vec.y);

        this.tweens.add({ targets: slash, alpha: 0, duration: 200, onComplete: () => slash.destroy() });

        // Calculate melee damage with permanent boost
        let meleeDamage = CONFIG.PLAYER.MELEE_DAMAGE;
        if (this.permanentDamageBoost > 1) {
            meleeDamage = Math.ceil(meleeDamage * this.permanentDamageBoost);
        }
        // Apply Last Stand skill (+50% damage when below 25% HP)
        if (this.lastStandBonus > 0 && this.playerStats.hp / this.playerStats.maxHp <= this.lastStandThreshold) {
            meleeDamage = Math.ceil(meleeDamage * (1 + this.lastStandBonus));
        }
        const limbHpMelee = this.playerStats.limbHp;
        if (limbHpMelee && (limbHasBreak(limbHpMelee, 'leftArm') || limbHasBreak(limbHpMelee, 'rightArm'))) meleeDamage = Math.max(1, Math.floor(meleeDamage * 0.5));
        
        this.enemies.getChildren().forEach(e => {
            if (!e.active || e.isCorpse) return;
            if (Phaser.Math.Distance.Between(slash.x, slash.y, e.x, e.y) < CONFIG.PLAYER.MELEE_RANGE) {
                if (e.enemyType === 'boss') {
                    if (!e.isInvulnerable) e.takeDamage(meleeDamage, 'melee', this.player.x, this.player.y);
                } else if (e.takeDamage) {
                    e.takeDamage(meleeDamage, 'melee', this.player.x, this.player.y);
                }
            }
        });

        this.time.delayedCall(CONFIG.PLAYER.MELEE_COOLDOWN, () => { this.isMeleeAttacking = false; });
    }

    fireBullet(pointer) {
        if (this.isOpening || this.isPaused || this.isInventoryOpen || this.isReloading || this.isDodging) return;
        if (this.isPinned) return; // Leaper pin: only knockback (space), no shooting
        if (this.hasBothArmsBlacked()) {
            this.showFloatingText(this.player.x, this.player.y - 40, "ARMS DESTROYED - CAN'T SHOOT", 0xff0000);
            return;
        }
        this.ensureCurrentWeaponInSlots();
        const slotted = this.getSlottedWeaponList();
        if (!slotted.length || !slotted.includes(this.playerStats.currentWeapon)) {
            this.showFloatingText(this.player.x, this.player.y - 40, "EQUIP WEAPON IN SLOT", 0xff6600);
            return;
        }

        const weapon = this.playerStats.currentWeapon;
        const limbHpFire = this.playerStats.limbHp;
        const armBroken = limbHpFire && (limbHasBreak(limbHpFire, 'leftArm') || limbHasBreak(limbHpFire, 'rightArm'));
        const twoHanded = ['shotgun', 'smg', 'crossbow', 'rifle'].includes(weapon);
        // Both arms broken: force pistol; one arm blacked: no two-handed; one arm broken: can use all (1 dmg to broken arm when two-handed)
        if (this.hasOneArmBlacked() && twoHanded) {
            this.playerStats.currentWeapon = 'pistol';
            this.showFloatingText(this.player.x, this.player.y - 40, "ONE ARM DESTROYED - SIDEARM", 0xff6600);
            return;
        }
        if (this.hasNoGoodArms() && twoHanded) {
            this.playerStats.currentWeapon = 'pistol';
            this.showFloatingText(this.player.x, this.player.y - 40, "BOTH ARMS BROKEN - SIDEARM", 0xff6600);
            return;
        }
        const wpnConfig = CONFIG.WEAPONS[weapon.toUpperCase()];
        const magWeapons = ['pistol', 'smg', 'rifle'];
        const currentMag = magWeapons.includes(weapon)
            ? ((getEquippedMag(this.playerStats, weapon) || {}).rounds ?? 0)
            : this.playerStats.magazines[weapon];
        
        // Check magazine
        if (currentMag <= 0) {
            sfx.empty();
            if (magWeapons.includes(weapon)) this.showFloatingText(this.player.x, this.player.y - 40, "Empty click... empty.", 0xffaa00);
            this.startReload();
            return;
        }
        
        // Check ammo cost
        if (weapon === 'shotgun' && currentMag < wpnConfig.AMMO_COST) {
            sfx.empty();
            this.startReload();
            return;
        }

        const now = this.time.now;
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y);
        
        // Get mod effects for current weapon
        const modEffects = this.weaponModEffects?.[weapon] || { 
            fireRateMultiplier: 1, damageMultiplier: 1, spreadMultiplier: 1, isSilent: false 
        };
        // Calculate effective fire rate (lower multiplier = faster, but we use it as divisor)
        // Positive fireRate bonus = faster shots, so we divide by (1 + bonus)
        // Negative fireRate (from damage barrel) = slower shots
        const effectiveFireRate = Math.max(50, wpnConfig.FIRE_RATE / Math.max(0.5, 1 + modEffects.fireRateMultiplier - 1));

        if (weapon === 'shotgun') {
            if (now - this.lastFired < effectiveFireRate) return;

            if (!modEffects.isSilent) {
                sfx.shootShotgun();
                this.particles.spawnMuzzleFlash(this.player.x, this.player.y, angle, 1.5, this.muzzleFlashColor);
                this.onUnsuppressedGunshot(this.player.x, this.player.y);
            }
            let pelletsShot = 0;
            const spreadMod = modEffects.spreadMultiplier;
            for (let i = -10; i <= 10; i += wpnConfig.SPREAD_STEP) {
                const b = this.bullets.get(this.player.x, this.player.y);
                if (b) { 
                    b.fire(this.player.x, this.player.y, pointer.x, pointer.y, Math.round(i * spreadMod), false); 
                    b.modDamageMultiplier = modEffects.damageMultiplier;
                    b.isSilent = modEffects.isSilent;
                    pelletsShot++; 
                }
            }
            this.playerStats.magazines[weapon] -= wpnConfig.AMMO_COST;
            this.lastFired = now;
            this.applyFireJuice(weapon, angle, modEffects.isSilent);
            this.persistent.runShotsFired++;
            this.persistent.totalShotsFired++;
            if (this.hasNoGoodArms()) this.applyArmPenaltyDamage();
            else if (armBroken) this.applyOneArmBrokenFireDamage();
        } else if (weapon === 'smg') {
            if (now - this.lastFired < effectiveFireRate) return;

            if (!modEffects.isSilent) {
                sfx.shootSMG();
                this.particles.spawnMuzzleFlash(this.player.x, this.player.y, angle, 0.6, this.muzzleFlashColor);
                this.onUnsuppressedGunshot(this.player.x, this.player.y);
            }
            const smgSpread = Math.round(wpnConfig.SPREAD * modEffects.spreadMultiplier);
            const spread = Phaser.Math.Between(-smgSpread, smgSpread);
            const b = this.bullets.get(this.player.x, this.player.y);
            if (b) {
                b.fire(this.player.x, this.player.y, pointer.x, pointer.y, spread, false);
                b.modDamageMultiplier = modEffects.damageMultiplier;
                b.isSilent = modEffects.isSilent;
            }
            const emSmg = getEquippedMag(this.playerStats, 'smg');
            if (emSmg) emSmg.rounds = Math.max(0, (emSmg.rounds || 0) - wpnConfig.AMMO_COST);
            this.lastFired = now;
            this.applyFireJuice(weapon, angle, modEffects.isSilent);
            this.persistent.runShotsFired++;
            this.persistent.totalShotsFired++;
            if (this.hasNoGoodArms()) this.applyArmPenaltyDamage();
            else if (armBroken) this.applyOneArmBrokenFireDamage();
        } else if (weapon === 'crossbow') {
            // Crossbow - Silent, piercing, high damage
            if (now - this.lastFired < effectiveFireRate) return;

            sfx.shootCrossbow();
            // No muzzle flash for crossbow - it's silent
            
            const b = this.bullets.get(this.player.x, this.player.y);
            if (b) {
                b.fire(this.player.x, this.player.y, pointer.x, pointer.y, 0, false);
                b.setTint(0x8B4513); // Brown bolt color
                b.isPiercing = true; // Mark as piercing
                b.isSilent = true;   // Mark as silent (won't aggro enemies)
                b.crossbowDamage = wpnConfig.DAMAGE; // Store crossbow's high damage
                b.modDamageMultiplier = modEffects.damageMultiplier;
            }
            this.playerStats.magazines[weapon] -= wpnConfig.AMMO_COST;
            this.lastFired = now;
            this.applyFireJuice(weapon, angle, true);
            this.persistent.runShotsFired++;
            this.persistent.totalShotsFired++;
            if (this.hasNoGoodArms()) this.applyArmPenaltyDamage();
            else if (armBroken) this.applyOneArmBrokenFireDamage();
            this.startReload();
        } else if (weapon === 'rifle') {
            // Assault Rifle - Accurate, medium fire rate
            if (now - this.lastFired < effectiveFireRate) return;

            if (!modEffects.isSilent) {
                sfx.shootRifle();
                this.particles.spawnMuzzleFlash(this.player.x, this.player.y, angle, 1.2, this.muzzleFlashColor);
                this.onUnsuppressedGunshot(this.player.x, this.player.y);
            }
            // First shot accuracy bonus when stationary
            const rifleSpread = Math.round(wpnConfig.SPREAD * modEffects.spreadMultiplier);
            let spread = Phaser.Math.Between(-rifleSpread, rifleSpread);
            if (wpnConfig.FIRST_SHOT_BONUS && this.player.body.velocity.length() < 10) {
                spread = 0; // Perfect accuracy when stationary
            }
            
            const b = this.bullets.get(this.player.x, this.player.y);
            if (b) {
                b.fire(this.player.x, this.player.y, pointer.x, pointer.y, spread, false);
                b.rifleDamage = wpnConfig.DAMAGE; // Store rifle's damage multiplier
                b.modDamageMultiplier = modEffects.damageMultiplier;
                b.isSilent = modEffects.isSilent;
            }
            const emRifle = getEquippedMag(this.playerStats, 'rifle');
            if (emRifle) emRifle.rounds = Math.max(0, (emRifle.rounds || 0) - wpnConfig.AMMO_COST);
            this.lastFired = now;
            this.applyFireJuice(weapon, angle, modEffects.isSilent);
            this.persistent.runShotsFired++;
            this.persistent.totalShotsFired++;
            if (this.hasNoGoodArms()) this.applyArmPenaltyDamage();
            else if (armBroken) this.applyOneArmBrokenFireDamage();
        } else {
            // Pistol
            if (now - this.lastFired < effectiveFireRate) return;

            if (!modEffects.isSilent) {
                sfx.shootPistol();
                this.particles.spawnMuzzleFlash(this.player.x, this.player.y, angle, 1, this.muzzleFlashColor);
                this.onUnsuppressedGunshot(this.player.x, this.player.y);
            }
            const pistolSpread = Math.round(wpnConfig.SPREAD * modEffects.spreadMultiplier);
            const b = this.bullets.get(this.player.x, this.player.y);
            if (b) {
                b.fire(this.player.x, this.player.y, pointer.x, pointer.y, pistolSpread, false);
                b.modDamageMultiplier = modEffects.damageMultiplier;
                b.isSilent = modEffects.isSilent;
            }
            const emPistol = getEquippedMag(this.playerStats, 'pistol');
            if (emPistol) emPistol.rounds = Math.max(0, (emPistol.rounds || 0) - wpnConfig.AMMO_COST);
            this.lastFired = now;
            this.applyFireJuice(weapon, angle, modEffects.isSilent);
            this.persistent.runShotsFired++;
            this.persistent.totalShotsFired++;
            if (this.hasNoGoodArms()) this.applyArmPenaltyDamage();
        }
    }

    applyArmPenaltyDamage() {
        this.hitPlayer(1, this.player.x, this.player.y, { armPenalty: true });
    }

    // One arm broken + firing two-handed: 1 damage to the broken limb(s) only
    applyOneArmBrokenFireDamage() {
        const limbHp = this.playerStats.limbHp;
        if (!limbHp) return;
        let didDamage = false;
        ['leftArm', 'rightArm'].forEach(armId => {
            if (!limbHasBreak(limbHp, armId)) return;
            const arm = limbHp[armId];
            if (!arm || (arm.hp || 0) <= 0) return;
            arm.hp = Math.max(0, (arm.hp || 0) - 1);
            if (arm.hp === 0 && Array.isArray(arm.effects) && !arm.effects.includes('trauma')) arm.effects.push('trauma');
            didDamage = true;
            this.logDamageEntry({ damage: 1, limbId: armId, mitigated: false });
        });
        if (didDamage) {
            this.playerStats.hp = sumLimbHp(limbHp);
            this.persistent.runDamageTaken += 1;
            this.levelDamageTaken += 1;
            sfx.playerHurt();
            if (this.gameSettings.screenShake) this.cameras.main.shake(100, 0.01);
            this.player.setAlpha(0.5);
            this.player.setTint(0xff0000);
            this.time.delayedCall(100, () => { if (this.player.active) this.player.clearTint(); });
            this.time.delayedCall(CONFIG.PLAYER.INVULN_TIME, () => this.player.setAlpha(1));
            this.checkDeathConditions();
        }
    }

    // Both arms broken: every action (reload, open, loot, door, grenade, use item) = 1 damage to each arm
    applyBothArmsActionDamage() {
        const limbHp = this.playerStats.limbHp;
        if (!limbHp || !limbHp.leftArm || !limbHp.rightArm) return;
        let total = 0;
        ['leftArm', 'rightArm'].forEach(armId => {
            const arm = limbHp[armId];
            if (arm && (arm.hp || 0) > 0) {
                const take = Math.min(1, arm.hp || 0);
                arm.hp = Math.max(0, (arm.hp || 0) - take);
                if (arm.hp === 0 && Array.isArray(arm.effects) && !arm.effects.includes('trauma')) arm.effects.push('trauma');
                total += take;
                if (take > 0) this.logDamageEntry({ damage: take, limbId: armId, mitigated: false });
            }
        });
        if (total > 0) {
            this.playerStats.hp = sumLimbHp(limbHp);
            this.persistent.runDamageTaken += total;
            this.levelDamageTaken += total;
            sfx.playerHurt();
            if (this.gameSettings.screenShake) this.cameras.main.shake(100, 0.01);
            this.player.setAlpha(0.5);
            this.player.setTint(0xff0000);
            this.time.delayedCall(100, () => { if (this.player.active) this.player.clearTint(); });
            this.time.delayedCall(CONFIG.PLAYER.INVULN_TIME, () => this.player.setAlpha(1));
            this.checkDeathConditions();
        }
    }

    /** Push a damage log entry (damage + limb or ARMOR). Cap at 12 entries. Toggle visibility with backtick key. */
    logDamageEntry(entry) {
        if (!this.damageLog) return;
        this.damageLog.push(entry);
        const maxEntries = (CONFIG.UI && CONFIG.UI.DAMAGE_LOG_MAX_ENTRIES != null) ? CONFIG.UI.DAMAGE_LOG_MAX_ENTRIES : 12;
        if (this.damageLog.length > maxEntries) this.damageLog.shift();
        // Teach limbs: flash the hit body part on the HUD silhouette
        if (entry && !entry.mitigated && entry.limbId && entry.limbId !== 'hp' && this.time) {
            this.limbHudFlash = {
                limbId: entry.limbId,
                until: this.time.now + ((CONFIG.LIMB_VIS && CONFIG.LIMB_VIS.HUD_FLASH_MS) || 380)
            };
        }
    }

    hitPlayer(damage, fromX = null, fromY = null, options = {}) {
        const allowWhenPinned = options.fromPin === true;
        const armPenalty = options.armPenalty === true;
        const bodyOnly = options.bodyOnly === true;
        const bypassArmor = options.bypassArmor === true;
        const fromBleed = options.fromBleed === true;
        const damageSource = options.damageSource || null;
        let targetLimbId = options.targetLimbId || null;
        if (!allowWhenPinned && !armPenalty && !bodyOnly && !fromBleed && (this.player.alpha < 1 || this.isPinned || this.isDodging)) return;

        // Apply skill damage reduction (Thick Skin / Iron Will)
        if (this.skillDamageReduction > 0) {
            damage = Math.max(1, Math.ceil(damage * (1 - this.skillDamageReduction)));
        }

        // Track damage for stats
        this.persistent.runDamageTaken += damage;
        this.levelDamageTaken += damage;
        
        // Show hit direction indicator if we have source position
        if (fromX !== null && fromY !== null) {
            this.hitIndicators.showHit(fromX, fromY, this.player.x, this.player.y);
        }

        let mitigated = false;
        if (!armPenalty && !bodyOnly && !bypassArmor && !fromBleed) {
            const attacker = options.meleeAttacker;
            const armorBlocksFromThisAttacker = (attacker && attacker.armorBlocksAgainstPlayer) || 0;
            const isZombie = attacker && attacker.enemyType !== 'bandit';
            const runArmorCheck = () => {
                const slots = ['body', 'head', 'arms', 'feet'];
                for (let slot of slots) {
                    if (this.playerStats.armor[slot] && this.playerStats.armor[slot].durability > 0) {
                        this.playerStats.armor[slot].durability--;
                        this.showFloatingText(this.player.x, this.player.y - 20, "BLOCKED!", 0x00ffff);
                        if (this.playerStats.armor[slot].durability <= 0) {
                            this.playerStats.armor[slot] = null;
                            this.showFloatingText(this.player.x, this.player.y - 40, "ARMOR BROKE!", 0xff0000);
                        }
                        mitigated = true;
                        this.logDamageEntry({ mitigated: true });
                        if (attacker) attacker.armorBlocksAgainstPlayer = armorBlocksFromThisAttacker + 1;
                        break;
                    }
                }
            };
            if (attacker && armorBlocksFromThisAttacker >= 2) {
                attacker.meleeHitsSinceSecondBlock = (attacker.meleeHitsSinceSecondBlock || 0) + 1;
                if (attacker.meleeHitsSinceSecondBlock % 2 === 1) {
                    // Odd (hit 3, 5, 7…): go for soft targets. Zombies = arms; bandits = arms + legs
                    const softPool = attacker.enemyType === 'bandit'
                        ? ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']
                        : ['leftArm', 'rightArm'];
                    const withHp = softPool.filter(id => this.playerStats.limbHp && this.playerStats.limbHp[id] && (this.playerStats.limbHp[id].hp || 0) > 0);
                    const pool = withHp.length > 0 ? withHp : softPool;
                    options.forceTargetLimbId = pickOneLimbByWeight(pool);
                } else {
                    // Even (hit 4, 6, 8…): try armor again
                    runArmorCheck();
                }
            } else {
                runArmorCheck();
            }
        }

        if (!mitigated) {
            if (!fromBleed) sfx.playerHurt();
            if (this.playerStats.limbHp) {
                // Single-limb path when source context is present: one limb per hit, size-weighted if not specified
                if (damageSource && !armPenalty && !bodyOnly && !fromBleed) {
                    if (options.forceTargetLimbId && this.playerStats.limbHp[options.forceTargetLimbId] != null) {
                        targetLimbId = options.forceTargetLimbId;
                    } else if (!targetLimbId || this.playerStats.limbHp[targetLimbId] == null) {
                        // Melee: stance-based limb pools (Phase 2). Upright = arms/chest/head; on-all-fours = legs/abdomen. Sticky zone within stance.
                        if (damageSource === 'melee' && (options.meleeAttacker || options.enemyType)) {
                            const enemyType = options.enemyType || (options.meleeAttacker && options.meleeAttacker.enemyType);
                            const stance = (enemyType && MELEE_STANCE_BY_ENEMY[enemyType]) ? MELEE_STANCE_BY_ENEMY[enemyType] : 'upright';
                            let stancePool = MELEE_LIMB_POOLS[stance];
                            if (!Array.isArray(stancePool) || stancePool.length === 0) stancePool = Object.keys(LIMB_MAX_HP);
                            const attacker = options.meleeAttacker;
                            let pool = stancePool;
                            if (attacker) {
                                if (!attacker.meleeTargetZone || !MELEE_TARGET_ZONES[attacker.meleeTargetZone]) {
                                    const zones = Object.keys(MELEE_ZONE_WEIGHTS);
                                    let total = 0;
                                    for (const z of zones) total += MELEE_ZONE_WEIGHTS[z] || 0;
                                    let r = Math.random() * total;
                                    for (const z of zones) {
                                        r -= MELEE_ZONE_WEIGHTS[z] || 0;
                                        if (r <= 0) { attacker.meleeTargetZone = z; break; }
                                    }
                                    if (!attacker.meleeTargetZone) attacker.meleeTargetZone = zones[0];
                                }
                                const zoneLimbs = MELEE_TARGET_ZONES[attacker.meleeTargetZone] || [];
                                const inStance = zoneLimbs.filter(id => stancePool.includes(id));
                                if (inStance.length > 0) pool = inStance;
                            }
                            const withHp = pool.filter(id => (this.playerStats.limbHp[id] && (this.playerStats.limbHp[id].hp || 0) > 0));
                            if (withHp.length > 0) pool = withHp;
                            targetLimbId = pickOneLimbByWeight(pool);
                        } else if ((damageSource === 'bullet' || damageSource === 'acid') && fromX != null && fromY != null) {
                            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, fromX, fromY);
                            const band = dist < RANGED_CLOSE_MAX ? 'close' : dist < RANGED_MEDIUM_MAX ? 'medium' : 'far';
                            let pool = RANGED_LIMB_BANDS[band];
                            if (!Array.isArray(pool) || pool.length === 0) pool = Object.keys(LIMB_MAX_HP);
                            const withHp = pool.filter(id => (this.playerStats.limbHp[id] && (this.playerStats.limbHp[id].hp || 0) > 0));
                            if (withHp.length > 0) pool = withHp;
                            targetLimbId = pickOneLimbByWeight(pool);
                        } else {
                            targetLimbId = pickOneLimbByWeight(null);
                        }
                    }
                    const limb = this.playerStats.limbHp[targetLimbId];
                    const escalationSource = options.meleeAttacker;
                    let escalationCount = 0;
                    let outcomeTable = LIMB_OUTCOME_TABLE;
                    if (escalationSource && this.limbEffectHitCount) {
                        const now = this.time.now;
                        let entry = this.limbEffectHitCount.get(escalationSource);
                        if (!escalationSource.active) { this.limbEffectHitCount.delete(escalationSource); entry = null; }
                        if (entry && (now - entry.lastHitTime) > ESCALATION_TIMEOUT_MS) entry = null;
                        escalationCount = entry ? entry.count : 0;
                        outcomeTable = outcomeTableWithEscalation(LIMB_OUTCOME_TABLE, escalationCount);
                    }
                    const outcomeSourceType = options.enemyType || (options.meleeAttacker && options.meleeAttacker.enemyType) || (damageSource === 'acid' ? 'spitter' : null);
                    outcomeTable = outcomeTableWithEnemyModifiers(outcomeTable, outcomeSourceType);
                    const outcome = rollOutcome(outcomeTable);
                    let take = 0;
                    if (outcome === 'black') {
                        take = limb.hp || 0;
                        limb.hp = 0;
                        if (Array.isArray(limb.effects) && !limb.effects.includes('trauma')) limb.effects.push('trauma');
                    } else {
                        take = Math.min(damage, limb.hp || 0);
                        limb.hp = Math.max(0, (limb.hp || 0) - take);
                        if (limb.hp === 0 && Array.isArray(limb.effects) && !limb.effects.includes('trauma')) limb.effects.push('trauma');
                        if (outcome !== 'damage_only' && Array.isArray(limb.effects)) {
                            if (outcome === 'minor_bleed' && !limb.effects.includes('minor_bleed')) limb.effects.push('minor_bleed');
                            else if (outcome === 'major_bleed' && !limb.effects.includes('major_bleed')) limb.effects.push('major_bleed');
                            else if (outcome === 'break' && !limb.effects.includes('break')) limb.effects.push('break');
                        }
                    }
                    this.playerStats.hp = sumLimbHp(this.playerStats.limbHp);
                    this.recordHitRecap({
                        limbId: targetLimbId,
                        enemyType: outcomeSourceType,
                        damageSource,
                        fromBleed: false,
                        outcome
                    });
                    if ((targetLimbId === 'chest' || targetLimbId === 'head') && limb.hp === 0) {
                        this.handlePlayerDeath({ cause: targetLimbId === 'head' ? 'HEAD DESTROYED' : 'CHEST DESTROYED', limbId: targetLimbId });
                    }
                    this.logDamageEntry({ damage: take, limbId: targetLimbId, outcome, mitigated: false });
                    if (escalationSource && escalationSource.active && this.limbEffectHitCount) {
                        const now = this.time.now;
                        this.limbEffectHitCount.set(escalationSource, { count: escalationCount + 1, lastHitTime: now });
                    }
                } else if (targetLimbId && this.playerStats.limbHp[targetLimbId] != null) {
                    const limb = this.playerStats.limbHp[targetLimbId];
                    const take = Math.min(damage, limb.hp || 0);
                    limb.hp = Math.max(0, (limb.hp || 0) - take);
                    if (limb.hp === 0 && Array.isArray(limb.effects) && !limb.effects.includes('trauma')) limb.effects.push('trauma');
                    this.playerStats.hp = sumLimbHp(this.playerStats.limbHp);
                    this.recordHitRecap({
                        limbId: targetLimbId,
                        enemyType: options.enemyType || (options.meleeAttacker && options.meleeAttacker.enemyType) || null,
                        damageSource: fromBleed ? 'bleed' : damageSource,
                        fromBleed
                    });
                    if ((targetLimbId === 'chest' || targetLimbId === 'head') && limb.hp === 0 && !fromBleed) {
                        this.handlePlayerDeath({ cause: targetLimbId === 'head' ? 'HEAD DESTROYED' : 'CHEST DESTROYED', limbId: targetLimbId });
                    }
                    this.logDamageEntry({ damage: take, limbId: targetLimbId, mitigated: false });
                } else {
                    let remaining = damage;
                    // Arm penalty: arms only; body-only (e.g. heal with both arms blacked): torso/head only
                    const limbIds = armPenalty
                        ? ['leftArm', 'rightArm']
                        : bodyOnly
                            ? ['head', 'chest', 'abdomen', 'crotch']
                            : ['head', 'leftArm', 'rightArm', 'chest', 'abdomen', 'crotch', 'leftLeg', 'rightLeg'];
                    while (remaining > 0) {
                        const withHp = limbIds.filter(id => (this.playerStats.limbHp[id].hp || 0) > 0);
                        if (withHp.length === 0) break;
                        const limbId = withHp[Math.floor(Math.random() * withHp.length)];
                        const limb = this.playerStats.limbHp[limbId];
                        const take = Math.min(remaining, limb.hp || 0);
                        limb.hp = Math.max(0, (limb.hp || 0) - take);
                        if (limb.hp === 0 && Array.isArray(limb.effects) && !limb.effects.includes('trauma')) limb.effects.push('trauma');
                        if ((limbId === 'chest' || limbId === 'head') && limb.hp === 0 && !fromBleed) this.handlePlayerDeath();
                        remaining -= take;
                        if (take > 0) this.logDamageEntry({ damage: take, limbId, mitigated: false });
                    }
                    this.playerStats.hp = sumLimbHp(this.playerStats.limbHp);
                }
            } else {
                this.playerStats.hp -= damage;
                this.logDamageEntry({ damage, limbId: 'hp', mitigated: false });
            }
            if (!fromBleed) {
                if (this.gameSettings.screenShake) this.cameras.main.shake(100, 0.01);
                this.player.setAlpha(0.5);
                this.player.setTint(0xff0000);
                this.time.delayedCall(100, () => { if (this.player.active) this.player.clearTint(); });
                this.time.delayedCall(CONFIG.PLAYER.INVULN_TIME, () => this.player.setAlpha(1));
            }

            // Bite / zombie contact → infection (not guns, not bleed ticks)
            if (!fromBleed && !armPenalty && damageSource !== 'bullet') {
                const et = options.enemyType
                    || (options.meleeAttacker && options.meleeAttacker.enemyType)
                    || (options.fromPin ? 'leaper' : null)
                    || (damageSource === 'acid' ? 'spitter' : null);
                if (et) this.applyBiteInfection(et);
            }
        }

        this.checkDeathConditions();
    }

    recordHitRecap(info) {
        if (!info) return;
        this._lastHitRecap = {
            limbId: info.limbId || null,
            enemyType: info.enemyType || null,
            damageSource: info.damageSource || null,
            fromBleed: !!info.fromBleed,
            outcome: info.outcome || null
        };
    }

    buildDeathRecap(options = {}) {
        const last = this._lastHitRecap || {};
        const limbId = options.limbId || last.limbId || null;
        let cause = options.cause || null;
        if (!cause) {
            if ((this.playerStats.infection || 0) >= 100) cause = 'INFECTION';
            else if ((this.playerStats.blood || 0) <= 0) cause = 'BLED OUT';
            else if (last.enemyType) cause = String(last.enemyType).toUpperCase();
            else if (last.fromBleed || last.damageSource === 'bleed') cause = 'BLEED';
            else if (last.damageSource) cause = String(last.damageSource).toUpperCase();
            else cause = 'UNKNOWN';
        }
        const lost = diffLostItemLabels(this.playerStats, this.checkpointStats);
        return {
            cause,
            limbLabel: limbId ? (LIMB_DISPLAY_NAMES[limbId] || limbId) : '—',
            killer: last.enemyType ? String(last.enemyType).toUpperCase() : (last.damageSource ? String(last.damageSource).toUpperCase() : '—'),
            lost: lost.slice(0, 8),
            lostMore: Math.max(0, lost.length - 8),
            level: this.currentLevel,
            insuranceNote: options.insuranceNote || null
        };
    }

    showDeathRecap(recap) {
        const depth = 2000;
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.72).setScrollFactor(0).setDepth(depth);
        const panel = this.add.rectangle(400, 300, 420, 340, 0x1a1a1a, 0.95).setStrokeStyle(2, 0xaa2222).setScrollFactor(0).setDepth(depth + 1);
        const title = this.add.text(400, 170, 'YOU DIED', {
            fontSize: '36px', fill: '#ff3333', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2);

        const lostLines = (recap.lost && recap.lost.length)
            ? recap.lost.join('\n') + (recap.lostMore ? `\n+${recap.lostMore} more` : '')
            : 'Nothing new since checkpoint';
        const insuranceLine = recap.insuranceNote ? `\n\n${recap.insuranceNote}` : '';
        const body = this.add.text(400, 305,
            `Cause: ${recap.cause}\nLimb: ${recap.limbLabel}\nSource: ${recap.killer}\nLevel: ${recap.level}\n\nLeft in the field:\n${lostLines}${insuranceLine}`,
            { fontSize: '15px', fill: '#dddddd', align: 'center', lineSpacing: 5 }
        ).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2);

        const hint = this.add.text(400, 450, 'Click or Space to continue', {
            fontSize: '14px', fill: '#888888'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2);

        this._deathRecapNodes = [overlay, panel, title, body, hint];

        // Click / Space / Enter skips the auto-restart wait
        const skip = () => this.continueAfterDeathRecap();
        overlay.setInteractive({ useHandCursor: true });
        overlay.on('pointerdown', skip);
        panel.setInteractive({ useHandCursor: true });
        panel.on('pointerdown', skip);
        this._deathRecapKeyHandler = (event) => {
            if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
                event.preventDefault();
                skip();
            }
        };
        this.input.keyboard.on('keydown', this._deathRecapKeyHandler);
    }

    continueAfterDeathRecap() {
        if (this._deathRecapFinished) return;
        this._deathRecapFinished = true;
        if (this._deathRecapTimer) {
            this._deathRecapTimer.remove(false);
            this._deathRecapTimer = null;
        }
        if (this._deathRecapKeyHandler && this.input && this.input.keyboard) {
            this.input.keyboard.off('keydown', this._deathRecapKeyHandler);
            this._deathRecapKeyHandler = null;
        }
        this.scene.restart({ level: this.currentLevel, stats: this.checkpointStats });
    }

    /** Queue insured mid-raid loot for hideout claim. Returns note for death recap. */
    processInsuranceOnDeath() {
        ensureInsuranceFields(this.persistent);
        if (!this.persistent.insuranceActive) return null;
        this.persistent.insuranceActive = false;
        const lost = diffLostItemSnapshots(this.playerStats, this.checkpointStats);
        if (!lost.length) return 'Insurance: nothing to return';
        const chance = (CONFIG.HIDEOUT && CONFIG.HIDEOUT.INSURANCE_RETURN_CHANCE != null)
            ? CONFIG.HIDEOUT.INSURANCE_RETURN_CHANCE : 0.7;
        const delay = (CONFIG.HIDEOUT && CONFIG.HIDEOUT.INSURANCE_RETURN_MS) || 180000;
        const readyAt = Date.now() + delay;
        let returned = 0;
        let scavenged = 0;
        lost.forEach(row => {
            if (Math.random() < chance) {
                this.persistent.insuranceReturns.push({ ...row, readyAt });
                returned++;
            } else {
                scavenged++;
            }
        });
        if (returned <= 0) return 'Insurance: scavs took everything';
        const mins = Math.max(1, Math.round(delay / 60000));
        return scavenged > 0
            ? `Insurance: ${returned} returning (~${mins}m), ${scavenged} scavenged`
            : `Insurance: ${returned} returning to stash (~${mins}m)`;
    }

    handlePlayerDeath(options = {}) {
        if (this.isTransitioning) return;
        
        // Second Wind skill: Survive one lethal hit per run
        if (this.hasSkill('second_wind') && !this.persistent.secondWindUsed) {
            this.persistent.secondWindUsed = true;
            this.playerStats.hp = 1;
            savePersistent(this.persistent);
            
            // Visual feedback
            sfx.success();
            this.showFloatingText(this.player.x, this.player.y - 50, "SECOND WIND!", 0xffff00);
            this.cameras.main.flash(200, 255, 255, 0);
            
            // Brief invulnerability
            this.player.setAlpha(0.5);
            this.time.delayedCall(2000, () => {
                if (this.player.active) this.player.setAlpha(1);
            });
            return; // Don't die
        }
        
        this.isTransitioning = true;
        this.cleanupTimerEvents();
        
        // Track death
        this.persistent.totalDeaths++;
        const insuranceNote = this.processInsuranceOnDeath();
        savePersistent(this.persistent);
        
        sfx.playerDeath();
        this.physics.pause();
        this._deathRecapFinished = false;
        const recap = this.buildDeathRecap({ ...options, insuranceNote });
        this.showDeathRecap(recap);

        this._deathRecapTimer = this.time.delayedCall(CONFIG.TIMINGS.DEATH_RESTART, () => {
            this.continueAfterDeathRecap();
        });
    }

    triggerKnockdown(leaper) {
        if (this.isPinned || this.isDodging) return;
        this.isPinned = true;
        this.pinnedBy = leaper;
        this.pinHitCount = 0;
        this.lastPinDamageTime = this.time.now;
        this.player.setVelocity(0);
        leaper.setVelocity(0);
        leaper.state = 'PINNING';
        leaper.pinnedTarget = this.player; // Leaper stays on player (same as bandit pin)
        this.player.setTint(0x0000ff);
        this.showFloatingText(this.player.x, this.player.y - 50, this.hasBothArmsBlacked() ? "ARMS DESTROYED - CAN'T BREAK FREE" : "PRESS SPACE!", 0xff0000);
        this.cancelReload();
    }

    hasNoGoodArms() {
        const limbHp = this.playerStats.limbHp;
        return limbHp && limbHasBreak(limbHp, 'leftArm') && limbHasBreak(limbHp, 'rightArm');
    }

    /** Returns list of weapon ids that are currently in weapon slots (primary, secondary, sidearm). Only these are usable for firing/reload/Q-switch. */
    getSlottedWeaponList() {
        const ws = this.playerStats.weaponSlots || { primary: null, secondary: null, sidearm: 'pistol', melee: null };
        const raw = [ws.sidearm, ws.primary, ws.secondary].filter(Boolean);
        return [...new Set(raw)];
    }

    /** If currentWeapon is not in a slot, set it to first slotted weapon or pistol (so combat never uses a non-equipped weapon). */
    ensureCurrentWeaponInSlots() {
        const list = this.getSlottedWeaponList();
        if (list.length === 0) return;
        if (!list.includes(this.playerStats.currentWeapon)) {
            this.playerStats.currentWeapon = list[0];
        }
    }

    isArmBlacked(armId) {
        const limbHp = this.playerStats.limbHp;
        return limbHp && limbHp[armId] != null && (limbHp[armId].hp || 0) <= 0;
    }

    hasOneArmBlacked() {
        const left = this.isArmBlacked('leftArm');
        const right = this.isArmBlacked('rightArm');
        return (left && !right) || (!left && right);
    }

    hasBothArmsBlacked() {
        return this.isArmBlacked('leftArm') && this.isArmBlacked('rightArm');
    }

    areVitalLimbsBlacked() {
        const limbHp = this.playerStats.limbHp;
        if (!limbHp || !limbHp.chest || !limbHp.head) return false;
        return (limbHp.chest.hp || 0) <= 0 && (limbHp.head.hp || 0) <= 0;
    }

    checkDeathConditions() {
        if (this.playerStats.hp <= 0) this.handlePlayerDeath();
    }

    processBleedTick() {
        const limbHp = this.playerStats.limbHp;
        if (!limbHp) return;
        ensureLimbVisStats(this.playerStats);
        const now = this.time.now;
        const cfg = CONFIG.BLEED || {};
        const vis = CONFIG.LIMB_VIS || {};
        const minorInterval = cfg.MINOR_INTERVAL_MS != null ? cfg.MINOR_INTERVAL_MS : 3000;
        const majorInterval = cfg.MAJOR_INTERVAL_MS != null ? cfg.MAJOR_INTERVAL_MS : 1500;
        const minorDmg = cfg.MINOR_DAMAGE != null ? cfg.MINOR_DAMAGE : 1;
        const majorDmg = cfg.MAJOR_DAMAGE != null ? cfg.MAJOR_DAMAGE : 1;
        const bloodDrainMinor = vis.BLOOD_DRAIN_MINOR != null ? vis.BLOOD_DRAIN_MINOR : 1;
        const bloodDrainMajor = vis.BLOOD_DRAIN_MAJOR != null ? vis.BLOOD_DRAIN_MAJOR : 2;

        Object.keys(limbHp).forEach(limbId => {
            const limb = limbHp[limbId];
            const effects = Array.isArray(limb.effects) ? limb.effects : [];
            const hp = limb.hp || 0;

            if (effects.includes('minor_bleed') && hp > 0) {
                if (this.lastBleedTick.minor[limbId] == null) this.lastBleedTick.minor[limbId] = now;
                if (now - this.lastBleedTick.minor[limbId] >= minorInterval) {
                    this.lastBleedTick.minor[limbId] = now;
                    this.hitPlayer(minorDmg, null, null, { targetLimbId: limbId, fromBleed: true });
                    this.playerStats.blood = Math.max(0, (this.playerStats.blood || 0) - bloodDrainMinor);
                    if ((limbHp[limbId].hp || 0) <= 0) {
                        const idx = limbHp[limbId].effects.indexOf('minor_bleed');
                        if (idx !== -1) limbHp[limbId].effects.splice(idx, 1);
                    }
                }
            }

            if (effects.includes('major_bleed')) {
                if (this.lastBleedTick.major[limbId] == null) this.lastBleedTick.major[limbId] = now;
                if (now - this.lastBleedTick.major[limbId] >= majorInterval) {
                    this.lastBleedTick.major[limbId] = now;
                    const damageTargetId = hp > 0 ? limbId : (MAJOR_BLEED_PROPAGATION[limbId] || null);
                    if (damageTargetId && limbHp[damageTargetId] && (limbHp[damageTargetId].hp || 0) > 0) {
                        this.hitPlayer(majorDmg, null, null, { targetLimbId: damageTargetId, fromBleed: true });
                    }
                    this.playerStats.blood = Math.max(0, (this.playerStats.blood || 0) - bloodDrainMajor);
                }
            }
        });

        if ((this.playerStats.blood || 0) <= 0) {
            this.showFloatingText(this.player.x, this.player.y - 50, "BLED OUT!", 0xaa0000);
            this.handlePlayerDeath({ cause: 'BLED OUT', limbId: (this._lastHitRecap && this._lastHitRecap.limbId) || null });
        }
    }

    /** Blood regen when dry; infection fill after bite; death at 100%. */
    processBloodAndInfection(time, delta) {
        ensureLimbVisStats(this.playerStats);
        const vis = CONFIG.LIMB_VIS || {};
        const dt = delta / 1000;

        if (!hasAnyBleed(this.playerStats.limbHp)) {
            const regen = vis.BLOOD_REGEN_PER_SEC != null ? vis.BLOOD_REGEN_PER_SEC : 3;
            this.playerStats.blood = Math.min(
                this.playerStats.maxBlood,
                (this.playerStats.blood || 0) + regen * dt
            );
        }

        let infection = this.playerStats.infection || 0;
        if (infection > 0 && infection < 100) {
            const fillMs = vis.INFECTION_FILL_MS || 90000;
            infection = Math.min(100, infection + (100 / fillMs) * delta);
            this.playerStats.infection = infection;
            if (infection >= 100) {
                this.showFloatingText(this.player.x, this.player.y - 50, "INFECTION TOOK HOLD!", 0x66ff44);
                this.handlePlayerDeath({ cause: 'INFECTION' });
            }
        }
    }

    /** Limp bob + blood droplet trail while moving/bleeding. */
    updateLimbVisFeel(time, delta) {
        if (!this.player || !this.player.active) return;
        const limbHp = this.playerStats.limbHp;
        const vis = CONFIG.LIMB_VIS || {};
        const leftLegBlacked = limbHp && limbHp.leftLeg && (limbHp.leftLeg.hp || 0) === 0;
        const rightLegBlacked = limbHp && limbHp.rightLeg && (limbHp.rightLeg.hp || 0) === 0;
        const oneLegBlacked = (leftLegBlacked && !rightLegBlacked) || (!leftLegBlacked && rightLegBlacked);
        const legBroken = (id) => limbHp && limbHp[id] && Array.isArray(limbHp[id].effects) && limbHp[id].effects.includes('break');
        const isLimping = oneLegBlacked || legBroken('leftLeg') || legBroken('rightLeg');
        const moving = this.player.body && (Math.abs(this.player.body.velocity.x) + Math.abs(this.player.body.velocity.y) > 8);

        if (isLimping && moving) {
            this._limpPhase = (this._limpPhase || 0) + delta * 0.001 * ((vis.LIMP_BOB_HZ || 5) * Math.PI * 2);
            const amp = vis.LIMP_ORIGIN_AMP != null ? vis.LIMP_ORIGIN_AMP : 0.1;
            this.player.setOrigin(0.5, 0.5 + Math.sin(this._limpPhase) * amp);
        } else {
            this.player.setOrigin(0.5, 0.5);
        }

        if (hasAnyBleed(limbHp) && moving) {
            const interval = vis.BLEED_DROP_INTERVAL_MS || 200;
            if (time - (this._lastBleedDrop || 0) >= interval) {
                this._lastBleedDrop = time;
                this.spawnBloodDrop(this.player.x, this.player.y);
            }
        }
    }

    spawnBloodDrop(x, y) {
        const drop = this.add.circle(
            x + (Math.random() - 0.5) * 10,
            y + 8 + Math.random() * 6,
            2 + Math.random() * 2,
            0x880000,
            0.85
        ).setDepth(3);
        this.tweens.add({
            targets: drop,
            alpha: 0.15,
            scale: 1.6,
            duration: 2200,
            onComplete: () => drop.destroy()
        });
    }

    clearInfection(showMsg = false) {
        if ((this.playerStats.infection || 0) > 0 && showMsg) {
            this.showFloatingText(400, 260, "INFECTION CLEARED", 0x88ff88);
        }
        this.playerStats.infection = 0;
        this._infectionWarned = false;
    }

    applyBiteInfection(enemyType) {
        const sources = (CONFIG.LIMB_VIS && CONFIG.LIMB_VIS.INFECTION_SOURCES) || [];
        if (!enemyType || !sources.includes(enemyType)) return;
        ensureLimbVisStats(this.playerStats);
        if ((this.playerStats.infection || 0) > 0) return;
        this.playerStats.infection = 1;
        this._infectionWarned = true;
        sfx.infectionWarn();
        this.showFloatingText(this.player.x, this.player.y - 55, "BITTEN — INFECTION!", 0x88ff44);
    }

    applyBodyPenaltyDamage() {
        this.hitPlayer(1, this.player.x, this.player.y, { bodyOnly: true, bypassArmor: true });
    }

    recoverFromKnockdown() {
        const limbHpRec = this.playerStats.limbHp;
        const leftBroken = limbHpRec && limbHasBreak(limbHpRec, 'leftArm');
        const rightBroken = limbHpRec && limbHasBreak(limbHpRec, 'rightArm');
        const recoveryDamage = (leftBroken ? 2 : 0) + (rightBroken ? 2 : 0);
        if (recoveryDamage > 0) {
            this.hitPlayer(recoveryDamage, this.player.x, this.player.y, { fromPin: true, bypassArmor: true });
        }
        this.isPinned = false;
        this.player.clearTint();
        if (this.pinnedBy && this.pinnedBy.active && this.pinnedBy.body) {
            this.pinnedBy.pinnedTarget = null;
            this.pinnedBy.state = 'COOLDOWN';
            this.pinnedBy.leapTimer = CONFIG.ENEMIES.LEAPER.COOLDOWN_TIME;
            const mult = CONFIG.ENEMIES.LEAPER.PLAYER_BREAKFREE_KNOCKBACK_MULTIPLIER != null ? CONFIG.ENEMIES.LEAPER.PLAYER_BREAKFREE_KNOCKBACK_MULTIPLIER : 1.5;
            this.pinnedBy.knockBack(mult);
        }
        this.pinnedBy = null;
    }

    checkDebris() {
        if (this.debrisBlock && this.debrisBlock.active &&
            Phaser.Math.Distance.Between(this.player.x, this.player.y, this.debrisBlock.x, this.debrisBlock.y) < CONFIG.DISTANCES.DEBRIS) {
            if (this.hasMolotov) this.startBurningDebris();
            else this.showFloatingText(this.debrisBlock.x, this.debrisBlock.y, "Need Molotov!", 0xffffff);
            return true;
        }
        return false;
    }

    startBurningDebris() {
        this.debrisBurning = true;
        this.showFloatingText(this.debrisBlock.x, this.debrisBlock.y, "BURNING!", 0xff4500);
        this.debrisBlock.setTint(0xff4500);
        this.openTimerEvent = this.time.addEvent({
            delay: CONFIG.TIMINGS.DEBRIS_BURN,
            callback: () => {
                this.debrisBurning = false;
                if (this.debrisBlock) this.debrisBlock.destroy();
                this.showFloatingText(this.player.x, this.player.y, "CLEARED!", 0x00ff00);
            }
        });
    }

    checkSwitch() {
        // Extraction switches on boss levels (5 and 7)
        if (this.currentLevel !== 5 && this.currentLevel !== 7) return false;
        const s = this.switches.getFirstAlive();
        if (s && Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y) < CONFIG.DISTANCES.INTERACT) {
            this.activateExtraction();
            s.destroy();
            return true;
        }
        return false;
    }

    checkDoor() {
        // Check room transition doors first (if using room grid system)
        if (this.roomGrid && this.roomDoors) {
            for (const roomDoor of this.roomDoors) {
                if (Phaser.Math.Distance.Between(this.player.x, this.player.y, roomDoor.x, roomDoor.y) < CONFIG.DISTANCES.DOOR) {
                    if (this.hasBothArmsBlacked()) {
                        this.showFloatingText(roomDoor.x, roomDoor.y - 40, "ARMS DESTROYED - CAN'T OPEN DOOR", 0xff0000);
                        return true;
                    }
                    if (this.hasNoGoodArms()) {
                        if (!this.doorPending) {
                            this.doorPending = { start: this.time.now, action: 'room', targetRoom: roomDoor.targetRoom };
                            this.showFloatingText(roomDoor.x, roomDoor.y - 40, "Trying the handle...", 0xffffff);
                        }
                        return true;
                    }
                    this.transitionToRoom(roomDoor.targetRoom);
                    return true;
                }
            }
        }
        
        // Check risk room door
        if (this.riskDoor && !this.inRiskRoom) {
            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.riskDoor.x, this.riskDoor.y) < CONFIG.DISTANCES.DOOR) {
                if (this.hasBothArmsBlacked()) {
                    this.showFloatingText(this.riskDoor.x, this.riskDoor.y - 40, "ARMS DESTROYED - CAN'T OPEN DOOR", 0xff0000);
                    return true;
                }
                if (this.hasNoGoodArms()) {
                    if (!this.doorPending) {
                        this.doorPending = { start: this.time.now, action: 'risk' };
                        this.showFloatingText(this.riskDoor.x, this.riskDoor.y - 40, "Trying the handle...", 0xffffff);
                    }
                    return true;
                }
                this.enterRiskRoom();
                return true;
            }
        }
        
        // Check for risk room exit door (must be near exit and enemies cleared)
        if (this.inRiskRoom && this.riskRoomExitDoor) {
            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.riskRoomExitDoor.x, this.riskRoomExitDoor.y) < CONFIG.DISTANCES.DOOR) {
                if (this.enemies.countActive() > 0) {
                    this.showFloatingText(this.riskRoomExitDoor.x, this.riskRoomExitDoor.y - 40, "Clear enemies first!", 0xff0000);
                    return true;
                }
                if (this.hasBothArmsBlacked()) {
                    this.showFloatingText(this.riskRoomExitDoor.x, this.riskRoomExitDoor.y - 40, "ARMS DESTROYED - CAN'T OPEN DOOR", 0xff0000);
                    return true;
                }
                if (this.hasNoGoodArms()) {
                    if (!this.doorPending) {
                        this.doorPending = { start: this.time.now, action: 'exitRisk' };
                        this.showFloatingText(this.riskRoomExitDoor.x, this.riskRoomExitDoor.y - 40, "Trying the handle...", 0xffffff);
                    }
                    return true;
                }
                this.exitRiskRoom();
                return true;
            }
        }
        
        // Check main level exit door (in exit room only for room grid system)
        if (this.roomGrid) {
            const currentRoom = this.roomGrid.rooms[this.roomGrid.currentRoom];
            if (!currentRoom.isExit) return false; // Can only use exit door in exit room
        }
        
        if (this.currentLevel === 7) return false; // Cemetery is extraction-only (final level)
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.door.x, this.door.y) < CONFIG.DISTANCES.DOOR) {
            if (this.hasBothArmsBlacked()) {
                this.showFloatingText(this.door.x, this.door.y - 40, "ARMS DESTROYED - CAN'T OPEN DOOR", 0xff0000);
                return true;
            }
            if (this.currentLevel === 1) {
                if (hasDoorKey(this.playerStats)) {
                    if (this.hasNoGoodArms()) {
                        if (!this.doorPending) {
                            this.doorPending = { start: this.time.now, action: 'nextLevel' };
                            this.showFloatingText(this.door.x, this.door.y - 40, "Trying the handle...", 0xffffff);
                        }
                    } else this.nextLevel();
                } else this.showFloatingText(this.door.x, this.door.y - 40, "Need Key!", 0xffffff);
            } else if (this.currentLevel === 2) {
                if (this.hasNoGoodArms()) {
                    if (!this.doorPending) {
                        this.doorPending = { start: this.time.now, action: 'nextLevel' };
                        this.showFloatingText(this.door.x, this.door.y - 40, "Trying the handle...", 0xffffff);
                    }
                } else this.nextLevel();
            } else if (this.currentLevel === 3) {
                if (hasDoorKey(this.playerStats)) {
                    if (this.hasNoGoodArms()) {
                        if (!this.doorPending) {
                            this.doorPending = { start: this.time.now, action: 'nextLevel' };
                            this.showFloatingText(this.door.x, this.door.y - 40, "Trying the handle...", 0xffffff);
                        }
                    } else this.nextLevel();
                } else this.showFloatingText(this.door.x, this.door.y - 40, "Need Key!", 0xffffff);
            } else if (this.currentLevel === 4) {
                if (hasDoorKey(this.playerStats)) {
                    if (this.hasNoGoodArms()) {
                        if (!this.doorPending) {
                            this.doorPending = { start: this.time.now, action: 'nextLevel' };
                            this.showFloatingText(this.door.x, this.door.y - 40, "Trying the handle...", 0xffffff);
                        }
                    } else this.nextLevel();
                } else this.showFloatingText(this.door.x, this.door.y - 40, "Need Key!", 0xffffff);
            } else if (this.currentLevel === 5) {
                if (this.switchDropped) {
                    this.showFloatingText(this.door.x, this.door.y - 40, "Use switch first!", 0xffffff);
                } else {
                    if (hasDoorKey(this.playerStats)) {
                        if (this.hasNoGoodArms()) {
                            if (!this.doorPending) {
                                this.doorPending = { start: this.time.now, action: 'nextLevel' };
                                this.showFloatingText(this.door.x, this.door.y - 40, "Trying the handle...", 0xffffff);
                            }
                        } else this.nextLevel();
                    } else this.showFloatingText(this.door.x, this.door.y - 40, "Need Key!", 0xffffff);
                }
            } else if (this.currentLevel === 6) {
                if (hasDoorKey(this.playerStats)) {
                    if (this.hasNoGoodArms()) {
                        if (!this.doorPending) {
                            this.doorPending = { start: this.time.now, action: 'nextLevel' };
                            this.showFloatingText(this.door.x, this.door.y - 40, "Trying the handle...", 0xffffff);
                        }
                    } else this.nextLevel();
                } else this.showFloatingText(this.door.x, this.door.y - 40, "Need Key!", 0xffffff);
            }
            return true;
        }
        return false;
    }

    nextLevel() {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.cleanupTimerEvents();
        this.physics.pause();

        // Surviving to extract clears infection (same rule as beacon extract)
        this.clearInfection(true);
        ensureLimbVisStats(this.playerStats);
        this.playerStats.blood = Math.min(this.playerStats.maxBlood, (this.playerStats.blood || 0) + 25);
        
        sfx.levelComplete();
        sfx.doorOpen();
        
        // Track run completion for progression
        this.persistent.runsCompleted = (this.persistent.runsCompleted || 0) + 1;
        
        // Calculate and award skill points
        const skillPointsEarned = this.calculateRunSkillPoints();
        if (skillPointsEarned > 0) {
            this.persistent.skillPoints = (this.persistent.skillPoints || 0) + skillPointsEarned;
            this.persistent.totalSkillPoints = (this.persistent.totalSkillPoints || 0) + skillPointsEarned;
            this.showFloatingText(400, 320, `+${skillPointsEarned} SKILL POINT${skillPointsEarned > 1 ? 'S' : ''}!`, 0xaa66ff);
        }
        
        // ===== CHALLENGE TRACKING =====
        // Weekly extractions
        this.persistent.weeklyExtractions = (this.persistent.weeklyExtractions || 0) + 1;
        
        // Weekly unique levels
        if (!this.persistent.weeklyUniqueLevels) this.persistent.weeklyUniqueLevels = [];
        if (!this.persistent.weeklyUniqueLevels.includes(this.currentLevel)) {
            this.persistent.weeklyUniqueLevels.push(this.currentLevel);
        }
        
        // Perfect level tracking (no damage taken)
        if (this.levelDamageTaken === 0) {
            this.persistent.perfectLevels = (this.persistent.perfectLevels || 0) + 1;
        }
        
        // Update challenge progress
        this.updateChallengeProgress();
        
        // Check for completed challenges
        const completedChallenges = checkChallengeCompletion(this.persistent);
        completedChallenges.forEach(c => {
            if (c.type === 'permanent') {
                this.showFloatingText(400, 350, `CHALLENGE: ${c.name}!`, 0xffd700);
            }
        });
        
        // Check untouchable achievement and Scout unlock (no damage this level)
        if (this.levelDamageTaken === 0) {
            const newAchievements = checkAchievements(this.persistent, { levelCompletedNoDamage: true });
            newAchievements.forEach(a => {
                sfx.achievement();
                this.showFloatingText(400, 200, `${a.icon} ${a.name}!`, 0xffd700);
            });
        }
        
        // Unlock the next level
        if (this.playerStats.highestLevelUnlocked < this.currentLevel + 1) {
            this.playerStats.highestLevelUnlocked = this.currentLevel + 1;
        }
        this.playerStats.nextLevel = this.currentLevel + 1;
        
        // Sync highestLevelUnlocked to persistent for upgrade tracking
        if (this.playerStats.highestLevelUnlocked > (this.persistent.highestLevelUnlocked || 0)) {
            this.persistent.highestLevelUnlocked = this.playerStats.highestLevelUnlocked;
        }
        
        // Check for new permanent upgrades
        const newUpgrades = checkUpgrades(this.persistent);
        newUpgrades.forEach(u => {
            sfx.achievement();
            this.showFloatingText(400, 250, `UPGRADE: ${u.name}!`, 0xffaa00);
        });
        
        savePersistent(this.persistent);
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.playerStats));
        
        // Show level complete choice screen
        this.showLevelCompleteChoice();
    }
    
    showLevelCompleteChoice() {
        const LEVEL_NAMES = ['', 'Street', 'Apartment', 'Rooftop', 'Sewers', 'Hospital', 'Mall', 'Cemetery'];
        const currentName = LEVEL_NAMES[this.currentLevel];
        const nextName = LEVEL_NAMES[this.currentLevel + 1] || 'Unknown';
        
        // Flag to prevent double-triggering
        this.levelChoiceMade = false;
        
        const doTransition = (toHideout) => {
            if (this.levelChoiceMade) return;
            this.levelChoiceMade = true;
            sfx.click();
            this.cameras.main.fade(CONFIG.TIMINGS.LEVEL_TRANSITION, 0, 0, 0);
            this.time.delayedCall(CONFIG.TIMINGS.LEVEL_TRANSITION, () => {
                if (toHideout) {
                    this.scene.start('HideoutScene', { stats: this.playerStats });
                } else {
                    this.scene.restart({ level: this.currentLevel + 1, stats: this.playerStats, levelDamageTaken: 0 });
                }
            });
        };
        
        // Create overlay
        const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85).setDepth(500);
        
        // Title
        const title = this.add.text(400, 180, 'LEVEL COMPLETE!', { 
            fontSize: '48px', fill: '#00ff00', fontStyle: 'bold' 
        }).setOrigin(0.5).setDepth(501);
        
        // Level transition text
        const transitionText = this.add.text(400, 250, `${currentName} -> ${nextName}`, { 
            fontSize: '24px', fill: '#ffffff' 
        }).setOrigin(0.5).setDepth(501);
        
        // Stats summary
        const curWeapon = this.playerStats.currentWeapon;
        const reserveAmmo = getReserveAmmoCount(this.playerStats, curWeapon);
        const statsText = this.add.text(400, 295, 
            `HP: ${this.playerStats.hp}/${this.playerStats.maxHp}  |  Ammo: ${reserveAmmo}  |  Scrap: ${this.playerStats.scrap}`, 
            { fontSize: '16px', fill: '#888888' }
        ).setOrigin(0.5).setDepth(501);
        
        // Skill points info
        const skillPtsText = this.add.text(400, 325, 
            `Skill Points: ${this.persistent.skillPoints || 0}`, 
            { fontSize: '16px', fill: '#aa66ff' }
        ).setOrigin(0.5).setDepth(501);
        
        // Continue button
        const continueBtn = this.add.rectangle(300, 400, 200, 60, 0x008800).setInteractive().setDepth(501);
        const continueTxt = this.add.text(300, 400, 'CONTINUE', { 
            fontSize: '24px', fill: '#ffffff' 
        }).setOrigin(0.5).setDepth(502);
        
        continueBtn.on('pointerover', () => { if (!this.levelChoiceMade) continueBtn.setFillStyle(0x00aa00); });
        continueBtn.on('pointerout', () => { if (!this.levelChoiceMade) continueBtn.setFillStyle(0x008800); });
        continueBtn.on('pointerdown', () => doTransition(false));
        
        // Return to hideout button
        const hideoutBtn = this.add.rectangle(500, 400, 200, 60, 0x444488).setInteractive().setDepth(501);
        const hideoutTxt = this.add.text(500, 400, 'HIDEOUT', { 
            fontSize: '24px', fill: '#ffffff' 
        }).setOrigin(0.5).setDepth(502);
        
        hideoutBtn.on('pointerover', () => { if (!this.levelChoiceMade) hideoutBtn.setFillStyle(0x5555aa); });
        hideoutBtn.on('pointerout', () => { if (!this.levelChoiceMade) hideoutBtn.setFillStyle(0x444488); });
        hideoutBtn.on('pointerdown', () => doTransition(true));
        
        // Keyboard shortcuts - use existing keys system instead of adding new ones
        this.levelChoiceEnterHandler = () => doTransition(false);
        this.levelChoiceEscHandler = () => doTransition(true);
        
        this.input.keyboard.on('keydown-ENTER', this.levelChoiceEnterHandler);
        this.input.keyboard.on('keydown-ESC', this.levelChoiceEscHandler);
        
        // Hint text
        const hintText = this.add.text(400, 480, 'ENTER = Continue  |  ESC = Hideout', { 
            fontSize: '14px', fill: '#666666' 
        }).setOrigin(0.5).setDepth(501);
    }

    winGame() {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.cleanupTimerEvents();
        this.extractionActive = false;
        this.physics.pause();
        this.levelText.setText("EXTRACTED!").setAlpha(1);
        if (this.uiGraphics) this.uiGraphics.clear();
        
        sfx.levelComplete();
        sfx.success();
        
        // Track run completion
        this.persistent.runsCompleted++;
        
        // Calculate and award skill points
        const skillPointsEarned = this.calculateRunSkillPoints();
        if (skillPointsEarned > 0) {
            this.persistent.skillPoints = (this.persistent.skillPoints || 0) + skillPointsEarned;
            this.persistent.totalSkillPoints = (this.persistent.totalSkillPoints || 0) + skillPointsEarned;
            this.showFloatingText(400, 320, `+${skillPointsEarned} SKILL POINT${skillPointsEarned > 1 ? 'S' : ''}!`, 0xaa66ff);
        }
        
        // ===== CHALLENGE TRACKING =====
        // Weekly extractions
        this.persistent.weeklyExtractions = (this.persistent.weeklyExtractions || 0) + 1;
        
        // Weekly unique levels (track which levels extracted from this week)
        if (!this.persistent.weeklyUniqueLevels) this.persistent.weeklyUniqueLevels = [];
        if (!this.persistent.weeklyUniqueLevels.includes(this.currentLevel)) {
            this.persistent.weeklyUniqueLevels.push(this.currentLevel);
        }
        
        // Perfect level tracking (no damage taken)
        if (this.levelDamageTaken === 0) {
            this.persistent.perfectLevels = (this.persistent.perfectLevels || 0) + 1;
        }
        
        // Update challenge progress for daily/weekly challenges
        this.updateChallengeProgress();
        
        // Check for completed challenges and show notifications
        const completedChallenges = checkChallengeCompletion(this.persistent);
        completedChallenges.forEach(c => {
            if (c.type === 'permanent') {
                this.showFloatingText(400, 350, `CHALLENGE: ${c.name}!`, 0xffd700);
            }
        });
        
        // Update next level for progression (after level 5 go to 6, after level 7 reset to 1)
        if (this.currentLevel === 7) {
            this.persistent.level7Completed = true;
            this.playerStats.nextLevel = 1; // Game complete, reset
            this.playerStats.highestLevelUnlocked = 7; // All levels stay unlocked
            this.showFloatingText(400, 200, "GAME COMPLETE!", 0x00ff00);
        } else {
            this.playerStats.nextLevel = this.currentLevel + 1;
            // Unlock the next level if not already unlocked
            if (this.playerStats.highestLevelUnlocked < this.currentLevel + 1) {
                this.playerStats.highestLevelUnlocked = this.currentLevel + 1;
            }
        }
        
        // Sync highestLevelUnlocked to persistent for upgrade tracking
        if (this.playerStats.highestLevelUnlocked > (this.persistent.highestLevelUnlocked || 0)) {
            this.persistent.highestLevelUnlocked = this.playerStats.highestLevelUnlocked;
        }
        
        // Check achievements
        const newAchievements = checkAchievements(this.persistent, {
            hasAllWeapons: this.playerStats.hasShotgun && this.playerStats.hasSMG
        });
        newAchievements.forEach(a => {
            sfx.achievement();
            this.showFloatingText(400, 250, `${a.icon} ${a.name}!`, 0xffd700);
        });
        
        // Check for new permanent upgrades
        const newUpgrades = checkUpgrades(this.persistent);
        newUpgrades.forEach(u => {
            sfx.achievement();
            this.showFloatingText(400, 280, `UPGRADE: ${u.name}!`, 0xffaa00);
        });
        
        // Extraction clears infection (virus has weakened — DESIGN.md)
        this.clearInfection(true);
        ensureLimbVisStats(this.playerStats);
        this.playerStats.blood = this.playerStats.maxBlood;

        savePersistent(this.persistent);
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.playerStats));
        this.time.delayedCall(CONFIG.TIMINGS.DEATH_RESTART, () => {
            this.scene.start('HideoutScene', { stats: this.playerStats });
        });
    }

    tryInteract() {
        if (this.hasBothArmsBlacked()) {
            this.showFloatingText(this.player.x, this.player.y - 40, "ARMS DESTROYED - CAN'T LOOT", 0xff0000);
            return;
        }
        const crates = this.crates.getChildren();
        let closest = null;
        let minDst = CONFIG.DISTANCES.INTERACT;

        crates.forEach(c => {
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, c.x, c.y);
            if (c.active && d < minDst) { closest = c; minDst = d; }
        });
        if (closest) {
            this.openCrate(closest);
            return;
        }

        const skulls = this.skulls.getChildren();
        closest = null;
        minDst = CONFIG.DISTANCES.INTERACT;

        skulls.forEach(s => {
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
            if (s.active && d < minDst) { closest = s; minDst = d; }
        });
        if (closest) {
            this.openBody(closest);
            return;
        }

        const dropped = this.droppedInventoryItems.getChildren();
        closest = null;
        minDst = CONFIG.DISTANCES.INTERACT;
        dropped.forEach(d => {
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, d.x, d.y);
            if (d.active && dist < minDst) { closest = d; minDst = dist; }
        });
        if (closest) {
            this.openDroppedItem(closest);
            return;
        }
    }

    openDroppedItem(item) {
        const type = item.getData('type');
        this.isOpening = true;
        sfx.crateShuffle();
        let searchTime = Math.floor((CONFIG.TIMINGS.BODY_SEARCH || 500) * (1 - (this.quickHandsBonus || 0)));
        const limbHpOp = this.playerStats.limbHp;
        if (limbHpOp && (limbHasBreak(limbHpOp, 'leftArm') || limbHasBreak(limbHpOp, 'rightArm'))) searchTime = Math.ceil(searchTime * 1.5);
        this.openTimerEvent = this.time.addEvent({
            delay: searchTime,
            callback: () => {
                this.isOpening = false;
                item.destroy();
                this.applyLoot(type);
                this.onPlayerSearchNoise(this.player.x, this.player.y);
                if (this.hasNoGoodArms()) this.applyBothArmsActionDamage();
            }
        });
    }

    openCrate(crate) {
        const itemID = crate.getData('lootID');
        this.isOpening = true;
        sfx.crateShuffle();
        let openTime = Math.floor(CONFIG.TIMINGS.CRATE_OPEN * (1 - (this.quickHandsBonus || 0)));
        const limbHpCrate = this.playerStats.limbHp;
        if (limbHpCrate && (limbHasBreak(limbHpCrate, 'leftArm') || limbHasBreak(limbHpCrate, 'rightArm'))) openTime = Math.ceil(openTime * 1.5);
        this.openTimerEvent = this.time.addEvent({
            delay: openTime,
            callback: () => {
                this.isOpening = false;
                sfx.crateOpen();
                crate.destroy();
                this.applyLoot(itemID);
                this.onPlayerSearchNoise(this.player.x, this.player.y);
                if (this.hasNoGoodArms()) this.applyBothArmsActionDamage();
            }
        });
    }

    openBody(skull) {
        const itemID = skull.getData('lootID');
        this.isOpening = true;
        sfx.crateShuffle();
        let searchTime = Math.floor((CONFIG.TIMINGS.BODY_SEARCH || 500) * (1 - (this.quickHandsBonus || 0)));
        const limbHpBody = this.playerStats.limbHp;
        if (limbHpBody && (limbHasBreak(limbHpBody, 'leftArm') || limbHasBreak(limbHpBody, 'rightArm'))) searchTime = Math.ceil(searchTime * 1.5);
        this.openTimerEvent = this.time.addEvent({
            delay: searchTime,
            callback: () => {
                this.isOpening = false;
                skull.destroy();
                this.applyLoot(itemID);
                this.onPlayerSearchNoise(this.player.x, this.player.y);
                if (this.hasNoGoodArms()) this.applyBothArmsActionDamage();
            }
        });
    }

    applyLoot(id) {
        let txt = "", col = 0xffffff;

        // Dropped grid item (from inventory drop): add back to backpack
        if (typeof id === 'object' && id != null && id.itemId != null) {
            if (!this.playerStats.backpack) this.playerStats.backpack = getDefaultBackpack();
            const backpack = this.playerStats.backpack;
            ensureGridItems(backpack);
            const count = id.count || 1;
            const extra = {};
            const hasDur = getDefaultDurability(id.itemId) && (id.durability != null || id.maxDurability != null);
            if (hasDur) { extra.durability = id.durability; extra.maxDurability = id.maxDurability; }
            if (id.rounds != null || id.maxRounds != null) { extra.rounds = id.rounds ?? 0; extra.maxRounds = id.maxRounds ?? (isMagazineItem(id.itemId) ? getMagazineCapacity(id.itemId) : undefined); }
            const useExtra = Object.keys(extra).length ? extra : undefined;
            let added = false;
            if (id.innerGrid && (id.itemId === 'ammo_box' || id.itemId === 'rig' || id.itemId === 'backpack_default')) {
                const cfg = getInventoryItemConfig(id.itemId);
                const sizeW = (cfg && cfg.sizeW) || (id.itemId === 'ammo_box' ? 2 : 4);
                const sizeH = (cfg && cfg.sizeH) || (id.itemId === 'ammo_box' ? 2 : 4);
                const runStats = this.playerStats || this.stats;
                if (id.itemId === 'backpack_default' && runStats && (!runStats.equippedBackpack || runStats.equippedBackpack.placementId !== 'equipped')) {
                    if (!runStats.backpackInventories) runStats.backpackInventories = {};
                    runStats.equippedBackpack = { itemId: 'backpack_default', placementId: 'equipped' };
                    runStats.backpackInventories['equipped'] = id.innerGrid && typeof id.innerGrid === 'object' ? id.innerGrid : getDefaultBackpack();
                    ensureGridItems(runStats.backpackInventories['equipped']);
                    runStats.backpack = runStats.backpackInventories['equipped'];
                    runStats.backpack.gridW = 6;
                    runStats.backpack.gridH = 9;
                    added = true;
                } else {
                    const pos = findSpace(backpack, sizeW, sizeH);
                    if (pos) {
                        const newPlacementId = placeItem(backpack, id.itemId, count, pos.row, pos.col, useExtra);
                        if (newPlacementId != null) {
                            if (runStats) {
                                if (id.itemId === 'ammo_box') {
                                    if (!runStats.ammoBoxInventories) runStats.ammoBoxInventories = {};
                                    runStats.ammoBoxInventories['backpack_' + newPlacementId] = id.innerGrid;
                                } else if (id.itemId === 'rig') {
                                    if (!runStats.rigInventories) runStats.rigInventories = {};
                                    runStats.rigInventories['backpack_' + newPlacementId] = id.innerGrid;
                                } else if (id.itemId === 'backpack_default') {
                                    if (!runStats.backpackInventories) runStats.backpackInventories = {};
                                    runStats.backpackInventories['backpack_' + newPlacementId] = id.innerGrid;
                                }
                            }
                            added = true;
                        }
                    }
                }
            }
            // Mag from ground: same process as equip path — rig → pockets → backpack (or drop if full)
            if (!added && isMagazineItem(id.itemId) && count === 1) {
                const magState = { itemId: id.itemId, rounds: id.rounds ?? 0, maxRounds: id.maxRounds ?? getMagazineCapacity(id.itemId) };
                placeMagInRigPocketBackpackOrGround(this, this.playerStats, magState);
                const cfg = getInventoryItemConfig(id.itemId);
                const name = (cfg && cfg.label) ? cfg.label : id.itemId;
                this.showFloatingText(this.player.x, this.player.y - 30, `+${count} ${name}`, 0x88ff88);
                return;
            }
            if (!added && tryAddItem(backpack, id.itemId, count, useExtra)) added = true;
            if (added) {
                const cfg = getInventoryItemConfig(id.itemId);
                const name = (cfg && cfg.label) ? cfg.label : id.itemId;
                this.showFloatingText(this.player.x, this.player.y - 30, `+${count} ${name}`, 0x88ff88);
            } else {
                this.showFloatingText(this.player.x, this.player.y - 30, "BACKPACK FULL!", 0xff6600);
            }
            return;
        }

        // Grid items: mags use rig → pockets → backpack (same as equip); others try rig then backpack.
        const instantOnly = ['map', 'scrap', 'meds', 'molotov'];
        if (!instantOnly.includes(id) && getInventoryItemConfig(id)) {
            if (isMagazineItem(id)) {
                const cap = getMagazineCapacity(id);
                const magState = { itemId: id, rounds: Phaser.Math.Between(0, cap), maxRounds: cap };
                placeMagInRigPocketBackpackOrGround(this, this.playerStats, magState);
                const cfg = getInventoryItemConfig(id);
                const name = (cfg && cfg.label) ? cfg.label : id;
                this.showFloatingText(this.player.x, this.player.y - 30, `+1 ${name}`, 0x88ff88);
                return;
            }
            if (!this.playerStats.backpack) this.playerStats.backpack = getDefaultBackpack();
            const backpack = this.playerStats.backpack;
            ensureGridItems(backpack);
            const count = (id === 'ammo' ? 5 : (id && id.startsWith('ammo_')) ? 5 : id === 'scrap' ? 5 : id === 'materials' ? 10 : id === 'meds' ? 1 : id === 'cigarettes' ? 1 : 1);
            const gridExtra = getDefaultDurability(id);
            const extra = gridExtra ? { durability: gridExtra.durability, maxDurability: gridExtra.maxDurability } : undefined;
            const rigEquippedForLoot = this.playerStats.armor && this.playerStats.armor.rig && this.playerStats.rigGrid;
            const addedToRig = rigEquippedForLoot && tryAddItem(this.playerStats.rigGrid, id, count, extra);
            const addedToBackpack = !addedToRig && tryAddItem(backpack, id, count, extra);
            if (!addedToRig && !addedToBackpack) {
                this.showFloatingText(this.player.x, this.player.y - 30, "BACKPACK FULL!", 0xff6600);
                return;
            }
        }

        // Data-driven: weapon pickups (flag + float text)
        const weaponAction = CONFIG.LOOT.LOOT_WEAPON_ACTIONS && CONFIG.LOOT.LOOT_WEAPON_ACTIONS[id];
        if (weaponAction) {
            sfx.lootWeapon();
            this.playerStats[weaponAction.flag] = true;
            txt = weaponAction.txt;
            col = weaponAction.col;
            const magWeapons = { smg: 'mag_smg', rifle: 'mag_rifle', pistol: 'mag_pistol' };
            const magItemId = magWeapons[id];
            if (magItemId) {
                const capacity = getMagazineCapacity(magItemId);
                const rounds = getRandomMagRoundsForLootedWeapon(capacity);
                setEquippedMag(this.playerStats, id, { itemId: magItemId, rounds, maxRounds: capacity });
            }
        } else {
            // Data-driven: medical/grid items (sfx + "LABEL (dur/max)" + color)
            const medicalDisplay = CONFIG.LOOT.LOOT_MEDICAL_DISPLAY && CONFIG.LOOT.LOOT_MEDICAL_DISPLAY[id];
            if (medicalDisplay) {
                sfx.loot();
                const cfg = getInventoryItemConfig(id);
                const dur = getDefaultDurability(id);
                const label = (cfg && cfg.label) ? cfg.label : id;
                txt = dur ? `${label} (${dur.durability}/${dur.maxDurability})` : label;
                col = medicalDisplay.col;
            } else switch (id) {
            case 'meds':
                sfx.lootHealth();
                const oldMedsHp = this.playerStats.hp;
                this.playerStats.hp = Math.min(this.playerStats.hp + 5, this.playerStats.maxHp);
                const medsHealedAmount = this.playerStats.hp - oldMedsHp;
                if (medsHealedAmount > 0) {
                    this.persistent.totalHPHealed = (this.persistent.totalHPHealed || 0) + medsHealedAmount;
                    const medsAchievements = checkAchievements(this.persistent, {});
                    medsAchievements.forEach(a => {
                        sfx.achievement();
                        this.showFloatingText(400, 200, `${a.icon} ${a.name}!`, 0xffd700);
                    });
                    savePersistent(this.persistent);
                }
                txt = "+5 HP"; col = 0xff0000;
                break;
            case 'ammo':
                sfx.lootAmmo();
                txt = "+5 Ammo"; col = 0xffff00;
                break;
            case 'ammo_bolts':
            case 'ammo_shells':
            case 'ammo_9mm':
            case 'ammo_45':
            case 'ammo_556':
                sfx.lootAmmo();
                const ammoType = CONFIG.AMMO_TYPES && Object.values(CONFIG.AMMO_TYPES).find(t => t.ammoId === id);
                txt = ammoType ? `+5 ${ammoType.label}` : `+5 ${id}`;
                col = ammoType && ammoType.color ? parseInt(ammoType.color.slice(1), 16) : 0xffff00;
                break;
            case 'key':
                sfx.lootKey();
                txt = "KEY FOUND!"; col = 0xffd700;
                break;
            case 'map':
                sfx.lootKey();
                this.hasMap = true;
                this.updateMinimap();
                txt = "MAP FOUND!"; col = 0x00ffaa;
                break;
            case 'molotov':
                sfx.loot();
                this.hasMolotov = true;
                txt = "MOLOTOV!"; col = 0xff4500;
                break;
            case 'scrap':
                sfx.loot();
                this.playerStats.scrap += 5;
                this.persistent.totalScrapCollected += 5;
                // Check scavenger achievement
                const scrapAchievements = checkAchievements(this.persistent, {});
                scrapAchievements.forEach(a => {
                    sfx.achievement();
                    this.showFloatingText(400, 200, `${a.icon} ${a.name}!`, 0xffd700);
                });
                savePersistent(this.persistent);
                txt = "+5 SCRAP"; col = 0xaaaaaa;
                break;
            case 'plug':
                sfx.loot();
                txt = "SPARK PLUG!"; col = 0x00ffff;
                break;
            case 'helmet':
                sfx.loot();
                this.playerStats.armor.head = { name: 'HELMET', durability: 30, maxDurability: 30, itemId: 'helmet' };
                txt = "HELMET EQUIPPED"; col = 0x00ff00;
                break;
            case 'headset':
                sfx.loot();
                this.playerStats.armor.head = { name: 'HEADSET', durability: 30, maxDurability: 30, itemId: 'headset' };
                txt = "HEADSET EQUIPPED"; col = 0x00ff00;
                break;
            case 'vest':
                sfx.loot();
                this.playerStats.armor.body = { name: 'VEST', durability: 50, maxDurability: 50 };
                txt = "VEST EQUIPPED"; col = 0x00ff00;
                break;
            case 'grenade':
                if (tryAddItem(this.playerStats.backpack, 'grenade', 1)) {
                    sfx.loot();
                    txt = "+1 GRENADE"; col = 0x556B2F;
                } else {
                    sfx.error();
                    txt = "INVENTORY FULL"; col = 0x888888;
                }
                break;
            case 'materials':
                sfx.loot();
                const materialsAmount = 10;
                this.playerStats.materials += materialsAmount;
                this.persistent.totalMaterialsCollected = (this.persistent.totalMaterialsCollected || 0) + materialsAmount;
                txt = `+${materialsAmount} MATERIALS`;
                col = (CONFIG.CURRENCIES && CONFIG.CURRENCIES.MATERIALS && CONFIG.CURRENCIES.MATERIALS.color) ? CONFIG.CURRENCIES.MATERIALS.color : 0x00aaff;
                break;
            case 'cigarettes':
                sfx.loot();
                txt = "+1 Cigarettes"; col = 0x8B4513;
                break;
            // Weapon Mods (rarity affects display color); flashlight is an attachment
            case 'extended_mag':
            case 'suppressor':
            case 'laser_sight':
            case 'damage_barrel':
            case 'rapid_fire':
            case 'flashlight':
                sfx.lootWeapon();
                if (!this.persistent.modInventory) this.persistent.modInventory = [];
                this.persistent.modInventory.push(id);
                savePersistent(this.persistent);
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.playerStats));
                const modConfig = Object.values(CONFIG.MODS || {}).find(m => m.id === id);
                const modName = modConfig?.name || id.replace(/_/g, ' ').toUpperCase();
                if (modConfig && modConfig.rarity === 'rare') {
                    txt = `RARE: ${modName}!`;
                    col = 0xffd700;
                } else if (modConfig && modConfig.rarity === 'uncommon') {
                    txt = `MOD: ${modName}!`;
                    col = 0x00ccff;
                } else {
                    txt = `MOD: ${modName}!`;
                    col = 0xff00ff;
                }
                break;
            }
        }

        this.showFloatingText(this.player.x, this.player.y - 30, txt, col);
    }

    showFloatingText(x, y, msg, color) {
        this.floatingText.spawn(x, y, msg, color);
    }

    updateBossBar(hp, max) {
        this.bossBar.clear();
        this.bossBar.fillStyle(0x000000, 1);
        this.bossBar.fillRect(200, 50, 400, 20);
        this.bossBar.fillStyle(0xff0000, 1);
        this.bossBar.fillRect(202, 52, 396 * (hp / max), 16);
    }

    /** Compact body silhouette — flashes the hit limb so combat teaches the system. */
    drawLimbHudFigure() {
        const g = this.uiGraphics;
        if (!g || !this.playerStats.limbHp) return;
        const cx = 755, cy = 95;
        const flash = this.limbHudFlash && this.time.now < this.limbHudFlash.until
            ? this.limbHudFlash.limbId
            : null;
        const parts = [
            { id: 'head', x: cx, y: cy - 28, w: 12, h: 12 },
            { id: 'chest', x: cx, y: cy - 10, w: 18, h: 14 },
            { id: 'abdomen', x: cx, y: cy + 6, w: 16, h: 10 },
            { id: 'crotch', x: cx, y: cy + 18, w: 12, h: 8 },
            { id: 'leftArm', x: cx - 16, y: cy - 8, w: 8, h: 18 },
            { id: 'rightArm', x: cx + 16, y: cy - 8, w: 8, h: 18 },
            { id: 'leftLeg', x: cx - 7, y: cy + 32, w: 8, h: 18 },
            { id: 'rightLeg', x: cx + 7, y: cy + 32, w: 8, h: 18 }
        ];
        parts.forEach(p => {
            const limb = this.playerStats.limbHp[p.id];
            const maxH = (limb && limb.maxHp) || 1;
            const pct = Math.max(0, Math.min(1, ((limb && limb.hp) || 0) / maxH));
            let color = pct <= 0 ? 0x222222 : (pct >= 0.5 ? 0x2a8a2a : (pct >= 0.35 ? 0xaa6622 : 0x882222));
            const effects = (limb && Array.isArray(limb.effects)) ? limb.effects : [];
            if (effects.includes('major_bleed')) color = 0xcc0000;
            else if (effects.includes('minor_bleed')) color = 0xaa3333;
            else if (effects.includes('break')) color = 0xccaa22;
            if (flash === p.id) color = 0xffffff;
            g.fillStyle(color, flash === p.id ? 1 : 0.9);
            g.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
            g.lineStyle(1, 0x888888, 0.8);
            g.strokeRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
        });
    }

    drawUI() {
        if (!this.uiGraphics) return;
        const ui = CONFIG.UI;
        this.uiGraphics.clear();
        ensureLimbVisStats(this.playerStats);

        // HP Bar
        this.uiGraphics.fillStyle(0x000000, 0.5);
        this.uiGraphics.fillRect(10, 10, ui.HP_BAR_WIDTH + 4, ui.HP_BAR_HEIGHT + 4);
        this.uiGraphics.fillStyle(0xff0000, 1);
        this.uiGraphics.fillRect(12, 12, ui.HP_BAR_WIDTH * (this.playerStats.hp / this.playerStats.maxHp), ui.HP_BAR_HEIGHT);

        // Stamina Bar
        this.uiGraphics.fillStyle(0x000000, 0.5);
        this.uiGraphics.fillRect(10, 40, ui.STAMINA_BAR_WIDTH + 4, ui.STAMINA_BAR_HEIGHT + 4);
        this.uiGraphics.fillStyle(0x0088ff, 1);
        this.uiGraphics.fillRect(12, 42, ui.STAMINA_BAR_WIDTH * (this.playerStats.stamina / this.playerStats.maxStamina), ui.STAMINA_BAR_HEIGHT);

        // Blood bar (right of HP) — bleed pool separate from limb HP
        const bloodW = 120, bloodH = 10;
        const bloodPct = (this.playerStats.blood || 0) / (this.playerStats.maxBlood || 100);
        this.uiGraphics.fillStyle(0x000000, 0.5);
        this.uiGraphics.fillRect(220, 10, bloodW + 4, bloodH + 4);
        this.uiGraphics.fillStyle(0x990022, 1);
        this.uiGraphics.fillRect(222, 12, bloodW * bloodPct, bloodH);

        // Infection bar (right of stamina) — only when bitten
        const infection = this.playerStats.infection || 0;
        if (infection > 0) {
            const infW = 120, infH = 10;
            this.uiGraphics.fillStyle(0x000000, 0.5);
            this.uiGraphics.fillRect(220, 34, infW + 4, infH + 4);
            this.uiGraphics.fillStyle(0x44cc44, 1);
            this.uiGraphics.fillRect(222, 36, infW * (infection / 100), infH);
            if (infection > 70) {
                const pulse = 0.4 + Math.sin(this.time.now / 180) * 0.4;
                this.uiGraphics.lineStyle(2, 0x88ff44, pulse);
                this.uiGraphics.strokeRect(220, 34, infW + 4, infH + 4);
            }
        }

        this.drawLimbHudFigure();

        // Ammo display: mag weapons = rounds/max or "-"; shotgun/crossbow = mag/max (reserve)
        const weapon = this.playerStats.currentWeapon;
        const magWeaponsHud = ['pistol', 'smg', 'rifle'];
        let ammoStr;
        if (magWeaponsHud.includes(weapon)) {
            const em = getEquippedMag(this.playerStats, weapon);
            ammoStr = em ? `${em.rounds}/${em.maxRounds}` : "—";
        } else {
            const mag = this.playerStats.magazines[weapon];
            const maxMag = CONFIG.WEAPONS[weapon.toUpperCase()].MAG_SIZE;
            const reserveCount = getReserveAmmoCount(this.playerStats, weapon);
            ammoStr = `${mag}/${maxMag} (${reserveCount})`;
        }
        let reloadText = this.isReloading ? " [RELOADING]" : "";
        this.uiText.setText(`${weapon.toUpperCase()}: ${ammoStr}${reloadText} | GREN: ${getUsableGrenadeCount(this.playerStats)} | 🔧${this.playerStats.scrap} 💰${this.playerStats.credits} ⚙️${this.playerStats.materials}`);

        // Run clock + extraction pressure (top center)
        const extractStatus = this.getExtractPressureStatus();
        const runClock = this.formatRunClock(Date.now() - (this.levelStartTime || Date.now()));
        if (this.extractHudText) {
            this.extractHudText.setText(`LV${this.currentLevel}  ${runClock}  |  ${extractStatus.label}`);
            this.extractHudText.setColor(extractStatus.color || '#cccccc');
            if (extractStatus.kind === 'beacon') {
                const pulse = 0.7 + Math.sin(this.time.now / 120) * 0.3;
                this.extractHudText.setAlpha(pulse);
            } else {
                this.extractHudText.setAlpha(1);
            }
        }
        if (extractStatus.kind === 'beacon' && extractStatus.progress != null) {
            const barW = 160, barH = 6, barX = 400 - barW / 2, barY = 26;
            this.uiGraphics.fillStyle(0x000000, 0.55);
            this.uiGraphics.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
            this.uiGraphics.fillStyle(0x442222, 1);
            this.uiGraphics.fillRect(barX, barY, barW, barH);
            this.uiGraphics.fillStyle(0xff3333, 1);
            this.uiGraphics.fillRect(barX, barY, barW * Math.max(0, Math.min(1, extractStatus.progress)), barH);
        }

        // Icons
        let iconX = 300;
        if (hasDoorKey(this.playerStats)) {
            this.uiGraphics.fillStyle(0xFFD700, 1);
            this.uiGraphics.fillCircle(iconX, 22, ui.ICON_RADIUS);
            iconX += ui.ICON_SPACING;
        }
        if (this.playerStats.hasFlashlight) {
            this.uiGraphics.fillStyle(0xffffff, 1);
            this.uiGraphics.fillCircle(iconX, 22, ui.ICON_RADIUS);
            iconX += ui.ICON_SPACING;
        }
        if (this.hasMolotov) {
            this.uiGraphics.fillStyle(0xff4500, 1);
            this.uiGraphics.fillCircle(iconX, 22, ui.ICON_RADIUS);
            iconX += ui.ICON_SPACING;
        }
        if (this.playerStats.hideout.hasSparkPlug) {
            this.uiGraphics.fillStyle(0x00ffff, 1);
            this.uiGraphics.fillCircle(iconX, 22, ui.ICON_RADIUS);
            iconX += ui.ICON_SPACING;
        }
        if (hasEquippedNvg(this.playerStats)) {
            this.uiGraphics.fillStyle(0x00ff00, 1);
            this.uiGraphics.fillCircle(iconX, 22, ui.ICON_RADIUS);
            iconX += ui.ICON_SPACING;
        }
        if (getUsableGrenadeCount(this.playerStats) > 0) {
            this.uiGraphics.fillStyle(0x556B2F, 1);
            this.uiGraphics.fillCircle(iconX, 22, ui.ICON_RADIUS);
            this.uiGraphics.fillStyle(0xffffff, 1);
        }
        
        // Damage log (toggle with ` key) — damage, body part, ARMOR, outcome
        if (this.damageLogBg) this.damageLogBg.setVisible(this.damageLogVisible);
        if (this.damageLogText) {
            this.damageLogText.setVisible(this.damageLogVisible);
            if (this.damageLogVisible && this.damageLog && this.damageLog.length > 0) {
                const lines = this.damageLog.map(e => {
                    if (e.mitigated) return 'ARMOR';
                    const limbName = (e.limbId && LIMB_DISPLAY_NAMES[e.limbId]) ? LIMB_DISPLAY_NAMES[e.limbId] : (e.limbId || '?');
                    const outcomeStr = (e.outcome && e.outcome !== 'damage_only') ? ` (${e.outcome})` : '';
                    return `${e.damage} ${limbName}${outcomeStr}`;
                });
                this.damageLogText.setText('Combat log (`):\n' + lines.join('\n'));
            } else if (this.damageLogVisible) {
                this.damageLogText.setText('Combat log (`):\n(no hits yet)');
            }
        }

        // Dodge cooldown indicator
        const dodgeCooldownRemaining = CONFIG.PLAYER.DODGE_COOLDOWN - (this.time.now - this.lastDodgeTime);
        if (dodgeCooldownRemaining > 0) {
            const cooldownPercent = dodgeCooldownRemaining / CONFIG.PLAYER.DODGE_COOLDOWN;
            this.uiGraphics.fillStyle(0x444444, 0.8);
            this.uiGraphics.fillRect(10, 56, 50, 8);
            this.uiGraphics.fillStyle(0x00ffff, 1);
            this.uiGraphics.fillRect(10, 56, 50 * (1 - cooldownPercent), 8);
        }
        
        // Consumable slots (bottom-left)
        const slotSize = 35;
        const slotSpacing = 5;
        const slotY = 560;
        // Defensive check for consumables array
        if (!this.playerStats.consumables || !Array.isArray(this.playerStats.consumables)) {
            this.playerStats.consumables = [null, null, null];
        }
        
        for (let i = 0; i < 3; i++) {
            const slotX = 15 + i * (slotSize + slotSpacing);
            const consumable = this.playerStats.consumables[i];
            
            // Slot background
            this.uiGraphics.fillStyle(0x222222, 0.8);
            this.uiGraphics.fillRect(slotX, slotY, slotSize, slotSize);
            this.uiGraphics.lineStyle(2, consumable ? 0x00ff00 : 0x444444);
            this.uiGraphics.strokeRect(slotX, slotY, slotSize, slotSize);
            
            // Slot number
            if (!this.consumableSlotTexts) {
                this.consumableSlotTexts = [];
                for (let j = 0; j < 3; j++) {
                    const numText = this.add.text(20 + j * (slotSize + slotSpacing), slotY + slotSize + 2, `${j + 1}`, 
                        { fontSize: '12px', fill: '#888' }).setDepth(101);
                    this.consumableSlotTexts.push(numText);
                    
                    const iconText = this.add.text(20 + j * (slotSize + slotSpacing) + slotSize/2 - 8, slotY + 8, '', 
                        { fontSize: '18px' }).setDepth(101);
                    this.consumableSlotTexts.push(iconText);
                }
            }
            
            // Update slot icon
            const iconTextIdx = i * 2 + 1;
            if (this.consumableSlotTexts && this.consumableSlotTexts[iconTextIdx]) {
                if (consumable && CONFIG.CONSUMABLES[consumable]) {
                    this.consumableSlotTexts[iconTextIdx].setText(CONFIG.CONSUMABLES[consumable].icon);
                } else {
                    this.consumableSlotTexts[iconTextIdx].setText('');
                }
            }
        }
    }
    
    drawLaserSight() {
        if (!this.laserGraphics) return;
        this.laserGraphics.clear();
        
        // Check if laser is toggled on
        if (!this.laserEnabled) return;
        
        // Check if current weapon has laser sight mod
        const weapon = this.playerStats.currentWeapon;
        const modEffects = this.weaponModEffects?.[weapon];
        if (!modEffects || !modEffects.hasLaser) return;
        
        // Draw laser line from player to mouse pointer
        const pointer = this.input.activePointer;
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y);
        
        // Calculate laser endpoint (limited range of 300 pixels)
        const laserRange = 300;
        const endX = this.player.x + Math.cos(angle) * laserRange;
        const endY = this.player.y + Math.sin(angle) * laserRange;
        
        // Draw the laser beam
        this.laserGraphics.lineStyle(1, 0xff0000, 0.8);
        this.laserGraphics.beginPath();
        this.laserGraphics.moveTo(this.player.x, this.player.y);
        this.laserGraphics.lineTo(endX, endY);
        this.laserGraphics.strokePath();
        
        // Draw small dot at end
        this.laserGraphics.fillStyle(0xff0000, 1);
        this.laserGraphics.fillCircle(endX, endY, 3);
    }
    
    shutdown() {
        // Clean up keyboard handlers from level complete choice
        if (this.levelChoiceEnterHandler) {
            this.input.keyboard.off('keydown-ENTER', this.levelChoiceEnterHandler);
            this.levelChoiceEnterHandler = null;
        }
        if (this.levelChoiceEscHandler) {
            this.input.keyboard.off('keydown-ESC', this.levelChoiceEscHandler);
            this.levelChoiceEscHandler = null;
        }
        
        // Clean up timer events
        this.cleanupTimerEvents();
        
        // Clear consumable slot texts reference
        this.consumableSlotTexts = null;
    }
}

// =============================================================================
// GAME CONFIGURATION
// =============================================================================
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#000000',
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 0 } }
    },
    scene: [MainMenuScene, GameScene, HideoutScene],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

const game = new Phaser.Game(config);
// Block browser right-click on the entire document (menus + in-game) so right-click can be used for game actions
document.addEventListener('contextmenu', function (e) { e.preventDefault(); }, true);
