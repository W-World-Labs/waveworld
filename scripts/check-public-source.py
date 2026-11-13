#!/usr/bin/env python3
"""Metadata-only source boundary gate; never imports application code."""
import json
from pathlib import Path
import re
import subprocess
import unicodedata

ROOT = Path(__file__).resolve().parents[1]

def main():
    expected = json.loads((ROOT / 'public-source-files.json').read_text())['files']
    rows = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=ROOT).decode().split('\0')
    actual, normalized, total = [], {}, 0
    for row in filter(None, rows):
        meta, name = row.split('\t', 1)
        mode, _, stage = meta.split()
        path = ROOT / name
        if mode not in {'100644', '100755'} or stage != '0' or not path.is_file() or path.is_symlink():
            raise ValueError('Only regular reviewed source files allowed: ' + name)
        parts = Path(name).parts
        if any(x in {'node_modules', '.next', '.git', '.runtime', '.gitea', '.grok', '.hive', '.loop', 'dist'} for x in parts):
            raise ValueError('Unreviewed runtime/cache/control path: ' + name)
        if name.startswith(('deploy/', 'quarantine/')) or (Path(name).name.startswith('.env') and not name.endswith('.example')):
            raise ValueError('Private operations/environment path: ' + name)
        size = path.stat().st_size
        if size > 10 * 1024 * 1024:
            raise ValueError('Source blob exceeds10MiB: ' + name)
        total += size
        for i in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:i])
            key = unicodedata.normalize('NFC', prefix).casefold()
            if key in normalized and normalized[key] != prefix:
                raise ValueError('NFC/case path collision')
            normalized[key] = prefix
        actual.append(name)
    if sorted(actual) != expected or total > 100 * 1024 * 1024:
        raise ValueError('Source allowlist/size differs from reviewed boundary')
    if not (ROOT / 'LICENSE').read_text().startswith('MIT License\n') or not (ROOT / 'THIRD-PARTY-NOTICES.md').is_file():
        raise ValueError('Own/third-party license boundary missing')
    manifest = json.loads((ROOT / 'vendor/w-sim/manifest.json').read_text())
    if manifest['source']['repository'] not in {'W-World-Labs/w-sim', 'https://github.com/W-World-Labs/w-sim'}:
        raise ValueError('W-Sim must identify reviewed public source')
    if not re.fullmatch('[0-9a-f]{40}', manifest['source']['revision']) or manifest['source'].get('workingTreeClean') is not True:
        raise ValueError('W-Sim immutable clean source identity missing')
    print(f'Reviewed source: {len(actual)} files, {total} bytes')

if __name__ == '__main__':
    main()
