---
name: Permanent Upgrades System
overview: Implement Milestone 7b with permanent upgrades (starting gear, stat boosts, cosmetics) that auto-unlock based on persistent stats, displayed in a new UPGRADES panel in the Hideout.
todos:
  - id: config-upgrades
    content: Add CONFIG.UPGRADES with all 14 upgrades and their requirements
    status: in_progress
  - id: persistent-model
    content: Extend DEFAULT_PERSISTENT with unlockedUpgrades, equippedSkin, equippedMuzzle
    status: pending
  - id: check-upgrades
    content: Add checkUpgrades() function to auto-unlock based on stats
    status: pending
  - id: starting-stats
    content: Create getStartingStats() to apply gear/stat upgrades on new run
    status: pending
  - id: apply-cosmetics
    content: Apply equipped skin tint and muzzle color in GameScene
    status: pending
  - id: damage-boost
    content: Implement +10% damage boost in bullet/melee damage calculations
    status: pending
  - id: upgrades-panel
    content: Add UPGRADES button and showUpgradesPanel() modal with tabs
    status: pending
  - id: equip-cosmetics
    content: Add click-to-equip functionality for skins and muzzle colors
    status: pending
  - id: integration
    content: Wire up upgrade checks at level complete and new run
    status: pending
isProject: false
---

# Milestone 7b: Permanent Upgrades System

## Overview

Add permanent upgrades that unlock based on player progression and persist across all runs. Players can view their progress in a new UPGRADES panel in the Hideout.

---

## Phase 1: Data Model

### Add CONFIG.UPGRADES

Add after CONFIG.CLASSES in [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html):

```javascript
UPGRADES: {
    // Starting Gear
    START_SHOTGUN: { id: 'start_shotgun', name: 'Shotgun Start', desc: 'Begin runs with Shotgun', 
                     category: 'gear', requirement: { stat: 'runsCompleted', value: 10 } },
    START_GRENADE: { id: 'start_grenade', name: 'Grenade Start', desc: 'Begin runs with 1 Grenade',
                     category: 'gear', requirement: { stat: 'totalGrenadeKills', value: 25 } },
    START_FLASHLIGHT: { id: 'start_flashlight', name: 'Flashlight Start', desc: 'Begin runs with Flashlight',
                        category: 'gear', requirement: { stat: 'highestLevelUnlocked', value: 5 } },
    START_AMMO: { id: 'start_ammo', name: 'Ammo Cache', desc: 'Begin runs with +20 Ammo',
                  category: 'gear', requirement: { stat: 'totalKills', value: 100 } },
    
    // Stat Boosts
    HP_BOOST_1: { id: 'hp_boost_1', name: 'Tough I', desc: '+1 Max HP',
                  category: 'stats', requirement: { stat: 'runsCompleted', value: 5 } },
    HP_BOOST_2: { id: 'hp_boost_2', name: 'Tough II', desc: '+2 Max HP',
                  category: 'stats', requirement: { stat: 'runsCompleted', value: 15 } },
    SPEED_BOOST: { id: 'speed_boost', name: 'Fleet Feet', desc: '+5% Movement Speed',
                   category: 'stats', requirement: { stat: 'highestLevelUnlocked', value: 7 } },
    DAMAGE_BOOST: { id: 'damage_boost', name: 'Lethal', desc: '+10% Damage',
                    category: 'stats', requirement: { stat: 'bossesKilled', value: 10 } },
    
    // Cosmetics - Player Skins (tints)
    SKIN_TACTICAL: { id: 'skin_tactical', name: 'Tactical', desc: 'Dark blue player skin',
                     category: 'skin', tint: 0x4466aa, requirement: { stat: 'runsStarted', value: 10 } },
    SKIN_SURVIVOR: { id: 'skin_survivor', name: 'Survivor', desc: 'Battle-worn red skin',
                     category: 'skin', tint: 0xaa4444, requirement: { stat: 'runsStarted', value: 25 } },
    SKIN_GHOST: { id: 'skin_ghost', name: 'Ghost', desc: 'Pale stealth skin',
                  category: 'skin', tint: 0xaaaacc, requirement: { stat: 'meleeKills', value: 50 } },
    
    // Cosmetics - Muzzle Flash Colors
    MUZZLE_BLUE: { id: 'muzzle_blue', name: 'Blue Flash', desc: 'Blue muzzle flash',
                   category: 'muzzle', color: 0x00aaff, requirement: { stat: 'totalShotsFired', value: 1000 } },
    MUZZLE_RED: { id: 'muzzle_red', name: 'Red Flash', desc: 'Red muzzle flash',
                  category: 'muzzle', color: 0xff4444, requirement: { stat: 'bossesKilled', value: 5 } },
    MUZZLE_GREEN: { id: 'muzzle_green', name: 'Green Flash', desc: 'Green muzzle flash',
                    category: 'muzzle', color: 0x44ff44, requirement: { stat: 'totalScrapCollected', value: 300 } }
}
```

