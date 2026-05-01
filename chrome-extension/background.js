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
  // Skip reset if host unchanged — preserves ongoing session timing
  const { activeHost } = await getSession();
  if (activeHost === host) return;
  await chrome.storage.session.set({ activeHost: host, sessionStart: Date.now() });
}

async function clearActiveHost() {
  await chrome.storage.session.remove(['activeHost', 'sessionStart']);
}

// ── time accumulation ─────────────────────────────────────────────────────────

async function flushElapsed() {
  const { activeHost, sessionStart } = await getSession();
  if (!activeHost || !sessionStart) return null;

  const now = Date.now();
  const elapsed = Math.round((now - sessionStart) / 1000);
  if (elapsed <= 0) return null;

  // Atomically claim this time window before the slower local-storage write
  // so concurrent calls can't double-count the same interval
  await chrome.storage.session.set({ sessionStart: now });

  const { timeMap } = await chrome.storage.local.get('timeMap');
  const map = timeMap ?? {};
  map[activeHost] = (map[activeHost] ?? 0) + elapsed;
  await chrome.storage.local.set({ timeMap: map });
  return { host: activeHost, total: map[activeHost] };
}

// ── pre-limit warning (5 min before) ─────────────────────────────────────────

async function maybeWarn(host, totalSeconds) {
  const cfg = await getCfg();
  if (!matchesSite(host, cfg.trackedSites)) return;

  const limit = cfg.limitMinutes * 60;
  const remaining = limit - totalSeconds;
  // Fire warning when 1–5 minutes remain (alarm granularity is 1 min)
  if (remaining <= 0 || remaining > 300) return;

  // Skip if already on break
  const { breaks } = await chrome.storage.local.get('breaks');
  if (breaks?.[host] && breaks[host] > Date.now()) return;

  // Only warn once per session per host
  const { warnedHosts } = await chrome.storage.session.get('warnedHosts');
  const warned = warnedHosts ?? {};
  if (warned[host]) return;
  warned[host] = true;
  await chrome.storage.session.set({ warnedHosts: warned });

  const minsLeft = Math.ceil(remaining / 60);
  const callerName = cfg.callerName ?? '宝贝';
  chrome.notifications.create(`gfgk_warn_${host}`, {
    type:    'basic',
    iconUrl: 'icons/icon128.png',
    title:   `⏰ 还有 ${minsLeft} 分钟就超时了`,
    message: `${callerName} 提醒你：${host} 快到时间限制了`,
  });
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

// Guard against stale alarm surviving an extension update
chrome.alarms.get('tick', existing => {
  if (!existing) chrome.alarms.create('tick', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tick') {
    const result = await flushElapsed();
    if (result) {
      await maybeWarn(result.host, result.total);
      await checkAndTrigger(result.host, result.total);
    }
    return;
  }

  // Break-end alarm: notify user that tracking has resumed
  if (alarm.name.startsWith('gfgk_break_end_')) {
    const host = alarm.name.slice('gfgk_break_end_'.length);
    chrome.notifications.create(`gfgk_end_${Date.now()}`, {
      type:    'basic',
      iconUrl: 'icons/icon128.png',
      title:   '🌸 休息结束',
      message: `${host} 计时重新开始，控制好使用时间哦`,
    });
  }
});

// ── tab events ────────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await flushElapsed();
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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await flushElapsed();
  // Re-sync to whatever tab is now active; don't blindly clear
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.url || !activeTab.url.startsWith('http')) {
      await clearActiveHost();
    } else {
      await setActiveHost(new URL(activeTab.url).hostname);
    }
  } catch (_) { await clearActiveHost(); }
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

      // Clear warning flag so next session can warn again
      const { warnedHosts } = await chrome.storage.session.get('warnedHosts');
      const warned = warnedHosts ?? {};
      delete warned[host];
      await chrome.storage.session.set({ warnedHosts: warned });

      // Schedule break-end notification
      chrome.alarms.create(`gfgk_break_end_${host}`, { delayInMinutes: breakMinutes });
    }

    if (msg.type === 'reset_all') {
      const today = new Date().toDateString();
      await chrome.storage.local.set({ timeMap: {}, breaks: {}, statsDate: today });
      await chrome.storage.session.set({ sessionStart: Date.now(), warnedHosts: {} });
      // Clear all break-end alarms
      const alarms = await chrome.alarms.getAll();
      for (const a of alarms) {
        if (a.name.startsWith('gfgk_break_end_')) chrome.alarms.clear(a.name);
      }
    }

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
  return true;
});
