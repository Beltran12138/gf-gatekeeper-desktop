const DEFAULT_SITES = [
  'instagram.com','tiktok.com','youtube.com','twitter.com','x.com',
  'reddit.com','facebook.com','threads.net','weibo.com','douyin.com',
  'xiaohongshu.com','bilibili.com','twitch.tv','pinterest.com',
].join('\n');

async function load() {
  const { cfg, timeMap } = await chrome.storage.local.get(['cfg', 'timeMap']);

  document.getElementById('limitMin').value  = cfg?.limitMinutes ?? 15;
  document.getElementById('breakMin').value  = cfg?.breakMinutes ?? 5;
  document.getElementById('message').value   = cfg?.message ?? '';
  document.getElementById('sites').value     = (cfg?.trackedSites ?? []).join('\n') || DEFAULT_SITES;

  if (cfg?.photoB64) {
    const img = document.getElementById('preview');
    img.src = cfg.photoB64;
    img.classList.add('visible');
  }

  renderStats(timeMap ?? {});
}

function renderStats(timeMap) {
  const el = document.getElementById('stats');
  const entries = Object.entries(timeMap)
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  if (!entries.length) {
    el.innerHTML = '<span style="color:#333">暂无数据</span>';
    return;
  }
  el.innerHTML = entries.map(([site, sec]) => {
    const min = Math.round(sec / 60);
    return `<div class="stat-row"><span class="site">${site}</span><span class="mins">${min} min</span></div>`;
  }).join('');
}

// Photo upload
document.getElementById('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const b64 = ev.target.result;
    document.getElementById('preview').src = b64;
    document.getElementById('preview').classList.add('visible');
    // Save photo immediately
    chrome.storage.local.get('cfg', ({ cfg }) => {
      chrome.storage.local.set({ cfg: { ...(cfg ?? {}), photoB64: b64 } });
    });
  };
  reader.readAsDataURL(file);
});

// Save
document.getElementById('saveBtn').addEventListener('click', async () => {
  const { cfg: existing } = await chrome.storage.local.get('cfg');
  const sites = document.getElementById('sites').value
    .split('\n').map(s => s.trim()).filter(Boolean);

  const cfg = {
    ...(existing ?? {}),
    limitMinutes: parseInt(document.getElementById('limitMin').value) || 15,
    breakMinutes: parseInt(document.getElementById('breakMin').value) || 5,
    message:      document.getElementById('message').value || '宝贝说：该休息了 ❤️',
    trackedSites: sites,
  };
  await chrome.storage.local.set({ cfg });

  const msg = document.getElementById('savedMsg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2000);
});

// Reset
document.getElementById('resetBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ timeMap: {}, breaks: {} });
  chrome.runtime.sendMessage({ type: 'reset_all' });
  renderStats({});
});

// Test overlay immediately
document.getElementById('testBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'test_overlay' });
  window.close();
});

load();
