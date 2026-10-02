#!/usr/bin/env python3
"""Write SHA256SUMS for GitHub's flat downloaded asset names, not artifact paths."""
import argparse
import hashlib
from pathlib import Path


def checksum_lines(root: Path) -> list[str]:
    suffixes = {".deb", ".appimage", ".dmg", ".msi"}
    files = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in suffixes)
    if not files:
        raise ValueError("No installer assets found")
    names = set()
    lines = []
    for path in files:
        name = path.name
        if name.casefold() in names or any(character in name for character in "\n\r\\"):
            raise ValueError(f"Ambiguous installer asset name: {name!r}")
        names.add(name.casefold())
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Installer asset must be a regular file inside the artifact directory")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        lines.append(f"{digest.hexdigest()}  {name}\n")
    return lines


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    print("".join(checksum_lines(args.root)), end="")
