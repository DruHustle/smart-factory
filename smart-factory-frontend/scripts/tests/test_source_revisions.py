import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('sources', Path(__file__).resolve().parents[1] / 'qualification/source_revisions.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SourceRevisionTests(unittest.TestCase):
    def test_monorepo_requires_full_sha(self):
        for value in (None, '', 'main', 'a' * 39, 'A' * 40, 'a' * 40 + '\n'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                m.load_rollback_sources(Path('/unused'), {'BUNDLE_SOURCE_LAYOUT': 'monorepo', 'BUNDLE_ROLLBACK_SOURCE_SHA': value})
    def test_monorepo_uses_one_exact_revision(self):
        actual = m.load_rollback_sources(Path('/unused'), {'BUNDLE_SOURCE_LAYOUT': 'monorepo', 'BUNDLE_ROLLBACK_SOURCE_SHA': 'a' * 40})
        self.assertEqual(actual, dict.fromkeys(m.COMPONENTS, 'a' * 40))
    def test_unknown_layout_rejected(self):
        with self.assertRaises(ValueError):
            m.load_rollback_sources(Path('/unused'), {'BUNDLE_SOURCE_LAYOUT': 'other'})
    def test_legacy_cannot_accept_override(self):
        with self.assertRaises(ValueError):
            m.load_rollback_sources(Path('/unused'), {'BUNDLE_ROLLBACK_SOURCE_SHA': 'a' * 40})
    def test_legacy_pins_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'deploy').mkdir()
            value = dict(zip(m.COMPONENTS, ('a' * 40, 'b' * 40, 'c' * 40)))
            (root / 'deploy/rollback-sources.json').write_text(json.dumps(value))
            self.assertEqual(m.load_rollback_sources(root, {}), value)
    def test_invalid_legacy_pins_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'deploy').mkdir()
            (root / 'deploy/rollback-sources.json').write_text('{"frontend":"main"}')
            with self.assertRaises(ValueError):
                m.load_rollback_sources(root, {})

if __name__ == '__main__':
    unittest.main()
