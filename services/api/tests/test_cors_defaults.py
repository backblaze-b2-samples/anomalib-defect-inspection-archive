"""The default CORS allowlist covers both spellings of the local dev origin."""

from app.config.settings import Settings


def test_default_cors_origins_cover_localhost_and_loopback_ip():
    default = Settings.model_fields["api_cors_origins"].default
    origins = {o.strip() for o in default.split(",")}
    # Opening the dev app as http://127.0.0.1:3000 must not turn every API
    # call into an opaque CORS failure.
    assert {"http://localhost:3000", "http://127.0.0.1:3000"} <= origins
