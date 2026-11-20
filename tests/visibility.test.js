import { describe, it, expect } from 'vitest';
import { castLightPolygon, computeLightPolygons, isRevealedByLight } from '../src/visibility.js';

const TAU = Math.PI * 2;
const BOUNDS = { x: 0, y: 0, w: 800, h: 600 };

// Ray-casting point-in-polygon (boundary-agnostic; test points avoid edges).
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const crosses = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const allFinite = (poly) => poly.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
const hasVertexNear = (poly, x, y, tol = 1e-6) => poly.some(p => dist(p.x, p.y, x, y) < tol);

describe('castLightPolygon — empty room', () => {
  it('(a) cone reaches maxRange at boundary rays, no NaN, arc is sampled', () => {
    const poly = castLightPolygon(400, 300, -0.5, 0.5, [], 200, BOUNDS);
    expect(poly.length).toBeGreaterThan(4); // origin + subdivided arc, not a triangle
    expect(allFinite(poly)).toBe(true);
    // Boundary rays land exactly at maxRange.
    expect(hasVertexNear(poly, 400 + 200 * Math.cos(-0.5), 300 + 200 * Math.sin(-0.5))).toBe(true);
    expect(hasVertexNear(poly, 400 + 200 * Math.cos(0.5), 300 + 200 * Math.sin(0.5))).toBe(true);
    for (const p of poly) expect(dist(p.x, p.y, 400, 300)).toBeLessThanOrEqual(200 + 1e-6);
    expect(pointInPolygon(400 + 100, 300, poly)).toBe(true);
    expect(pointInPolygon(400 - 100, 300, poly)).toBe(false); // behind the cone
  });

  it('(a2) full circle with zero walls is a ring at maxRange', () => {
    const poly = castLightPolygon(400, 300, 0, TAU, [], 100, BOUNDS);
    expect(poly.length).toBeGreaterThanOrEqual(8);
    expect(allFinite(poly)).toBe(true);
    for (const p of poly) expect(dist(p.x, p.y, 400, 300)).toBeCloseTo(100, 5);
    expect(pointInPolygon(400, 300, poly)).toBe(true);
    expect(pointInPolygon(400 + 150, 300, poly)).toBe(false);
  });

  it('(a3) maxRange smaller than distance to walls stops at maxRange', () => {
    const walls = [{ x: 300, y: 300, w: 32, h: 200 }]; // face at x=284
    const poly = castLightPolygon(100, 300, -0.3, 0.3, walls, 50, BOUNDS);
    expect(allFinite(poly)).toBe(true);
    for (const p of poly) expect(dist(p.x, p.y, 100, 300)).toBeLessThanOrEqual(50 + 1e-6);
    expect(hasVertexNear(poly, 100 + 50 * Math.cos(-0.3), 300 + 50 * Math.sin(-0.3))).toBe(true);
    expect(poly.every(p => p.x < 284)).toBe(true); // never reaches the wall
  });
});

