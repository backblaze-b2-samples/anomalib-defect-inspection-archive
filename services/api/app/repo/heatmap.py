"""Image helpers: normalize captures to PNG and render anomaly heatmaps.

Pillow + numpy only (no torch), so the core API can import this without the ML
extra. The anomaly map arrives as a plain 2-D float array from the engine.
"""

import io

import numpy as np
from PIL import Image, UnidentifiedImageError

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"
MAX_PIXELS = 40_000_000


class BadImage(ValueError):
    """The bytes are not a decodable PNG or JPEG image."""


def sniff(data: bytes) -> str | None:
    if data[:8] == PNG_MAGIC:
        return "image/png"
    if data[:3] == JPEG_MAGIC:
        return "image/jpeg"
    return None


def to_png(data: bytes) -> tuple[bytes, bool]:
    """Return (png_bytes, converted). PNG input is validated and kept as-is."""
    kind = sniff(data)
    if kind is None:
        raise BadImage("Image must be a PNG or JPEG file")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > MAX_PIXELS:
                raise BadImage("Image is too large")
            image.load()
            if kind == "image/png":
                return data, False
            out = io.BytesIO()
            image.convert("RGB").save(out, format="PNG")
            return out.getvalue(), True
    except (UnidentifiedImageError, OSError) as e:
        raise BadImage(f"Image could not be decoded: {e}") from None


def _colormap(values: np.ndarray) -> np.ndarray:
    """Map [0, 1] to an RGB 'jet'-style ramp (blue -> green -> yellow -> red)."""
    v = np.clip(values, 0.0, 1.0)
    red = np.clip(1.5 - np.abs(4.0 * v - 3.0), 0.0, 1.0)
    green = np.clip(1.5 - np.abs(4.0 * v - 2.0), 0.0, 1.0)
    blue = np.clip(1.5 - np.abs(4.0 * v - 1.0), 0.0, 1.0)
    return (np.stack([red, green, blue], axis=-1) * 255).astype(np.uint8)


def render_overlay(
    image_png: bytes, anomaly_map: np.ndarray, vmax: float, alpha: float = 0.5
) -> bytes:
    """Colour overlay of ``anomaly_map`` on the image, at the stored image size.

    ``vmax`` fixes the colour scale (raw score units) so heatmaps from one model
    version are comparable: values at or above ``vmax`` are fully red.
    """
    amap = np.asarray(anomaly_map, dtype=np.float32).squeeze()
    if amap.ndim != 2:
        raise ValueError(f"anomaly map must be 2-D, got shape {amap.shape}")
    with Image.open(io.BytesIO(image_png)) as source:
        base = source.convert("RGB")
    scaled = amap / max(float(vmax), 1e-6)
    heat = Image.fromarray(_colormap(scaled)).resize(base.size, Image.Resampling.BILINEAR)
    blended = Image.blend(base, heat, alpha)
    out = io.BytesIO()
    blended.save(out, format="PNG")
    return out.getvalue()
