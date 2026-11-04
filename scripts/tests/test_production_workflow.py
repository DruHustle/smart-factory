from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import consolidate_workflows as migration
import vercel_release_guard as guard

class ProductionWorkflowTests(unittest.TestCase):
    def project(self):
        return {'id': 'prj_test', 'accountId': 'team_test', 'rootDirectory': 'smart-factory-frontend',
                'link': {'type': 'github', 'org': 'DruHustle', 'repo': 'smart-factory'},
                'targets': {'production': {'id': 'dpl_previous'}}}
    def test_project_and_current_deployment_must_match(self):
        self.assertEqual(guard.project_identity(self.project(), 'prj_test', 'team_test', 'dpl_previous'), 'dpl_previous')
        for key, value in (('id', 'prj_other'), ('accountId', 'team_other'), ('rootDirectory', None),
                           ('link', {'type': 'github', 'org': 'DruHustle', 'repo': 'smart-factory-frontend'}),
                           ('targets', {'production': {'id': 'dpl_changed'}})):
            project = self.project()
            project[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                guard.project_identity(project, 'prj_test', 'team_test', 'dpl_previous')
    def stage(self):
        return {'id': 'dpl_candidate', 'projectId': 'prj_test', 'readyState': 'READY',
                'target': 'production', 'url': 'factory-candidate.vercel.app',
                'meta': {'githubCommitSha': 'a' * 40}}
    def test_stage_exact_source_and_project(self):
        self.assertEqual(guard.stage_identity(self.stage(), 'prj_test', 'a' * 40,
                         'https://factory-candidate.vercel.app'), 'dpl_candidate')
        for key, value in (('id', None), ('projectId', 'prj_other'), ('readyState', 'BUILDING'),
                           ('target', 'preview'), ('url', 'other.vercel.app'),
                           ('meta', {'githubCommitSha': 'b' * 40})):
            stage = self.stage()
            stage[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                guard.stage_identity(stage, 'prj_test', 'a' * 40, 'https://factory-candidate.vercel.app')
    def test_untrusted_stage_origins_rejected(self):
        for origin in ('http://factory-candidate.vercel.app', 'https://factory-candidate.vercel.app.evil.test',
                       'https://x@factory-candidate.vercel.app', 'https://factory-candidate.vercel.app/a',
                       'https://factory-candidate.vercel.app:8443', 'https://factory-candidate.vercel.app?x=1'):
            with self.subTest(origin=origin), self.assertRaises(RuntimeError):
                guard.stage_identity(self.stage(), 'prj_test', 'a' * 40, origin)
    def workflow(self):
        return migration.load((ROOT / '.github/workflows/deploy-vercel-oracle.yml').read_text())
    def test_manual_only_protected_main_release(self):
        workflow = self.workflow()
        self.assertEqual(set(workflow['on']), {'workflow_dispatch'})
        self.assertEqual(workflow['permissions'], {'contents': 'read', 'actions': 'read'})
        job = workflow['jobs']['deploy']
        self.assertEqual(job['environment'], 'production')
        self.assertIn("github.ref == 'refs/heads/main'", job['if'])
        self.assertIn("github.repository == 'DruHustle/smart-factory'", job['if'])
        self.assertFalse(workflow['concurrency']['cancel-in-progress'])
    def test_no_promotion_before_stage_and_api_verification(self):
        steps = self.workflow()['jobs']['deploy']['steps']
        commands = '\n'.join(s.get('run', '') for s in steps)
        install = commands.index('scripts/verify-runtime.mts')
        stage = commands.index('deploy --prebuilt')
        verify = commands.index('scripts/verify-staged-release.mts')
        promote = commands.index('promote "$STAGED_ORIGIN"')
        proxy = commands.index('API_ORIGIN="$RELEASE_ORIGIN"')
        self.assertLess(install, stage)
        self.assertLess(stage, verify)
        self.assertLess(verify, promote)
        self.assertLess(promote, proxy)
        self.assertIn('--prod --skip-domain', commands)
        self.assertEqual(commands.count('scripts/release_gate.py'), 3)
        self.assertEqual(commands.count('scripts/vercel_release_guard.py project'), 2)
        self.assertNotIn('delete', commands)
    def test_main_always_gets_generated_release_evidence(self):
        for content in migration.generated().values():
            workflow = migration.load(content)
            self.assertEqual(workflow['on']['push'], {'branches': ['main']})
    def test_missing_private_and_resource_suites_restored(self):
        workflow = migration.load((ROOT / '.github/workflows/feature-coverage.yml').read_text())
        self.assertEqual(workflow['jobs']['journeys']['strategy']['matrix']['suite'], ['onesa', 'resources'])
    def test_provider_capability_remains_optional_for_rollback(self):
        source = (ROOT / 'smart-factory-frontend/shared/runtime-contract.ts').read_text()
        required, optional = source.split('export const optionalCapabilities =', 1)
        self.assertNotIn('"assistant-provider-selection-v1"', required)
        self.assertIn('"assistant-provider-selection-v1"', optional)
    def test_backend_identity_change_does_not_rename_dns(self):
        source = (ROOT / 'smart-factory-backend/deploy/terraform/oracle-basyx/main.tf').read_text()
        self.assertRegex(source, r'hostname_label\s*=\s*var\.instance_name')
        self.assertIn('display_name        = var.instance_display_name', source)
        variables = (ROOT / 'smart-factory-backend/deploy/terraform/oracle-basyx/variables.tf').read_text()
        self.assertIn('Onesa UG Backend', variables)

if __name__ == '__main__':
    unittest.main()
