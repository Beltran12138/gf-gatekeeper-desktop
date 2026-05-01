const DEFAULT_SITES = [
  'instagram.com','tiktok.com','youtube.com','twitter.com','x.com',
  'reddit.com','facebook.com','threads.net','weibo.com','douyin.com',
  'xiaohongshu.com','bilibili.com','twitch.tv','pinterest.com',
].join('\n');

function fmtBytes(b) {
  if (b < 1024)     return b + ' B';
  if (b < 1048576)  return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fileToDataUrl(file) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = ev => res(ev.target.result);
    r.readAsDataURL(file);
  });
}

// Returns true if the PNG data URL contains meaningful alpha transparency
function hasAlphaChannel(dataUrl) {
  return new Promise(res => {
    if (!dataUrl.startsWith('data:image/png')) { res(false); return; }
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.min(img.width, 64); cv.height = Math.min(img.height, 64);
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 200) transparent++;
      res(transparent > (cv.width * cv.height * 0.05)); // >5% transparent pixels
    };
    img.onerror = () => res(false);
    img.src = dataUrl;
  });
}

// ── load saved state ──────────────────────────────────────────────────────────

async function load() {
  const { cfg, statsDate } = await chrome.storage.local.get(['cfg', 'statsDate']);

  // Auto-reset daily — "今日统计" should reflect today only
  const today = new Date().toDateString();
  let timeMap = {};
  if (statsDate !== today) {
    await chrome.storage.local.set({ timeMap: {}, statsDate: today });
  } else {
    ({ timeMap } = await chrome.storage.local.get('timeMap'));
    timeMap = timeMap ?? {};
  }

  document.getElementById('limitMin').value   = cfg?.limitMinutes ?? 15;
  document.getElementById('breakMin').value   = cfg?.breakMinutes ?? 5;
  document.getElementById('callerName').value = cfg?.callerName  ?? '';
  document.getElementById('message').value    = cfg?.message ?? '';
  document.getElementById('sites').value      = (cfg?.trackedSites ?? []).join('\n') || DEFAULT_SITES;

  if (cfg?.mediaMeta) await restoreMediaLabel(cfg.mediaMeta, cfg);
  if (cfg?.bgmMeta)   restoreBgmLabel(cfg.bgmMeta);

  renderStats(timeMap);
}

async function restoreMediaLabel(meta, cfg) {
  document.getElementById('mediaName').textContent = meta.name;
  document.getElementById('mediaSize').textContent = fmtBytes(meta.size);
  const isVideo = meta.type?.startsWith('video/');
  if (isVideo) {
    // Video stored under separate key to keep cfg small
    const { gfgk_videoUrl } = await chrome.storage.local.get('gfgk_videoUrl');
    if (gfgk_videoUrl) {
      const vid = document.getElementById('mediaThumbVid');
      vid.src = gfgk_videoUrl; vid.classList.add('show');
      vid.play().catch(() => {});
    }
  } else if (cfg?.photoB64) {
    const img = document.getElementById('mediaThumbImg');
    img.src = cfg.photoB64; img.classList.add('show');
  }
}

function restoreBgmLabel(meta) {
  document.getElementById('bgmName').textContent = meta.name;
  document.getElementById('bgmSize').textContent = fmtBytes(meta.size);
}

function renderStats(timeMap) {
  const el = document.getElementById('stats');
  const entries = Object.entries(timeMap)
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  if (!entries.length) {
    el.innerHTML = '<span style="color:#333">暂无数据</span>'; return;
  }
  el.innerHTML = entries.map(([site, sec]) =>
    `<div class="stat-row">
       <span class="site">${site}</span>
       <span class="mins">${Math.round(sec / 60)} min</span>
     </div>`
  ).join('');
}

// ── media upload ──────────────────────────────────────────────────────────────

// Tracks in-progress storage write so testBtn can wait before sending the message
let _pendingWrite = Promise.resolve();