describe('castLightPolygon — occlusion', () => {
  it('(b) single wall: polygon stops ON the wall face, nothing beyond it in the blocked lane', () => {
    // Wall rect x[284,316], y[200,400]; origin left of it, cone aimed +x.
    const walls = [{ x: 300, y: 300, w: 32, h: 200 }];
    const poly = castLightPolygon(100, 300, -0.6, 0.6, walls, 500, BOUNDS);
    expect(allFinite(poly)).toBe(true);
    expect(pointInPolygon(200, 300, poly)).toBe(true);  // in front of wall
    expect(pointInPolygon(400, 300, poly)).toBe(false); // behind wall
    // Some vertex lies exactly on the near face x=284 within the wall's y span.
    expect(poly.some(p => Math.abs(p.x - 284) < 1e-3 && p.y >= 200 - 1e-6 && p.y <= 400 + 1e-6)).toBe(true);
    // Any vertex past the far face must have gone around (outside the wall's y span).
    for (const p of poly) {
      if (p.x > 316 + 1e-6) expect(p.y < 200 - 1e-6 || p.y > 400 + 1e-6).toBe(true);
    }
  });

  it('(c) L-shaped two-wall arrangement matches hand-computed shadow', () => {
    // wallA x[200,400] y[184,216]; wallB x[384,416] y[200,400] — an L at (400,200).
    const walls = [
      { x: 300, y: 200, w: 200, h: 32 },
      { x: 400, y: 300, w: 32, h: 200 },
    ];
    const poly = castLightPolygon(100, 100, 0, TAU, walls, 600, BOUNDS);
    expect(allFinite(poly)).toBe(true);
    // Behind the L: ray (100,100)->(500,350) crosses wallB at y~287 -> shadow.
    expect(pointInPolygon(500, 350, poly)).toBe(false);
    // Open lanes: straight down the left side, and above wallA.
    expect(pointInPolygon(150, 400, poly)).toBe(true);
    expect(pointInPolygon(300, 100, poly)).toBe(true);
    expect(pointInPolygon(300, 150, poly)).toBe(true);
    // Occlusion edge lies on wallA's top face y=184.
    expect(poly.some(p => Math.abs(p.y - 184) < 1e-3 && p.x >= 200 - 1e-6 && p.x <= 400 + 1e-6)).toBe(true);
  });

  it('(e) nearest of two walls wins the hit', () => {
    const walls = [
      { x: 250, y: 300, w: 32, h: 200 }, // near face x=234
      { x: 450, y: 300, w: 32, h: 200 }, // far face x=434
    ];
    const poly = castLightPolygon(100, 300, -0.3, 0.3, walls, 600, BOUNDS);
    expect(pointInPolygon(200, 300, poly)).toBe(true);
    expect(pointInPolygon(300, 300, poly)).toBe(false); // gap between walls is shadowed
    expect(poly.some(p => Math.abs(p.x - 234) < 1e-3)).toBe(true);
    for (const p of poly) expect(p.x).toBeLessThanOrEqual(234 + 1e-3); // far wall never reached
  });

  it('(b2) full circle with a wall: behind point outside, in-front point inside (F2)', () => {
    // Wall rect x[284,316], y[200,400]; origin left of it, FULL circle sweep.
    const walls = [{ x: 300, y: 300, w: 32, h: 200 }];
    const poly = castLightPolygon(100, 300, 0, TAU, walls, 500, BOUNDS);
    expect(allFinite(poly)).toBe(true);
    expect(pointInPolygon(200, 300, poly)).toBe(true);  // in front of wall
    expect(pointInPolygon(400, 300, poly)).toBe(false); // behind wall, occluded
    // Open lane around the wall's top end stays lit.
    expect(pointInPolygon(300, 100, poly)).toBe(true);
  });
});

describe('castLightPolygon — degenerate and seam cases', () => {
  it('(d) origin exactly on / adjacent to a wall corner: finite, no crash', () => {
    const walls = [{ x: 216, y: 216, w: 32, h: 32 }]; // rect [200,232]x[200,232]
    for (const [ox, oy] of [[200, 200], [199.999, 200], [200, 200.001]]) {
      const full = castLightPolygon(ox, oy, 0, TAU, walls, 100, BOUNDS);
      expect(Array.isArray(full)).toBe(true);
      expect(full.length).toBeGreaterThanOrEqual(1);
      expect(allFinite(full)).toBe(true);
      const cone = castLightPolygon(ox, oy, -0.5, 0.5, walls, 100, BOUNDS);
      expect(allFinite(cone)).toBe(true);
      for (const p of full) expect(dist(p.x, p.y, ox, oy)).toBeLessThanOrEqual(100 + 1e-6);
      // F1: occlusion from a corner origin — (260,216) sits behind the wall's
      // right face (x=232, ray crosses it at y~208.5) and inside the cone's
      // angular sector, so it must be OUTSIDE both polygons.
      expect(pointInPolygon(260, 216, full)).toBe(false);
      expect(pointInPolygon(260, 216, cone)).toBe(false);
      // Sanity: an unobstructed point up-left of the corner stays lit.
      expect(pointInPolygon(150, 150, full)).toBe(true);
    }
  });

  it('(f) cone spanning the -PI/PI seam is occluded correctly', () => {
    const walls = [{ x: 200, y: 300, w: 32, h: 300 }]; // rect x[184,216] y[150,450]
    const poly = castLightPolygon(400, 300, Math.PI - 0.5, Math.PI + 0.5, walls, 400, BOUNDS);
    expect(allFinite(poly)).toBe(true);
    expect(pointInPolygon(300, 300, poly)).toBe(true);  // in front of wall, along -x
    expect(pointInPolygon(100, 300, poly)).toBe(false); // behind wall
    // Every arc ray in this cone hits the wall's right face x=216.
    const arc = poly.filter(p => dist(p.x, p.y, 400, 300) > 1e-6);
    expect(arc.length).toBeGreaterThan(2);
    for (const p of arc) expect(Math.abs(p.x - 216)).toBeLessThan(1e-3);
  });

  it('(f2) wraparound with normalized angles (start 2.8, end -2.8)', () => {
    const poly = castLightPolygon(400, 300, 2.8, -2.8, [], 150, BOUNDS);
    expect(allFinite(poly)).toBe(true);
    expect(hasVertexNear(poly, 400 + 150 * Math.cos(2.8), 300 + 150 * Math.sin(2.8))).toBe(true);
    expect(hasVertexNear(poly, 400 + 150 * Math.cos(-2.8), 300 + 150 * Math.sin(-2.8))).toBe(true);
    expect(pointInPolygon(300, 300, poly)).toBe(true);  // angle PI inside the wrapped cone
    expect(pointInPolygon(500, 300, poly)).toBe(false); // angle 0 outside
  });

  it('(g) zero / negative maxRange is degenerate but safe', () => {
    for (const r of [0, -5]) {
      const poly = castLightPolygon(400, 300, -0.5, 0.5, [], r, BOUNDS);
      expect(allFinite(poly)).toBe(true);
      for (const p of poly) {
        expect(p.x).toBe(400);
        expect(p.y).toBe(300);
      }
    }
  });
});

