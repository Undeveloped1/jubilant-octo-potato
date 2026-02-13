---
name: Skill Tree and Challenges
overview: Implement Skill Tree System (15 skills across 3 branches) followed by Challenge System (daily/weekly missions) that awards skill points, creating a complete progression loop.
todos:
  - id: skill-config
    content: Add CONFIG.SKILLS with all 15 skills across 3 branches
    status: completed
  - id: skill-persistent
    content: Add skillPoints, totalSkillPoints, unlockedSkills to DEFAULT_PERSISTENT
    status: completed
  - id: skill-tree-ui
    content: Create Skill Tree UI modal in HideoutScene with branch layout
    status: completed
  - id: skill-unlock
    content: Implement skill purchase logic with prerequisite checking
    status: completed
  - id: skill-effects
    content: Apply all 15 skill effects in GameScene (damage reduction, regen, reload speed, etc.)
    status: completed
  - id: skill-point-earn
    content: Add skill point earning calculation at run completion
    status: completed
  - id: challenge-config
    content: Add CONFIG.CHALLENGES with daily/weekly/permanent templates
    status: completed
  - id: challenge-persistent
    content: Add challenge tracking fields to DEFAULT_PERSISTENT
    status: completed
  - id: challenge-rotation
    content: Implement daily/weekly challenge rotation with timestamp resets
    status: completed
  - id: challenge-ui
    content: Create Challenges UI modal showing active challenges with progress
    status: completed
  - id: challenge-tracking
    content: Hook challenge progress updates into kill/extraction events
    status: completed
isProject: false
---

# Skill Tree and Challenge System Implementation

## Phase 1: Skill Tree System

### 1.1 Data Structures

Add to `CONFIG` in [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html):

```javascript
CONFIG.SKILLS = {
    // Survival Branch
    THICK_SKIN: { id: 'thick_skin', branch: 'survival', name: 'Thick Skin', 
                  desc: '-10% damage taken', cost: 2, effect: { type: 'damage_reduction', value: 0.1 } },
    IRON_WILL: { id: 'iron_will', branch: 'survival', name: 'Iron Will',
                 desc: '-20% damage taken', cost: 4, requires: 'thick_skin', effect: { type: 'damage_reduction', value: 0.2 } },
    SECOND_WIND: { id: 'second_wind', branch: 'survival', name: 'Second Wind',
                   desc: 'Survive one lethal hit per run', cost: 6, effect: { type: 'cheat_death' } },
    REGENERATION: { id: 'regeneration', branch: 'survival', name: 'Regeneration',
                    desc: 'Heal 1 HP every 60s', cost: 5, effect: { type: 'regen', interval: 60000 } },
    LAST_STAND: { id: 'last_stand', branch: 'survival', name: 'Last Stand',
                  desc: '+50% damage below 25% HP', cost: 4, effect: { type: 'low_hp_damage', threshold: 0.25, bonus: 0.5 } },
    // Stealth Branch (5 skills)
    // Utility Branch (5 skills)
};
```

Add to `DEFAULT_PERSISTENT`:

```javascript
skillPoints: 0,           // Spendable points
totalSkillPoints: 0,      // Lifetime earned (for stats)
unlockedSkills: [],       // Array of skill IDs
```

### 1.2 Skill Point Earning

Points awarded at end of each run based on performance:

- Base: 1 point per extraction
- Bonus: +1 for no damage taken
- Bonus: +1 for boss killed
- Bonus: +1 for 50%+ accuracy

Add `calculateRunSkillPoints(persistent)` function.

### 1.3 Skill Tree UI

New "SKILLS" button in HideoutScene (next to UPGRADES button).
Modal with three vertical branches displayed side-by-side.

```
┌─────────────────────────────────────────────┐
│            SKILL TREE  [12 pts]             │
├─────────────┬─────────────┬─────────────────┤
│  SURVIVAL   │   STEALTH   │    UTILITY      │
├─────────────┼─────────────┼─────────────────┤
│ [Thick Skin]│ [Light Feet]│ [Quick Hands]   │
│      ↓      │      ↓      │      ↓          │
│ [Iron Will] │[Shadow Step]│  [Haggler]      │
│      ↓      │      ↓      │      ↓          │
│[Second Wind]│[Silent Kill]│  [Scrapper]     │
│             │      ↓      │      ↓          │
│[Regeneration│  [Ambush]   │ [Swift Reload]  │
│             │      ↓      │      ↓          │
│ [Last Stand]│   [Ghost]   │  [Pack Mule]    │
└─────────────┴─────────────┴─────────────────┘
```

- Locked skills: Gray, show cost
- Affordable skills: Highlighted, clickable
- Unlocked skills: Green checkmark

### 1.4 Apply Skill Effects

Modify existing code in GameScene:


| Skill                  | Where to Apply                                   |
| ---------------------- | ------------------------------------------------ |
| Thick Skin / Iron Will | `hitPlayer()` - multiply damage                  |
| Second Wind            | `handlePlayerDeath()` - check for cheat death    |
| Regeneration           | `create()` - add timer event (stacks with Medic) |
| Last Stand             | `fireBullet()` and melee - check HP threshold    |
| Light Feet             | `footstep()` - reduce volume                     |
| Shadow Step            | `updateStealthMechanics()` - reduce vision range |
| Silent Killer          | `meleeAttack()` - flag for stealth               |
| Ambush                 | Bullet/melee damage - check enemy awareness      |
| Ghost                  | Detection decay rate increase                    |
| Pack Mule              | `DEFAULT_STATS.consumables` - 4 slots            |
| Quick Hands            | Crate opening time reduction                     |
| Haggler                | `purchaseItem()` - apply discount                |
| Scrapper               | `spawnLootSkull()` - multiply scrap              |
| Swift Reload           | `startReload()` - reduce time                    |


