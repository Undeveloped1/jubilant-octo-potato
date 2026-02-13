# Zombie Extraction Game - Project Guide

## Overview

A top-down zombie survival extraction game built with **Phaser 3**. The entire game is contained in a single HTML file (`game.html`) with embedded JavaScript (~9200 lines).

**Current Build**: v24.1 (single-player)  
**Save Version**: v24

---

## Tomorrow / Next session

- **Leaper vs bandit attack – dissect and fix**  
  Leaper still spins in circles after leaping and does not deal damage to bandits. Need to trace the full flow: how the leaper decides to leap at a bandit, how the LEAP state and hit detection work (distance check in `Enemy` update, enemy–enemy overlap), and why pin/knockback + damage never apply. Possible causes: update order, `this.target` vs “any bandit in range”, collision pushing bodies apart, or state never transitioning to PINNING/COOLDOWN.

---

## Known issues (bug list)

| Risk   | Issue | Notes |
|--------|--------|------|
| **Medium** | **Loot box / crate spawns on room re-entry** | Unlooted crates are saved/restored per room (`crateState`, `restoreCratesFromState`), with dedupe-by-position and clear-after-restore. Users still report issues: boxes duplicating, disappearing, or sprites not showing when leaving and re-entering rooms or exiting risk room. Needs further repro and possibly a different approach (e.g. don't destroy then restore; keep crates in scene and only hide/show per room). |

---

## Architecture

### File Structure

```
LovelyLadyLumps/
├── game.html              # Main game file (all code)
├── ROADMAP.md             # Feature roadmap and changelog
├── PROJECT_GUIDE.md       # This file
├── sprite_*.png           # Character/enemy sprites
├── leaper_idle_*.png      # Leaper animation frames
├── .cursor/
│   ├── rules/             # AI assistant rules
│   └── plans/             # Implementation plans
└── .vscode/
    └── settings.json
```

### Scene Flow

```
MainMenuScene
    ├── New Game → HideoutScene (fresh stats)
    ├── Continue → HideoutScene (loaded stats)
    └── Settings → Settings modal
    
HideoutScene (Hub)
    ├── Upgrades (Rest Area, Generator, Armory, Workbench, Repair Station)
    ├── Trader (Buy/Sell)
    ├── Mission Map → GameScene (selected level)
    ├── Class Selection
    ├── Skills Panel
    ├── Challenges Panel
    └── Upgrades Panel (permanent progression)
    
GameScene (Gameplay)
    ├── Level 1-6: Door exit → Level Complete Choice → Continue/Hideout
    └── Level 5,7: Extraction → winGame() → HideoutScene
```

---

## Configuration Reference

All configuration is in the `CONFIG` object at the top of `game.html`.

### CONFIG.WEAPONS
Weapon statistics for all 5 weapons.
```javascript
PISTOL:   { DAMAGE: 1, FIRE_RATE: 250, MAG_SIZE: 12, RELOAD_TIME: 1500 }
SHOTGUN:  { DAMAGE: 1, FIRE_RATE: 600, MAG_SIZE: 6,  PELLETS: 5 }
SMG:      { DAMAGE: 1, FIRE_RATE: 100, MAG_SIZE: 30 }
CROSSBOW: { DAMAGE: 3, FIRE_RATE: 800, MAG_SIZE: 1,  PIERCING: true, SILENT: true }
RIFLE:    { DAMAGE: 2, FIRE_RATE: 200, MAG_SIZE: 20 }
```

### CONFIG.ENEMIES
Enemy types with HP, damage, speed, and special behaviors.
- Walker, Leaper, Bandit, Spitter, Exploder, Boss, Necromancer

### CONFIG.CURRENCIES
Three-currency economy system.
```javascript
SCRAP:     { color: 0xffaa00 }  // From walkers, spitters, leapers
CREDITS:   { color: 0x00ff00 }  // From bandits
MATERIALS: { color: 0x8888ff }  // From bosses
```

### CONFIG.CLASSES
Four character classes with passive abilities.
- **Survivor**: No passive (default)
- **Scout**: +20% speed, silent footsteps
- **Medic**: Regen 1 HP every 30s
- **Scavenger**: +50% loot drops

### CONFIG.UPGRADES
14 permanent upgrades unlocked by progression stats.
- Starting Gear (4): Shotgun, Grenade, Flashlight, Ammo Cache
- Stat Boosts (4): Tough I/II, Fleet Feet, Lethal
- Cosmetics (6): Player skins, muzzle flash colors

### CONFIG.SKILLS
15 skills across 3 branches, purchased with skill points.
- **Survival**: Damage reduction, Second Wind, Regeneration, Last Stand
- **Stealth**: Light Feet, Shadow Step, Silent Killer, Ambush, Ghost
- **Utility**: Quick Hands, Haggler, Scrapper, Swift Reload, Pack Mule

### CONFIG.CHALLENGES
Daily (8 templates), Weekly (5 templates), Permanent (4) challenges.
- Daily reset: Midnight UTC
- Weekly reset: Monday midnight UTC
- Rewards: Skill points (daily/weekly), Cosmetics (permanent)

### CONFIG.LEVEL_GRIDS
Procedural room grid dimensions per level.
```javascript
1: { cols: 2, rows: 2, theme: 'STREET' },      // 4 rooms
2: { cols: 2, rows: 2, theme: 'APARTMENT' },   // 4 rooms
3: { cols: 2, rows: 2, theme: 'ROOFTOP' },     // 4 rooms
4: { cols: 3, rows: 2, theme: 'SEWERS' },      // 6 rooms (maze)
5: { cols: 2, rows: 1, theme: 'HOSPITAL' },    // 2 rooms (boss)
6: { cols: 3, rows: 2, theme: 'MALL' },        // 6 rooms
7: { cols: 2, rows: 1, theme: 'CEMETERY' }     // 2 rooms (boss)
```

### CONFIG.ROOM_CHUNKS
Room templates for each level theme. Each chunk defines:
- `floor`: Floor texture
- `walls`: Array of wall positions and scales
- `spawnPoints`: Valid enemy spawn locations
- `crateSlots`: Valid crate positions
- `doorPositions`: Which sides can have doors (north/south/east/west)
- `isBossRoom`: (optional) Boss room flag

### CONFIG.TRADER
Hideout shop stock (`HIDEOUT_STOCK`), sell rate, and **in-level trader**:
- `IN_LEVEL_SPAWN_CHANCE: 0.25` — at most one trader per level, 25% chance; eligible rooms are non-start, non-exit, non-boss (levels 5 and 7 have 0 eligible rooms).
- `IN_LEVEL_STOCK` — array of item IDs (e.g. ammo_bundle, med_kit, grenade, adrenaline, armor_patch) shown in the in-level buy list (no mods).
- In-level traders use the same run stats (scrap, credits, materials) and **F** to interact when near the trader NPC.

### CONFIG.RISK_ROOM
Risk room configuration.
```javascript
SPAWN_CHANCE: 0.25,        // 25% per eligible room
ENEMY_MULTIPLIER: 1.5,     // More enemies
LOOT_MULTIPLIER: 2.0,      // Better drops
ENEMY_UPGRADES: {          // Harder enemies
    walker: 'leaper',
    leaper: 'bandit',
    spitter: 'exploder'
}
```

---

## Save Data

### DEFAULT_STATS (Per-Run)
State that resets each new game.
```javascript
{
    hp, maxHp, stamina, ammo, scrap, credits, materials, grenades,
    nextLevel, highestLevelUnlocked,
    consumables: [null, null, null],
    hasFlashlight, hasShotgun, hasSMG, hasCrossbow, hasRifle,
    currentWeapon, magazines: {...},
    armor: { head, body, arms, feet },
    hideout: { restAreaLvl, generatorLvl, workbenchLvl, ... }
}
```

### DEFAULT_PERSISTENT (Cross-Run)
Progression that survives across all runs.
```javascript
{
    // Lifetime stats
    totalKills, totalDeaths, runsCompleted, runsStarted,
    totalShotsFired, totalShotsHit, totalScrapCollected, ...
    
    // Run stats (reset each run)
    runKills, runShotsFired, runDamageTaken, ...
    
    // Progression systems
    achievements: [],
    unlockedClasses: ['survivor'], selectedClass: 'survivor',
    unlockedUpgrades: [], equippedSkin, equippedMuzzle,
    
    // Skill Tree
    skillPoints, totalSkillPoints, unlockedSkills: [],
    
    // Challenges
    activeDailies: [], activeWeeklies: [], completedPermanents: [],
    dailyResetTime, weeklyResetTime,
    weeklyKills, weeklyExtractions, weeklyBossKills, ...
}
```

### Save Keys
- `zombie_save_v17` - Current run stats
- `zombie_persistent_v17` - Persistent progression
- `zombie_settings_v17` - Audio/display settings

---

## Implementation Patterns

### Adding a New Feature

1. **Define Configuration**
   ```javascript
   // Add to CONFIG object
   CONFIG.NEW_FEATURE = {
       ITEM_A: { id: 'item_a', name: 'Item A', effect: 0.1 },
       // ...
   };
   ```

2. **Add Persistent Data** (if needed)
   ```javascript
   // In DEFAULT_PERSISTENT
   newFeatureData: [],
   newFeatureStat: 0,
   ```

3. **Add Migration Code**
   ```javascript
   // In loadPersistent(), after const merged = {...}
   if (!merged.newFeatureData || !Array.isArray(merged.newFeatureData)) {
       merged.newFeatureData = [];
   }
   if (merged.newFeatureStat === undefined) {
       merged.newFeatureStat = 0;
   }
   ```

4. **Add UI in HideoutScene**
   ```javascript
   // Button
   const newBtn = this.add.rectangle(x, y, w, h, color).setInteractive();
   this.add.text(x, y, "LABEL", {...}).setOrigin(0.5);
   newBtn.on('pointerdown', () => this.showNewFeaturePanel());
   
   // Modal method
   showNewFeaturePanel() {
       const elements = [];
       this.persistent = loadPersistent(); // Fresh data
       // ... build UI ...
       closeBtn.on('pointerdown', () => {
           elements.forEach(e => e.destroy());
           this.scene.restart({ stats: this.stats }); // Refresh labels
       });
   }
   ```

5. **Apply Effects in GameScene**
   ```javascript
   // In GameScene.create(), after loading persistent
   if (this.persistent.newFeatureData?.includes('item_a')) {
       this.someMultiplier = 1.1;
   }
   ```

6. **Track Progress** (if applicable)
   ```javascript
   // In BOTH nextLevel() AND winGame()
   this.persistent.newFeatureStat++;
   savePersistent(this.persistent);
   ```

### Modal UI Pattern

```javascript
showXxxPanel() {
    const elements = [];
    
    // Always reload persistent data
    this.persistent = loadPersistent();
    
    // Dark overlay
    const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85).setDepth(499);
    elements.push(overlay);
    
    // Modal background
    const modalBg = this.add.rectangle(400, 300, 600, 400, 0x1a1a1a, 0.98)
        .setDepth(500).setStrokeStyle(3, 0x886600);
    elements.push(modalBg);
    
    // Title
    const title = this.add.text(400, 120, "PANEL TITLE", {...}).setOrigin(0.5).setDepth(501);
    elements.push(title);
    
    // Content...
    
    // Close button - MUST restart scene
    const closeBtn = this.add.text(400, 480, "[ CLOSE ]", {...})
        .setOrigin(0.5).setDepth(510).setInteractive();
    elements.push(closeBtn);
    closeBtn.on('pointerdown', () => {
        sfx.menuClose();
        elements.forEach(e => e.destroy());
        this.scene.restart({ stats: this.stats });
    });
}
```

---

## Testing & Debugging

### Quick Testing

1. **Level Select** (Main Menu)
   - Bottom-right button, all levels unlocked
   - Useful for testing specific level mechanics

2. **God Mode**
   - At cheat code prompt, enter: `god mode`
   - Makes player invincible

3. **Browser Console**
   - Check for save/load errors
   - Inspect `localStorage` for save data:
     ```javascript
     JSON.parse(localStorage.getItem('zombie_persistent_v17'))
     ```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Button shows wrong count | Static label, not refreshed | Restart scene on modal close |
| Skill/challenge not tracking | Only in winGame() | Add tracking to nextLevel() too |
| Old save missing fields | No migration code | Add defaults in loadPersistent() |
| Effect not applying | Not loaded in create() | Check GameScene.create() initialization |

---

## Workflow Best Practices

### Before Starting a Feature

1. **Check ROADMAP.md** for specifications
2. **Switch to planning mode** for non-trivial features
3. **Clarify design decisions**:
   - Does it persist between runs?
   - How is it acquired? (loot, trader, crafting, unlock)
   - Where is the UI? (hideout, in-game, both)
4. **Look at similar features** for implementation patterns

### Planning Phase (CRITICAL for Core Gameplay Changes)

For features that change core gameplay flow (like room systems, level transitions, or loot distribution), spend extra time in planning:

#### 1. UX Walkthrough
Mentally trace the COMPLETE player journey:
```
Start → What do they see? → What actions do they take? → 
Where do they expect to end up? → How do they know they succeeded?
```

Example questions for a room system:
- "If I walk through a door, where do I expect to appear?"
- "How will the player know which door leads to the exit?"
- "What if they want to go back?"

#### 2. Check Existing Patterns
**ALWAYS search the codebase** before writing new code that references variables:
```javascript
// WRONG: Assumed variable name
this.lootSkulls.clear()

// RIGHT: Search first, found existing pattern
this.skulls.clear()  // Actual variable name in codebase
```

Use grep/search for:
- Similar feature implementations
- Variable naming conventions
- How existing systems handle the same problem

#### 3. Essential Mechanics Checklist
When modifying level structure, verify these still work:
- [ ] **Keys**: Can spawn, can be collected, unlock works
- [ ] **Level exit**: Clearly visible, reachable, interactable
- [ ] **Progression**: Level unlock, skill points awarded
- [ ] **Save/load**: State persists correctly
- [ ] **Boss levels**: Special mechanics preserved (switches, extraction)

#### 4. Multi-System Integration
List ALL systems that interact with your feature:
```
Room System touches:
├── Loot spawning (keys must spawn somewhere reachable)
├── Enemy spawning (per-room, not per-level)
├── Door interactions (room doors vs level exit)
├── Player positioning (where to spawn after transition)
├── Minimap (visual representation)
└── Boss mechanics (boss rooms need special handling)
```

For each system, ask: "Does my implementation break this? Does it need modification?"

#### 5. Visual Hierarchy
For any UI/gameplay elements, define clear visual distinction:
```
Exit Door:     Gold, 1.5x scale, "EXIT" label
Room Door:     Gray, normal scale, no label
Risk Door:     Red, pulsing, ⚠️ warning
```

### During Implementation

1. Follow the standard feature pattern above
2. Use existing sfx methods for sounds
3. Match existing UI styling (colors, fonts, depths)
4. Test incrementally
5. **Reference existing variable names** - don't assume

### After Implementation

1. **Update ROADMAP.md** with completion status
2. **Test thoroughly**:
   - New game flow
   - Continue game flow (save/load)
   - Edge cases (empty inventory, max values)
3. **Verify migrations** work for old saves
4. **Full player journey test** - play through the feature as a user would

---

## Level Reference

| Level | Name | Rooms | Key Mechanic | Exit Type |
|-------|------|-------|--------------|-----------|
| 1 | Street | 2x2 (4) | Key required | Door |
| 2 | Apartment | 2x2 (4) | Debris clearing | Door |
| 3 | Rooftop | 2x2 (4) | Key required | Door |
| 4 | Sewers | 3x2 (6) | Key required | Door |
| 5 | Hospital | 2x1 (2) | Boss fight | Switch → Extraction |
| 6 | Mall | 3x2 (6) | Key required, Exploders | Door |
| 7 | Cemetery | 2x1 (2) | Stealth + Necromancer boss | Switch → Extraction |

### Room System Overview
- Each level is a grid of connected rooms
- **Start room**: Player spawns here (Room 0)
- **Exit room**: Contains level exit door (last room in grid)
- **Risk rooms**: 25% chance per eligible room, red door with ⚠️, harder enemies + better loot
- **Keys**: Always spawn in first non-start room visited (guaranteed)
- **Minimap**: Top-right shows room grid (Blue=current, Yellow=exit, Green=cleared)

---

*Last Updated: Build 24.1*