describe('computeLightPolygons', () => {
  const walls = [{ x: 300, y: 300, w: 32, h: 200 }];
  const opts = {
    ambientRadius: 60,
    ambientConeRange: 140,
    ambientConeHalfAngle: 0.6,
    hasFlashlight: true,
    flashlightOn: true,
    flashRange: 300,
    flashHalfAngle: 0.5,
    bounds: BOUNDS,
  };

  it('returns all three polygons when flashlight is on', () => {
    const r = computeLightPolygons(100, 300, 0, walls, opts);
    expect(Array.isArray(r.ambientCircle)).toBe(true);
    expect(Array.isArray(r.ambientCone)).toBe(true);
    expect(Array.isArray(r.flashlight)).toBe(true);
    expect(allFinite(r.ambientCircle)).toBe(true);
    expect(allFinite(r.ambientCone)).toBe(true);
    expect(allFinite(r.flashlight)).toBe(true);
    // Flashlight is wall-occluded: shadow behind the wall.
    expect(pointInPolygon(200, 300, r.flashlight)).toBe(true);
    expect(pointInPolygon(400, 300, r.flashlight)).toBe(false);
  });

  it('flashlight is null when unequipped or switched off', () => {
    expect(computeLightPolygons(100, 300, 0, walls, { ...opts, hasFlashlight: false }).flashlight).toBeNull();
    expect(computeLightPolygons(100, 300, 0, walls, { ...opts, flashlightOn: false }).flashlight).toBeNull();
    expect(computeLightPolygons(100, 300, 0, walls, {}).flashlight).toBeNull();
  });

  it('defaults match CONFIG tunables (60 / 140 / 0.6)', () => {
    const r = computeLightPolygons(400, 300, 0, [], {});
    for (const p of r.ambientCircle) expect(dist(p.x, p.y, 400, 300)).toBeCloseTo(60, 5);
    expect(hasVertexNear(r.ambientCone, 400 + 140 * Math.cos(-0.6), 300 + 140 * Math.sin(-0.6))).toBe(true);
    expect(hasVertexNear(r.ambientCone, 400 + 140 * Math.cos(0.6), 300 + 140 * Math.sin(0.6))).toBe(true);
  });
});

