from copy import deepcopy
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import release_gate as gate
import prepare_consolidated_release as preparation

REVISION = 'a' * 40

def run(workflow, identity=1):
    return {'id': identity, 'head_sha': REVISION, 'head_branch': 'main', 'event': 'push',
            'path': '.github/workflows/' + workflow, 'status': 'completed', 'conclusion': 'success',
            'repository': {'full_name': gate.REPOSITORY}, 'head_repository': {'full_name': gate.REPOSITORY}}

class ReleaseGateTests(unittest.TestCase):
    def reader(self, path):
        if path == 'commits/main':
            return {'sha': REVISION}
        workflow = path.split('/')[2]
        return {'workflow_runs': [run(workflow)]}
    def test_all_required_suites_needed(self):
        self.assertEqual(set(gate.check_ci(REVISION, self.reader)), set(gate.WORKFLOWS))
    def test_missing_suite_rejected(self):
        with self.assertRaises(RuntimeError):
            gate.check_ci(REVISION, lambda path: {'sha': REVISION} if path == 'commits/main' else {'workflow_runs': []})
    def test_main_drift_rejected(self):
        with self.assertRaises(RuntimeError):
            gate.check_ci(REVISION, lambda path: {'sha': 'b' * 40})
    def test_later_failure_not_hidden_by_older_success(self):
        def read(path):
            value = self.reader(path)
            if 'workflow_runs' in value:
                failed = deepcopy(value['workflow_runs'][0])
                failed.update(id=2, conclusion='failure')
                value['workflow_runs'].append(failed)
            return value
        with self.assertRaises(RuntimeError):
            gate.check_ci(REVISION, read)
    def test_wrong_run_identity_rejected(self):
        for key, value in (('head_sha', 'b' * 40), ('head_branch', 'dev'), ('event', 'pull_request'),
                           ('path', '.github/workflows/other.yml'), ('conclusion', 'failure'),
                           ('status', 'in_progress'), ('repository', {'full_name': 'other/repo'}),
                           ('head_repository', {'full_name': 'other/repo'}), ('id', True)):
            candidate = run('bundle-arm64.yml')
            candidate[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                gate.successful_run(candidate, REVISION, 'bundle-arm64.yml')
    def artifact(self):
        return {'id': 7, 'name': 'qualified-arm64-bundle', 'expired': False, 'size_in_bytes': 100,
                'digest': 'sha256:' + 'b' * 64, 'workflow_run': {'id': 1, 'head_sha': REVISION}}
    def test_artifact_digest_verified(self):
        self.assertEqual(gate.artifact_identity(self.artifact(), 1, REVISION), 'b' * 64)
    def test_expired_forged_or_oversized_artifacts_rejected(self):
        for key, value in (('expired', True), ('name', 'other'), ('id', True), ('size_in_bytes', 2**32),
                           ('digest', None), ('digest', 'sha256:' + 'b' * 64 + '\n'),
                           ('workflow_run', {'id': 2, 'head_sha': REVISION})):
            artifact = self.artifact()
            artifact[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                gate.artifact_identity(artifact, 1, REVISION)
    def test_partial_or_newline_revision_rejected(self):
        for value in ('main', 'a' * 39, REVISION + '\n', None):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                gate.sha(value)
    def test_unpack_rejects_unexpected_and_duplicate_members(self):
        for names in (['../unexpected'], ['expected', 'expected']):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / 'bundle.zip'
                with zipfile.ZipFile(archive, 'w') as value:
                    for name in names:
                        value.writestr(name, 'data')
                with self.assertRaises(RuntimeError):
                    preparation.unpack(archive, root, {'expected'})
    def test_unpack_rejects_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'bundle.zip'
            with zipfile.ZipFile(archive, 'w') as value:
                entry = zipfile.ZipInfo('expected')
                entry.external_attr = 0o120777 << 16
                value.writestr(entry, 'other-file')
            with self.assertRaises(RuntimeError):
                preparation.unpack(archive, root, {'expected'})
    def test_unpack_preserves_bytes_with_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'bundle.zip'
            with zipfile.ZipFile(archive, 'w') as value:
                value.writestr('expected', b'actual bytes')
            preparation.unpack(archive, root, {'expected'})
            self.assertEqual((root / 'expected').read_bytes(), b'actual bytes')
            self.assertEqual((root / 'expected').stat().st_mode & 0o777, 0o600)

if __name__ == '__main__':
    unittest.main()
