"""Bounded, lossless retention for the Mesa collector's UTC NDJSON segments."""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile


RAW_RETENTION_DAYS = 30
LOG_CAP_BYTES = 2 * 1024**3
CHUNK_BYTES = 1024**2
DATED_LOG = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2})?\.ndjson")


def _period(name):
    if not DATED_LOG.fullmatch(name):
        return None
    stamp = name.removesuffix(".ndjson")
    try:
        start = datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return start, 1 if "T" in stamp else 24


def log_paths(root):
    """Prefer the raw copy if an interrupted archive left both copies present."""
    root = Path(root).resolve()
    paths = {}
    for path in sorted(root.glob("*.ndjson.gz")) + sorted(root.glob("*.ndjson")):
        if path.is_file() and not path.is_symlink():
            paths[path.name.removesuffix(".gz")] = path
    return [paths[name] for name in sorted(paths)]


def open_log(path, mode="rt"):
    options = {} if "b" in mode else {"encoding": "utf-8"}
    if path.suffix == ".gz":
        return gzip.open(path, mode, **options)
    try:
        return path.open(mode, **options)
    except FileNotFoundError:
        # A maintenance job may have completed since discovery.
        return gzip.open(path.with_suffix(".ndjson.gz"), mode, **options)


def _file_digest(stream, destination=None):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(CHUNK_BYTES), b""):
        digest.update(chunk)
        if destination is not None:
            destination.write(chunk)
    return digest.hexdigest()


def _verify_archive(path, expected):
    with gzip.open(path, "rb") as compressed:
        if _file_digest(compressed) != expected:
            raise ValueError("archive checksum mismatch")


def _fingerprint(stat):
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)


def _sync_directory(root):
    if os.name == "posix":
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _archive(source):
    target = source.with_suffix(".ndjson.gz")
    temporary = None
    try:
        with source.open("rb") as raw:
            original = _fingerprint(os.fstat(raw.fileno()))
            if target.is_symlink():
                raise ValueError("archive path is a symbolic link")
            if target.exists():
                digest = _file_digest(raw)
            else:
                with tempfile.NamedTemporaryFile(
                    dir=source.parent, prefix=".axiom-archive-", delete=False
                ) as output:
                    temporary = Path(output.name)
                    with gzip.GzipFile(filename="", fileobj=output, mode="wb",
                                       compresslevel=1, mtime=0) as compressed:
                        digest = _file_digest(raw, compressed)
                    output.flush()
                    os.fsync(output.fileno())
        if temporary is not None:
            _verify_archive(temporary, digest)
            # Publish only a verified file and keep any concurrently published copy.
            try:
                os.link(temporary, target)
            except FileExistsError:
                if target.is_symlink():
                    raise ValueError("archive path is a symbolic link")
                _verify_archive(target, digest)
        else:
            _verify_archive(target, digest)
        _sync_directory(source.parent)
        if _fingerprint(source.stat()) != original:
            raise ValueError("source changed during archival")
        source.unlink()
        return {"day": source.name[:10], "segment": source.name, "sha256": digest,
                "raw_bytes": original[2], "archive_bytes": target.stat().st_size}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _sizes(root):
    raw = {}
    archived = {}
    for path in root.iterdir():
        if path.is_symlink() or not path.is_file():
            continue
        if path.suffix == ".ndjson":
            raw[path.name] = path.stat().st_size
        elif path.name.endswith(".ndjson.gz"):
            archived[path.name.removesuffix(".gz")] = path.stat().st_size
    return raw, archived


def archive_expired(root, cutoff, *, cap_bytes=LOG_CAP_BYTES):
    """Archive at most one closed segment and keep all original records replayable."""
    root = Path(root).resolve()
    now = datetime.fromtimestamp(cutoff / 1000, timezone.utc)
    retention_start = now - timedelta(days=RAW_RETENTION_DAYS)
    raw, archives = _sizes(root)
    closed = {}
    covered_hours = set()
    measured_bytes = 0
    for name, size in (archives | raw).items():
        period = _period(name)
        if period is None:
            continue
        start, hours = period
        end = start + timedelta(hours=hours)
        # Leave the active and immediately preceding UTC periods to the writer.
        if end + timedelta(hours=hours) > now:
            continue
        closed[name] = end
        measured_bytes += size
        covered_hours.update(start + timedelta(hours=i) for i in range(hours))
    daily_bytes = 24 * measured_bytes // len(covered_hours) if covered_hours else None
    projected = daily_bytes * RAW_RETENTION_DAYS if daily_bytes is not None else None
    total = sum(raw.values()) + sum(archives.values())
    constrained = (projected is not None and projected > cap_bytes) or total >= cap_bytes
    result = {"raw_retention_days": RAW_RETENTION_DAYS, "limit_bytes": cap_bytes,
              "measured_days": len({hour.date() for hour in covered_hours}),
              "measured_hours": len(covered_hours), "measured_bytes_per_day": daily_bytes,
              "projected_30_day_bytes": projected, "storage_pressure": constrained,
              "raw_bytes": sum(raw.values()), "archive_bytes": sum(archives.values()),
              "archived": None, "error": None}
    for name in sorted(raw):
        if name not in closed:
            continue
        if closed[name] > retention_start and not constrained:
            continue
        if name not in archives and shutil.disk_usage(root).free < raw[name] + CHUNK_BYTES:
            result["error"] = "INSUFFICIENT_FREE_DISK"
            break
        try:
            archived = _archive(root / name)
            result["archived"] = archived
            result["raw_bytes"] -= archived["raw_bytes"]
            if name not in archives:
                result["archive_bytes"] += archived["archive_bytes"]
        except (OSError, EOFError, ValueError) as error:
            # Keep the original and surface failures without exposing local paths.
            result["error"] = type(error).__name__
        break
    if result["error"]:
        result["status"] = "ERROR"
    elif result["archived"]:
        result["status"] = "ARCHIVED"
    elif constrained:
        result["status"] = "PRESSURE"
    else:
        result["status"] = "WITHIN_POLICY"
    return result
