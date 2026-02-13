# Zombie Extraction Game - Development Roadmap

## Current State: Build 24.1 (Single-player / Streamlined UI)

### Completed Features
- **7 Levels**: Street → Apartment → Rooftop → Sewers → Hospital → Mall → Cemetery
- **7 Enemy Types**: Walker, Leaper, Bandit, Spitter, Boss, Exploder, Necromancer
- **5 Weapons**: Pistol, Shotgun, SMG, Crossbow (silent/piercing), Assault Rifle (accurate)
- **Combat**: Dodge roll (SPACE), reload (R), melee (E), grenades (G), muzzle flash, low HP vignette, **mouse wheel weapon swap**
- **Hideout (Tabbed UI)**: FACILITIES tab (Rest Area, Generator, Armory, Workbench, Repair Station), CHARACTER tab (Class, Skills, Upgrades, Mods, Stats, Challenges), SHOP tab (Trader)
- **Economy**: 3 currencies (Scrap, Credits, Materials), Buy/Sell system (including mod selling), Consumables (1-2-3 keys)
- **Weapon Mods**: 5 mods (Extended Mag, Suppressor, Laser Sight, Damage Barrel, Rapid Fire), 2 slots per weapon, **sellable for materials**
- **Mission Map**: Visual city overview with selectable levels, sequential unlocking, replay any cleared level
- **Level Transitions**: Post-level choice screen (Continue to next OR return to Hideout)
- **Stealth System**: Detection meter, patrol enemies, vision cones (Cemetery level)
- **Character Classes**: 4 classes (Survivor, Scout, Medic, Scavenger) with passive abilities, achievement-based unlocks
- **Permanent Upgrades**: 14 upgrades (starting gear, stat boosts, cosmetics) that auto-unlock based on progression
- **Skill Tree**: 15 skills across 3 branches (Survival, Stealth, Utility), spend skill points earned from runs
- **Challenge System**: Daily (3), Weekly (5), and Permanent challenges with skill point rewards
- **Roguelike Rooms**: Procedural room grids (2x2 to 3x2), themed chunks per level, 1 risk room per level (25% chance)
- **Progression**: 13 achievements, persistent stats, `highestLevelUnlocked` tracking, save/load system
- **Polish**: Settings menu with controls display, hit indicators, 25+ procedural sounds, customizable muzzle flash colors, **minimap**
- **Streamlined Main Menu**: Clean title, NEW RUN/CONTINUE buttons, icon-based export/import/settings

---

## Milestone 5: Trader & Expanded Loot System ✅ COMPLETE

**Status**: Implemented in v15.0

### What Was Built
- **Three-Currency System**:
  - Scrap (dropped by Walkers, Spitters, Leapers) - used for crafting
  - Credits (dropped by Bandits) - used for trader purchases
  - Materials (dropped by Bosses) - used for upgrades
- **Hideout Trader**: Yellow button opens modal with Buy/Sell tabs
- **Trader Stock**: Ammo Bundle, Med Kit, Grenade, Adrenaline Shot, Armor Patch
- **Consumables System**: 3 inventory slots, used with 1, 2, 3 keys
  - Adrenaline Shot: +50% speed for 10 seconds
  - Armor Patch: Repairs all equipped armor by 20 durability
- **Currency Auto-Collection**: Enemies drop currency that auto-collects with floating text

### Deferred Features
- (None; in-level traders implemented in Milestone 10)

---

## Milestone 10: In-Level Traders ✅ COMPLETE (Continuous Improvements)

**Status**: Implemented (post-v0.6.0)

### What Was Built

#### In-Level Trader (Safehouse NPC)
- **Spawn**: At most one trader per level, 25% chance; spawns in one random eligible room (non-start, non-exit, non-boss). Levels 5 and 7 (2-room) have 0 eligible rooms so never get a trader.
- **Visual**: Green "TRADER" panel in room (e.g. 350, 350).
- **Interaction**: Approach and press **F** (same as crates/doors); opens buy/sell modal. Game pauses while modal is open.
- **Stock**: Subset of Hideout — Ammo Bundle, Med Kit, Grenade, Adrenaline Shot, Armor Patch (no mods in-level).
- **Economy**: Same run currencies (scrap, credits, materials); Haggler skill applies 15% discount. Sell tab: armor, consumables, unequipped mods (same as Hideout).

