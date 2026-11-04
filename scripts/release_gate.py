#!/usr/bin/env python3
"""Read-only exact-source gates. These checks never deploy or delete repositories."""
import argparse
import json
import re
import subprocess

REPOSITORY = 'DruHustle/smart-factory'
WORKFLOWS = ('quality.yml', 'frontend-quality.yml', 'bundle-arm64.yml',
             'documentation-artifacts.yml', 'renderer-quality.yml',
             'release-contracts.yml', 'feature-coverage.yml')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-f0-9]{40}', value),
            'An exact lowercase Git commit is required.')
    return value


def api(path):
    result = subprocess.run(['gh', 'api', '--hostname', 'github.com',
                             'repos/' + REPOSITORY + '/' + path],
                            capture_output=True, text=True, timeout=60)
    require(result.returncode == 0, 'GitHub metadata could not be verified: ' + path.split('?')[0])
    return json.loads(result.stdout)


def successful_run(run, revision, workflow):
    require(isinstance(run, dict), 'Missing workflow run.')
    require(run.get('head_sha') == sha(revision) and run.get('head_branch') == 'main',
            'Qualification is not for the exact main revision.')
    require(run.get('event') in ('push', 'workflow_dispatch') and run.get('path') == '.github/workflows/' + workflow,
            'Qualification must be a canonical main push or manually dispatched main workflow.')
    require(run.get('repository', {}).get('full_name') == REPOSITORY and
            run.get('head_repository', {}).get('full_name') == REPOSITORY,
            'Qualification belongs to a different source repository.')
    require(run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'The latest qualification is not successful: ' + workflow)
    require(type(run.get('id')) is int and run['id'] > 0, 'Invalid workflow identity.')
    return run['id']


def check_ci(revision, read=api):
    sha(revision)
    require(read('commits/main').get('sha') == revision, 'The approved main revision has changed.')
    runs = {}
    for workflow in WORKFLOWS:
        value = read('actions/workflows/' + workflow + '/runs?branch=main&head_sha=' + revision + '&per_page=100')
        candidates = [run for run in value.get('workflow_runs', []) if run.get('head_sha') == revision]
        require(candidates, 'No exact-source main qualification for ' + workflow)
        # A newer failure or in-progress attempt must never be hidden by an older green run.
        latest = max(candidates, key=lambda run: (run.get('id', 0), run.get('run_attempt', 0)))
        runs[workflow] = successful_run(latest, revision, workflow)
    require(read('commits/main').get('sha') == revision, 'Main changed while checking qualification.')
    return runs


def artifact_identity(value, run_id, revision):
    require(type(value.get('id')) is int and value['id'] > 0, 'Invalid artifact ID.')
    require(value.get('name') == 'qualified-arm64-bundle' and value.get('expired') is False,
            'The exact qualification artifact is absent or expired.')
    require(type(value.get('size_in_bytes')) is int and 0 < value['size_in_bytes'] <= 2 * 1024**3,
            'The qualification artifact exceeds its bounded size.')
    run = value.get('workflow_run', {})
    require(run.get('id') == run_id and run.get('head_sha') == sha(revision),
            'Artifact source or run does not match the selected qualification.')
    digest = value.get('digest')
    require(isinstance(digest, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', digest),
            'GitHub must supply the artifact digest; never synthesize it.')
    return digest.removeprefix('sha256:')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    print(json.dumps({'repository': REPOSITORY, 'revision': args.revision,
                      'qualifiedRuns': check_ci(args.revision), 'productionVerified': False,
                      'rollbackVerified': False, 'deletionAuthorized': False}, indent=2))


if __name__ == '__main__':
    main()
