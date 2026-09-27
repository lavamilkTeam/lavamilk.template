#!/usr/bin/env python3
"""Installed administrator-owned SSH receiver. Never executes uploaded shell scripts."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path('/www/wwwroot/lavamilk.club')
STATE = Path('/www/backups/lavamilk/cicd')
MAX_BYTES = 150 * 1024 * 1024


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def unpack(archive, destination, commit):
    """Reject links, traversal, hidden files, duplicate paths and unlisted content."""
    with tarfile.open(archive, 'r:gz') as source:
        members = source.getmembers()
        names = set()
        total = 0
        for item in members:
            path = PurePosixPath(item.name)
            allowed = item.name == 'release.json' or item.name.startswith(
                ('dist/', 'server/', 'pocketbase/pb_hooks/', 'pocketbase/pb_migrations/'))
            if (not item.isfile() or not allowed or path.is_absolute()
                    or any(p.startswith('.') for p in path.parts)
                    or str(path) != item.name or item.name in names):
                raise ValueError(f'Unsafe archive member: {item.name}')
            total += item.size
            if total > MAX_BYTES or len(names) > 20000:
                raise ValueError('Release exceeds size limit')
            names.add(item.name)
        manifest = json.load(source.extractfile('release.json'))
        if manifest['commit'] != commit or set(manifest['files']) != names - {'release.json'}:
            raise ValueError('Manifest commit or file list mismatch')
        required = {'dist/index.html', 'dist/ai-chat/index.html', 'server/start.js',
                    'server/package-lock.json', 'server/community/lib/mysql.js'}
        if not required <= names:
            raise ValueError('Incomplete release')
        for item in members:
            data = source.extractfile(item).read()
            if item.name != 'release.json' and hashlib.sha256(data).hexdigest() != manifest['files'][item.name]:
                raise ValueError(f'Checksum mismatch: {item.name}')
            target = destination / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
    return manifest


def tree_hash(path):
    return {p.relative_to(path).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in path.rglob('*') if p.is_file() and 'node_modules' not in p.parts and 'tests' not in p.parts}


def replace_tree(source, target):
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def verify(dist):
    # Resolve locally while retaining TLS SNI and Host; avoids DNS/CDN ambiguity.
    def fetch(path):
        return subprocess.check_output(['curl', '--fail', '--silent', '--show-error',
                                       '--max-time', '15', '--resolve', 'lavamilk.club:443:127.0.0.1',
                                       'https://lavamilk.club' + path])
    for path in ('/', '/docs', '/pig-king', '/ai-agent'):
        if fetch(path) != (dist / 'index.html').read_bytes():
            raise ValueError(f'Wrong SPA response: {path}')
    if (dist / 'ai-chat/index.html').exists() and fetch('/ai-chat/') != (dist / 'ai-chat/index.html').read_bytes():
        raise ValueError('Wrong AI application response')
    for directory in ('assets', 'ai-chat/assets'):
        for path in (dist / directory).rglob('*'):
            if path.is_file() and fetch('/' + path.relative_to(dist).as_posix()) != path.read_bytes():
                raise ValueError(f'Asset mismatch: {path.name}')
    health = json.loads(fetch('/api/pig-king/health'))
    if health.get('status') != 'ok' or health.get('database') != 'mysql':
        raise ValueError('Community health check failed')
    fetch('/api/health')
    for prefix in ('assets', 'ai-chat/assets'):
        status = command('curl', '--silent', '--max-time', '15', '--output', '/dev/null',
                         '--write-out', '%{http_code}', '--resolve', 'lavamilk.club:443:127.0.0.1',
                         f'https://lavamilk.club/{prefix}/__deploy_missing__.js')
        if status != '404':
            raise ValueError(f'Missing asset returned {status}: {prefix}')


def wait_api():
    for _ in range(30):
        try:
            for port, path in ((8091, '/api/pig-king/health'), (8090, '/api/health')):
                with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=3) as response:
                    if response.status != 200:
                        raise ValueError('Health check failed')
            return
        except (OSError, ValueError):
            time.sleep(1)
    raise RuntimeError('Services did not become healthy')


def publish(stage, backup, root=ROOT):
    """Deploy runtime files and assets, restoring files/services on verification failure."""
    # Schema changes require a separately reviewed migration with a data backup.
    if (stage / 'server/community/lib/mysql.js').read_bytes() != (root / 'community/server/community/lib/mysql.js').read_bytes():
        raise ValueError('MySQL schema adapter changed; deploy its migration manually first')
    if tree_hash(stage / 'pocketbase/pb_migrations') != tree_hash(root / 'app/pocketbase/pb_migrations'):
        raise ValueError('PocketBase migrations changed; deploy manually first')
    backend = tree_hash(stage / 'server') != tree_hash(root / 'community/server')
    scoring = tree_hash(stage / 'pocketbase/pb_hooks/pig-king') != tree_hash(root / 'community/pocketbase/pb_hooks/pig-king')
    hooks = tree_hash(stage / 'pocketbase/pb_hooks') != tree_hash(root / 'pb/pb_hooks')
    if backend:
        image = command('docker', 'inspect', '--format', '{{.Config.Image}}', 'lavamilk-community-api')
        # Install as an unprivileged user; no production environment, lifecycle scripts or Docker socket.
        command('chmod', '-R', 'a+rX', str(stage))
        command('chown', '-R', '1000:1000', str(stage / 'server'))
        command('docker', 'run', '--rm', '--user', '1000:1000', '--cap-drop=ALL',
                '--security-opt=no-new-privileges', '--mount', f'type=bind,src={stage / "server"},dst=/app',
                '--workdir', '/app', '--env', 'npm_config_cache=/tmp/npm', image,
                'npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund')
    targets = [('dist', 'dist')]
    if backend:
        targets.append(('server', 'community/server'))
    if scoring:
        targets.append(('pocketbase/pb_hooks/pig-king', 'community/pocketbase/pb_hooks/pig-king'))
    if hooks:
        targets.append(('pocketbase/pb_hooks', 'pb/pb_hooks'))
    # All backups finish before the first mutation.
    for _, relative in targets:
        shutil.copytree(root / relative, backup / relative)
    (backup / 'restore.json').write_text(json.dumps({'targets': targets, 'api': backend or scoring, 'pb': hooks}))
    try:
        for source, relative in targets[1:]:
            replace_tree(stage / source, root / relative)
        if hooks:
            command('chown', '-R', 'www:www', str(root / 'pb/pb_hooks'))
            command('systemctl', 'restart', 'lavamilk-pb')
        if backend or scoring:
            command('docker', 'restart', 'lavamilk-community-api')
        wait_api()
        # Keep old hashed assets for already-open browser tabs. Switch entry HTML last.
        for path in (stage / 'dist').rglob('*'):
            if path.is_file() and path.name != 'index.html':
                target = root / 'dist' / path.relative_to(stage / 'dist')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
        for path in sorted((stage / 'dist').rglob('index.html'), key=lambda p: len(p.parts), reverse=True):
            target = root / 'dist' / path.relative_to(stage / 'dist')
            target.parent.mkdir(parents=True, exist_ok=True)
            pending = target.with_suffix('.pending')
            shutil.copy2(path, pending)
            pending.replace(target)
        verify(stage / 'dist')
    except BaseException:
        restore(backup, root)
        raise


def restore(backup, root=ROOT):
    record = json.loads((backup / 'restore.json').read_text())
    for _, relative in record['targets']:
        if relative == 'dist':
            # Copy back old files without removing hashed assets still in use.
            for page in (root / relative).rglob('index.html'):
                if not (backup / relative / page.relative_to(root / relative)).exists():
                    page.unlink()
            shutil.copytree(backup / relative, root / relative, dirs_exist_ok=True)
        else:
            replace_tree(backup / relative, root / relative)
    if record['pb']:
        command('chown', '-R', 'www:www', str(root / 'pb/pb_hooks'))
        command('systemctl', 'restart', 'lavamilk-pb')
    if record['api']:
        command('docker', 'restart', 'lavamilk-community-api')
    wait_api()
    verify(backup / 'dist')
    print('Previous release restored and verified', flush=True)


def main():
    def interrupted(signum, _frame):
        raise RuntimeError(f'Deployment interrupted by signal {signum}')
    for signum in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, interrupted)
    os.umask(0o022)
    # Forced-command key permits only this protocol, not shell/SFTP/forwarding.
    match = re.fullmatch(r'deploy ([0-9a-f]{40}) ([1-9][0-9]*)', os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if not match:
        raise ValueError('Expected deploy COMMIT RUN_NUMBER')
    commit, run = match.groups()
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = STATE / 'current.json'
        if current.exists() and int(json.loads(current.read_text())['run']) >= int(run):
            raise ValueError('Refusing stale or duplicate workflow run')
        with tempfile.TemporaryDirectory(prefix='incoming-', dir=STATE) as incoming:
            work = Path(incoming)
            archive = work / 'release.tar.gz'
            with archive.open('wb') as output:
                size = 0
                while chunk := sys.stdin.buffer.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError('Archive exceeds size limit')
                    output.write(chunk)
            stage = work / 'stage'
            manifest = unpack(archive, stage, commit)
            command('nginx', '-t')
            backup = STATE / f'{run}-{commit[:12]}-{time.time_ns()}'
            backup.mkdir(mode=0o700)
            publish(stage, backup)
            record = {'commit': commit, 'run': int(run), 'backup': str(backup)}
            (backup / 'deployed.json').write_text(json.dumps(record))
            pending = current.with_suffix('.pending')
            pending.write_text(json.dumps(record))
            pending.replace(current)
            print(f'Deployed {manifest["commit"]}; rollback: {backup}', flush=True)


if __name__ == '__main__':
    main()
