---
name: Walker AI and visible LOS
overview: "Implement improved Walker (purple zombie) AI: roomba-style straight-line patrol with stuck handling, gunshot alert (hearing radius), perception-circle hunt with LOS, search phase on lost target, and visible vision cones (flashlight-style) for the player."
todos: []
isProject: false
---

# Walker AI Overhaul and Visible Line of Sight

## Summary of design (from your answers)

- **Scope**: All walkers everywhere; replace current simple aggro and Cemetery waypoint patrol with the new system.
- **Gunshot**: Only walkers within a configurable **hearing radius** react (e.g. 400–600px).
- **Lose target**: **Search phase** — move to last known position, wander within a predefined **search radius**, then resume patrol.
- **Visible LOS**: Walker vision cone drawn like the player’s flashlight so the player can see when they’re in a walker’s line of sight.

---

## 1. Config and state

**File**: [game..html](game..html)

- **CONFIG.ENEMIES.WALKER** (around line 93): Add:
  - `PERCEPTION_RADIUS` (e.g. 280) — circle for see/hear; can reuse or replace current `AGGRO_RANGE` semantics.
  - `VISION_ANGLE` (e.g. `Math.PI / 3`) — cone half-angle for LOS (and for the visible cone).
  - `HEARING_RADIUS` (e.g. 500) — max distance to react to unsuppressed gunshots.
  - `GUNSHOT_ALERT_DURATION` (3000 ms).
  - `SEARCH_RADIUS` (e.g. 80) — wander radius during search phase.
  - `SEARCH_DURATION` (e.g. 4000 ms) — how long to search before resuming patrol.
  - `PATROL_SPEED` (e.g. 40) and optionally `STUCK_THRESHOLD` / `TURN_INCREMENT` (15° in radians).
- **Walker instance state** (in `Enemy` constructor for `type === 'walker'` and in patrol/walker init):
  - `walkerState`: `'PATROL' | 'GUNSHOT_ALERT' | 'HUNT' | 'SEARCH'`.
  - `patrolDirection`: angle (0, π/2, π, -π/2) for horizontal/vertical straight-line patrol.
  - `gunshotAlertEndTime`, `lastKnownPlayerX/Y`, `searchEndTime`, `stuckTurnOffset` (for 15° increments when stuck).

---

## 2. Patrol: roomba-style straight line + stuck handling

- **Patrol**: Walker moves in a single axis (left–right or up–down). On spawn, choose one of four directions (0, π/2, π, -π/2). Each frame in `PATROL`: set velocity along that axis at `PATROL_SPEED`; use wall colliders so they stop at walls.
- **Stuck detection**: If velocity is near zero for a short time (e.g. 0.3–0.5s) while in `PATROL`, consider stuck. **Unstuck**: add 15° (`TURN_INCREMENT`) to `patrolDirection` (wrap), set velocity along new direction, and clear stuck timer. Repeat until moving again (or cap attempts).
- **Cemetery / stealth**: Remove or repurpose waypoint patrol and `updatePatrolEnemies` for walkers; all walkers use this new patrol and state machine. Stealth detection meter can stay but feed into the same walker states (e.g. seeing player in cone → `HUNT`).

---

## 3. Gunshot alert (unsuppressed only, hearing radius)

- **Event**: When the player fires and the shot is **not** silent (`!isSilent`), call a scene method e.g. `onUns suppressedGunshot(shotX, shotY)` (use player position at fire time as proxy for “gunshot location”).
- **Reaction**: For each **walker** where distance from walker to `(shotX, shotY)` ≤ `HEARING_RADIUS`:
  - Set `walkerState = 'GUNSHOT_ALERT'`, `gunshotAlertEndTime = time + 3000`.
  - Optional: store `gunshotTargetX/Y = shotX, shotY` to move toward.
  - Show **red exclamation** above walker (sprite or text, same as “!” above head); hide when leaving alert.
- **Behavior during alert**: For 3 seconds, move toward gunshot position (or in direction of gunshot). After `gunshotAlertEndTime`, set state back to `PATROL` (resume straight-line from current position, keep or reset `patrolDirection` as desired).

---

## 4. Perception circle and hunt mode (see or hear)

- **Perception**: Every frame, for each walker, if state is `PATROL` or `GUNSHOT_ALERT` or `SEARCH`: if player is within `PERCEPTION_RADIUS`, then:
  - **Hear**: Player movement (footsteps) or any sound event could set “last heard” position (optional; can start with “see” only).
  - **See**: Check **line of sight** (see below). If LOS from walker to player is clear, set `walkerState = 'HUNT'`, set `lastKnownPlayerX/Y` to player position each frame while in `HUNT`.
