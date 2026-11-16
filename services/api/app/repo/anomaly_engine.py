"""Anomalib PatchCore engine: availability, device choice and backbone pins.

The ML stack (torch, torchvision, anomalib, lightning, timm) is an OPTIONAL
extra (services/api/requirements-ml.txt, `pnpm setup:ml`). It is imported only
here and in the sibling ``anomaly_train`` / ``anomaly_infer`` modules, and only
inside functions, so the core API, `pnpm verify` and CI never need it. Without
it, scoring and training raise ``EngineUnavailable`` (the API answers 503 with
the install command) while capture still stores images.
"""

import importlib
import importlib.metadata
import importlib.util
import logging
import os
from types import SimpleNamespace

from app.config import settings

logger = logging.getLogger(__name__)

# Backbone: torchvision's ImageNet weights as republished by timm, BSD-3-Clause
# per the model card (https://huggingface.co/timm/wide_resnet50_2.tv2_in1k).
# The weights tag is pinned so Anomalib/timm can never silently pick others.
BACKBONE = "wide_resnet50_2"
WEIGHTS = "wide_resnet50_2.tv2_in1k"
WEIGHTS_URL = "https://huggingface.co/timm/wide_resnet50_2.tv2_in1k"
WEIGHTS_LICENSE = "BSD-3-Clause"
LAYERS = ("layer2", "layer3")
NUM_NEIGHBORS = 9
CHECKPOINT_FORMAT = "anomalib-patchcore-memory-bank/1"
INSTALL_HINT = (
    "The anomaly engine is not installed. Run `pnpm setup:ml` "
    "(installs services/api/requirements-ml.txt into services/api/.venv), then restart the API."
)
ML_MODULES = ("torch", "torchvision", "anomalib", "lightning", "timm")
DEVICES = ("auto", "cpu", "cuda", "mps")


class EngineUnavailable(RuntimeError):
    """The optional ML extra is not installed."""

    def __init__(self) -> None:
        super().__init__(INSTALL_HINT)


def ml_installed() -> bool:
    """Cheap check (no import) that every ML module can be found."""
    return all(importlib.util.find_spec(name) is not None for name in ML_MODULES)


def load_ml() -> SimpleNamespace:
    """Import the ML stack lazily. Raises EngineUnavailable when it is missing."""
    # Some PatchCore ops lack an MPS kernel; let them fall back to CPU instead
    # of raising. Must be set before torch is imported.
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    try:
        torch = importlib.import_module("torch")
        anomalib_data = importlib.import_module("anomalib.data")
        anomalib_models = importlib.import_module("anomalib.models")
        anomalib_engine = importlib.import_module("anomalib.engine")
    except ImportError as e:
        logger.warning("Anomaly engine unavailable: %s", e)
        raise EngineUnavailable() from None
    return SimpleNamespace(
        torch=torch,
        Folder=anomalib_data.Folder,
        Patchcore=anomalib_models.Patchcore,
        Engine=anomalib_engine.Engine,
    )


def anomalib_version() -> str | None:
    try:
        return importlib.metadata.version("anomalib")
    except importlib.metadata.PackageNotFoundError:
        return None


def torch_version() -> str | None:
    try:
        return importlib.metadata.version("torch")
    except importlib.metadata.PackageNotFoundError:
        return None


def resolve_device(torch, requested: str | None = None) -> str:
    """First available of CUDA -> Apple MPS -> CPU for "auto"; else the forced one.

    A forced GPU that is not present falls back to CPU with a warning rather
    than failing: a GPU is optional, never required.
    """
    choice = (requested or settings.inspection_device or "auto").lower()
    if choice not in DEVICES:
        logger.warning("Unknown INSPECTION_DEVICE=%s; using auto", choice)
        choice = "auto"
    cuda = bool(torch.cuda.is_available())
    mps = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    if choice == "auto":
        return "cuda" if cuda else "mps" if mps else "cpu"
    if (choice == "cuda" and not cuda) or (choice == "mps" and not mps):
        logger.warning("INSPECTION_DEVICE=%s is not available here; using cpu", choice)
        return "cpu"
    return choice


def lightning_accelerator(device: str) -> str:
    return {"cuda": "gpu", "mps": "mps"}.get(device, "cpu")


def build_model(ml: SimpleNamespace, image_size: int, coreset_ratio: float = 0.1):
    """A PatchCore Lightning module with the pinned backbone weights.

    Post-processing, evaluation and visualization are switched off: the app
    keeps raw anomaly scores (threshold and score in the same units) and
    computes its own metrics on the B2-read eval split.
    """
    pre_processor = ml.Patchcore.configure_pre_processor(image_size=(image_size, image_size))
    return ml.Patchcore(
        backbone=WEIGHTS,
        layers=list(LAYERS),
        pre_trained=True,
        coreset_sampling_ratio=coreset_ratio,
        num_neighbors=NUM_NEIGHBORS,
        pre_processor=pre_processor,
        post_processor=False,
        evaluator=False,
        visualizer=False,
    )


def status() -> dict:
    """Engine facts for GET /engine. Imports torch only when it is installed."""
    available = ml_installed()
    device = "cpu"
    if available:
        try:
            device = resolve_device(load_ml().torch)
        except EngineUnavailable:
            available = False
    return {
        "ml_available": available,
        "anomalib_version": anomalib_version() if available else None,
        "torch_version": torch_version() if available else None,
        "device": device,
        "backbone": BACKBONE,
        "weights": WEIGHTS,
        "install_hint": None if available else INSTALL_HINT,
    }
