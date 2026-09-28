"""Public deployment entry points, using real filesystem and fake service boundaries."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = 'a' * 40


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def archive(self, extra=None, corrupt=False):
        files = {p: b'valid' for p in ('dist/index.html', 'dist/ai-chat/index.html',
                                     'server/start.js', 'server/package-lock.json',
                                     'server/community/lib/mysql.js')}
        manifest = {'commit': SHA, 'files': {p: hashlib.sha256(b).hexdigest() for p, b in files.items()}}
        if corrupt:
            files['dist/index.html'] = b'corrupt'
        files['release.json'] = json.dumps(manifest).encode()
        archive = self.base / 'release.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            for name, data in files.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                out.addfile(entry, io.BytesIO(data))
            if extra:
                out.addfile(extra)
        return archive

    def test_valid_artifact(self):
        deploy.unpack(self.archive(), self.base / 'stage', SHA)
        self.assertEqual((self.base / 'stage/dist/index.html').read_text(), 'valid')

    def test_reject_corruption_and_wrong_commit(self):
        with self.assertRaises(ValueError):
            deploy.unpack(self.archive(corrupt=True), self.base / 'stage', SHA)
        with self.assertRaises(ValueError):
            deploy.unpack(self.archive(), self.base / 'stage2', 'b' * 40)

    def test_reject_traversal_links_and_duplicates(self):
        for name in ('dist/../../escape', '/dist/escape', 'dist/.env', 'dist/index.html'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                deploy.unpack(self.archive(tarfile.TarInfo(name)), self.base / 'stage', SHA)
        link = tarfile.TarInfo('dist/link')
        link.type, link.linkname = tarfile.SYMTYPE, '/etc/passwd'
        with self.assertRaises(ValueError):
            deploy.unpack(self.archive(link), self.base / 'stage', SHA)

    def setup_release(self):
        root, stage, backup = [self.base / p for p in ('root', 'stage', 'backup')]
        files = {'server/community/lib/mysql.js': 'schema', 'server/start.js': 'code',
                 'pocketbase/pb_hooks/pig-king/index.cjs': 'score',
                 'pocketbase/pb_migrations/1.js': 'migration', 'dist/index.html': 'old'}
        for name, data in files.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(data)
        for source, target in (('server', 'community/server'), ('pocketbase/pb_hooks', 'pb/pb_hooks'),
                               ('pocketbase/pb_hooks/pig-king', 'community/pocketbase/pb_hooks/pig-king'),
                               ('pocketbase/pb_migrations', 'app/pocketbase/pb_migrations'), ('dist', 'dist')):
            deploy.shutil.copytree(stage / source, root / target)
        (stage / 'dist/index.html').write_text('new')
        return root, stage, backup

    def test_success_keeps_old_assets_and_does_not_restart_unchanged_services(self):
        root, stage, backup = self.setup_release()
        (root / 'dist/old-hash.js').write_text('old cached asset')
        with patch.object(deploy, 'command') as commands, patch.object(deploy, 'wait_api'), patch.object(deploy, 'verify'):
            deploy.publish(stage, backup, root)
        self.assertEqual((root / 'dist/index.html').read_text(), 'new')
        self.assertEqual((backup / 'dist/index.html').read_text(), 'old')
        self.assertTrue((root / 'dist/old-hash.js').exists())
        commands.assert_not_called()

    def test_failed_health_rolls_back_frontend_and_backend(self):
        root, stage, backup = self.setup_release()
        (stage / 'server/start.js').write_text('new backend')
        with patch.object(deploy, 'command', return_value='node:22') as commands, \
                patch.object(deploy, 'wait_api'), \
                patch.object(deploy, 'verify', side_effect=[ValueError('unhealthy'), None]) as verify:
            with self.assertRaisesRegex(ValueError, 'unhealthy'):
                deploy.publish(stage, backup, root)
        self.assertEqual((root / 'dist/index.html').read_text(), 'old')
        self.assertEqual((root / 'community/server/start.js').read_text(), 'code')
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(sum(c.args == ('docker', 'restart', 'lavamilk-community-api') for c in commands.call_args_list), 2)

    def test_pocketbase_migration_change_stops_before_live_writes(self):
        root, stage, backup = self.setup_release()
        (stage / 'pocketbase/pb_migrations/2.js').write_text('migration')
        with self.assertRaisesRegex(ValueError, 'migrations'):
            deploy.publish(stage, backup, root)
        self.assertFalse(backup.exists())

    def test_schema_change_stops_before_live_writes(self):
        root, stage, backup = self.setup_release()
        (stage / 'server/community/lib/mysql.js').write_text('new schema')
        with self.assertRaisesRegex(ValueError, 'migration'):
            deploy.publish(stage, backup, root)
        self.assertFalse(backup.exists())
        self.assertEqual((root / 'dist/index.html').read_text(), 'old')

    def test_approved_migration_deploys_but_changed_sql_is_rejected(self):
        root, stage, backup = self.setup_release()
        migrations = stage / 'server/migrations'
        migrations.mkdir()
        (migrations / '001.sql').write_text('CREATE TABLE example(id INT)')
        (stage / 'server/community/lib/mysql.js').write_text('verified adapter')
        approval = self.base / 'approved.json'
        approval.write_text(json.dumps({
            'adapter': hashlib.sha256((stage / 'server/community/lib/mysql.js').read_bytes()).hexdigest(),
            'migrations': deploy.tree_hash(migrations)}))
        with patch.object(deploy, 'SCHEMA_APPROVAL', approval), patch.object(deploy, 'command', return_value='node:22'), \
                patch.object(deploy, 'wait_api'), patch.object(deploy, 'verify'):
            deploy.publish(stage, backup, root)
            (migrations / '001.sql').write_text('DROP TABLE example')
            with self.assertRaisesRegex(ValueError, 'Unapproved'):
                deploy.publish(stage, self.base / 'second-backup', root)
            self.assertFalse((self.base / 'second-backup').exists())


if __name__ == '__main__':
    unittest.main()
