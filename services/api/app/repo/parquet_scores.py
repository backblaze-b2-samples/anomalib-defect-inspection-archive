"""Score rows as immutable Parquet part files (pyarrow is contained here).

Object storage has no append, so "appending" a score means writing one NEW part
file per scoring call; nothing is ever rewritten. Readers list a line's part
files and concatenate them, tolerating columns added later.
"""

import io
from datetime import UTC, datetime
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema(
    [
        ("line_id", pa.string()),
        ("serial", pa.string()),
        ("capture_date", pa.date32()),
        ("image_key", pa.string()),
        ("heatmap_key", pa.string()),
        ("score", pa.float64()),
        ("threshold", pa.float64()),
        ("above_threshold", pa.bool_()),
        ("model_version", pa.string()),
        ("backbone", pa.string()),
        ("anomalib_version", pa.string()),
        ("scored_at", pa.timestamp("us", tz="UTC")),
    ]
)
COLUMNS = tuple(SCHEMA.names)


def encode_rows(rows: list[dict[str, Any]]) -> bytes:
    """Serialize score rows (dicts with every SCHEMA column) to Parquet bytes."""
    if not rows:
        raise ValueError("No score rows to write")
    missing = [c for c in COLUMNS if c not in rows[0]]
    if missing:
        raise ValueError(f"Score row is missing columns: {missing}")
    table = pa.Table.from_pylist([{c: row[c] for c in COLUMNS} for row in rows], schema=SCHEMA)
    sink = io.BytesIO()
    pq.write_table(table, sink, compression="zstd")
    return sink.getvalue()


def _normalize(value: Any) -> Any:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def decode_rows(data: bytes) -> list[dict[str, Any]]:
    """Parse one part file. Extra columns are kept; missing optional ones are None."""
    table = pq.read_table(io.BytesIO(data))
    rows = table.to_pylist()
    out = []
    for row in rows:
        normalized = {key: _normalize(value) for key, value in row.items()}
        for column in COLUMNS:
            normalized.setdefault(column, None)
        if isinstance(normalized.get("capture_date"), datetime):
            normalized["capture_date"] = normalized["capture_date"].date()
        out.append(normalized)
    return out
