# Design ideas & brainstorming

Design and lore ideas captured for future implementation. **No implementation implied** — this doc is for reference and planning.

---

## Blood & infection (brainstorm)

### Blood bar *(MVP in game — Jul 2026 Phase 6)*

- **Single global blood bar** that empties when minor/major bleeds tick (in addition to per-limb HP).
- Regen while no bleeds are active; blood = 0 → bleed-out death.
- **Hideout Med Bay** (Jul 2026): pay scrap → full blood refill (+ infection clear if present). Rare blood items still open.

### Infection from bites *(MVP in game — Jul 2026 Phase 6; treatment loop Jul 2026)*

- **Bite** (zombie/leaper/spitter/etc. melee or pin; not bandit bullets) starts **infection**.
- **One infection bar** (0–100%): fills over ~90s after being bitten.
- **Treatment:**
  - Extraction / clear level door → infection cleared (MVP).
  - **Antidote** — consumable hotkey (1/2/3) or medical item dropped on any limb; also trader + crate/spitter loot.
  - **Hideout Med Bay** — Facilities tab; scrap cost clears infection + refills blood.
- If bar hits 100% before treatment → death (“INFECTION TOOK HOLD!”).

### Lore: virus has weakened

- **Outbreak:** No cure or treatment — bite = turn, death sentence.
- **Now (game present):** The virus has **weakened** over time (mutated, less virulent, etc.). Bites are still serious but **treatable**; antidote / extraction / hideout can save you.
- Justifies: “Why can the player survive a bite?” and “Why does infection have a timer instead of instant game over?”

### Super infection (not yet implemented)

- **Certain zombies** are more virulent and cause **super infection**.
- Super infection is **uncurable** — no antidote, no extraction save. Player is doomed.
- When the player dies from super infection (or this type of permanent death), they **select a new hero** from the **“station”** at the hideout (hero-select / roster).
- Design hooks:
  - Which enemies cause super infection (e.g. boss, named “virulent” type, risk-room only).
  - Clear feedback so the player knows they’re super infected (e.g. distinct debuff / UI).
- Ties into: hideout as persistent hub, “station” as the place you pick the next character after a run ends.

---

## Damage system — constituent parts and tables

Breakdown of what the damage/effect system needs so we can implement roll tables, modifiers, and limb selection.

### 1. Attack category (melee vs ranged)

- **Melee**: enemy overlaps player (walker, leaper, bandit punch, etc.). No distance falloff; limb choice can use enemy type + attack type (e.g. pounce → arms).
- **Ranged**: projectile hits player (bullet, acid). Distance and optionally weapon type affect limb bands (close = head/torso, medium = torso/abdomen, far = legs or miss).

*Table:* Which sources are melee vs ranged (or a flag per source). Used to decide which limb-selection path runs.

### 2. Source identity (who / what is hitting)

- **Enemy type**: walker, leaper, spitter, bandit, boss, exploder, necromancer, etc.
- **Attack type** (optional, per enemy): e.g. walker = grab vs bite; leaper = pounce vs swipe. Some enemies have one, some have two.

*Table:* Per enemy type (and per attack type if used): modifiers to the base outcome table (e.g. +break%, +black%, escalation rate), and limb bias for melee (arms/legs/torso/head or null = random).

### 3. Outcome table (what happens on this hit)

One roll per hit. Possible outcomes (example bands):

- Damage only
- Damage + minor_bleed
- Damage + major_bleed
- Damage + break
- Black limb (full damage to limb + trauma, or instant black)

*Table:* Base percentages (e.g. 82 / 10 / 5 / 2.5 / 0.5). Can be one “generic” base table, or one per attack category (melee base, ranged base) or per attack type.

### 4. Outcome modifiers (shift the bands)

- **Consecutive hits**: same enemy (or same type in window) has hit the player N times → add a % into effect outcomes (escalation). Stored at runtime (e.g. hit count per enemy instance or per type).
- **Enemy/attack modifiers**: from (2), e.g. leaper pounce +break, spitter +black, tank +leg break. Applied on top of base table.

*Table:* Escalation curve (e.g. +5% per hit, cap 25%). Per-enemy/attack modifiers (breakBonus, blackBonus, minorBleedBonus, majorBleedBonus, etc.).

