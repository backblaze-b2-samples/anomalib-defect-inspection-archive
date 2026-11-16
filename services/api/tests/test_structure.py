"""Structural tests that enforce layering rules and code quality invariants."""

import ast
from pathlib import Path

APP_ROOT = Path(__file__).parent.parent / "app"

# Layer ordering: lower layers must not import from higher layers
LAYER_ORDER = ["types", "config", "repo", "service", "runtime"]

# Map of layer -> set of layers it must NOT import from
FORBIDDEN_IMPORTS: dict[str, set[str]] = {}
for i, layer in enumerate(LAYER_ORDER):
    # Each layer cannot import from layers above it
    FORBIDDEN_IMPORTS[layer] = set(LAYER_ORDER[i + 1 :])


def _get_python_files(directory: Path) -> list[Path]:
    """Get all .py files in a directory recursively."""
    return list(directory.rglob("*.py"))


def _get_imports(filepath: Path) -> list[str]:
    """Extract all import module names from a Python file."""
    try:
        tree = ast.parse(filepath.read_text())
    except SyntaxError:
        return []

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)
    return imports


def _layer_of_import(module: str) -> str | None:
    """Return the layer name if the import is from app.<layer>, else None."""
    if not module.startswith("app."):
        return None
    parts = module.split(".")
    if len(parts) >= 2:
        return parts[1]
    return None


def test_no_backward_imports():
    """Verify no layer imports from a higher layer."""
    violations = []
    for layer in LAYER_ORDER:
        layer_dir = APP_ROOT / layer
        if not layer_dir.exists():
            continue
        for pyfile in _get_python_files(layer_dir):
            for imp in _get_imports(pyfile):
                imported_layer = _layer_of_import(imp)
                if imported_layer and imported_layer in FORBIDDEN_IMPORTS[layer]:
                    rel = pyfile.relative_to(APP_ROOT.parent)
                    violations.append(
                        f"{rel}: {layer}/ imports from {imported_layer}/ ({imp})"
                    )
    assert violations == [], "Backward import violations:\n" + "\n".join(violations)


def test_boto3_only_in_repo():
    """Verify boto3 is only imported in app/repo/."""
    violations = []
    for layer in LAYER_ORDER:
        if layer == "repo":
            continue
        layer_dir = APP_ROOT / layer
        if not layer_dir.exists():
            continue
        for pyfile in _get_python_files(layer_dir):
            for imp in _get_imports(pyfile):
                if imp == "boto3" or imp.startswith("boto3.") or imp == "botocore" or imp.startswith("botocore."):
                    rel = pyfile.relative_to(APP_ROOT.parent)
                    violations.append(f"{rel}: boto3/botocore imported outside repo/")
    assert violations == [], "boto3 boundary violations:\n" + "\n".join(violations)


def test_api_app_python_file_size_limit():
    """Verify authored Python under services/api/app stays within 300 lines."""
    violations = []
    for pyfile in _get_python_files(APP_ROOT):
        line_count = len(pyfile.read_text().splitlines())
        if line_count > 300:
            rel = pyfile.relative_to(APP_ROOT.parent)
            violations.append(f"{rel}: {line_count} lines (max 300)")
    assert violations == [], "File size violations:\n" + "\n".join(violations)


def test_all_layers_exist():
    """Verify all expected layer directories exist."""
    for layer in LAYER_ORDER:
        layer_dir = APP_ROOT / layer
        assert layer_dir.exists(), f"Missing layer directory: app/{layer}/"
        init_file = layer_dir / "__init__.py"
        assert init_file.exists(), f"Missing __init__.py in app/{layer}/"


ML_MODULES = {"torch", "torchvision", "anomalib", "lightning", "timm"}
ANOMALY_MODULES = {"anomaly_engine.py", "anomaly_train.py", "anomaly_infer.py"}


def _top_level_imports(filepath: Path) -> list[str]:
    tree = ast.parse(filepath.read_text())
    names = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
    return names


def test_ml_stack_only_in_anomaly_modules_and_never_at_import_time():
    """torch/anomalib/lightning/timm are an optional extra: contained in
    repo/anomaly_*.py and imported lazily, so the core API runs without them."""
    violations = []
    for pyfile in _get_python_files(APP_ROOT):
        rel = pyfile.relative_to(APP_ROOT.parent)
        source = pyfile.read_text()
        for imp in _get_imports(pyfile):
            if imp.split(".")[0] in ML_MODULES:
                violations.append(f"{rel}: imports {imp}")
        if pyfile.name not in ANOMALY_MODULES:
            for name in ML_MODULES:
                if f'import_module("{name}' in source:
                    violations.append(f"{rel}: lazily imports {name} outside repo/anomaly_*")
        for imp in _top_level_imports(pyfile):
            if imp.split(".")[0] in ML_MODULES:
                violations.append(f"{rel}: top-level import of {imp}")
    assert violations == [], "ML containment violations:\n" + "\n".join(violations)


def test_pyarrow_only_in_parquet_repo_module():
    violations = []
    for pyfile in _get_python_files(APP_ROOT):
        if pyfile.name == "parquet_scores.py" and pyfile.parent.name == "repo":
            continue
        for imp in _get_imports(pyfile):
            if imp.split(".")[0] == "pyarrow":
                violations.append(str(pyfile.relative_to(APP_ROOT.parent)))
    assert violations == [], "pyarrow outside repo/parquet_scores.py:\n" + "\n".join(violations)


def test_core_app_imports_without_the_ml_extra():
    """Importing the API must not import torch (it may not be installed)."""
    import subprocess
    import sys

    code = "import sys, main; sys.exit(1 if 'torch' in sys.modules else 0)"
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=APP_ROOT.parent, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