### Extend DEFAULT_PERSISTENT

Add to persistent data:

```javascript
// Permanent upgrades (auto-unlock tracking handled by checkUpgrades)
unlockedUpgrades: [],
// Equipped cosmetics
equippedSkin: null,      // null = default green
equippedMuzzle: null,    // null = default yellow/orange
// For speedrun tracking (future use)
bestLevelTimes: {}       // { level1: ms, level2: ms, ... }
```

---

## Phase 2: Unlock System

### Add checkUpgrades Function

Similar to checkAchievements, checks persistent stats against upgrade requirements:

```javascript
function checkUpgrades(persistent) {
    const newUpgrades = [];
    
    Object.values(CONFIG.UPGRADES).forEach(upgrade => {
        if (persistent.unlockedUpgrades.includes(upgrade.id)) return;
        
        const req = upgrade.requirement;
        let currentValue = persistent[req.stat];
        
        // Handle special cases
        if (req.stat === 'highestLevelUnlocked') {
            // This is in main stats, not persistent - need to pass it
            return; // Handle separately
        }
        
        if (currentValue >= req.value) {
            persistent.unlockedUpgrades.push(upgrade.id);
            newUpgrades.push(upgrade);
        }
    });
    
    return newUpgrades;
}
```

### Track highestLevelUnlocked in Persistent

Currently `highestLevelUnlocked` is in main stats. Copy to persistent on level complete for upgrade tracking.

---

## Phase 3: Apply Upgrades

### Modify DEFAULT_STATS Generation

When starting a new run, apply unlocked upgrades:

```javascript
function getStartingStats(persistent) {
    const stats = JSON.parse(JSON.stringify(DEFAULT_STATS));
    
    // Apply starting gear upgrades
    if (persistent.unlockedUpgrades.includes('start_shotgun')) stats.hasShotgun = true;
    if (persistent.unlockedUpgrades.includes('start_grenade')) stats.grenades = 1;
    if (persistent.unlockedUpgrades.includes('start_flashlight')) stats.hasFlashlight = true;
    if (persistent.unlockedUpgrades.includes('start_ammo')) stats.ammo += 20;
    
    // Apply stat boosts
    if (persistent.unlockedUpgrades.includes('hp_boost_1')) { stats.hp += 1; stats.maxHp += 1; }
    if (persistent.unlockedUpgrades.includes('hp_boost_2')) { stats.hp += 2; stats.maxHp += 2; }
    
    return stats;
}
```

### Apply Speed/Damage Boosts in GameScene

In GameScene.create(), after loading persistent:

```javascript
// Apply permanent stat boosts
if (this.persistent.unlockedUpgrades?.includes('speed_boost')) {
    this.baseSpeedMultiplier *= 1.05; // Stacks with Scout
    this.speedMultiplier = this.baseSpeedMultiplier;
}
this.permanentDamageBoost = this.persistent.unlockedUpgrades?.includes('damage_boost') ? 1.1 : 1;
```

Apply damage boost in bullet damage calculation.

