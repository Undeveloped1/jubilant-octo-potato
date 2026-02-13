---
name: Trader Loot System
overview: Implement a multi-currency economy with two trader locations (hideout + in-level safehouse), expanded loot drops by enemy type, and a full buy/sell trading system with consumables, weapons, armor, and crafting materials.
todos:
  - id: data-structures
    content: Add CONFIG.CURRENCIES, CONFIG.TRADER, new fields to DEFAULT_STATS and DEFAULT_PERSISTENT with save migration
    status: pending
  - id: enemy-loot-drops
    content: Modify spawnLootSkull() - Bandits drop credits, Bosses drop materials, zombies drop scrap
    status: pending
  - id: hideout-trader-card
    content: Create trader card in HideoutScene with shop/sell buttons
    status: pending
  - id: shop-modal-ui
    content: Build shop modal overlay with item list, buy buttons, and close functionality
    status: pending
  - id: buy-sell-logic
    content: Implement purchase transactions and sell-items system with price calculations
    status: pending
  - id: consumables-system
    content: Add inventory slots (max 3), consumable items with timed buff effects, hotkey usage (1-2-3)
    status: pending
  - id: in-level-trader
    content: Add safehouse trader spawn on Level 2 and Level 4, NPC interaction with F key, compact shop UI
    status: pending
  - id: sound-polish
    content: Add trader sounds (purchase, sell, insufficient funds) and UI feedback
    status: pending
isProject: false
---

# Milestone 5: Trader & Expanded Loot System

## Currency System Design

Three currencies with distinct purposes:

- **Scrap** (existing): Crafting items, some basic purchases
- **Credits** (new): Primary trader currency, earned by selling items or dropped by bandits
- **Materials** (new): Hideout upgrades, specialty crafting, dropped by bosses

### Drop Sources


| Enemy Type     | Primary Drop | Secondary Drop      |
| -------------- | ------------ | ------------------- |
| Walker/Spitter | Scrap        | Ammo, Meds          |
| Bandit         | Credits      | Weapons parts, Ammo |
| Boss           | Materials    | Rare items          |
| Crates         | Any currency | Random loot         |


---

## Trader Implementation

### 1. Hideout Trader (New Card in HideoutScene)

Location: New upgrade card position in the hideout UI grid

**Inventory** (always available):

- Ammo Bundle (50 rounds) - 15 credits
- Med Kit (+5 HP) - 20 credits  
- Grenade - 25 credits
- Helmet/Vest - 40-60 credits
- Consumables (Adrenaline, Damage Boost) - 30-50 credits
- Weapons (Shotgun, SMG) - 100-150 credits (if not owned)

**Sell System**:

- Player can sell armor pieces, excess ammo, materials for credits
- Sell prices = ~50% of buy prices

### 2. In-Level Trader (Fixed Safehouse Location)

Appears on specific levels as a "safehouse" zone:

- Level 2 (Apartment) - Room with locked door, opens after clearing nearby enemies
- Level 4 (Sewers) - Hidden alcove trader

**Inventory** (limited, higher prices):

- Emergency supplies only: Ammo, Meds, single Grenade
- Prices 25% higher than hideout trader
- Risk/reward: Stopping to trade leaves you vulnerable

---

## Data Structure Changes

### CONFIG additions

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
        // ... etc
    ],
    SELL_RATE: 0.5, // 50% of buy price
    IN_LEVEL_MARKUP: 1.25 // 25% higher in missions
};
```

### DEFAULT_STATS additions

```javascript
// Add to DEFAULT_STATS
credits: 0,
materials: 0,
inventory: [], // For consumables player is carrying
```

### DEFAULT_PERSISTENT additions

```javascript
// Add to DEFAULT_PERSISTENT  
totalCreditsEarned: 0,
totalMaterialsCollected: 0,
itemsSold: 0,
itemsBought: 0,
```

---

## New Consumables System

Consumables are single-use items that provide temporary buffs:


| Item            | Effect                                   | Duration   | Cost       |
| --------------- | ---------------------------------------- | ---------- | ---------- |
| Adrenaline Shot | +50% move speed                          | 10 seconds | 30 credits |
| Damage Boost    | +50% weapon damage                       | 15 seconds | 50 credits |
| Armor Patch     | Instant +20 durability to equipped armor | Instant    | 25 credits |
| Stim Pack       | Regen 1 HP/sec                           | 10 seconds | 40 credits |


Player can carry up to 3 consumables, used with number keys (1, 2, 3) or via inventory menu.

---

## UI Components

### Hideout Trader Card

New card in `HideoutScene` at position (500, 375) or new row:

```
┌──────────────────────────┐
│ TRADER                   │
│ ─────────────────────────│
│ Credits: 150 💰          │
│ [BROWSE SHOP]            │
│ [SELL ITEMS]             │
└──────────────────────────┘
```

Clicking "BROWSE SHOP" opens a modal overlay (similar to existing settings menu pattern).

### Shop Modal UI

```
┌─────────────────────────────────────────┐
│ TRADER - Your Credits: 150              │
├─────────────────────────────────────────┤
│ [Ammo Bundle]     50 rounds    15 💰 [BUY]│
│ [Med Kit]         +5 HP        20 💰 [BUY]│
│ [Grenade]         x1           25 💰 [BUY]│
│ [Adrenaline]      Speed+50%    30 💰 [BUY]│
│ [Damage Boost]    DMG+50%      50 💰 [BUY]│
│ ...                                      │
├─────────────────────────────────────────┤
│                              [CLOSE]     │
└─────────────────────────────────────────┘
```

### In-Level Trader Interaction

When player approaches safehouse NPC and presses F:

- Time slows/pauses (optional)
- Compact shop UI appears
- Limited inventory, higher prices
- Press ESC or click outside to close

---

## Implementation Order

The work is organized into discrete, testable chunks:

1. **Data structures first** - Add new currencies and config without breaking existing saves
2. **Loot drop changes** - Modify `spawnLootSkull()` to drop by enemy type
3. **Hideout trader UI** - New card + shop modal
4. **Buy/sell logic** - Transaction handlers with validation
5. **Consumables system** - Inventory slots, hotkeys, buff effects
6. **In-level trader** - Safehouse spawn points, NPC interaction
7. **Polish** - Sound effects, animations, balance tuning

---

## Compatibility Notes

- Existing saves will get `credits: 0, materials: 0, inventory: []` via migration
- Scrap continues to work exactly as before for crafting/upgrades
- New hideout upgrade costs can optionally require materials instead of scrap

