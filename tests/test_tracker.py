"""Tests for tracker.py logic (no Windows API calls)."""
import sys, os
import time
import threading
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


def _make_tracker(limit_min=1, keywords=None):
    """Return (tracker, events_list) with ctypes patched out."""
    from tracker import WindowTracker
    events: list[str] = []
    cfg = {
        'time_limit_minutes': limit_min,
        'break_minutes': 1,
        'tracked_keywords': keywords or ['YouTube', 'TikTok'],
    }
    t = WindowTracker(
        config_getter=lambda: cfg,
        on_limit_reached=lambda k: events.append(k),
    )
    return t, events


def test_match_finds_keyword():
    from tracker import WindowTracker
    t, _ = _make_tracker()
    assert t._match('YouTube - Google Chrome', {'tracked_keywords': ['YouTube']}) == 'YouTube'


def test_match_case_insensitive():
    from tracker import WindowTracker
    t, _ = _make_tracker()
    assert t._match('youtube shorts', {'tracked_keywords': ['YouTube']}) == 'YouTube'


def test_match_returns_none_for_unknown():
    from tracker import WindowTracker
    t, _ = _make_tracker()
    assert t._match('Microsoft Word', {'tracked_keywords': ['YouTube']}) is None


def test_get_stats_initially_empty():
    t, _ = _make_tracker()
    st, be = t.get_stats()
    assert st == {}
    assert be == {}


def test_reset_clears_state():
    t, _ = _make_tracker()
    t._site_time['YouTube'] = 500
    t._triggered.add('YouTube')
    t.reset_all()
    st, be = t.get_stats()
    assert st == {}
    assert 'YouTube' not in t._triggered


def test_start_break_resets_site_time():
    t, _ = _make_tracker()
    t._site_time['TikTok'] = 120
    t._triggered.add('TikTok')
    with patch('tracker.log_session'):
        t.start_break('TikTok')
    assert t._site_time.get('TikTok', 0) == 0
    assert 'TikTok' not in t._triggered
    assert 'TikTok' in t._break_end


def test_start_break_sets_end_timestamp():
    t, _ = _make_tracker()
    t._site_time['TikTok'] = 60
    before = time.time()
    with patch('tracker.log_session'):
        t.start_break('TikTok')
    after = time.time()
    end = t._break_end.get('TikTok', 0)
    assert before + 58 <= end <= after + 62  # ~1 min break
