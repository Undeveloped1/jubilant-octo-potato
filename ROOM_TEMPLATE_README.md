# Room template & coordinate system

## Template image

- **`reference/room_template_800x600_perimeter.png`** — 800×600 landscape. Blank floor with **perimeter walls only** (32px thick). Gaps in the perimeter mark the four **door positions** (where the game places room doors). Use this as a background when drawing your own layout or building collision in an editor.

---

## “Forced” perspective (how the view works)

The game does **not** use 3D or isometric perspective. It uses a fixed 2D view:

| Aspect | What it means |
|--------|----------------|
| **Projection** | **Orthographic** — no perspective distortion. One pixel in your PNG = one unit in the game. |
| **Origin** | **Top-left** is (0, 0). X increases to the **right**, Y increases **down**. |
| **Room size** | Exactly **800×600** pixels. The Phaser scene and camera match this; the game uses `Scale.FIT` so the canvas may letterbox on screen but coordinates are always 0–800 × 0–600. |
| **Camera** | **Fixed** — no zoom, no pan. One room fills the whole view. When you change rooms, the view switches to that room’s 800×600. |
| **Gravity** | **Zero** — top-down, no “down” in the physics sense. |

So “forced perspective” here really means: **one fixed orthographic 800×600 view per room**. Your art should be drawn to match that (landscape 800×600, Y-down).

---

## Coordinates cheat sheet

- **Room bounds:** `x: 0–800`, `y: 0–600`
- **Center:** `(400, 300)`
- **Wall unit:** All wall collision is based on a **32×32** tile. In chunk data, walls use `{ x, y, scaleX, scaleY }`; size in pixels = `(scaleX * 32, scaleY * 32)`.

### Door positions (where the game places doors)

These are the **center** positions used in code; doors are 40×60 (width×height) and may be rotated for east/west:

| Side  | Center (x, y) | Use in template |
|-------|----------------|------------------|
| North | (400, 30)      | Gap in top wall  |
| South | (400, 570)     | Gap in bottom wall |
| East  | (770, 300)     | Gap in right wall |
| West  | (30, 300)      | Gap in left wall  |

When you draw collision or art, keep these four openings clear so doors and room transitions line up.

---

## Using the template

1. Open **`reference/room_template_800x600_perimeter.png`** in your image editor (or level editor).
2. Draw your custom floor/background on the gray area; avoid drawing over the door gaps if you want doors to stay visible.
3. Add interior walls as rectangles; in game terms each rectangle is a wall with size in multiples of 32 (e.g. 32×96 → `scaleX: 1, scaleY: 3`), with (x, y) = center of the rectangle.
4. Export collision/decoration as your editor allows, or match the chunk format in `CONFIG.ROOM_CHUNKS` (e.g. `walls: [{ x, y, scaleX, scaleY }]`).

If you later load this PNG as a room background in the game, use **800×600** and the same origin (top-left) so it lines up with the perimeter and doors.