document.getElementById('mediaInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const isVideo = file.type.startsWith('video/');

  document.getElementById('mediaName').textContent = file.name;
  document.getElementById('mediaSize').textContent = fmtBytes(file.size);

  const dataUrl = await fileToDataUrl(file);
  const isAnime = !isVideo && await hasAlphaChannel(dataUrl);

  // Write storage FIRST — thumbnail appears only after writes are confirmed.
  // This prevents a race where the user clicks Test before cfg.hasVideo is saved.
  _pendingWrite = (async () => {
    try {
      const { cfg } = await chrome.storage.local.get('cfg');
      if (isVideo) {
        await chrome.storage.local.set({ gfgk_videoUrl: dataUrl });
      } else {
        await chrome.storage.local.remove('gfgk_videoUrl');
      }
      await chrome.storage.local.set({
        cfg: {
          ...(cfg ?? {}),
          hasVideo:  isVideo,
          animeMode: isAnime,
          photoB64:  isVideo ? null : dataUrl,
          mediaMeta: { name: file.name, size: file.size, type: file.type },
        }
      });
    } catch (err) {
      console.error('[GFGK] media storage write failed:', err);
    }
  })();

  await _pendingWrite;

  // Show thumbnail only after storage is confirmed written
  if (isVideo) {
    const vid = document.getElementById('mediaThumbVid');
    vid.src = dataUrl; vid.classList.add('show');
    vid.play().catch(() => {});
    document.getElementById('mediaThumbImg').classList.remove('show');
  } else {
    const img = document.getElementById('mediaThumbImg');
    img.src = dataUrl; img.classList.add('show');
    document.getElementById('mediaThumbVid').classList.remove('show');
  }

  const badge = document.getElementById('animeBadge');
  if (badge) badge.style.display = isAnime ? 'inline' : 'none';
});

document.getElementById('mediaClear').addEventListener('click', async () => {
  document.getElementById('mediaThumbImg').classList.remove('show');
  document.getElementById('mediaThumbVid').classList.remove('show');
  document.getElementById('mediaName').textContent = '未上传';
  document.getElementById('mediaSize').textContent = '';
  await chrome.storage.local.remove('gfgk_videoUrl');
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), photoB64: null, hasVideo: false, mediaMeta: null }
  });
});

// ── BGM upload ────────────────────────────────────────────────────────────────

document.getElementById('bgmInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const dataUrl = await fileToDataUrl(file);

  document.getElementById('bgmName').textContent = file.name;
  document.getElementById('bgmSize').textContent = fmtBytes(file.size);

  // BGM stored under a separate key to keep cfg small
  await chrome.storage.local.set({ gfgk_bgmUrl: dataUrl });
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), hasBgm: true, bgmMeta: { name: file.name, size: file.size } }
  });
});

document.getElementById('bgmClear').addEventListener('click', async () => {
  document.getElementById('bgmName').textContent = '未上传';
  document.getElementById('bgmSize').textContent = '';
  await chrome.storage.local.remove('gfgk_bgmUrl');
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), hasBgm: false, bgmMeta: null }
  });
});

// ── save settings ─────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  const { cfg: existing } = await chrome.storage.local.get('cfg');
  const sites = document.getElementById('sites').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  const cfg = {
    ...(existing ?? {}),
    limitMinutes: parseInt(document.getElementById('limitMin').value) || 15,
    breakMinutes: parseInt(document.getElementById('breakMin').value) || 5,
    callerName:   document.getElementById('callerName').value.trim() || '宝贝',
    message:      document.getElementById('message').value || '宝贝说：该休息了 ❤️',
    trackedSites: sites,
  };
  await chrome.storage.local.set({ cfg });
  const msg = document.getElementById('savedMsg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 2000);
});

// ── reset / test ──────────────────────────────────────────────────────────────

const resetBtn = document.getElementById('resetBtn');
resetBtn.addEventListener('click', () => {
  if (resetBtn.dataset.confirm === '1') {
    chrome.runtime.sendMessage({ type: 'reset_all' });
    renderStats({});
    resetBtn.textContent = '重置';
    delete resetBtn.dataset.confirm;
  } else {
    resetBtn.textContent = '确认重置？';
    resetBtn.dataset.confirm = '1';
    setTimeout(() => {
      resetBtn.textContent = '重置';
      delete resetBtn.dataset.confirm;
    }, 3000);
  }
});

document.getElementById('testBtn').addEventListener('click', async () => {
  // Wait for any in-progress media write before triggering the overlay
  await _pendingWrite;
  chrome.runtime.sendMessage({ type: 'test_overlay' });
  window.close();
});

// ── init ──────────────────────────────────────────────────────────────────────

load();
