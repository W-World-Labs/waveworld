#!/usr/bin/env python3
"""Archive exact reviewed Git source, never installed/generated runtime files."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def main():
    output = Path(sys.argv[1]).resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError('Output must be outside source')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Output must be empty')
    files = json.loads((ROOT / 'public-source-files.json').read_text())['files']
    raw = git('archive', '--format=tar', 'HEAD')
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        actual = {}
        for item in archive.getmembers():
            if item.issym() or item.islnk() or item.name.startswith('/') or '..' in Path(item.name).parts:
                raise ValueError('Unsafe source archive path')
            if item.isfile():
                if item.name in actual:
                    raise ValueError('Duplicate source archive file')
                actual[item.name] = item
        if set(actual) != set(files):
            raise ValueError('Source artifact closure differs')
        for name in files:
            if archive.extractfile(actual[name]).read() != git('show', 'HEAD:' + name):
                raise ValueError('Source artifact bytes differ: ' + name)
    (output / 'waveworld-source.tar.gz').write_bytes(gzip.compress(raw, mtime=0))
    metadata = {'source_commit': git('rev-parse', 'HEAD').decode().strip(),
                'source_tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
                'repository': os.environ['GITHUB_REPOSITORY'], 'files': len(files),
                'scope': 'reviewed source and declared hash-pinned dependency/data inputs',
                'installed_node_modules': False, 'generated_waveworld_app_or_native_binaries': False,
                'runtime_user_or_review_data': False}
    if metadata['source_commit'] != os.environ['GITHUB_SHA']:
        raise ValueError('CI source commit differs')
    (output / 'SOURCE.json').write_text(json.dumps(metadata, sort_keys=True) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in sorted(output.iterdir()) if p.is_file()))
    print('Verified exact-commit source archive closure:', len(files))

if __name__ == '__main__':
    main()
