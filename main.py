"""
Girlfriend Gatekeeper — Desktop
監測窗口標題，超時彈出全屏覆蓋。
"""
import tkinter as tk
import threading
import queue
import sys

from config import load_config, save_config
from tracker import WindowTracker
from overlay import GatekeeperOverlay
from settings_win import SettingsWindow


class App:
    def __init__(self):
        self.config = load_config()

        # Init analytics DB (creates tables if needed)
        try:
            from analytics import init_db
            init_db()
        except Exception:
            pass

        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title('Girlfriend Gatekeeper')

        self.q = queue.Queue()
        self.overlay: GatekeeperOverlay | None = None
        self.settings: SettingsWindow | None = None

        self.tracker = WindowTracker(
            config_getter=lambda: self.config,
            on_limit_reached=lambda key: self.q.put(('overlay', key))
        )
        self.tracker.start()

        # Start embedded Flask dashboard (silently ignored if flask not installed)
        try:
            from web.server import start_server, set_tracker
            set_tracker(self.tracker)
            start_server()
        except Exception:
            pass

        self._mini_control()
        self._setup_tray()
        self._poll()
        self.root.mainloop()

    # ── event loop ───────────────────────────────────────────────────────────

    def _poll(self):
        try:
            while True:
                cmd, *args = self.q.get_nowait()
                if cmd == 'overlay':
                    self._show_overlay(args[0])
                elif cmd == 'settings':
                    self._open_settings()
                elif cmd == 'reset':
                    self.tracker.reset_all()
                elif cmd == 'dashboard':
                    self._open_dashboard()
                elif cmd == 'quit':
                    self._quit()
        except queue.Empty:
            pass
        self.root.after(100, self._poll)

    # ── overlay ──────────────────────────────────────────────────────────────

    def _show_overlay(self, key):
        if self.overlay:
            return
        self.overlay = GatekeeperOverlay(
            parent=self.root,
            key=key,
            config=self.config,
            on_break_start=self.tracker.start_break,
            on_break_end=self._overlay_done,
        )
        self.overlay.show()

    def _overlay_done(self):
        self.overlay = None

    # ── settings ─────────────────────────────────────────────────────────────

    def _open_settings(self):
        if self.settings:
            self.settings.focus()
            return

        def on_save(new_cfg):
            self.config.update(new_cfg)
            save_config(self.config)

        self.settings = SettingsWindow(
            parent=self.root,
            config=self.config,
            on_save=on_save,
            on_close=lambda: setattr(self, 'settings', None),
            tracker=self.tracker,
        )

    # ── dashboard ────────────────────────────────────────────────────────────

    def _open_dashboard(self):
        try:
            from web.server import open_dashboard
            open_dashboard()
        except Exception:
            pass

    # ── tray ─────────────────────────────────────────────────────────────────

    def _setup_tray(self):
        try:
            import pystray
            from PIL import Image, ImageDraw

            img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            d.ellipse([2, 2, 62, 62], fill=(255, 107, 157))

            menu = pystray.Menu(
                pystray.MenuItem('設置', lambda: self.q.put(('settings',))),
                pystray.MenuItem('重置計時', lambda: self.q.put(('reset',))),
                pystray.MenuItem('統計面板', lambda: self.q.put(('dashboard',))),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem('退出', lambda: self.q.put(('quit',))),
            )
            self.tray = pystray.Icon(
                'gf_gatekeeper', img, 'Girlfriend Gatekeeper', menu)
            threading.Thread(target=self.tray.run, daemon=True).start()

        except Exception:
            pass

    def _mini_control(self):
        w = tk.Toplevel(self.root)
        w.title('Girlfriend Gatekeeper')
        w.geometry('280x120')
        w.resizable(False, False)
        w.configure(bg='#111111')
        w.protocol('WM_DELETE_WINDOW', w.withdraw)

        tk.Label(w, text='Girlfriend Gatekeeper',
                 font=('Microsoft YaHei', 11, 'bold'),
                 bg='#111111', fg='white').pack(pady=(12, 8))

        row = tk.Frame(w, bg='#111111')
        row.pack()

        buttons = [
            ('設置',  'settings',  'white',   '#2a2a2a'),
            ('重置',  'reset',     'white',   '#2a2a2a'),
            ('面板',  'dashboard', '#7dcfff', '#0a1a2a'),
            ('退出',  'quit',      '#ff7070', '#2a0000'),
        ]
        for txt, cmd, fg, bg in buttons:
            tk.Button(row, text=txt, font=('Microsoft YaHei', 10),
                      fg=fg, bg=bg, relief='flat', padx=10, pady=5,
                      cursor='hand2',
                      command=lambda c=cmd: self.q.put((c,))
                      ).pack(side='left', padx=3)

    # ── quit ─────────────────────────────────────────────────────────────────

    def _quit(self):
        save_config(self.config)
        self.tracker.stop()
        try:
            self.tray.stop()
        except Exception:
            pass
        self.root.quit()
        sys.exit(0)


if __name__ == '__main__':
    App()
