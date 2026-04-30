"""Embedded Flask analytics dashboard — runs on http://127.0.0.1:7878"""
import logging
import os
import sys
import threading
import webbrowser

PORT = 7878


def _template_folder() -> str:
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'web', 'templates')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')


try:
    from flask import Flask, jsonify, render_template

    app = Flask(__name__, template_folder=_template_folder())
    logging.getLogger('werkzeug').setLevel(logging.ERROR)

    _tracker = None

    def set_tracker(tracker) -> None:
        global _tracker
        _tracker = tracker

    @app.route('/')
    def dashboard():
        return render_template('dashboard.html')

    @app.route('/api/top')
    def api_top():
        from analytics import top_sites
        return jsonify(top_sites(days=7))

    @app.route('/api/daily')
    def api_daily():
        from analytics import daily_summary
        return jsonify(daily_summary(days=7))

    @app.route('/api/trend')
    def api_trend():
        from analytics import weekly_trend
        return jsonify(weekly_trend())

    @app.route('/api/current')
    def api_current():
        import time as _t
        if _tracker is None:
            return jsonify([])
        site_time, break_end = _tracker.get_stats()
        now = _t.time()
        result = [
            {
                'keyword':  kw,
                'seconds':  sec,
                'on_break': break_end.get(kw, 0) > now,
            }
            for kw, sec in sorted(site_time.items(), key=lambda x: -x[1])
            if sec > 0
        ]
        return jsonify(result)

    _started = False

    def start_server() -> None:
        global _started
        if _started:
            return
        _started = True
        threading.Thread(
            target=lambda: app.run(
                host='127.0.0.1', port=PORT,
                use_reloader=False, threaded=True,
            ),
            daemon=True,
            name='gk-flask',
        ).start()

    def open_dashboard() -> None:
        start_server()
        webbrowser.open(f'http://127.0.0.1:{PORT}')

    HAS_FLASK = True

except ImportError:
    HAS_FLASK = False

    def set_tracker(tracker) -> None:  # type: ignore[misc]
        pass

    def start_server() -> None:  # type: ignore[misc]
        pass

    def open_dashboard() -> None:  # type: ignore[misc]
        import tkinter.messagebox as mb
        mb.showinfo('提示', 'pip install flask 後可使用網頁面板')
