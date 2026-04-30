import os
import subprocess
import tkinter as tk
from tkinter import filedialog, messagebox
from PIL import Image, ImageTk

BG    = '#111111'
BG2   = '#1c1c1c'
BG3   = '#242424'
PINK  = '#ff6b9d'
WHITE = '#ffffff'
GRAY  = '#888888'
GREEN = '#07C160'
FONT  = 'Microsoft YaHei'

IMG_TYPES  = [('圖片/GIF/視頻',
               '*.jpg *.jpeg *.png *.webp *.bmp *.gif *.mp4 *.avi *.mov *.mkv'),
              ('所有', '*.*')]
AUDIO_TYPES = [('音頻', '*.mp3 *.wav *.ogg *.m4a *.flac'), ('所有', '*.*')]


class SettingsWindow:
    def __init__(self, parent, config, on_save, on_close, tracker=None):
        self.parent  = parent
        self.config  = dict(config)
        self.on_save = on_save
        self.on_close = on_close
        self.tracker = tracker

        self.win = tk.Toplevel(parent)
        self.win.title('Girlfriend Gatekeeper — 設置')
        self.win.configure(bg=BG)
        self.win.geometry('500x700')
        self.win.resizable(False, True)
        self.win.protocol('WM_DELETE_WINDOW', self._close)
        self._build()

    def focus(self):
        self.win.lift()
        self.win.focus_force()

    # ── layout ───────────────────────────────────────────────────────────────

    def _build(self):
        # Header
        hdr = tk.Frame(self.win, bg='#1a0814', pady=14, padx=20)
        hdr.pack(fill='x')
        tk.Label(hdr, text='Girlfriend Gatekeeper',
                 font=(FONT, 14, 'bold'), bg='#1a0814', fg=WHITE).pack(anchor='w')
        tk.Label(hdr, text='她說：該休息了',
                 font=(FONT, 10), bg='#1a0814', fg='#666666').pack(anchor='w')

        # Scrollable body
        outer = tk.Frame(self.win, bg=BG)
        outer.pack(fill='both', expand=True)
        cv = tk.Canvas(outer, bg=BG, highlightthickness=0)
        sb = tk.Scrollbar(outer, orient='vertical', command=cv.yview)
        self._body = tk.Frame(cv, bg=BG, padx=20, pady=10)
        self._body.bind('<Configure>',
                        lambda e: cv.configure(scrollregion=cv.bbox('all')))
        cv.create_window((0, 0), window=self._body, anchor='nw')
        cv.configure(yscrollcommand=sb.set)
        cv.pack(side='left', fill='both', expand=True)
        sb.pack(side='right', fill='y')
        cv.bind('<MouseWheel>',
                lambda e: cv.yview_scroll(-1 * (e.delta // 120), 'units'))

        self._fill_form()

        # Footer
        foot = tk.Frame(self.win, bg='#0a0a0a', pady=12, padx=20)
        foot.pack(fill='x')
        tk.Button(foot, text='保存', font=(FONT, 12, 'bold'),
                  fg=WHITE, bg=PINK, activeforeground=WHITE,
                  activebackground='#e05585', relief='flat',
                  padx=22, pady=7, cursor='hand2',
                  command=self._save).pack(side='right')
        tk.Button(foot, text='取消', font=(FONT, 11),
                  fg=GRAY, bg=BG2, activeforeground=WHITE,
                  activebackground='#333', relief='flat',
                  padx=18, pady=7, cursor='hand2',
                  command=self._close).pack(side='right', padx=8)

    # ── section helpers ───────────────────────────────────────────────────────

    def _sec(self, title):
        tk.Label(self._body, text=title, font=(FONT, 9, 'bold'),
                 bg=BG, fg='#555555').pack(anchor='w', pady=(18, 5))
        tk.Frame(self._body, bg='#252525', height=1).pack(fill='x', pady=(0, 10))

    def _lbl(self, text, fg=GRAY, size=10):
        return tk.Label(self._body, text=text, font=(FONT, size),
                        bg=BG, fg=fg, anchor='w')

    def _entry(self, var, width=40, parent=None):
        p = parent or self._body
        e = tk.Entry(p, textvariable=var, width=width,
                     bg=BG2, fg=WHITE, insertbackground=WHITE,
                     relief='solid', bd=1, font=(FONT, 11),
                     highlightthickness=1,
                     highlightcolor=PINK, highlightbackground='#333')
        e.pack(fill='x', ipady=6, ipadx=8, pady=(4, 0))
        return e

    # ── form ─────────────────────────────────────────────────────────────────

    def _fill_form(self):
        self._fill_media()
        self._fill_timing()
        self._fill_message()
        self._fill_audio()
        self._fill_chat()
        self._fill_ui_mode()
        self._fill_keywords()
        self._fill_stats()

    # 1 ── Media list ──────────────────────────────────────────────────────────

    def _fill_media(self):
        self._sec('📷  媒體（照片 / GIF / 視頻）—— 多個自動輪換')

        # Listbox
        lb_frame = tk.Frame(self._body, bg=BG2)
        lb_frame.pack(fill='x')
        self.media_lb = tk.Listbox(lb_frame, height=5, bg=BG2, fg=WHITE,
                                    selectbackground='#333', selectforeground=WHITE,
                                    relief='flat', bd=0, font=(FONT, 10),
                                    activestyle='none')
        self.media_lb.pack(fill='x', padx=8, pady=6)
        for p in self.config.get('media_list', []):
            self.media_lb.insert('end', os.path.basename(p))
        self._media_paths = list(self.config.get('media_list', []))

        # Buttons
        btn_row = tk.Frame(self._body, bg=BG)
        btn_row.pack(fill='x', pady=(6, 0))
        for txt, cmd in [('添加', self._add_media),
                         ('刪除', self._del_media),
                         ('上移', lambda: self._move_media(-1)),
                         ('下移', lambda: self._move_media(1))]:
            tk.Button(btn_row, text=txt, font=(FONT, 10),
                      fg=WHITE, bg=BG3, activeforeground=WHITE,
                      activebackground='#333', relief='flat',
                      padx=10, pady=4, cursor='hand2', command=cmd
                      ).pack(side='left', padx=(0, 6))

        # Switch interval
        row = tk.Frame(self._body, bg=BG)
        row.pack(fill='x', pady=(8, 0))
        tk.Label(row, text='輪換間隔（秒）', font=(FONT, 11),
                 bg=BG, fg=WHITE).pack(side='left')
        self.switch_var = tk.StringVar(value=str(self.config.get('media_switch_seconds', 8)))
        tk.Entry(row, textvariable=self.switch_var, width=6,
                 bg=BG2, fg=WHITE, insertbackground=WHITE,
                 relief='solid', bd=1, font=(FONT, 11)).pack(side='left', padx=8,
                                                               ipady=4, ipadx=6)

        # Photo style
        self.style_var = tk.StringVar(value=self.config.get('photo_style', 'circle'))
        sr = tk.Frame(self._body, bg=BG)
        sr.pack(fill='x', pady=(8, 0))
        tk.Label(sr, text='顯示形狀：', font=(FONT, 11),
                 bg=BG, fg=WHITE).pack(side='left')
        for val, lbl in [('circle', '圓形'), ('square', '方形')]:
            tk.Radiobutton(sr, text=lbl, variable=self.style_var, value=val,
                           bg=BG, fg=WHITE, activebackground=BG,
                           selectcolor=BG2, font=(FONT, 10)).pack(side='left', padx=6)

    def _add_media(self):
        paths = filedialog.askopenfilenames(
            title='選擇媒體（可多選）', parent=self.win,
            filetypes=IMG_TYPES)
        for p in paths:
            if p not in self._media_paths:
                self._media_paths.append(p)
                self.media_lb.insert('end', os.path.basename(p))

    def _del_media(self):
        for i in reversed(self.media_lb.curselection()):
            self.media_lb.delete(i)
            del self._media_paths[i]

    def _move_media(self, direction: int):
        sel = self.media_lb.curselection()
        if not sel:
            return
        i = sel[0]
        j = i + direction
        if j < 0 or j >= len(self._media_paths):
            return
        # Swap
        self._media_paths[i], self._media_paths[j] = self._media_paths[j], self._media_paths[i]
        items = list(self.media_lb.get(0, 'end'))
        items[i], items[j] = items[j], items[i]
        self.media_lb.delete(0, 'end')
        for it in items:
            self.media_lb.insert('end', it)
        self.media_lb.selection_set(j)

    # 2 ── Timing ──────────────────────────────────────────────────────────────

    def _fill_timing(self):
        self._sec('⏱  時間設置')
        for label, attr in [('每站時限（分鐘）', 'time_limit_minutes'),
                             ('休息時長（分鐘）', 'break_minutes')]:
            row = tk.Frame(self._body, bg=BG)
            row.pack(fill='x', pady=3)
            tk.Label(row, text=label, font=(FONT, 11), bg=BG, fg=WHITE,
                     width=18, anchor='w').pack(side='left')
            var = tk.StringVar(value=str(self.config.get(attr, 15 if 'limit' in attr else 5)))
            setattr(self, f'_{attr}_var', var)
            tk.Entry(row, textvariable=var, width=6, bg=BG2, fg=WHITE,
                     insertbackground=WHITE, relief='solid', bd=1,
                     font=(FONT, 11)).pack(side='left', ipady=5, ipadx=6)

    # 3 ── Message ─────────────────────────────────────────────────────────────

    def _fill_message(self):
        self._sec('💬  顯示文字')
        self.msg_var = tk.StringVar(
            value=self.config.get('custom_message', '寶貝說：該休息了 ❤️'))
        self._lbl('她說的話').pack(anchor='w')
        self._entry(self.msg_var)

    # 4 ── Audio (BGM) ─────────────────────────────────────────────────────────

    def _fill_audio(self):
        self._sec('🎵  BGM / 她的聲音')

        self.bgm_var = tk.StringVar(value=self.config.get('bgm_path', ''))
        row = tk.Frame(self._body, bg=BG)
        row.pack(fill='x')
        self._bgm_lbl = tk.Label(row,
                                  text=self._short(self.bgm_var.get()) or '未選擇',
                                  font=(FONT, 10), bg=BG,
                                  fg=WHITE if self.bgm_var.get() else GRAY,
                                  anchor='w', width=32)
        self._bgm_lbl.pack(side='left')

        btn_row = tk.Frame(self._body, bg=BG)
        btn_row.pack(fill='x', pady=(6, 0))
        tk.Button(btn_row, text='選擇音頻', font=(FONT, 10),
                  fg=WHITE, bg=BG3, activeforeground=WHITE,
                  activebackground='#333', relief='flat',
                  padx=12, pady=4, cursor='hand2',
                  command=self._pick_bgm).pack(side='left')
        tk.Button(btn_row, text='清除', font=(FONT, 10),
                  fg='#ff7070', bg=BG3, activeforeground='#ff7070',
                  activebackground='#333', relief='flat',
                  padx=10, pady=4, cursor='hand2',
                  command=self._clear_bgm).pack(side='left', padx=6)
        tk.Button(btn_row, text='試聽', font=(FONT, 10),
                  fg=WHITE, bg=BG3, activeforeground=WHITE,
                  activebackground='#333', relief='flat',
                  padx=10, pady=4, cursor='hand2',
                  command=self._preview_bgm).pack(side='left')

        self._lbl('支持 MP3 / WAV / OGG / M4A。循環播放直到休息結束。', '#555555', 9).pack(anchor='w', pady=(4, 0))

    def _pick_bgm(self):
        p = filedialog.askopenfilename(
            title='選擇BGM', parent=self.win, filetypes=AUDIO_TYPES)
        if p:
            self.bgm_var.set(p)
            self._bgm_lbl.config(text=self._short(p), fg=WHITE)

    def _clear_bgm(self):
        self.bgm_var.set('')
        self._bgm_lbl.config(text='未選擇', fg=GRAY)

    def _preview_bgm(self):
        p = self.bgm_var.get()
        if not p or not os.path.exists(p):
            return
        try:
            import pygame.mixer as pm
            pm.music.load(p)
            pm.music.play(0)
        except Exception as e:
            messagebox.showinfo('試聽', f'無法播放：{e}', parent=self.win)

    # 5 ── Chat ────────────────────────────────────────────────────────────────

    def _fill_chat(self):
        self._sec('💬  點擊照片 → 打開聊天')

        self._lbl('自定義啟動命令（留空 = 自動喚起微信）').pack(anchor='w')
        self.chat_var = tk.StringVar(value=self.config.get('chat_command', ''))
        self._entry(self.chat_var)

        btn_row = tk.Frame(self._body, bg=BG)
        btn_row.pack(fill='x', pady=(8, 0))
        tk.Button(btn_row, text='測試', font=(FONT, 10),
                  fg=WHITE, bg=BG3, activeforeground=WHITE,
                  activebackground='#333', relief='flat',
                  padx=12, pady=4, cursor='hand2',
                  command=self._test_chat).pack(side='left')
        self._lbl('例：weixin://  或填微信exe路徑', '#555555', 9).pack(anchor='w', pady=(4, 0))

    def _test_chat(self):
        cmd = self.chat_var.get().strip()
        if cmd:
            try:
                subprocess.Popen(cmd, shell=True)
            except Exception as e:
                messagebox.showerror('錯誤', str(e), parent=self.win)
        else:
            messagebox.showinfo('提示', '留空時將自動查找並前置微信窗口', parent=self.win)

    # 6 ── UI mode ─────────────────────────────────────────────────────────────

    def _fill_ui_mode(self):
        self._sec('🎨  覆蓋層樣式')

        self.vc_var = tk.BooleanVar(value=self.config.get('videocall_ui', False))
        row = tk.Frame(self._body, bg=BG)
        row.pack(fill='x')
        tk.Checkbutton(row, text='微信視頻通話風格（綠色頂欄 + 通話計時）',
                       variable=self.vc_var, font=(FONT, 11),
                       bg=BG, fg=WHITE, activebackground=BG,
                       selectcolor=BG2).pack(side='left')

        name_row = tk.Frame(self._body, bg=BG)
        name_row.pack(fill='x', pady=(8, 0))
        tk.Label(name_row, text='通話顯示名稱', font=(FONT, 11),
                 bg=BG, fg=WHITE).pack(side='left')
        self.cname_var = tk.StringVar(value=self.config.get('contact_name', '寶貝'))
        tk.Entry(name_row, textvariable=self.cname_var, width=16,
                 bg=BG2, fg=WHITE, insertbackground=WHITE,
                 relief='solid', bd=1, font=(FONT, 11)).pack(side='left',
                                                              padx=10, ipady=5, ipadx=6)

    # 7 ── Keywords ────────────────────────────────────────────────────────────

    def _fill_keywords(self):
        self._sec('🔍  監測關鍵詞（窗口標題含此詞則計時）')

        lb_frame = tk.Frame(self._body, bg=BG2)
        lb_frame.pack(fill='x')
        self.kw_lb = tk.Listbox(lb_frame, height=6, bg=BG2, fg=WHITE,
                                 selectbackground='#333', selectforeground=WHITE,
                                 relief='flat', bd=0, font=(FONT, 11),
                                 activestyle='none')
        self.kw_lb.pack(fill='x', padx=8, pady=6)
        for kw in self.config.get('tracked_keywords', []):
            self.kw_lb.insert('end', kw)

        add_row = tk.Frame(self._body, bg=BG)
        add_row.pack(fill='x', pady=(6, 0))
        self.kw_var = tk.StringVar()
        self.kw_entry = tk.Entry(add_row, textvariable=self.kw_var, width=18,
                                  bg='#2a2a2a', fg=WHITE, insertbackground=WHITE,
                                  relief='solid', bd=1, font=(FONT, 11),
                                  highlightthickness=1,
                                  highlightcolor=PINK, highlightbackground='#333')
        self.kw_entry.pack(side='left', ipady=5, ipadx=6)
        self.kw_entry.bind('<Return>', lambda _e: self._add_kw())

        for txt, cmd, fg, bg in [
            ('添加', self._add_kw, WHITE, BG3),
            ('刪除選中', self._del_kw, '#ff7070', '#2a0000'),
        ]:
            tk.Button(add_row, text=txt, font=(FONT, 10),
                      fg=fg, bg=bg, activeforeground=fg,
                      activebackground='#333', relief='flat',
                      padx=10, pady=3, cursor='hand2', command=cmd
                      ).pack(side='left', padx=6)

        self.kw_status = tk.Label(self._body, text='', font=(FONT, 9),
                                   bg=BG, fg=GRAY)
        self.kw_status.pack(anchor='w', pady=(3, 0))

    def _add_kw(self):
        kw = self.kw_var.get().strip()
        if not kw:
            return
        if kw.lower() in [x.lower() for x in self.kw_lb.get(0, 'end')]:
            self._kw_status(f'「{kw}」已存在', '#ff7070')
            return
        self.kw_lb.insert('end', kw)
        self.kw_var.set('')
        self._kw_status(f'✓ 已添加「{kw}」', '#7fff7f')
        self.kw_entry.focus_set()

    def _del_kw(self):
        for i in reversed(self.kw_lb.curselection()):
            self.kw_lb.delete(i)

    def _kw_status(self, msg, color):
        self.kw_status.config(text=msg, fg=color)
        self.win.after(2000, lambda: self.kw_status.config(text=''))

    # 8 ── Stats ───────────────────────────────────────────────────────────────

    def _fill_stats(self):
        self._sec('📊  統計')
        self.stats_frame = tk.Frame(self._body, bg=BG)
        self.stats_frame.pack(fill='x')
        self._refresh_stats()
        self._embed_history_chart()

        btn_row = tk.Frame(self._body, bg=BG)
        btn_row.pack(fill='x', pady=(10, 0))
        tk.Button(btn_row, text='重置所有計時器',
                  font=(FONT, 10), fg='#ff7070', bg='#200000',
                  activeforeground='#ff7070', activebackground='#300000',
                  relief='flat', padx=14, pady=5, cursor='hand2',
                  command=self._reset_all).pack(side='left')
        tk.Button(btn_row, text='開啟網頁面板 ↗',
                  font=(FONT, 10), fg='#7dcfff', bg='#0a1a2a',
                  activeforeground='#7dcfff', activebackground='#0d2035',
                  relief='flat', padx=14, pady=5, cursor='hand2',
                  command=self._open_dashboard).pack(side='left', padx=8)

    def _embed_history_chart(self):
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
            from analytics import top_sites

            data = top_sites(days=7)
            if not data:
                self._lbl('（歷史數據累積後此處顯示圖表）',
                          '#444', 9).pack(anchor='w', pady=(8, 0))
                return

            fig, ax = plt.subplots(figsize=(5, 2.4), dpi=80)
            fig.patch.set_facecolor('#1c1c1c')
            ax.set_facecolor('#1c1c1c')

            keywords = [d['keyword'][:12] for d in data[:6]]
            minutes  = [round(d['total_seconds'] / 60) for d in data[:6]]
            keywords.reverse(); minutes.reverse()

            ax.barh(keywords, minutes, color='#ff6b9d', height=0.55)
            ax.set_xlabel('分鐘（本週）', color='#666', fontsize=8)
            ax.tick_params(colors='#666', labelsize=8)
            for spine in ax.spines.values():
                spine.set_edgecolor('#2a2a2a')
            fig.tight_layout(pad=0.8)

            canvas = FigureCanvasTkAgg(fig, master=self._body)
            canvas.draw()
            canvas.get_tk_widget().pack(fill='x', pady=(10, 0))
            plt.close(fig)

        except ImportError:
            self._lbl('安裝 matplotlib 可查看圖表：pip install matplotlib',
                      '#444', 9).pack(anchor='w', pady=(8, 0))
        except Exception:
            pass

    def _open_dashboard(self):
        try:
            from web.server import open_dashboard
            open_dashboard()
        except Exception:
            pass

    def _refresh_stats(self):
        for w in self.stats_frame.winfo_children():
            w.destroy()
        if not self.tracker:
            tk.Label(self.stats_frame, text='重新打開設置窗口可見最新統計',
                     font=(FONT, 10), bg=BG, fg='#555555').pack(anchor='w')
            return
        import time as _t
        st, be = self.tracker.get_stats()
        limit = self.config.get('time_limit_minutes', 15) * 60
        now = _t.time()
        if not st:
            tk.Label(self.stats_frame, text='今日尚無記錄',
                     font=(FONT, 10), bg=BG, fg='#555555').pack(anchor='w')
            return
        for site, sec in sorted(st.items(), key=lambda x: -x[1]):
            if sec <= 0:
                continue
            on_break = be.get(site, 0) > now
            row = tk.Frame(self.stats_frame, bg=BG2)
            row.pack(fill='x', pady=2)
            color = '#ff6b9d' if sec >= limit else '#666666'
            label = site + ('  🛌' if on_break else '')
            m, s = divmod(sec, 60)
            tk.Label(row, text=f'  {label}',
                     font=(FONT, 11), bg=BG2, fg=WHITE).pack(side='left', pady=4)
            tk.Label(row, text=f'{m}m {s}s{"  ⚠️" if sec >= limit else ""}  ',
                     font=(FONT, 11), bg=BG2, fg=color).pack(side='right', pady=4)

    def _reset_all(self):
        if messagebox.askyesno('確認重置', '確定清零所有計時器？', parent=self.win):
            if self.tracker:
                self.tracker.reset_all()
            self._refresh_stats()

    # ── save / close ──────────────────────────────────────────────────────────

    def _save(self):
        try:
            tl = max(1, int(self._time_limit_minutes_var.get()))
            bm = max(1, int(self._break_minutes_var.get()))
            sw = max(1, int(self.switch_var.get()))
        except ValueError:
            messagebox.showerror('格式錯誤', '時間請填整數', parent=self.win)
            return

        self.config.update({
            'time_limit_minutes':   tl,
            'break_minutes':        bm,
            'media_list':           list(self._media_paths),
            'media_switch_seconds': sw,
            'photo_style':          self.style_var.get(),
            'custom_message':       self.msg_var.get().strip() or '寶貝說：該休息了 ❤️',
            'bgm_path':             self.bgm_var.get(),
            'chat_command':         self.chat_var.get().strip(),
            'videocall_ui':         self.vc_var.get(),
            'contact_name':         self.cname_var.get().strip() or '寶貝',
            'tracked_keywords':     list(self.kw_lb.get(0, 'end')),
        })
        self.on_save(self.config)
        self._close()

    def _close(self):
        self.on_close()
        self.win.destroy()

    # ── helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _short(path: str, max_len: int = 36) -> str:
        name = os.path.basename(path)
        return name if len(name) <= max_len else '…' + name[-max_len+1:]
