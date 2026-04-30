"""
Overlay: full-screen girlfriend gatekeeper.
Features: multi-media rotation, BGM + video audio (ffmpeg),
          WeChat-call UI, click-to-chat (AttachThreadInput),
          ESC emergency exit, 3D spring-physics entrance,
          PIL QUAD perspective transform, glow pulse ring,
          progress arc.
"""
import ctypes
import datetime
import math
import os
import subprocess
import tempfile
import threading
import tkinter as tk
from PIL import Image, ImageTk, ImageDraw

BG      = '#0a0a0f'
WHITE   = '#ffffff'
GRAY    = '#888888'
DIM     = '#444444'
PINK    = '#ff6b9d'
PURPLE  = '#c44dff'
WECHAT  = '#1aad19'
FONT    = 'Microsoft YaHei'

# 24-step glow colour cycle: dark-pink → full-pink → back
_GLOW_N = 24
GLOW_CYCLE = [
    (f'#{int(0x40 + 0xbf * ((math.sin(2 * math.pi * i / _GLOW_N) + 1) / 2)):02x}'
     f'{int(0x08 + 0x63 * ((math.sin(2 * math.pi * i / _GLOW_N) + 1) / 2)):02x}'
     f'{int(0x1f + 0x7e * ((math.sin(2 * math.pi * i / _GLOW_N) + 1) / 2)):02x}')
    for i in range(_GLOW_N)
]

# ── Optional deps ─────────────────────────────────────────────────────────────

try:
    import cv2 as _cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    import pygame.mixer as _pmix
    _pmix.pre_init(44100, -16, 2, 512)
    _pmix.init()
    HAS_AUDIO = True
except Exception:
    HAS_AUDIO = False


# ── Video audio extraction ────────────────────────────────────────────────────

def _extract_video_audio(video_path: str) -> str | None:
    """
    Use ffmpeg to extract audio from video to a temp WAV file.
    Returns path to temp WAV, or None if ffmpeg unavailable / no audio track.
    """
    try:
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        tmp.close()
        result = subprocess.run(
            ['ffmpeg', '-y', '-i', video_path,
             '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2',
             tmp.name],
            capture_output=True, timeout=15,
        )
        if result.returncode == 0 and os.path.getsize(tmp.name) > 1024:
            return tmp.name
        os.unlink(tmp.name)
    except Exception:
        pass
    return None


# ── MediaItem ─────────────────────────────────────────────────────────────────

