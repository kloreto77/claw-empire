from datetime import datetime
import gzip
import hashlib
import json

import pytest

from axiom_retention import archive_expired, log_paths, open_log
from axiom_runtime import freeze_inputs, inputs, scan


CUTOFF = int(datetime.fromisoformat("2026-11-26T12:00:00+00:00").timestamp() * 1000)


def test_archival_preserves_causal_inputs_and_skips_recent_segments(tmp_path):
    event_time = int(datetime.fromisoformat("2026-10-25T12:00:00+00:00").timestamp() * 1000)
    event = {
        "operator_id": "axiom-01", "schema_version": 1, "run_id": "r",
        "ts_receive_utc": event_time + 1000, "kind": "FEATURE_1M",
        "data": {"symbol": "BTCUSDT", "end": event_time},
    }
    raw_bytes = (json.dumps(event) + "\n{").encode()
    old = tmp_path / "2026-10-25.ndjson"
    old.write_bytes(raw_bytes)
    for name in ("2026-10-27.ndjson", "2026-11-26.ndjson", "manual.ndjson"):
        (tmp_path / name).touch()
    before, before_hash = freeze_inputs(inputs(tmp_path), tmp_path / "before", CUTOFF)
    result = archive_expired(tmp_path, CUTOFF)
    assert result["archived"]["day"] == "2026-10-25"
    assert result["archived"]["sha256"] == hashlib.sha256(raw_bytes).hexdigest()
    assert not old.exists()
    with open_log(old, "rb") as archived:
        assert archived.read() == raw_bytes
    after, after_hash = freeze_inputs(inputs(tmp_path), tmp_path / "after", CUTOFF)
    assert after_hash == before_hash
    assert after.read_bytes() == before.read_bytes()
    assert scan(inputs(tmp_path), CUTOFF)["invalid_records"] == 1
    assert archive_expired(tmp_path, CUTOFF)["archived"] is None


def test_pressure_archives_one_segment_and_preserves_active_files(tmp_path):
    files = {}
    for day in ("23", "24", "25", "26"):
        files[day] = tmp_path / f"2026-11-{day}.ndjson"
        files[day].write_bytes(b"data to compress\n" * 1024)
    result = archive_expired(tmp_path, CUTOFF, cap_bytes=25000)
    assert result["storage_pressure"] is True
    assert result["archived"]["day"] == "2026-11-23"
    assert result["archive_bytes"] < result["archived"]["raw_bytes"]
    assert all(files[day].exists() for day in ("24", "25", "26"))


@pytest.mark.parametrize("compressed", [b"broken", gzip.compress(b"different")])
def test_existing_invalid_archive_never_removes_raw(tmp_path, compressed):
    original = tmp_path / "2026-10-25.ndjson"
    conflicting = tmp_path / "2026-10-25.ndjson.gz"
    original.write_bytes(b"important evidence\n")
    conflicting.write_bytes(compressed)
    result = archive_expired(tmp_path, CUTOFF)
    assert result["archived"] is None
    assert result["error"] in {"BadGzipFile", "ValueError"}
    assert original.read_bytes() == b"important evidence\n"
    assert conflicting.read_bytes() == compressed
    assert log_paths(tmp_path) == [original]


def test_resume_valid_archive(tmp_path):
    original = tmp_path / "2026-10-25.ndjson"
    archived = tmp_path / "2026-10-25.ndjson.gz"
    original.write_bytes(b"important evidence\n")
    compressed = gzip.compress(original.read_bytes())
    archived.write_bytes(compressed)
    result = archive_expired(tmp_path, CUTOFF)
    assert result["error"] is None
    assert log_paths(tmp_path) == [archived]
    assert archived.read_bytes() == compressed


def test_hourly_pressure_archives_closed_segment_without_touching_writer(tmp_path):
    for hour in (9, 10, 11, 12):
        (tmp_path / f"2026-11-26T{hour:02d}.ndjson").write_bytes(b"data\n" * 1000)
    result = archive_expired(tmp_path, CUTOFF, cap_bytes=21000)
    assert result["measured_hours"] == 2
    assert result["archived"]["segment"] == "2026-11-26T09.ndjson"
    assert (tmp_path / "2026-11-26T09.ndjson.gz").exists()
    assert (tmp_path / "2026-11-26T10.ndjson").exists()
    assert (tmp_path / "2026-11-26T11.ndjson").exists()
    assert (tmp_path / "2026-11-26T12.ndjson").exists()