### 5. Limb selection (which limb is hit)

- **Melee**: limb bias from source (e.g. pounce → arms, tank → legs). If no bias, random limb (or weighted).
- **Ranged**: distance bands (close / medium / far) map to limb or limb-category weights. Optionally weapon type (pistol vs rifle) changes bands or spread.

*Table:*  
- Melee: per enemy type / attack type, limb bias (e.g. `arms`, `legs`, `torso`, `head`, or `null` for random).  
- Ranged: distance thresholds (closeMax, mediumMax) and per-band limb weights (e.g. close = [head, chest, leftArm, rightArm], medium = [chest, abdomen], far = [leftLeg, rightLeg] or + miss chance).

---

### 5a. Melee limb targeting — stance (upright vs on-all-fours)

**Rule:** What the attacker can reach depends on posture.

- **Upright** (walker, bandit, humanoid): natural targets = **arms, chest, head**. They’re at face/chest height; legs are lower and less likely unless they’re sweeping or the player is down. So melee limb pool = `[leftArm, rightArm, chest, head]` (optionally weighted, e.g. chest most likely, then arms, then head).
- **On all fours** (crawler, leaper when low, quadruped): natural targets = **legs, abdomen**. They’re low; they bite or swipe at legs and belly. So melee limb pool = `[leftLeg, rightLeg, abdomen]` (maybe crotch too). Optional: small chance to still hit arms if they lunge up.

**Implementation:** One flag or enum per enemy (or per attack): `stance: 'upright' | 'onAllFours'`. Look up limb pool (or limb weights) from that. No per-enemy limb list needed—just two pools. Overrides (e.g. “leaper pounce = arms because they’re jumping at you”) can be special cases for that attack type.

*Table:* `MELEE_LIMB_POOLS.upright = [leftArm, rightArm, chest, head]`, `MELEE_LIMB_POOLS.onAllFours = [leftLeg, rightLeg, abdomen]`. Per enemy type (or attack): which stance, and optional override pool for that attack (e.g. pounce → arms).

---

### 5a(ii). Limb size / target area (weighted by relative size)

**Rule:** When picking a limb from a pool or band, **weight by relative size** of the body part. Someone aiming center mass should hit chest or abdomen most of the time, not a foot or hand—unless distance/spread/accuracy pushes the hit “off” the center.

- **Why it matters:** Without size weights, a “center mass” band (e.g. torso) could still pick leftArm vs chest with equal probability. In reality, chest is a much larger target than one arm. So within any pool or band, use **limb size weights** (target area or hit probability) so that:
  - **Chest** and **abdomen** are the most likely when the “aim” is center mass.
  - **Head** is smaller than chest but still a distinct zone (and why helmet matters).
  - **Arms** and **legs** are thinner; they become more likely when spread/distance/accuracy is worse (e.g. far band, low hit quality).
- **Armor link:** Helmet and chest/vest armor protect the **high-size-weight** zones (head, chest). So size weights both drive “where hits land” and justify why those slots are valuable.

**Implementation:** One table, e.g. `LIMB_TARGET_WEIGHT` or `LIMB_SIZE_WEIGHT`, per limb id: `{ head: 12, chest: 50, abdomen: 25, leftArm: 10, rightArm: 10, leftLeg: 15, rightLeg: 15, crotch: 8 }` (numbers are relative; chest largest, then abdomen, legs, arms, head, crotch). When choosing a limb **within** a pool or band, use **weighted random** with these weights (only among limbs in the pool/band). So “center mass” band = [chest, abdomen] or [head, chest, leftArm, rightArm]; within that list, chest has highest weight, so it wins most of the time unless we explicitly add spread (e.g. far band or low accuracy shifts weight toward legs/arms).

*Table:* `LIMB_TARGET_WEIGHT[limbId]` = number (relative target area). Used whenever we pick one limb from a set (melee pool, ranged band). Tune so chest > abdomen > legs > arms > head > crotch (or match your intended “center mass” feel).

---

### 5b. Ranged limb targeting — keep it one pipeline, not a pile of ifs

