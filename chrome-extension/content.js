/**
 * Girlfriend Gatekeeper — content script
 * Two UI modes:
 *   real person → WeChat video-call full-screen (default)
 *   anime / animal PNG with alpha → floating character + speech bubble
 * db.js no longer needed; media loaded from chrome.storage.local.
 */

(function () {
  'use strict';
  if (window.__gfgk_loaded) return;
  window.__gfgk_loaded = true;

  let overlayEl        = null;
  let countdownInterval = null;
  let callTimerInterval = null;
  let bgmAudio         = null;
  let videoEl          = null;
  let objectURLs       = [];
  let callSecs         = 0;

  // ── message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'show_overlay' && !overlayEl) showOverlay(msg);
  });

  // ── build overlay ─────────────────────────────────────────────────────────

  async function showOverlay({ host, breakMinutes, photoB64, message, callerName, hasVideo, hasBgm, animeMode }) {
    const shadow = createShadowHost();
    const root   = shadow.shadowRoot;

    const style = document.createElement('style');
    style.textContent = getStyles();
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'gfgk-wrap';
    root.appendChild(wrap);
    overlayEl = wrap;

    if (animeMode) {
      await buildAnimeUI(wrap, host, breakMinutes, message, photoB64, hasBgm);
    } else {
      await buildRealUI(wrap, host, breakMinutes, message, callerName ?? '宝贝', photoB64, hasVideo, hasBgm);
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
      wrap.classList.add('gfgk-entered');
    }));
    document.addEventListener('keydown', onKeydown);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODE A — Real person: WeChat video-call UI
  // ══════════════════════════════════════════════════════════════════════════

  async function buildRealUI(wrap, host, breakMinutes, message, callerName, photoB64, hasVideo, hasBgm) {
    const mediaBg = document.createElement('div');
    mediaBg.className = 'gfgk-media-bg';
    wrap.appendChild(mediaBg);
    await loadMedia(mediaBg, photoB64, hasVideo, hasBgm);

    const gradTop = document.createElement('div'); gradTop.className = 'gfgk-grad-top'; wrap.appendChild(gradTop);
    const gradBot = document.createElement('div'); gradBot.className = 'gfgk-grad-bot'; wrap.appendChild(gradBot);

    wrap.appendChild(buildTopBar(callerName));

    const msgEl = document.createElement('div');
    msgEl.className = 'gfgk-subtitle';
    msgEl.textContent = message ?? '宝贝说：该休息了 ❤️';
    wrap.appendChild(msgEl);

    wrap.appendChild(buildBottomBar(host, breakMinutes));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODE B — Anime / animal: floating character + speech bubble
  // ══════════════════════════════════════════════════════════════════════════

  async function buildAnimeUI(wrap, host, breakMinutes, message, photoB64, hasBgm) {
    wrap.classList.add('gfgk-anime');

    // Dark radial background
    const bg = document.createElement('div');
    bg.className = 'gfgk-anime-bg';
    wrap.appendChild(bg);

    // Load BGM if any
    if (hasBgm) await loadBgmOnly();

    // Character image
    const { cfg } = await chrome.storage.local.get('cfg').catch(() => ({ cfg: null }));
    const src = cfg?.photoB64 ?? photoB64;
    if (src) {
      const char = document.createElement('img');
      char.className = 'gfgk-char';
      char.src = src;
      wrap.appendChild(char);
    } else {
      const em = document.createElement('div');
      em.className = 'gfgk-char-emoji';
      em.textContent = '🐱';
      wrap.appendChild(em);
    }

    // Speech bubble
    const bubble = document.createElement('div');
    bubble.className = 'gfgk-bubble';
    bubble.textContent = message ?? '该休息啦！❤️';
    wrap.appendChild(bubble);

    // Countdown + buttons card
    const card = document.createElement('div');
    card.className = 'gfgk-anime-card';

    const cdHint = document.createElement('div');
    cdHint.className = 'gfgk-cd-hint';
    cdHint.textContent = `休息 ${breakMinutes} 分钟后恢复`;
    card.appendChild(cdHint);

    let remaining = breakMinutes * 60;
    const cdEl = document.createElement('div');
    cdEl.className = 'gfgk-cd';
    cdEl.textContent = fmt(remaining);
    card.appendChild(cdEl);

    countdownInterval = setInterval(() => {
      remaining--;
      cdEl.textContent = fmt(remaining);
      if (remaining <= 0) endBreak(host, breakMinutes);
    }, 1000);

    const btnRow = document.createElement('div');
    btnRow.className = 'gfgk-actions';
    btnRow.appendChild(makeActionBtn('📵', '去休息',  'gfgk-act-btn gfgk-end-btn', () => endBreak(host, breakMinutes)));
    btnRow.appendChild(makeActionBtn('✕',  '紧急退出','gfgk-act-btn gfgk-esc-btn', removeOverlay));
    card.appendChild(btnRow);

    const esc = document.createElement('div');
    esc.className = 'gfgk-cd-hint';
    esc.textContent = 'ESC 紧急退出';
    card.appendChild(esc);

    wrap.appendChild(card);
  }

  // ── media loading ─────────────────────────────────────────────────────────

  async function loadMedia(container, photoB64, hasVideo, hasBgm) {
    const { cfg } = await chrome.storage.local.get('cfg').catch(() => ({ cfg: null }));

    if (hasVideo && cfg?.videoDataUrl) {
      videoEl = document.createElement('video');
      videoEl.className = 'gfgk-media';
      videoEl.autoplay = true; videoEl.loop = true; videoEl.playsInline = true;
      videoEl.src = cfg.videoDataUrl;
      container.appendChild(videoEl);
      videoEl.play().catch(() => {});
      return;
    }

    const photo = cfg?.photoB64 ?? photoB64;
    if (photo) {
      const img = document.createElement('img');
      img.className = 'gfgk-media';
      img.src = photo;
      container.appendChild(img);
    } else {
      const em = document.createElement('div');
      em.className = 'gfgk-emoji-bg';
      em.textContent = '❤️';
      container.appendChild(em);
    }

    if (hasBgm) await loadBgmOnly(cfg);
  }

  async function loadBgmOnly(cfg) {
    try {
      const c = cfg ?? (await chrome.storage.local.get('cfg').catch(() => ({ cfg: null }))).cfg;
      if (c?.bgmDataUrl) {
        bgmAudio = document.createElement('audio');
        bgmAudio.loop = true;
        bgmAudio.src = c.bgmDataUrl;
        bgmAudio.play().catch(() => {});
      }
    } catch (_) {}
  }

  // ── top bar (real mode) ───────────────────────────────────────────────────

  function buildTopBar(callerName) {
    const bar = document.createElement('div');
    bar.className = 'gfgk-top-bar';

    const back = document.createElement('span');
    back.className = 'gfgk-back-btn';
    back.textContent = '‹';
    bar.appendChild(back);

    const mid = document.createElement('div');
    mid.className = 'gfgk-top-mid';

    const name = document.createElement('div');
    name.className = 'gfgk-caller-name';
    name.textContent = callerName;
    mid.appendChild(name);

    const status = document.createElement('div');
    status.className = 'gfgk-call-status-txt';
    status.textContent = '视频通话中';
    mid.appendChild(status);

    bar.appendChild(mid);

    const timerEl = document.createElement('span');
    timerEl.className = 'gfgk-call-timer';
    timerEl.textContent = '00:00';
    bar.appendChild(timerEl);

    callTimerInterval = setInterval(() => {
      callSecs++;
      timerEl.textContent = fmt(callSecs);
    }, 1000);

    return bar;
  }

  // ── bottom bar (real mode) ────────────────────────────────────────────────

  function buildBottomBar(host, breakMinutes) {
    const bar = document.createElement('div');
    bar.className = 'gfgk-bottom-bar';

    const cdWrap = document.createElement('div');
    cdWrap.className = 'gfgk-cd-wrap';

    const cdHint = document.createElement('div');
    cdHint.className = 'gfgk-cd-hint';
    cdHint.textContent = `休息 ${breakMinutes} 分钟后恢复`;
    cdWrap.appendChild(cdHint);

    let remaining = breakMinutes * 60;
    const cdEl = document.createElement('div');
    cdEl.className = 'gfgk-cd';
    cdEl.textContent = fmt(remaining);
    cdWrap.appendChild(cdEl);

    countdownInterval = setInterval(() => {
      remaining--;
      cdEl.textContent = fmt(remaining);
      if (remaining <= 0) endBreak(host, breakMinutes);
    }, 1000);

    bar.appendChild(cdWrap);

    const actions = document.createElement('div');
    actions.className = 'gfgk-actions';

    // Mute button — toggles overlay media + all page audio/video
    let muted = false;
    const muteWrap = document.createElement('div');
    muteWrap.className = 'gfgk-act-wrap';
    const muteBtn = document.createElement('button');
    muteBtn.className = 'gfgk-act-btn';
    muteBtn.textContent = '🎤';
    const muteLbl = document.createElement('span');
    muteLbl.className = 'gfgk-act-lbl';
    muteLbl.textContent = '静音';
    muteBtn.onclick = () => {
      muted = !muted;
      if (videoEl)  videoEl.muted  = muted;
      if (bgmAudio) bgmAudio.muted = muted;
      document.querySelectorAll('video, audio').forEach(el => { el.muted = muted; });
      muteBtn.textContent = muted ? '🔇' : '🎤';
      muteLbl.textContent = muted ? '已静音' : '静音';
      muteBtn.style.background = muted ? 'rgba(255,80,80,0.35)' : '';
    };
    muteWrap.appendChild(muteBtn);
    muteWrap.appendChild(muteLbl);
    actions.appendChild(muteWrap);

    actions.appendChild(makeActionBtn('📵', '去休息',  'gfgk-act-btn gfgk-end-btn', () => endBreak(host, breakMinutes)));
    actions.appendChild(makeActionBtn('✕',  '紧急退出','gfgk-act-btn gfgk-esc-btn', removeOverlay));

    bar.appendChild(actions);
    return bar;
  }

  function makeActionBtn(icon, label, cls, handler) {
    const wrap = document.createElement('div');
    wrap.className = 'gfgk-act-wrap';
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = icon;
    if (handler) btn.onclick = handler;
    wrap.appendChild(btn);
    const lbl = document.createElement('span');
    lbl.className = 'gfgk-act-lbl';
    lbl.textContent = label;
    wrap.appendChild(lbl);
    return wrap;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  function onKeydown(e) { if (e.key === 'Escape') removeOverlay(); }

  function endBreak(host, breakMinutes) {
    chrome.runtime.sendMessage({ type: 'start_break', host, breakMinutes });
    removeOverlay();
  }

  function removeOverlay() {
    clearInterval(countdownInterval);
    clearInterval(callTimerInterval);
    callSecs = 0;
    document.removeEventListener('keydown', onKeydown);
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; }
    if (videoEl)  { videoEl.pause();  videoEl  = null; }
    objectURLs.forEach(u => URL.revokeObjectURL(u));
    objectURLs = [];
    document.querySelectorAll('video, audio').forEach(el => { el.muted = false; });
    const host = document.getElementById('__gfgk_shadow_host__');
    if (host) host.remove();
    overlayEl = null;
  }

  function createShadowHost() {
    const host = document.createElement('div');
    host.id = '__gfgk_shadow_host__';
    Object.assign(host.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '2147483647', pointerEvents: 'all',
    });
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
    return host;
  }

  function fmt(sec) {
    const s = Math.abs(sec);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ── styles ────────────────────────────────────────────────────────────────

  function getStyles() { return `
    .gfgk-wrap {
      position: fixed; inset: 0; overflow: hidden;
      font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      opacity: 0; transition: opacity 0.4s ease;
    }
    .gfgk-wrap.gfgk-entered { opacity: 1; }

    /* ══ REAL-PERSON MODE ══ */

    .gfgk-media-bg {
      position: absolute; inset: 0; background: #060610; overflow: hidden;
    }
    .gfgk-media {
      width: 100%; height: 100%; object-fit: cover; display: block;
      filter: brightness(0.72) saturate(1.1);
    }
    .gfgk-emoji-bg {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 200px;
      background: radial-gradient(ellipse at 50% 42%, #1a0a2e 0%, #04020d 100%);
    }
    .gfgk-grad-top {
      position: absolute; top: 0; left: 0; right: 0; height: 220px;
      background: linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%);
      pointer-events: none; z-index: 1;
    }
    .gfgk-grad-bot {
      position: absolute; bottom: 0; left: 0; right: 0; height: 340px;
      background: linear-gradient(to top, rgba(0,0,0,0.90) 0%, transparent 100%);
      pointer-events: none; z-index: 1;
    }
    .gfgk-top-bar {
      position: absolute; top: 0; left: 0; right: 0; height: 80px;
      display: flex; align-items: center; padding: 20px 20px 0; gap: 8px;
      z-index: 10;
    }
    .gfgk-back-btn {
      font-size: 38px; color: rgba(255,255,255,0.9); line-height: 1;
      cursor: default; flex-shrink: 0;
      text-shadow: 0 1px 5px rgba(0,0,0,0.5);
    }
    .gfgk-top-mid {
      flex: 1; display: flex; flex-direction: column; align-items: center;
    }
    .gfgk-caller-name {
      font-size: 18px; font-weight: 600; color: #fff;
      text-shadow: 0 1px 6px rgba(0,0,0,0.55);
    }
    .gfgk-call-status-txt {
      font-size: 12px; color: rgba(255,255,255,0.58); margin-top: 2px;
    }
    .gfgk-call-timer {
      font-size: 14px; color: rgba(255,255,255,0.72); flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .gfgk-subtitle {
      position: absolute; left: 0; right: 0; bottom: 268px;
      text-align: center; z-index: 10; pointer-events: none;
      font-size: 18px; font-weight: 500; color: #fff;
      padding: 0 48px;
      text-shadow: 0 2px 12px rgba(0,0,0,0.75);
    }
    .gfgk-bottom-bar {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; flex-direction: column; align-items: center;
      padding: 0 0 38px; gap: 18px; z-index: 10;
    }
    .gfgk-cd-wrap {
      display: flex; flex-direction: column; align-items: center; gap: 3px;
    }

    /* ══ ANIME / ANIMAL MODE ══ */

    .gfgk-anime { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
    .gfgk-anime-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 60%, #0d0622 0%, #020208 100%);
    }
    .gfgk-char {
      position: absolute;
      max-height: 72vh; max-width: 60vw;
      object-fit: contain;
      bottom: 180px; left: 50%; transform: translateX(-50%);
      filter: drop-shadow(0 0 40px rgba(180,100,255,0.35))
              drop-shadow(0 20px 60px rgba(0,0,0,0.7));
      z-index: 2;
      animation: gfgk-float 4s ease-in-out infinite;
    }
    .gfgk-char-emoji {
      position: absolute; bottom: 180px; left: 50%; transform: translateX(-50%);
      font-size: 160px; z-index: 2;
      filter: drop-shadow(0 0 30px rgba(255,180,80,0.5));
      animation: gfgk-float 4s ease-in-out infinite;
    }
    @keyframes gfgk-float {
      0%, 100% { transform: translateX(-50%) translateY(0); }
      50%       { transform: translateX(-50%) translateY(-12px); }
    }
    .gfgk-bubble {
      position: absolute; z-index: 3;
      top: 18px; left: 50%; transform: translateX(-50%);
      background: rgba(255,255,255,0.96);
      color: #1a1a2e; font-size: 16px; font-weight: 600;
      padding: 10px 20px; border-radius: 20px;
      max-width: 72vw; text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    .gfgk-bubble::after {
      content: ''; position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%);
      border: 10px solid transparent; border-top-color: rgba(255,255,255,0.96);
      border-bottom: 0;
    }
    .gfgk-anime-card {
      position: relative; z-index: 10;
      background: rgba(10,8,22,0.92);
      border: 1px solid rgba(180,100,255,0.2);
      border-radius: 20px; padding: 16px 32px 20px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      margin-bottom: 24px;
      backdrop-filter: blur(12px);
      box-shadow: 0 0 40px rgba(140,60,255,0.15);
    }

    /* ══ SHARED ══ */

    .gfgk-cd-hint { font-size: 12px; color: rgba(255,255,255,0.45); }
    .gfgk-cd {
      font-size: 48px; font-weight: 700; color: #fff; line-height: 1;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 2px 16px rgba(0,0,0,0.55);
    }
    .gfgk-actions { display: flex; align-items: flex-end; gap: 44px; }
    .gfgk-act-wrap { display: flex; flex-direction: column; align-items: center; gap: 7px; }
    .gfgk-act-btn {
      width: 62px; height: 62px; border-radius: 50%;
      background: rgba(255,255,255,0.16);
      border: none; cursor: pointer; outline: none;
      font-size: 26px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px);
      transition: background 0.18s, transform 0.14s;
      color: #fff;
    }
    .gfgk-act-btn:hover  { background: rgba(255,255,255,0.26); transform: scale(1.06); }
    .gfgk-act-btn:active { transform: scale(0.95); }
    .gfgk-end-btn {
      width: 72px !important; height: 72px !important; font-size: 30px !important;
      background: #ff3b30 !important;
      box-shadow: 0 4px 28px rgba(255,59,48,0.6);
    }
    .gfgk-end-btn:hover { background: #ff1a0e !important; }
    .gfgk-esc-btn { font-size: 22px !important; color: rgba(255,255,255,0.65); }
    .gfgk-act-lbl { font-size: 11px; color: rgba(255,255,255,0.62); white-space: nowrap; }
  `; }
})();
