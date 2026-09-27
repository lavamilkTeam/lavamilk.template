#!/usr/bin/env python3
"""Package only built assets and Git-tracked runtime files (no credentials/data)."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile


def main():
    output = Path(sys.argv[1]).resolve()
    subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--'], check=True)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    tracked = subprocess.check_output(['git', 'ls-files', '-z', 'server',
                                      'pocketbase/pb_hooks', 'pocketbase/pb_migrations']).decode().split('\0')
    files = [Path(p) for p in tracked if p and '/tests/' not in p]
    files += sorted(p for p in Path('dist').rglob('*') if p.is_file())
    assert Path('dist/index.html') in files and Path('dist/ai-chat/index.html') in files
    manifest = {}
    with tarfile.open(output, 'w:gz') as archive:
        for path in files:
            if path.is_symlink() or any(p.startswith('.') for p in path.parts):
                raise ValueError(f'Unexpected file: {path}')
            content = path.read_bytes()
            manifest[path.as_posix()] = hashlib.sha256(content).hexdigest()
            entry = tarfile.TarInfo(path.as_posix())
            entry.size, entry.mode = len(content), 0o644
            archive.addfile(entry, io.BytesIO(content))
        content = json.dumps({'commit': sha, 'files': manifest}, sort_keys=True).encode()
        entry = tarfile.TarInfo('release.json')
        entry.size = len(content)
        archive.addfile(entry, io.BytesIO(content))
    print(f'Packaged {len(files)} files for {sha}')


if __name__ == '__main__':
    main()
