"""One background worker thread that runs training jobs FIFO, one at a time.

A job's status lives in its ModelVersion record in B2, not here. This module
only knows which jobs THIS process has accepted and not finished; a record that
claims `queued`/`training` but is unknown here was left behind by an earlier
process, and ``model_versions.reconcile`` marks it `interrupted`.
"""

import logging
import queue
import threading
from collections.abc import Callable

logger = logging.getLogger(__name__)

_jobs: "queue.Queue[tuple[str, Callable[[], None]]]" = queue.Queue()
_tracked: set[str] = set()
_lock = threading.Lock()
_worker: threading.Thread | None = None


def _run() -> None:
    while True:
        job_id, fn = _jobs.get()
        try:
            fn()
        except Exception:
            logger.exception("Training job %s crashed", job_id)
        finally:
            with _lock:
                _tracked.discard(job_id)
            _jobs.task_done()


def track(job_id: str) -> None:
    """Claim a job id before its record is written (see module docstring)."""
    with _lock:
        _tracked.add(job_id)


def submit(job_id: str, fn: Callable[[], None]) -> None:
    global _worker
    with _lock:
        _tracked.add(job_id)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, name="train-runner", daemon=True)
            _worker.start()
    _jobs.put((job_id, fn))


def is_tracked(job_id: str) -> bool:
    with _lock:
        return job_id in _tracked


def queue_depth() -> int:
    return _jobs.qsize()


def wait_idle(timeout: float | None = None) -> bool:
    """Block until every accepted job finished (used by tests and the self-test)."""
    done = threading.Event()

    def _waiter() -> None:
        _jobs.join()
        done.set()

    threading.Thread(target=_waiter, daemon=True).start()
    return done.wait(timeout)


def _reset_for_tests() -> None:
    with _lock:
        _tracked.clear()
