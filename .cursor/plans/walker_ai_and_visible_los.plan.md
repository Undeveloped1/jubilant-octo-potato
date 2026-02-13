---
name: Walker AI and Visible LOS
overview: Implement improved Walker (purple zombie) AI with roomba-style patrol, gunshot alert, perception-circle hunt, search phase, visible vision cones, and 50% reduced walk speed.
todos:
  - id: config-and-state
    content: Add CONFIG.ENEMIES.WALKER params and walker state (patrol direction, state enum, timers)
  - id: patrol-and-stuck
    content: Implement PATROL movement and stuck detection with 15° turn
  - id: los-and-hunt
    content: Implement LOS helper and PERCEPTION_RADIUS + cone check; PATROL → HUNT transition
  - id: search-phase
    content: Implement SEARCH (move to last known, wander in radius, timer → PATROL)
  - id: gunshot-alert
    content: Add onUns suppressedGunshot and GUNSHOT_ALERT (hearing radius, 3s, red "!")
  - id: visible-cones
    content: Add walkerVisionGraphics and draw cone per walker (flashlight-style)
  - id: integrate-cleanup
    content: Remove/refactor Cemetery waypoint patrol for walkers; wire stealth if needed
  - id: testing-lighten
    content: Lighten level for testing (reduce darkness alpha or increase base light)
  - id: testing-walker-only
    content: Add WALKER_AI_TEST_MODE flag; only spawn walkers while flag is set
isProject: false
---

# Walker AI Overhaul and Visible Line of Sight

## Summary of design

- **Scope**: All walkers everywhere; replace current simple aggro and Cemetery waypoint patrol.
- **Gunshot**: Only walkers within a configurable **hearing radius** react.
- **Lose target**: **Search phase** at last known position, wander in **search radius**, then resume patrol.
- **Visible LOS**: Walker vision cone drawn like the player's flashlight.
- **Speed**: Walker walk speed reduced by **50%** from current value.

---

## 1. Config and state

**File**: [game..html](game..html)

- **CONFIG.ENEMIES.WALKER** (around line 93):
  - **Reduce base speed by 50%**: Current `SPEED: 60` → set to `30` (or keep `SPEED: 60` and apply 0.5 multiplier wherever walker movement is computed). All walker movement (patrol, hunt, search, gunshot alert) should use this reduced speed.
  - Add: `PERCEPTION_RADIUS`, `VISION_ANGLE`, `HEARING_RADIUS`, `GUNSHOT_ALERT_DURATION`, `SEARCH_RADIUS`, `SEARCH_DURATION`, `PATROL_SPEED` (e.g. 20 if base is 30, or 40 * 0.5), `STUCK_THRESHOLD`, `TURN_INCREMENT` (15° in radians).

- **Walker instance state**: `walkerState`, `patrolDirection`, `gunshotAlertEndTime`, `lastKnownPlayerX/Y`, `searchEndTime`, `stuckTurnOffset`.

---

## 2. Patrol: roomba-style + stuck handling

- Patrol at **50% speed** (use `PATROL_SPEED` or `this.speed * 0.5`). Stuck detection and 15° turn as in original plan.

---

## 3. Gunshot alert

- Unsuppressed shot → `onUns suppressedGunshot(shotX, shotY)`. Walkers within `HEARING_RADIUS` enter `GUNSHOT_ALERT` for 3s, red "!", move toward shot at reduced walker speed.

---

## 4. Perception and hunt

- PERCEPTION_RADIUS + LOS (cone + raycast). Enter HUNT when see/hear player. Chase at **50% speed**. On lost LOS/range → SEARCH.

---

## 5. Search phase

- Move to last known position, wander in SEARCH_RADIUS, then back to PATROL. Use reduced speed for search movement.

---

## 6. Visible line of sight

- `walkerVisionGraphics`: draw cone per walker with `graphics.slice(...)` (flashlight-style), red tint, PERCEPTION_RADIUS and VISION_ANGLE.

---

## 7. Integration and cleanup

- Walker branch in `Enemy.update` uses state machine; all movement uses the new 50% speed. Remove/refactor Cemetery waypoint patrol for walkers.

---

## Speed change summary

- **Current**: `CONFIG.ENEMIES.WALKER.SPEED: 60`.
- **New**: Set `SPEED: 30` (50% of 60), and use this value for all walker movement (patrol, hunt, search, gunshot alert). Alternatively keep 60 in CONFIG and multiply by 0.5 in code so the reduction is explicit and easy to tune.

---

## 8. Testing accommodations (temporary)

For testing the new walker AI without distraction:

### 8.1 Lighten the level

- **Where**: GameScene lighting in [game..html](game..html) — `this.darkness` (around line 6096) is a full-screen rectangle with `0x000000, 0.95` alpha, masked by `lightShape`.
- **Options** (pick one or combine; keep changes easy to revert, e.g. behind a flag):
  - **A)** Reduce darkness alpha from `0.95` to something like `0.2`–`0.35` when a test flag is true, so the level is visibly brighter.
  - **B)** When test flag is true, hide darkness: `this.darkness.setVisible(false)` after creation (revert by setting visible true).
  - **C)** Increase `CONFIG.PLAYER.LIGHT_RADIUS` (e.g. from 60 to 250) when test flag is true so the player’s default circle of light is much larger.
- **Recommendation**: Add a single `WALKER_AI_TEST_MODE` (e.g. on CONFIG or at top of GameScene) and, when true, set darkness alpha to ~0.25 (or hide darkness) so the walker cones and movement are easy to see. Revert when turning off test mode.

### 8.2 Suspend non-walker spawns

- **Where**: Level setup in [game..html](game..html) — random spawns use `levelEnemyTypes[level]` and `enemyTypes` (around 7080–7170); each level also has hardcoded `spawnEnemy(type, x, y)` calls (e.g. 7701+, 7728+, 7956+, etc.).
- **Implementation**:
  - **Random spawns**: When `WALKER_AI_TEST_MODE` is true, force `enemyTypes = ['walker']` (or equivalent) so the pool used for random spawns is walker-only.
  - **Level-specific spawns**: When the flag is true, either (a) only call `spawnEnemy` when `type === 'walker'`, or (b) replace `type` with `'walker'` for every spawn on that level. Option (a) reduces total enemy count (only pre-placed walkers); option (b) keeps the same number of spawn points but all become walkers. Choose (b) if you want a full room of walkers for testing.
- **Boss / special levels**: For levels that spawn a single boss or necromancer (e.g. 5, 7), decide whether to skip that spawn in test mode or replace with a walker; recommend skip so the level doesn’t require boss logic.
- **Risk rooms**: Apply the same rule where risk-room enemy types are chosen (around 7451): when test flag is true, only spawn walkers.
- **Result**: While `WALKER_AI_TEST_MODE` is true, no leapers, bandits, spitters, exploders, bosses, or necromancers spawn; only walkers. Easy to turn off later by clearing the flag.