class MediaItem:
    VIDEO_EXTS = {'.mp4', '.avi', '.mov', '.mkv', '.webm'}
    IMG_EXTS   = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}

    def __init__(self, path: str, base_size: int = 220, circle: bool = True):
        self.path       = path
        self.frames: list[Image.Image] = []
        self.frame_idx  = 0
        self.is_animated = False
        self.audio_path: str | None = None   # extracted video audio (WAV)
        self.frame_delay_ms: int = 113       # ms between frames in _do_animate
        ext = os.path.splitext(path)[1].lower()
        try:
            if ext == '.gif':
                self.is_animated = True
                self._load_gif(path, base_size, circle)
            elif ext in self.VIDEO_EXTS and HAS_CV2:
                self.is_animated = True
                self._load_video(path, base_size, circle)
                # Extract audio in the same background thread (ffmpeg)
                self.audio_path = _extract_video_audio(path)
            else:
                self._load_image(path, base_size, circle)
        except Exception as e:
            print(f'[MediaItem] {path}: {e}')

    def _prep(self, img: Image.Image, size: int, circle: bool) -> Image.Image:
        img = img.convert('RGBA')
        w, h = img.size
        m = min(w, h)
        img = img.crop(((w-m)//2, (h-m)//2, (w+m)//2, (h+m)//2))
        img = img.resize((size, size), Image.LANCZOS)
        if circle:
            mask = Image.new('L', (size, size), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, size-1, size-1), fill=255)
            img.putalpha(mask)
        return img

    def _load_image(self, path, size, circle):
        base = self._prep(Image.open(path), size, circle)
        for i in range(40):
            scale = 1.0 + 0.038 * math.sin(2 * math.pi * i / 40)
            sz = max(1, int(size * scale))
            self.frames.append(base.resize((sz, sz), Image.LANCZOS))

    def _load_gif(self, path, size, circle):
        gif = Image.open(path)
        try:
            while True:
                self.frames.append(self._prep(gif.copy(), size, circle))
                gif.seek(gif.tell() + 1)
        except EOFError:
            pass
        if not self.frames:
            self._load_image(path, size, circle)

    def _load_video(self, path, size, circle):
        cap = _cv2.VideoCapture(path)
        total = int(cap.get(_cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps   = cap.get(_cv2.CAP_PROP_FPS) or 30.0
        step  = max(1, total // 120)
        # Playback delay: each stored frame represents `step` original frames
        self.frame_delay_ms = max(20, int(step * 1000 / fps))
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if i % step == 0:
                frame = _cv2.cvtColor(frame, _cv2.COLOR_BGR2RGB)
                self.frames.append(
                    self._prep(Image.fromarray(frame), size, circle))
            i += 1
        cap.release()

    def ok(self) -> bool:
        return bool(self.frames)

    def next_frame(self) -> Image.Image | None:
        if not self.frames:
            return None
        f = self.frames[self.frame_idx]
        self.frame_idx = (self.frame_idx + 1) % len(self.frames)
        return f


# ── Overlay ───────────────────────────────────────────────────────────────────

class GatekeeperOverlay:
    def __init__(self, parent, key, config, on_break_start, on_break_end):
        self.parent         = parent
        self.key            = key
        self.config         = config
        self.on_break_start = on_break_start
        self.on_break_end   = on_break_end

        self.win              = None
        self.canvas           = None
        self.media_items: list[MediaItem] = []
        self.media_idx        = 0
        self._tk_ref          = None
        self.photo_id         = None
        self.cd_id            = None
        self.sub_id           = None
        self.btn              = None
        self.break_started    = False
        self._total_break     = config.get('break_minutes', 5) * 60
        self.countdown_val    = self._total_break
        self._anim_job        = None
        self._cd_job          = None
        self._switch_job      = None
        self._glow_job        = None
        self._loaded          = False
        self.cx = self.cy = self.photo_cy = 0
        self._base_photo_size = 220

        # Glow rings
        self._glow_ids: list[int] = []
        self._glow_idx  = 0
        self._glow_radii = [128, 138, 148]

        # Progress arc
        self._arc_id = None

        # Blurred screenshot background
        self._bg_tk = None

    # ── public ───────────────────────────────────────────────────────────────

    def show(self):
        # Screenshot BEFORE window appears — captures what user was browsing
        sw = self.parent.winfo_screenwidth()
        sh = self.parent.winfo_screenheight()
        self._capture_blurred_bg(sw, sh)

        self.win = tk.Toplevel(self.parent)
        self.win.title('')
        self.win.configure(bg=BG)
        self.win.attributes('-fullscreen', True)
        self.win.attributes('-topmost', True)
        self.win.overrideredirect(True)
        self.win.focus_force()

        self.cx, self.cy = sw // 2, sh // 2
        self.photo_cy = self.cy - 120

        self.canvas = tk.Canvas(self.win, bg=BG, highlightthickness=0,
                                width=sw, height=sh)
        self.canvas.pack(fill='both', expand=True)

        self.win.bind('<Escape>', lambda _e: self._emergency())
        self.canvas.bind('<Button-1>', self._click)

        self._draw_bg(sw, sh)
        self._draw_chrome(sw, sh)
        self._draw_glow_rings()
        threading.Thread(target=self._load_media, daemon=True).start()
        self._poll_loaded()
        self._tick_glow()

    def hide(self):
        for j in (self._anim_job, self._cd_job, self._switch_job, self._glow_job):
            if j:
                try: self.win.after_cancel(j)
                except Exception: pass
        self._stop_audio()
        if self.win:
            self.win.destroy()
            self.win = None

    # ── background: blurred screenshot ───────────────────────────────────────

    def _capture_blurred_bg(self, sw: int, sh: int) -> None:
        """Grab current screen, blur, darken — used as overlay background."""
        try:
            from PIL import ImageGrab, ImageFilter, ImageEnhance, ImageDraw as _ID
            import numpy as _np
            img = ImageGrab.grab(bbox=(0, 0, sw, sh))
            img = img.resize((sw, sh), Image.LANCZOS)
            img = img.filter(ImageFilter.GaussianBlur(radius=30))
            img = ImageEnhance.Brightness(img).enhance(0.32)
            # Radial vignette via PIL: darken edges, keep centre brighter
            vig = Image.new('L', (sw, sh), 0)
            _vd = _ID.Draw(vig)
            # 5 concentric ellipses white→black from centre outward
            steps = 8
            for i in range(steps):
                frac = i / steps
                alpha = int(220 * frac ** 1.6)
                rx = int(sw * 0.55 * frac)
                ry = int(sh * 0.55 * frac)
                cx2, cy2 = sw // 2, sh // 2
                _vd.ellipse([cx2 - rx, cy2 - ry, cx2 + rx, cy2 + ry],
                            fill=alpha)
            # Invert: we want DARK at edges
            vig_inv = Image.eval(vig, lambda x: 255 - x)
            dark = Image.new('RGB', (sw, sh), (0, 0, 8))
            img = Image.composite(dark, img, vig_inv)
            self._bg_tk = ImageTk.PhotoImage(img.convert('RGB'))
        except Exception:
            self._bg_tk = None

    def _draw_bg(self, sw: int, sh: int) -> None:
        c = self.canvas
        if self._bg_tk:
            c.create_image(0, 0, image=self._bg_tk, anchor='nw')
        else:
            c.create_rectangle(0, 0, sw, sh, fill=BG, outline='')

    # ── glow rings ────────────────────────────────────────────────────────────

    def _draw_glow_rings(self):
        if not self.win:
            return
        c, cx, cy = self.canvas, self.cx, self.photo_cy
        for i, r in enumerate(self._glow_radii):
            w = 3 if i == 1 else 2
            oid = c.create_oval(cx - r, cy - r, cx + r, cy + r,
                                outline=GLOW_CYCLE[0], width=w, fill='')
            self._glow_ids.append(oid)

    def _tick_glow(self):
        if not self.win:
            return
        self._glow_idx = (self._glow_idx + 1) % _GLOW_N
        for i, oid in enumerate(self._glow_ids):
            col = GLOW_CYCLE[(self._glow_idx + i * 8) % _GLOW_N]
            self.canvas.itemconfig(oid, outline=col)
        self._glow_job = self.win.after(90, self._tick_glow)

    def _scale_glow_rings(self, scale: float):
        """Resize glow ring ovals during entrance animation."""
        if not self.canvas:
            return
        cx, cy = self.cx, self.photo_cy
        for i, (oid, base_r) in enumerate(zip(self._glow_ids, self._glow_radii)):
            r = max(4, int(base_r * scale))
            self.canvas.coords(oid, cx - r, cy - r, cx + r, cy + r)

    # ── media loading ─────────────────────────────────────────────────────────

    def _load_media(self):
        ml = self.config.get('media_list', [])
        if not ml:
            p = self.config.get('photo_path', '')
            if p:
                ml = [p]
        videocall = self.config.get('videocall_ui', False)
        self._base_photo_size = 260 if videocall else 220
        circle = (not videocall) and \
                 (self.config.get('photo_style', 'circle') == 'circle')
        for path in ml:
            if os.path.exists(path):
                item = MediaItem(path,
                                 base_size=self._base_photo_size,
                                 circle=circle)
                if item.ok():
                    self.media_items.append(item)
        self._loaded = True

    def _poll_loaded(self):
        if not self._loaded:
            self._anim_job = self.win.after(80, self._poll_loaded) if self.win else None
            return
        if self.media_items:
            self._play_item_audio(self.media_items[0])
            self._entrance()
            secs = self.config.get('media_switch_seconds', 8)
            if len(self.media_items) > 1:
                self._switch_job = self.win.after(secs * 1000, self._next_media)
        else:
            self._start_bgm()
            if self.win:
                self.canvas.create_text(self.cx, self.photo_cy,
                                        text='❤️', font=('Segoe UI Emoji', 80),
                                        anchor='center')

    # ── 3D entrance: spring physics + PIL QUAD perspective ────────────────────

    @staticmethod
    def _apply_perspective(img: Image.Image, tilt: float) -> Image.Image:
        """
        PIL QUAD transform: bottom edge narrower = image tilted top-toward-viewer.
        tilt=0: flat. tilt=1: max perspective.
        """
        if tilt < 0.01:
            return img
        w, h = img.size
        shrink = int(w * tilt * 0.28)
        # QUAD data: (top-left, bottom-left, bottom-right, top-right) of SOURCE
        # Top: full width (close), Bottom: narrowed (far)
        data = (
            0,          0,   # output TL ← input TL
            shrink,     h,   # output BL ← input (inward) BL
            w - shrink, h,   # output BR ← input (inward) BR
            w,          0,   # output TR ← input TR
        )
        return img.transform(img.size, Image.QUAD, data, Image.BICUBIC)

    def _entrance(self, step: int = 0):
        """
        Spring-damped 3D entrance.
        omega=10, zeta=0.6 → overshoots ~8% at t≈0.3, settles by t≈0.8.
        """
        TOTAL  = 65
        OMEGA  = 10.0
        ZETA   = 0.60
        OMEGA_D = OMEGA * math.sqrt(1 - ZETA ** 2)

        if not self.win or not self.media_items:
            return

        t = (step / TOTAL) * 1.1          # map 0..TOTAL → 0..1.1 for full settle
        t = min(t, 1.5)

        # Underdamped spring: x(t) = 1 - e^(-ζωt)[cos(ωd*t) + (ζω/ωd)sin(ωd*t)]
        decay = math.exp(-ZETA * OMEGA * t)
        spring = 1.0 - decay * (
            math.cos(OMEGA_D * t) +
            (ZETA * OMEGA / OMEGA_D) * math.sin(OMEGA_D * t)
        )
        scale = max(0.02, spring)

        # Perspective tilt: max at t=0, zero by t=0.45
        tilt = max(0.0, 0.65 * (1.0 - t / 0.45))

        base = self.media_items[self.media_idx].frames[0]
        sz   = max(2, int(base.width * scale))
        frame = base.resize((sz, sz), Image.LANCZOS)
        frame = self._apply_perspective(frame, tilt)

        self._show_frame(frame)
        self._scale_glow_rings(scale)

        if step < TOTAL:
            delay = 14 if step < 40 else 20
            self._anim_job = self.win.after(delay, lambda: self._entrance(step + 1))
        else:
            # Reset glow rings to full size, start breathing animation
            self._scale_glow_rings(1.0)
            self._do_animate()

    def _do_animate(self):
        if not self.win or not self.media_items:
            return
        item = self.media_items[self.media_idx]
        self._show_frame(item.next_frame())
        self._anim_job = self.win.after(item.frame_delay_ms, self._do_animate)

    def _show_frame(self, pil_img: Image.Image | None, y_off: int = 0):
        if pil_img is None or not self.win:
            return
        tk_img = ImageTk.PhotoImage(pil_img)
        self._tk_ref = tk_img
        if self.photo_id is None:
            self.photo_id = self.canvas.create_image(
                self.cx, self.photo_cy + y_off, image=tk_img, anchor='center')
        else:
            self.canvas.itemconfig(self.photo_id, image=tk_img)
            self.canvas.coords(self.photo_id, self.cx, self.photo_cy + y_off)
        self.canvas.tag_raise(self.photo_id)
        for oid in self._glow_ids:
            self.canvas.tag_raise(oid)

    def _next_media(self):
        if not self.win or len(self.media_items) <= 1:
            return
        self.media_idx = (self.media_idx + 1) % len(self.media_items)
        self._play_item_audio(self.media_items[self.media_idx])
        secs = self.config.get('media_switch_seconds', 8)
        self._switch_job = self.win.after(secs * 1000, self._next_media)

    # ── audio ─────────────────────────────────────────────────────────────────

    def _play_item_audio(self, item: MediaItem):
        """Video item with extracted audio takes priority over BGM config."""
        if not HAS_AUDIO:
            return
        if item.audio_path and os.path.exists(item.audio_path):
            try:
                _pmix.music.load(item.audio_path)
                _pmix.music.play(-1)
                return
            except Exception as e:
                print(f'[audio] video audio failed: {e}')
        self._start_bgm()

    def _start_bgm(self):
        if not HAS_AUDIO:
            return
        bgm = self.config.get('bgm_path', '')
        if bgm and os.path.exists(bgm):
            try:
                _pmix.music.load(bgm)
                _pmix.music.play(-1)
            except Exception as e:
                print(f'[BGM] {e}')

    def _stop_audio(self):
        if HAS_AUDIO:
            try: _pmix.music.stop()
            except Exception: pass

    # ── chrome: dispatch ──────────────────────────────────────────────────────

    def _draw_chrome(self, sw, sh):
        if self.config.get('videocall_ui', False):
            self._draw_wechat_chrome(sw, sh)
        else:
            self._draw_normal_chrome(sw, sh)

    # ── normal chrome ─────────────────────────────────────────────────────────

    def _draw_normal_chrome(self, sw, sh):
        c, cx, cy = self.canvas, self.cx, self.cy
        pcy = self.photo_cy

        em = tk.Button(self.win, text='緊急退出 [ESC]', font=(FONT, 9),
                       fg='#2a2a2a', bg=BG, activeforeground='#ff7070',
                       activebackground=BG, relief='flat', padx=6, pady=3,
                       cursor='hand2', bd=0, command=self._emergency)
        c.create_window(14, 14, window=em, anchor='nw')
        c.create_text(sw - 16, 16, anchor='ne', text=self.key,
                      font=(FONT, 11), fill='#2a2a2a')
        c.create_text(cx, pcy + 150, text='點 擊 她 → 打 開 聊 天  💬',
                      font=(FONT, 10), fill='#252525', anchor='center')

        # Progress arc — shown once break starts (extent updated in _tick)
        r = 160
        self._arc_id = c.create_arc(
            cx - r, pcy - r, cx + r, pcy + r,
            start=90, extent=0, outline=PINK, width=3, style='arc',
        )

        # Text card
        card_y = cy + 42
        c.create_rectangle(cx - 255, card_y - 8, cx + 255, card_y + 196,
                           fill='#0f0f18', outline='#1c1c2e', width=1)
        msg = self.config.get('custom_message', '寶貝說：該休息了 ❤️')
        c.create_text(cx, card_y + 22, text=msg,
                      font=(FONT, 22, 'bold'), fill=WHITE, anchor='center')
        brk = self.config.get('break_minutes', 5)
        self.sub_id = c.create_text(cx, card_y + 60,
                                    text=f'休息 {brk} 分鐘後繼續',
                                    font=(FONT, 12), fill='#50506a',
                                    anchor='center')
        self.cd_id = c.create_text(cx, card_y + 122,
                                   text=self._fmt(self.countdown_val),
                                   font=('Consolas', 52, 'bold'), fill=WHITE,
                                   anchor='center')
        c.create_text(cx, card_y + 162, text='休 息 倒 計 時',
                      font=(FONT, 10), fill='#2e2e48', anchor='center')

        self.btn = tk.Button(
            self.win, text='好的，我去休息了  ❤️',
            font=(FONT, 15, 'bold'), fg=WHITE, bg=PURPLE,
            activeforeground=WHITE, activebackground='#a020f0',
            relief='flat', padx=28, pady=12, cursor='hand2', bd=0,
            command=self._break_click)
        c.create_window(cx, card_y + 234, window=self.btn, anchor='center')

    # ── WeChat chrome ─────────────────────────────────────────────────────────

    def _draw_wechat_chrome(self, sw, sh):
        c, cx, cy = self.canvas, self.cx, self.cy

        # Status bar
        SB = 28
        c.create_rectangle(0, 0, sw, SB, fill='#000', outline='')
        c.create_text(16, SB // 2, text='中國移動', anchor='w',
                      font=(FONT, 9), fill='#ccc')
        c.create_text(cx, SB // 2,
                      text=datetime.datetime.now().strftime('%H:%M'),
                      anchor='center', font=('Consolas', 10), fill='#ccc')
        c.create_text(sw - 14, SB // 2, text='▊▊▊ 🔋',
                      anchor='e', font=(FONT, 9), fill='#ccc')

        # Call top bar
        BAR_TOP, BAR_H = SB, 52
        c.create_rectangle(0, BAR_TOP, sw, BAR_TOP + BAR_H, fill=WECHAT, outline='')
        c.create_text(24, BAR_TOP + BAR_H // 2, text='←', anchor='w',
                      font=(FONT, 16), fill=WHITE)
        name = self.config.get('contact_name', '寶貝')
        c.create_text(cx, BAR_TOP + BAR_H // 2,
                      text=f'{name}  视频通话中',
                      anchor='center', font=(FONT, 14, 'bold'), fill=WHITE)
        self._call_elapsed = 0
        self.call_timer_id = c.create_text(sw - 20, BAR_TOP + BAR_H // 2,
                                           text='00:00', anchor='e',
                                           font=('Consolas', 13), fill=WHITE)
        self._tick_call_timer()

        # Video frame
        VW, VH = 320, 420
        vx = cx - VW // 2
        vy = BAR_TOP + BAR_H + 20
        c.create_rectangle(vx + 5, vy + 5, vx + VW + 5, vy + VH + 5,
                           fill='#000', outline='')
        c.create_rectangle(vx - 3, vy - 3, vx + VW + 3, vy + VH + 3,
                           fill='', outline=WECHAT, width=3)
        c.create_rectangle(vx, vy, vx + VW, vy + VH,
                           fill='#111122', outline='')
        self.photo_cy = vy + VH // 2
        c.create_text(cx, vy + VH - 14,
                      text='點擊畫面 → 打開聊天  💬',
                      anchor='center', font=(FONT, 9), fill='#2e2e52')

        # Self-view thumbnail
        THUMB = 72
        tx, ty = vx + VW - THUMB - 10, vy + 10
        c.create_rectangle(tx, ty, tx + THUMB, ty + THUMB,
                           fill='#0a0a1a', outline='#2a2a4a', width=1)
        c.create_text(tx + THUMB // 2, ty + THUMB // 2,
                      text='你', font=(FONT, 18), fill='#303055')

        # Message below frame
        msg_y = vy + VH + 22
        msg = self.config.get('custom_message', '寶貝說：該休息了 ❤️')
        self.sub_id = c.create_text(cx, msg_y, text=msg,
                                    font=(FONT, 14, 'bold'), fill=WHITE,
                                    anchor='center')
        self.cd_id = c.create_text(cx, msg_y + 40,
                                   text=self._fmt(self.countdown_val),
                                   font=('Consolas', 34, 'bold'), fill=WHITE,
                                   anchor='center')

        # Emergency exit
        em = tk.Button(self.win, text='[ESC] 緊急退出', font=(FONT, 9),
                       fg='#2d2d2d', bg='#000', activeforeground='#ff7070',
                       activebackground='#000', relief='flat', padx=6, pady=3,
                       cursor='hand2', bd=0, command=self._emergency)
        c.create_window(14, BAR_TOP + BAR_H + 10, window=em, anchor='nw')

        # Action buttons row
        btn_y = sh - 58
        _mk_icon_btn(self.win, c, cx - 110, btn_y, '🔇', '#2a2a2a', self._noop)
        self.btn = tk.Button(
            self.win, text='📵  掛斷休息',
            font=(FONT, 14, 'bold'), fg=WHITE, bg='#fa5151',
            activeforeground=WHITE, activebackground='#c03030',
            relief='flat', padx=24, pady=12, cursor='hand2', bd=0,
            command=self._break_click)
        c.create_window(cx, btn_y, window=self.btn, anchor='center')
        _mk_icon_btn(self.win, c, cx + 110, btn_y, '📷', '#2a2a2a', self._noop)

    def _tick_call_timer(self):
        if not self.win or not hasattr(self, 'call_timer_id'):
            return
        self._call_elapsed += 1
        self.canvas.itemconfig(self.call_timer_id, text=self._fmt(self._call_elapsed))
        self.win.after(1000, self._tick_call_timer)

    def _noop(self):
        pass

    # ── interactions ──────────────────────────────────────────────────────────

    def _click(self, event):
        if abs(event.x - self.cx) < 150 and abs(event.y - self.photo_cy) < 150:
            self._open_chat()

    def _open_chat(self):
        cmd = self.config.get('chat_command', '').strip()
        if cmd:
            try:
                subprocess.Popen(cmd, shell=True)
                return
            except Exception as e:
                print(f'[chat] custom command: {e}')
        hwnd = self._find_wechat_hwnd()
        if hwnd:
            self._force_foreground(hwnd)
        else:
            for path in [
                r'C:\Program Files\Tencent\WeChat\WeChat.exe',
                r'C:\Program Files (x86)\Tencent\WeChat\WeChat.exe',
            ]:
                if os.path.exists(path):
                    subprocess.Popen([path])
                    break

    def _find_wechat_hwnd(self) -> int | None:
        hwnd = ctypes.windll.user32.FindWindowW(None, '微信')
        if hwnd:
            return hwnd
        for cls in ['WeChatMainWndForPC', 'ChatWnd', 'WeUIDialog']:
            hwnd = ctypes.windll.user32.FindWindowW(cls, None)
            if hwnd:
                return hwnd
        found: list[int] = []
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_size_t, ctypes.c_size_t)
        def _cb(hwnd, _):
            buf = ctypes.create_unicode_buffer(512)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, 512)
            if '微信' in buf.value or 'WeChat' in buf.value:
                found.append(hwnd)
            return True
        ctypes.windll.user32.EnumWindows(WNDENUMPROC(_cb), 0)
        return found[0] if found else None

    def _force_foreground(self, hwnd: int):
        try:
            wechat_tid = ctypes.windll.user32.GetWindowThreadProcessId(hwnd, None)
            our_tid    = ctypes.windll.kernel32.GetCurrentThreadId()
            ctypes.windll.user32.AllowSetForegroundWindow(-1)
            ctypes.windll.user32.AttachThreadInput(our_tid, wechat_tid, True)
            if self.win:
                self.win.attributes('-topmost', False)
            ctypes.windll.user32.ShowWindow(hwnd, 9)
            ctypes.windll.user32.BringWindowToTop(hwnd)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
            ctypes.windll.user32.SetActiveWindow(hwnd)
            ctypes.windll.user32.AttachThreadInput(our_tid, wechat_tid, False)
            if self.win:
                self.win.after(600, self._restore_topmost)
        except Exception as e:
            print(f'[chat] force_foreground: {e}')

    def _restore_topmost(self):
        if self.win:
            self.win.attributes('-topmost', True)

    def _break_click(self):
        if self.break_started:
            return
        self.break_started = True
        self.btn.config(text='休息進行中…', state='disabled',
                        bg='#333333', activebackground='#333333')
        if self.sub_id:
            self.canvas.itemconfig(self.sub_id, text='好好休息  ❤️')
        self.on_break_start(self.key)
        self._tick()

    def _emergency(self):
        self.hide()
        self.on_break_end()

    # ── countdown + progress arc ──────────────────────────────────────────────

    def _tick(self):
        if not self.win:
            return
        if self.cd_id:
            self.canvas.itemconfig(self.cd_id, text=self._fmt(self.countdown_val))
        if self._arc_id and self._total_break > 0:
            frac = self.countdown_val / self._total_break
            self.canvas.itemconfig(self._arc_id, extent=-360.0 * frac)
        if self.countdown_val > 0:
            self.countdown_val -= 1
            self._cd_job = self.win.after(1000, self._tick)
        else:
            self.hide()
            self.on_break_end()

    @staticmethod
    def _fmt(s: int) -> str:
        s = max(0, int(s))
        return f'{s // 60:02d}:{s % 60:02d}'


# ── helpers ───────────────────────────────────────────────────────────────────

def _mk_icon_btn(win, canvas, x, y, emoji, bg, cmd):
    b = tk.Button(win, text=emoji, font=('Segoe UI Emoji', 20),
                  fg=WHITE, bg=bg, activeforeground=WHITE,
                  activebackground='#555', relief='flat',
                  padx=10, pady=8, cursor='hand2', bd=0, command=cmd)
    canvas.create_window(x, y, window=b, anchor='center')
    return b
