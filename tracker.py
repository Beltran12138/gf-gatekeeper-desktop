"""
Window focus tracker using SetWinEventHook (event-driven, replaces 1-second polling).

Architecture:
  hook_thread  — installs SetWinEventHook, runs Windows message pump,
                 updates _current_key on every foreground-window change.
  tick_thread  — every 1 s, increments _site_time[_current_key],
                 checks limits, fires on_limit_reached.
"""
import ctypes
import threading
import time
from ctypes import wintypes
from typing import Callable

EVENT_SYSTEM_FOREGROUND = 0x0003
WINEVENT_OUTOFCONTEXT   = 0x0000
WINEVENT_SKIPOWNPROCESS = 0x0002

WinEventProc = ctypes.WINFUNCTYPE(
    None,
    wintypes.HANDLE,  # hWinEventHook
    wintypes.DWORD,   # event
    wintypes.HWND,    # hwnd
    wintypes.LONG,    # idObject
    wintypes.LONG,    # idChild
    wintypes.DWORD,   # dwEventThread
    wintypes.DWORD,   # dwmsEventTime
)


def log_session(keyword: str, seconds: int, triggered: bool) -> None:
    """Thin wrapper — silently ignores missing analytics module."""
    try:
        from analytics import log_session as _log
        _log(keyword, seconds, triggered)
    except Exception:
        pass


class WindowTracker:
    def __init__(
        self,
        config_getter: Callable[[], dict],
        on_limit_reached: Callable[[str], None],
    ) -> None:
        self.config_getter    = config_getter
        self.on_limit_reached = on_limit_reached

        self._site_time: dict[str, int]   = {}
        self._break_end: dict[str, float] = {}
        self._triggered: set[str]         = set()
        self._current_key: str | None     = None
        self._lock                        = threading.Lock()
        self._running                     = False

        # Hook-thread state
        self._hook_proc: WinEventProc | None = None  # must stay alive
        self._hook: wintypes.HANDLE | None   = None
        self._hook_tid: int                  = 0
        self._hook_ready                     = threading.Event()

    # ── public API ───────────────────────────────────────────────────────────

    def start(self) -> None:
        self._running = True
        threading.Thread(target=self._hook_thread, daemon=True,
                         name='gk-hook').start()
        threading.Thread(target=self._tick_thread, daemon=True,
                         name='gk-tick').start()

    def stop(self) -> None:
        self._running = False
        # Flush accumulated (non-triggered) time to analytics before exit
        with self._lock:
            pending = dict(self._site_time)
        for kw, sec in pending.items():
            if sec > 0:
                log_session(kw, sec, triggered=False)
        # Tear down Windows hook
        self._hook_ready.wait(timeout=2.0)
        if self._hook:
            ctypes.windll.user32.UnhookWinEvent(self._hook)
        if self._hook_tid:
            ctypes.windll.user32.PostThreadMessageW(
                self._hook_tid, 0x0012, 0, 0)  # WM_QUIT

    def start_break(self, key: str) -> None:
        cfg = self.config_getter()
        end = time.time() + cfg.get('break_minutes', 5) * 60
        with self._lock:
            prev = self._site_time.get(key, 0)
            self._break_end[key] = end
            self._site_time[key] = 0
            self._triggered.discard(key)
        log_session(key, prev, triggered=True)

    def reset_all(self) -> None:
        with self._lock:
            self._site_time.clear()
            self._break_end.clear()
            self._triggered.clear()
            self._current_key = None

    def get_stats(self) -> tuple[dict[str, int], dict[str, float]]:
        with self._lock:
            return dict(self._site_time), dict(self._break_end)

    # ── hook thread ──────────────────────────────────────────────────────────

    def _hook_thread(self) -> None:
        self._hook_tid = ctypes.windll.kernel32.GetCurrentThreadId()

        def _callback(
            hWinEventHook, event, hwnd,
            idObject, idChild, dwEventThread, dwmsEventTime,
        ):
            buf = ctypes.create_unicode_buffer(512)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, 512)
            key = self._match(buf.value, self.config_getter())
            with self._lock:
                self._current_key = key

        self._hook_proc = WinEventProc(_callback)
        self._hook = ctypes.windll.user32.SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
            None, self._hook_proc, 0, 0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
        self._hook_ready.set()

        msg = wintypes.MSG()
        while ctypes.windll.user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            ctypes.windll.user32.TranslateMessage(ctypes.byref(msg))
            ctypes.windll.user32.DispatchMessageW(ctypes.byref(msg))

    # ── tick thread ──────────────────────────────────────────────────────────

    def _tick_thread(self) -> None:
        while self._running:
            time.sleep(1)
            cfg = self.config_getter()
            now = time.time()
            limit = cfg.get('time_limit_minutes', 15) * 60

            # Poll every tick to catch in-browser tab changes
            # (SetWinEventHook only fires on window-level focus change, not tab switch)
            try:
                hwnd = ctypes.windll.user32.GetForegroundWindow()
                buf  = ctypes.create_unicode_buffer(512)
                ctypes.windll.user32.GetWindowTextW(hwnd, buf, 512)
                polled_key = self._match(buf.value, cfg)
                with self._lock:
                    self._current_key = polled_key
            except Exception:
                pass

            with self._lock:
                # Expire finished breaks
                expired = [k for k, v in self._break_end.items() if now >= v]
                for k in expired:
                    del self._break_end[k]
                    self._site_time[k] = 0
                    self._triggered.discard(k)

                key = self._current_key
                if key and key not in self._break_end:
                    self._site_time[key] = self._site_time.get(key, 0) + 1
                    if (self._site_time[key] >= limit
                            and key not in self._triggered):
                        self._triggered.add(key)
                        threading.Thread(
                            target=self.on_limit_reached,
                            args=(key,), daemon=True,
                        ).start()

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _match(title: str, cfg: dict) -> str | None:
        tl = title.lower()
        for kw in cfg.get('tracked_keywords', []):
            if kw.lower() in tl:
                return kw
        return None