- **Hunt**: Move toward `this.target` (player) at walker speed. Every frame update `lastKnownPlayerX/Y` if still in LOS. When player leaves `PERCEPTION_RADIUS` or LOS is lost: leave `HUNT`, set state to `SEARCH`, set `searchEndTime = time + SEARCH_DURATION`, keep `lastKnownPlayerX/Y` as search center.
- **Line of sight**: Same as for visibility: ray from walker to player; if it intersects any wall in `this.walls`, no LOS. Use Phaser’s physics raycast (e.g. `scene.physics.world.raycast`) or a simple segment-vs-rect test against `this.walls.getChildren()`. Vision **cone**: only consider LOS if the angle from walker to player is within `VISION_ANGLE` of the walker’s facing direction (patrol direction or direction toward player in hunt).

---

## 5. Search phase then back to patrol

- **Search**: Move toward `(lastKnownPlayerX, lastKnownPlayerY)`. When within `SEARCH_RADIUS` (or on arrival), **wander**: e.g. pick a random point within `SEARCH_RADIUS` of that center every 0.5–1s and move there. After `SEARCH_DURATION` ms, set `walkerState = 'PATROL'`, choose a new `patrolDirection` (e.g. based on current velocity or random axis-aligned).

---

## 6. Visible line of sight (like the flashlight)

- **Goal**: Player sees each walker’s vision cone so they know when they’re in a walker’s LOS.
- **Implementation** (same file, GameScene):
  - Add a **graphics object** for walker vision (e.g. `this.walkerVisionGraphics = this.add.graphics().setDepth(85)`), created in `create()`, cleared and redrawn each frame in `update()`. Use a depth between darkness and player so cones are visible.
  - For each **walker** that has an active vision (e.g. in `PATROL`, `GUNSHOT_ALERT`, `SEARCH`, or `HUNT`):
    - **Facing angle**: In PATROL/SEARCH use `patrolDirection` or velocity angle; in GUNSHOT_ALERT use angle toward gunshot target; in HUNT use angle toward player or `lastKnownPlayerX/Y`.
    - Draw a **cone** with `graphics.fillStyle(0xff0000, 0.25)` (or similar red with alpha), then `graphics.slice(walker.x, walker.y, PERCEPTION_RADIUS, facingAngle - VISION_ANGLE, facingAngle + VISION_ANGLE); graphics.fill();` — same pattern as the player’s flashlight cone (around lines 8086–8089) but from walker position and with walker’s range/angle.
  - Optional: Slightly different color/alpha when in HUNT (e.g. brighter red) vs PATROL so the player can read the state.
- **Cleanup**: In `shutdown()`, destroy `walkerVisionGraphics` if present.

This gives a flashlight-style cone for each walker that the player can see at all times (or when in range), matching the “visible like the flashlight” request.

---

## 7. Integration and cleanup

- **Enemy.update** (walker branch, ~2677): Replace the current “if in AGGRO_RANGE move to player” with the state machine: PATROL → stuck check and 15° turn; GUNSHOT_ALERT → move toward gunshot until timer done; HUNT → move to player, update last known, check LOS/radius for transition to SEARCH; SEARCH → move to last known, wander, timer to PATROL.
- **Remove or refactor**: Cemetery-specific waypoint patrol (`spawnPatrolEnemy` waypoints, `updatePatrolEnemies` for walkers). Either remove walker-specific waypoint logic and use the new patrol for all walkers on that level, or keep a separate list only for non-walker patrols if any. Stealth detection meter can still drive a “global alert” that sets all walkers to HUNT if you want to keep that behavior.
- **Gunshot**: In the same place where `isSilent` is checked for SFX/muzzle (e.g. when firing pistol/shotgun/SMG/rifle), add: `if (!modEffects.isSilent) this.onUns suppressedGunshot(this.player.x, this.player.y);`
- **Red exclamation**: Simple text or sprite above walker when `walkerState === 'GUNSHOT_ALERT'`; create once per walker or pool, set visible/position in update.

---

## 8. Order of work (suggested)

1. Add CONFIG and walker state (patrol direction, state enum, timers).
2. Implement PATROL movement and stuck detection + 15° turn.
3. Implement LOS helper (raycast vs walls) and cone check; wire PERCEPTION_RADIUS + LOS to transition PATROL → HUNT.
4. Implement HUNT (chase, update last known, transition to SEARCH on lost LOS/range).
5. Implement SEARCH (move to last known, wander in radius, timer → PATROL).
6. Add `onUns suppressedGunshot` and GUNSHOT_ALERT (hearing radius, 3s, red “!”).
7. Add visible vision cones (walkerVisionGraphics, slice per walker).
8. Remove/refactor Cemetery waypoint patrol for walkers and hook stealth level to new states if needed.

---

## Files to touch

- **[game..html](game..html)**: CONFIG.ENEMIES.WALKER; Enemy constructor and `update()` walker branch; new LOS/cone helper; `onUns suppressedGunshot()`; create/update/shutdown for `walkerVisionGraphics`; fire-weapon block for gunshot event; optional exclamation UI per walker.

No new files required; all logic stays in the single game file.