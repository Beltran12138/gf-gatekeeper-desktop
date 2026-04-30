# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Girlfriend Gatekeeper.

Build:
    pip install pyinstaller
    pyinstaller build.spec
Output: dist/GirlfriendGatekeeper.exe
"""

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('web/templates', 'web/templates'),
    ],
    hiddenimports=[
        # pygame
        'pygame._view',
        'pygame.mixer',
        'pygame.mixer_music',
        # PIL / Pillow
        'PIL._tkinter_finder',
        'PIL.ImageTk',
        # pystray
        'pystray._win32',
        # flask + deps
        'flask',
        'werkzeug',
        'jinja2',
        'click',
        'itsdangerous',
        # matplotlib
        'matplotlib',
        'matplotlib.backends.backend_tkagg',
        'matplotlib.backends.backend_agg',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'cv2',        # optional video — exclude to keep size small
        'tkinter.test',
        'unittest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='GirlfriendGatekeeper',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,       # windowed — no terminal window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,           # replace with 'icon.ico' if you have one
)
