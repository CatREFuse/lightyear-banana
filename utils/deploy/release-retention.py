"""Deployment-owned snapshot retention; invoked under the existing deploy lock."""
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import unquote, urlsplit


def literal_directory(value):
    path = Path(value)
    if not path.is_absolute() or not path.is_dir() or path.resolve() != path:
        raise ValueError('Expected a literal absolute directory: ' + str(path))
    return path


def copy_downloads(source, destination):
    source = literal_directory(source)
    destination = literal_directory(destination)
    pending = ['latest.json']
    selected = {}
    while pending:
        name = pending.pop()
        if name in selected:
            continue
        if not name or any(part in ('', '.', '..') for part in name.split('/')) or name.startswith('/'):
            raise ValueError('Unsafe referenced download: ' + name)
        path = source / name
        if not path.is_file() or path.resolve() != path:
            raise ValueError('Missing or non-literal referenced download: ' + name)
        selected[name] = path
        if path.suffix == '.json':
            def references(value, key=''):
                if isinstance(value, dict):
                    for child_key, child in value.items():
                        if child_key.lower() == 'filename' and isinstance(value.get('url'), str):
                            continue
                        references(child, child_key)
                elif isinstance(value, list):
                    for child in value:
                        references(child, key)
                elif isinstance(value, str):
                    url = urlsplit(value)
                    decoded = unquote(url.path)
                    if decoded.startswith('/releases/'):
                        pending.append(decoded[len('/releases/'):])
                    elif key.lower() in ('url', 'path', 'file', 'filename', 'downloadurl', 'checksumurl') and not url.scheme and decoded:
                        pending.append(decoded[len('releases/'):] if decoded.startswith('releases/') else decoded)
            references(json.loads(path.read_text()))
    # Validate the complete reference graph before copying any file.
    for name, path in selected.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


def prune(root, expected_current, kind, incoming=None):
    root = literal_directory(root)
    releases = literal_directory(root / 'releases')
    current = root / 'current'
    expected = Path(expected_current)
    if not current.is_symlink() or os.readlink(current) != str(expected):
        raise ValueError('Deployment superseded or current is not a symlink; nothing removed')
    if expected.parent != releases:
        raise ValueError('Current is outside the direct releases directory')
    literal_directory(expected)
    marker = {'site': 'site-release.json', 'webui': 'release.json'}[kind]
    if not (expected / marker).is_file():
        raise ValueError('Current release metadata is missing')
    obsolete = []
    for path in releases.iterdir():
        if path == expected:
            continue
        # Fail closed before removing anything if the release root contains unknown data.
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', path.name) or '..' in path.name:
            raise ValueError('Unrecognized release directory: ' + str(path))
        literal_directory(path)
        if not (path / marker).is_file():
            raise ValueError('Unrecognized release metadata: ' + str(path))
        obsolete.append(path)
    previous = root / 'previous'
    if previous.exists() or previous.is_symlink():
        if not previous.is_symlink() or Path(os.readlink(previous)).parent != releases:
            raise ValueError('Unsafe previous link')
    temporary = None
    if incoming:
        temporary = Path(incoming)
        if temporary.parent != root / '.incoming':
            raise ValueError('Cleanup must address this deployment incoming directory')
        literal_directory(temporary.parent)
        if temporary.exists() or temporary.is_symlink():
            literal_directory(temporary)
    stale_assets = []
    if kind == 'webui':
        assets = literal_directory(root / 'assets')
        current_assets = literal_directory(expected / 'assets')
        for path in assets.rglob('*'):
            if path.is_symlink():
                raise ValueError('Shared assets contain a symlink')
            if path.is_file() and not (current_assets / path.relative_to(assets)).is_file():
                stale_assets.append(path)
    # Caller holds the same lock used by activation. All destructive targets are validated above.
    if previous.is_symlink():
        previous.unlink()
    for path in obsolete:
        shutil.rmtree(path)
    for path in stale_assets:
        path.unlink()
    if temporary and temporary.exists():
        shutil.rmtree(temporary)
    print('Retention complete: only current release retained')


if __name__ == '__main__':
    if sys.argv[1] == 'copy-downloads':
        copy_downloads(*sys.argv[2:])
    elif sys.argv[1] == 'prune':
        prune(*sys.argv[2:])
    else:
        raise ValueError('Unknown retention operation')