Ranged has many inputs: **distance**, **weapon** (pistol, rifle, acid), **attacker accuracy** (skill points or NPC stat). Instead of “if rifle and close and accuracy > 5 then …” everywhere, collapse to a **single number** that drives one lookup.

**Option A — Effective “hit quality” (0–1)**  
- Compute: `distanceFactor` (e.g. 1 at point-blank, 0 at max range; linear or curve).  
- Compute: `weaponAccuracy` (per weapon/projectile from config; rifle holds accuracy longer than pistol, acid might drop fast).  
- Compute: `skillAccuracy` (e.g. bandit “accuracy” stat or player-facing: 0–1 from skill points).  
- Combine: `hitQuality = distanceFactor * weaponAccuracy * (0.7 + 0.3 * skillAccuracy)` or similar. One formula, one number.  
- Use `hitQuality` to **pick a limb band**: e.g. 0.8–1.0 = head/chest/arms (precise), 0.4–0.8 = torso/abdomen, 0–0.4 = legs or miss. So one lookup: which band does this hitQuality fall in, then pick random limb from that band’s list (or weighted random).  
- All tuning lives in: (1) the formula constants, (2) weapon/projectile accuracy values, (3) band boundaries and limb lists per band. No branching on “if weapon X and distance Y”.

**Option B — Distance band first, then blur by accuracy**  
- Step 1: Distance only → band (close / medium / far) and a **default** limb weight array for that band.  
- Step 2: “Spread” or “blur” the weights by accuracy: low accuracy = shift weight toward “middle” limbs (torso, legs) and maybe add a miss chance; high accuracy = keep band’s default (more head/chest at close). So one spread function: `blurWeights(defaultWeights, accuracy)` that moves weight from extremities toward center (or adds miss).  
- Step 3: Weapon type can change the **default** band widths (rifle = “close” band extends farther) or the default weights per band. So tables stay: band → default weights; weapon → band thresholds and maybe spread factor. Accuracy is one parameter into the blur step.

**Option C — Precomputed grid (distance × weapon), accuracy shifts band**  
- Ranged limb weights live in a 2D grid: rows = distance band (close/medium/far), columns = weapon/projectile type. Each cell = limb weight array (or limb list + weights).  
- At runtime: get distance band (from distance + weapon’s band thresholds), get weapon id → one table lookup → base limb weights. Then: accuracy shifts which “row” you use (e.g. high accuracy = use “tighter” row for that band, or interpolate between rows). So still one lookup plus one optional interpolation; all data in one table.

**Recommendation:** Option A (hit quality) or B (band + blur). One small function: `getRangedLimbWeights(distance, weaponId, accuracyStat)` that returns a weight object or list; then one size-weighted random pick (see 5a(ii)) so center-mass aim favors chest/abdomen—hitting the right foot only when distance/spread puts you in a legs band. All “a lot calculated” is inside that function and the config it reads; the rest of the game just calls it and gets a limb. Tables to define: (1) per-weapon/projectile: accuracy curve vs distance and maybe base limb weights per “quality” band, or (2) band thresholds per weapon + limb weights per band + blur rule for accuracy; (3) limb size weights (5a(ii)) when picking from the band.

---

### 6. Distance (ranged only)

- **Close**: high accuracy, upper body / head.
- **Medium**: torso / abdomen.
- **Far**: legs or miss (projectile effectiveness drop).

*Table:* Numeric thresholds (e.g. close &lt; 80, medium &lt; 200, else far). Can be per weapon or per projectile type (acid vs bullet).

### 7. Weapon / projectile type (ranged only)

- Bandit: pistol vs rifle (different accuracy falloff or limb bands).
- Spitter: acid (maybe different table: corrosive = higher black chance, plus distance).

*Table:* Per weapon/projectile: distance thresholds and/or limb weights per band. Optional: separate outcome modifiers (e.g. acid +black%).

### 8. Runtime state (not config tables)

- **Hit count per source**: e.g. `enemyHitCount[enemyId]` or `enemyTypeHitCount[type][lastHitTime]` for escalation. Reset on death or after timeout.
- **Last hit time** (optional): for “same type in window” escalation.

---

**Summary — tables we need**

