# Art Guide

**Direction (locked Jul 2026):** Kenney **Top-down Shooter** pack — flat, bright, top-down characters facing **+X (right)**. CC0 / public domain ([kenney.nl](https://kenney.nl/assets/top-down-shooter)).

## Recipe

| Role | Asset | Notes |
|------|--------|--------|
| Player | `Soldier 1 / soldier1_gun` | Faces aim via `player.setRotation` |
| Walker / exploder | `Zombie 1 / zoimbie1_stand` | Exploder uses soft orange tint |
| Leaper | `zoimbie1_hold` + `zoimbie1_reload` | Idle anim frames |
| Bandit | `Man Brown / manBrown_gun` | |
| Spitter | `zoimbie1_machine` | Soft green tint |
| Boss | `Robot 1 / robot1_stand` | Scale 2, soft red tint |
| Necromancer | `Man Old / manOld_stand` | Soft purple tint |
| Floors | Kenney tiles 01 / 05 / 12 / 90 (+ sewer tint) | 64×64 |
| Wall | Generated 32×32 in Kenney palette | Keeps existing wall scale math |
| Crate | Cropped from Kenney furniture tile | ~32px |

## Rules for new art

1. **Top-down only** — no side-view Metal Slug / platformer frames.
2. **Face +X** — gun/nose points right so Phaser rotation matches aim/movement.
3. **Display size** ~32–56px. Prefer native Kenney sizes; don’t upscale blurry.
4. **Alpha** — true RGBA, no checkerboard baked into RGB.
5. **Palette** — match Kenney flat fills (green grass `#27AE60`-ish, wood `#BB8044`, charcoal floors `#4A4A4A`, wall accent `#D87F4A`).
6. **Tints** — multiply lightly (`0xb8ffb8`, `0xffaa66`, `0xcc88ff`). Never full `0x00ff00` / `0xff0000` on characters.
7. **Install path** — drop source under `tools/tmp/kenney/`, run `python tools/install_kenney.py`, commit `public/assets/`.

## Credit

Kenney.nl Top-down Shooter (CC0). Attribution appreciated, not required. License copy: `public/assets/sprites/KENNEY_LICENSE.txt`.
