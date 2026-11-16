"""PatchCore training through Anomalib's Folder datamodule and Engine.

The run directory holds links into the local cache, which was filled from B2
(repo/local_cache.py); Anomalib reads nothing else.

    <run>/train/good/*.png     normal training images
    <run>/test/good/*.png      held-out normal images
    <run>/test/defect/*.png    anomalous images (optional)
"""

import logging
from pathlib import Path

from app.repo.anomaly_engine import build_model, lightning_accelerator, load_ml, resolve_device
from app.repo.anomaly_infer import Scorer

logger = logging.getLogger(__name__)


def _fit(ml, run_dir: Path, image_size: int, coreset_ratio: float, device: str):
    has_defects = (run_dir / "test" / "defect").is_dir()
    datamodule = ml.Folder(
        name=run_dir.name,
        root=run_dir,
        normal_dir="train/good",
        abnormal_dir="test/defect" if has_defects else None,
        normal_test_dir="test/good",
        train_batch_size=8,
        eval_batch_size=8,
        num_workers=0,
        seed=0,
    )
    model = build_model(ml, image_size, coreset_ratio)
    engine = ml.Engine(
        accelerator=lightning_accelerator(device),
        devices=1,
        default_root_dir=str(run_dir / "lightning"),
        logger=False,
        enable_progress_bar=False,
    )
    engine.fit(model=model, datamodule=datamodule)
    return model


def train_patchcore(run_dir: Path, image_size: int, coreset_ratio: float) -> Scorer:
    """Fit PatchCore on ``run_dir`` and return a Scorer holding the new model.

    Device is auto-detected (CUDA -> MPS -> CPU, or INSPECTION_DEVICE). If the
    fit fails on MPS it is retried once on CPU.
    """
    ml = load_ml()
    ml.torch.manual_seed(0)
    device = resolve_device(ml.torch)
    try:
        model = _fit(ml, run_dir, image_size, coreset_ratio, device)
    except (RuntimeError, NotImplementedError) as e:
        if device != "mps":
            raise
        logger.warning("PatchCore fit failed on MPS (%s); retrying on CPU", e)
        device = "cpu"
        model = _fit(ml, run_dir, image_size, coreset_ratio, device)
    # The checkpoint stores the bank as float16; round it the same way now so
    # the eval scores (and so the threshold) match what scoring will compute.
    model.model.memory_bank = model.model.memory_bank.half().float()
    logger.info(
        "PatchCore trained: memory bank %s on %s",
        tuple(model.model.memory_bank.shape),
        device,
    )
    return Scorer(ml, model, image_size, device)
