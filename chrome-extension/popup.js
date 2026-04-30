const DEFAULT_SITES = [
  'instagram.com','tiktok.com','youtube.com','twitter.com','x.com',
  'reddit.com','facebook.com','threads.net','weibo.com','douyin.com',
  'xiaohongshu.com','bilibili.com','twitch.tv','pinterest.com',
].join('\n');

function fmtBytes(b) {
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ── load saved state ──────────────────────────────────────────────────────────

async function load() {
  const { cfg, timeMap } = await chrome.storage.local.get(['cfg', 'timeMap']);

  document.getElementById('limitMin').value = cfg?.limitMinutes ?? 15;
  document.getElementById('breakMin').value = cfg?.breakMinutes ?? 5;
  document.getElementById('message').value  = cfg?.message ?? '';
  document.getElementById('sites').value    = (cfg?.trackedSites ?? []).join('\n') || DEFAULT_SITES;

  // Restore media labels from saved meta
  if (cfg?.mediaMeta) restoreMediaLabel(cfg.mediaMeta);
  if (cfg?.bgmMeta)   restoreBgmLabel(cfg.bgmMeta);

  renderStats(timeMap ?? {});
}

function restoreMediaLabel(meta) {
  document.getElementById('mediaName').textContent = meta.name;
  document.getElementById('mediaSize').textContent = fmtBytes(meta.size);
  const isVideo = meta.type.startsWith('video/');
  if (isVideo) {
    mediaLoad('main_media').then(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const vid = document.getElementById('mediaThumbVid');
      vid.src = url; vid.classList.add('show');
      vid.play().catch(() => {});
    });
  } else if (meta.photoB64) {
    const img = document.getElementById('mediaThumbImg');
    img.src = meta.photoB64; img.classList.add('show');
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

  // Store blob in IndexedDB
  await mediaSave('main_media', file);

  // For photos: also store base64 for quick preview / legacy path
  let photoB64 = null;
  if (!isVideo) {
    photoB64 = await new Promise(res => {
      const r = new FileReader();
      r.onload = ev => res(ev.target.result);
      r.readAsDataURL(file);
    });
    const img = document.getElementById('mediaThumbImg');
    img.src = photoB64; img.classList.add('show');
    document.getElementById('mediaThumbVid').classList.remove('show');
  } else {
    const url = URL.createObjectURL(file);
    const vid = document.getElementById('mediaThumbVid');
    vid.src = url; vid.classList.add('show');
    vid.play().catch(() => {});
    document.getElementById('mediaThumbImg').classList.remove('show');
  }

  document.getElementById('mediaName').textContent = file.name;
  document.getElementById('mediaSize').textContent = fmtBytes(file.size);

  // Save meta to chrome.storage.local
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: {
      ...(cfg ?? {}),
      photoB64: isVideo ? null : photoB64,
      hasVideo: isVideo,
      mediaMeta: { name: file.name, size: file.size, type: file.type, photoB64: isVideo ? null : photoB64 },
    }
  });
});

document.getElementById('mediaClear').addEventListener('click', async () => {
  await mediaDelete('main_media');
  document.getElementById('mediaThumbImg').classList.remove('show');
  document.getElementById('mediaThumbVid').classList.remove('show');
  document.getElementById('mediaName').textContent = '未上传';
  document.getElementById('mediaSize').textContent = '';
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({ cfg: { ...(cfg ?? {}), photoB64: null, hasVideo: false, mediaMeta: null } });
});

// ── BGM upload ────────────────────────────────────────────────────────────────

document.getElementById('bgmInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  await mediaSave('bgm', file);

  document.getElementById('bgmName').textContent = file.name;
  document.getElementById('bgmSize').textContent = fmtBytes(file.size);

  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({
    cfg: { ...(cfg ?? {}), hasBgm: true, bgmMeta: { name: file.name, size: file.size } }
  });
});

document.getElementById('bgmClear').addEventListener('click', async () => {
  await mediaDelete('bgm');
  document.getElementById('bgmName').textContent = '未上传';
  document.getElementById('bgmSize').textContent = '';
  const { cfg } = await chrome.storage.local.get('cfg');
  await chrome.storage.local.set({ cfg: { ...(cfg ?? {}), hasBgm: false, bgmMeta: null } });
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
