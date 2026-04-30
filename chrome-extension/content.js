/**
 * Girlfriend Gatekeeper — content script
 * Supports: photo, GIF, video (with audio), BGM fallback.
 * db.js is loaded before this file (see manifest.json).
 */

(function () {
  'use strict';
  if (window.__gfgk_loaded) return;
  window.__gfgk_loaded = true;

  let overlayEl = null;
  let countdownInterval = null;
  let bgmAudio = null;
  let videoEl  = null;
  let objectURLs = [];   // revoked on hide

  // ── message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'show_overlay' && !overlayEl) showOverlay(msg);
  });

  // ── build overlay ─────────────────────────────────────────────────────────

  async function showOverlay({ host, breakMinutes, photoB64, message, hasVideo, hasBgm }) {
    const shadow = createShadowHost();
    const root   = shadow.shadowRoot;

    const style = document.createElement('style');
    style.textContent = getStyles();
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'gfgk-wrap';
    root.appendChild(wrap);
    overlayEl = wrap;

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'gfgk-backdrop';
    wrap.appendChild(backdrop);

    // Media area
    const photoWrap = document.createElement('div');
    photoWrap.className = 'gfgk-photo-wrap';
    wrap.appendChild(photoWrap);

    await loadMedia(photoWrap, photoB64, hasVideo, hasBgm);

    // Card
    const card = buildCard(host, breakMinutes, message);
    wrap.appendChild(card.el);

    // Entrance animation
    requestAnimationFrame(() => requestAnimationFrame(() => {
      photoWrap.classList.add('gfgk-entered');
      card.el.classList.add('gfgk-card-entered');
    }));

    document.addEventListener('keydown', onKeydown);
  }

  // ── media loading ─────────────────────────────────────────────────────────

  async function loadMedia(container, photoB64, hasVideo, hasBgm) {
    // 1. Try video from IndexedDB
    if (hasVideo) {
      try {
        const blob = await mediaLoad('main_media');
        if (blob) {
          videoEl = document.createElement('video');
          videoEl.className = 'gfgk-photo';
          videoEl.autoplay = true;
          videoEl.loop = true;
          videoEl.playsInline = true;
          // Video carries its own audio — no separate BGM needed
          const url = URL.createObjectURL(blob);
          objectURLs.push(url);
          videoEl.src = url;
          container.appendChild(videoEl);
          videoEl.play().catch(() => {});
          return;  // video loaded, skip photo + BGM
        }
      } catch (_) {}
    }

    // 2. Fall back to photo (base64)
    if (photoB64) {
      const img = document.createElement('img');
      img.className = 'gfgk-photo';
      img.src = photoB64;
      container.appendChild(img);
    } else {
      // 3. Emoji placeholder
      const em = document.createElement('div');
      em.className = 'gfgk-emoji';
      em.textContent = '❤️';
      container.appendChild(em);
    }

    // 4. BGM (only when no video)
    if (hasBgm) {
      try {
        const blob = await mediaLoad('bgm');
        if (blob) {
          bgmAudio = document.createElement('audio');
          bgmAudio.loop = true;
          const url = URL.createObjectURL(blob);
          objectURLs.push(url);
          bgmAudio.src = url;
          bgmAudio.play().catch(() => {});
        }
      } catch (_) {}
    }
  }

  // ── card with countdown ───────────────────────────────────────────────────

  function buildCard(host, breakMinutes, message) {
    const card = document.createElement('div');
    card.className = 'gfgk-card';

    const msgEl = document.createElement('div');
    msgEl.className = 'gfgk-message';
    msgEl.textContent = message ?? '宝贝说：该休息了 ❤️';
    card.appendChild(msgEl);

    const subEl = document.createElement('div');
    subEl.className = 'gfgk-sub';
    subEl.textContent = `休息 ${breakMinutes} 分钟后继续`;
    card.appendChild(subEl);

    let remaining = breakMinutes * 60;
    const cdEl = document.createElement('div');
    cdEl.className = 'gfgk-countdown';
    cdEl.textContent = fmt(remaining);
    card.appendChild(cdEl);

    countdownInterval = setInterval(() => {
      remaining--;
      cdEl.textContent = fmt(remaining);
      if (remaining <= 0) endBreak(host, breakMinutes);
    }, 1000);

    const btn = document.createElement('button');
    btn.className = 'gfgk-btn';
    btn.textContent = '好的，我去休息了  ❤️';
    btn.onclick = () => endBreak(host, breakMinutes);
    card.appendChild(btn);

    const esc = document.createElement('button');
    esc.className = 'gfgk-esc';
    esc.textContent = '紧急退出 [ESC]';
    esc.onclick = removeOverlay;
    card.appendChild(esc);

    return { el: card };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  function onKeydown(e) { if (e.key === 'Escape') removeOverlay(); }

  function endBreak(host, breakMinutes) {
    chrome.runtime.sendMessage({ type: 'start_break', host, breakMinutes });
    removeOverlay();
  }

  function removeOverlay() {
    clearInterval(countdownInterval);
    document.removeEventListener('keydown', onKeydown);
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; }
    if (videoEl)  { videoEl.pause();  videoEl  = null; }
    objectURLs.forEach(u => URL.revokeObjectURL(u));
    objectURLs = [];
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
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 22px;
      font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
    }
    .gfgk-backdrop {
      position: absolute; inset: 0; z-index: 0;
      background: rgba(6, 2, 14, 0.52);
      backdrop-filter: blur(20px) brightness(0.35) saturate(0.5);
      -webkit-backdrop-filter: blur(20px) brightness(0.35) saturate(0.5);
    }

    /* Photo / Video — spring entrance */
    .gfgk-photo-wrap {
      position: relative; z-index: 1;
      transform: scale(0.05) perspective(600px) rotateX(40deg);
      opacity: 0;
      transition: transform 0.75s cubic-bezier(0.34, 1.56, 0.64, 1),
                  opacity   0.35s ease;
    }
    .gfgk-photo-wrap.gfgk-entered {
      transform: scale(1) perspective(600px) rotateX(0deg);
      opacity: 1;
    }
    .gfgk-photo {
      width: 240px; height: 240px; border-radius: 50%;
      object-fit: cover;
      border: 3px solid #ff6b9d;
      box-shadow:
        0 0 0   6px rgba(255,107,157,0.15),
        0 0 0  18px rgba(255,107,157,0.07),
        0 0 50px 10px rgba(196,77,255,0.20),
        0 24px 60px rgba(0,0,0,0.8);
      animation: breathe 3.5s ease-in-out infinite;
    }
    .gfgk-emoji {
      font-size: 110px; line-height: 1;
      filter: drop-shadow(0 0 30px rgba(255,107,157,0.6));
      animation: breathe 3.5s ease-in-out infinite;
    }
    @keyframes breathe {
      0%, 100% { transform: scale(1); }
      50%       { transform: scale(1.04); }
    }

    /* Glow rings */
    .gfgk-photo-wrap::before {
      content: ''; position: absolute; inset: -18px;
      border-radius: 50%; border: 2px solid #ff6b9d;
      opacity: 0.4; animation: pulse 2s ease-in-out infinite;
    }
    .gfgk-photo-wrap::after {
      content: ''; position: absolute; inset: -32px;
      border-radius: 50%; border: 1px solid #c44dff;
      opacity: 0.2; animation: pulse 2s ease-in-out 0.6s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1);    opacity: 0.4; }
      50%       { transform: scale(1.09); opacity: 0.1; }
    }

    /* Card */
    .gfgk-card {
      position: relative; z-index: 1;
      background: rgba(14, 14, 22, 0.94);
      border: 1px solid #1c1c30; border-radius: 16px;
      padding: 26px 38px 30px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      min-width: 320px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.7);
      transform: translateY(28px); opacity: 0;
      transition: transform 0.55s cubic-bezier(0.34, 1.3, 0.64, 1) 0.18s,
                  opacity   0.4s ease 0.18s;
    }
    .gfgk-card.gfgk-card-entered { transform: translateY(0); opacity: 1; }

    .gfgk-message { font-size: 19px; font-weight: 700; color: #fff; text-align: center; }
    .gfgk-sub     { font-size: 11px; color: #50506a; }
    .gfgk-countdown {
      font-family: 'Consolas', monospace;
      font-size: 50px; font-weight: 700;
      color: #fff; letter-spacing: 2px; line-height: 1.1;
    }
    .gfgk-btn {
      margin-top: 6px; padding: 12px 30px;
      background: #c44dff; color: #fff;
      border: none; border-radius: 10px;
      font-size: 14px; font-weight: 700; cursor: pointer;
      transition: background 0.2s, transform 0.15s; font-family: inherit;
    }
    .gfgk-btn:hover  { background: #a020f0; transform: scale(1.03); }
    .gfgk-btn:active { transform: scale(0.97); }
    .gfgk-esc {
      background: none; border: none; color: #2a2a2a;
      font-size: 11px; cursor: pointer; font-family: inherit;
      transition: color 0.2s;
    }
    .gfgk-esc:hover { color: #ff7070; }
  `; }
})();
