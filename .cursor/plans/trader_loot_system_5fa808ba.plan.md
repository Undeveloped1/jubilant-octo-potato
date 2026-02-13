---
name: Trader Loot System
overview: Add Credits and Materials currencies with auto-collection, implement a Hideout Trader modal with buy/sell functionality, and create a consumables system with hotkey support. Requires fresh save (v15).
todos:
  - id: data-structures
    content: Add CONFIG.CURRENCIES, CONFIG.TRADER, CONFIG.CONSUMABLES, CONFIG.ENEMY_DROPS; update DEFAULT_STATS and DEFAULT_PERSISTENT; bump save version to v15
    status: completed
  - id: loot-drops
    content: Refactor spawnLootSkull() for auto-currency collection and enemy-type-specific item drops
    status: completed
  - id: trader-ui
    content: Create showTraderModal() in HideoutScene with BUY/SELL tabs and item listings
    status: completed
  - id: buy-sell-logic
    content: Implement purchaseItem() and sellItem() methods with validation and effects
    status: completed
  - id: consumables
    content: Add 1/2/3 hotkey bindings and useConsumable() method with speed/repair effects
    status: completed
  - id: ui-updates
    content: Update drawUI() and HUD to show credits, materials, and consumable slots
    status: completed
  - id: sounds
    content: Add purchase(), sell(), and useConsumable() sounds to SoundManager
    status: completed
isProject: false
---

# Trader and Expanded Loot System Implementation

## Scope

- Three-currency system (Scrap, Credits, Materials)
- Currency auto-collects on kill; items remain in skulls
- Hideout Trader modal with buy/sell
- Consumables with 1/2/3 hotkeys
- Save version bump to v15 (fresh save required)
- In-level traders deferred to future milestone

---

## Phase 1: Data Structures

Add to `CONFIG` (after line 196):

```javascript
CONFIG.CURRENCIES = {
    SCRAP: { name: 'Scrap', icon: '🔧', color: 0xaaaaaa },
    CREDITS: { name: 'Credits', icon: '💰', color: 0xffd700 },
    MATERIALS: { name: 'Materials', icon: '⚙️', color: 0x00aaff }
};

CONFIG.TRADER = {
    HIDEOUT_STOCK: [
        { id: 'ammo_bundle', name: 'Ammo Bundle', type: 'ammo', amount: 50, cost: 15, currency: 'credits' },
        { id: 'med_kit', name: 'Med Kit', type: 'heal', amount: 5, cost: 20, currency: 'credits' },
        { id: 'grenade', name: 'Grenade', type: 'grenade', amount: 1, cost: 25, currency: 'credits' },
        { id: 'adrenaline', name: 'Adrenaline Shot', type: 'consumable', effect: 'speed', cost: 30, currency: 'credits' },
        { id: 'armor_patch', name: 'Armor Patch', type: 'consumable', effect: 'repair', cost: 25, currency: 'credits' }
    ],
    SELL_RATE: 0.5
};

CONFIG.CONSUMABLES = {
    adrenaline: { name: 'Adrenaline', effect: 'speed', multiplier: 1.5, duration: 10000, icon: '💉' },
    armor_patch: { name: 'Armor Patch', effect: 'repair', amount: 20, duration: 0, icon: '🩹' }
};

CONFIG.ENEMY_DROPS = {
    WALKER: { currency: 'scrap', min: 1, max: 3, items: ['ammo', 'meds'] },
    SPITTER: { currency: 'scrap', min: 2, max: 4, items: ['ammo', 'meds', 'grenade'] },
    BANDIT: { currency: 'credits', min: 5, max: 15, items: ['ammo', 'helmet', 'vest'] },
    BOSS: { currency: 'materials', min: 5, max: 15, items: ['grenade', 'meds'] },
    LEAPER: { currency: 'scrap', min: 1, max: 2, items: ['ammo'] }
};
```

Update `DEFAULT_STATS` (line 200):

```javascript
// Add these fields:
credits: 0,
materials: 0,
consumables: [null, null, null]  // 3 slots for hotkeys 1, 2, 3
```

Update `DEFAULT_PERSISTENT` (line 222):

```javascript
// Add these fields:
totalCreditsEarned: 0,
totalMaterialsCollected: 0,
itemsSold: 0,
itemsBought: 0
```

Bump save keys (lines 26-27):

```javascript
SAVE_KEY: 'zombie_save_v15',
SETTINGS_KEY: 'zombie_settings_v15',
// And line 246:
PERSISTENT_KEY = 'zombie_persistent_v15';
```

---

## Phase 2: Loot Drop Changes

Refactor `spawnLootSkull()` in GameScene (line 2389):

```javascript
spawnLootSkull(x, y, enemyType, killSource = 'gun') {
    // Track kill stats (existing code)
    this.persistent.runKills++;
    this.persistent.totalKills++;
    // ... existing kill tracking ...

    // NEW: Auto-collect currency based on enemy type
    const dropConfig = CONFIG.ENEMY_DROPS[enemyType.toUpperCase()];
    if (dropConfig) {
        const amount = Phaser.Math.Between(dropConfig.min, dropConfig.max);
        const currency = dropConfig.currency;
        
        // Add currency to player
        if (currency === 'scrap') {
            this.playerStats.scrap += amount;
            this.persistent.totalScrapCollected += amount;
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
        
        // Spawn skull with random item (not currency)
        if (dropConfig.items.length > 0) {
            const item = Phaser.Utils.Array.GetRandom(dropConfig.items);
            let s = this.skulls.create(x, y, 'skull').setScale(0.8);
            s.setData('lootID', item);
        }
    }
    
    savePersistent(this.persistent);
}
```

