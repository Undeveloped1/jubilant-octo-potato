---
name: Best Practices Documentation
overview: Create a Cursor rule for AI auto-loading and a PROJECT_GUIDE.md for human reference, covering both technical patterns and workflow best practices for the Zombie Extraction Game project.
todos:
  - id: cursor-rule
    content: Create .cursor/rules/zombie-game.mdc with AI instructions and project context
    status: completed
  - id: project-guide
    content: Create PROJECT_GUIDE.md with comprehensive technical and workflow documentation
    status: completed
isProject: false
---

# Best Practices Documentation

## Deliverables

### 1. Cursor Rule File

**Path**: `.cursor/rules/zombie-game.mdc`

Auto-loaded by AI when working in this project. Contains:

- Project context (single-file Phaser game)
- Key file locations and CONFIG structure
- Workflow rules (plan before implement, clarify design decisions)
- Common patterns for adding features

### 2. Project Guide

**Path**: `PROJECT_GUIDE.md`

Human-readable reference document covering:

- Architecture overview
- Technical patterns
- Workflow best practices
- Testing/debugging tips

---

## Content Structure

### Technical Patterns

**File Structure:**

- Single file: `game.html` (~6800 lines)
- All game logic, scenes, and config in one file
- Sprites: `sprite_*.png`, `leaper_idle_*.png`

**Key CONFIG Sections** (lines 24-450):

```
CONFIG.WEAPONS - Weapon stats (damage, fire rate, mag size)
CONFIG.ENEMIES - Enemy types and behaviors
CONFIG.CURRENCIES - Scrap, Credits, Materials
CONFIG.TRADER - Shop inventory
CONFIG.CLASSES - Character class passives
CONFIG.UPGRADES - Permanent progression unlocks
CONFIG.SKILLS - Skill tree (15 skills, 3 branches)
CONFIG.CHALLENGES - Daily/Weekly/Permanent challenges
```

**Save Data Structures:**

- `DEFAULT_STATS` - Current run state (HP, ammo, weapons, hideout)
- `DEFAULT_PERSISTENT` - Cross-run progression (kills, achievements, unlocks)
- Save keys: `zombie_save_v17`, `zombie_persistent_v17`

**Scene Architecture:**

- `MainMenuScene` - Title screen, new/continue/settings
- `HideoutScene` - Hub with upgrades, trader, mission map
- `GameScene` - Core gameplay loop

**Adding New Features Pattern:**

1. Add config to appropriate CONFIG section
2. Add persistent fields to DEFAULT_PERSISTENT if needed
3. Update loadPersistent() for migration
4. Add UI in HideoutScene (button + modal)
5. Apply effects in GameScene
6. Save with savePersistent()

### Workflow Best Practices

**Before Implementation:**

1. Switch to planning mode for non-trivial features
2. Clarify design decisions (persistence, acquisition, UI location)
3. Create plan with specific line numbers and code snippets

**During Implementation:**

- Check for existing patterns in similar features
- Update ROADMAP.md when completing milestones
- Test with god mode cheat and level select

**Testing Notes:**

- Level Select: Bottom-right of main menu (all levels unlocked for testing)
- God Mode: Type "god mode" at cheat code prompt
- Console: Check for save/load errors

---

## Key Lessons Captured

1. **Skill/Challenge tracking** must happen in BOTH `nextLevel()` AND `winGame()` - not just extraction
2. **Button labels** need scene refresh after modal changes (skills panel close restarts scene)
3. **Challenge initialization** must happen in GameScene.create() too, not just HideoutScene
4. **Migration code** in loadPersistent() ensures old saves work with new fields

