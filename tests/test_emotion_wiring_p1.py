"""P1 validation: emotion beats wired into overlay nodes.

Run:  python tests/test_emotion_wiring_p1.py
No real window is created — self.win / canvas / widgets are stubbed, and the
emotion-switch + countdown internals are recorded. Also checks the real
_emotion_items fallback + shared-MediaItem cache against a temp pack.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image
import config
import overlay as ov
from overlay import GatekeeperOverlay, HAPPY_HOLD_MS, BYE_HOLD_MS

FAILS = []


def check(name, cond):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        FAILS.append(name)


class FakeWin:
    def __init__(self):
        self.scheduled = []  # (ms, callback)
    def after(self, ms, cb):
        self.scheduled.append((ms, cb))
        return f"job{len(self.scheduled)}"
    def after_cancel(self, _job):
        pass


class FakeCfgWidget:
    def config(self, **_kw):
        pass
    def itemconfig(self, *_a, **_kw):
        pass


def make_png(path, color=(200, 100, 100, 255)):
    Image.new("RGBA", (16, 16), color).save(path)


def new_overlay(cfg):
    o = GatekeeperOverlay(parent=None, key='example.com', config=cfg,
                          on_break_start=lambda k: None, on_break_end=lambda: None)
    return o


def test_break_click_beats():
    print("break_click → happy, then waiting:")
    o = new_overlay({'break_minutes': 5})
    seen = []
    o._set_emotion = lambda name: seen.append(name)
    o._tick = lambda: seen.append('__tick__')
    o.win = FakeWin()
    o.btn = FakeCfgWidget()
    o.canvas = FakeCfgWidget()
    o.sub_id = 1

    o._break_click()
    check("happy fires immediately", seen[:1] == ['happy'])
    check("countdown started (_tick called)", '__tick__' in seen)
    check("waiting scheduled at HAPPY_HOLD_MS",
          any(ms == HAPPY_HOLD_MS for ms, _ in o.win.scheduled))
    # fire the scheduled waiting callback
    for ms, cb in o.win.scheduled:
        if ms == HAPPY_HOLD_MS:
            cb()
    check("waiting fires after hold", 'waiting' in seen)

    # second click is a no-op (break_started guard)
    seen.clear()
    o._break_click()
    check("re-click ignored", seen == [])


def test_finish_beat():
    print("countdown end → bye, then close:")
    o = new_overlay({'break_minutes': 5})
    seen = []
    closed = []
    o._set_emotion = lambda name: seen.append(name)
    o.hide = lambda: closed.append('hide')
    o.on_break_end = lambda: closed.append('end')
    o.win = FakeWin()

    o._finish()
    check("bye fires", seen == ['bye'])
    check("close scheduled at BYE_HOLD_MS",
          any(ms == BYE_HOLD_MS for ms, _ in o.win.scheduled))
    for ms, cb in o.win.scheduled:
        if ms == BYE_HOLD_MS:
            cb()
    check("hide + on_break_end after bye hold", closed == ['hide', 'end'])


def test_emergency_stays_instant():
    print("emergency (ESC) stays instant — no emotion, no delay:")
    o = new_overlay({'break_minutes': 5})
    seen = []
    closed = []
    o._set_emotion = lambda name: seen.append(name)
    o.hide = lambda: closed.append('hide')
    o.on_break_end = lambda: closed.append('end')
    o._emergency()
    check("no emotion beat on emergency", seen == [])
    check("closes immediately", closed == ['hide', 'end'])


def test_emotion_items_fallback_and_cache():
    print("_emotion_items fallback + shared MediaItem cache:")
    tmp = Path(tempfile.mkdtemp(prefix="gfp1_"))
    packs = tmp / "packs"
    wf = packs / "waifu"
    wf.mkdir(parents=True)
    make_png(wf / "nag.png", (10, 200, 10, 255))
    make_png(wf / "happy.png", (10, 10, 200, 255))
    (wf / "pack.json").write_text(json.dumps({
        "id": "waifu", "style": "circle",
        "emotions": {"nag": ["nag.png"], "happy": ["happy.png"]},
    }), encoding="utf-8")
    config.PACKS_DIR = packs

    o = new_overlay({'active_pack': 'waifu'})
    o.pack = config.active_pack({'active_pack': 'waifu'})
    o._base_photo_size = 220
    o._circle = True

    nag = o._emotion_items('nag')
    happy = o._emotion_items('happy')
    bye = o._emotion_items('bye')       # absent → falls back to nag
    check("nag loads 1 MediaItem", len(nag) == 1 and nag[0].ok())
    check("happy is its own item", len(happy) == 1 and happy[0] is not nag[0])
    check("bye falls back to nag's SAME MediaItem", bye and bye[0] is nag[0])
    check("cache returns identical list object", o._emotion_items('nag') is nag)
    check("_item_by_path shared (2 distinct images loaded)", len(o._item_by_path) == 2)


def main():
    test_break_click_beats()
    test_finish_beat()
    test_emergency_stays_instant()
    test_emotion_items_fallback_and_cache()
    print()
    if FAILS:
        print(f"RESULT: FAIL ❌  ({len(FAILS)} failed: {', '.join(FAILS)})")
        sys.exit(1)
    print("RESULT: PASS ✅  (all P1 wiring assertions)")


if __name__ == "__main__":
    main()
