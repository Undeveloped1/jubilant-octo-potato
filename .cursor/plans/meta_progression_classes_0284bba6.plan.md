---
name: Meta Progression Classes
overview: "Implement Milestone 7 incrementally: bump save version to v17, add class selection UI in Hideout, then progressively implement Scout, Medic, and Scavenger passives with achievement-based unlocks."
todos:
  - id: save-bump
    content: Bump save version to v17 and add CONFIG.CLASSES definition
    status: completed
  - id: data-model
    content: Extend DEFAULT_PERSISTENT with unlockedClasses, selectedClass, totalHPHealed
    status: completed
  - id: class-ui
    content: Add CLASS button and selection modal to HideoutScene
    status: completed
  - id: scout-passive
    content: Implement Scout +20% speed and silent footsteps
    status: completed
  - id: medic-passive
    content: Implement Medic HP regeneration timer (1 HP / 30s)
    status: completed
  - id: scavenger-passive
    content: Implement Scavenger +50% loot drop multiplier
    status: completed
  - id: achievements
    content: Add 3 new achievements and wire up class unlock logic
    status: completed
  - id: migration
    content: Add v16 to v17 save migration logic
    status: completed
isProject: false
---

# Milestone 7: Meta Progression (Character Classes)

## Phase 1: Save System and Data Model

### Bump Save Version to v17

Update all save keys in [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html):

```javascript
// Line ~26-27
SAVE_KEY: 'zombie_save_v17',
SETTINGS_KEY: 'zombie_settings_v17',

// Line ~332
const PERSISTENT_KEY = 'zombie_persistent_v17';
```

### Add Class Configuration

Add to CONFIG (after line ~260):

```javascript
CLASSES: {
    SURVIVOR: { id: 'survivor', name: 'Survivor', desc: 'No passive ability', passive: null, icon: '🧍' },
    SCOUT: { id: 'scout', name: 'Scout', desc: '+20% speed, silent footsteps', passive: 'speed', icon: '🏃' },
    MEDIC: { id: 'medic', name: 'Medic', desc: 'Regen 1 HP every 30s', passive: 'regen', icon: '💉' },
    SCAVENGER: { id: 'scavenger', name: 'Scavenger', desc: '+50% loot drops', passive: 'loot', icon: '🎒' }
}
```

### Add New Achievements for Class Unlocks

Add to CONFIG.ACHIEVEMENTS (line ~217):

```javascript
SCOUT_UNLOCK: { id: 'scout_unlock', name: 'Ghost Runner', desc: 'Complete Level 3 without being hit', icon: '🏃' },
MEDIC_UNLOCK: { id: 'medic_unlock', name: 'Field Medic', desc: 'Heal 50 total HP across all runs', icon: '💉' },
SCAVENGER_UNLOCK: { id: 'scavenger_unlock', name: 'Pack Rat', desc: 'Collect 500 total scrap', icon: '🎒' }
```

### Extend DEFAULT_PERSISTENT

Add new fields (line ~304):

```javascript
// After existing fields
totalHPHealed: 0,          // For Medic unlock
unlockedClasses: ['survivor'],  // Classes available to play
selectedClass: 'survivor'  // Current class selection
```

---

## Phase 2: Class Selection UI (Hideout)

### Add Class Button to HideoutScene

Location: [game.html line ~1918](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html) (after upgrade cards)

- Add "CLASS" button (cyan color) near other upgrade cards
- Opens modal showing 4 classes in a grid
- Locked classes show achievement requirement
- Selected class highlighted with border
- Selection stored in persistent data

### UI Flow

```
Hideout Scene
├── Existing upgrade cards (Rest Area, Generator, etc.)
├── [CLASS] button (new) → Opens class selection modal
│   ├── Survivor (always unlocked) - default
│   ├── Scout (locked until Ghost Runner achievement)
│   ├── Medic (locked until Field Medic achievement)
│   └── Scavenger (locked until Pack Rat achievement)
└── Deploy button applies selected class to run
```

---

## Phase 3: Achievement Unlock Logic

### Update checkAchievements Function

Location: [game.html line ~827](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html)

Add checks for new achievements:

