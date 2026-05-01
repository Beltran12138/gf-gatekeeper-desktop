# Chrome Web Store Listing — Girlfriend Gatekeeper

## Category
Productivity

## Language
English (primary) — add zh-CN translation in "Additional languages"

---

## Name (≤45 chars)
```
Girlfriend Gatekeeper
```

## Short Description (≤132 chars)
```
Set time limits on social media. When you scroll too long, your girlfriend's photo fills the screen as a reminder.
```
*(112 chars)*

---

## Full Description

```
💕 Girlfriend Gatekeeper — your most personal screen-time manager.

Set a daily time limit (default: 15 minutes) for any social media site. The moment you go over, your girlfriend's photo, GIF, or video fills the screen in a beautiful full-screen reminder — so you actually stop scrolling.

HOW IT WORKS
1. Upload your girlfriend's photo, GIF, or video
2. Set your time limit (e.g. 15 min for Instagram)
3. Browse normally — the extension tracks time in the background
4. When time's up, a full-screen reminder appears
5. Take a 5-minute break → timer resets → back to normal

THREE REMINDER STYLES — automatic based on what you upload:
• Photo / GIF → "Love notification" style: circular avatar with a pulsing heart ring, blurred background, glassmorphism message card
• Video (MP4) → WeChat video-call style: full-screen video background with caller name and action bar
• Transparent PNG (anime / mascot) → Floating character mode: your character floats with a glowing aura and speech bubble

FEATURES
✓ Tracks any website — add custom domains beyond the defaults
✓ Background music — upload a separate MP3/WAV to play during the reminder
✓ Caller name & custom message — fully personalized
✓ 5-minute warning notification before you hit the limit
✓ Break-end notification when your break is over and tracking resumes
✓ Mute button — silences both the overlay and all page audio
✓ Daily stats — see your top 8 sites by time spent today
✓ Emergency exit — press ESC at any time

PRIVACY FIRST
All data stays on your device. Zero network requests. No analytics. No accounts.
Your photos and videos never leave your browser.

DEFAULT TRACKED SITES
Instagram · TikTok · YouTube · Twitter/X · Reddit · Facebook · Threads
Weibo · Douyin · Xiaohongshu · Bilibili · Twitch · Pinterest
(Add or remove any site in settings)

Inspired by catgatekeeper.org — for people whose motivation is more personal than a cat.
```

---

## Permission Justifications
*(Paste into CWS Developer Dashboard → Privacy practices → Permissions justification)*

**tabs**
The extension queries all open browser tabs to find which ones match the user's configured social media sites, and sends the time-limit overlay message to all affected tabs simultaneously. Without this permission, the overlay cannot appear on tabs the user has open in the background.

**activeTab**
Required to show a test overlay on the currently active tab when the user clicks the "🧪 Test" button in the extension popup, so users can preview their reminder before a real time limit is hit.

**scripting**
After a Chrome extension update, previously injected content scripts become orphaned and can no longer receive messages. This permission allows the extension to re-inject the content script into affected tabs automatically, ensuring overlays continue to appear without requiring the user to manually refresh every open tab.

**storage**
Used to persist the user's settings (time limits, tracked sites, caller name, message), uploaded media (photo/video/audio as base64 data URLs), daily usage counters, and break state — all stored exclusively on the user's local device.

**unlimitedStorage**
Users upload photos, GIF images, and MP4 videos as their reminder media. These files are converted to base64 data URLs and stored in chrome.storage.local for access by both the popup and content scripts. Video files can easily exceed Chrome's default 10 MB storage quota; this permission removes that limit so large media files can be stored reliably.

**alarms**
The extension uses a 1-minute periodic alarm (the minimum interval allowed by Chrome's MV3 alarms API) to accumulate time spent on tracked sites while the service worker is in its normal sleep state. Without this alarm, time tracking would stop whenever the service worker sleeps between tab events.

**notifications**
Used to show two types of system notifications: (1) a warning 5 minutes before the user reaches their time limit on a site, giving them advance notice; and (2) a confirmation when a break period ends and time tracking resumes. Both notifications are informational only and require no user interaction.

**Host permission: <all_urls>**
Users can add any website to their personally configured list of tracked sites — not just the defaults. The extension must be able to inject the reminder overlay (a content script) on any domain the user specifies. Restricting host permissions to a fixed list would prevent users from tracking custom or regional social media sites.

---

## Screenshots Needed (1280×800 or 640×400)

1. **Popup settings UI** — showing the media upload card, time settings, and stats
2. **Photo reminder overlay** — circular avatar with pulse ring, blurred background
3. **Video call overlay** — full-screen video, caller name bar, action buttons
4. **Anime/character overlay** — floating PNG with speech bubble on dark background
5. **Pre-limit system notification** — "⏰ 还有 5 分钟就超时了"

## Promotional Tile (440×280)
- Dark background (#0f0f18)
- Pink accent (#ff6b9d)
- Extension name + tagline: "Your most personal screen-time manager"

---

## Privacy Policy URL
Host `store-assets/privacy-policy.html` on GitHub Pages:
`https://beltran12138.github.io/gf-gatekeeper-desktop/privacy-policy.html`

Enable GitHub Pages in repo Settings → Pages → Source: main branch / root (or /docs folder).
Copy privacy-policy.html to repo root or /docs/ accordingly.