describe('isRevealedByLight — DK2 pass 2 reveal predicate', () => {
  // Wall rect x[284,316], y[200,400]; player left of it aiming +x (angle 0).
  const walls = [{ x: 300, y: 300, w: 32, h: 200 }];
  const opts = {
    ambientRadius: 60,
    ambientConeRange: 140,
    ambientConeHalfAngle: 0.6,
    hasFlashlight: true,
    flashlightOn: true,
    flashRange: 300,
    flashHalfAngle: 0.5,
  };

  it('enemy behind wall in flashlight cone -> false (LOS blocked)', () => {
    // (400,300): dist 300, dead ahead in the cone, but the wall blocks LOS.
    expect(isRevealedByLight(400, 300, 100, 300, 0, walls, opts)).toBe(false);
  });

  it('enemy in ambient cone with no wall -> true', () => {
    // (200,300): dist 100 <= 140, angle diff 0 <= 0.6, no walls.
    expect(isRevealedByLight(200, 300, 100, 300, 0, [], opts)).toBe(true);
  });

  it('enemy outside all light -> false', () => {
    // (600,300): dist 500 > max(60, 140, 300).
    expect(isRevealedByLight(600, 300, 100, 300, 0, [], opts)).toBe(false);
  });

  it('enemy in ambient circle behind wall -> false (LOS blocked)', () => {
    // Close wall x[120,140]; enemy (150,300) is dist 50 <= 60 but behind it.
    const closeWall = [{ x: 130, y: 300, w: 20, h: 100 }];
    expect(isRevealedByLight(150, 300, 100, 300, 0, closeWall, opts)).toBe(false);
    // Same enemy with the wall removed -> revealed by the ambient circle.
    expect(isRevealedByLight(150, 300, 100, 300, 0, [], opts)).toBe(true);
  });

  it('enemy in flashlight cone with no wall -> true; flashlight off -> ambient only', () => {
    // (350,300): dist 250, in flashlight cone (<=300, diff 0), outside ambient cone (140).
    expect(isRevealedByLight(350, 300, 100, 300, 0, [], opts)).toBe(true);
    expect(isRevealedByLight(350, 300, 100, 300, 0, [], { ...opts, flashlightOn: false })).toBe(false);
    expect(isRevealedByLight(350, 300, 100, 300, 0, [], { ...opts, hasFlashlight: false })).toBe(false);
  });

  it('ambient cone is aim-relative: enemy behind the player is not revealed', () => {
    // (30,300): dist 70 <= 140 but angle PI away from aim 0 (outside 0.6 half-angle),
    // and outside the 60px ambient circle.
    expect(isRevealedByLight(30, 300, 100, 300, 0, [], opts)).toBe(false);
    // Aim turned around -> same enemy now inside the ambient cone.
    expect(isRevealedByLight(30, 300, 100, 300, Math.PI, [], opts)).toBe(true);
  });
});

