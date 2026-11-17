"""Bounded B2 connectivity check behind /health.

The probe runs on its own thread and /health waits at most
``_HEALTH_WAIT_SECONDS`` for it, so an unreachable B2 can never make the API
look dead to dev tooling or uptime monitors.
"""

import time
from threading import Lock, Thread

from app.config import settings
from app.repo.b2_client import get_s3_client

# Cache the B2 connectivity result briefly so uptime monitors polling /health
# every few seconds don't issue a B2 head_bucket on every call.
_HEALTH_TTL_SECONDS = 5.0
# /health never waits longer than this for B2. An unreachable endpoint can take
# a minute to fail (connect timeout x resolved addresses x retries); dev tooling
# and uptime probes must still see the API answer, so the probe runs on its own
# thread and /health reports the last known result (or "not connected") meanwhile.
_HEALTH_WAIT_SECONDS = 2.0
_health_cache: tuple[float, bool] | None = None
_health_lock = Lock()
_probe_thread: Thread | None = None


def _probe_b2() -> bool:
    try:
        get_s3_client().head_bucket(Bucket=settings.b2_bucket_name)
        return True
    except Exception:
        return False


def _run_probe() -> None:
    global _health_cache
    ok = _probe_b2()
    with _health_lock:
        _health_cache = (time.monotonic(), ok)


def check_connectivity() -> bool:
    global _probe_thread
    with _health_lock:
        cached = _health_cache
        if cached is not None and time.monotonic() - cached[0] < _HEALTH_TTL_SECONDS:
            return cached[1]
        if _probe_thread is None or not _probe_thread.is_alive():
            _probe_thread = Thread(target=_run_probe, name="b2-health-probe", daemon=True)
            _probe_thread.start()
        probe = _probe_thread
    probe.join(_HEALTH_WAIT_SECONDS)
    with _health_lock:
        latest = _health_cache
    return latest[1] if latest is not None else False