---

## Phase 2: Challenge System

### 2.1 Data Structures

```javascript
CONFIG.CHALLENGES = {
    DAILY: [
        { id: 'melee_15', name: 'Melee Master', desc: 'Kill 15 enemies with melee', 
          target: 15, stat: 'runMeleeKills', reward: 2, type: 'daily' },
        { id: 'no_grenades', name: 'Pacifist Explosives', desc: 'Complete any level without grenades',
          target: 1, stat: 'levelNoGrenades', reward: 1, type: 'daily' },
        // 8-10 more daily templates
    ],
    WEEKLY: [
        { id: 'kills_50', name: 'Exterminator', desc: 'Kill 50 enemies this week',
          target: 50, stat: 'weeklyKills', reward: 4, type: 'weekly' },
        { id: 'extract_3', name: 'Globetrotter', desc: 'Extract from 3 different levels',
          target: 3, stat: 'weeklyLevelsExtracted', reward: 3, type: 'weekly' },
        // 8-10 more weekly templates
    ],
    PERMANENT: [
        { id: 'crossbow_100', name: 'Bolt Action', desc: 'Kill 100 enemies with crossbow',
          target: 100, stat: 'crossbowKills', reward: { type: 'cosmetic', id: 'skin_hunter' } },
        // More permanent challenges
    ]
};
```

Add to `DEFAULT_PERSISTENT`:

```javascript
// Challenge tracking
activeDailies: [],         // 3 active daily challenges with progress
activeWeeklies: [],        // 5 active weekly challenges with progress
completedPermanents: [],   // IDs of completed permanent challenges
dailyResetTime: 0,         // Unix timestamp for next daily reset
weeklyResetTime: 0,        // Unix timestamp for next weekly reset
// Tracking stats for challenges
crossbowKills: 0,
weeklyKills: 0,
weeklyLevelsExtracted: [],
```

### 2.2 Challenge Rotation

- `checkChallengeReset(persistent)` - Called on game load
- Daily reset: Every 24 hours at midnight UTC
- Weekly reset: Every Monday at midnight UTC
- Randomly select from challenge pools

### 2.3 Challenge UI

New "CHALLENGES" button in HideoutScene.
Modal showing active challenges with progress bars.

```
┌─────────────────────────────────────────────┐
│              CHALLENGES                     │
├─────────────────────────────────────────────┤
│ DAILY (Resets in 14h 32m)                   │
│ ┌─────────────────────────────────────────┐ │
│ │ ⚔️ Melee Master: 8/15 kills  [2 pts]   │ │
│ │ ████████░░░░░░░░░░░░                    │ │
│ └─────────────────────────────────────────┘ │
│ ... 2 more dailies                          │
├─────────────────────────────────────────────┤
│ WEEKLY (Resets in 4d 14h)                   │
│ ... 5 weekly challenges                     │
├─────────────────────────────────────────────┤
│ PERMANENT                                   │
│ ... Long-term challenges                    │
└─────────────────────────────────────────────┘
```

### 2.4 Challenge Progress Tracking

Hook into existing stat tracking:

- `spawnLootSkull()` - Track kills by weapon type
- `winGame()` / level completion - Track extractions
- Various gameplay events - Increment challenge progress

`updateChallengeProgress(persistent, stat, amount)` - Central function.

---

## Key Files Modified

All changes in [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html):

1. **CONFIG section** (~line 24-324): Add SKILLS and CHALLENGES
2. **DEFAULT_PERSISTENT** (~line 355-391): Add skill/challenge fields
3. **loadPersistent()** (~line 863): Ensure new fields exist
4. **HideoutScene** (~line 2024): Add SKILLS and CHALLENGES buttons + modals
5. **GameScene.create()** (~line 3415): Apply skill effects on run start
6. **GameScene.hitPlayer()** (~line 5041): Apply damage reduction skills
7. **GameScene.handlePlayerDeath()** (~line 5086): Check Second Wind
8. **GameScene.fireBullet()** (~line 4924): Apply Last Stand damage bonus
9. **GameScene.startReload()** (~line 3827): Apply Swift Reload
10. **GameScene.spawnLootSkull()** (~line 3912): Apply Scrapper bonus + track challenges
11. **GameScene.winGame()**: Award skill points + update challenges

---

## Implementation Order

1. Add CONFIG.SKILLS with all 15 skills defined
2. Add persistent data fields for skills
3. Implement Skill Tree UI modal in HideoutScene
4. Implement skill unlocking logic
5. Apply skill effects throughout GameScene (one by one)
6. Add skill point earning at run completion
7. Test all skills work correctly
8. Add CONFIG.CHALLENGES definitions
9. Add persistent data fields for challenges
10. Implement challenge rotation/reset logic
11. Implement Challenge UI modal in HideoutScene
12. Hook challenge progress tracking into gameplay
13. Test daily/weekly reset and rewards

