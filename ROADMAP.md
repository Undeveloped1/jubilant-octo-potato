# Zombie Extraction Game - Development Roadmap

## Current State: Build 14.0 (Polish Pass)

### Completed Features
- **5 Levels**: Street → Apartment → Rooftop → Sewers → Hospital
- **5 Enemy Types**: Walker, Leaper, Bandit, Spitter, Boss
- **3 Weapons**: Pistol, Shotgun, SMG (magazine/reload system)
- **Combat**: Dodge roll (SPACE), reload (R), melee (E), grenades (G), muzzle flash, low HP vignette
- **Hideout Upgrades**: Rest Area, Generator, Armory (NVG crafting), Workbench (+25% damage), Repair Station
- **Progression**: 10 achievements, persistent stats, save/load system
- **Polish**: Settings menu, hit indicators, 25+ procedural sounds, improved UI

---

## Milestone 5: Trader & Expanded Loot System ✅ PLANNED

**Status**: Plan created, implementation in progress

### Decisions Made
- **Trader Location**: Both hideout (always available) + in-level (fixed safehouse locations)
- **Currency System**: Multi-currency
  - Scrap = Crafting
  - Credits = Trader purchases, earned by selling items
  - Materials = Hideout upgrades, specialty crafting
- **Loot Drops**: By enemy type
  - Zombies → Scrap
  - Bandits → Credits
  - Bosses → Materials
  - Crates → Any
- **Trader Inventory**: Ammo, meds, grenades, weapons, armor, consumables, crafting materials
- **In-Level Trader**: Fixed locations (Level 2 Apartment, Level 4 Sewers)

### Key Features
- Hideout trader card with shop modal UI
- Buy/sell system (sell rate ~50%)
- Consumables: Adrenaline (+50% speed), Damage Boost (+50% DMG), Armor Patch, Stim Pack
- Inventory slots (max 3 consumables), hotkeys 1-2-3

**Full plan**: `.cursor/plans/trader_loot_system_3615661b.plan.md`

---

## Milestone 6: Content Expansion 🎯 IN PLANNING

**Status**: Design decisions in progress

### Decisions Made
- **New Levels**: 2 levels (Level 6-7)
- **Themes**: Mall (Level 6) + Cemetery (Level 7)
- **Special Mechanics**: Mixed - Cemetery has stealth section
- **New Enemy**: Exploder confirmed

### Pending Decisions

#### New Weapons (pick 1-2)
| Weapon | Description | Use Case |
|--------|-------------|----------|
| Assault Rifle | High accuracy, medium fire rate, good range | All-rounder upgrade |
| Crossbow | Silent, piercing, slow reload | Perfect for stealth level |
| Flamethrower | Cone damage, DOT, crowd control, limited fuel | Crowd control |
| Sniper Rifle | One-shot potential, very slow, scoped zoom | High-skill option |

#### Additional Enemies (consider adding)
| Enemy | Behavior | Challenge |
|-------|----------|-----------|
| Tank | High HP, slow, heavy damage, staggers on hit | Bullet sponge, positioning |
| Swarm | Tiny, fast, weak, spawns in groups of 5-8 | Overwhelm, ammo drain |
| Screamer | Alerts/buffs nearby enemies when spotted | Priority target |
| Stalker | Invisible until close, burst damage, flees | Jump scares, awareness |

#### Boss Decision
- **Unique Boss**: Grave Warden, Necromancer (summons minions), Reaper
- **Variant Boss**: Tougher existing boss with new attacks
- **No Boss**: Focus on atmosphere and stealth

### Level Concepts

#### Level 6: Shopping Mall
- Open atriums with multiple floors
- Escalators (movement boost/hazard)
- Storefronts as cover
- Ambient: flickering lights, distant echoes, abandoned carts
- Objective: Navigate to rooftop extraction

#### Level 7: Cemetery/Church
- **Stealth Section**: Graveyard approach
  - Staying in shadows/behind tombstones
  - Detection meter (like MGS)
  - Getting spotted = overwhelming horde spawns
- Church interior as final combat zone
- Crypts with loot but risk
- Atmospheric: fog, moonlight, distant howls

---

## Milestone 7: Meta Progression

**Status**: Concept only

### Proposed Features

#### Permanent Upgrades (persist across all runs)
- Starting weapon unlocks (begin with shotgun)
- Base stat bonuses (+1 max HP per unlock tier)
- Starting resources (begin with 10 scrap)
- Hideout auto-upgrades (generator starts at lvl 1)

