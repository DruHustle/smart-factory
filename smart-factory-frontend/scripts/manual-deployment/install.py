#!/usr/bin/env python3
"""Install workspace launchers. Default is a read-only plan; --execute writes them."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sys


def validate_sources(sources):
    """Keep incompatible canonical layouts out of legacy launcher configuration."""
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(
        "smart_factory_legacy_manual_cli", Path(__file__).with_name("cli.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.repositories(sources)
    except module.ReleaseError as error:
        raise SystemExit(str(error)) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    root, sources = args.workspace.expanduser().resolve(), args.source_root.expanduser().resolve()
    tools = root / "local-tools"
    if tools.is_symlink() or not tools.is_dir() or not all(
        (root / name).is_dir()
        for name in ("smart-factory-frontend", "smart-factory-backend", "smart-factory-edge")
    ):
        raise SystemExit("Expected the canonical Smart Factory workspace and a physical local-tools directory.")
    if not sources.is_relative_to(root) or sources.is_relative_to((tools / "recovered").resolve()):
        raise SystemExit("Select active sources inside the canonical workspace.")
    source = Path(__file__).resolve().parent
    target = root / "local-tools/manual deployment"
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise SystemExit("The manual deployment destination must be a physical directory inside local-tools.")
    files = {"deploy.py": source / "launcher.py", "README.md": source / "README.md"}
    files.update({path.name: path for path in source.glob("*.sh")})
    for name, path in files.items():
        destination = target / name
        if destination.is_symlink():
            raise SystemExit("Existing launcher/document is a symlink; inspect it before installing: " + str(destination))
        if destination.exists() and destination.read_bytes() != path.read_bytes():
            raise SystemExit("Existing launcher/document differs; preserve and review it before replacing: " + str(destination))
    if (target / "config.json").is_symlink():
        raise SystemExit("Existing config.json is a symlink; inspect it before installing.")
    validate_sources(sources)
    print(json.dumps({"target": str(target), "sources": str(sources), "files": list(files),
                      "mode": "install" if args.execute else "plan"}, indent=2))
    if args.execute:
        target.mkdir(parents=True, exist_ok=True)
        for name, path in files.items():
            shutil.copyfile(path, target / name)
            (target / name).chmod(0o755 if name.endswith((".py", ".sh")) else 0o644)
        (target / "config.json").write_text(json.dumps({"sourceRoot": str(sources.relative_to(root))}, indent=2) + "\n")


if __name__ == "__main__":
    main()
