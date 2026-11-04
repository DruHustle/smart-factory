import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('migration', ROOT / 'scripts/consolidate_workflows.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class ReleaseWorkflowTests(unittest.TestCase):
    def workflow(self, name):
        return m.load((ROOT / '.github/workflows' / name).read_text())
    def test_native_arm64_and_read_only_token(self):
        flow = self.workflow('bundle-arm64.yml')
        self.assertEqual(flow['jobs']['bundle']['runs-on'], 'ubuntu-24.04-arm')
        self.assertEqual(flow['permissions'], {'contents': 'read'})
        self.assertGreaterEqual(flow['jobs']['bundle']['timeout-minutes'], 30)
    def test_candidate_and_rollback_from_canonical_repository(self):
        steps = self.workflow('bundle-arm64.yml')['jobs']['bundle']['steps']
        checkouts = [s for s in steps if s.get('uses', '').startswith('actions/checkout@')]
        self.assertEqual(len(checkouts), 2)
        for step in checkouts:
            self.assertNotIn('repository', step['with'])
            self.assertIs(step['with']['persist-credentials'], False)
        self.assertEqual(checkouts[0]['with']['ref'], '${{ github.event.pull_request.head.sha || github.sha }}')
        self.assertEqual(checkouts[1]['with']['ref'], '${{ steps.sources.outputs.rollback }}')
    def test_all_runtime_security_and_rollback_checks_retained(self):
        steps = self.workflow('bundle-arm64.yml')['jobs']['bundle']['steps']
        commands = '\n'.join(s.get('run', '') for s in steps)
        for required in ('test_smtp_capture.py', 'test_source_revisions.py', 'scripts/mqtt/broker-smoke.py', 'scripts/bundle-smoke.py', 'scripts/audit-container.py', 'docker save factory-qualified:candidate', 'docker save factory-qualified:rollback'):
            self.assertIn(required, commands)
        smoke = next(s for s in steps if s.get('run') == 'python3 scripts/bundle-smoke.py')
        self.assertEqual(smoke['env']['BUNDLE_SOURCE_LAYOUT'], 'monorepo')
        self.assertEqual(smoke['env']['BUNDLE_ROLLBACK_SOURCE_SHA'], '${{ steps.sources.outputs.rollback }}')
    def test_audit_is_read_only_and_not_a_release(self):
        audit = self.workflow('consolidation-audit.yml')
        self.assertEqual(audit['permissions'], {'contents': 'read'})
        self.assertNotIn('environment', audit['jobs']['source-audit'])
    def test_temporary_writer_removed(self):
        self.assertFalse((ROOT / '.github/workflows/migration-candidate.yml').exists())

if __name__ == '__main__':
    unittest.main()
