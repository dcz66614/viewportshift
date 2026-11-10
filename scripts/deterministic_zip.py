#!/usr/bin/env python3
"""P021 ViewportShift T014 — deterministic ZIP creation and verification.

Determinism contract (P021_IMPLEMENTATION_PLAN.md §6.3):
  * entries sorted by name (byte order);
  * every entry timestamp fixed to 1980-01-01 00:00:00 (ZIP epoch);
  * fixed Unix permissions (0o644 files, 0o755 directories);
  * ZIP_DEFLATED at compresslevel 9, no comments, no extra fields;
  * relative paths only — no absolute paths, no "..", no duplicates.

Usage:
  python3 scripts/deterministic_zip.py --create --root <dir> \
      --list <file-with-one-relative-path-per-line> --output <zip>
  python3 scripts/deterministic_zip.py --verify <zip>

--create reads the listed files (relative to --root), adds explicit
directory entries for every parent directory, and writes the zip.
--verify checks the determinism contract (sorted entries, fixed
timestamps, no absolute/parent paths, no duplicates, testzip clean)
and prints the zip's SHA-256. Exit 0 only when every check passes.
"""

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

FIXED_DATE = (1980, 1, 1, 0, 0, 0)
FILE_MODE = 0o644
DIR_MODE = 0o755


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _zip_info(name, is_dir):
    info = zipfile.ZipInfo(filename=name, date_time=FIXED_DATE)
    info.create_system = 3  # Unix
    info.external_attr = ((DIR_MODE if is_dir else FILE_MODE) << 16)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_version = 20
    info.extract_version = 20
    info.flag_bits = 0x00
    return info


def create_zip(root, file_list, output):
    root = Path(root).resolve()
    rel_paths = []
    for line in Path(file_list).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if Path(line).is_absolute() or ".." in Path(line).parts:
            raise ValueError(f"refusing non-relative path in list: {line!r}")
        rel_paths.append(line)
    if len(set(rel_paths)) != len(rel_paths):
        raise ValueError("duplicate paths in file list")
    rel_paths.sort()

    # Collect parent directories (as "dir/" entries), sorted.
    dirs = set()
    for rel in rel_paths:
        parts = Path(rel).parts[:-1]
        for i in range(1, len(parts) + 1):
            dirs.add("/".join(parts[:i]) + "/")
    entries = sorted(dirs | set(rel_paths))

    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9) as zf:
        zf.comment = b""
        for name in entries:
            if name.endswith("/"):
                zf.writestr(_zip_info(name, True), b"")
            else:
                data = (root / name).read_bytes()
                zf.writestr(_zip_info(name, False), data)
    return out


def verify_zip(path):
    errors = []
    with zipfile.ZipFile(path, "r") as zf:
        infos = zf.infolist()
        names = [i.filename for i in infos]
        if names != sorted(names):
            errors.append("entries are not sorted")
        if len(set(names)) != len(names):
            errors.append("duplicate entries")
        for info in infos:
            if info.filename.startswith("/") or Path(info.filename).is_absolute():
                errors.append(f"absolute path entry: {info.filename}")
            if ".." in Path(info.filename).parts:
                errors.append(f"parent path entry: {info.filename}")
            if info.date_time != FIXED_DATE:
                errors.append(
                    f"non-fixed timestamp {info.date_time} on {info.filename}")
            if info.compress_type not in (zipfile.ZIP_DEFLATED,
                                         zipfile.ZIP_STORED):
                errors.append(f"unexpected compression on {info.filename}")
        bad = zf.testzip()
        if bad is not None:
            errors.append(f"corrupt entry: {bad}")
        if zf.comment:
            errors.append("zip has a comment")
    print(f"verify: {path}: {len(infos)} entries, "
          f"sha256={sha256_file(path)}")
    if errors:
        for e in errors:
            print(f"verify: FAIL — {e}")
        return 1
    print("verify: PASS — deterministic contract holds "
          "(sorted, fixed 1980-01-01 timestamps, relative paths only)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--create", action="store_true")
    ap.add_argument("--verify", metavar="ZIP")
    ap.add_argument("--root", default=".")
    ap.add_argument("--list", metavar="FILELIST")
    ap.add_argument("--output", metavar="ZIP")
    args = ap.parse_args(argv)

    if args.create:
        if not args.list or not args.output:
            ap.error("--create requires --list and --output")
        out = create_zip(args.root, args.list, args.output)
        print(f"create: {out}: sha256={sha256_file(out)}")
        return 0
    if args.verify:
        return verify_zip(args.verify)
    ap.error("specify --create or --verify")
    return 2


if __name__ == "__main__":
    sys.exit(main())
