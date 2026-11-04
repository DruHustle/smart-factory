"""Keep independent browser execution complete and its named result fail-closed."""
import importlib.util
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('migration', ROOT / 'scripts/consolidate_workflows.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
collector_spec = importlib.util.spec_from_file_location(
    'contexts', ROOT / 'smart-factory-frontend/scripts/qualification/collect-error-contexts.py')
contexts = importlib.util.module_from_spec(collector_spec)
collector_spec.loader.exec_module(contexts)


class EvidenceLedWorkflowTests(unittest.TestCase):
    def workflows(self):
        for relative in ('smart-factory-frontend/.github/workflows/ci.yml',
                         '.github/workflows/frontend-quality.yml'):
            yield m.load((ROOT / relative).read_text())

    def test_every_workspace_browser_file_runs_in_one_independent_group(self):
        config = (ROOT / 'smart-factory-frontend/playwright.workspace.config.ts').read_text()
        selection = re.search(r'testMatch:\s*\[(.*?)\]', config, re.S)
        self.assertIsNotNone(selection)
        files = re.findall(r'"([^"]+\.spec\.ts)"', selection.group(1))
        self.assertEqual(set(files), {
            'workspace.spec.ts', 'incident-assignment.spec.ts',
            'infrastructure-private.spec.ts', 'factory-layouts-private.spec.ts',
            'assistant-selection.spec.ts', 'list-filters.spec.ts',
        })
        for flow in self.workflows():
            job = flow['jobs']['workspace-browser']
            matrix = job['strategy']['matrix']['include']
            self.assertEqual(len(matrix), 2)
            self.assertEqual(len({group['suite'] for group in matrix}), 2)
            selected = []
            for group in matrix:
                matches = [name for name in files if re.search(group['files'], 'e2e/' + name)]
                self.assertTrue(matches, group['suite'])
                selected.extend(matches)
            self.assertCountEqual(selected, files)
            step, = [s for s in job['steps'] if 'E2E_TEST_FILES' in s.get('env', {})]
            self.assertEqual(step['env'], {'E2E_TEST_FILES': '${{ matrix.files }}'})
            self.assertEqual(step['run'], 'pnpm e2e:workspace "$E2E_TEST_FILES" --reporter=line')
            artifact, = [s for s in job['steps'] if s.get('uses', '').startswith('actions/upload-artifact@')]
            self.assertEqual(artifact['with']['name'], 'workspace-rendered-evidence-${{ matrix.suite }}')

    def test_workspace_groups_retain_budgets_and_do_not_cancel_peers(self):
        config = (ROOT / 'smart-factory-frontend/playwright.workspace.config.ts').read_text()
        for setting in (r'timeout:\s*60000\s*,', r'expect:\s*\{\s*timeout:\s*15000\s*\}',
                        r'retries:\s*0\s*,', r'workers:\s*1\s*,', r'fullyParallel:\s*false\s*,'):
            self.assertRegex(config, setting)
        for flow in self.workflows():
            self.assertEqual(flow['permissions'], {'contents': 'read'})
            job = flow['jobs']['workspace-browser']
            self.assertEqual(job['timeout-minutes'], 15)
            self.assertIs(job['strategy']['fail-fast'], False)
            self.assertEqual(job['strategy']['max-parallel'], 2)
            for key in ('if', 'continue-on-error', 'environment'):
                self.assertNotIn(key, job)
            for step in job['steps']:
                self.assertNotIn('continue-on-error', step)

    def test_original_workspace_result_rejects_incomplete_groups(self):
        for flow in self.workflows():
            job = flow['jobs']['unified-workspace']
            self.assertEqual(job['name'], 'Unified workspace journeys')
            self.assertEqual(job['if'], '${{ always() }}')
            self.assertEqual(job['needs'], ['workspace-browser'])
            step, = job['steps']
            self.assertEqual(step['env'], {'WORKSPACE_RESULT': '${{ needs.workspace-browser.result }}'})
            for outcome in ('success', 'failure', 'cancelled', 'skipped', '', 'unknown'):
                result = subprocess.run(
                    ['bash', '--noprofile', '--norc', '-c', step['run']],
                    env={**os.environ, 'WORKSPACE_RESULT': outcome},
                    capture_output=True, text=True, timeout=5,
                )
                self.assertEqual(result.returncode == 0, outcome == 'success')

    def test_every_configured_browser_file_runs_once(self):
        config = (ROOT / 'smart-factory-frontend/playwright.visual-workspaces.config.ts').read_text()
        selection = re.search(r'testMatch:\s*\[(.*?)\]', config, re.S)
        self.assertIsNotNone(selection)
        files = re.findall(r'"([^"]+\.spec\.ts)"', selection.group(1))
        self.assertEqual(set(files), {'assistant.spec.ts', 'editable-demo.spec.ts',
                                     'design-system.spec.ts', 'infrastructure.spec.ts'})
        for flow in self.workflows():
            job = flow['jobs']['evidence-led-browser']
            matrix = job['strategy']['matrix']['include']
            selected = []
            for group in matrix:
                matches = [name for name in files if re.search(group['files'], 'e2e/' + name)]
                self.assertTrue(matches, group['suite'])
                selected.extend(matches)
            self.assertCountEqual(selected, files)
            step = next(s for s in job['steps'] if 'E2E_TEST_FILES' in s.get('env', {}))
            self.assertEqual(step['run'], 'pnpm e2e:visual-workspaces "$E2E_TEST_FILES"')
            self.assertEqual(step['env']['E2E_TEST_FILES'], '${{ matrix.files }}')

    def test_independent_groups_keep_limits_and_continue_after_peer_failure(self):
        for flow in self.workflows():
            self.assertEqual(flow['permissions'], {'contents': 'read'})
            self.assertIs(flow['jobs']['evidence-led-browser']['strategy']['fail-fast'], False)
            for key in ('evidence-led-browser', 'evidence-led-private-infrastructure'):
                job = flow['jobs'][key]
                self.assertEqual(job['timeout-minutes'], 15)
                self.assertNotIn('if', job)
                self.assertNotIn('continue-on-error', job)
                self.assertNotIn('environment', job)
                for step in job['steps']:
                    self.assertNotIn('continue-on-error', step)

    def test_private_authorization_and_registration_command_is_retained(self):
        expected = (
            "pnpm e2e:workspace --grep 'private .*cannot inspect installation infrastructure|"
            "individual administrator|registration and role-filtered' "
            "--output=test-results/infrastructure-private"
        )
        for flow in self.workflows():
            steps = flow['jobs']['evidence-led-private-infrastructure']['steps']
            matching = [step for step in steps if step.get('run') == expected]
            self.assertEqual(len(matching), 1)
            self.assertNotIn('if', matching[0])
            self.assertEqual(matching[0]['env'], {
                'VISUAL_WORKSPACE_EVIDENCE_DIR': 'test-results/evidence-led-private',
            })

    def test_original_named_result_requires_every_group(self):
        for flow in self.workflows():
            job = flow['jobs']['evidence-led-workspaces']
            self.assertEqual(job['name'], 'Assistant, design system and infrastructure')
            self.assertEqual(job['if'], '${{ always() }}')
            self.assertCountEqual(job['needs'], ['evidence-led-browser', 'evidence-led-private-infrastructure'])
            step, = job['steps']
            self.assertEqual(step['env'], {
                'BROWSER_RESULT': '${{ needs.evidence-led-browser.result }}',
                'PRIVATE_INFRASTRUCTURE_RESULT': '${{ needs.evidence-led-private-infrastructure.result }}',
            })
            cases = [('success', 'success')]
            for outcome in ('failure', 'cancelled', 'skipped', '', 'unknown'):
                cases.extend([(outcome, 'success'), ('success', outcome)])
            for browser, private in cases:
                result = subprocess.run(
                    ['bash', '--noprofile', '--norc', '-c', step['run']],
                    env={**os.environ, 'BROWSER_RESULT': browser,
                         'PRIVATE_INFRASTRUCTURE_RESULT': private},
                    capture_output=True, text=True, timeout=5,
                )
                self.assertEqual(result.returncode == 0, browser == private == 'success')

    def test_case_limits_are_preserved_and_failure_reporting_is_immediate(self):
        config = (ROOT / 'smart-factory-frontend/playwright.visual-workspaces.config.ts').read_text()
        self.assertRegex(config, r'timeout:\s*60000\s*,')
        self.assertRegex(config, r'expect:\s*\{\s*timeout:\s*15000\s*\}')
        self.assertRegex(config, r'retries:\s*0\s*,')
        self.assertRegex(config, r'reporter:\s*"line"\s*,')

    def test_visual_jobs_preserve_cad_and_report_dependencies(self):
        for flow in self.workflows():
            contract = flow['jobs']['visual-contracts']
            overview = flow['jobs']['visual-overview-reports']
            for job in (contract, overview):
                self.assertEqual(job['timeout-minutes'], 25)
                self.assertNotIn('if', job)
                self.assertNotIn('continue-on-error', job)
                self.assertNotIn('environment', job)
            steps = {step.get('name'): step for step in contract['steps']}
            cad = steps['Audit editable CAD and vector PDF engineering sheets']['run']
            for command in (
                'node --import tsx scripts/engineering/export-fixtures.ts test-results/cad-validation/fixtures',
                'node --import tsx scripts/engineering/export-complex.ts test-results/cad-validation/complex',
                'node scripts/engineering/qualify-files.mjs test-results/cad-validation/fixtures',
                'node scripts/engineering/qualify-files.mjs test-results/cad-validation/complex',
                '"$RUNNER_TEMP/smart-factory-cad/bin/python" scripts/engineering/verify-dxf.py test-results/cad-validation/fixtures',
                '"$RUNNER_TEMP/smart-factory-cad/bin/python" scripts/engineering/verify-dxf.py test-results/cad-validation/complex',
            ):
                self.assertIn(command, cad.splitlines())
            required = {
                'Verify Demo/Live and factory overview UI contracts': 'pnpm exec playwright test --config=playwright.overview-contract.config.ts',
                'Verify NVIDIA references on the factory floor': 'pnpm exec playwright test --config=playwright.nvidia-floor.config.ts',
                'Audit actual browser engineering downloads': '"$RUNNER_TEMP/smart-factory-cad/bin/python" scripts/engineering/verify-browser-exports.py test-results/cad-exports',
                'Verify layout editing under delayed account responses and draft capacity': 'pnpm exec playwright test --config=playwright.layout-review.config.ts',
            }
            for name, command in required.items():
                self.assertEqual(steps[name]['run'], command)
                self.assertNotIn('if', steps[name])
            before = [step.get('name') for step in contract['steps']]
            self.assertLess(before.index('Verify Demo/Live and factory overview UI contracts'),
                            before.index('Audit actual browser engineering downloads'))
            runs = [step for step in overview['steps'] if 'run' in step]
            graphical, inspect = runs[-2:]
            self.assertEqual(graphical['run'], "pnpm e2e:experience --grep 'Overview graphics|operational reports print' --output=test-results/overview-graphics --reporter=line")
            self.assertEqual(graphical['env'], {
                'OVERVIEW_EVIDENCE_DIR': 'test-results/visual-first',
                'REPORT_EVIDENCE_DIR': '${{ runner.temp }}/operational-report-pdfs',
            })
            self.assertEqual(inspect['run'], '"$RUNNER_TEMP/smart-factory-cad/bin/python" scripts/engineering/verify-report-pdfs.py "$RUNNER_TEMP/operational-report-pdfs"')
            self.assertNotIn('if', graphical)
            self.assertNotIn('if', inspect)

    def test_original_visual_result_rejects_incomplete_children(self):
        for flow in self.workflows():
            job = flow['jobs']['visual-workspaces']
            self.assertEqual(job['name'], 'Visual navigation and overview')
            self.assertEqual(job['if'], '${{ always() }}')
            self.assertCountEqual(job['needs'], ['visual-contracts', 'visual-overview-reports'])
            step, = job['steps']
            self.assertEqual(step['env'], {
                'CONTRACT_RESULT': '${{ needs.visual-contracts.result }}',
                'OVERVIEW_RESULT': '${{ needs.visual-overview-reports.result }}',
            })
            cases = [('success', 'success')]
            for outcome in ('failure', 'cancelled', 'skipped', '', 'unknown'):
                cases.extend([(outcome, 'success'), ('success', outcome)])
            for contract, overview in cases:
                result = subprocess.run(
                    ['bash', '--noprofile', '--norc', '-c', step['run']],
                    env={**os.environ, 'CONTRACT_RESULT': contract,
                         'OVERVIEW_RESULT': overview},
                    capture_output=True, text=True, timeout=5,
                )
                self.assertEqual(result.returncode == 0, contract == overview == 'success')

    def test_core_upload_is_scoped_collected_and_retained_one_day(self):
        for flow in self.workflows():
            steps = flow['jobs']['build-core']['steps']
            smoke = next(i for i, step in enumerate(steps) if step.get('name') == 'Run E2E Smoke Tests')
            collector, upload = steps[smoke + 1:smoke + 3]
            self.assertEqual(collector['id'], 'collect-core-contexts')
            self.assertEqual(collector['if'], 'always()')
            self.assertEqual(collector['run'], 'python3 scripts/qualification/collect-error-contexts.py --source test-results --destination "$RUNNER_TEMP/core-error-contexts"')
            self.assertEqual(upload['if'], "${{ always() && steps.collect-core-contexts.outcome == 'success' }}")
            self.assertEqual(upload['with'], {
                'name': 'core-browser-error-contexts',
                'path': '${{ runner.temp }}/core-error-contexts/**/error-context.md',
                'retention-days': 1, 'include-hidden-files': False,
                'if-no-files-found': 'ignore',
            })


class ErrorContextCollectorTests(unittest.TestCase):
    def test_only_regular_contexts_are_copied_with_private_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'test-results'
            case = source / 'failed-case'
            case.mkdir(parents=True)
            (case / 'error-context.md').write_bytes(b'# Synthetic page snapshot\n')
            (case / 'trace.zip').write_bytes(b'excluded')
            (case / 'auth-state.json').write_bytes(b'excluded')
            output = root / 'collected'
            self.assertEqual(contexts.collect(source, output), 1)
            self.assertEqual([p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()],
                             ['failed-case/error-context.md'])
            copied = output / 'failed-case/error-context.md'
            self.assertEqual(copied.read_bytes(), b'# Synthetic page snapshot\n')
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(copied.stat().st_mode), 0o600)

    def test_root_directory_and_file_symlinks_are_not_followed(self):
        for kind in ('root', 'directory', 'file'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                outside = root / 'outside'
                outside.mkdir()
                (outside / 'error-context.md').write_bytes(b'not a source context')
                source = root / 'test-results'
                if kind == 'root':
                    source.symlink_to(outside, target_is_directory=True)
                else:
                    source.mkdir()
                    if kind == 'directory':
                        (source / 'linked-case').symlink_to(outside, target_is_directory=True)
                    else:
                        (source / 'error-context.md').symlink_to(outside / 'error-context.md')
                with self.assertRaises((OSError, ValueError)):
                    contexts.collect(source, root / 'collected')
                self.assertFalse(any((root / 'collected').rglob('error-context.md')))

    def test_non_regular_hardlinked_and_oversized_contexts_are_refused(self):
        for kind in ('fifo', 'hardlink', 'oversized'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / 'test-results'
                source.mkdir()
                candidate = source / 'error-context.md'
                if kind == 'fifo':
                    os.mkfifo(candidate)
                elif kind == 'hardlink':
                    original = root / 'original'
                    original.write_bytes(b'not a unique source context')
                    os.link(original, candidate)
                else:
                    candidate.write_bytes(b'x' * (contexts.MAX_FILE_BYTES + 1))
                with self.assertRaises(ValueError):
                    contexts.collect(source, root / 'collected')
                self.assertFalse(any((root / 'collected').rglob('error-context.md')))

    def test_total_and_count_limits_fail_and_existing_output_is_not_reused(self):
        for limit in ('MAX_TOTAL_BYTES', 'MAX_FILES'):
            with self.subTest(limit=limit), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / 'test-results'
                source.mkdir()
                (source / 'error-context.md').write_bytes(b'context')
                with patch.object(contexts, limit, 0), self.assertRaises(ValueError):
                    contexts.collect(source, root / 'collected')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / 'collected'
            self.assertEqual(contexts.collect(root / 'missing', output), 0)
            with self.assertRaises(FileExistsError):
                contexts.collect(root / 'missing', output)


if __name__ == '__main__':
    unittest.main()