#### Character Classes/Loadouts
| Class | Starting Gear | Passive |
|-------|---------------|---------|
| Soldier | Assault Rifle, 2 grenades | +10% damage |
| Scavenger | Pistol, extra backpack slots | +25% loot find |
| Medic | Pistol, 3 med kits | Slow health regen |
| Scout | Crossbow, NVG | Move silently, +15% speed |

#### Daily Challenges
- "Kill 20 enemies with melee only"
- "Complete Level 3 without taking damage"
- "Extract with less than 10 ammo remaining"
- Reward: Bonus credits/materials

#### Local Leaderboards
- Fastest extraction time per level
- Most kills in a run
- Highest accuracy run
- Longest survival streak

---

## Milestone 8: Gameplay Depth

**Status**: Concept only

### Proposed Features

#### Skill Tree / Perks
Earn skill points from runs, spend on permanent abilities:

**Combat Branch**
- Quick Reload (-20% reload time)
- Steady Aim (+accuracy after standing still)
- Overkill (+10% damage to enemies below 25% HP)

**Survival Branch**
- Thick Skin (-10% damage taken)
- Scavenger (+loot drop rates)
- Second Wind (survive one lethal hit per run)

**Utility Branch**
- Pack Mule (+inventory slots)
- Night Owl (better visibility in dark)
- Quick Hands (+25% interact speed)

#### Weapon Attachments/Mods
Found as loot or purchased from trader:

| Attachment | Effect | Compatible |
|------------|--------|------------|
| Extended Mag | +50% magazine size | Pistol, SMG |
| Red Dot Sight | +accuracy | All guns |
| Suppressor | Silent shots, -10% damage | Pistol, SMG |
| Laser Sight | Show bullet path | All guns |
| Grip | -recoil/spread | Shotgun, SMG |

#### Crafting Expansion
Combine materials at workbench:
- Scrap + Materials = Weapon mods
- Materials + Credits = Special ammo (incendiary, AP)
- Scrap + Scrap = Basic consumables

#### Roguelike Elements
- **Random Level Modifiers**: "Dense Fog", "Ammo Scarcity", "Double Enemies"
- **Random Room Layouts**: Procedural room arrangement within level theme
- **Risk/Reward Rooms**: Optional dangerous rooms with better loot

---

## Milestone 9: Multiplayer/Social

**Status**: Concept only

### Proposed Features

#### Local Co-op (2 players)
- Split screen or shared screen
- Revive downed teammate mechanic
- Shared resources or individual inventories (design choice)
- Difficulty scales with player count

#### Score Sharing
- End-of-run summary screen with shareable stats
- Screenshot/export run results
- Compare with friends

#### Ghost Runs
- Race against your own best time
- See ghost of previous run's movement
- Optional: Download community ghost runs
- Leaderboard integration

#### Async Challenges
- Send challenge to friend: "Beat my Level 3 time"
- Weekly community challenges
- Seasonal events with unique rewards

---

## Design Principles

### Core Loop
1. **Deploy** from hideout with current gear
2. **Fight** through level, collect loot
3. **Extract** or die trying
4. **Return** to hideout, upgrade, repeat

### Difficulty Curve
- Levels 1-2: Tutorial, learn mechanics
- Levels 3-4: Challenge ramps, requires upgrades
- Levels 5+: Mastery required, skill expression

### Resource Economy
- **Scrap**: Common, steady income, crafting currency
- **Credits**: Medium rarity, trading currency
- **Materials**: Rare, endgame upgrades

### Player Agency
- Multiple viable builds (tanky, fast, stealthy)
- Risk/reward choices (explore more vs. extract safe)
- Meaningful upgrade decisions

---

## Technical Notes

### Code Structure (game.html)
```
CONFIG - All settings + achievements config
DEFAULT_STATS / DEFAULT_PERSISTENT - Save data structures
loadPersistent() / savePersistent() / checkAchievements() - Stats helpers
SoundManager class - Procedural audio with volume controls
MainMenuScene / HideoutScene / GameScene - Main Phaser scenes
Enemy / Bullet classes - Game entities
```

### Adding New Content Checklist
- [ ] Add to CONFIG (stats, costs, settings)
- [ ] Update DEFAULT_STATS/PERSISTENT if new save data
- [ ] Add save migration for existing saves
- [ ] Create/update scene code
- [ ] Add sound effects to SoundManager
- [ ] Test with fresh save AND existing save
- [ ] Update version number in SAVE_KEY

---

## Priority Order (Suggested)

1. **Milestone 5** - Trader system (adds economic depth)
2. **Milestone 6** - Content expansion (more to do)
3. **Milestone 8** - Gameplay depth (skill expression)
4. **Milestone 7** - Meta progression (replayability)
5. **Milestone 9** - Multiplayer (scope increase)

---

*Last updated: Build 14.0*
*Document created during planning session*
