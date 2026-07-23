"""
Phase 1 step 2: downscale sprites, key alpha, pack Phaser atlas.
Run from repo root: python tools/crunch_sprites.py
"""
from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sprites"
MAX_EDGE = 256
PAD = 2

# Root PNGs to crunch → atlas frame name
SOURCES = {
    "sprite_player.png": "player",
    "sprite_zombie.png": "zombie",
    "sprite_bandit.png": "bandit",
    "sprite_spitter.png": "spitter",
    "sprite_boss.png": "boss",
    "sprite_skull.png": "skull",
    "sprite_crate.png": "crate",
    "leaper_idle_0.png": "leaper_idle_0",
    "leaper_idle_1.png": "leaper_idle_1",
}


def is_near_black(r: int, g: int, b: int, thresh: int = 28) -> bool:
    return r <= thresh and g <= thresh and b <= thresh


def is_checker_gray(r: int, g: int, b: int) -> bool:
    """Checkerboard / neutral gray background (player/bandit AI exports)."""
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn > 18:
        return False
    # typical checker cells ~15–140
    avg = (r + g + b) / 3
    return 8 <= avg <= 160


def flood_key_transparent(im: Image.Image, mode: str) -> Image.Image:
    """Flood from edges; mark background pixels transparent."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    visited = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()

    def idx(x: int, y: int) -> int:
        return y * w + x

    def is_bg(r: int, g: int, b: int, a: int) -> bool:
        if a == 0:
            return True
        if mode == "black":
            return is_near_black(r, g, b)
        if mode == "checker":
            return is_checker_gray(r, g, b) or is_near_black(r, g, b, 12)
        return False

    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        i = idx(x, y)
        if visited[i]:
            continue
        visited[i] = 1
        r, g, b, a = px[x, y]
        if not is_bg(r, g, b, a):
            continue
        px[x, y] = (r, g, b, 0)
        if x > 0:
            q.append((x - 1, y))
        if x + 1 < w:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y + 1 < h:
            q.append((x, y + 1))

    return rgba


def content_bbox(im: Image.Image, alpha_min: int = 16) -> tuple[int, int, int, int] | None:
    a = im.split()[-1]
    bb = a.getbbox()
    if not bb:
        # fallback: any non-near-black
        rgb = im.convert("RGB")
        w, h = rgb.size
        px = rgb.load()
        minx, miny, maxx, maxy = w, h, -1, -1
        for y in range(h):
            for x in range(w):
                r, g, b = px[x, y]
                if not is_near_black(r, g, b, 20):
                    minx = min(minx, x)
                    miny = min(miny, y)
                    maxx = max(maxx, x)
                    maxy = max(maxy, y)
        if maxx < 0:
            return None
        return (minx, miny, maxx + 1, maxy + 1)
    return bb


def process_one(path: Path, frame: str) -> Image.Image:
    im = Image.open(path)
    # Already-RGBA small assets: keep alpha, just ensure size
    if im.mode == "RGBA" and max(im.size) <= 128 and frame.startswith("leaper"):
        out = im
    elif frame in ("player", "bandit"):
        # Downscale first for flood speed, then key
        scale = min(1.0, 1024 / max(im.size))
        if scale < 1:
            nw = max(1, int(im.width * scale))
            nh = max(1, int(im.height * scale))
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        out = flood_key_transparent(im, "checker")
    else:
        scale = min(1.0, 1024 / max(im.size))
        if scale < 1 and max(im.size) > 1024:
            nw = max(1, int(im.width * scale))
            nh = max(1, int(im.height * scale))
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)
        out = flood_key_transparent(im, "black")

    bb = content_bbox(out)
    if bb:
        x0, y0, x1, y1 = bb
        x0 = max(0, x0 - PAD)
        y0 = max(0, y0 - PAD)
        x1 = min(out.width, x1 + PAD)
        y1 = min(out.height, y1 + PAD)
        out = out.crop((x0, y0, x1, y1))

    w, h = out.size
    if max(w, h) > MAX_EDGE:
        s = MAX_EDGE / max(w, h)
        out = out.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)

    return out.convert("RGBA")


def pack_atlas(frames: dict[str, Image.Image]) -> tuple[Image.Image, dict]:
    """Simple shelf packer (left-to-right, wrap)."""
    items = sorted(frames.items(), key=lambda kv: -kv[1].height)
    gap = 2
    # estimate width
    total_area = sum(im.width * im.height for _, im in items)
    sheet_w = 1 << int(math.ceil(math.log2(max(512, int(math.sqrt(total_area * 1.3))))))
    sheet_w = min(sheet_w, 2048)

    x = gap
    y = gap
    row_h = 0
    placements: list[tuple[str, int, int, Image.Image]] = []
    for name, im in items:
        if x + im.width + gap > sheet_w:
            x = gap
            y += row_h + gap
            row_h = 0
        placements.append((name, x, y, im))
        row_h = max(row_h, im.height)
        x += im.width + gap

    sheet_h = y + row_h + gap
    # bump to power of two height for nicer GPU upload
    pot_h = 1
    while pot_h < sheet_h:
        pot_h <<= 1
    sheet = Image.new("RGBA", (sheet_w, pot_h), (0, 0, 0, 0))
    json_frames = {}
    for name, fx, fy, im in placements:
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
            "app": "LovelyLadyLumps tools/crunch_sprites.py",
            "version": "1.0",
            "image": "sprites.png",
            "format": "RGBA8888",
            "size": {"w": sheet_w, "h": pot_h},
            "scale": "1",
        },
    }
    return sheet, atlas


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (ROOT / "assets" / "audio").mkdir(parents=True, exist_ok=True)
    (ROOT / "assets" / "tiles").mkdir(parents=True, exist_ok=True)
    (ROOT / "assets" / "ui").mkdir(parents=True, exist_ok=True)

    frames: dict[str, Image.Image] = {}
    for src_name, frame in SOURCES.items():
        src = ROOT / src_name
        if not src.exists():
            print(f"SKIP missing {src_name}")
            continue
        print(f"process {src_name} -> {frame} ...")
        frames[frame] = process_one(src, frame)
        # also write individual for inspection
        frames[frame].save(OUT_DIR / f"{frame}.png", optimize=True)

    sheet, atlas = pack_atlas(frames)
    sheet_path = OUT_DIR / "sprites.png"
    json_path = OUT_DIR / "sprites.json"
    sheet.save(sheet_path, optimize=True)
    json_path.write_text(json.dumps(atlas, indent=2), encoding="utf-8")

    total = sum(p.stat().st_size for p in OUT_DIR.glob("*") if p.is_file())
    print(f"Wrote {sheet_path} ({sheet.size[0]}x{sheet.size[1]})")
    print(f"Wrote {json_path}")
    print(f"assets/sprites total: {total / 1024:.1f} KB")
    for name, im in sorted(frames.items()):
        print(f"  {name}: {im.size[0]}x{im.size[1]}")


if __name__ == "__main__":
    main()
