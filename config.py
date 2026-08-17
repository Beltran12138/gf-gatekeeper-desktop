import json
from pathlib import Path

CONFIG_DIR = Path.home() / '.gf_gatekeeper'
CONFIG_FILE = CONFIG_DIR / 'config.json'
PACKS_DIR = CONFIG_DIR / 'packs'

# Emotion packs ------------------------------------------------------------
# Canonical emotions, mapped to real overlay moments:
#   nag     — she appears nagging you (overlay _entrance); the BASE state
#   waiting — break countdown running, impatient (overlay _tick)
#   happy   — you clicked "go rest" (overlay _break_click)
#   bye     — countdown over / emergency exit, waves off (overlay _emergency)
#   angry   — optional, ESC-mashed emergency
# `nag` is the fallback: any missing emotion resolves to it, so a pack that
# only ships one image still renders every moment.
EMOTIONS = ['nag', 'waiting', 'happy', 'bye', 'angry']
BASE_EMOTION = 'nag'

DEFAULTS = {
    'time_limit_minutes': 15,
    'break_minutes': 5,
    'custom_message': '寶貝說：該休息了 ❤️',
    # Media
    'media_list': [],            # List of photo/gif/video paths
    'photo_path': '',            # Legacy single photo (fallback)
    'photo_style': 'circle',     # 'circle' or 'square'
    'media_switch_seconds': 8,   # Seconds before switching to next media
    'active_pack': '',           # id of active emotion pack; '' = legacy media_list
    # Audio
    'bgm_path': '',              # BGM file path (mp3/wav/ogg)
    # Chat
    'chat_command': '',          # Custom command; empty = auto-detect WeChat
    'contact_name': '寶貝',     # Name shown in video-call UI
    # UI mode
    'videocall_ui': False,       # True = WeChat video-call style overlay
    # Tracking
    'tracked_keywords': [
        'Instagram', 'TikTok', 'YouTube', 'Twitter', 'X.com',
        'Reddit', 'Facebook', 'Threads', 'Bluesky', 'Weibo',
        '微博', '抖音', '小红书', 'Douyin',
    ],
}


def load_config():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, encoding='utf-8') as f:
                return {**DEFAULTS, **json.load(f)}
        except Exception:
            pass
    return dict(DEFAULTS)


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# ── Emotion pack loading ────────────────────────────────────────────────────

def _resolve_media(base_dir, entries):
    """Resolve a list of filenames to existing absolute paths.

    Each entry may be relative to the pack dir (the normal case) or already
    absolute (handy for legacy configs). Non-existent files are dropped so the
    overlay never tries to open a missing path.
    """
    out = []
    if not isinstance(entries, list):
        entries = [entries]
    for e in entries:
        if not e:
            continue
        p = Path(e)
        if not p.is_absolute() and base_dir:
            p = Path(base_dir) / e
        if p.exists():
            out.append(str(p))
    return out


def load_pack(pack_dir):
    """Load one pack from <pack_dir>/pack.json into a normalized dict.

    Returns None if the manifest is missing/invalid or resolves to zero media
    (an empty pack can't render, so it's not offered).
    """
    pack_dir = Path(pack_dir)
    manifest = pack_dir / 'pack.json'
    if not manifest.exists():
        return None
    try:
        with open(manifest, encoding='utf-8') as f:
            raw = json.load(f)
    except Exception:
        return None

    emotions = {}
    raw_emotions = raw.get('emotions', {}) or {}
    for emo in EMOTIONS:
        media = _resolve_media(pack_dir, raw_emotions.get(emo, []))
        if media:
            emotions[emo] = media
    if not emotions:
        return None

    bgm = _resolve_media(pack_dir, raw.get('bgm', ''))
    return {
        'id': raw.get('id') or pack_dir.name,
        'name': raw.get('name') or pack_dir.name,
        'author': raw.get('author', ''),
        'style': raw.get('style', 'circle'),
        'dir': str(pack_dir),
        'bgm': bgm[0] if bgm else '',
        'emotions': emotions,
    }


def list_packs():
    """Load every valid pack under ~/.gf_gatekeeper/packs/, sorted by id."""
    if not PACKS_DIR.exists():
        return []
    packs = []
    for child in sorted(PACKS_DIR.iterdir()):
        if child.is_dir():
            pack = load_pack(child)
            if pack:
                packs.append(pack)
    return packs


def legacy_pack(cfg):
    """Synthesize a pack from the old media_list/photo_path config.

    Everything the old overlay rotated through becomes the `nag` emotion, so a
    user who never made a pack keeps the exact behavior they had. Returns None
    if there is no legacy media at all.
    """
    entries = cfg.get('media_list') or []
    if not entries:
        p = cfg.get('photo_path', '')
        entries = [p] if p else []
    media = _resolve_media(None, entries)
    if not media:
        return None
    return {
        'id': 'legacy',
        'name': '（旧配置）',
        'author': '',
        'style': cfg.get('photo_style', 'circle'),
        'dir': '',
        'bgm': cfg.get('bgm_path', ''),
        'emotions': {BASE_EMOTION: media},
    }


def active_pack(cfg):
    """Return the pack the overlay should use, or None if nothing is available.

    Prefers cfg['active_pack'] by id; falls back to the synthesized legacy pack
    when no pack is selected or the selected id is gone.
    """
    want = cfg.get('active_pack', '')
    if want:
        for pack in list_packs():
            if pack['id'] == want:
                return pack
    return legacy_pack(cfg)


def pack_emotion(pack, emotion):
    """Resolve an emotion to a media path list, with graceful fallback.

    emotion → BASE_EMOTION → any non-empty emotion → []. This lets the overlay
    ask for `happy`/`bye`/etc. unconditionally and always get something to show.
    """
    if not pack:
        return []
    emotions = pack.get('emotions', {})
    if emotions.get(emotion):
        return emotions[emotion]
    if emotions.get(BASE_EMOTION):
        return emotions[BASE_EMOTION]
    for emo in EMOTIONS:
        if emotions.get(emo):
            return emotions[emo]
    return []
