#!/usr/bin/env python3
"""`make demo`: leave a line with flagged parts waiting in the review queue.

Runs against the dev servers started by `pnpm dev` (API on API_PORT, default
8000; web on WEB_PORT, default 3000) over plain HTTP, exactly as the browser
would: create a `demo-<utc-ts>` line, capture VisA reference images (presigned
PUT straight to B2), train v1 from them, capture a few new normal and anomalous
parts, and open /review. No verdicts are recorded, so the flagged parts stay in
the queue for you. Needs B2 credentials and the ML extra (`pnpm setup:ml`) in
the API's environment. Deletes nothing.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import webbrowser
from datetime import UTC, datetime
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
API = f"http://localhost:{os.environ.get('API_PORT', '8000')}"
WEB = f"http://localhost:{os.environ.get('WEB_PORT', '3000')}"


def _ok(response: httpx.Response) -> dict:
    if response.status_code >= 400:
        raise SystemExit(f"{response.request.method} {response.request.url} -> {response.status_code}: {response.text}")
    return response.json()


def _capture(api: httpx.Client, line_id: str, serial: str, path: Path, reference: str | None) -> dict:
    data = path.read_bytes()
    presign = _ok(api.post(f"/lines/{line_id}/parts/presign",
                           json={"serial": serial, "content_type": "image/png", "size_bytes": len(data)}))
    for attempt in range(4):
        put = httpx.put(presign["upload_url"], content=data, headers=presign["headers"], timeout=120)
        if put.status_code < 500:
            break
        time.sleep(2**attempt)
    if put.status_code != 200:
        raise SystemExit(f"direct PUT to B2 failed: {put.status_code} {put.text[:200]}")
    body = {"serial": serial, "image_key": presign["image_key"], "reference": reference}
    return _ok(api.post(f"/lines/{line_id}/parts", json=body))


def main() -> int:
    visa = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "visa_subset.py")],
        check=True, capture_output=True, text=True,
    ).stdout.strip().splitlines()[-1]
    images = Path(visa) / "candle"
    with httpx.Client(base_url=API, timeout=600) as api:
        engine = _ok(api.get("/engine"))
        if not engine["ml_available"]:
            raise SystemExit(engine["install_hint"])
        line_id = f"demo-{datetime.now(UTC).strftime('%Y%m%dt%H%M%S')}"
        _ok(api.post("/lines", json={"line_id": line_id, "name": "Demo line (VisA candle)",
                                      "description": "Created by make demo"}))
        for i, path in enumerate(sorted((images / "train_normal").glob("*.png"))[:12]):
            _capture(api, line_id, f"REF-N-{i:03d}", path, "normal")
        anomalies = sorted((images / "test_anomaly").glob("*.png"))
        for i, path in enumerate(anomalies[:3]):
            _capture(api, line_id, f"REF-A-{i:03d}", path, "anomalous")
        version = _ok(api.post(f"/lines/{line_id}/models", json={"coreset_ratio": 0.01}))["version"]
        while True:
            record = _ok(api.get(f"/lines/{line_id}/models/{version}"))
            if record["status"] not in ("queued", "training"):
                break
            time.sleep(5)
        if record["status"] != "ready":
            raise SystemExit(f"training ended {record['status']}: {record.get('error')}")
        new_parts = [(f"CNDL-N-{i:03d}", p) for i, p in enumerate(sorted((images / "test_normal").glob("*.png"))[:4])]
        new_parts += [(f"CNDL-A-{i:03d}", p) for i, p in enumerate(anomalies[3:6])]
        for serial, path in new_parts:
            record = _capture(api, line_id, serial, path, None)
        _ok(api.get("/review-queue", params={"line_id": line_id}))
    url = f"{WEB}/review?line={line_id}"
    webbrowser.open(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
