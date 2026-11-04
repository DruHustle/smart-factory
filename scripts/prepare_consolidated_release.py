#!/usr/bin/env python3
"""Prepare the existing strict VM installer's manifest from canonical CI artifacts.

Read-only GitHub access only. No legacy repository download, rebuild, SSH,
production write, database operation or deletion. --baseline must describe the
reviewed installed runtime, not the isolated CI fallback. The VM installer's
independent read-only preflight checks this baseline again before any change.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import zipfile
from release_gate import REPOSITORY, api, artifact_identity, check_ci, require, sha

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'smart-factory-frontend'


def module(name, relative):
    spec = importlib.util.spec_from_file_location(name, FRONTEND / relative)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def unpack(archive_path, destination, members):
    with zipfile.ZipFile(archive_path) as archive:
        require(len(archive.infolist()) == len(members) and set(archive.namelist()) == members,
                'Artifact members differ from the strict seven-file release bundle.')
        for entry in archive.infolist():
            mode = entry.external_attr >> 16
            limit = 2 * 1024**3 if entry.filename.endswith('.tar.gz') else 4 * 1024**2
            require(not entry.is_dir() and not entry.flag_bits & 1 and
                    stat.S_IFMT(mode) in (0, stat.S_IFREG) and 0 < entry.file_size <= limit,
                    'Unsafe or oversized qualification artifact entry.')
            target = destination / entry.filename
            with archive.open(entry) as source, target.open('xb') as output:
                os.chmod(target, 0o600)
                copied = 0
                while block := source.read(1024 * 1024):
                    copied += len(block)
                    require(copied <= entry.file_size, 'Artifact decompression exceeded its declared size.')
                    output.write(block)
                require(copied == entry.file_size, 'Artifact entry was truncated.')


def prepare(revision, artifact_id, baseline_path, output):
    sha(revision)
    require(type(artifact_id) is int and artifact_id > 0, 'Invalid artifact ID.')
    actual = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    require(actual == revision, 'Run the preparer from the exact reviewed canonical checkout.')
    status = subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain'], text=True)
    require(not status, 'Use a clean checkout; preserve unrelated work in a separate worktree.')
    info = baseline_path.lstat()
    require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 4 * 1024**2,
            'An explicit bounded installed-runtime baseline file is required.')
    baseline = json.loads(baseline_path.read_text())
    runs = check_ci(revision)
    metadata = api('actions/artifacts/' + str(artifact_id))
    run_id = runs['bundle-arm64.yml']
    expected_digest = artifact_identity(metadata, run_id, revision)
    rollback = sha(json.loads((ROOT / 'release/qualification.json').read_text())['rollbackRevision'])
    require(rollback != revision, 'The compatibility fallback cannot be the candidate.')
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    archive_path = output / 'qualified-arm64-bundle.zip'
    with archive_path.open('xb') as stream:
        os.chmod(archive_path, 0o600)
        result = subprocess.run(['gh', 'api', '--hostname', 'github.com',
                                 f'repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip'],
                                stdout=stream, stderr=subprocess.PIPE, timeout=900)
    require(result.returncode == 0, 'The qualified artifact could not be downloaded.')
    require(archive_path.stat().st_size == metadata['size_in_bytes'] and digest(archive_path) == expected_digest,
            'Downloaded bytes do not match GitHub artifact identity.')
    core = module('factory_vm_release_verifier', 'scripts/deploy-vm.py')
    # Reuse only the pure OCI-byte verifier. No legacy source/preparation function runs.
    oci = module('factory_oci_release_verifier', 'scripts/prepare-manual-release.py')
    with tempfile.TemporaryDirectory(prefix='verified-images-', dir=output) as temporary:
        evidence = Path(temporary)
        unpack(archive_path, evidence, core.MEMBERS)
        result = json.loads((evidence / 'result.json').read_text())
        releases = {}
        for role, source_revision in (('candidate', revision), ('rollback', rollback)):
            sources = dict.fromkeys(('frontend', 'backend', 'edge'), source_revision)
            inspections = json.loads((evidence / ('image.json' if role == 'candidate' else 'rollback-image.json')).read_text())
            require(isinstance(inspections, list) and len(inspections) == 1, 'Expected one exact image inspection.')
            tag = 'factory-qualified:' + role
            image_archive = evidence / (role + '.tar.gz')
            config_id, manifest_id = oci.oci_identities(image_archive, tag, inspections[0], sources)
            runtime = result.get('runtime') if role == 'candidate' else result.get('compatibleRollback', {}).get('runtime')
            require(isinstance(runtime, dict) and isinstance(runtime.get('schema'), dict), 'Actual runtime proof is missing.')
            releases[role] = {'sources': sources, 'configId': config_id, 'manifestId': manifest_id,
                              'archiveSha256': digest(image_archive), 'sourceTag': tag,
                              'schema': {key: runtime['schema'].get(key) for key in ('revision', 'digest')},
                              'capabilities': runtime.get('capabilities')}
    manifest = {'manifestVersion': 1, 'artifact': {'sha256': expected_digest,
                'size': metadata['size_in_bytes'], 'provenance': {'kind': 'github-arm64-qualification',
                'workflowRunId': run_id, 'artifactId': artifact_id}}, **releases, 'baseline': baseline}
    core.M = core.validate_manifest(manifest)
    core.verify_bundle(archive_path)
    require(check_ci(revision) == runs, 'Qualification changed while preparing the artifact.')
    manifest_path = output / 'release-manifest.json'
    core.write_json_private(manifest_path, manifest)
    return {'status': 'PREPARED', 'revision': revision, 'bundle': str(archive_path),
            'manifest': str(manifest_path), 'productionAccess': False,
            'productionVerified': False, 'rollbackVerified': False, 'deletionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--artifact-id', required=True, type=int)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.revision, args.artifact_id, args.baseline.resolve(),
                                 args.output_dir.absolute()), indent=2))
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        parser.exit(1, 'STOPPED: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