| What | Purpose |
|------|--------|
| Melee vs ranged flag (or attack category) | Chooses limb logic path |
| Base outcome table(s) | Damage only / +minor / +major / +break / black % |
| Enemy + attack type modifiers | Shift outcome bands (e.g. +break for leaper pounce) |
| Escalation curve | Consecutive-hit penalty (e.g. +5% per hit) |
| Melee limb bias | Per enemy/attack: arms/legs/torso/head or random |
| Ranged distance thresholds | Close/medium/far bands |
| Ranged limb weights per band | Which limbs (or categories) per distance |
| **Limb size / target area weights** | Relative size per limb (chest/abdomen largest); weighted random within pool/band so center mass hits chest, not foot; justifies helmet/vest |
| Weapon/projectile modifiers (optional) | Different bands or outcome shifts for acid vs bullet |

---

### Implementation status (limb/damage system)

The damage system above is **implemented** in `game.js` per `.cursor/plans/limb_effects_phased_implementation_bf516cf0.plan.md`:

- **Phase 1 (Bedrock):** Single limb per hit when `damageSource` is set; `LIMB_TARGET_WEIGHT`; size-weighted `pickOneLimbByWeight`; call sites pass `damageSource` (bullet, acid, melee, explosion).
- **Phase 2 (Melee stance):** `MELEE_LIMB_POOLS` (upright / onAllFours), `MELEE_STANCE_BY_ENEMY`; melee uses stance-based limb pools; sticky zone (upper/middle/lower) per attacker with zone weights.
- **Phase 3 (Outcome roll):** `LIMB_OUTCOME_TABLE`, `rollOutcome`; one roll per hit → damage_only / minor_bleed / major_bleed / break / black; effects applied to chosen limb. Combat log (damage + limb + outcome, ARMOR) with toggle (backtick).
- **Phase 4 (Ranged bands):** `RANGED_CLOSE_MAX`, `RANGED_MEDIUM_MAX`, `RANGED_LIMB_BANDS`; bullet/acid use distance to pick limb band (close = head/chest/arms, medium = torso, far = legs).
- **Phase 5 (Escalation):** `limbEffectHitCount` Map per melee attacker; `outcomeTableWithEscalation` (+5% effect per hit, cap 25%); 15s timeout and cleanup when enemy inactive.
- **Phase 6 (Enemy modifiers):** `ENEMY_OUTCOME_MODIFIERS` (leaper +break, spitter +black, exploder +majorBleed, boss +black/+break); `outcomeTableWithEnemyModifiers` applied after escalation; acid treated as spitter for modifiers.

Additional behaviour (not in original plan): armor “soft target” logic (zombies/bandits after 2 blocks bypass armor every other hit and target arms or arms+legs); enemy melee hit cooldown (700 ms) so armor durability is not drained per frame; all damage paths log to combat log.

**Magazine system (in-run):** Physical mags (mag_pistol, mag_smg, mag_rifle), fill by dragging ammo onto mag, mag slot on weapon, R reload from rig/pocket, firing from mag, HUD rounds/max, ground drop with rounds, trader buy; migration = one mag per slotted weapon. **TESTING_FEEDBACK follow-ups complete** (drag-mag, rig→pockets, hover/tooltip ammo, rounds on slot, empty-click, mags in loot for bandits+crates). Flashlight per-weapon/body deferred for design workups.

---

## Bleed system (current implementation)

Bleed behaviour is **implemented** and left as-is for now. Summary for reference:

- **Minor bleed:** 1 dmg every 3 s to the limb; when limb is blacked, effect is removed (limb stays blacked).
- **Major bleed:** 1 dmg every 1.5 s; effect **stays on the limb** when it blacks; the **damage tick** propagates to the next limb (leg → crotch → abdomen → chest). Hemostat removes the effect (including on blacked limbs); limb stays blacked until healed (e.g. medkit).
- **Death:** Total HP ≤ 0 always kills; chest or head blacked by **taken** damage (not bleed) also kills.

---

*Last updated: TESTING_FEEDBACK magazine follow-ups marked complete; flashlight deferred. Limb/damage Phases 1–6, bleed implementation unchanged.*
