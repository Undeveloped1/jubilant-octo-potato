# Phase 4 prep: Ranged limb selection (distance bands)

**Goal (from plan):** Ranged hits (bullet, acid) choose limb from distance bands: close = upper body/head, medium = torso, far = legs (or miss). One generic set of bands for now (no weapon/accuracy).

---

## Current state (verified)

- **Call sites** already pass position for distance:
  - **Bullet** (game.js ~7949): `this.hitPlayer(bulletDmg, bx, by, { damageSource: 'bullet' })` — `bx, by` = bullet position at hit.
  - **Acid** (game.js ~7962): `this.hitPlayer(CONFIG.ENEMIES.SPITTER.DAMAGE, ax, ay, { damageSource: 'acid' })` — `ax, ay` = acid position at hit.
- **hitPlayer** already receives `fromX, fromY` as second and third arguments. So distance can be computed inside `hitPlayer` as `Phaser.Math.Distance.Between(this.player.x, this.player.y, fromX, fromY)` when `damageSource` is `'bullet'` or `'acid'`. No call-site signature change required.
- **Limb pick for non-melee** is at game.js ~12255–12257: the `else` branch that does `targetLimbId = pickOneLimbByWeight(null)`. Phase 4 adds a **ranged** branch before that `else`, so: melee → stance; **ranged (bullet/acid) → distance band**; else → all limbs.

---

## Implementation checklist (when you’re ready)

### 1. Config (next to other limb config, ~1048)

Add:

- **Distance thresholds** (one set for now): e.g. `RANGED_CLOSE_MAX = 100`, `RANGED_MEDIUM_MAX = 250` (so close &lt; 100, medium &lt; 250, else far).
- **Per-band limb pools**: e.g.  
  `RANGED_LIMB_BANDS = { close: ['head','chest','leftArm','rightArm'], medium: ['chest','abdomen'], far: ['leftLeg','rightLeg'] }`  
  (Plan says far = legs or miss; optional miss can be added later.)

### 2. Helper (optional but clear)

- `getRangedDistanceBand(distance)` → `'close' | 'medium' | 'far'` using the thresholds.  
  Or inline in `hitPlayer`: `if (dist < RANGED_CLOSE_MAX) band = 'close'; else if (dist < RANGED_MEDIUM_MAX) band = 'medium'; else band = 'far';`

### 3. hitPlayer single-limb path (game.js ~12227–12258)

After the melee block, **before** `targetLimbId = pickOneLimbByWeight(null)`:

- **If** `(damageSource === 'bullet' || damageSource === 'acid')` **and** `fromX != null && fromY != null`:
  - `dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, fromX, fromY)`.
  - Resolve `band` from thresholds (close / medium / far).
  - `pool = RANGED_LIMB_BANDS[band]` (or fallback to all limbs if band unknown).
  - Optionally filter to limbs with HP &gt; 0 (same pattern as melee).
  - `targetLimbId = pickOneLimbByWeight(pool)`.
- **Else** (explosion, or no position): keep `targetLimbId = pickOneLimbByWeight(null)`.

No change to outcome roll or damage application; they already use `targetLimbId`.

### 4. Optional: damage log

- You can add `band` (and maybe `dist`) to the log entry for ranged hits so testing is easy (e.g. “3 Chest (close)” or “2 L.Leg (far)”). Not required by the plan.

### 5. Testing

- Close range: stand near bandit/spitter, take bullet/acid; expect mostly head/chest/arms in log.
- Far range: take hits from distance; expect mostly legs (and possibly abdomen if medium band is hit).
- Explosion unchanged: still uses fallback (all limbs, size-weighted).

---

## Files to touch

- **game.js only**: add config constants, then the ranged branch in `hitPlayer` (no new files).

---

## Dependencies

- Phase 1 (single-limb path, `damageSource`, `fromX`/`fromY`) ✅  
- Phase 3 (outcome roll, damage log) ✅  
- Melee remains stance-based; ranged is the only new branch in the limb-selection chain.
