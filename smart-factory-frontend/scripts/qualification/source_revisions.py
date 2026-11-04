"""Strict source identity selection for legacy and consolidated bundle qualification."""
import json
import os
from pathlib import Path
import re

SHA = re.compile(r'[a-f0-9]{40}\Z')
COMPONENTS = ('frontend', 'backend', 'edge')


def load_rollback_sources(root: Path, environ=None):
    env = os.environ if environ is None else environ
    layout = env.get('BUNDLE_SOURCE_LAYOUT', 'legacy')
    revision = env.get('BUNDLE_ROLLBACK_SOURCE_SHA')
    if layout == 'monorepo':
        if not isinstance(revision, str) or not SHA.fullmatch(revision):
            raise ValueError('A pinned monorepo rollback revision is required')
        return dict.fromkeys(COMPONENTS, revision)
    if layout != 'legacy' or revision is not None:
        raise ValueError('Unrecognized or contradictory source layout')
    sources = json.loads((root / 'deploy/rollback-sources.json').read_text())
    if not isinstance(sources, dict) or any(not isinstance(sources.get(name), str) or
            not SHA.fullmatch(sources[name]) for name in COMPONENTS):
        raise ValueError('All legacy rollback revisions must be immutable')
    return {name: sources[name] for name in COMPONENTS}