---

## Phase 3: Hideout Trader UI

Add to `HideoutScene.create()` (after line 1574):

```javascript
// Trader button
const traderBtn = this.add.rectangle(650, 450, 150, 40, 0xffd700).setInteractive();
this.add.text(650, 450, "TRADER", { fontSize: '16px', fill: '#000' }).setOrigin(0.5);
traderBtn.on('pointerdown', () => { sfx.menuOpen(); this.showTraderModal(); });
```

New method `showTraderModal()`:

- Dark overlay covering screen (click to close)
- Two tabs: BUY and SELL
- List items with costs and [BUY]/[SELL] buttons
- Player currency display at top
- Pattern matches existing `showSettingsMenu()` and `showStatsPanel()` methods

---

## Phase 4: Buy/Sell Logic

New methods in HideoutScene:

```javascript
purchaseItem(item) {
    const currency = item.currency;
    const cost = item.cost;
    
    if (this.stats[currency] < cost) {
        sfx.error();
        return false;
    }
    
    this.stats[currency] -= cost;
    this.persistent.itemsBought++;
    
    // Apply item effect
    switch (item.type) {
        case 'ammo': this.stats.ammo += item.amount; break;
        case 'heal': this.stats.hp = Math.min(this.stats.hp + item.amount, this.stats.maxHp); break;
        case 'grenade': this.stats.grenades = Math.min(this.stats.grenades + item.amount, CONFIG.GRENADE.MAX_CARRY); break;
        case 'consumable': this.addConsumable(item.id); break;
    }
    
    sfx.success();
    savePersistent(this.persistent);
    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(this.stats));
    return true;
}

sellItem(slot, item) {
    // Remove item from player inventory
    // Add credits at SELL_RATE
    // Update UI
}
```

---

## Phase 5: Consumables System

Add to GameScene input setup (after line 2202):

```javascript
this.keys.consumable1 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
this.keys.consumable2 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
this.keys.consumable3 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
```

Add to GameScene.update() (after dodge roll check):

```javascript
if (Phaser.Input.Keyboard.JustDown(this.keys.consumable1)) this.useConsumable(0);
if (Phaser.Input.Keyboard.JustDown(this.keys.consumable2)) this.useConsumable(1);
if (Phaser.Input.Keyboard.JustDown(this.keys.consumable3)) this.useConsumable(2);
```

New method `useConsumable(slot)`:

```javascript
useConsumable(slot) {
    const consumable = this.playerStats.consumables[slot];
    if (!consumable) {
        this.showFloatingText(this.player.x, this.player.y - 40, "EMPTY SLOT", 0xff0000);
        return;
    }
    
    const config = CONFIG.CONSUMABLES[consumable];
    
    if (config.effect === 'speed') {
        this.speedMultiplier = config.multiplier;
        this.time.delayedCall(config.duration, () => { this.speedMultiplier = 1; });
        this.showFloatingText(this.player.x, this.player.y - 40, "ADRENALINE!", 0x00ff00);
    } else if (config.effect === 'repair') {
        // Repair equipped armor
        for (const slot of ['head', 'body', 'arms', 'feet']) {
            if (this.playerStats.armor[slot]) {
                this.playerStats.armor[slot].durability = Math.min(
                    this.playerStats.armor[slot].durability + config.amount,
                    this.playerStats.armor[slot].maxDurability
                );
            }
        }
        this.showFloatingText(this.player.x, this.player.y - 40, "ARMOR PATCHED!", 0x00aaff);
    }
    
    this.playerStats.consumables[slot] = null;
    sfx.success();
}
```

---

## Phase 6: UI Updates

Update `drawUI()` to show all currencies:

```javascript
// Add credits and materials to the UI text display
this.uiText.setText(`... | CRED: ${this.playerStats.credits} | MAT: ${this.playerStats.materials} | ...`);
```

Add consumable slot indicators to HUD (bottom-left, showing 1/2/3 slots with icons).

Update `updateStatText()` in HideoutScene to show all currencies.

---

## Phase 7: Sound Effects

Add to SoundManager:

```javascript
purchase() { this.playTone(800, 'sine', 0.1, 0.3); this.playTone(1000, 'sine', 0.15, 0.25); }
sell() { this.playTone(600, 'sine', 0.1, 0.25); this.playTone(400, 'sine', 0.1, 0.2); }
useConsumable() { this.playTone(1200, 'sine', 0.1, 0.3); this.playNoise(0.05, 0.15); }
```

---

## Files Modified

- [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html) - All changes in single file

## Testing Checklist

- New save required (v15) - verify old saves prompt for new game
- Kill enemies, verify currency auto-collects with floating text
- Open Trader modal, verify buy/sell works correctly
- Purchase consumables, verify they appear in inventory
- Use consumables with 1/2/3 keys, verify effects apply
- Verify UI shows all three currencies

