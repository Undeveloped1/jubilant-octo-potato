// visibility.js — pure wall-occluded light polygon geometry (DK2-style, pass 1).
// Zero Phaser imports; node-testable. All angles in radians, Y-down screen space.
//
// Algorithm (classic 2D visibility polygon):
//   1. Collect candidate ray angles: the two sector boundary rays plus, for every
//      wall corner inside the sector, the corner angle and a ±EPS pair (the eps
//      rays hug both sides of a corner so shadow edges land exactly on faces).
//   2. Fill angular gaps with extra rays (max step MAX_ARC_STEP) so empty arcs
//      stay round instead of collapsing to chords.
//   3. Cast each ray as a segment [0, maxRange]: nearest wall entry (ray/AABB
//      slab test) or bounds exit wins; emit the hit point.
//   4. Sort hits by angle -> closed polygon. Sectors prepend the origin so the
//      shape is a pie (matches Phaser Graphics.slice semantics); full circles
//      return just the ring.
//
// walls: [{x, y, w, h}] CENTER-based rects. bounds: {x, y, w, h} top-left rect.

const TAU = Math.PI * 2;
const CORNER_EPS = 1e-4;   // angular offset for corner-hugging rays (spec)
const MAX_ARC_STEP = Math.PI / 16; // arc sampling when no wall corners fill a gap
const TINY = 1e-9;

/**
 * Ray vs axis-aligned rect slab test.
 * Returns {enter, exit} distances along the (unit) direction, or null if the
 * ray line misses the rect. enter < 0 means the origin is inside the slab span.
 */
function raySlab(ox, oy, dx, dy, minX, minY, maxX, maxY) {
    let tmin = -Infinity;
    let tmax = Infinity;
    if (Math.abs(dx) < 1e-12) {
        if (ox < minX || ox > maxX) return null;
    } else {
        let t1 = (minX - ox) / dx;
        let t2 = (maxX - ox) / dx;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
    }
    if (Math.abs(dy) < 1e-12) {
        if (oy < minY || oy > maxY) return null;
    } else {
        let t1 = (minY - oy) / dy;
        let t2 = (maxY - oy) / dy;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
    }
    if (tmax < tmin) return null;
    return { enter: tmin, exit: tmax };
}

/** Nearest forward hit distance for a ray, capped at maxRange. */
function castRay(ox, oy, dx, dy, wallRects, bounds, maxRange) {
    let best = maxRange;
    for (const r of wallRects) {
        const hit = raySlab(ox, oy, dx, dy, r.minX, r.minY, r.maxX, r.maxY);
        if (!hit) continue;
        // Entry distance; origin inside the wall -> hit at 0. A slab overlap
        // that ends at/before the origin (grazing corner behind us) is no hit.
        const t = hit.enter >= 0 ? hit.enter : (hit.exit > TINY ? 0 : -1);
        if (t >= 0 && t < best) best = t;
    }
    // Origin is inside the room bounds: the bounds limit is the EXIT distance.
    const b = raySlab(ox, oy, dx, dy, bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h);
    if (b && b.exit >= 0 && b.exit < best) best = b.exit;
    return best;
}

/**
 * Cast a wall-occluded light polygon.
 * @param {number} ox origin x
 * @param {number} oy origin y
 * @param {number} startAngle sector start (radians; any range, wrap handled)
 * @param {number} endAngle sector end; endAngle - startAngle >= 2PI = full circle
 * @param {Array<{x:number,y:number,w:number,h:number}>} walls CENTER-based rects
 * @param {number} maxRange max ray length in px (<= 0 -> degenerate point)
 * @param {{x:number,y:number,w:number,h:number}} bounds room rect (top-left based)
 * @returns {Array<{x:number,y:number}>} closed polygon vertices in angular order
 */
