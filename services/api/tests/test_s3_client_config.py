"""Every boto3 client carries the attribution user agent and B2-safe checksums."""

import ast
from pathlib import Path

from app.repo.b2_client import get_s3_bulk_client, get_s3_client

API_ROOT = Path(__file__).resolve().parents[1]
UA = "b2ai-anomalib-inspection-archive"


def _client_calls():
    for path in [*API_ROOT.joinpath("app").rglob("*.py"), *API_ROOT.joinpath("scripts").rglob("*.py")]:
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in {"client", "resource"}
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "boto3"
            ):
                yield path, node


def _config_kwargs(call: ast.Call) -> dict[str, object]:
    for kw in call.keywords:
        if kw.arg == "config" and isinstance(kw.value, ast.Call):
            return {
                k.arg: k.value.value
                for k in kw.value.keywords
                if isinstance(k.value, ast.Constant)
            }
    return {}


def test_every_boto3_client_sets_user_agent_and_checksums():
    calls = list(_client_calls())
    assert len(calls) >= 2  # the app's factory and the CORS setup script
    for path, call in calls:
        config = _config_kwargs(call)
        where = f"{path.relative_to(API_ROOT)}:{call.lineno}"
        assert config.get("user_agent_extra") == UA, where
        assert config.get("request_checksum_calculation") == "when_required", where
        assert config.get("response_checksum_validation") == "when_required", where


def test_runtime_client_config():
    for client in (get_s3_client(), get_s3_bulk_client()):
        config = client.meta.config
        assert config.user_agent_extra == UA
        assert config.request_checksum_calculation == "when_required"
        assert config.response_checksum_validation == "when_required"
    assert get_s3_client().meta.config.read_timeout == 30
    assert get_s3_bulk_client().meta.config.read_timeout == 300
