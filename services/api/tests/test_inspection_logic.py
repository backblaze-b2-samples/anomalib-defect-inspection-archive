"""Pure inspection logic: status, review selection, training sets, metrics, Parquet."""

from datetime import UTC, date, datetime, timedelta

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from app.repo import parquet_scores
from app.service import metrics_calc, review, state, training
from app.types.inspection import PartStatus
from app.types.models import TrainingSource

T0 = datetime(2026, 11, 16, 8, 0, tzinfo=UTC)


def _row(serial, score, threshold=1.0, minutes=0, version="v1"):
    return {
        "line_id": "line-01",
        "serial": serial,
        "capture_date": date(2026, 11, 16),
        "image_key": f"lines/line-01/2026-11-16/images/{serial}.png",
        "heatmap_key": f"lines/line-01/2026-11-16/heatmaps/{serial}.{version}.png",
        "score": score,
        "threshold": threshold,
        "above_threshold": score >= threshold,
        "model_version": version,
        "backbone": "wide_resnet50_2",
        "anomalib_version": "2.7.0",
        "scored_at": T0 + timedelta(minutes=minutes),
    }


def _state(parts, scores=None, labels=None):
    st = state.LineState(line_id="line-01")
    for i, (serial, reference) in enumerate(parts):
        st.parts[serial] = {
            "serial": serial,
            "capture_date": "2026-11-16",
            "image_key": f"lines/line-01/2026-11-16/images/{serial}.png",
            "captured_at": (T0 + timedelta(minutes=i)).isoformat(),
            "reference": reference,
        }
    st.scores = scores or {}
    st.labels = labels or {}
    return st


def test_status_derivation_latest_verdict_then_latest_score():
    assert state.derive_status([], []) == PartStatus.unscored
    assert state.derive_status([_row("a", 0.5)], []) == PartStatus.below_threshold
    assert state.derive_status([_row("a", 1.5)], []) == PartStatus.in_review
    # A later re-score below threshold leaves review.
    assert state.derive_status([_row("a", 1.5), _row("a", 0.2, minutes=1)], []) == (
        PartStatus.below_threshold
    )
    verdicts = [{"verdict": "fail"}, {"verdict": "pass"}]
    assert state.derive_status([_row("a", 1.5)], verdicts) == PartStatus.passed
    assert state.derive_status([_row("a", 1.5)], verdicts[:1]) == PartStatus.failed


def test_review_queue_selects_unadjudicated_above_threshold_oldest_first():
    st = _state([("old", None), ("mid", None), ("new", None), ("low", None), ("done", None)])
    st.scores = {
        "new": [_row("new", 2.0)],
        "old": [_row("old", 3.0)],
        "mid": [_row("mid", 1.0)],  # exactly at threshold counts as above
        "low": [_row("low", 0.1)],
        "done": [_row("done", 5.0)],
    }
    st.labels = {"done": [{"verdict": "pass", "recorded_at": T0.isoformat()}]}
    assert review.select_for_review(st) == ["old", "mid", "new"]


def test_training_set_pass_trains_fail_evals_and_holds_out_references():
    parts = [(f"r{i}", "normal") for i in range(5)] + [("ra", "anomalous"), ("p", None), ("f", None), ("u", None)]
    st = _state(parts)
    st.labels = {
        "p": [{"verdict": "fail"}, {"verdict": "pass"}],
        "f": [{"verdict": "fail"}],
    }
    entries = {e["serial"]: e for e in training.assemble_training_set(st, TrainingSource.reference_and_adjudicated)}
    assert entries["p"] == {"serial": "p", "key": entries["p"]["key"], "role": "train",
                            "label": "normal", "source": "verdict"}
    assert (entries["f"]["role"], entries["f"]["label"], entries["f"]["source"]) == (
        "eval", "anomalous", "verdict",
    )
    assert (entries["ra"]["role"], entries["ra"]["label"]) == ("eval", "anomalous")
    assert entries["r4"]["role"] == "eval"  # every 5th reference normal is held out
    assert [entries[f"r{i}"]["role"] for i in range(4)] == ["train"] * 4
    assert "u" not in entries  # neither reference nor adjudicated


def test_reference_only_ignores_verdicts():
    st = _state([("r0", "normal"), ("r1", "normal"), ("r2", "normal"), ("p", None)])
    st.labels = {"p": [{"verdict": "pass"}]}
    entries = training.assemble_training_set(st, TrainingSource.reference_only)
    assert {e["serial"] for e in entries} == {"r0", "r1", "r2"}
    # With fewer than five normals one is still held out for eval.
    assert sum(1 for e in entries if e["role"] == "eval") == 1


def test_too_few_normals_is_a_clear_400():
    with pytest.raises(training.InspectionError) as err:
        training._check_trainable([{"role": "train", "label": "normal"}])
    assert err.value.status_code == 400


def test_metrics_f1_threshold_auroc_and_p99_fallback():
    labels = [0, 0, 0, 1, 1]
    scores = [1.0, 2.0, 3.0, 4.0, 5.0]
    result = metrics_calc.evaluate(labels, scores)
    assert result["threshold"] == 4.0
    assert result["threshold_method"] == "f1_max"
    assert result["image_auroc"] == 1.0
    assert result["image_f1"] == 1.0
    # pos {1.0, 0.5} vs neg {1.0, 2.0}: one tie (0.5) out of four pairs.
    assert metrics_calc.auroc([0, 1, 0, 1], [1.0, 1.0, 2.0, 0.5]) == pytest.approx(0.125)
    normal_only = metrics_calc.evaluate([0] * 5, [1.0, 2.0, 3.0, 4.0, 5.0])
    assert normal_only["threshold_method"] == "p99_normal"
    assert normal_only["threshold"] == pytest.approx(4.96)
    assert normal_only["image_auroc"] is None


def test_parquet_rows_round_trip_with_schema():
    rows = [_row("a", 0.5), _row("b", 2.5, minutes=1)]
    data = parquet_scores.encode_rows(rows)
    table = pq.read_table(pa.BufferReader(data))
    assert table.schema.names == list(parquet_scores.COLUMNS)
    assert table.schema.field("capture_date").type == pa.date32()
    assert table.schema.field("score").type == pa.float64()
    back = parquet_scores.decode_rows(data)
    assert [r["serial"] for r in back] == ["a", "b"]
    assert back[1]["above_threshold"] is True
    assert back[0]["scored_at"] == T0
    assert back[0]["capture_date"] == date(2026, 11, 16)


def test_parquet_reader_tolerates_added_columns():
    table = pa.Table.from_pylist([{**_row("a", 0.5), "operator_station": "S2"}])
    sink = pa.BufferOutputStream()
    pq.write_table(table, sink)
    back = parquet_scores.decode_rows(sink.getvalue().to_pybytes())
    assert back[0]["operator_station"] == "S2"
    assert back[0]["serial"] == "a"


def test_parquet_rejects_incomplete_rows():
    row = _row("a", 0.5)
    del row["threshold"]
    with pytest.raises(ValueError):
        parquet_scores.encode_rows([row])
