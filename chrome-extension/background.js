/**
 * Girlfriend Gatekeeper — background service worker (MV3)
 *
 * Tracks active time per hostname. When limit exceeded on a tracked site,
 * sends "show_overlay" message to the active tab's content script.
 */

const DEFAULT_SITES = [
  'instagram.com', 'tiktok.com', 'youtube.com', 'twitter.com', 'x.com',
  'reddit.com', 'facebook.com', 'threads.net', 'weibo.com', 'douyin.com',
  'xiaohongshu.com', 'bilibili.com', 'twitch.tv', 'pinterest.com',
];

// ── helpers ──────────────────────────────────────────────────────────────────

async function getCfg() {
  const { cfg } = await chrome.storage.local.get('cfg');
  return cfg ?? {
    limitMinutes:  15,
    breakMinutes:  5,
    trackedSites:  DEFAULT_SITES,
    photoB64:      null,
    message:       '宝贝说：该休息了 ❤️',
  };
}

function matchesSite(hostname, sites) {
  return sites.some(s => hostname === s || hostname.endsWith('.' + s));
}

// ── session tracking ─────────────────────────────────────────────────────────

let _activeHost  = null;
let _sessionStart = null;   // timestamp when current host became active

async function getTimeMap() {
  const { timeMap } = await chrome.storage.local.get('timeMap');
  return timeMap ?? {};
}

async function flushCurrentSession() {
  if (!_activeHost || !_sessionStart) return;
  const elapsed = Math.round((Date.now() - _sessionStart) / 1000);
  if (elapsed <= 0) return;

  const timeMap = await getTimeMap();
  timeMap[_activeHost] = (timeMap[_activeHost] ?? 0) + elapsed;
  await chrome.storage.local.set({ timeMap });
  _sessionStart = Date.now();   // reset for continuous tracking
  return timeMap[_activeHost];
}

async function checkLimit(host, totalSeconds) {
  const cfg = await getCfg();
  if (!matchesSite(host, cfg.trackedSites)) return;

  const limitSeconds = cfg.limitMinutes * 60;
  if (totalSeconds >= limitSeconds) {
    // Check not already on break
    const { breaks } = await chrome.storage.local.get('breaks');
    const now = Date.now();
    if (breaks?.[host] && breaks[host] > now) return;  // still on break

    // Fire overlay on all tabs matching this host
    const tabs = await chrome.tabs.query({ active: true });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'show_overlay',
          host,
          limitMinutes: cfg.limitMinutes,
          breakMinutes: cfg.breakMinutes,
          photoB64:     cfg.photoB64,
          message:      cfg.message,
        });
      } catch (_) { /* tab not ready */ }
    }
  }
}

// ── tab events ───────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await flushCurrentSession();

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://')) {
      _activeHost = null; _sessionStart = null; return;
    }
    const host = new URL(tab.url).hostname;
    _activeHost  = host;
    _sessionStart = Date.now();
  } catch (_) {
    _activeHost = null; _sessionStart = null;
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !tab.active) return;
  await flushCurrentSession();
  if (!tab.url || tab.url.startsWith('chrome://')) return;
  const host = new URL(tab.url).hostname;
  _activeHost  = host;
  _sessionStart = Date.now();
});

// ── alarm: tick every 5 seconds ──────────────────────────────────────────────

chrome.alarms.create('tick', { periodInMinutes: 1 / 12 });  // ~5s

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'tick') return;
  if (!_activeHost) return;

  const total = await flushCurrentSession();
  if (total != null) await checkLimit(_activeHost, total);
});

// ── break management (called from content.js) ────────────────────────────────

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'start_break') {
    const { host, breakMinutes } = msg;
    const { breaks } = await chrome.storage.local.get('breaks');
    const updated = breaks ?? {};
    updated[host] = Date.now() + breakMinutes * 60 * 1000;

    // Reset site time
    const timeMap = await getTimeMap();
    timeMap[host] = 0;
    await chrome.storage.local.set({ breaks: updated, timeMap });
    _sessionStart = Date.now();
  }

  if (msg.type === 'reset_all') {
    await chrome.storage.local.set({ timeMap: {}, breaks: {} });
    _sessionStart = Date.now();
  }
});