```javascript
// Scout - Level 3 no damage (context.level3NoDamage)
if (!persistent.achievements.includes(a.SCOUT_UNLOCK.id) && context.level3NoDamage) {
    persistent.achievements.push(a.SCOUT_UNLOCK.id);
    if (!persistent.unlockedClasses.includes('scout')) persistent.unlockedClasses.push('scout');
    newAchievements.push(a.SCOUT_UNLOCK);
}

// Medic - Heal 50 HP total
if (!persistent.achievements.includes(a.MEDIC_UNLOCK.id) && persistent.totalHPHealed >= 50) {
    persistent.achievements.push(a.MEDIC_UNLOCK.id);
    if (!persistent.unlockedClasses.includes('medic')) persistent.unlockedClasses.push('medic');
    newAchievements.push(a.MEDIC_UNLOCK);
}

// Scavenger - 500 scrap total
if (!persistent.achievements.includes(a.SCAVENGER_UNLOCK.id) && persistent.totalScrapCollected >= 500) {
    persistent.achievements.push(a.SCAVENGER_UNLOCK.id);
    if (!persistent.unlockedClasses.includes('scavenger')) persistent.unlockedClasses.push('scavenger');
    newAchievements.push(a.SCAVENGER_UNLOCK);
}
```

### Track HP Healed

In GameScene where HP pickups are collected (line ~4900+), add:

```javascript
persistent.totalHPHealed += healAmount;
```

---

## Phase 4: Class Passives Implementation

### Scout Passive (+20% Speed, Silent Footsteps)

Location: GameScene.create() around line ~3027

```javascript
// After speedMultiplier = 1
if (this.persistent.selectedClass === 'scout') {
    this.baseSpeedMultiplier = 1.2;
    this.speedMultiplier = this.baseSpeedMultiplier;
    this.silentFootsteps = true;
}
```

Modify footstep sound (line ~4329):

```javascript
if (!this.silentFootsteps) {
    sfx.footstep(this.time.now, speed === CONFIG.PLAYER.SPRINT_SPEED);
}
```

### Medic Passive (Regen 1 HP / 30s)

Location: GameScene.create()

```javascript
if (this.persistent.selectedClass === 'medic') {
    this.time.addEvent({
        delay: 30000,
        callback: () => {
            if (this.playerStats.hp < this.playerStats.maxHp && this.player.active) {
                this.playerStats.hp = Math.min(this.playerStats.hp + 1, this.playerStats.maxHp);
                this.showFloatingText(this.player.x, this.player.y - 40, "+1 HP", 0x00ff00);
                sfx.heal();
            }
        },
        loop: true
    });
}
```

### Scavenger Passive (+50% Loot)

Location: CONFIG.ENEMY_DROPS handling (line ~3428)

```javascript
// In currency drop calculation
let amount = Phaser.Math.Between(dropConfig.min, dropConfig.max);
if (this.persistent.selectedClass === 'scavenger') {
    amount = Math.floor(amount * 1.5);
}
```

---

## Migration Strategy

### Old Save Handling

In MainMenuScene and HideoutScene where saves are loaded, add migration:

```javascript
// Migrate v16 persistent to v17
if (!persistent.unlockedClasses) persistent.unlockedClasses = ['survivor'];
if (!persistent.selectedClass) persistent.selectedClass = 'survivor';
if (persistent.totalHPHealed === undefined) persistent.totalHPHealed = 0;
```

---

## Implementation Order

1. **Save version bump** - Update keys, add CONFIG.CLASSES
2. **Data model** - Extend DEFAULT_PERSISTENT with class fields
3. **Class selection UI** - Button + modal in HideoutScene (functional but no passives yet)
4. **Scout passive** - Speed boost and silent footsteps
5. **Medic passive** - HP regeneration timer
6. **Scavenger passive** - Loot multiplier
7. **Achievement unlocks** - Add new achievements, wire up unlock logic
8. **Testing** - Verify each class works, saves persist, migrations work

---

## Files Modified

- [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html) - All changes in single file

## Testing Checklist

- New game starts with Survivor class
- Class selection UI shows locked/unlocked correctly
- Scout speed boost feels noticeable
- Scout footsteps are silent
- Medic heals 1 HP every 30 seconds
- Scavenger gets ~50% more currency drops
- Old v16 saves migrate to v17 without data loss
- Achievements unlock classes correctly

