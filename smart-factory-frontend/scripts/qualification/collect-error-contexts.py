#!/usr/bin/env python3
"""Copy only bounded regular Playwright failure contexts into a new private folder."""
import argparse
import os
from pathlib import Path
import stat

MAX_FILES = 256
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024


def collect(source: Path, destination: Path) -> int:
    # A new destination prevents earlier files, aliases or unrelated artifacts
    # from entering this upload. GitHub's RUNNER_TEMP is the trusted parent.
    destination.mkdir(mode=0o700)
    try:
        root = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return 0
    count = total = 0
    try:
        # fwalk's directory descriptors and openat/O_NOFOLLOW bind reads to the
        # observed source tree; a symlink replacement cannot redirect a read.
        for relative, directories, files, directory in os.fwalk(
            '.', follow_symlinks=False, dir_fd=root,
        ):
            for name in directories:
                mode = os.stat(name, dir_fd=directory, follow_symlinks=False).st_mode
                if not stat.S_ISDIR(mode):
                    raise ValueError('Refusing a linked failure-context directory')
            directories[:] = [name for name in directories if not name.startswith('.')]
            if 'error-context.md' not in files:
                continue
            descriptor = os.open('error-context.md', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                 dir_fd=directory)
            with os.fdopen(descriptor, 'rb') as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                    raise ValueError('Failure context must be a unique regular file')
                content = stream.read(MAX_FILE_BYTES + 1)
            count += 1
            total += len(content)
            if count > MAX_FILES or len(content) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                raise ValueError('Failure context collection exceeds its bounded size')
            target = destination / relative / 'error-context.md'
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            output = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600)
            with os.fdopen(output, 'wb') as stream:
                stream.write(content)
    finally:
        os.close(root)
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    print(f'Collected {collect(args.source, args.destination)} synthetic failure contexts.')


if __name__ == '__main__':
    main()
