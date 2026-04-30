/**
 * Girlfriend Gatekeeper — content script
 * Injected into every page. Listens for show_overlay message from background.
 */

(function () {
  'use strict';

  if (window.__gfgk_loaded) return;
  window.__gfgk_loaded = true;

  let overlayEl = null;
  let countdownInterval = null;

  // ── receive trigger ─────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'show_overlay' && !overlayEl) {
      showOverlay(msg);
    }
  });

  // ── overlay ─────────────────────────────────────────────────────────────────

  function showOverlay({ host, breakMinutes, photoB64, message }) {
    const shadow = createShadowHost();
    const root   = shadow.shadowRoot;

    // Inject styles into shadow DOM (page CSS cannot bleed in)
    const style = document.createElement('style');
    style.textContent = getStyles();
    root.appendChild(style);

    // Build DOM
    const wrap = document.createElement('div');
    wrap.className = 'gfgk-wrap';
    root.appendChild(wrap);
    overlayEl = wrap;

    // Background blur via CSS backdrop-filter
    const backdrop = document.createElement('div');
    backdrop.className = 'gfgk-backdrop';
    wrap.appendChild(backdrop);

    // Photo
    const photoWrap = document.createElement('div');
    photoWrap.className = 'gfgk-photo-wrap';
    if (photoB64) {
      const img = document.createElement('img');
      img.className = 'gfgk-photo';
      img.src = photoB64;
      photoWrap.appendChild(img);
    } else {
      const emoji = document.createElement('div');
      emoji.className = 'gfgk-emoji';
      emoji.textContent = '❤️';
      photoWrap.appendChild(emoji);
    }
    wrap.appendChild(photoWrap);

    // Card
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

    wrap.appendChild(card);

    // Entrance animation trigger
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        photoWrap.classList.add('gfgk-entered');
        card.classList.add('gfgk-card-entered');
      });
    });

    // ESC key
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') removeOverlay();
  }

  function endBreak(host, breakMinutes) {
    chrome.runtime.sendMessage({ type: 'start_break', host, breakMinutes });
    removeOverlay();
  }

  function removeOverlay() {
    clearInterval(countdownInterval);
    document.removeEventListener('keydown', onKeydown);
    const host = document.getElementById('__gfgk_shadow_host__');
    if (host) host.remove();
    overlayEl = null;
  }

  // ── shadow DOM host ──────────────────────────────────────────────────────────

  function createShadowHost() {
    const host = document.createElement('div');
    host.id = '__gfgk_shadow_host__';
    Object.assign(host.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      zIndex: '2147483647',
      pointerEvents: 'all',
    });
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });
    return host;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  function fmt(sec) {
    const m = Math.floor(Math.abs(sec) / 60);
    const s = Math.abs(sec) % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── styles ───────────────────────────────────────────────────────────────────

  function getStyles() {
    return `
      .gfgk-wrap {
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 24px;
        font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
      }

      .gfgk-backdrop {
        position: absolute; inset: 0;
        background: rgba(6, 2, 14, 0.52);
        backdrop-filter: blur(20px) brightness(0.35) saturate(0.5);
        -webkit-backdrop-filter: blur(20px) brightness(0.35) saturate(0.5);
        z-index: 0;
      }

      /* Photo — spring entrance */
      .gfgk-photo-wrap {
        position: relative; z-index: 1;
        transform: scale(0.05) perspective(600px) rotateX(45deg);
        opacity: 0;
        transition: transform 0.75s cubic-bezier(0.34, 1.56, 0.64, 1),
                    opacity   0.35s ease;
      }
      .gfgk-photo-wrap.gfgk-entered {
        transform: scale(1) perspective(600px) rotateX(0deg);
        opacity: 1;
      }

      .gfgk-photo {
        width: 240px; height: 240px;
        border-radius: 50%;
        object-fit: cover;
        border: 3px solid #ff6b9d;
        box-shadow:
          0 0 0   6px rgba(255,107,157,0.15),
          0 0 0  16px rgba(255,107,157,0.08),
          0 0 40px 8px rgba(196,77,255,0.25),
          0 24px 60px rgba(0,0,0,0.7);
        animation: breathe 3.5s ease-in-out infinite;
      }

      .gfgk-emoji {
        font-size: 100px;
        line-height: 1;
        filter: drop-shadow(0 0 30px rgba(255,107,157,0.6));
        animation: breathe 3.5s ease-in-out infinite;
      }

      @keyframes breathe {
        0%, 100% { transform: scale(1);     }
        50%       { transform: scale(1.04); }
      }

      /* Glow pulse ring */
      .gfgk-photo-wrap::before {
        content: '';
        position: absolute;
        inset: -18px;
        border-radius: 50%;
        border: 2px solid #ff6b9d;
        opacity: 0.4;
        animation: pulse 2s ease-in-out infinite;
      }
      .gfgk-photo-wrap::after {
        content: '';
        position: absolute;
        inset: -30px;
        border-radius: 50%;
        border: 1px solid #c44dff;
        opacity: 0.2;
        animation: pulse 2s ease-in-out 0.5s infinite;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1);    opacity: 0.4; }
        50%       { transform: scale(1.08); opacity: 0.1; }
      }

      /* Card — fade up */
      .gfgk-card {
        position: relative; z-index: 1;
        background: rgba(15,15,24,0.92);
        border: 1px solid #1c1c2e;
        border-radius: 16px;
        padding: 28px 40px 32px;
        display: flex; flex-direction: column; align-items: center;
        gap: 10px;
        min-width: 340px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        transform: translateY(24px); opacity: 0;
        transition: transform 0.5s cubic-bezier(0.34, 1.3, 0.64, 1) 0.2s,
                    opacity   0.4s ease 0.2s;
      }
      .gfgk-card.gfgk-card-entered {
        transform: translateY(0); opacity: 1;
      }

      .gfgk-message {
        font-size: 20px; font-weight: 700;
        color: #ffffff; text-align: center;
      }
      .gfgk-sub {
        font-size: 12px; color: #50506a;
      }
      .gfgk-countdown {
        font-family: 'Consolas', monospace;
        font-size: 52px; font-weight: 700;
        color: #ffffff; letter-spacing: 2px;
        line-height: 1.1;
      }
      .gfgk-btn {
        margin-top: 8px;
        padding: 13px 32px;
        background: #c44dff;
        color: #fff;
        border: none; border-radius: 10px;
        font-size: 15px; font-weight: 700;
        cursor: pointer;
        transition: background 0.2s, transform 0.15s;
        font-family: inherit;
      }
      .gfgk-btn:hover { background: #a020f0; transform: scale(1.03); }
      .gfgk-btn:active { transform: scale(0.97); }

      .gfgk-esc {
        background: none; border: none;
        color: #2a2a2a; font-size: 11px;
        cursor: pointer; font-family: inherit;
        transition: color 0.2s;
      }
      .gfgk-esc:hover { color: #ff7070; }
    `;
  }
})();
