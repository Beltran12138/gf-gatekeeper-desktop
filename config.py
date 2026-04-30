import json
from pathlib import Path

CONFIG_DIR = Path.home() / '.gf_gatekeeper'
CONFIG_FILE = CONFIG_DIR / 'config.json'

DEFAULTS = {
    'time_limit_minutes': 15,
    'break_minutes': 5,
    'custom_message': '寶貝說：該休息了 ❤️',
    # Media
    'media_list': [],            # List of photo/gif/video paths
    'photo_path': '',            # Legacy single photo (fallback)
    'photo_style': 'circle',     # 'circle' or 'square'
    'media_switch_seconds': 8,   # Seconds before switching to next media
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
