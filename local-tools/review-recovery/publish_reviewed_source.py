"""One-time source recovery, not a production release or a CI approval.

Only the reviewed patch digest and twelve explicit source/documentation paths
may be published. The target is the existing draft feature branch, never main.
Repository code is not executed while the scoped write token is available.
"""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

REPOSITORY = 'DruHustle/smart-factory'
BASE = '248c130c0cd900a17a3bf08368559b5fc56bb6ec'
BASE_TREE = '6734cdc4e84d88fb4e6c3a54db65c6bdcf4267f1'
TARGET = 'feat/overview-floor-insights-20261105'
RECOVERY_REF = 'refs/heads/chore/recover-reviewed-source-20261106'
DIGEST = 'bf802dc469daed954ed4c0b9a9f6fdc5efa93ba6b3a56313d0ca40243ad36aff'
PATHS = (
    'docs/reviews/smart-factory-review-20261105.md',
    'smart-factory-frontend/client/src/components/workspace/FactoryFloor.tsx',
    'smart-factory-frontend/client/src/components/workspace/FactoryFloorInsights.tsx',
    'smart-factory-frontend/client/src/components/workspace/FactoryWorkspace.tsx',
    'smart-factory-frontend/client/src/index.css',
    'smart-factory-frontend/client/src/lib/floor-insights.ts',
    'smart-factory-frontend/docs/overview-floor-workspaces.md',
    'smart-factory-frontend/e2e/data-workspace.spec.ts',
    'smart-factory-frontend/e2e/factory-diagrams.spec.ts',
    'smart-factory-frontend/e2e/named-factories.spec.ts',
    'smart-factory-frontend/e2e/overview.spec.ts',
    'smart-factory-frontend/server/floor-insights.test.ts',
)
ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / 'local-tools' / 'review-recovery'
WORKTREE = ROOT / 'local-tools' / 'worktrees' / 'review-recovery'


def run(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def scope():
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise RuntimeError('Wrong repository; no changes allowed')
    if os.environ.get('GITHUB_REF') != RECOVERY_REF:
        raise RuntimeError('Wrong branch; no changes allowed')
    if os.environ.get('GITHUB_EVENT_NAME') != 'push':
        raise RuntimeError('Only an owner-authorized recovery-branch push is allowed')


def prepare():
    # No write credential is injected into this step.
    encoded = ''.join((STATE / ('patch.%02d.b64' % i)).read_text() for i in range(3))
    compressed = base64.b64decode(''.join(encoded.split()), validate=True)
    decoded = lzma.decompress(compressed)
    if len(decoded) != 66723 or hashlib.sha256(decoded).hexdigest() != DIGEST:
        raise RuntimeError('Reviewed patch checksum mismatch')
    patch = STATE / 'verified.patch'
    patch.write_bytes(decoded)
    paths = {line.split('\t', 2)[2] for line in run('git', 'apply', '--numstat', str(patch)).splitlines()}
    if paths != set(PATHS):
        raise RuntimeError('Patch path allowlist mismatch')
    run('git', 'fetch', '--no-tags', '--depth=1', 'origin', BASE)
    if run('git', 'rev-parse', BASE + '^{tree}') != BASE_TREE:
        raise RuntimeError('Unexpected base tree')
    WORKTREE.parent.mkdir(parents=True, exist_ok=True)
    run('git', 'worktree', 'add', '--detach', str(WORKTREE), BASE)
    run('git', 'apply', '--check', str(patch), cwd=WORKTREE)
    run('git', 'apply', str(patch), cwd=WORKTREE)
    run('git', 'add', '--', *PATHS, cwd=WORKTREE)
    if set(run('git', 'diff', '--cached', '--name-only', cwd=WORKTREE).splitlines()) != set(PATHS):
        raise RuntimeError('Unexpected staged paths')
    run('git', 'diff', '--cached', '--check', cwd=WORKTREE)
    entries = []
    for name in PATHS:
        path = WORKTREE / name
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('Only reviewed regular UTF-8 files are permitted')
        content = path.read_text(encoding='utf-8')
        entries.append({'path': name, 'mode': '100644', 'type': 'blob', 'content': content})
    payload = {'base_tree': BASE_TREE, 'tree': entries}
    (STATE / 'tree.json').write_text(json.dumps(payload))
    print('Verified reviewed source recovery:', len(entries), 'files;', DIGEST)


def api(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        'https://api.github.com/repos/' + REPOSITORY + '/' + path,
        data=data, method=method,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28',
                 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never print request headers, response payloads or credentials.
        raise RuntimeError('GitHub source publication failed with HTTP ' + str(error.code)) from None


def publish():
    target = api('GET', 'git/ref/heads/' + TARGET)
    if target['object']['sha'] != BASE:
        raise RuntimeError('Feature branch moved; stop instead of overwriting concurrent work')
    payload = json.loads((STATE / 'tree.json').read_text())
    if payload['base_tree'] != BASE_TREE or {x['path'] for x in payload['tree']} != set(PATHS):
        raise RuntimeError('Prepared source allowlist mismatch')
    if any(x.get('type') != 'blob' or x.get('mode') != '100644' or not isinstance(x.get('content'), str) for x in payload['tree']):
        raise RuntimeError('Invalid prepared source entries')
    tree = api('POST', 'git/trees', payload)
    commit = api('POST', 'git/commits', {
        'message': 'fix(overview): restore evidence windows, source context and inventory inspection after review',
        'tree': tree['sha'], 'parents': [BASE],
    })
    if api('GET', 'git/ref/heads/' + TARGET)['object']['sha'] != BASE:
        raise RuntimeError('Concurrent change detected; feature branch retained')
    # Non-forced update cannot replace a concurrent descendant.
    api('PATCH', 'git/refs/heads/' + TARGET, {'sha': commit['sha'], 'force': False})
    actual = api('GET', 'git/ref/heads/' + TARGET)['object']['sha']
    if actual != commit['sha']:
        raise RuntimeError('Feature branch publication could not be verified')
    print('Published reviewed draft-branch source:', actual)
    print('Production, main, branch protection and qualification gates were not changed.')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as out:
            out.write('Recovered twelve reviewed source files onto draft PR #10.\n\nCommit: `' + actual + '`.\n\nNo production release or independent review approval is claimed. Full exact-source CI must run before promotion.\n')


if __name__ == '__main__':
    scope()
    if sys.argv[1:] == ['prepare']:
        prepare()
    elif sys.argv[1:] == ['publish']:
        publish()
    else:
        raise SystemExit('Use prepare or publish')