// DK2 pass 2 (C2): parity between the rendered light geometry (union of the
// computeLightPolygons shapes) and the pure reveal predicate. They must agree at
// every point that is NOT near a fuzzy boundary. Fuzzy sources, all skipped with a
// documented 5px margin:
//   * range-circle arcs are chords sampled at MAX_ARC_STEP (PI/16); a chord sags
//     inward by r*(1-cos(step/2)) ≈ 1.44px at r300 (0.67px @140, 0.29px @60), so
//     points within 5px of a range circle can legitimately differ.
//   * cone edge rays and wall faces are exact lines but point-in-polygon is
//     numerically fragile right on them -> 5px margin.
//   * the origin vertex (pie polygons) and room bounds edges -> 5px margin.
// Wall SHADOW edges are exact (corner ±EPS rays land on the origin->corner line),
// so they need no margin and behind-wall points are asserted normally.
describe('geometry/predicate parity — DK2 pass 2 (C2)', () => {
  const MARGIN = 5;
  const OPTS = {
    ambientRadius: 60, ambientConeRange: 140, ambientConeHalfAngle: 0.6,
    flashRange: 300, flashHalfAngle: 0.5, bounds: BOUNDS,
  };

  // Distance from a point to a center-based wall rect's boundary (inside -> nearest
  // face; outside -> nearest point on the rect).
  const distToWallFace = (px, py, w) => {
    const minX = w.x - w.w / 2, maxX = w.x + w.w / 2;
    const minY = w.y - w.h / 2, maxY = w.y + w.h / 2;
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      return Math.min(px - minX, maxX - px, py - minY, maxY - py);
    }
    const cx = Math.max(minX, Math.min(px, maxX));
    const cy = Math.max(minY, Math.min(py, maxY));
    return Math.hypot(px - cx, py - cy);
  };

  // Distance from a point to the forward ray from (ox,oy) at angle ang (behind the
  // origin -> distance to the origin itself).
  const distToForwardRay = (px, py, ox, oy, ang) => {
    const dx = px - ox, dy = py - oy;
    const t = dx * Math.cos(ang) + dy * Math.sin(ang);
    if (t <= 0) return Math.hypot(dx, dy);
    return Math.abs(dx * Math.sin(ang) - dy * Math.cos(ang));
  };

  const isFuzzy = (px, py, ox, oy, aim, walls, opts) => {
    const d = Math.hypot(px - ox, py - oy);
    if (d < MARGIN) return true;                                   // origin vertex
    if (px < MARGIN || px > 800 - MARGIN || py < MARGIN || py > 600 - MARGIN) return true; // bounds
    const flashOn = !!(opts.hasFlashlight && opts.flashlightOn);
    const ranges = [opts.ambientRadius, opts.ambientConeRange];
    if (flashOn) ranges.push(opts.flashRange);
    for (const R of ranges) if (Math.abs(d - R) < MARGIN) return true; // arc chords
    const halfAngles = [opts.ambientConeHalfAngle];
    if (flashOn) halfAngles.push(opts.flashHalfAngle);
    for (const half of halfAngles) {
      if (distToForwardRay(px, py, ox, oy, aim - half) < MARGIN) return true; // cone edges
      if (distToForwardRay(px, py, ox, oy, aim + half) < MARGIN) return true;
    }
    for (const w of walls) if (distToWallFace(px, py, w) < MARGIN) return true; // wall faces
    return false;
  };

  const layouts = [
    { name: 'single wall', walls: [{ x: 300, y: 300, w: 32, h: 200 }], ox: 100, oy: 300, aim: 0,
      grid: { x0: 20, x1: 480, y0: 120, y1: 480, step: 20 } },
    { name: 'L-shape', walls: [{ x: 300, y: 200, w: 200, h: 32 }, { x: 400, y: 300, w: 32, h: 200 }],
      ox: 100, oy: 100, aim: Math.PI / 4, grid: { x0: 20, x1: 500, y0: 20, y1: 500, step: 20 } },
  ];
  const configs = [
    { name: 'flashlight on', hasFlashlight: true, flashlightOn: true },
    { name: 'flashlight off', hasFlashlight: true, flashlightOn: false },
    { name: 'ambient only', hasFlashlight: false, flashlightOn: false },
  ];

  it('union of light polygons === isRevealedByLight at >=30 non-boundary points (incl. behind-wall)', () => {
    let asserted = 0, insideCount = 0, outsideCount = 0, behindWallCount = 0, skipped = 0;
    const mismatches = [];
    for (const layout of layouts) {
      for (const cfg of configs) {
        const opts = { ...OPTS, ...cfg };
        const polys = computeLightPolygons(layout.ox, layout.oy, layout.aim, layout.walls, opts);
        const shapes = [polys.ambientCircle, polys.ambientCone, polys.flashlight].filter(Boolean);
        for (let px = layout.grid.x0; px <= layout.grid.x1; px += layout.grid.step) {
          for (let py = layout.grid.y0; py <= layout.grid.y1; py += layout.grid.step) {
            if (isFuzzy(px, py, layout.ox, layout.oy, layout.aim, layout.walls, opts)) { skipped++; continue; }
            const unionInside = shapes.some(s => pointInPolygon(px, py, s));
            const revealed = isRevealedByLight(px, py, layout.ox, layout.oy, layout.aim, layout.walls, opts);
            // A point the light would reach with no walls, but the walls block -> behind-wall.
            if (!revealed && isRevealedByLight(px, py, layout.ox, layout.oy, layout.aim, [], opts)) behindWallCount++;
            asserted++;
            if (unionInside) insideCount++; else outsideCount++;
            if (unionInside !== revealed) {
              mismatches.push({ layout: layout.name, cfg: cfg.name, px, py, unionInside, revealed });
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(asserted).toBeGreaterThanOrEqual(30);
    expect(insideCount).toBeGreaterThan(0);   // clearly-inside points asserted
    expect(outsideCount).toBeGreaterThan(0);  // clearly-outside points asserted
    expect(behindWallCount).toBeGreaterThan(0); // behind-wall occlusion asserted
    expect(skipped).toBeGreaterThan(0);       // margin helper actually exercised
  });
});