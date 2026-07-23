"""
Install curated Kenney Top-down Shooter (CC0) assets into assets/.
Expects extracted pack at tools/tmp/kenney/ (from OpenGameArt topdown-shooter.zip).
"""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools" / "tmp" / "kenney" / "PNG"
OUT_SPRITES = ROOT / "assets" / "sprites"
OUT_TILES = ROOT / "assets" / "tiles"
OUT_UI = ROOT / "assets" / "ui"

CHAR_MAP = {
    "player": SRC / "Soldier 1" / "soldier1_gun.png",
    "zombie": SRC / "Zombie 1" / "zoimbie1_stand.png",
    "leaper_idle_0": SRC / "Zombie 1" / "zoimbie1_hold.png",
    "leaper_idle_1": SRC / "Zombie 1" / "zoimbie1_reload.png",
    "bandit": SRC / "Man Brown" / "manBrown_gun.png",
    "spitter": SRC / "Zombie 1" / "zoimbie1_machine.png",
    "boss": SRC / "Robot 1" / "robot1_stand.png",
    "necromancer": SRC / "Man Old" / "manOld_stand.png",
}

TILE_MAP = {
    "floor_grass": "tile_01.png",
    "floor_apt": "tile_05.png",
    "floor_hospital": "tile_12.png",
    "floor_roof": "tile_90.png",
    "crate_src": "tile_457.png",
}


def crop_alpha(im: Image.Image, pad: int = 1) -> Image.Image:
    im = im.convert("RGBA")
    bb = im.split()[-1].getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def make_wall_tile() -> Image.Image:
    """32x32 wall block matching Kenney orange-brown / charcoal palette."""
    im = Image.new("RGBA", (32, 32), (74, 74, 74, 255))
    # subtle top highlight + edge so scaled walls don't look flat-dead
    for x in range(32):
        im.putpixel((x, 0), (216, 127, 74, 255))
        im.putpixel((x, 1), (180, 100, 55, 255))
        im.putpixel((x, 31), (40, 40, 40, 255))
    for y in range(32):
        im.putpixel((0, y), (216, 127, 74, 255))
        im.putpixel((31, y), (40, 40, 40, 255))
    return im


def make_sewer_floor(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            # push toward murky green
            px[x, y] = (max(0, int(r * 0.55)), min(255, int(g * 0.85 + 20)), max(0, int(b * 0.55)), a)
    return im


def pack_atlas(frames: dict[str, Image.Image], out_png: Path, out_json: Path) -> None:
    items = sorted(frames.items(), key=lambda kv: (-kv[1].height, -kv[1].width))
    gap = 2
    total_area = sum(im.width * im.height for _, im in items)
    sheet_w = 1 << int(math.ceil(math.log2(max(256, int(math.sqrt(total_area * 1.4))))))
    sheet_w = min(sheet_w, 1024)
    x = gap
    y = gap
    row_h = 0
    placed: list[tuple[str, int, int, Image.Image]] = []
    for name, im in items:
        if x + im.width + gap > sheet_w:
            x = gap
            y += row_h + gap
            row_h = 0
        placed.append((name, x, y, im))
        row_h = max(row_h, im.height)
        x += im.width + gap
    sheet_h = y + row_h + gap
    pot_h = 1
    while pot_h < sheet_h:
        pot_h <<= 1
    sheet = Image.new("RGBA", (sheet_w, pot_h), (0, 0, 0, 0))
    json_frames = {}
    for name, fx, fy, im in placed:
        sheet.paste(im, (fx, fy), im)
        json_frames[name] = {
            "frame": {"x": fx, "y": fy, "w": im.width, "h": im.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
            "sourceSize": {"w": im.width, "h": im.height},
        }
    atlas = {
        "frames": json_frames,
        "meta": {
            "app": "tools/install_kenney.py",
            "version": "1.0",
            "image": "sprites.png",
            "format": "RGBA8888",
            "size": {"w": sheet_w, "h": pot_h},
            "scale": "1",
            "credit": "Kenney.nl Top-down Shooter (CC0)",
        },
    }
    sheet.save(out_png, optimize=True)
    out_json.write_text(json.dumps(atlas, indent=2), encoding="utf-8")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing Kenney PNG root: {SRC}")

    OUT_SPRITES.mkdir(parents=True, exist_ok=True)
    OUT_TILES.mkdir(parents=True, exist_ok=True)
    OUT_UI.mkdir(parents=True, exist_ok=True)

    frames: dict[str, Image.Image] = {}
    for name, path in CHAR_MAP.items():
        im = crop_alpha(Image.open(path))
        frames[name] = im
        im.save(OUT_SPRITES / f"{name}.png", optimize=True)
        print(f"sprite {name}: {im.size}")

    tiles_root = SRC / "Tiles"
    for key, fname in TILE_MAP.items():
        if key == "crate_src":
            crate = crop_alpha(Image.open(tiles_root / fname))
            # normalize crate to ~32px tall for gameplay scale
            s = 32 / max(crate.size)
            crate = crate.resize((max(1, int(crate.width * s)), max(1, int(crate.height * s))), Image.Resampling.LANCZOS)
            frames["crate"] = crate
            crate.save(OUT_SPRITES / "crate.png", optimize=True)
            print(f"sprite crate: {crate.size}")
            continue
        src = tiles_root / fname
        dest = OUT_TILES / f"{key}.png"
        shutil.copy2(src, dest)
        print(f"tile {key} <- {fname}")

    sewer = make_sewer_floor(tiles_root / "tile_90.png")
    sewer.save(OUT_TILES / "floor_sewer.png", optimize=True)
    print("tile floor_sewer (tinted)")

    wall = make_wall_tile()
    wall.save(OUT_TILES / "wall.png", optimize=True)
    frames["wall"] = wall
    print("tile wall 32x32")

    # License note
    lic_src = ROOT / "tools" / "tmp" / "kenney" / "License.txt"
    if lic_src.exists():
        shutil.copy2(lic_src, OUT_SPRITES / "KENNEY_LICENSE.txt")

    pack_atlas(frames, OUT_SPRITES / "sprites.png", OUT_SPRITES / "sprites.json")
    total = sum(p.stat().st_size for p in list(OUT_SPRITES.glob("*")) + list(OUT_TILES.glob("*")) if p.is_file())
    print(f"assets total: {total / 1024:.1f} KB")


if __name__ == "__main__":
    main()
