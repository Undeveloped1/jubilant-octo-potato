---
name: Hideout UI Redesign
overview: Reorganize the Hideout UI into a clean tabbed interface with MISSION MAP as the prominent action, grouping related functions into logical tabs.
todos:
  - id: header-footer
    content: Create persistent header (title + resources) and footer (MAIN MENU, SETTINGS, MISSION MAP)
    status: completed
  - id: tab-system
    content: Implement tab bar and tab switching logic with content cleanup
    status: completed
  - id: facilities-tab
    content: Refactor facility cards into renderFacilitiesTab() with consistent sizing
    status: completed
  - id: character-tab
    content: Create renderCharacterTab() grouping CLASS, SKILLS, UPGRADES, MODS, STATS, CHALLENGES
    status: completed
  - id: shop-tab
    content: Create renderShopTab() with TRADER interface
    status: completed
  - id: styling
    content: Apply consistent colors, sizes, and spacing throughout
    status: completed
isProject: false
---

# Hideout UI Redesign

## Current Problems

- Overlapping buttons (TRADER covers ARMORY, MODS overlaps SETTINGS)
- No visual hierarchy or grouping
- Inconsistent button sizes and colors
- Elements cut off at screen edges
- 10+ buttons competing for attention

## New Layout Structure

```
+------------------------------------------------------------------+
|  THE HIDEOUT                    HP: 32/32  AMMO: 1105            |
|                                 SCRAP: 366  CREDITS: 647  MAT: 0 |
+------------------------------------------------------------------+
|  [FACILITIES]  [CHARACTER]  [SHOP]                               |
+------------------------------------------------------------------+
|                                                                  |
|  +----------------+  +----------------+  +----------------+      |
|  |  REST AREA     |  |  GENERATOR     |  |  ARMORY        |      |
|  |  LVL: 12       |  |  LVL: 1        |  |  NVG UNLOCKED  |      |
|  |  [UPGRADE]     |  |  [MAX LEVEL]   |  |  [EQUIPPED]    |      |
|  +----------------+  +----------------+  +----------------+      |
|                                                                  |
|  +----------------+  +----------------+                          |
|  |  WORKBENCH     |  |  REPAIR        |                          |
|  |  +25% damage   |  |  STATION       |                          |
|  |  [UPGRADED]    |  |  [NO REPAIRS]  |                          |
|  +----------------+  +----------------+                          |
|                                                                  |
+------------------------------------------------------------------+
|  [MAIN MENU]  [SETTINGS]    +============================+       |
|                             |      MISSION MAP           |       |
|                             +============================+       |
+------------------------------------------------------------------+
```

## Tab Contents

**FACILITIES Tab (default)**

- REST AREA, GENERATOR, ARMORY (top row)
- WORKBENCH, REPAIR STATION (bottom row)
- Clean 3x2 grid layout

**CHARACTER Tab**

- CLASS selection (with current class shown)
- SKILLS panel (with point indicator)
- UPGRADES panel
- MODS panel (with count)
- STATS panel
- CHALLENGES (with unclaimed indicator)

**SHOP Tab**

- TRADER (full-width, prominent)
- Future: Could add more shop features

## Implementation Approach

1. **Refactor `create()` method** in [game.html](game.html) (lines 2896-3093)
  - Extract UI creation into separate methods per tab
  - Add tab state management (`this.currentTab`)
  - Create `renderHeader()`, `renderTabs()`, `renderFooter()` methods
2. **Create tab switching system**
  - `showTab(tabName)` method clears content area and renders appropriate tab
  - `renderFacilitiesTab()` - existing facility cards
  - `renderCharacterTab()` - CLASS, SKILLS, UPGRADES, MODS, STATS, CHALLENGES
  - `renderShopTab()` - TRADER interface
3. **Standardize visual styling**
  - Consistent card sizes: 200x140 for facilities
  - Consistent button sizes: tabs 100x40, actions 80x35
  - Color palette: 
    - Tabs: `0x444444` (inactive), `0x666666` (active)
    - Primary action (MISSION MAP): `0x00aa44` (green)
    - Secondary: `0x444444` (gray)
4. **Fixed footer with MISSION MAP**
  - MAIN MENU (left)
  - SETTINGS (left-center)  
  - MISSION MAP (right, large and prominent)

## Key Code Changes

The main changes will be in the `HideoutScene.create()` method, restructuring it to:

- Store content elements in `this.tabContent` array for cleanup on tab switch
- Keep header/footer elements persistent
- Call appropriate render method based on active tab

