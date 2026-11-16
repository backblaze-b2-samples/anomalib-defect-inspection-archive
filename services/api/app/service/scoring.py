"""Score parts with a ready model version and archive the evidence in B2.

For each part: fill the local cache from B2 (image + checkpoint), run PatchCore,
render the heatmap, write it under ``<date>/heatmaps/<serial>.<version>.png``
(one per model version, so re-scoring keeps earlier heatmaps), then append ONE
new Parquet part file holding the rows of this scoring call.
"""

import logging
from datetime import UTC, date, datetime

from app.repo import anomaly_engine, b2_store, heatmap, local_cache, parquet_scores
from app.repo.anomaly_infer import cached_scorer
from app.service import keys, model_versions
from app.service.errors import unavailable
from app.types.models import ModelVersion

logger = logging.getLogger(__name__)

# Heatmap colour scale: full red at 1.5x the version's threshold, so heatmaps
# from one model version share one scale and stay comparable.
HEATMAP_SCALE = 1.5


def _scorer_for(record: ModelVersion):
    ckpt_key = keys.model_file(record.line_id, record.version, "model.ckpt")
    meta = b2_store.head(ckpt_key)
    if meta is None:
        raise RuntimeError(f"Checkpoint '{ckpt_key}' is missing from B2")
    path = local_cache.fetch(ckpt_key, meta["etag"])
    return cached_scorer(f"{record.line_id}/{record.version}@{meta['etag']}", path)


def score_parts(line_id: str, parts: list[dict], version: str) -> list[dict]:
    """Score ``parts`` (part index dicts) with ``version``; returns the new rows.

    Raises InspectionError 503 without the ML extra, 409 for a non-ready version.
    """
    if not anomaly_engine.ml_installed():
        raise unavailable(anomaly_engine.INSTALL_HINT)
    if not parts:
        return []
    record = model_versions.require_ready(line_id, version)
    try:
        scorer = _scorer_for(record)
    except anomaly_engine.EngineUnavailable as e:
        raise unavailable(str(e)) from None
    threshold = float(record.threshold or 0.0)
    rows = []
    for part in parts:
        image_path = local_cache.fetch(part["image_key"], part.get("etag", ""))
        score, amap = scorer.score(image_path)
        overlay = heatmap.render_overlay(
            image_path.read_bytes(), amap, vmax=threshold * HEATMAP_SCALE or float(amap.max())
        )
        heatmap_key = keys.heatmap(line_id, part["capture_date"], part["serial"], version)
        b2_store.put_bytes(heatmap_key, overlay, "image/png")
        rows.append(
            {
                "line_id": line_id,
                "serial": part["serial"],
                "capture_date": date.fromisoformat(part["capture_date"]),
                "image_key": part["image_key"],
                "heatmap_key": heatmap_key,
                "score": score,
                "threshold": threshold,
                "above_threshold": score >= threshold,
                "model_version": version,
                "backbone": record.backbone,
                "anomalib_version": record.anomalib_version or "",
                "scored_at": datetime.now(UTC),
            }
        )
    # One immutable part file per call, partitioned by the first part's date.
    parquet_key = keys.scores_part(line_id, parts[0]["capture_date"])
    b2_store.put_bytes(parquet_key, parquet_scores.encode_rows(rows), "application/vnd.apache.parquet")
    logger.info("Scored %d part(s) on %s with %s -> %s", len(rows), line_id, version, parquet_key)
    return rows
