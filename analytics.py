import sqlite3
from pathlib import Path
from typing import Any

DB_PATH = Path.home() / '.gf_gatekeeper' / 'analytics.db'


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    with _conn() as con:
        con.execute('''CREATE TABLE IF NOT EXISTS sessions (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword   TEXT    NOT NULL,
            seconds   INTEGER NOT NULL,
            date      TEXT    NOT NULL DEFAULT (date('now')),
            triggered INTEGER NOT NULL DEFAULT 0
        )''')
        con.execute('CREATE INDEX IF NOT EXISTS idx_date ON sessions(date)')


def log_session(keyword: str, seconds: int, triggered: bool) -> None:
    if seconds <= 0:
        return
    with _conn() as con:
        con.execute(
            "INSERT INTO sessions (keyword, seconds, triggered) VALUES (?,?,?)",
            (keyword, seconds, int(triggered)),
        )


def top_sites(days: int = 7) -> list[dict[str, Any]]:
    with _conn() as con:
        rows = con.execute('''
            SELECT keyword,
                   SUM(seconds)   AS total_seconds,
                   SUM(triggered) AS triggers
            FROM   sessions
            WHERE  date >= date('now', ?)
            GROUP  BY keyword
            ORDER  BY total_seconds DESC
            LIMIT  10
        ''', (f'-{days} days',)).fetchall()
    return [dict(r) for r in rows]


def daily_summary(days: int = 7) -> list[dict[str, Any]]:
    with _conn() as con:
        rows = con.execute('''
            SELECT date,
                   keyword,
                   SUM(seconds)   AS total_seconds,
                   SUM(triggered) AS triggers
            FROM   sessions
            WHERE  date >= date('now', ?)
            GROUP  BY date, keyword
            ORDER  BY date, total_seconds DESC
        ''', (f'-{days} days',)).fetchall()
    return [dict(r) for r in rows]


def weekly_trend() -> list[dict[str, Any]]:
    with _conn() as con:
        rows = con.execute('''
            SELECT date,
                   SUM(seconds) AS total_seconds,
                   COUNT(*)     AS sessions
            FROM   sessions
            WHERE  date >= date('now', '-14 days')
            GROUP  BY date
            ORDER  BY date
        ''').fetchall()
    return [dict(r) for r in rows]
