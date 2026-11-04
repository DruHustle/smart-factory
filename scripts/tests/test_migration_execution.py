import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).resolve().parents[1] / 'consolidate_workflows.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MigrationExecutionTests(unittest.TestCase):
    def test_aggregate_without_checkout_runs_at_workspace_root(self):
        original = m.load('name: Quality\non: {push: {branches: [main]}}\njobs:\n  aggregate:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo verified\n')
        actual = m.migrate(original)
        self.assertEqual(actual['jobs']['aggregate']['defaults']['run']['working-directory'], '.')
    def test_every_checkout_is_exact_candidate(self):
        original = m.load('name: Quality\non: {push: {branches: [main]}}\njobs:\n  test:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@abc\n      - run: pnpm test\n')
        step = m.migrate(original)['jobs']['test']['steps'][0]
        self.assertEqual(step['with']['ref'], '${{ github.event.pull_request.head.sha || github.sha }}')
        self.assertIs(step['with']['persist-credentials'], False)

if __name__ == '__main__':
    unittest.main()
