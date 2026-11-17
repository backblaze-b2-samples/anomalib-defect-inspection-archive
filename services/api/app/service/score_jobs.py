"""Score every unscored part of a line in the background, server-side.

One job per line at a time, run on the shared train runner (one ML job at a
time in this process), so it survives the browser leaving or reloading the
page. Progress lives in memory: a job is a convenience over parts that stay
`unscored` in B2 until scored, so an API restart loses only the progress view,
never evidence; scoring again picks up whatever is still unscored.
"""

import logging
from datetime import UTC, datetime
from threading import Lock

from app.repo import anomaly_engine
from app.service import lines, scoring, state, train_runner
from app.service.errors import conflict, unavailable
from app.types.inspection import PartStatus
from app.types.lines import ScoreJob, ScoreJobStatus

logger = logging.getLogger(__name__)

_lock = Lock()
_jobs: dict[str, ScoreJob] = {}
_UNFINISHED = (ScoreJobStatus.queued, ScoreJobStatus.running)


def get(line_id: str) -> ScoreJob:
    """The line's latest job, or an `idle` placeholder."""
    lines.get_line(line_id)
    with _lock:
        job = _jobs.get(line_id)
        return job.model_copy() if job else ScoreJob(line_id=line_id, status=ScoreJobStatus.idle)


def start(line_id: str, version: str | None = None) -> ScoreJob:
    """Queue a job with `version` (default: the line's active model).

    Returns the line's running job if any. Training passes the version it is
    about to activate, so the job exists before the line names it active.
    """
    version = version or lines.get_line(line_id).active_model_version
    if not version:
        raise conflict(f"Line '{line_id}' has no active model yet; train one first")
    if not anomaly_engine.ml_installed():
        raise unavailable(anomaly_engine.INSTALL_HINT)
    with _lock:
        current = _jobs.get(line_id)
        if current and current.status in _UNFINISHED:
            return current.model_copy()
        job = ScoreJob(
            line_id=line_id,
            status=ScoreJobStatus.queued,
            model_version=version,
            started_at=datetime.now(UTC),
        )
        _jobs[line_id] = job
        snapshot = job.model_copy()
    train_runner.submit(f"score:{line_id}", lambda: _run(line_id, version))
    return snapshot


def _update(line_id: str, **changes) -> None:
    with _lock:
        job = _jobs[line_id]
        for name, value in changes.items():
            setattr(job, name, value)


def _run(line_id: str, version: str) -> None:
    """The job body: runs on the train-runner thread, one part per scoring call."""
    try:
        st = state.load_line_state(line_id)
        pending = sorted(
            (part for serial, part in st.parts.items()
             if state.part_status(st, serial) == PartStatus.unscored),
            # Production parts first: they are what an operator waits on;
            # reference images are labelled already and scored for the record.
            key=lambda part: (part.get("reference") is not None, part["captured_at"]),
        )
    except Exception as e:
        logger.exception("Score job %s could not read the line", line_id)
        _update(line_id, status=ScoreJobStatus.failed, error=f"{type(e).__name__}: {e}"[:300],
                finished_at=datetime.now(UTC))
        return
    _update(line_id, status=ScoreJobStatus.running, total=len(pending))
    scored = failed = 0
    for part in pending:
        try:
            scoring.score_parts(line_id, [part], version)
            scored += 1
            _update(line_id, scored=scored)
        except Exception as e:
            failed += 1
            logger.exception("Score job %s: %s failed", line_id, part["serial"])
            _update(line_id, failed=failed, error=f"{part['serial']}: {e}"[:300])
    final = ScoreJobStatus.failed if failed and not scored else ScoreJobStatus.done
    _update(line_id, status=final, finished_at=datetime.now(UTC))
    logger.info("Score job %s: %d scored, %d failed with %s", line_id, scored, failed, version)


def _reset_for_tests() -> None:
    with _lock:
        _jobs.clear()