### Apply Cosmetics in GameScene

```javascript
// Apply equipped skin
if (this.persistent.equippedSkin) {
    const skinUpgrade = Object.values(CONFIG.UPGRADES).find(u => u.id === this.persistent.equippedSkin);
    if (skinUpgrade?.tint) this.player.setTint(skinUpgrade.tint);
}

// Store muzzle color for shooting
this.muzzleFlashColor = 0xffff00; // default
if (this.persistent.equippedMuzzle) {
    const muzzleUpgrade = Object.values(CONFIG.UPGRADES).find(u => u.id === this.persistent.equippedMuzzle);
    if (muzzleUpgrade?.color) this.muzzleFlashColor = muzzleUpgrade.color;
}
```

---

## Phase 4: UPGRADES Panel UI

### Add UPGRADES Button to HideoutScene

Add button near CLASS button:

```javascript
const upgradesBtn = this.add.rectangle(600, 495, 180, 50, 0x886600).setInteractive();
this.add.text(600, 495, "UPGRADES", { fontSize: '20px', fill: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
upgradesBtn.on('pointerdown', () => { sfx.menuOpen(); this.showUpgradesPanel(); });
```

### showUpgradesPanel() Method

Modal with tabs for each category:

- **GEAR** tab: Starting gear unlocks
- **STATS** tab: Stat boosts
- **SKINS** tab: Player skins (click to equip)
- **EFFECTS** tab: Muzzle flash colors (click to equip)

Each upgrade shows:

- Name and description
- Locked: Progress bar (current/required)
- Unlocked: Checkmark, equip button for cosmetics

---

## Phase 5: Integration Points

### New Run (MainMenuScene)

Replace `DEFAULT_STATS` with `getStartingStats(persistent)`:

```javascript
this.createButton(400, 240, "NEW RUN", 0x880000, () => {
    if(confirm("Start a new run?")) {
        const persistent = loadPersistent();
        const stats = getStartingStats(persistent);
        // ... start game
    }
});
```

### Level Complete

Sync `highestLevelUnlocked` to persistent:

```javascript
if (this.playerStats.highestLevelUnlocked > (this.persistent.highestLevelUnlocked || 0)) {
    this.persistent.highestLevelUnlocked = this.playerStats.highestLevelUnlocked;
}
// Check for new upgrades
const newUpgrades = checkUpgrades(this.persistent);
newUpgrades.forEach(u => {
    sfx.achievement();
    this.showFloatingText(400, 250, `UPGRADE: ${u.name}!`, 0xffaa00);
});
```

### Muzzle Flash

Modify muzzle flash rendering to use `this.muzzleFlashColor`.

---

## Files Modified

- [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html) - All changes

## Summary of Upgrades


| Category | Upgrade          | Requirement         | Effect                |
| -------- | ---------------- | ------------------- | --------------------- |
| Gear     | Shotgun Start    | 10 extractions      | Start with Shotgun    |
| Gear     | Grenade Start    | 25 grenade kills    | Start with 1 Grenade  |
| Gear     | Flashlight Start | Complete Level 4    | Start with Flashlight |
| Gear     | Ammo Cache       | 100 total kills     | Start with +20 Ammo   |
| Stats    | Tough I          | 5 extractions       | +1 Max HP             |
| Stats    | Tough II         | 15 extractions      | +2 Max HP             |
| Stats    | Fleet Feet       | Complete all levels | +5% Speed             |
| Stats    | Lethal           | 10 boss kills       | +10% Damage           |
| Skin     | Tactical         | 10 runs started     | Blue tint             |
| Skin     | Survivor         | 25 runs started     | Red tint              |
| Skin     | Ghost            | 50 melee kills      | Pale tint             |
| Muzzle   | Blue Flash       | 1000 shots fired    | Blue muzzle           |
| Muzzle   | Red Flash        | 5 boss kills        | Red muzzle            |
| Muzzle   | Green Flash      | 300 scrap collected | Green muzzle          |


