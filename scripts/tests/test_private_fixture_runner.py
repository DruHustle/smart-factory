import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / 'smart-factory-frontend'

class PrivateFixtureRunnerTests(unittest.TestCase):
    def run_fixture(self, private=True, database=None, production=False):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            evidence = folder / 'calls.jsonl'
            stub = folder / 'node'
            stub.write_text('''#!/usr/bin/env python3
import json, os, sys
record = {'args': sys.argv[1:], 'enabled': os.getenv('ONESA_ENABLED'),
          'origin': os.getenv('ONESA_APPROVED_ORIGIN'), 'database': os.getenv('DATABASE_URL')}
with open(os.environ['FIXTURE_CALLS'], 'a') as f:
    f.write(json.dumps(record) + '\\n')
''')
            stub.chmod(0o755)
            for name in ('docker', 'pnpm'):
                tool = folder / name
                tool.write_text('#!/usr/bin/env bash\nexit 0\n')
                tool.chmod(0o755)
            env = {**os.environ, 'PATH': str(folder) + os.pathsep + os.environ['PATH'],
                   'FIXTURE_CALLS': str(evidence), 'ONESA_ENABLED': 'true',
                   'ONESA_APPROVED_ORIGIN': 'https://unapproved.invalid',
                   'E2E_ONESA_PRIVATE': 'true' if private else 'false',
                   'NODE_ENV': 'production' if production else 'development',
                   'DATABASE_URL': database or 'postgres://postgres:postgres@127.0.0.1:55432/smart_factory_e2e'}
            direct = database is not None or production or not private
            script = 'scripts/onesa/seed-private-fixture.sh' if direct else 'scripts/onesa/e2e.sh'
            result = subprocess.run(['bash', script], cwd=FRONTEND, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            records = [json.loads(line) for line in evidence.read_text().splitlines()] if evidence.exists() else []
            return result, records
    def test_fixture_scope_does_not_leak_into_application(self):
        result, records = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        seeded = [r for r in records if 'scripts/onesa/seed-fixture.ts' in r['args']]
        self.assertEqual(len(seeded), 1)
        self.assertEqual(seeded[0]['enabled'], 'true')
        self.assertEqual(seeded[0]['origin'], 'http://127.0.0.1:18640')
        servers = [r for r in records if 'server/_core/index.ts' in r['args']]
        self.assertEqual(len(servers), 1)
        self.assertIsNone(servers[0]['enabled'])
        self.assertIsNone(servers[0]['origin'])
        for record in records:
            self.assertNotIn('scripts/onesa/run-receiver.ts', record['args'])
    def test_nonlocal_database_refused_before_node(self):
        result, records = self.run_fixture(database='postgres://postgres:postgres@database.invalid/prod')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(records, [])
    def test_production_refused_before_node(self):
        result, records = self.run_fixture(production=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(records, [])
    def test_requires_private_fixture_flag(self):
        result, records = self.run_fixture(private=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(records, [])
    def test_workspace_retains_deadlines_and_zero_retries(self):
        source = (FRONTEND / 'playwright.workspace.config.ts').read_text()
        self.assertIn('expect: { timeout: 15000 }', source)
        self.assertIn('retries: 0', source)
        self.assertRegex(source, r'\n  timeout: 60000,')

if __name__ == '__main__':
    unittest.main()
