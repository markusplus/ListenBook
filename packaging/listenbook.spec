# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


# PyInstaller exposes SPECPATH as the directory containing this spec file.
ROOT = Path(SPECPATH).resolve().parent


def bundled_directory(name):
    source = ROOT / name
    return (str(source), name) if source.is_dir() else None


datas = [
    (str(ROOT / 'index.html'), '.'),
    (str(ROOT / 'manifest.webmanifest'), '.'),
]
for directory in ('css', 'scripts', 'resources', 'default_audios'):
    item = bundled_directory(directory)
    if item:
        datas.append(item)


a = Analysis(
    [str(ROOT / 'listenbook_server.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ListenBook',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
)