export function castLightPolygon(ox, oy, startAngle, endAngle, walls, maxRange, bounds) {
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !(maxRange > 0)) {
        return [{ x: ox, y: oy }];
    }
    const b = bounds || { x: 0, y: 0, w: 800, h: 600 };
    const wallRects = (walls || []).map(w => ({
        minX: w.x - w.w / 2, minY: w.y - w.h / 2,
        maxX: w.x + w.w / 2, maxY: w.y + w.h / 2
    }));

    // Normalize the sweep into [0, TAU]; handle cones crossing the -PI/PI seam.
    let sweep = endAngle - startAngle;
    let fullCircle = false;
    if (sweep >= TAU - TINY) {
        fullCircle = true;
        sweep = TAU;
    } else {
        while (sweep < 0) sweep += TAU;
        while (sweep >= TAU) sweep -= TAU;
    }
    if (sweep <= TINY) return [{ x: ox, y: oy }];

    // Candidate ray offsets from startAngle.
    const offsets = new Set();
    offsets.add(0);
    if (!fullCircle) offsets.add(sweep);
    for (const r of wallRects) {
        const corners = [
            [r.minX, r.minY], [r.maxX, r.minY],
            [r.minX, r.maxY], [r.maxX, r.maxY]
        ];
        for (const [cx, cy] of corners) {
            let d = (Math.atan2(cy - oy, cx - ox) - startAngle) % TAU;
            if (d < 0) d += TAU;
            if (d > sweep + TINY) continue; // corner outside the sector
            d = Math.min(Math.max(d, 0), sweep);
            offsets.add(d);
            offsets.add(Math.min(Math.max(d - CORNER_EPS, 0), sweep));
            offsets.add(Math.min(Math.max(d + CORNER_EPS, 0), sweep));
        }
    }
    if (fullCircle) {
        // Guarantee a sane ring even with zero walls.
        for (let k = 1; k < 4; k++) offsets.add((TAU * k) / 4);
    }

    // Sort, then subdivide large gaps so unoccluded arcs stay curved.
    const sorted = [...offsets].sort((a, c) => a - c);
    const rays = [];
    for (let i = 0; i < sorted.length; i++) {
        rays.push(sorted[i]);
        const next = i + 1 < sorted.length ? sorted[i + 1] : (fullCircle ? sorted[0] + TAU : null);
        if (next !== null) {
            for (let t = sorted[i] + MAX_ARC_STEP; t < next - TINY; t += MAX_ARC_STEP) rays.push(t);
        }
    }

    // Cast every ray; emit hit points in angular order.
    const pts = [];
    let prevX = NaN, prevY = NaN;
    for (const t of rays) {
        const ang = startAngle + t;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const dist = castRay(ox, oy, dx, dy, wallRects, b, maxRange);
        const x = ox + dx * dist;
        const y = oy + dy * dist;
        if (Math.abs(x - prevX) < TINY && Math.abs(y - prevY) < TINY) continue; // dedupe
        pts.push({ x, y });
        prevX = x; prevY = y;
    }
    // Sectors are pies: include the origin so closing the path matches slice().
    if (!fullCircle) pts.unshift({ x: ox, y: oy });
    return pts;
}

/**
 * Compute the three darkness-mask polygons for one frame.
 * @param {number} ox player x
 * @param {number} oy player y
 * @param {number} aimAngle aim direction (radians)
 * @param {Array<{x:number,y:number,w:number,h:number}>} walls CENTER-based rects
 * @param {object} opts {ambientRadius, ambientConeRange, ambientConeHalfAngle,
 *   hasFlashlight, flashlightOn, flashRange, flashHalfAngle, bounds}
 * @returns {{ambientCircle: Array, ambientCone: Array, flashlight: Array|null}}
 *   flashlight is null unless both hasFlashlight and flashlightOn are true.
 */
export function computeLightPolygons(ox, oy, aimAngle, walls, opts = {}) {
    const ambientRadius = opts.ambientRadius != null ? opts.ambientRadius : 60;
    const ambientConeRange = opts.ambientConeRange != null ? opts.ambientConeRange : 140;
    const ambientConeHalfAngle = opts.ambientConeHalfAngle != null ? opts.ambientConeHalfAngle : 0.6;
    const flashRange = opts.flashRange != null ? opts.flashRange : 300;
    const flashHalfAngle = opts.flashHalfAngle != null ? opts.flashHalfAngle : 0.5;
    const bounds = opts.bounds || { x: 0, y: 0, w: 800, h: 600 };
    const ambientCircle = castLightPolygon(ox, oy, 0, TAU, walls, ambientRadius, bounds);
    const ambientCone = castLightPolygon(ox, oy, aimAngle - ambientConeHalfAngle, aimAngle + ambientConeHalfAngle, walls, ambientConeRange, bounds);
    const flashlight = (opts.hasFlashlight && opts.flashlightOn)
        ? castLightPolygon(ox, oy, aimAngle - flashHalfAngle, aimAngle + flashHalfAngle, walls, flashRange, bounds)
        : null;
    return { ambientCircle, ambientCone, flashlight };
}

