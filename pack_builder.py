#!/usr/bin/env python3
"""
Emotion-pack image prep — chroma-key green/flat backgrounds to clean PNGs.

Lifted from the Joke Bear Codex-pet packer (pack_pet.py `remove_bg`): flood-fill
the flat background from the 4 corners (so same-colored pixels INSIDE the subject
survive), then a vectorized green-despill to kill the anti-aliased fringe. Unlike
the pet packer this does NOT build a sprite-sheet — gf-gk uses one image per
emotion, so this just emits trimmed, transparent PNGs ready to drop into a pack.

Usage:
    pip install pillow
    python pack_builder.py raw/                 # strip every image in raw/ → *_clean.png
    python pack_builder.py raw/nag.jpg          # single file
    python pack_builder.py raw/ -o packs/waifu  # write cleaned PNGs into a pack dir
    python pack_builder.py raw/ --circle        # also apply a round mask
    python pack_builder.py raw/ --tol 55        # raise tolerance if a halo remains

Then hand-write packs/<id>/pack.json referencing the cleaned files, e.g.:
    {"id":"waifu","name":"Waifu","style":"circle",
     "emotions":{"nag":["nag_clean.png"],"happy":["happy_clean.png"]}}
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    sys.exit("Missing dependency. Run:  pip install pillow")

IMG_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}


def crop_to_content(img: Image.Image) -> Image.Image:
    """Trim fully-transparent margins."""
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def remove_bg(img: Image.Image, tol: int) -> Image.Image:
    """Chroma-key a flat/green background to transparency.

    Flood-fills from the 4 corners (contiguous only, so same-colored pixels
    inside the subject are preserved) and neutralizes leftover green fringe.
    """
    # Full-res floodfill is pure-Python and slow; 1024 is plenty for portraits
    # and keeps it responsive. (Pet cells were tiny; portraits want more detail.)
    if max(img.size) > 1024:
        img = img.copy()
        img.thumbnail((1024, 1024), Image.LANCZOS)
    rgb = img.convert("RGB")
    W, H = rgb.size
    # Magenta sentinel: assumed absent from the subject (true for green-screen /
    # white / beige backdrops). If your subject is magenta, pick another color.
    sentinel = (255, 0, 255)
    work = rgb.copy()
    for corner in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
        ImageDraw.floodfill(work, corner, sentinel, thresh=tol)

    # Vectorized background mask: where the flood painted sentinel exactly.
    diff = ImageChops.difference(work, Image.new("RGB", (W, H), sentinel))
    dr, dg, db = diff.split()
    nz = ImageChops.lighter(ImageChops.lighter(dr, dg), db)
    bg_mask = nz.point(lambda v: 255 if v == 0 else 0)

    out = img.convert("RGBA")
    r, g, b, a = out.split()
    max_rb = ImageChops.lighter(r, b)
    green = ImageChops.subtract(g, max_rb)                    # >0 where green-dominant
    kill = green.point(lambda v: 255 if v > 30 else 0)       # fringe / leftover specks
    mild = green.point(lambda v: 255 if 0 < v <= 30 else 0)  # faint green tint
    g = Image.composite(max_rb, g, mild)                     # neutralize the tint
    transparent = ImageChops.lighter(bg_mask, kill)
    a = Image.composite(Image.new("L", (W, H), 0), a, transparent)
    return crop_to_content(Image.merge("RGBA", (r, g, b, a)))


def apply_circle(img: Image.Image) -> Image.Image:
    """Center-crop to a square and mask to a circle (matches overlay circle style)."""
    img = img.convert("RGBA")
    w, h = img.size
    m = min(w, h)
    img = img.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
    mask = Image.new('L', (m, m), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, m - 1, m - 1), fill=255)
    img.putalpha(mask)
    return img


def process(src: Path, out_dir: Path, tol: int, circle: bool, no_strip: bool) -> Path:
    img = Image.open(src)
    if not no_strip:
        img = remove_bg(img, tol)
    else:
        img = img.convert("RGBA")
    if circle:
        img = apply_circle(img)
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"{src.stem}_clean.png"
    img.save(dst, "PNG")
    return dst


def gather(target: Path):
    if target.is_dir():
        return sorted(p for p in target.iterdir() if p.suffix.lower() in IMG_EXTS)
    if target.suffix.lower() in IMG_EXTS:
        return [target]
    return []


def main() -> None:
    ap = argparse.ArgumentParser(description="Chroma-key emotion-pack images to clean PNGs.")
    ap.add_argument("input", help="image file or folder of images")
    ap.add_argument("-o", "--out", help="output dir (default: alongside input)")
    ap.add_argument("--tol", type=int, default=40,
                    help="chroma-key tolerance (default 40; raise if halo remains)")
    ap.add_argument("--circle", action="store_true", help="also apply a round mask")
    ap.add_argument("--no-strip", action="store_true",
                    help="skip background removal (only convert / circle-mask)")
    args = ap.parse_args()

    target = Path(args.input)
    files = gather(target)
    if not files:
        sys.exit(f"No images found at: {target}")
    out_dir = Path(args.out) if args.out else (target if target.is_dir() else target.parent)

    for src in files:
        try:
            dst = process(src, out_dir, args.tol, args.circle, args.no_strip)
            print(f"  {src.name}  ->  {dst}")
        except Exception as e:
            print(f"  {src.name}  FAILED: {e}")
    print(f"\nDone. Reference the *_clean.png files from your pack.json emotions.")


if __name__ == "__main__":
    main()
