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
  const { cfg, timeMap } = await chrome.storage.local.get(['cfg', 'timeMap']);

  document.getElementById('limitMin').value   = cfg?.limitMinutes ?? 15;
  document.getElementById('breakMin').value   = cfg?.breakMinutes ?? 5;
  document.getElementById('callerName').value = cfg?.callerName  ?? '';
  document.getElementById('message').value    = cfg?.message ?? '';
  document.getElementById('sites').value      = (cfg?.trackedSites ?? []).join('\n') || DEFAULT_SITES;

  if (cfg?.mediaMeta) restoreMediaLabel(cfg.mediaMeta, cfg);
  if (cfg?.bgmMeta)   restoreBgmLabel(cfg.bgmMeta);

  renderStats(timeMap ?? {});
}

function restoreMediaLabel(meta, cfg) {
  document.getElementById('mediaName').textContent = meta.name;
  document.getElementById('mediaSize').textContent = fmtBytes(meta.size);
  const isVideo = meta.type?.startsWith('video/');
  if (isVideo && cfg?.videoDataUrl) {
    const vid = document.getElementById('mediaThumbVid');
    vid.src = cfg.videoDataUrl; vid.classList.add('show');
    vid.play().catch(() => {});
  } else if (!isVideo && cfg?.photoB64) {
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

document.getElementById('mediaInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const isVideo = file.type.startsWith('video/');

  // Read as data URL — accessible from both popup and content scripts
  const dataUrl = await fileToDataUrl(file);

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

  document.getElementById('mediaName').textContent = file.name;
  document.getElementById('mediaSize').textContent = fmtBytes(file.size);

  const isAnime = !isVideo && await hasAlphaChannel(dataUrl);

  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: {
      ...(cfg ?? {}),
      hasVideo:     isVideo,
      animeMode:    isAnime,
      videoDataUrl: isVideo ? dataUrl : null,
      photoB64:     isVideo ? null    : dataUrl,
      mediaMeta: { name: file.name, size: file.size, type: file.type },
    }
  });

  // Show anime mode badge if detected
  const badge = document.getElementById('animeBadge');
  if (badge) badge.style.display = isAnime ? 'inline' : 'none';
});

document.getElementById('mediaClear').addEventListener('click', async () => {
  document.getElementById('mediaThumbImg').classList.remove('show');
  document.getElementById('mediaThumbVid').classList.remove('show');
  document.getElementById('mediaName').textContent = '未上传';
  document.getElementById('mediaSize').textContent = '';
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), photoB64: null, hasVideo: false, videoDataUrl: null, mediaMeta: null }
  });
});

// ── BGM upload ────────────────────────────────────────────────────────────────

document.getElementById('bgmInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const dataUrl = await fileToDataUrl(file);

  document.getElementById('bgmName').textContent = file.name;
  document.getElementById('bgmSize').textContent = fmtBytes(file.size);

  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), hasBgm: true, bgmDataUrl: dataUrl, bgmMeta: { name: file.name, size: file.size } }
  });
});

document.getElementById('bgmClear').addEventListener('click', async () => {
  document.getElementById('bgmName').textContent = '未上传';
  document.getElementById('bgmSize').textContent = '';
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), hasBgm: false, bgmDataUrl: null, bgmMeta: null }
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

document.getElementById('resetBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ timeMap: {}, breaks: {} });
  chrome.runtime.sendMessage({ type: 'reset_all' });
  renderStats({});
});

document.getElementById('testBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'test_overlay' });
  window.close();
});

// ── init ──────────────────────────────────────────────────────────────────────

load();
