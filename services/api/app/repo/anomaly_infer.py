"""PatchCore scoring: load a checkpoint from the local cache and score images.

Scores are the raw PatchCore image scores (max patch distance to the memory
bank), the same units as the thresholds stored in metrics.json.
"""

import logging
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
from PIL import Image

from app.repo.anomaly_engine import (
    CHECKPOINT_FORMAT,
    LAYERS,
    WEIGHTS,
    build_model,
    load_ml,
    resolve_device,
)

logger = logging.getLogger(__name__)


class Scorer:
    """A trained PatchCore model ready to score images on one device."""

    def __init__(self, ml, model, image_size: int, device: str) -> None:
        self._ml = ml
        self._model = model
        self.image_size = image_size
        self.device = device
        self._lock = threading.Lock()
        model.eval()
        self._move(device)

    def _move(self, device: str) -> None:
        self._model.to(device)
        self.device = device

    def _tensor(self, image_path: Path):
        torch = self._ml.torch
        with Image.open(image_path) as image:
            array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        tensor = torch.from_numpy(array).permute(2, 0, 1).contiguous()
        batch = self._model.pre_processor.transform(tensor).unsqueeze(0)
        return batch.to(self.device)

    def score(self, image_path: Path) -> tuple[float, np.ndarray]:
        """(raw image score, 2-D anomaly map) for one image file."""
        torch = self._ml.torch
        with self._lock, torch.no_grad():
            try:
                output = self._model.model(self._tensor(image_path))
            except (RuntimeError, NotImplementedError) as e:
                if self.device != "mps":
                    raise
                logger.warning("MPS scoring failed (%s); falling back to CPU", e)
                self._move("cpu")
                output = self._model.model(self._tensor(image_path))
        score = float(output.pred_score.reshape(-1)[0].item())
        amap = output.anomaly_map.detach().float().cpu().numpy().squeeze()
        return score, amap

    def save_checkpoint(self, path: Path, extra: dict) -> None:
        """Persist only what scoring needs: the memory bank plus its config.

        The bank is stored as float16 (half the bytes to move to and from B2)
        and upcast to float32 on load, so distances are computed in float32.
        """
        torch = self._ml.torch
        payload = {
            "format": CHECKPOINT_FORMAT,
            "weights": WEIGHTS,
            "layers": list(LAYERS),
            "image_size": int(self.image_size),
            "memory_bank": self._model.model.memory_bank.detach().cpu().half(),
            **{k: v for k, v in extra.items() if isinstance(v, (str, int, float))},
        }
        torch.save(payload, str(path))


def load_scorer(checkpoint_path: Path) -> Scorer:
    """Rebuild a Scorer from a checkpoint written by ``Scorer.save_checkpoint``."""
    ml = load_ml()
    payload = ml.torch.load(str(checkpoint_path), map_location="cpu", weights_only=True)
    if payload.get("format") != CHECKPOINT_FORMAT:
        raise RuntimeError(f"Unsupported checkpoint format: {payload.get('format')!r}")
    if payload.get("weights") != WEIGHTS:
        raise RuntimeError(f"Checkpoint was built on {payload.get('weights')}, not {WEIGHTS}")
    image_size = int(payload["image_size"])
    model = build_model(ml, image_size)
    model.model.memory_bank = payload["memory_bank"].float()
    return Scorer(ml, model, image_size, resolve_device(ml.torch))


_CACHE_LIMIT = 2
_cache: OrderedDict[str, Scorer] = OrderedDict()
_cache_lock = threading.Lock()


def cached_scorer(cache_key: str, checkpoint_path: Path) -> Scorer:
    """Keep the most recently used model versions resident (at most two)."""
    with _cache_lock:
        if cache_key in _cache:
            _cache.move_to_end(cache_key)
            return _cache[cache_key]
    scorer = load_scorer(checkpoint_path)
    with _cache_lock:
        _cache[cache_key] = scorer
        while len(_cache) > _CACHE_LIMIT:
            _cache.popitem(last=False)
    return scorer
