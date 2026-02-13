---
name: Hideout Mission Map
overview: Add a visual city map to the Hideout that shows all 7 levels as locations, with sequential unlocking. Players can select and deploy to any unlocked level. After completing a level, show choice to continue or return to hideout.
todos:
  - id: stats
    content: Add highestLevelUnlocked to DEFAULT_STATS and add migration for old saves
    status: completed
  - id: progression
    content: Update nextLevel() and winGame() to track highestLevelUnlocked
    status: completed
  - id: level-choice
    content: Create showLevelCompleteChoice() UI with Continue/Hideout buttons
    status: completed
  - id: map-ui
    content: Create showMissionMap() in HideoutScene with city overview visual
    status: completed
  - id: level-nodes
    content: Draw level nodes with roads, colors for cleared/locked/current states
    status: completed
  - id: selection
    content: Add click handlers for level selection and connect to deploy flow
    status: completed
  - id: deploy-update
    content: Update DEPLOY button to show selected mission or open map
    status: completed
isProject: false
---

# Hideout Mission Map

## Overview

Add a top-down city overview map to the Hideout showing all 7 levels as selectable locations. Levels unlock sequentially as the player progresses.

## Data Model Changes

Add to `DEFAULT_STATS` in [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html):

```javascript
highestLevelUnlocked: 1,  // Track progression (1-7)
```

This tracks the highest level the player has unlocked. Combined with the existing `nextLevel` field, we know:

- Which levels can be selected (1 through highestLevelUnlocked)
- Which level is the "frontier" for progression

## Map UI Design

Create a modal map view accessible from hideout with:

```
+------------------------------------------+
|           MISSION SELECT                  |
|                                          |
|    [1]---[2]---[3]                       |
|     |         /                          |
|    [4]---[5]                             |
|          |                               |
|        [6]---[7]                         |
|                                          |
|  1. Street (CLEARED)                     |
|  2. Apartment (CLEARED)                  |
|  3. Rooftop (LOCKED)                     |
|  ...                                     |
+------------------------------------------+
```

Visual elements:

- City grid background (dark with grid lines)
- Level nodes as colored circles/squares
- Connecting roads/paths between levels
- Cleared levels: Green with checkmark
- Current target: Yellow/pulsing
- Locked levels: Gray/dimmed with lock icon
- Hover shows level name and status

## Level Node Positions (City Layout)

```javascript
const LEVEL_POSITIONS = {
    1: { x: 150, y: 120, name: "Street" },
    2: { x: 300, y: 80, name: "Apartment" },
    3: { x: 450, y: 120, name: "Rooftop" },
    4: { x: 200, y: 220, name: "Sewers" },
    5: { x: 350, y: 200, name: "Hospital" },
    6: { x: 400, y: 320, name: "Mall" },
    7: { x: 550, y: 350, name: "Cemetery" }
};
```

Road connections: 1-2, 2-3, 1-4, 4-5, 3-5, 5-6, 6-7

## Level Complete Choice Screen

When player goes through a door (completes a level), instead of auto-transitioning, show a choice:

```
+------------------------------------------+
|         LEVEL COMPLETE!                  |
|                                          |
|      Street -> Apartment                 |
|                                          |
|   [CONTINUE TO NEXT]    [RETURN HOME]   |
|                                          |
+------------------------------------------+
```

- Modify `nextLevel()` to show choice UI instead of immediate transition
- "CONTINUE TO NEXT" proceeds to next level (current behavior)
- "RETURN HOME" saves progress and goes to HideoutScene
- Both options unlock the next level in `highestLevelUnlocked`
- Screen fades in over paused gameplay
- For level 7 (final), only show "RETURN HOME" (extraction required)

## Implementation

### 1. Update Stats Tracking

- Add `highestLevelUnlocked` to DEFAULT_STATS
- Update `winGame()` to increment when completing a new level
- Update `nextLevel()` to show choice screen and track unlock
- Add migration for old saves

### 2. Level Complete Choice UI (GameScene)

- Create `showLevelCompleteChoice()` method
- Pause game, show overlay with level name and options
- CONTINUE button: transitions to next level
- HIDEOUT button: saves stats and returns to HideoutScene
- Both unlock the next level before transitioning

### 3. Create Map Modal in HideoutScene

- Add "MISSION MAP" button to hideout (prominent position)
- Create `showMissionMap()` method
- Draw city grid background
- Draw road connections between level nodes
- Draw level nodes with appropriate styling
- Add click handlers for unlocked levels
- Show level info on hover

### 4. Deploy Flow Changes

- Clicking unlocked level sets `stats.nextLevel` and closes map
- DEPLOY button uses selected level
- Visual feedback shows selected mission

### 5. Replace Existing DEPLOY

- Current DEPLOY button becomes "MISSION MAP" or shows map inline
- Map selection feeds into deploy

## Files Modified

- [game.html](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.html): All changes in single file

## Migration

Old saves without `highestLevelUnlocked` default to their `nextLevel` value to preserve progress.