#### Config
- `CONFIG.TRADER.IN_LEVEL_SPAWN_CHANCE: 0.25`
- `CONFIG.TRADER.IN_LEVEL_STOCK`: array of item IDs for in-level buy list

---

## Milestone 6: Content Expansion ✅ COMPLETE

**Status**: Implemented in v16.0

### What Was Built

#### New Weapons
- **Crossbow**: Silent, piercing (hits 2 enemies), high damage (3), 1-bolt magazine, auto-reload
- **Assault Rifle**: Balanced stats, medium fire rate, tight spread, first-shot accuracy bonus

#### New Enemy Types
- **Exploder**: Fast charger, explodes on death dealing AoE damage to player AND other enemies (chain reactions!)
- **Necromancer**: Boss with summon phase (4 walkers), vulnerability windows, purple projectiles, teleportation

#### New Levels
- **Level 6 - Mall**: Multi-floor combat, balcony bandits, store breach waves, exploders
- **Level 7 - Cemetery**: Stealth graveyard with patrol enemies, detection meter, church boss arena

#### Stealth System (Cemetery)
- Detection meter UI (green → yellow → red)
- Patrol enemies with waypoint movement and vision cones
- Alert state spawns reinforcement horde if detected
- Crossbow is silent (doesn't increase detection)

#### Sound Effects Added
- Crossbow twang, Rifle crack
- Exploder warning/explosion
- Stealth detection ping/alert
- Necromancer summon/teleport/projectile/death

---

## Build 17-18: Level Progression & Mission Map ✅ COMPLETE

**Status**: Implemented in v17.0-v18.0

### What Was Built

#### Mission Map (v18)
- **City Overview**: Visual map in Hideout showing all 7 levels with road connections
- **Level Nodes**: Color-coded states (Green=Cleared, Orange=Current, Blue=Selected, Gray=Locked)
- **Sequential Unlocking**: Complete level N to unlock level N+1 (tracked via `highestLevelUnlocked`)
- **Replay System**: Can select and replay any previously cleared level

#### Level Complete Choice Screen (v17-18)
- After completing a level, shows choice overlay instead of auto-transitioning
- **CONTINUE** button (or ENTER key): Proceed to next level
- **HIDEOUT** button (or ESC key): Return to hideout with progress saved
- Both options unlock the next level before transitioning

#### Bug Fixes (v17-18)
- Fixed bullet pooling bug (bullets now reset `hitEnemies`, `isPiercing`, `crossbowDamage` on fire)
- Fixed consumables not persisting between levels (array validation added)
- Fixed scene cleanup crashes (proper keyboard handler cleanup, shutdown method)
- Added defensive null checks throughout UI update functions

### Data Model Changes
```javascript
// Added to DEFAULT_STATS:
nextLevel: 1,              // Which level to deploy to
highestLevelUnlocked: 1,   // Progression tracking (1-7)
```

---

## Milestone 7: Meta Progression ✅ COMPLETE (Phase 1)

**Status**: Implemented in v19.0 (Character Classes)

### What Was Built

#### Character Classes (4 Classes)
- **Survivor**: Default class, no passive ability (always unlocked)
- **Scout**: +20% movement speed, silent footsteps (unlock: any level no damage)
- **Medic**: Regenerate 1 HP every 30 seconds (unlock: Heal 50 total HP)
- **Scavenger**: +50% loot drops (unlock: Collect 500 total scrap)

#### Class Selection UI
- CLASS button in Hideout (cyan) opens class selection modal
- 2x2 grid showing all classes with lock status
- Locked classes show unlock requirements
- Selected class highlighted, persists across sessions

#### New Achievements
- **Ghost Runner**: Complete any level without being hit (unlocks Scout)
- **Field Medic**: Heal 50 total HP across all runs (unlocks Medic)
- **Pack Rat**: Collect 500 total scrap (unlocks Scavenger)

---

## Milestone 7b: Permanent Upgrades ✅ COMPLETE

**Status**: Implemented in v20.0

### What Was Built

#### Starting Gear Unlocks (4)
- **Shotgun Start**: Begin runs with Shotgun (10 extractions)
- **Grenade Start**: Begin runs with 1 Grenade (25 grenade kills)
- **Flashlight Start**: Begin runs with Flashlight (complete Level 4)
- **Ammo Cache**: Begin runs with +20 Ammo (100 total kills)

#### Stat Boosts (4)
- **Tough I**: +1 Max HP (5 extractions)
- **Tough II**: +2 Max HP (15 extractions)
- **Fleet Feet**: +5% Movement Speed (complete all levels)
- **Lethal**: +10% Damage (10 boss kills)

#### Cosmetics - Player Skins (3)
- **Tactical**: Blue tint (10 runs started)
- **Survivor**: Red tint (25 runs started)
- **Ghost**: Pale tint (50 melee kills)

#### Cosmetics - Muzzle Flash (3)
- **Blue Flash**: Blue muzzle flash (1000 shots fired)
- **Red Flash**: Red muzzle flash (5 boss kills)
- **Green Flash**: Green muzzle flash (300 scrap collected)

#### UPGRADES Panel
- Accessed via new UPGRADES button in Hideout
- Tabbed interface: GEAR | STATS | SKINS | EFFECTS
- Shows progress bars for locked upgrades
- Click-to-equip functionality for cosmetics

---

## Milestone 8: Gameplay Depth ✅ COMPLETE

**Status**: Implemented in v21.0 (Skill Tree & Challenges), v22.0 (Weapon Mods), v23.0 (Roguelike Elements), v24.0 (UI Redesign)

### Skill Tree System ✅ COMPLETE

Three branches, spend skill points to unlock abilities. Points earned per level completion:
- **Base**: 1 point per level completed
- **Bonus +1**: No damage taken during level
- **Bonus +1**: Boss level (levels 5 and 7)
- **Bonus +1**: 50%+ accuracy with at least 10 shots

#### Survival Branch
| Skill | Effect | Cost | Status |
|-------|--------|------|--------|
| Thick Skin | -10% damage taken | 2 | ✅ |
| Iron Will | -20% damage taken | 4 | ✅ |
| Second Wind | Survive one lethal hit per run (1 HP) | 6 | ✅ |
| Regeneration | Heal 1 HP every 60 seconds | 5 | ✅ |
| Last Stand | +50% damage when below 25% HP | 4 | ✅ |

#### Stealth Branch
| Skill | Effect | Cost | Status |
|-------|--------|------|--------|
| Light Feet | Footstep sounds reduced | 2 | ✅ |
| Shadow Step | -25% enemy detection range | 4 | ✅ |
| Silent Killer | Melee kills don't alert nearby enemies | 5 | ✅ |
| Ambush | +50% damage to unaware enemies | 6 | ✅ |
| Ghost | Enemies lose track of you faster | 3 | ✅ |

#### Utility Branch
| Skill | Effect | Cost | Status |
|-------|--------|------|--------|
| Quick Hands | +25% interact speed | 2 | ✅ |
| Haggler | 15% discount at trader | 4 | ✅ |
| Scrapper | +25% scrap from all sources | 5 | ✅ |
| Swift Reload | -15% reload time | 4 | ✅ |
| Pack Mule | +1 consumable slot | 3 | ✅ |

### Challenge System ✅ COMPLETE

#### Daily Challenges (3 per day, reset at midnight UTC)
- Melee Mayhem: Kill 10 enemies with melee (2 pts)
- Exterminator: Kill 20 enemies in a single run (1 pt)
- Untouchable: Complete a level without taking damage (2 pts)
- Sharpshooter: Achieve 60%+ accuracy (min 20 shots) (2 pts)
- Bombardier: Kill 5 enemies with grenades (2 pts)
- Scavenger Run: Collect 50 scrap in a single run (1 pt)
- Speed Demon: Complete any level in under 2 minutes (2 pts)
- Old Faithful: Complete a level using only the pistol (2 pts)

#### Weekly Challenges (5 per week, reset Monday UTC)
- Genocide: Kill 100 enemies this week (4 pts)
- Survivor: Extract 5 times this week (3 pts)
- Boss Hunter: Kill 3 bosses this week (5 pts)
- Hoarder: Collect 200 scrap this week (3 pts)
- Globetrotter: Extract from 5 different levels this week (4 pts)

#### Permanent Challenges (Cosmetic Rewards)
- Bolt Action: Kill 100 enemies with crossbow (Hunter skin)
- Bladedancer: Kill 200 enemies with melee (Assassin skin)
- Veteran: Complete 50 extractions (Gold muzzle flash)
- Perfection: Complete 5 levels with 0 damage (Ethereal skin)

### Weapon Mods System ✅ COMPLETE

5 weapon mods with 2 equip slots per weapon. Acquired from trader (Materials) or loot drops (levels 5-7).

| Mod | Effect | Compatible Weapons |
|-----|--------|-------------------|
| Extended Mag | +50% magazine size | All guns |
| Suppressor | Silent shots, -10% damage | Pistol, SMG, Rifle |
| Laser Sight | Shows trajectory (toggle L key) | All guns |
| Damage Barrel | +20% damage, -15% fire rate | Shotgun, Rifle |
| Rapid Fire | +25% fire rate, +20% spread | SMG, Pistol |

**Features**:
- MODS panel in Hideout for equipping mods to weapons
- Mods persist in inventory permanently, equipped mods are per-run
- Compatibility checking prevents invalid combinations
- In-game inventory shows equipped mods for current weapon
- Trader scrolling with mouse wheel support

### Roguelike Elements ✅ COMPLETE

**Status**: Implemented in v23.0

#### Procedural Room Grid System
- Levels are now grids of connected rooms (2x2 for early levels, 3x2 for later levels)
- Each level theme has 2-3 room "chunks" (templates) that are randomly assigned
- Room chunks define: walls, spawn points, crate slots, door positions
- Rooms persist state: cleared rooms stay cleared when revisited
- Start room (player spawn) and exit room (level door) automatically assigned

| Level | Grid Size | Theme |
|-------|-----------|-------|
| 1 Street | 2x2 (4 rooms) | STREET |
| 2 Apartment | 2x2 (4 rooms) | APARTMENT |
| 3 Rooftop | 2x2 (4 rooms) | ROOFTOP |
| 4 Sewers | 3x2 (6 rooms) | SEWERS |
| 5 Hospital | 2x1 (2 rooms) | HOSPITAL |
| 6 Mall | 3x2 (6 rooms) | MALL |
| 7 Cemetery | 2x1 (2 rooms) | CEMETERY |

#### Risk Rooms
- 25% chance per eligible room to have a risk room door
- Red-tinted door with pulsing animation and ⚠️ danger indicator
- Enemies upgraded: walkers→leapers, leapers→bandits, spitters→exploders
- 1.5x enemy count multiplier
- 2x loot/currency multiplier
- Guaranteed weapon mod drop from risk rooms

#### Room Transitions
- Gray doors connect adjacent rooms within level
- Fade transition effect when moving between rooms
- Player positioned at opposite side from entry direction
- Room state persists (enemies don't respawn in cleared rooms)

#### Minimap
- Top-right corner shows room grid layout
- Color coding: Gray=unvisited, Dark gray=visited, Green=cleared, Yellow=exit, Blue=current
- Red dot indicates risk room availability
- Connection lines show room links

---

## Priority Order

1. ~~**Milestone 5** - Trader system~~ ✅ COMPLETE
2. ~~**Milestone 6** - Content expansion~~ ✅ COMPLETE
3. ~~**Build 17-18** - Level progression & Mission Map~~ ✅ COMPLETE
4. ~~**Milestone 7** - Meta progression (character classes)~~ ✅ COMPLETE
5. ~~**Milestone 7b** - Meta progression (permanent upgrades)~~ ✅ COMPLETE
6. ~~**Milestone 8a** - Skill Tree & Challenge System~~ ✅ COMPLETE
7. ~~**Milestone 8b** - Weapon Mods~~ ✅ COMPLETE
8. ~~**Milestone 8c** - Roguelike Elements (Random Layouts, Risk Rooms)~~ ✅ COMPLETE
9. ~~**Milestone 10** - In-Level Traders (safehouse NPCs)~~ ✅ COMPLETE

---

## Continuous Improvements

Ongoing work that ships as part of post-milestone updates (no fixed version). Add items here as they land.

- **New enemies** — Additional enemy types, behaviors, or variants.
- **New weapons** — Additional weapons, ammo types, or weapon mechanics.
- **New levels** — Additional levels, themes, or level mechanics.
- **Polish** — UX, UI, SFX, VFX, balance, accessibility, performance, and quality-of-life improvements.
- **Features** — Smaller features (e.g. in-level traders, async challenges) that don’t warrant a full milestone.

---

## Technical Notes

### Code Structure (game.html)
```
CONFIG - All settings, weapons, enemies, currencies, trader stock
DEFAULT_STATS / DEFAULT_PERSISTENT - Save data structures
SoundManager class - 30+ procedural audio effects
MainMenuScene / HideoutScene / GameScene - Main Phaser scenes
Enemy class - All enemy types including patrol behavior
Bullet class - Handles piercing, damage multipliers
```

### Save Version History
- v14: Polish Pass (settings, hit indicators)
- v15: Trader & Loot System (currencies, consumables)
- v16: Content Expansion (new weapons, levels, enemies)
- v17: Level Progression (nextLevel tracking, level complete choice)
- v18: Mission Map (highestLevelUnlocked, city overview map, level replay)
- v19: Meta Progression (character classes, class passives, class unlock achievements)
- v20: Permanent Upgrades (14 upgrades, cosmetics system, UPGRADES panel)
- v21: Skill Tree & Challenges (15 skills, daily/weekly/permanent challenges, skill points)
- v22: Weapon Mods (5 mods, modInventory, equippedMods, MODS panel)
- v23: Roguelike Elements (room grids, chunks, risk rooms, minimap)
- v24: UI Redesign (tabbed hideout, streamlined main menu, mod selling, controls in settings)
- In-Level Traders (IN_LEVEL_SPAWN_CHANCE, IN_LEVEL_STOCK; F to interact in eligible rooms)

### Key Config Locations
- `CONFIG.WEAPONS` - All weapon stats including Crossbow/Rifle
- `CONFIG.ENEMIES` - All enemy types including Exploder/Necromancer
- `CONFIG.CURRENCIES` - Scrap, Credits, Materials definitions
- `CONFIG.TRADER` - Shop stock, sell rates, IN_LEVEL_SPAWN_CHANCE, IN_LEVEL_STOCK (in-level trader)
- `CONFIG.CONSUMABLES` - Consumable effects and durations
- `CONFIG.CLASSES` - Character classes with passives and unlock requirements
- `CONFIG.UPGRADES` - Permanent upgrades with stat requirements and cosmetic effects
- `CONFIG.SKILLS` - 15 skills across 3 branches with costs and effects
- `CONFIG.CHALLENGES` - Daily, Weekly, and Permanent challenge templates
- `CONFIG.MODS` - 5 weapon mods with effects and compatibility lists
- `CONFIG.LEVEL_GRIDS` - Room grid dimensions per level (cols, rows, theme)
- `CONFIG.RISK_ROOM` - Risk room spawn chance, enemy/loot multipliers, enemy upgrades
- `CONFIG.ROOM_CHUNKS` - Room templates with walls, spawn points, crate slots, doors

### Level Progression
1. Street (key required) → 2. Apartment (debris) → 3. Rooftop (key) → 4. Sewers (key) → 5. Hospital (boss→switch→extraction) → 6. Mall (key) → 7. Cemetery (boss→switch→extraction)

**Post-Level Flow**: After door/extraction → Choice Screen (Continue or Hideout) → Unlocks next level → Awards skill points

---

*Last updated: Build 24.1 (single-player)*
*Milestones 5–8, 10 COMPLETE; multiplayer (9) removed*
