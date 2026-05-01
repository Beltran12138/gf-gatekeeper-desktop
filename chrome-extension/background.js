/**
 * Girlfriend Gatekeeper — background service worker (MV3)
 *
 * State is stored in chrome.storage.session so it survives
 * service-worker sleep/wake cycles within the same browser session.
 */

const DEFAULT_SITES = [
  'instagram.com','tiktok.com','youtube.com','twitter.com','x.com',
  'reddit.com','facebook.com','threads.net','weibo.com','douyin.com',
  'xiaohongshu.com','bilibili.com','twitch.tv','pinterest.com',
];

// ── config ────────────────────────────────────────────────────────────────────

async function getCfg() {
  const { cfg } = await chrome.storage.local.get('cfg');
  return cfg ?? {
    limitMinutes: 15,
    breakMinutes: 5,
    trackedSites: DEFAULT_SITES,
    photoB64: null,
    message: '宝贝说：该休息了 ❤️',
  };
}

function matchesSite(hostname, sites) {
  return sites.some(s => hostname === s || hostname.endsWith('.' + s));
}

// ── session state (survives SW sleep) ────────────────────────────────────────

async function getSession() {
  const d = await chrome.storage.session.get(['activeHost', 'sessionStart']);
  return { activeHost: d.activeHost ?? null, sessionStart: d.sessionStart ?? null };
}

async function setActiveHost(host) {
  await chrome.storage.session.set({ activeHost: host, sessionStart: Date.now() });
}

async function clearActiveHost() {
  await chrome.storage.session.remove(['activeHost', 'sessionStart']);
}

// ── time accumulation ─────────────────────────────────────────────────────────

async function flushElapsed() {
  const { activeHost, sessionStart } = await getSession();
  if (!activeHost || !sessionStart) return null;

  const elapsed = Math.round((Date.now() - sessionStart) / 1000);
  if (elapsed <= 0) return null;

  const { timeMap } = await chrome.storage.local.get('timeMap');
  const map = timeMap ?? {};
  map[activeHost] = (map[activeHost] ?? 0) + elapsed;
  await chrome.storage.local.set({ timeMap: map });
  // Reset session start so we don't double-count
  await chrome.storage.session.set({ sessionStart: Date.now() });
  return { host: activeHost, total: map[activeHost] };
}

// ── limit check + overlay trigger ────────────────────────────────────────────

async function checkAndTrigger(host, totalSeconds) {
  const cfg = await getCfg();
  if (!matchesSite(host, cfg.trackedSites)) return;

  const limit = cfg.limitMinutes * 60;
  if (totalSeconds < limit) return;

  // Skip if already on break
  const { breaks } = await chrome.storage.local.get('breaks');
  if (breaks?.[host] && breaks[host] > Date.now()) return;

  const payload = {
    type:        'show_overlay',
    host,
    breakMinutes: cfg.breakMinutes,
    photoB64:     cfg.photoB64   ?? null,
    message:      cfg.message,
    callerName:   cfg.callerName ?? '宝贝',
    hasVideo:     cfg.hasVideo   ?? false,
    hasBgm:       cfg.hasBgm    ?? false,
    animeMode:    cfg.animeMode  ?? false,
  };

  // Send to ALL tracked tabs; re-inject if content script is orphaned
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const url = tab.url ?? '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    try {
      const tabHost = new URL(url).hostname;
      if (!matchesSite(tabHost, cfg.trackedSites)) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, payload);
      } catch (_) {
        // Content script orphaned after extension reload — re-inject
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => { window.__gfgk_loaded = false; },
          });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
          });
          await chrome.tabs.sendMessage(tab.id, payload);
        } catch (_) {}
      }
    } catch (_) {}
  }
}

// ── alarm: tick every minute (MV3 minimum) ───────────────────────────────────

chrome.alarms.create('tick', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tick') return;
  const result = await flushElapsed();
  if (result) await checkAndTrigger(result.host, result.total);
});

// ── tab events ────────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await flushElapsed();   // flush previous host
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://')) {
      await clearActiveHost(); return;
    }
    await setActiveHost(new URL(tab.url).hostname);
  } catch (_) { await clearActiveHost(); }
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !tab.active) return;
  await flushElapsed();
  if (!tab.url || tab.url.startsWith('chrome://')) {
    await clearActiveHost(); return;
  }
  await setActiveHost(new URL(tab.url).hostname);
});

chrome.tabs.onRemoved.addListener(async () => {
  await flushElapsed();
  await clearActiveHost();
});

// ── messages from content/popup ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'start_break') {
      const { host, breakMinutes } = msg;
      const { breaks, timeMap } = await chrome.storage.local.get(['breaks', 'timeMap']);
      const b = breaks ?? {};
      b[host] = Date.now() + breakMinutes * 60 * 1000;
      const m = timeMap ?? {};
      m[host] = 0;
      await chrome.storage.local.set({ breaks: b, timeMap: m });
      await chrome.storage.session.set({ sessionStart: Date.now() });
    }

    if (msg.type === 'reset_all') {
      await chrome.storage.local.set({ timeMap: {}, breaks: {} });
      await chrome.storage.session.set({ sessionStart: Date.now() });
    }

    // Debug: force-show overlay on active tab immediately
    if (msg.type === 'test_overlay') {
      const cfg = await getCfg();
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const url = tab?.url ?? '';
      if (tab && (url.startsWith('http://') || url.startsWith('https://'))) {
        const payload = {
          type:        'show_overlay',
          host:        'test',
          breakMinutes: cfg.breakMinutes,
          photoB64:     cfg.photoB64   ?? null,
          message:      cfg.message,
          callerName:   cfg.callerName ?? '宝贝',
          hasVideo:     cfg.hasVideo   ?? false,
          hasBgm:       cfg.hasBgm    ?? false,
          animeMode:    cfg.animeMode  ?? false,
        };
        try {
          await chrome.tabs.sendMessage(tab.id, payload);
        } catch (e) {
          // Content script orphaned or not ready — reset guard then re-inject
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => { window.__gfgk_loaded = false; },
            });
          } catch (_) {}
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js'],
            });
            await chrome.tabs.sendMessage(tab.id, payload);
          } catch (_) {}
        }
      }
    }

    sendResponse({ ok: true });
  })();
  return true;  // keep channel open for async
});