/** Convert CENTER-based wall rects to min/max slab rects (shared by ray casts). */
function toSlabRects(walls) {
    return (walls || []).map(w => ({
        minX: w.x - w.w / 2, minY: w.y - w.h / 2,
        maxX: w.x + w.w / 2, maxY: w.y + w.h / 2
    }));
}

/**
 * DK2 pass 2: segment vs wall-rect occlusion (line of sight).
 * True when any wall rect crosses the open segment (ox,oy)->(ex,ey) before the
 * endpoint. Reuses the same ray/AABB slab test as the light polygons so LOS and
 * light geometry agree. A wall the origin sits inside counts as blocking.
 */
function segmentBlocked(ox, oy, ex, ey, slabRects) {
    const dx = ex - ox, dy = ey - oy;
    const dist = Math.hypot(dx, dy);
    if (dist < TINY) return false;
    const ux = dx / dist, uy = dy / dist;
    for (const r of slabRects) {
        const hit = raySlab(ox, oy, ux, uy, r.minX, r.minY, r.maxX, r.maxY);
        if (!hit) continue;
        const t = hit.enter >= 0 ? hit.enter : (hit.exit > TINY ? 0 : -1);
        if (t >= 0 && t < dist - TINY) return true;
    }
    return false;
}

/** Wrap an angle difference into [-PI, PI]. */
function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
}

/**
 * DK2 pass 2: pure enemy-reveal predicate. An enemy at (ex,ey) is revealed by the
 * player at (ox,oy) aiming aimAngle when it lies in ANY of the three light shapes
 * AND has line of sight through the walls:
 *   - ambient circle: dist <= ambientRadius
 *   - ambient cone:   dist <= ambientConeRange && |angleDiff| <= ambientConeHalfAngle
 *   - flashlight cone (only when hasFlashlight && flashlightOn):
 *                     dist <= flashRange && |angleDiff| <= flashHalfAngle
 * walls are CENTER-based rects (same as computeLightPolygons). LOS is a
 * segment-rect test against those walls. Visual only — no game-state side effects.
 * @returns {boolean}
 */
export function isRevealedByLight(ex, ey, ox, oy, aimAngle, walls, opts = {}) {
    const ambientRadius = opts.ambientRadius != null ? opts.ambientRadius : 60;
    const ambientConeRange = opts.ambientConeRange != null ? opts.ambientConeRange : 140;
    const ambientConeHalfAngle = opts.ambientConeHalfAngle != null ? opts.ambientConeHalfAngle : 0.6;
    const flashRange = opts.flashRange != null ? opts.flashRange : 300;
    const flashHalfAngle = opts.flashHalfAngle != null ? opts.flashHalfAngle : 0.5;
    const flashActive = !!(opts.hasFlashlight && opts.flashlightOn);

    const dx = ex - ox, dy = ey - oy;
    const dist = Math.hypot(dx, dy);
    const maxRange = Math.max(ambientRadius, ambientConeRange, flashActive ? flashRange : 0);
    if (!(dist <= maxRange)) return false; // outside every light shape

    if (segmentBlocked(ox, oy, ex, ey, toSlabRects(walls))) return false; // no LOS

    if (dist <= ambientRadius) return true; // ambient circle (angle-independent)
    const diff = Math.abs(angleDiff(Math.atan2(dy, dx), aimAngle));
    if (dist <= ambientConeRange && diff <= ambientConeHalfAngle) return true;
    if (flashActive && dist <= flashRange && diff <= flashHalfAngle) return true;
    return false;
}