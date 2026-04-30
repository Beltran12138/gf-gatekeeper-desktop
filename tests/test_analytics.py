"""Tests for analytics.py SQLite layer."""
import pytest
from pathlib import Path
from unittest.mock import patch
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import analytics


@pytest.fixture
def db(tmp_path):
    """Redirect DB to a temp file for each test."""
    with patch.object(analytics, 'DB_PATH', tmp_path / 'test.db'):
        analytics.init_db()
        yield


def test_init_creates_table(tmp_path):
    with patch.object(analytics, 'DB_PATH', tmp_path / 'test.db'):
        analytics.init_db()
        con = analytics._conn()
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        assert 'sessions' in tables


def test_log_and_top_sites(db):
    analytics.log_session('Instagram', 300, triggered=True)
    analytics.log_session('TikTok', 120, triggered=False)
    analytics.log_session('Instagram', 60, triggered=False)

    rows = analytics.top_sites(days=7)
    assert rows[0]['keyword'] == 'Instagram'
    assert rows[0]['total_seconds'] == 360
    assert rows[0]['triggers'] == 1
    assert rows[1]['keyword'] == 'TikTok'


def test_log_skips_zero_seconds(db):
    analytics.log_session('YouTube', 0, triggered=False)
    assert analytics.top_sites(days=7) == []


def test_daily_summary(db):
    analytics.log_session('YouTube', 600, triggered=True)
    summary = analytics.daily_summary(days=1)
    assert len(summary) == 1
    assert summary[0]['total_seconds'] == 600
    assert summary[0]['keyword'] == 'YouTube'


def test_weekly_trend(db):
    analytics.log_session('Reddit', 100, triggered=False)
    trend = analytics.weekly_trend()
    assert len(trend) >= 1
    assert trend[-1]['total_seconds'] == 100


def test_top_sites_empty(db):
    assert analytics.top_sites(days=7) == []


def test_multiple_days_aggregation(db):
    analytics.log_session('Twitter', 200, triggered=False)
    analytics.log_session('Twitter', 300, triggered=True)
    rows = analytics.top_sites(days=7)
    assert rows[0]['total_seconds'] == 500
    assert rows[0]['triggers'] == 1
