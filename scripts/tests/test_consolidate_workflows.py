import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).resolve().parents[1] / 'consolidate_workflows.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MigrationTests(unittest.TestCase):
    def basic(self):
        return m.load('''name: Quality
on:
  push:
    branches: [main]
permissions: {contents: read}
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@abc
        with: {persist-credentials: false}
      - uses: actions/setup-node@abc
        with: {cache: pnpm}
      - run: pnpm test
      - uses: actions/upload-artifact@abc
        with:
          path: |
            test-results/**/*.json
            ${{ runner.temp }}/proof.json
''')
    def test_yaml_on_and_false_are_not_corrupted(self):
        value = self.basic()
        self.assertIn('on', value)
        self.assertIs(value['jobs']['test']['steps'][0]['with']['persist-credentials'], False)
    def test_duplicate_keys_fail(self):
        with self.assertRaises(ValueError):
            m.load('name: a\nname: b\non: {}\njobs: {}')
    def test_defaults_cache_and_artifacts(self):
        after = m.migrate(self.basic())
        self.assertEqual(after['defaults']['run']['working-directory'], m.FRONTEND)
        steps = after['jobs']['test']['steps']
        self.assertEqual(steps[1]['with']['cache-dependency-path'], m.FRONTEND + '/pnpm-lock.yaml')
        self.assertEqual(steps[3]['with']['path'], 'smart-factory-frontend/test-results/**/*.json\n${{ runner.temp }}/proof.json\n')
    def test_test_removal_rejected(self):
        before = self.basic()
        after = m.migrate(before)
        after['jobs']['test']['steps'].pop(2)
        with self.assertRaises(ValueError):
            m.validate(before, after)
    def test_job_removal_rejected(self):
        before = self.basic()
        after = m.migrate(before)
        after['jobs'] = {}
        with self.assertRaises(ValueError):
            m.validate(before, after)
    def test_external_repository_rejected(self):
        before = self.basic()
        before['jobs']['test']['steps'][0]['with']['repository'] = 'other/repository'
        with self.assertRaises(ValueError):
            m.migrate(before)
    def test_cross_service_uses_one_checkout(self):
        before = self.basic()
        job = before['jobs'].pop('test')
        before['jobs']['trusted-cross-service'] = job
        job['steps'][0]['with']['path'] = m.FRONTEND
        job['steps'][1:1] = [
            {'name': 'Read immutable companion identities', 'run': 'read old pins'},
            {'uses': 'actions/checkout@abc', 'with': {'repository': 'DruHustle/smart-factory-backend'}},
            {'uses': 'actions/checkout@abc', 'with': {'repository': 'DruHustle/smart-factory-edge'}},
        ]
        after = m.migrate(before)['jobs']['trusted-cross-service']
        self.assertEqual(after['defaults']['run']['working-directory'], '.')
        self.assertNotIn('path', after['steps'][0]['with'])
        self.assertEqual([s['run'] for s in after['steps'] if 'run' in s], ['pnpm test'])
    def test_unknown_cross_service_layout_refused(self):
        before = self.basic()
        before['jobs']['trusted-cross-service'] = before['jobs'].pop('test')
        with self.assertRaises(ValueError):
            m.migrate(before)
    def test_permissions_cannot_expand(self):
        before = self.basic()
        after = m.migrate(before)
        after['permissions']['contents'] = 'write'
        with self.assertRaises(ValueError):
            m.validate(before, after)
    def test_timeout_cannot_be_reduced(self):
        before = self.basic()
        after = m.migrate(before)
        after['jobs']['test']['timeout-minutes'] = 1
        with self.assertRaises(ValueError):
            m.validate(before, after)
    def test_negative_filter_preserved(self):
        self.assertEqual(m.prefixed('!test-results/**'), '!smart-factory-frontend/test-results/**')
    def test_roundtrip(self):
        value = m.migrate(self.basic())
        text = m.yaml.dump(value, Dumper=m.WorkflowDumper, sort_keys=False)
        self.assertEqual(m.load(text), value)

if __name__ == '__main__':
    unittest.main()
