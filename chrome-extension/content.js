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

  // Detect transparent PNG at display time — works even if animeMode flag not saved
  function detectAlpha(dataUrl) {
    return new Promise(res => {
      if (!dataUrl || !dataUrl.startsWith('data:image/png')) { res(false); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = Math.min(img.width, 64); cv.height = Math.min(img.height, 64);
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
          let t = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] < 200) t++;
          res(t > cv.width * cv.height * 0.05);
        } catch (_) { res(false); }
      };
      img.onerror = () => res(false);
      img.src = dataUrl;
    });
  }

  async function showOverlay({ host, breakMinutes, photoB64, message, callerName, hasVideo, hasBgm, animeMode }) {
    if (overlayEl) return;
    overlayEl = true; // sentinel: block re-entry during async gap before wrap is assigned

    const { cfg } = await chrome.storage.local.get('cfg').catch(() => ({ cfg: null }));
    const photo = cfg?.photoB64 ?? photoB64;
    const effectiveAnime = !hasVideo && (animeMode || await detectAlpha(photo));

    const shadow = createShadowHost();
    const root   = shadow.shadowRoot;

    const style = document.createElement('style');
    style.textContent = getStyles();
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'gfgk-wrap';
    root.appendChild(wrap);
    overlayEl = wrap;

    if (effectiveAnime) {
      await buildAnimeUI(wrap, host, breakMinutes, message, photo, hasBgm, cfg);
    } else if (hasVideo) {
      await buildRealUI(wrap, host, breakMinutes, message, callerName ?? '宝贝', photoB64, hasVideo, hasBgm);
    } else {
      await buildPhotoUI(wrap, host, breakMinutes, message, callerName ?? '宝贝', photo, hasBgm, cfg);
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
  // MODE B — Photo / GIF: love-notification lock-screen style
  // ══════════════════════════════════════════════════════════════════════════

  async function buildPhotoUI(wrap, host, breakMinutes, message, callerName, photo, hasBgm, cfg) {
    // Blurred full-screen background
    const bgEl = document.createElement('div');
    bgEl.className = 'gfgk-photo-bg';
    if (photo && photo.startsWith('data:image/')) {
      bgEl.style.backgroundImage = `url("${photo}")`;
    }
    wrap.appendChild(bgEl);

    // Dark overlay for readability
    const overlay = document.createElement('div');
    overlay.className = 'gfgk-photo-overlay';
    wrap.appendChild(overlay);

    if (hasBgm) await loadBgmOnly(cfg);

    // Center content
    const center = document.createElement('div');
    center.className = 'gfgk-photo-center';

    // Circular avatar with pulse ring
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'gfgk-avatar-wrap';

    const ring = document.createElement('div');
    ring.className = 'gfgk-avatar-ring';
    avatarWrap.appendChild(ring);

    if (photo) {
      const avatar = document.createElement('img');
      avatar.className = 'gfgk-avatar';
      avatar.src = photo;
      avatarWrap.appendChild(avatar);
    } else {
      const em = document.createElement('div');
      em.className = 'gfgk-avatar-emoji';
      em.textContent = '❤️';
      avatarWrap.appendChild(em);
    }
    center.appendChild(avatarWrap);

    // Caller name
    const nameEl = document.createElement('div');
    nameEl.className = 'gfgk-photo-name';
    nameEl.textContent = callerName;
    center.appendChild(nameEl);

    // Subtitle: "想你了" style hint
    const hintEl = document.createElement('div');
    hintEl.className = 'gfgk-photo-hint';
    hintEl.textContent = '❤️ 给你发来了提醒';
    center.appendChild(hintEl);

    // Message card
    const msgCard = document.createElement('div');
    msgCard.className = 'gfgk-photo-msg';
    msgCard.textContent = message ?? '宝贝说：该休息了 ❤️';
    center.appendChild(msgCard);

    wrap.appendChild(center);

    // Bottom bar: countdown + actions
    const bottom = document.createElement('div');
    bottom.className = 'gfgk-photo-bottom';

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

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      remaining--;
      cdEl.textContent = fmt(remaining);
      if (remaining <= 0) endBreak(host, breakMinutes);
    }, 1000);

    bottom.appendChild(cdWrap);

    const actions = document.createElement('div');
    actions.className = 'gfgk-actions';

    // Mute
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
      if (bgmAudio) bgmAudio.muted = muted;
      document.querySelectorAll('video, audio').forEach(el => { el.muted = muted; });
      muteBtn.textContent = muted ? '🔇' : '🎤';
      muteLbl.textContent = muted ? '已静音' : '静音';
      muteBtn.style.background = muted ? 'rgba(255,80,80,0.35)' : '';
    };
    muteWrap.appendChild(muteBtn);
    muteWrap.appendChild(muteLbl);
    actions.appendChild(muteWrap);

    actions.appendChild(makeActionBtn('📵', '去休息',   'gfgk-act-btn gfgk-end-btn', () => endBreak(host, breakMinutes)));
    actions.appendChild(makeActionBtn('✕',  '紧急退出', 'gfgk-act-btn gfgk-esc-btn', removeOverlay));

    bottom.appendChild(actions);
    wrap.appendChild(bottom);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODE C — Anime / animal: floating character + speech bubble
  // ══════════════════════════════════════════════════════════════════════════

  async function buildAnimeUI(wrap, host, breakMinutes, message, photo, hasBgm, cfg) {
    wrap.classList.add('gfgk-anime');

    const bg = document.createElement('div');
    bg.className = 'gfgk-anime-bg';
    wrap.appendChild(bg);

    if (hasBgm) await loadBgmOnly(cfg);

    const src = photo;
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

    if (countdownInterval) clearInterval(countdownInterval);
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
      videoEl.muted = true; // required for autoplay policy; mute btn can toggle later

      // Convert data URL → Blob URL: avoids Chrome's large-src silent failure
      try {
        const blob = await fetch(cfg.videoDataUrl).then(r => r.blob());
        const objUrl = URL.createObjectURL(blob);
        objectURLs.push(objUrl);
        videoEl.src = objUrl;
      } catch (_) {
        videoEl.src = cfg.videoDataUrl; // fallback
      }

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

    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      remaining--;
      cdEl.textContent = fmt(remaining);
      if (remaining <= 0) endBreak(host, breakMinutes);
    }, 1000);

    bar.appendChild(cdWrap);

    const actions = document.createElement('div');
    actions.className = 'gfgk-actions';

    // Mute button — video starts muted for autoplay; button reflects real state
    let muted = videoEl ? videoEl.muted : false;
    const muteWrap = document.createElement('div');
    muteWrap.className = 'gfgk-act-wrap';
    const muteBtn = document.createElement('button');
    muteBtn.className = 'gfgk-act-btn';
    muteBtn.textContent = muted ? '🔇' : '🎤';
    if (muted) muteBtn.style.background = 'rgba(255,80,80,0.35)';
    const muteLbl = document.createElement('span');
    muteLbl.className = 'gfgk-act-lbl';
    muteLbl.textContent = muted ? '已静音' : '静音';
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
    // Remove stale host from a previous re-injection to avoid duplicate listeners
    const stale = document.getElementById('__gfgk_shadow_host__');
    if (stale) stale.remove();
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

    /* ══ PHOTO / GIF MODE ══ */

    .gfgk-photo-bg {
      position: absolute; inset: 0;
      background-size: cover; background-position: center;
      filter: blur(28px) brightness(0.45) saturate(1.2);
      transform: scale(1.08);
    }
    .gfgk-photo-overlay {
      position: absolute; inset: 0;
      background: linear-gradient(
        180deg,
        rgba(0,0,0,0.30) 0%,
        rgba(0,0,0,0.10) 40%,
        rgba(0,0,0,0.55) 75%,
        rgba(0,0,0,0.88) 100%
      );
    }
    .gfgk-photo-center {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -54%);
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      z-index: 5;
    }
    .gfgk-avatar-wrap {
      position: relative; width: 160px; height: 160px;
    }
    .gfgk-avatar-ring {
      position: absolute; inset: -8px; border-radius: 50%;
      border: 3px solid rgba(255,107,157,0.75);
      animation: gfgk-pulse-ring 2.2s ease-out infinite;
      box-shadow: 0 0 0 0 rgba(255,107,157,0.55);
    }
    @keyframes gfgk-pulse-ring {
      0%   { transform: scale(1);    opacity: 1; box-shadow: 0 0 0 0   rgba(255,107,157,0.55); }
      70%  { transform: scale(1.12); opacity: 0.6; box-shadow: 0 0 0 18px rgba(255,107,157,0); }
      100% { transform: scale(1);    opacity: 1; box-shadow: 0 0 0 0   rgba(255,107,157,0); }
    }
    .gfgk-avatar {
      width: 160px; height: 160px; border-radius: 50%;
      object-fit: cover; display: block;
      border: 4px solid rgba(255,255,255,0.92);
      box-shadow: 0 8px 48px rgba(0,0,0,0.65), 0 0 0 6px rgba(255,107,157,0.22);
    }
    .gfgk-avatar-emoji {
      width: 160px; height: 160px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 80px;
      background: rgba(255,255,255,0.10);
      border: 4px solid rgba(255,255,255,0.5);
    }
    .gfgk-photo-name {
      font-size: 24px; font-weight: 700; color: #fff;
      text-shadow: 0 2px 12px rgba(0,0,0,0.7);
      letter-spacing: 0.02em;
    }
    .gfgk-photo-hint {
      font-size: 13px; color: rgba(255,255,255,0.55);
      letter-spacing: 0.04em;
    }
    .gfgk-photo-msg {
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.18);
      backdrop-filter: blur(16px);
      border-radius: 18px;
      padding: 12px 26px;
      font-size: 16px; font-weight: 500; color: #fff;
      text-align: center; max-width: 72vw;
      text-shadow: 0 1px 6px rgba(0,0,0,0.4);
      box-shadow: 0 4px 24px rgba(0,0,0,0.25);
    }
    .gfgk-photo-bottom {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; flex-direction: column; align-items: center;
      padding: 0 0 38px; gap: 18px; z-index: 10;
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
