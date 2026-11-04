#!/usr/bin/env python3
"""Read-only migration audit; its artifacts never authorize repository deletion."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ('frontend', 'backend', 'edge')


def run(args, cwd=ROOT, data=None, check=True):
    return subprocess.run(args, cwd=cwd, input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=check)


def git(args, cwd=ROOT, check=True):
    return run(['git', *args], cwd, check=check).stdout


def blob(repo, ref, path):
    result = run(['git', 'show', ref + ':' + path], repo, check=False)
    return result.stdout if result.returncode == 0 else None


def main():
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=False)
    revision = git(['rev-parse', 'HEAD']).decode().strip()
    if revision != os.environ['EXPECTED_SHA'] or not re.fullmatch('[a-f0-9]{40}', revision):
        raise SystemExit('Unexpected canonical revision')
    git(['bundle', 'create', str(out / 'smart-factory.bundle'), 'HEAD', 'refs/remotes/origin/main'])
    git(['bundle', 'verify', str(out / 'smart-factory.bundle')])
    report = {'canonicalRevision': revision, 'productionVerified': False,
              'rollbackVerified': False, 'deletionAuthorized': False, 'components': {}}
    with tempfile.TemporaryDirectory(prefix='factory-source-audit-') as tmp:
        for component in COMPONENTS:
            name = 'smart-factory-' + component
            repo = Path(tmp) / (name + '.git')
            git(['clone', '--mirror', 'https://github.com/DruHustle/' + name + '.git', str(repo)])
            pages = json.loads(run(['gh', 'api', '--paginate', '--slurp',
                'repos/DruHustle/' + name + '/pulls?state=open&per_page=100']).stdout)
            records = []
            for pr in [item for page in pages for item in page]:
                number, head, base = pr['number'], pr['head']['sha'], pr['base']['sha']
                if not all(re.fullmatch('[a-f0-9]{40}', sha) for sha in (head, base)):
                    raise SystemExit('Invalid upstream identity')
                git(['fetch', 'origin', '+refs/pull/' + str(number) + '/head:refs/pull/' + str(number) + '/head'], repo)
                merge_base = git(['merge-base', base, head], repo).decode().strip()
                paths = git(['diff', '--name-only', '-z', merge_base, head], repo).decode().split('\0')
                changes = {}
                for path in filter(None, paths):
                    if path.startswith('/') or '..' in Path(path).parts:
                        raise SystemExit('Unsafe upstream path')
                    current = blob(ROOT, revision, name + '/' + path)
                    before, after = blob(repo, merge_base, path), blob(repo, head, path)
                    if current == after:
                        status = 'identical-to-pr-head'
                    elif current == before:
                        status = 'change-not-incorporated'
                    else:
                        patch = git(['diff', '--binary', merge_base, head, '--', path], repo)
                        prefix = ['git', 'apply', '--check', '--directory=' + name]
                        if run(prefix + ['--reverse'], data=patch, check=False).returncode == 0:
                            status = 'patch-present-with-later-changes'
                        elif run(prefix, data=patch, check=False).returncode == 0:
                            status = 'patch-still-applicable'
                        else:
                            status = 'requires-reconciliation'
                    changes[path] = status
                record = {'number': number, 'head': head, 'base': base,
                          'mergeBase': merge_base, 'changes': changes}
                records.append(record)
                print(json.dumps({'component': component, **record}, sort_keys=True), flush=True)
            git(['bundle', 'create', str(out / (name + '.bundle')), '--all'], repo)
            git(['bundle', 'verify', str(out / (name + '.bundle'))], repo)
            refs = git(['show-ref'], repo).decode()
            (out / (name + '-refs.txt')).write_text(refs)
            report['components'][component] = {'pullRequests': records, 'refsSha256': hashlib.sha256(refs.encode()).hexdigest()}
    checksums = {}
    for bundle in sorted(out.glob('*.bundle')):
        digest = hashlib.sha256()
        with bundle.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        checksums[bundle.name] = digest.hexdigest()
    report['bundleSha256'] = checksums
    (out / 'audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'revision': revision, 'bundlesVerified': sorted(checksums),
                      'productionVerified': False, 'rollbackVerified': False, 'deletionAuthorized': False}), flush=True)
    for relative in ('scripts/verify-runtime.mts', 'scripts/deploy-vm.py',
                     'scripts/prepare-manual-release.py', 'scripts/bundle-smoke.py',
                     'scripts/qualification/trusted-path.py', 'scripts/check-deployment.mjs'):
        path = ROOT / 'smart-factory-frontend' / relative
        if path.is_file():
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if re.search(r'qualification-sources|rollback-sources|DruHustle/smart-factory|rev-parse|git archive|SOURCE_REVISION', line):
                    print('SOURCE-REFERENCE ' + relative + ':' + str(number) + ': ' + line[:400], flush=True)
    print('Source backup and comparison only; seven-day artifacts are not durable retirement backups.', flush=True)


if __name__ == '__main__':
    main()
