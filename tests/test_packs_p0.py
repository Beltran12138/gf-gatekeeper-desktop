"""P0 validation: emotion-pack format + loader + chroma-key builder.

Run:  python tests/test_packs_p0.py
Uses a temp packs dir (never touches the real ~/.gf_gatekeeper).
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config
import pack_builder
from PIL import Image

FAILS = []


def check(name, cond):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        FAILS.append(name)


def make_png(path, color=(200, 100, 100, 255), size=(20, 20)):
    Image.new("RGBA", size, color).save(path)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="gfpack_"))
    packs = tmp / "packs"

    # --- build a valid pack: waifu with nag + happy, bye/waiting/angry absent ---
    wf = packs / "waifu"
    wf.mkdir(parents=True)
    make_png(wf / "nag.png")
    make_png(wf / "happy.png")
    (wf / "pack.json").write_text(json.dumps({
        "id": "waifu", "name": "Waifu", "author": "me", "style": "square",
        "emotions": {"nag": ["nag.png"], "happy": ["happy.png"],
                     "ghost": ["missing.png"]},  # missing file must be dropped
    }), encoding="utf-8")

    # an invalid pack (no resolvable media) must be skipped by list_packs
    bad = packs / "bad"
    bad.mkdir()
    (bad / "pack.json").write_text(json.dumps(
        {"id": "bad", "emotions": {"nag": ["nope.png"]}}), encoding="utf-8")

    config.PACKS_DIR = packs  # redirect loader to temp

    print("load_pack:")
    p = config.load_pack(wf)
    check("loads waifu", p is not None)
    check("id/name/style parsed", p["id"] == "waifu" and p["style"] == "square")
    check("nag resolved to abs existing path", len(p["emotions"]["nag"]) == 1
          and Path(p["emotions"]["nag"][0]).exists())
    check("missing file dropped (ghost absent)", "ghost" not in p["emotions"])
    check("unknown emotion 'ghost' never admitted", set(p["emotions"]) <= set(config.EMOTIONS))

    print("list_packs (skips invalid):")
    lst = config.list_packs()
    check("only valid pack returned", [x["id"] for x in lst] == ["waifu"])

    print("pack_emotion fallback:")
    check("happy → happy", config.pack_emotion(p, "happy") == p["emotions"]["happy"])
    check("bye (absent) → nag", config.pack_emotion(p, "bye") == p["emotions"]["nag"])
    check("waiting (absent) → nag", config.pack_emotion(p, "waiting") == p["emotions"]["nag"])
    check("None pack → []", config.pack_emotion(None, "nag") == [])

    print("active_pack selection:")
    check("active_pack='waifu' → waifu", config.active_pack({"active_pack": "waifu"})["id"] == "waifu")
    check("unknown id → legacy fallback (None here, no media)",
          config.active_pack({"active_pack": "ghost"}) is None)

    print("legacy backward-compat:")
    legacy_img = tmp / "old.png"
    make_png(legacy_img)
    cfg = {"active_pack": "", "media_list": [str(legacy_img)], "photo_style": "circle"}
    lp = config.active_pack(cfg)
    check("legacy media_list → synthesized pack", lp is not None and lp["id"] == "legacy")
    check("legacy media lands in nag", lp["emotions"]["nag"] == [str(legacy_img)])
    check("legacy style carried through", lp["style"] == "circle")
    check("empty config → None", config.active_pack({"active_pack": ""}) is None)
    check("photo_path fallback works",
          config.active_pack({"photo_path": str(legacy_img)})["emotions"]["nag"] == [str(legacy_img)])

    print("pack_builder chroma-key:")
    # green-screen image: green border, red center square → corners must go clear
    src = tmp / "green.png"
    im = Image.new("RGBA", (60, 60), (0, 255, 0, 255))
    for x in range(20, 40):
        for y in range(20, 40):
            im.putpixel((x, y), (200, 30, 30, 255))
    im.save(src)
    out = pack_builder.process(src, tmp / "clean", tol=40, circle=False, no_strip=False)
    res = Image.open(out).convert("RGBA")
    check("output is RGBA with alpha", res.mode == "RGBA")
    check("cropped to red content (~20x20)", abs(res.width - 20) <= 4 and abs(res.height - 20) <= 4)
    r, g, b, a = res.split()
    check("subject stays opaque after strip", a.getextrema()[1] == 255)
    check("green fully removed from result", g.getextrema()[1] <= b.getextrema()[1] + 40)

    print()
    if FAILS:
        print(f"RESULT: FAIL ❌  ({len(FAILS)} failed: {', '.join(FAILS)})")
        sys.exit(1)
    print("RESULT: PASS ✅  (all P0 assertions)")


if __name__ == "__main__":
    main()
