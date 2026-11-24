#!/usr/bin/env python3
"""Extract the immutable candidate for an isolated, synthetic Factory fixture."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile


MAX_PACKAGE = 2 * 1024**3
MAX_METADATA = 4 * 1024**2
MEMBERS = {
    "candidate.tar.gz", "rollback.tar.gz", "archive.sha256", "image.json",
    "rollback-image.json", "result.json", "container-audit.json",
}
CANDIDATE = "candidate.tar.gz"
SHA = re.compile(r"[a-f0-9]{40}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(source, destination=None):
    digest = hashlib.sha256()
    while block := source.read(1024 * 1024):
        digest.update(block)
        if destination is not None:
            destination.write(block)
    return digest.hexdigest()


def inspect_candidate(path, inspection, revision):
    helper = Path(__file__).with_name("prepare-manual-release.py")
    spec = importlib.util.spec_from_file_location("factory_stage_fixture_oci", helper)
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    sources = dict.fromkeys(("frontend", "backend", "edge"), revision)
    return verifier.oci_identities(path, "factory-qualified:candidate", inspection, sources)


def prepare(bundle, output, revision, package_digest, package_size):
    require(SHA.fullmatch(revision) and SHA256.fullmatch(package_digest)
            and type(package_size) is int and 0 < package_size <= MAX_PACKAGE,
            "Supply the exact source, ZIP digest and ZIP size from trusted qualification evidence.")
    require(stat.S_ISREG(bundle.lstat().st_mode), "Use a regular, non-linked qualification ZIP.")
    require(not output.exists() and not output.is_symlink(), "Choose a new candidate output file.")

    with bundle.open("rb") as source, tempfile.TemporaryDirectory(
        prefix=".factory-stage-image-", dir=output.parent,
    ) as temporary:
        require(os.fstat(source.fileno()).st_size == package_size and fingerprint(source) == package_digest,
                "Qualification ZIP bytes do not match the trusted receipt.")
        source.seek(0)
        path = Path(temporary) / CANDIDATE
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            require(len(entries) == len(MEMBERS) and set(archive.namelist()) == MEMBERS,
                    "Unexpected or duplicate qualification files.")
            for item in entries:
                limit = MAX_PACKAGE if item.filename.endswith(".tar.gz") else MAX_METADATA
                require(not item.is_dir() and not item.flag_bits & 1
                        and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG)
                        and 0 < item.file_size <= limit, "Unsafe qualification entry.")
            records = json.loads(archive.read("image.json"))
            require(isinstance(records, list) and len(records) == 1 and isinstance(records[0], dict),
                    "The qualified candidate must have one image inspection.")
            expected = [row.split()[0] for row in archive.read("archive.sha256").decode().splitlines()
                        if re.fullmatch(r"[a-f0-9]{64}\s+(?:test-results/arm64/)?candidate\.tar\.gz", row)]
            require(len(expected) == 1, "Missing or repeated candidate archive digest.")
            with archive.open(CANDIDATE) as candidate, path.open("xb") as target:
                os.fchmod(target.fileno(), 0o600)
                digest = fingerprint(candidate, target)
            require(digest == expected[0], "The candidate archive does not match its qualification digest.")
        image, manifest = inspect_candidate(path, records[0], revision)
        # Publish only the verified candidate and never overwrite an existing file.
        os.link(path, output)

    return {"sourceRevision": revision, "imageId": image, "ociManifest": manifest, "archiveSha256": digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--zip-sha256", required=True)
    parser.add_argument("--zip-bytes", required=True, type=int)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.bundle, args.output, args.revision, args.zip_sha256, args.zip_bytes)))
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Fixture preparation stopped: {error}\n")


if __name__ == "__main__":
    main()
